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
import {
  EmptyResponseError,
  parseToolCallArguments,
  StreamProtocolError,
} from "./errors";
import { normalizeLegacyMessages } from "./legacy";
import {
  ContentItem,
  DeltaContentItem,
  Fidelity,
  FinishReason,
  TextDoneItem,
  UniConfig,
  UniDeltaEvent,
  UniEvent,
  UniMessage,
  UniStopEvent,
  UsageMetadata,
} from "./types";

/**
 * The item under itemId is complete: the base builds its done item from the deltas it streamed.
 * Not every provider names the kind where an item ends (Anthropic content_block_stop, Interactions
 * step.stop), so a marker is a text.done the base reads only for its item_id.
 */
export function doneMarker(itemId: string): TextDoneItem {
  return { type: "text.done", text: "", fidelity: { item_id: itemId } };
}

/**
 * Whether a content item carries a non-empty fidelity payload.
 */
function hasFidelity(fidelity?: Fidelity): fidelity is Fidelity {
  return fidelity != null && Object.keys(fidelity).length > 0;
}

/**
 * Whether a fragment carries nothing: no content and no fidelity.
 */
function isEmptyDelta(item: DeltaContentItem): boolean {
  if (item.type === "embedding.delta") {
    return false;
  }
  if (hasFidelity(item.fidelity)) {
    return false;
  }
  if (item.type === "text.delta") {
    return item.text === "";
  }
  if (item.type === "thinking.delta") {
    return item.thinking === "";
  }
  if (item.type === "tool_call.delta") {
    return !item.name && !item.tool_call_id && !item.arguments;
  }
  return item.data.length === 0;
}

function deltaEvent(item: DeltaContentItem | ContentItem): UniDeltaEvent {
  return {
    role: "assistant",
    event_type: "delta",
    content_items: [item],
    usage_metadata: null,
    finish_reason: null,
    created_at: Date.now(),
  };
}

interface ItemGroup {
  kind: string;
  deltas: DeltaContentItem[];
  // fragments held back while an earlier item is still streaming
  pending: DeltaContentItem[];
  closed: boolean;
  fidelity?: Fidelity;
}

/**
 * Turns the universal events a client makes of its provider's stream into the public stream:
 * every item streams as contiguous deltas closed by its done item, and items never interleave,
 * so a caller attributes each delta to the item streaming at that moment. An item that starts
 * while an earlier one is open is held back until the earlier one is done.
 */
class StreamAssembler {
  private readonly order: string[] = [];
  private readonly groups = new Map<string, ItemGroup>();
  private readonly finishedKeys = new Set<string>();
  private embeddingCount = 0;
  private usageMetadata: UsageMetadata | null = null;
  private finishReason: FinishReason | null = null;
  readonly doneItems: ContentItem[] = [];

  constructor(private readonly client: string) {}

  private protocolError(message: string): StreamProtocolError {
    return new StreamProtocolError({ client: this.client, message });
  }

  // a generator, so the events of an item reach the caller even when a later item of the same
  // wire event fails, as a whole tool call followed by its done marker does on bad arguments
  *push(event: UniEvent): Generator<UniDeltaEvent> {
    if (
      event.event_type === "delta" &&
      (event.usage_metadata != null || event.finish_reason != null)
    ) {
      throw this.protocolError(
        "a delta event carries usage_metadata or finish_reason",
      );
    }

    for (const item of event.content_items) {
      if (item.type === "embedding.delta") {
        // a vector is complete in itself, so the base names its item and closes it at once
        const key = `embedding:${this.embeddingCount}`;
        this.embeddingCount += 1;
        yield* this.pushDelta(key, item);
        yield* this.pushDone(key);
        continue;
      }

      // item_id is stripped before any other rule runs, so it never reaches the public stream
      const { item_id: itemId, ...fidelity }: Fidelity =
        ("fidelity" in item ? item.fidelity : undefined) ?? {};
      if (typeof itemId !== "string" || itemId === "") {
        throw this.protocolError(`${item.type} carries no fidelity.item_id`);
      }
      if (item.type.endsWith(".done")) {
        if (hasFidelity(fidelity)) {
          throw this.protocolError(
            `the done marker of item ${itemId} carries fidelity beyond item_id`,
          );
        }
        yield* this.pushDone(itemId);
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { fidelity: withItemId, ...content } = item as {
        fidelity?: Fidelity;
      };
      const stripped = hasFidelity(fidelity) ? { ...item, fidelity } : content;
      yield* this.pushDelta(itemId, stripped as DeltaContentItem);
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

  private pushDone(key: string): UniDeltaEvent[] {
    if (this.finishedKeys.has(key)) {
      throw this.protocolError(`item ${key} was done twice`);
    }
    const group = this.groups.get(key);
    if (!group) {
      // an item that never produced content has nothing to close
      this.finishedKeys.add(key);
      return [];
    }
    if (group.closed) {
      throw this.protocolError(`item ${key} was done twice`);
    }
    group.closed = true;
    return this.flush();
  }

  private pushDelta(key: string, item: DeltaContentItem): UniDeltaEvent[] {
    const kind = item.type.slice(0, -".delta".length);
    if (this.finishedKeys.has(key)) {
      throw this.protocolError(
        `${item.type} arrived after item ${key} was done`,
      );
    }

    let group = this.groups.get(key);
    if (!group) {
      if (isEmptyDelta(item)) {
        return [];
      }
      if (
        item.type === "tool_call.delta" &&
        (!item.name || !item.tool_call_id)
      ) {
        throw this.protocolError(
          `the first tool_call.delta of item ${key} must carry the name and the tool_call_id`,
        );
      }
      group = { kind, deltas: [], pending: [], closed: false };
      this.groups.set(key, group);
      this.order.push(key);
    }

    if (group.closed) {
      throw this.protocolError(
        `${item.type} arrived after item ${key} was done`,
      );
    }
    if (group.kind !== kind) {
      throw this.protocolError(
        `${item.type} arrived for item ${key}, which streams ${group.kind}`,
      );
    }

    let emitted = item;
    if (item.type !== "embedding.delta" && hasFidelity(item.fidelity)) {
      if (group.fidelity === undefined) {
        group.fidelity = item.fidelity;
      } else if (isDeepStrictEqual(group.fidelity, item.fidelity)) {
        // a client may repeat the fidelity it already sent; only the first copy goes out
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { fidelity, ...rest } = item;
        emitted = rest as DeltaContentItem;
      } else {
        throw this.protocolError(
          `item ${key} carried two different fidelity payloads`,
        );
      }
    }
    if (isEmptyDelta(emitted)) {
      return [];
    }

    group.deltas.push(emitted);
    if (this.order[0] === key) {
      return [deltaEvent(emitted)];
    }
    group.pending.push(emitted);
    return [];
  }

  private flush(): UniDeltaEvent[] {
    const events: UniDeltaEvent[] = [];
    while (this.order.length > 0) {
      const key = this.order[0];
      const group = this.groups.get(key) as ItemGroup;
      if (!group.closed) {
        break;
      }

      this.order.shift();
      this.groups.delete(key);
      this.finishedKeys.add(key);
      for (const item of group.pending) {
        events.push(deltaEvent(item));
      }
      const done = this.buildDone(group);
      this.doneItems.push(done);
      events.push(deltaEvent(done));
    }

    if (this.order.length > 0) {
      // the item that just reached the front streams from here on
      const front = this.groups.get(this.order[0]) as ItemGroup;
      for (const item of front.pending) {
        events.push(deltaEvent(item));
      }
      front.pending = [];
    }
    return events;
  }

  closeAll(): UniDeltaEvent[] {
    for (const group of this.groups.values()) {
      group.closed = true;
    }
    return this.flush();
  }

  private buildDone(group: ItemGroup): ContentItem {
    const fidelity = group.fidelity ? { fidelity: group.fidelity } : {};
    const deltas = group.deltas;
    if (group.kind === "text") {
      const text = deltas
        .map((item) => (item.type === "text.delta" ? item.text : ""))
        .join("");
      return { type: "text.done", text, ...fidelity };
    }
    if (group.kind === "thinking") {
      const thinking = deltas
        .map((item) => (item.type === "thinking.delta" ? item.thinking : ""))
        .join("");
      return { type: "thinking.done", thinking, ...fidelity };
    }
    if (group.kind === "tool_call") {
      let name = "";
      let toolCallId = "";
      let rawArguments = "";
      for (const item of deltas) {
        if (item.type === "tool_call.delta") {
          name = name || item.name;
          toolCallId = toolCallId || item.tool_call_id;
          rawArguments += item.arguments;
        }
      }
      return {
        type: "tool_call.done",
        name,
        arguments: parseToolCallArguments(
          rawArguments,
          this.client,
          name,
          toolCallId,
        ),
        tool_call_id: toolCallId,
        ...fidelity,
      };
    }
    if (group.kind === "embedding") {
      const last = deltas[deltas.length - 1];
      return {
        type: "embedding.done",
        embedding: last.type === "embedding.delta" ? last.embedding : [],
      };
    }

    const chunks: Buffer[] = [];
    let mimeType = "";
    for (const item of deltas) {
      if (
        item.type === "inline_data.delta" ||
        item.type === "inline_thinking.delta"
      ) {
        chunks.push(item.data);
        mimeType = mimeType || item.mime_type;
      }
    }
    return {
      type:
        group.kind === "inline_data"
          ? "inline_data.done"
          : "inline_thinking.done",
      data: Buffer.concat(chunks),
      mime_type: mimeType,
      ...fidelity,
    };
  }

  /**
   * Build the stop event once every item is done, rejecting a response that cannot be one.
   */
  stop(): UniStopEvent {
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
   * content_items holds any number of items in wire order — `.delta` fragments and done markers,
   * each carrying `fidelity.item_id`, the provider's identity for the item (a block index, an
   * output item id, a step index and run), except `embedding.delta`, which is complete in itself.
   * event_type is "stop" on the wire events that report usage_metadata and/or finish_reason, in
   * pieces the base class merges field by field, and "delta" otherwise; a "delta" event carries
   * neither.
   *
   * @param modelOutput - Model-specific output object (streaming chunk)
   * @returns Universal event object, an empty delta event when the wire event carries nothing
   *   universal
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  abstract transformModelOutputToUniEvent(modelOutput: any): UniEvent;

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
   * Each model client implements it to send the request and yield one universal event per event
   * of the provider's stream; streamingResponse assembles them into the public stream.
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
  }): AsyncGenerator<UniDeltaEvent | UniStopEvent> {
    const { messages, config } = options;

    // Stamp any messages that don't yet have a created_at timestamp
    for (const msg of messages) {
      if (msg.created_at == null) {
        msg.created_at = Date.now();
      }
    }
    const requestMessages = normalizeLegacyMessages(messages);

    const assembler = new StreamAssembler(this.constructor.name);
    for await (const event of this._streamingResponseInternal({
      messages: requestMessages,
      config,
      signal: options.signal,
    })) {
      yield* assembler.push(event);
    }
    yield* assembler.closeAll();
    const stopEvent = assembler.stop();

    // saved before the stop is yielded: a caller may stop iterating as soon as it sees it
    if (config.trace_id) {
      const { Tracer } = await import("./integration/tracer");
      const assistantMessage: UniMessage = {
        role: "assistant",
        content_items: assembler.doneItems,
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
  }): AsyncGenerator<UniDeltaEvent | UniStopEvent> {
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
