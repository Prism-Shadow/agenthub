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

// A GPT-6 reasoning item arrives twice: response.output_item.added carries an
// encrypted_content that may still be truncated, and response.output_item.done carries the
// complete one. The two are different ciphertexts, not a prefix pair (verified live
// 2026-09-09, api_captures/openai_responses/gpt-6-astra/), and the streaming-events
// reference says to replay the done one.
const PARTIAL_ENCRYPTED_CONTENT = "gAAAAABpartial";
const FULL_ENCRYPTED_CONTENT = "gAAAAABcomplete-ciphertext";
const REASONING_ITEM_ID = "rs_072e343322bd1418016aa1391d844c87";
const SUMMARY_TEXT = "**Distinguishing Paris and London metro references**";

interface ReasoningItemCase {
  expectedClient: string;
  model: string;
  clientType: string;
}

// Both clients that serve gpt-6-astra: the official endpoint and the gateway path the
// OpenRouter openai/gpt-6-astra row routes through.
const REASONING_ITEM_CASES: ReasoningItemCase[] = [
  {
    expectedClient: "GPT6Client",
    model: "gpt-6-astra",
    clientType: "gpt-6",
  },
  {
    expectedClient: "OpenaiResponsesClient",
    model: "openai/gpt-6-astra",
    clientType: "openai-responses",
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

function installFakeResponsesStream(
  client: AutoLLMClient,
  events: unknown[],
): void {
  const routedClient = (client as unknown as { _client: { _client: unknown } })
    ._client;
  routedClient._client = {
    responses: { create: async () => streamFromEvents(events) },
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

function textDeltaEvent(text: string): unknown {
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

function userMessage(): UniMessage {
  return {
    role: "user",
    content_items: [{ type: "text", text: "Which city is on the Seine?" }],
  };
}

async function runTurnAndReplay(client: AutoLLMClient): Promise<{
  historyMessage: UniMessage;
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
  const modelInput = (await client.transformUniMessageToModelInput(
    history,
  )) as Record<string, unknown>[];
  return { historyMessage: history[history.length - 1], modelInput };
}

describe.each(REASONING_ITEM_CASES)(
  "GPT-6 reasoning item capture for $clientType",
  (testCase) => {
    test("fidelity carries the done encrypted_content and the replay rebuilds from it", async () => {
      const client = new AutoLLMClient({
        model: testCase.model,
        apiKey: "test-key",
        clientType: testCase.clientType,
      });
      expect(
        (client as unknown as { _client: object })._client.constructor.name,
      ).toBe(testCase.expectedClient);
      installFakeResponsesStream(client, [
        reasoningItemAddedEvent(),
        reasoningSummaryDeltaEvent("**Distinguishing Paris"),
        reasoningSummaryDeltaEvent(" and London metro references**"),
        reasoningItemDoneEvent(),
        textDeltaEvent("Paris."),
        completedEvent(),
      ]);

      const { historyMessage, modelInput } = await runTurnAndReplay(client);

      // one thinking item, carrying the streamed summary and the completed item's fields
      expect(
        historyMessage.content_items.filter((item) => item.type === "thinking"),
      ).toEqual([
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
