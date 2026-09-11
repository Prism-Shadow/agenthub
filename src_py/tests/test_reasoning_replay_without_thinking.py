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

"""Replaying a tool-calling turn the model thought nothing on.

DeepSeek stops thinking part-way through a long tool chain, so such a turn arrives normally;
replaying it without a chain of thought is then rejected with "the reasoning_content in the
thinking mode must be passed back to the API". DeepSeek waives that only for tool_call ids it
recognises as its own, which it cannot once a relay has reissued them. The turn therefore
carries the reasoning field empty.
"""

import inspect
from typing import Any

import pytest

from agenthub import AutoLLMClient


THINKING = "I should call the tool."


def _chat_client() -> AutoLLMClient:
    """The Chat Completions client; GLM and Kimi keep transforms of their own."""
    client = AutoLLMClient(model="gpt-5.6", api_key="test-key", client_type="openai-chat")
    assert client._client.__class__.__name__ == "OpenaiChatClient"  # noqa: SLF001
    return client


async def _transform_history(client: AutoLLMClient, history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    model_input = client.transform_uni_message_to_model_input(history)
    if inspect.isawaitable(model_input):
        model_input = await model_input

    return model_input


def _user_text() -> dict[str, Any]:
    return {"role": "user", "content_items": [{"type": "text", "text": "What is the weather in Paris?"}]}


def _thinking_item(text: str, reasoning_field: str | None = None) -> dict[str, Any]:
    item: dict[str, Any] = {"type": "thinking", "thinking": text}
    if reasoning_field is not None:
        item["fidelity"] = {"reasoning_field": reasoning_field}

    return item


def _tool_call_item(tool_call_id: str) -> dict[str, Any]:
    return {"type": "tool_call", "name": "get_weather", "arguments": {"city": "Paris"}, "tool_call_id": tool_call_id}


def _assistant(*content_items: dict[str, Any]) -> dict[str, Any]:
    return {"role": "assistant", "content_items": list(content_items)}


def _tool_results(*tool_call_ids: str) -> dict[str, Any]:
    return {
        "role": "user",
        "content_items": [
            {"type": "tool_result", "text": "20 degrees.", "tool_call_id": tool_call_id}
            for tool_call_id in tool_call_ids
        ],
    }


def _assistant_messages(model_input: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [message for message in model_input if message["role"] == "assistant"]


def _tool_call_ids(message: dict[str, Any]) -> list[str]:
    return [tool_call["id"] for tool_call in message["tool_calls"]]


@pytest.mark.asyncio
async def test_replay_sends_empty_reasoning_content_for_a_tool_call_without_thinking():
    client = _chat_client()
    history = [
        _user_text(),
        _assistant(_thinking_item(THINKING, "reasoning_content"), _tool_call_item("call_1")),
        _tool_results("call_1"),
        _assistant(_tool_call_item("call_2")),
        _tool_results("call_2"),
    ]

    thought, unthought = _assistant_messages(await _transform_history(client, history))
    assert thought["reasoning_content"] == THINKING
    assert "reasoning" not in thought
    assert _tool_call_ids(unthought) == ["call_2"]
    assert unthought["reasoning_content"] == ""
    assert "reasoning" not in unthought


@pytest.mark.asyncio
async def test_replay_sends_empty_reasoning_for_a_tool_call_without_thinking():
    client = _chat_client()
    history = [
        _user_text(),
        _assistant(_thinking_item(THINKING, "reasoning"), _tool_call_item("call_1")),
        _tool_results("call_1"),
        _assistant(_tool_call_item("call_2")),
        _tool_results("call_2"),
    ]

    thought, unthought = _assistant_messages(await _transform_history(client, history))
    assert thought["reasoning"] == THINKING
    assert "reasoning_content" not in thought
    assert _tool_call_ids(unthought) == ["call_2"]
    assert unthought["reasoning"] == ""
    assert "reasoning_content" not in unthought


@pytest.mark.asyncio
async def test_replay_sends_no_reasoning_field_when_no_message_ever_thought():
    """A server that never produces a reasoning field never starts receiving one."""
    client = _chat_client()
    history = [
        _user_text(),
        _assistant({"type": "text", "text": "Let me check that for you."}, _tool_call_item("call_1")),
        _tool_results("call_1"),
    ]

    (message,) = _assistant_messages(await _transform_history(client, history))
    assert _tool_call_ids(message) == ["call_1"]
    assert "reasoning_content" not in message
    assert "reasoning" not in message


@pytest.mark.asyncio
async def test_replay_sends_no_reasoning_field_for_a_message_without_tool_calls():
    """The empty field rides with a tool call only: a plain answer is replayed as it was."""
    client = _chat_client()
    history = [
        _user_text(),
        _assistant(_thinking_item(THINKING, "reasoning_content"), _tool_call_item("call_1")),
        _tool_results("call_1"),
        _assistant({"type": "text", "text": "It is 20 degrees in Paris."}),
    ]

    _thought, answer = _assistant_messages(await _transform_history(client, history))
    assert answer["content"] == [{"type": "text", "text": "It is 20 degrees in Paris."}]
    assert "reasoning_content" not in answer
    assert "reasoning" not in answer


@pytest.mark.asyncio
async def test_replay_keeps_each_message_on_its_own_reasoning_field():
    client = _chat_client()
    history = [
        _user_text(),
        _assistant(_thinking_item("First Paris.", "reasoning"), _tool_call_item("call_1")),
        _tool_results("call_1"),
        _assistant(_thinking_item("Now London.", "reasoning_content"), _tool_call_item("call_2")),
        _tool_results("call_2"),
        _assistant(_tool_call_item("call_3")),
        _tool_results("call_3"),
    ]

    first, second, third = _assistant_messages(await _transform_history(client, history))
    # a message that thought still replays through the field its own item recorded
    assert first["reasoning"] == "First Paris."
    assert "reasoning_content" not in first
    assert second["reasoning_content"] == "Now London."
    assert "reasoning" not in second
    # the request as a whole produced both spellings, so the turn without thinking sends both
    assert third["reasoning_content"] == ""
    assert third["reasoning"] == ""
