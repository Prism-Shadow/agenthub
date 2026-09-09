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

from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from types import SimpleNamespace

import pytest

from agenthub import AutoLLMClient
from agenthub.base_client import LLMClient
from agenthub.types import UniConfig, UniEvent, UniMessage


@dataclass
class StreamCase:
    expected_client: str
    model: str
    client_type: str


# Every client that parses the OpenAI Responses SSE shape.
RESPONSES_STREAM_CASES = [
    StreamCase(expected_client="GPT6Client", model="gpt-5.6", client_type="gpt-5.6"),
    StreamCase(expected_client="OpenaiResponsesClient", model="gpt-5.6", client_type="openai-responses"),
    StreamCase(expected_client="DeepSeekV4Client", model="deepseek-v4", client_type="deepseek-v4"),
    StreamCase(expected_client="MiniMaxM3Client", model="minimax-m3", client_type="minimax-m3"),
]

# Every client that parses the OpenAI Chat Completions chunk shape.
CHAT_STREAM_CASES = [
    StreamCase(expected_client="OpenaiChatClient", model="gpt-5.6", client_type="openai-chat"),
    StreamCase(expected_client="GLM5_3Client", model="glm-5.3", client_type="glm-5.3"),
    StreamCase(expected_client="KimiK3Client", model="kimi-k3", client_type="kimi-k3"),
]

# Every client that parses the Anthropic Messages event shape.
MESSAGES_STREAM_CASES = [
    StreamCase(expected_client="Claude5Client", model="claude-sonnet-5", client_type="claude-sonnet-5"),
    StreamCase(expected_client="AntMessagesClient", model="claude-sonnet-5", client_type="ant-messages"),
]

# Every client that parses the Gemini generateContent chunk shape.
GEMINI_STREAM_CASES = [
    StreamCase(expected_client="Gemini3_8Client", model="gemini-3.8-flash", client_type="gemini-3.8"),
]

MESSAGES = [{"role": "user", "content_items": [{"type": "text", "text": "Create a memo."}]}]


def _create_auto_client(case: StreamCase) -> AutoLLMClient:
    return AutoLLMClient(model=case.model, api_key="test-key", client_type=case.client_type)


async def _stream_from_events(events: list[object]) -> AsyncIterator[object]:
    for event in events:
        yield event


class _FakeCreateEndpoint:
    """Stands in for an SDK endpoint whose create() returns a stream."""

    def __init__(self, events: list[object]) -> None:
        self._events = events

    async def create(self, **_kwargs: object) -> AsyncIterator[object]:
        return _stream_from_events(self._events)


class _FakeGeminiModels:
    def __init__(self, events: list[object]) -> None:
        self._events = events

    async def generate_content_stream(self, **_kwargs: object) -> AsyncIterator[object]:
        return _stream_from_events(self._events)


def _install_fake_responses_stream(client: AutoLLMClient, events: list[object]) -> None:
    client._client._client = SimpleNamespace(responses=_FakeCreateEndpoint(events))  # noqa: SLF001


def _install_fake_chat_stream(client: AutoLLMClient, events: list[object]) -> None:
    client._client._client = SimpleNamespace(  # noqa: SLF001
        base_url="https://api.test.invalid/v1",
        chat=SimpleNamespace(completions=_FakeCreateEndpoint(events)),
    )


def _install_fake_messages_stream(client: AutoLLMClient, events: list[object]) -> None:
    client._client._client = SimpleNamespace(  # noqa: SLF001
        base_url="https://api.test.invalid",
        beta=SimpleNamespace(messages=_FakeCreateEndpoint(events)),
    )


def _install_fake_gemini_stream(client: AutoLLMClient, events: list[object]) -> None:
    client._client._client = SimpleNamespace(aio=SimpleNamespace(models=_FakeGeminiModels(events)))  # noqa: SLF001


# Heartbeats come from gateways in front of the provider (one-api-style proxies), never from
# the official APIs, so the event shapes below are synthesized from the report in
# https://github.com/Prism-Shadow/penguin-harness/issues/286.
def _responses_keepalive_event(sequence_number: int) -> object:
    return SimpleNamespace(type="keepalive", sequence_number=sequence_number)


def _responses_text_delta_event(text: str) -> object:
    return SimpleNamespace(type="response.output_text.delta", delta=text)


def _responses_completed_event() -> object:
    return SimpleNamespace(
        type="response.completed",
        response=SimpleNamespace(
            status="completed",
            usage=SimpleNamespace(
                input_tokens=2,
                output_tokens=3,
                input_tokens_details=SimpleNamespace(cached_tokens=0),
                output_tokens_details=SimpleNamespace(reasoning_tokens=1),
            ),
        ),
    )


def _chat_keepalive_chunk(sequence_number: int) -> object:
    # A heartbeat is not a Chat Completions chunk, so the SDK's lenient parsing leaves every
    # field it declares unset: choices arrives as None rather than an empty list.
    return SimpleNamespace(type="keepalive", sequence_number=sequence_number, choices=None, usage=None)


def _chat_text_chunk(text: str) -> object:
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                delta=SimpleNamespace(content=text, tool_calls=None, reasoning_content=None),
                finish_reason=None,
            )
        ],
        usage=None,
    )


def _chat_stop_chunk() -> object:
    return SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(content=None, tool_calls=None), finish_reason="stop")],
        usage=SimpleNamespace(
            prompt_tokens=2,
            completion_tokens=3,
            prompt_tokens_details=None,
            completion_tokens_details=SimpleNamespace(reasoning_tokens=1),
            prompt_cache_hit_tokens=0,
            prompt_cache_miss_tokens=2,
        ),
    )


def _messages_ping_event() -> object:
    return SimpleNamespace(type="ping")


def _messages_start_event() -> object:
    return SimpleNamespace(
        type="message_start",
        message=SimpleNamespace(
            usage=SimpleNamespace(input_tokens=2, cache_creation_input_tokens=0, cache_read_input_tokens=0)
        ),
    )


def _messages_text_delta_event(text: str) -> object:
    return SimpleNamespace(type="content_block_delta", delta=SimpleNamespace(type="text_delta", text=text))


def _messages_stop_event() -> object:
    return SimpleNamespace(
        type="message_delta",
        delta=SimpleNamespace(stop_reason="end_turn"),
        usage=SimpleNamespace(
            input_tokens=2,
            cache_creation_input_tokens=0,
            cache_read_input_tokens=0,
            output_tokens=3,
            output_tokens_details=None,
        ),
    )


def _gemini_keepalive_chunk() -> object:
    # The SDK maps only the fields it knows onto the response, so a heartbeat reaches the
    # client as a chunk carrying neither candidates nor usage.
    return SimpleNamespace(candidates=None, usage_metadata=None)


def _gemini_unknown_part_chunk() -> object:
    # a part the client recognizes by none of its fields, e.g. a modality added after this client
    part = SimpleNamespace(function_call=None, thought=None, text=None, inline_data=None, thought_signature=None)
    return SimpleNamespace(
        candidates=[SimpleNamespace(content=SimpleNamespace(parts=[part]), finish_reason=None)], usage_metadata=None
    )


def _gemini_text_chunk(text: str) -> object:
    part = SimpleNamespace(function_call=None, thought=None, text=text, inline_data=None, thought_signature=None)
    return SimpleNamespace(
        candidates=[SimpleNamespace(content=SimpleNamespace(parts=[part]), finish_reason=None)],
        usage_metadata=None,
    )


def _gemini_stop_chunk() -> object:
    return SimpleNamespace(
        # FinishReason is a string enum, so the raw value keys the client's mapping
        candidates=[SimpleNamespace(content=SimpleNamespace(parts=[]), finish_reason="STOP")],
        usage_metadata=SimpleNamespace(
            prompt_token_count=2,
            cached_content_token_count=0,
            thoughts_token_count=1,
            candidates_token_count=3,
        ),
    )


# Events belonging to no protocol the clients parse. A gateway injects the first two on long
# generations -- the ping shape a relay sent into a Responses stream, carrying its own cost field,
# and a bare heartbeat -- while the last two carry something a client would otherwise drop.
def _foreign_ping_event() -> object:
    return SimpleNamespace(type="ping", cost="@")


def _foreign_heartbeat_event() -> object:
    return SimpleNamespace(type="heartbeat")


def _foreign_error_event() -> object:
    return SimpleNamespace(type="gateway_error", message="upstream 502")


def _foreign_payload_event() -> object:
    return SimpleNamespace(type="relay_frame", data=SimpleNamespace(text="dropped"))


def _responses_unknown_event() -> object:
    return SimpleNamespace(type="response.mystery_event")


def _messages_unknown_event() -> object:
    return SimpleNamespace(type="message_mystery")


# One shape per reason an event can be unrecognized: inside the protocol's own namespace, an
# error the gateway reports, and a frame carrying a payload.
UNKNOWN_RESPONSES_EVENTS = [_responses_unknown_event, _foreign_error_event, _foreign_payload_event]
UNKNOWN_MESSAGES_EVENTS = [_messages_unknown_event, _foreign_error_event, _foreign_payload_event]
UNKNOWN_EVENT_IDS = ["in-protocol", "error", "payload"]


def _collected_texts(events: list[dict]) -> list[str]:
    return [item["text"] for event in events for item in event["content_items"] if item["type"] == "text"]


@pytest.mark.asyncio
@pytest.mark.parametrize("case", RESPONSES_STREAM_CASES, ids=[case.client_type for case in RESPONSES_STREAM_CASES])
async def test_responses_clients_skip_keepalive_heartbeats(case: StreamCase):
    client = _create_auto_client(case)
    assert type(client._client).__name__ == case.expected_client  # noqa: SLF001
    _install_fake_responses_stream(
        client,
        [
            _responses_keepalive_event(1),
            _responses_text_delta_event("Here is"),
            _responses_keepalive_event(2),
            _responses_text_delta_event(" the memo."),
            _responses_completed_event(),
            _responses_keepalive_event(3),
        ],
    )

    events = [event async for event in client.streaming_response(MESSAGES, {})]
    assert _collected_texts(events) == ["Here is", " the memo."]
    assert events[-1]["finish_reason"] == "stop"


@pytest.mark.asyncio
@pytest.mark.parametrize("case", RESPONSES_STREAM_CASES, ids=[case.client_type for case in RESPONSES_STREAM_CASES])
async def test_responses_clients_skip_foreign_gateway_events(case: StreamCase):
    client = _create_auto_client(case)
    _install_fake_responses_stream(
        client,
        [
            _foreign_ping_event(),
            _responses_text_delta_event("Here is"),
            _foreign_heartbeat_event(),
            _responses_text_delta_event(" the memo."),
            _responses_completed_event(),
        ],
    )

    events = [event async for event in client.streaming_response(MESSAGES, {})]
    assert _collected_texts(events) == ["Here is", " the memo."]
    assert events[-1]["finish_reason"] == "stop"


@pytest.mark.asyncio
@pytest.mark.parametrize("event_factory", UNKNOWN_RESPONSES_EVENTS, ids=UNKNOWN_EVENT_IDS)
@pytest.mark.parametrize("case", RESPONSES_STREAM_CASES, ids=[case.client_type for case in RESPONSES_STREAM_CASES])
async def test_responses_clients_skip_unknown_events(case: StreamCase, event_factory: Callable[[], object]):
    client = _create_auto_client(case)
    _install_fake_responses_stream(
        client,
        [event_factory(), *[_responses_text_delta_event("Here is"), _responses_completed_event()]],
    )

    events = [event async for event in client.streaming_response(MESSAGES, {})]
    assert _collected_texts(events) == ["Here is"]
    assert events[-1]["finish_reason"] == "stop"


@pytest.mark.asyncio
@pytest.mark.parametrize("event_factory", UNKNOWN_RESPONSES_EVENTS, ids=UNKNOWN_EVENT_IDS)
@pytest.mark.parametrize("case", RESPONSES_STREAM_CASES, ids=[case.client_type for case in RESPONSES_STREAM_CASES])
async def test_responses_clients_reject_unknown_events_in_debug_mode(
    case: StreamCase, event_factory: Callable[[], object], monkeypatch
):
    monkeypatch.setenv("AGENTHUB_DEBUG", "1")
    client = _create_auto_client(case)
    _install_fake_responses_stream(
        client, [event_factory(), *[_responses_text_delta_event("Here is"), _responses_completed_event()]]
    )

    with pytest.raises(ValueError, match="Unknown output"):
        async for _event in client.streaming_response(MESSAGES, {}):
            pass


@pytest.mark.asyncio
@pytest.mark.parametrize("case", CHAT_STREAM_CASES, ids=[case.client_type for case in CHAT_STREAM_CASES])
async def test_chat_clients_skip_keepalive_heartbeats(case: StreamCase):
    client = _create_auto_client(case)
    assert type(client._client).__name__ == case.expected_client  # noqa: SLF001
    _install_fake_chat_stream(
        client,
        [
            _chat_keepalive_chunk(1),
            _chat_text_chunk("Here is"),
            _chat_keepalive_chunk(2),
            _chat_text_chunk(" the memo."),
            _chat_stop_chunk(),
            _chat_keepalive_chunk(3),
        ],
    )

    events = [event async for event in client.streaming_response(MESSAGES, {})]
    assert _collected_texts(events) == ["Here is", " the memo."]
    assert events[-1]["finish_reason"] == "stop"


@pytest.mark.asyncio
@pytest.mark.parametrize("case", MESSAGES_STREAM_CASES, ids=[case.client_type for case in MESSAGES_STREAM_CASES])
async def test_messages_clients_skip_ping_heartbeats(case: StreamCase):
    client = _create_auto_client(case)
    assert type(client._client).__name__ == case.expected_client  # noqa: SLF001
    _install_fake_messages_stream(
        client,
        [
            _messages_ping_event(),
            _messages_start_event(),
            _messages_text_delta_event("Here is"),
            _messages_ping_event(),
            _messages_text_delta_event(" the memo."),
            _messages_stop_event(),
            _messages_ping_event(),
        ],
    )

    events = [event async for event in client.streaming_response(MESSAGES, {})]
    assert _collected_texts(events) == ["Here is", " the memo."]
    assert events[-1]["finish_reason"] == "stop"


@pytest.mark.asyncio
@pytest.mark.parametrize("case", MESSAGES_STREAM_CASES, ids=[case.client_type for case in MESSAGES_STREAM_CASES])
async def test_messages_clients_skip_foreign_gateway_events(case: StreamCase):
    client = _create_auto_client(case)
    _install_fake_messages_stream(
        client,
        [
            _messages_start_event(),
            # the Responses-protocol spelling, injected into a Messages stream
            _responses_keepalive_event(1),
            _messages_text_delta_event("Here is"),
            _foreign_heartbeat_event(),
            _messages_text_delta_event(" the memo."),
            _messages_stop_event(),
        ],
    )

    events = [event async for event in client.streaming_response(MESSAGES, {})]
    assert _collected_texts(events) == ["Here is", " the memo."]
    assert events[-1]["finish_reason"] == "stop"


@pytest.mark.asyncio
@pytest.mark.parametrize("event_factory", UNKNOWN_MESSAGES_EVENTS, ids=UNKNOWN_EVENT_IDS)
@pytest.mark.parametrize("case", MESSAGES_STREAM_CASES, ids=[case.client_type for case in MESSAGES_STREAM_CASES])
async def test_messages_clients_skip_unknown_events(case: StreamCase, event_factory: Callable[[], object]):
    client = _create_auto_client(case)
    _install_fake_messages_stream(
        client,
        [event_factory(), *[_messages_start_event(), _messages_text_delta_event("Here is"), _messages_stop_event()]],
    )

    events = [event async for event in client.streaming_response(MESSAGES, {})]
    assert _collected_texts(events) == ["Here is"]
    assert events[-1]["finish_reason"] == "stop"


@pytest.mark.asyncio
@pytest.mark.parametrize("event_factory", UNKNOWN_MESSAGES_EVENTS, ids=UNKNOWN_EVENT_IDS)
@pytest.mark.parametrize("case", MESSAGES_STREAM_CASES, ids=[case.client_type for case in MESSAGES_STREAM_CASES])
async def test_messages_clients_reject_unknown_events_in_debug_mode(
    case: StreamCase, event_factory: Callable[[], object], monkeypatch
):
    monkeypatch.setenv("AGENTHUB_DEBUG", "1")
    client = _create_auto_client(case)
    _install_fake_messages_stream(
        client,
        [event_factory(), *[_messages_start_event(), _messages_text_delta_event("Here is"), _messages_stop_event()]],
    )

    with pytest.raises(ValueError, match="Unknown output"):
        async for _event in client.streaming_response(MESSAGES, {}):
            pass


@pytest.mark.asyncio
@pytest.mark.parametrize("case", GEMINI_STREAM_CASES, ids=[case.client_type for case in GEMINI_STREAM_CASES])
async def test_gemini_client_skips_keepalive_heartbeats(case: StreamCase):
    client = _create_auto_client(case)
    assert type(client._client).__name__ == case.expected_client  # noqa: SLF001
    _install_fake_gemini_stream(
        client,
        [
            _gemini_keepalive_chunk(),
            _gemini_text_chunk("Here is"),
            _gemini_keepalive_chunk(),
            _gemini_text_chunk(" the memo."),
            _gemini_stop_chunk(),
            _gemini_keepalive_chunk(),
        ],
    )

    events = [event async for event in client.streaming_response(MESSAGES, {})]
    assert _collected_texts(events) == ["Here is", " the memo."]
    # a heartbeat must not surface as an empty event of its own
    assert len(events) == 3
    assert events[-1]["finish_reason"] == "stop"


@pytest.mark.asyncio
@pytest.mark.parametrize("case", GEMINI_STREAM_CASES, ids=[case.client_type for case in GEMINI_STREAM_CASES])
async def test_gemini_client_skips_unknown_parts(case: StreamCase):
    client = _create_auto_client(case)
    _install_fake_gemini_stream(
        client,
        [_gemini_unknown_part_chunk(), _gemini_text_chunk("Here is"), _gemini_stop_chunk()],
    )

    events = [event async for event in client.streaming_response(MESSAGES, {})]
    assert _collected_texts(events) == ["Here is"]
    assert events[-1]["finish_reason"] == "stop"


@pytest.mark.asyncio
@pytest.mark.parametrize("case", GEMINI_STREAM_CASES, ids=[case.client_type for case in GEMINI_STREAM_CASES])
async def test_gemini_client_rejects_unknown_parts_in_debug_mode(case: StreamCase, monkeypatch):
    monkeypatch.setenv("AGENTHUB_DEBUG", "1")
    client = _create_auto_client(case)
    _install_fake_gemini_stream(client, [_gemini_unknown_part_chunk(), _gemini_stop_chunk()])

    with pytest.raises(ValueError, match="Unknown output"):
        async for _event in client.streaming_response(MESSAGES, {}):
            pass


# Every client, driven over the ignorable events its own protocol carries.
UNUSED_EVENT_CASES = [
    *[
        (
            case,
            _install_fake_responses_stream,
            [_responses_keepalive_event(1), _responses_text_delta_event("Here is"), _responses_completed_event()],
        )
        for case in RESPONSES_STREAM_CASES
    ],
    *[
        (case, _install_fake_chat_stream, [_chat_keepalive_chunk(1), _chat_text_chunk("Here is"), _chat_stop_chunk()])
        for case in CHAT_STREAM_CASES
    ],
    *[
        (
            case,
            _install_fake_messages_stream,
            [
                _messages_ping_event(),
                _messages_start_event(),
                _messages_text_delta_event("Here is"),
                _messages_stop_event(),
            ],
        )
        for case in MESSAGES_STREAM_CASES
    ],
    *[
        (
            case,
            _install_fake_gemini_stream,
            [_gemini_keepalive_chunk(), _gemini_text_chunk("Here is"), _gemini_stop_chunk()],
        )
        for case in GEMINI_STREAM_CASES
    ],
]


class _LeakyClient(LLMClient):
    """A client that lets its own "unused" bookkeeping escape, which no client may do."""

    _model = "leaky-1"

    def transform_uni_config_to_model_config(self, config: UniConfig) -> UniConfig:
        return config

    def transform_uni_message_to_model_input(self, messages: list[UniMessage]) -> list[UniMessage]:
        return messages

    def transform_model_output_to_uni_event(self, model_output: UniEvent) -> UniEvent:
        return model_output

    async def list_models(self) -> list[str]:
        return [self._model]

    async def _streaming_response_internal(
        self, messages: list[UniMessage], config: UniConfig
    ) -> AsyncIterator[UniEvent]:
        yield {
            "role": "assistant",
            "event_type": "unused",
            "content_items": [],
            "usage_metadata": None,
            "finish_reason": None,
        }
        yield {
            "role": "assistant",
            "event_type": "delta",
            "content_items": [{"type": "text", "text": "Here is"}],
            "usage_metadata": None,
            "finish_reason": None,
        }
        yield {
            "role": "assistant",
            "event_type": "stop",
            "content_items": [],
            "usage_metadata": {
                "cached_tokens": 0,
                "prompt_tokens": 1,
                "thoughts_tokens": 0,
                "response_tokens": 1,
            },
            "finish_reason": "stop",
        }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("case", "installer", "stream"),
    UNUSED_EVENT_CASES,
    ids=[case.client_type for case, _installer, _stream in UNUSED_EVENT_CASES],
)
async def test_clients_never_yield_unused_events(
    case: StreamCase, installer: Callable[[AutoLLMClient, list[object]], None], stream: list[object], monkeypatch
):
    # with the debug guard on, an "unused" event that reached the caller raises instead of passing
    monkeypatch.setenv("AGENTHUB_DEBUG", "1")
    client = _create_auto_client(case)
    installer(client, stream)

    events = [event async for event in client.streaming_response(MESSAGES, {})]
    assert all(event["event_type"] != "unused" for event in events)
    assert _collected_texts(events) == ["Here is"]


@pytest.mark.asyncio
async def test_base_client_drops_an_escaped_unused_event():
    events = [event async for event in _LeakyClient().streaming_response(MESSAGES, {})]

    assert [event["event_type"] for event in events] == ["delta", "stop"]


@pytest.mark.asyncio
async def test_base_client_rejects_an_escaped_unused_event_in_debug_mode(monkeypatch):
    monkeypatch.setenv("AGENTHUB_DEBUG", "1")

    with pytest.raises(ValueError, match="unused event"):
        async for _event in _LeakyClient().streaming_response(MESSAGES, {}):
            pass
