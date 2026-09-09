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

import { expect, describe, test, afterEach } from "@jest/globals";
import {
  AutoLLMClient,
  TextContentItem,
  UniConfig,
  UniEvent,
  UniMessage,
} from "../src";
import { LLMClient } from "../src/baseClient";

type StreamClient = {
  streamingResponse(options: {
    messages: UniMessage[];
    config: UniConfig;
  }): AsyncIterable<UniEvent>;
};

interface StreamCase {
  expectedClient: string;
  model: string;
  clientType: string;
}

// Every client that parses the OpenAI Responses SSE shape.
const RESPONSES_STREAM_CASES: StreamCase[] = [
  {
    expectedClient: "GPT6Client",
    model: "gpt-5.6",
    clientType: "gpt-5.6",
  },
  {
    expectedClient: "OpenaiResponsesClient",
    model: "gpt-5.6",
    clientType: "openai-responses",
  },
  {
    expectedClient: "DeepSeekV4Client",
    model: "deepseek-v4",
    clientType: "deepseek-v4",
  },
  {
    expectedClient: "MiniMaxM3Client",
    model: "minimax-m3",
    clientType: "minimax-m3",
  },
];

// Every client that parses the OpenAI Chat Completions chunk shape.
const CHAT_STREAM_CASES: StreamCase[] = [
  {
    expectedClient: "OpenaiChatClient",
    model: "gpt-5.6",
    clientType: "openai-chat",
  },
  {
    expectedClient: "GLM5_3Client",
    model: "glm-5.3",
    clientType: "glm-5.3",
  },
  {
    expectedClient: "KimiK3Client",
    model: "kimi-k3",
    clientType: "kimi-k3",
  },
];

// Every client that parses the Anthropic Messages event shape.
const MESSAGES_STREAM_CASES: StreamCase[] = [
  {
    expectedClient: "Claude5Client",
    model: "claude-sonnet-5",
    clientType: "claude-sonnet-5",
  },
  {
    expectedClient: "AntMessagesClient",
    model: "claude-sonnet-5",
    clientType: "ant-messages",
  },
];

// Every client that parses the Gemini generateContent chunk shape.
const GEMINI_STREAM_CASES: StreamCase[] = [
  {
    expectedClient: "Gemini3_8Client",
    model: "gemini-3.8-flash",
    clientType: "gemini-3.8",
  },
];

const messages: UniMessage[] = [
  {
    role: "user",
    content_items: [{ type: "text", text: "Create a memo." }],
  },
];

function streamFromEvents(events: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

function installFakeStream(client: StreamClient, fakeClient: unknown): void {
  const routedClient = (client as unknown as { _client: { _client: unknown } })
    ._client;
  routedClient._client = fakeClient;
}

function installFakeResponsesStream(
  client: StreamClient,
  events: unknown[],
): void {
  installFakeStream(client, {
    responses: { create: async () => streamFromEvents(events) },
  });
}

function installFakeChatStream(client: StreamClient, events: unknown[]): void {
  installFakeStream(client, {
    baseURL: "https://api.test.invalid/v1",
    chat: {
      completions: { create: async () => streamFromEvents(events) },
    },
  });
}

function installFakeMessagesStream(
  client: StreamClient,
  events: unknown[],
): void {
  installFakeStream(client, {
    baseURL: "https://api.test.invalid",
    beta: { messages: { create: async () => streamFromEvents(events) } },
  });
}

function installFakeGeminiStream(
  client: StreamClient,
  events: unknown[],
): void {
  installFakeStream(client, {
    models: { generateContentStream: async () => streamFromEvents(events) },
  });
}

function routedClientName(client: StreamClient): string {
  return (client as unknown as { _client: object })._client.constructor.name;
}

function createAutoClient(testCase: StreamCase): AutoLLMClient {
  return new AutoLLMClient({
    model: testCase.model,
    apiKey: "test-key",
    clientType: testCase.clientType,
  });
}

// Heartbeats come from gateways in front of the provider (one-api-style proxies), never
// from the official APIs, so the event shapes below are synthesized from the report in
// https://github.com/Prism-Shadow/penguin-harness/issues/286.
function responsesKeepaliveEvent(sequenceNumber: number): unknown {
  return { type: "keepalive", sequence_number: sequenceNumber };
}

function responsesTextDeltaEvent(text: string): unknown {
  return { type: "response.output_text.delta", delta: text };
}

function responsesCompletedEvent(): unknown {
  return {
    type: "response.completed",
    response: {
      status: "completed",
      usage: {
        input_tokens: 2,
        output_tokens: 3,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 1 },
      },
    },
  };
}

function chatKeepaliveChunk(sequenceNumber: number): unknown {
  // A heartbeat is not a Chat Completions chunk, so the fields the client reads are
  // simply absent: choices arrives as undefined rather than an empty list.
  return { type: "keepalive", sequence_number: sequenceNumber };
}

function chatTextChunk(text: string): unknown {
  return {
    choices: [{ delta: { content: text }, finish_reason: null }],
  };
}

function chatStopChunk(): unknown {
  return {
    choices: [{ delta: {}, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 2,
      completion_tokens: 3,
      completion_tokens_details: { reasoning_tokens: 1 },
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: 2,
    },
  };
}

function messagesPingEvent(): unknown {
  return { type: "ping" };
}

function messagesStartEvent(): unknown {
  return {
    type: "message_start",
    message: {
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  };
}

function messagesTextDeltaEvent(text: string): unknown {
  return {
    type: "content_block_delta",
    delta: { type: "text_delta", text: text },
  };
}

function messagesStopEvent(): unknown {
  return {
    type: "message_delta",
    delta: { stop_reason: "end_turn" },
    usage: {
      input_tokens: 2,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 3,
    },
  };
}

function geminiKeepaliveChunk(): unknown {
  // The SDK maps only the fields it knows onto the response, so a heartbeat reaches the
  // client as a chunk carrying neither candidates nor usage.
  return {};
}

function geminiUnknownPartChunk(): unknown {
  // a part the client recognizes by none of its fields, e.g. a modality added after this
  // client: the SDK leaves what it does not know undefined rather than null
  return {
    candidates: [{ content: { parts: [{}] }, finishReason: null }],
  };
}

function geminiTextChunk(text: string): unknown {
  return {
    candidates: [{ content: { parts: [{ text: text }] }, finishReason: null }],
  };
}

function geminiStopChunk(): unknown {
  return {
    // FinishReason is a string enum, so the raw value keys the client's mapping
    candidates: [{ content: { parts: [] }, finishReason: "STOP" }],
    usageMetadata: {
      promptTokenCount: 2,
      cachedContentTokenCount: 0,
      thoughtsTokenCount: 1,
      candidatesTokenCount: 3,
    },
  };
}

// Events belonging to no protocol the clients parse. A gateway injects the first two on
// long generations — the ping shape a relay sent into a Responses stream, carrying its own
// cost field, and a bare heartbeat — while the last two carry something a client would
// otherwise drop.
function foreignPingEvent(): unknown {
  return { type: "ping", cost: "@" };
}

function foreignHeartbeatEvent(): unknown {
  return { type: "heartbeat" };
}

function foreignErrorEvent(): unknown {
  return { type: "gateway_error", message: "upstream 502" };
}

function foreignPayloadEvent(): unknown {
  return { type: "relay_frame", data: { text: "dropped" } };
}

// One shape per reason an event can be unrecognized: inside the protocol's own namespace,
// an error the gateway reports, and a frame carrying a payload.
const unknownResponsesEvents: [string, () => unknown][] = [
  ["in-protocol", () => ({ type: "response.mystery_event" })],
  ["error", foreignErrorEvent],
  ["payload", foreignPayloadEvent],
];

const unknownMessagesEvents: [string, () => unknown][] = [
  ["in-protocol", () => ({ type: "message_mystery" })],
  ["error", foreignErrorEvent],
  ["payload", foreignPayloadEvent],
];

async function collectEvents(
  stream: AsyncIterable<UniEvent>,
): Promise<UniEvent[]> {
  const events: UniEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

function collectedTexts(events: UniEvent[]): string[] {
  return events.flatMap((event) =>
    event.content_items
      .filter((item): item is TextContentItem => item.type === "text")
      .map((item) => item.text),
  );
}

afterEach(() => {
  delete process.env.AGENTHUB_DEBUG;
});

describe.each(RESPONSES_STREAM_CASES)(
  "Stream event handling for $clientType",
  (testCase) => {
    test("skips gateway keepalive heartbeats between stream events", async () => {
      const client = createAutoClient(testCase);
      expect(routedClientName(client)).toBe(testCase.expectedClient);
      installFakeResponsesStream(client, [
        responsesKeepaliveEvent(1),
        responsesTextDeltaEvent("Here is"),
        responsesKeepaliveEvent(2),
        responsesTextDeltaEvent(" the memo."),
        responsesCompletedEvent(),
        responsesKeepaliveEvent(3),
      ]);

      const events = await collectEvents(
        client.streamingResponse({ messages, config: {} }),
      );
      expect(collectedTexts(events)).toEqual(["Here is", " the memo."]);
      expect(events[events.length - 1].finish_reason).toBe("stop");
    });

    test.each(unknownResponsesEvents)(
      "skips an unknown event that is %s",
      async (_label, unknownEvent) => {
        const client = createAutoClient(testCase);
        installFakeResponsesStream(client, [unknownEvent(), responsesTextDeltaEvent("Here is"), responsesCompletedEvent()]);

        const events = await collectEvents(
          client.streamingResponse({ messages, config: {} }),
        );
        expect(collectedTexts(events)).toEqual(["Here is"]);
        expect(events[events.length - 1].finish_reason).toBe("stop");
      },
    );

    test("skips foreign gateway events", async () => {
      const client = createAutoClient(testCase);
      installFakeResponsesStream(client, [
        foreignPingEvent(),
        responsesTextDeltaEvent("Here is"),
        foreignHeartbeatEvent(),
        responsesTextDeltaEvent(" the memo."),
        responsesCompletedEvent(),
      ]);

      const events = await collectEvents(
        client.streamingResponse({ messages, config: {} }),
      );
      expect(collectedTexts(events)).toEqual(["Here is", " the memo."]);
      expect(events[events.length - 1].finish_reason).toBe("stop");
    });

    test.each(unknownResponsesEvents)(
      "rejects an unknown event that is %s with AGENTHUB_DEBUG set",
      async (_label, unknownEvent) => {
        process.env.AGENTHUB_DEBUG = "1";
        const client = createAutoClient(testCase);
        installFakeResponsesStream(client, [unknownEvent(), responsesCompletedEvent()]);

        await expect(
          collectEvents(client.streamingResponse({ messages, config: {} })),
        ).rejects.toThrow("Unknown output");
      },
    );
  },
);

describe.each(CHAT_STREAM_CASES)(
  "Stream event handling for $clientType",
  (testCase) => {
    test("skips gateway keepalive heartbeats between stream chunks", async () => {
      const client = createAutoClient(testCase);
      expect(routedClientName(client)).toBe(testCase.expectedClient);
      installFakeChatStream(client, [
        chatKeepaliveChunk(1),
        chatTextChunk("Here is"),
        chatKeepaliveChunk(2),
        chatTextChunk(" the memo."),
        chatStopChunk(),
        chatKeepaliveChunk(3),
      ]);

      const events = await collectEvents(
        client.streamingResponse({ messages, config: {} }),
      );
      expect(collectedTexts(events)).toEqual(["Here is", " the memo."]);
      expect(events[events.length - 1].finish_reason).toBe("stop");
    });
  },
);

describe.each(MESSAGES_STREAM_CASES)(
  "Stream event handling for $clientType",
  (testCase) => {
    test("skips gateway ping heartbeats between stream events", async () => {
      const client = createAutoClient(testCase);
      expect(routedClientName(client)).toBe(testCase.expectedClient);
      installFakeMessagesStream(client, [
        messagesPingEvent(),
        messagesStartEvent(),
        messagesTextDeltaEvent("Here is"),
        messagesPingEvent(),
        messagesTextDeltaEvent(" the memo."),
        messagesStopEvent(),
        messagesPingEvent(),
      ]);

      const events = await collectEvents(
        client.streamingResponse({ messages, config: {} }),
      );
      expect(collectedTexts(events)).toEqual(["Here is", " the memo."]);
      expect(events[events.length - 1].finish_reason).toBe("stop");
    });

    test.each(unknownMessagesEvents)(
      "skips an unknown event that is %s",
      async (_label, unknownEvent) => {
        const client = createAutoClient(testCase);
        installFakeMessagesStream(client, [unknownEvent(), messagesStartEvent(), messagesTextDeltaEvent("Here is"), messagesStopEvent()]);

        const events = await collectEvents(
          client.streamingResponse({ messages, config: {} }),
        );
        expect(collectedTexts(events)).toEqual(["Here is"]);
        expect(events[events.length - 1].finish_reason).toBe("stop");
      },
    );

    test("skips foreign gateway events", async () => {
      const client = createAutoClient(testCase);
      installFakeMessagesStream(client, [
        messagesStartEvent(),
        // the Responses-protocol spelling, injected into a Messages stream
        responsesKeepaliveEvent(1),
        messagesTextDeltaEvent("Here is"),
        foreignHeartbeatEvent(),
        messagesTextDeltaEvent(" the memo."),
        messagesStopEvent(),
      ]);

      const events = await collectEvents(
        client.streamingResponse({ messages, config: {} }),
      );
      expect(collectedTexts(events)).toEqual(["Here is", " the memo."]);
      expect(events[events.length - 1].finish_reason).toBe("stop");
    });

    test.each(unknownMessagesEvents)(
      "rejects an unknown event that is %s with AGENTHUB_DEBUG set",
      async (_label, unknownEvent) => {
        process.env.AGENTHUB_DEBUG = "1";
        const client = createAutoClient(testCase);
        installFakeMessagesStream(client, [unknownEvent(), messagesStartEvent(), messagesStopEvent()]);

        await expect(
          collectEvents(client.streamingResponse({ messages, config: {} })),
        ).rejects.toThrow("Unknown output");
      },
    );
  },
);

describe.each(GEMINI_STREAM_CASES)(
  "Stream event handling for $clientType",
  (testCase) => {
    test("skips an unknown part", async () => {
      const client = createAutoClient(testCase);
      installFakeGeminiStream(client, [
        geminiUnknownPartChunk(),
        geminiTextChunk("Here is"),
        geminiStopChunk(),
      ]);

      const events = await collectEvents(
        client.streamingResponse({ messages, config: {} }),
      );
      expect(collectedTexts(events)).toEqual(["Here is"]);
      expect(events[events.length - 1].finish_reason).toBe("stop");
    });

    test("rejects an unknown part with AGENTHUB_DEBUG set", async () => {
      process.env.AGENTHUB_DEBUG = "1";
      const client = createAutoClient(testCase);
      installFakeGeminiStream(client, [
        geminiUnknownPartChunk(),
        geminiStopChunk(),
      ]);

      await expect(
        collectEvents(client.streamingResponse({ messages, config: {} })),
      ).rejects.toThrow("Unknown output");
    });

    test("skips gateway keepalive heartbeats between stream chunks", async () => {
      const client = createAutoClient(testCase);
      expect(routedClientName(client)).toBe(testCase.expectedClient);
      installFakeGeminiStream(client, [
        geminiKeepaliveChunk(),
        geminiTextChunk("Here is"),
        geminiKeepaliveChunk(),
        geminiTextChunk(" the memo."),
        geminiStopChunk(),
        geminiKeepaliveChunk(),
      ]);

      const events = await collectEvents(
        client.streamingResponse({ messages, config: {} }),
      );
      expect(collectedTexts(events)).toEqual(["Here is", " the memo."]);
      // a heartbeat must not surface as an empty event of its own
      expect(events).toHaveLength(3);
      expect(events[events.length - 1].finish_reason).toBe("stop");
    });
  },
);


// Every client, driven over the ignorable events its own protocol carries.
const UNUSED_EVENT_CASES: Array<{
  testCase: StreamCase;
  install: (client: StreamClient, events: unknown[]) => void;
  stream: () => unknown[];
}> = [
  ...RESPONSES_STREAM_CASES.map((testCase) => ({
    testCase,
    install: installFakeResponsesStream,
    stream: () => [
      responsesKeepaliveEvent(1),
      responsesTextDeltaEvent("Here is"),
      responsesCompletedEvent(),
    ],
  })),
  ...CHAT_STREAM_CASES.map((testCase) => ({
    testCase,
    install: installFakeChatStream,
    stream: () => [chatKeepaliveChunk(1), chatTextChunk("Here is"), chatStopChunk()],
  })),
  ...MESSAGES_STREAM_CASES.map((testCase) => ({
    testCase,
    install: installFakeMessagesStream,
    stream: () => [
      messagesPingEvent(),
      messagesStartEvent(),
      messagesTextDeltaEvent("Here is"),
      messagesStopEvent(),
    ],
  })),
  ...GEMINI_STREAM_CASES.map((testCase) => ({
    testCase,
    install: installFakeGeminiStream,
    stream: () => [geminiKeepaliveChunk(), geminiTextChunk("Here is"), geminiStopChunk()],
  })),
];

/** A client that lets its own "unused" bookkeeping escape, which no client may do. */
class LeakyClient extends LLMClient {
  protected _model = "leaky-1";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transformUniConfigToModelConfig(config: UniConfig): any {
    return config;
  }

  transformUniMessageToModelInput(messages: UniMessage[]): UniMessage[] {
    return messages;
  }

  transformModelOutputToUniEvent(modelOutput: UniEvent): UniEvent {
    return modelOutput;
  }

  async *_streamingResponseInternal(): AsyncGenerator<UniEvent> {
    yield {
      role: "assistant",
      event_type: "unused",
      content_items: [],
      usage_metadata: null,
      finish_reason: null,
    };
    yield {
      role: "assistant",
      event_type: "delta",
      content_items: [{ type: "text", text: "Here is" }],
      usage_metadata: null,
      finish_reason: null,
    };
    yield {
      role: "assistant",
      event_type: "stop",
      content_items: [],
      usage_metadata: {
        cached_tokens: 0,
        prompt_tokens: 1,
        thoughts_tokens: 0,
        response_tokens: 1,
      },
      finish_reason: "stop",
    };
  }

  async listModels(): Promise<string[]> {
    return [this._model];
  }
}

describe.each(UNUSED_EVENT_CASES)(
  "Unused event handling for $testCase.clientType",
  ({ testCase, install, stream }) => {
    test("never yields an unused event", async () => {
      // with the debug guard on, an "unused" event that reached the caller throws instead of passing
      process.env.AGENTHUB_DEBUG = "1";
      const client = createAutoClient(testCase);
      install(client, stream());

      const events = await collectEvents(
        client.streamingResponse({ messages, config: {} }),
      );
      expect(events.every((event) => event.event_type !== "unused")).toBe(true);
      expect(collectedTexts(events)).toEqual(["Here is"]);
    });
  },
);

describe("Base client unused event guarantee", () => {
  test("drops an escaped unused event", async () => {
    const events = await collectEvents(
      new LeakyClient().streamingResponse({ messages, config: {} }),
    );

    expect(events.map((event) => event.event_type)).toEqual(["delta", "stop"]);
  });

  test("rejects an escaped unused event with AGENTHUB_DEBUG set", async () => {
    process.env.AGENTHUB_DEBUG = "1";

    await expect(
      collectEvents(new LeakyClient().streamingResponse({ messages, config: {} })),
    ).rejects.toThrow("unused event");
  });
});
