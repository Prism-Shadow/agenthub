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
import { AutoLLMClient, UniEvent, UniMessage } from "../src";
import { assertStreamGrammar } from "./streamGrammar";

type FakeOpenAICompatibleClient = {
  baseURL: string;
  chat: {
    completions: {
      create: () => Promise<AsyncIterable<unknown>>;
    };
  };
};

interface ReasoningReplayCase {
  model: string;
  clientType: string;
}

const REASONING_REPLAY_CASES: ReasoningReplayCase[] = [
  { model: "gpt-5.5", clientType: "openai" },
  { model: "glm-5.1", clientType: "glm-5.1" },
  { model: "kimi-k2.6", clientType: "kimi-k2.6" },
];

interface ResponsesReasoningCase extends ReasoningReplayCase {
  expectedClient: string;
}

// The Responses-protocol clients that carry a reasoning item's encrypted_content back on
// the next turn; DeepSeek and MiniMax rebuild reasoning from text and are covered by the
// chat table's rules above. The done event is the only source of that ciphertext: the
// streaming-events reference says "For reasoning items, encrypted_content may be
// incomplete while the item is in progress. Use the reasoning item from the corresponding
// response.output_item.done event when passing it as input to a subsequent request.", and
// the live capture on 2026-09-09 (api_captures/openai_responses/gpt-6-astra/) showed the
// added and done ciphertexts differ and are not a prefix pair.
const RESPONSES_REASONING_CASES: ResponsesReasoningCase[] = [
  { expectedClient: "GPT6Client", model: "gpt-6-astra", clientType: "gpt-6" },
  {
    expectedClient: "OpenaiResponsesClient",
    model: "openai/gpt-6-astra",
    clientType: "openai-responses",
  },
];

const PARTIAL_ENCRYPTED_CONTENT = "gAAAAABpartial";
const FULL_ENCRYPTED_CONTENT = "gAAAAABcomplete-ciphertext";
const REASONING_ITEM_ID = "rs_072e343322bd1418016aa1391d844c87";
const SUMMARY_TEXT = "**Distinguishing Paris and London metro references**";

function streamFromChunks(chunks: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

function installFakeOpenAICompatibleStream(
  client: AutoLLMClient,
  chunks: unknown[],
): void {
  const fakeClient: FakeOpenAICompatibleClient = {
    baseURL: "https://api.test.invalid/v1",
    chat: {
      completions: {
        create: async () => streamFromChunks(chunks),
      },
    },
  };
  const routedClient = (
    client as unknown as { _client: { _client: FakeOpenAICompatibleClient } }
  )._client;
  routedClient._client = fakeClient;
}

function createAutoClient(testCase: ReasoningReplayCase): AutoLLMClient {
  return new AutoLLMClient({
    model: testCase.model,
    apiKey: "test-key",
    clientType: testCase.clientType,
  });
}

function deltaChunk(delta: {
  content?: string;
  reasoning_content?: string;
  reasoning?: string;
}): unknown {
  return {
    choices: [{ delta, finish_reason: null }],
    usage: null,
  };
}

function stopChunk(finishReason: string = "stop"): unknown {
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

function userMessage(): UniMessage {
  return {
    role: "user",
    content_items: [{ type: "text.done", text: "Create a memo." }],
  };
}

async function transformHistory(
  client: AutoLLMClient,
  history: UniMessage[],
): Promise<Record<string, unknown>[]> {
  return (await client.transformUniMessageToModelInput(history)) as Record<
    string,
    unknown
  >[];
}

async function runTurnAndReplay(client: AutoLLMClient): Promise<{
  events: UniEvent[];
  historyMessage: UniMessage;
  replayedMessage: Record<string, unknown>;
  modelInput: Record<string, unknown>[];
}> {
  const events: UniEvent[] = [];
  for await (const event of client.streamingResponseStateful({
    message: userMessage(),
    config: {},
  })) {
    events.push(event);
  }
  assertStreamGrammar(events);

  const history = client.getHistory();
  const modelInput = await transformHistory(client, history);
  const historyMessage = history[history.length - 1];
  const replayedMessage = modelInput[modelInput.length - 1];
  if (!historyMessage || !replayedMessage) {
    throw new Error("history or model input is empty");
  }

  return { events, historyMessage, replayedMessage, modelInput };
}

function thinkingItems(message: UniMessage): unknown[] {
  return message.content_items.filter((item) => item.type === "thinking.done");
}

/** Every item the events carried, in stream order. */
function streamedItems(events: UniEvent[]) {
  return events.flatMap((event) => event.content_items);
}

describe.each(REASONING_REPLAY_CASES)(
  "Reasoning field fidelity for $clientType",
  (testCase) => {
    test("replay preserves the reasoning_content field", async () => {
      const client = createAutoClient(testCase);
      installFakeOpenAICompatibleStream(client, [
        deltaChunk({ reasoning_content: "Let me think" }),
        deltaChunk({ reasoning_content: " about the memo." }),
        deltaChunk({ content: "Here is the memo." }),
        stopChunk(),
      ]);

      const { historyMessage, replayedMessage } =
        await runTurnAndReplay(client);
      expect(thinkingItems(historyMessage)).toEqual([
        {
          type: "thinking.done",
          thinking: "Let me think about the memo.",
          fidelity: { reasoning_field: "reasoning_content" },
        },
      ]);
      expect(replayedMessage.reasoning_content).toBe(
        "Let me think about the memo.",
      );
      expect(replayedMessage).not.toHaveProperty("reasoning");
    });

    test("replay preserves the reasoning field", async () => {
      const client = createAutoClient(testCase);
      installFakeOpenAICompatibleStream(client, [
        deltaChunk({ reasoning: "Let me think" }),
        deltaChunk({ reasoning: " about the memo." }),
        deltaChunk({ content: "Here is the memo." }),
        stopChunk(),
      ]);

      const { historyMessage, replayedMessage } =
        await runTurnAndReplay(client);
      expect(thinkingItems(historyMessage)).toEqual([
        {
          type: "thinking.done",
          thinking: "Let me think about the memo.",
          fidelity: { reasoning_field: "reasoning" },
        },
      ]);
      expect(replayedMessage.reasoning).toBe("Let me think about the memo.");
      expect(replayedMessage).not.toHaveProperty("reasoning_content");
    });

    test("replay keeps both fields when the origin is ambiguous", async () => {
      const client = createAutoClient(testCase);
      installFakeOpenAICompatibleStream(client, [
        deltaChunk({
          reasoning_content: "Let me think.",
          reasoning: "Let me think.",
        }),
        deltaChunk({ content: "Here is the memo." }),
        stopChunk(),
      ]);

      const { historyMessage, replayedMessage } =
        await runTurnAndReplay(client);
      expect(thinkingItems(historyMessage)).toEqual([
        { type: "thinking.done", thinking: "Let me think." },
      ]);
      expect(replayedMessage.reasoning_content).toBe("Let me think.");
      expect(replayedMessage.reasoning).toBe("Let me think.");
    });

    test("replay of thinking without fidelity sends both fields", async () => {
      const client = createAutoClient(testCase);
      const history: UniMessage[] = [
        userMessage(),
        {
          role: "assistant",
          content_items: [
            { type: "thinking.done", thinking: "Let me think." },
            { type: "text.done", text: "Here is the memo." },
          ],
        },
      ];

      const modelInput = await transformHistory(client, history);
      const replayedMessage = modelInput[modelInput.length - 1];
      if (!replayedMessage) {
        throw new Error("model input is empty");
      }

      expect(replayedMessage.reasoning_content).toBe("Let me think.");
      expect(replayedMessage.reasoning).toBe("Let me think.");
    });
  },
);

function installFakeResponsesStream(
  client: AutoLLMClient,
  events: unknown[],
): void {
  const routedClient = (client as unknown as { _client: { _client: unknown } })
    ._client;
  routedClient._client = {
    responses: { create: async () => streamFromChunks(events) },
  };
}

function reasoningItemAddedEvent(): unknown {
  return {
    type: "response.output_item.added",
    output_index: 0,
    item: {
      id: REASONING_ITEM_ID,
      type: "reasoning",
      content: [],
      encrypted_content: PARTIAL_ENCRYPTED_CONTENT,
      summary: [],
    },
  };
}

function reasoningSummaryDeltaEvent(text: string): unknown {
  return {
    type: "response.reasoning_summary_text.delta",
    item_id: REASONING_ITEM_ID,
    summary_index: 0,
    delta: text,
  };
}

function reasoningItemDoneEvent(): unknown {
  return {
    type: "response.output_item.done",
    output_index: 0,
    item: {
      id: REASONING_ITEM_ID,
      type: "reasoning",
      content: [],
      encrypted_content: FULL_ENCRYPTED_CONTENT,
      summary: [{ type: "summary_text", text: SUMMARY_TEXT }],
    },
  };
}

function responsesTextDeltaEvent(text: string): unknown {
  return { type: "response.output_text.delta", delta: text };
}

function completedEvent(): unknown {
  return {
    type: "response.completed",
    response: {
      status: "completed",
      usage: {
        input_tokens: 139,
        output_tokens: 109,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 21 },
      },
    },
  };
}

describe.each(RESPONSES_REASONING_CASES)(
  "Responses reasoning replay for $clientType",
  (testCase) => {
    test("replay carries the done encrypted_content only", async () => {
      const client = createAutoClient(testCase);
      expect(
        (client as unknown as { _client: object })._client.constructor.name,
      ).toBe(testCase.expectedClient);
      installFakeResponsesStream(client, [
        reasoningItemAddedEvent(),
        reasoningSummaryDeltaEvent("**Distinguishing Paris"),
        reasoningSummaryDeltaEvent(" and London metro references**"),
        reasoningItemDoneEvent(),
        responsesTextDeltaEvent("Paris."),
        completedEvent(),
      ]);

      const { events, historyMessage, modelInput } =
        await runTurnAndReplay(client);

      // the fidelity goes out once, on the empty delta the completed item yields, and the
      // done item carries it
      expect(
        streamedItems(events).filter(
          (item) => item.type === "thinking.delta" && item.fidelity,
        ),
      ).toEqual([
        {
          type: "thinking.delta",
          thinking: "",
          fidelity: {
            channel: "summary",
            encrypted_content: FULL_ENCRYPTED_CONTENT,
          },
        },
      ]);
      // one thinking item, carrying the streamed summary and the completed item's fields
      expect(thinkingItems(historyMessage)).toEqual([
        {
          type: "thinking.done",
          thinking: SUMMARY_TEXT,
          fidelity: {
            channel: "summary",
            encrypted_content: FULL_ENCRYPTED_CONTENT,
          },
        },
      ]);

      const reasoningInput = modelInput.find(
        (item) => item.type === "reasoning",
      );
      expect(reasoningInput).toEqual({
        type: "reasoning",
        summary: [{ type: "summary_text", text: SUMMARY_TEXT }],
        encrypted_content: FULL_ENCRYPTED_CONTENT,
      });
      // the in-progress ciphertext never reaches the replay, and the provider's item id
      // is not replayed either
      expect(JSON.stringify(modelInput)).not.toContain(
        PARTIAL_ENCRYPTED_CONTENT,
      );
      expect(reasoningInput).not.toHaveProperty("id");
    });
  },
);

function messageItemAddedEvent(itemId: string, phase: string): unknown {
  return {
    type: "response.output_item.added",
    item: {
      id: itemId,
      type: "message",
      role: "assistant",
      status: "in_progress",
      content: [],
      phase,
    },
  };
}

function messageTextDeltaEvent(itemId: string, text: string): unknown {
  return {
    type: "response.output_text.delta",
    item_id: itemId,
    content_index: 0,
    delta: text,
  };
}

function messageItemDoneEvent(
  itemId: string,
  phase: string,
  text: string,
): unknown {
  return {
    type: "response.output_item.done",
    item: {
      id: itemId,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text, annotations: [] }],
      phase,
    },
  };
}

// A message item's phase is known when the item is added, so it goes out once, on an empty
// delta, and the item's done carries it. Nothing merges items after the fact: the message keeps
// one text item per message item, and the replay starts a new message only where the phase
// changes.
describe.each(RESPONSES_REASONING_CASES)(
  "Responses phase replay for $clientType",
  (testCase) => {
    test("every message item keeps its phase, and the replay splits only on a phase change", async () => {
      const client = createAutoClient(testCase);
      expect(
        (client as unknown as { _client: object })._client.constructor.name,
      ).toBe(testCase.expectedClient);
      installFakeResponsesStream(client, [
        messageItemAddedEvent("msg_1", "commentary"),
        messageTextDeltaEvent("msg_1", "I'll inspect the logs."),
        messageItemDoneEvent("msg_1", "commentary", "I'll inspect the logs."),
        messageItemAddedEvent("msg_2", "final_answer"),
        messageTextDeltaEvent("msg_2", "Root cause:"),
        messageTextDeltaEvent("msg_2", " cache invalidation race."),
        messageItemDoneEvent(
          "msg_2",
          "final_answer",
          "Root cause: cache invalidation race.",
        ),
        messageItemAddedEvent("msg_3", "final_answer"),
        messageTextDeltaEvent("msg_3", " Remediation follows."),
        messageItemDoneEvent("msg_3", "final_answer", " Remediation follows."),
        completedEvent(),
      ]);

      const { events, historyMessage, modelInput } =
        await runTurnAndReplay(client);

      const commentary = { phase: "commentary" };
      const finalAnswer = { phase: "final_answer" };
      expect(streamedItems(events)).toEqual([
        { type: "text.delta", text: "", fidelity: commentary },
        { type: "text.delta", text: "I'll inspect the logs." },
        {
          type: "text.done",
          text: "I'll inspect the logs.",
          fidelity: commentary,
        },
        { type: "text.delta", text: "", fidelity: finalAnswer },
        { type: "text.delta", text: "Root cause:" },
        { type: "text.delta", text: " cache invalidation race." },
        {
          type: "text.done",
          text: "Root cause: cache invalidation race.",
          fidelity: finalAnswer,
        },
        { type: "text.delta", text: "", fidelity: finalAnswer },
        { type: "text.delta", text: " Remediation follows." },
        {
          type: "text.done",
          text: " Remediation follows.",
          fidelity: finalAnswer,
        },
      ]);

      const doneItems = streamedItems(events).filter(
        (item) => item.type === "text.done",
      );
      expect(historyMessage.content_items).toEqual(doneItems);
      expect(client.concatUniEventsToUniMessage(events).content_items).toEqual(
        doneItems,
      );

      expect(modelInput.slice(1)).toEqual([
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "I'll inspect the logs." }],
          phase: "commentary",
        },
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Root cause: cache invalidation race.",
            },
            { type: "output_text", text: " Remediation follows." },
          ],
          phase: "final_answer",
        },
      ]);
    });
  },
);

function installFakeGenerateContentStream(
  client: AutoLLMClient,
  chunks: unknown[],
): void {
  const routedClient = (client as unknown as { _client: { _client: unknown } })
    ._client;
  routedClient._client = {
    models: { generateContentStream: async () => streamFromChunks(chunks) },
  };
}

// Vertex AI attaches a usageMetadata carrying no counts to every chunk before the last one
function generateContentChunk(parts: object[]): unknown {
  return {
    candidates: [{ content: { role: "model", parts } }],
    usageMetadata: { trafficType: "ON_DEMAND" },
  };
}

function generateContentStopChunk(parts: object[]): unknown {
  return {
    candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }],
    usageMetadata: {
      promptTokenCount: 77,
      candidatesTokenCount: 87,
      thoughtsTokenCount: 377,
      trafficType: "ON_DEMAND",
    },
  };
}

function createGenerateContentClient(): AutoLLMClient {
  const client = new AutoLLMClient({
    model: "gemini-3.8-flash",
    apiKey: "test-key",
    clientType: "gemini-generate-content",
  });
  expect(
    (client as unknown as { _client: object })._client.constructor.name,
  ).toBe("Gemini3_8GenerateContentClient");
  return client;
}

// generateContent carries no item identity and no end-of-item signal; the chunk shapes follow
// the Vertex AI captures of 2026-09-17 (api_captures/gemini_interactions/vertex/generate_content/).
describe("generateContent signature replay", () => {
  test("generateContent closes an item with its signature and replays it on the same part", async () => {
    const client = createGenerateContentClient();
    installFakeGenerateContentStream(client, [
      generateContentChunk([
        { text: "**Checking the weather**", thought: true },
      ]),
      generateContentChunk([{ text: "The capital" }]),
      generateContentChunk([{ text: " of China" }]),
      generateContentChunk([{ text: " is Beijing." }]),
      generateContentChunk([
        {
          functionCall: {
            name: "get_weather",
            args: { city: "Beijing" },
            id: "call_1",
          },
          thoughtSignature: "sig-1",
        },
      ]),
      generateContentStopChunk([{ text: "" }]),
    ]);

    const { events, modelInput } = await runTurnAndReplay(client);

    const fidelity = { signature: "sig-1" };
    expect(streamedItems(events)).toEqual([
      { type: "thinking.delta", thinking: "**Checking the weather**" },
      { type: "thinking.done", thinking: "**Checking the weather**" },
      { type: "text.delta", text: "The capital" },
      { type: "text.delta", text: " of China" },
      { type: "text.delta", text: " is Beijing." },
      { type: "text.done", text: "The capital of China is Beijing." },
      {
        type: "tool_call.delta",
        name: "get_weather",
        arguments: '{"city":"Beijing"}',
        tool_call_id: "call_1",
        fidelity,
      },
      {
        type: "tool_call.done",
        name: "get_weather",
        arguments: { city: "Beijing" },
        tool_call_id: "call_1",
        fidelity,
      },
    ]);
    // the API reports STOP for a turn that stopped to call a tool
    expect(events[events.length - 1].finish_reason).toBe("tool_call");

    // the empty text part that ended the stream is not replayed
    expect(modelInput[1]).toEqual({
      role: "model",
      parts: [
        { text: "**Checking the weather**", thought: true },
        { text: "The capital of China is Beijing." },
        {
          functionCall: {
            id: "call_1",
            name: "get_weather",
            args: { city: "Beijing" },
          },
          thoughtSignature: "sig-1",
        },
      ],
    });
  });

  test("generateContent closes a text answer with the signature of its last empty part", async () => {
    const client = createGenerateContentClient();
    installFakeGenerateContentStream(client, [
      generateContentChunk([{ text: "The weather in Beijing" }]),
      generateContentChunk([{ text: " is sunny." }]),
      generateContentStopChunk([{ text: "", thoughtSignature: "sig-2" }]),
    ]);

    const { events, historyMessage, modelInput } =
      await runTurnAndReplay(client);

    expect(historyMessage.content_items).toEqual([
      {
        type: "text.done",
        text: "The weather in Beijing is sunny.",
        fidelity: { signature: "sig-2" },
      },
    ]);
    expect(events[events.length - 1].finish_reason).toBe("stop");
    expect(modelInput[1]).toEqual({
      role: "model",
      parts: [
        { text: "The weather in Beijing is sunny.", thoughtSignature: "sig-2" },
      ],
    });
  });
});
