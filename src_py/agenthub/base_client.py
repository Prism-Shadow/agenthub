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

import asyncio
import time
from abc import ABC, abstractmethod
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Iterator

from .abort_signal import AbortSignal
from .errors import EmptyResponseError, StreamProtocolError, parse_tool_call_arguments
from .legacy import normalize_legacy_messages
from .types import (
    ContentItem,
    DeltaContentItem,
    EventContentItem,
    Fidelity,
    FinishReason,
    TextDoneItem,
    UniConfig,
    UniDeltaEvent,
    UniEvent,
    UniMessage,
    UniStopEvent,
    UsageMetadata,
)


def done_marker(item_id: str) -> TextDoneItem:
    """The item under item_id is complete: the base builds its done item from the deltas it streamed.

    Not every provider names the kind where an item ends (Anthropic content_block_stop, Interactions
    step.stop), so a marker is a text.done the base reads only for its item_id.
    """
    return {"type": "text.done", "text": "", "fidelity": {"item_id": item_id}}


def _has_fidelity(fidelity: Fidelity | None) -> bool:
    """Whether a content item carries a non-empty fidelity payload."""
    return fidelity is not None and len(fidelity) > 0


def _is_empty_delta(item: DeltaContentItem) -> bool:
    """Whether a fragment carries nothing: no content and no fidelity."""
    if item["type"] == "embedding.delta":
        return False
    if _has_fidelity(item.get("fidelity")):
        return False
    if item["type"] == "text.delta":
        return item["text"] == ""
    if item["type"] == "thinking.delta":
        return item["thinking"] == ""
    if item["type"] == "tool_call.delta":
        return not item["name"] and not item["tool_call_id"] and not item["arguments"]
    return len(item["data"]) == 0


def _delta_event(item: EventContentItem) -> UniDeltaEvent:
    return {
        "role": "assistant",
        "event_type": "delta",
        "content_items": [item],
        "usage_metadata": None,
        "finish_reason": None,
        "created_at": int(time.time() * 1000),
    }


@dataclass
class _ItemGroup:
    kind: str
    deltas: list[DeltaContentItem] = field(default_factory=list)
    # fragments held back while an earlier item is still streaming
    pending: list[DeltaContentItem] = field(default_factory=list)
    closed: bool = False
    fidelity: Fidelity | None = None


class _StreamAssembler:
    """Turns the universal events a client makes of its provider's stream into the public stream.

    Every item streams as contiguous deltas closed by its done item, and items never interleave,
    so a caller attributes each delta to the item streaming at that moment. An item that starts
    while an earlier one is open is held back until the earlier one is done.
    """

    def __init__(self, client: str) -> None:
        self._client = client
        self._order: list[str] = []
        self._groups: dict[str, _ItemGroup] = {}
        self._finished_keys: set[str] = set()
        self._embedding_count = 0
        self._usage_metadata: UsageMetadata | None = None
        self._finish_reason: FinishReason | None = None
        self.done_items: list[ContentItem] = []

    def _protocol_error(self, message: str) -> StreamProtocolError:
        return StreamProtocolError(self._client, message)

    def push(self, event: UniEvent) -> Iterator[UniDeltaEvent]:
        # a generator, so the events of an item reach the caller even when a later item of the same
        # wire event fails, as a whole tool call followed by its done marker does on bad arguments
        if event["event_type"] == "delta" and (
            event["usage_metadata"] is not None or event["finish_reason"] is not None
        ):
            raise self._protocol_error("a delta event carries usage_metadata or finish_reason")

        for item in event["content_items"]:
            if item["type"] == "embedding.delta":
                # a vector is complete in itself, so the base names its item and closes it at once
                key = f"embedding:{self._embedding_count}"
                self._embedding_count += 1
                yield from self._push_delta(key, item)
                yield from self._push_done(key)
                continue

            # item_id is stripped before any other rule runs, so it never reaches the public stream
            fidelity = dict(item.get("fidelity") or {})
            item_id = fidelity.pop("item_id", None)
            if not isinstance(item_id, str) or item_id == "":
                raise self._protocol_error(f"{item['type']} carries no fidelity.item_id")

            if item["type"].endswith(".done"):
                if _has_fidelity(fidelity):
                    raise self._protocol_error(f"the done marker of item {item_id} carries fidelity beyond item_id")

                yield from self._push_done(item_id)
                continue

            if _has_fidelity(fidelity):
                stripped = {**item, "fidelity": fidelity}
            else:
                stripped = {field_name: value for field_name, value in item.items() if field_name != "fidelity"}
            yield from self._push_delta(item_id, stripped)

        if event["usage_metadata"] is not None:
            if self._usage_metadata is None:
                self._usage_metadata = {
                    "cached_tokens": None,
                    "prompt_tokens": None,
                    "thoughts_tokens": None,
                    "response_tokens": None,
                }
            for usage_field in ("cached_tokens", "prompt_tokens", "thoughts_tokens", "response_tokens"):
                if event["usage_metadata"].get(usage_field) is not None:
                    self._usage_metadata[usage_field] = event["usage_metadata"][usage_field]

        if event["finish_reason"]:
            self._finish_reason = event["finish_reason"]

    def _push_done(self, key: str) -> list[UniDeltaEvent]:
        if key in self._finished_keys:
            raise self._protocol_error(f"item {key} was done twice")

        group = self._groups.get(key)
        if group is None:
            # an item that never produced content has nothing to close
            self._finished_keys.add(key)
            return []

        if group.closed:
            raise self._protocol_error(f"item {key} was done twice")

        group.closed = True
        return self._flush()

    def _push_delta(self, key: str, item: DeltaContentItem) -> list[UniDeltaEvent]:
        kind = item["type"].removesuffix(".delta")
        if key in self._finished_keys:
            raise self._protocol_error(f"{item['type']} arrived after item {key} was done")

        group = self._groups.get(key)
        if group is None:
            if _is_empty_delta(item):
                return []

            if item["type"] == "tool_call.delta" and (not item["name"] or not item["tool_call_id"]):
                raise self._protocol_error(
                    f"the first tool_call.delta of item {key} must carry the name and the tool_call_id"
                )

            group = _ItemGroup(kind)
            self._groups[key] = group
            self._order.append(key)

        if group.closed:
            raise self._protocol_error(f"{item['type']} arrived after item {key} was done")

        if group.kind != kind:
            raise self._protocol_error(f"{item['type']} arrived for item {key}, which streams {group.kind}")

        emitted = item
        if item["type"] != "embedding.delta" and _has_fidelity(item.get("fidelity")):
            if group.fidelity is None:
                group.fidelity = item["fidelity"]
            elif group.fidelity == item["fidelity"]:
                # a client may repeat the fidelity it already sent; only the first copy goes out
                emitted = {field_name: value for field_name, value in item.items() if field_name != "fidelity"}
            else:
                raise self._protocol_error(f"item {key} carried two different fidelity payloads")

        if _is_empty_delta(emitted):
            return []

        group.deltas.append(emitted)
        if self._order[0] == key:
            return [_delta_event(emitted)]

        group.pending.append(emitted)
        return []

    def _flush(self) -> list[UniDeltaEvent]:
        events: list[UniDeltaEvent] = []
        while self._order:
            key = self._order[0]
            group = self._groups[key]
            if not group.closed:
                break

            self._order.pop(0)
            del self._groups[key]
            self._finished_keys.add(key)
            for item in group.pending:
                events.append(_delta_event(item))
            done = self._build_done(group)
            self.done_items.append(done)
            events.append(_delta_event(done))

        if self._order:
            # the item that just reached the front streams from here on
            front = self._groups[self._order[0]]
            for item in front.pending:
                events.append(_delta_event(item))
            front.pending = []

        return events

    def close_all(self) -> list[UniDeltaEvent]:
        for group in self._groups.values():
            group.closed = True

        return self._flush()

    def _build_done(self, group: _ItemGroup) -> ContentItem:
        fidelity = {"fidelity": group.fidelity} if group.fidelity else {}
        deltas = group.deltas
        if group.kind == "text":
            return {"type": "text.done", "text": "".join(item["text"] for item in deltas), **fidelity}

        if group.kind == "thinking":
            return {"type": "thinking.done", "thinking": "".join(item["thinking"] for item in deltas), **fidelity}

        if group.kind == "tool_call":
            name = ""
            tool_call_id = ""
            raw_arguments = ""
            for item in deltas:
                name = name or item["name"]
                tool_call_id = tool_call_id or item["tool_call_id"]
                raw_arguments += item["arguments"]

            return {
                "type": "tool_call.done",
                "name": name,
                "arguments": parse_tool_call_arguments(raw_arguments, self._client, name, tool_call_id),
                "tool_call_id": tool_call_id,
                **fidelity,
            }

        if group.kind == "embedding":
            return {"type": "embedding.done", "embedding": deltas[-1]["embedding"]}

        mime_type = ""
        for item in deltas:
            mime_type = mime_type or item["mime_type"]

        return {
            "type": "inline_data.done" if group.kind == "inline_data" else "inline_thinking.done",
            "data": b"".join(item["data"] for item in deltas),
            "mime_type": mime_type,
            **fidelity,
        }

    def stop(self) -> UniStopEvent:
        """Build the stop event once every item is done, rejecting a response that cannot be one."""
        if self._usage_metadata is None:
            raise ValueError("Streaming response ended without usage_metadata")

        if self._finish_reason is None:
            raise ValueError("Streaming response ended without finish_reason")

        # replaying a thinking-only assistant message on the next turn fails with a 400 error
        if all(item["type"] in ("thinking.done", "inline_thinking.done") for item in self.done_items):
            raise EmptyResponseError(self._client, self._finish_reason, self._usage_metadata)

        return {
            "role": "assistant",
            "event_type": "stop",
            "content_items": [],
            "usage_metadata": self._usage_metadata,
            "finish_reason": self._finish_reason,
            "created_at": int(time.time() * 1000),
        }


class LLMClient(ABC):
    """
    Abstract base class for LLM clients.

    All model-specific clients must inherit from this class and implement
    the required abstract methods for complete SDK abstraction.
    """

    _model: str
    _history: list[UniMessage] = []

    @abstractmethod
    def transform_uni_config_to_model_config(self, config: UniConfig) -> Any:
        """
        Transform universal configuration to model-specific configuration.

        Args:
            config: Universal configuration dict

        Returns:
            Model-specific configuration object
        """
        pass

    @abstractmethod
    def transform_uni_message_to_model_input(self, messages: list[UniMessage]) -> Any:
        """
        Transform universal message format to model-specific input format.

        Args:
            messages: List of universal message dictionaries

        Returns:
            Model-specific input format (e.g., Gemini's Content list, OpenAI's messages array)
        """
        pass

    @abstractmethod
    def transform_model_output_to_uni_event(self, model_output: Any) -> UniEvent:
        """
        Transform one event of the provider's stream into a universal event, which the base class
        narrows into the public stream.

        content_items holds any number of items in wire order — `.delta` fragments and done markers,
        each carrying `fidelity.item_id`, the provider's identity for the item (a block index, an
        output item id, a step index and run), except `embedding.delta`, which is complete in itself.
        event_type is "stop" on the wire events that report usage_metadata and/or finish_reason, in
        pieces the base class merges field by field, and "delta" otherwise; a "delta" event carries
        neither.

        Args:
            model_output: Model-specific output object (streaming chunk)

        Returns:
            Universal event dictionary, an empty delta event when the wire event carries nothing
            universal
        """
        pass

    def concat_uni_events_to_uni_message(self, events: list[UniEvent]) -> UniMessage:
        """
        Concatenate a stream of universal events into a single universal message.

        Args:
            events: List of universal events from streaming response

        Returns:
            Complete universal message dictionary: every done item in stream order, with the
            usage, finish reason and timestamp of the stop event
        """
        content_items: list[ContentItem] = []
        stop_event: UniEvent | None = None
        for event in events:
            if event["event_type"] == "stop":
                stop_event = event
                continue

            for item in event["content_items"]:
                if item["type"].endswith(".done"):
                    content_items.append(item)

        return {
            "role": "assistant",
            "content_items": content_items,
            "usage_metadata": stop_event["usage_metadata"] if stop_event else None,
            "finish_reason": stop_event["finish_reason"] if stop_event else None,
            "created_at": stop_event.get("created_at") if stop_event else None,
        }

    @abstractmethod
    async def _streaming_response_internal(
        self,
        messages: list[UniMessage],
        config: UniConfig,
    ) -> AsyncIterator[UniEvent]:
        """
        Internal method to handle streaming response.

        Each model client implements it to send the request and yield one universal event per event
        of the provider's stream; streaming_response assembles them into the public stream.

        Args:
            messages: List of universal message dictionaries
            config: Universal configuration dict

        Yields:
            Universal events of the streaming response
        """
        pass

    @abstractmethod
    async def list_models(self) -> list[str]:
        """
        List the model ids the configured endpoint serves.

        Returns:
            list[str]: The model ids, in the order the endpoint returned them.
        """

    async def streaming_response(
        self,
        messages: list[UniMessage],
        config: UniConfig,
        signal: AbortSignal | None = None,
    ) -> AsyncIterator[UniDeltaEvent | UniStopEvent]:
        """
        Generate content in streaming mode (stateless).

        Args:
            messages: List of universal message dictionaries containing conversation history
            config: Universal configuration dict
            signal: Optional abort signal used to cancel the active request

        Yields:
            Delta events, each carrying one delta or done item, then exactly one stop event
            carrying the usage and the finish reason
        """
        # Stamp any messages that don't yet have a created_at timestamp
        for msg in messages:
            if "created_at" not in msg:
                msg["created_at"] = int(time.time() * 1000)
        request_messages = normalize_legacy_messages(messages)

        assembler = _StreamAssembler(self.__class__.__name__)
        if signal is not None:
            signal.throw_if_aborted()

        stream = self._streaming_response_internal(request_messages, config)
        abort_task: asyncio.Task[None] | None = None
        waiting_for_stream = False
        if signal is not None:
            streaming_task = asyncio.current_task()
            abort_task = asyncio.create_task(signal.wait())

            def cancel_streaming_task(task: asyncio.Task[None]) -> None:
                if (
                    task.cancelled()
                    or not signal.aborted
                    or not waiting_for_stream
                    or streaming_task is None
                    or streaming_task.done()
                ):
                    return

                streaming_task.cancel(signal.reason)

            abort_task.add_done_callback(cancel_streaming_task)

        try:
            while True:
                try:
                    if signal is not None:
                        signal.throw_if_aborted()
                        waiting_for_stream = True
                        signal.throw_if_aborted()

                    event = await anext(stream)
                except StopAsyncIteration:
                    break
                except asyncio.CancelledError:
                    if signal is not None and signal.aborted:
                        signal.throw_if_aborted()
                    raise
                finally:
                    waiting_for_stream = False

                for delta_event in assembler.push(event):
                    yield delta_event
        finally:
            if abort_task is not None and not abort_task.done():
                abort_task.cancel()
                with suppress(asyncio.CancelledError):
                    await abort_task
            await stream.aclose()

        for event in assembler.close_all():
            yield event
        stop_event = assembler.stop()

        # saved before the stop is yielded: a caller may stop iterating as soon as it sees it
        if config.get("trace_id"):
            from .integration.tracer import Tracer

            assistant_message: UniMessage = {
                "role": "assistant",
                "content_items": assembler.done_items,
                "usage_metadata": stop_event["usage_metadata"],
                "finish_reason": stop_event["finish_reason"],
                "created_at": stop_event["created_at"],
            }
            tracer = Tracer()
            tracer.save_history(self._model, request_messages + [assistant_message], config["trace_id"], config)

        yield stop_event

    async def streaming_response_stateful(
        self,
        message: UniMessage,
        config: UniConfig,
        signal: AbortSignal | None = None,
    ) -> AsyncIterator[UniDeltaEvent | UniStopEvent]:
        """
        Generate content in streaming mode (stateful).

        Args:
            message: Latest universal message dictionary to add to conversation
            config: Universal configuration dict
            signal: Optional abort signal used to cancel the active request

        Yields:
            Universal events from the streaming response
        """
        [message] = normalize_legacy_messages([message])

        events: list[UniEvent] = []
        async for event in self.streaming_response(messages=self._history + [message], config=config, signal=signal):
            events.append(event)
            if event["event_type"] == "stop":
                # recorded before the stop is yielded: a caller may stop iterating as soon as it sees it
                self._history.append(message)
                self._history.append(self.concat_uni_events_to_uni_message(events))
            yield event

    def clear_history(self) -> None:
        """Clear the message history."""
        self._history.clear()

    def get_history(self) -> list[UniMessage]:
        """Get the current message history."""
        return self._history.copy()

    def set_history(self, history: list[UniMessage]) -> None:
        """Replace the message history with a copy of the provided history.

        Args:
            history: List of universal message dictionaries to set as the new history
        """
        self._history = normalize_legacy_messages(history)
