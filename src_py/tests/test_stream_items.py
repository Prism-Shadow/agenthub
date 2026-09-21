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

import pytest

from agenthub.errors import StreamProtocolError, ToolCallArgumentParseError
from agenthub.stream_items import StreamItems


def with_id(item_id, item, fidelity=None):
    """A delta the way a client yields it: the item's id rides in fidelity.item_id."""
    if not item_id and not fidelity:
        return item

    return {**item, "fidelity": {"item_id": item_id, **(fidelity or {})}}


def text(item_id, value, fidelity=None):
    return with_id(item_id, {"type": "text.delta", "text": value}, fidelity)


def thinking(item_id, value, fidelity=None):
    return with_id(item_id, {"type": "thinking.delta", "thinking": value}, fidelity)


def call(item_id, name, tool_call_id, arguments=""):
    return with_id(
        item_id, {"type": "tool_call.delta", "name": name, "arguments": arguments, "tool_call_id": tool_call_id}
    )


def args(item_id, fragment):
    return call(item_id, "", "", fragment)


def data(item_id, value, mime_type, item_type="inline_data.delta"):
    return with_id(item_id, {"type": item_type, "data": value.encode(), "mime_type": mime_type})


# ---------------------------------------------------------------- one assembly rule for every kind


def test_a_done_item_is_the_first_delta_with_the_growing_field_joined_and_item_id_never_goes_out():
    items = StreamItems("Test")
    assert items.delta(text("0", "Hel")) == [{"type": "text.delta", "text": "Hel"}]
    assert items.delta(text("0", "lo")) == [{"type": "text.delta", "text": "lo"}]
    assert items.end() == [{"type": "text.done", "text": "Hello"}]


def test_a_tool_call_keeps_the_header_of_its_first_delta_and_parses_the_joined_arguments():
    items = StreamItems("Test")
    assert items.delta(call("1", "get_weather", "toolu_1")) == [
        {"type": "tool_call.delta", "name": "get_weather", "arguments": "", "tool_call_id": "toolu_1"}
    ]
    items.delta(args("1", '{"city":'))
    items.delta(args("1", '"Paris"}'))
    assert items.end() == [
        {"type": "tool_call.done", "name": "get_weather", "arguments": {"city": "Paris"}, "tool_call_id": "toolu_1"}
    ]


def test_malformed_arguments_raise_when_the_call_is_done_empty_ones_parse_to_an_empty_object():
    items = StreamItems("Test")
    items.delta(call("0", "f", "c", '{"a":'))
    with pytest.raises(ToolCallArgumentParseError):
        items.end()

    items.delta(call("1", "g", "d"))
    assert items.end()[0]["arguments"] == {}


def test_audio_chunks_join_into_one_buffer_while_every_image_is_an_item_of_its_own():
    items = StreamItems("Test")
    items.delta(data("0", "ab", "audio/L16"))
    items.delta(data("0", "c", "audio/L16"))
    assert items.end() == [{"type": "inline_data.done", "data": b"abc", "mime_type": "audio/L16"}]

    items.delta(data("0", "one", "image/png"))
    out = items.delta(data("0", "two", "image/png"))
    assert [(item["type"], item["data"]) for item in out] == [
        ("inline_data.done", b"one"),
        ("inline_data.delta", b"two"),
    ]
    # a thought image too
    out = items.delta(data("0", "three", "image/png", "inline_thinking.delta"))
    assert [item["type"] for item in out] == ["inline_data.done", "inline_thinking.delta"]


def test_a_vector_is_an_item_of_its_own_and_an_empty_one_goes_out_all_the_same():
    items = StreamItems("Test")
    assert items.delta({"type": "embedding.delta", "embedding": [0.1, 0.2]}) == [
        {"type": "embedding.delta", "embedding": [0.1, 0.2]}
    ]
    # it stands for the input it was made of
    assert items.delta({"type": "embedding.delta", "embedding": []}) == [
        {"type": "embedding.done", "embedding": [0.1, 0.2]},
        {"type": "embedding.delta", "embedding": []},
    ]
    assert items.end() == [{"type": "embedding.done", "embedding": []}]


# ---------------------------------------------------------------- when an item is done


def test_a_delta_under_another_id_ends_the_item_streaming_ahead_of_the_delta():
    items = StreamItems("Test")
    items.delta(thinking("reasoning", "Hmm"))
    assert items.delta(text("content", "Hel")) == [
        {"type": "thinking.done", "thinking": "Hmm"},
        {"type": "text.delta", "text": "Hel"},
    ]
    items.delta(text("content", "lo"))
    # the same kind under another id is the next item too
    assert items.delta(text("content_2", "!")) == [
        {"type": "text.done", "text": "Hello"},
        {"type": "text.delta", "text": "!"},
    ]


def test_a_delta_of_another_kind_under_the_same_id_is_the_next_item():
    # an Interactions thought step going text, image, text
    items = StreamItems("Test")
    items.delta(thinking("0", "first"))
    out = items.delta(data("0", "draft", "image/png", "inline_thinking.delta"))
    assert [item["type"] for item in out] == ["thinking.done", "inline_thinking.delta"]
    out = items.delta(thinking("0", "then"))
    assert out[0] == {"type": "inline_thinking.done", "data": b"draft", "mime_type": "image/png"}
    assert out[1] == {"type": "thinking.delta", "thinking": "then"}


def test_a_calls_name_begins_the_next_call_and_its_arguments_continue_it_whatever_id_they_carry():
    # Chat Completions: every call under the same wire field
    items = StreamItems("Test")
    items.delta(call("tool_calls", "f", "call_1", '{"a":'))
    items.delta(args("tool_calls", "1}"))
    out = items.delta(call("tool_calls", "g", "call_2"))
    assert out[0] == {"type": "tool_call.done", "name": "f", "arguments": {"a": 1}, "tool_call_id": "call_1"}
    assert out[1]["name"] == "g"
    # a gateway announcing a call under one id and streaming its arguments under another
    items.delta(args("fc_other", '{"q":"m"}'))
    assert items.end() == [{"type": "tool_call.done", "name": "g", "arguments": {"q": "m"}, "tool_call_id": "call_2"}]


def test_a_delta_without_an_id_continues_the_item_streaming_now_which_takes_the_first_id_it_sees():
    items = StreamItems("Test")
    items.delta(text(None, "a"))
    items.delta(text("msg_1", "b"))
    items.delta(text(None, "c"))
    assert items.delta(text("msg_2", "d")) == [
        {"type": "text.done", "text": "abc"},
        {"type": "text.delta", "text": "d"},
    ]


def test_the_item_streaming_when_the_stream_ends_is_done_and_nothing_is_when_none_streams():
    items = StreamItems("Test")
    assert items.end() == []
    items.delta(text("0", "a"))
    assert items.end() == [{"type": "text.done", "text": "a"}]
    assert items.end() == []


# ---------------------------------------------------------------- fidelity


def test_the_fidelity_a_delta_carries_is_the_done_items_and_a_repeat_of_it_goes_out_once():
    items = StreamItems("Test")
    fidelity = {"reasoning_field": "reasoning_content"}
    assert items.delta(thinking("r", "a", fidelity)) == [
        {"type": "thinking.delta", "thinking": "a", "fidelity": fidelity}
    ]
    assert items.delta(thinking("r", "b", fidelity)) == [{"type": "thinking.delta", "thinking": "b"}]
    assert items.end() == [{"type": "thinking.done", "thinking": "ab", "fidelity": fidelity}]


def test_a_signature_arriving_after_the_text_is_a_delta_of_its_own_carrying_only_fidelity():
    items = StreamItems("Test")
    items.delta(thinking("0", "Let me look"))
    assert items.delta(thinking("0", "", {"signature": "sig"})) == [
        {"type": "thinking.delta", "thinking": "", "fidelity": {"signature": "sig"}}
    ]
    assert items.end() == [{"type": "thinking.done", "thinking": "Let me look", "fidelity": {"signature": "sig"}}]


def test_two_different_fidelity_payloads_in_one_item_raise_naming_the_item():
    items = StreamItems("Test")
    items.delta(thinking("rs_1", "a", {"signature": "1"}))
    with pytest.raises(StreamProtocolError, match="item rs_1 carried two different fidelity payloads"):
        items.delta(thinking("rs_1", "", {"signature": "2"}))


def test_fidelity_sent_alone_under_the_items_id_is_that_items_whatever_kind_carries_it():
    # an Interactions thought step: an image, then the signature the step ends with
    items = StreamItems("Test")
    items.delta(data("0", "draft", "image/png", "inline_thinking.delta"))
    assert items.delta(thinking("0", "", {"signature": "sig"})) == [
        {"type": "inline_thinking.delta", "data": b"", "mime_type": "image/png", "fidelity": {"signature": "sig"}}
    ]
    assert items.end() == [
        {"type": "inline_thinking.done", "data": b"draft", "mime_type": "image/png", "fidelity": {"signature": "sig"}}
    ]


# ---------------------------------------------------------------- what goes out


def test_a_delta_carrying_nothing_goes_nowhere_and_an_item_nothing_went_out_for_has_no_done_item():
    items = StreamItems("Test")
    assert items.delta(text("msg_1", "")) == []
    assert items.delta(text("msg_2", "a")) == [{"type": "text.delta", "text": "a"}]


def test_the_first_tool_call_delta_must_carry_the_name_and_the_tool_call_id():
    items = StreamItems("Test")
    with pytest.raises(
        StreamProtocolError, match="the first tool_call.delta of item 1 must carry the name and the tool_call_id"
    ):
        items.delta(call("1", "g", ""))

    # arguments with no call streaming
    with pytest.raises(
        StreamProtocolError, match="the first tool_call.delta of an item must carry the name and the tool_call_id"
    ):
        StreamItems("Test").delta(args(None, "{}"))


def test_a_client_yields_deltas_only():
    items = StreamItems("Test")
    with pytest.raises(StreamProtocolError):
        items.delta({"type": "text.done", "text": "a"})
