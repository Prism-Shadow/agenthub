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
  EventContentItem,
  TextDeltaItem,
  UniConfig,
  UniEvent,
  UniMessage,
} from "../src";
import { assertStreamGrammar } from "./streamGrammar";

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

// Every client that parses the Gemini Interactions event shape.
const GEMINI_STREAM_CASES: StreamCase[] = [
  {
    expectedClient: "Gemini3_8Client",
    model: "gemini-3.8-flash",
    clientType: "gemini-3.8",
  },
];

// Every client that parses the Gemini generateContent chunk shape.
const GENERATE_CONTENT_STREAM_CASES: StreamCase[] = [
  {
    expectedClient: "Gemini3_8GenerateContentClient",
    model: "gemini-3.8-flash",
    clientType: "gemini-generate-content",
  },
];

const messages: UniMessage[] = [
  {
    role: "user",
    content_items: [{ type: "text.done", text: "Create a memo." }],
  },
];

// what a client makes of a wire event that carries nothing universal
const EMPTY_EVENT: UniEvent = {
  role: "assistant",
  event_type: "delta",
  content_items: [],
  usage_metadata: null,
  finish_reason: null,
};

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
    interactions: { create: async () => streamFromEvents(events) },
  });
}

function installFakeGenerateContentStream(
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
    index: 0,
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

function geminiKeepaliveEvent(): unknown {
  // The SDK passes a frame through as parsed, so a heartbeat reaches the client without the
  // event_type every Interactions event carries.
  return { type: "keepalive", sequence_number: 1 };
}

function geminiStatusUpdateEvent(): unknown {
  return {
    event_type: "interaction.status_update",
    interaction_id: "",
    status: "in_progress",
  };
}

function geminiUnknownDeltaEvent(): unknown {
  // a delta of a type the client does not know, e.g. a modality added after this client
  return { event_type: "step.delta", index: 0, delta: { type: "hologram" } };
}

function geminiTextDeltaEvent(text: string): unknown {
  return {
    event_type: "step.delta",
    index: 0,
    delta: { type: "text", text: text },
  };
}

function geminiDeltaEvent(index: number, delta: object): unknown {
  return { event_type: "step.delta", index, delta };
}

function geminiErrorEvent(): unknown {
  // the error event the streaming reference documents, which the SDK hands over as parsed
  return {
    event_type: "error",
    error: {
      message: "Deadline expired before operation could complete.",
      code: "gateway_timeout",
    },
  };
}

function geminiCompletedEvent(status = "completed"): unknown {
  return {
    event_type: "interaction.completed",
    interaction: {
      status,
      usage: {
        total_input_tokens: 2,
        total_cached_tokens: 0,
        total_thought_tokens: 1,
        total_output_tokens: 3,
      },
    },
  };
}

function generateContentKeepaliveChunk(): unknown {
  // The SDK maps only the fields it knows onto the response, so a heartbeat reaches the
  // client as a chunk carrying neither candidates nor usage.
  return {};
}

function generateContentUnknownPartChunk(): unknown {
  // a part the client recognizes by none of its fields, e.g. a modality added after this
  // client: the SDK leaves what it does not know undefined rather than null
  return {
    candidates: [{ content: { parts: [{}] }, finishReason: null }],
  };
}

function generateContentTextChunk(text: string): unknown {
  return {
    candidates: [{ content: { parts: [{ text: text }] }, finishReason: null }],
  };
}

function generateContentStopChunk(): unknown {
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
  return events
    .flatMap((event): EventContentItem[] => event.content_items)
    .filter((item): item is TextDeltaItem => item.type === "text.delta")
    .map((item) => item.text);
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
      assertStreamGrammar(events);
      expect(collectedTexts(events)).toEqual(["Here is", " the memo."]);
      expect(events[events.length - 1].finish_reason).toBe("stop");
    });

    test.each(unknownResponsesEvents)(
      "skips an unknown event that is %s",
      async (_label, unknownEvent) => {
        const client = createAutoClient(testCase);
        expect(client.transformModelOutputToUniEvent(unknownEvent())).toEqual(
          EMPTY_EVENT,
        );
        installFakeResponsesStream(client, [
          unknownEvent(),
          responsesTextDeltaEvent("Here is"),
          responsesCompletedEvent(),
        ]);

        const events = await collectEvents(
          client.streamingResponse({ messages, config: {} }),
        );
        assertStreamGrammar(events);
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
      assertStreamGrammar(events);
      expect(collectedTexts(events)).toEqual(["Here is", " the memo."]);
      expect(events[events.length - 1].finish_reason).toBe("stop");
    });

    test.each(unknownResponsesEvents)(
      "rejects an unknown event that is %s with AGENTHUB_DEBUG set",
      async (_label, unknownEvent) => {
        process.env.AGENTHUB_DEBUG = "1";
        const client = createAutoClient(testCase);
        installFakeResponsesStream(client, [
          unknownEvent(),
          responsesCompletedEvent(),
        ]);

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
      assertStreamGrammar(events);
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
      assertStreamGrammar(events);
      expect(collectedTexts(events)).toEqual(["Here is", " the memo."]);
      expect(events[events.length - 1].finish_reason).toBe("stop");
    });

    test.each(unknownMessagesEvents)(
      "skips an unknown event that is %s",
      async (_label, unknownEvent) => {
        const client = createAutoClient(testCase);
        expect(client.transformModelOutputToUniEvent(unknownEvent())).toEqual(
          EMPTY_EVENT,
        );
        installFakeMessagesStream(client, [
          unknownEvent(),
          messagesStartEvent(),
          messagesTextDeltaEvent("Here is"),
          messagesStopEvent(),
        ]);

        const events = await collectEvents(
          client.streamingResponse({ messages, config: {} }),
        );
        assertStreamGrammar(events);
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
      assertStreamGrammar(events);
      expect(collectedTexts(events)).toEqual(["Here is", " the memo."]);
      expect(events[events.length - 1].finish_reason).toBe("stop");
    });

    test.each(unknownMessagesEvents)(
      "rejects an unknown event that is %s with AGENTHUB_DEBUG set",
      async (_label, unknownEvent) => {
        process.env.AGENTHUB_DEBUG = "1";
        const client = createAutoClient(testCase);
        installFakeMessagesStream(client, [
          unknownEvent(),
          messagesStartEvent(),
          messagesStopEvent(),
        ]);

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
    test("skips an unknown delta", async () => {
      const client = createAutoClient(testCase);
      expect(
        client.transformModelOutputToUniEvent(geminiUnknownDeltaEvent()),
      ).toEqual(EMPTY_EVENT);
      installFakeGeminiStream(client, [
        geminiUnknownDeltaEvent(),
        geminiTextDeltaEvent("Here is"),
        geminiCompletedEvent(),
      ]);

      const events = await collectEvents(
        client.streamingResponse({ messages, config: {} }),
      );
      assertStreamGrammar(events);
      expect(collectedTexts(events)).toEqual(["Here is"]);
      expect(events[events.length - 1].finish_reason).toBe("stop");
    });

    test("rejects an unknown delta with AGENTHUB_DEBUG set", async () => {
      process.env.AGENTHUB_DEBUG = "1";
      const client = createAutoClient(testCase);
      installFakeGeminiStream(client, [
        geminiUnknownDeltaEvent(),
        geminiCompletedEvent(),
      ]);

      await expect(
        collectEvents(client.streamingResponse({ messages, config: {} })),
      ).rejects.toThrow("Unknown output");
    });

    test("skips gateway keepalive heartbeats between stream events", async () => {
      const client = createAutoClient(testCase);
      expect(routedClientName(client)).toBe(testCase.expectedClient);
      installFakeGeminiStream(client, [
        geminiKeepaliveEvent(),
        geminiTextDeltaEvent("Here is"),
        geminiKeepaliveEvent(),
        geminiTextDeltaEvent(" the memo."),
        geminiCompletedEvent(),
        geminiKeepaliveEvent(),
      ]);

      const events = await collectEvents(
        client.streamingResponse({ messages, config: {} }),
      );
      assertStreamGrammar(events);
      expect(collectedTexts(events)).toEqual(["Here is", " the memo."]);
      // a heartbeat must not surface as an event of its own: two text deltas, their done
      // item, the stop
      expect(events).toHaveLength(4);
      expect(events[events.length - 1].finish_reason).toBe("stop");
    });

    test("raises a provider error event with its code and message", async () => {
      const client = createAutoClient(testCase);
      installFakeGeminiStream(client, [
        geminiTextDeltaEvent("Here is"),
        geminiErrorEvent(),
        geminiCompletedEvent("failed"),
      ]);

      await expect(
        collectEvents(client.streamingResponse({ messages, config: {} })),
      ).rejects.toThrow(
        "Gemini stream error gateway_timeout: Deadline expired before operation could complete.",
      );
    });

    test("streams every image of a step as an item of its own and audio chunks as one item", async () => {
      const data = (text: string) => Buffer.from(text).toString("base64");
      const client = createAutoClient(testCase);
      installFakeGeminiStream(client, [
        // an image model's thought summary showing two drafts in a row, closed by its signature
        geminiDeltaEvent(0, {
          type: "thought_summary",
          content: {
            type: "image",
            data: data("draft 1"),
            mime_type: "image/png",
          },
        }),
        geminiDeltaEvent(0, {
          type: "thought_summary",
          content: {
            type: "image",
            data: data("draft 2"),
            mime_type: "image/png",
          },
        }),
        geminiDeltaEvent(0, { type: "thought_signature", signature: "sig-1" }),
        { event_type: "step.stop", index: 0 },
        // two images in a row in the model's output
        geminiDeltaEvent(1, {
          type: "image",
          data: data("image 1"),
          mime_type: "image/png",
        }),
        geminiDeltaEvent(1, {
          type: "image",
          data: data("image 2"),
          mime_type: "image/png",
        }),
        { event_type: "step.stop", index: 1 },
        // speech a TTS model streams in chunks
        geminiDeltaEvent(2, {
          type: "audio",
          data: data("pcm 1"),
          mime_type: "audio/l16",
          sample_rate: 24000,
          channels: 1,
        }),
        geminiDeltaEvent(2, {
          type: "audio",
          data: data("pcm 2"),
          mime_type: "audio/l16",
          sample_rate: 24000,
          channels: 1,
        }),
        { event_type: "step.stop", index: 2 },
        geminiCompletedEvent(),
      ]);

      const events = await collectEvents(
        client.streamingResponse({ messages, config: {} }),
      );
      assertStreamGrammar(events);
      const doneItems = events
        .flatMap((event): EventContentItem[] => event.content_items)
        .filter((item) => item.type.endsWith(".done"));
      expect(doneItems).toEqual([
        {
          type: "inline_thinking.done",
          data: Buffer.from("draft 1"),
          mime_type: "image/png",
        },
        {
          type: "inline_thinking.done",
          data: Buffer.from("draft 2"),
          mime_type: "image/png",
          fidelity: { signature: "sig-1" },
        },
        {
          type: "inline_data.done",
          data: Buffer.from("image 1"),
          mime_type: "image/png",
        },
        {
          type: "inline_data.done",
          data: Buffer.from("image 2"),
          mime_type: "image/png",
        },
        {
          type: "inline_data.done",
          data: Buffer.from("pcm 1pcm 2"),
          mime_type: "audio/l16; rate=24000; channels=1",
        },
      ]);
    });
  },
);

describe.each(GENERATE_CONTENT_STREAM_CASES)(
  "Stream event handling for $clientType",
  (testCase) => {
    test("skips an unknown part", async () => {
      const client = createAutoClient(testCase);
      expect(
        client.transformModelOutputToUniEvent(
          generateContentUnknownPartChunk(),
        ),
      ).toEqual(EMPTY_EVENT);
      installFakeGenerateContentStream(client, [
        generateContentUnknownPartChunk(),
        generateContentTextChunk("Here is"),
        generateContentStopChunk(),
      ]);

      const events = await collectEvents(
        client.streamingResponse({ messages, config: {} }),
      );
      assertStreamGrammar(events);
      expect(collectedTexts(events)).toEqual(["Here is"]);
      expect(events[events.length - 1].finish_reason).toBe("stop");
    });

    test("rejects an unknown part with AGENTHUB_DEBUG set", async () => {
      process.env.AGENTHUB_DEBUG = "1";
      const client = createAutoClient(testCase);
      installFakeGenerateContentStream(client, [
        generateContentUnknownPartChunk(),
        generateContentStopChunk(),
      ]);

      await expect(
        collectEvents(client.streamingResponse({ messages, config: {} })),
      ).rejects.toThrow("Unknown output");
    });

    test("skips gateway keepalive heartbeats between stream chunks", async () => {
      const client = createAutoClient(testCase);
      expect(routedClientName(client)).toBe(testCase.expectedClient);
      installFakeGenerateContentStream(client, [
        generateContentKeepaliveChunk(),
        generateContentTextChunk("Here is"),
        generateContentKeepaliveChunk(),
        generateContentTextChunk(" the memo."),
        generateContentStopChunk(),
        generateContentKeepaliveChunk(),
      ]);

      const events = await collectEvents(
        client.streamingResponse({ messages, config: {} }),
      );
      assertStreamGrammar(events);
      expect(collectedTexts(events)).toEqual(["Here is", " the memo."]);
      // a heartbeat must not surface as an event of its own: two text deltas, their done
      // item, the stop
      expect(events).toHaveLength(4);
      expect(events[events.length - 1].finish_reason).toBe("stop");
    });
  },
);

// Every client, driven over a stream opening with an ignorable event of its own protocol.
const IGNORABLE_EVENT_CASES: Array<{
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
    stream: () => [
      chatKeepaliveChunk(1),
      chatTextChunk("Here is"),
      chatStopChunk(),
    ],
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
    stream: () => [
      geminiStatusUpdateEvent(),
      geminiTextDeltaEvent("Here is"),
      geminiCompletedEvent(),
    ],
  })),
  ...GENERATE_CONTENT_STREAM_CASES.map((testCase) => ({
    testCase,
    install: installFakeGenerateContentStream,
    stream: () => [
      generateContentKeepaliveChunk(),
      generateContentTextChunk("Here is"),
      generateContentStopChunk(),
    ],
  })),
];

describe.each(IGNORABLE_EVENT_CASES)(
  "Ignorable event handling for $testCase.clientType",
  ({ testCase, install, stream }) => {
    test("turns an ignorable event into an empty event and streams only deltas and a stop", async () => {
      // with the debug guard on, an event the client did not know would throw instead of passing
      process.env.AGENTHUB_DEBUG = "1";
      const client = createAutoClient(testCase);
      const [ignorableEvent] = stream();
      expect(client.transformModelOutputToUniEvent(ignorableEvent)).toEqual(
        EMPTY_EVENT,
      );
      install(client, stream());

      const events = await collectEvents(
        client.streamingResponse({ messages, config: {} }),
      );
      assertStreamGrammar(events);
      expect(collectedTexts(events)).toEqual(["Here is"]);
    });
  },
);
