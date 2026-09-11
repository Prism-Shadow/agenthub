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
  // Claude replays the signature as text, Gemini as the bytes it streamed
  thoughtSignature?: string | Buffer;
  // a text-only tool result goes out as a plain string rather than a one-part list
  bareTextToolResult?: boolean;
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
const GEMINI_ORDER = [
  "user:text",
  "model:thinking,text,function_call",
  "user:function_response",
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
    bareTextToolResult: true,
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
    thoughtSignature: Buffer.from("sig-1"),
  },
  {
    expectedClient: "OpenaiChatClient",
    model: "gpt-5.6",
    clientType: "openai-chat",
    protocol: "chat",
    expected: CHAT_ORDER,
    bareTextToolResult: true,
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
    bareTextToolResult: true,
  },
];

function messagesFor(testCase: MessageOrderCase): UniMessage[] {
  return [
    {
      role: "user",
      content_items: [{ type: "text", text: "What is the weather in Paris?" }],
    },
    {
      role: "assistant",
      content_items: [
        {
          type: "thinking",
          thinking: "I should call the tool.",
          fidelity: { signature: testCase.thoughtSignature ?? "sig-1" },
        },
        { type: "text", text: "Let me check that for you." },
        {
          type: "tool_call",
          name: "get_weather",
          arguments: { city: "Paris" },
          tool_call_id: "call_1",
        },
      ],
    },
    {
      role: "user",
      content_items: [
        { type: "tool_result", text: "20 degrees.", tool_call_id: "call_1" },
      ],
    },
  ];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function signature(testCase: MessageOrderCase, modelInput: any[]): string[] {
  if (testCase.protocol === "responses") {
    return modelInput.map((item) => item.type ?? `message:${item.role}`);
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
    return modelInput.map((content) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const kinds = content.parts.map((part: any) => {
        if (part.functionCall) return "function_call";
        if (part.functionResponse) return "function_response";
        if (part.thought) return "thinking";
        return "text";
      });
      return `${content.role}:${kinds.join(",")}`;
    });
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

describe.each(MESSAGE_ORDER_CASES)(
  "Message transform order for $expectedClient",
  (testCase) => {
    test("keeps the order of the content items", async () => {
      const client = new AutoLLMClient({
        model: testCase.model,
        apiKey: "test-key",
        clientType: testCase.clientType,
      });
      const routedClient = (
        client as unknown as {
          _client: {
            constructor: { name: string };
            transformUniMessageToModelInput(
              messages: UniMessage[],
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ): Promise<any[]> | any[];
          };
        }
      )._client;
      expect(routedClient.constructor.name).toBe(testCase.expectedClient);

      const modelInput = await routedClient.transformUniMessageToModelInput(
        messagesFor(testCase),
      );

      expect(signature(testCase, modelInput)).toEqual(testCase.expected);

      if (testCase.bareTextToolResult) {
        expect(
          testCase.protocol === "responses"
            ? modelInput[4].output
            : modelInput[2].content,
        ).toBe("20 degrees.");
      }
    });
  },
);
