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


def text(value, fidelity=None):
    return {"type": "text.delta", "text": value, **({"fidelity": fidelity} if fidelity else {})}


def thinking(value, fidelity=None):
    return {"type": "thinking.delta", "thinking": value, **({"fidelity": fidelity} if fidelity else {})}


def call(name, tool_call_id, arguments=""):
    return {"type": "tool_call.delta", "name": name, "arguments": arguments, "tool_call_id": tool_call_id}


def args(fragment):
    return call("", "", fragment)


def image(data, item_type="inline_thinking.delta"):
    return {"type": item_type, "data": data.encode(), "mime_type": "image/png"}


# ---------------------------------------------------------------- one assembly rule for every kind


def test_a_done_item_is_the_first_delta_with_the_growing_field_joined_numbered_within_the_stream():
    items = StreamItems("Test")
    assert items.delta("0", text("Hel")) == [{"type": "text.delta", "text": "Hel", "fidelity": {"item_id": "1"}}]
    assert items.delta("0", text("lo")) == [{"type": "text.delta", "text": "lo", "fidelity": {"item_id": "1"}}]
    assert items.done("0") == [{"type": "text.done", "text": "Hello", "fidelity": {"item_id": "1"}}]
    assert items.delta("1", thinking("hmm")) == [
        {"type": "thinking.delta", "thinking": "hmm", "fidelity": {"item_id": "2"}}
    ]
    assert items.done("1") == [{"type": "thinking.done", "thinking": "hmm", "fidelity": {"item_id": "2"}}]


def test_a_tool_call_keeps_the_header_of_its_first_delta_and_parses_the_joined_arguments():
    items = StreamItems("Test")
    assert items.delta("1", call("get_weather", "toolu_1")) == [
        {
            "type": "tool_call.delta",
            "name": "get_weather",
            "arguments": "",
            "tool_call_id": "toolu_1",
            "fidelity": {"item_id": "1"},
        }
    ]
    items.delta("1", args('{"city":'))
    items.delta("1", args('"Paris"}'))
    assert items.done("1") == [
        {
            "type": "tool_call.done",
            "name": "get_weather",
            "arguments": {"city": "Paris"},
            "tool_call_id": "toolu_1",
            "fidelity": {"item_id": "1"},
        }
    ]
    # the fields keep the order of the first delta, whatever the client's
    reordered = StreamItems("Test")
    reordered.delta("1", {"type": "tool_call.delta", "tool_call_id": "c", "name": "f", "arguments": "{}"})
    assert list(reordered.done("1")[0]) == ["type", "tool_call_id", "name", "arguments", "fidelity"]


def test_malformed_arguments_raise_when_the_call_is_done_empty_ones_parse_to_an_empty_object():
    items = StreamItems("Test")
    items.delta("1", call("f", "c", '{"a":'))
    with pytest.raises(ToolCallArgumentParseError):
        items.done("1")

    empty = StreamItems("Test")
    empty.delta("1", call("f", "c"))
    assert empty.done("1")[0]["arguments"] == {}


def test_bytes_join_into_one_buffer_and_an_embedding_is_one_whole_vector():
    items = StreamItems("Test")
    items.delta("0", {"type": "inline_data.delta", "data": b"\x01\x02", "mime_type": "audio/L16"})
    items.delta("0", {"type": "inline_data.delta", "data": b"\x03", "mime_type": "audio/L16"})
    assert items.done("0") == [
        {"type": "inline_data.done", "data": b"\x01\x02\x03", "mime_type": "audio/L16", "fidelity": {"item_id": "1"}}
    ]
    assert items.delta("v", {"type": "embedding.delta", "embedding": [0.1, 0.2]}) == [
        {"type": "embedding.delta", "embedding": [0.1, 0.2], "fidelity": {"item_id": "2"}}
    ]
    assert items.done("v") == [{"type": "embedding.done", "embedding": [0.1, 0.2], "fidelity": {"item_id": "2"}}]


# ---------------------------------------------------------------- fidelity


def test_the_fidelity_a_delta_carries_is_the_done_items_and_a_repeat_of_it_goes_out_once():
    items = StreamItems("Test")
    fidelity = {"reasoning_field": "reasoning_content"}
    assert items.delta("r", thinking("a", fidelity)) == [
        {"type": "thinking.delta", "thinking": "a", "fidelity": {"item_id": "1", **fidelity}}
    ]
    assert items.delta("r", thinking("b", fidelity)) == [
        {"type": "thinking.delta", "thinking": "b", "fidelity": {"item_id": "1"}}
    ]
    # a repeat that leaves the fragment carrying nothing goes out nowhere
    assert items.delta("r", thinking("", fidelity)) == []
    assert items.done("r") == [{"type": "thinking.done", "thinking": "ab", "fidelity": {"item_id": "1", **fidelity}}]


def test_a_signature_arriving_after_the_text_is_a_fragment_of_its_own_carrying_only_fidelity():
    items = StreamItems("Test")
    items.delta("0", thinking("Let me look"))
    assert items.delta("0", thinking("", {"signature": "sig"})) == [
        {"type": "thinking.delta", "thinking": "", "fidelity": {"item_id": "1", "signature": "sig"}}
    ]
    assert items.done("0") == [
        {"type": "thinking.done", "thinking": "Let me look", "fidelity": {"item_id": "1", "signature": "sig"}}
    ]


def test_two_different_fidelity_payloads_in_one_item_raise_naming_the_providers_id():
    items = StreamItems("Test")
    items.delta("0", thinking("a", {"signature": "1"}))
    with pytest.raises(StreamProtocolError, match="item 0 carried two different fidelity payloads"):
        items.delta("0", thinking("", {"signature": "2"}))


def test_fidelity_sent_under_an_items_id_belongs_to_that_item_whatever_kind_it_streams():
    # an Interactions thought step: an image, then the signature that closes the step
    items = StreamItems("Test", sequential=True)
    items.delta("0", image("draft"))
    assert items.delta("0", thinking("", {"signature": "sig"})) == [
        {
            "type": "inline_thinking.delta",
            "data": b"",
            "mime_type": "image/png",
            "fidelity": {"item_id": "1", "signature": "sig"},
        }
    ]
    assert items.done("0") == [
        {
            "type": "inline_thinking.done",
            "data": b"draft",
            "mime_type": "image/png",
            "fidelity": {"item_id": "1", "signature": "sig"},
        }
    ]


# ---------------------------------------------------------------- what goes out


def test_a_fragment_carrying_nothing_registers_its_item_and_goes_out_nowhere():
    items = StreamItems("Test")
    assert items.delta("msg", text("")) == []
    assert items.delta("msg", text("a")) == [{"type": "text.delta", "text": "a", "fidelity": {"item_id": "1"}}]
    assert items.delta("msg", text("")) == []
    assert items.done("msg") == [{"type": "text.done", "text": "a", "fidelity": {"item_id": "1"}}]
    # an announce the header rides on is not nothing
    assert len(items.delta("fc", call("f", "c"))) == 1


def test_an_item_nothing_went_out_for_yet_streams_the_kind_of_the_first_fragment_that_does():
    # a tool_use block announced without its name, then a thinking block under the same index
    items = StreamItems("Test")
    assert items.delta("1", call("", "")) == []
    assert items.delta("1", thinking("hmm")) == [
        {"type": "thinking.delta", "thinking": "hmm", "fidelity": {"item_id": "1"}}
    ]
    assert items.done("1") == [{"type": "thinking.done", "thinking": "hmm", "fidelity": {"item_id": "1"}}]


def test_an_item_no_fragment_of_which_went_out_has_no_done_item():
    items = StreamItems("Test")
    items.delta("msg", text(""))
    assert items.done("msg") == []
    assert items.done("never") == []
    assert items.done() == []


def test_the_first_tool_call_delta_must_carry_the_name_and_the_tool_call_id():
    items = StreamItems("Test")
    with pytest.raises(
        StreamProtocolError, match="the first tool_call.delta of item 0 must carry the name and the tool_call_id"
    ):
        items.delta("0", call("f", "", "{}"))

    with pytest.raises(StreamProtocolError, match="the first tool_call.delta of item unkeyed-0 must carry"):
        StreamItems("Test").delta(None, args("{}"))


# ---------------------------------------------------------------- which item a fragment belongs to


def test_a_fragment_without_an_id_belongs_to_the_item_streamed_last_while_it_is_open_and_of_the_kind():
    items = StreamItems("Test")
    items.delta("rs_1", thinking(""))
    assert items.delta(None, thinking("Plan")) == [
        {"type": "thinking.delta", "thinking": "Plan", "fidelity": {"item_id": "1"}}
    ]
    # another kind starts an item of its own
    assert items.delta(None, text("Answer")) == [
        {"type": "text.delta", "text": "Answer", "fidelity": {"item_id": "2"}}
    ]
    # the item streamed last ends with an id-less done
    assert items.done() == [{"type": "text.done", "text": "Answer", "fidelity": {"item_id": "2"}}]
    assert items.done("rs_1") == [{"type": "thinking.done", "thinking": "Plan", "fidelity": {"item_id": "1"}}]
    # nothing open any more: a new item
    assert items.delta(None, text("More")) == [{"type": "text.delta", "text": "More", "fidelity": {"item_id": "3"}}]


def test_a_continuation_whose_id_names_nothing_belongs_to_the_item_streamed_last():
    # a gateway announcing a call under one id and streaming its arguments under another
    items = StreamItems("Test")
    items.delta("fc_real", call("lookup", "call_m"))
    items.delta("fc_other", args('{"q":"m"}'))
    assert items.done("fc_real") == [
        {
            "type": "tool_call.done",
            "name": "lookup",
            "arguments": {"q": "m"},
            "tool_call_id": "call_m",
            "fidelity": {"item_id": "1"},
        }
    ]


def test_a_fragment_carrying_part_of_its_header_is_a_malformed_start_not_a_continuation():
    items = StreamItems("Test")
    items.delta("0", call("f", "toolu_0"))
    with pytest.raises(
        StreamProtocolError, match="the first tool_call.delta of item 1 must carry the name and the tool_call_id"
    ):
        items.delta("1", call("g", ""))

    with pytest.raises(StreamProtocolError, match="the first tool_call.delta of item unkeyed-0 must carry"):
        items.delta(None, call("", "toolu_2"))


def test_a_fragment_that_can_start_an_item_starts_one_under_a_new_id():
    items = StreamItems("Test")
    items.delta("msg_1", text("a"))
    assert items.delta("msg_2", text("b")) == [{"type": "text.delta", "text": "b", "fidelity": {"item_id": "2"}}]
    assert items.delta("fc", call("f", "c")) == [
        {"type": "tool_call.delta", "name": "f", "arguments": "", "tool_call_id": "c", "fidelity": {"item_id": "3"}}
    ]


# ---------------------------------------------------------------- items that end on done


def test_items_may_interleave_each_is_done_under_its_own_id():
    items = StreamItems("Test")
    items.delta("a", call("f", "call_a"))
    items.delta("b", call("g", "call_b"))
    items.delta("a", args('{"x":'))
    items.delta("b", args('{"y":2}'))
    items.delta("a", args("1}"))
    done_b = items.done("b")[0]
    assert (done_b["arguments"], done_b["fidelity"]) == ({"y": 2}, {"item_id": "2"})
    done_a = items.done("a")[0]
    assert (done_a["arguments"], done_a["fidelity"]) == ({"x": 1}, {"item_id": "1"})


def test_the_id_of_a_done_item_is_closed_for_good():
    items = StreamItems("Test")
    items.delta("0", text("a"))
    items.done("0")
    with pytest.raises(StreamProtocolError, match="text.delta arrived after item 0 was done"):
        items.delta("0", text("b"))

    with pytest.raises(StreamProtocolError, match="item 0 was done twice"):
        items.done("0")

    # a done for an item that never streamed closes the id too
    items.done("5")
    with pytest.raises(StreamProtocolError):
        items.delta("5", text("late"))


def test_a_fragment_of_another_kind_under_an_open_items_id_is_a_protocol_error():
    items = StreamItems("Test")
    items.delta("0", text("a"))
    with pytest.raises(StreamProtocolError, match="thinking.delta arrived for item 0, which streams text"):
        items.delta("0", thinking("b"))


# ---------------------------------------------------------------- items that end on the next item


def test_the_first_fragment_of_the_next_item_ends_the_previous_one_ahead_of_the_fragment():
    items = StreamItems("Test", sequential=True)
    items.delta("reasoning", thinking("Hmm"))
    assert items.delta("content", text("Hel")) == [
        {"type": "thinking.done", "thinking": "Hmm", "fidelity": {"item_id": "1"}},
        {"type": "text.delta", "text": "Hel", "fidelity": {"item_id": "2"}},
    ]
    assert items.delta("content", text("lo")) == [{"type": "text.delta", "text": "lo", "fidelity": {"item_id": "2"}}]
    assert items.end() == [{"type": "text.done", "text": "Hello", "fidelity": {"item_id": "2"}}]


def test_a_fragment_of_another_kind_under_the_open_items_id_is_the_next_item():
    # a thought step going text, image, text
    items = StreamItems("Test", sequential=True)
    items.delta("0", thinking("first"))
    assert items.delta("0", image("draft")) == [
        {"type": "thinking.done", "thinking": "first", "fidelity": {"item_id": "1"}},
        {"type": "inline_thinking.delta", "data": b"draft", "mime_type": "image/png", "fidelity": {"item_id": "2"}},
    ]
    assert items.delta("0", thinking("then")) == [
        {"type": "inline_thinking.done", "data": b"draft", "mime_type": "image/png", "fidelity": {"item_id": "2"}},
        {"type": "thinking.delta", "thinking": "then", "fidelity": {"item_id": "3"}},
    ]


def test_an_id_is_reused_once_its_item_is_done_and_a_done_still_ends_an_item_on_the_spot():
    # generateContent: every function call is an item of its own under the part kind
    items = StreamItems("Test", sequential=True)
    first = [*items.delta("function_call", call("f", "call_1", '{"a":1}')), *items.done("function_call")]
    assert [(item["type"], item["fidelity"]) for item in first] == [
        ("tool_call.delta", {"item_id": "1"}),
        ("tool_call.done", {"item_id": "1"}),
    ]
    assert first[1]["arguments"] == {"a": 1}
    second = [*items.delta("function_call", call("g", "call_2", "{}")), *items.done("function_call")]
    assert [(item["type"], item["fidelity"]) for item in second] == [
        ("tool_call.delta", {"item_id": "2"}),
        ("tool_call.done", {"item_id": "2"}),
    ]
    # each image its own item: the done goes before the image, which stays open for a signature
    images = [
        *items.delta("img", image("one", "inline_data.delta")),
        *items.done("img"),
        *items.delta("img", image("two", "inline_data.delta")),
    ]
    assert [(item["type"], item["fidelity"]) for item in images] == [
        ("inline_data.delta", {"item_id": "3"}),
        ("inline_data.done", {"item_id": "3"}),
        ("inline_data.delta", {"item_id": "4"}),
    ]


# ---------------------------------------------------------------- the end of the stream


def test_every_item_still_open_is_done_in_the_order_they_started():
    items = StreamItems("Test")
    items.delta("a", text("a"))
    items.delta("b", text("b"))
    items.delta("c", text(""))
    assert items.end() == [
        {"type": "text.done", "text": "a", "fidelity": {"item_id": "1"}},
        {"type": "text.done", "text": "b", "fidelity": {"item_id": "2"}},
    ]
    assert items.end() == []
