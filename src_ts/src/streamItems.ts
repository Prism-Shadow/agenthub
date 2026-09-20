// Copyright 2025 Prism Shadow. and/or its affiliates
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { isDeepStrictEqual } from "util";
import { parseToolCallArguments, StreamProtocolError } from "./errors";
import {
  ContentItem,
  DeltaContentItem,
  EventContentItem,
  Fidelity,
} from "./types";

/**
 * How a kind of item streams: the one field its deltas grow, and the fields only its first
 * delta carries. A done item is the first delta with the growing field replaced by the join of
 * every delta's, so this table is the only per-kind knowledge in the stream.
 */
interface Kind {
  field: string;
  header: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  join: (chunks: any[]) => any;
  // the joined value becomes the done item's; tool call arguments stream as a JSON string and
  // are parsed into an object
  parse?: (
    joined: string,
    client: string,
    header: Record<string, string>,
  ) => unknown;
}

const KINDS: Record<string, Kind> = {
  text: { field: "text", header: [], join: (chunks) => chunks.join("") },
  thinking: {
    field: "thinking",
    header: [],
    join: (chunks) => chunks.join(""),
  },
  tool_call: {
    field: "arguments",
    header: ["name", "tool_call_id"],
    join: (chunks) => chunks.join(""),
    parse: (joined, client, header) =>
      parseToolCallArguments(joined, client, header.name, header.tool_call_id),
  },
  inline_data: {
    field: "data",
    header: [],
    join: (chunks) => Buffer.concat(chunks),
  },
  inline_thinking: {
    field: "data",
    header: [],
    join: (chunks) => Buffer.concat(chunks),
  },
  // one whole vector per delta
  embedding: {
    field: "embedding",
    header: [],
    join: (chunks) => chunks.flat(),
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fields = Record<string, any>;

interface Item {
  // the provider's id for the item, or unkeyed-N for one the provider never names
  key: string;
  // the item's number within the stream: what fidelity.item_id carries
  id: string;
  kind: string;
  open: boolean;
  // the first fragment that went out, without its fidelity: the item's header
  first?: Fields;
  // the growing field of every fragment that went out
  chunks: unknown[];
  fidelity?: Fidelity;
}

function hasFidelity(fidelity?: Fidelity): fidelity is Fidelity {
  return fidelity != null && Object.keys(fidelity).length > 0;
}

/**
 * Whether a fragment carries no content: its growing field and header fields are empty.
 */
function bare(kind: Kind, fields: Fields): boolean {
  return (
    fields[kind.field].length === 0 &&
    kind.header.every((name) => !fields[name])
  );
}

/**
 * Assembles the items of one stream from the two things a provider says: here is a fragment of
 * an item (`delta`), and that item ended (`done`). Every fragment goes out as it arrives, and a
 * done item is the item's first fragment with the growing field replaced by the join of every
 * fragment's, plus the item's fidelity. Fragments and done items go out carrying
 * `fidelity.item_id`, the item's number within the stream, which the base client orders by and
 * strips.
 *
 * A fragment belongs to the item its id names. Without an id, or as a continuation whose id
 * names nothing (a tool call fragment without its name cannot start an item), it belongs to the
 * item streamed last while that item is open and of its kind, and starts a new item otherwise.
 * Fidelity sent under an item's id belongs to that item whatever kind it streams.
 *
 * A provider that streams one item at a time and never says where it ends (Chat Completions,
 * generateContent, Interactions) uses `sequential`: the first fragment of the next item ends
 * the previous one, and a fragment of another kind under the open item's id is the next item.
 * By default items end on `done` and may interleave (Anthropic content blocks, Responses output
 * items); the ids of done items are remembered, so a fragment or a second done for one is a
 * protocol error.
 */
export class StreamItems {
  private readonly sequential: boolean;
  private readonly open = new Map<string, Item>();
  private readonly finished = new Set<string>();
  private last: Item | null = null;
  private count = 0;
  private unkeyed = 0;

  constructor(
    private readonly client: string,
    options: { sequential?: boolean } = {},
  ) {
    this.sequential = options.sequential ?? false;
  }

  private protocolError(message: string): StreamProtocolError {
    return new StreamProtocolError({ client: this.client, message });
  }

  /**
   * A fragment of the item under itemId (undefined where the provider sends none). Returns what
   * the client yields: the fragment, preceded by the done item it ended in sequential mode.
   */
  delta(
    itemId: string | undefined,
    fragment: DeltaContentItem,
  ): EventContentItem[] {
    const kind = fragment.type.slice(0, -".delta".length);
    if (itemId && this.finished.has(itemId)) {
      throw this.protocolError(
        `${fragment.type} arrived after item ${itemId} was done`,
      );
    }
    const { fidelity: carried, ...content } = fragment as Fields;
    let fidelity: Fidelity | undefined = carried;
    let fields: Fields = content;

    const headerless = !KINDS[kind].header.some((name) => fields[name]);
    // a fragment of a kind with a header cannot start an item without it
    const continuation = KINDS[kind].header.length > 0 && headerless;

    const out: EventContentItem[] = [];
    let item = itemId ? this.open.get(itemId) : undefined;
    if (item === undefined && (itemId ? continuation : headerless)) {
      // no id, or a continuation whose id names nothing: the item streamed last
      item = this.last?.open && this.last.kind === kind ? this.last : undefined;
    }
    if (item !== undefined && item.kind !== kind) {
      if (item.first === undefined) {
        // an item nothing went out for yet streams the kind of the first fragment that does
        item.kind = kind;
      } else if (bare(KINDS[kind], fields) && hasFidelity(fidelity)) {
        // fidelity sent under an item's id belongs to that item, whatever kind it streams
        const spec = KINDS[item.kind];
        fields = { ...item.first, [spec.field]: spec.join([]) };
      } else if (this.sequential) {
        item = undefined;
      } else {
        throw this.protocolError(
          `${fragment.type} arrived for item ${itemId}, which streams ${item.kind}`,
        );
      }
    }
    if (item === undefined) {
      if (this.sequential && this.last?.open) {
        // the first fragment of the next item ends the previous one
        out.push(...this.close(this.last));
      }
      this.count += 1;
      item = {
        key: itemId || `unkeyed-${this.unkeyed++}`,
        id: String(this.count),
        kind,
        open: true,
        chunks: [],
      };
      this.open.set(item.key, item);
    }
    this.last = item;

    if (hasFidelity(fidelity)) {
      if (item.fidelity === undefined) {
        item.fidelity = fidelity;
      } else if (isDeepStrictEqual(item.fidelity, fidelity)) {
        // repeated fidelity goes out once
        fidelity = undefined;
      } else {
        throw this.protocolError(
          `item ${item.key} carried two different fidelity payloads`,
        );
      }
    }
    const spec = KINDS[item.kind];
    if (bare(spec, fields) && !hasFidelity(fidelity)) {
      // carries nothing; the item is registered all the same
      return out;
    }
    if (item.first === undefined) {
      if (!spec.header.every((name) => fields[name])) {
        throw this.protocolError(
          `the first ${fields.type} of item ${item.key} must carry the ${spec.header.join(" and the ")}`,
        );
      }
      item.first = fields;
    }
    item.chunks.push(fields[spec.field]);
    const emitted: Fields = {
      ...fields,
      fidelity: { item_id: item.id, ...fidelity },
    };
    out.push(emitted as EventContentItem);
    return out;
  }

  /**
   * The provider says the item under itemId ended (no id: the item streamed last). Returns its
   * complete done item, or nothing for an item no fragment of which went out.
   */
  done(itemId?: string): ContentItem[] {
    if (itemId && this.finished.has(itemId)) {
      throw this.protocolError(`item ${itemId} was done twice`);
    }
    const item = itemId
      ? this.open.get(itemId)
      : this.last?.open
        ? this.last
        : undefined;
    if (itemId && !this.sequential) {
      this.finished.add(itemId);
    }
    return item === undefined ? [] : this.close(item);
  }

  /**
   * The provider's stream ended: every item still open is done, in the order they started.
   */
  end(): ContentItem[] {
    return [...this.open.values()].flatMap((item) => this.close(item));
  }

  private close(item: Item): ContentItem[] {
    item.open = false;
    this.open.delete(item.key);
    if (item.first === undefined) {
      return [];
    }

    const spec = KINDS[item.kind];
    const joined = spec.join(item.chunks);
    const value = spec.parse
      ? spec.parse(joined, this.client, item.first)
      : joined;
    const done: Fields = {};
    for (const [name, field] of Object.entries(item.first)) {
      done[name] =
        name === "type"
          ? `${item.kind}.done`
          : name === spec.field
            ? value
            : field;
    }
    done.fidelity = { item_id: item.id, ...item.fidelity };
    return [done as ContentItem];
  }
}
