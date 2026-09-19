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

import os
import re
from typing import Any, AsyncIterator

from anthropic import AsyncAnthropic
from anthropic.types.beta import BetaMessageParam, BetaRawMessageStreamEvent

from ..base_client import LLMClient
from ..errors import UnsupportedParameterError, parse_tool_call_arguments
from ..types import (
    EventType,
    FinishReason,
    PartialContentItem,
    PromptCaching,
    ThinkingLevel,
    ToolChoice,
    UniConfig,
    UniEvent,
    UniMessage,
    UsageMetadata,
)
from ..utils import fix_openrouter_usage_metadata, is_debug_enabled


REDACTED_THINKING = "_REDACTED_THINKING"


class AntMessagesClient(LLMClient):
    """Anthropic Messages-compatible client implementation."""

    def __init__(
        self,
        model: str,
        api_key: str | None = None,
        base_url: str | None = None,
        default_headers: dict[str, str] | None = None,
    ):
        """Initialize Anthropic Messages-compatible client with model, API key, and base URL."""
        self._model = model
        api_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        base_url = base_url or os.getenv("ANTHROPIC_BASE_URL")
        # send the credential through both header conventions: Anthropic and DeepSeek read
        # x-api-key while gateways such as OpenRouter and Z.AI read Authorization: Bearer
        self._client = AsyncAnthropic(
            api_key=api_key, auth_token=api_key, base_url=base_url, default_headers=default_headers
        )
        # With no credential the SDK reads the None auth_token as unset and may fill it from
        # ANTHROPIC_AUTH_TOKEN, so pin the token to the key it was given.
        self._client.auth_token = api_key
        self._history: list[UniMessage] = []

    def _convert_image_url_to_source(self, url: str) -> dict[str, Any]:
        """Convert image URL to an Anthropic image source block."""
        if url.startswith("data:"):
            match = re.match(r"data:([^;]+);base64,(.+)", url)
            if not match:
                raise ValueError(f"Invalid base64 image: {url}")

            return {
                "type": "image",
                "source": {"type": "base64", "media_type": match.group(1), "data": match.group(2)},
            }

        return {"type": "image", "source": {"type": "url", "url": url}}

    def _convert_thinking_level_to_thinking_config(self, thinking_level: ThinkingLevel) -> dict[str, Any]:
        """Convert ThinkingLevel enum to the Messages API thinking config."""
        # NONE is explicit rather than omitted because some servers (e.g. Z.AI) think by default
        mapping = {
            ThinkingLevel.NONE: {"thinking": {"type": "disabled"}},
            ThinkingLevel.LOW: {"thinking": {"type": "adaptive"}, "output_config": {"effort": "low"}},
            ThinkingLevel.MEDIUM: {"thinking": {"type": "adaptive"}, "output_config": {"effort": "medium"}},
            ThinkingLevel.HIGH: {"thinking": {"type": "adaptive"}, "output_config": {"effort": "high"}},
            ThinkingLevel.XHIGH: {"thinking": {"type": "adaptive"}, "output_config": {"effort": "xhigh"}},
            ThinkingLevel.MAX: {"thinking": {"type": "adaptive"}, "output_config": {"effort": "max"}},
        }
        return mapping.get(thinking_level)

    def _convert_tool_choice(self, tool_choice: ToolChoice) -> dict[str, str]:
        """Convert ToolChoice to the Messages API tool_choice format."""
        if isinstance(tool_choice, list):
            if len(tool_choice) > 1:
                raise UnsupportedParameterError(
                    self.__class__.__name__, "tool_choice", "The Messages API does not support multiple tool choices."
                )

            return {"type": "tool", "name": tool_choice[0]}
        elif tool_choice == "none":
            return {"type": "none"}
        elif tool_choice == "auto":
            return {"type": "auto"}
        elif tool_choice == "required":
            return {"type": "any"}

    def transform_uni_config_to_model_config(self, config: UniConfig) -> dict[str, Any]:
        """
        Transform universal configuration to Anthropic Messages-compatible configuration.

        Args:
            config: Universal configuration dict

        Returns:
            Anthropic Messages API configuration dictionary
        """
        ant_config = {"model": self._model, "stream": True}

        if config.get("system_prompt") is not None:
            ant_config["system"] = config["system_prompt"]

        if config.get("max_tokens") is not None:
            ant_config["max_tokens"] = config["max_tokens"]
        else:
            ant_config["max_tokens"] = 64000  # the Messages API requires max_tokens to be specified

        if config.get("temperature") is not None:
            ant_config["temperature"] = config["temperature"]

        if config.get("thinking_level") is not None:
            ant_config.update(self._convert_thinking_level_to_thinking_config(config["thinking_level"]))

        if config.get("thinking_summary") is not None:
            # display lives on the thinking block, so a summary asked for on its own selects
            # adaptive thinking. A disabled block is the one place it cannot ride along --
            # "thinking.disabled.display: Extra inputs are not permitted" (400, verified live
            # 2026-09-03) -- and thinking_level NONE disables thinking, leaving nothing to show.
            thinking = ant_config.setdefault("thinking", {"type": "adaptive"})
            if thinking["type"] != "disabled":
                thinking["display"] = "summarized" if config["thinking_summary"] else "omitted"

        # Convert tools to the Messages API tool schema
        if config.get("tools") is not None:
            ant_tools = []
            for tool in config["tools"]:
                ant_tool = {}
                for key, value in tool.items():
                    ant_tool[key.replace("parameters", "input_schema")] = value

                ant_tools.append(ant_tool)

            ant_config["tools"] = ant_tools

        # Convert tool_choice
        if config.get("tool_choice") is not None:
            ant_config["tool_choice"] = self._convert_tool_choice(config["tool_choice"])

        if config.get("fast_mode"):
            ant_config["speed"] = "fast"
            ant_config["betas"] = ["fast-mode-2026-02-01"]

        if config.get("prompt_caching") is not None and config["prompt_caching"] != PromptCaching.ENABLE:
            raise UnsupportedParameterError(
                self.__class__.__name__, "prompt_caching", "prompt_caching must be ENABLE for the Messages API."
            )

        return ant_config

    def transform_uni_message_to_model_input(self, messages: list[UniMessage]) -> list[BetaMessageParam]:
        """
        Transform universal message format to the Messages API BetaMessageParam format.

        Args:
            messages: List of universal message dictionaries

        Returns:
            List of Messages API BetaMessageParam objects
        """
        ant_messages: list[BetaMessageParam] = []

        for msg in messages:
            content_blocks = []
            for item in msg["content_items"]:
                if item["type"] == "text":
                    content_blocks.append({"type": "text", "text": item["text"]})
                elif item["type"] == "image_url":
                    content_blocks.append(self._convert_image_url_to_source(item["image_url"]))
                elif item["type"] == "thinking":
                    if item["thinking"] == REDACTED_THINKING:
                        content_blocks.append({"type": "redacted_thinking", "data": item["fidelity"]["signature"]})
                    else:
                        # third-party servers accept thinking without a signature, but the
                        # official API requires the one it emitted
                        thinking_block = {"type": "thinking", "thinking": item["thinking"]}
                        signature = (item.get("fidelity") or {}).get("signature")
                        if signature is not None:
                            thinking_block["signature"] = signature

                        content_blocks.append(thinking_block)
                elif item["type"] == "tool_call":
                    content_blocks.append(
                        {
                            "type": "tool_use",
                            "id": item["tool_call_id"],
                            "name": item["name"],
                            "input": item["arguments"],
                        }
                    )
                elif item["type"] == "tool_result":
                    if "tool_call_id" not in item:
                        raise ValueError("tool_call_id is required for tool result.")

                    tool_result = [{"type": "text", "text": item["text"]}]
                    if "images" in item:
                        for image_url in item["images"]:
                            tool_result.append(self._convert_image_url_to_source(image_url))

                    content_blocks.append(
                        {"type": "tool_result", "content": tool_result, "tool_use_id": item["tool_call_id"]}
                    )
                else:
                    raise ValueError(f"Unknown item: {item}")

            ant_messages.append({"role": msg["role"], "content": content_blocks})

        return ant_messages

    def transform_model_output_to_uni_event(self, model_output: BetaRawMessageStreamEvent) -> UniEvent:
        """
        Transform a Messages API streaming event to universal event format.

        NOTE: the Messages API always has only one content item per event.

        Args:
            model_output: Messages API streaming event

        Returns:
            Universal event dictionary
        """
        event_type: EventType | None = None
        content_items: list[PartialContentItem] = []
        usage_metadata: UsageMetadata | None = None
        finish_reason: FinishReason | None = None

        ant_event_type = model_output.type
        if ant_event_type == "content_block_start":
            event_type = "start"
            block = model_output.content_block
            if block.type == "tool_use":
                content_items.append(
                    {"type": "partial_tool_call", "name": block.name, "arguments": "", "tool_call_id": block.id}
                )
            elif block.type == "redacted_thinking":
                content_items.append(
                    {"type": "thinking", "thinking": REDACTED_THINKING, "fidelity": {"signature": block.data}}
                )

        elif ant_event_type == "content_block_delta":
            event_type = "delta"
            delta = model_output.delta
            if delta.type == "thinking_delta":
                content_items.append({"type": "thinking", "thinking": delta.thinking})
            elif delta.type == "text_delta":
                content_items.append({"type": "text", "text": delta.text})
            elif delta.type == "input_json_delta":
                content_items.append(
                    {"type": "partial_tool_call", "name": "", "arguments": delta.partial_json, "tool_call_id": ""}
                )
            elif delta.type == "signature_delta":
                content_items.append({"type": "thinking", "thinking": "", "fidelity": {"signature": delta.signature}})

        elif ant_event_type == "content_block_stop":
            event_type = "stop"

        elif ant_event_type == "message_start":
            event_type = "start"
            message = model_output.message
            if getattr(message, "usage", None):
                cache_creation_tokens = message.usage.cache_creation_input_tokens or 0
                usage_metadata = {
                    "cached_tokens": message.usage.cache_read_input_tokens,
                    "prompt_tokens": message.usage.input_tokens + cache_creation_tokens,
                    "thoughts_tokens": None,
                    "response_tokens": None,
                }

        elif ant_event_type == "message_delta":
            event_type = "stop"
            delta = model_output.delta
            if getattr(delta, "stop_reason", None):
                stop_reason_mapping = {
                    "end_turn": "stop",
                    "max_tokens": "length",
                    "stop_sequence": "stop",
                    "tool_use": "tool_call",
                }
                finish_reason = stop_reason_mapping.get(delta.stop_reason, "unknown")

            usage = getattr(model_output, "usage", None)
            if usage:
                # gateways report zero usage in message_start and the full counts here, so the
                # delta also carries the input-side fields (None on servers that omit them)
                if usage.input_tokens is not None:
                    prompt_tokens = usage.input_tokens + (usage.cache_creation_input_tokens or 0)
                else:
                    prompt_tokens = None

                output_details = getattr(usage, "output_tokens_details", None)
                thinking_tokens = getattr(output_details, "thinking_tokens", None) if output_details else None
                usage_metadata = {
                    "cached_tokens": usage.cache_read_input_tokens,
                    "prompt_tokens": prompt_tokens,
                    "thoughts_tokens": thinking_tokens,
                    "response_tokens": usage.output_tokens - (thinking_tokens or 0),
                }

        elif ant_event_type == "message_stop":
            event_type = "stop"

        elif ant_event_type in ["text", "thinking", "signature", "input_json", "ping"]:
            # the SDK drops the "ping" heartbeat at the SSE layer; it reaches here only from
            # gateways that relabel it onto another event
            event_type = "unused"

        elif is_debug_enabled():
            raise ValueError(f"Unknown output: {model_output}")

        else:
            # a gateway injects its own events (heartbeats, cost tickers) into the stream, and
            # killing a long generation over one costs more than dropping it
            event_type = "unused"

        return {
            "role": "assistant",
            "event_type": event_type,
            "content_items": content_items,
            "usage_metadata": usage_metadata,
            "finish_reason": finish_reason,
        }

    async def _streaming_response_internal(
        self,
        messages: list[UniMessage],
        config: UniConfig,
    ) -> AsyncIterator[UniEvent]:
        """Stream generate using an Anthropic Messages-compatible API with unified conversion methods."""
        # Use unified config conversion
        ant_config = self.transform_uni_config_to_model_config(config)

        # Use unified message conversion
        ant_messages = self.transform_uni_message_to_model_input(messages)

        # Stream generate
        partial_tool_call = {}
        partial_usage = {}
        stream = await self._client.beta.messages.create(**ant_config, messages=ant_messages)
        async for event in stream:
            event = self.transform_model_output_to_uni_event(event)
            if event["event_type"] == "start":
                for item in event["content_items"]:
                    if item["type"] == "partial_tool_call":
                        # initialize partial_tool_call
                        partial_tool_call = {
                            "name": item["name"],
                            "arguments": "",
                            "tool_call_id": item["tool_call_id"],
                        }

                if event["content_items"]:
                    yield event

                if event["usage_metadata"] is not None:
                    # initialize partial_usage
                    partial_usage = {
                        "prompt_tokens": event["usage_metadata"]["prompt_tokens"],
                        "cached_tokens": event["usage_metadata"]["cached_tokens"],
                    }

            elif event["event_type"] == "delta":
                for item in event["content_items"]:
                    if item["type"] == "partial_tool_call":
                        # update partial_tool_call
                        partial_tool_call["arguments"] += item["arguments"]

                yield event

            elif event["event_type"] == "stop":
                if "name" in partial_tool_call and "arguments" in partial_tool_call:
                    # finish partial_tool_call
                    yield {
                        "role": "assistant",
                        "event_type": "delta",
                        "content_items": [
                            {
                                "type": "tool_call",
                                "name": partial_tool_call["name"],
                                "arguments": parse_tool_call_arguments(
                                    partial_tool_call["arguments"],
                                    self.__class__.__name__,
                                    partial_tool_call["name"],
                                    partial_tool_call["tool_call_id"],
                                ),
                                "tool_call_id": partial_tool_call["tool_call_id"],
                            }
                        ],
                        "usage_metadata": None,
                        "finish_reason": None,
                    }
                    partial_tool_call = {}

                if event["usage_metadata"] is not None:
                    # finish partial_usage: the message_delta counts win over message_start
                    delta_usage = event["usage_metadata"]
                    usage_metadata = {
                        "prompt_tokens": (
                            delta_usage["prompt_tokens"]
                            if delta_usage["prompt_tokens"] is not None
                            else partial_usage.get("prompt_tokens")
                        ),
                        "cached_tokens": (
                            delta_usage["cached_tokens"]
                            if delta_usage["cached_tokens"] is not None
                            else partial_usage.get("cached_tokens")
                        ),
                        "thoughts_tokens": delta_usage["thoughts_tokens"],
                        "response_tokens": delta_usage["response_tokens"],
                    }
                    yield {
                        "role": "assistant",
                        "event_type": "stop",
                        "content_items": [],
                        "usage_metadata": fix_openrouter_usage_metadata(usage_metadata, str(self._client.base_url)),
                        "finish_reason": event["finish_reason"],
                    }
                    partial_usage = {}

    async def list_models(self) -> list[str]:
        """
        List the model ids the configured endpoint serves.

        Returns:
            list[str]: The model ids, in the order the endpoint returned them.
        """
        return [model.id async for model in self._client.models.list()]
