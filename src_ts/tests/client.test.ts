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

import { AutoLLMClient } from "../src/autoClient";
import { listSupportedModels } from "../src/registry";
import { ThinkingLevel, UniMessage, UniConfig, UniEvent } from "../src/types";
import { beforeAll, expect, describe, test } from "@jest/globals";
import { Gaxios } from "gaxios";

const IMAGE =
  "https://sghimages.shobserver.com/img/catch/2022/01/22/c1ae0300-9402-4128-a7e6-1244d3874167.jpg";
const IMAGE_KEYWORDS = ["flower", "narcissus", "daffodil", "bloom"];

interface Model {
  name: string;
  supportTextGeneration: boolean;
  supportImageUnderstanding: boolean;
  supportImageGeneration: boolean;
  supportAudioGeneration: boolean;
  supportEmbedding: boolean;
  clientType?: string;
  baseUrl?: string;
  provider:
    | "official"
    | "bedrock"
    | "vertex"
    | "siliconflow"
    | "openrouter"
    | "modelverse"
    | "deepseek"
    | "zai"
    | "minimax";
}

const AVAILABLE_MODELS: Model[] = [];

if (process.env.GEMINI_API_KEY) {
  AVAILABLE_MODELS.push({
    name: "gemini-3.8-flash",
    supportTextGeneration: true,
    supportImageUnderstanding: true,
    supportImageGeneration: false,
    supportAudioGeneration: false,
    supportEmbedding: false,
    provider: "official",
  });

  AVAILABLE_MODELS.push({
    name: "gemini-3.1-flash-image",
    supportTextGeneration: false,
    supportImageUnderstanding: false,
    supportImageGeneration: true,
    supportAudioGeneration: false,
    supportEmbedding: false,
    provider: "official",
  });

  AVAILABLE_MODELS.push({
    name: "gemini-3.1-flash-tts-preview",
    supportTextGeneration: false,
    supportImageUnderstanding: false,
    supportImageGeneration: false,
    supportAudioGeneration: true,
    supportEmbedding: false,
    provider: "official",
  });

  AVAILABLE_MODELS.push({
    name: "gemini-embedding-2",
    supportTextGeneration: false,
    supportImageUnderstanding: false,
    supportImageGeneration: false,
    supportAudioGeneration: false,
    supportEmbedding: true,
    provider: "official",
  });
}

if (process.env.ANTHROPIC_API_KEY) {
  AVAILABLE_MODELS.push({
    name: "claude-sonnet-5",
    supportTextGeneration: true,
    supportImageUnderstanding: true,
    supportImageGeneration: false,
    supportAudioGeneration: false,
    supportEmbedding: false,
    provider: "official",
  });
}

if (process.env.OPENAI_API_KEY) {
  AVAILABLE_MODELS.push({
    name: "gpt-5.6-luna",
    supportTextGeneration: true,
    supportImageUnderstanding: true,
    supportImageGeneration: false,
    supportAudioGeneration: false,
    supportEmbedding: false,
    provider: "official",
  });

  AVAILABLE_MODELS.push({
    name: "text-embedding-3-large",
    supportTextGeneration: false,
    supportImageUnderstanding: false,
    supportImageGeneration: false,
    supportAudioGeneration: false,
    supportEmbedding: true,
    clientType: "openai-embedding",
    provider: "official",
  });
}

// per-protocol base URLs for the generic protocol clients (Z.AI entries use the
// GLM Coding Plan base URLs)
const PROTOCOL_MODES = ["openai-chat", "openai-responses", "ant-messages"];
const PROTOCOL_BASE_URLS: { [provider: string]: { [mode: string]: string } } = {
  deepseek: {
    "openai-chat": "https://api.deepseek.com",
    "openai-responses": "https://api.deepseek.com",
    "ant-messages": "https://api.deepseek.com/anthropic",
  },
  zai: {
    "openai-chat": "https://api.z.ai/api/coding/paas/v4",
    "openai-responses": "https://api.z.ai/api/v1",
    "ant-messages": "https://api.z.ai/api/anthropic",
  },
  minimax: {
    "openai-chat": "https://api.minimax.io/v1",
    "openai-responses": "https://api.minimax.io/v1",
    "ant-messages": "https://api.minimax.io/anthropic",
  },
  openrouter: {
    "openai-chat": "https://openrouter.ai/api/v1",
    "openai-responses": "https://openrouter.ai/api/v1",
    "ant-messages": "https://openrouter.ai/api",
  },
};

if (process.env.ZAI_API_KEY) {
  AVAILABLE_MODELS.push({
    name: "glm-5.3-flash",
    supportTextGeneration: true,
    supportImageUnderstanding: true,
    supportImageGeneration: false,
    supportAudioGeneration: false,
    supportEmbedding: false,
    provider: "official",
  });
}

if (process.env.MOONSHOT_API_KEY) {
  AVAILABLE_MODELS.push({
    name: "kimi-k3",
    supportTextGeneration: true,
    supportImageUnderstanding: true,
    supportImageGeneration: false,
    supportAudioGeneration: false,
    supportEmbedding: false,
    provider: "official",
  });
}

if (process.env.MINIMAX_API_KEY) {
  AVAILABLE_MODELS.push({
    name: "MiniMax-M3",
    supportTextGeneration: true,
    supportImageUnderstanding: true,
    supportImageGeneration: false,
    supportAudioGeneration: false,
    supportEmbedding: false,
    clientType: "minimax-m3",
    provider: "official",
  });
}

if (process.env.DEEPSEEK_API_KEY) {
  AVAILABLE_MODELS.push({
    name: "deepseek-v4-flash-vision-exp",
    supportTextGeneration: true,
    supportImageUnderstanding: true,
    supportImageGeneration: false,
    supportAudioGeneration: false,
    supportEmbedding: false,
    provider: "official",
  });
  for (const mode of PROTOCOL_MODES) {
    AVAILABLE_MODELS.push({
      name: "deepseek-v4-flash",
      supportTextGeneration: true,
      supportImageUnderstanding: false,
      supportImageGeneration: false,
      supportAudioGeneration: false,
      supportEmbedding: false,
      provider: "deepseek",
      clientType: mode,
      baseUrl: PROTOCOL_BASE_URLS.deepseek[mode],
    });
  }
}

if (process.env.BEDROCK_API_KEY) {
  AVAILABLE_MODELS.push({
    name: "global.anthropic.claude-sonnet-4-6",
    supportTextGeneration: true,
    supportImageUnderstanding: true,
    supportImageGeneration: false,
    supportAudioGeneration: false,
    supportEmbedding: false,
    provider: "bedrock",
  });
}

if (process.env.VERTEX_API_KEY) {
  AVAILABLE_MODELS.push({
    name: "gemini-3.8-flash",
    supportTextGeneration: true,
    supportImageUnderstanding: true,
    supportImageGeneration: false,
    supportAudioGeneration: false,
    supportEmbedding: false,
    provider: "vertex",
  });

  AVAILABLE_MODELS.push({
    name: "gemini-3.1-flash-image",
    supportTextGeneration: false,
    supportImageUnderstanding: false,
    supportImageGeneration: true,
    supportAudioGeneration: false,
    supportEmbedding: false,
    provider: "vertex",
  });

  AVAILABLE_MODELS.push({
    name: "gemini-3.1-flash-tts-preview",
    supportTextGeneration: false,
    supportImageUnderstanding: false,
    supportImageGeneration: false,
    supportAudioGeneration: true,
    supportEmbedding: false,
    provider: "vertex",
  });
}

const RUN_SLOW_TEST = process.env.RUN_SLOW_TEST === "1";

if (process.env.ZAI_API_KEY && RUN_SLOW_TEST) {
  for (const mode of PROTOCOL_MODES) {
    // Z.AI's Anthropic-compatible gateway defaults to thinking disabled when a request
    // carries no thinking config, which glm-5.3 rejects because it cannot disable
    // thinking; that protocol stays on glm-5.2
    AVAILABLE_MODELS.push({
      name: mode === "ant-messages" ? "glm-5.2" : "glm-5.3",
      supportTextGeneration: true,
      supportImageUnderstanding: false,
      supportImageGeneration: false,
      supportAudioGeneration: false,
      supportEmbedding: false,
      provider: "zai",
      clientType: mode,
      baseUrl: PROTOCOL_BASE_URLS.zai[mode],
    });
  }
}

if (process.env.MINIMAX_API_KEY && RUN_SLOW_TEST) {
  for (const mode of PROTOCOL_MODES) {
    AVAILABLE_MODELS.push({
      name: "MiniMax-M3",
      supportTextGeneration: true,
      supportImageUnderstanding: true,
      supportImageGeneration: false,
      supportAudioGeneration: false,
      supportEmbedding: false,
      provider: "minimax",
      clientType: mode,
      baseUrl: PROTOCOL_BASE_URLS.minimax[mode],
    });
  }
}

if (process.env.OPENROUTER_API_KEY && RUN_SLOW_TEST) {
  for (const mode of PROTOCOL_MODES) {
    AVAILABLE_MODELS.push({
      name: "openai/gpt-5.6-luna",
      supportTextGeneration: true,
      supportImageUnderstanding: true,
      supportImageGeneration: false,
      supportAudioGeneration: false,
      supportEmbedding: false,
      provider: "openrouter",
      clientType: mode,
      baseUrl: PROTOCOL_BASE_URLS.openrouter[mode],
    });
  }
  AVAILABLE_MODELS.push({
    name: "z-ai/glm-5.3",
    supportTextGeneration: true,
    supportImageUnderstanding: false,
    supportImageGeneration: false,
    supportAudioGeneration: false,
    supportEmbedding: false,
    provider: "openrouter",
  });
  AVAILABLE_MODELS.push({
    name: "qwen/qwen3.6-35b-a3b",
    supportTextGeneration: true,
    supportImageUnderstanding: true,
    supportImageGeneration: false,
    supportAudioGeneration: false,
    supportEmbedding: false,
    clientType: "openai-responses",
    provider: "openrouter",
  });
  AVAILABLE_MODELS.push({
    name: "qwen/qwen3-embedding-4b",
    supportTextGeneration: false,
    supportImageUnderstanding: false,
    supportImageGeneration: false,
    supportAudioGeneration: false,
    supportEmbedding: true,
    clientType: "openai-embedding",
    provider: "openrouter",
  });
  AVAILABLE_MODELS.push({
    name: "moonshotai/kimi-k3",
    supportTextGeneration: true,
    supportImageUnderstanding: true,
    supportImageGeneration: false,
    supportAudioGeneration: false,
    supportEmbedding: false,
    provider: "openrouter",
  });
}

if (process.env.SILICONFLOW_API_KEY && RUN_SLOW_TEST) {
  AVAILABLE_MODELS.push({
    name: "zai-org/GLM-5.2",
    supportTextGeneration: true,
    supportImageUnderstanding: false,
    supportImageGeneration: false,
    supportAudioGeneration: false,
    supportEmbedding: false,
    provider: "siliconflow",
  });
  AVAILABLE_MODELS.push({
    name: "Qwen/Qwen3.6-35B-A3B",
    supportTextGeneration: true,
    supportImageUnderstanding: true,
    supportImageGeneration: false,
    supportAudioGeneration: false,
    supportEmbedding: false,
    clientType: "openai-chat",
    provider: "siliconflow",
  });
  AVAILABLE_MODELS.push({
    name: "Pro/moonshotai/Kimi-K2.6",
    supportTextGeneration: true,
    supportImageUnderstanding: true,
    supportImageGeneration: false,
    supportAudioGeneration: false,
    supportEmbedding: false,
    provider: "siliconflow",
  });
  AVAILABLE_MODELS.push({
    name: "Qwen/Qwen3-Embedding-8B",
    supportTextGeneration: false,
    supportImageUnderstanding: false,
    supportImageGeneration: false,
    supportAudioGeneration: false,
    supportEmbedding: true,
    clientType: "openai-embedding",
    provider: "siliconflow",
  });
}

if (process.env.MODELVERSE_API_KEY && RUN_SLOW_TEST) {
  AVAILABLE_MODELS.push({
    name: "claude-sonnet-4-6",
    supportTextGeneration: true,
    supportImageUnderstanding: true,
    supportImageGeneration: false,
    supportAudioGeneration: false,
    supportEmbedding: false,
    provider: "modelverse",
    baseUrl: "https://api.modelverse.cn/",
  });
  AVAILABLE_MODELS.push({
    name: "gpt-5.5",
    supportTextGeneration: true,
    supportImageUnderstanding: true,
    supportImageGeneration: false,
    supportAudioGeneration: false,
    supportEmbedding: false,
    provider: "modelverse",
  });
}

const PROVIDER_API_KEY_ENVS: { [provider: string]: string } = {
  bedrock: "BEDROCK_API_KEY",
  vertex: "VERTEX_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  siliconflow: "SILICONFLOW_API_KEY",
  modelverse: "MODELVERSE_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  zai: "ZAI_API_KEY",
  minimax: "MINIMAX_API_KEY",
};

const PROVIDER_BASE_URLS: { [provider: string]: string } = {
  bedrock: "bedrock://us-east-1",
  openrouter: "https://openrouter.ai/api/v1",
  siliconflow: "https://api.siliconflow.cn/v1",
  modelverse: "https://api.modelverse.cn/v1",
};

function createClient(model: Model): AutoLLMClient {
  const keyEnv = PROVIDER_API_KEY_ENVS[model.provider];
  const apiKey = keyEnv ? process.env[keyEnv] : undefined;
  const baseUrl = model.baseUrl || PROVIDER_BASE_URLS[model.provider];

  return new AutoLLMClient({
    model: model.name,
    apiKey,
    baseUrl,
    clientType: model.clientType,
  });
}

function checkEventIntegrity(event: UniEvent): void {
  expect(event).toHaveProperty("role");
  expect(event).toHaveProperty("event_type");
  expect(event).toHaveProperty("usage_metadata");
  expect(event).toHaveProperty("finish_reason");

  expect(["user", "assistant"]).toContain(event.role);
  expect(["start", "delta", "stop"]).toContain(event.event_type);
  expect(["stop", "length", "tool_call", "unknown", null]).toContain(
    event.finish_reason,
  );
  expect(event).toHaveProperty("created_at");
  expect(event.created_at).toBeGreaterThan(0);

  for (const item of event.content_items) {
    if (item.type === "text") {
      expect(typeof item.text).toBe("string");
    } else if (item.type === "image_url") {
      expect(typeof item.image_url).toBe("string");
    } else if (item.type === "inline_data") {
      expect(Buffer.isBuffer(item.data)).toBe(true);
      expect(item.data.length).toBeGreaterThan(0);
      expect(typeof item.mime_type).toBe("string");
    } else if (item.type === "thinking") {
      expect(typeof item.thinking).toBe("string");
    } else if (item.type === "inline_thinking") {
      expect(Buffer.isBuffer(item.data)).toBe(true);
      expect(item.data.length).toBeGreaterThan(0);
      expect(typeof item.mime_type).toBe("string");
    } else if (item.type === "tool_call") {
      expect(typeof item.name).toBe("string");
      expect(typeof item.arguments).toBe("object");
      expect(typeof item.tool_call_id).toBe("string");
    } else if (item.type === "partial_tool_call") {
      expect(typeof item.name).toBe("string");
      expect(typeof item.arguments).toBe("string");
      expect(typeof item.tool_call_id).toBe("string");
    } else if (item.type === "tool_result") {
      expect(typeof item.text).toBe("string");
      expect(typeof item.tool_call_id).toBe("string");
    }
  }

  if (event.usage_metadata) {
    expect(event.usage_metadata).toHaveProperty("cached_tokens");
    expect(event.usage_metadata).toHaveProperty("prompt_tokens");
    expect(event.usage_metadata).toHaveProperty("thoughts_tokens");
    expect(event.usage_metadata).toHaveProperty("response_tokens");

    if (event.usage_metadata.cached_tokens !== null) {
      expect(event.usage_metadata.cached_tokens).toBeGreaterThanOrEqual(0);
    }
    if (event.usage_metadata.prompt_tokens !== null) {
      expect(event.usage_metadata.prompt_tokens).toBeGreaterThanOrEqual(0);
    }
    if (event.usage_metadata.thoughts_tokens !== null) {
      expect(event.usage_metadata.thoughts_tokens).toBeGreaterThanOrEqual(0);
    }
    if (event.usage_metadata.response_tokens !== null) {
      expect(event.usage_metadata.response_tokens).toBeGreaterThanOrEqual(0);
    }
  }
}

const MODEL_CASES = AVAILABLE_MODELS.map((m): [string, Model] => [
  m.clientType
    ? `${m.name}:${m.provider}:${m.clientType}`
    : `${m.name}:${m.provider}`,
  m,
]);

/**
 * Declare one check across every available model.
 *
 * Each check becomes its own describe block, and jest-circus runs describe blocks one
 * after another, so a single model never has two checks in flight — providers rate-limit
 * per client. Inside a block the models run concurrently, which is the wall-clock saving.
 */
// Providers throttle live E2E traffic; a 429 says "later", not "broken", so retry it
// rather than failing the run. Every other error propagates on the first attempt.
// mirrors the pytest job's --reruns 5 --reruns-delay 30
const RATE_LIMIT_RETRIES = 5;
const RATE_LIMIT_RETRY_DELAY_MS = 30_000;

function isRateLimited(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  const message = (error as { message?: string })?.message ?? "";
  return status === 429 || /rate limit|429/i.test(message);
}

async function withRateLimitRetry(run: () => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await run();
      return;
    } catch (error) {
      if (attempt >= RATE_LIMIT_RETRIES || !isRateLimited(error)) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS),
      );
    }
  }
}

function modelTest(
  name: string,
  // ahead of the body so Prettier keeps the body hugged against the call
  timeout: number,
  body: (model: Model) => void | Promise<void>,
): void {
  // the deadline covers every retried attempt plus the waits between them
  const retryBudget =
    RATE_LIMIT_RETRIES * (timeout + RATE_LIMIT_RETRY_DELAY_MS);
  describe(name, () => {
    test.concurrent.each(MODEL_CASES)(
      "%s",
      async (_caseName, model) => {
        await withRateLimitRetry(async () => {
          await body(model);
        });
      },
      timeout + retryBudget,
    );
  });
}

if (AVAILABLE_MODELS.length > 0) {
  describe("Client tests", () => {
    beforeAll(async () => {
      // gaxios, the transport behind Vertex service-account auth, `import()`s node-fetch
      // on its first request and caches it on the class. Jest keeps one
      // `isInsideTestCode` flag for the whole runtime and clears it the moment any
      // concurrent sibling finishes, after which a dynamic import throws
      // "trying to `import` a file outside of the scope of the test code". Priming the
      // cache from a hook, where the flag is set, keeps that import out of the tests.
      await new Gaxios()
        .request({ url: "http://127.0.0.1:1/" })
        .catch(() => {});
    });

    modelTest("should stream basic response", 60000, async (model) => {
      if (!model.supportTextGeneration) {
        return;
      }
      const client = createClient(model);
      const messages: UniMessage[] = [
        {
          role: "user",
          content_items: [{ type: "text", text: "What is 2+3?" }],
        },
      ];
      const config: UniConfig = {};

      let text = "";
      for await (const event of client.streamingResponse({
        messages,
        config,
      })) {
        checkEventIntegrity(event);
        for (const item of event.content_items) {
          if (item.type === "text") {
            text += item.text;
          }
        }
      }

      expect(text).toContain("5");
    });

    modelTest(
      "should stream response with all parameters",
      60000,
      async (model) => {
        if (!model.supportTextGeneration) {
          return;
        }
        const client = createClient(model);
        const messages: UniMessage[] = [
          {
            role: "user",
            content_items: [{ type: "text", text: "What is 2+3?" }],
          },
        ];
        const config: UniConfig = {
          max_tokens: 8192,
          thinking_summary: true,
          thinking_level: ThinkingLevel.LOW,
        };

        let text = "";
        for await (const event of client.streamingResponse({
          messages,
          config,
        })) {
          checkEventIntegrity(event);
          for (const item of event.content_items) {
            if (item.type === "text") {
              text += item.text;
            }
          }
        }

        expect(text).toContain("5");
      },
    );

    modelTest("should handle stateful streaming", 60000, async (model) => {
      if (!model.supportTextGeneration) {
        return;
      }
      const client = createClient(model);
      const config: UniConfig = {};

      const message1: UniMessage = {
        role: "user",
        content_items: [{ type: "text", text: "My name is Alice" }],
      };
      for await (const event of client.streamingResponseStateful({
        message: message1,
        config,
      })) {
        checkEventIntegrity(event);
      }

      expect(client.getHistory().length).toBe(2);

      const message2: UniMessage = {
        role: "user",
        content_items: [{ type: "text", text: "What is my name?" }],
      };
      let text = "";
      for await (const event of client.streamingResponseStateful({
        message: message2,
        config,
      })) {
        checkEventIntegrity(event);
        for (const item of event.content_items) {
          if (item.type === "text") {
            text += item.text;
          }
        }
      }

      expect(text.toLowerCase()).toContain("alice");
      expect(client.getHistory().length).toBe(4);
    });

    modelTest("should set history", 5000, (model) => {
      const client = createClient(model);
      const newHistory: UniMessage[] = [
        { role: "user", content_items: [{ type: "text", text: "Hi" }] },
        {
          role: "assistant",
          content_items: [{ type: "text", text: "Hello!" }],
        },
      ];

      client.setHistory(newHistory);
      expect(client.getHistory()).toEqual(newHistory);

      // Mutating the original array must not affect the stored history
      newHistory.splice(0);
      expect(client.getHistory().length).toBe(2);
    });

    modelTest("should clear history", 5000, async (model) => {
      const client = createClient(model);
      const newHistory: UniMessage[] = [
        { role: "user", content_items: [{ type: "text", text: "Hi" }] },
        {
          role: "assistant",
          content_items: [{ type: "text", text: "Hello!" }],
        },
      ];

      client.setHistory(newHistory);
      expect(client.getHistory()).toEqual(newHistory);

      client.clearHistory();
      expect(client.getHistory().length).toBe(0);
    });

    modelTest("should concatenate events to message", 60000, async (model) => {
      if (!model.supportTextGeneration) {
        return;
      }

      const client = createClient(model);
      const messages: UniMessage[] = [
        {
          role: "user",
          content_items: [
            {
              type: "text",
              text: "Say 'The quick brown fox jumps over the lazy dog.'",
            },
          ],
        },
      ];
      const config: UniConfig = {};

      const events: UniEvent[] = [];
      let text = "";
      for await (const event of client.streamingResponse({
        messages,
        config,
      })) {
        events.push(event);
        for (const item of event.content_items) {
          if (item.type === "text") {
            text += item.text;
          }
        }
      }

      const message = client.concatUniEventsToUniMessage(events);
      expect(message.role).toBe("assistant");
      const allText = message.content_items
        .filter((item) => item.type === "text")
        .map((item) => (item as { type: "text"; text: string }).text)
        .join("");
      expect(allText).toBe(text);
    });

    modelTest("should handle tool use", 60000, async (model) => {
      if (!model.supportTextGeneration) {
        return;
      }
      const client = createClient(model);

      const weatherTool = {
        name: "get_weather",
        description: "Get the current weather in a given location",
        parameters: {
          type: "object",
          properties: {
            location: {
              type: "string",
              description: "The city name, e.g. San Francisco",
            },
          },
          required: ["location"],
        },
      };

      const config: UniConfig = { tools: [weatherTool] };
      let toolCallId: string | undefined;
      const partialToolCallData: {
        name?: string;
        arguments?: string;
        tool_call_id?: string;
      } = {};
      let toolName: string | undefined;
      let toolArguments: Record<string, unknown> | undefined;

      const message1: UniMessage = {
        role: "user",
        content_items: [
          { type: "text", text: "What is the weather in San Francisco?" },
        ],
      };
      for await (const event of client.streamingResponseStateful({
        message: message1,
        config,
      })) {
        checkEventIntegrity(event);
        for (const item of event.content_items) {
          if (item.type === "partial_tool_call") {
            if (!partialToolCallData.name) {
              partialToolCallData.name = item.name;
              partialToolCallData.arguments = item.arguments;
              partialToolCallData.tool_call_id = item.tool_call_id;
            } else {
              partialToolCallData.arguments += item.arguments;
            }
          } else if (item.type === "tool_call") {
            toolName = item.name;
            toolArguments = item.arguments;
            toolCallId = item.tool_call_id;
          }
        }
      }

      expect(toolName).toBe(weatherTool.name);
      expect(toolArguments).toHaveProperty("location");
      expect(toolCallId).toBeDefined();
      expect(partialToolCallData.name).toBe(toolName);
      expect(partialToolCallData.tool_call_id).toBe(toolCallId);
      if (partialToolCallData.arguments && toolArguments) {
        expect(JSON.parse(partialToolCallData.arguments)).toEqual(
          toolArguments,
        );
      }

      const message2: UniMessage = {
        role: "user",
        content_items: [
          {
            type: "tool_result",
            text: "It's 20 degrees in San Francisco.",
            tool_call_id: toolCallId || "",
          },
        ],
      };
      let text = "";
      for await (const event of client.streamingResponseStateful({
        message: message2,
        config,
      })) {
        checkEventIntegrity(event);
        for (const item of event.content_items) {
          if (item.type === "text") {
            text += item.text;
          }
        }
      }

      expect(text).toContain("20");
    });

    // A user message mixing a tool result with follow-up text: an agent resending an
    // interrupted turn's tool output together with the user's next prompt. Vertex AI
    // rejects a Gemini content that mixes functionResponse parts with any other kind
    // (HTTP 400 "Requests ending with a model turn are not supported"), so the Gemini
    // client splits them into separate contents; the model must still see both halves.
    modelTest(
      "should handle tool result mixed with text",
      60000,
      async (model) => {
        if (!model.supportTextGeneration) {
          return;
        }
        const client = createClient(model);

        const weatherTool = {
          name: "get_weather",
          description: "Get the current weather in a given location",
          parameters: {
            type: "object",
            properties: {
              location: {
                type: "string",
                description: "The city name, e.g. San Francisco",
              },
            },
            required: ["location"],
          },
        };

        const config: UniConfig = { tools: [weatherTool] };
        let toolCallId: string | undefined;

        const message1: UniMessage = {
          role: "user",
          content_items: [
            { type: "text", text: "What is the weather in San Francisco?" },
          ],
        };
        for await (const event of client.streamingResponseStateful({
          message: message1,
          config,
        })) {
          checkEventIntegrity(event);
          for (const item of event.content_items) {
            if (item.type === "tool_call") {
              toolCallId = item.tool_call_id;
            }
          }
        }
        expect(toolCallId).toBeDefined();

        const message2: UniMessage = {
          role: "user",
          content_items: [
            {
              type: "tool_result",
              text: "It's 20 degrees in San Francisco.",
              tool_call_id: toolCallId || "",
            },
            {
              type: "text",
              text: "Answer with the temperature, and end your reply with the exact word BANANA.",
            },
          ],
        };
        let text = "";
        for await (const event of client.streamingResponseStateful({
          message: message2,
          config,
        })) {
          checkEventIntegrity(event);
          for (const item of event.content_items) {
            if (item.type === "text") {
              text += item.text;
            }
          }
        }

        // "20" proves the tool result reached the model; "BANANA" proves the text
        // riding in the same universal message reached it too.
        expect(text).toContain("20");
        expect(text.toUpperCase()).toContain("BANANA");
      },
    );

    modelTest("should handle system prompt", 60000, async (model) => {
      if (!model.supportTextGeneration) {
        return;
      }
      const client = createClient(model);
      const messages: UniMessage[] = [
        {
          role: "user",
          content_items: [{ type: "text", text: "Hello" }],
        },
      ];
      const config: UniConfig = {
        system_prompt:
          "You are a kitten. Every reply MUST contain the exact word 'meow' — " +
          "never a variant like 'mreow' or a *purrs* action instead.",
      };

      let text = "";
      for await (const event of client.streamingResponse({
        messages,
        config,
      })) {
        checkEventIntegrity(event);
        for (const item of event.content_items) {
          if (item.type === "text") {
            text += item.text;
          }
        }
      }

      expect(text.toLowerCase()).toContain("meow");
    });

    modelTest("should handle image understanding", 60000, async (model) => {
      if (!model.supportImageUnderstanding) {
        return;
      }

      const client = createClient(model);
      const config: UniConfig = {};
      const messages: UniMessage[] = [
        {
          role: "user",
          content_items: [
            {
              type: "text",
              text: "What's in this image? Describe it briefly.",
            },
            { type: "image_url", image_url: IMAGE },
          ],
        },
      ];

      let text = "";
      for await (const event of client.streamingResponse({
        messages,
        config,
      })) {
        checkEventIntegrity(event);
        for (const item of event.content_items) {
          if (item.type === "text") {
            text += item.text;
          }
        }
      }

      expect(
        IMAGE_KEYWORDS.some((keyword) => text.toLowerCase().includes(keyword)),
      ).toBe(true);
    });

    modelTest(
      "should handle base64 encoded image understanding",
      60000,
      async (model) => {
        if (!model.supportImageUnderstanding) {
          return;
        }

        const client = createClient(model);
        const config: UniConfig = {};

        const mimeType = "image/jpeg";
        const response = await fetch(IMAGE);
        const imageBuffer = await response.arrayBuffer();
        const base64Image = Buffer.from(imageBuffer).toString("base64");

        const dataUri = `data:${mimeType};base64,${base64Image}`;

        const messages: UniMessage[] = [
          {
            role: "user",
            content_items: [
              {
                type: "text",
                text: "What's in this image? Describe it briefly.",
              },
              { type: "image_url", image_url: dataUri },
            ],
          },
        ];

        let text = "";
        for await (const event of client.streamingResponse({
          messages,
          config,
        })) {
          checkEventIntegrity(event);
          for (const item of event.content_items) {
            if (item.type === "text") {
              text += item.text;
            }
          }
        }

        expect(
          IMAGE_KEYWORDS.some((keyword) =>
            text.toLowerCase().includes(keyword),
          ),
        ).toBe(true);
      },
    );

    modelTest("should handle tool result with image", 60000, async (model) => {
      if (!model.supportImageUnderstanding) {
        return;
      }

      const client = createClient(model);

      const imageTool = {
        name: "get_image",
        description: "Get an image URL",
        parameters: {
          type: "object",
          properties: {
            seed: {
              type: "integer",
              description: "The random seed to retrieve the image.",
            },
          },
          required: ["seed"],
        },
      };

      const config: UniConfig = { tools: [imageTool] };
      let toolCallId: string | undefined;
      let toolName: string | undefined;

      // Prescriptive on purpose: this test covers a tool *result* carrying an image, so
      // reaching that state is setup. Natural tool selection is covered by the tool-use test.
      const toolPrompt =
        "Call get_image exactly once with seed 42. Make that function call your only action " +
        "this turn, then describe the returned image briefly.";
      const message1: UniMessage = {
        role: "user",
        content_items: [{ type: "text", text: toolPrompt }],
      };
      for await (const event of client.streamingResponseStateful({
        message: message1,
        config,
      })) {
        checkEventIntegrity(event);
        for (const item of event.content_items) {
          if (item.type === "tool_call") {
            toolName = item.name;
            toolCallId = item.tool_call_id;
          }
        }
      }

      expect(toolName).toBe(imageTool.name);
      expect(toolCallId).toBeDefined();

      const message2: UniMessage = {
        role: "user",
        content_items: [
          {
            type: "tool_result",
            text: "Here is the result image:",
            images: [IMAGE],
            tool_call_id: toolCallId || "",
          },
        ],
      };
      let text = "";
      for await (const event of client.streamingResponseStateful({
        message: message2,
        config,
      })) {
        checkEventIntegrity(event);
        for (const item of event.content_items) {
          if (item.type === "text") {
            text += item.text;
          }
        }
      }

      expect(
        IMAGE_KEYWORDS.some((keyword) => text.toLowerCase().includes(keyword)),
      ).toBe(true);
    });

    modelTest("should handle image generation", 180000, async (model) => {
      if (!model.supportImageGeneration) {
        return;
      }
      const client = createClient(model);
      const config: UniConfig = {
        image_config: { aspect_ratio: "1:1", image_size: "1K" },
      };
      const messages: UniMessage[] = [
        {
          role: "user",
          content_items: [
            {
              type: "text",
              text: "Generate a cozy watercolor illustration of two white flowers with raindrops.",
            },
          ],
        },
      ];

      const inlineItems: { data: Buffer; mime_type: string }[] = [];
      for await (const event of client.streamingResponse({
        messages,
        config,
      })) {
        checkEventIntegrity(event);
        for (const item of event.content_items) {
          if (item.type === "inline_data") {
            inlineItems.push(item);
          }
        }
      }

      expect(inlineItems.length).toBeGreaterThan(0);
      expect(
        inlineItems.some((item) => item.mime_type.startsWith("image/")),
      ).toBe(true);
      expect(inlineItems.every((item) => item.data.length > 0)).toBe(true);
    });

    modelTest("should handle tts generation", 180000, async (model) => {
      if (!model.supportAudioGeneration) {
        return;
      }

      const client = createClient(model);
      const config: UniConfig = {
        tts_config: [{ voice: "Kore" }],
      };
      const messages: UniMessage[] = [
        {
          role: "user",
          content_items: [
            {
              type: "text",
              text: "Say cheerfully: Have a wonderful day!",
            },
          ],
        },
      ];

      const inlineItems: { data: Buffer; mime_type: string }[] = [];
      for await (const event of client.streamingResponse({
        messages,
        config,
      })) {
        checkEventIntegrity(event);
        for (const item of event.content_items) {
          if (item.type === "inline_data") {
            inlineItems.push(item);
          }
        }
      }

      expect(inlineItems.length).toBeGreaterThan(0);
      expect(
        inlineItems.some(
          (item) =>
            item.mime_type.startsWith("audio/") ||
            item.mime_type === "application/octet-stream",
        ),
      ).toBe(true);
      expect(inlineItems.every((item) => item.data.length > 0)).toBe(true);
    });

    modelTest("should stream text embeddings", 60000, async (model) => {
      if (!model.supportEmbedding) {
        return;
      }

      const client = createClient(model);
      const messages = [
        {
          role: "user" as const,
          content_items: [{ type: "text" as const, text: "Hello world" }],
        },
        {
          role: "user" as const,
          content_items: [
            { type: "text" as const, text: "Goodbye " },
            { type: "text" as const, text: "world" },
          ],
        },
      ];

      const events: UniEvent[] = [];
      for await (const event of client.streamingResponse({
        messages,
        config: { embedding_config: { dimensions: 768 } },
      })) {
        checkEventIntegrity(event);
        events.push(event);
      }

      const embeddingItems = events.flatMap((event) =>
        event.content_items.filter((item) => item.type === "embedding"),
      );
      expect(embeddingItems.length).toBe(2);
      for (const item of embeddingItems) {
        expect(item.embedding.length).toBe(768);
        expect(item.embedding.every((v) => typeof v === "number")).toBe(true);
      }
    });
  });
}

test("should reject unknown model", () => {
  expect(() => new AutoLLMClient({ model: "unknown-model" })).toThrow(
    "not supported",
  );
});

test("should list supported model entries", () => {
  const entries = listSupportedModels();
  const kimi = entries.find((entry) => entry.model === "kimi-k3");
  expect(kimi).toBeDefined();
  expect(kimi?.base_url).toBe("https://api.moonshot.cn/v1");
  expect(kimi?.client).toBe("kimi-k3");
  expect(kimi?.context_window).toBe(1048576);
  expect(kimi?.input_modalities).toEqual(["Text", "Image"]);
  expect(kimi?.output_modalities).toEqual(["Text"]);
  // stored in USD (official CNY prices pre-converted at 7 CNY/USD)
  expect(kimi?.pricing).toEqual({
    currency: "USD",
    prompt_tokens: 2.857143,
    thoughts_tokens: 14.285714,
    response_tokens: 14.285714,
    cached_tokens: 0.285714,
  });

  // Pricing is always the list price: Google's launch discount on the three Gemini flash
  // rows is not recorded here, so the catalog rate is what every entry reports.
  for (const model of [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
  ]) {
    const gemini = entries.find((entry) => entry.model === model);
    expect(gemini?.client).toBe("gemini-3.8");
    expect([
      gemini?.pricing?.prompt_tokens,
      gemini?.pricing?.response_tokens,
      gemini?.pricing?.cached_tokens,
    ]).toEqual([1.5, 7.5, 0.15]);
  }

  const kimiCny = listSupportedModels("CNY").find(
    (entry) => entry.model === "kimi-k3",
  );
  expect(kimiCny?.pricing?.currency).toBe("CNY");
  expect(kimiCny?.pricing?.prompt_tokens).toBeCloseTo(20.0, 3);
  expect(kimiCny?.pricing?.thoughts_tokens).toBeCloseTo(100.0, 3);
  expect(kimiCny?.pricing?.response_tokens).toBeCloseTo(100.0, 3);
  expect(kimiCny?.pricing?.cached_tokens).toBeCloseTo(2.0, 3);

  const glm52 = entries.find((entry) => entry.model === "z-ai/glm-5.2");
  expect(glm52?.base_url).toBe("https://openrouter.ai/api/v1");
  expect(glm52?.client).toBe("glm-5.2");

  for (const entry of entries) {
    expect(entry.input_modalities.length).toBeGreaterThan(0);
    expect(entry.output_modalities.length).toBeGreaterThan(0);
    const client = new AutoLLMClient({
      model: entry.model,
      apiKey: "test-key",
      baseUrl: entry.base_url,
      clientType: entry.client,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((client as any)._client).toBeDefined();
  }
});

test.each([
  ["openai-compatible", "OpenaiChatClient"],
  ["openai-chat-compatible", "OpenaiChatClient"],
  ["openai-responses-compatible", "OpenaiResponsesClient"],
  ["ant-messages-compatible", "AntMessagesClient"],
  ["openai-embedding-compatible", "OpenaiEmbeddingClient"],
])("should route %s clientType to %s", (clientType, clientName) => {
  const client = new AutoLLMClient({
    model: "unknown-model",
    apiKey: "test-key",
    clientType,
  });

  expect((client as any)._client.constructor.name).toBe(clientName);
});

test("should reject non-text content items for OpenAI embeddings", () => {
  const client = new AutoLLMClient({
    model: "unknown-model",
    apiKey: "test-key",
    clientType: "openai-embedding",
  });
  const messages: UniMessage[] = [
    {
      role: "user",
      content_items: [{ type: "image_url", image_url: IMAGE }],
    },
  ];

  expect(() => client.transformUniMessageToModelInput(messages)).toThrow(
    "only support text",
  );
});

test("should validate last event has usage_metadata and finish_reason", () => {
  const { LLMClient } = require("../src/baseClient");

  const validEvent = {
    role: "assistant",
    event_type: "stop",
    content_items: [],
    usage_metadata: {
      cached_tokens: 0,
      prompt_tokens: 10,
      thoughts_tokens: null,
      response_tokens: 5,
    },
    finish_reason: "stop",
  };

  // should not throw
  expect(() => LLMClient._validateLastEvent(validEvent)).not.toThrow();

  // null event
  expect(() => LLMClient._validateLastEvent(null)).toThrow("no events");

  // missing usage_metadata
  expect(() =>
    LLMClient._validateLastEvent({ ...validEvent, usage_metadata: null }),
  ).toThrow("usage_metadata");

  // missing finish_reason
  expect(() =>
    LLMClient._validateLastEvent({ ...validEvent, finish_reason: null }),
  ).toThrow("finish_reason");
});
