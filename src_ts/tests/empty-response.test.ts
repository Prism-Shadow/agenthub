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

import { expect, describe, test } from "@jest/globals";
import {
  AgentHubError,
  AutoLLMClient,
  EmptyResponseError,
  EventContentItem,
  TextDeltaItem,
  ToolCallArgumentParseError,
  UniConfig,
  UniEvent,
  UniMessage,
} from "../src";
import { assertStreamGrammar } from "./streamGrammar";

type FakeCreateEndpoint = {
  create: () => Promise<AsyncIterable<unknown>>;
};

type FakeStreamClient = {
  baseURL?: string;
  chat?: { completions: FakeCreateEndpoint };
  responses?: FakeCreateEndpoint;
};

type ReasoningStreamClient = {
  streamingResponse(options: {
    messages: UniMessage[];
    config: UniConfig;
  }): AsyncIterable<UniEvent>;
};

interface ReasoningStreamCase {
  expectedClient: string;
  model: string;
  clientType: string;
  // the wire shape the client parses: "chat" or "responses"
  protocol?: "chat" | "responses";
}

const REASONING_STREAM_CASES: ReasoningStreamCase[] = [
  {
    expectedClient: "OpenaiChatClient",
    model: "gpt-5.5",
    clientType: "openai",
  },
  {
    expectedClient: "GLM5_3Client",
    model: "glm-5.1",
    clientType: "glm-5.1",
  },
  {
    expectedClient: "KimiK3Client",
    model: "kimi-k2.6",
    clientType: "kimi-k2.6",
  },
  {
    expectedClient: "OpenaiResponsesClient",
    model: "gpt-5.6",
    clientType: "openai-responses",
    protocol: "responses",
  },
  {
    expectedClient: "DeepSeekV4Client",
    model: "deepseek-v4",
    clientType: "deepseek-v4",
    protocol: "responses",
  },
];

const messages: UniMessage[] = [
  {
    role: "user",
    content_items: [{ type: "text.done", text: "Create a memo." }],
  },
];

function streamFromChunks(chunks: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

function installFakeStream(
  client: ReasoningStreamClient,
  testCase: ReasoningStreamCase,
  chunks: unknown[],
): void {
  const endpoint: FakeCreateEndpoint = {
    create: async () => streamFromChunks(chunks),
  };
  const fakeClient: FakeStreamClient =
    testCase.protocol === "responses"
      ? { responses: endpoint }
      : {
          baseURL: "https://api.test.invalid/v1",
          chat: { completions: endpoint },
        };
  const routedClient = (
    client as unknown as { _client: { _client: FakeStreamClient } }
  )._client;
  routedClient._client = fakeClient;
}

function createAutoClient(testCase: ReasoningStreamCase): AutoLLMClient {
  return new AutoLLMClient({
    model: testCase.model,
    apiKey: "test-key",
    clientType: testCase.clientType,
  });
}

function deltaChunk(delta: {
  content?: string;
  reasoning_content?: string;
}): unknown {
  return {
    choices: [{ delta, finish_reason: null }],
    usage: null,
  };
}

function stopChunk(finishReason: string): unknown {
  return {
    choices: [{ delta: {}, finish_reason: finishReason }],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      completion_tokens_details: { reasoning_tokens: 1 },
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: 1,
    },
  };
}

function responsesStopEvent(finishReason: string): unknown {
  const status = finishReason === "length" ? "incomplete" : "completed";
  return {
    type: `response.${status}`,
    response: {
      status,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 1 },
      },
    },
  };
}

/** Build a thinking/text/stop stream in the wire shape the case's client parses. */
function reasoningStream(
  testCase: ReasoningStreamCase,
  options: { thinking?: string; text?: string; finishReason?: string },
): unknown[] {
  const finishReason = options.finishReason ?? "stop";
  if (testCase.protocol === "responses") {
    const events: unknown[] = [];
    if (options.thinking) {
      events.push({
        type: "response.reasoning_text.delta",
        delta: options.thinking,
      });
    }
    if (options.text) {
      events.push({
        type: "response.output_text.delta",
        delta: options.text,
      });
    }

    events.push(responsesStopEvent(finishReason));
    return events;
  }

  const chunks: unknown[] = [];
  if (options.thinking) {
    chunks.push(deltaChunk({ reasoning_content: options.thinking }));
  }
  if (options.text) {
    chunks.push(deltaChunk({ content: options.text }));
  }

  chunks.push(stopChunk(finishReason));
  return chunks;
}

async function collectEvents(
  stream: AsyncIterable<UniEvent>,
): Promise<UniEvent[]> {
  const events: UniEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

async function captureStreamError(
  stream: AsyncIterable<UniEvent>,
): Promise<unknown> {
  let capturedError: unknown;
  try {
    await collectEvents(stream);
  } catch (error) {
    capturedError = error;
  }
  return capturedError;
}

describe.each(REASONING_STREAM_CASES)(
  "Reasoning output validation for $clientType",
  (testCase) => {
    test("rejects thinking-only responses", async () => {
      const client = createAutoClient(testCase);
      installFakeStream(
        client,
        testCase,
        reasoningStream(testCase, { thinking: "Let me think about the memo." }),
      );

      const capturedError = await captureStreamError(
        client.streamingResponse({ messages, config: {} }),
      );

      expect(capturedError).toBeInstanceOf(EmptyResponseError);
      const emptyError = capturedError as EmptyResponseError;
      expect(emptyError.client).toBe(testCase.expectedClient);
      expect(emptyError.finishReason).toBe("stop");
      expect(emptyError.message).toContain("no content other than thinking");
    });

    test("rejects responses without any content", async () => {
      const client = createAutoClient(testCase);
      installFakeStream(
        client,
        testCase,
        reasoningStream(testCase, { finishReason: "length" }),
      );

      const capturedError = await captureStreamError(
        client.streamingResponse({ messages, config: {} }),
      );

      expect(capturedError).toBeInstanceOf(EmptyResponseError);
      expect((capturedError as EmptyResponseError).finishReason).toBe("length");
    });

    test("accepts responses with text content", async () => {
      const client = createAutoClient(testCase);
      installFakeStream(
        client,
        testCase,
        reasoningStream(testCase, {
          thinking: "Let me think about the memo.",
          text: "Here is the memo.",
        }),
      );

      const events = await collectEvents(
        client.streamingResponse({ messages, config: {} }),
      );
      assertStreamGrammar(events);
      const texts = events
        .flatMap((event): EventContentItem[] => event.content_items)
        .filter((item): item is TextDeltaItem => item.type === "text.delta")
        .map((item) => item.text);
      expect(texts).toEqual(["Here is the memo."]);
    });
  },
);

test("AgentHub errors share the AgentHubError base class", () => {
  const emptyError = new EmptyResponseError({
    client: "OpenaiChatClient",
    finishReason: "stop",
  });
  expect(emptyError).toBeInstanceOf(AgentHubError);
  const parseError = new ToolCallArgumentParseError({
    client: "OpenaiChatClient",
    toolName: "exec_command",
    toolCallId: "call_ok",
    rawArguments: "[]",
    reason: "Expected a JSON object.",
  });
  expect(parseError).toBeInstanceOf(AgentHubError);
});
