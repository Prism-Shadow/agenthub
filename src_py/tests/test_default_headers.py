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
import threading
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from agenthub import AutoLLMClient


@dataclass
class HeaderCase:
    client_type: str
    model: str
    base_url_suffix: str
    expected: list[str]


# One case per SDK: the OpenAI and Anthropic clients take default_headers directly, while the
# Gemini SDK carries them inside http_options.
HEADER_CASES = [
    HeaderCase(client_type="openai-chat", model="gpt-5.6", base_url_suffix="/v1", expected=["m1", "m2"]),
    HeaderCase(client_type="ant-messages", model="claude-sonnet-5", base_url_suffix="", expected=["m1", "m2"]),
    HeaderCase(
        client_type="gemini-3.8",
        model="gemini-3.8-flash",
        base_url_suffix="",
        # the Gemini client is deduced from the model id, so its listing keeps only ids that
        # deduce back to it
        expected=["gemini-3.8-flash", "gemini-3.8-pro"],
    ),
    # the generateContent client builds its own SDK client, and lists the Gemini family's ids
    HeaderCase(
        client_type="gemini-generate-content",
        model="gemini-3.8-flash",
        base_url_suffix="",
        expected=["gemini-3.8-flash", "gemini-3.8-pro"],
    ),
]

EXTRA_HEADERS = {"X-App": "cli", "HTTP-Referer": "https://example.test"}


class _ModelListHandler(BaseHTTPRequestHandler):
    """Answers a model listing in whichever shape the requesting protocol expects."""

    # header names are case-insensitive on the wire and the SDKs disagree on casing
    # (the OpenAI client lowercases custom names, the Anthropic one sends them as given)
    received_headers: dict[str, str] = {}

    def do_GET(self) -> None:  # noqa: N802 - the name is BaseHTTPRequestHandler's
        type(self).received_headers = {name.lower(): value for name, value in self.headers.items()}
        if "v1beta" in self.path:
            payload = {"models": [{"name": "models/gemini-3.8-flash"}, {"name": "models/gemini-3.8-pro"}]}
        else:
            payload = {"object": "list", "data": [{"id": "m1"}, {"id": "m2"}], "has_more": False}

        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: object) -> None:
        """Keep the request log out of the test output."""


@pytest.fixture
def model_list_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _ModelListHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


@pytest.mark.asyncio
@pytest.mark.parametrize("case", HEADER_CASES, ids=[case.client_type for case in HEADER_CASES])
async def test_default_headers_reach_the_endpoint(case: HeaderCase, model_list_server: str):
    _ModelListHandler.received_headers = {}
    client = AutoLLMClient(
        model=case.model,
        api_key="test-key",
        base_url=model_list_server + case.base_url_suffix,
        client_type=case.client_type,
        default_headers=EXTRA_HEADERS,
    )

    assert await client.list_models() == case.expected
    assert _ModelListHandler.received_headers["x-app"] == "cli"
    assert _ModelListHandler.received_headers["http-referer"] == "https://example.test"


@pytest.mark.asyncio
async def test_requests_carry_no_extra_headers_by_default(model_list_server: str):
    _ModelListHandler.received_headers = {}
    client = AutoLLMClient(
        model="gpt-5.6", api_key="test-key", base_url=model_list_server + "/v1", client_type="openai-chat"
    )

    assert await client.list_models() == ["m1", "m2"]
    assert "x-app" not in _ModelListHandler.received_headers
