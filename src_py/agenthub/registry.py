# Copyright 2025 Prism Shadow. and/or its affiliates
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from typing import Literal, NotRequired, TypedDict


Modality = Literal["Text", "Image", "Video", "Audio", "Embed"]
Currency = Literal["USD", "CNY"]


class ModelPricing(TypedDict):
    """List prices per million tokens for AgentHub's usage buckets.

    Keys mirror ``usage_metadata``: ``cached_tokens`` (cache-hit price, absent when the
    platform publishes none), ``prompt_tokens`` (non-cached input), and
    ``thoughts_tokens``/``response_tokens``, which both carry the vendor's output price.
    Values are in the currency requested from ``list_supported_models``.
    """

    currency: Currency
    prompt_tokens: float
    thoughts_tokens: float
    response_tokens: float
    cached_tokens: NotRequired[float]


class SupportedModel(TypedDict):
    """One supported model entry.

    (model, base_url, client) maps directly onto the AutoLLMClient constructor:
    ``AutoLLMClient(model=entry["model"], base_url=entry["base_url"], client_type=entry["client"])``.
    Modalities describe what is usable through that client; ``context_window`` and
    ``pricing`` are omitted where the platform publishes no authoritative value.

    ``pricing`` is always the LIST price. A running promotion is deliberately not recorded:
    the registry's job is the catalog price, and applying a promotion is the consumer's.
    """

    model: str
    base_url: str
    client: str
    input_modalities: list[Modality]
    output_modalities: list[Modality]
    context_window: NotRequired[int]
    pricing: NotRequired[ModelPricing]


_GOOGLE = "https://generativelanguage.googleapis.com"
_ANTHROPIC = "https://api.anthropic.com"
_OPENAI = "https://api.openai.com/v1"
_ZAI = "https://api.z.ai/api/paas/v4/"
_MOONSHOT = "https://api.moonshot.cn/v1"
_DEEPSEEK = "https://api.deepseek.com"
_OPENROUTER = "https://openrouter.ai/api/v1"
_SILICONFLOW = "https://api.siliconflow.cn/v1"
_MINIMAX = "https://api.minimax.io/v1"

# Display convention shared with the AgentHub apps: prices are stored in USD (official CNY
# list prices pre-converted at 7 CNY/USD), so requesting CNY shows the vendor's numbers.
_CNY_PER_USD = 7.0


def _usd(prompt: float, output: float, cached: float | None = None) -> ModelPricing:
    # thoughts and response tokens are both billed at the vendor's output price
    pricing: ModelPricing = {
        "currency": "USD",
        "prompt_tokens": prompt,
        "thoughts_tokens": output,
        "response_tokens": output,
    }
    if cached is not None:
        pricing["cached_tokens"] = cached
    return pricing


def _cny(prompt: float, output: float, cached: float | None = None) -> ModelPricing:
    """Declare a CNY-denominated official list price; storage stays USD (converted at 7 CNY/USD)."""

    def rate(value: float) -> float:
        return round(value / _CNY_PER_USD, 6)

    return _usd(rate(prompt), rate(output), rate(cached) if cached is not None else None)


# Prices in USD per million tokens (official CNY prices pre-converted at 7 CNY/USD); platform
# data (context windows, OpenRouter USD prices, modality flags) verified against the live
# /models APIs on 2026-07-22, SiliconFlow CNY prices from the vendors' official price lists.
_SUPPORTED_MODELS: list[SupportedModel] = [
    # official vendor endpoints
    {
        "model": "gemini-3.8-flash",
        "base_url": _GOOGLE,
        "client": "gemini-3.8",
        "input_modalities": ["Text", "Image", "Video", "Audio"],
        "output_modalities": ["Text"],
        "context_window": 1048576,
        # Google runs a launch discount through 2026-12-31 on this row and on the two flash
        # rows below; the list price is stored regardless, because applying a running
        # promotion belongs to the consumer, not to the registry.
        "pricing": _usd(1.5, 7.5, cached=0.15),
    },
    {
        "model": "gemini-3.7-flash",
        "base_url": _GOOGLE,
        "client": "gemini-3.8",
        "input_modalities": ["Text", "Image", "Video", "Audio"],
        "output_modalities": ["Text"],
        "context_window": 1048576,
        "pricing": _usd(1.5, 7.5, cached=0.15),
    },
    {
        "model": "gemini-3.6-flash",
        "base_url": _GOOGLE,
        "client": "gemini-3.8",
        "input_modalities": ["Text", "Image", "Video", "Audio"],
        "output_modalities": ["Text"],
        "context_window": 1048576,
        "pricing": _usd(1.5, 7.5, cached=0.15),
    },
    {
        "model": "gemini-3.5-flash-lite",
        "base_url": _GOOGLE,
        "client": "gemini-3.8",
        "input_modalities": ["Text", "Image", "Video", "Audio"],
        "output_modalities": ["Text"],
        "context_window": 1048576,
        "pricing": _usd(0.3, 2.5, cached=0.03),
    },
    {
        "model": "gemini-3.5-flash",
        "base_url": _GOOGLE,
        "client": "gemini-3.8",
        "input_modalities": ["Text", "Image", "Video", "Audio"],
        "output_modalities": ["Text"],
        "context_window": 1048576,
        "pricing": _usd(1.5, 9.0, cached=0.15),
    },
    {
        "model": "gemini-3.1-flash-image",
        "base_url": _GOOGLE,
        "client": "gemini-3.8",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Image"],
    },
    {
        "model": "gemini-3.1-flash-tts-preview",
        "base_url": _GOOGLE,
        "client": "gemini-3.8",
        "input_modalities": ["Text"],
        "output_modalities": ["Audio"],
    },
    {
        "model": "gemini-embedding-2",
        "base_url": _GOOGLE,
        "client": "gemini-3.8",
        "input_modalities": ["Text"],
        "output_modalities": ["Embed"],
    },
    {
        "model": "claude-fable-5",
        "base_url": _ANTHROPIC,
        "client": "claude-5",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1000000,
        "pricing": _usd(10.0, 50.0, cached=1.0),
    },
    {
        "model": "claude-opus-5",
        "base_url": _ANTHROPIC,
        "client": "claude-5",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1000000,
        "pricing": _usd(5.0, 25.0, cached=0.5),
    },
    {
        "model": "claude-sonnet-5",
        "base_url": _ANTHROPIC,
        "client": "claude-5",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1000000,
        "pricing": _usd(2.0, 10.0, cached=0.2),
    },
    {
        "model": "claude-opus-4-8",
        "base_url": _ANTHROPIC,
        "client": "claude-5",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1000000,
        "pricing": _usd(5.0, 25.0, cached=0.5),
    },
    {
        "model": "claude-sonnet-4-6",
        "base_url": _ANTHROPIC,
        "client": "claude-4-6",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1000000,
        "pricing": _usd(3.0, 15.0, cached=0.3),
    },
    {
        # official list price per 1M tokens: $1 cached input, $10 uncached input, $12.5 cache
        # writes, $50 output, all doubled above 272K input tokens except output, which is 1.5x.
        # The prompt bucket carries the cache-write rate: the usage buckets do not separate
        # cache-written input from plain input.
        "model": "gpt-6-astra",
        "base_url": _OPENAI,
        "client": "gpt-6",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1050000,
        "pricing": _usd(12.5, 50.0, cached=1.0),
    },
    {
        # official standard-tier list price; the bare gpt-5.6 alias also routes here
        "model": "gpt-5.6-sol",
        "base_url": _OPENAI,
        "client": "gpt-6",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1050000,
        "pricing": _usd(5.0, 30.0, cached=0.5),
    },
    {
        "model": "gpt-5.6-terra",
        "base_url": _OPENAI,
        "client": "gpt-6",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1050000,
        "pricing": _usd(2.0, 12.0, cached=0.2),
    },
    {
        "model": "gpt-5.6-luna",
        "base_url": _OPENAI,
        "client": "gpt-6",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1050000,
        "pricing": _usd(0.2, 1.2, cached=0.02),
    },
    {
        "model": "gpt-5.5",
        "base_url": _OPENAI,
        "client": "gpt-5.5",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1050000,
        "pricing": _usd(5.0, 30.0, cached=0.5),
    },
    {
        "model": "MiniMax-M3",
        "base_url": _MINIMAX,
        "client": "minimax-m3",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1000000,
        # official list price for the <=512K-input tier; rates double above it
        "pricing": _usd(0.3, 1.2, cached=0.06),
    },
    {
        "model": "text-embedding-3-large",
        "base_url": _OPENAI,
        "client": "openai-embedding",
        "input_modalities": ["Text"],
        "output_modalities": ["Embed"],
        "pricing": _usd(0.13, 0.0),
    },
    {
        "model": "glm-5.3",
        "base_url": _ZAI,
        "client": "glm-5.3",
        "input_modalities": ["Text"],
        "output_modalities": ["Text"],
        "context_window": 1000000,
        "pricing": _usd(1.4, 4.4, cached=0.26),
    },
    {
        "model": "glm-5.3-flash",
        "base_url": _ZAI,
        "client": "glm-5.3",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1000000,
        # official list price (verified 2026-08-26); a launch discount halves all three rates
        # through 2026-09-09 (UTC+8)
        "pricing": _usd(0.15, 0.5, cached=0.03),
    },
    {
        "model": "glm-5.2",
        "base_url": _ZAI,
        "client": "glm-5.3",
        "input_modalities": ["Text"],
        "output_modalities": ["Text"],
        "context_window": 1000000,
        "pricing": _usd(1.4, 4.4, cached=0.26),
    },
    {
        "model": "glm-5.1",
        "base_url": _ZAI,
        "client": "glm-5.3",
        "input_modalities": ["Text"],
        "output_modalities": ["Text"],
        "context_window": 200000,
        "pricing": _usd(1.4, 4.4, cached=0.26),
    },
    {
        "model": "kimi-k3",
        "base_url": _MOONSHOT,
        "client": "kimi-k3",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1048576,
        "pricing": _cny(20.0, 100.0, cached=2.0),
    },
    {
        "model": "kimi-k2.6",
        "base_url": _MOONSHOT,
        "client": "kimi-k2.6",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 262144,
        "pricing": _cny(6.5, 27.0, cached=1.1),
    },
    {
        "model": "deepseek-v4-flash",
        "base_url": _DEEPSEEK,
        "client": "deepseek-v4",
        "input_modalities": ["Text"],
        "output_modalities": ["Text"],
        "context_window": 1000000,
        # official off-peak list price (verified 2026-08-18); peak-hour rates
        # (Beijing 9:00-12:00, 14:00-18:00) are double
        "pricing": _cny(1.5, 4.5, cached=0.05),
    },
    {
        "model": "deepseek-v4-flash-vision-exp",
        "base_url": _DEEPSEEK,
        "client": "deepseek-v4",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1000000,
        # priced as deepseek-v4-flash; official off-peak list price (verified 2026-08-21), and
        # peak-hour rates (Beijing 9:00-12:00, 14:00-18:00) are double
        "pricing": _cny(1.5, 4.5, cached=0.05),
    },
    {
        "model": "deepseek-v4-pro",
        "base_url": _DEEPSEEK,
        "client": "deepseek-v4",
        "input_modalities": ["Text"],
        "output_modalities": ["Text"],
        "context_window": 1000000,
        # official off-peak list price (verified 2026-08-18); peak-hour rates
        # (Beijing 9:00-12:00, 14:00-18:00) are double
        "pricing": _cny(4.5, 13.5, cached=0.15),
    },
    # OpenRouter (USD prices, context windows and modality flags from the live /models API)
    {
        "model": "anthropic/claude-fable-5",
        "base_url": _OPENROUTER,
        "client": "openai-responses",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1000000,
        "pricing": _usd(10.0, 50.0, cached=1.0),
    },
    {
        "model": "anthropic/claude-opus-5",
        "base_url": _OPENROUTER,
        "client": "openai-responses",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1000000,
        "pricing": _usd(5.0, 25.0, cached=0.5),
    },
    {
        "model": "anthropic/claude-opus-4.8",
        "base_url": _OPENROUTER,
        "client": "openai-responses",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1000000,
        "pricing": _usd(5.0, 25.0, cached=0.5),
    },
    {
        "model": "anthropic/claude-opus-4.7",
        "base_url": _OPENROUTER,
        "client": "openai-responses",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1000000,
        "pricing": _usd(5.0, 25.0, cached=0.5),
    },
    {
        "model": "anthropic/claude-sonnet-5",
        "base_url": _OPENROUTER,
        "client": "openai-responses",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1000000,
        "pricing": _usd(2.0, 10.0, cached=0.2),
    },
    {
        "model": "deepseek/deepseek-v4-flash",
        "base_url": _OPENROUTER,
        "client": "deepseek-v4",
        "input_modalities": ["Text"],
        "output_modalities": ["Text"],
        "context_window": 1048576,
        "pricing": _usd(0.098, 0.196, cached=0.0196),
    },
    {
        "model": "deepseek/deepseek-v4-pro",
        "base_url": _OPENROUTER,
        "client": "deepseek-v4",
        "input_modalities": ["Text"],
        "output_modalities": ["Text"],
        "context_window": 1048576,
        "pricing": _usd(0.435, 0.87, cached=0.003625),
    },
    {
        "model": "google/gemini-3.5-flash",
        "base_url": _OPENROUTER,
        "client": "openai-responses",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1048576,
        "pricing": _usd(1.5, 9.0, cached=0.15),
    },
    {
        "model": "minimax/minimax-m3",
        "base_url": _OPENROUTER,
        "client": "openai-responses",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1048576,
        "pricing": _usd(0.3, 1.2, cached=0.06),
    },
    {
        "model": "moonshotai/kimi-k3",
        "base_url": _OPENROUTER,
        "client": "kimi-k3",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1048576,
        "pricing": _usd(3.0, 15.0, cached=0.3),
    },
    {
        "model": "moonshotai/kimi-k2.6",
        "base_url": _OPENROUTER,
        "client": "kimi-k2.6",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 262144,
        "pricing": _usd(0.684, 3.42, cached=0.144),
    },
    {
        "model": "nvidia/nemotron-3-ultra-550b-a55b:free",
        "base_url": _OPENROUTER,
        "client": "openai-responses",
        "input_modalities": ["Text"],
        "output_modalities": ["Text"],
        "context_window": 1000000,
        "pricing": _usd(0.0, 0.0),
    },
    {
        # models API 2026-09-09, default OpenAI endpoint, no discount: $10 input, $50 output,
        # $1 cache read, $12.5 cache write per 1M tokens
        "model": "openai/gpt-6-astra",
        "base_url": _OPENROUTER,
        "client": "openai-responses",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1050000,
        "pricing": _usd(12.5, 50.0, cached=1.0),
    },
    {
        "model": "openai/gpt-5.6-sol",
        "base_url": _OPENROUTER,
        "client": "openai-responses",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1050000,
        "pricing": _usd(2.5, 15.0, cached=0.25),
    },
    {
        "model": "openai/gpt-5.6-terra",
        "base_url": _OPENROUTER,
        "client": "openai-responses",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1050000,
        "pricing": _usd(2.0, 12.0, cached=0.2),
    },
    {
        "model": "openai/gpt-5.6-luna",
        "base_url": _OPENROUTER,
        "client": "openai-responses",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1050000,
        "pricing": _usd(0.2, 1.2, cached=0.02),
    },
    {
        "model": "openai/gpt-5.5",
        "base_url": _OPENROUTER,
        "client": "openai-responses",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1050000,
        "pricing": _usd(5.0, 30.0, cached=0.5),
    },
    {
        "model": "qwen/qwen3.6-35b-a3b",
        "base_url": _OPENROUTER,
        "client": "openai-responses",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 262144,
        "pricing": _usd(0.14, 1.0),
    },
    {
        "model": "qwen/qwen3-embedding-4b",
        "base_url": _OPENROUTER,
        "client": "openai-embedding",
        "input_modalities": ["Text"],
        "output_modalities": ["Embed"],
        "context_window": 32768,
        "pricing": _usd(0.02, 0.0),
    },
    {
        "model": "stepfun/step-3.7-flash",
        "base_url": _OPENROUTER,
        "client": "openai-responses",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 262144,
        "pricing": _usd(0.2, 1.15, cached=0.04),
    },
    {
        "model": "tencent/hy3",
        "base_url": _OPENROUTER,
        "client": "openai-responses",
        "input_modalities": ["Text"],
        "output_modalities": ["Text"],
        "context_window": 262144,
        "pricing": _usd(0.14, 0.58, cached=0.035),
    },
    {
        "model": "x-ai/grok-4.5",
        "base_url": _OPENROUTER,
        "client": "openai-responses",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 500000,
        "pricing": _usd(2.0, 6.0, cached=0.3),
    },
    {
        "model": "xiaomi/mimo-v2.5",
        "base_url": _OPENROUTER,
        "client": "openai-responses",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 1050000,
        "pricing": _usd(0.14, 0.28, cached=0.0028),
    },
    {
        "model": "z-ai/glm-5.3",
        "base_url": _OPENROUTER,
        "client": "glm-5.3",
        "input_modalities": ["Text"],
        "output_modalities": ["Text"],
        "context_window": 1048576,
        "pricing": _usd(1.4, 4.4, cached=0.26),
    },
    {
        "model": "z-ai/glm-5.2",
        "base_url": _OPENROUTER,
        "client": "glm-5.2",
        "input_modalities": ["Text"],
        "output_modalities": ["Text"],
        "context_window": 1048576,
        "pricing": _usd(0.966, 3.036, cached=0.1932),
    },
    {
        "model": "z-ai/glm-5.1",
        "base_url": _OPENROUTER,
        "client": "glm-5.1",
        "input_modalities": ["Text"],
        "output_modalities": ["Text"],
        "context_window": 204800,
        "pricing": _usd(0.966, 3.036, cached=0.1794),
    },
    # SiliconFlow (official CNY price lists pre-converted to USD; no public pricing API)
    {
        "model": "deepseek-ai/DeepSeek-V4-Flash",
        "base_url": _SILICONFLOW,
        "client": "openai-chat",
        "input_modalities": ["Text"],
        "output_modalities": ["Text"],
        "context_window": 1000000,
        "pricing": _cny(1.0, 2.0, cached=0.02),
    },
    {
        "model": "deepseek-ai/DeepSeek-V4-Pro",
        "base_url": _SILICONFLOW,
        "client": "openai-chat",
        "input_modalities": ["Text"],
        "output_modalities": ["Text"],
        "context_window": 1000000,
        "pricing": _cny(12.0, 24.0, cached=0.1),
    },
    {
        "model": "meituan-longcat/LongCat-2.0",
        "base_url": _SILICONFLOW,
        "client": "openai-chat",
        "input_modalities": ["Text"],
        "output_modalities": ["Text"],
        "context_window": 1000000,
        "pricing": _cny(5.0, 20.0, cached=0.1),
    },
    {
        "model": "moonshotai/Kimi-K2.7-Code",
        "base_url": _SILICONFLOW,
        "client": "openai-chat",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 262144,
        "pricing": _cny(6.5, 27.0, cached=1.3),
    },
    {
        "model": "zai-org/GLM-5.2",
        "base_url": _SILICONFLOW,
        "client": "glm-5.2",
        "input_modalities": ["Text"],
        "output_modalities": ["Text"],
        "context_window": 1000000,
        "pricing": _cny(8.0, 28.0, cached=2.0),
    },
    {
        "model": "Pro/zai-org/GLM-5.1",
        "base_url": _SILICONFLOW,
        "client": "glm-5.1",
        "input_modalities": ["Text"],
        "output_modalities": ["Text"],
        "context_window": 200000,
    },
    {
        "model": "Pro/moonshotai/Kimi-K2.6",
        "base_url": _SILICONFLOW,
        "client": "kimi-k2.6",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 262144,
    },
    {
        "model": "Qwen/Qwen3.6-35B-A3B",
        "base_url": _SILICONFLOW,
        "client": "openai-chat",
        "input_modalities": ["Text", "Image"],
        "output_modalities": ["Text"],
        "context_window": 262144,
    },
    {
        "model": "Qwen/Qwen3-Embedding-8B",
        "base_url": _SILICONFLOW,
        "client": "openai-embedding",
        "input_modalities": ["Text"],
        "output_modalities": ["Embed"],
    },
]


def _convert_pricing(pricing: ModelPricing, currency: Currency) -> ModelPricing:
    if currency == "USD":
        return dict(pricing)

    converted: ModelPricing = {
        "currency": "CNY",
        "prompt_tokens": 0.0,
        "thoughts_tokens": 0.0,
        "response_tokens": 0.0,
    }
    for key in ("prompt_tokens", "thoughts_tokens", "response_tokens", "cached_tokens"):
        if key in pricing:
            converted[key] = round(pricing[key] * _CNY_PER_USD, 6)
    return converted


def list_supported_models(currency: Currency = "USD") -> list[SupportedModel]:
    """List supported models with base URL, client, modalities, context window, and pricing.

    Covers the official vendor endpoints plus the OpenRouter and SiliconFlow platforms;
    ``client`` is the ``client_type`` token that routes the model to its protocol client.
    Prices are per million tokens for AgentHub's usage buckets (cached_tokens,
    prompt_tokens, thoughts_tokens, response_tokens), stored in USD and converted to
    ``currency`` at 7 CNY/USD on request.
    """
    entries: list[SupportedModel] = []
    for entry in _SUPPORTED_MODELS:
        copied = dict(entry)
        copied["input_modalities"] = list(entry["input_modalities"])
        copied["output_modalities"] = list(entry["output_modalities"])
        if "pricing" in entry:
            copied["pricing"] = _convert_pricing(entry["pricing"], currency)
        entries.append(copied)
    return entries
