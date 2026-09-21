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
from typing import Any, AsyncIterator, Iterator

from .abort_signal import AbortSignal
from .errors import EmptyResponseError, StreamProtocolError
from .legacy import normalize_legacy_messages
from .stream_items import StreamItems
from .types import (
    ContentItem,
    EventContentItem,
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


class _PublicStream:
    """Turns the events a client yields into the public stream.

    A client yields deltas only; every one goes out as it arrives, in an event of its own, and
    `StreamItems` closes each item with its done item when the next item begins or the stream ends.
    The usage and finish reason of the client's stop events are merged into the one final stop.
    """

    def __init__(self, client: str) -> None:
        self._client = client
        self._items = StreamItems(client)
        self._usage_metadata: UsageMetadata | None = None
        self._finish_reason: FinishReason | None = None
        self.done_items: list[ContentItem] = []

    def push(self, event: UniEvent) -> Iterator[UniEvent]:
        # a generator, so the deltas of an event reach the caller even when a later one fails
        if event["event_type"] == "delta" and (
            event["usage_metadata"] is not None or event["finish_reason"] is not None
        ):
            raise StreamProtocolError(self._client, "a delta event carries usage_metadata or finish_reason")

        for delta in event["content_items"]:
            yield from self._emit(self._items.delta(delta))

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

    def end(self) -> Iterator[UniEvent]:
        """The client's stream ended: the item still streaming is done."""
        yield from self._emit(self._items.end())

    def _emit(self, items: list[EventContentItem]) -> Iterator[UniEvent]:
        for item in items:
            if item["type"].endswith(".done"):
                self.done_items.append(item)

            yield _delta_event(item)

    def stop(self) -> UniEvent:
        """Build the stop event once the client's stream ended, rejecting a response that cannot be one."""
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
        turns into the public stream.

        content_items holds the deltas the wire event carries, in wire order, and never a done item:
        the base class closes an item when the next one begins or the stream ends. The deltas of one
        item are contiguous and carry the same `fidelity.item_id`, the provider's id for the item
        where it has one, which never reaches the public stream. Its event_type is "stop" on the
        wire events that report usage_metadata and/or finish_reason, in pieces the base class merges
        field by field, and "delta" otherwise; a "delta" event carries neither.

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
        of the provider's stream; streaming_response turns them into the public stream.

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

        for public_event in output.end():
            yield public_event

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
