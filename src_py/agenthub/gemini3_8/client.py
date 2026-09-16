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
import re
from typing import Any, AsyncIterator

import httpx
from google import genai
from google.genai import interactions, types
from google.oauth2 import service_account

from ..base_client import ClientPart, LLMClient
from ..errors import UnsupportedParameterError
from ..types import DeltaContentItem, FinishReason, PromptCaching, ThinkingLevel, ToolChoice, UniConfig, UniMessage
from ..utils import is_debug_enabled


class Gemini3_8Client(LLMClient):
    """Unified client for the Gemini family, named for the newest generation it serves (3.8).

    It speaks the Interactions API statelessly (store=false, the whole history in every request) for
    3.8 back through the 3.x text, image, and TTS models, and embeds through embedContent, because the
    Interactions API does not serve the embedding models. The API deprecated the temperature/top_p/top_k
    sampling parameters starting with the 3.6 generation (silently ignored today, HTTP 400 in future
    generations), and this client applies that contract to the whole family: temperature is rejected
    everywhere.
    """

    def __init__(
        self,
        model: str,
        api_key: str | None = None,
        base_url: str | None = None,
        default_headers: dict[str, str] | None = None,
    ):
        """Initialize Gemini 3.8 client with model and API key."""
        self._model = model
        api_key = api_key or os.getenv("GEMINI_API_KEY")
        base_url = base_url or os.getenv("GEMINI_BASE_URL")
        # the Gemini SDK carries connection headers inside http_options rather than its own argument
        http_options: dict[str, Any] = {}
        if base_url:
            http_options["base_url"] = base_url
        if default_headers:
            http_options["headers"] = default_headers
        if api_key and api_key.startswith("{"):
            service_account_info = json.loads(api_key)
            credentials = service_account.Credentials.from_service_account_info(
                service_account_info, scopes=["https://www.googleapis.com/auth/cloud-platform"]
            )
            self._client = genai.Client(
                vertexai=True,
                credentials=credentials,
                project=service_account_info["project_id"],
                location="global",
                http_options=http_options or None,
            )
        else:
            self._client = genai.Client(api_key=api_key, http_options=http_options or None)

        self._history: list[UniMessage] = []

    def _detect_image_mime_type(self, url: str) -> str:
        """Detect MIME type from URL extension for image."""
        mime_type, _ = mimetypes.guess_type(url)
        return mime_type or "image/jpeg"

    async def _get_image_bytes_and_mime_type(self, url: str) -> dict[str, bytes | str]:
        """Get image bytes and MIME type from URL."""
        if url.startswith("data:"):
            match = re.match(r"data:([^;]+);base64,(.+)", url)
            if match:
                mime_type = match.group(1)
                base64_string = match.group(2)
                image_bytes = base64.b64decode(base64_string)
            else:
                raise ValueError(f"Invalid base64 image: {url}")
        else:
            async with httpx.AsyncClient() as client:
                response = await client.get(url)
                response.raise_for_status()
                image_bytes = response.content
                mime_type = self._detect_image_mime_type(url)

        return {"data": image_bytes, "mime_type": mime_type}

    # Gemini thinking levels from weakest to strongest, used to pick the
    # closest supported level when a model rejects the requested one.
    _GEMINI_LEVEL_ORDER = ("minimal", "low", "medium", "high")

    def _supported_thinking_levels(self) -> tuple[str, ...]:
        """Thinking levels the target model accepts (llmsdk_docs/gemini_interactions/docs/thinking.md).

        An empty tuple means the model rejects the thinking_level parameter
        entirely, so it must be omitted from the request.
        """
        if "-image" in self._model:
            return ("minimal", "high")
        if "gemini-3-pro" in self._model:
            # The only pro generation without "medium".
            return ("low", "high")
        if "-pro" in self._model:
            # Every pro generation rejects "minimal"; matching broadly keeps
            # future pro models on the safe side (clamping a level the model
            # would have accepted costs a little accuracy, forwarding an
            # unsupported one is a 400).
            return ("low", "medium", "high")
        if "gemini-3.7" in self._model or "gemini-3.8" in self._model:
            # Both generations reject "minimal" with a 400 (3.7 verified live 2026-08-13,
            # 3.7 and 3.8 again through the Interactions API 2026-09-16).
            return ("low", "medium", "high")
        return self._GEMINI_LEVEL_ORDER

    def _convert_thinking_level(self, thinking_level: ThinkingLevel | None) -> str | None:
        """Convert ThinkingLevel enum to the closest Gemini thinking level the model supports."""
        mapping = {
            ThinkingLevel.NONE: "minimal",
            ThinkingLevel.LOW: "low",
            ThinkingLevel.MEDIUM: "medium",
            ThinkingLevel.HIGH: "high",
            ThinkingLevel.XHIGH: "high",
            # Gemini stops at "high", so both top levels land there before per-model clamping
            ThinkingLevel.MAX: "high",
        }
        level = mapping.get(thinking_level)
        if level is None:
            return None
        supported = self._supported_thinking_levels()
        if not supported:
            # A model that takes no thinking_level at all has nothing to clamp onto, so the
            # parameter is omitted rather than turned into a failed request. thinking_summary
            # is unaffected -- thinking_summaries still rides along.
            return None
        if level in supported:
            return level
        # Degrade silently to the nearest supported level; ties round up,
        # e.g. MEDIUM becomes HIGH on gemini-3-pro and NONE maps to LOW on
        # gemini-3.7-flash.
        index = self._GEMINI_LEVEL_ORDER.index(level)
        return min(
            supported,
            key=lambda candidate: (
                abs(self._GEMINI_LEVEL_ORDER.index(candidate) - index),
                -self._GEMINI_LEVEL_ORDER.index(candidate),
            ),
        )

    def _convert_tool_choice(self, tool_choice: ToolChoice) -> str | dict[str, Any] | None:
        """Convert ToolChoice to the Interactions API tool_choice."""
        if isinstance(tool_choice, list):
            # allowed_tools takes only the "any" and "validated" modes (verified live 2026-09-16)
            return {"allowed_tools": {"mode": "any", "tools": tool_choice}}
        elif tool_choice == "none":
            return "none"
        elif tool_choice == "auto":
            return "auto"
        elif tool_choice == "required":
            return "any"

    def transform_uni_config_to_model_config(self, config: UniConfig) -> dict[str, Any]:
        """
        Transform universal configuration to an Interactions API request without its input.

        Args:
            config: Universal configuration dict

        Returns:
            The keyword arguments of interactions.create, except input
        """
        if config.get("temperature") is not None:
            raise UnsupportedParameterError(
                self.__class__.__name__,
                "temperature",
                "Gemini models do not support setting temperature; the API deprecated "
                "sampling parameters starting with the 3.6 generation.",
            )

        if config.get("prompt_caching") is not None and config["prompt_caching"] != PromptCaching.ENABLE:
            raise UnsupportedParameterError(
                self.__class__.__name__, "prompt_caching", "prompt_caching must be ENABLE for Gemini."
            )

        # the history travels in every request, so nothing needs to be stored server-side
        gemini_config: dict[str, Any] = {"model": self._model, "stream": True, "store": False}
        generation_config: dict[str, Any] = {}

        if config.get("max_tokens") is not None:
            generation_config["max_output_tokens"] = config["max_tokens"]

        if config.get("fast_mode"):
            gemini_config["service_tier"] = "priority"

        # A TTS model takes the speech settings and nothing else: a system instruction, a
        # thinking config, or a tool declaration each comes back as a 400 (verified live
        # 2026-08-20, again through the Interactions API 2026-09-16), so the rest of the
        # universal config never reaches the request.
        if "tts" in self._model.lower():
            tts_config = config.get("tts_config") or [{"voice": "Kore"}]
            if len(tts_config) not in (1, 2):
                raise ValueError("tts_config must contain 1 or 2 entries.")

            gemini_config["response_format"] = {"type": "audio"}
            if len(tts_config) == 1:
                generation_config["speech_config"] = [{"voice": tts_config[0]["voice"]}]
            else:
                speech_config = []
                for speaker_config in tts_config:
                    speaker = speaker_config.get("speaker")
                    if not speaker:
                        raise ValueError("speaker is required when tts_config has 2 entries.")

                    speech_config.append({"speaker": speaker, "voice": speaker_config["voice"]})

                generation_config["speech_config"] = speech_config

            gemini_config["generation_config"] = generation_config
            return gemini_config

        if config.get("system_prompt") is not None:
            gemini_config["system_instruction"] = config["system_prompt"]

        thinking_level = self._convert_thinking_level(config.get("thinking_level"))
        if thinking_level is not None:
            generation_config["thinking_level"] = thinking_level

        if config.get("thinking_summary") is not None:
            generation_config["thinking_summaries"] = "auto" if config["thinking_summary"] else "none"

        if config.get("tools") is not None:
            gemini_config["tools"] = [{"type": "function", **tool} for tool in config["tools"]]
            if config.get("tool_choice") is not None:
                generation_config["tool_choice"] = self._convert_tool_choice(config["tool_choice"])

        if config.get("image_config") is not None:
            # an image entry alone suppresses the text the model writes beside its images
            gemini_config["response_format"] = [{"type": "text"}, {"type": "image", **config["image_config"]}]

        if generation_config:
            gemini_config["generation_config"] = generation_config

        return gemini_config

    async def transform_uni_message_to_model_input(self, messages: list[UniMessage]) -> list[interactions.StepParam]:
        """
        Transform universal message format to Interactions API input steps.

        Args:
            messages: List of universal message dictionaries

        Returns:
            List of Interactions API steps
        """
        steps: list[interactions.StepParam] = []
        # A function_result must name its function (HTTP 400 without it), but a universal
        # tool_result carries only the call id, so remember each call's name.
        call_names: dict[str, str] = {}
        for msg in messages:
            message_start = len(steps)
            # consecutive text and media of a message share one user_input or model_output step
            content: list[interactions.ContentParam] | None = None
            # consecutive thinking items share one thought step, which ends at the item carrying
            # the signature: a stream closes every thought step with its signature
            thought: interactions.ThoughtStepParam | None = None

            for item in msg["content_items"]:
                signature = (item.get("fidelity") or {}).get("signature")
                # the generateContent SDK recorded signatures as bytes, on thinking items as on the rest
                if isinstance(signature, bytes):
                    signature = base64.b64encode(signature).decode()

                if item["type"] in ("thinking.done", "inline_thinking.done"):
                    content = None
                    summary = []
                    if item["type"] == "inline_thinking.done":
                        summary.append(
                            {
                                "type": "image",
                                "data": base64.b64encode(item["data"]).decode(),
                                "mime_type": item["mime_type"],
                            }
                        )
                    elif item["thinking"]:
                        summary.append({"type": "text", "text": item["thinking"]})

                    if not summary and not signature:
                        continue

                    if thought is None:
                        thought = {"type": "thought", "summary": []}
                        steps.append(thought)

                    thought["summary"].extend(summary)
                    if signature:
                        thought["signature"] = signature
                        thought = None

                    continue

                thought = None
                if signature:
                    # Histories recorded through generateContent carry the signature on the text,
                    # image or call it came with and hold no thinking item; the Interactions API takes
                    # it back as a thought step in front of that item (verified live 2026-09-16).
                    steps.append({"type": "thought", "signature": signature})
                    content = None

                if item["type"] in ("text.done", "image_url.done", "inline_data.done"):
                    if item["type"] == "text.done":
                        # an empty text block is rejected: "Missing text in content of type text"
                        if not item["text"]:
                            continue

                        block = {"type": "text", "text": item["text"]}
                    else:
                        if item["type"] == "image_url.done":
                            media = await self._get_image_bytes_and_mime_type(item["image_url"])
                        else:
                            media = {"data": item["data"], "mime_type": item["mime_type"]}

                        # the block type follows the MIME type: image/jpeg is an image, application/pdf a document
                        kind = media["mime_type"].split("/")[0]
                        block = {
                            "type": kind if kind in ("image", "audio", "video") else "document",
                            "data": base64.b64encode(media["data"]).decode(),
                            "mime_type": media["mime_type"],
                        }

                    if content is None:
                        content = []
                        steps.append(
                            {"type": "user_input" if msg["role"] == "user" else "model_output", "content": content}
                        )

                    content.append(block)
                elif item["type"] == "tool_call.done":
                    content = None
                    call_names[item["tool_call_id"]] = item["name"]
                    # Histories from before ids were stored carry the name as the tool_call_id; replay
                    # those without an id, because parallel calls sharing one id are rejected with a
                    # 400 (verified live 2026-09-16).
                    function_call = {"type": "function_call", "name": item["name"], "arguments": item["arguments"]}
                    if item["tool_call_id"] != item["name"]:
                        function_call["id"] = item["tool_call_id"]

                    steps.append(function_call)
                elif item["type"] == "tool_result.done":
                    content = None
                    if "tool_call_id" not in item:
                        raise ValueError("tool_call_id is required for tool result.")

                    result: str | list[dict[str, str]] = item["text"]
                    if "images" in item:
                        # an empty text block is rejected, while a result of images alone is accepted
                        result = [{"type": "text", "text": item["text"]}] if item["text"] else []
                        for image_url in item["images"]:
                            image_data = await self._get_image_bytes_and_mime_type(image_url)
                            result.append(
                                {
                                    "type": "image",
                                    "data": base64.b64encode(image_data["data"]).decode(),
                                    "mime_type": image_data["mime_type"],
                                }
                            )

                    function_name = call_names.get(item["tool_call_id"], item["tool_call_id"])
                    function_result = {"type": "function_result", "name": function_name, "result": result}
                    if item["tool_call_id"] != function_name:
                        function_result["call_id"] = item["tool_call_id"]

                    steps.append(function_result)
                else:
                    raise ValueError(f"Unknown item: {item}")

            # An image model sometimes streams its text before its first thought step, but the API
            # takes a turn holding a thought back only when the turn opens with one: "Model turns with
            # images must start with a thought block" (verified live 2026-09-16). A turn another
            # provider produced holds no signed thought at all, which the API rejects once the turn
            # continues with its tool results (verified live 2026-09-16). Both open with the
            # placeholder signature Google documents for thoughts it did not produce.
            turn = steps[message_start:]
            if (any(step["type"] == "thought" for step in turn) and turn[0]["type"] != "thought") or (
                any(step["type"] in ("model_output", "function_call") for step in turn)
                and not any(step["type"] == "thought" and step.get("signature") for step in turn)
            ):
                steps.insert(message_start, {"type": "thought", "signature": "skip_thought_signature_validator"})

        return steps

    def transform_model_output_to_client_parts(
        self, model_output: interactions.InteractionSSEEvent
    ) -> list[ClientPart]:
        """
        Transform one Interactions API stream event into client parts, keyed by step index.

        Args:
            model_output: Interactions API stream event

        Returns:
            The parts the event carries, none when it carries nothing universal
        """
        if model_output.event_type == "step.start":
            step = model_output.step
            if step.type == "function_call":
                # the start names the call; its arguments stream as deltas behind an empty object
                start_arguments = json.dumps(step.arguments, ensure_ascii=False) if step.arguments else ""
                return [
                    {
                        "type": "delta",
                        "key": str(model_output.index),
                        "item": {
                            "type": "tool_call.delta",
                            "name": step.name,
                            "arguments": start_arguments,
                            "tool_call_id": step.id,
                        },
                    }
                ]
            elif step.type in ("thought", "model_output"):
                return []

        elif model_output.event_type == "step.delta":
            key = str(model_output.index)
            delta = model_output.delta
            if delta.type == "thought_summary":
                if delta.content is not None and delta.content.type == "text":
                    return [
                        {
                            "type": "delta",
                            "key": key,
                            "item": {"type": "thinking.delta", "thinking": delta.content.text},
                        }
                    ]
                elif delta.content is not None and delta.content.type == "image":
                    # image models summarize their thinking with interim images too
                    return [
                        {
                            "type": "delta",
                            "key": key,
                            "item": {
                                "type": "inline_thinking.delta",
                                "data": base64.b64decode(delta.content.data or ""),
                                "mime_type": delta.content.mime_type or "image/jpeg",
                            },
                        }
                    ]

            elif delta.type == "thought_signature":
                # the signature is the last delta of its thought step
                return [
                    {
                        "type": "delta",
                        "key": key,
                        "item": {"type": "thinking.delta", "thinking": "", "fidelity": {"signature": delta.signature}},
                    }
                ]
            elif delta.type == "arguments_delta":
                return [
                    {
                        "type": "delta",
                        "key": key,
                        "item": {
                            "type": "tool_call.delta",
                            "name": "",
                            "arguments": delta.arguments or "",
                            "tool_call_id": "",
                        },
                    }
                ]
            elif delta.type == "text":
                return [{"type": "delta", "key": key, "item": {"type": "text.delta", "text": delta.text}}]
            elif delta.type == "image":
                return [
                    {
                        "type": "delta",
                        "key": key,
                        "item": {
                            "type": "inline_data.delta",
                            "data": base64.b64decode(delta.data or ""),
                            "mime_type": delta.mime_type or "image/jpeg",
                        },
                    }
                ]
            elif delta.type == "audio":
                # TTS streams raw PCM in 40 ms chunks; the MIME type carries the format a player needs
                return [
                    {
                        "type": "delta",
                        "key": key,
                        "item": {
                            "type": "inline_data.delta",
                            "data": base64.b64decode(delta.data or ""),
                            "mime_type": f"{delta.mime_type}; rate={delta.sample_rate}; channels={delta.channels}",
                        },
                    }
                ]

        elif model_output.event_type == "step.stop":
            return [{"type": "done", "key": str(model_output.index)}]

        elif model_output.event_type == "interaction.completed":
            status_mapping: dict[str, FinishReason] = {
                "completed": "stop",
                "requires_action": "tool_call",
                "incomplete": "length",
            }
            usage = model_output.interaction.usage or interactions.Usage()
            # total_input_tokens includes the cached tokens; total_output_tokens excludes the thoughts
            return [
                {
                    "type": "finish",
                    "finish_reason": status_mapping.get(model_output.interaction.status, "unknown"),
                    "usage_metadata": {
                        "cached_tokens": usage.total_cached_tokens or None,
                        "prompt_tokens": (usage.total_input_tokens or 0) - (usage.total_cached_tokens or 0),
                        "thoughts_tokens": usage.total_thought_tokens or None,
                        "response_tokens": usage.total_output_tokens or None,
                    },
                }
            ]

        elif model_output.event_type == "error" and model_output.error is not None:
            # Neither Interactions SDK raises on an error event inside an open stream, so the provider's
            # failure is raised here rather than lost; an error event without an error, which the Python
            # SDK makes of a gateway heartbeat, stays with the unknown-event guard.
            raise RuntimeError(f"Gemini stream error {model_output.error.code}: {model_output.error.message}")

        elif model_output.event_type in ("interaction.created", "interaction.status_update"):
            return []

        if is_debug_enabled():
            raise ValueError(f"Unknown output: {model_output}")

        # the API adds event, step and delta types over time (the SDK surfaces them as its Unknown*
        # types), and killing a long generation over one costs more than dropping it
        return []

    async def _embed_messages_internal(
        self,
        messages: list[UniMessage],
        config: UniConfig,
    ) -> AsyncIterator[ClientPart]:
        """Embed messages through embedContent and yield one embedding item per message."""
        # the Interactions API does not serve embedding models (HTTP 404, verified live
        # 2026-09-16), so they stay on embedContent
        contents = []
        for msg in messages:
            parts = []
            for item in msg["content_items"]:
                if item["type"] == "text.done":
                    parts.append(types.Part(text=item["text"]))
                elif item["type"] == "image_url.done":
                    image_data = await self._get_image_bytes_and_mime_type(item["image_url"])
                    parts.append(types.Part.from_bytes(**image_data))
                elif item["type"] == "inline_data.done":
                    parts.append(types.Part.from_bytes(data=item["data"], mime_type=item["mime_type"]))
                else:
                    raise ValueError(f"Unknown item: {item}")

            contents.append(types.Content(role="user" if msg["role"] == "user" else "model", parts=parts))

        embedding_config = config.get("embedding_config") or {}
        gemini_config = None
        if embedding_config.get("dimensions") is not None:
            gemini_config = types.EmbedContentConfig(output_dimensionality=embedding_config["dimensions"])

        result = await self._client.aio.models.embed_content(
            model=self._model,
            contents=contents,
            config=gemini_config,
        )

        for i, embedding in enumerate(result.embeddings or []):
            key = f"embedding:{i}"
            yield {
                "type": "delta",
                "key": key,
                "item": {"type": "embedding.delta", "embedding": list(embedding.values or [])},
            }
            yield {"type": "done", "key": key}

        yield {
            "type": "finish",
            "usage_metadata": {
                "cached_tokens": None,
                "prompt_tokens": result.metadata.billable_character_count if result.metadata else None,
                "thoughts_tokens": None,
                "response_tokens": None,
            },
            "finish_reason": "stop",
        }

    async def _streaming_response_internal(
        self,
        messages: list[UniMessage],
        config: UniConfig,
    ) -> AsyncIterator[ClientPart]:
        """Stream generate through the Interactions API with unified conversion methods."""
        if "embedding" in self._model.lower():
            async for part in self._embed_messages_internal(messages, config):
                yield part
            return

        gemini_config = self.transform_uni_config_to_model_config(config)

        # A TTS model synthesizes a single text turn: a conversation comes back as "Multiturn chat
        # is not enabled for this model" and an audio part as "Audio input modality is not enabled
        # for this model" (verified live 2026-08-20), so only the newest message is sent and the
        # audio a stateful session records stays out of the request.
        if "tts" in self._model.lower():
            messages = messages[-1:]
            invalid_item = next(
                (item for message in messages for item in message["content_items"] if item["type"] != "text.done"),
                None,
            )
            if invalid_item is not None:
                raise ValueError(f"Gemini TTS only supports text input, got content item type={invalid_item['type']}.")

        steps = await self.transform_uni_message_to_model_input(messages)

        stream = await self._client.aio.interactions.create(**gemini_config, input=steps)

        # A step streams one item per run of a content kind: an image model's thought summary can go
        # text, image, text, which is three items, so an item's key is its step index and the number
        # of the run within the step. Every image delta is a whole image and a run of its own, while audio
        # streams in chunks of one run.
        step_key = ""
        run = 0
        run_item: DeltaContentItem | None = None
        async for event in stream:
            for part in self.transform_model_output_to_client_parts(event):
                if part["type"] == "finish":
                    yield part
                    continue

                if part["key"] != step_key:
                    step_key = part["key"]
                    run = 0
                    run_item = None

                if part["type"] == "done":
                    yield {"type": "done", "key": f"{step_key}.{run}"}
                    continue

                item = part["item"]
                if (
                    item["type"] == "thinking.delta"
                    and item.get("fidelity")
                    and run_item is not None
                    and run_item["type"] == "inline_thinking.delta"
                ):
                    # the signature closes the run its thought step ends with, an image one included
                    item = {
                        "type": "inline_thinking.delta",
                        "data": b"",
                        "mime_type": run_item["mime_type"],
                        "fidelity": item["fidelity"],
                    }
                elif run_item is not None and (
                    run_item["type"] != item["type"]
                    or item["type"] == "inline_thinking.delta"
                    or (item["type"] == "inline_data.delta" and item["mime_type"].startswith("image/"))
                ):
                    yield {"type": "done", "key": f"{step_key}.{run}"}
                    run += 1

                run_item = item
                yield {"type": "delta", "key": f"{step_key}.{run}", "item": item}

    async def list_models(self) -> list[str]:
        """
        List the model ids the configured endpoint serves.

        Returns:
            list[str]: The model ids, in the order the endpoint returned them.
        """
        # the API returns path-qualified names: models/gemini-3.7-flash, publishers/google/models/...
        return [model.name.split("/")[-1] async for model in await self._client.aio.models.list() if model.name]
