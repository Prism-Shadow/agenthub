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

from collections.abc import AsyncIterator
from dataclasses import dataclass
from types import SimpleNamespace

import pytest

from agenthub import AutoLLMClient, ToolCallArgumentParseError


@dataclass
class OpenAICompatibleToolStreamCase:
    expected_client: str
    model: str
    client_type: str
    protocol: str = "chat"  # the wire shape the client parses: "chat" or "responses"


OPENAI_COMPATIBLE_TOOL_STREAM_CASES = [
    OpenAICompatibleToolStreamCase(
        expected_client="OpenaiChatClient",
        model="gpt-5.5",
        client_type="openai",
    ),
    OpenAICompatibleToolStreamCase(
        expected_client="GLM5_3Client",
        model="glm-5.1",
        client_type="glm-5.1",
    ),
    OpenAICompatibleToolStreamCase(
        expected_client="KimiK3Client",
        model="kimi-k2.6",
        client_type="kimi-k2.6",
    ),
    OpenAICompatibleToolStreamCase(
        expected_client="OpenaiResponsesClient",
        model="gpt-5.6",
        client_type="openai-responses",
        protocol="responses",
    ),
    OpenAICompatibleToolStreamCase(
        expected_client="DeepSeekV4Client",
        model="deepseek-v4",
        client_type="deepseek-v4",
        protocol="responses",
    ),
]


def _create_auto_client(case: OpenAICompatibleToolStreamCase) -> AutoLLMClient:
    return AutoLLMClient(model=case.model, api_key="test-key", client_type=case.client_type)


async def _stream_from_chunks(chunks: list[object]) -> AsyncIterator[object]:
    for chunk in chunks:
        yield chunk


class _FakeCreateEndpoint:
    """Stands in for an SDK endpoint whose create() returns a stream."""

    def __init__(self, chunks: list[object]) -> None:
        self._chunks = chunks

    async def create(self, **_kwargs: object) -> AsyncIterator[object]:
        return _stream_from_chunks(self._chunks)


def _install_fake_stream(client: AutoLLMClient, case: OpenAICompatibleToolStreamCase, chunks: list[object]) -> None:
    endpoint = _FakeCreateEndpoint(chunks)
    if case.protocol == "responses":
        client._client._client = SimpleNamespace(responses=endpoint)  # noqa: SLF001
    else:
        client._client._client = SimpleNamespace(  # noqa: SLF001
            base_url="https://api.test.invalid/v1", chat=SimpleNamespace(completions=endpoint)
        )


def _tool_delta_chunk(tool_call_id: str, name: str, arguments: str) -> object:
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                delta=SimpleNamespace(
                    content=None,
                    tool_calls=[
                        SimpleNamespace(
                            id=tool_call_id,
                            function=SimpleNamespace(name=name, arguments=arguments),
                        )
                    ],
                ),
                finish_reason=None,
            )
        ],
        usage=None,
    )


def _tool_stop_chunk() -> object:
    return SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(content=None, tool_calls=None), finish_reason="tool_calls")],
        usage=SimpleNamespace(
            prompt_tokens=1,
            completion_tokens=1,
            prompt_tokens_details=None,
            completion_tokens_details=SimpleNamespace(reasoning_tokens=0),
            prompt_cache_hit_tokens=0,
            prompt_cache_miss_tokens=1,
        ),
    )


def _tool_stream(case: OpenAICompatibleToolStreamCase, tool_call_id: str, name: str, *fragments: str) -> list[object]:
    """Build a streamed tool call in the wire shape the case's client parses."""
    if case.protocol == "responses":
        events = [
            SimpleNamespace(
                type="response.output_item.added",
                item=SimpleNamespace(type="function_call", name=name, call_id=tool_call_id, id=None),
            )
        ]
        events += [
            SimpleNamespace(type="response.function_call_arguments.delta", item_id=None, delta=fragment)
            for fragment in fragments
        ]
        events.append(SimpleNamespace(type="response.function_call_arguments.done", item_id=None))
        events.append(
            SimpleNamespace(
                type="response.completed",
                response=SimpleNamespace(
                    status="completed",
                    usage=SimpleNamespace(
                        input_tokens=1,
                        output_tokens=1,
                        input_tokens_details=SimpleNamespace(cached_tokens=0),
                        output_tokens_details=SimpleNamespace(reasoning_tokens=0),
                    ),
                ),
            )
        )
        return events

    chunks = [_tool_delta_chunk(tool_call_id, name, fragments[0])]
    chunks += [_tool_delta_chunk("", "", fragment) for fragment in fragments[1:]]
    chunks.append(_tool_stop_chunk())
    return chunks


async def _capture_tool_argument_error(stream: AsyncIterator[object]) -> ToolCallArgumentParseError:
    with pytest.raises(ToolCallArgumentParseError) as exc_info:
        async for _event in stream:
            pass
    return exc_info.value


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    OPENAI_COMPATIBLE_TOOL_STREAM_CASES,
    ids=[case.client_type for case in OPENAI_COMPATIBLE_TOOL_STREAM_CASES],
)
async def test_openai_compatible_clients_combine_streamed_tool_call_arguments(
    case: OpenAICompatibleToolStreamCase,
):
    client = _create_auto_client(case)
    _install_fake_stream(client, case, _tool_stream(case, "call_ok", "exec_command", '{"cmd":', '"echo ok"}'))

    messages = [{"role": "user", "content_items": [{"type": "text", "text": "Create a memo."}]}]
    events = [event async for event in client.streaming_response(messages, {})]
    tool_calls = [item for event in events for item in event["content_items"] if item["type"] == "tool_call"]

    assert tool_calls == [
        {
            "type": "tool_call",
            "name": "exec_command",
            "arguments": {"cmd": "echo ok"},
            "tool_call_id": "call_ok",
        }
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    OPENAI_COMPATIBLE_TOOL_STREAM_CASES,
    ids=[case.client_type for case in OPENAI_COMPATIBLE_TOOL_STREAM_CASES],
)
async def test_openai_compatible_clients_report_malformed_streamed_tool_call_arguments(
    case: OpenAICompatibleToolStreamCase,
):
    client = _create_auto_client(case)
    _install_fake_stream(client, case, _tool_stream(case, "call_bad", "exec_command", '{"cmd":"python create_docx.py'))

    messages = [{"role": "user", "content_items": [{"type": "text", "text": "Create a memo."}]}]
    parse_error = await _capture_tool_argument_error(client.streaming_response(messages, {}))
    assert parse_error.client == case.expected_client
    assert parse_error.tool_name == "exec_command"
    assert parse_error.tool_call_id == "call_bad"
    assert parse_error.raw_arguments_length > 0
    assert "create_docx.py" in parse_error.raw_arguments_preview
    message = str(parse_error)
    assert "exec_command" in message
    assert "call_bad" in message
    assert "length=" in message
    assert "Unterminated string" in message


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    OPENAI_COMPATIBLE_TOOL_STREAM_CASES,
    ids=[case.client_type for case in OPENAI_COMPATIBLE_TOOL_STREAM_CASES],
)
async def test_openai_compatible_clients_report_non_object_streamed_tool_call_arguments(
    case: OpenAICompatibleToolStreamCase,
):
    client = _create_auto_client(case)
    _install_fake_stream(client, case, _tool_stream(case, "call_array", "exec_command", "[]"))

    messages = [{"role": "user", "content_items": [{"type": "text", "text": "Create a memo."}]}]
    parse_error = await _capture_tool_argument_error(client.streaming_response(messages, {}))
    assert parse_error.client == case.expected_client
    assert parse_error.tool_name == "exec_command"
    assert parse_error.tool_call_id == "call_array"
    assert parse_error.raw_arguments_length == 2
    assert parse_error.raw_arguments_preview == "[]"
    assert "Expected a JSON object." in str(parse_error)


# A gateway may open every function call of a response before closing any of them: Console Go
# streams added(A), deltas(A), added(B), deltas(B), done(A), done(B). Each call still belongs to
# the assistant message -- one dropped call replays its tool result as an orphaned
# function_call_output on the next request, which Console Go rejects with "No function call found
# for function_call_output with call_id ...".
RESPONSES_CASES = [case for case in OPENAI_COMPATIBLE_TOOL_STREAM_CASES if case.protocol == "responses"]

_COMPLETED_EVENT = SimpleNamespace(
    type="response.completed",
    response=SimpleNamespace(
        status="completed",
        usage=SimpleNamespace(
            input_tokens=1,
            output_tokens=1,
            input_tokens_details=SimpleNamespace(cached_tokens=0),
            output_tokens_details=SimpleNamespace(reasoning_tokens=0),
        ),
    ),
)


def _interleaved_parallel_call_stream() -> list[object]:
    """Two function calls of one response, interleaved the way Console Go streams them."""

    def open_call(suffix: str) -> dict[str, object]:
        return {
            "added": SimpleNamespace(
                type="response.output_item.added",
                item=SimpleNamespace(
                    type="function_call",
                    id=f"fc_{suffix}",
                    call_id=f"call_{suffix}",
                    name=f"tool_{suffix}",
                ),
            ),
            "deltas": [
                SimpleNamespace(
                    type="response.function_call_arguments.delta", item_id=f"fc_{suffix}", delta='{"city":'
                ),
                SimpleNamespace(
                    type="response.function_call_arguments.delta", item_id=f"fc_{suffix}", delta='"Paris"}'
                ),
            ],
            "done": SimpleNamespace(type="response.function_call_arguments.done", item_id=f"fc_{suffix}"),
        }

    first = open_call("first")
    second = open_call("second")

    return [
        first["added"],
        *first["deltas"],
        second["added"],
        *second["deltas"],
        first["done"],
        second["done"],
        _COMPLETED_EVENT,
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    RESPONSES_CASES,
    ids=[case.client_type for case in RESPONSES_CASES],
)
async def test_openai_responses_clients_keep_interleaved_parallel_tool_calls(
    case: OpenAICompatibleToolStreamCase,
):
    client = _create_auto_client(case)
    _install_fake_stream(client, case, _interleaved_parallel_call_stream())

    messages = [{"role": "user", "content_items": [{"type": "text", "text": "Create a memo."}]}]
    events = [event async for event in client.streaming_response(messages, {})]
    tool_calls = [item for event in events for item in event["content_items"] if item["type"] == "tool_call"]

    assert tool_calls == [
        {
            "type": "tool_call",
            "name": "tool_first",
            "arguments": {"city": "Paris"},
            "tool_call_id": "call_first",
        },
        {
            "type": "tool_call",
            "name": "tool_second",
            "arguments": {"city": "Paris"},
            "tool_call_id": "call_second",
        },
    ]
