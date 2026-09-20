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
import { EmptyResponseError, StreamProtocolError } from "./errors";
import { normalizeLegacyMessages } from "./legacy";
import { StreamItems } from "./streamItems";
import {
  ContentItem,
  EventContentItem,
  Fidelity,
  FinishReason,
  UniConfig,
  UniEvent,
  UniMessage,
  UsageMetadata,
} from "./types";

/**
 * Whether a content item carries a non-empty fidelity payload.
 */
function hasFidelity(fidelity?: Fidelity): fidelity is Fidelity {
  return fidelity != null && Object.keys(fidelity).length > 0;
}

function deltaEvent(item: EventContentItem): UniEvent {
  return {
    role: "assistant",
    event_type: "delta",
    content_items: [item],
    usage_metadata: null,
    finish_reason: null,
    created_at: Date.now(),
  };
}

interface OpenItem {
  kind: string;
  // the fidelity one of its deltas carried
  fidelity?: Fidelity;
  // events held back while an earlier item is still streaming
  pending: UniEvent[];
  // set once the item's done item arrived
  done?: ContentItem;
}

/**
 * Narrows the events a client yields into the public stream. Items go out one at a time in the
 * order they started, so a caller attributes each delta to the item streaming at that moment: an
 * item that starts while an earlier one is open is held back until the earlier one is done. Every
 * item is checked against the protocol, its `fidelity.item_id` stripped, and the usage and finish
 * reason of the client's stop events merged into the one final stop.
 */
class PublicStream {
  // open item ids, in the order they started
  private readonly order: string[] = [];
  private readonly items = new Map<string, OpenItem>();
  private usageMetadata: UsageMetadata | null = null;
  private finishReason: FinishReason | null = null;
  readonly doneItems: ContentItem[] = [];

  constructor(private readonly client: string) {}

  private protocolError(message: string): StreamProtocolError {
    return new StreamProtocolError({ client: this.client, message });
  }

  // a generator, so the events of an item reach the caller even when a later item of the same
  // client event fails
  *push(event: UniEvent): Generator<UniEvent> {
    if (
      event.event_type === "delta" &&
      (event.usage_metadata != null || event.finish_reason != null)
    ) {
      throw this.protocolError(
        "a delta event carries usage_metadata or finish_reason",
      );
    }

    for (const item of event.content_items) {
      // item_id is stripped before any other rule runs, so it never reaches the public stream
      const { item_id: itemId, ...fidelity }: Fidelity =
        ("fidelity" in item ? item.fidelity : undefined) ?? {};
      if (typeof itemId !== "string" || itemId === "") {
        throw this.protocolError(`${item.type} carries no fidelity.item_id`);
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { fidelity: withItemId, ...content } = item as {
        fidelity?: Fidelity;
      };
      const stripped = (
        hasFidelity(fidelity) ? { ...item, fidelity } : content
      ) as EventContentItem;
      const [kind, phase] = item.type.split(".");
      const open = this.items.get(itemId);

      if (phase === "delta") {
        if (open?.done) {
          throw this.protocolError(
            `${item.type} arrived after item ${itemId} was done`,
          );
        }
        if (open && open.kind !== kind) {
          throw this.protocolError(
            `${item.type} arrived for item ${itemId}, which streams ${open.kind}`,
          );
        }
        if (
          !open &&
          item.type === "tool_call.delta" &&
          (!item.name || !item.tool_call_id)
        ) {
          throw this.protocolError(
            `the first tool_call.delta of item ${itemId} must carry the name and the tool_call_id`,
          );
        }
        const group = open ?? { kind, pending: [] };
        if (!open) {
          this.items.set(itemId, group);
          this.order.push(itemId);
        }
        if (hasFidelity(fidelity)) {
          if (group.fidelity !== undefined) {
            throw this.protocolError(`item ${itemId} carried fidelity twice`);
          }
          group.fidelity = fidelity;
        }
        yield* this.emit(itemId, group, deltaEvent(stripped));
        continue;
      }

      if (!open || open.done) {
        throw this.protocolError(
          `${item.type} arrived for item ${itemId}, which is not streaming`,
        );
      }
      if (open.kind !== kind) {
        throw this.protocolError(
          `${item.type} arrived for item ${itemId}, which streams ${open.kind}`,
        );
      }
      if (!isDeepStrictEqual(open.fidelity ?? {}, fidelity)) {
        throw this.protocolError(
          `the fidelity of ${item.type} differs from what item ${itemId} streamed`,
        );
      }
      open.done = stripped as ContentItem;
      yield* this.flush();
    }

    if (event.usage_metadata) {
      const usage: UsageMetadata = this.usageMetadata ?? {
        cached_tokens: null,
        prompt_tokens: null,
        thoughts_tokens: null,
        response_tokens: null,
      };
      for (const field of [
        "cached_tokens",
        "prompt_tokens",
        "thoughts_tokens",
        "response_tokens",
      ] as const) {
        if (event.usage_metadata[field] != null) {
          usage[field] = event.usage_metadata[field];
        }
      }
      this.usageMetadata = usage;
    }
    if (event.finish_reason) {
      this.finishReason = event.finish_reason;
    }
  }

  private *emit(
    itemId: string,
    group: OpenItem,
    event: UniEvent,
  ): Generator<UniEvent> {
    if (this.order[0] === itemId) {
      yield event;
    } else {
      group.pending.push(event);
    }
  }

  private *flush(): Generator<UniEvent> {
    while (this.order.length > 0) {
      const itemId = this.order[0];
      const group = this.items.get(itemId) as OpenItem;
      if (group.done === undefined) {
        break;
      }

      this.order.shift();
      this.items.delete(itemId);
      yield* group.pending;
      this.doneItems.push(group.done);
      yield deltaEvent(group.done);
    }

    if (this.order.length > 0) {
      // the item that just reached the front streams from here on
      const front = this.items.get(this.order[0]) as OpenItem;
      yield* front.pending;
      front.pending = [];
    }
  }

  /**
   * Build the stop event once the client's stream ended, rejecting a response that cannot be one.
   */
  stop(): UniEvent {
    if (this.order.length > 0) {
      throw this.protocolError(
        `the stream ended with item ${this.order[0]} still open`,
      );
    }
    if (this.usageMetadata === null) {
      throw new Error("Streaming response ended without usage_metadata");
    }
    if (this.finishReason === null) {
      throw new Error("Streaming response ended without finish_reason");
    }
    // replaying a thinking-only assistant message on the next turn fails with a 400 error
    const thinkingOnly = this.doneItems.every(
      (item) =>
        item.type === "thinking.done" || item.type === "inline_thinking.done",
    );
    if (thinkingOnly) {
      throw new EmptyResponseError({
        client: this.client,
        finishReason: this.finishReason,
        usageMetadata: this.usageMetadata,
      });
    }

    return {
      role: "assistant",
      event_type: "stop",
      content_items: [],
      usage_metadata: this.usageMetadata,
      finish_reason: this.finishReason,
      created_at: Date.now(),
    };
  }
}

/**
 * Abstract base class for LLM clients.
 *
 * All model-specific clients must inherit from this class and implement
 * the required abstract methods for complete SDK abstraction.
 */
export abstract class LLMClient {
  protected _model: string;
  private _history: UniMessage[];

  constructor() {
    this._model = "";
    this._history = [];
  }

  /**
   * Transform universal configuration to model-specific configuration.
   *
   * @param config - Universal configuration object
   * @returns Model-specific configuration object
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  abstract transformUniConfigToModelConfig(config: UniConfig): any;

  /**
   * Transform universal message format to model-specific input format.
   *
   * @param messages - List of universal message objects
   * @returns Model-specific input format (e.g., Gemini's Content list, OpenAI's messages array)
   */
  abstract transformUniMessageToModelInput(
    messages: UniMessage[],
    signal?: AbortSignal,
  ): any; // eslint-disable-line @typescript-eslint/no-explicit-any

  /**
   * Transform one event of the provider's stream into a universal event, which the base class
   * narrows into the public stream.
   *
   * content_items holds what `items` returns, in wire order: `items.delta(id, fragment)` for
   * every fragment the wire event carries, `items.done(id)` where it says an item ended. Its
   * event_type is "stop" on the wire events that report usage_metadata and/or finish_reason, in
   * pieces the base class merges field by field, and "delta" otherwise; a "delta" event carries
   * neither.
   *
   * @param modelOutput - Model-specific output object (streaming chunk)
   * @param items - The items of the stream this event belongs to
   * @returns Universal event object, an empty delta event when the wire event carries nothing
   *   universal
   */
  abstract transformModelOutputToUniEvent(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modelOutput: any,
    items: StreamItems,
  ): UniEvent;

  /**
   * Concatenate a stream of universal events into a single universal message.
   *
   * @param events - List of universal events from streaming response
   * @returns Complete universal message object: every done item in stream order, with the
   *   usage, finish reason and timestamp of the stop event
   */
  concatUniEventsToUniMessage(events: UniEvent[]): UniMessage {
    const contentItems: ContentItem[] = [];
    let stopEvent: UniEvent | null = null;
    for (const event of events) {
      if (event.event_type === "stop") {
        stopEvent = event;
        continue;
      }
      for (const item of event.content_items) {
        if (item.type.endsWith(".done")) {
          contentItems.push(item as ContentItem);
        }
      }
    }

    return {
      role: "assistant",
      content_items: contentItems,
      usage_metadata: stopEvent?.usage_metadata ?? null,
      finish_reason: stopEvent?.finish_reason ?? null,
      created_at: stopEvent?.created_at,
    };
  }

  /**
   * Internal method to handle streaming response.
   *
   * Each model client implements it to send the request, create the `StreamItems` of the stream,
   * yield one universal event per event of the provider's stream, and yield one last delta event
   * carrying `items.end()`; streamingResponse narrows them into the public stream.
   *
   * @param options - Object containing messages and config
   * @yields Universal events of the streaming response
   */
  abstract _streamingResponseInternal(options: {
    messages: UniMessage[];
    config: UniConfig;
    signal?: AbortSignal;
  }): AsyncGenerator<UniEvent>;

  /**
   * List the model ids the configured endpoint serves.
   *
   * @returns The model ids, in the order the endpoint returned them.
   */
  abstract listModels(): Promise<string[]>;

  /**
   * Generate content in streaming mode (stateless).
   *
   * @param options - Object containing messages and config
   * @yields Delta events, each carrying one delta or done item, then exactly one stop event
   *   carrying the usage and the finish reason
   */
  async *streamingResponse(options: {
    messages: UniMessage[];
    config: UniConfig;
    signal?: AbortSignal;
  }): AsyncGenerator<UniEvent> {
    const { messages, config } = options;

    // Stamp any messages that don't yet have a created_at timestamp
    for (const msg of messages) {
      if (msg.created_at == null) {
        msg.created_at = Date.now();
      }
    }
    const requestMessages = normalizeLegacyMessages(messages);

    const output = new PublicStream(this.constructor.name);
    for await (const event of this._streamingResponseInternal({
      messages: requestMessages,
      config,
      signal: options.signal,
    })) {
      yield* output.push(event);
    }
    const stopEvent = output.stop();

    // saved before the stop is yielded: a caller may stop iterating as soon as it sees it
    if (config.trace_id) {
      const { Tracer } = await import("./integration/tracer");
      const assistantMessage: UniMessage = {
        role: "assistant",
        content_items: output.doneItems,
        usage_metadata: stopEvent.usage_metadata,
        finish_reason: stopEvent.finish_reason,
        created_at: stopEvent.created_at,
      };
      const tracer = new Tracer();
      tracer.saveHistory(
        this._model,
        [...requestMessages, assistantMessage],
        config.trace_id,
        config,
      );
    }

    yield stopEvent;
  }

  /**
   * Generate content in streaming mode (stateful).
   *
   * @param message - Latest universal message object to add to conversation
   * @param config - Universal configuration object
   * @yields Universal events from the streaming response
   */
  async *streamingResponseStateful(options: {
    message: UniMessage;
    config: UniConfig;
    signal?: AbortSignal;
  }): AsyncGenerator<UniEvent> {
    const { config } = options;
    const [message] = normalizeLegacyMessages([options.message]);

    const events: UniEvent[] = [];
    for await (const event of this.streamingResponse({
      messages: [...this._history, message],
      config,
      signal: options.signal,
    })) {
      events.push(event);
      if (event.event_type === "stop") {
        // recorded before the stop is yielded: a caller may stop iterating as soon as it sees it
        this._history.push(message);
        this._history.push(this.concatUniEventsToUniMessage(events));
      }
      yield event;
    }
  }

  /**
   * Clear the message history.
   */
  clearHistory(): void {
    this._history = [];
  }

  /**
   * Get the current message history.
   *
   * @returns Copy of the current message history
   */
  getHistory(): UniMessage[] {
    return [...this._history];
  }

  /**
   * Replace the message history with a copy of the provided history.
   *
   * @param history - List of universal message objects to set as the new history
   */
  setHistory(history: UniMessage[]): void {
    this._history = normalizeLegacyMessages(history);
  }
}
