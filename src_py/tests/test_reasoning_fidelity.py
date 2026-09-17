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
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

import pytest
from google.genai import types
from stream_grammar import assert_stream_grammar

from agenthub import AutoLLMClient
from agenthub.types import UniEvent


@dataclass
class ReasoningReplayCase:
    model: str
    client_type: str


REASONING_REPLAY_CASES = [
    ReasoningReplayCase(model="gpt-5.5", client_type="openai"),
    ReasoningReplayCase(model="glm-5.1", client_type="glm-5.1"),
    ReasoningReplayCase(model="kimi-k2.6", client_type="kimi-k2.6"),
]


@dataclass
class ResponsesReasoningCase(ReasoningReplayCase):
    expected_client: str


# The Responses-protocol clients that carry a reasoning item's encrypted_content back on the
# next turn; DeepSeek and MiniMax rebuild reasoning from text and are covered by the chat
# table's rules above. The done event is the only source of that ciphertext: the
# streaming-events reference says "For reasoning items, encrypted_content may be incomplete
# while the item is in progress. Use the reasoning item from the corresponding
# response.output_item.done event when passing it as input to a subsequent request.", and the
# live capture on 2026-09-09 (api_captures/openai_responses/gpt-6-astra/) showed the added and
# done ciphertexts differ and are not a prefix pair.
RESPONSES_REASONING_CASES = [
    ResponsesReasoningCase(expected_client="GPT6Client", model="gpt-6-astra", client_type="gpt-6"),
    ResponsesReasoningCase(
        expected_client="OpenaiResponsesClient", model="openai/gpt-6-astra", client_type="openai-responses"
    ),
]

PARTIAL_ENCRYPTED_CONTENT = "gAAAAABpartial"
FULL_ENCRYPTED_CONTENT = "gAAAAABcomplete-ciphertext"
REASONING_ITEM_ID = "rs_072e343322bd1418016aa1391d844c87"
SUMMARY_TEXT = "**Distinguishing Paris and London metro references**"


def _create_auto_client(case: ReasoningReplayCase) -> AutoLLMClient:
    return AutoLLMClient(model=case.model, api_key="test-key", client_type=case.client_type)


async def _stream_from_chunks(chunks: list[object]) -> AsyncIterator[object]:
    for chunk in chunks:
        yield chunk


class _FakeOpenAICompatibleCompletions:
    def __init__(self, chunks: list[object]) -> None:
        self._chunks = chunks

    async def create(self, **_kwargs: object) -> AsyncIterator[object]:
        return _stream_from_chunks(self._chunks)


class _FakeOpenAICompatibleClient:
    def __init__(self, chunks: list[object]) -> None:
        self.base_url = "https://api.test.invalid/v1"
        self.chat = SimpleNamespace(completions=_FakeOpenAICompatibleCompletions(chunks))


def _install_fake_openai_compatible_stream(client: AutoLLMClient, chunks: list[object]) -> None:
    client._client._client = _FakeOpenAICompatibleClient(chunks)  # noqa: SLF001


def _delta_chunk(text: str | None = None, **reasoning_fields: str) -> object:
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                delta=SimpleNamespace(content=text, tool_calls=None, **reasoning_fields),
                finish_reason=None,
            )
        ],
        usage=None,
    )


def _stop_chunk(finish_reason: str = "stop") -> object:
    return SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(content=None, tool_calls=None), finish_reason=finish_reason)],
        usage=SimpleNamespace(
            prompt_tokens=1,
            completion_tokens=1,
            prompt_tokens_details=None,
            completion_tokens_details=SimpleNamespace(reasoning_tokens=1),
            prompt_cache_hit_tokens=0,
            prompt_cache_miss_tokens=1,
        ),
    )


def _user_message() -> dict[str, Any]:
    return {"role": "user", "content_items": [{"type": "text.done", "text": "Create a memo."}]}


async def _transform_history(client: AutoLLMClient, history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    model_input = client.transform_uni_message_to_model_input(history)
    if inspect.isawaitable(model_input):
        model_input = await model_input

    return model_input


async def _run_turn_and_replay(
    client: AutoLLMClient,
) -> tuple[list[UniEvent], dict[str, Any], list[dict[str, Any]]]:
    """Run one fake streamed turn, then rebuild the request payload from the stored history."""
    events = [event async for event in client.streaming_response_stateful(_user_message(), {})]
    assert_stream_grammar(events)

    history = client.get_history()
    model_input = await _transform_history(client, history)
    return events, history[-1], model_input


@pytest.mark.asyncio
@pytest.mark.parametrize("case", REASONING_REPLAY_CASES, ids=[case.client_type for case in REASONING_REPLAY_CASES])
async def test_replay_preserves_reasoning_content_field(case: ReasoningReplayCase):
    client = _create_auto_client(case)
    _install_fake_openai_compatible_stream(
        client,
        [
            _delta_chunk(reasoning_content="Let me think"),
            _delta_chunk(reasoning_content=" about the memo."),
            _delta_chunk(text="Here is the memo."),
            _stop_chunk(),
        ],
    )

    _events, history_message, model_input = await _run_turn_and_replay(client)
    replayed_message = model_input[-1]
    thinking_items = [item for item in history_message["content_items"] if item["type"] == "thinking.done"]
    assert thinking_items == [
        {
            "type": "thinking.done",
            "thinking": "Let me think about the memo.",
            "fidelity": {"reasoning_field": "reasoning_content"},
        }
    ]
    assert replayed_message["reasoning_content"] == "Let me think about the memo."
    assert "reasoning" not in replayed_message


@pytest.mark.asyncio
@pytest.mark.parametrize("case", REASONING_REPLAY_CASES, ids=[case.client_type for case in REASONING_REPLAY_CASES])
async def test_replay_preserves_reasoning_field(case: ReasoningReplayCase):
    client = _create_auto_client(case)
    _install_fake_openai_compatible_stream(
        client,
        [
            _delta_chunk(reasoning="Let me think"),
            _delta_chunk(reasoning=" about the memo."),
            _delta_chunk(text="Here is the memo."),
            _stop_chunk(),
        ],
    )

    _events, history_message, model_input = await _run_turn_and_replay(client)
    replayed_message = model_input[-1]
    thinking_items = [item for item in history_message["content_items"] if item["type"] == "thinking.done"]
    assert thinking_items == [
        {
            "type": "thinking.done",
            "thinking": "Let me think about the memo.",
            "fidelity": {"reasoning_field": "reasoning"},
        }
    ]
    assert replayed_message["reasoning"] == "Let me think about the memo."
    assert "reasoning_content" not in replayed_message


@pytest.mark.asyncio
@pytest.mark.parametrize("case", REASONING_REPLAY_CASES, ids=[case.client_type for case in REASONING_REPLAY_CASES])
async def test_replay_keeps_both_fields_when_origin_is_ambiguous(case: ReasoningReplayCase):
    client = _create_auto_client(case)
    _install_fake_openai_compatible_stream(
        client,
        [
            _delta_chunk(reasoning_content="Let me think.", reasoning="Let me think."),
            _delta_chunk(text="Here is the memo."),
            _stop_chunk(),
        ],
    )

    _events, history_message, model_input = await _run_turn_and_replay(client)
    replayed_message = model_input[-1]
    thinking_items = [item for item in history_message["content_items"] if item["type"] == "thinking.done"]
    assert thinking_items == [{"type": "thinking.done", "thinking": "Let me think."}]
    assert replayed_message["reasoning_content"] == "Let me think."
    assert replayed_message["reasoning"] == "Let me think."


@pytest.mark.asyncio
@pytest.mark.parametrize("case", REASONING_REPLAY_CASES, ids=[case.client_type for case in REASONING_REPLAY_CASES])
async def test_replay_of_thinking_without_fidelity_sends_both_fields(case: ReasoningReplayCase):
    client = _create_auto_client(case)
    history = [
        _user_message(),
        {
            "role": "assistant",
            "content_items": [
                {"type": "thinking.done", "thinking": "Let me think."},
                {"type": "text.done", "text": "Here is the memo."},
            ],
        },
    ]

    model_input = await _transform_history(client, history)
    replayed_message = model_input[-1]
    assert replayed_message["reasoning_content"] == "Let me think."
    assert replayed_message["reasoning"] == "Let me think."


class _FakeCreateEndpoint:
    """Stands in for an SDK endpoint whose create() returns a stream."""

    def __init__(self, events: list[object]) -> None:
        self._events = events

    async def create(self, **_kwargs: object) -> AsyncIterator[object]:
        return _stream_from_chunks(self._events)


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


def _responses_text_delta_event(text: str) -> object:
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


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case", RESPONSES_REASONING_CASES, ids=[case.client_type for case in RESPONSES_REASONING_CASES]
)
async def test_responses_replay_carries_done_encrypted_content_only(case: ResponsesReasoningCase):
    client = _create_auto_client(case)
    assert client._client.__class__.__name__ == case.expected_client  # noqa: SLF001
    _install_fake_responses_stream(
        client,
        [
            _reasoning_item_added_event(),
            _reasoning_summary_delta_event("**Distinguishing Paris"),
            _reasoning_summary_delta_event(" and London metro references**"),
            _reasoning_item_done_event(),
            _responses_text_delta_event("Paris."),
            _completed_event(),
        ],
    )

    events, history_message, model_input = await _run_turn_and_replay(client)

    # the fidelity goes out once, on the empty delta the completed item yields, and the done item
    # carries it
    streamed_items = [item for event in events for item in event["content_items"]]
    assert [item for item in streamed_items if item["type"] == "thinking.delta" and item.get("fidelity")] == [
        {
            "type": "thinking.delta",
            "thinking": "",
            "fidelity": {"channel": "summary", "encrypted_content": FULL_ENCRYPTED_CONTENT},
        }
    ]
    # one thinking item, carrying the streamed summary and the completed item's fields
    assert [item for item in history_message["content_items"] if item["type"] == "thinking.done"] == [
        {
            "type": "thinking.done",
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


def _message_item_added_event(item_id: str, phase: str) -> object:
    return SimpleNamespace(
        type="response.output_item.added",
        item=SimpleNamespace(
            id=item_id, type="message", role="assistant", status="in_progress", content=[], phase=phase
        ),
    )


def _message_text_delta_event(item_id: str, text: str) -> object:
    return SimpleNamespace(type="response.output_text.delta", item_id=item_id, content_index=0, delta=text)


def _message_item_done_event(item_id: str, phase: str, text: str) -> object:
    return SimpleNamespace(
        type="response.output_item.done",
        item=SimpleNamespace(
            id=item_id,
            type="message",
            role="assistant",
            status="completed",
            content=[SimpleNamespace(type="output_text", text=text, annotations=[])],
            phase=phase,
        ),
    )


# A message item's phase is known when the item is added, so it goes out once, on an empty delta,
# and the item's done carries it. Nothing merges items after the fact: the message keeps one text
# item per message item, and the replay starts a new message only where the phase changes.
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case", RESPONSES_REASONING_CASES, ids=[case.client_type for case in RESPONSES_REASONING_CASES]
)
async def test_responses_message_items_keep_their_phase_and_replay_splits_only_on_phase_change(
    case: ResponsesReasoningCase,
):
    client = _create_auto_client(case)
    assert client._client.__class__.__name__ == case.expected_client  # noqa: SLF001
    _install_fake_responses_stream(
        client,
        [
            _message_item_added_event("msg_1", "commentary"),
            _message_text_delta_event("msg_1", "I'll inspect the logs."),
            _message_item_done_event("msg_1", "commentary", "I'll inspect the logs."),
            _message_item_added_event("msg_2", "final_answer"),
            _message_text_delta_event("msg_2", "Root cause:"),
            _message_text_delta_event("msg_2", " cache invalidation race."),
            _message_item_done_event("msg_2", "final_answer", "Root cause: cache invalidation race."),
            _message_item_added_event("msg_3", "final_answer"),
            _message_text_delta_event("msg_3", " Remediation follows."),
            _message_item_done_event("msg_3", "final_answer", " Remediation follows."),
            _completed_event(),
        ],
    )

    events, history_message, model_input = await _run_turn_and_replay(client)

    commentary = {"phase": "commentary"}
    final_answer = {"phase": "final_answer"}
    streamed_items = [item for event in events for item in event["content_items"]]
    assert streamed_items == [
        {"type": "text.delta", "text": "", "fidelity": commentary},
        {"type": "text.delta", "text": "I'll inspect the logs."},
        {"type": "text.done", "text": "I'll inspect the logs.", "fidelity": commentary},
        {"type": "text.delta", "text": "", "fidelity": final_answer},
        {"type": "text.delta", "text": "Root cause:"},
        {"type": "text.delta", "text": " cache invalidation race."},
        {"type": "text.done", "text": "Root cause: cache invalidation race.", "fidelity": final_answer},
        {"type": "text.delta", "text": "", "fidelity": final_answer},
        {"type": "text.delta", "text": " Remediation follows."},
        {"type": "text.done", "text": " Remediation follows.", "fidelity": final_answer},
    ]

    done_items = [item for item in streamed_items if item["type"] == "text.done"]
    assert history_message["content_items"] == done_items
    assert client.concat_uni_events_to_uni_message(events)["content_items"] == done_items

    assert model_input[1:] == [
        {
            "type": "message",
            "role": "assistant",
            "content": [{"type": "output_text", "text": "I'll inspect the logs."}],
            "phase": "commentary",
        },
        {
            "type": "message",
            "role": "assistant",
            "content": [
                {"type": "output_text", "text": "Root cause: cache invalidation race."},
                {"type": "output_text", "text": " Remediation follows."},
            ],
            "phase": "final_answer",
        },
    ]


@pytest.mark.asyncio
async def test_gemini_replays_a_bytes_signature_on_a_thinking_item_as_base64():
    """The generateContent client recorded every thought signature as bytes, a thinking item's included."""
    client = AutoLLMClient(model="gemini-3.8-flash", api_key="test-key")
    assert client._client.__class__.__name__ == "Gemini3_8Client"  # noqa: SLF001
    history = [
        _user_message(),
        {
            "role": "assistant",
            "content_items": [
                {"type": "thinking.done", "thinking": "Let me think.", "fidelity": {"signature": b"sig-1"}},
                {"type": "text.done", "text": "Here is the memo."},
            ],
        },
    ]

    model_input = await _transform_history(client, history)
    assert model_input[1] == {
        "type": "thought",
        "summary": [{"type": "text", "text": "Let me think."}],
        "signature": base64.b64encode(b"sig-1").decode(),
    }


class _FakeGenerateContentModels:
    """Stands in for the Gemini SDK's models resource, whose generate_content_stream() returns a stream."""

    def __init__(self, chunks: list[object]) -> None:
        self._chunks = chunks

    async def generate_content_stream(self, **_kwargs: object) -> AsyncIterator[object]:
        return _stream_from_chunks(self._chunks)


def _install_fake_generate_content_stream(client: AutoLLMClient, chunks: list[object]) -> None:
    client._client._client = SimpleNamespace(aio=SimpleNamespace(models=_FakeGenerateContentModels(chunks)))  # noqa: SLF001


def _generate_content_chunk(*parts: types.Part) -> types.GenerateContentResponse:
    # Vertex AI attaches a usage_metadata carrying no counts to every chunk before the last one
    return types.GenerateContentResponse(
        candidates=[types.Candidate(content=types.Content(role="model", parts=list(parts)))],
        usage_metadata=types.GenerateContentResponseUsageMetadata(traffic_type="ON_DEMAND"),
    )


def _generate_content_stop_chunk(*parts: types.Part) -> types.GenerateContentResponse:
    return types.GenerateContentResponse(
        candidates=[
            types.Candidate(
                content=types.Content(role="model", parts=list(parts)), finish_reason=types.FinishReason.STOP
            )
        ],
        usage_metadata=types.GenerateContentResponseUsageMetadata(
            prompt_token_count=77, candidates_token_count=87, thoughts_token_count=377, traffic_type="ON_DEMAND"
        ),
    )


def _generate_content_client() -> AutoLLMClient:
    client = AutoLLMClient(model="gemini-3.8-flash", api_key="test-key", client_type="gemini-generate-content")
    assert client._client.__class__.__name__ == "Gemini3_8GenerateContentClient"  # noqa: SLF001
    return client


def _wire_parts(content: types.Content) -> list[dict[str, Any]]:
    """The parts of a content as the SDK sends them, signatures as base64."""
    return [part.model_dump(mode="json", exclude_none=True) for part in content.parts]


# generateContent carries no item identity and no end-of-item signal; the chunk shapes follow the
# Vertex AI captures of 2026-09-17 (api_captures/gemini_interactions/vertex/generate_content/).
@pytest.mark.asyncio
async def test_generate_content_closes_an_item_with_its_signature_and_replays_it_on_the_same_part():
    client = _generate_content_client()
    _install_fake_generate_content_stream(
        client,
        [
            _generate_content_chunk(types.Part(text="**Checking the weather**", thought=True)),
            _generate_content_chunk(types.Part(text="The capital")),
            _generate_content_chunk(types.Part(text=" of China")),
            _generate_content_chunk(types.Part(text=" is Beijing.")),
            _generate_content_chunk(
                types.Part(
                    function_call=types.FunctionCall(name="get_weather", args={"city": "Beijing"}, id="call_1"),
                    thought_signature=b"sig-1",
                )
            ),
            _generate_content_stop_chunk(types.Part(text="")),
        ],
    )

    events, _history_message, model_input = await _run_turn_and_replay(client)

    # the SDK hands a signature over as bytes, which the client records as base64 text
    fidelity = {"signature": base64.b64encode(b"sig-1").decode()}
    assert [item for event in events for item in event["content_items"]] == [
        {"type": "thinking.delta", "thinking": "**Checking the weather**"},
        {"type": "thinking.done", "thinking": "**Checking the weather**"},
        {"type": "text.delta", "text": "The capital"},
        {"type": "text.delta", "text": " of China"},
        {"type": "text.delta", "text": " is Beijing."},
        {"type": "text.done", "text": "The capital of China is Beijing."},
        {
            "type": "tool_call.delta",
            "name": "get_weather",
            "arguments": '{"city": "Beijing"}',
            "tool_call_id": "call_1",
            "fidelity": fidelity,
        },
        {
            "type": "tool_call.done",
            "name": "get_weather",
            "arguments": {"city": "Beijing"},
            "tool_call_id": "call_1",
            "fidelity": fidelity,
        },
    ]
    # the API reports STOP for a turn that stopped to call a tool
    assert events[-1]["finish_reason"] == "tool_call"

    # the empty text part that ended the stream is not replayed
    assert model_input[1].role == "model"
    assert _wire_parts(model_input[1]) == [
        {"text": "**Checking the weather**", "thought": True},
        {"text": "The capital of China is Beijing."},
        {
            "function_call": {"id": "call_1", "name": "get_weather", "args": {"city": "Beijing"}},
            "thought_signature": fidelity["signature"],
        },
    ]


@pytest.mark.asyncio
async def test_generate_content_closes_a_text_answer_with_the_signature_of_its_last_empty_part():
    client = _generate_content_client()
    _install_fake_generate_content_stream(
        client,
        [
            _generate_content_chunk(types.Part(text="The weather in Beijing")),
            _generate_content_chunk(types.Part(text=" is sunny.")),
            _generate_content_stop_chunk(types.Part(text="", thought_signature=b"sig-2")),
        ],
    )

    events, history_message, model_input = await _run_turn_and_replay(client)

    signature = base64.b64encode(b"sig-2").decode()
    assert history_message["content_items"] == [
        {"type": "text.done", "text": "The weather in Beijing is sunny.", "fidelity": {"signature": signature}}
    ]
    assert events[-1]["finish_reason"] == "stop"
    assert _wire_parts(model_input[1]) == [
        {"text": "The weather in Beijing is sunny.", "thought_signature": signature}
    ]


@pytest.mark.asyncio
async def test_generate_content_replays_a_bytes_signature_of_a_thinking_item_on_the_text():
    """The generateContent client recorded every thought signature as bytes before 0.5.0, a thinking item's included."""
    client = _generate_content_client()
    history = [
        _user_message(),
        {
            "role": "assistant",
            "content_items": [
                {"type": "thinking.done", "thinking": "Let me think.", "fidelity": {"signature": b"sig-1"}},
                {"type": "text.done", "text": "Here is the memo."},
            ],
        },
    ]

    model_input = await _transform_history(client, history)
    assert model_input[1].parts[0].thought_signature is None
    assert model_input[1].parts[1].thought_signature == b"sig-1"
