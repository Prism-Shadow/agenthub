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
from typing import Any, AsyncIterator

from openai import AsyncOpenAI

from ..base_client import LLMClient
from ..errors import UnsupportedParameterError
from ..stream_items import StreamItems
from ..types import EventContentItem, UniConfig, UniEvent, UniMessage


class OpenaiEmbeddingClient(LLMClient):
    """OpenAI Embeddings-compatible client implementation."""

    def __init__(
        self,
        model: str,
        api_key: str | None = None,
        base_url: str | None = None,
        default_headers: dict[str, str] | None = None,
    ):
        """Initialize OpenAI-compatible embedding client with model, API key, and base URL."""
        self._model = model
        api_key = api_key or os.getenv("OPENAI_API_KEY")
        base_url = base_url or os.getenv("OPENAI_BASE_URL")
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url, default_headers=default_headers)
        self._history: list[UniMessage] = []

    def transform_uni_config_to_model_config(self, config: UniConfig) -> dict[str, Any]:
        """Transform universal configuration to OpenAI Embeddings configuration."""
        if config.get("fast_mode"):
            raise UnsupportedParameterError(
                self.__class__.__name__, "fast_mode", "OpenAI embeddings do not support fast mode."
            )

        params: dict[str, Any] = {"model": self._model}
        embedding_config = config.get("embedding_config") or {}
        if embedding_config.get("dimensions") is not None:
            params["dimensions"] = embedding_config["dimensions"]
        return params

    def transform_uni_message_to_model_input(self, messages: list[UniMessage]) -> list[str]:
        """Transform universal messages to OpenAI Embeddings input strings."""
        texts = []
        for msg in messages:
            msg_text = ""
            for item in msg["content_items"]:
                if item["type"] != "text.done":
                    raise ValueError("OpenAI embeddings only support text content items.")
                msg_text += item["text"]
            texts.append(msg_text or " ")
        return texts

    def transform_model_output_to_uni_event(self, model_output: Any, items: StreamItems) -> UniEvent:
        """
        Transform an OpenAI Embeddings response into a universal event. A vector is an item of its own,
        complete in its one fragment.
        """
        usage = getattr(model_output, "usage", None)
        content_items: list[EventContentItem] = []
        for item in model_output.data:
            content_items.extend(items.delta(None, {"type": "embedding.delta", "embedding": item.embedding}))
            content_items.extend(items.done())

        return {
            "role": "assistant",
            "event_type": "stop",
            "content_items": content_items,
            "usage_metadata": {
                "cached_tokens": None,
                "prompt_tokens": usage.prompt_tokens if usage else None,
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
        """Generate embeddings using OpenAI Embeddings-compatible API."""
        params = self.transform_uni_config_to_model_config(config)
        params["input"] = self.transform_uni_message_to_model_input(messages)
        result = await self._client.embeddings.create(**params)
        yield self.transform_model_output_to_uni_event(result, StreamItems(self.__class__.__name__))

    async def list_models(self) -> list[str]:
        """
        List the model ids the configured endpoint serves.

        Returns:
            list[str]: The model ids, in the order the endpoint returned them.
        """
        return [model.id async for model in self._client.models.list()]
