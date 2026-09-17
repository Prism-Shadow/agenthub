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
from openai.types.chat import ChatCompletionChunk, ChatCompletionMessageParam

from ..base_client import LLMClient, done_marker
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
from ..utils import fix_openrouter_usage_metadata


class GLM5_3Client(LLMClient):
    """Unified client for the GLM series, named for the newest generation it serves (5.3).

    The wire format is shared across GLM-5.1 through 5.3; only the thinking parameter
    contract differs per generation, handled model-by-model below.
    """

    def __init__(
        self,
        model: str,
        api_key: str | None = None,
        base_url: str | None = None,
        default_headers: dict[str, str] | None = None,
    ):
        """Initialize GLM client with model and API key."""
        self._model = model
        api_key = api_key or os.getenv("ZAI_API_KEY")
        base_url = base_url or os.getenv("ZAI_BASE_URL") or "https://api.z.ai/api/paas/v4/"
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url, default_headers=default_headers)
        self._history: list[UniMessage] = []

    def _convert_thinking_level_to_config(self, thinking_level: ThinkingLevel) -> dict[str, str | bool]:
        """Convert ThinkingLevel enum to GLM's thinking configuration.

        GLM-5.3 uses forced thinking and errors on {"type": "disabled"}, so NONE stays
        enabled there and degrades through the lightest reasoning effort instead
        (llmsdk_docs/glm5_3/docs/thinking.md).
        """
        # Provider-hosted ids keep their own casing (e.g. SiliconFlow's zai-org/GLM-5.2),
        # so generation detection is case-insensitive.
        if thinking_level == ThinkingLevel.NONE and "glm-5.3" not in self._model.lower():
            return {"type": "disabled"}
        return {"type": "enabled", "clear_thinking": False}

    def _convert_thinking_level_to_reasoning_effort(self, thinking_level: ThinkingLevel) -> str | None:
        """Convert ThinkingLevel enum to the reasoning_effort the model accepts.

        GLM-5.3 accepts only low/high/max and errors on anything else, so the client
        clamps to the closest value; NONE rides on low because 5.3 cannot disable
        thinking. Every earlier generation takes the vocabulary unchanged: 5.2 maps it
        server-side (low/medium to high, xhigh to max), and 5.1 and below accept the
        parameter and ignore it (verified live 2026-09-03 on Z.AI, OpenRouter and
        SiliconFlow), so the level is forwarded there rather than dropped. Outside 5.3
        NONE disables thinking outright, which leaves no effort to send.
        """
        model = self._model.lower()  # provider-hosted ids keep their own casing
        if "glm-5.3" in model:
            mapping = {
                ThinkingLevel.NONE: "low",
                ThinkingLevel.LOW: "low",
                ThinkingLevel.MEDIUM: "high",
                ThinkingLevel.HIGH: "high",
                ThinkingLevel.XHIGH: "max",
                ThinkingLevel.MAX: "max",
            }
            return mapping.get(thinking_level)
        mapping = {
            ThinkingLevel.NONE: None,
            ThinkingLevel.LOW: "low",
            ThinkingLevel.MEDIUM: "medium",
            ThinkingLevel.HIGH: "high",
            ThinkingLevel.XHIGH: "xhigh",
            ThinkingLevel.MAX: "max",
        }
        return mapping.get(thinking_level)

    def _convert_tool_choice(self, tool_choice: ToolChoice) -> str:
        """Convert ToolChoice to OpenAI's tool_choice format."""
        if tool_choice == "auto":
            return "auto"
        else:
            raise UnsupportedParameterError(
                self.__class__.__name__, "tool_choice", "GLM only supports 'auto' for tool_choice."
            )

    def transform_uni_config_to_model_config(self, config: UniConfig) -> dict[str, Any]:
        """
        Transform universal configuration to GLM-specific configuration.

        Args:
            config: Universal configuration dict

        Returns:
            GLM configuration dictionary
        """
        glm_config = {"model": self._model, "stream": True, "extra_body": {"tool_stream": True}}

        if config.get("max_tokens") is not None:
            glm_config["max_tokens"] = config["max_tokens"]

        if config.get("temperature") is not None:
            glm_config["temperature"] = config["temperature"]

        # NOTE: glm-5 always provides thinking summary
        if config.get("thinking_level") is not None:
            thinking_config = self._convert_thinking_level_to_config(config["thinking_level"])
            # thinking is only effective when using the official API endpoint
            glm_config.setdefault("extra_body", {})["thinking"] = thinking_config
            reasoning_effort = self._convert_thinking_level_to_reasoning_effort(config["thinking_level"])
            if reasoning_effort is not None:
                glm_config["reasoning_effort"] = reasoning_effort

        if config.get("tools") is not None:
            glm_config["tools"] = [{"type": "function", "function": tool} for tool in config["tools"]]

        if config.get("tool_choice") is not None:
            glm_config["tool_choice"] = self._convert_tool_choice(config["tool_choice"])

        if config.get("fast_mode"):
            raise UnsupportedParameterError(self.__class__.__name__, "fast_mode", "GLM does not support fast mode.")

        if config.get("prompt_caching") is not None and config["prompt_caching"] != PromptCaching.ENABLE:
            raise UnsupportedParameterError(
                self.__class__.__name__, "prompt_caching", "prompt_caching must be ENABLE for GLM."
            )

        return glm_config

    def transform_uni_message_to_model_input(self, messages: list[UniMessage]) -> list[ChatCompletionMessageParam]:
        """
        Transform universal message format to OpenAI's message format.

        Args:
            messages: List of universal message dictionaries

        Returns:
            List of OpenAI message dictionaries
        """
        # glm-5.3-flash is the natively multimodal GLM and the only one that reads image
        # parts (https://docs.z.ai/guides/vlm/glm-5.3-flash); every other GLM answers a request
        # carrying one with an error, so the item is refused here rather than dropped.
        # Provider-hosted ids keep their own casing (e.g. z-ai/glm-5.3-flash), so the version
        # match is case-insensitive.
        supports_image = "glm-5.3-flash" in self._model.lower()
        openai_messages = []

        for msg in messages:
            content_parts = []  # may be empty for tool results
            tool_calls = []  # may be empty for no tool calls
            thinking = ""
            thinking_fields: set[str | None] = set()
            for item in msg["content_items"]:
                if item["type"] == "text.done":
                    content_parts.append({"type": "text", "text": item["text"]})
                elif item["type"] == "image_url.done":
                    if not supports_image:
                        raise ValueError(f"GLM {self._model} does not support image inputs.")

                    content_parts.append({"type": "image_url", "image_url": {"url": item["image_url"]}})
                elif item["type"] == "thinking.done":
                    thinking += item["thinking"]
                    thinking_fields.add((item.get("fidelity") or {}).get("reasoning_field"))
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
                        if not supports_image:
                            raise ValueError(f"GLM {self._model} does not support images in tool results.")

                        for image_url in item["images"]:
                            content_parts.append({"type": "image_url", "image_url": {"url": image_url}})

                    # the plain string is the only content shape the Chat Completion schema
                    # documents for a tool message
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
        Transform one GLM streaming chunk into a universal event.

        Chat Completions gives an item no identity, so each delta's item_id is the wire field that
        carried it; _streaming_response_internal turns those into one item id per item.

        Args:
            model_output: OpenAI streaming chunk

        Returns:
            Universal event dictionary
        """
        event_type: EventType = "delta"
        content_items: list[EventContentItem] = []
        usage_metadata: UsageMetadata | None = None
        finish_reason: FinishReason | None = None

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
                # ambiguous origin: record no reasoning_field so a replay sends both fields back
                content_items.append(
                    {
                        "type": "thinking.delta",
                        "thinking": reasoning_content,
                        "fidelity": {"item_id": "reasoning_content"},
                    }
                )
            elif reasoning_content:
                content_items.append(
                    {
                        "type": "thinking.delta",
                        "thinking": reasoning_content,
                        "fidelity": {"item_id": "reasoning_content", "reasoning_field": "reasoning_content"},
                    }
                )
            elif reasoning:
                content_items.append(
                    {
                        "type": "thinking.delta",
                        "thinking": reasoning,
                        "fidelity": {"item_id": "reasoning", "reasoning_field": "reasoning"},
                    }
                )

            if delta.content:
                content_items.append({"type": "text.delta", "text": delta.content, "fidelity": {"item_id": "content"}})

            if delta.tool_calls:
                for tool_call in delta.tool_calls:
                    content_items.append(
                        {
                            "type": "tool_call.delta",
                            "name": tool_call.function.name or "",
                            "arguments": tool_call.function.arguments or "",
                            "tool_call_id": tool_call.id or "",
                            "fidelity": {"item_id": "tool_calls"},
                        }
                    )

            if choice.finish_reason:
                event_type = "stop"
                finish_reason_mapping = {
                    "stop": "stop",
                    "length": "length",
                    "tool_calls": "tool_call",
                    "content_filter": "stop",
                }
                finish_reason = finish_reason_mapping.get(choice.finish_reason, "unknown")

        if model_output.usage:
            event_type = "stop"

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
        """Stream generate using GLM SDK with unified conversion methods."""
        # Use unified config conversion
        glm_config = self.transform_uni_config_to_model_config(config)

        # Use unified message conversion
        glm_messages = self.transform_uni_message_to_model_input(messages)

        # Extract system prompt if present
        if config.get("system_prompt"):
            glm_messages.insert(0, {"role": "system", "content": config["system_prompt"]})

        # Stream generate
        stream = await self._client.chat.completions.create(**glm_config, messages=glm_messages)

        # Chat Completions never signals that an item ended either: an item runs until a delta
        # arrives from another wire field or names the next tool call
        item_index = -1
        open_field = None
        async for chunk in stream:
            event = self.transform_model_output_to_uni_event(chunk)
            content_items: list[EventContentItem] = []
            for item in event["content_items"]:
                if item["fidelity"]["item_id"] != open_field or (item["type"] == "tool_call.delta" and item["name"]):
                    if open_field is not None:
                        content_items.append(done_marker(str(item_index)))

                    item_index += 1
                    open_field = item["fidelity"]["item_id"]

                item["fidelity"]["item_id"] = str(item_index)
                content_items.append(item)

            yield {**event, "content_items": content_items}

    async def list_models(self) -> list[str]:
        """
        List the model ids the configured endpoint serves.

        Returns:
            list[str]: The model ids, in the order the endpoint returned them.
        """
        return [model.id async for model in self._client.models.list()]
