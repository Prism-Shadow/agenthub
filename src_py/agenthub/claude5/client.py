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

import base64
import mimetypes
import os
import re
from typing import Any, AsyncIterator

import httpx
from anthropic import AsyncAnthropic, AsyncAnthropicBedrock
from anthropic.types.beta import BetaMessageParam, BetaRawMessageStreamEvent

from ..base_client import LLMClient, done_marker
from ..errors import UnsupportedOperationError, UnsupportedParameterError
from ..types import (
    EventContentItem,
    EventType,
    FinishReason,
    PromptCaching,
    ThinkingLevel,
    ToolChoice,
    UniConfig,
    UniEvent,
    UniMessage,
    UsageMetadata,
)
from ..utils import is_debug_enabled


REDACTED_THINKING = "_REDACTED_THINKING"


class Claude5Client(LLMClient):
    """Claude 5-specific LLM client implementation (also serves Claude 4.6 through 4.8)."""

    def __init__(
        self,
        model: str,
        api_key: str | None = None,
        base_url: str | None = None,
        default_headers: dict[str, str] | None = None,
    ):
        """Initialize Claude 5 client with model and API key."""
        self._model = model
        api_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        base_url = base_url or os.getenv("ANTHROPIC_BASE_URL")
        if base_url and base_url.startswith("bedrock://"):  # example: bedrock://us-east-1
            region = base_url.replace("bedrock://", "")
            access_key, secret_key = api_key.split(",")
            self._client = AsyncAnthropicBedrock(
                aws_secret_key=secret_key,
                aws_access_key=access_key,
                aws_region=region,
                default_headers=default_headers,
            )
            self._use_bedrock = True
        else:
            self._client = AsyncAnthropic(api_key=api_key, base_url=base_url, default_headers=default_headers)
            self._use_bedrock = False

        self._history: list[UniMessage] = []

    async def _convert_image_url_to_source(self, url: str) -> dict[str, Any]:
        """Convert image URL to image source.

        Bedrock does not support image url sources, so we need to fetch the image bytes and encode them.

        Args:
            url: Image URL to convert

        Returns:
            Image source
        """
        if url.startswith("data:"):
            match = re.match(r"data:([^;]+);base64,(.+)", url)
            if match:
                media_type = match.group(1)
                base64_data = match.group(2)
                source = {
                    "type": "image",
                    "source": {"type": "base64", "media_type": media_type, "data": base64_data},
                }
            else:
                raise ValueError(f"Invalid base64 image: {url}")
        elif self._use_bedrock:
            async with httpx.AsyncClient() as client:
                response = await client.get(url)
                response.raise_for_status()
                image_bytes = response.content
                mime_type = mimetypes.guess_type(url)[0] or "image/jpeg"
                source = {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": mime_type,
                        "data": base64.b64encode(image_bytes).decode("utf-8"),
                    },
                }
        else:
            source = {"type": "image", "source": {"type": "url", "url": url}}

        return source

    def _convert_thinking_level_to_thinking_config(self, thinking_level: ThinkingLevel) -> dict[str, Any]:
        """Convert ThinkingLevel enum to Claude's adaptive thinking config."""
        mapping = {
            ThinkingLevel.NONE: {},  # omit thinking config
            ThinkingLevel.LOW: {"thinking": {"type": "adaptive"}, "output_config": {"effort": "low"}},
            ThinkingLevel.MEDIUM: {"thinking": {"type": "adaptive"}, "output_config": {"effort": "medium"}},
            ThinkingLevel.HIGH: {"thinking": {"type": "adaptive"}, "output_config": {"effort": "high"}},
            # Claude 4.6 has no xhigh effort, so XHIGH degrades to the closest supported level
            ThinkingLevel.XHIGH: {
                "thinking": {"type": "adaptive"},
                "output_config": {"effort": "high" if "4-6" in self._model else "xhigh"},
            },
            # every model this client serves is 4.6 or later, and max spans that whole range
            ThinkingLevel.MAX: {"thinking": {"type": "adaptive"}, "output_config": {"effort": "max"}},
        }
        return mapping.get(thinking_level)

    def _convert_tool_choice(self, tool_choice: ToolChoice) -> dict[str, str]:
        """Convert ToolChoice to Claude's tool_choice format."""
        if isinstance(tool_choice, list):
            if len(tool_choice) > 1:
                raise UnsupportedParameterError(
                    self.__class__.__name__, "tool_choice", "Claude supports only one tool choice."
                )

            return {"type": "any", "name": tool_choice[0]}
        elif tool_choice == "none":
            return {"type": "none"}
        elif tool_choice == "auto":
            return {"type": "auto"}
        elif tool_choice == "required":
            return {"type": "any"}

    def transform_uni_config_to_model_config(self, config: UniConfig) -> dict[str, Any]:
        """
        Transform universal configuration to Claude-specific configuration.

        Args:
            config: Universal configuration dict

        Returns:
            Claude configuration dictionary
        """
        claude_config = {"model": self._model, "stream": True}

        if config.get("system_prompt") is not None:
            claude_config["system"] = config["system_prompt"]

        if config.get("max_tokens") is not None:
            claude_config["max_tokens"] = config["max_tokens"]
        else:
            claude_config["max_tokens"] = 64000  # Claude requires max_tokens to be specified

        if config.get("temperature") is not None and config["temperature"] != 1.0:
            raise UnsupportedParameterError(
                self.__class__.__name__,
                "temperature",
                "Claude models do not support setting temperature; the API dropped it "
                "starting with the 4.7 generation and the unified client rejects it for the whole family.",
            )

        if config.get("thinking_level") is not None:
            claude_config.update(self._convert_thinking_level_to_thinking_config(config["thinking_level"]))

        if config.get("thinking_summary") is not None:
            # display lives on the thinking block, so a summary asked for on its own selects
            # adaptive thinking, which is what this family runs by default anyway; a block
            # carrying display but no output_config is accepted on 4.6 through 5 (verified
            # live 2026-09-03). NONE omits the block, so the request lands on that default.
            thinking = claude_config.setdefault("thinking", {"type": "adaptive"})
            thinking["display"] = "summarized" if config["thinking_summary"] else "omitted"

        # Convert tools to Claude's tool schema
        if config.get("tools") is not None:
            claude_tools = []
            for tool in config["tools"]:
                claude_tool = {}
                for key, value in tool.items():
                    claude_tool[key.replace("parameters", "input_schema")] = value

                claude_tools.append(claude_tool)

            claude_config["tools"] = claude_tools

        # Convert tool_choice
        if config.get("tool_choice") is not None:
            claude_config["tool_choice"] = self._convert_tool_choice(config["tool_choice"])

        if config.get("fast_mode"):
            if self._use_bedrock:
                raise UnsupportedParameterError(
                    self.__class__.__name__, "fast_mode", "Bedrock does not support fast mode."
                )

            if "4-6" in self._model:
                raise UnsupportedParameterError(
                    self.__class__.__name__, "fast_mode", "Claude 4.6 does not support fast mode."
                )

            claude_config["speed"] = "fast"
            claude_config["betas"] = ["fast-mode-2026-02-01"]

        # Add cache_control if prompt caching is enabled
        # TODO: wait for bedrock to support cache_control in config
        if not self._use_bedrock:
            prompt_caching = config.get("prompt_caching", PromptCaching.ENABLE)
            if prompt_caching == PromptCaching.ENABLE:
                claude_config["cache_control"] = {"type": "ephemeral"}
            elif prompt_caching == PromptCaching.ENHANCE:
                claude_config["cache_control"] = {"type": "ephemeral", "ttl": "1h"}

        return claude_config

    async def transform_uni_message_to_model_input(self, messages: list[UniMessage]) -> list[BetaMessageParam]:
        """
        Transform universal message format to Claude's BetaMessageParam format.

        Args:
            messages: List of universal message dictionaries

        Returns:
            List of Claude BetaMessageParam objects
        """
        claude_messages: list[BetaMessageParam] = []

        for msg in messages:
            content_blocks = []
            for item in msg["content_items"]:
                if item["type"] == "text.done":
                    content_blocks.append({"type": "text", "text": item["text"]})
                elif item["type"] == "image_url.done":
                    content_blocks.append(await self._convert_image_url_to_source(item["image_url"]))
                elif item["type"] == "thinking.done":
                    if item["thinking"] == REDACTED_THINKING:
                        content_blocks.append({"type": "redacted_thinking", "data": item["fidelity"]["signature"]})
                    else:
                        content_blocks.append(
                            {
                                "type": "thinking",
                                "thinking": item["thinking"],
                                "signature": item["fidelity"]["signature"],
                            }
                        )
                elif item["type"] == "tool_call.done":
                    content_blocks.append(
                        {
                            "type": "tool_use",
                            "id": item["tool_call_id"],
                            "name": item["name"],
                            "input": item["arguments"],
                        }
                    )
                elif item["type"] == "tool_result.done":
                    if "tool_call_id" not in item:
                        raise ValueError("tool_call_id is required for tool result.")

                    tool_result = [{"type": "text", "text": item["text"]}]
                    if "images" in item:
                        for image_url in item["images"]:
                            tool_result.append(await self._convert_image_url_to_source(image_url))

                    content_blocks.append(
                        {"type": "tool_result", "content": tool_result, "tool_use_id": item["tool_call_id"]}
                    )
                else:
                    raise ValueError(f"Unknown item: {item}")

            claude_messages.append({"role": msg["role"], "content": content_blocks})

        return claude_messages

    def transform_model_output_to_uni_event(self, model_output: BetaRawMessageStreamEvent) -> UniEvent:
        """
        Transform one Claude stream event into a universal event, identifying items by content block index.

        Args:
            model_output: Claude streaming event

        Returns:
            Universal event dictionary, an empty delta event when the wire event carries nothing universal
        """
        event_type: EventType = "delta"
        content_items: list[EventContentItem] = []
        usage_metadata: UsageMetadata | None = None
        finish_reason: FinishReason | None = None

        claude_event_type = model_output.type
        if claude_event_type == "content_block_start":
            item_id = str(model_output.index)
            block = model_output.content_block
            if block.type == "tool_use":
                content_items.append(
                    {
                        "type": "tool_call.delta",
                        "name": block.name,
                        "arguments": "",
                        "tool_call_id": block.id,
                        "fidelity": {"item_id": item_id},
                    }
                )
            elif block.type == "redacted_thinking":
                content_items.append(
                    {
                        "type": "thinking.delta",
                        "thinking": REDACTED_THINKING,
                        "fidelity": {"item_id": item_id, "signature": block.data},
                    }
                )

        elif claude_event_type == "content_block_delta":
            item_id = str(model_output.index)
            delta = model_output.delta
            if delta.type == "thinking_delta":
                content_items.append(
                    {"type": "thinking.delta", "thinking": delta.thinking, "fidelity": {"item_id": item_id}}
                )
            elif delta.type == "text_delta":
                content_items.append({"type": "text.delta", "text": delta.text, "fidelity": {"item_id": item_id}})
            elif delta.type == "input_json_delta":
                content_items.append(
                    {
                        "type": "tool_call.delta",
                        "name": "",
                        "arguments": delta.partial_json,
                        "tool_call_id": "",
                        "fidelity": {"item_id": item_id},
                    }
                )
            elif delta.type == "signature_delta":
                # the signature closes the thinking block it belongs to
                content_items.append(
                    {
                        "type": "thinking.delta",
                        "thinking": "",
                        "fidelity": {"item_id": item_id, "signature": delta.signature},
                    }
                )

        elif claude_event_type == "content_block_stop":
            content_items.append(done_marker(str(model_output.index)))

        elif claude_event_type == "message_start":
            event_type = "stop"
            usage = getattr(model_output.message, "usage", None)
            if usage:
                cache_creation_tokens = usage.cache_creation_input_tokens or 0
                usage_metadata = {
                    "cached_tokens": usage.cache_read_input_tokens,
                    "prompt_tokens": usage.input_tokens + cache_creation_tokens,
                    "thoughts_tokens": None,
                    "response_tokens": None,
                }

        elif claude_event_type == "message_delta":
            event_type = "stop"
            stop_reason_mapping = {
                "end_turn": "stop",
                "max_tokens": "length",
                "stop_sequence": "stop",
                "tool_use": "tool_call",
            }
            stop_reason = getattr(model_output.delta, "stop_reason", None)
            if stop_reason:
                finish_reason = stop_reason_mapping.get(stop_reason, "unknown")

            if getattr(model_output, "usage", None):
                # message_delta reports the output tokens; the input side came with message_start
                usage_metadata = {
                    "cached_tokens": None,
                    "prompt_tokens": None,
                    "thoughts_tokens": None,
                    "response_tokens": model_output.usage.output_tokens,
                }

        elif claude_event_type in ["message_stop", "text", "thinking", "signature", "input_json", "ping"]:
            # the SDK drops the "ping" heartbeat at the SSE layer; it reaches here only from
            # gateways that relabel it onto another event
            pass

        elif is_debug_enabled():
            raise ValueError(f"Unknown output: {model_output}")

        else:
            # a gateway injects its own events (heartbeats, cost tickers) into the stream, and
            # killing a long generation over one costs more than dropping it
            pass

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
        """Stream generate using Claude SDK with unified conversion methods."""
        # Use unified config conversion
        claude_config = self.transform_uni_config_to_model_config(config)

        # Use unified message conversion
        claude_messages = await self.transform_uni_message_to_model_input(messages)

        # Add cache_control to last user message's last item if using bedrock and enabled prompt caching
        # TODO: remove after bedrock supports cache_control in config
        if self._use_bedrock:
            prompt_caching = config.get("prompt_caching", PromptCaching.ENABLE)
            if prompt_caching != PromptCaching.DISABLE and claude_messages:
                try:
                    last_user_message = next(filter(lambda x: x["role"] == "user", claude_messages[::-1]))
                    last_content_item = last_user_message["content"][-1]
                    last_content_item["cache_control"] = {
                        "type": "ephemeral",
                        "ttl": "1h" if prompt_caching == PromptCaching.ENHANCE else "5m",
                    }
                except StopIteration:
                    pass

        stream = await self._client.beta.messages.create(**claude_config, messages=claude_messages)
        async for event in stream:
            yield self.transform_model_output_to_uni_event(event)

    async def list_models(self) -> list[str]:
        """
        List the model ids the configured endpoint serves.

        Returns:
            list[str]: The model ids, in the order the endpoint returned them.
        """
        if self._use_bedrock:
            raise UnsupportedOperationError(
                self.__class__.__name__, "list_models", "Bedrock does not support listing models."
            )

        return [model.id async for model in self._client.models.list()]
