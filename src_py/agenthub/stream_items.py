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

from dataclasses import dataclass, field
from typing import Any, Callable

from .errors import StreamProtocolError, parse_tool_call_arguments
from .types import ContentItem, DeltaContentItem, EventContentItem, Fidelity


@dataclass(frozen=True)
class _Kind:
    """How a kind of item streams: the one field its deltas grow, and the fields only its first delta carries.

    A done item is the first delta with the growing field replaced by the join of every delta's, so
    this table is the only per-kind knowledge in the stream.
    """

    field: str
    header: tuple[str, ...]
    join: Callable[[list[Any]], Any]
    # the joined value becomes the done item's; tool call arguments stream as a JSON string and are
    # parsed into an object
    parse: Callable[[str, str, dict[str, Any]], Any] | None = None
    # whether a delta begins an item by itself, whatever id it carries
    begins: Callable[[dict[str, Any]], bool] | None = None
    # an empty delta of this kind goes out all the same
    keeps_empty: bool = False


_KINDS = {
    "text": _Kind("text", (), "".join),
    "thinking": _Kind("thinking", (), "".join),
    "tool_call": _Kind(
        "arguments",
        ("name", "tool_call_id"),
        "".join,
        parse=lambda joined, client, header: parse_tool_call_arguments(
            joined, client, header["name"], header["tool_call_id"]
        ),
        # a call's name comes once, on its first delta
        begins=lambda delta: bool(delta["name"]),
    ),
    # an image arrives whole, while audio streams in chunks
    "inline_data": _Kind("data", (), b"".join, begins=lambda delta: delta["mime_type"].startswith("image/")),
    "inline_thinking": _Kind("data", (), b"".join, begins=lambda delta: True),
    # one whole vector per delta, and an empty one still stands for the input it was made of
    "embedding": _Kind(
        "embedding",
        (),
        lambda chunks: [value for chunk in chunks for value in chunk],
        begins=lambda delta: True,
        keeps_empty=True,
    ),
}


@dataclass
class _Item:
    """The item streaming now."""

    kind: str
    # the id its deltas carry, where the provider names its items
    id: str | None = None
    # the first delta that went out, without its fidelity: the item's header
    first: dict[str, Any] | None = None
    # the growing field of every delta that went out
    chunks: list[Any] = field(default_factory=list)
    fidelity: Fidelity | None = None


def _is_empty(kind: _Kind, fields: dict[str, Any]) -> bool:
    """Whether a delta carries no content: its growing field and header fields are empty."""
    return not kind.keeps_empty and len(fields[kind.field]) == 0 and not any(fields[name] for name in kind.header)


class StreamItems:
    """Assembles the items of one stream from the deltas a client yields.

    Model output is serial, so the deltas of an item are contiguous and one item streams at a time:
    it is done when a delta of the next item arrives, or when the stream ends.

    A delta belongs to the next item when it carries another `fidelity.item_id`, is of another kind,
    or begins an item by itself (a call's name, an image, a vector). Otherwise it continues the item
    streaming now: a delta without an id does, and so do a call's arguments whatever id a gateway
    puts on them. Fidelity sent alone under the item's id is that item's, whatever kind carries it.

    Every delta goes out as it arrives, without its `item_id`. A done item is the item's first delta
    with the growing field replaced by the join of every delta's, plus the item's fidelity.
    """

    def __init__(self, client: str) -> None:
        self._client = client
        self._item: _Item | None = None

    def _protocol_error(self, message: str) -> StreamProtocolError:
        return StreamProtocolError(self._client, message)

    def delta(self, delta: DeltaContentItem) -> list[EventContentItem]:
        """One delta a client yielded.

        Returns what goes out: the done item of the item it ended, if any, then the delta itself.
        """
        kind, _, phase = delta["type"].partition(".")
        if phase != "delta" or kind not in _KINDS:
            raise self._protocol_error(f"a client yields deltas, not {delta['type']}")

        fields = {name: value for name, value in delta.items() if name != "fidelity"}
        fidelity = dict(delta.get("fidelity") or {})
        item_id = fidelity.pop("item_id", None)

        out: list[EventContentItem] = []
        item = self._item
        if (
            item is not None
            and item.first is not None
            and item.kind != kind
            and item_id
            and item_id == item.id
            and fidelity
            and _is_empty(_KINDS[kind], fields)
        ):
            # fidelity sent alone under the item's id is that item's, whatever kind carries it
            spec = _KINDS[item.kind]
            fields = {**item.first, spec.field: spec.join([])}
        elif item is None or self._begins(item, kind, item_id, fields):
            out.extend(self.end())
            item = self._item = _Item(kind)

        item.id = item.id or item_id

        name = f"item {item.id}" if item.id else "an item"
        if fidelity:
            if item.fidelity is None:
                item.fidelity = fidelity
            elif item.fidelity == fidelity:
                # repeated fidelity goes out once
                fidelity = {}
            else:
                raise self._protocol_error(f"{name} carried two different fidelity payloads")

        spec = _KINDS[item.kind]
        if _is_empty(spec, fields) and not fidelity:
            # carries nothing; the item is streaming all the same
            return out

        if item.first is None:
            if not all(fields[header] for header in spec.header):
                raise self._protocol_error(
                    f"the first {fields['type']} of {name} must carry the {' and the '.join(spec.header)}"
                )

            item.first = fields

        item.chunks.append(fields[spec.field])
        out.append({**fields, "fidelity": fidelity} if fidelity else fields)
        return out

    def end(self) -> list[ContentItem]:
        """The next item began, or the stream ended.

        Returns the done item of the item streaming now, or nothing when no delta of it went out.
        """
        item = self._item
        self._item = None
        if item is None or item.first is None:
            return []

        spec = _KINDS[item.kind]
        joined = spec.join(item.chunks)
        done = {
            **item.first,
            "type": f"{item.kind}.done",
            spec.field: spec.parse(joined, self._client, item.first) if spec.parse else joined,
        }
        if item.fidelity is not None:
            done["fidelity"] = item.fidelity

        return [done]

    def _begins(self, item: _Item, kind: str, item_id: str | None, fields: dict[str, Any]) -> bool:
        """Whether a delta begins the next item rather than continuing the one streaming now."""
        spec = _KINDS[kind]
        if item.kind != kind or (spec.begins is not None and spec.begins(fields)):
            return True

        # what cannot begin an item (a call's arguments) continues the one streaming now
        return not spec.header and bool(item_id) and bool(item.id) and item_id != item.id
