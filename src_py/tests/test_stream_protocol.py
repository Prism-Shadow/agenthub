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
from typing import Any, AsyncIterator

import pytest
from stream_grammar import assert_stream_grammar

from agenthub import legacy
from agenthub.base_client import LLMClient
from agenthub.errors import EmptyResponseError, StreamProtocolError, ToolCallArgumentParseError
from agenthub.legacy import normalize_legacy_messages
from agenthub.stream_items import StreamItems
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
    """A client that replays a fixed list of events, complete items included, and records the messages it was sent."""

    def __init__(self, events: list[UniEvent]) -> None:
        self._model = "scripted"
        self._history = []
        self._events = events
        self.sent_messages: list[list[UniMessage]] = []

    def transform_uni_config_to_model_config(self, config: UniConfig) -> None:
        return None

    def transform_uni_message_to_model_input(self, messages: list[UniMessage]) -> list[UniMessage]:
        return messages

    def transform_model_output_to_uni_event(
        self, model_output: UniEvent, items: StreamItems | None = None
    ) -> UniEvent:
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


# one wire event of a provider: a fragment of an item, the end of an item, or the usage
Step = tuple[str, Any, Any] | tuple[str, Any]


class AssembledClient(LLMClient):
    """A client that assembles its items with StreamItems the way every real client does, one wire event per step."""

    def __init__(self, steps: list[Step]) -> None:
        self._model = "assembled"
        self._history = []
        self._steps = steps

    def transform_uni_config_to_model_config(self, config: UniConfig) -> None:
        return None

    def transform_uni_message_to_model_input(self, messages: list[UniMessage]) -> list[UniMessage]:
        return messages

    def transform_model_output_to_uni_event(self, step: Step, items: StreamItems) -> UniEvent:
        if step[0] == "stop":
            return stop(step[1], step[2])

        return delta(*(items.delta(step[1], step[2]) if step[0] == "delta" else items.done(step[1])))

    async def _streaming_response_internal(
        self,
        messages: list[UniMessage],
        config: UniConfig,
    ) -> AsyncIterator[UniEvent]:
        items = StreamItems(self.__class__.__name__)
        for step in self._steps:
            yield self.transform_model_output_to_uni_event(step, items)

        yield delta(*items.end())

    async def list_models(self) -> list[str]:
        return []


async def collect(client: LLMClient, config: UniConfig | None = None) -> list[UniEvent]:
    return [event async for event in client.streaming_response(messages=[USER], config=config or {})]


def items(events: list[UniEvent]) -> list[EventContentItem]:
    return [item for event in events for item in event["content_items"]]


# ---------------------------------------------------------------- the public stream


@pytest.mark.asyncio
async def test_text_streams_as_deltas_a_done_item_then_the_stop_event():
    events = await collect(
        ScriptedClient(
            [
                delta(with_id("0", {"type": "text.delta", "text": "Hel"})),
                delta(with_id("0", {"type": "text.delta", "text": "lo"})),
                delta(with_id("0", {"type": "text.done", "text": "Hello"})),
                FINISH,
            ]
        )
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
async def test_thinking_closed_by_a_signature_then_a_tool_call():
    events = await collect(
        ScriptedClient(
            [
                delta(with_id("0", {"type": "thinking.delta", "thinking": "Let me"})),
                delta(with_id("0", {"type": "thinking.delta", "thinking": " look"})),
                delta(with_id("0", {"type": "thinking.delta", "thinking": "", "fidelity": {"signature": "sig"}})),
                delta(
                    with_id(
                        "0", {"type": "thinking.done", "thinking": "Let me look", "fidelity": {"signature": "sig"}}
                    )
                ),
                delta(
                    with_id(
                        "1",
                        {"type": "tool_call.delta", "name": "get_weather", "arguments": "", "tool_call_id": "toolu_1"},
                    )
                ),
                delta(
                    with_id(
                        "1",
                        {"type": "tool_call.delta", "name": "", "arguments": '{"city":"Paris"}', "tool_call_id": ""},
                    )
                ),
                delta(
                    with_id(
                        "1",
                        {
                            "type": "tool_call.done",
                            "name": "get_weather",
                            "arguments": {"city": "Paris"},
                            "tool_call_id": "toolu_1",
                        },
                    )
                ),
                stop(USAGE, "tool_call"),
            ]
        )
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

    def done(call_id: str, arguments: dict[str, int]) -> UniEvent:
        return delta(
            with_id(
                call_id,
                {
                    "type": "tool_call.done",
                    "name": f"tool_{call_id}",
                    "arguments": arguments,
                    "tool_call_id": f"call_{call_id}",
                },
            )
        )

    events = await collect(
        ScriptedClient(
            [
                call("a"),
                call("b"),
                fragment("a", '{"x":'),
                fragment("b", '{"y":2}'),
                done("b", {"y": 2}),
                fragment("a", "1}"),
                done("a", {"x": 1}),
                FINISH,
            ]
        )
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
async def test_usage_pieces_merge_field_by_field():
    events = await collect(
        ScriptedClient(
            [
                delta(with_id("0", {"type": "text.delta", "text": "a"})),
                delta(with_id("0", {"type": "text.done", "text": "a"})),
                stop({"cached_tokens": 3, "prompt_tokens": 7, "thoughts_tokens": None, "response_tokens": None}, None),
                stop(
                    {"cached_tokens": None, "prompt_tokens": None, "thoughts_tokens": None, "response_tokens": 9},
                    "length",
                ),
            ]
        )
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
            delta(with_id("0", {"type": "thinking.done", "thinking": "a", "fidelity": {"signature": "s"}})),
            delta(with_id("1", {"type": "text.delta", "text": "b"})),
            delta(with_id("1", {"type": "text.done", "text": "b"})),
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
    assert "fidelity" not in items(events)[2]
    assert "item_id" not in json.dumps(client.concat_uni_events_to_uni_message(events))
    assert "item_id" not in json.dumps(client.get_history())


@pytest.mark.asyncio
async def test_an_event_carries_several_items_in_wire_order():
    # Responses reasoning: the fidelity arrives with the item's end, in one wire event
    reasoning = await collect(
        ScriptedClient(
            [
                delta(with_id("rs_1", {"type": "thinking.delta", "thinking": "Plan"})),
                delta(
                    with_id(
                        "rs_1", {"type": "thinking.delta", "thinking": "", "fidelity": {"encrypted_content": "enc"}}
                    ),
                    with_id(
                        "rs_1", {"type": "thinking.done", "thinking": "Plan", "fidelity": {"encrypted_content": "enc"}}
                    ),
                ),
                delta(with_id("msg_1", {"type": "text.delta", "text": "Done"})),
                delta(with_id("msg_1", {"type": "text.done", "text": "Done"})),
                FINISH,
            ]
        )
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
        ScriptedClient(
            [
                delta(with_id("0", {"type": "thinking.delta", "thinking": "Hmm"})),
                delta(
                    with_id("0", {"type": "thinking.done", "thinking": "Hmm"}),
                    with_id("1", {"type": "text.delta", "text": "Hel"}),
                ),
                stop(None, "stop", [with_id("1", {"type": "text.delta", "text": "lo"})]),
                delta(with_id("1", {"type": "text.done", "text": "Hello"})),
                stop(USAGE, None),
            ]
        )
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
async def test_an_empty_delta_event_and_a_stop_event_carrying_nothing_are_ignored():
    events = await collect(
        ScriptedClient(
            [
                delta(),
                delta(with_id("0", {"type": "text.delta", "text": "a"})),
                delta(with_id("0", {"type": "text.done", "text": "a"})),
                FINISH,
                stop(None, None),
                delta(),
            ]
        )
    )

    assert_stream_grammar(events)
    assert items(events) == [{"type": "text.delta", "text": "a"}, {"type": "text.done", "text": "a"}]
    assert events[-1]["usage_metadata"] == USAGE
    assert events[-1]["finish_reason"] == "stop"


# ---------------------------------------------------------------- a client assembling its items with StreamItems


@pytest.mark.asyncio
async def test_an_anthropic_shaped_stream_blocks_under_their_index_done_on_their_stop():
    events = await collect(
        AssembledClient(
            [
                ("stop", USAGE, None),
                ("delta", "0", {"type": "thinking.delta", "thinking": "Let me"}),
                ("delta", "0", {"type": "thinking.delta", "thinking": " look"}),
                ("delta", "0", {"type": "thinking.delta", "thinking": "", "fidelity": {"signature": "sig"}}),
                ("done", "0"),
                (
                    "delta",
                    "1",
                    {"type": "tool_call.delta", "name": "get_weather", "arguments": "", "tool_call_id": "toolu_1"},
                ),
                ("delta", "1", {"type": "tool_call.delta", "name": "", "arguments": '{"city":', "tool_call_id": ""}),
                ("delta", "1", {"type": "tool_call.delta", "name": "", "arguments": '"Paris"}', "tool_call_id": ""}),
                ("done", "1"),
                ("stop", None, "tool_call"),
            ]
        )
    )

    assert_stream_grammar(events)
    assert items(events) == [
        {"type": "thinking.delta", "thinking": "Let me"},
        {"type": "thinking.delta", "thinking": " look"},
        {"type": "thinking.delta", "thinking": "", "fidelity": {"signature": "sig"}},
        {"type": "thinking.done", "thinking": "Let me look", "fidelity": {"signature": "sig"}},
        {"type": "tool_call.delta", "name": "get_weather", "arguments": "", "tool_call_id": "toolu_1"},
        {"type": "tool_call.delta", "name": "", "arguments": '{"city":', "tool_call_id": ""},
        {"type": "tool_call.delta", "name": "", "arguments": '"Paris"}', "tool_call_id": ""},
        {"type": "tool_call.done", "name": "get_weather", "arguments": {"city": "Paris"}, "tool_call_id": "toolu_1"},
    ]
    assert events[-1]["usage_metadata"] == USAGE
    assert events[-1]["finish_reason"] == "tool_call"


@pytest.mark.asyncio
async def test_items_still_open_when_the_providers_stream_ends_are_done_before_the_stop():
    events = await collect(
        AssembledClient(
            [
                ("delta", "0", {"type": "text.delta", "text": "a"}),
                ("delta", "1", {"type": "text.delta", "text": "b"}),
                ("stop", USAGE, "stop"),
            ]
        )
    )

    assert_stream_grammar(events)
    assert items(events) == [
        {"type": "text.delta", "text": "a"},
        {"type": "text.done", "text": "a"},
        {"type": "text.delta", "text": "b"},
        {"type": "text.done", "text": "b"},
    ]


@pytest.mark.asyncio
async def test_a_tool_calls_fragments_reach_the_caller_before_its_malformed_arguments_fail():
    events: list[UniEvent] = []
    client = AssembledClient(
        [
            ("delta", "0", {"type": "tool_call.delta", "name": "f", "arguments": '{"a":', "tool_call_id": "c"}),
            ("done", "0"),
            ("stop", USAGE, "stop"),
        ]
    )

    with pytest.raises(ToolCallArgumentParseError):
        async for event in client.streaming_response(messages=[USER], config={}):
            events.append(event)

    assert items(events) == [{"type": "tool_call.delta", "name": "f", "arguments": '{"a":', "tool_call_id": "c"}]


# ---------------------------------------------------------------- stream protocol violations and rejected responses


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "script",
    [
        pytest.param(
            [
                delta(with_id("0", {"type": "text.delta", "text": "a"})),
                delta(with_id("0", {"type": "text.done", "text": "a"})),
                delta(with_id("0", {"type": "text.delta", "text": "b"})),
            ],
            id="a delta after its item was done",
        ),
        pytest.param(
            [
                delta(with_id("0", {"type": "thinking.delta", "thinking": "a", "fidelity": {"signature": "1"}})),
                delta(with_id("0", {"type": "thinking.delta", "thinking": "", "fidelity": {"signature": "1"}})),
            ],
            id="a second delta carrying fidelity in one item",
        ),
        pytest.param(
            [
                delta(with_id("0", {"type": "thinking.delta", "thinking": "a"})),
                delta(with_id("0", {"type": "thinking.done", "thinking": "a", "fidelity": {"signature": "s"}})),
            ],
            id="a done item whose fidelity differs from its deltas'",
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
            [
                delta(with_id("0", {"type": "text.delta", "text": "a"})),
                delta(with_id("0", {"type": "thinking.done", "thinking": "a"})),
            ],
            id="a done item of another kind under an item's id",
        ),
        pytest.param(
            [delta(with_id("0", {"type": "text.done", "text": "a"}))],
            id="a done item no delta of which streamed",
        ),
        pytest.param([delta({"type": "text.delta", "text": "a"})], id="a delta without fidelity.item_id"),
        pytest.param(
            [{**delta(with_id("0", {"type": "text.delta", "text": "a"})), "finish_reason": "stop"}],
            id="a delta event carrying a finish reason",
        ),
        pytest.param(
            [delta(with_id("0", {"type": "text.delta", "text": "a"}))],
            id="an item still open when the stream ends",
        ),
    ],
)
async def test_stream_protocol_violation_raises_stream_protocol_error(script: list[UniEvent]):
    with pytest.raises(StreamProtocolError):
        await collect(ScriptedClient([*script, FINISH]))


@pytest.mark.asyncio
async def test_the_items_of_an_event_reach_the_caller_up_to_the_one_that_fails():
    events: list[UniEvent] = []
    client = ScriptedClient(
        [
            delta(
                with_id("0", {"type": "text.delta", "text": "a"}),
                with_id("0", {"type": "thinking.delta", "thinking": "b"}),
            ),
            FINISH,
        ]
    )

    with pytest.raises(StreamProtocolError):
        async for event in client.streaming_response(messages=[USER], config={}):
            events.append(event)

    assert items(events) == [{"type": "text.delta", "text": "a"}]


@pytest.mark.asyncio
async def test_a_stream_without_usage_or_finish_reason_yields_no_stop_event():
    events: list[UniEvent] = []
    client = ScriptedClient(
        [
            delta(with_id("0", {"type": "text.delta", "text": "a"})),
            delta(with_id("0", {"type": "text.done", "text": "a"})),
            stop(None, "stop"),
        ]
    )

    with pytest.raises(ValueError, match="without usage_metadata"):
        async for event in client.streaming_response(messages=[USER], config={}):
            events.append(event)

    assert not any(event["event_type"] == "stop" for event in events)


@pytest.mark.asyncio
async def test_a_thinking_only_response_raises_empty_response_error_carrying_its_usage():
    with pytest.raises(EmptyResponseError) as exc_info:
        await collect(
            ScriptedClient(
                [
                    delta(with_id("0", {"type": "thinking.delta", "thinking": "hmm"})),
                    delta(with_id("0", {"type": "thinking.done", "thinking": "hmm"})),
                    FINISH,
                ]
            )
        )

    assert exc_info.value.usage_metadata == USAGE
    assert exc_info.value.finish_reason == "stop"


# ---------------------------------------------------------------- history and legacy messages


REPLY: list[UniEvent] = [
    delta(with_id("0", {"type": "text.delta", "text": "hello"})),
    delta(with_id("0", {"type": "text.done", "text": "hello"})),
    FINISH,
]


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
    events = await collect(ScriptedClient(REPLY))
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
