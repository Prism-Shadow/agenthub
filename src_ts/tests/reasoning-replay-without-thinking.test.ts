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

// Replaying a tool-calling turn the model thought nothing on.
//
// DeepSeek stops thinking part-way through a long tool chain, so such a turn arrives
// normally; replaying it without a chain of thought is then rejected with "the
// reasoning_content in the thinking mode must be passed back to the API". DeepSeek waives
// that only for tool_call ids it recognises as its own, which it cannot once a relay has
// reissued them. Chat Completions carries an empty reasoning field on the turn; the
// Responses-shaped DeepSeek client inserts a reasoning item ahead of the call.

import { expect, test } from "@jest/globals";
import {
  AutoLLMClient,
  ContentItem,
  ThinkingContentItem,
  UniMessage,
} from "../src";

const THINKING = "I should call the tool.";

type ModelInputItem = Record<string, unknown>;

interface ReasoningInputItem {
  type: string;
  summary: unknown[];
  content: Array<{ type: string; text: string }>;
}

/** The Chat Completions client; GLM and Kimi keep transforms of their own. */
function chatClient(): AutoLLMClient {
  const client = new AutoLLMClient({
    model: "gpt-5.6",
    apiKey: "test-key",
    clientType: "openai-chat",
  });
  expect(
    (client as unknown as { _client: object })._client.constructor.name,
  ).toBe("OpenaiChatClient");
  return client;
}

function deepseekClient(): AutoLLMClient {
  const client = new AutoLLMClient({
    model: "deepseek-v4",
    apiKey: "test-key",
    clientType: "deepseek-v4",
  });
  expect(
    (client as unknown as { _client: object })._client.constructor.name,
  ).toBe("DeepSeekV4Client");
  return client;
}

async function transformHistory(
  client: AutoLLMClient,
  history: UniMessage[],
): Promise<ModelInputItem[]> {
  return (await client.transformUniMessageToModelInput(
    history,
  )) as ModelInputItem[];
}

function userText(): UniMessage {
  return {
    role: "user",
    content_items: [{ type: "text", text: "What is the weather in Paris?" }],
  };
}

function thinkingItem(text: string, reasoningField?: string): ContentItem {
  const item: ThinkingContentItem = { type: "thinking", thinking: text };
  if (reasoningField !== undefined) {
    item.fidelity = { reasoning_field: reasoningField };
  }

  return item;
}

function toolCallItem(toolCallId: string): ContentItem {
  return {
    type: "tool_call",
    name: "get_weather",
    arguments: { city: "Paris" },
    tool_call_id: toolCallId,
  };
}

function assistant(...contentItems: ContentItem[]): UniMessage {
  return { role: "assistant", content_items: contentItems };
}

function toolResults(...toolCallIds: string[]): UniMessage {
  return {
    role: "user",
    content_items: toolCallIds.map((toolCallId): ContentItem => ({
      type: "tool_result",
      text: "20 degrees.",
      tool_call_id: toolCallId,
    })),
  };
}

function assistantMessages(modelInput: ModelInputItem[]): ModelInputItem[] {
  return modelInput.filter((message) => message.role === "assistant");
}

/** The Responses input as a flat list of item kinds. */
function inputItemTypes(modelInput: ModelInputItem[]): string[] {
  return modelInput.map((item) =>
    item.type === undefined
      ? `message:${item.role as string}`
      : (item.type as string),
  );
}

function toolCallIds(message: ModelInputItem): string[] {
  return (message.tool_calls as Array<{ id: string }>).map((call) => call.id);
}

test("replay sends an empty reasoning_content for a tool call without thinking", async () => {
  const client = chatClient();
  const history: UniMessage[] = [
    userText(),
    assistant(
      thinkingItem(THINKING, "reasoning_content"),
      toolCallItem("call_1"),
    ),
    toolResults("call_1"),
    assistant(toolCallItem("call_2")),
    toolResults("call_2"),
  ];

  const [thought, unthought] = assistantMessages(
    await transformHistory(client, history),
  );
  expect(thought.reasoning_content).toBe(THINKING);
  expect(thought).not.toHaveProperty("reasoning");
  expect(toolCallIds(unthought)).toEqual(["call_2"]);
  expect(unthought.reasoning_content).toBe("");
  expect(unthought).not.toHaveProperty("reasoning");
});

test("replay sends an empty reasoning for a tool call without thinking", async () => {
  const client = chatClient();
  const history: UniMessage[] = [
    userText(),
    assistant(thinkingItem(THINKING, "reasoning"), toolCallItem("call_1")),
    toolResults("call_1"),
    assistant(toolCallItem("call_2")),
    toolResults("call_2"),
  ];

  const [thought, unthought] = assistantMessages(
    await transformHistory(client, history),
  );
  expect(thought.reasoning).toBe(THINKING);
  expect(thought).not.toHaveProperty("reasoning_content");
  expect(toolCallIds(unthought)).toEqual(["call_2"]);
  expect(unthought.reasoning).toBe("");
  expect(unthought).not.toHaveProperty("reasoning_content");
});

// A server that never produces a reasoning field never starts receiving one.
test("replay sends no reasoning field when no message ever thought", async () => {
  const client = chatClient();
  const history: UniMessage[] = [
    userText(),
    assistant(
      { type: "text", text: "Let me check that for you." },
      toolCallItem("call_1"),
    ),
    toolResults("call_1"),
  ];

  const [message] = assistantMessages(await transformHistory(client, history));
  expect(toolCallIds(message)).toEqual(["call_1"]);
  expect(message).not.toHaveProperty("reasoning_content");
  expect(message).not.toHaveProperty("reasoning");
});

// The empty field rides with a tool call only: a plain answer is replayed as it was.
test("replay sends no reasoning field for a message without tool calls", async () => {
  const client = chatClient();
  const history: UniMessage[] = [
    userText(),
    assistant(
      thinkingItem(THINKING, "reasoning_content"),
      toolCallItem("call_1"),
    ),
    toolResults("call_1"),
    assistant({ type: "text", text: "It is 20 degrees in Paris." }),
  ];

  const [, answer] = assistantMessages(await transformHistory(client, history));
  expect(answer.content).toEqual([
    { type: "text", text: "It is 20 degrees in Paris." },
  ]);
  expect(answer).not.toHaveProperty("reasoning_content");
  expect(answer).not.toHaveProperty("reasoning");
});

test("replay keeps each message on its own reasoning field", async () => {
  const client = chatClient();
  const history: UniMessage[] = [
    userText(),
    assistant(
      thinkingItem("First Paris.", "reasoning"),
      toolCallItem("call_1"),
    ),
    toolResults("call_1"),
    assistant(
      thinkingItem("Now London.", "reasoning_content"),
      toolCallItem("call_2"),
    ),
    toolResults("call_2"),
    assistant(toolCallItem("call_3")),
    toolResults("call_3"),
  ];

  const [first, second, third] = assistantMessages(
    await transformHistory(client, history),
  );
  // a message that thought still replays through the field its own item recorded
  expect(first.reasoning).toBe("First Paris.");
  expect(first).not.toHaveProperty("reasoning_content");
  expect(second.reasoning_content).toBe("Now London.");
  expect(second).not.toHaveProperty("reasoning");
  // the request as a whole produced both spellings, so the turn without thinking sends both
  expect(third.reasoning_content).toBe("");
  expect(third.reasoning).toBe("");
});

test("DeepSeek keeps the real reasoning item before the function call", async () => {
  const client = deepseekClient();
  const history: UniMessage[] = [
    userText(),
    assistant(thinkingItem(THINKING), toolCallItem("call_1")),
    toolResults("call_1"),
  ];

  const modelInput = await transformHistory(client, history);
  expect(inputItemTypes(modelInput)).toEqual([
    "message:user",
    "reasoning",
    "function_call",
    "function_call_output",
  ]);
  expect(modelInput[1]).toEqual({
    type: "reasoning",
    summary: [],
    content: [{ type: "reasoning_text", text: THINKING }],
  });
});

test("DeepSeek adds a reasoning item before a function call without thinking", async () => {
  const client = deepseekClient();
  const history: UniMessage[] = [
    userText(),
    assistant(toolCallItem("call_1")),
    toolResults("call_1"),
  ];

  const modelInput = await transformHistory(client, history);
  expect(inputItemTypes(modelInput)).toEqual([
    "message:user",
    "reasoning",
    "function_call",
    "function_call_output",
  ]);
  const placeholder = modelInput[1] as unknown as ReasoningInputItem;
  expect(placeholder.summary).toEqual([]);
  expect(placeholder.content[0].type).toBe("reasoning_text");
  // an empty reasoning_text is refused the same way the missing item is
  expect(placeholder.content[0].text).not.toBe("");
});

test("DeepSeek fills an empty thinking item with replayable text", async () => {
  // A thinking item whose text never arrived still has to reach the wire with text.
  const client = deepseekClient();
  const history: UniMessage[] = [
    userText(),
    assistant(thinkingItem(""), toolCallItem("call_1")),
    toolResults("call_1"),
  ];

  const modelInput = await transformHistory(client, history);
  expect(inputItemTypes(modelInput)).toEqual([
    "message:user",
    "reasoning",
    "function_call",
    "function_call_output",
  ]);
  const reasoning = modelInput[1] as unknown as ReasoningInputItem;
  expect(reasoning.content[0].text).not.toBe("");
});

test("DeepSeek adds one reasoning item for two function calls without thinking", async () => {
  const client = deepseekClient();
  const history: UniMessage[] = [
    userText(),
    assistant(toolCallItem("call_1"), toolCallItem("call_2")),
    toolResults("call_1", "call_2"),
  ];

  const modelInput = await transformHistory(client, history);
  expect(inputItemTypes(modelInput)).toEqual([
    "message:user",
    "reasoning",
    "function_call",
    "function_call",
    "function_call_output",
    "function_call_output",
  ]);
});
