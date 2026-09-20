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
import { StreamItems } from "../src/streamItems";
import {
  DeltaContentItem,
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
 * A client that replays a fixed list of events, complete items included, and records the
 * messages it was sent.
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

// one wire event of a provider: a fragment of an item, the end of an item, or the usage
type Step =
  | ["delta", string | undefined, DeltaContentItem]
  | ["done", string | undefined]
  | ["stop", UsageMetadata | null, FinishReason | null];

/**
 * A client that assembles its items with StreamItems the way every real client does, one wire
 * event per step.
 */
class AssembledClient extends LLMClient {
  constructor(private readonly steps: Step[]) {
    super();
    this._model = "assembled";
  }

  transformUniConfigToModelConfig(): undefined {
    return undefined;
  }

  transformUniMessageToModelInput(messages: UniMessage[]): UniMessage[] {
    return messages;
  }

  transformModelOutputToUniEvent(step: Step, items: StreamItems): UniEvent {
    if (step[0] === "stop") {
      return stop(step[1], step[2]);
    }
    return delta(
      ...(step[0] === "delta"
        ? items.delta(step[1], step[2])
        : items.done(step[1])),
    );
  }

  async *_streamingResponseInternal(): AsyncGenerator<UniEvent> {
    const items = new StreamItems(this.constructor.name);
    for (const step of this.steps) {
      yield this.transformModelOutputToUniEvent(step, items);
    }
    yield delta(...items.end());
  }

  async listModels(): Promise<string[]> {
    return [];
  }
}

async function collect(
  client: LLMClient,
  config: UniConfig = {},
): Promise<UniEvent[]> {
  const events: UniEvent[] = [];
  for await (const event of client.streamingResponse({
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

describe("the public stream", () => {
  test("text streams as deltas, a done item, then the stop event", async () => {
    const events = await collect(
      new ScriptedClient([
        delta(withId("0", { type: "text.delta", text: "Hel" })),
        delta(withId("0", { type: "text.delta", text: "lo" })),
        delta(withId("0", { type: "text.done", text: "Hello" })),
        FINISH,
      ]),
    );

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

  test("thinking closed by a signature, then a tool call", async () => {
    const events = await collect(
      new ScriptedClient([
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
          withId("0", {
            type: "thinking.done",
            thinking: "Let me look",
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
            arguments: '{"city":"Paris"}',
            tool_call_id: "",
          }),
        ),
        delta(
          withId("1", {
            type: "tool_call.done",
            name: "get_weather",
            arguments: { city: "Paris" },
            tool_call_id: "toolu_1",
          }),
        ),
        stop(USAGE, "tool_call"),
      ]),
    );

    assertStreamGrammar(events);
    expect(items(events).filter((item) => item.type.endsWith(".done"))).toEqual(
      [
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
      ],
    );
  });

  test("an item that starts while another streams is held back until that one is done", async () => {
    const call = (id: string) =>
      delta(
        withId(id, {
          type: "tool_call.delta",
          name: `tool_${id}`,
          arguments: "",
          tool_call_id: `call_${id}`,
        }),
      );
    const fragment = (id: string, text: string) =>
      delta(
        withId(id, {
          type: "tool_call.delta",
          name: "",
          arguments: text,
          tool_call_id: "",
        }),
      );
    const done = (id: string, args: Record<string, number>) =>
      delta(
        withId(id, {
          type: "tool_call.done",
          name: `tool_${id}`,
          arguments: args,
          tool_call_id: `call_${id}`,
        }),
      );

    const events = await collect(
      new ScriptedClient([
        call("a"),
        call("b"),
        fragment("a", '{"x":'),
        fragment("b", '{"y":2}'),
        done("b", { y: 2 }),
        fragment("a", "1}"),
        done("a", { x: 1 }),
        FINISH,
      ]),
    );

    assertStreamGrammar(events);
    expect(items(events).map((item) => item.type)).toEqual([
      "tool_call.delta",
      "tool_call.delta",
      "tool_call.delta",
      "tool_call.done",
      "tool_call.delta",
      "tool_call.delta",
      "tool_call.done",
    ]);
    expect(items(events)[3]).toMatchObject({ arguments: { x: 1 } });
    expect(items(events)[6]).toMatchObject({ arguments: { y: 2 } });
  });

  test("usage pieces merge field by field", async () => {
    const events = await collect(
      new ScriptedClient([
        delta(withId("0", { type: "text.delta", text: "a" })),
        delta(withId("0", { type: "text.done", text: "a" })),
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
      ]),
    );

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
      delta(
        withId("0", {
          type: "thinking.done",
          thinking: "a",
          fidelity: { signature: "s" },
        }),
      ),
      delta(withId("1", { type: "text.delta", text: "b" })),
      delta(withId("1", { type: "text.done", text: "b" })),
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
    // Responses reasoning: the fidelity arrives with the item's end, in one wire event
    const reasoning = await collect(
      new ScriptedClient([
        delta(withId("rs_1", { type: "thinking.delta", thinking: "Plan" })),
        delta(
          withId("rs_1", {
            type: "thinking.delta",
            thinking: "",
            fidelity: { encrypted_content: "enc" },
          }),
          withId("rs_1", {
            type: "thinking.done",
            thinking: "Plan",
            fidelity: { encrypted_content: "enc" },
          }),
        ),
        delta(withId("msg_1", { type: "text.delta", text: "Done" })),
        delta(withId("msg_1", { type: "text.done", text: "Done" })),
        FINISH,
      ]),
    );
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

    // Chat Completions: the switch to content closes the reasoning, and the last content chunk
    // carries the finish reason, while the usage follows in a chunk of its own
    const chat = await collect(
      new ScriptedClient([
        delta(withId("0", { type: "thinking.delta", thinking: "Hmm" })),
        delta(
          withId("0", { type: "thinking.done", thinking: "Hmm" }),
          withId("1", { type: "text.delta", text: "Hel" }),
        ),
        stop(null, "stop", [withId("1", { type: "text.delta", text: "lo" })]),
        delta(withId("1", { type: "text.done", text: "Hello" })),
        stop(USAGE, null),
      ]),
    );
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

  test("an empty delta event and a stop event carrying nothing are ignored", async () => {
    const events = await collect(
      new ScriptedClient([
        delta(),
        delta(withId("0", { type: "text.delta", text: "a" })),
        delta(withId("0", { type: "text.done", text: "a" })),
        FINISH,
        stop(null, null),
        delta(),
      ]),
    );

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
});

describe("a client assembling its items with StreamItems", () => {
  test("an Anthropic-shaped stream: blocks under their index, done on their stop", async () => {
    const events = await collect(
      new AssembledClient([
        ["stop", USAGE, null],
        ["delta", "0", { type: "thinking.delta", thinking: "Let me" }],
        ["delta", "0", { type: "thinking.delta", thinking: " look" }],
        [
          "delta",
          "0",
          {
            type: "thinking.delta",
            thinking: "",
            fidelity: { signature: "sig" },
          },
        ],
        ["done", "0"],
        [
          "delta",
          "1",
          {
            type: "tool_call.delta",
            name: "get_weather",
            arguments: "",
            tool_call_id: "toolu_1",
          },
        ],
        [
          "delta",
          "1",
          {
            type: "tool_call.delta",
            name: "",
            arguments: '{"city":',
            tool_call_id: "",
          },
        ],
        [
          "delta",
          "1",
          {
            type: "tool_call.delta",
            name: "",
            arguments: '"Paris"}',
            tool_call_id: "",
          },
        ],
        ["done", "1"],
        ["stop", null, "tool_call"],
      ]),
    );

    assertStreamGrammar(events);
    expect(items(events)).toEqual([
      { type: "thinking.delta", thinking: "Let me" },
      { type: "thinking.delta", thinking: " look" },
      { type: "thinking.delta", thinking: "", fidelity: { signature: "sig" } },
      {
        type: "thinking.done",
        thinking: "Let me look",
        fidelity: { signature: "sig" },
      },
      {
        type: "tool_call.delta",
        name: "get_weather",
        arguments: "",
        tool_call_id: "toolu_1",
      },
      {
        type: "tool_call.delta",
        name: "",
        arguments: '{"city":',
        tool_call_id: "",
      },
      {
        type: "tool_call.delta",
        name: "",
        arguments: '"Paris"}',
        tool_call_id: "",
      },
      {
        type: "tool_call.done",
        name: "get_weather",
        arguments: { city: "Paris" },
        tool_call_id: "toolu_1",
      },
    ]);
    expect(events[events.length - 1]).toMatchObject({
      usage_metadata: USAGE,
      finish_reason: "tool_call",
    });
  });

  test("items still open when the provider's stream ends are done before the stop", async () => {
    const events = await collect(
      new AssembledClient([
        ["delta", "0", { type: "text.delta", text: "a" }],
        ["delta", "1", { type: "text.delta", text: "b" }],
        ["stop", USAGE, "stop"],
      ]),
    );

    assertStreamGrammar(events);
    expect(items(events)).toEqual([
      { type: "text.delta", text: "a" },
      { type: "text.done", text: "a" },
      { type: "text.delta", text: "b" },
      { type: "text.done", text: "b" },
    ]);
  });

  test("a tool call's fragments reach the caller before its malformed arguments fail", async () => {
    const events: UniEvent[] = [];
    const run = async () => {
      for await (const event of new AssembledClient([
        [
          "delta",
          "0",
          {
            type: "tool_call.delta",
            name: "f",
            arguments: '{"a":',
            tool_call_id: "c",
          },
        ],
        ["done", "0"],
        ["stop", USAGE, "stop"],
      ]).streamingResponse({ messages: [USER], config: {} })) {
        events.push(event);
      }
    };

    await expect(run()).rejects.toBeInstanceOf(ToolCallArgumentParseError);
    expect(items(events)).toEqual([
      {
        type: "tool_call.delta",
        name: "f",
        arguments: '{"a":',
        tool_call_id: "c",
      },
    ]);
  });
});

describe("stream protocol violations and rejected responses", () => {
  test.each<[string, UniEvent[]]>([
    [
      "a delta after its item was done",
      [
        delta(withId("0", { type: "text.delta", text: "a" })),
        delta(withId("0", { type: "text.done", text: "a" })),
        delta(withId("0", { type: "text.delta", text: "b" })),
      ],
    ],
    [
      "a second delta carrying fidelity in one item",
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
            fidelity: { signature: "1" },
          }),
        ),
      ],
    ],
    [
      "a done item whose fidelity differs from its deltas'",
      [
        delta(withId("0", { type: "thinking.delta", thinking: "a" })),
        delta(
          withId("0", {
            type: "thinking.done",
            thinking: "a",
            fidelity: { signature: "s" },
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
      "a fragment of another kind under an item's id",
      [
        delta(withId("0", { type: "text.delta", text: "a" })),
        delta(withId("0", { type: "thinking.delta", thinking: "b" })),
      ],
    ],
    [
      "a done item of another kind under an item's id",
      [
        delta(withId("0", { type: "text.delta", text: "a" })),
        delta(withId("0", { type: "thinking.done", thinking: "a" })),
      ],
    ],
    [
      "a done item no delta of which streamed",
      [delta(withId("0", { type: "text.done", text: "a" }))],
    ],
    [
      "a delta without fidelity.item_id",
      [delta({ type: "text.delta", text: "a" })],
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
    [
      "an item still open when the stream ends",
      [delta(withId("0", { type: "text.delta", text: "a" }))],
    ],
  ])("%s raises StreamProtocolError", async (_name, script) => {
    await expect(
      collect(new ScriptedClient([...script, FINISH])),
    ).rejects.toBeInstanceOf(StreamProtocolError);
  });

  test("the items of an event reach the caller up to the one that fails", async () => {
    const events: UniEvent[] = [];
    const run = async () => {
      for await (const event of new ScriptedClient([
        delta(
          withId("0", { type: "text.delta", text: "a" }),
          withId("0", { type: "thinking.delta", thinking: "b" }),
        ),
        FINISH,
      ]).streamingResponse({ messages: [USER], config: {} })) {
        events.push(event);
      }
    };

    await expect(run()).rejects.toBeInstanceOf(StreamProtocolError);
    expect(items(events)).toEqual([{ type: "text.delta", text: "a" }]);
  });

  test("a stream without usage or finish reason yields no stop event", async () => {
    const events: UniEvent[] = [];
    const run = async () => {
      for await (const event of new ScriptedClient([
        delta(withId("0", { type: "text.delta", text: "a" })),
        delta(withId("0", { type: "text.done", text: "a" })),
        stop(null, "stop"),
      ]).streamingResponse({ messages: [USER], config: {} })) {
        events.push(event);
      }
    };

    await expect(run()).rejects.toThrow("without usage_metadata");
    expect(events.some((event) => event.event_type === "stop")).toBe(false);
  });

  test("a thinking-only response raises EmptyResponseError carrying its usage", async () => {
    const error = await collect(
      new ScriptedClient([
        delta(withId("0", { type: "thinking.delta", thinking: "hmm" })),
        delta(withId("0", { type: "thinking.done", thinking: "hmm" })),
        FINISH,
      ]),
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(EmptyResponseError);
    expect(error.usageMetadata).toEqual(USAGE);
    expect(error.finishReason).toBe("stop");
  });
});

describe("history and legacy messages", () => {
  const reply: UniEvent[] = [
    delta(withId("0", { type: "text.delta", text: "hello" })),
    delta(withId("0", { type: "text.done", text: "hello" })),
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
    const events = await collect(new ScriptedClient(reply));
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
