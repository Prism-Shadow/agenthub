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
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

import pytest

from agenthub import AutoLLMClient


# A GPT-6 reasoning item arrives twice: response.output_item.added carries an
# encrypted_content that may still be truncated, and response.output_item.done carries the
# complete one. The two are different ciphertexts, not a prefix pair (verified live
# 2026-09-09, api_captures/openai_responses/gpt-6-astra/), and the streaming-events
# reference says to replay the done one.
PARTIAL_ENCRYPTED_CONTENT = "gAAAAABpartial"
FULL_ENCRYPTED_CONTENT = "gAAAAABcomplete-ciphertext"
REASONING_ITEM_ID = "rs_072e343322bd1418016aa1391d844c87"
SUMMARY_TEXT = "**Distinguishing Paris and London metro references**"


@dataclass
class ReasoningItemCase:
    expected_client: str
    model: str
    client_type: str


# Both clients that serve gpt-6-astra: the official endpoint and the gateway path the
# OpenRouter openai/gpt-6-astra row routes through.
REASONING_ITEM_CASES = [
    ReasoningItemCase(expected_client="GPT6Client", model="gpt-6-astra", client_type="gpt-6"),
    ReasoningItemCase(
        expected_client="OpenaiResponsesClient", model="openai/gpt-6-astra", client_type="openai-responses"
    ),
]


async def _stream_from_events(events: list[object]) -> AsyncIterator[object]:
    for event in events:
        yield event


class _FakeCreateEndpoint:
    """Stands in for an SDK endpoint whose create() returns a stream."""

    def __init__(self, events: list[object]) -> None:
        self._events = events

    async def create(self, **_kwargs: object) -> AsyncIterator[object]:
        return _stream_from_events(self._events)


def _install_fake_responses_stream(client: AutoLLMClient, events: list[object]) -> None:
    client._client._client = SimpleNamespace(responses=_FakeCreateEndpoint(events))  # noqa: SLF001


def _reasoning_item_added_event() -> object:
    return SimpleNamespace(
        type="response.output_item.added",
        output_index=0,
        item=SimpleNamespace(
            id=REASONING_ITEM_ID,
            type="reasoning",
            content=[],
            encrypted_content=PARTIAL_ENCRYPTED_CONTENT,
            summary=[],
        ),
    )


def _reasoning_summary_delta_event(text: str) -> object:
    return SimpleNamespace(
        type="response.reasoning_summary_text.delta",
        item_id=REASONING_ITEM_ID,
        summary_index=0,
        delta=text,
    )


def _reasoning_item_done_event() -> object:
    return SimpleNamespace(
        type="response.output_item.done",
        output_index=0,
        item=SimpleNamespace(
            id=REASONING_ITEM_ID,
            type="reasoning",
            content=[],
            encrypted_content=FULL_ENCRYPTED_CONTENT,
            summary=[SimpleNamespace(type="summary_text", text=SUMMARY_TEXT)],
        ),
    )


def _text_delta_event(text: str) -> object:
    return SimpleNamespace(type="response.output_text.delta", delta=text)


def _completed_event() -> object:
    return SimpleNamespace(
        type="response.completed",
        response=SimpleNamespace(
            status="completed",
            usage=SimpleNamespace(
                input_tokens=139,
                output_tokens=109,
                input_tokens_details=SimpleNamespace(cached_tokens=0, cache_write_tokens=0),
                output_tokens_details=SimpleNamespace(reasoning_tokens=21),
            ),
        ),
    )


def _user_message() -> dict[str, Any]:
    return {"role": "user", "content_items": [{"type": "text", "text": "Which city is on the Seine?"}]}


async def _run_turn_and_replay(client: AutoLLMClient) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Run one fake streamed turn, then rebuild the request payload from the stored history."""
    async for _event in client.streaming_response_stateful(_user_message(), {}):
        pass

    history = client.get_history()
    model_input = client.transform_uni_message_to_model_input(history)
    if inspect.isawaitable(model_input):
        model_input = await model_input

    return history[-1], model_input


@pytest.mark.asyncio
@pytest.mark.parametrize("case", REASONING_ITEM_CASES, ids=[case.client_type for case in REASONING_ITEM_CASES])
async def test_reasoning_fidelity_uses_the_done_event_only(case: ReasoningItemCase):
    client = AutoLLMClient(model=case.model, api_key="test-key", client_type=case.client_type)
    assert client._client.__class__.__name__ == case.expected_client  # noqa: SLF001
    _install_fake_responses_stream(
        client,
        [
            _reasoning_item_added_event(),
            _reasoning_summary_delta_event("**Distinguishing Paris"),
            _reasoning_summary_delta_event(" and London metro references**"),
            _reasoning_item_done_event(),
            _text_delta_event("Paris."),
            _completed_event(),
        ],
    )

    history_message, model_input = await _run_turn_and_replay(client)

    # one thinking item, carrying the streamed summary and the completed item's fields
    assert [item for item in history_message["content_items"] if item["type"] == "thinking"] == [
        {
            "type": "thinking",
            "thinking": SUMMARY_TEXT,
            "fidelity": {"channel": "summary", "encrypted_content": FULL_ENCRYPTED_CONTENT},
        }
    ]

    reasoning_input = next(item for item in model_input if item.get("type") == "reasoning")
    assert reasoning_input == {
        "type": "reasoning",
        "summary": [{"type": "summary_text", "text": SUMMARY_TEXT}],
        "encrypted_content": FULL_ENCRYPTED_CONTENT,
    }
    # the in-progress ciphertext never reaches the replay, and the provider's item id is
    # not replayed either
    assert PARTIAL_ENCRYPTED_CONTENT not in json.dumps(model_input)
    assert "id" not in reasoning_input
