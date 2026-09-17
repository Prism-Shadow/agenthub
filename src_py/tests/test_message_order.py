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
import inspect
from dataclasses import dataclass
from typing import Any

import pytest

from agenthub import AutoLLMClient


# The Gemini SDK holds a thought signature as bytes and takes it as base64 text, the form a
# stream records it in, so the generateContent client cannot replay a signature like "sig-1".
GENERATE_CONTENT_SIGNATURE = base64.b64encode(b"sig-1").decode()


@dataclass
class MessageOrderCase:
    expected_client: str
    model: str
    client_type: str | None
    protocol: str
    expected: list[str]
    thought_signature: str = "sig-1"


# A turn where the model thought, spoke, and then called a tool. Every protocol that can
# express the order has to keep it: an assistant message placed after the function call it
# preceded is what DeepSeek answers with "No tool output found for tool call".
RESPONSES_ORDER = ["message:user", "reasoning", "message:assistant", "function_call", "function_call_output"]
MESSAGES_ORDER = ["user:text", "assistant:thinking,text,tool_use", "user:tool_result"]
# the Interactions API sends every item as a step of its own kind, a thought first in its turn
GEMINI_ORDER = ["user_input", "thought", "model_output", "function_call", "function_result"]
GENERATE_CONTENT_ORDER = ["user:text", "model:thinking,text,function_call", "user:function_response"]
# Chat Completions has no interleaving to keep: the text lands in content, the call in
# tool_calls of the same message, and the thinking in its own reasoning field.
CHAT_ORDER = ["user:text", "assistant:text,tool_calls,thinking", "tool:call_1"]

MESSAGE_ORDER_CASES = [
    MessageOrderCase("GPT6Client", "gpt-5.6", None, "responses", RESPONSES_ORDER),
    MessageOrderCase("OpenaiResponsesClient", "gpt-5.6", "openai-responses", "responses", RESPONSES_ORDER),
    MessageOrderCase("DeepSeekV4Client", "deepseek-v4", "deepseek-v4", "responses", RESPONSES_ORDER),
    MessageOrderCase("MiniMaxM3Client", "MiniMax-M3", "minimax-m3", "responses", RESPONSES_ORDER),
    MessageOrderCase("Claude5Client", "claude-sonnet-5", None, "messages", MESSAGES_ORDER),
    MessageOrderCase("AntMessagesClient", "claude-sonnet-5", "ant-messages", "messages", MESSAGES_ORDER),
    MessageOrderCase("Gemini3_8Client", "gemini-3.8-flash", None, "gemini", GEMINI_ORDER),
    MessageOrderCase(
        "Gemini3_8GenerateContentClient",
        "gemini-3.8-flash",
        "gemini-generate-content",
        "generate_content",
        GENERATE_CONTENT_ORDER,
        GENERATE_CONTENT_SIGNATURE,
    ),
    MessageOrderCase("OpenaiChatClient", "gpt-5.6", "openai-chat", "chat", CHAT_ORDER),
    MessageOrderCase("GLM5_3Client", "glm-5.3", None, "chat", CHAT_ORDER),
    MessageOrderCase("KimiK3Client", "kimi-k3", None, "chat", CHAT_ORDER),
]


def _messages(thought_signature: str = "sig-1") -> list[dict[str, Any]]:
    return [
        {"role": "user", "content_items": [{"type": "text.done", "text": "What is the weather in Paris?"}]},
        {
            "role": "assistant",
            "content_items": [
                {
                    "type": "thinking.done",
                    "thinking": "I should call the tool.",
                    "fidelity": {"signature": thought_signature},
                },
                {"type": "text.done", "text": "Let me check that for you."},
                {
                    "type": "tool_call.done",
                    "name": "get_weather",
                    "arguments": {"city": "Paris"},
                    "tool_call_id": "call_1",
                },
            ],
        },
        {
            "role": "user",
            "content_items": [{"type": "tool_result.done", "text": "20 degrees.", "tool_call_id": "call_1"}],
        },
    ]


def _responses_signature(model_input: list[dict[str, Any]]) -> list[str]:
    # every Responses client sends a turn as a typed message item, and an item carrying no type
    # at all is a message too; both are labelled by role, so one order fits every client
    labels = []
    for item in model_input:
        kind = item.get("type")
        labels.append(f"message:{item['role']}" if not kind or kind == "message" else kind)

    return labels


def _messages_signature(model_input: list[dict[str, Any]]) -> list[str]:
    return [f"{message['role']}:" + ",".join(block["type"] for block in message["content"]) for message in model_input]


def _gemini_signature(model_input: list[dict[str, Any]]) -> list[str]:
    return [step["type"] for step in model_input]


def _generate_content_signature(model_input: list[Any]) -> list[str]:
    labels = []
    for content in model_input:
        kinds = []
        for part in content.parts:
            if part.function_call is not None:
                kinds.append("function_call")
            elif part.function_response is not None:
                kinds.append("function_response")
            elif part.thought:
                kinds.append("thinking")
            else:
                kinds.append("text")

        labels.append(f"{content.role}:" + ",".join(kinds))

    return labels


def _chat_signature(model_input: list[dict[str, Any]]) -> list[str]:
    labels = []
    for message in model_input:
        if message["role"] == "tool":
            labels.append(f"tool:{message['tool_call_id']}")
            continue

        kinds = []
        if message.get("content"):
            kinds.append("text")
        if message.get("tool_calls"):
            kinds.append("tool_calls")
        if message.get("reasoning_content") or message.get("reasoning"):
            kinds.append("thinking")

        labels.append(f"{message['role']}:" + ",".join(kinds))

    return labels


_SIGNATURES = {
    "responses": _responses_signature,
    "messages": _messages_signature,
    "gemini": _gemini_signature,
    "generate_content": _generate_content_signature,
    "chat": _chat_signature,
}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    MESSAGE_ORDER_CASES,
    ids=[f"{case.model}:{case.client_type or 'auto'}" for case in MESSAGE_ORDER_CASES],
)
async def test_message_transform_keeps_content_item_order(case: MessageOrderCase):
    client = AutoLLMClient(model=case.model, api_key="test-key", client_type=case.client_type)
    assert client._client.__class__.__name__ == case.expected_client  # noqa: SLF001

    model_input = client._client.transform_uni_message_to_model_input(_messages(case.thought_signature))  # noqa: SLF001
    if inspect.isawaitable(model_input):
        model_input = await model_input

    assert _SIGNATURES[case.protocol](model_input) == case.expected

    # every Responses, Chat Completions, Interactions and generateContent client sends a text-only
    # tool result as a plain string rather than a one-part content list; the messages protocol has
    # no such position
    if case.protocol == "responses":
        assert model_input[4]["output"] == "20 degrees."
    elif case.protocol == "chat":
        assert model_input[2]["content"] == "20 degrees."
    elif case.protocol == "gemini":
        assert model_input[4]["result"] == "20 degrees."
    elif case.protocol == "generate_content":
        assert model_input[2].parts[0].function_response.response["result"] == "20 degrees."


@pytest.mark.asyncio
async def test_gemini_sends_an_image_only_tool_result_without_an_empty_text_block():
    client = AutoLLMClient(model="gemini-3.8-flash", api_key="test-key")
    assert client._client.__class__.__name__ == "Gemini3_8Client"  # noqa: SLF001
    messages = _messages()
    messages[2]["content_items"] = [
        {
            "type": "tool_result.done",
            "text": "",
            "images": ["data:image/png;base64,iVBORw0KGgo="],
            "tool_call_id": "call_1",
        }
    ]

    model_input = await client._client.transform_uni_message_to_model_input(messages)  # noqa: SLF001
    # an empty text block is rejected with a 400, while a result of images alone is accepted
    assert model_input[4]["result"] == [{"type": "image", "data": "iVBORw0KGgo=", "mime_type": "image/png"}]


def _generate_content_client(model: str = "gemini-3.8-flash") -> AutoLLMClient:
    client = AutoLLMClient(model=model, api_key="test-key", client_type="gemini-generate-content")
    assert client._client.__class__.__name__ == "Gemini3_8GenerateContentClient"  # noqa: SLF001
    return client


def _wire_parts(content: Any) -> list[dict[str, Any]]:
    """The parts of a content as the SDK sends them, signatures and data as base64."""
    return [part.model_dump(mode="json", exclude_none=True) for part in content.parts]


@pytest.mark.asyncio
async def test_generate_content_moves_a_thought_signature_onto_the_first_function_call():
    client = _generate_content_client()

    model_input = await client._client.transform_uni_message_to_model_input(  # noqa: SLF001
        _messages(GENERATE_CONTENT_SIGNATURE)
    )
    # generateContent validates the signature on the first function call of a turn, where the
    # Interactions API records it on the turn's thought
    assert _wire_parts(model_input[1]) == [
        {"text": "I should call the tool.", "thought": True},
        {"text": "Let me check that for you."},
        {
            "function_call": {"id": "call_1", "name": "get_weather", "args": {"city": "Paris"}},
            "thought_signature": GENERATE_CONTENT_SIGNATURE,
        },
    ]


@pytest.mark.asyncio
async def test_generate_content_splits_function_responses_into_contents_of_their_own():
    client = _generate_content_client()
    messages = _messages(GENERATE_CONTENT_SIGNATURE)
    messages[2]["content_items"] = [
        {"type": "text.done", "text": "Here is the weather."},
        {"type": "tool_result.done", "text": "20 degrees.", "tool_call_id": "call_1"},
    ]

    model_input = await client._client.transform_uni_message_to_model_input(messages)  # noqa: SLF001
    # Vertex AI rejects a content mixing function responses with other parts
    assert [(content.role, _wire_parts(content)) for content in model_input[2:]] == [
        ("user", [{"text": "Here is the weather."}]),
        (
            "user",
            [
                {
                    "function_response": {
                        "id": "call_1",
                        "name": "get_weather",
                        "response": {"result": "20 degrees."},
                    }
                }
            ],
        ),
    ]


@pytest.mark.asyncio
async def test_generate_content_keeps_the_signature_of_a_thought_image_on_its_own_part():
    client = _generate_content_client("gemini-3.1-flash-image")

    model_input = await client._client.transform_uni_message_to_model_input(  # noqa: SLF001
        [
            {"role": "user", "content_items": [{"type": "text.done", "text": "Draw a cat."}]},
            {
                "role": "assistant",
                "content_items": [
                    {
                        "type": "inline_thinking.done",
                        "data": b"draft",
                        "mime_type": "image/png",
                        "fidelity": {"signature": GENERATE_CONTENT_SIGNATURE},
                    },
                    {"type": "inline_data.done", "data": b"image", "mime_type": "image/png"},
                ],
            },
        ]
    )
    assert _wire_parts(model_input[1]) == [
        {
            "inline_data": {"data": base64.b64encode(b"draft").decode(), "mime_type": "image/png"},
            "thought": True,
            "thought_signature": GENERATE_CONTENT_SIGNATURE,
        },
        {"inline_data": {"data": base64.b64encode(b"image").decode(), "mime_type": "image/png"}},
    ]


# The generic client and the three routed ones share the replayed shape, so the cases are the
# Responses rows of the order suite.
RESPONSES_SHAPE_CASES = [case for case in MESSAGE_ORDER_CASES if case.protocol == "responses"]


@pytest.mark.parametrize(
    "case",
    RESPONSES_SHAPE_CASES,
    ids=[f"{case.model}:{case.client_type or 'auto'}" for case in RESPONSES_SHAPE_CASES],
)
def test_responses_replays_every_turn_as_a_message_item(case: MessageOrderCase):
    client = AutoLLMClient(model=case.model, api_key="test-key", client_type=case.client_type)
    assert client._client.__class__.__name__ == case.expected_client  # noqa: SLF001

    history = [
        {"role": "user", "content_items": [{"type": "text.done", "text": "Hello."}]},
        {"role": "assistant", "content_items": [{"type": "text.done", "text": "Hi there."}]},
        {"role": "user", "content_items": [{"type": "text.done", "text": "And now?"}]},
    ]
    model_input = client._client.transform_uni_message_to_model_input(history)  # noqa: SLF001

    # every turn is a typed message item — the EasyInputMessage shape, which a vLLM-style
    # Responses server requires for the replayed assistant turn and takes for a user turn too.
    # Every client on this protocol emits input_text for a user part and output_text for an
    # assistant one.
    assert model_input == [
        {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Hello."}]},
        {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Hi there."}]},
        {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "And now?"}]},
    ]
    for item in model_input:
        assert sorted(item) == ["content", "role", "type"]
