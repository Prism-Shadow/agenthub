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

import re
from dataclasses import dataclass
from typing import Any

import pytest

from agenthub import AutoLLMClient


# Each case builds a client under a controlled environment and reads the credential its vendor
# SDK instance ends up holding; nothing here reaches the network. The OpenAI and Anthropic SDKs
# fill every credential they are handed as None from their own environment variables, so a client
# that hands them None sends whatever those variables hold to its own host.
_CREDENTIAL_ENV = [
    "CLIENT_TYPE",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_BASE_URL",
    "ZAI_API_KEY",
    "ZAI_BASE_URL",
    "MOONSHOT_API_KEY",
    "MOONSHOT_BASE_URL",
    "MINIMAX_API_KEY",
    "MINIMAX_BASE_URL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_BEDROCK_BASE_URL",
    # the Python Bedrock client refuses AWS keys while this is set
    "AWS_BEARER_TOKEN_BEDROCK",
]


@pytest.fixture(autouse=True)
def _controlled_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in _CREDENTIAL_ENV:
        monkeypatch.delenv(name, raising=False)


def _routed_client_name(client: AutoLLMClient) -> str:
    return type(client._client).__name__  # noqa: SLF001


def _sdk(client: AutoLLMClient) -> Any:
    return client._client._client  # noqa: SLF001


def _anthropic_auth_headers(client: AutoLLMClient) -> dict[str, str]:
    """The headers the Anthropic SDK attaches to every request it sends."""
    return {name.lower(): value for name, value in _sdk(client).auth_headers.items()}


@dataclass
class VendorCase:
    expected_client: str
    model: str
    key_env: str


# The vendor clients built on the OpenAI SDK: each reads its own variable and nothing else.
VENDOR_CASES = [
    VendorCase(expected_client="DeepSeekV4Client", model="deepseek-v4-flash", key_env="DEEPSEEK_API_KEY"),
    VendorCase(expected_client="GLM5_3Client", model="glm-5.3", key_env="ZAI_API_KEY"),
    VendorCase(expected_client="KimiK3Client", model="kimi-k3", key_env="MOONSHOT_API_KEY"),
    VendorCase(expected_client="MiniMaxM3Client", model="MiniMax-M3", key_env="MINIMAX_API_KEY"),
]
VENDOR_IDS = [case.expected_client for case in VENDOR_CASES]


def _missing_key_message(case: VendorCase) -> str:
    return re.escape(f"{case.key_env} is required for {case.expected_client}.")


@pytest.mark.parametrize("case", VENDOR_CASES, ids=VENDOR_IDS)
def test_vendor_client_refuses_to_build_on_openai_api_key_alone(case: VendorCase, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-PROBE")

    with pytest.raises(ValueError, match=_missing_key_message(case)):
        AutoLLMClient(model=case.model)


@pytest.mark.parametrize("case", VENDOR_CASES, ids=VENDOR_IDS)
def test_vendor_client_without_any_key_names_its_own_variable(case: VendorCase):
    with pytest.raises(ValueError, match=_missing_key_message(case)):
        AutoLLMClient(model=case.model)


@pytest.mark.parametrize("case", VENDOR_CASES, ids=VENDOR_IDS)
def test_vendor_client_uses_its_own_variable_not_openai_api_key(case: VendorCase, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-PROBE")
    monkeypatch.setenv(case.key_env, "sk-vendor-PROBE")

    client = AutoLLMClient(model=case.model)

    assert _routed_client_name(client) == case.expected_client
    assert _sdk(client).api_key == "sk-vendor-PROBE"


@pytest.mark.parametrize("case", VENDOR_CASES, ids=VENDOR_IDS)
def test_vendor_client_uses_an_explicit_key_over_both_variables(case: VendorCase, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-PROBE")
    monkeypatch.setenv(case.key_env, "sk-vendor-PROBE")

    client = AutoLLMClient(model=case.model, api_key="sk-explicit-PROBE")

    assert _sdk(client).api_key == "sk-explicit-PROBE"


@dataclass
class OpenaiCase:
    expected_client: str
    model: str
    client_type: str | None = None


# The OpenAI protocol clients, which OPENAI_API_KEY and OPENAI_BASE_URL belong to.
OPENAI_CASES = [
    OpenaiCase(expected_client="GPT6Client", model="gpt-6-astra"),
    OpenaiCase(expected_client="OpenaiChatClient", model="gpt-5.6", client_type="openai-chat"),
    OpenaiCase(expected_client="OpenaiResponsesClient", model="gpt-5.6", client_type="openai-responses"),
    OpenaiCase(
        expected_client="OpenaiEmbeddingClient", model="text-embedding-3-large", client_type="openai-embedding"
    ),
    OpenaiCase(
        expected_client="OpenaiChatVllmAdapterClient",
        model="Qwen/Qwen3.6-35B-A3B",
        client_type="openai-chat-vllm-adapter",
    ),
]


@pytest.mark.parametrize("case", OPENAI_CASES, ids=[case.expected_client for case in OPENAI_CASES])
def test_openai_protocol_client_reads_openai_api_key_and_base_url(case: OpenaiCase, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-PROBE")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://gateway.example/v1/")

    client = AutoLLMClient(model=case.model, client_type=case.client_type)

    assert _routed_client_name(client) == case.expected_client
    assert _sdk(client).api_key == "sk-openai-PROBE"
    assert str(_sdk(client).base_url) == "https://gateway.example/v1/"


@dataclass
class AnthropicCase:
    expected_client: str
    model: str
    client_type: str | None = None
    # ant-messages sends its key through both header conventions, claude-5 as x-api-key only
    key_as_bearer: bool = False


ANTHROPIC_CASES = [
    AnthropicCase(expected_client="Claude5Client", model="claude-sonnet-5"),
    AnthropicCase(
        expected_client="AntMessagesClient", model="claude-sonnet-5", client_type="ant-messages", key_as_bearer=True
    ),
]
ANTHROPIC_IDS = [case.expected_client for case in ANTHROPIC_CASES]


def _key_headers(key: str, key_as_bearer: bool) -> dict[str, str]:
    return {"x-api-key": key, "authorization": f"Bearer {key}"} if key_as_bearer else {"x-api-key": key}


@pytest.mark.parametrize("case", ANTHROPIC_CASES, ids=ANTHROPIC_IDS)
def test_anthropic_client_sends_a_configured_key_without_anthropic_auth_token(
    case: AnthropicCase, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "tok-env-PROBE")

    client = AutoLLMClient(
        model=case.model,
        client_type=case.client_type,
        api_key="sk-row-KEY",
        base_url="https://proxy.example/anthropic",
    )

    assert _routed_client_name(client) == case.expected_client
    assert _anthropic_auth_headers(client) == _key_headers("sk-row-KEY", case.key_as_bearer)


@pytest.mark.parametrize("case", ANTHROPIC_CASES, ids=ANTHROPIC_IDS)
def test_anthropic_client_reads_anthropic_api_key_and_base_url_but_not_auth_token(
    case: AnthropicCase, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-PROBE")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://gateway.example/anthropic/")
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "tok-env-PROBE")

    client = AutoLLMClient(model=case.model, client_type=case.client_type)

    assert str(_sdk(client).base_url) == "https://gateway.example/anthropic/"
    assert _anthropic_auth_headers(client) == _key_headers("sk-ant-PROBE", case.key_as_bearer)


@pytest.mark.parametrize("case", ANTHROPIC_CASES, ids=ANTHROPIC_IDS)
def test_anthropic_client_without_a_key_does_not_send_anthropic_auth_token(
    case: AnthropicCase, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "tok-env-PROBE")

    client = AutoLLMClient(model=case.model, client_type=case.client_type)

    assert _anthropic_auth_headers(client) == {}


def test_claude5_client_on_bedrock_sends_no_anthropic_credential_to_aws(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-PROBE")
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "tok-env-PROBE")

    client = AutoLLMClient(
        model="claude-sonnet-5", api_key="AKIAEXAMPLE,secret-EXAMPLE", base_url="bedrock://us-east-1"
    )

    assert type(_sdk(client)).__name__ == "AsyncAnthropicBedrock"
    assert _anthropic_auth_headers(client) == {}
