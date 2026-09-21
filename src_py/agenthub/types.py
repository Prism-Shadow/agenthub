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

from enum import StrEnum
from typing import Any, Literal, NotRequired, TypedDict


class ThinkingLevel(StrEnum):
    """Thinking level for model reasoning."""

    NONE = "none"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    XHIGH = "xhigh"
    MAX = "max"


class PromptCaching(StrEnum):
    """Prompt cache configuration for Claude models."""

    ENABLE = "enable"
    DISABLE = "disable"
    ENHANCE = "enhance"


# Tool choice can be a literal string or a list of tool names
ToolChoice = Literal["auto", "required", "none"] | list[str]
Role = Literal["user", "assistant"]
# A stream is any number of "delta" events closed by exactly one "stop" event, which carries the
# usage and the finish reason; a caller can tell a running stream from a finished one by it.
EventType = Literal["delta", "stop"]
FinishReason = Literal["stop", "length", "tool_call", "unknown"]
AspectRatio = Literal["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"]
ImageSize = Literal["1K", "2K"]

# Arbitrary JSON-style payload of wire-fidelity data recorded by a client, such as
# thinking signatures, phase labels, or the upstream reasoning field name. Opaque to
# consumers: pass it back unchanged so a replay reproduces the original wire message.
Fidelity = dict[str, Any]


# Complete items. A message holds only these, and a stream closes every item it streams with one.


class TextDoneItem(TypedDict):
    type: Literal["text.done"]
    text: str
    fidelity: NotRequired[Fidelity]


class ImageUrlDoneItem(TypedDict):
    type: Literal["image_url.done"]
    image_url: str


class InlineDataDoneItem(TypedDict):
    type: Literal["inline_data.done"]
    data: bytes
    mime_type: str
    fidelity: NotRequired[Fidelity]


class ThinkingDoneItem(TypedDict):
    type: Literal["thinking.done"]
    thinking: str
    fidelity: NotRequired[Fidelity]


class InlineThinkingDoneItem(TypedDict):
    type: Literal["inline_thinking.done"]
    data: bytes
    mime_type: str
    fidelity: NotRequired[Fidelity]


class ToolCallDoneItem(TypedDict):
    type: Literal["tool_call.done"]
    name: str
    arguments: dict[str, Any]
    tool_call_id: str
    fidelity: NotRequired[Fidelity]


class ToolResultDoneItem(TypedDict):
    type: Literal["tool_result.done"]
    text: str
    images: NotRequired[list[str]]
    tool_call_id: str


class EmbeddingDoneItem(TypedDict):
    type: Literal["embedding.done"]
    embedding: list[float]


ContentItem = (
    TextDoneItem
    | ImageUrlDoneItem
    | InlineDataDoneItem
    | ThinkingDoneItem
    | InlineThinkingDoneItem
    | ToolCallDoneItem
    | ToolResultDoneItem
    | EmbeddingDoneItem
)


# Streamed fragments. One or more deltas of a kind are followed by the done item of that kind;
# at most one delta of an item carries fidelity, and it equals the done item's fidelity.


class TextDeltaItem(TypedDict):
    type: Literal["text.delta"]
    text: str
    fidelity: NotRequired[Fidelity]


class InlineDataDeltaItem(TypedDict):
    type: Literal["inline_data.delta"]
    data: bytes
    mime_type: str
    fidelity: NotRequired[Fidelity]


class ThinkingDeltaItem(TypedDict):
    type: Literal["thinking.delta"]
    thinking: str
    fidelity: NotRequired[Fidelity]


class InlineThinkingDeltaItem(TypedDict):
    type: Literal["inline_thinking.delta"]
    data: bytes
    mime_type: str
    fidelity: NotRequired[Fidelity]


class ToolCallDeltaItem(TypedDict):
    type: Literal["tool_call.delta"]
    # non-empty on the first delta of a call only
    name: str
    # a fragment of the raw arguments JSON string
    arguments: str
    # non-empty on the first delta of a call only
    tool_call_id: str
    fidelity: NotRequired[Fidelity]


class EmbeddingDeltaItem(TypedDict):
    type: Literal["embedding.delta"]
    embedding: list[float]


DeltaContentItem = (
    TextDeltaItem
    | InlineDataDeltaItem
    | ThinkingDeltaItem
    | InlineThinkingDeltaItem
    | ToolCallDeltaItem
    | EmbeddingDeltaItem
)

EventContentItem = DeltaContentItem | ContentItem


class UsageMetadata(TypedDict):
    """Usage metadata for model response."""

    cached_tokens: int | None
    prompt_tokens: int | None
    thoughts_tokens: int | None
    response_tokens: int | None


class UniMessage(TypedDict):
    """Universal message format for LLM communication."""

    role: Role
    content_items: list[ContentItem]
    usage_metadata: NotRequired[UsageMetadata | None]
    finish_reason: NotRequired[FinishReason | None]
    created_at: NotRequired[int]


class UniEvent(TypedDict):
    """Universal event format for streaming responses.

    A "delta" event carries exactly one delta or done item and no usage or finish reason; the one
    "stop" event that ends every successful stream carries no items and both.
    """

    role: Role
    event_type: EventType
    content_items: list[EventContentItem]
    usage_metadata: UsageMetadata | None
    finish_reason: FinishReason | None
    created_at: NotRequired[int]


class ToolSchema(TypedDict):
    """Available tool schema."""

    name: str
    description: str
    parameters: NotRequired[dict[str, Any]]


class ImageConfig(TypedDict):
    """Image generation configuration for models that support image output."""

    aspect_ratio: NotRequired[AspectRatio]
    image_size: NotRequired[ImageSize]


class SpeakerConfig(TypedDict):
    """Speaker and voice assignment for TTS."""

    voice: str
    speaker: NotRequired[str]


class EmbeddingConfig(TypedDict):
    """Embedding generation configuration."""

    dimensions: NotRequired[int]


class UniConfig(TypedDict):
    """Universal configuration format for LLM requests."""

    max_tokens: NotRequired[int]
    temperature: NotRequired[float]
    tools: NotRequired[list[ToolSchema]]
    thinking_summary: NotRequired[bool]
    thinking_level: NotRequired[ThinkingLevel]
    tool_choice: NotRequired[ToolChoice]
    system_prompt: NotRequired[str]
    prompt_caching: NotRequired[PromptCaching]
    # fast processing at premium pricing: OpenAI-protocol and Gemini clients send
    # service_tier="priority", Anthropic-protocol clients send speed="fast"; clients without a
    # fast tier reject it
    fast_mode: NotRequired[bool]
    image_config: NotRequired[ImageConfig]
    tts_config: NotRequired[list[SpeakerConfig]]
    embedding_config: NotRequired[EmbeddingConfig]
    trace_id: NotRequired[str]
