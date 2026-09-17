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
from typing import Any

from .types import UsageMetadata


def _preview_tool_call_arguments(raw: str) -> str:
    max_length = 160
    if len(raw) <= max_length:
        return raw

    edge_length = 72
    return f"{raw[:edge_length]}...[truncated]...{raw[-edge_length:]}"


class AgentHubError(ValueError):
    """Base class for errors raised by AgentHub clients."""


class UnsupportedParameterError(AgentHubError):
    """Raised when a UniConfig parameter value is not supported by the target model client.

    Thinking levels never raise this by design: every client maps each ThinkingLevel
    onto the closest level the model supports. Parameters such as temperature and
    tool_choice may reject unsupported values with this error.
    """

    def __init__(self, client: str, parameter: str, message: str) -> None:
        self.client = client
        self.parameter = parameter
        super().__init__(message)


class UnsupportedOperationError(AgentHubError):
    """Raised when a client cannot perform an operation at all, whatever it is passed.

    Distinct from UnsupportedParameterError, which rejects a UniConfig parameter value:
    this one reports a capability the routed client does not have, such as listing models
    through an SDK client that carries no models endpoint.
    """

    def __init__(self, client: str, operation: str, message: str) -> None:
        self.client = client
        self.operation = operation
        super().__init__(message)


class EmptyResponseError(AgentHubError):
    """Raised when a completed response carries no non-thinking content and no tool calls.

    Models occasionally finish a turn with thinking output only (reasoning models in
    particular); replaying such an assistant message on the next turn fails with a 400
    error, so the response is rejected as soon as the stream completes.
    """

    def __init__(self, client: str, finish_reason: str | None, usage_metadata: UsageMetadata | None = None) -> None:
        self.client = client
        self.finish_reason = finish_reason
        # the tokens the rejected response still cost, since no stop event carries them
        self.usage_metadata = usage_metadata
        super().__init__(f"{client} returned no content other than thinking (finish_reason={finish_reason!r}).")


class StreamProtocolError(AgentHubError):
    """Raised when a client produces a stream that breaks the streaming protocol.

    Examples are a fragment after its item was completed, a second different fidelity within
    one item, a tool call whose first fragment lacks its name or id, or a fragment of another
    kind under an item's key.

    It always reports a bug in the client rather than in the provider's output, so it is
    raised in every mode instead of being repaired into a stream that breaks the contract.
    """

    def __init__(self, client: str, message: str) -> None:
        self.client = client
        super().__init__(f"{client} broke the streaming protocol: {message}")


class ToolCallArgumentParseError(AgentHubError):
    def __init__(self, client: str, tool_name: str, tool_call_id: str, raw_arguments: str, reason: str) -> None:
        self.client = client
        self.tool_name = tool_name
        self.tool_call_id = tool_call_id
        self.raw_arguments_length = len(raw_arguments)
        self.raw_arguments_preview = _preview_tool_call_arguments(raw_arguments)
        super().__init__(
            f'Invalid streamed tool call arguments from {client} for tool "{tool_name}" '
            f'(tool_call_id="{tool_call_id}", length={self.raw_arguments_length}, '
            f"preview={self.raw_arguments_preview!r}): {reason}"
        )


def parse_tool_call_arguments(
    raw_arguments: str | None,
    client: str,
    tool_name: str,
    tool_call_id: str,
) -> dict[str, Any]:
    raw = raw_arguments or "{}"
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ToolCallArgumentParseError(client, tool_name, tool_call_id, raw, str(exc)) from exc

    if not isinstance(parsed, dict):
        raise ToolCallArgumentParseError(client, tool_name, tool_call_id, raw, "Expected a JSON object.")

    return parsed
