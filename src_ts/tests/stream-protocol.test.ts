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
import { ClientPart, LLMClient } from "../src/baseClient";
import {
  EmptyResponseError,
  StreamProtocolError,
  ToolCallArgumentParseError,
} from "../src/errors";
import { normalizeLegacyMessages } from "../src/legacy";
import { UniConfig, UniEvent, UniMessage, UsageMetadata } from "../src/types";
import { assertStreamGrammar } from "./streamGrammar";

const USAGE: UsageMetadata = {
  cached_tokens: null,
  prompt_tokens: 10,
  thoughts_tokens: null,
  response_tokens: 5,
};

const FINISH: ClientPart = {
  type: "finish",
  usage_metadata: USAGE,
  finish_reason: "stop",
};

const USER: UniMessage = {
  role: "user",
  content_items: [{ type: "text.done", text: "hi" }],
};

/**
 * A client that replays a fixed list of parts and records the messages it was sent.
 */
class ScriptedClient extends LLMClient {
  sentMessages: UniMessage[][] = [];

  constructor(private readonly parts: ClientPart[]) {
    super();
    this._model = "scripted";
  }

  transformUniConfigToModelConfig(): undefined {
    return undefined;
  }

  transformUniMessageToModelInput(messages: UniMessage[]): UniMessage[] {
    return messages;
  }

  transformModelOutputToClientParts(modelOutput: ClientPart): ClientPart[] {
    return [modelOutput];
  }

  async *_streamingResponseInternal(options: {
    messages: UniMessage[];
    config: UniConfig;
  }): AsyncGenerator<ClientPart> {
    this.sentMessages.push(options.messages);
    for (const part of this.parts) {
      yield* this.transformModelOutputToClientParts(part);
    }
  }

  async listModels(): Promise<string[]> {
    return [];
  }
}

async function collect(
  parts: ClientPart[],
  config: UniConfig = {},
): Promise<UniEvent[]> {
  const events: UniEvent[] = [];
  for await (const event of new ScriptedClient(parts).streamingResponse({
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
      { type: "delta", key: "0", item: { type: "text.delta", text: "Hel" } },
      { type: "delta", key: "0", item: { type: "text.delta", text: "lo" } },
      { type: "done", key: "0" },
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
      {
        type: "delta",
        key: "msg",
        item: {
          type: "text.delta",
          text: "",
          fidelity: { phase: "commentary" },
        },
      },
      {
        type: "delta",
        key: "msg",
        item: { type: "text.delta", text: "Checking" },
      },
      { type: "done", key: "msg" },
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

  test("thinking closed by a signature, then a tool call built from its fragments", async () => {
    const events = await collect([
      {
        type: "delta",
        key: "0",
        item: { type: "thinking.delta", thinking: "Let me" },
      },
      {
        type: "delta",
        key: "0",
        item: { type: "thinking.delta", thinking: " look" },
      },
      {
        type: "delta",
        key: "0",
        item: {
          type: "thinking.delta",
          thinking: "",
          fidelity: { signature: "sig" },
        },
      },
      { type: "done", key: "0" },
      {
        type: "delta",
        key: "1",
        item: {
          type: "tool_call.delta",
          name: "get_weather",
          arguments: "",
          tool_call_id: "toolu_1",
        },
      },
      {
        type: "delta",
        key: "1",
        item: {
          type: "tool_call.delta",
          name: "",
          arguments: '{"city":',
          tool_call_id: "",
        },
      },
      {
        type: "delta",
        key: "1",
        item: {
          type: "tool_call.delta",
          name: "",
          arguments: '"Paris"}',
          tool_call_id: "",
        },
      },
      { type: "done", key: "1" },
      { type: "finish", finish_reason: "tool_call", usage_metadata: USAGE },
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

  test("an item that starts while another streams is held back until that one is done", async () => {
    const call = (id: string) => ({
      type: "delta" as const,
      key: id,
      item: {
        type: "tool_call.delta" as const,
        name: `tool_${id}`,
        arguments: "",
        tool_call_id: `call_${id}`,
      },
    });
    const fragment = (id: string, text: string) => ({
      type: "delta" as const,
      key: id,
      item: {
        type: "tool_call.delta" as const,
        name: "",
        arguments: text,
        tool_call_id: "",
      },
    });

    const events = await collect([
      call("a"),
      call("b"),
      fragment("a", '{"x":'),
      fragment("b", '{"y":2}'),
      fragment("a", "1}"),
      { type: "done", key: "a" },
      { type: "done", key: "b" },
      FINISH,
    ]);

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

  test("items still open when the provider's stream ends are done before the stop", async () => {
    const events = await collect([
      { type: "delta", key: "0", item: { type: "text.delta", text: "a" } },
      { type: "delta", key: "1", item: { type: "text.delta", text: "b" } },
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
      {
        type: "delta",
        key: "0",
        item: { type: "thinking.delta", thinking: "" },
      },
      {
        type: "delta",
        key: "0",
        item: { type: "thinking.delta", thinking: "a", fidelity },
      },
      {
        type: "delta",
        key: "0",
        item: { type: "thinking.delta", thinking: "b", fidelity },
      },
      { type: "delta", key: "1", item: { type: "text.delta", text: "ok" } },
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

  test("audio chunks join into one done item and embeddings stream one vector per item", async () => {
    const audio = await collect([
      {
        type: "delta",
        key: "0",
        item: {
          type: "inline_data.delta",
          data: Buffer.from([1, 2]),
          mime_type: "audio/L16",
        },
      },
      {
        type: "delta",
        key: "0",
        item: {
          type: "inline_data.delta",
          data: Buffer.from([3]),
          mime_type: "audio/L16",
        },
      },
      FINISH,
    ]);
    assertStreamGrammar(audio);
    expect(items(audio)[2]).toEqual({
      type: "inline_data.done",
      data: Buffer.from([1, 2, 3]),
      mime_type: "audio/L16",
    });

    const embeddings = await collect([
      {
        type: "delta",
        key: "e0",
        item: { type: "embedding.delta", embedding: [0.1] },
      },
      { type: "done", key: "e0" },
      {
        type: "delta",
        key: "e1",
        item: { type: "embedding.delta", embedding: [0.2] },
      },
      { type: "done", key: "e1" },
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
      { type: "delta", key: "0", item: { type: "text.delta", text: "a" } },
      {
        type: "finish",
        usage_metadata: {
          cached_tokens: 3,
          prompt_tokens: 7,
          thoughts_tokens: null,
          response_tokens: null,
        },
      },
      {
        type: "finish",
        finish_reason: "length",
        usage_metadata: {
          cached_tokens: null,
          prompt_tokens: null,
          thoughts_tokens: null,
          response_tokens: 9,
        },
      },
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
});

describe("stream protocol violations and rejected responses", () => {
  test.each<[string, ClientPart[]]>([
    [
      "a delta after its item was done",
      [
        { type: "delta", key: "0", item: { type: "text.delta", text: "a" } },
        { type: "done", key: "0" },
        { type: "delta", key: "0", item: { type: "text.delta", text: "b" } },
      ],
    ],
    [
      "two different fidelity payloads in one item",
      [
        {
          type: "delta",
          key: "0",
          item: {
            type: "thinking.delta",
            thinking: "a",
            fidelity: { signature: "1" },
          },
        },
        {
          type: "delta",
          key: "0",
          item: {
            type: "thinking.delta",
            thinking: "",
            fidelity: { signature: "2" },
          },
        },
      ],
    ],
    [
      "a tool call whose first fragment has no id",
      [
        {
          type: "delta",
          key: "0",
          item: {
            type: "tool_call.delta",
            name: "f",
            arguments: "{}",
            tool_call_id: "",
          },
        },
      ],
    ],
    [
      "a fragment of another kind under an item's key",
      [
        { type: "delta", key: "0", item: { type: "text.delta", text: "a" } },
        {
          type: "delta",
          key: "0",
          item: { type: "thinking.delta", thinking: "b" },
        },
      ],
    ],
  ])("%s raises StreamProtocolError", async (_name, parts) => {
    await expect(collect([...parts, FINISH])).rejects.toBeInstanceOf(
      StreamProtocolError,
    );
  });

  test("a stream without usage or finish reason yields no stop event", async () => {
    const events: UniEvent[] = [];
    const run = async () => {
      for await (const event of new ScriptedClient([
        { type: "delta", key: "0", item: { type: "text.delta", text: "a" } },
        { type: "finish", finish_reason: "stop" },
      ]).streamingResponse({ messages: [USER], config: {} })) {
        events.push(event);
      }
    };

    await expect(run()).rejects.toThrow("without usage_metadata");
    expect(events.some((event) => event.event_type === "stop")).toBe(false);
  });

  test("a thinking-only response raises EmptyResponseError carrying its usage", async () => {
    const error = await collect([
      {
        type: "delta",
        key: "0",
        item: { type: "thinking.delta", thinking: "hmm" },
      },
      FINISH,
    ]).catch((caught) => caught);

    expect(error).toBeInstanceOf(EmptyResponseError);
    expect(error.usageMetadata).toEqual(USAGE);
    expect(error.finishReason).toBe("stop");
  });

  test("malformed tool call arguments raise when the call is done", async () => {
    await expect(
      collect([
        {
          type: "delta",
          key: "0",
          item: {
            type: "tool_call.delta",
            name: "f",
            arguments: '{"a":',
            tool_call_id: "c",
          },
        },
        { type: "done", key: "0" },
        FINISH,
      ]),
    ).rejects.toBeInstanceOf(ToolCallArgumentParseError);
  });
});

describe("history and legacy messages", () => {
  const reply: ClientPart[] = [
    { type: "delta", key: "0", item: { type: "text.delta", text: "hello" } },
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
