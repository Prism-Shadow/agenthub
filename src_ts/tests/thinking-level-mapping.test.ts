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
import { ThinkingLevel as GeminiThinkingLevel } from "@google/genai";
import { AutoLLMClient, ThinkingLevel, UniConfig } from "../src";

// Not every Gemini model accepts every thinking level (verified live 2026-07-24;
// see llmsdk_docs/gemini3/docs/thinking.md): pro models reject "minimal"
// (gemini-3-pro also "medium") and image models accept only "minimal" and
// "high". Unsupported levels must clamp to the closest supported one, never error.
const GEMINI3_THINKING_LEVEL_CASES: Array<
  [string, ThinkingLevel, GeminiThinkingLevel | undefined]
> = [
  ["gemini-3.1-pro-preview", ThinkingLevel.NONE, GeminiThinkingLevel.LOW],
  ["gemini-3.1-pro-preview", ThinkingLevel.LOW, GeminiThinkingLevel.LOW],
  ["gemini-3.1-pro-preview", ThinkingLevel.MEDIUM, GeminiThinkingLevel.MEDIUM],
  ["gemini-3.1-pro-preview", ThinkingLevel.HIGH, GeminiThinkingLevel.HIGH],
  ["gemini-3.1-pro-preview", ThinkingLevel.XHIGH, GeminiThinkingLevel.HIGH],
  ["gemini-3.1-pro-preview", ThinkingLevel.MAX, GeminiThinkingLevel.HIGH],
  ["gemini-3-pro-preview", ThinkingLevel.NONE, GeminiThinkingLevel.LOW],
  ["gemini-3-pro-preview", ThinkingLevel.MEDIUM, GeminiThinkingLevel.HIGH],
  ["gemini-3.1-flash-image", ThinkingLevel.NONE, GeminiThinkingLevel.MINIMAL],
  ["gemini-3.1-flash-image", ThinkingLevel.LOW, GeminiThinkingLevel.MINIMAL],
  ["gemini-3.1-flash-image", ThinkingLevel.MEDIUM, GeminiThinkingLevel.HIGH],
  // "-image" wins over "gemini-3-pro" (LOW would stay LOW under the pro set).
  ["gemini-3-pro-image", ThinkingLevel.LOW, GeminiThinkingLevel.MINIMAL],
  ["gemini-3-flash-preview", ThinkingLevel.NONE, GeminiThinkingLevel.MINIMAL],
  ["gemini-3.5-flash", ThinkingLevel.MEDIUM, GeminiThinkingLevel.MEDIUM],
  // A future pro generation falls into the generic "-pro" branch.
  ["gemini-4-pro", ThinkingLevel.NONE, GeminiThinkingLevel.LOW],
  // An unrecognized model inherits the full four-level default.
  ["gemini-9-flash", ThinkingLevel.NONE, GeminiThinkingLevel.MINIMAL],
];

// clientType pins routing so hypothetical model names reach the unified
// Gemini3_8Client the same way an explicit override would in user code.
function createGemini3AutoClient(model: string): AutoLLMClient {
  return new AutoLLMClient({
    model,
    apiKey: "test-key",
    clientType: "gemini-3",
  });
}

describe("gemini3 thinking level clamping", () => {
  test.each(GEMINI3_THINKING_LEVEL_CASES)(
    "%s clamps %s to %s",
    (model, level, expected) => {
      const client = createGemini3AutoClient(model);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((client as any)._client._convertThinkingLevel(level)).toBe(
        expected,
      );
    },
  );

  test("thinking config carries the clamped level", () => {
    const client = createGemini3AutoClient("gemini-3.1-pro-preview");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config = (client as any)._client.transformUniConfigToModelConfig({
      thinking_level: ThinkingLevel.NONE,
    });
    expect(config.thinkingConfig.thinkingLevel).toBe(GeminiThinkingLevel.LOW);
  });
});

// The 3.7 and 3.8 generations drop "minimal" (3.7 verified live 2026-08-13, see
// llmsdk_docs/gemini3_8/docs/thinking.md; 3.8 documented at
// ai.google.dev/gemini-api/docs/latest-model); the 3.6-generation models routed
// to the same client keep the full four-level set.
const GEMINI3_7_THINKING_LEVEL_CASES: Array<
  [string, ThinkingLevel, GeminiThinkingLevel]
> = [
  ["gemini-3.8-flash", ThinkingLevel.NONE, GeminiThinkingLevel.LOW],
  ["gemini-3.8-flash", ThinkingLevel.MAX, GeminiThinkingLevel.HIGH],
  ["gemini-3.7-flash", ThinkingLevel.NONE, GeminiThinkingLevel.LOW],
  ["gemini-3.7-flash", ThinkingLevel.LOW, GeminiThinkingLevel.LOW],
  ["gemini-3.7-flash", ThinkingLevel.MEDIUM, GeminiThinkingLevel.MEDIUM],
  ["gemini-3.7-flash", ThinkingLevel.HIGH, GeminiThinkingLevel.HIGH],
  ["gemini-3.7-flash", ThinkingLevel.XHIGH, GeminiThinkingLevel.HIGH],
  // Gemini has no level above "high", so MAX clamps there too.
  ["gemini-3.7-flash", ThinkingLevel.MAX, GeminiThinkingLevel.HIGH],
  ["gemini-3.6-flash", ThinkingLevel.NONE, GeminiThinkingLevel.MINIMAL],
  ["gemini-3.5-flash-lite", ThinkingLevel.NONE, GeminiThinkingLevel.MINIMAL],
];

describe("gemini3_8 thinking level clamping", () => {
  test.each(GEMINI3_7_THINKING_LEVEL_CASES)(
    "%s clamps %s to %s",
    (model, level, expected) => {
      // These are real model ids, so automatic routing reaches Gemini3_8Client directly.
      const client = new AutoLLMClient({ model, apiKey: "test-key" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((client as any)._client.constructor.name).toBe("Gemini3_8Client");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((client as any)._client._convertThinkingLevel(level)).toBe(
        expected,
      );
    },
  );
});

// GLM-5.3 cannot disable thinking and accepts only low/high/max reasoning_effort
// (llmsdk_docs/glm5_3/docs/thinking.md); GLM-5.2
// keeps the full pass-through vocabulary and pre-5.2 models take no effort parameter.
const GLM_THINKING_LEVEL_CASES: Array<
  [string, ThinkingLevel, string, string | undefined]
> = [
  ["glm-5.3", ThinkingLevel.NONE, "enabled", "low"],
  ["glm-5.3", ThinkingLevel.LOW, "enabled", "low"],
  ["glm-5.3", ThinkingLevel.MEDIUM, "enabled", "high"],
  ["glm-5.3", ThinkingLevel.HIGH, "enabled", "high"],
  ["glm-5.3", ThinkingLevel.XHIGH, "enabled", "max"],
  ["glm-5.3", ThinkingLevel.MAX, "enabled", "max"],
  ["glm-5.3-flash", ThinkingLevel.MAX, "enabled", "max"],
  ["glm-5.2", ThinkingLevel.NONE, "disabled", undefined],
  ["glm-5.2", ThinkingLevel.MEDIUM, "enabled", "medium"],
  ["glm-5.2", ThinkingLevel.XHIGH, "enabled", "xhigh"],
  ["glm-5.2", ThinkingLevel.MAX, "enabled", "max"],
  ["glm-5.1", ThinkingLevel.NONE, "disabled", undefined],
  ["glm-5.1", ThinkingLevel.HIGH, "enabled", "high"],
  // Provider-hosted ids keep their own casing (SiliconFlow), so generation
  // detection must be case-insensitive.
  ["zai-org/GLM-5.2", ThinkingLevel.XHIGH, "enabled", "xhigh"],
  ["Pro/zai-org/GLM-5.1", ThinkingLevel.HIGH, "enabled", "high"],
];

describe("glm thinking level mapping", () => {
  test.each(GLM_THINKING_LEVEL_CASES)(
    "%s maps %s to thinking=%s effort=%s",
    (model, level, thinkingType, effort) => {
      const client = new AutoLLMClient({ model, apiKey: "test-key" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((client as any)._client.constructor.name).toBe("GLM5_3Client");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = (client as any)._client.transformUniConfigToModelConfig({
        thinking_level: level,
      });
      expect(config.extra_body.thinking.type).toBe(thinkingType);
      expect(config.reasoning_effort).toBe(effort);
    },
  );
});

// What each remaining client puts on the wire for a level, per its vendor's effort
// vocabulary: OpenAI takes the full set except on GPT-6, which rejects "none" and
// "minimal" so NONE degrades to low; Claude tops out at max (xhigh only from 4.7),
// DeepSeek and Kimi accept low/high/max, DeepSeek turns thinking off with none, and
// MiniMax has no level above high.
const THINKING_EFFORT_CASES: Array<
  [string, string | undefined, ThinkingLevel, string | undefined]
> = [
  ["gpt-6-astra", undefined, ThinkingLevel.NONE, "low"],
  ["gpt-6-astra", undefined, ThinkingLevel.LOW, "low"],
  ["gpt-6-astra", undefined, ThinkingLevel.MAX, "max"],
  // a gateway serving GPT-6 forwards the effort to OpenAI, so the generic Responses
  // client degrades NONE the same way
  ["gpt-6-astra", "openai-responses", ThinkingLevel.NONE, "low"],
  ["gpt-6-astra", "openai-responses", ThinkingLevel.LOW, "low"],
  ["gpt-6-astra", "openai-responses", ThinkingLevel.MAX, "max"],
  ["gpt-5.6", undefined, ThinkingLevel.NONE, "none"],
  ["gpt-5.6", undefined, ThinkingLevel.XHIGH, "xhigh"],
  ["gpt-5.6", undefined, ThinkingLevel.MAX, "max"],
  ["gpt-5.6", "openai-responses", ThinkingLevel.MAX, "max"],
  ["claude-sonnet-5", undefined, ThinkingLevel.XHIGH, "xhigh"],
  ["claude-sonnet-5", undefined, ThinkingLevel.MAX, "max"],
  // 4.6 has no xhigh but does take max.
  ["claude-sonnet-4-6", undefined, ThinkingLevel.XHIGH, "high"],
  ["claude-sonnet-4-6", undefined, ThinkingLevel.MAX, "max"],
  ["claude-sonnet-5", "ant-messages", ThinkingLevel.MAX, "max"],
  ["deepseek-v4", undefined, ThinkingLevel.NONE, "none"],
  ["deepseek-v4", undefined, ThinkingLevel.LOW, "low"],
  ["deepseek-v4", undefined, ThinkingLevel.MEDIUM, "high"],
  ["deepseek-v4", undefined, ThinkingLevel.HIGH, "high"],
  // DeepSeek maps xhigh onto high server-side, so the client sends high.
  ["deepseek-v4", undefined, ThinkingLevel.XHIGH, "high"],
  ["deepseek-v4", undefined, ThinkingLevel.MAX, "max"],
  ["kimi-k3", undefined, ThinkingLevel.LOW, "low"],
  ["kimi-k3", undefined, ThinkingLevel.MEDIUM, "high"],
  ["kimi-k3", undefined, ThinkingLevel.XHIGH, "max"],
  ["kimi-k3", undefined, ThinkingLevel.MAX, "max"],
  ["MiniMax-M3", "minimax-m3", ThinkingLevel.XHIGH, "high"],
  ["MiniMax-M3", "minimax-m3", ThinkingLevel.MAX, "high"],
];

/** Read the effort out of whichever config key the client used. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wireEffort(config: any): string | undefined {
  if (config.reasoning) return config.reasoning.effort;
  if (config.output_config) return config.output_config.effort;
  return config.reasoning_effort;
}

describe("thinking level to vendor effort", () => {
  test.each(THINKING_EFFORT_CASES)(
    "%s (%s) maps %s to %s",
    (model, clientType, level, expected) => {
      const client = new AutoLLMClient({
        model,
        apiKey: "test-key",
        clientType,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = (client as any)._client.transformUniConfigToModelConfig({
        thinking_level: level,
      });
      expect(wireEffort(config)).toBe(expected);
    },
  );
});

// thinking_summary reaches the wire on its own, not only when a thinking_level rides with
// it. Each protocol spells the switch differently: Anthropic puts it on thinking.display,
// the Responses API on reasoning.summary, and Gemini on thinkingConfig.includeThoughts.
const THINKING_SUMMARY_CASES: Array<
  [string, string | undefined, UniConfig, string | boolean | undefined]
> = [
  ["claude-sonnet-5", undefined, { thinking_summary: true }, "summarized"],
  ["claude-sonnet-5", undefined, { thinking_summary: false }, "omitted"],
  [
    "claude-sonnet-5",
    undefined,
    { thinking_summary: true, thinking_level: ThinkingLevel.NONE },
    "summarized",
  ],
  [
    "claude-sonnet-5",
    undefined,
    { thinking_summary: true, thinking_level: ThinkingLevel.MAX },
    "summarized",
  ],
  ["claude-sonnet-5", "ant-messages", { thinking_summary: true }, "summarized"],
  ["claude-sonnet-5", "ant-messages", { thinking_summary: false }, "omitted"],
  // The Messages API disables thinking for NONE and rejects display on a disabled block,
  // so that one combination leaves no thinking to summarize.
  [
    "claude-sonnet-5",
    "ant-messages",
    { thinking_summary: true, thinking_level: ThinkingLevel.NONE },
    undefined,
  ],
  ["deepseek-v4", undefined, { thinking_summary: true }, "concise"],
  [
    "deepseek-v4",
    undefined,
    { thinking_summary: true, thinking_level: ThinkingLevel.NONE },
    "concise",
  ],
  ["gpt-5.6", undefined, { thinking_summary: true }, "concise"],
  // OpenRouter reads an effort-less reasoning object as "reasoning disabled", so the
  // generic Responses client alone keeps the summary tied to a level.
  ["gpt-5.6", "openai-responses", { thinking_summary: true }, undefined],
  ["gemini-3.8-flash", undefined, { thinking_summary: true }, true],
  ["gemini-3.8-flash", undefined, { thinking_summary: false }, false],
];

/** Read the thinking-summary switch out of whichever field the client used. */
function wireThinkingSummary(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any,
): string | boolean | undefined {
  if (config.thinkingConfig) return config.thinkingConfig.includeThoughts;
  if (config.reasoning) return config.reasoning.summary;
  return config.thinking?.display;
}

describe("thinking summary reaches the wire", () => {
  test.each(THINKING_SUMMARY_CASES)(
    "%s (%s) with %p sends %s",
    (model, clientType, uniConfig, expected) => {
      const client = new AutoLLMClient({
        model,
        apiKey: "test-key",
        clientType,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = (client as any)._client.transformUniConfigToModelConfig(
        uniConfig,
      );
      expect(wireThinkingSummary(config)).toBe(expected);
    },
  );
});

describe("vLLM thinking switch", () => {
  // vLLM hands chat_template_kwargs to the served model's own chat template, so the switch
  // differs per model. The shapes come from the artifacts snapshotted in
  // llmsdk_docs/openai_chat_vllm_adapter/: Qwen3 reads a single enable_thinking boolean;
  // the two Qwen3.8 models share one template that takes reasoning_effort (low/medium/xhigh
  // only); and DeepSeek V4 reads a thinking flag paired with reasoning_effort, which its
  // Pro and Flash encoder narrows to high/max while Flash-Vision-Exp also accepts low.
  // Absent kwargs are how DeepSeek reads as off. Levels the model does not offer clamp to
  // the closest one it does; a model outside the table falls back to Qwen3's boolean.
  // undefined as the expectation means no kwargs are sent at all.
  test.each([
    ["Qwen/Qwen3.6-35B-A3B", ThinkingLevel.NONE, { enable_thinking: false }],
    ["Qwen/Qwen3.6-35B-A3B", ThinkingLevel.LOW, { enable_thinking: true }],
    ["Qwen/Qwen3.6-35B-A3B", ThinkingLevel.MAX, { enable_thinking: true }],
    ["Qwen/Qwen3.8-Flash-Next", ThinkingLevel.NONE, { enable_thinking: false }],
    ["Qwen/Qwen3.8-Flash-Next", ThinkingLevel.LOW, { reasoning_effort: "low" }],
    ["Qwen/Qwen3.5-0.8B", ThinkingLevel.NONE, { enable_thinking: false }],
    ["Qwen/Qwen3.5-9B", ThinkingLevel.MEDIUM, { enable_thinking: true }],
    ["Qwen/Qwen3.8-27B", ThinkingLevel.NONE, { enable_thinking: false }],
    ["Qwen/Qwen3.8-27B", ThinkingLevel.LOW, { reasoning_effort: "low" }],
    ["Qwen/Qwen3.8-27B", ThinkingLevel.MEDIUM, { reasoning_effort: "medium" }],
    ["Qwen/Qwen3.8-27B", ThinkingLevel.HIGH, { reasoning_effort: "xhigh" }],
    ["Qwen/Qwen3.8-27B", ThinkingLevel.XHIGH, { reasoning_effort: "xhigh" }],
    ["Qwen/Qwen3.8-27B", ThinkingLevel.MAX, { reasoning_effort: "xhigh" }],
    ["deepseek-ai/DeepSeek-V4-Pro", ThinkingLevel.NONE, undefined],
    [
      "deepseek-ai/DeepSeek-V4-Pro",
      ThinkingLevel.LOW,
      { thinking: true, reasoning_effort: "high" },
    ],
    [
      "deepseek-ai/DeepSeek-V4-Pro",
      ThinkingLevel.MEDIUM,
      { thinking: true, reasoning_effort: "high" },
    ],
    [
      "deepseek-ai/DeepSeek-V4-Pro",
      ThinkingLevel.HIGH,
      { thinking: true, reasoning_effort: "high" },
    ],
    [
      "deepseek-ai/DeepSeek-V4-Pro",
      ThinkingLevel.XHIGH,
      { thinking: true, reasoning_effort: "high" },
    ],
    [
      "deepseek-ai/DeepSeek-V4-Pro",
      ThinkingLevel.MAX,
      { thinking: true, reasoning_effort: "max" },
    ],
    [
      "deepseek-ai/DeepSeek-V4-Flash",
      ThinkingLevel.LOW,
      { thinking: true, reasoning_effort: "high" },
    ],
    ["deepseek-ai/DeepSeek-V4-Flash-Vision-Exp", ThinkingLevel.NONE, undefined],
    [
      "deepseek-ai/DeepSeek-V4-Flash-Vision-Exp",
      ThinkingLevel.LOW,
      { thinking: true, reasoning_effort: "low" },
    ],
    [
      "deepseek-ai/DeepSeek-V4-Flash-Vision-Exp",
      ThinkingLevel.HIGH,
      { thinking: true, reasoning_effort: "high" },
    ],
    ["meta-llama/Llama-4-70B", ThinkingLevel.NONE, { enable_thinking: false }],
    ["meta-llama/Llama-4-70B", ThinkingLevel.HIGH, { enable_thinking: true }],
  ])(
    "maps %s at %s onto its own chat template kwargs",
    (model, level, expected) => {
      const client = new AutoLLMClient({
        model: model as string,
        apiKey: "test-key",
        baseUrl: "http://localhost:8000/v1",
        clientType: "openai-chat-vllm-adapter",
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = (client as any)._client.transformUniConfigToModelConfig({
        thinking_level: level,
      });
      expect(config.chat_template_kwargs).toEqual(expected);
    },
  );

  test("does not add the vLLM extension when no level is selected", () => {
    const client = new AutoLLMClient({
      model: "Qwen/Qwen3.6-35B-A3B",
      apiKey: "test-key",
      clientType: "openai-chat-vllm-adapter",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config = (client as any)._client.transformUniConfigToModelConfig({});
    expect(config.chat_template_kwargs).toBeUndefined();
  });

  test("keeps generic OpenAI Chat requests unchanged", () => {
    const client = new AutoLLMClient({
      model: "Qwen/Qwen3.6-35B-A3B",
      apiKey: "test-key",
      clientType: "openai-chat",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config = (client as any)._client.transformUniConfigToModelConfig({
      thinking_level: ThinkingLevel.NONE,
    });
    expect(config.chat_template_kwargs).toBeUndefined();
  });
});
