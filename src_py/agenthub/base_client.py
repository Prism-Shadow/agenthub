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
from .errors import EmptyResponseError, StreamProtocolError
from .legacy import normalize_legacy_messages
from .stream_items import StreamItems
from .types import (
    ContentItem,
    EventContentItem,
    Fidelity,
    FinishReason,
    UniConfig,
    UniEvent,
    UniMessage,
    UsageMetadata,
)


def _delta_event(item: EventContentItem) -> UniEvent:
    return {
        "role": "assistant",
        "event_type": "delta",
        "content_items": [item],
        "usage_metadata": None,
        "finish_reason": None,
        "created_at": int(time.time() * 1000),
    }


@dataclass
class _OpenItem:
    kind: str
    # the fidelity one of its deltas carried
    fidelity: Fidelity | None = None
    # events held back while an earlier item is still streaming
    pending: list[UniEvent] = field(default_factory=list)
    # set once the item's done item arrived
    done: ContentItem | None = None


class _PublicStream:
    """Narrows the events a client yields into the public stream.

    Items go out one at a time in the order they started, so a caller attributes each delta to the
    item streaming at that moment: an item that starts while an earlier one is open is held back
    until the earlier one is done. Every item is checked against the protocol, its
    `fidelity.item_id` stripped, and the usage and finish reason of the client's stop events merged
    into the one final stop.
    """

    def __init__(self, client: str) -> None:
        self._client = client
        # open item ids, in the order they started
        self._order: list[str] = []
        self._items: dict[str, _OpenItem] = {}
        self._usage_metadata: UsageMetadata | None = None
        self._finish_reason: FinishReason | None = None
        self.done_items: list[ContentItem] = []

    def _protocol_error(self, message: str) -> StreamProtocolError:
        return StreamProtocolError(self._client, message)

    def push(self, event: UniEvent) -> Iterator[UniEvent]:
        # a generator, so the events of an item reach the caller even when a later item of the same
        # client event fails
        if event["event_type"] == "delta" and (
            event["usage_metadata"] is not None or event["finish_reason"] is not None
        ):
            raise self._protocol_error("a delta event carries usage_metadata or finish_reason")

        for item in event["content_items"]:
            # item_id is stripped before any other rule runs, so it never reaches the public stream
            fidelity = dict(item.get("fidelity") or {})
            item_id = fidelity.pop("item_id", None)
            if not isinstance(item_id, str) or item_id == "":
                raise self._protocol_error(f"{item['type']} carries no fidelity.item_id")

            stripped = {name: value for name, value in item.items() if name != "fidelity"}
            if fidelity:
                stripped["fidelity"] = fidelity
            kind, _, phase = item["type"].partition(".")
            open_item = self._items.get(item_id)

            if phase == "delta":
                if open_item is not None and open_item.done is not None:
                    raise self._protocol_error(f"{item['type']} arrived after item {item_id} was done")

                if open_item is not None and open_item.kind != kind:
                    raise self._protocol_error(
                        f"{item['type']} arrived for item {item_id}, which streams {open_item.kind}"
                    )

                if (
                    open_item is None
                    and item["type"] == "tool_call.delta"
                    and (not item["name"] or not item["tool_call_id"])
                ):
                    raise self._protocol_error(
                        f"the first tool_call.delta of item {item_id} must carry the name and the tool_call_id"
                    )

                if open_item is None:
                    open_item = _OpenItem(kind)
                    self._items[item_id] = open_item
                    self._order.append(item_id)

                if fidelity:
                    if open_item.fidelity is not None:
                        raise self._protocol_error(f"item {item_id} carried fidelity twice")

                    open_item.fidelity = fidelity

                yield from self._emit(item_id, open_item, _delta_event(stripped))
                continue

            if open_item is None or open_item.done is not None:
                raise self._protocol_error(f"{item['type']} arrived for item {item_id}, which is not streaming")

            if open_item.kind != kind:
                raise self._protocol_error(
                    f"{item['type']} arrived for item {item_id}, which streams {open_item.kind}"
                )

            if (open_item.fidelity or {}) != fidelity:
                raise self._protocol_error(f"the fidelity of {item['type']} differs from what item {item_id} streamed")

            open_item.done = stripped
            yield from self._flush()

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

    def _emit(self, item_id: str, open_item: _OpenItem, event: UniEvent) -> Iterator[UniEvent]:
        if self._order[0] == item_id:
            yield event
        else:
            open_item.pending.append(event)

    def _flush(self) -> Iterator[UniEvent]:
        while self._order:
            item_id = self._order[0]
            open_item = self._items[item_id]
            if open_item.done is None:
                break

            self._order.pop(0)
            del self._items[item_id]
            yield from open_item.pending
            self.done_items.append(open_item.done)
            yield _delta_event(open_item.done)

        if self._order:
            # the item that just reached the front streams from here on
            front = self._items[self._order[0]]
            yield from front.pending
            front.pending = []

    def stop(self) -> UniEvent:
        """Build the stop event once the client's stream ended, rejecting a response that cannot be one."""
        if self._order:
            raise self._protocol_error(f"the stream ended with item {self._order[0]} still open")

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
    def transform_model_output_to_uni_event(self, model_output: Any, items: StreamItems) -> UniEvent:
        """
        Transform one event of the provider's stream into a universal event, which the base class
        narrows into the public stream.

        content_items holds what `items` returns, in wire order: `items.delta(id, fragment)` for
        every fragment the wire event carries, `items.done(id)` where it says an item ended. Its
        event_type is "stop" on the wire events that report usage_metadata and/or finish_reason, in
        pieces the base class merges field by field, and "delta" otherwise; a "delta" event carries
        neither.

        Args:
            model_output: Model-specific output object (streaming chunk)
            items: The items of the stream this event belongs to

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

        Each model client implements it to send the request, create the `StreamItems` of the
        stream, yield one universal event per event of the provider's stream, and yield one last
        delta event carrying `items.end()`; streaming_response narrows them into the public stream.

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
    ) -> AsyncIterator[UniEvent]:
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

        output = _PublicStream(self.__class__.__name__)
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

                for public_event in output.push(event):
                    yield public_event
        finally:
            if abort_task is not None and not abort_task.done():
                abort_task.cancel()
                with suppress(asyncio.CancelledError):
                    await abort_task
            await stream.aclose()

        stop_event = output.stop()

        # saved before the stop is yielded: a caller may stop iterating as soon as it sees it
        if config.get("trace_id"):
            from .integration.tracer import Tracer

            assistant_message: UniMessage = {
                "role": "assistant",
                "content_items": output.done_items,
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
    ) -> AsyncIterator[UniEvent]:
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
