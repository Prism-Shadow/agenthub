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
import os
from typing import Any, AsyncIterator

from openai import AsyncOpenAI
from openai.types.responses import ResponseStreamEvent

from ..base_client import LLMClient
from ..errors import UnsupportedParameterError
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


_DEFAULT_BASE_URL = "https://api.minimax.io/v1"


class MiniMaxM3Client(LLMClient):
    """MiniMax M3 client using MiniMax's Responses API."""

    def __init__(
        self,
        model: str,
        api_key: str | None = None,
        base_url: str | None = None,
        default_headers: dict[str, str] | None = None,
    ):
        """Initialize a MiniMax M3 Responses client with a Subscription Key or API key."""
        self._model = model
        # The wrapped OpenAI SDK falls back to OPENAI_API_KEY when handed None, which would send an
        # OpenAI credential to the MiniMax host, so resolve the key here and fail loudly instead.
        resolved_api_key = api_key or os.getenv("MINIMAX_API_KEY")
        if not resolved_api_key:
            raise ValueError("MINIMAX_API_KEY is required for MiniMaxM3Client.")
        self._client = AsyncOpenAI(
            api_key=resolved_api_key,
            base_url=base_url or os.getenv("MINIMAX_BASE_URL") or _DEFAULT_BASE_URL,
            default_headers=default_headers,
        )
        self._history: list[UniMessage] = []

    def _convert_thinking_level_to_effort(self, thinking_level: ThinkingLevel) -> str:
        """Map AgentHub thinking levels to the MiniMax reasoning effort vocabulary."""
        mapping = {
            ThinkingLevel.NONE: "none",
            ThinkingLevel.LOW: "low",
            ThinkingLevel.MEDIUM: "medium",
            ThinkingLevel.HIGH: "high",
            ThinkingLevel.XHIGH: "high",
            # MiniMax stops at "high"
            ThinkingLevel.MAX: "high",
        }
        return mapping[thinking_level]

    def _convert_tool_choice(self, tool_choice: ToolChoice) -> str:
        """Validate MiniMax's supported automatic tool-selection modes."""
        if tool_choice in ("auto", "none"):
            return tool_choice
        raise UnsupportedParameterError(
            self.__class__.__name__,
            "tool_choice",
            "MiniMax Responses API does not support required or named tool selection.",
        )

    def transform_uni_config_to_model_config(self, config: UniConfig) -> dict[str, Any]:
        """Transform universal configuration to MiniMax's Responses API payload."""
        minimax_config: dict[str, Any] = {"model": self._model, "store": False}

        if config.get("system_prompt") is not None:
            minimax_config["instructions"] = config["system_prompt"]
        if config.get("max_tokens") is not None:
            minimax_config["max_output_tokens"] = config["max_tokens"]
        if config.get("temperature") is not None:
            temperature = config["temperature"]
            if not 0 <= temperature <= 1:
                raise UnsupportedParameterError(
                    self.__class__.__name__,
                    "temperature",
                    "MiniMax Responses API does not support temperatures outside the range 0 to 1.",
                )
            minimax_config["temperature"] = temperature
        if config.get("thinking_level") is not None:
            minimax_config["reasoning"] = {"effort": self._convert_thinking_level_to_effort(config["thinking_level"])}
        if config.get("tools") is not None:
            minimax_config["tools"] = [{"type": "function", **tool} for tool in config["tools"]]
        if config.get("tool_choice") is not None:
            minimax_config["tool_choice"] = self._convert_tool_choice(config["tool_choice"])
        if config.get("fast_mode"):
            minimax_config["service_tier"] = "priority"

        if config.get("prompt_caching") == PromptCaching.DISABLE:
            raise UnsupportedParameterError(
                self.__class__.__name__,
                "prompt_caching",
                "MiniMax Responses API does not support disabling its automatic prompt cache.",
            )
        if config.get("prompt_caching") == PromptCaching.ENHANCE:
            raise UnsupportedParameterError(
                self.__class__.__name__,
                "prompt_caching",
                "MiniMax Responses API does not support enhancing its automatic prompt cache.",
            )

        return minimax_config

    def transform_uni_message_to_model_input(self, messages: list[UniMessage]) -> list[dict[str, Any]]:
        """Transform universal messages to MiniMax Responses input items."""
        input_list: list[dict[str, Any]] = []

        for message in messages:
            content_items: list[dict[str, Any]] = []
            for item in message["content_items"]:
                # anything that is not message content becomes an input item of its own, so the
                # text collected so far is flushed first to keep the order the model produced
                if item["type"] not in ("text.done", "image_url.done") and content_items:
                    # Every turn goes back as a typed message item — the Responses API's EasyInputMessage
                    # shape, where type "message" is valid for any role. A vLLM-style Responses server
                    # answers a bare {"role": "assistant", "content": [...]} item with a 400 on the turn that
                    # replays it and takes the typed form for every role; OpenAI, DeepSeek and MiniMax accept
                    # either shape. Nothing beyond that minimal shape goes out: an id or a status the server
                    # never sent would be an invention.
                    input_list.append({"type": "message", "role": message["role"], "content": content_items})
                    content_items = []

                if item["type"] == "text.done":
                    content_items.append(
                        {
                            "type": "input_text" if message["role"] == "user" else "output_text",
                            "text": item["text"],
                        }
                    )
                elif item["type"] == "image_url.done":
                    content_items.append({"type": "input_image", "image_url": item["image_url"]})
                elif item["type"] == "thinking.done":
                    # MiniMax accepts a reasoning item rebuilt from the thinking text alone, so no
                    # fidelity is recorded for it.
                    input_list.append(
                        {
                            "type": "reasoning",
                            "content": [{"type": "reasoning_text", "text": item["thinking"]}]
                            if item["thinking"]
                            else [],
                        }
                    )
                elif item["type"] == "tool_call.done":
                    input_list.append(
                        {
                            "type": "function_call",
                            "call_id": item["tool_call_id"],
                            "name": item["name"],
                            "arguments": json.dumps(item["arguments"], ensure_ascii=False),
                        }
                    )
                elif item["type"] == "tool_result.done":
                    if "tool_call_id" not in item:
                        raise ValueError("tool_call_id is required for tool result.")

                    output: str | list[dict[str, Any]] = item["text"]
                    if item.get("images"):
                        output = [{"type": "input_text", "text": item["text"]}]
                        output.extend({"type": "input_image", "image_url": image_url} for image_url in item["images"])
                    input_list.append(
                        {
                            "type": "function_call_output",
                            "call_id": item["tool_call_id"],
                            "output": output,
                        }
                    )
                else:
                    raise ValueError(f"Unknown item: {item}")

            if content_items:
                input_list.append({"type": "message", "role": message["role"], "content": content_items})

        return input_list

    def transform_model_output_to_uni_event(self, model_output: ResponseStreamEvent) -> UniEvent:
        """Transform one MiniMax streaming event into a universal event, identifying items by output item id."""
        event_type: EventType = "delta"
        content_items: list[EventContentItem] = []
        usage_metadata: UsageMetadata | None = None
        finish_reason: FinishReason | None = None

        minimax_event_type = model_output.type
        if minimax_event_type == "response.output_text.delta":
            content_items.append(
                {
                    "type": "text.delta",
                    "text": model_output.delta,
                    "fidelity": {"item_id": getattr(model_output, "item_id", None)},
                }
            )

        elif minimax_event_type == "response.reasoning_text.delta":
            content_items.append(
                {
                    "type": "thinking.delta",
                    "thinking": model_output.delta,
                    "fidelity": {"item_id": getattr(model_output, "item_id", None)},
                }
            )

        elif minimax_event_type == "response.output_item.added":
            # a message or reasoning item is announced with an empty delta, so a fragment a server
            # sends without its item id belongs to the item announced last
            if model_output.item.type == "message":
                content_items.append(
                    {"type": "text.delta", "text": "", "fidelity": {"item_id": getattr(model_output.item, "id", None)}}
                )
            elif model_output.item.type == "reasoning":
                content_items.append(
                    {
                        "type": "thinking.delta",
                        "thinking": "",
                        "fidelity": {"item_id": getattr(model_output.item, "id", None)},
                    }
                )

        elif minimax_event_type == "response.output_item.done":
            # MiniMax's tool calls are read from the completed item alone: the argument deltas are
            # left unread rather than reconciled against this item, and the call streams as one
            # delta carrying the whole arguments, so what a consumer streams and the call it is
            # handed are one and the same.
            item = model_output.item
            if item.type == "function_call":
                content_items.append(
                    {
                        "type": "tool_call.delta",
                        "name": item.name,
                        # a server may complete a call without its arguments field
                        "arguments": item.arguments or "",
                        "tool_call_id": item.call_id,
                        # a server that sends no item id still sends the call id
                        "fidelity": {"item_id": item.id or item.call_id},
                    }
                )

        elif minimax_event_type in ("response.completed", "response.incomplete"):
            event_type = "stop"
            response = model_output.response
            finish_reason_mapping: dict[str, FinishReason] = {"completed": "stop", "incomplete": "length"}
            finish_reason = finish_reason_mapping.get(response.status, "unknown")

            if response.usage:
                # MiniMax drops the detail blocks on truncated responses, so default them to zero.
                input_details = response.usage.input_tokens_details
                output_details = response.usage.output_tokens_details
                cached_tokens = input_details.cached_tokens if input_details else 0
                reasoning_tokens = output_details.reasoning_tokens if output_details else 0
                usage_metadata = {
                    "cached_tokens": cached_tokens,
                    "prompt_tokens": response.usage.input_tokens - cached_tokens,
                    "thoughts_tokens": reasoning_tokens,
                    "response_tokens": response.usage.output_tokens - reasoning_tokens,
                }

        elif (
            minimax_event_type
            not in (
                "response.created",
                "response.in_progress",
                "response.output_text.done",
                "response.reasoning_text.done",
                "response.function_call_arguments.delta",
                "response.function_call_arguments.done",
                "response.content_part.added",
                "response.content_part.done",
                "keepalive",  # gateway heartbeat on long generations; carries no content
            )
            and is_debug_enabled()
        ):
            raise ValueError(f"Unknown output: {model_output}")

        return {
            "role": "assistant",
            "event_type": event_type,
            "content_items": content_items,
            "usage_metadata": usage_metadata,
            "finish_reason": finish_reason,
        }

    async def _streaming_response_internal(
        self, messages: list[UniMessage], config: UniConfig
    ) -> AsyncIterator[UniEvent]:
        """Stream MiniMax Responses events with unified conversion methods."""
        minimax_config = self.transform_uni_config_to_model_config(config)
        input_list = self.transform_uni_message_to_model_input(messages)

        stream = await self._client.responses.create(**minimax_config, input=input_list, stream=True)
        async for model_event in stream:
            yield self.transform_model_output_to_uni_event(model_event)

    async def list_models(self) -> list[str]:
        """
        List the model ids the configured endpoint serves.

        Returns:
            list[str]: The model ids, in the order the endpoint returned them.
        """
        return [model.id async for model in self._client.models.list()]
