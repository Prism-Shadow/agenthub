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
  AutoLLMClient,
  ToolCallArgumentParseError,
  ToolCallDeltaItem,
  ToolCallDoneItem,
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

type OpenAICompatibleToolStreamClient = {
  streamingResponse(options: {
    messages: UniMessage[];
    config: UniConfig;
  }): AsyncIterable<UniEvent>;
};

interface OpenAICompatibleToolStreamCase {
  expectedClient: string;
  model: string;
  clientType: string;
  // the wire shape the client parses: "chat" or "responses"
  protocol?: "chat" | "responses";
}

const OPENAI_COMPATIBLE_TOOL_STREAM_CASES: OpenAICompatibleToolStreamCase[] = [
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
  {
    expectedClient: "MiniMaxM3Client",
    model: "MiniMax-M3",
    clientType: "minimax-m3",
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
  client: OpenAICompatibleToolStreamClient,
  testCase: OpenAICompatibleToolStreamCase,
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

function createAutoClient(
  testCase: OpenAICompatibleToolStreamCase,
): AutoLLMClient {
  return new AutoLLMClient({
    model: testCase.model,
    apiKey: "test-key",
    clientType: testCase.clientType,
  });
}

function toolDeltaChunk(
  toolCallId: string,
  name: string,
  args: string,
): unknown {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              id: toolCallId,
              function: { name, arguments: args },
            },
          ],
        },
        finish_reason: null,
      },
    ],
    usage: null,
  };
}

function toolStopChunk(): unknown {
  return {
    choices: [{ delta: {}, finish_reason: "tool_calls" }],
    usage: {
      completion_tokens: 1,
      completion_tokens_details: { reasoning_tokens: 0 },
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: 1,
    },
  };
}

/** The completed function-call item a Responses server sends once its arguments are done. */
function functionCallItemDone(
  toolCallId: string,
  name: string,
  args: string,
  itemId?: string,
): unknown {
  return {
    type: "response.output_item.done",
    item: {
      type: "function_call",
      id: itemId,
      call_id: toolCallId,
      name,
      arguments: args,
      status: "completed",
    },
  };
}

/** Build a streamed tool call in the wire shape the case's client parses. */
function toolStream(
  testCase: OpenAICompatibleToolStreamCase,
  toolCallId: string,
  name: string,
  ...fragments: string[]
): unknown[] {
  if (testCase.protocol === "responses") {
    const events: unknown[] = [
      {
        type: "response.output_item.added",
        item: { type: "function_call", name, call_id: toolCallId },
      },
    ];
    for (const fragment of fragments) {
      events.push({
        type: "response.function_call_arguments.delta",
        delta: fragment,
      });
    }

    events.push({ type: "response.function_call_arguments.done" });
    events.push(functionCallItemDone(toolCallId, name, fragments.join("")));
    events.push({
      type: "response.completed",
      response: {
        status: "completed",
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      },
    });
    return events;
  }

  const chunks: unknown[] = [toolDeltaChunk(toolCallId, name, fragments[0])];
  for (const fragment of fragments.slice(1)) {
    chunks.push(toolDeltaChunk("", "", fragment));
  }

  chunks.push(toolStopChunk());
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

/** Consume a stream expected to fail, keeping the events that arrived before the error. */
async function captureStreamError(
  stream: AsyncIterable<UniEvent>,
): Promise<{ events: UniEvent[]; error: unknown }> {
  const events: UniEvent[] = [];
  try {
    for await (const event of stream) {
      events.push(event);
    }
  } catch (error) {
    return { events, error };
  }
  return { events, error: undefined };
}

/** Every item the events carried, in stream order. */
function streamedItems(events: UniEvent[]) {
  return events.flatMap((event) => event.content_items);
}

/**
 * Arguments are parsed when the call's item is done: the call's deltas have already reached the
 * caller, and neither its done item nor the stop event ever does.
 */
function expectRaisedWhenTheCallIsDone(
  events: UniEvent[],
  toolCallId: string,
): void {
  const items = streamedItems(events);
  expect(items[0]).toMatchObject({
    type: "tool_call.delta",
    name: "exec_command",
    tool_call_id: toolCallId,
  });
  expect(items.map((item) => item.type)).not.toContain("tool_call.done");
  expect(events.map((event) => event.event_type)).not.toContain("stop");
}

describe.each(OPENAI_COMPATIBLE_TOOL_STREAM_CASES)(
  "OpenAI-compatible tool call streaming for $clientType",
  (testCase) => {
    test("combines valid streamed tool call arguments", async () => {
      const client = createAutoClient(testCase);
      installFakeStream(
        client,
        testCase,
        toolStream(
          testCase,
          "call_ok",
          "exec_command",
          '{"cmd":',
          '"echo ok"}',
        ),
      );

      const events = await collectEvents(
        client.streamingResponse({ messages, config: {} }),
      );
      assertStreamGrammar(events);
      const toolCalls = streamedItems(events).filter(
        (item): item is ToolCallDoneItem => item.type === "tool_call.done",
      );

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]).toEqual({
        type: "tool_call.done",
        name: "exec_command",
        arguments: { cmd: "echo ok" },
        tool_call_id: "call_ok",
      });

      // the deltas announce the call before its done item and concatenate to the arguments
      // it carries, whether the client streamed them or delivered the item alone
      const fragments = streamedItems(events).filter(
        (item): item is ToolCallDeltaItem => item.type === "tool_call.delta",
      );
      expect(fragments[0]).toMatchObject({
        name: "exec_command",
        tool_call_id: "call_ok",
      });
      expect(
        JSON.parse(fragments.map((fragment) => fragment.arguments).join("")),
      ).toEqual(toolCalls[0].arguments);
      const kinds = streamedItems(events)
        .filter(
          (item) =>
            item.type === "tool_call.delta" || item.type === "tool_call.done",
        )
        .map((item) => item.type);
      expect(kinds.indexOf("tool_call.delta")).toBeLessThan(
        kinds.indexOf("tool_call.done"),
      );
    });

    test("reports malformed streamed tool call arguments with context", async () => {
      const client = createAutoClient(testCase);
      installFakeStream(
        client,
        testCase,
        toolStream(
          testCase,
          "call_bad",
          "exec_command",
          '{"cmd":"python create_docx.py',
        ),
      );

      const { events, error } = await captureStreamError(
        client.streamingResponse({ messages, config: {} }),
      );

      expect(error).toBeInstanceOf(ToolCallArgumentParseError);
      expectRaisedWhenTheCallIsDone(events, "call_bad");
      const parseError = error as ToolCallArgumentParseError;
      expect(parseError.client).toBe(testCase.expectedClient);
      expect(parseError.toolName).toBe("exec_command");
      expect(parseError.toolCallId).toBe("call_bad");
      expect(parseError.rawArgumentsLength).toBeGreaterThan(0);
      expect(parseError.rawArgumentsPreview).toContain("create_docx.py");
      expect(parseError.message).toMatch(/Unterminated string/u);
    });

    test("reports non-object streamed tool call arguments with context", async () => {
      const client = createAutoClient(testCase);
      installFakeStream(
        client,
        testCase,
        toolStream(testCase, "call_array", "exec_command", "[]"),
      );

      const { events, error } = await captureStreamError(
        client.streamingResponse({ messages, config: {} }),
      );

      expect(error).toBeInstanceOf(ToolCallArgumentParseError);
      expectRaisedWhenTheCallIsDone(events, "call_array");
      const parseError = error as ToolCallArgumentParseError;
      expect(parseError.client).toBe(testCase.expectedClient);
      expect(parseError.toolName).toBe("exec_command");
      expect(parseError.toolCallId).toBe("call_array");
      expect(parseError.rawArgumentsLength).toBe(2);
      expect(parseError.rawArgumentsPreview).toBe("[]");
      expect(parseError.message).toContain("Expected a JSON object.");
    });
  },
);

// A gateway may open every function call of a response before closing any of them: Console Go
// streams added(A), deltas(A), added(B), deltas(B), done(A), done(B). Each call still belongs to
// the assistant message -- one dropped call replays its tool result as an orphaned
// function_call_output on the next request, which Console Go rejects with "No function call found
// for function_call_output with call_id ...".
const RESPONSES_CASES = OPENAI_COMPATIBLE_TOOL_STREAM_CASES.filter(
  (testCase) => testCase.protocol === "responses",
);

const COMPLETED_EVENT: unknown = {
  type: "response.completed",
  response: {
    status: "completed",
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  },
};

/** Two function calls of one response, interleaved the way Console Go streams them. */
function interleavedParallelCallStream(): unknown[] {
  const open = (suffix: string) => ({
    added: {
      type: "response.output_item.added",
      item: {
        type: "function_call",
        id: `fc_${suffix}`,
        call_id: `call_${suffix}`,
        name: `tool_${suffix}`,
      },
    },
    deltas: [
      {
        type: "response.function_call_arguments.delta",
        item_id: `fc_${suffix}`,
        delta: '{"city":',
      },
      {
        type: "response.function_call_arguments.delta",
        item_id: `fc_${suffix}`,
        delta: '"Paris"}',
      },
    ],
    done: {
      type: "response.function_call_arguments.done",
      item_id: `fc_${suffix}`,
    },
    itemDone: functionCallItemDone(
      `call_${suffix}`,
      `tool_${suffix}`,
      '{"city":"Paris"}',
      `fc_${suffix}`,
    ),
  });
  const first = open("first");
  const second = open("second");

  return [
    first.added,
    ...first.deltas,
    second.added,
    ...second.deltas,
    first.done,
    first.itemDone,
    second.done,
    second.itemDone,
    COMPLETED_EVENT,
  ];
}

describe.each(RESPONSES_CASES)(
  "OpenAI Responses parallel tool calls for $clientType",
  (testCase) => {
    test("keeps every call when a gateway interleaves their events", async () => {
      const client = createAutoClient(testCase);
      installFakeStream(client, testCase, interleavedParallelCallStream());

      const events = await collectEvents(
        client.streamingResponse({ messages, config: {} }),
      );
      // the grammar also proves the two calls reach the caller one after the other
      assertStreamGrammar(events);
      const toolCalls = streamedItems(events).filter(
        (item): item is ToolCallDoneItem => item.type === "tool_call.done",
      );

      expect(
        toolCalls.map((call) => [call.tool_call_id, call.name, call.arguments]),
      ).toEqual([
        ["call_first", "tool_first", { city: "Paris" }],
        ["call_second", "tool_second", { city: "Paris" }],
      ]);
    });
  },
);
