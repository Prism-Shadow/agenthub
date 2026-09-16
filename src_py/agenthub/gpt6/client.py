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
from openai.types.responses import ResponseInputParam, ResponseStreamEvent

from ..base_client import ClientPart, LLMClient
from ..errors import UnsupportedParameterError
from ..types import (
    PromptCaching,
    ThinkingLevel,
    ToolChoice,
    UniConfig,
    UniMessage,
)
from ..utils import is_debug_enabled, openai_image_detail


class GPT6Client(LLMClient):
    """GPT-6-specific LLM client implementation (also serves GPT-5.6, GPT-5.5 and GPT-5.4)."""

    def __init__(
        self,
        model: str,
        api_key: str | None = None,
        base_url: str | None = None,
        default_headers: dict[str, str] | None = None,
    ):
        """Initialize GPT-6 client with model and API key."""
        self._model = model
        api_key = api_key or os.getenv("OPENAI_API_KEY")
        base_url = base_url or os.getenv("OPENAI_BASE_URL")
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url, default_headers=default_headers)
        self._history: list[UniMessage] = []

    def _convert_thinking_level_to_effort(self, thinking_level: ThinkingLevel) -> str:
        """Convert ThinkingLevel enum to OpenAI's reasoning effort."""
        if thinking_level == ThinkingLevel.NONE and "gpt-6" in self._model:
            # GPT-6 rejects both "none" and "minimal" with a 400 (verified live 2026-09-09:
            # "Unsupported value: 'none' is not supported with the 'gpt-6-astra' model.
            # Supported values are: 'low', 'medium', 'high', 'xhigh', and 'max'."), so NONE
            # degrades to the lowest effort the generation accepts.
            return "low"

        mapping = {
            ThinkingLevel.NONE: "none",
            ThinkingLevel.LOW: "low",
            ThinkingLevel.MEDIUM: "medium",
            ThinkingLevel.HIGH: "high",
            ThinkingLevel.XHIGH: "xhigh",
            ThinkingLevel.MAX: "max",
        }
        return mapping.get(thinking_level)

    def _convert_tool_choice(self, tool_choice: ToolChoice) -> str | dict[str, Any]:
        """Convert ToolChoice to OpenAI's tool_choice format with allowed tools support."""
        if isinstance(tool_choice, list):
            return {"mode": "required", "tools": [{"type": "function", "name": name} for name in tool_choice]}
        return tool_choice

    def _convert_image_url(self, image_url: str) -> dict[str, str]:
        """Convert an image URL to an input_image item, at the detail the API needs to read it."""
        item = {"type": "input_image", "image_url": image_url}
        if detail := openai_image_detail(self._model, image_url):
            item["detail"] = detail

        return item

    def transform_uni_config_to_model_config(self, config: UniConfig) -> dict[str, Any]:
        """
        Transform universal configuration to OpenAI Responses API configuration.

        Args:
            config: Universal configuration dict

        Returns:
            OpenAI Responses API configuration dictionary
        """
        # Set store to False to avoid validation error
        # https://community.openai.com/t/one-potential-cause-of-item-rs-xx-of-type-reasoning-was-provided-without-its-required-following-item-error-stateless-using-agents-sdk/1370540
        openai_config = {"model": self._model, "store": False, "include": ["reasoning.encrypted_content"]}

        if config.get("system_prompt") is not None:
            openai_config["instructions"] = config["system_prompt"]

        if config.get("max_tokens") is not None:
            openai_config["max_output_tokens"] = config["max_tokens"]

        if config.get("temperature") is not None and config["temperature"] != 1.0:
            raise UnsupportedParameterError(
                self.__class__.__name__, "temperature", "GPT-6 does not support setting temperature."
            )

        if config.get("thinking_level") is not None:
            openai_config["reasoning"] = {"effort": self._convert_thinking_level_to_effort(config["thinking_level"])}

        if config.get("thinking_summary"):
            # reasoning.summary stands on its own, with or without an effort (verified live
            # 2026-09-03 on the OpenAI and OpenRouter endpoints). False needs no key: the
            # Responses API returns no summary unless one is asked for.
            openai_config.setdefault("reasoning", {})["summary"] = "concise"

        if config.get("tools") is not None:
            openai_config["tools"] = [{"type": "function", **tool} for tool in config["tools"]]

        if config.get("tool_choice") is not None:
            openai_config["tool_choice"] = self._convert_tool_choice(config["tool_choice"])

        if config.get("fast_mode"):
            openai_config["service_tier"] = "priority"

        if config.get("prompt_caching") is not None and config["prompt_caching"] != PromptCaching.ENABLE:
            raise UnsupportedParameterError(
                self.__class__.__name__, "prompt_caching", "prompt_caching must be ENABLE for GPT-6."
            )

        return openai_config

    def transform_uni_message_to_model_input(self, messages: list[UniMessage]) -> ResponseInputParam:
        """
        Transform universal message format to OpenAI Responses API input format.

        Args:
            messages: List of universal message dictionaries

        Returns:
            List of input items for OpenAI Responses API
        """
        input_list: list[ResponseInputParam] = []

        for msg in messages:
            content_items: list = []
            last_phase: str | None = None

            for item in msg["content_items"]:
                # anything that is not message content becomes an input item of its own, so the
                # text collected so far is flushed first to keep the order the model produced
                if item["type"] not in ("text.done", "image_url.done") and content_items:
                    # Every turn goes back as a typed message item — the Responses API's EasyInputMessage
                    # shape, where type "message" is valid for any role. A vLLM-style Responses server
                    # answers a bare {"role": "assistant", "content": [...]} item with a 400 on the turn that
                    # replays it and takes the typed form for every role; OpenAI, DeepSeek and MiniMax accept
                    # either shape. Nothing beyond that minimal shape goes out: an id or a status the server
                    # never sent would be an invention.
                    entry = {"type": "message", "role": msg["role"], "content": content_items}
                    if last_phase is not None:
                        entry["phase"] = last_phase
                    input_list.append(entry)
                    content_items = []

                if item["type"] == "text.done":
                    phase = (item.get("fidelity") or {}).get("phase")
                    if msg["role"] == "assistant" and phase:  # split different phases
                        if last_phase is not None and last_phase != phase and content_items:
                            input_list.append(
                                {"type": "message", "role": msg["role"], "content": content_items, "phase": last_phase}
                            )
                            content_items = []

                        last_phase = phase

                    if msg["role"] == "user":
                        content_items.append({"type": "input_text", "text": item["text"]})
                    else:
                        content_items.append({"type": "output_text", "text": item["text"]})
                elif item["type"] == "image_url.done":
                    content_items.append(self._convert_image_url(item["image_url"]))
                elif item["type"] == "thinking.done":
                    # rebuild the reasoning item from the recorded wire fields: the thinking
                    # text goes back through the channel that carried it (histories recorded
                    # by the pre-channel client carry encrypted_content and stream summaries)
                    fidelity = item.get("fidelity") or {}
                    reasoning = {"type": "reasoning", "summary": []}
                    summary_channel = fidelity.get("channel") == "summary" or (
                        "channel" not in fidelity and fidelity.get("encrypted_content") is not None
                    )
                    if summary_channel:
                        if item["thinking"]:
                            reasoning["summary"] = [{"type": "summary_text", "text": item["thinking"]}]
                    elif item["thinking"]:
                        reasoning["content"] = [{"type": "reasoning_text", "text": item["thinking"]}]

                    for key in ("encrypted_content", "signature", "format"):
                        if fidelity.get(key) is not None:
                            reasoning[key] = fidelity[key]

                    input_list.append(reasoning)
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

                    # NOTE: tool results are input items
                    image_parts = []
                    if "images" in item:
                        for image_url in item["images"]:
                            image_parts.append(self._convert_image_url(image_url))

                    # a plain string is the form the Responses API documents for a text result and the
                    # one every endpoint that fronts this model accepts; the content-part list is
                    # reserved for results carrying images
                    output = (
                        [{"type": "input_text", "text": item["text"]}, *image_parts] if image_parts else item["text"]
                    )

                    input_list.append(
                        {"type": "function_call_output", "call_id": item["tool_call_id"], "output": output}
                    )
                else:
                    raise ValueError(f"Unknown item: {item}")

            if content_items:
                entry = {"type": "message", "role": msg["role"], "content": content_items}
                if last_phase is not None:
                    entry["phase"] = last_phase
                input_list.append(entry)

        return input_list

    def transform_model_output_to_client_parts(self, model_output: ResponseStreamEvent) -> list[ClientPart]:
        """
        Transform one OpenAI Responses API streaming event into client parts, keyed by output item id.

        Args:
            model_output: OpenAI Responses API streaming event

        Returns:
            The parts the event carries, none when it carries nothing universal
        """
        openai_event_type = model_output.type
        if openai_event_type == "response.output_text.delta":
            return [
                {
                    "type": "delta",
                    "key": getattr(model_output, "item_id", None),
                    "item": {"type": "text.delta", "text": model_output.delta},
                }
            ]

        elif openai_event_type in ("response.reasoning_summary_text.delta", "response.reasoning_text.delta"):
            return [
                {
                    "type": "delta",
                    "key": getattr(model_output, "item_id", None),
                    "item": {"type": "thinking.delta", "thinking": model_output.delta},
                }
            ]

        elif openai_event_type == "response.output_item.added":
            # every item is announced with a delta, empty unless it carries the call or the phase,
            # so a fragment a server sends without its item id belongs to the item announced last
            item = model_output.item
            if item.type == "function_call":
                return [
                    {
                        "type": "delta",
                        # a server that sends no item id still sends the call id
                        "key": item.id or item.call_id,
                        "item": {
                            "type": "tool_call.delta",
                            "name": item.name,
                            "arguments": "",
                            "tool_call_id": item.call_id,
                        },
                    }
                ]
            elif item.type == "message":
                phase = getattr(item, "phase", None)
                return [
                    {
                        "type": "delta",
                        "key": getattr(item, "id", None),
                        "item": {"type": "text.delta", "text": "", "fidelity": {"phase": phase}}
                        if phase is not None
                        else {"type": "text.delta", "text": ""},
                    }
                ]
            elif item.type == "reasoning":
                return [
                    {
                        "type": "delta",
                        "key": getattr(item, "id", None),
                        "item": {"type": "thinking.delta", "thinking": ""},
                    }
                ]

            return []

        elif openai_event_type == "response.output_item.done":
            item = model_output.item
            if item.type == "reasoning":
                # the completed item carries the canonical wire fields to send back on the
                # next turn (identical to the response.completed copy, but adjacent to the
                # thinking deltas so the fidelity lands on the item that carried the text);
                # record the channel plus the fields the server demands back. This event is the
                # only source of encrypted_content, because the streaming-events reference says
                # of response.output_item.added: "For reasoning items, encrypted_content may be
                # incomplete while the item is in progress. Use the reasoning item from the
                # corresponding response.output_item.done event when passing it as input to a
                # subsequent request."
                fidelity = {}
                if getattr(item, "summary", None):
                    fidelity["channel"] = "summary"
                elif getattr(item, "content", None):
                    fidelity["channel"] = "content"
                for key in ("encrypted_content", "signature", "format"):
                    if getattr(item, key, None) is not None:
                        fidelity[key] = getattr(item, key)

                return [
                    {
                        "type": "delta",
                        "key": getattr(item, "id", None),
                        "item": {"type": "thinking.delta", "thinking": "", "fidelity": fidelity},
                    },
                    {"type": "done", "key": getattr(item, "id", None)},
                ]
            elif item.type == "function_call":
                return [{"type": "done", "key": item.id or item.call_id}]
            elif item.type == "message":
                return [{"type": "done", "key": getattr(item, "id", None)}]

            return []

        elif openai_event_type == "response.function_call_arguments.delta":
            return [
                {
                    "type": "delta",
                    "key": getattr(model_output, "item_id", None),
                    "item": {
                        "type": "tool_call.delta",
                        "name": "",
                        "arguments": model_output.delta,
                        "tool_call_id": "",
                    },
                }
            ]

        elif openai_event_type == "response.function_call_arguments.done":
            # the call's output_item.done completes it instead: its item still names the call where
            # a server leaves the item id off this event, and a call whose output_item.done never
            # arrives is completed when the stream ends
            return []

        elif openai_event_type in ("response.completed", "response.incomplete"):
            finish_reason_mapping = {
                "completed": "stop",
                "incomplete": "length",
            }
            input_tokens = model_output.response.usage.input_tokens
            output_tokens = model_output.response.usage.output_tokens

            cached_tokens = model_output.response.usage.input_tokens_details.cached_tokens
            reasoning_tokens = model_output.response.usage.output_tokens_details.reasoning_tokens

            return [
                {
                    "type": "finish",
                    "usage_metadata": {
                        "cached_tokens": cached_tokens,
                        "prompt_tokens": input_tokens - cached_tokens,
                        "thoughts_tokens": reasoning_tokens,
                        "response_tokens": output_tokens - reasoning_tokens,
                    },
                    "finish_reason": finish_reason_mapping.get(model_output.response.status, "unknown"),
                }
            ]

        elif openai_event_type in [
            "response.created",
            "response.in_progress",
            "response.output_text.done",
            "response.reasoning_summary_part.added",
            "response.reasoning_summary_part.done",
            "response.reasoning_summary_text.done",
            "response.reasoning_text.done",
            "response.content_part.added",
            "response.content_part.done",
            "keepalive",  # gateway heartbeat on long generations; carries no content
        ]:
            return []

        elif is_debug_enabled():
            raise ValueError(f"Unknown output: {model_output}")

        else:
            # a gateway injects its own events (heartbeats, cost tickers) into the stream, and
            # killing a long generation over one costs more than dropping it
            return []

    async def _streaming_response_internal(
        self,
        messages: list[UniMessage],
        config: UniConfig,
    ) -> AsyncIterator[ClientPart]:
        """Stream generate using OpenAI Responses API with unified conversion methods."""
        # Use unified config conversion
        openai_config = self.transform_uni_config_to_model_config(config)

        # Use unified message conversion
        input_list = self.transform_uni_message_to_model_input(messages)

        # A server may leave the item ids out. A part without one belongs to the item announced or
        # streamed last while that item is open and of the same kind, and starts an item of its own
        # otherwise; an argument fragment whose id names no announced call counts as one without.
        announced_calls: set[str] = set()
        last_key = ""
        last_type = ""
        unkeyed_items = 0

        # Stream generate
        stream = await self._client.responses.create(**openai_config, input=input_list, stream=True)
        async for model_event in stream:
            for part in self.transform_model_output_to_client_parts(model_event):
                if part["type"] == "delta":
                    item = part["item"]
                    if item["type"] == "tool_call.delta" and item["tool_call_id"]:
                        announced_calls.add(part["key"])
                    elif not part["key"] or (item["type"] == "tool_call.delta" and part["key"] not in announced_calls):
                        if last_type == item["type"]:
                            part["key"] = last_key
                        else:
                            part["key"] = f"unkeyed-{unkeyed_items}"
                            unkeyed_items += 1
                    last_key = part["key"]
                    last_type = item["type"]
                elif part["type"] == "done":
                    if not part["key"] and not last_key:
                        continue
                    part["key"] = part["key"] or last_key
                    if part["key"] == last_key:
                        last_key = ""
                        last_type = ""
                yield part

    async def list_models(self) -> list[str]:
        """
        List the model ids the configured endpoint serves.

        Returns:
            list[str]: The model ids, in the order the endpoint returned them.
        """
        return [model.id async for model in self._client.models.list()]
