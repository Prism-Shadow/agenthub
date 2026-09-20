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
    ),
    "inline_data": _Kind("data", (), b"".join),
    "inline_thinking": _Kind("data", (), b"".join),
    # one whole vector per delta
    "embedding": _Kind("embedding", (), lambda chunks: [value for chunk in chunks for value in chunk]),
}


@dataclass
class _Item:
    # the provider's id for the item, or unkeyed-N for one the provider never names
    key: str
    # the item's number within the stream: what fidelity.item_id carries
    id: str
    kind: str
    open: bool = True
    # the first fragment that went out, without its fidelity: the item's header
    first: dict[str, Any] | None = None
    # the growing field of every fragment that went out
    chunks: list[Any] = field(default_factory=list)
    fidelity: Fidelity | None = None


def _bare(kind: _Kind, fields: dict[str, Any]) -> bool:
    """Whether a fragment carries no content: its growing field and header fields are empty."""
    return len(fields[kind.field]) == 0 and not any(fields[name] for name in kind.header)


class StreamItems:
    """Assembles the items of one stream from the two things a provider says.

    Here is a fragment of an item (`delta`), and that item ended (`done`). Every fragment goes out
    as it arrives, and a done item is the item's first fragment with the growing field replaced by
    the join of every fragment's, plus the item's fidelity. Fragments and done items go out carrying
    `fidelity.item_id`, the item's number within the stream, which the base client orders by and
    strips.

    A fragment belongs to the item its id names. Without an id, or as a continuation whose id names
    nothing (a tool call fragment without its name cannot start an item), it belongs to the item
    streamed last while that item is open and of its kind, and starts a new item otherwise. Fidelity
    sent under an item's id belongs to that item whatever kind it streams.

    A provider that streams one item at a time and never says where it ends (Chat Completions,
    generateContent, Interactions) uses `sequential`: the first fragment of the next item ends the
    previous one, and a fragment of another kind under the open item's id is the next item. By
    default items end on `done` and may interleave (Anthropic content blocks, Responses output
    items); the ids of done items are remembered, so a fragment or a second done for one is a
    protocol error.
    """

    def __init__(self, client: str, sequential: bool = False) -> None:
        self._client = client
        self._sequential = sequential
        self._open: dict[str, _Item] = {}
        self._finished: set[str] = set()
        self._last: _Item | None = None
        self._count = 0
        self._unkeyed = 0

    def _protocol_error(self, message: str) -> StreamProtocolError:
        return StreamProtocolError(self._client, message)

    def delta(self, item_id: str | None, fragment: DeltaContentItem) -> list[EventContentItem]:
        """A fragment of the item under item_id (None where the provider sends none).

        Returns what the client yields: the fragment, preceded by the done item it ended in
        sequential mode.
        """
        kind = fragment["type"].removesuffix(".delta")
        if item_id and item_id in self._finished:
            raise self._protocol_error(f"{fragment['type']} arrived after item {item_id} was done")

        fields = {name: value for name, value in fragment.items() if name != "fidelity"}
        fidelity = fragment.get("fidelity") or None

        headerless = not any(fields[name] for name in _KINDS[kind].header)
        # a fragment of a kind with a header cannot start an item without it
        continuation = bool(_KINDS[kind].header) and headerless

        out: list[EventContentItem] = []
        item = self._open.get(item_id) if item_id else None
        if item is None and (continuation if item_id else headerless):
            # no id, or a continuation whose id names nothing: the item streamed last
            item = self._last if self._last is not None and self._last.open and self._last.kind == kind else None

        if item is not None and item.kind != kind:
            if item.first is None:
                # an item nothing went out for yet streams the kind of the first fragment that does
                item.kind = kind
            elif _bare(_KINDS[kind], fields) and fidelity:
                # fidelity sent under an item's id belongs to that item, whatever kind it streams
                spec = _KINDS[item.kind]
                fields = {**item.first, spec.field: spec.join([])}
            elif self._sequential:
                item = None
            else:
                raise self._protocol_error(f"{fragment['type']} arrived for item {item_id}, which streams {item.kind}")

        if item is None:
            if self._sequential and self._last is not None and self._last.open:
                # the first fragment of the next item ends the previous one
                out.extend(self._close(self._last))

            self._count += 1
            if not item_id:
                item_id = f"unkeyed-{self._unkeyed}"
                self._unkeyed += 1

            item = _Item(key=item_id, id=str(self._count), kind=kind)
            self._open[item.key] = item

        self._last = item

        if fidelity:
            if item.fidelity is None:
                item.fidelity = fidelity
            elif item.fidelity == fidelity:
                # repeated fidelity goes out once
                fidelity = None
            else:
                raise self._protocol_error(f"item {item.key} carried two different fidelity payloads")

        spec = _KINDS[item.kind]
        if _bare(spec, fields) and not fidelity:
            # carries nothing; the item is registered all the same
            return out

        if item.first is None:
            if not all(fields[name] for name in spec.header):
                raise self._protocol_error(
                    f"the first {fields['type']} of item {item.key} must carry the {' and the '.join(spec.header)}"
                )

            item.first = fields

        item.chunks.append(fields[spec.field])
        out.append({**fields, "fidelity": {"item_id": item.id, **(fidelity or {})}})
        return out

    def done(self, item_id: str | None = None) -> list[ContentItem]:
        """The provider says the item under item_id ended (no id: the item streamed last).

        Returns its complete done item, or nothing for an item no fragment of which went out.
        """
        if item_id and item_id in self._finished:
            raise self._protocol_error(f"item {item_id} was done twice")

        if item_id:
            item = self._open.get(item_id)
        else:
            item = self._last if self._last is not None and self._last.open else None

        if item_id and not self._sequential:
            self._finished.add(item_id)

        return [] if item is None else self._close(item)

    def end(self) -> list[ContentItem]:
        """The provider's stream ended: every item still open is done, in the order they started."""
        return [done for item in list(self._open.values()) for done in self._close(item)]

    def _close(self, item: _Item) -> list[ContentItem]:
        item.open = False
        del self._open[item.key]
        if item.first is None:
            return []

        spec = _KINDS[item.kind]
        joined = spec.join(item.chunks)
        value = spec.parse(joined, self._client, item.first) if spec.parse else joined
        done = {
            name: f"{item.kind}.done" if name == "type" else value if name == spec.field else field_value
            for name, field_value in item.first.items()
        }
        done["fidelity"] = {"item_id": item.id, **(item.fidelity or {})}
        return [done]
