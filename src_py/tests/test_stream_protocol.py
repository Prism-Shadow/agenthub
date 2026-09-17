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

import json
from typing import AsyncIterator

import pytest
from stream_grammar import assert_stream_grammar

from agenthub import legacy
from agenthub.base_client import LLMClient, done_marker
from agenthub.errors import EmptyResponseError, StreamProtocolError, ToolCallArgumentParseError
from agenthub.legacy import normalize_legacy_messages
from agenthub.types import EventContentItem, FinishReason, UniConfig, UniEvent, UniMessage, UsageMetadata


USAGE: UsageMetadata = {"cached_tokens": None, "prompt_tokens": 10, "thoughts_tokens": None, "response_tokens": 5}

USER: UniMessage = {"role": "user", "content_items": [{"type": "text.done", "text": "hi"}]}


def delta(*items: EventContentItem) -> UniEvent:
    return {
        "role": "assistant",
        "event_type": "delta",
        "content_items": list(items),
        "usage_metadata": None,
        "finish_reason": None,
    }


def stop(
    usage: UsageMetadata | None, finish: FinishReason | None, items: list[EventContentItem] | None = None
) -> UniEvent:
    return {
        "role": "assistant",
        "event_type": "stop",
        "content_items": items or [],
        "usage_metadata": usage,
        "finish_reason": finish,
    }


def with_id(item_id: str, item: EventContentItem) -> EventContentItem:
    """The item with fidelity.item_id in front of the fidelity it already carries."""
    return {**item, "fidelity": {"item_id": item_id, **item.get("fidelity", {})}}


FINISH = stop(USAGE, "stop")


class ScriptedClient(LLMClient):
    """A client that replays a fixed list of events and records the messages it was sent."""

    def __init__(self, events: list[UniEvent]) -> None:
        self._model = "scripted"
        self._history = []
        self._events = events
        self.sent_messages: list[list[UniMessage]] = []

    def transform_uni_config_to_model_config(self, config: UniConfig) -> None:
        return None

    def transform_uni_message_to_model_input(self, messages: list[UniMessage]) -> list[UniMessage]:
        return messages

    def transform_model_output_to_uni_event(self, model_output: UniEvent) -> UniEvent:
        return model_output

    async def _streaming_response_internal(
        self,
        messages: list[UniMessage],
        config: UniConfig,
    ) -> AsyncIterator[UniEvent]:
        self.sent_messages.append(messages)
        for event in self._events:
            yield self.transform_model_output_to_uni_event(event)

    async def list_models(self) -> list[str]:
        return []


async def collect(script: list[UniEvent], config: UniConfig | None = None) -> list[UniEvent]:
    return [event async for event in ScriptedClient(script).streaming_response(messages=[USER], config=config or {})]


def items(events: list[UniEvent]) -> list[EventContentItem]:
    return [item for event in events for item in event["content_items"]]


@pytest.mark.asyncio
async def test_text_streams_as_deltas_a_done_item_then_the_stop_event():
    events = await collect(
        [
            delta(with_id("0", {"type": "text.delta", "text": "Hel"})),
            delta(with_id("0", {"type": "text.delta", "text": "lo"})),
            delta(done_marker("0")),
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
            delta(with_id("msg", {"type": "text.delta", "text": "", "fidelity": {"phase": "commentary"}})),
            delta(with_id("msg", {"type": "text.delta", "text": "Checking"})),
            delta(done_marker("msg")),
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
            delta(with_id("0", {"type": "thinking.delta", "thinking": "Let me"})),
            delta(with_id("0", {"type": "thinking.delta", "thinking": " look"})),
            delta(with_id("0", {"type": "thinking.delta", "thinking": "", "fidelity": {"signature": "sig"}})),
            delta(done_marker("0")),
            delta(
                with_id(
                    "1",
                    {"type": "tool_call.delta", "name": "get_weather", "arguments": "", "tool_call_id": "toolu_1"},
                )
            ),
            delta(with_id("1", {"type": "tool_call.delta", "name": "", "arguments": '{"city":', "tool_call_id": ""})),
            delta(with_id("1", {"type": "tool_call.delta", "name": "", "arguments": '"Paris"}', "tool_call_id": ""})),
            delta(done_marker("1")),
            stop(USAGE, "tool_call"),
        ]
    )

    assert_stream_grammar(events)
    assert [item for item in items(events) if item["type"].endswith(".done")] == [
        {"type": "thinking.done", "thinking": "Let me look", "fidelity": {"signature": "sig"}},
        {"type": "tool_call.done", "name": "get_weather", "arguments": {"city": "Paris"}, "tool_call_id": "toolu_1"},
    ]


@pytest.mark.asyncio
async def test_an_item_that_starts_while_another_streams_is_held_back_until_that_one_is_done():
    def call(call_id: str) -> UniEvent:
        return delta(
            with_id(
                call_id,
                {
                    "type": "tool_call.delta",
                    "name": f"tool_{call_id}",
                    "arguments": "",
                    "tool_call_id": f"call_{call_id}",
                },
            )
        )

    def fragment(call_id: str, text: str) -> UniEvent:
        return delta(with_id(call_id, {"type": "tool_call.delta", "name": "", "arguments": text, "tool_call_id": ""}))

    events = await collect(
        [
            call("a"),
            call("b"),
            fragment("a", '{"x":'),
            fragment("b", '{"y":2}'),
            fragment("a", "1}"),
            delta(done_marker("a")),
            delta(done_marker("b")),
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
            delta(with_id("0", {"type": "text.delta", "text": "a"})),
            delta(with_id("1", {"type": "text.delta", "text": "b"})),
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
            delta(with_id("0", {"type": "thinking.delta", "thinking": ""})),
            delta(with_id("0", {"type": "thinking.delta", "thinking": "a", "fidelity": fidelity})),
            delta(with_id("0", {"type": "thinking.delta", "thinking": "b", "fidelity": fidelity})),
            delta(with_id("1", {"type": "text.delta", "text": "ok"})),
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
            delta(with_id("0", {"type": "inline_data.delta", "data": bytes([1, 2]), "mime_type": "audio/L16"})),
            delta(with_id("0", {"type": "inline_data.delta", "data": bytes([3]), "mime_type": "audio/L16"})),
            FINISH,
        ]
    )
    assert_stream_grammar(audio)
    assert items(audio)[2] == {"type": "inline_data.done", "data": bytes([1, 2, 3]), "mime_type": "audio/L16"}

    embeddings = await collect(
        [
            delta({"type": "embedding.delta", "embedding": [0.1]}),
            delta({"type": "embedding.delta", "embedding": [0.2]}),
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
            delta(with_id("0", {"type": "text.delta", "text": "a"})),
            stop({"cached_tokens": 3, "prompt_tokens": 7, "thoughts_tokens": None, "response_tokens": None}, None),
            stop(
                {"cached_tokens": None, "prompt_tokens": None, "thoughts_tokens": None, "response_tokens": 9}, "length"
            ),
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
async def test_item_id_never_reaches_the_public_stream_the_message_or_the_history():
    client = ScriptedClient(
        [
            delta(with_id("0", {"type": "thinking.delta", "thinking": "a", "fidelity": {"signature": "s"}})),
            delta(done_marker("0")),
            delta(with_id("1", {"type": "text.delta", "text": "b"})),
            FINISH,
        ]
    )
    events = [event async for event in client.streaming_response_stateful(message=USER, config={})]

    assert_stream_grammar(events)
    assert items(events) == [
        {"type": "thinking.delta", "thinking": "a", "fidelity": {"signature": "s"}},
        {"type": "thinking.done", "thinking": "a", "fidelity": {"signature": "s"}},
        {"type": "text.delta", "text": "b"},
        {"type": "text.done", "text": "b"},
    ]
    assert '"item_id"' not in json.dumps(client.concat_uni_events_to_uni_message(events))
    assert '"item_id"' not in json.dumps(client.get_history())


@pytest.mark.asyncio
async def test_an_event_carries_several_items_in_wire_order():
    # Responses reasoning: the fidelity arrives with the item's end, in one wire event
    reasoning = await collect(
        [
            delta(with_id("rs_1", {"type": "thinking.delta", "thinking": "Plan"})),
            delta(
                with_id("rs_1", {"type": "thinking.delta", "thinking": "", "fidelity": {"encrypted_content": "enc"}}),
                done_marker("rs_1"),
            ),
            delta(with_id("msg_1", {"type": "text.delta", "text": "Done"})),
            FINISH,
        ]
    )
    assert_stream_grammar(reasoning)
    assert items(reasoning) == [
        {"type": "thinking.delta", "thinking": "Plan"},
        {"type": "thinking.delta", "thinking": "", "fidelity": {"encrypted_content": "enc"}},
        {"type": "thinking.done", "thinking": "Plan", "fidelity": {"encrypted_content": "enc"}},
        {"type": "text.delta", "text": "Done"},
        {"type": "text.done", "text": "Done"},
    ]

    # Chat Completions: the switch to content closes the reasoning, and the last content chunk
    # carries the finish reason, while the usage follows in a chunk of its own
    chat = await collect(
        [
            delta(with_id("0", {"type": "thinking.delta", "thinking": "Hmm"})),
            delta(done_marker("0"), with_id("1", {"type": "text.delta", "text": "Hel"})),
            stop(None, "stop", [with_id("1", {"type": "text.delta", "text": "lo"})]),
            stop(USAGE, None),
        ]
    )
    assert_stream_grammar(chat)
    assert items(chat) == [
        {"type": "thinking.delta", "thinking": "Hmm"},
        {"type": "thinking.done", "thinking": "Hmm"},
        {"type": "text.delta", "text": "Hel"},
        {"type": "text.delta", "text": "lo"},
        {"type": "text.done", "text": "Hello"},
    ]
    assert chat[-1]["usage_metadata"] == USAGE
    assert chat[-1]["finish_reason"] == "stop"


@pytest.mark.asyncio
async def test_a_done_marker_closes_the_item_under_its_id_whatever_kind_the_item_streams():
    call = delta(with_id("0", {"type": "tool_call.delta", "name": "f", "arguments": "{}", "tool_call_id": "call_1"}))
    events = await collect([call, delta(done_marker("0")), FINISH])

    assert_stream_grammar(events)
    assert items(events) == [
        {"type": "tool_call.delta", "name": "f", "arguments": "{}", "tool_call_id": "call_1"},
        {"type": "tool_call.done", "name": "f", "arguments": {}, "tool_call_id": "call_1"},
    ]
    # closed by the marker itself, not by the end of the stream
    with pytest.raises(StreamProtocolError, match="arrived after item 0 was done"):
        await collect([call, delta(done_marker("0")), call, FINISH])


@pytest.mark.asyncio
async def test_embedding_vectors_need_no_item_id_and_no_done_marker():
    events = await collect(
        [
            stop(
                USAGE,
                "stop",
                [
                    {"type": "embedding.delta", "embedding": [0.1, 0.2]},
                    {"type": "embedding.delta", "embedding": [0.3, 0.4]},
                ],
            )
        ]
    )

    assert_stream_grammar(events)
    assert items(events) == [
        {"type": "embedding.delta", "embedding": [0.1, 0.2]},
        {"type": "embedding.done", "embedding": [0.1, 0.2]},
        {"type": "embedding.delta", "embedding": [0.3, 0.4]},
        {"type": "embedding.done", "embedding": [0.3, 0.4]},
    ]


@pytest.mark.asyncio
async def test_an_empty_delta_event_and_a_stop_event_carrying_nothing_are_ignored():
    events = await collect(
        [
            delta(),
            delta(with_id("0", {"type": "text.delta", "text": "a"})),
            FINISH,
            stop(None, None),
            delta(),
        ]
    )

    assert_stream_grammar(events)
    assert items(events) == [{"type": "text.delta", "text": "a"}, {"type": "text.done", "text": "a"}]
    assert events[-1]["usage_metadata"] == USAGE
    assert events[-1]["finish_reason"] == "stop"


@pytest.mark.asyncio
async def test_a_done_marker_for_an_item_that_never_streamed_is_ignored():
    events = await collect(
        [
            delta(with_id("msg_1", {"type": "text.delta", "text": ""})),
            delta(done_marker("msg_1")),
            delta(done_marker("msg_2")),
            delta(with_id("msg_3", {"type": "text.delta", "text": "a"})),
            FINISH,
        ]
    )

    assert_stream_grammar(events)
    assert items(events) == [{"type": "text.delta", "text": "a"}, {"type": "text.done", "text": "a"}]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "script",
    [
        pytest.param(
            [
                delta(with_id("0", {"type": "text.delta", "text": "a"})),
                delta(done_marker("0")),
                delta(with_id("0", {"type": "text.delta", "text": "b"})),
            ],
            id="a delta after its item was done",
        ),
        pytest.param(
            [
                delta(with_id("0", {"type": "thinking.delta", "thinking": "a", "fidelity": {"signature": "1"}})),
                delta(with_id("0", {"type": "thinking.delta", "thinking": "", "fidelity": {"signature": "2"}})),
            ],
            id="two different fidelity payloads in one item",
        ),
        pytest.param(
            [delta(with_id("0", {"type": "tool_call.delta", "name": "f", "arguments": "{}", "tool_call_id": ""}))],
            id="a tool call whose first fragment has no tool_call_id",
        ),
        pytest.param(
            [
                delta(with_id("0", {"type": "text.delta", "text": "a"})),
                delta(with_id("0", {"type": "thinking.delta", "thinking": "b"})),
            ],
            id="a fragment of another kind under an item's id",
        ),
        pytest.param(
            [delta({"type": "text.delta", "text": "a"})],
            id="a delta without fidelity.item_id",
        ),
        pytest.param(
            [
                delta(with_id("0", {"type": "thinking.delta", "thinking": "a"})),
                delta({"type": "text.done", "text": "", "fidelity": {"item_id": "0", "signature": "s"}}),
            ],
            id="a done marker carrying fidelity beyond item_id",
        ),
        pytest.param(
            [{**delta(with_id("0", {"type": "text.delta", "text": "a"})), "finish_reason": "stop"}],
            id="a delta event carrying a finish reason",
        ),
    ],
)
async def test_stream_protocol_violation_raises_stream_protocol_error(script: list[UniEvent]):
    with pytest.raises(StreamProtocolError):
        await collect([*script, FINISH])


@pytest.mark.asyncio
async def test_a_stream_without_usage_or_finish_reason_yields_no_stop_event():
    events: list[UniEvent] = []
    client = ScriptedClient([delta(with_id("0", {"type": "text.delta", "text": "a"})), stop(None, "stop")])

    with pytest.raises(ValueError, match="without usage_metadata"):
        async for event in client.streaming_response(messages=[USER], config={}):
            events.append(event)

    assert not any(event["event_type"] == "stop" for event in events)


@pytest.mark.asyncio
async def test_a_thinking_only_response_raises_empty_response_error_carrying_its_usage():
    with pytest.raises(EmptyResponseError) as exc_info:
        await collect([delta(with_id("0", {"type": "thinking.delta", "thinking": "hmm"})), FINISH])

    assert exc_info.value.usage_metadata == USAGE
    assert exc_info.value.finish_reason == "stop"


@pytest.mark.asyncio
async def test_malformed_tool_call_arguments_raise_when_the_call_is_done():
    with pytest.raises(ToolCallArgumentParseError):
        await collect(
            [
                delta(
                    with_id("0", {"type": "tool_call.delta", "name": "f", "arguments": '{"a":', "tool_call_id": "c"})
                ),
                delta(done_marker("0")),
                FINISH,
            ]
        )


@pytest.mark.asyncio
async def test_a_whole_tool_call_reaches_the_caller_before_its_done_marker_in_the_same_event_fails():
    call = {"type": "tool_call.delta", "name": "f", "arguments": '{"a":', "tool_call_id": "c"}
    events: list[UniEvent] = []
    client = ScriptedClient([delta(with_id("0", call), done_marker("0")), FINISH])

    with pytest.raises(ToolCallArgumentParseError):
        async for event in client.streaming_response(messages=[USER], config={}):
            events.append(event)

    assert items(events) == [call]


REPLY: list[UniEvent] = [delta(with_id("0", {"type": "text.delta", "text": "hello"})), FINISH]


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
    with pytest.warns(FutureWarning, match="0.6.0") as warnings_record:
        async for _event in client.streaming_response(messages=[legacy_message], config={}):
            pass
        client.set_history([legacy_message])

    assert len([warning for warning in warnings_record if warning.category is FutureWarning]) == 1
    assert client.sent_messages[0][0]["content_items"] == [
        {"type": "text.done", "text": "hi"},
        {"type": "tool_result.done", "text": "22 C", "tool_call_id": "call_1"},
    ]
    # the caller's message is left as it was
    assert legacy_message["content_items"][0]["type"] == "text"
    assert client.get_history()[0]["content_items"][0]["type"] == "text.done"

    current = [USER]
    assert normalize_legacy_messages(current)[0] is USER
