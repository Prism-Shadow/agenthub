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

import inspect
from dataclasses import dataclass
from typing import Any

import pytest

from agenthub import AutoLLMClient


@dataclass
class MessageOrderCase:
    expected_client: str
    model: str
    client_type: str | None
    protocol: str
    expected: list[str]
    # Claude replays the signature as text, Gemini as the bytes it streamed
    thought_signature: str | bytes = "sig-1"


# A turn where the model thought, spoke, and then called a tool. Every protocol that can
# express the order has to keep it: an assistant message placed after the function call it
# preceded is what DeepSeek answers with "No tool output found for tool call".
RESPONSES_ORDER = ["message:user", "reasoning", "message:assistant", "function_call", "function_call_output"]
MESSAGES_ORDER = ["user:text", "assistant:thinking,text,tool_use", "user:tool_result"]
GEMINI_ORDER = ["user:text", "model:thinking,text,function_call", "user:function_response"]
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
    MessageOrderCase("Gemini3_8Client", "gemini-3.8-flash", None, "gemini", GEMINI_ORDER, b"sig-1"),
    MessageOrderCase("OpenaiChatClient", "gpt-5.6", "openai-chat", "chat", CHAT_ORDER),
    MessageOrderCase("GLM5_3Client", "glm-5.3", None, "chat", CHAT_ORDER),
    MessageOrderCase("KimiK3Client", "kimi-k3", None, "chat", CHAT_ORDER),
]


def _messages(case: MessageOrderCase) -> list[dict[str, Any]]:
    return [
        {"role": "user", "content_items": [{"type": "text", "text": "What is the weather in Paris?"}]},
        {
            "role": "assistant",
            "content_items": [
                {
                    "type": "thinking",
                    "thinking": "I should call the tool.",
                    "fidelity": {"signature": case.thought_signature},
                },
                {"type": "text", "text": "Let me check that for you."},
                {
                    "type": "tool_call",
                    "name": "get_weather",
                    "arguments": {"city": "Paris"},
                    "tool_call_id": "call_1",
                },
            ],
        },
        {
            "role": "user",
            "content_items": [{"type": "tool_result", "text": "20 degrees.", "tool_call_id": "call_1"}],
        },
    ]


def _responses_signature(model_input: list[dict[str, Any]]) -> list[str]:
    return [item.get("type") or f"message:{item['role']}" for item in model_input]


def _messages_signature(model_input: list[dict[str, Any]]) -> list[str]:
    return [f"{message['role']}:" + ",".join(block["type"] for block in message["content"]) for message in model_input]


def _gemini_signature(model_input: list[Any]) -> list[str]:
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

    model_input = client._client.transform_uni_message_to_model_input(_messages(case))  # noqa: SLF001
    if inspect.isawaitable(model_input):
        model_input = await model_input

    assert _SIGNATURES[case.protocol](model_input) == case.expected
