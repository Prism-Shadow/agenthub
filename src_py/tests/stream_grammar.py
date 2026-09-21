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

from agenthub.types import EventContentItem, UniEvent


def assert_stream_grammar(events: list[UniEvent]) -> None:
    """Assert that a finished stream follows the streaming protocol every client promises.

    Delta events carry one item each, then exactly one stop event carries usage and a finish
    reason; every item streams as contiguous deltas closed by its done item; at most one delta
    of an item carries fidelity, equal to the done item's; the done item holds what its deltas
    streamed; the first tool_call.delta names the call; no item carries the fidelity.item_id a
    client identifies its items with.
    """
    assert len(events) > 0
    stop = events[-1]
    assert stop["event_type"] == "stop"
    assert stop["content_items"] == []
    assert stop["usage_metadata"] is not None
    assert stop["finish_reason"] is not None

    open_deltas: list[EventContentItem] = []
    for event in events[:-1]:
        assert event["event_type"] == "delta"
        assert event["usage_metadata"] is None
        assert event["finish_reason"] is None
        assert len(event["content_items"]) == 1

        item = event["content_items"][0]
        assert "item_id" not in (item.get("fidelity") or {})
        kind, _, phase = item["type"].partition(".")
        assert phase in ("delta", "done")
        if open_deltas:
            # an item must be done before the next one starts
            assert open_deltas[0]["type"] == f"{kind}.delta"

        if phase == "delta":
            if not open_deltas and item["type"] == "tool_call.delta":
                assert item["name"] != ""
                assert item["tool_call_id"] != ""
            open_deltas.append(item)
            continue

        assert len(open_deltas) > 0
        with_fidelity = [delta for delta in open_deltas if delta.get("fidelity")]
        assert len(with_fidelity) <= 1
        delta_fidelity = with_fidelity[0]["fidelity"] if with_fidelity else {}
        assert delta_fidelity == (item.get("fidelity") or {})

        if item["type"] == "text.done":
            assert item["text"] == "".join(delta["text"] for delta in open_deltas)
        elif item["type"] == "thinking.done":
            assert item["thinking"] == "".join(delta["thinking"] for delta in open_deltas)
        elif item["type"] == "tool_call.done":
            raw = "".join(delta["arguments"] for delta in open_deltas)
            assert item["arguments"] == json.loads(raw or "{}")
            assert item["name"] == open_deltas[0]["name"]
            assert item["tool_call_id"] == open_deltas[0]["tool_call_id"]
        open_deltas = []

    assert open_deltas == []
