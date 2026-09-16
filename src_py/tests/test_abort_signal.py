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
import threading
from typing import Any, AsyncIterator

import pytest

from agenthub.abort_signal import AbortSignal, run_with_abort
from agenthub.base_client import ClientPart, LLMClient
from agenthub.types import UniConfig, UniMessage


class SlowStreamingClient(LLMClient):
    def __init__(self) -> None:
        self._model = "slow-test"
        self._history = []
        self.started = asyncio.Event()
        self.cleaned = asyncio.Event()

    def transform_uni_config_to_model_config(self, config: UniConfig) -> dict[str, Any]:
        return dict(config)

    def transform_uni_message_to_model_input(self, messages: list[UniMessage]) -> list[UniMessage]:
        return messages

    def transform_model_output_to_client_parts(self, model_output: ClientPart) -> list[ClientPart]:
        return [model_output]

    async def list_models(self) -> list[str]:
        return []

    async def _streaming_response_internal(
        self,
        messages: list[UniMessage],
        config: UniConfig,
    ) -> AsyncIterator[ClientPart]:
        self.started.set()
        try:
            await asyncio.sleep(60)
        finally:
            self.cleaned.set()

        yield {
            "type": "finish",
            "usage_metadata": {
                "cached_tokens": None,
                "prompt_tokens": None,
                "thoughts_tokens": None,
                "response_tokens": None,
            },
            "finish_reason": "stop",
        }


class MultiEventStreamingClient(LLMClient):
    def __init__(self) -> None:
        self._model = "multi-event-test"
        self._history = []

    def transform_uni_config_to_model_config(self, config: UniConfig) -> dict[str, Any]:
        return dict(config)

    def transform_uni_message_to_model_input(self, messages: list[UniMessage]) -> list[UniMessage]:
        return messages

    def transform_model_output_to_client_parts(self, model_output: ClientPart) -> list[ClientPart]:
        return [model_output]

    async def list_models(self) -> list[str]:
        return []

    async def _streaming_response_internal(
        self,
        messages: list[UniMessage],
        config: UniConfig,
    ) -> AsyncIterator[ClientPart]:
        for text in ("hello", " world"):
            await asyncio.sleep(0)
            yield {"type": "delta", "key": "0", "item": {"type": "text.delta", "text": text}}

        await asyncio.sleep(0)
        yield {
            "type": "finish",
            "usage_metadata": {
                "cached_tokens": None,
                "prompt_tokens": 1,
                "thoughts_tokens": None,
                "response_tokens": 2,
            },
            "finish_reason": "stop",
        }


class CountingAbortSignal(AbortSignal):
    def __init__(self) -> None:
        super().__init__()
        self.wait_count = 0

    async def wait(self) -> None:
        self.wait_count += 1
        await super().wait()


class StreamCreationTrackingClient(MultiEventStreamingClient):
    def __init__(self) -> None:
        super().__init__()
        self.stream_created = False

    def _streaming_response_internal(
        self,
        messages: list[UniMessage],
        config: UniConfig,
    ) -> AsyncIterator[ClientPart]:
        self.stream_created = True
        return super()._streaming_response_internal(messages, config)


def test_abort_signal_state_is_idempotent() -> None:
    signal = AbortSignal()

    assert not signal.aborted
    assert signal.reason is None

    signal.abort("first")
    signal.abort("second")

    assert signal.aborted
    assert signal.reason == "first"


@pytest.mark.asyncio
async def test_abort_signal_waits_until_aborted() -> None:
    signal = AbortSignal()
    waiter = asyncio.create_task(signal.wait())

    await asyncio.sleep(0)
    assert not waiter.done()

    signal.abort("stop")

    await asyncio.wait_for(waiter, timeout=1)
    assert signal.aborted


@pytest.mark.asyncio
async def test_abort_signal_can_abort_from_another_thread() -> None:
    signal = AbortSignal()
    waiter = asyncio.create_task(signal.wait())

    await asyncio.sleep(0)

    thread = threading.Thread(target=lambda: signal.abort("thread-stop"))
    thread.start()
    thread.join(timeout=1)

    await asyncio.wait_for(waiter, timeout=1)
    assert signal.aborted
    assert signal.reason == "thread-stop"


@pytest.mark.asyncio
async def test_run_with_abort_returns_result_without_abort() -> None:
    async def work() -> str:
        await asyncio.sleep(0)
        return "done"

    assert await run_with_abort(work(), AbortSignal()) == "done"


@pytest.mark.asyncio
async def test_run_with_abort_cancels_coroutine_when_signal_aborts() -> None:
    signal = AbortSignal()
    started = asyncio.Event()
    cleaned = asyncio.Event()

    async def work() -> str:
        started.set()
        try:
            await asyncio.sleep(60)
        finally:
            cleaned.set()
        return "done"

    task = asyncio.create_task(run_with_abort(work(), signal))
    await started.wait()

    signal.abort("stop")

    with pytest.raises(asyncio.CancelledError):
        await task

    assert cleaned.is_set()


@pytest.mark.asyncio
async def test_run_with_abort_does_not_start_when_signal_is_already_aborted() -> None:
    signal = AbortSignal()
    signal.abort("stop")
    started = False

    async def work() -> str:
        nonlocal started
        started = True
        return "done"

    with pytest.raises(asyncio.CancelledError):
        await run_with_abort(work(), signal)

    assert not started


@pytest.mark.asyncio
async def test_run_with_abort_cancels_existing_task_when_signal_is_already_aborted() -> None:
    signal = AbortSignal()
    signal.abort("stop")
    started = asyncio.Event()

    async def work() -> str:
        started.set()
        await asyncio.sleep(60)
        return "done"

    task = asyncio.create_task(work())

    with pytest.raises(asyncio.CancelledError):
        await run_with_abort(task, signal)

    assert task.cancelled()
    assert not started.is_set()


@pytest.mark.asyncio
async def test_streaming_response_cancels_current_iteration_when_signal_aborts() -> None:
    client = SlowStreamingClient()
    signal = AbortSignal()
    messages: list[UniMessage] = [{"role": "user", "content_items": [{"type": "text.done", "text": "hello"}]}]
    stream = client.streaming_response(messages=messages, config={}, signal=signal)

    task = asyncio.create_task(anext(stream))
    await client.started.wait()

    signal.abort("stop")

    with pytest.raises(asyncio.CancelledError):
        await task

    assert client.cleaned.is_set()


@pytest.mark.asyncio
async def test_streaming_response_reuses_one_abort_waiter_for_whole_stream() -> None:
    client = MultiEventStreamingClient()
    signal = CountingAbortSignal()
    messages: list[UniMessage] = [{"role": "user", "content_items": [{"type": "text.done", "text": "hello"}]}]

    events = [event async for event in client.streaming_response(messages=messages, config={}, signal=signal)]

    # two text deltas, the text done item, then the stop event
    assert len(events) == 4
    assert signal.wait_count == 1


@pytest.mark.asyncio
async def test_streaming_response_does_not_create_stream_when_signal_is_already_aborted() -> None:
    client = StreamCreationTrackingClient()
    signal = AbortSignal()
    signal.abort("stop")
    messages: list[UniMessage] = [{"role": "user", "content_items": [{"type": "text.done", "text": "hello"}]}]

    with pytest.raises(asyncio.CancelledError):
        async for _ in client.streaming_response(messages=messages, config={}, signal=signal):
            pass

    assert not client.stream_created
