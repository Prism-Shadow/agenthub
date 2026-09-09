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

export type Modality = "Text" | "Image" | "Video" | "Audio" | "Embed";
export type Currency = "USD" | "CNY";

/**
 * List prices per million tokens for AgentHub's usage buckets.
 *
 * Keys mirror `usage_metadata`: `cached_tokens` (cache-hit price, absent when
 * the platform publishes none), `prompt_tokens` (non-cached input), and
 * `thoughts_tokens`/`response_tokens`, which both carry the vendor's output
 * price. Values are in the currency requested from listSupportedModels.
 */
export interface ModelPricing {
  currency: Currency;
  prompt_tokens: number;
  thoughts_tokens: number;
  response_tokens: number;
  cached_tokens?: number;
}

/**
 * One supported model entry.
 *
 * (model, base_url, client) maps directly onto the AutoLLMClient constructor:
 * `new AutoLLMClient({ model, baseUrl: base_url, clientType: client })`.
 * Modalities describe what is usable through that client; `context_window` and
 * `pricing` are omitted where the platform publishes no authoritative value.
 *
 * `pricing` is always the LIST price. A running promotion is deliberately not recorded: the
 * registry's job is the catalog price, and applying a promotion is the consumer's.
 */
export interface SupportedModel {
  model: string;
  base_url: string;
  client: string;
  input_modalities: Modality[];
  output_modalities: Modality[];
  context_window?: number;
  pricing?: ModelPricing;
}

const GOOGLE = "https://generativelanguage.googleapis.com";
const ANTHROPIC = "https://api.anthropic.com";
const OPENAI = "https://api.openai.com/v1";
const ZAI = "https://api.z.ai/api/paas/v4/";
const MOONSHOT = "https://api.moonshot.cn/v1";
const DEEPSEEK = "https://api.deepseek.com";
const OPENROUTER = "https://openrouter.ai/api/v1";
const SILICONFLOW = "https://api.siliconflow.cn/v1";
const MINIMAX = "https://api.minimax.io/v1";

// Display convention shared with the AgentHub apps: prices are stored in USD
// (official CNY list prices pre-converted at 7 CNY/USD), so requesting CNY
// shows the vendor's numbers.
const CNY_PER_USD = 7.0;

function usd(prompt: number, output: number, cached?: number): ModelPricing {
  // thoughts and response tokens are both billed at the vendor's output price
  return {
    currency: "USD",
    prompt_tokens: prompt,
    thoughts_tokens: output,
    response_tokens: output,
    ...(cached !== undefined ? { cached_tokens: cached } : {}),
  };
}

/**
 * Declare a CNY-denominated official list price; storage stays USD (converted
 * at 7 CNY/USD).
 */
function cny(prompt: number, output: number, cached?: number): ModelPricing {
  const rate = (v: number): number => Math.round((v / CNY_PER_USD) * 1e6) / 1e6;
  return usd(rate(prompt), rate(output), cached !== undefined ? rate(cached) : undefined);
}

// Prices in USD per million tokens (official CNY prices pre-converted at
// 7 CNY/USD); platform data (context windows, OpenRouter USD prices, modality
// flags) verified against the live /models APIs on 2026-07-22, SiliconFlow CNY
// prices from the vendors' official price lists.
const SUPPORTED_MODELS: SupportedModel[] = [
  // official vendor endpoints
  {
    model: "gemini-3.8-flash",
    base_url: GOOGLE,
    client: "gemini-3.8",
    input_modalities: ["Text", "Image", "Video", "Audio"],
    output_modalities: ["Text"],
    context_window: 1048576,
    // Google runs a launch discount through 2026-12-31 on this row and on the two flash
    // rows below; the list price is stored regardless, because applying a running
    // promotion belongs to the consumer, not to the registry.
    pricing: usd(1.5, 7.5, 0.15),
  },
  {
    model: "gemini-3.7-flash",
    base_url: GOOGLE,
    client: "gemini-3.8",
    input_modalities: ["Text", "Image", "Video", "Audio"],
    output_modalities: ["Text"],
    context_window: 1048576,
    pricing: usd(1.5, 7.5, 0.15),
  },
  {
    model: "gemini-3.6-flash",
    base_url: GOOGLE,
    client: "gemini-3.8",
    input_modalities: ["Text", "Image", "Video", "Audio"],
    output_modalities: ["Text"],
    context_window: 1048576,
    pricing: usd(1.5, 7.5, 0.15),
  },
  {
    model: "gemini-3.5-flash-lite",
    base_url: GOOGLE,
    client: "gemini-3.8",
    input_modalities: ["Text", "Image", "Video", "Audio"],
    output_modalities: ["Text"],
    context_window: 1048576,
    pricing: usd(0.3, 2.5, 0.03),
  },
  {
    model: "gemini-3.5-flash",
    base_url: GOOGLE,
    client: "gemini-3.8",
    input_modalities: ["Text", "Image", "Video", "Audio"],
    output_modalities: ["Text"],
    context_window: 1048576,
    pricing: usd(1.5, 9.0, 0.15),
  },
  {
    model: "gemini-3.1-flash-image",
    base_url: GOOGLE,
    client: "gemini-3.8",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Image"],
  },
  {
    model: "gemini-3.1-flash-tts-preview",
    base_url: GOOGLE,
    client: "gemini-3.8",
    input_modalities: ["Text"],
    output_modalities: ["Audio"],
  },
  {
    model: "gemini-embedding-2",
    base_url: GOOGLE,
    client: "gemini-3.8",
    input_modalities: ["Text"],
    output_modalities: ["Embed"],
  },
  {
    model: "claude-fable-5",
    base_url: ANTHROPIC,
    client: "claude-5",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1000000,
    pricing: usd(10.0, 50.0, 1.0),
  },
  {
    model: "claude-opus-5",
    base_url: ANTHROPIC,
    client: "claude-5",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1000000,
    pricing: usd(5.0, 25.0, 0.5),
  },
  {
    model: "claude-sonnet-5",
    base_url: ANTHROPIC,
    client: "claude-5",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1000000,
    pricing: usd(2.0, 10.0, 0.2),
  },
  {
    model: "claude-opus-4-8",
    base_url: ANTHROPIC,
    client: "claude-5",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1000000,
    pricing: usd(5.0, 25.0, 0.5),
  },
  {
    model: "claude-sonnet-4-6",
    base_url: ANTHROPIC,
    client: "claude-4-6",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1000000,
    pricing: usd(3.0, 15.0, 0.3),
  },
  {
    // official list price per 1M tokens: $1 cached input, $10 uncached input, $12.5 cache
    // writes, $50 output, all doubled above 272K input tokens except output, which is 1.5x.
    // The prompt bucket carries the cache-write rate: the usage buckets do not separate
    // cache-written input from plain input.
    model: "gpt-6-astra",
    base_url: OPENAI,
    client: "gpt-6",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1050000,
    pricing: usd(12.5, 50.0, 1.0),
  },
  {
    // official standard-tier list price; the bare gpt-5.6 alias also routes here
    model: "gpt-5.6-sol",
    base_url: OPENAI,
    client: "gpt-6",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1050000,
    pricing: usd(5.0, 30.0, 0.5),
  },
  {
    model: "gpt-5.6-terra",
    base_url: OPENAI,
    client: "gpt-6",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1050000,
    pricing: usd(2.0, 12.0, 0.2),
  },
  {
    model: "gpt-5.6-luna",
    base_url: OPENAI,
    client: "gpt-6",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1050000,
    pricing: usd(0.2, 1.2, 0.02),
  },
  {
    model: "gpt-5.5",
    base_url: OPENAI,
    client: "gpt-5.5",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1050000,
    pricing: usd(5.0, 30.0, 0.5),
  },
  {
    model: "MiniMax-M3",
    base_url: MINIMAX,
    client: "minimax-m3",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1000000,
    // official list price for the <=512K-input tier; rates double above it
    pricing: usd(0.3, 1.2, 0.06),
  },
  {
    model: "text-embedding-3-large",
    base_url: OPENAI,
    client: "openai-embedding",
    input_modalities: ["Text"],
    output_modalities: ["Embed"],
    pricing: usd(0.13, 0.0),
  },
  {
    model: "glm-5.3",
    base_url: ZAI,
    client: "glm-5.3",
    input_modalities: ["Text"],
    output_modalities: ["Text"],
    context_window: 1000000,
    pricing: usd(1.4, 4.4, 0.26),
  },
  {
    model: "glm-5.3-flash",
    base_url: ZAI,
    client: "glm-5.3",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1000000,
    // official list price (verified 2026-08-26); a launch discount halves all three
    // rates through 2026-09-09 (UTC+8)
    pricing: usd(0.15, 0.5, 0.03),
  },
  {
    model: "glm-5.2",
    base_url: ZAI,
    client: "glm-5.3",
    input_modalities: ["Text"],
    output_modalities: ["Text"],
    context_window: 1000000,
    pricing: usd(1.4, 4.4, 0.26),
  },
  {
    model: "glm-5.1",
    base_url: ZAI,
    client: "glm-5.3",
    input_modalities: ["Text"],
    output_modalities: ["Text"],
    context_window: 200000,
    pricing: usd(1.4, 4.4, 0.26),
  },
  {
    model: "kimi-k3",
    base_url: MOONSHOT,
    client: "kimi-k3",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1048576,
    pricing: cny(20.0, 100.0, 2.0),
  },
  {
    model: "kimi-k2.6",
    base_url: MOONSHOT,
    client: "kimi-k2.6",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 262144,
    pricing: cny(6.5, 27.0, 1.1),
  },
  {
    model: "deepseek-v4.1-flash",
    base_url: DEEPSEEK,
    client: "deepseek-v4",
    // announced by DeepSeek for release after 2026-09-10 and not yet served on
    // 2026-09-09; multimodal per the announcement
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    // assumed equal to deepseek-v4-flash until the official model page lists it
    context_window: 1000000,
    // priced as the V4 Flash series: official off-peak list price effective 2026-09-10,
    // and peak-hour rates (Beijing 9:00-12:00, 14:00-18:00) are double
    pricing: cny(1.0, 4.0, 0.02),
  },
  {
    model: "deepseek-v4-flash",
    base_url: DEEPSEEK,
    client: "deepseek-v4",
    input_modalities: ["Text"],
    output_modalities: ["Text"],
    context_window: 1000000,
    // official off-peak list price effective 2026-09-10 (verified 2026-09-08 against
    // the official adjustment); peak-hour rates (Beijing 9:00-12:00, 14:00-18:00) are
    // double
    pricing: cny(1.0, 4.0, 0.02),
  },
  {
    model: "deepseek-v4-flash-vision-exp",
    base_url: DEEPSEEK,
    client: "deepseek-v4",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1000000,
    // priced as deepseek-v4-flash; official off-peak list price effective 2026-09-10
    // (verified 2026-09-08 against the official adjustment), and peak-hour rates
    // (Beijing 9:00-12:00, 14:00-18:00) are double
    pricing: cny(1.0, 4.0, 0.02),
  },
  {
    model: "deepseek-v4-pro",
    base_url: DEEPSEEK,
    client: "deepseek-v4",
    input_modalities: ["Text"],
    output_modalities: ["Text"],
    context_window: 1000000,
    // official off-peak list price (verified 2026-08-18); peak-hour rates
    // (Beijing 9:00-12:00, 14:00-18:00) are double
    pricing: cny(4.5, 13.5, 0.15),
  },
  // OpenRouter (USD prices, context windows and modality flags from the live /models API)
  {
    model: "anthropic/claude-fable-5",
    base_url: OPENROUTER,
    client: "openai-responses",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1000000,
    pricing: usd(10.0, 50.0, 1.0),
  },
  {
    model: "anthropic/claude-opus-5",
    base_url: OPENROUTER,
    client: "openai-responses",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1000000,
    pricing: usd(5.0, 25.0, 0.5),
  },
  {
    model: "anthropic/claude-opus-4.8",
    base_url: OPENROUTER,
    client: "openai-responses",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1000000,
    pricing: usd(5.0, 25.0, 0.5),
  },
  {
    model: "anthropic/claude-opus-4.7",
    base_url: OPENROUTER,
    client: "openai-responses",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1000000,
    pricing: usd(5.0, 25.0, 0.5),
  },
  {
    model: "anthropic/claude-sonnet-5",
    base_url: OPENROUTER,
    client: "openai-responses",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1000000,
    pricing: usd(2.0, 10.0, 0.2),
  },
  {
    model: "deepseek/deepseek-v4-flash",
    base_url: OPENROUTER,
    client: "deepseek-v4",
    input_modalities: ["Text"],
    output_modalities: ["Text"],
    context_window: 1048576,
    pricing: usd(0.098, 0.196, 0.0196),
  },
  {
    model: "deepseek/deepseek-v4-pro",
    base_url: OPENROUTER,
    client: "deepseek-v4",
    input_modalities: ["Text"],
    output_modalities: ["Text"],
    context_window: 1048576,
    pricing: usd(0.435, 0.87, 0.003625),
  },
  {
    model: "google/gemini-3.5-flash",
    base_url: OPENROUTER,
    client: "openai-responses",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1048576,
    pricing: usd(1.5, 9.0, 0.15),
  },
  {
    model: "minimax/minimax-m3",
    base_url: OPENROUTER,
    client: "openai-responses",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1048576,
    pricing: usd(0.3, 1.2, 0.06),
  },
  {
    model: "moonshotai/kimi-k3",
    base_url: OPENROUTER,
    client: "kimi-k3",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1048576,
    pricing: usd(3.0, 15.0, 0.3),
  },
  {
    model: "moonshotai/kimi-k2.6",
    base_url: OPENROUTER,
    client: "kimi-k2.6",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 262144,
    pricing: usd(0.684, 3.42, 0.144),
  },
  {
    model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    base_url: OPENROUTER,
    client: "openai-responses",
    input_modalities: ["Text"],
    output_modalities: ["Text"],
    context_window: 1000000,
    pricing: usd(0.0, 0.0),
  },
  {
    // models API 2026-09-09, default OpenAI endpoint, no discount: $10 input, $50 output,
    // $1 cache read, $12.5 cache write per 1M tokens
    model: "openai/gpt-6-astra",
    base_url: OPENROUTER,
    client: "openai-responses",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1050000,
    pricing: usd(12.5, 50.0, 1.0),
  },
  {
    model: "openai/gpt-5.6-sol",
    base_url: OPENROUTER,
    client: "openai-responses",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1050000,
    pricing: usd(2.5, 15.0, 0.25),
  },
  {
    model: "openai/gpt-5.6-terra",
    base_url: OPENROUTER,
    client: "openai-responses",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1050000,
    pricing: usd(2.0, 12.0, 0.2),
  },
  {
    model: "openai/gpt-5.6-luna",
    base_url: OPENROUTER,
    client: "openai-responses",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1050000,
    pricing: usd(0.2, 1.2, 0.02),
  },
  {
    model: "openai/gpt-5.5",
    base_url: OPENROUTER,
    client: "openai-responses",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1050000,
    pricing: usd(5.0, 30.0, 0.5),
  },
  {
    model: "qwen/qwen3.6-35b-a3b",
    base_url: OPENROUTER,
    client: "openai-responses",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 262144,
    pricing: usd(0.14, 1.0),
  },
  {
    model: "qwen/qwen3-embedding-4b",
    base_url: OPENROUTER,
    client: "openai-embedding",
    input_modalities: ["Text"],
    output_modalities: ["Embed"],
    context_window: 32768,
    pricing: usd(0.02, 0.0),
  },
  {
    model: "stepfun/step-3.7-flash",
    base_url: OPENROUTER,
    client: "openai-responses",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 262144,
    pricing: usd(0.2, 1.15, 0.04),
  },
  {
    model: "tencent/hy3",
    base_url: OPENROUTER,
    client: "openai-responses",
    input_modalities: ["Text"],
    output_modalities: ["Text"],
    context_window: 262144,
    pricing: usd(0.14, 0.58, 0.035),
  },
  {
    model: "x-ai/grok-4.5",
    base_url: OPENROUTER,
    client: "openai-responses",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 500000,
    pricing: usd(2.0, 6.0, 0.3),
  },
  {
    model: "xiaomi/mimo-v2.5",
    base_url: OPENROUTER,
    client: "openai-responses",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 1050000,
    pricing: usd(0.14, 0.28, 0.0028),
  },
  {
    model: "z-ai/glm-5.3",
    base_url: OPENROUTER,
    client: "glm-5.3",
    input_modalities: ["Text"],
    output_modalities: ["Text"],
    context_window: 1048576,
    pricing: usd(1.4, 4.4, 0.26),
  },
  {
    model: "z-ai/glm-5.2",
    base_url: OPENROUTER,
    client: "glm-5.2",
    input_modalities: ["Text"],
    output_modalities: ["Text"],
    context_window: 1048576,
    pricing: usd(0.966, 3.036, 0.1932),
  },
  {
    model: "z-ai/glm-5.1",
    base_url: OPENROUTER,
    client: "glm-5.1",
    input_modalities: ["Text"],
    output_modalities: ["Text"],
    context_window: 204800,
    pricing: usd(0.966, 3.036, 0.1794),
  },
  // SiliconFlow (official CNY price lists pre-converted to USD; no public pricing API)
  {
    model: "deepseek-ai/DeepSeek-V4-Flash",
    base_url: SILICONFLOW,
    client: "openai-chat",
    input_modalities: ["Text"],
    output_modalities: ["Text"],
    context_window: 1000000,
    pricing: cny(1.0, 2.0, 0.02),
  },
  {
    model: "deepseek-ai/DeepSeek-V4-Pro",
    base_url: SILICONFLOW,
    client: "openai-chat",
    input_modalities: ["Text"],
    output_modalities: ["Text"],
    context_window: 1000000,
    pricing: cny(12.0, 24.0, 0.1),
  },
  {
    model: "meituan-longcat/LongCat-2.0",
    base_url: SILICONFLOW,
    client: "openai-chat",
    input_modalities: ["Text"],
    output_modalities: ["Text"],
    context_window: 1000000,
    pricing: cny(5.0, 20.0, 0.1),
  },
  {
    model: "moonshotai/Kimi-K2.7-Code",
    base_url: SILICONFLOW,
    client: "openai-chat",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 262144,
    pricing: cny(6.5, 27.0, 1.3),
  },
  {
    model: "zai-org/GLM-5.2",
    base_url: SILICONFLOW,
    client: "glm-5.2",
    input_modalities: ["Text"],
    output_modalities: ["Text"],
    context_window: 1000000,
    pricing: cny(8.0, 28.0, 2.0),
  },
  {
    model: "Pro/zai-org/GLM-5.1",
    base_url: SILICONFLOW,
    client: "glm-5.1",
    input_modalities: ["Text"],
    output_modalities: ["Text"],
    context_window: 200000,
  },
  {
    model: "Pro/moonshotai/Kimi-K2.6",
    base_url: SILICONFLOW,
    client: "kimi-k2.6",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 262144,
  },
  {
    model: "Qwen/Qwen3.6-35B-A3B",
    base_url: SILICONFLOW,
    client: "openai-chat",
    input_modalities: ["Text", "Image"],
    output_modalities: ["Text"],
    context_window: 262144,
  },
  {
    model: "Qwen/Qwen3-Embedding-8B",
    base_url: SILICONFLOW,
    client: "openai-embedding",
    input_modalities: ["Text"],
    output_modalities: ["Embed"],
  },
];

function convertPricing(pricing: ModelPricing, currency: Currency): ModelPricing {
  if (currency === "USD") {
    return { ...pricing };
  }

  const round = (v: number): number => Math.round(v * CNY_PER_USD * 1e6) / 1e6;
  return {
    currency: "CNY",
    prompt_tokens: round(pricing.prompt_tokens),
    thoughts_tokens: round(pricing.thoughts_tokens),
    response_tokens: round(pricing.response_tokens),
    ...(pricing.cached_tokens !== undefined
      ? { cached_tokens: round(pricing.cached_tokens) }
      : {}),
  };
}

/**
 * List supported models with base URL, client, modalities, context window, and
 * pricing.
 *
 * Covers the official vendor endpoints plus the OpenRouter and SiliconFlow
 * platforms; `client` is the `clientType` token that routes the model to its
 * protocol client. Prices are per million tokens for AgentHub's usage buckets
 * (cached_tokens, prompt_tokens, thoughts_tokens, response_tokens), stored in
 * USD and converted to `currency` at 7 CNY/USD on request.
 */
export function listSupportedModels(currency: Currency = "USD"): SupportedModel[] {
  return SUPPORTED_MODELS.map((entry) => ({
    ...entry,
    input_modalities: [...entry.input_modalities],
    output_modalities: [...entry.output_modalities],
    ...(entry.pricing ? { pricing: convertPricing(entry.pricing, currency) } : {}),
  }));
}
