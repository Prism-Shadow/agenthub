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
import { AutoLLMClient, UniMessage } from "../src";

interface MessageOrderCase {
  expectedClient: string;
  model: string;
  clientType?: string;
  protocol: "responses" | "messages" | "gemini" | "chat";
  expected: string[];
}

// A turn where the model thought, spoke, and then called a tool. Every protocol that can
// express the order has to keep it: an assistant message placed after the function call it
// preceded is what DeepSeek answers with "No tool output found for tool call".
const RESPONSES_ORDER = [
  "message:user",
  "reasoning",
  "message:assistant",
  "function_call",
  "function_call_output",
];
const MESSAGES_ORDER = [
  "user:text",
  "assistant:thinking,text,tool_use",
  "user:tool_result",
];
// the Interactions API sends every item as a step of its own kind, a thought first in its turn
const GEMINI_ORDER = [
  "user_input",
  "thought",
  "model_output",
  "function_call",
  "function_result",
];
// Chat Completions has no interleaving to keep: the text lands in content, the call in
// tool_calls of the same message, and the thinking in its own reasoning field.
const CHAT_ORDER = [
  "user:text",
  "assistant:text,tool_calls,thinking",
  "tool:call_1",
];

const MESSAGE_ORDER_CASES: MessageOrderCase[] = [
  {
    expectedClient: "GPT6Client",
    model: "gpt-5.6",
    protocol: "responses",
    expected: RESPONSES_ORDER,
  },
  {
    expectedClient: "OpenaiResponsesClient",
    model: "gpt-5.6",
    clientType: "openai-responses",
    protocol: "responses",
    expected: RESPONSES_ORDER,
  },
  {
    expectedClient: "DeepSeekV4Client",
    model: "deepseek-v4",
    clientType: "deepseek-v4",
    protocol: "responses",
    expected: RESPONSES_ORDER,
  },
  {
    expectedClient: "MiniMaxM3Client",
    model: "MiniMax-M3",
    clientType: "minimax-m3",
    protocol: "responses",
    expected: RESPONSES_ORDER,
  },
  {
    expectedClient: "Claude5Client",
    model: "claude-sonnet-5",
    protocol: "messages",
    expected: MESSAGES_ORDER,
  },
  {
    expectedClient: "AntMessagesClient",
    model: "claude-sonnet-5",
    clientType: "ant-messages",
    protocol: "messages",
    expected: MESSAGES_ORDER,
  },
  {
    expectedClient: "Gemini3_8Client",
    model: "gemini-3.8-flash",
    protocol: "gemini",
    expected: GEMINI_ORDER,
  },
  {
    expectedClient: "OpenaiChatClient",
    model: "gpt-5.6",
    clientType: "openai-chat",
    protocol: "chat",
    expected: CHAT_ORDER,
  },
  {
    expectedClient: "GLM5_3Client",
    model: "glm-5.3",
    protocol: "chat",
    expected: CHAT_ORDER,
  },
  {
    expectedClient: "KimiK3Client",
    model: "kimi-k3",
    protocol: "chat",
    expected: CHAT_ORDER,
  },
];

function messagesFor(): UniMessage[] {
  return [
    {
      role: "user",
      content_items: [
        { type: "text.done", text: "What is the weather in Paris?" },
      ],
    },
    {
      role: "assistant",
      content_items: [
        {
          type: "thinking.done",
          thinking: "I should call the tool.",
          fidelity: { signature: "sig-1" },
        },
        { type: "text.done", text: "Let me check that for you." },
        {
          type: "tool_call.done",
          name: "get_weather",
          arguments: { city: "Paris" },
          tool_call_id: "call_1",
        },
      ],
    },
    {
      role: "user",
      content_items: [
        {
          type: "tool_result.done",
          text: "20 degrees.",
          tool_call_id: "call_1",
        },
      ],
    },
  ];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function signature(testCase: MessageOrderCase, modelInput: any[]): string[] {
  if (testCase.protocol === "responses") {
    return modelInput.map((item) => {
      // every Responses client sends a turn as a typed message item, and an item carrying
      // no type at all is a message too; both are labelled by role, so one order fits
      // every client
      if (!item.type || item.type === "message") {
        return `message:${item.role}`;
      }

      return item.type;
    });
  }

  if (testCase.protocol === "messages") {
    return modelInput.map(
      (message) =>
        `${message.role}:` +
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        message.content.map((block: any) => block.type).join(","),
    );
  }

  if (testCase.protocol === "gemini") {
    return modelInput.map((step) => step.type);
  }

  return modelInput.map((message) => {
    if (message.role === "tool") {
      return `tool:${message.tool_call_id}`;
    }

    const kinds: string[] = [];
    if (message.content) kinds.push("text");
    if (message.tool_calls) kinds.push("tool_calls");
    if (message.reasoning_content || message.reasoning) kinds.push("thinking");
    return `${message.role}:${kinds.join(",")}`;
  });
}

interface RoutedClient {
  constructor: { name: string };
  transformUniMessageToModelInput(
    messages: UniMessage[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any[]> | any[];
}

function routedClient(model: string, clientType?: string): RoutedClient {
  const client = new AutoLLMClient({ model, apiKey: "test-key", clientType });
  return (client as unknown as { _client: RoutedClient })._client;
}

describe.each(MESSAGE_ORDER_CASES)(
  "Message transform order for $expectedClient",
  (testCase) => {
    test("keeps the order of the content items", async () => {
      const client = routedClient(testCase.model, testCase.clientType);
      expect(client.constructor.name).toBe(testCase.expectedClient);

      const modelInput =
        await client.transformUniMessageToModelInput(messagesFor());

      expect(signature(testCase, modelInput)).toEqual(testCase.expected);

      // every Responses, Chat Completions and Interactions client sends a text-only tool
      // result as a plain string rather than a one-part content list; the messages protocol
      // has no such position
      if (testCase.protocol === "responses") {
        expect(modelInput[4].output).toBe("20 degrees.");
      } else if (testCase.protocol === "chat") {
        expect(modelInput[2].content).toBe("20 degrees.");
      } else if (testCase.protocol === "gemini") {
        expect(modelInput[4].result).toBe("20 degrees.");
      }
    });
  },
);

describe("Message transform shape for Gemini3_8Client", () => {
  test("sends an image-only tool result without an empty text block", async () => {
    const client = routedClient("gemini-3.8-flash");
    expect(client.constructor.name).toBe("Gemini3_8Client");
    const messages = messagesFor();
    messages[2].content_items = [
      {
        type: "tool_result.done",
        text: "",
        images: ["data:image/png;base64,iVBORw0KGgo="],
        tool_call_id: "call_1",
      },
    ];

    const modelInput = await client.transformUniMessageToModelInput(messages);
    // an empty text block is rejected with a 400, while a result of images alone is accepted
    expect(modelInput[4].result).toEqual([
      { type: "image", data: "iVBORw0KGgo=", mime_type: "image/png" },
    ]);
  });
});

// The generic client and the three routed ones share the replayed shape, so the cases are
// the Responses rows of the order suite.
const RESPONSES_SHAPE_CASES = MESSAGE_ORDER_CASES.filter(
  (testCase) => testCase.protocol === "responses",
);

describe.each(RESPONSES_SHAPE_CASES)(
  "Message transform shape for $expectedClient",
  (testCase) => {
    test("replays every turn as a message item", async () => {
      const client = routedClient(testCase.model, testCase.clientType);
      expect(client.constructor.name).toBe(testCase.expectedClient);

      const modelInput = await client.transformUniMessageToModelInput([
        {
          role: "user",
          content_items: [{ type: "text.done", text: "Hello." }],
        },
        {
          role: "assistant",
          content_items: [{ type: "text.done", text: "Hi there." }],
        },
        {
          role: "user",
          content_items: [{ type: "text.done", text: "And now?" }],
        },
      ]);

      // every turn is a typed message item — the EasyInputMessage shape, which a vLLM-style
      // Responses server requires for the replayed assistant turn and takes for a user turn
      // too. Every client on this protocol emits input_text for a user part and output_text
      // for an assistant one.
      expect(modelInput).toEqual([
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Hello." }],
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Hi there." }],
        },
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "And now?" }],
        },
      ]);
      for (const item of modelInput) {
        expect(Object.keys(item).sort()).toEqual(["content", "role", "type"]);
      }
    });
  },
);
