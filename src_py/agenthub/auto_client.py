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

from .abort_signal import AbortSignal
from .base_client import LLMClient
from .types import UniConfig, UniEvent, UniMessage


# The generic protocol clients are named explicitly rather than deduced from a model id.
_PROTOCOL_CLIENT_TYPES = (
    "openai-chat",
    "openai-chat-vllm-adapter",
    "openai-responses",
    "ant-messages",
    "openai-embedding",
)


class AutoLLMClient(LLMClient):
    """
    Auto-routing LLM client that dispatches to appropriate model-specific client.

    This client is stateful - it knows the model name at initialization and maintains
    conversation history for that specific model.
    """

    def __init__(
        self,
        model: str,
        api_key: str | None = None,
        base_url: str | None = None,
        client_type: str | None = None,
        default_headers: dict[str, str] | None = None,
    ):
        """
        Initialize AutoLLMClient with a specific model.

        Args:
            model: Model identifier (determines which client to use)
            api_key: Optional API key
            base_url: Optional base URL for API requests
            client_type: Optional client type override
            default_headers: Optional headers sent with every request, for endpoints that demand their own
        """
        self._client_type = (client_type or os.getenv("CLIENT_TYPE") or model).lower()
        self._client = self._create_client_for_model(model, api_key, base_url, self._client_type, default_headers)

    @staticmethod
    def _client_class_for_model(client_type: str) -> type[LLMClient] | None:
        """
        Resolve which client a resolved (lowercased) client type routes to.

        Args:
            client_type: The resolved client type, which is the model id when none was given.

        Returns:
            type[LLMClient] | None: The client class, or None when no client claims the type.
        """
        # every Gemini generation shares the unified client ("gemini-3" also matches the
        # gemini-3.8/gemini-3.7/gemini-3.6/gemini-3.5-flash-lite client types)
        if any(
            prefix in client_type for prefix in ("gemini-3", "gemini-embedding")
        ):  # e.g., gemini-3.8-flash, gemini-3-flash-preview, gemini-embedding-2
            from .gemini3_8 import Gemini3_8Client

            return Gemini3_8Client
        elif "claude" in client_type and (
            "4-6" in client_type or "4-7" in client_type or "4-8" in client_type or "-5" in client_type
        ):  # the whole Claude 4.6+ series shares the unified client, e.g., claude-sonnet-4-6
            from .claude5 import Claude5Client

            return Claude5Client
        elif (
            "gpt-5.4" in client_type or "gpt-5.5" in client_type or "gpt-5.6" in client_type or "gpt-6" in client_type
        ):  # e.g., gpt-6-astra
            from .gpt6 import GPT6Client

            return GPT6Client
        elif "glm-5" in client_type:  # the whole GLM series shares the unified client
            from .glm5_3 import GLM5_3Client

            return GLM5_3Client
        elif "kimi-k3" in client_type or "kimi-k2.5" in client_type or "kimi-k2.6" in client_type:
            # the whole Kimi K2.5+ series shares the unified client
            from .kimi_k3 import KimiK3Client

            return KimiK3Client
        elif client_type == "minimax-m3":
            from .minimax_m3 import MiniMaxM3Client

            return MiniMaxM3Client
        elif "deepseek-v4" in client_type:
            from .deepseek_v4 import DeepSeekV4Client

            return DeepSeekV4Client
        elif client_type == "openai-chat-vllm-adapter":
            # exact match: "openai-chat-vllm-adapter" contains "openai", so the substring
            # branches below would otherwise claim it
            from .openai_chat_vllm_adapter import OpenaiChatVllmAdapterClient

            return OpenaiChatVllmAdapterClient
        elif "ant-messages" in client_type:
            from .ant_messages import AntMessagesClient

            return AntMessagesClient
        elif "openai-responses" in client_type:
            from .openai_responses import OpenaiResponsesClient

            return OpenaiResponsesClient
        elif "openai" in client_type and "embedding" in client_type:
            from .openai_embedding import OpenaiEmbeddingClient

            return OpenaiEmbeddingClient
        elif "openai" in client_type and "embedding" not in client_type:  # openai-chat, plus bare "openai" as alias
            from .openai_chat import OpenaiChatClient

            return OpenaiChatClient
        else:
            return None

    def _create_client_for_model(
        self,
        model: str,
        api_key: str | None = None,
        base_url: str | None = None,
        client_type: str | None = None,
        default_headers: dict[str, str] | None = None,
    ) -> LLMClient:
        """Create the appropriate client for the given model."""
        client_class = self._client_class_for_model(client_type or model.lower())
        if client_class is None:
            raise ValueError(
                f"{client_type} is not supported. "
                "Supported client types: minimax-m3, gemini-3.8, gemini-3.7, gemini-3.6, gemini-3, "
                "claude-5, claude-4-8, claude-4-7, claude-4-6, gpt-6, gpt-5.6, gpt-5.5, gpt-5.4, "
                "glm-5.3, glm-5.2, glm-5.1, kimi-k3, kimi-k2.6, kimi-k2.5, deepseek-v4, "
                "openai-chat-vllm-adapter, openai-embedding, ant-messages, openai-responses, openai-chat."
            )

        return client_class(model=model, api_key=api_key, base_url=base_url, default_headers=default_headers)

    def transform_uni_config_to_model_config(self, config: UniConfig) -> Any:
        """Delegate to underlying client's transform_uni_config_to_model_config."""
        return self._client.transform_uni_config_to_model_config(config)

    def transform_uni_message_to_model_input(self, messages: list[UniMessage]) -> Any:
        """Delegate to underlying client's transform_uni_message_to_model_input."""
        return self._client.transform_uni_message_to_model_input(messages)

    def transform_model_output_to_uni_event(self, model_output: Any) -> UniEvent:
        """Delegate to underlying client's transform_model_output_to_uni_event."""
        return self._client.transform_model_output_to_uni_event(model_output)

    async def _streaming_response_internal(
        self,
        messages: list[UniMessage],
        config: UniConfig,
    ) -> AsyncIterator[UniEvent]:
        raise NotImplementedError("Please use streaming_response instead.")

    async def streaming_response(
        self,
        messages: list[UniMessage],
        config: UniConfig,
        signal: AbortSignal | None = None,
    ) -> AsyncIterator[UniEvent]:
        """Route to underlying client's streaming_response."""
        async for event in self._client.streaming_response(
            messages=messages,
            config=config,
            signal=signal,
        ):
            yield event

    async def streaming_response_stateful(
        self,
        message: UniMessage,
        config: UniConfig,
        signal: AbortSignal | None = None,
    ) -> AsyncIterator[UniEvent]:
        """Route to underlying client's streaming_response_stateful."""
        async for event in self._client.streaming_response_stateful(
            message=message,
            config=config,
            signal=signal,
        ):
            yield event

    def clear_history(self) -> None:
        """Clear history in the underlying client."""
        self._client.clear_history()

    def get_history(self) -> list[UniMessage]:
        """Get history from the underlying client."""
        return self._client.get_history()

    def set_history(self, history: list[UniMessage]) -> None:
        """Set history in the underlying client."""
        self._client.set_history(history)

    async def list_models(self) -> list[str]:
        """
        List the model ids the endpoint serves that the routed client can be used for.

        A protocol client is chosen explicitly and speaks for whatever the endpoint serves, so its
        listing is returned whole. A client deduced from a model id serves only the ids that deduce
        back to it, so a gateway fronting many vendors is filtered down to that client's own models.

        Returns:
            list[str]: The model ids, in the order the endpoint returned them.
        """
        model_ids = await self._client.list_models()
        protocol_classes = {self._client_class_for_model(name) for name in _PROTOCOL_CLIENT_TYPES}
        if type(self._client) in protocol_classes:
            return model_ids

        client_class = type(self._client)
        return [model_id for model_id in model_ids if self._client_class_for_model(model_id.lower()) is client_class]
