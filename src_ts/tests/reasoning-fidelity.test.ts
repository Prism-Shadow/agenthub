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
import { AutoLLMClient, TextContentItem, UniEvent, UniMessage } from "../src";

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
    content_items: [{ type: "text", text: "Create a memo." }],
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

  const history = client.getHistory();
  const modelInput = await transformHistory(client, history);
  const historyMessage = history[history.length - 1];
  const replayedMessage = modelInput[modelInput.length - 1];
  if (!historyMessage || !replayedMessage) {
    throw new Error("history or model input is empty");
  }

  return { historyMessage, replayedMessage, modelInput };
}

function thinkingItems(message: UniMessage): unknown[] {
  return message.content_items.filter((item) => item.type === "thinking");
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
          type: "thinking",
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
          type: "thinking",
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
        { type: "thinking", thinking: "Let me think." },
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
            { type: "thinking", thinking: "Let me think." },
            { type: "text", text: "Here is the memo." },
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

      const { historyMessage, modelInput } = await runTurnAndReplay(client);

      // one thinking item, carrying the streamed summary and the completed item's fields
      expect(thinkingItems(historyMessage)).toEqual([
        {
          type: "thinking",
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

function textDeltaEvent(text: string, phase?: string): UniEvent {
  const item: TextContentItem = { type: "text", text };
  if (phase !== undefined) {
    item.fidelity = { phase };
  }

  return {
    role: "assistant",
    event_type: "delta",
    content_items: [item],
    usage_metadata: null,
    finish_reason: null,
  };
}

test("concatenation splits text items only on phase change", () => {
  const client = createAutoClient(REASONING_REPLAY_CASES[0]);
  const message = client.concatUniEventsToUniMessage([
    textDeltaEvent("", "commentary"),
    textDeltaEvent("I'll inspect the logs."),
    textDeltaEvent("", "final_answer"),
    textDeltaEvent("Root cause:"),
    textDeltaEvent(" cache invalidation race."),
    textDeltaEvent("", "final_answer"),
    textDeltaEvent(" Remediation follows."),
  ]);

  expect(message.content_items).toEqual([
    {
      type: "text",
      text: "I'll inspect the logs.",
      fidelity: { phase: "commentary" },
    },
    {
      type: "text",
      text: "Root cause: cache invalidation race. Remediation follows.",
      fidelity: { phase: "final_answer" },
    },
  ]);
});
