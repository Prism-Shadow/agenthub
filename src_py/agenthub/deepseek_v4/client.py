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
import re
from typing import Any, AsyncIterator

from openai import AsyncOpenAI
from openai.types.responses import ResponseInputParam, ResponseStreamEvent

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
from ..utils import is_debug_enabled


# The DeepSeek ids that read no image: the current V4 Flash and V4 Pro, bare or with a dated
# snapshot suffix (deepseek-v4-flash-0731). Every other id forwards its images. Matched against
# the bare id — the part after the last "/", lowercased — so a gateway prefix (deepseek/,
# deepseek-ai/) and the spelling a platform uses do not change the verdict.
_TEXT_ONLY_MODELS = re.compile(r"deepseek-v4-(flash|pro)(-\d{4})?")


def _reasoning_item(text: str) -> dict[str, Any]:
    """A `reasoning` input item carrying `text`.

    The item must carry SOME text: the Responses API refuses an empty `reasoning_text` exactly
    as it refuses a tool-calling turn with no reasoning item at all (verified live 2026-09-11),
    so a turn with nothing to replay gets the least this layer can invent.
    """
    return {"type": "reasoning", "summary": [], "content": [{"type": "reasoning_text", "text": text or " "}]}


class DeepSeekV4Client(LLMClient):
    """DeepSeek V4-specific LLM client implementation using the OpenAI-compatible Responses API."""

    def __init__(
        self,
        model: str,
        api_key: str | None = None,
        base_url: str | None = None,
        default_headers: dict[str, str] | None = None,
    ):
        """Initialize DeepSeek client with model, API key, and base URL."""
        self._model = model
        api_key = api_key or os.getenv("DEEPSEEK_API_KEY")
        base_url = base_url or os.getenv("DEEPSEEK_BASE_URL") or "https://api.deepseek.com"
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url, default_headers=default_headers)
        self._history: list[UniMessage] = []

    def _convert_thinking_level_to_effort(self, thinking_level: ThinkingLevel) -> str:
        """Convert ThinkingLevel enum to DeepSeek's reasoning effort.

        DeepSeek accepts low/high/max and maps medium and xhigh onto high server-side
        (llmsdk_docs/deepseek_v4/docs/thinking-mode.md), so this sends the value the
        server would settle on anyway. Effort "none" is what turns thinking off on this
        endpoint: the Chat Completions `thinking` toggle is ignored here (verified live
        2026-08-21).
        """
        mapping = {
            ThinkingLevel.NONE: "none",
            ThinkingLevel.LOW: "low",
            ThinkingLevel.MEDIUM: "high",
            ThinkingLevel.HIGH: "high",
            ThinkingLevel.XHIGH: "high",
            ThinkingLevel.MAX: "max",
        }
        return mapping[thinking_level]

    def _convert_tool_choice(self, tool_choice: ToolChoice) -> str:
        """Convert ToolChoice to DeepSeek's Responses-compatible tool_choice format."""
        if tool_choice in ["auto", "none"]:
            return tool_choice
        raise UnsupportedParameterError(
            self.__class__.__name__, "tool_choice", "DeepSeek V4 only supports 'auto' and 'none' for tool_choice."
        )

    def transform_uni_config_to_model_config(self, config: UniConfig) -> dict[str, Any]:
        """
        Transform universal configuration to DeepSeek-specific configuration.

        Args:
            config: Universal configuration dict

        Returns:
            DeepSeek configuration dictionary
        """
        deepseek_config = {"model": self._model, "store": False}

        if config.get("system_prompt") is not None:
            deepseek_config["instructions"] = config["system_prompt"]

        if config.get("max_tokens") is not None:
            deepseek_config["max_output_tokens"] = config["max_tokens"]

        if config.get("temperature") is not None and config["temperature"] != 1.0:
            raise UnsupportedParameterError(
                self.__class__.__name__, "temperature", "DeepSeek V4 does not support setting temperature."
            )

        if config.get("thinking_level") is not None:
            deepseek_config["reasoning"] = {"effort": self._convert_thinking_level_to_effort(config["thinking_level"])}

        if config.get("thinking_summary"):
            # DeepSeek takes reasoning.summary with or without an effort and returns an empty
            # summary list for now (verified live 2026-09-03 on api.deepseek.com and
            # OpenRouter), so the request carries the preference instead of dropping it and
            # picks up summaries as soon as the vendor generates them. False needs no key:
            # the Responses API returns no summary unless one is asked for.
            deepseek_config.setdefault("reasoning", {})["summary"] = "concise"

        if config.get("tools") is not None:
            deepseek_config["tools"] = [{"type": "function", **tool} for tool in config["tools"]]

        if config.get("tool_choice") is not None:
            deepseek_config["tool_choice"] = self._convert_tool_choice(config["tool_choice"])

        if config.get("fast_mode"):
            raise UnsupportedParameterError(
                self.__class__.__name__, "fast_mode", "DeepSeek V4 does not support fast mode."
            )

        if config.get("prompt_caching") is not None and config["prompt_caching"] != PromptCaching.ENABLE:
            raise UnsupportedParameterError(
                self.__class__.__name__, "prompt_caching", "prompt_caching must be ENABLE for DeepSeek."
            )

        return deepseek_config

    def transform_uni_message_to_model_input(self, messages: list[UniMessage]) -> ResponseInputParam:
        """
        Transform universal message format to DeepSeek's Responses-compatible input format.

        Args:
            messages: List of universal message dictionaries

        Returns:
            List of input items for the Responses API
        """
        # a text-only model answers from a placeholder instead of failing
        # (llmsdk_docs/deepseek_v4/docs/responses-api.md), so an image is refused here rather
        # than silently dropped
        supports_image = not _TEXT_ONLY_MODELS.fullmatch(self._model.lower().rsplit("/", 1)[-1])
        input_list: list[ResponseInputParam] = []

        for msg in messages:
            content_items: list = []
            # Whether this turn has already put its chain of thought on the wire (see the
            # placeholder pushed with the first function call below).
            carried_reasoning = False

            for item in msg["content_items"]:
                # anything that is not message content becomes an input item of its own, so the
                # text collected so far is flushed first to keep the original order: DeepSeek
                # merges a function call into the adjacent assistant message and answers a call
                # whose output does not follow it with "No tool output found for tool call"
                # (verified live 2026-08-21)
                if item["type"] not in ("text", "image_url") and content_items:
                    input_list.append({"role": msg["role"], "content": content_items})
                    content_items = []

                if item["type"] == "text":
                    if msg["role"] == "user":
                        content_items.append({"type": "input_text", "text": item["text"]})
                    else:
                        content_items.append({"type": "output_text", "text": item["text"]})
                elif item["type"] == "image_url":
                    if not supports_image:
                        raise ValueError(f"DeepSeek {self._model} does not support image inputs.")

                    content_items.append({"type": "input_image", "image_url": item["image_url"]})
                elif item["type"] == "thinking":
                    # DeepSeek carries the chain of thought as plain reasoning_text and ignores the
                    # summary and encrypted_content channels, so the item is rebuilt from the text
                    input_list.append(_reasoning_item(item["thinking"]))
                    carried_reasoning = True
                elif item["type"] == "tool_call":
                    if not carried_reasoning:
                        # A tool-calling turn the model thought nothing on — DeepSeek stops
                        # thinking part-way through a long tool chain. Replaying that turn
                        # without its chain of thought is rejected with "the reasoning_text in
                        # the thinking mode must be passed back to the API"; DeepSeek waives that
                        # only for call_ids it recognises as its own, which it cannot once a
                        # relay has reissued them.
                        input_list.append(_reasoning_item(""))
                        carried_reasoning = True

                    input_list.append(
                        {
                            "type": "function_call",
                            "call_id": item["tool_call_id"],
                            "name": item["name"],
                            "arguments": json.dumps(item["arguments"], ensure_ascii=False),
                        }
                    )
                elif item["type"] == "tool_result":
                    if "tool_call_id" not in item:
                        raise ValueError("tool_call_id is required for tool result.")

                    # NOTE: tool results are input items
                    tool_result = [{"type": "input_text", "text": item["text"]}]
                    if "images" in item:
                        if not supports_image:
                            raise ValueError(f"DeepSeek {self._model} does not support images in tool results.")

                        for image_url in item["images"]:
                            tool_result.append({"type": "input_image", "image_url": image_url})

                    input_list.append(
                        {"type": "function_call_output", "call_id": item["tool_call_id"], "output": tool_result}
                    )
                else:
                    raise ValueError(f"Unknown item: {item}")

            if content_items:
                input_list.append({"role": msg["role"], "content": content_items})

        return input_list

    def transform_model_output_to_uni_event(self, model_output: ResponseStreamEvent) -> UniEvent:
        """
        Transform DeepSeek streaming event to universal event format.

        Args:
            model_output: Responses API streaming event

        Returns:
            Universal event dictionary
        """
        event_type: EventType | None = None
        content_items: list[PartialContentItem] = []
        usage_metadata: UsageMetadata | None = None
        finish_reason: FinishReason | None = None

        deepseek_event_type = model_output.type
        if deepseek_event_type == "response.output_text.delta":
            event_type = "delta"
            content_items.append({"type": "text", "text": model_output.delta})

        elif deepseek_event_type == "response.reasoning_text.delta":
            event_type = "delta"
            content_items.append({"type": "thinking", "thinking": model_output.delta})

        elif deepseek_event_type == "response.output_item.added":
            if model_output.item.type == "function_call":
                event_type = "start"
                content_items.append(
                    {
                        "type": "partial_tool_call",
                        "name": model_output.item.name,
                        "arguments": "",
                        "tool_call_id": model_output.item.call_id,
                    }
                )
            else:
                event_type = "unused"

        elif deepseek_event_type == "response.function_call_arguments.delta":
            event_type = "delta"
            content_items.append(
                {"type": "partial_tool_call", "name": "", "arguments": model_output.delta, "tool_call_id": ""}
            )

        elif deepseek_event_type == "response.function_call_arguments.done":
            event_type = "stop"

        elif deepseek_event_type in ("response.completed", "response.incomplete"):
            event_type = "stop"
            finish_reason_mapping = {
                "completed": "stop",
                "incomplete": "length",
            }
            finish_reason = finish_reason_mapping.get(model_output.response.status, "unknown")

            if model_output.response.usage:
                input_details = model_output.response.usage.input_tokens_details
                output_details = model_output.response.usage.output_tokens_details
                cached_tokens = input_details.cached_tokens if input_details else 0
                reasoning_tokens = output_details.reasoning_tokens if output_details else 0
                usage_metadata = {
                    "cached_tokens": cached_tokens,
                    "prompt_tokens": model_output.response.usage.input_tokens - cached_tokens,
                    "thoughts_tokens": reasoning_tokens,
                    "response_tokens": model_output.response.usage.output_tokens - reasoning_tokens,
                }

        elif deepseek_event_type in (
            "response.created",
            "response.in_progress",
            "response.output_item.done",
            "response.output_text.done",
            "response.reasoning_text.done",
            "response.content_part.added",
            "response.content_part.done",
            "keepalive",  # gateway heartbeat on long generations; carries no content
        ):
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
        """Stream generate using DeepSeek's OpenAI-compatible Responses API."""
        # Use unified config conversion
        deepseek_config = self.transform_uni_config_to_model_config(config)

        # Use unified message conversion
        input_list = self.transform_uni_message_to_model_input(messages)

        # Stream generate
        partial_tool_call = {}
        stream = await self._client.responses.create(**deepseek_config, input=input_list, stream=True)
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
                        yield event
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

                if event["finish_reason"] or event["usage_metadata"]:
                    yield event

    async def list_models(self) -> list[str]:
        """
        List the model ids the configured endpoint serves.

        Returns:
            list[str]: The model ids, in the order the endpoint returned them.
        """
        return [model.id async for model in self._client.models.list()]
