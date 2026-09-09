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

import base64
import json
import mimetypes
import os
from dataclasses import dataclass
from typing import Literal

import httpx
import pytest

from agenthub import AutoLLMClient, ThinkingLevel, list_supported_models


IMAGE = "https://sghimages.shobserver.com/img/catch/2022/01/22/c1ae0300-9402-4128-a7e6-1244d3874167.jpg"
IMAGE_KEYWORDS = ("flower", "narcissus", "daffodil", "bloom")


@dataclass
class Model:
    name: str
    support_text: bool = True
    support_image_understanding: bool = True
    support_image_generation: bool = False
    support_tts: bool = False
    support_embedding: bool = False
    provider: Literal[
        "official", "bedrock", "vertex", "siliconflow", "openrouter", "modelverse", "deepseek", "zai", "minimax"
    ] = "official"
    client_type: str | None = None
    base_url: str | None = None

    def __repr__(self) -> str:
        if self.client_type is not None:
            return f"{self.name}:{self.provider}:{self.client_type}"

        return f"{self.name}:{self.provider}"


AVAILABLE_MODELS: list[Model] = []

if os.getenv("GEMINI_API_KEY"):
    AVAILABLE_MODELS.append(Model(name="gemini-3.8-flash"))
    AVAILABLE_MODELS.append(
        Model(
            name="gemini-3.1-flash-image",
            support_text=False,
            support_image_understanding=False,
            support_image_generation=True,
        )
    )
    AVAILABLE_MODELS.append(
        Model(
            name="gemini-3.1-flash-tts-preview",
            support_text=False,
            support_image_understanding=False,
            support_tts=True,
        )
    )
    AVAILABLE_MODELS.append(
        Model(
            name="gemini-embedding-2",
            support_text=False,
            support_image_understanding=False,
            support_embedding=True,
        )
    )

if os.getenv("ANTHROPIC_API_KEY"):
    AVAILABLE_MODELS.append(Model(name="claude-sonnet-5"))

if os.getenv("OPENAI_API_KEY"):
    AVAILABLE_MODELS.append(Model(name="gpt-5.6-luna"))
    AVAILABLE_MODELS.append(
        Model(
            name="text-embedding-3-large",
            support_text=False,
            support_image_understanding=False,
            support_embedding=True,
            client_type="openai-embedding",
        )
    )

# per-protocol base URLs for the generic protocol clients (Z.AI entries use the
# GLM Coding Plan base URLs)
_PROTOCOL_MODES = ["openai-chat", "openai-responses", "ant-messages"]
_PROTOCOL_BASE_URLS = {
    "deepseek": {
        "openai-chat": "https://api.deepseek.com",
        "openai-responses": "https://api.deepseek.com",
        "ant-messages": "https://api.deepseek.com/anthropic",
    },
    "zai": {
        "openai-chat": "https://api.z.ai/api/coding/paas/v4",
        "openai-responses": "https://api.z.ai/api/v1",
        "ant-messages": "https://api.z.ai/api/anthropic",
    },
    "minimax": {
        "openai-chat": "https://api.minimax.io/v1",
        "openai-responses": "https://api.minimax.io/v1",
        "ant-messages": "https://api.minimax.io/anthropic",
    },
    "openrouter": {
        "openai-chat": "https://openrouter.ai/api/v1",
        "openai-responses": "https://openrouter.ai/api/v1",
        "ant-messages": "https://openrouter.ai/api",
    },
}

if os.getenv("ZAI_API_KEY"):
    AVAILABLE_MODELS.append(Model(name="glm-5.3-flash"))

if os.getenv("MOONSHOT_API_KEY"):
    AVAILABLE_MODELS.append(Model(name="kimi-k3"))

if os.getenv("MINIMAX_API_KEY"):
    AVAILABLE_MODELS.append(Model(name="MiniMax-M3", client_type="minimax-m3"))

if os.getenv("DEEPSEEK_API_KEY"):
    AVAILABLE_MODELS.append(Model(name="deepseek-v4-flash-vision-exp"))
    for mode in _PROTOCOL_MODES:
        AVAILABLE_MODELS.append(
            Model(
                name="deepseek-v4-flash",
                provider="deepseek",
                client_type=mode,
                base_url=_PROTOCOL_BASE_URLS["deepseek"][mode],
                support_image_understanding=False,
            )
        )

if os.getenv("BEDROCK_API_KEY"):
    AVAILABLE_MODELS.append(Model(name="global.anthropic.claude-sonnet-4-6", provider="bedrock"))

if os.getenv("VERTEX_API_KEY"):
    AVAILABLE_MODELS.append(Model(name="gemini-3.8-flash", provider="vertex"))
    AVAILABLE_MODELS.append(
        Model(
            name="gemini-3.1-flash-image",
            provider="vertex",
            support_text=False,
            support_image_understanding=False,
            support_image_generation=True,
        )
    )
    AVAILABLE_MODELS.append(
        Model(
            name="gemini-3.1-flash-tts-preview",
            provider="vertex",
            support_text=False,
            support_image_understanding=False,
            support_tts=True,
        )
    )

RUN_SLOW_TEST = os.getenv("RUN_SLOW_TEST", "0") == "1"

if os.getenv("ZAI_API_KEY") and RUN_SLOW_TEST:
    for mode in _PROTOCOL_MODES:
        # Z.AI's Anthropic-compatible gateway defaults to thinking disabled when a request
        # carries no thinking config, which glm-5.3 rejects because it cannot disable
        # thinking; that protocol stays on glm-5.2
        AVAILABLE_MODELS.append(
            Model(
                name="glm-5.2" if mode == "ant-messages" else "glm-5.3",
                provider="zai",
                client_type=mode,
                base_url=_PROTOCOL_BASE_URLS["zai"][mode],
                support_image_understanding=False,
            )
        )

if os.getenv("MINIMAX_API_KEY") and RUN_SLOW_TEST:
    for mode in _PROTOCOL_MODES:
        AVAILABLE_MODELS.append(
            Model(
                name="MiniMax-M3",
                provider="minimax",
                client_type=mode,
                base_url=_PROTOCOL_BASE_URLS["minimax"][mode],
            )
        )

if os.getenv("OPENROUTER_API_KEY") and RUN_SLOW_TEST:
    for mode in _PROTOCOL_MODES:
        AVAILABLE_MODELS.append(
            Model(
                name="openai/gpt-5.6-luna",
                provider="openrouter",
                client_type=mode,
                base_url=_PROTOCOL_BASE_URLS["openrouter"][mode],
            )
        )
    AVAILABLE_MODELS.append(Model(name="z-ai/glm-5.3", provider="openrouter", support_image_understanding=False))
    AVAILABLE_MODELS.append(Model(name="qwen/qwen3.6-35b-a3b", provider="openrouter", client_type="openai-responses"))
    AVAILABLE_MODELS.append(
        Model(
            name="qwen/qwen3-embedding-4b",
            support_text=False,
            support_image_understanding=False,
            support_embedding=True,
            provider="openrouter",
            client_type="openai-embedding",
        )
    )
    AVAILABLE_MODELS.append(Model(name="moonshotai/kimi-k3", provider="openrouter"))

if os.getenv("SILICONFLOW_API_KEY") and RUN_SLOW_TEST:
    AVAILABLE_MODELS.append(Model(name="zai-org/GLM-5.2", provider="siliconflow", support_image_understanding=False))
    AVAILABLE_MODELS.append(Model(name="Qwen/Qwen3.6-35B-A3B", provider="siliconflow", client_type="openai-chat"))
    AVAILABLE_MODELS.append(Model(name="Pro/moonshotai/Kimi-K2.6", provider="siliconflow"))
    AVAILABLE_MODELS.append(
        Model(
            name="Qwen/Qwen3-Embedding-8B",
            support_text=False,
            support_image_understanding=False,
            support_embedding=True,
            provider="siliconflow",
            client_type="openai-embedding",
        )
    )

if os.getenv("MODELVERSE_API_KEY") and RUN_SLOW_TEST:
    AVAILABLE_MODELS.append(
        Model(name="claude-sonnet-4-6", provider="modelverse", base_url="https://api.modelverse.cn/")
    )
    AVAILABLE_MODELS.append(Model(name="gpt-5.5", provider="modelverse"))


_PROVIDER_API_KEY_ENVS = {
    "bedrock": "BEDROCK_API_KEY",
    "vertex": "VERTEX_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "siliconflow": "SILICONFLOW_API_KEY",
    "modelverse": "MODELVERSE_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "zai": "ZAI_API_KEY",
    "minimax": "MINIMAX_API_KEY",
}

_PROVIDER_BASE_URLS = {
    "bedrock": "bedrock://us-east-1",
    "openrouter": "https://openrouter.ai/api/v1",
    "siliconflow": "https://api.siliconflow.cn/v1",
    "modelverse": "https://api.modelverse.cn/v1",
}


async def _create_client(model: Model) -> AutoLLMClient:
    """Create a client for the given model."""
    key_env = _PROVIDER_API_KEY_ENVS.get(model.provider)
    api_key = os.getenv(key_env) if key_env else None
    base_url = model.base_url or _PROVIDER_BASE_URLS.get(model.provider)

    return AutoLLMClient(model=model.name, api_key=api_key, base_url=base_url, client_type=model.client_type)


async def _check_event_integrity(event: dict) -> None:
    """Check event integrity."""
    assert "role" in event
    assert "event_type" in event
    assert "usage_metadata" in event
    assert "finish_reason" in event
    assert event["role"] in ["user", "assistant"]
    assert event["event_type"] in ["start", "delta", "stop"]
    assert event["finish_reason"] in ["stop", "length", "tool_call", "unknown", None]
    assert isinstance(event["created_at"], int) and event["created_at"] > 0
    for item in event["content_items"]:
        if item["type"] == "text":
            assert isinstance(item["text"], str)
        elif item["type"] == "image_url":
            assert isinstance(item["image_url"], str)
        elif item["type"] == "inline_data":
            assert isinstance(item["data"], bytes)
            assert isinstance(item["mime_type"], str)
        elif item["type"] == "thinking":
            assert isinstance(item["thinking"], str)
        elif item["type"] == "inline_thinking":
            assert isinstance(item["data"], bytes)
            assert isinstance(item["mime_type"], str)
        elif item["type"] == "tool_call":
            assert isinstance(item["name"], str)
            assert isinstance(item["arguments"], dict)
            assert isinstance(item["tool_call_id"], str)
        elif item["type"] == "partial_tool_call":
            assert isinstance(item["name"], str)
            assert isinstance(item["arguments"], str)
            assert isinstance(item["tool_call_id"], str)
        elif item["type"] == "tool_result":
            assert isinstance(item["text"], str)
            assert isinstance(item["tool_call_id"], str)

    if event["usage_metadata"]:
        assert "cached_tokens" in event["usage_metadata"]
        assert "prompt_tokens" in event["usage_metadata"]
        assert "thoughts_tokens" in event["usage_metadata"]
        assert "response_tokens" in event["usage_metadata"]

        if event["usage_metadata"]["cached_tokens"] is not None:
            assert event["usage_metadata"]["cached_tokens"] >= 0
        if event["usage_metadata"]["prompt_tokens"] is not None:
            assert event["usage_metadata"]["prompt_tokens"] >= 0
        if event["usage_metadata"]["thoughts_tokens"] is not None:
            assert event["usage_metadata"]["thoughts_tokens"] >= 0
        if event["usage_metadata"]["response_tokens"] is not None:
            assert event["usage_metadata"]["response_tokens"] >= 0


@pytest.mark.asyncio
@pytest.mark.parametrize("model", AVAILABLE_MODELS, ids=[str(model) for model in AVAILABLE_MODELS])
async def test_streaming_response_basic(model: Model):
    """Test basic stateless stream generation."""
    if not model.support_text:
        pytest.skip(f"Text generation is not supported by {model.name}.")

    client = await _create_client(model)
    messages = [{"role": "user", "content_items": [{"type": "text", "text": "What is 2+3?"}]}]
    config = {}

    text = ""
    async for event in client.streaming_response(messages=messages, config=config):
        await _check_event_integrity(event)
        for item in event["content_items"]:
            if item["type"] == "text":
                text += item["text"]

    assert "5" in text  # 2 + 3 = 5


@pytest.mark.asyncio
@pytest.mark.parametrize("model", AVAILABLE_MODELS, ids=[str(model) for model in AVAILABLE_MODELS])
async def test_streaming_response_with_all_parameters(model: Model):
    """Test stream generation with all optional parameters."""
    if not model.support_text:
        pytest.skip(f"Text generation is not supported by {model.name}.")

    client = await _create_client(model)
    messages = [{"role": "user", "content_items": [{"type": "text", "text": "What is 2+3?"}]}]
    config = {"max_tokens": 8192, "thinking_summary": True, "thinking_level": ThinkingLevel.LOW}

    text = ""
    async for event in client.streaming_response(messages=messages, config=config):
        await _check_event_integrity(event)
        for item in event["content_items"]:
            if item["type"] == "text":
                text += item["text"]

    assert "5" in text  # 2 + 3 = 5


@pytest.mark.asyncio
@pytest.mark.parametrize("model", AVAILABLE_MODELS, ids=[str(model) for model in AVAILABLE_MODELS])
async def test_streaming_response_stateful(model: Model):
    """Test stateful stream generation."""
    if not model.support_text:
        pytest.skip(f"Text generation is not supported by {model.name}.")

    client = await _create_client(model)
    config = {}

    message1 = {"role": "user", "content_items": [{"type": "text", "text": "My name is Alice"}]}
    async for event in client.streaming_response_stateful(message=message1, config=config):
        await _check_event_integrity(event)

    assert len(client.get_history()) == 2  # user message + assistant response

    message2 = {"role": "user", "content_items": [{"type": "text", "text": "What is my name?"}]}
    text = ""
    async for event in client.streaming_response_stateful(message=message2, config=config):
        await _check_event_integrity(event)
        for item in event["content_items"]:
            if item["type"] == "text":
                text += item["text"]

    assert "alice" in text.lower()
    assert len(client.get_history()) == 4  # 2 previous + 2 new


@pytest.mark.asyncio
@pytest.mark.parametrize("model", AVAILABLE_MODELS, ids=[str(model) for model in AVAILABLE_MODELS])
async def test_set_history(model: Model):
    """Test setting conversation history."""
    client = await _create_client(model)
    new_history: list = [
        {"role": "user", "content_items": [{"type": "text", "text": "Hi"}]},
        {"role": "assistant", "content_items": [{"type": "text", "text": "Hello!"}]},
    ]

    client.set_history(new_history)
    assert client.get_history() == new_history

    # Mutating the original list must not affect the stored history
    new_history.clear()
    assert len(client.get_history()) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("model", AVAILABLE_MODELS, ids=[str(model) for model in AVAILABLE_MODELS])
async def test_clear_history(model: Model):
    """Test clearing conversation history."""
    client = await _create_client(model)
    new_history: list = [
        {"role": "user", "content_items": [{"type": "text", "text": "Hello"}]},
        {"role": "assistant", "content_items": [{"type": "text", "text": "Hello!"}]},
    ]
    client.set_history(new_history)
    assert len(client.get_history()) > 0

    client.clear_history()
    assert len(client.get_history()) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("model", AVAILABLE_MODELS, ids=[str(model) for model in AVAILABLE_MODELS])
async def test_concat_uni_events_to_uni_message(model: Model):
    """Test concatenation of events into a single message."""
    if model.support_embedding:
        pytest.skip(f"Embedding model {model.name} do not need concatenation.")
    client = await _create_client(model)
    messages = [
        {
            "role": "user",
            "content_items": [{"type": "text", "text": "Say 'The quick brown fox jumps over the lazy dog.'"}],
        }
    ]
    config = {}

    events = []
    text = ""
    async for event in client.streaming_response(messages=messages, config=config):
        events.append(event)
        for item in event["content_items"]:
            if item["type"] == "text":
                text += item["text"]

    # Concatenate events to get the full message
    message = client.concat_uni_events_to_uni_message(events)
    assert message["role"] == "assistant"
    all_text = "".join(item["text"] for item in message["content_items"] if item["type"] == "text")
    assert all_text == text


@pytest.mark.asyncio
async def test_unknown_model():
    """Test that unknown models raise ValueError."""
    with pytest.raises(ValueError, match="not support"):
        AutoLLMClient(model="unknown-model")


@pytest.mark.asyncio
async def test_list_supported_models():
    """Test that the registry lists model entries accepted by AutoLLMClient."""
    entries = list_supported_models()
    kimi = next(entry for entry in entries if entry["model"] == "kimi-k3")
    assert kimi["base_url"] == "https://api.moonshot.cn/v1"
    assert kimi["client"] == "kimi-k3"
    assert kimi["context_window"] == 1048576
    assert kimi["input_modalities"] == ["Text", "Image"]
    assert kimi["output_modalities"] == ["Text"]
    # stored in USD (official CNY prices pre-converted at 7 CNY/USD)
    assert kimi["pricing"] == {
        "currency": "USD",
        "prompt_tokens": 2.857143,
        "thoughts_tokens": 14.285714,
        "response_tokens": 14.285714,
        "cached_tokens": 0.285714,
    }

    # Pricing is always the list price: Google's launch discount on the three Gemini flash
    # rows is not recorded here, so the catalog rate is what every entry reports.
    for model in ("gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"):
        gemini = next(entry for entry in entries if entry["model"] == model)
        assert gemini["client"] == "gemini-3.8"
        assert gemini["pricing"]["prompt_tokens"] == 1.5
        assert gemini["pricing"]["response_tokens"] == 7.5
        assert gemini["pricing"]["cached_tokens"] == 0.15

    kimi_cny = next(entry for entry in list_supported_models(currency="CNY") if entry["model"] == "kimi-k3")
    assert kimi_cny["pricing"]["currency"] == "CNY"
    assert kimi_cny["pricing"]["prompt_tokens"] == pytest.approx(20.0, abs=1e-4)
    assert kimi_cny["pricing"]["thoughts_tokens"] == pytest.approx(100.0, abs=1e-4)
    assert kimi_cny["pricing"]["response_tokens"] == pytest.approx(100.0, abs=1e-4)
    assert kimi_cny["pricing"]["cached_tokens"] == pytest.approx(2.0, abs=1e-4)

    glm_5_2 = next(entry for entry in entries if entry["model"] == "z-ai/glm-5.2")
    assert glm_5_2["base_url"] == "https://openrouter.ai/api/v1"
    assert glm_5_2["client"] == "glm-5.2"

    for entry in entries:
        assert {"model", "base_url", "client", "input_modalities", "output_modalities"} <= set(entry)
        client = AutoLLMClient(
            model=entry["model"], api_key="test-key", base_url=entry["base_url"], client_type=entry["client"]
        )
        assert client._client is not None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("client_type", "client_name"),
    [
        ("openai-compatible", "OpenaiChatClient"),
        ("openai-chat-compatible", "OpenaiChatClient"),
        ("openai-responses-compatible", "OpenaiResponsesClient"),
        ("ant-messages-compatible", "AntMessagesClient"),
        ("openai-embedding-compatible", "OpenaiEmbeddingClient"),
    ],
)
async def test_openai_client_type_routes(client_type: str, client_name: str):
    """Test client_type override for OpenAI-compatible models."""
    client = AutoLLMClient(model="unknown-model", api_key="test-key", client_type=client_type)

    assert client._client.__class__.__name__ == client_name


@pytest.mark.asyncio
async def test_validate_last_event_raises_on_missing_usage_metadata():
    """Test that _validate_last_event raises ValueError when usage_metadata is None."""
    valid_event = {
        "role": "assistant",
        "event_type": "stop",
        "content_items": [],
        "usage_metadata": {"cached_tokens": 0, "prompt_tokens": 10, "thoughts_tokens": None, "response_tokens": 5},
        "finish_reason": "stop",
    }
    AutoLLMClient._validate_last_event(valid_event)  # should not raise

    with pytest.raises(ValueError, match="no events"):
        AutoLLMClient._validate_last_event(None)

    with pytest.raises(ValueError, match="usage_metadata"):
        AutoLLMClient._validate_last_event({**valid_event, "usage_metadata": None})

    with pytest.raises(ValueError, match="finish_reason"):
        AutoLLMClient._validate_last_event({**valid_event, "finish_reason": None})


@pytest.mark.asyncio
@pytest.mark.parametrize("model", AVAILABLE_MODELS, ids=[str(model) for model in AVAILABLE_MODELS])
async def test_tool_use(model: Model):
    """Test tool use capability."""
    if not model.support_text:
        pytest.skip(f"Text generation is not supported by {model.name}.")

    client = await _create_client(model)

    # Define a simple weather tool
    weather_tool = {
        "name": "get_weather",
        "description": "Get the current weather in a given location",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "The city name, e.g. San Francisco",
                },
            },
            "required": ["location"],
        },
    }

    config = {"tools": [weather_tool]}
    tool_call_id = None
    partial_tool_call_data = {}

    message1 = {"role": "user", "content_items": [{"type": "text", "text": "What is the weather in San Francisco?"}]}
    async for event in client.streaming_response_stateful(message=message1, config=config):
        await _check_event_integrity(event)
        for item in event["content_items"]:
            if item["type"] == "partial_tool_call":
                if not partial_tool_call_data:
                    partial_tool_call_data = {
                        "name": item["name"],
                        "arguments": item["arguments"],
                        "tool_call_id": item["tool_call_id"],
                    }
                else:
                    partial_tool_call_data["arguments"] += item["arguments"]
            elif item["type"] == "tool_call":
                tool_name = item["name"]
                tool_arguments = item["arguments"]
                tool_call_id = item["tool_call_id"]

    # Check if a function call was made
    assert tool_name == weather_tool["name"]
    assert "location" in tool_arguments
    assert tool_call_id is not None
    assert partial_tool_call_data["name"] == tool_name
    assert partial_tool_call_data["tool_call_id"] == tool_call_id
    assert json.loads(partial_tool_call_data["arguments"]) == tool_arguments

    message2 = {
        "role": "user",
        "content_items": [
            {"type": "tool_result", "text": "It's 20 degrees in San Francisco.", "tool_call_id": tool_call_id}
        ],
    }
    text = ""
    async for event in client.streaming_response_stateful(message=message2, config=config):
        await _check_event_integrity(event)
        for item in event["content_items"]:
            if item["type"] == "text":
                text += item["text"]

    assert "20" in text


@pytest.mark.asyncio
@pytest.mark.parametrize("model", AVAILABLE_MODELS, ids=[str(model) for model in AVAILABLE_MODELS])
async def test_tool_result_mixed_with_text(model: Model):
    """A user message mixing a tool result with follow-up text.

    An agent resends an interrupted turn's tool output together with the user's next
    prompt. Vertex AI rejects a Gemini content that mixes function_response parts with
    any other kind (HTTP 400 "Requests ending with a model turn are not supported"), so
    the Gemini client splits them into separate contents; the model must still see both
    halves.
    """
    if not model.support_text:
        pytest.skip(f"Text generation is not supported by {model.name}.")

    client = await _create_client(model)

    weather_tool = {
        "name": "get_weather",
        "description": "Get the current weather in a given location",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "The city name, e.g. San Francisco",
                },
            },
            "required": ["location"],
        },
    }

    config = {"tools": [weather_tool]}
    tool_call_id = None

    message1 = {"role": "user", "content_items": [{"type": "text", "text": "What is the weather in San Francisco?"}]}
    async for event in client.streaming_response_stateful(message=message1, config=config):
        await _check_event_integrity(event)
        for item in event["content_items"]:
            if item["type"] == "tool_call":
                tool_call_id = item["tool_call_id"]
    assert tool_call_id is not None

    message2 = {
        "role": "user",
        "content_items": [
            {"type": "tool_result", "text": "It's 20 degrees in San Francisco.", "tool_call_id": tool_call_id},
            {"type": "text", "text": "Answer with the temperature, and end your reply with the exact word BANANA."},
        ],
    }
    text = ""
    async for event in client.streaming_response_stateful(message=message2, config=config):
        await _check_event_integrity(event)
        for item in event["content_items"]:
            if item["type"] == "text":
                text += item["text"]

    # "20" proves the tool result reached the model; "BANANA" proves the text riding
    # in the same universal message reached it too.
    assert "20" in text
    assert "BANANA" in text.upper()


@pytest.mark.asyncio
@pytest.mark.parametrize("model", AVAILABLE_MODELS, ids=[str(model) for model in AVAILABLE_MODELS])
async def test_system_prompt(model: Model):
    """Test system prompt capability."""
    if not model.support_text:
        pytest.skip(f"Text generation is not supported by {model.name}.")

    client = await _create_client(model)
    messages = [{"role": "user", "content_items": [{"type": "text", "text": "Hello"}]}]
    config = {
        "system_prompt": "You are a kitten. Every reply MUST contain the exact word 'meow' — "
        "never a variant like 'mreow' or a *purrs* action instead."
    }

    text = ""
    async for event in client.streaming_response(messages=messages, config=config):
        await _check_event_integrity(event)
        for item in event["content_items"]:
            if item["type"] == "text":
                text += item["text"]

    assert "meow" in text.lower()


@pytest.mark.asyncio
@pytest.mark.parametrize("model", AVAILABLE_MODELS, ids=[str(model) for model in AVAILABLE_MODELS])
async def test_image_understanding(model: Model):
    """Test image understanding with a URL."""
    if not model.support_image_understanding:
        pytest.skip(f"Image understanding is not supported by {model.name}.")

    client = await _create_client(model)
    config = {}
    messages = [
        {
            "role": "user",
            "content_items": [
                {"type": "text", "text": "What's in this image? Describe it briefly."},
                {"type": "image_url", "image_url": IMAGE},
            ],
        }
    ]
    text = ""
    async for event in client.streaming_response(messages=messages, config=config):
        await _check_event_integrity(event)
        for item in event["content_items"]:
            if item["type"] == "text":
                text += item["text"]

    assert any(keyword in text.lower() for keyword in IMAGE_KEYWORDS)


@pytest.mark.asyncio
@pytest.mark.parametrize("model", AVAILABLE_MODELS, ids=[str(model) for model in AVAILABLE_MODELS])
async def test_image_understanding_base64(model: Model):
    """Test image understanding with base64 encoded image."""
    if not model.support_image_understanding:
        pytest.skip(f"Image understanding is not supported by {model.name}.")

    client = await _create_client(model)
    config = {}

    async with httpx.AsyncClient() as http_client:
        response = await http_client.get(IMAGE)
        image_bytes = response.content
    base64_image = base64.b64encode(image_bytes).decode("utf-8")
    mime_type, _ = mimetypes.guess_type(IMAGE)

    # Create data URI
    data_uri = f"data:{mime_type};base64,{base64_image}"
    messages = [
        {
            "role": "user",
            "content_items": [
                {"type": "text", "text": "What's in this image? Describe it briefly."},
                {"type": "image_url", "image_url": data_uri},
            ],
        }
    ]
    text = ""
    async for event in client.streaming_response(messages=messages, config=config):
        await _check_event_integrity(event)
        for item in event["content_items"]:
            if item["type"] == "text":
                text += item["text"]

    assert any(keyword in text.lower() for keyword in IMAGE_KEYWORDS)


@pytest.mark.asyncio
@pytest.mark.parametrize("model", AVAILABLE_MODELS, ids=[str(model) for model in AVAILABLE_MODELS])
async def test_tool_result_with_image(model: Model):
    """Test tool result with image_url."""
    if not model.support_image_understanding:
        pytest.skip(f"Image in tool result is not supported by {model.name}.")

    client = await _create_client(model)

    # Define a tool that returns an image
    image_tool = {
        "name": "get_image",
        "description": "Get an image URL",
        "parameters": {
            "type": "object",
            "properties": {
                "seed": {
                    "type": "integer",
                    "description": "The random seed to retrieve the image.",
                },
            },
            "required": ["seed"],
        },
    }

    config = {"tools": [image_tool]}
    tool_call_id = None

    # Prescriptive on purpose: this test covers a tool *result* carrying an image, so reaching
    # that state is setup. Natural tool selection is covered by test_tool_use.
    tool_prompt = (
        "Call get_image exactly once with seed 42. Make that function call your only action "
        "this turn, then describe the returned image briefly."
    )
    message1 = {"role": "user", "content_items": [{"type": "text", "text": tool_prompt}]}
    async for event in client.streaming_response_stateful(message=message1, config=config):
        await _check_event_integrity(event)
        for item in event["content_items"]:
            if item["type"] == "tool_call":
                tool_name = item["name"]
                tool_call_id = item["tool_call_id"]

    assert tool_name == image_tool["name"]
    assert tool_call_id is not None

    message2 = {
        "role": "user",
        "content_items": [
            {
                "type": "tool_result",
                "text": "Here is the result image:",
                "images": [IMAGE],
                "tool_call_id": tool_call_id,
            }
        ],
    }
    text = ""
    async for event in client.streaming_response_stateful(message=message2, config=config):
        await _check_event_integrity(event)
        for item in event["content_items"]:
            if item["type"] == "text":
                text += item["text"]

    assert any(keyword in text.lower() for keyword in IMAGE_KEYWORDS)


@pytest.mark.asyncio
@pytest.mark.parametrize("model", AVAILABLE_MODELS, ids=[str(model) for model in AVAILABLE_MODELS])
async def test_image_generation(model: Model):
    """Test streamed image generation output."""
    if not model.support_image_generation:
        pytest.skip(f"Image generation is not supported by {model.name}.")

    client = await _create_client(model)
    events = []
    async for event in client.streaming_response(
        messages=[
            {
                "role": "user",
                "content_items": [
                    {
                        "type": "text",
                        "text": "Generate a cozy watercolor illustration of two white flowers with raindrops.",
                    }
                ],
            }
        ],
        config={"image_config": {"aspect_ratio": "1:1", "image_size": "1K"}},
    ):
        await _check_event_integrity(event)
        events.append(event)

    inline_items = [item for event in events for item in event["content_items"] if item["type"] == "inline_data"]
    assert inline_items, f"No inline data returned for generated image by {model.name}"
    assert any("image/" in item["mime_type"] for item in inline_items)
    assert all(isinstance(item["data"], bytes) and item["data"] for item in inline_items)


@pytest.mark.asyncio
@pytest.mark.parametrize("model", AVAILABLE_MODELS, ids=[str(model) for model in AVAILABLE_MODELS])
async def test_tts_generation_single_speaker(model: Model):
    """Test single-speaker TTS output."""
    if not model.support_tts:
        pytest.skip(f"TTS is not supported by {model.name}.")

    client = await _create_client(model)
    events = []
    async for event in client.streaming_response(
        messages=[
            {
                "role": "user",
                "content_items": [
                    {
                        "type": "text",
                        "text": "Say cheerfully: Have a wonderful day!",
                    }
                ],
            }
        ],
        config={"tts_config": [{"voice": "Kore"}]},
    ):
        await _check_event_integrity(event)
        events.append(event)

    inline_items = [item for event in events for item in event["content_items"] if item["type"] == "inline_data"]
    assert inline_items, f"No inline data returned for TTS output by {model.name}"
    assert any("audio/" in item["mime_type"] for item in inline_items)
    assert all(isinstance(item["data"], bytes) and item["data"] for item in inline_items)


@pytest.mark.asyncio
@pytest.mark.parametrize("model", AVAILABLE_MODELS, ids=[str(model) for model in AVAILABLE_MODELS])
async def test_embedding(model: Model):
    """Test streamed text embedding with dimensions configuration."""
    if not model.support_embedding:
        pytest.skip(f"Embedding is not supported by {model.name}.")

    client = await _create_client(model)
    messages = [
        {"role": "user", "content_items": [{"type": "text", "text": "Hello world"}]},
        {"role": "user", "content_items": [{"type": "text", "text": "Goodbye "}, {"type": "text", "text": "world"}]},
    ]

    events = []
    async for event in client.streaming_response(
        messages=messages,
        config={"embedding_config": {"dimensions": 768}},
    ):
        await _check_event_integrity(event)
        events.append(event)

    embedding_items = [item for event in events for item in event["content_items"] if item["type"] == "embedding"]
    assert len(embedding_items) == 2
    for item in embedding_items:
        assert len(item["embedding"]) == 768
        assert all(isinstance(v, float) for v in item["embedding"])


if __name__ == "__main__":
    import asyncio

    asyncio.run(test_tool_use(Model(name=os.getenv("MODEL", "gpt-5.5"))))
