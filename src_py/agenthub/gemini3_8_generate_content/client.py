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
from google.genai import types
from google.oauth2 import service_account

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
from ..utils import is_debug_enabled


def _split_function_response_runs(parts: list[types.Part]) -> list[list[types.Part]]:
    """Split parts into consecutive runs of function_response and other parts.

    Vertex AI requires function responses to sit in a content of their own (see the call
    site); order is preserved, and a message without function responses — or with nothing
    else — comes back as one run.
    """
    runs: list[list[types.Part]] = []
    last_is_response: bool | None = None
    for part in parts:
        is_response = part.function_response is not None
        if is_response != last_is_response:
            runs.append([])
            last_is_response = is_response
        runs[-1].append(part)
    return runs if runs else [parts]


class Gemini3_8GenerateContentClient(LLMClient):
    """Client for the Gemini family through generateContent, named for the newest generation it serves (3.8).

    It serves Gemini on Vertex AI, whose Interactions endpoint serves none of these models, and gateways
    that proxy generateContent only: 3.8 back through the 3.x text, image, TTS, and embedding models. The
    API deprecated the temperature/top_p/top_k sampling parameters starting with the 3.6 generation
    (silently ignored today, HTTP 400 in future generations), and this client applies that contract to
    the whole family: temperature is rejected everywhere.
    """

    def __init__(
        self,
        model: str,
        api_key: str | None = None,
        base_url: str | None = None,
        default_headers: dict[str, str] | None = None,
    ):
        """Initialize Gemini 3.8 generateContent client with model and API key."""
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
    _GEMINI_LEVEL_ORDER = (
        types.ThinkingLevel.MINIMAL,
        types.ThinkingLevel.LOW,
        types.ThinkingLevel.MEDIUM,
        types.ThinkingLevel.HIGH,
    )

    def _supported_thinking_levels(self) -> tuple[types.ThinkingLevel, ...]:
        """Thinking levels the target model accepts (llmsdk_docs/gemini3_8/docs/thinking.md).

        An empty tuple means the model rejects the thinking_level parameter
        entirely, so it must be omitted from the request.
        """
        if "-image" in self._model:
            return (types.ThinkingLevel.MINIMAL, types.ThinkingLevel.HIGH)
        if "gemini-3-pro" in self._model:
            # The only pro generation without "medium".
            return (types.ThinkingLevel.LOW, types.ThinkingLevel.HIGH)
        if "-pro" in self._model:
            # Every pro generation rejects "minimal"; matching broadly keeps
            # future pro models on the safe side (clamping a level the model
            # would have accepted costs a little accuracy, forwarding an
            # unsupported one is a 400).
            return (types.ThinkingLevel.LOW, types.ThinkingLevel.MEDIUM, types.ThinkingLevel.HIGH)
        if "gemini-3.7" in self._model or "gemini-3.8" in self._model:
            # Both generations reject "minimal" with a 400 (3.7 verified live 2026-08-13,
            # 3.8 on Vertex AI 2026-09-17).
            return (types.ThinkingLevel.LOW, types.ThinkingLevel.MEDIUM, types.ThinkingLevel.HIGH)
        return self._GEMINI_LEVEL_ORDER

    def _convert_thinking_level(self, thinking_level: ThinkingLevel | None) -> types.ThinkingLevel | None:
        """Convert ThinkingLevel enum to the closest Gemini ThinkingLevel the model supports."""
        mapping = {
            ThinkingLevel.NONE: types.ThinkingLevel.MINIMAL,
            ThinkingLevel.LOW: types.ThinkingLevel.LOW,
            ThinkingLevel.MEDIUM: types.ThinkingLevel.MEDIUM,
            ThinkingLevel.HIGH: types.ThinkingLevel.HIGH,
            ThinkingLevel.XHIGH: types.ThinkingLevel.HIGH,
            # Gemini stops at "high", so both top levels land there before per-model clamping
            ThinkingLevel.MAX: types.ThinkingLevel.HIGH,
        }
        level = mapping.get(thinking_level)
        if level is None:
            return None
        supported = self._supported_thinking_levels()
        if not supported:
            # A model that takes no thinking_level at all has nothing to clamp onto, so the
            # parameter is omitted rather than turned into a failed request. thinking_summary
            # is unaffected -- include_thoughts still rides along.
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

    def _convert_tool_choice(self, tool_choice: ToolChoice) -> types.FunctionCallingConfig:
        """Convert ToolChoice to Gemini's tool config."""
        if isinstance(tool_choice, list):
            return types.FunctionCallingConfig(mode="ANY", allowed_function_names=tool_choice)
        elif tool_choice == "none":
            return types.FunctionCallingConfig(mode="NONE")
        elif tool_choice == "auto":
            return types.FunctionCallingConfig(mode="AUTO")
        elif tool_choice == "required":
            return types.FunctionCallingConfig(mode="ANY")

    def transform_uni_config_to_model_config(self, config: UniConfig) -> types.GenerateContentConfig | None:
        """
        Transform universal configuration to Gemini generateContent configuration.

        Args:
            config: Universal configuration dict

        Returns:
            Gemini GenerateContentConfig object or None if no config needed
        """
        config_params = {}
        if config.get("temperature") is not None:
            raise UnsupportedParameterError(
                self.__class__.__name__,
                "temperature",
                "Gemini models do not support setting temperature; the API deprecated "
                "sampling parameters starting with the 3.6 generation.",
            )

        if config.get("fast_mode"):
            raise UnsupportedParameterError(self.__class__.__name__, "fast_mode", "Gemini does not support fast mode.")

        if config.get("prompt_caching") is not None and config["prompt_caching"] != PromptCaching.ENABLE:
            raise UnsupportedParameterError(
                self.__class__.__name__, "prompt_caching", "prompt_caching must be ENABLE for Gemini."
            )

        if config.get("max_tokens") is not None:
            config_params["max_output_tokens"] = config["max_tokens"]

        # A TTS model takes the speech settings and nothing else: a system instruction, a
        # thinking config, or a tool declaration each comes back as a 400 (verified live
        # 2026-08-20), so the rest of the universal config never reaches the request.
        if "tts" in self._model.lower():
            config_params["response_modalities"] = ["AUDIO"]
            tts_config = config.get("tts_config") or [{"voice": "Kore"}]
            if len(tts_config) not in (1, 2):
                raise ValueError("tts_config must contain 1 or 2 entries.")

            if len(tts_config) == 1:
                config_params["speech_config"] = types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=tts_config[0]["voice"])
                    )
                )
            else:
                speaker_voice_configs = []
                for speaker_config in tts_config:
                    speaker = speaker_config.get("speaker")
                    if not speaker:
                        raise ValueError("speaker is required when tts_config has 2 entries.")

                    speaker_voice_configs.append(
                        types.SpeakerVoiceConfig(
                            speaker=speaker,
                            voice_config=types.VoiceConfig(
                                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=speaker_config["voice"])
                            ),
                        )
                    )

                config_params["speech_config"] = types.SpeechConfig(
                    multi_speaker_voice_config=types.MultiSpeakerVoiceConfig(
                        speaker_voice_configs=speaker_voice_configs
                    )
                )

            return types.GenerateContentConfig(**config_params)

        if config.get("system_prompt") is not None:
            config_params["system_instruction"] = config["system_prompt"]

        # include_thoughts asks for thought summaries, but whether generateContent returns any
        # is model-dependent (llmsdk_docs/gemini3_8/docs/thinking.md)
        thinking_summary = config.get("thinking_summary")
        thinking_level = config.get("thinking_level")
        if thinking_summary is not None or thinking_level is not None:
            config_params["thinking_config"] = types.ThinkingConfig(
                include_thoughts=thinking_summary, thinking_level=self._convert_thinking_level(thinking_level)
            )

        if config.get("tools") is not None:
            config_params["tools"] = [types.Tool(function_declarations=config["tools"])]
            tool_choice = config.get("tool_choice")
            if tool_choice is not None:
                tool_config = self._convert_tool_choice(tool_choice)
                config_params["tool_config"] = types.ToolConfig(function_calling_config=tool_config)

        if config.get("image_config") is not None:
            config_params["image_config"] = types.ImageConfig(**config["image_config"])

        return types.GenerateContentConfig(**config_params) if config_params else None

    async def transform_uni_message_to_model_input(self, messages: list[UniMessage]) -> list[types.Content]:
        """
        Transform universal message format to Gemini's Content format.

        Args:
            messages: List of universal message dictionaries

        Returns:
            List of Gemini Content objects
        """
        mapping = {"user": "user", "assistant": "model"}
        # The generateContent API wants both the call id and the function name on a function
        # response, but a universal tool_result carries only the id, so remember each call's name.
        call_names: dict[str, str] = {}
        contents = []
        for msg in messages:
            parts = []
            for item in msg["content_items"]:
                # base64 text as the stream recorded it, or the bytes older Python histories hold
                thought_signature = (item.get("fidelity") or {}).get("signature")
                if item["type"] == "text.done":
                    parts.append(types.Part(text=item["text"], thought_signature=thought_signature))
                elif item["type"] == "image_url.done":
                    image_url = item["image_url"]
                    image_data = await self._get_image_bytes_and_mime_type(image_url)
                    parts.append(types.Part.from_bytes(**image_data))
                elif item["type"] == "inline_data.done":
                    inline_data = types.Blob(data=item["data"], mime_type=item["mime_type"])
                    parts.append(types.Part(inline_data=inline_data, thought_signature=thought_signature))
                elif item["type"] == "thinking.done":
                    parts.append(types.Part(text=item["thinking"], thought=True, thought_signature=thought_signature))
                elif item["type"] == "inline_thinking.done":
                    inline_data = types.Blob(data=item["data"], mime_type=item["mime_type"])
                    parts.append(
                        types.Part(inline_data=inline_data, thought=True, thought_signature=thought_signature)
                    )
                elif item["type"] == "tool_call.done":
                    call_names[item["tool_call_id"]] = item["name"]
                    # Histories from before ids were stored carry the name as the tool_call_id;
                    # replay those without an id, exactly as they arrived.
                    function_call = types.FunctionCall(
                        id=item["tool_call_id"] if item["tool_call_id"] != item["name"] else None,
                        name=item["name"],
                        args=item["arguments"],
                    )
                    parts.append(types.Part(function_call=function_call, thought_signature=thought_signature))
                elif item["type"] == "tool_result.done":
                    if "tool_call_id" not in item:
                        raise ValueError("tool_call_id is required for tool result.")

                    tool_result = {"result": item["text"]}
                    multimodal_parts = []
                    if "images" in item:
                        for image_url in item["images"]:
                            image_data = await self._get_image_bytes_and_mime_type(image_url)
                            multimodal_parts.append(
                                types.FunctionResponsePart(inline_data=types.FunctionResponseBlob(**image_data))
                            )

                    function_name = call_names.get(item["tool_call_id"], item["tool_call_id"])
                    parts.append(
                        types.Part(
                            function_response=types.FunctionResponse(
                                id=item["tool_call_id"] if item["tool_call_id"] != function_name else None,
                                name=function_name,
                                response=tool_result,
                                parts=multimodal_parts if multimodal_parts else None,
                            )
                        )
                    )
                else:
                    raise ValueError(f"Unknown item: {item}")

            if msg["role"] == "assistant":
                # generateContent validates a single signature, the one on the first function call of a step
                # (llmsdk_docs/gemini3/docs/thought-signatures.md); a response without a call signs a later
                # part, which goes back unvalidated. The Interactions client records a signature on the thinking
                # item in front of what it signs instead, so a text thought's signature moves onto the first
                # call, or onto the next part when the turn makes no call, and a thought left empty is dropped;
                # an image thought keeps its own. A call nobody signed, one another provider made, carries the
                # placeholder Google documents for calls the API did not produce.
                first_call = next((i for i, part in enumerate(parts) if part.function_call is not None), -1)
                if first_call >= 0 and not parts[first_call].thought_signature:
                    donor = next(
                        (
                            part
                            for part in reversed(parts[:first_call])
                            if part.thought and part.text is not None and part.thought_signature
                        ),
                        None,
                    )
                    if donor is not None:
                        parts[first_call].thought_signature = donor.thought_signature
                        donor.thought_signature = None
                    else:
                        # a built Part holds its signature as bytes, which the SDK sends URL-safe base64 encoded
                        parts[first_call].thought_signature = base64.urlsafe_b64decode(
                            "skip_thought_signature_validator"
                        )

                for i, part in enumerate(parts):
                    if part.thought and part.text is not None and part.thought_signature:
                        later = next(
                            (
                                other
                                for other in parts[i + 1 :]
                                if not other.thought
                                and other.function_response is None
                                and not other.thought_signature
                            ),
                            None,
                        )
                        if later is not None:
                            later.thought_signature = part.thought_signature
                            part.thought_signature = None

                parts = [
                    part
                    for part in parts
                    if not (
                        part.thought and part.text == "" and part.inline_data is None and not part.thought_signature
                    )
                ]

            # Vertex AI rejects a content that mixes function_response parts with any other
            # part kind — the request fails with a misleading 400, "Requests ending with a
            # model turn are not supported" (the Gemini API endpoint accepts the mix). Split
            # such a message into consecutive same-role contents: each run of function
            # responses becomes its own content, the surrounding parts keep theirs, and the
            # part order is preserved. Homogeneous messages stay a single content.
            for run_parts in _split_function_response_runs(parts):
                contents.append(types.Content(role=mapping[msg["role"]], parts=run_parts))

        return contents

    def transform_model_output_to_uni_event(self, model_output: types.GenerateContentResponse) -> UniEvent:
        """
        Transform one generateContent stream chunk into a universal event.

        generateContent gives a part no identity, so each delta's item_id is the kind of wire part that
        carried it; _streaming_response_internal turns those into one item id per item.

        Args:
            model_output: Gemini response chunk

        Returns:
            Universal event dictionary
        """
        event_type: EventType = "delta"
        content_items: list[EventContentItem] = []
        usage_metadata: UsageMetadata | None = None
        finish_reason: FinishReason | None = None

        if model_output.candidates:
            candidate = model_output.candidates[0]
            content = getattr(candidate, "content", None)
            for part in getattr(content, "parts", None) or []:
                # recorded as base64 text, the form the TypeScript SDK and the Interactions API use
                signature = base64.b64encode(part.thought_signature).decode() if part.thought_signature else None
                fidelity = {"signature": signature} if signature else {}
                if part.function_call is not None:
                    # generateContent sends a call whole, so it streams as one complete delta
                    content_items.append(
                        {
                            "type": "tool_call.delta",
                            "name": part.function_call.name or "",
                            "arguments": json.dumps(part.function_call.args or {}, ensure_ascii=False),
                            "tool_call_id": part.function_call.id or part.function_call.name or "",
                            "fidelity": {"item_id": "function_call", **fidelity},
                        }
                    )
                elif part.thought and part.text is not None:
                    if part.text or signature:
                        content_items.append(
                            {
                                "type": "thinking.delta",
                                "thinking": part.text,
                                "fidelity": {"item_id": "thought", **fidelity},
                            }
                        )
                elif part.thought and part.inline_data is not None:
                    content_items.append(
                        {
                            "type": "inline_thinking.delta",
                            "data": part.inline_data.data or b"",
                            "mime_type": part.inline_data.mime_type or "application/octet-stream",
                            "fidelity": {"item_id": "inline_thinking", **fidelity},
                        }
                    )
                elif part.inline_data is not None:
                    content_items.append(
                        {
                            "type": "inline_data.delta",
                            "data": part.inline_data.data or b"",
                            "mime_type": part.inline_data.mime_type or "application/octet-stream",
                            "fidelity": {"item_id": "inline_data", **fidelity},
                        }
                    )
                elif part.text is not None:
                    # a response ends on an empty text part, which carries something only when it brings the
                    # signature
                    if part.text or signature:
                        content_items.append(
                            {"type": "text.delta", "text": part.text, "fidelity": {"item_id": "text", **fidelity}}
                        )
                elif is_debug_enabled():
                    raise ValueError(f"Unknown output: {part}")

            if candidate.finish_reason:
                event_type = "stop"
                stop_reason_mapping = {
                    types.FinishReason.STOP: "stop",
                    types.FinishReason.MAX_TOKENS: "length",
                }
                finish_reason = stop_reason_mapping.get(candidate.finish_reason, "unknown")

        # Vertex AI puts a usage object carrying only its traffic type on every chunk; the counts arrive with
        # the last one
        usage = model_output.usage_metadata
        if usage is not None and usage.prompt_token_count is not None:
            event_type = "stop"
            usage_metadata = {
                "cached_tokens": usage.cached_content_token_count or None,
                "prompt_tokens": (usage.prompt_token_count or 0) - (usage.cached_content_token_count or 0),
                "thoughts_tokens": usage.thoughts_token_count or None,
                "response_tokens": usage.candidates_token_count or None,
            }

        return {
            "role": "assistant",
            "event_type": event_type,
            "content_items": content_items,
            "usage_metadata": usage_metadata,
            "finish_reason": finish_reason,
        }

    async def _embed_messages_internal(
        self,
        messages: list[UniMessage],
        config: UniConfig,
    ) -> AsyncIterator[UniEvent]:
        """Embed messages through embedContent, one call per message, and yield one embedding item per message."""
        embedding_config = config.get("embedding_config") or {}
        gemini_config = None
        if embedding_config.get("dimensions") is not None:
            gemini_config = types.EmbedContentConfig(output_dimensionality=embedding_config["dimensions"])

        # Vertex AI embeds one content per call: a second content is a 400 there, and both SDKs refuse to send
        # one. It reports no billable characters either, only a token count per embedding.
        prompt_tokens = None
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

            result = await self._client.aio.models.embed_content(
                model=self._model,
                contents=[types.Content(role="user" if msg["role"] == "user" else "model", parts=parts)],
                config=gemini_config,
            )

            embedding = result.embeddings[0] if result.embeddings else types.ContentEmbedding()
            # a vector streams once its call returns; the usage, summed over the calls, follows the last one
            yield {
                "role": "assistant",
                "event_type": "delta",
                "content_items": [{"type": "embedding.delta", "embedding": list(embedding.values or [])}],
                "usage_metadata": None,
                "finish_reason": None,
            }
            if embedding.statistics is not None and embedding.statistics.token_count is not None:
                token_count = int(embedding.statistics.token_count)
            else:
                token_count = result.metadata.billable_character_count if result.metadata else None

            if token_count is not None:
                prompt_tokens = (prompt_tokens or 0) + token_count

        yield {
            "role": "assistant",
            "event_type": "stop",
            "content_items": [],
            "usage_metadata": {
                "cached_tokens": None,
                "prompt_tokens": prompt_tokens,
                "thoughts_tokens": None,
                "response_tokens": None,
            },
            "finish_reason": "stop",
        }

    async def _streaming_response_internal(
        self,
        messages: list[UniMessage],
        config: UniConfig,
    ) -> AsyncIterator[UniEvent]:
        """Stream generate using Gemini SDK with unified conversion methods."""
        if "embedding" in self._model.lower():
            async for event in self._embed_messages_internal(messages, config):
                yield event
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

        contents = await self.transform_uni_message_to_model_input(messages)

        response_stream = await self._client.aio.models.generate_content_stream(
            model=self._model, contents=contents, config=gemini_config
        )

        # generateContent never signals that an item ended either: an item runs until a part of another kind
        # arrives, except that every function call and every image is an item of its own, while audio chunks
        # and consecutive text parts share one
        item_index = -1
        open_field = None
        saw_function_call = False
        async for chunk in response_stream:
            event = self.transform_model_output_to_uni_event(chunk)
            content_items: list[EventContentItem] = []
            for item in event["content_items"]:
                own_item = item["type"] in ("tool_call.delta", "inline_thinking.delta") or (
                    item["type"] == "inline_data.delta" and item["mime_type"].startswith("image/")
                )
                if item["fidelity"]["item_id"] != open_field or own_item:
                    if open_field is not None:
                        content_items.append(done_marker(str(item_index)))

                    item_index += 1
                    open_field = item["fidelity"]["item_id"]

                if item["type"] == "tool_call.delta":
                    saw_function_call = True

                item["fidelity"]["item_id"] = str(item_index)
                content_items.append(item)
                # a thoughtSignature is the last thing the API says about a part: it closes the item it rides on
                if own_item or "signature" in item["fidelity"]:
                    content_items.append(done_marker(str(item_index)))
                    open_field = None

            # generateContent reports STOP for a turn that stopped to call tools
            finish_reason = (
                "tool_call" if event["finish_reason"] == "stop" and saw_function_call else event["finish_reason"]
            )
            yield {**event, "content_items": content_items, "finish_reason": finish_reason}

    async def list_models(self) -> list[str]:
        """
        List the model ids the configured endpoint serves.

        Returns:
            list[str]: The model ids, in the order the endpoint returned them.
        """
        # the API returns path-qualified names: models/gemini-3.7-flash, publishers/google/models/...
        return [model.name.split("/")[-1] async for model in await self._client.aio.models.list() if model.name]
