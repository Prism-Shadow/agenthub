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

import { describe, expect, jest, test } from "@jest/globals";
import { LLMClient } from "../src/baseClient";
import {
  EmptyResponseError,
  StreamProtocolError,
  ToolCallArgumentParseError,
} from "../src/errors";
import { normalizeLegacyMessages } from "../src/legacy";
import {
  EventContentItem,
  Fidelity,
  FinishReason,
  UniConfig,
  UniEvent,
  UniMessage,
  UsageMetadata,
} from "../src/types";
import { assertStreamGrammar } from "./streamGrammar";

const USAGE: UsageMetadata = {
  cached_tokens: null,
  prompt_tokens: 10,
  thoughts_tokens: null,
  response_tokens: 5,
};

const USER: UniMessage = {
  role: "user",
  content_items: [{ type: "text.done", text: "hi" }],
};

function delta(...items: EventContentItem[]): UniEvent {
  return {
    role: "assistant",
    event_type: "delta",
    content_items: items,
    usage_metadata: null,
    finish_reason: null,
  };
}

function stop(
  usage: UsageMetadata | null,
  finish: FinishReason | null,
  items: EventContentItem[] = [],
): UniEvent {
  return {
    role: "assistant",
    event_type: "stop",
    content_items: items,
    usage_metadata: usage,
    finish_reason: finish,
  };
}

/**
 * The item with fidelity.item_id in front of the fidelity it already carries.
 */
function withId(itemId: string, item: EventContentItem): EventContentItem {
  const { fidelity } = item as { fidelity?: Fidelity };
  return {
    ...item,
    fidelity: { item_id: itemId, ...fidelity },
  } as EventContentItem;
}

const FINISH = stop(USAGE, "stop");

/**
 * A client that replays a fixed list of events, deltas only as every client yields them, and
 * records the messages it was sent.
 */
class ScriptedClient extends LLMClient {
  sentMessages: UniMessage[][] = [];

  constructor(private readonly events: UniEvent[]) {
    super();
    this._model = "scripted";
  }

  transformUniConfigToModelConfig(): undefined {
    return undefined;
  }

  transformUniMessageToModelInput(messages: UniMessage[]): UniMessage[] {
    return messages;
  }

  transformModelOutputToUniEvent(modelOutput: UniEvent): UniEvent {
    return modelOutput;
  }

  async *_streamingResponseInternal(options: {
    messages: UniMessage[];
    config: UniConfig;
  }): AsyncGenerator<UniEvent> {
    this.sentMessages.push(options.messages);
    for (const event of this.events) {
      yield this.transformModelOutputToUniEvent(event);
    }
  }

  async listModels(): Promise<string[]> {
    return [];
  }
}

async function collect(
  script: UniEvent[],
  config: UniConfig = {},
): Promise<UniEvent[]> {
  const events: UniEvent[] = [];
  for await (const event of new ScriptedClient(script).streamingResponse({
    messages: [USER],
    config,
  })) {
    events.push(event);
  }
  return events;
}

function items(events: UniEvent[]) {
  return events.flatMap((event) => event.content_items);
}

describe("stream assembly", () => {
  test("text streams as deltas, a done item, then the stop event", async () => {
    const events = await collect([
      delta(withId("0", { type: "text.delta", text: "Hel" })),
      delta(withId("0", { type: "text.delta", text: "lo" })),
      FINISH,
    ]);

    assertStreamGrammar(events);
    expect(items(events)).toEqual([
      { type: "text.delta", text: "Hel" },
      { type: "text.delta", text: "lo" },
      { type: "text.done", text: "Hello" },
    ]);
    expect(events[events.length - 1]).toMatchObject({
      event_type: "stop",
      usage_metadata: USAGE,
      finish_reason: "stop",
    });
  });

  test("the fidelity a delta carries is the done item's fidelity", async () => {
    const events = await collect([
      delta(
        withId("msg", {
          type: "text.delta",
          text: "",
          fidelity: { phase: "commentary" },
        }),
      ),
      delta(withId("msg", { type: "text.delta", text: "Checking" })),
      FINISH,
    ]);

    assertStreamGrammar(events);
    expect(items(events)).toEqual([
      { type: "text.delta", text: "", fidelity: { phase: "commentary" } },
      { type: "text.delta", text: "Checking" },
      {
        type: "text.done",
        text: "Checking",
        fidelity: { phase: "commentary" },
      },
    ]);
  });

  test("thinking ending on its signature, then a tool call built from its fragments", async () => {
    const events = await collect([
      delta(withId("0", { type: "thinking.delta", thinking: "Let me" })),
      delta(withId("0", { type: "thinking.delta", thinking: " look" })),
      delta(
        withId("0", {
          type: "thinking.delta",
          thinking: "",
          fidelity: { signature: "sig" },
        }),
      ),
      delta(
        withId("1", {
          type: "tool_call.delta",
          name: "get_weather",
          arguments: "",
          tool_call_id: "toolu_1",
        }),
      ),
      delta(
        withId("1", {
          type: "tool_call.delta",
          name: "",
          arguments: '{"city":',
          tool_call_id: "",
        }),
      ),
      delta(
        withId("1", {
          type: "tool_call.delta",
          name: "",
          arguments: '"Paris"}',
          tool_call_id: "",
        }),
      ),
      stop(USAGE, "tool_call"),
    ]);

    assertStreamGrammar(events);
    const done = items(events).filter((item) => item.type.endsWith(".done"));
    expect(done).toEqual([
      {
        type: "thinking.done",
        thinking: "Let me look",
        fidelity: { signature: "sig" },
      },
      {
        type: "tool_call.done",
        name: "get_weather",
        arguments: { city: "Paris" },
        tool_call_id: "toolu_1",
      },
    ]);
  });

  test("an item is done when a delta of the next item arrives: another id, kind, or call", async () => {
    const call = (id: string, name: string, args: string) =>
      delta(
        withId(id, {
          type: "tool_call.delta",
          name,
          arguments: args,
          tool_call_id: name && `call_${name}`,
        }),
      );

    const events = await collect([
      delta(withId("msg_1", { type: "text.delta", text: "a" })),
      // another id
      delta(withId("msg_2", { type: "text.delta", text: "b" })),
      // another kind under the same id
      delta(withId("msg_2", { type: "thinking.delta", thinking: "c" })),
      // a call's name begins the next call, whatever id a provider gives its calls
      call("tool_calls", "f", '{"x":'),
      call("tool_calls", "", "1}"),
      call("tool_calls", "g", "{}"),
      // and its arguments continue it, whatever id a gateway puts on them
      call("other", "", ""),
      FINISH,
    ]);

    assertStreamGrammar(events);
    expect(items(events).map((item) => item.type)).toEqual([
      "text.delta",
      "text.done",
      "text.delta",
      "text.done",
      "thinking.delta",
      "thinking.done",
      "tool_call.delta",
      "tool_call.delta",
      "tool_call.done",
      "tool_call.delta",
      "tool_call.done",
    ]);
    expect(items(events)[8]).toMatchObject({ name: "f", arguments: { x: 1 } });
    expect(items(events)[10]).toMatchObject({ name: "g", arguments: {} });
  });

  test("a delta without an item_id continues the item streaming now", async () => {
    // a gateway that leaves the item ids off its deltas
    const events = await collect([
      delta(withId("rs_1", { type: "thinking.delta", thinking: "" })),
      delta({ type: "thinking.delta", thinking: "Plan" }),
      delta({ type: "text.delta", text: "Ans" }),
      delta({ type: "text.delta", text: "wer" }),
      FINISH,
    ]);

    assertStreamGrammar(events);
    expect(items(events)).toEqual([
      { type: "thinking.delta", thinking: "Plan" },
      { type: "thinking.done", thinking: "Plan" },
      { type: "text.delta", text: "Ans" },
      { type: "text.delta", text: "wer" },
      { type: "text.done", text: "Answer" },
    ]);
  });

  test("the item streaming when the provider's stream ends is done before the stop", async () => {
    const events = await collect([
      delta(withId("0", { type: "text.delta", text: "a" })),
      delta(withId("1", { type: "text.delta", text: "b" })),
      FINISH,
    ]);

    assertStreamGrammar(events);
    expect(items(events)).toEqual([
      { type: "text.delta", text: "a" },
      { type: "text.done", text: "a" },
      { type: "text.delta", text: "b" },
      { type: "text.done", text: "b" },
    ]);
  });

  test("a repeated identical fidelity goes out once, empty fragments not at all", async () => {
    const fidelity = { reasoning_field: "reasoning_content" };
    const events = await collect([
      delta(withId("0", { type: "thinking.delta", thinking: "" })),
      delta(withId("0", { type: "thinking.delta", thinking: "a", fidelity })),
      delta(withId("0", { type: "thinking.delta", thinking: "b", fidelity })),
      delta(withId("1", { type: "text.delta", text: "ok" })),
      FINISH,
    ]);

    assertStreamGrammar(events);
    expect(items(events)).toEqual([
      { type: "thinking.delta", thinking: "a", fidelity },
      { type: "thinking.delta", thinking: "b" },
      { type: "thinking.done", thinking: "ab", fidelity },
      { type: "text.delta", text: "ok" },
      { type: "text.done", text: "ok" },
    ]);
  });

  test("audio chunks join into one done item, while every image and every vector is an item", async () => {
    const audio = await collect([
      delta(
        withId("0", {
          type: "inline_data.delta",
          data: Buffer.from([1, 2]),
          mime_type: "audio/L16",
        }),
      ),
      delta(
        withId("0", {
          type: "inline_data.delta",
          data: Buffer.from([3]),
          mime_type: "audio/L16",
        }),
      ),
      FINISH,
    ]);
    assertStreamGrammar(audio);
    expect(items(audio)[2]).toEqual({
      type: "inline_data.done",
      data: Buffer.from([1, 2, 3]),
      mime_type: "audio/L16",
    });

    const image = (bytes: number[]) =>
      delta(
        withId("0", {
          type: "inline_data.delta",
          data: Buffer.from(bytes),
          mime_type: "image/png",
        }),
      );
    const images = await collect([image([1]), image([2]), FINISH]);
    assertStreamGrammar(images);
    expect(items(images).map((item) => item.type)).toEqual([
      "inline_data.delta",
      "inline_data.done",
      "inline_data.delta",
      "inline_data.done",
    ]);

    const embeddings = await collect([
      delta({ type: "embedding.delta", embedding: [0.1] }),
      delta({ type: "embedding.delta", embedding: [0.2] }),
      FINISH,
    ]);
    assertStreamGrammar(embeddings);
    expect(items(embeddings)).toEqual([
      { type: "embedding.delta", embedding: [0.1] },
      { type: "embedding.done", embedding: [0.1] },
      { type: "embedding.delta", embedding: [0.2] },
      { type: "embedding.done", embedding: [0.2] },
    ]);
  });

  test("usage pieces merge field by field", async () => {
    const events = await collect([
      delta(withId("0", { type: "text.delta", text: "a" })),
      stop(
        {
          cached_tokens: 3,
          prompt_tokens: 7,
          thoughts_tokens: null,
          response_tokens: null,
        },
        null,
      ),
      stop(
        {
          cached_tokens: null,
          prompt_tokens: null,
          thoughts_tokens: null,
          response_tokens: 9,
        },
        "length",
      ),
    ]);

    expect(events[events.length - 1]).toMatchObject({
      usage_metadata: {
        cached_tokens: 3,
        prompt_tokens: 7,
        thoughts_tokens: null,
        response_tokens: 9,
      },
      finish_reason: "length",
    });
  });

  test("item_id never reaches the public stream, the message or the history", async () => {
    const client = new ScriptedClient([
      delta(
        withId("0", {
          type: "thinking.delta",
          thinking: "a",
          fidelity: { signature: "s" },
        }),
      ),
      delta(withId("1", { type: "text.delta", text: "b" })),
      FINISH,
    ]);
    const events: UniEvent[] = [];
    for await (const event of client.streamingResponseStateful({
      message: USER,
      config: {},
    })) {
      events.push(event);
    }

    assertStreamGrammar(events);
    expect(items(events)).toEqual([
      { type: "thinking.delta", thinking: "a", fidelity: { signature: "s" } },
      { type: "thinking.done", thinking: "a", fidelity: { signature: "s" } },
      { type: "text.delta", text: "b" },
      { type: "text.done", text: "b" },
    ]);
    expect(items(events)[2]).not.toHaveProperty("fidelity");
    expect(
      JSON.stringify(client.concatUniEventsToUniMessage(events)),
    ).not.toContain('"item_id"');
    expect(JSON.stringify(client.getHistory())).not.toContain('"item_id"');
  });

  test("an event carries several items in wire order", async () => {
    // Responses reasoning: the fidelity arrives with the item's end
    const reasoning = await collect([
      delta(withId("rs_1", { type: "thinking.delta", thinking: "Plan" })),
      delta(
        withId("rs_1", {
          type: "thinking.delta",
          thinking: "",
          fidelity: { encrypted_content: "enc" },
        }),
      ),
      delta(withId("msg_1", { type: "text.delta", text: "Done" })),
      FINISH,
    ]);
    assertStreamGrammar(reasoning);
    expect(items(reasoning)).toEqual([
      { type: "thinking.delta", thinking: "Plan" },
      {
        type: "thinking.delta",
        thinking: "",
        fidelity: { encrypted_content: "enc" },
      },
      {
        type: "thinking.done",
        thinking: "Plan",
        fidelity: { encrypted_content: "enc" },
      },
      { type: "text.delta", text: "Done" },
      { type: "text.done", text: "Done" },
    ]);

    // Chat Completions: a chunk may end the reasoning and begin the answer, and the last content
    // chunk carries the finish reason, while the usage follows in a chunk of its own
    const chat = await collect([
      delta(
        withId("reasoning", { type: "thinking.delta", thinking: "Hmm" }),
        withId("content", { type: "text.delta", text: "Hel" }),
      ),
      stop(null, "stop", [
        withId("content", { type: "text.delta", text: "lo" }),
      ]),
      stop(USAGE, null),
    ]);
    assertStreamGrammar(chat);
    expect(items(chat)).toEqual([
      { type: "thinking.delta", thinking: "Hmm" },
      { type: "thinking.done", thinking: "Hmm" },
      { type: "text.delta", text: "Hel" },
      { type: "text.delta", text: "lo" },
      { type: "text.done", text: "Hello" },
    ]);
    expect(chat[chat.length - 1]).toMatchObject({
      usage_metadata: USAGE,
      finish_reason: "stop",
    });
  });

  test("fidelity sent alone under the item's id is that item's, whatever kind carries it", async () => {
    // an Interactions thought step: an image, then the signature the step ends with
    const events = await collect([
      delta(
        withId("0", {
          type: "inline_thinking.delta",
          data: Buffer.from("draft"),
          mime_type: "image/png",
        }),
      ),
      delta(
        withId("0", {
          type: "thinking.delta",
          thinking: "",
          fidelity: { signature: "sig" },
        }),
      ),
      delta(withId("1", { type: "text.delta", text: "ok" })),
      FINISH,
    ]);

    assertStreamGrammar(events);
    expect(items(events).slice(0, 3)).toEqual([
      {
        type: "inline_thinking.delta",
        data: Buffer.from("draft"),
        mime_type: "image/png",
      },
      {
        type: "inline_thinking.delta",
        data: Buffer.alloc(0),
        mime_type: "image/png",
        fidelity: { signature: "sig" },
      },
      {
        type: "inline_thinking.done",
        data: Buffer.from("draft"),
        mime_type: "image/png",
        fidelity: { signature: "sig" },
      },
    ]);
  });

  test("embedding vectors need no item_id", async () => {
    const events = await collect([
      stop(USAGE, "stop", [
        { type: "embedding.delta", embedding: [0.1, 0.2] },
        { type: "embedding.delta", embedding: [0.3, 0.4] },
      ]),
    ]);

    assertStreamGrammar(events);
    expect(items(events)).toEqual([
      { type: "embedding.delta", embedding: [0.1, 0.2] },
      { type: "embedding.done", embedding: [0.1, 0.2] },
      { type: "embedding.delta", embedding: [0.3, 0.4] },
      { type: "embedding.done", embedding: [0.3, 0.4] },
    ]);
  });

  test("an empty delta event and a stop event carrying nothing are ignored", async () => {
    const events = await collect([
      delta(),
      delta(withId("0", { type: "text.delta", text: "a" })),
      FINISH,
      stop(null, null),
      delta(),
    ]);

    assertStreamGrammar(events);
    expect(items(events)).toEqual([
      { type: "text.delta", text: "a" },
      { type: "text.done", text: "a" },
    ]);
    expect(events[events.length - 1]).toMatchObject({
      usage_metadata: USAGE,
      finish_reason: "stop",
    });
  });

  test("an item no delta of which went out has no done item", async () => {
    const events = await collect([
      delta(withId("msg_1", { type: "text.delta", text: "" })),
      delta(withId("msg_2", { type: "text.delta", text: "a" })),
      FINISH,
    ]);

    assertStreamGrammar(events);
    expect(items(events)).toEqual([
      { type: "text.delta", text: "a" },
      { type: "text.done", text: "a" },
    ]);
  });
});

describe("stream protocol violations and rejected responses", () => {
  test.each<[string, UniEvent[]]>([
    [
      "a done item: a client yields deltas only",
      [
        delta(withId("0", { type: "text.delta", text: "a" })),
        delta({ type: "text.done", text: "a" }),
      ],
    ],
    [
      "two different fidelity payloads in one item",
      [
        delta(
          withId("0", {
            type: "thinking.delta",
            thinking: "a",
            fidelity: { signature: "1" },
          }),
        ),
        delta(
          withId("0", {
            type: "thinking.delta",
            thinking: "",
            fidelity: { signature: "2" },
          }),
        ),
      ],
    ],
    [
      "a tool call whose first fragment has no tool_call_id",
      [
        delta(
          withId("0", {
            type: "tool_call.delta",
            name: "f",
            arguments: "{}",
            tool_call_id: "",
          }),
        ),
      ],
    ],
    [
      "arguments with no call streaming",
      [
        delta(withId("0", { type: "text.delta", text: "a" })),
        delta(
          withId("1", {
            type: "tool_call.delta",
            name: "",
            arguments: "{}",
            tool_call_id: "",
          }),
        ),
      ],
    ],
    [
      "a delta event carrying a finish reason",
      [
        {
          ...delta(withId("0", { type: "text.delta", text: "a" })),
          finish_reason: "stop",
        },
      ],
    ],
  ])("%s raises StreamProtocolError", async (_name, script) => {
    await expect(collect([...script, FINISH])).rejects.toBeInstanceOf(
      StreamProtocolError,
    );
  });

  test("a stream without usage or finish reason yields no stop event", async () => {
    const events: UniEvent[] = [];
    const run = async () => {
      for await (const event of new ScriptedClient([
        delta(withId("0", { type: "text.delta", text: "a" })),
        stop(null, "stop"),
      ]).streamingResponse({ messages: [USER], config: {} })) {
        events.push(event);
      }
    };

    await expect(run()).rejects.toThrow("without usage_metadata");
    expect(events.some((event) => event.event_type === "stop")).toBe(false);
  });

  test("a thinking-only response raises EmptyResponseError carrying its usage", async () => {
    const error = await collect([
      delta(withId("0", { type: "thinking.delta", thinking: "hmm" })),
      FINISH,
    ]).catch((caught) => caught);

    expect(error).toBeInstanceOf(EmptyResponseError);
    expect(error.usageMetadata).toEqual(USAGE);
    expect(error.finishReason).toBe("stop");
  });

  test("malformed tool call arguments raise when the call is done", async () => {
    await expect(
      collect([
        delta(
          withId("0", {
            type: "tool_call.delta",
            name: "f",
            arguments: '{"a":',
            tool_call_id: "c",
          }),
        ),
        FINISH,
      ]),
    ).rejects.toBeInstanceOf(ToolCallArgumentParseError);
  });

  test("a whole tool call reaches the caller before its malformed arguments fail", async () => {
    const call = {
      type: "tool_call.delta" as const,
      name: "f",
      arguments: '{"a":',
      tool_call_id: "c",
    };
    const events: UniEvent[] = [];
    const run = async () => {
      for await (const event of new ScriptedClient([
        delta(withId("0", call)),
        FINISH,
      ]).streamingResponse({ messages: [USER], config: {} })) {
        events.push(event);
      }
    };

    await expect(run()).rejects.toBeInstanceOf(ToolCallArgumentParseError);
    expect(items(events)).toEqual([call]);
  });
});

describe("history and legacy messages", () => {
  const reply: UniEvent[] = [
    delta(withId("0", { type: "text.delta", text: "hello" })),
    FINISH,
  ];

  test("stateful history is recorded even when the caller stops at the stop event", async () => {
    const client = new ScriptedClient(reply);
    for await (const event of client.streamingResponseStateful({
      message: USER,
      config: {},
    })) {
      if (event.event_type === "stop") {
        break;
      }
    }

    const history = client.getHistory();
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({
      role: "assistant",
      content_items: [{ type: "text.done", text: "hello" }],
      usage_metadata: USAGE,
      finish_reason: "stop",
    });
  });

  test("concatUniEventsToUniMessage keeps the done items and the stop event's metadata", async () => {
    const events = await collect(reply);
    const message = new ScriptedClient([]).concatUniEventsToUniMessage(events);
    expect(message).toMatchObject({
      role: "assistant",
      content_items: [{ type: "text.done", text: "hello" }],
      usage_metadata: USAGE,
      finish_reason: "stop",
    });
    expect(message.created_at).toBe(events[events.length - 1].created_at);
  });

  test("legacy content item types are converted before a request and in set history", async () => {
    const warn = jest
      .spyOn(process, "emitWarning")
      .mockImplementation(() => undefined);
    const legacy = {
      role: "user",
      content_items: [
        { type: "text", text: "hi" },
        { type: "tool_result", text: "22 C", tool_call_id: "call_1" },
        {
          type: "partial_tool_call",
          name: "",
          arguments: "",
          tool_call_id: "",
        },
      ],
    } as unknown as UniMessage;

    const client = new ScriptedClient(reply);
    for await (const event of client.streamingResponse({
      messages: [legacy],
      config: {},
    })) {
      void event;
    }
    expect(client.sentMessages[0][0].content_items).toEqual([
      { type: "text.done", text: "hi" },
      { type: "tool_result.done", text: "22 C", tool_call_id: "call_1" },
    ]);
    // the caller's message is left as it was
    expect((legacy.content_items[0] as { type: string }).type).toBe("text");

    client.setHistory([legacy]);
    expect(client.getHistory()[0].content_items[0].type).toBe("text.done");

    const current = [USER];
    expect(normalizeLegacyMessages(current)[0]).toBe(USER);
    warn.mockRestore();
  });
});
