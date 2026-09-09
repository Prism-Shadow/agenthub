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

from typing import Any

import pytest
from google.genai import types

from agenthub import AutoLLMClient, ThinkingLevel


# Not every Gemini model accepts every thinking level (verified live 2026-07-24;
# see llmsdk_docs/gemini3/docs/thinking.md): pro models reject "minimal"
# (gemini-3-pro also "medium") and image models accept only "minimal" and
# "high". Unsupported levels must clamp to the closest supported one, never error.
GEMINI3_THINKING_LEVEL_CASES = [
    ("gemini-3.1-pro-preview", ThinkingLevel.NONE, types.ThinkingLevel.LOW),
    ("gemini-3.1-pro-preview", ThinkingLevel.LOW, types.ThinkingLevel.LOW),
    ("gemini-3.1-pro-preview", ThinkingLevel.MEDIUM, types.ThinkingLevel.MEDIUM),
    ("gemini-3.1-pro-preview", ThinkingLevel.HIGH, types.ThinkingLevel.HIGH),
    ("gemini-3.1-pro-preview", ThinkingLevel.XHIGH, types.ThinkingLevel.HIGH),
    ("gemini-3.1-pro-preview", ThinkingLevel.MAX, types.ThinkingLevel.HIGH),
    ("gemini-3-pro-preview", ThinkingLevel.NONE, types.ThinkingLevel.LOW),
    ("gemini-3-pro-preview", ThinkingLevel.MEDIUM, types.ThinkingLevel.HIGH),
    ("gemini-3.1-flash-image", ThinkingLevel.NONE, types.ThinkingLevel.MINIMAL),
    ("gemini-3.1-flash-image", ThinkingLevel.LOW, types.ThinkingLevel.MINIMAL),
    ("gemini-3.1-flash-image", ThinkingLevel.MEDIUM, types.ThinkingLevel.HIGH),
    # "-image" wins over "gemini-3-pro" (LOW would stay LOW under the pro set).
    ("gemini-3-pro-image", ThinkingLevel.LOW, types.ThinkingLevel.MINIMAL),
    ("gemini-3-flash-preview", ThinkingLevel.NONE, types.ThinkingLevel.MINIMAL),
    ("gemini-3.5-flash", ThinkingLevel.MEDIUM, types.ThinkingLevel.MEDIUM),
    # A future pro generation falls into the generic "-pro" branch.
    ("gemini-4-pro", ThinkingLevel.NONE, types.ThinkingLevel.LOW),
    # An unrecognized model inherits the full four-level default.
    ("gemini-9-flash", ThinkingLevel.NONE, types.ThinkingLevel.MINIMAL),
]


def _create_gemini3_auto_client(model: str) -> AutoLLMClient:
    # client_type pins routing so hypothetical model names reach the unified
    # Gemini3_8Client the same way an explicit override would in user code.
    return AutoLLMClient(model=model, api_key="test-key", client_type="gemini-3")


@pytest.mark.parametrize(("model", "level", "expected"), GEMINI3_THINKING_LEVEL_CASES)
def test_gemini3_thinking_level_clamps_to_model_support(
    model: str, level: ThinkingLevel, expected: types.ThinkingLevel | None
):
    client = _create_gemini3_auto_client(model)
    assert client._client._convert_thinking_level(level) == expected  # noqa: SLF001


def test_gemini3_thinking_config_carries_clamped_level():
    client = _create_gemini3_auto_client("gemini-3.1-pro-preview")
    config = client._client.transform_uni_config_to_model_config(  # noqa: SLF001
        {"thinking_level": ThinkingLevel.NONE}
    )
    assert config.thinking_config.thinking_level == types.ThinkingLevel.LOW


# The 3.7 and 3.8 generations drop "minimal" (3.7 verified live 2026-08-13, see
# llmsdk_docs/gemini3_8/docs/thinking.md; 3.8 documented at
# ai.google.dev/gemini-api/docs/latest-model); the 3.6-generation models routed
# to the same client keep the full four-level set.
GEMINI3_7_THINKING_LEVEL_CASES = [
    ("gemini-3.8-flash", ThinkingLevel.NONE, types.ThinkingLevel.LOW),
    ("gemini-3.8-flash", ThinkingLevel.MAX, types.ThinkingLevel.HIGH),
    ("gemini-3.7-flash", ThinkingLevel.NONE, types.ThinkingLevel.LOW),
    ("gemini-3.7-flash", ThinkingLevel.LOW, types.ThinkingLevel.LOW),
    ("gemini-3.7-flash", ThinkingLevel.MEDIUM, types.ThinkingLevel.MEDIUM),
    ("gemini-3.7-flash", ThinkingLevel.HIGH, types.ThinkingLevel.HIGH),
    ("gemini-3.7-flash", ThinkingLevel.XHIGH, types.ThinkingLevel.HIGH),
    # Gemini has no level above "high", so MAX clamps there too.
    ("gemini-3.7-flash", ThinkingLevel.MAX, types.ThinkingLevel.HIGH),
    ("gemini-3.6-flash", ThinkingLevel.NONE, types.ThinkingLevel.MINIMAL),
    ("gemini-3.5-flash-lite", ThinkingLevel.NONE, types.ThinkingLevel.MINIMAL),
]


@pytest.mark.parametrize(("model", "level", "expected"), GEMINI3_7_THINKING_LEVEL_CASES)
def test_gemini3_8_thinking_level_clamps_to_model_support(
    model: str, level: ThinkingLevel, expected: types.ThinkingLevel
):
    # These are real model ids, so automatic routing reaches Gemini3_8Client directly.
    client = AutoLLMClient(model=model, api_key="test-key")
    assert client._client.__class__.__name__ == "Gemini3_8Client"
    assert client._client._convert_thinking_level(level) == expected  # noqa: SLF001


# GLM-5.3 cannot disable thinking and accepts only low/high/max reasoning_effort
# (llmsdk_docs/glm5_3/docs/thinking.md); GLM-5.2
# keeps the full pass-through vocabulary and pre-5.2 models take no effort parameter.
GLM_THINKING_LEVEL_CASES = [
    ("glm-5.3", ThinkingLevel.NONE, "enabled", "low"),
    ("glm-5.3", ThinkingLevel.LOW, "enabled", "low"),
    ("glm-5.3", ThinkingLevel.MEDIUM, "enabled", "high"),
    ("glm-5.3", ThinkingLevel.HIGH, "enabled", "high"),
    ("glm-5.3", ThinkingLevel.XHIGH, "enabled", "max"),
    ("glm-5.3", ThinkingLevel.MAX, "enabled", "max"),
    ("glm-5.3-flash", ThinkingLevel.MAX, "enabled", "max"),
    ("glm-5.2", ThinkingLevel.NONE, "disabled", None),
    ("glm-5.2", ThinkingLevel.MEDIUM, "enabled", "medium"),
    ("glm-5.2", ThinkingLevel.XHIGH, "enabled", "xhigh"),
    ("glm-5.2", ThinkingLevel.MAX, "enabled", "max"),
    ("glm-5.1", ThinkingLevel.NONE, "disabled", None),
    ("glm-5.1", ThinkingLevel.HIGH, "enabled", "high"),
    # Provider-hosted ids keep their own casing (SiliconFlow), so generation
    # detection must be case-insensitive.
    ("zai-org/GLM-5.2", ThinkingLevel.XHIGH, "enabled", "xhigh"),
    ("Pro/zai-org/GLM-5.1", ThinkingLevel.HIGH, "enabled", "high"),
]


@pytest.mark.parametrize(("model", "level", "thinking_type", "effort"), GLM_THINKING_LEVEL_CASES)
def test_glm_thinking_level_maps_per_generation(
    model: str, level: ThinkingLevel, thinking_type: str, effort: str | None
):
    client = AutoLLMClient(model=model, api_key="test-key")
    assert client._client.__class__.__name__ == "GLM5_3Client"
    config = client._client.transform_uni_config_to_model_config({"thinking_level": level})  # noqa: SLF001
    assert config["extra_body"]["thinking"]["type"] == thinking_type
    assert config.get("reasoning_effort") == effort


# What each remaining client puts on the wire for a level, per its vendor's effort
# vocabulary: OpenAI takes the full set except on GPT-6, which rejects "none" and
# "minimal" so NONE degrades to low; Claude tops out at max (xhigh only from 4.7),
# DeepSeek and Kimi accept low/high/max, DeepSeek turns thinking off with none, and
# MiniMax has no level above high.
THINKING_EFFORT_CASES = [
    ("gpt-6-astra", None, ThinkingLevel.NONE, "low"),
    ("gpt-6-astra", None, ThinkingLevel.LOW, "low"),
    ("gpt-6-astra", None, ThinkingLevel.MAX, "max"),
    # a gateway serving GPT-6 forwards the effort to OpenAI, so the generic Responses
    # client degrades NONE the same way
    ("gpt-6-astra", "openai-responses", ThinkingLevel.NONE, "low"),
    ("gpt-6-astra", "openai-responses", ThinkingLevel.LOW, "low"),
    ("gpt-6-astra", "openai-responses", ThinkingLevel.MAX, "max"),
    ("gpt-5.6", None, ThinkingLevel.NONE, "none"),
    ("gpt-5.6", None, ThinkingLevel.XHIGH, "xhigh"),
    ("gpt-5.6", None, ThinkingLevel.MAX, "max"),
    ("gpt-5.6", "openai-responses", ThinkingLevel.MAX, "max"),
    ("claude-sonnet-5", None, ThinkingLevel.XHIGH, "xhigh"),
    ("claude-sonnet-5", None, ThinkingLevel.MAX, "max"),
    # 4.6 has no xhigh but does take max.
    ("claude-sonnet-4-6", None, ThinkingLevel.XHIGH, "high"),
    ("claude-sonnet-4-6", None, ThinkingLevel.MAX, "max"),
    ("claude-sonnet-5", "ant-messages", ThinkingLevel.MAX, "max"),
    ("deepseek-v4", None, ThinkingLevel.NONE, "none"),
    ("deepseek-v4", None, ThinkingLevel.LOW, "low"),
    ("deepseek-v4", None, ThinkingLevel.MEDIUM, "high"),
    ("deepseek-v4", None, ThinkingLevel.HIGH, "high"),
    # DeepSeek maps xhigh onto high server-side, so the client sends high.
    ("deepseek-v4", None, ThinkingLevel.XHIGH, "high"),
    ("deepseek-v4", None, ThinkingLevel.MAX, "max"),
    ("kimi-k3", None, ThinkingLevel.LOW, "low"),
    ("kimi-k3", None, ThinkingLevel.MEDIUM, "high"),
    ("kimi-k3", None, ThinkingLevel.XHIGH, "max"),
    ("kimi-k3", None, ThinkingLevel.MAX, "max"),
    ("MiniMax-M3", "minimax-m3", ThinkingLevel.XHIGH, "high"),
    ("MiniMax-M3", "minimax-m3", ThinkingLevel.MAX, "high"),
]


def _wire_effort(config: dict) -> str | None:
    """Read the effort out of whichever config key the client used."""
    if "reasoning" in config:
        return config["reasoning"].get("effort")
    if "output_config" in config:
        return config["output_config"].get("effort")
    return config.get("reasoning_effort")


@pytest.mark.parametrize(("model", "client_type", "level", "expected"), THINKING_EFFORT_CASES)
def test_thinking_level_maps_to_vendor_effort(
    model: str, client_type: str | None, level: ThinkingLevel, expected: str | None
):
    client = AutoLLMClient(model=model, api_key="test-key", client_type=client_type)
    config = client._client.transform_uni_config_to_model_config({"thinking_level": level})  # noqa: SLF001
    assert _wire_effort(config) == expected


# thinking_summary reaches the wire on its own, not only when a thinking_level rides with
# it. Each protocol spells the switch differently: Anthropic puts it on thinking.display,
# the Responses API on reasoning.summary, and Gemini on thinking_config.include_thoughts.
THINKING_SUMMARY_CASES: list[tuple[str, str | None, dict[str, Any], Any]] = [
    ("claude-sonnet-5", None, {"thinking_summary": True}, "summarized"),
    ("claude-sonnet-5", None, {"thinking_summary": False}, "omitted"),
    ("claude-sonnet-5", None, {"thinking_summary": True, "thinking_level": ThinkingLevel.NONE}, "summarized"),
    ("claude-sonnet-5", None, {"thinking_summary": True, "thinking_level": ThinkingLevel.MAX}, "summarized"),
    ("claude-sonnet-5", "ant-messages", {"thinking_summary": True}, "summarized"),
    ("claude-sonnet-5", "ant-messages", {"thinking_summary": False}, "omitted"),
    # The Messages API disables thinking for NONE and rejects display on a disabled block,
    # so that one combination leaves no thinking to summarize.
    ("claude-sonnet-5", "ant-messages", {"thinking_summary": True, "thinking_level": ThinkingLevel.NONE}, None),
    ("deepseek-v4", None, {"thinking_summary": True}, "concise"),
    ("deepseek-v4", None, {"thinking_summary": True, "thinking_level": ThinkingLevel.NONE}, "concise"),
    ("gpt-5.6", None, {"thinking_summary": True}, "concise"),
    # OpenRouter reads an effort-less reasoning object as "reasoning disabled", so the
    # generic Responses client alone keeps the summary tied to a level.
    ("gpt-5.6", "openai-responses", {"thinking_summary": True}, None),
    ("gemini-3.8-flash", None, {"thinking_summary": True}, True),
    ("gemini-3.8-flash", None, {"thinking_summary": False}, False),
]


def _wire_thinking_summary(config: Any) -> Any:
    """Read the thinking-summary switch out of whichever field the client used."""
    thinking_config = getattr(config, "thinking_config", None)
    if thinking_config is not None:
        return thinking_config.include_thoughts
    if "reasoning" in config:
        return config["reasoning"].get("summary")
    return (config.get("thinking") or {}).get("display")


@pytest.mark.parametrize(("model", "client_type", "uni_config", "expected"), THINKING_SUMMARY_CASES)
def test_thinking_summary_reaches_the_wire(
    model: str, client_type: str | None, uni_config: dict[str, Any], expected: Any
):
    client = AutoLLMClient(model=model, api_key="test-key", client_type=client_type)
    config = client._client.transform_uni_config_to_model_config(uni_config)  # noqa: SLF001
    assert _wire_thinking_summary(config) == expected


# vLLM hands chat_template_kwargs to the served model's own chat template, so the switch
# differs per model. The shapes come from the artifacts snapshotted in
# llmsdk_docs/openai_chat_vllm_adapter/: Qwen3 reads a single enable_thinking boolean; the
# two Qwen3.8 models share one template that takes reasoning_effort (low/medium/xhigh
# only); and DeepSeek V4 reads a thinking flag paired with reasoning_effort, which its Pro
# and Flash encoder narrows to high/max while Flash-Vision-Exp also accepts low. Absent
# kwargs are how DeepSeek reads as off. Levels the model does not offer clamp to the
# closest one it does; a model outside the table falls back to Qwen3's boolean. None as
# the expectation means the request carries no kwargs at all.
VLLM_THINKING_LEVEL_CASES = [
    ("Qwen/Qwen3.6-35B-A3B", ThinkingLevel.NONE, {"enable_thinking": False}),
    ("Qwen/Qwen3.6-35B-A3B", ThinkingLevel.LOW, {"enable_thinking": True}),
    ("Qwen/Qwen3.6-35B-A3B", ThinkingLevel.MAX, {"enable_thinking": True}),
    ("Qwen/Qwen3.8-Flash-Next", ThinkingLevel.NONE, {"enable_thinking": False}),
    ("Qwen/Qwen3.8-Flash-Next", ThinkingLevel.LOW, {"reasoning_effort": "low"}),
    ("Qwen/Qwen3.5-0.8B", ThinkingLevel.NONE, {"enable_thinking": False}),
    ("Qwen/Qwen3.5-9B", ThinkingLevel.MEDIUM, {"enable_thinking": True}),
    ("Qwen/Qwen3.8-27B", ThinkingLevel.NONE, {"enable_thinking": False}),
    ("Qwen/Qwen3.8-27B", ThinkingLevel.LOW, {"reasoning_effort": "low"}),
    ("Qwen/Qwen3.8-27B", ThinkingLevel.MEDIUM, {"reasoning_effort": "medium"}),
    ("Qwen/Qwen3.8-27B", ThinkingLevel.HIGH, {"reasoning_effort": "xhigh"}),
    ("Qwen/Qwen3.8-27B", ThinkingLevel.XHIGH, {"reasoning_effort": "xhigh"}),
    ("Qwen/Qwen3.8-27B", ThinkingLevel.MAX, {"reasoning_effort": "xhigh"}),
    ("deepseek-ai/DeepSeek-V4-Pro", ThinkingLevel.NONE, None),
    ("deepseek-ai/DeepSeek-V4-Pro", ThinkingLevel.LOW, {"thinking": True, "reasoning_effort": "high"}),
    ("deepseek-ai/DeepSeek-V4-Pro", ThinkingLevel.MEDIUM, {"thinking": True, "reasoning_effort": "high"}),
    ("deepseek-ai/DeepSeek-V4-Pro", ThinkingLevel.HIGH, {"thinking": True, "reasoning_effort": "high"}),
    ("deepseek-ai/DeepSeek-V4-Pro", ThinkingLevel.XHIGH, {"thinking": True, "reasoning_effort": "high"}),
    ("deepseek-ai/DeepSeek-V4-Pro", ThinkingLevel.MAX, {"thinking": True, "reasoning_effort": "max"}),
    ("deepseek-ai/DeepSeek-V4-Flash", ThinkingLevel.LOW, {"thinking": True, "reasoning_effort": "high"}),
    ("deepseek-ai/DeepSeek-V4-Flash-Vision-Exp", ThinkingLevel.NONE, None),
    ("deepseek-ai/DeepSeek-V4-Flash-Vision-Exp", ThinkingLevel.LOW, {"thinking": True, "reasoning_effort": "low"}),
    ("deepseek-ai/DeepSeek-V4-Flash-Vision-Exp", ThinkingLevel.HIGH, {"thinking": True, "reasoning_effort": "high"}),
    ("meta-llama/Llama-4-70B", ThinkingLevel.NONE, {"enable_thinking": False}),
    ("meta-llama/Llama-4-70B", ThinkingLevel.HIGH, {"enable_thinking": True}),
]


@pytest.mark.parametrize(("model", "level", "expected"), VLLM_THINKING_LEVEL_CASES)
def test_openai_chat_vllm_adapter_thinking_level_maps_to_chat_template_kwargs(
    model: str, level: ThinkingLevel, expected: dict | None
):
    client = AutoLLMClient(
        model=model,
        api_key="test-key",
        base_url="http://localhost:8000/v1",
        client_type="openai-chat-vllm-adapter",
    )
    config = client._client.transform_uni_config_to_model_config({"thinking_level": level})  # noqa: SLF001
    assert config.get("chat_template_kwargs") == expected


def test_openai_chat_vllm_adapter_omits_chat_template_kwargs_without_thinking_level():
    client = AutoLLMClient(
        model="Qwen/Qwen3.6-35B-A3B",
        api_key="test-key",
        client_type="openai-chat-vllm-adapter",
    )
    config = client._client.transform_uni_config_to_model_config({})  # noqa: SLF001
    assert "chat_template_kwargs" not in config


def test_openai_chat_does_not_receive_the_vllm_extension():
    client = AutoLLMClient(
        model="Qwen/Qwen3.6-35B-A3B",
        api_key="test-key",
        client_type="openai-chat",
    )
    config = client._client.transform_uni_config_to_model_config(  # noqa: SLF001
        {"thinking_level": ThinkingLevel.NONE}
    )
    assert "chat_template_kwargs" not in config
