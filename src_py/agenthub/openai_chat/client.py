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

from ..base_client import ClientPart, LLMClient
from ..errors import UnsupportedParameterError
from ..types import (
    PromptCaching,
    ToolChoice,
    UniConfig,
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
        # The reasoning field this upstream has produced so far, if any. A turn the model
        # answered without thinking still has to carry that field, empty, when it made tool
        # calls: DeepSeek stops thinking part-way through a long tool chain, and then rejects
        # the replay of that turn with "the reasoning_content in the thinking mode must be
        # passed back to the API". It waives that only for tool_call ids it issued itself,
        # which a relay that reissues ids takes away. A conversation that never produced a
        # reasoning field never receives one.
        replay_fields: set[str | None] = set()

        for msg in messages:
            content_parts = []  # may be empty for tool results
            tool_calls = []  # may be empty for no tool calls
            thinking = ""
            thinking_fields: set[str | None] = set()
            for item in msg["content_items"]:
                if item["type"] == "text.done":
                    content_parts.append({"type": "text", "text": item["text"]})
                elif item["type"] == "image_url.done":
                    base64_image = await self._convert_image_url_to_base64(item["image_url"])
                    content_parts.append(self._convert_image_url(base64_image))
                elif item["type"] == "thinking.done":
                    thinking += item["thinking"]
                    thinking_fields.add((item.get("fidelity") or {}).get("reasoning_field"))
                    if item["thinking"]:
                        replay_fields.add((item.get("fidelity") or {}).get("reasoning_field"))
                elif item["type"] == "tool_call.done":
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
                elif item["type"] == "tool_result.done":
                    if "tool_call_id" not in item:
                        raise ValueError("tool_call_id is required for tool result.")

                    # Chat Completions lets a tool message carry text only, and a server that
                    # validates the schema rejects the whole request over an image part in one.
                    # The images ride in the user message that follows the turn's tool messages,
                    # the one place every OpenAI-compatible server reads them.
                    if "images" in item and item["images"]:
                        for image_url in item["images"]:
                            content_parts.append(
                                self._convert_image_url(await self._convert_image_url_to_base64(image_url))
                            )

                    # the plain string is the form every OpenAI-compatible server accepts
                    openai_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": item["tool_call_id"],
                            "content": item["text"],
                        }
                    )
                else:
                    raise ValueError(f"Unknown item type: {item['type']}")

            message = {"role": msg["role"]}
            if content_parts:
                message["content"] = content_parts

            if tool_calls:
                message["tool_calls"] = tool_calls

            # This turn's own fidelity when it thought; otherwise the field the upstream has
            # produced, with `thinking` still "" — the empty value keeps the turn replayable.
            fields = thinking_fields if thinking else replay_fields
            if thinking or (tool_calls and replay_fields):
                # send thinking back through the exact field the upstream produced (recorded
                # in the item fidelity); servers may reject the spelling they did not emit
                if fields == {"reasoning_content"}:
                    message["reasoning_content"] = thinking
                elif fields == {"reasoning"}:
                    message["reasoning"] = thinking
                else:
                    message["reasoning_content"] = thinking  # vLLM & siliconflow compatibility
                    message["reasoning"] = thinking  # openrouter compatibility

            # message may be empty for tool results
            if len(message.keys()) > 1:
                openai_messages.append(message)

        return openai_messages

    def transform_model_output_to_client_parts(self, model_output: ChatCompletionChunk) -> list[ClientPart]:
        """
        Transform one OpenAI Chat Completions streaming chunk into client parts.

        Chat Completions gives an item no identity, so each delta is keyed by the wire field that
        carried it; _streaming_response_internal turns those into one key per item.

        Args:
            model_output: OpenAI streaming chunk

        Returns:
            The parts the chunk carries, none when it carries nothing universal
        """
        parts: list[ClientPart] = []

        # gateways inject content-free heartbeat chunks on long generations, whose choices
        # the SDK leaves as None rather than an empty list
        if model_output.choices:
            choice = model_output.choices[0]
            delta = choice.delta

            # the thinking field name differs by server: vLLM & siliconflow use reasoning_content
            # while openrouter uses reasoning; record the wire field that carried each delta
            # so a replay can reproduce exactly the field the upstream produced. The reasoning
            # goes before the content because a chunk may end the reasoning and begin the answer.
            reasoning_content = getattr(delta, "reasoning_content", None)
            reasoning = getattr(delta, "reasoning", None)
            if reasoning_content and reasoning:
                # ambiguous origin: record no fidelity so a replay sends both fields back
                parts.append(
                    {
                        "type": "delta",
                        "key": "reasoning_content",
                        "item": {"type": "thinking.delta", "thinking": reasoning_content},
                    }
                )
            elif reasoning_content:
                parts.append(
                    {
                        "type": "delta",
                        "key": "reasoning_content",
                        "item": {
                            "type": "thinking.delta",
                            "thinking": reasoning_content,
                            "fidelity": {"reasoning_field": "reasoning_content"},
                        },
                    }
                )
            elif reasoning:
                parts.append(
                    {
                        "type": "delta",
                        "key": "reasoning",
                        "item": {
                            "type": "thinking.delta",
                            "thinking": reasoning,
                            "fidelity": {"reasoning_field": "reasoning"},
                        },
                    }
                )

            if delta.content:
                parts.append(
                    {"type": "delta", "key": "content", "item": {"type": "text.delta", "text": delta.content}}
                )

            if delta.tool_calls:
                for tool_call in delta.tool_calls:
                    parts.append(
                        {
                            "type": "delta",
                            "key": "tool_calls",
                            "item": {
                                "type": "tool_call.delta",
                                "name": tool_call.function.name or "",
                                "arguments": tool_call.function.arguments or "",
                                "tool_call_id": tool_call.id or tool_call.function.name or "",
                            },
                        }
                    )

            if choice.finish_reason:
                finish_reason_mapping = {
                    "stop": "stop",
                    "length": "length",
                    "tool_calls": "tool_call",
                    "content_filter": "stop",
                }
                parts.append(
                    {"type": "finish", "finish_reason": finish_reason_mapping.get(choice.finish_reason, "unknown")}
                )

        if model_output.usage:
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

            usage_metadata: UsageMetadata = {
                "cached_tokens": cached_tokens,
                "prompt_tokens": prompt_tokens,
                "thoughts_tokens": reasoning_tokens,
                "response_tokens": response_tokens,
            }
            parts.append(
                {
                    "type": "finish",
                    "usage_metadata": fix_openrouter_usage_metadata(usage_metadata, str(self._client.base_url)),
                }
            )

        return parts

    async def _streaming_response_internal(
        self,
        messages: list[UniMessage],
        config: UniConfig,
    ) -> AsyncIterator[ClientPart]:
        """Stream generate using OpenAI Chat Completions-compatible API."""
        openai_config = self.transform_uni_config_to_model_config(config)

        openai_messages = await self.transform_uni_message_to_model_input(messages)

        if config.get("system_prompt"):
            openai_messages.insert(0, {"role": "system", "content": config["system_prompt"]})

        stream = await self._client.chat.completions.create(**openai_config, messages=openai_messages)

        # Chat Completions never signals that an item ended either: an item runs until a delta
        # arrives from another wire field or names the next tool call
        item_index = -1
        open_field = None
        async for chunk in stream:
            for part in self.transform_model_output_to_client_parts(chunk):
                if part["type"] != "delta":
                    yield part
                    continue

                if part["key"] != open_field or (part["item"]["type"] == "tool_call.delta" and part["item"]["name"]):
                    if open_field is not None:
                        yield {"type": "done", "key": str(item_index)}

                    item_index += 1
                    open_field = part["key"]

                yield {**part, "key": str(item_index)}

    async def list_models(self) -> list[str]:
        """
        List the model ids the configured endpoint serves.

        Returns:
            list[str]: The model ids, in the order the endpoint returned them.
        """
        return [model.id async for model in self._client.models.list()]
