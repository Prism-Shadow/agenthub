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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fields = Record<string, any>;

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
  parse?: (joined: string, client: string, header: Fields) => unknown;
  // whether a delta begins an item by itself, whatever id it carries
  begins?: (delta: Fields) => boolean;
  // an empty delta of this kind goes out all the same
  keepsEmpty?: boolean;
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
    // a call's name comes once, on its first delta
    begins: (delta) => Boolean(delta.name),
  },
  // an image arrives whole, while audio streams in chunks
  inline_data: {
    field: "data",
    header: [],
    join: (chunks) => Buffer.concat(chunks),
    begins: (delta) => delta.mime_type.startsWith("image/"),
  },
  inline_thinking: {
    field: "data",
    header: [],
    join: (chunks) => Buffer.concat(chunks),
    begins: () => true,
  },
  // one whole vector per delta, and an empty one still stands for the input it was made of
  embedding: {
    field: "embedding",
    header: [],
    join: (chunks) => chunks.flat(),
    begins: () => true,
    keepsEmpty: true,
  },
};

/**
 * The item streaming now.
 */
interface Item {
  // the id its deltas carry, where the provider names its items
  id?: string;
  kind: string;
  // the first delta that went out, without its fidelity: the item's header
  first?: Fields;
  // the growing field of every delta that went out
  chunks: unknown[];
  fidelity?: Fidelity;
}

/**
 * Whether a delta carries no content: its growing field and header fields are empty.
 */
function isEmpty(kind: Kind, fields: Fields): boolean {
  return (
    !kind.keepsEmpty &&
    fields[kind.field].length === 0 &&
    kind.header.every((field) => !fields[field])
  );
}

/**
 * Assembles the items of one stream from the deltas a client yields. Model output is serial, so
 * the deltas of an item are contiguous and one item streams at a time: it is done when a delta of
 * the next item arrives, or when the stream ends.
 *
 * A delta belongs to the next item when it carries another `fidelity.item_id`, is of another
 * kind, or begins an item by itself (a call's name, an image, a vector). Otherwise it continues
 * the item streaming now: a delta without an id does, and so do a call's arguments whatever id a
 * gateway puts on them. Fidelity sent alone under the item's id is that item's, whatever kind
 * carries it.
 *
 * Every delta goes out as it arrives, without its `item_id`. A done item is the item's first
 * delta with the growing field replaced by the join of every delta's, plus the item's fidelity.
 */
export class StreamItems {
  private item: Item | null = null;

  constructor(private readonly client: string) {}

  private protocolError(message: string): StreamProtocolError {
    return new StreamProtocolError({ client: this.client, message });
  }

  /**
   * One delta a client yielded. Returns what goes out: the done item of the item it ended, if
   * any, then the delta itself.
   */
  delta(delta: DeltaContentItem): EventContentItem[] {
    const kind = delta.type.slice(0, -".delta".length);
    if (!delta.type.endsWith(".delta") || !(kind in KINDS)) {
      throw this.protocolError(`a client yields deltas, not ${delta.type}`);
    }
    const { fidelity: carried, ...content } = delta as Fields;
    const { item_id: itemId, ...rest }: Fidelity = carried ?? {};
    let fidelity: Fidelity | undefined =
      Object.keys(rest).length > 0 ? rest : undefined;
    let fields: Fields = content;

    const out: EventContentItem[] = [];
    let item = this.item;
    if (
      item?.first !== undefined &&
      item.kind !== kind &&
      itemId &&
      itemId === item.id &&
      fidelity !== undefined &&
      isEmpty(KINDS[kind], fields)
    ) {
      // fidelity sent alone under the item's id is that item's, whatever kind carries it
      const spec = KINDS[item.kind];
      fields = { ...item.first, [spec.field]: spec.join([]) };
    } else if (item === null || this.begins(item, kind, itemId, fields)) {
      out.push(...this.end());
      item = this.item = { kind, chunks: [] };
    }
    item.id = item.id || itemId;

    const name = item.id ? `item ${item.id}` : "an item";
    if (fidelity !== undefined) {
      if (item.fidelity === undefined) {
        item.fidelity = fidelity;
      } else if (isDeepStrictEqual(item.fidelity, fidelity)) {
        // repeated fidelity goes out once
        fidelity = undefined;
      } else {
        throw this.protocolError(
          `${name} carried two different fidelity payloads`,
        );
      }
    }
    const spec = KINDS[item.kind];
    if (isEmpty(spec, fields) && fidelity === undefined) {
      // carries nothing; the item is streaming all the same
      return out;
    }
    if (item.first === undefined) {
      if (!spec.header.every((field) => fields[field])) {
        throw this.protocolError(
          `the first ${fields.type} of ${name} must carry the ${spec.header.join(" and the ")}`,
        );
      }
      item.first = fields;
    }
    item.chunks.push(fields[spec.field]);
    out.push((fidelity ? { ...fields, fidelity } : fields) as EventContentItem);
    return out;
  }

  /**
   * The next item began, or the stream ended: returns the done item of the item streaming now,
   * or nothing when no delta of it went out.
   */
  end(): ContentItem[] {
    const item = this.item;
    this.item = null;
    if (item === null || item.first === undefined) {
      return [];
    }

    const spec = KINDS[item.kind];
    const joined = spec.join(item.chunks);
    const done: Fields = {
      ...item.first,
      type: `${item.kind}.done`,
      [spec.field]: spec.parse
        ? spec.parse(joined, this.client, item.first)
        : joined,
    };
    if (item.fidelity !== undefined) {
      done.fidelity = item.fidelity;
    }
    return [done as ContentItem];
  }

  /**
   * Whether a delta begins the next item rather than continuing the one streaming now.
   */
  private begins(
    item: Item,
    kind: string,
    itemId: string | undefined,
    fields: Fields,
  ): boolean {
    const spec = KINDS[kind];
    if (item.kind !== kind || spec.begins?.(fields)) {
      return true;
    }
    // what cannot begin an item (a call's arguments) continues the one streaming now
    return (
      spec.header.length === 0 &&
      Boolean(itemId) &&
      Boolean(item.id) &&
      itemId !== item.id
    );
  }
}
