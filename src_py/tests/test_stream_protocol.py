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

from typing import AsyncIterator

import pytest
from stream_grammar import assert_stream_grammar

from agenthub import legacy
from agenthub.base_client import ClientPart, LLMClient
from agenthub.errors import EmptyResponseError, StreamProtocolError, ToolCallArgumentParseError
from agenthub.legacy import normalize_legacy_messages
from agenthub.types import EventContentItem, UniConfig, UniEvent, UniMessage, UsageMetadata


USAGE: UsageMetadata = {"cached_tokens": None, "prompt_tokens": 10, "thoughts_tokens": None, "response_tokens": 5}

FINISH: ClientPart = {"type": "finish", "usage_metadata": USAGE, "finish_reason": "stop"}

USER: UniMessage = {"role": "user", "content_items": [{"type": "text.done", "text": "hi"}]}


class ScriptedClient(LLMClient):
    """A client that replays a fixed list of parts and records the messages it was sent."""

    def __init__(self, parts: list[ClientPart]) -> None:
        self._model = "scripted"
        self._history = []
        self._parts = parts
        self.sent_messages: list[list[UniMessage]] = []

    def transform_uni_config_to_model_config(self, config: UniConfig) -> None:
        return None

    def transform_uni_message_to_model_input(self, messages: list[UniMessage]) -> list[UniMessage]:
        return messages

    def transform_model_output_to_client_parts(self, model_output: ClientPart) -> list[ClientPart]:
        return [model_output]

    async def _streaming_response_internal(
        self,
        messages: list[UniMessage],
        config: UniConfig,
    ) -> AsyncIterator[ClientPart]:
        self.sent_messages.append(messages)
        for part in self._parts:
            for client_part in self.transform_model_output_to_client_parts(part):
                yield client_part

    async def list_models(self) -> list[str]:
        return []


async def collect(parts: list[ClientPart], config: UniConfig | None = None) -> list[UniEvent]:
    return [event async for event in ScriptedClient(parts).streaming_response(messages=[USER], config=config or {})]


def items(events: list[UniEvent]) -> list[EventContentItem]:
    return [item for event in events for item in event["content_items"]]


@pytest.mark.asyncio
async def test_text_streams_as_deltas_a_done_item_then_the_stop_event():
    events = await collect(
        [
            {"type": "delta", "key": "0", "item": {"type": "text.delta", "text": "Hel"}},
            {"type": "delta", "key": "0", "item": {"type": "text.delta", "text": "lo"}},
            {"type": "done", "key": "0"},
            FINISH,
        ]
    )

    assert_stream_grammar(events)
    assert items(events) == [
        {"type": "text.delta", "text": "Hel"},
        {"type": "text.delta", "text": "lo"},
        {"type": "text.done", "text": "Hello"},
    ]
    assert events[-1]["event_type"] == "stop"
    assert events[-1]["usage_metadata"] == USAGE
    assert events[-1]["finish_reason"] == "stop"


@pytest.mark.asyncio
async def test_the_fidelity_a_delta_carries_is_the_done_items_fidelity():
    events = await collect(
        [
            {
                "type": "delta",
                "key": "msg",
                "item": {"type": "text.delta", "text": "", "fidelity": {"phase": "commentary"}},
            },
            {"type": "delta", "key": "msg", "item": {"type": "text.delta", "text": "Checking"}},
            {"type": "done", "key": "msg"},
            FINISH,
        ]
    )

    assert_stream_grammar(events)
    assert items(events) == [
        {"type": "text.delta", "text": "", "fidelity": {"phase": "commentary"}},
        {"type": "text.delta", "text": "Checking"},
        {"type": "text.done", "text": "Checking", "fidelity": {"phase": "commentary"}},
    ]


@pytest.mark.asyncio
async def test_thinking_closed_by_a_signature_then_a_tool_call_built_from_its_fragments():
    events = await collect(
        [
            {"type": "delta", "key": "0", "item": {"type": "thinking.delta", "thinking": "Let me"}},
            {"type": "delta", "key": "0", "item": {"type": "thinking.delta", "thinking": " look"}},
            {
                "type": "delta",
                "key": "0",
                "item": {"type": "thinking.delta", "thinking": "", "fidelity": {"signature": "sig"}},
            },
            {"type": "done", "key": "0"},
            {
                "type": "delta",
                "key": "1",
                "item": {"type": "tool_call.delta", "name": "get_weather", "arguments": "", "tool_call_id": "toolu_1"},
            },
            {
                "type": "delta",
                "key": "1",
                "item": {"type": "tool_call.delta", "name": "", "arguments": '{"city":', "tool_call_id": ""},
            },
            {
                "type": "delta",
                "key": "1",
                "item": {"type": "tool_call.delta", "name": "", "arguments": '"Paris"}', "tool_call_id": ""},
            },
            {"type": "done", "key": "1"},
            {"type": "finish", "finish_reason": "tool_call", "usage_metadata": USAGE},
        ]
    )

    assert_stream_grammar(events)
    assert [item for item in items(events) if item["type"].endswith(".done")] == [
        {"type": "thinking.done", "thinking": "Let me look", "fidelity": {"signature": "sig"}},
        {"type": "tool_call.done", "name": "get_weather", "arguments": {"city": "Paris"}, "tool_call_id": "toolu_1"},
    ]


@pytest.mark.asyncio
async def test_an_item_that_starts_while_another_streams_is_held_back_until_that_one_is_done():
    def call(call_id: str) -> ClientPart:
        return {
            "type": "delta",
            "key": call_id,
            "item": {
                "type": "tool_call.delta",
                "name": f"tool_{call_id}",
                "arguments": "",
                "tool_call_id": f"call_{call_id}",
            },
        }

    def fragment(call_id: str, text: str) -> ClientPart:
        return {
            "type": "delta",
            "key": call_id,
            "item": {"type": "tool_call.delta", "name": "", "arguments": text, "tool_call_id": ""},
        }

    events = await collect(
        [
            call("a"),
            call("b"),
            fragment("a", '{"x":'),
            fragment("b", '{"y":2}'),
            fragment("a", "1}"),
            {"type": "done", "key": "a"},
            {"type": "done", "key": "b"},
            FINISH,
        ]
    )

    assert_stream_grammar(events)
    assert [item["type"] for item in items(events)] == [
        "tool_call.delta",
        "tool_call.delta",
        "tool_call.delta",
        "tool_call.done",
        "tool_call.delta",
        "tool_call.delta",
        "tool_call.done",
    ]
    assert items(events)[3]["arguments"] == {"x": 1}
    assert items(events)[6]["arguments"] == {"y": 2}


@pytest.mark.asyncio
async def test_items_still_open_when_the_providers_stream_ends_are_done_before_the_stop():
    events = await collect(
        [
            {"type": "delta", "key": "0", "item": {"type": "text.delta", "text": "a"}},
            {"type": "delta", "key": "1", "item": {"type": "text.delta", "text": "b"}},
            FINISH,
        ]
    )

    assert_stream_grammar(events)
    assert items(events) == [
        {"type": "text.delta", "text": "a"},
        {"type": "text.done", "text": "a"},
        {"type": "text.delta", "text": "b"},
        {"type": "text.done", "text": "b"},
    ]


@pytest.mark.asyncio
async def test_a_repeated_identical_fidelity_goes_out_once_empty_fragments_not_at_all():
    fidelity = {"reasoning_field": "reasoning_content"}
    events = await collect(
        [
            {"type": "delta", "key": "0", "item": {"type": "thinking.delta", "thinking": ""}},
            {"type": "delta", "key": "0", "item": {"type": "thinking.delta", "thinking": "a", "fidelity": fidelity}},
            {"type": "delta", "key": "0", "item": {"type": "thinking.delta", "thinking": "b", "fidelity": fidelity}},
            {"type": "delta", "key": "1", "item": {"type": "text.delta", "text": "ok"}},
            FINISH,
        ]
    )

    assert_stream_grammar(events)
    assert items(events) == [
        {"type": "thinking.delta", "thinking": "a", "fidelity": fidelity},
        {"type": "thinking.delta", "thinking": "b"},
        {"type": "thinking.done", "thinking": "ab", "fidelity": fidelity},
        {"type": "text.delta", "text": "ok"},
        {"type": "text.done", "text": "ok"},
    ]


@pytest.mark.asyncio
async def test_audio_chunks_join_into_one_done_item_and_embeddings_stream_one_vector_per_item():
    audio = await collect(
        [
            {
                "type": "delta",
                "key": "0",
                "item": {"type": "inline_data.delta", "data": bytes([1, 2]), "mime_type": "audio/L16"},
            },
            {
                "type": "delta",
                "key": "0",
                "item": {"type": "inline_data.delta", "data": bytes([3]), "mime_type": "audio/L16"},
            },
            FINISH,
        ]
    )
    assert_stream_grammar(audio)
    assert items(audio)[2] == {"type": "inline_data.done", "data": bytes([1, 2, 3]), "mime_type": "audio/L16"}

    embeddings = await collect(
        [
            {"type": "delta", "key": "e0", "item": {"type": "embedding.delta", "embedding": [0.1]}},
            {"type": "done", "key": "e0"},
            {"type": "delta", "key": "e1", "item": {"type": "embedding.delta", "embedding": [0.2]}},
            {"type": "done", "key": "e1"},
            FINISH,
        ]
    )
    assert_stream_grammar(embeddings)
    assert items(embeddings) == [
        {"type": "embedding.delta", "embedding": [0.1]},
        {"type": "embedding.done", "embedding": [0.1]},
        {"type": "embedding.delta", "embedding": [0.2]},
        {"type": "embedding.done", "embedding": [0.2]},
    ]


@pytest.mark.asyncio
async def test_usage_pieces_merge_field_by_field():
    events = await collect(
        [
            {"type": "delta", "key": "0", "item": {"type": "text.delta", "text": "a"}},
            {
                "type": "finish",
                "usage_metadata": {
                    "cached_tokens": 3,
                    "prompt_tokens": 7,
                    "thoughts_tokens": None,
                    "response_tokens": None,
                },
            },
            {
                "type": "finish",
                "finish_reason": "length",
                "usage_metadata": {
                    "cached_tokens": None,
                    "prompt_tokens": None,
                    "thoughts_tokens": None,
                    "response_tokens": 9,
                },
            },
        ]
    )

    assert events[-1]["usage_metadata"] == {
        "cached_tokens": 3,
        "prompt_tokens": 7,
        "thoughts_tokens": None,
        "response_tokens": 9,
    }
    assert events[-1]["finish_reason"] == "length"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "parts",
    [
        pytest.param(
            [
                {"type": "delta", "key": "0", "item": {"type": "text.delta", "text": "a"}},
                {"type": "done", "key": "0"},
                {"type": "delta", "key": "0", "item": {"type": "text.delta", "text": "b"}},
            ],
            id="a delta after its item was done",
        ),
        pytest.param(
            [
                {
                    "type": "delta",
                    "key": "0",
                    "item": {"type": "thinking.delta", "thinking": "a", "fidelity": {"signature": "1"}},
                },
                {
                    "type": "delta",
                    "key": "0",
                    "item": {"type": "thinking.delta", "thinking": "", "fidelity": {"signature": "2"}},
                },
            ],
            id="two different fidelity payloads in one item",
        ),
        pytest.param(
            [
                {
                    "type": "delta",
                    "key": "0",
                    "item": {"type": "tool_call.delta", "name": "f", "arguments": "{}", "tool_call_id": ""},
                },
            ],
            id="a tool call whose first fragment has no id",
        ),
        pytest.param(
            [
                {"type": "delta", "key": "0", "item": {"type": "text.delta", "text": "a"}},
                {"type": "delta", "key": "0", "item": {"type": "thinking.delta", "thinking": "b"}},
            ],
            id="a fragment of another kind under an item's key",
        ),
    ],
)
async def test_stream_protocol_violation_raises_stream_protocol_error(parts: list[ClientPart]):
    with pytest.raises(StreamProtocolError):
        await collect([*parts, FINISH])


@pytest.mark.asyncio
async def test_a_stream_without_usage_or_finish_reason_yields_no_stop_event():
    events: list[UniEvent] = []
    client = ScriptedClient(
        [
            {"type": "delta", "key": "0", "item": {"type": "text.delta", "text": "a"}},
            {"type": "finish", "finish_reason": "stop"},
        ]
    )

    with pytest.raises(ValueError, match="without usage_metadata"):
        async for event in client.streaming_response(messages=[USER], config={}):
            events.append(event)

    assert not any(event["event_type"] == "stop" for event in events)


@pytest.mark.asyncio
async def test_a_thinking_only_response_raises_empty_response_error_carrying_its_usage():
    with pytest.raises(EmptyResponseError) as exc_info:
        await collect([{"type": "delta", "key": "0", "item": {"type": "thinking.delta", "thinking": "hmm"}}, FINISH])

    assert exc_info.value.usage_metadata == USAGE
    assert exc_info.value.finish_reason == "stop"


@pytest.mark.asyncio
async def test_malformed_tool_call_arguments_raise_when_the_call_is_done():
    with pytest.raises(ToolCallArgumentParseError):
        await collect(
            [
                {
                    "type": "delta",
                    "key": "0",
                    "item": {"type": "tool_call.delta", "name": "f", "arguments": '{"a":', "tool_call_id": "c"},
                },
                {"type": "done", "key": "0"},
                FINISH,
            ]
        )


REPLY: list[ClientPart] = [{"type": "delta", "key": "0", "item": {"type": "text.delta", "text": "hello"}}, FINISH]


@pytest.mark.asyncio
async def test_stateful_history_is_recorded_even_when_the_caller_stops_at_the_stop_event():
    client = ScriptedClient(REPLY)
    async for event in client.streaming_response_stateful(message=USER, config={}):
        if event["event_type"] == "stop":
            break

    history = client.get_history()
    assert len(history) == 2
    assert history[1]["role"] == "assistant"
    assert history[1]["content_items"] == [{"type": "text.done", "text": "hello"}]
    assert history[1]["usage_metadata"] == USAGE
    assert history[1]["finish_reason"] == "stop"


@pytest.mark.asyncio
async def test_concat_uni_events_to_uni_message_keeps_the_done_items_and_the_stop_events_metadata():
    events = await collect(REPLY)
    message = ScriptedClient([]).concat_uni_events_to_uni_message(events)

    assert message["role"] == "assistant"
    assert message["content_items"] == [{"type": "text.done", "text": "hello"}]
    assert message["usage_metadata"] == USAGE
    assert message["finish_reason"] == "stop"
    assert message["created_at"] == events[-1]["created_at"]


@pytest.mark.asyncio
async def test_legacy_content_item_types_are_converted_before_a_request_and_in_set_history(
    monkeypatch: pytest.MonkeyPatch,
):
    # the deprecation warning goes out once per process, so an earlier conversion must not swallow it here
    monkeypatch.setattr(legacy, "_warned", False)
    legacy_message = {
        "role": "user",
        "content_items": [
            {"type": "text", "text": "hi"},
            {"type": "tool_result", "text": "22 C", "tool_call_id": "call_1"},
            {"type": "partial_tool_call", "name": "", "arguments": "", "tool_call_id": ""},
        ],
    }

    client = ScriptedClient(REPLY)
    with pytest.warns(DeprecationWarning, match="0.6.0") as warnings_record:
        async for _event in client.streaming_response(messages=[legacy_message], config={}):
            pass
        client.set_history([legacy_message])

    assert len([warning for warning in warnings_record if warning.category is DeprecationWarning]) == 1
    assert client.sent_messages[0][0]["content_items"] == [
        {"type": "text.done", "text": "hi"},
        {"type": "tool_result.done", "text": "22 C", "tool_call_id": "call_1"},
    ]
    # the caller's message is left as it was
    assert legacy_message["content_items"][0]["type"] == "text"
    assert client.get_history()[0]["content_items"][0]["type"] == "text.done"

    current = [USER]
    assert normalize_legacy_messages(current)[0] is USER
