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
import json
import mimetypes
import os
from typing import Any, AsyncIterator

import httpx
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionChunk, ChatCompletionMessageParam

from ..base_client import LLMClient
from ..errors import UnsupportedParameterError, parse_tool_call_arguments
from ..types import (
    EventType,
    FinishReason,
    PartialContentItem,
    PromptCaching,
    ToolChoice,
    UniConfig,
    UniEvent,
    UniMessage,
    UsageMetadata,
)
from ..utils import fix_openrouter_usage_metadata, openai_image_detail


class OpenaiChatClient(LLMClient):
    """OpenAI Chat Completions-compatible client implementation."""

    def __init__(
        self,
        model: str,
        api_key: str | None = None,
        base_url: str | None = None,
        default_headers: dict[str, str] | None = None,
    ):
        """Initialize OpenAI-compatible chat client with model, API key, and base URL."""
        self._model = model
        api_key = api_key or os.getenv("OPENAI_API_KEY")
        base_url = base_url or os.getenv("OPENAI_BASE_URL")
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url, default_headers=default_headers)
        self._history: list[UniMessage] = []

    async def _convert_image_url_to_base64(self, url: str) -> str:
        """Convert image URL to base64-encoded string.

        Args:
            url: Image URL to convert

        Returns:
            Base64-encoded image string
        """
        if url.startswith("data:"):
            return url

        async with httpx.AsyncClient() as client:
            response = await client.get(url)
            response.raise_for_status()
            image_bytes = response.content
            mime_type = mimetypes.guess_type(url)[0] or "image/jpeg"
            base64_string = base64.b64encode(image_bytes).decode("utf-8")
            return f"data:{mime_type};base64,{base64_string}"

    def _convert_tool_choice(self, tool_choice: ToolChoice) -> str | dict[str, Any]:
        """Convert ToolChoice to OpenAI Chat Completions tool_choice format."""
        if isinstance(tool_choice, list):
            return {
                "type": "allowed_tools",
                "allowed_tools": {
                    "mode": "auto",
                    "tools": [{"type": "function", "function": {"name": name}} for name in tool_choice],
                },
            }

        return tool_choice

    def _convert_image_url(self, data_url: str) -> dict[str, Any]:
        """Convert a fetched image to an image_url part, at the detail the API needs to read it."""
        image_url = {"url": data_url}
        if detail := openai_image_detail(self._model, data_url):
            image_url["detail"] = detail

        return {"type": "image_url", "image_url": image_url}

    def transform_uni_config_to_model_config(self, config: UniConfig) -> dict[str, Any]:
        """
        Transform universal configuration to OpenAI Chat Completions configuration.

        Args:
            config: Universal configuration dict

        Returns:
            OpenAI Chat Completions configuration dictionary
        """
        openai_config = {"model": self._model, "stream": True, "stream_options": {"include_usage": True}}

        if config.get("max_tokens") is not None:
            openai_config["max_completion_tokens"] = config["max_tokens"]

        if config.get("temperature") is not None:
            openai_config["temperature"] = config["temperature"]

        if config.get("tools") is not None:
            openai_config["tools"] = [{"type": "function", "function": tool} for tool in config["tools"]]

        if config.get("tool_choice") is not None:
            openai_config["tool_choice"] = self._convert_tool_choice(config["tool_choice"])

        if config.get("fast_mode"):
            openai_config["service_tier"] = "priority"

        if config.get("prompt_caching") is not None and config["prompt_caching"] != PromptCaching.ENABLE:
            raise UnsupportedParameterError(
                self.__class__.__name__, "prompt_caching", "prompt_caching must be ENABLE for OpenAI."
            )

        return openai_config

    async def transform_uni_message_to_model_input(
        self, messages: list[UniMessage]
    ) -> list[ChatCompletionMessageParam]:
        """
        Transform universal message format to OpenAI Chat Completions message format.

        Args:
            messages: List of universal message dictionaries

        Returns:
            List of OpenAI Chat Completions message dictionaries
        """
        openai_messages = []

        for msg in messages:
            content_parts = []  # may be empty for tool results
            tool_calls = []  # may be empty for no tool calls
            thinking = ""
            thinking_fields: set[str | None] = set()
            for item in msg["content_items"]:
                if item["type"] == "text":
                    content_parts.append({"type": "text", "text": item["text"]})
                elif item["type"] == "image_url":
                    base64_image = await self._convert_image_url_to_base64(item["image_url"])
                    content_parts.append(self._convert_image_url(base64_image))
                elif item["type"] == "thinking":
                    thinking += item["thinking"]
                    thinking_fields.add((item.get("fidelity") or {}).get("reasoning_field"))
                elif item["type"] == "tool_call":
                    tool_calls.append(
                        {
                            "id": item["tool_call_id"],
                            "type": "function",
                            "function": {
                                "name": item["name"],
                                "arguments": json.dumps(item["arguments"], ensure_ascii=False),
                            },
                        }
                    )
                elif item["type"] == "tool_result":
                    if "tool_call_id" not in item:
                        raise ValueError("tool_call_id is required for tool result.")

                    image_parts = []

                    if "images" in item and item["images"]:
                        for image_url in item["images"]:
                            part = self._convert_image_url(await self._convert_image_url_to_base64(image_url))
                            if "siliconflow.cn" in str(self._client.base_url):
                                # siliconflow does not support image_url in tool result
                                content_parts.append(part)
                            else:
                                image_parts.append(part)

                    # a plain string is the form every OpenAI-compatible server accepts for a text
                    # result; the content-part list is reserved for results carrying images, which
                    # only servers with multimodal tool messages take
                    content = [{"type": "text", "text": item["text"]}, *image_parts] if image_parts else item["text"]

                    # Tool results are sent as separate messages
                    openai_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": item["tool_call_id"],
                            "content": content,
                        }
                    )
                else:
                    raise ValueError(f"Unknown item type: {item['type']}")

            message = {"role": msg["role"]}
            if content_parts:
                message["content"] = content_parts

            if tool_calls:
                message["tool_calls"] = tool_calls

            if thinking:
                # send thinking back through the exact field the upstream produced (recorded
                # in the item fidelity); servers may reject the spelling they did not emit
                if thinking_fields == {"reasoning_content"}:
                    message["reasoning_content"] = thinking
                elif thinking_fields == {"reasoning"}:
                    message["reasoning"] = thinking
                else:
                    message["reasoning_content"] = thinking  # vLLM & siliconflow compatibility
                    message["reasoning"] = thinking  # openrouter compatibility

            # message may be empty for tool results
            if len(message.keys()) > 1:
                openai_messages.append(message)

        return openai_messages

    def transform_model_output_to_uni_event(self, model_output: ChatCompletionChunk) -> UniEvent:
        """
        Transform OpenAI Chat Completions streaming chunk to universal event format.

        Args:
            model_output: OpenAI streaming chunk

        Returns:
            Universal event dictionary
        """
        event_type: EventType | None = None
        content_items: list[PartialContentItem] = []
        usage_metadata: UsageMetadata | None = None
        finish_reason: FinishReason | None = None

        # gateways inject content-free heartbeat chunks on long generations, whose choices
        # the SDK leaves as None rather than an empty list
        if model_output.choices:
            choice = model_output.choices[0]
            delta = choice.delta

            if delta.content:
                event_type = "delta"
                content_items.append({"type": "text", "text": delta.content})

            # the thinking field name differs by server: vLLM & siliconflow use reasoning_content
            # while openrouter uses reasoning; record the wire field that carried each delta
            # so a replay can reproduce exactly the field the upstream produced
            reasoning_content = getattr(delta, "reasoning_content", None)
            reasoning = getattr(delta, "reasoning", None)
            if reasoning_content and reasoning:
                event_type = "delta"
                # ambiguous origin: record no fidelity so a replay sends both fields back
                content_items.append({"type": "thinking", "thinking": reasoning_content})
            elif reasoning_content:
                event_type = "delta"
                content_items.append(
                    {
                        "type": "thinking",
                        "thinking": reasoning_content,
                        "fidelity": {"reasoning_field": "reasoning_content"},
                    }
                )
            elif reasoning:
                event_type = "delta"
                content_items.append(
                    {"type": "thinking", "thinking": reasoning, "fidelity": {"reasoning_field": "reasoning"}}
                )

            if delta.tool_calls:
                for tool_call in delta.tool_calls:
                    event_type = "delta"
                    content_items.append(
                        {
                            "type": "partial_tool_call",
                            "name": tool_call.function.name or "",
                            "arguments": tool_call.function.arguments or "",
                            "tool_call_id": tool_call.id or tool_call.function.name or "",
                        }
                    )

            if choice.finish_reason:
                event_type = event_type or "stop"
                finish_reason_mapping = {
                    "stop": "stop",
                    "length": "length",
                    "tool_calls": "tool_call",
                    "content_filter": "stop",
                }
                finish_reason = finish_reason_mapping.get(choice.finish_reason, "unknown")

        if model_output.usage:
            event_type = event_type or "stop"  # deal with separate usage data

            if model_output.usage.prompt_tokens_details:
                cached_tokens = model_output.usage.prompt_tokens_details.cached_tokens
            else:
                cached_tokens = None

            if model_output.usage.completion_tokens_details:
                reasoning_tokens = model_output.usage.completion_tokens_details.reasoning_tokens
            else:
                reasoning_tokens = None

            if cached_tokens is not None:
                prompt_tokens = model_output.usage.prompt_tokens - cached_tokens
            else:
                prompt_tokens = model_output.usage.prompt_tokens

            if reasoning_tokens is not None:
                response_tokens = model_output.usage.completion_tokens - reasoning_tokens
            else:
                response_tokens = model_output.usage.completion_tokens

            usage_metadata = {
                "cached_tokens": cached_tokens,
                "prompt_tokens": prompt_tokens,
                "thoughts_tokens": reasoning_tokens,
                "response_tokens": response_tokens,
            }
            usage_metadata = fix_openrouter_usage_metadata(usage_metadata, str(self._client.base_url))

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
        """Stream generate using OpenAI Chat Completions-compatible API."""
        openai_config = self.transform_uni_config_to_model_config(config)

        openai_messages = await self.transform_uni_message_to_model_input(messages)

        if config.get("system_prompt"):
            openai_messages.insert(0, {"role": "system", "content": config["system_prompt"]})

        stream = await self._client.chat.completions.create(**openai_config, messages=openai_messages)

        partial_tool_call = {}
        partial_usage = {}
        async for chunk in stream:
            event = self.transform_model_output_to_uni_event(chunk)
            # the finish reason and usage metadata should be accumulated
            partial_usage["finish_reason"] = event["finish_reason"] or partial_usage.get("finish_reason")
            partial_usage["usage_metadata"] = event["usage_metadata"] or partial_usage.get("usage_metadata")
            if event["event_type"] == "delta":
                for item in event["content_items"]:
                    if item["type"] == "partial_tool_call":
                        if not partial_tool_call:
                            # start new partial tool call for tool call object
                            partial_tool_call = {
                                "name": item["name"],
                                "arguments": item["arguments"],
                                "tool_call_id": item["tool_call_id"],
                            }
                        elif item["name"]:
                            # finish previous partial tool call for tool call object
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
                            # start new partial tool call for tool call object
                            partial_tool_call = {
                                "name": item["name"],
                                "arguments": item["arguments"],
                                "tool_call_id": item["tool_call_id"],
                            }
                        else:
                            # update partial tool call for tool call object
                            partial_tool_call["arguments"] += item["arguments"]

                yield event
            elif event["event_type"] == "stop":
                if partial_tool_call:
                    # finish partial tool call for tool call object
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

                if partial_usage.get("finish_reason") and partial_usage.get("usage_metadata"):
                    yield {
                        "role": "assistant",
                        "event_type": "stop",
                        "content_items": [],
                        "usage_metadata": partial_usage["usage_metadata"],
                        "finish_reason": partial_usage["finish_reason"],
                    }
                    partial_usage = {}

    async def list_models(self) -> list[str]:
        """
        List the model ids the configured endpoint serves.

        Returns:
            list[str]: The model ids, in the order the endpoint returned them.
        """
        return [model.id async for model in self._client.models.list()]
