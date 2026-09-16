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
import shutil
import tempfile
from pathlib import Path

import pytest
from flask import Flask

from agenthub.base_client import LLMClient
from agenthub.integration.tracer import Tracer


@pytest.fixture
def temp_cache_dir():
    """Create a temporary cache directory for testing."""
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    shutil.rmtree(temp_dir, ignore_errors=True)


def test_tracer_init(temp_cache_dir):
    """Test Tracer initialization."""
    tracer = Tracer(cache_dir=temp_cache_dir)
    assert tracer.cache_dir == Path(temp_cache_dir)
    assert tracer.cache_dir.exists()


def test_save_history(temp_cache_dir):
    """Test saving conversation history to a file."""
    tracer = Tracer(cache_dir=temp_cache_dir)

    # Create sample history
    model = "fake-model"
    history = [
        {"role": "user", "content_items": [{"type": "text.done", "text": "Hello"}]},
        {"role": "assistant", "content_items": [{"type": "text.done", "text": "Hi there!"}]},
    ]

    # Save history
    file_id = "test/conversation"
    config = {"temperature": 0.7}
    tracer.save_history(model, history, file_id, config)

    # Verify files exist (both JSON and TXT)
    json_path = Path(temp_cache_dir) / (file_id + ".json")
    txt_path = Path(temp_cache_dir) / (file_id + ".txt")
    assert json_path.exists()
    assert txt_path.exists()

    # Verify TXT content
    content = txt_path.read_text()
    assert "USER:" in content
    assert "ASSISTANT:" in content
    assert "Hello" in content
    assert "Hi there!" in content
    assert "temperature" in content

    # Verify JSON content
    with open(json_path) as f:
        data = json.load(f)
    assert "history" in data
    assert "config" in data
    assert len(data["history"]) == 2


def test_save_history_creates_directories(temp_cache_dir):
    """Test that saving history creates necessary directories."""
    tracer = Tracer(cache_dir=temp_cache_dir)

    model = "fake-model"
    history = [{"role": "user", "content_items": [{"type": "text.done", "text": "Test"}]}]

    file_id = "agent1/subfolder/conversation"
    config = {}
    tracer.save_history(model, history, file_id, config)

    json_path = Path(temp_cache_dir) / (file_id + ".json")
    assert json_path.exists()
    assert json_path.parent.exists()


def test_save_history_overwrites_existing(temp_cache_dir):
    """Test that saving history overwrites existing files."""
    tracer = Tracer(cache_dir=temp_cache_dir)

    model = "fake-model"
    history1 = [{"role": "user", "content_items": [{"type": "text.done", "text": "First message"}]}]

    history2 = [
        {"role": "user", "content_items": [{"type": "text.done", "text": "First message"}]},
        {"role": "assistant", "content_items": [{"type": "text.done", "text": "Response"}]},
        {"role": "user", "content_items": [{"type": "text.done", "text": "Second message"}]},
    ]

    file_id = "test/conversation"
    config = {}

    # Save first history
    tracer.save_history(model, history1, file_id, config)
    txt_path = Path(temp_cache_dir) / (file_id + ".txt")
    content1 = txt_path.read_text()
    assert "First message" in content1
    assert "Second message" not in content1

    # Save second history (should overwrite)
    tracer.save_history(model, history2, file_id, config)
    content2 = txt_path.read_text()
    assert "First message" in content2
    assert "Second message" in content2
    assert "Response" in content2


def test_format_history_with_different_content_types(temp_cache_dir):
    """Test formatting history with different content item types."""
    tracer = Tracer(cache_dir=temp_cache_dir)

    model = "fake-model"
    history = [
        {"role": "user", "content_items": [{"type": "text.done", "text": "What's in this image?"}]},
        {
            "role": "assistant",
            "content_items": [
                {"type": "thinking.done", "thinking": "Let me analyze..."},
                {"type": "inline_thinking.done", "data": b"abc", "mime_type": "image/png"},
                {"type": "text.done", "text": "This is a flower."},
                {"type": "embedding.done", "embedding": [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]},
            ],
        },
        {
            "role": "assistant",
            "content_items": [{"type": "inline_data.done", "data": b"\x00\x01\x02\x03", "mime_type": "audio/pcm"}],
        },
        {
            "role": "user",
            "content_items": [{"type": "tool_result.done", "text": "Temperature is 20C", "tool_call_id": "call_123"}],
        },
    ]

    relative_path = "test/multi_content"
    config = {"temperature": 0.8}
    tracer.save_history(model, history, relative_path, config)

    file_path = Path(temp_cache_dir) / (relative_path + ".txt")
    content = file_path.read_text()

    assert "What's in this image?" in content
    assert "Thinking:" in content
    assert "Let me analyze..." in content
    assert "Thinking Inline Image: image/png" in content
    assert "This is a flower." in content
    assert "Embedding: [0.1, 0.2, 0.3, 0.4, 0.5]" in content
    assert "0.6" not in content
    assert "Inline Audio: audio/pcm" in content
    assert "Tool Result" in content
    assert "Temperature is 20C" in content

    app = tracer.create_web_app()
    with app.test_client() as client:
        response = client.get("/test/multi_content.json")
        assert response.status_code == 200
        html = response.data.decode()
        assert "Embedding: [0.1, 0.2, 0.3, 0.4, 0.5]" in html
        assert "0.6" not in html


def test_web_app_creation(temp_cache_dir):
    """Test web application creation."""
    tracer = Tracer(cache_dir=temp_cache_dir)
    app = tracer.create_web_app()
    assert app is not None
    assert isinstance(app, Flask)


def test_web_app_browse_empty_directory(temp_cache_dir):
    """Test browsing an empty cache directory."""
    tracer = Tracer(cache_dir=temp_cache_dir)
    app = tracer.create_web_app()

    with app.test_client() as client:
        response = client.get("/")
        assert response.status_code == 200
        assert b"Tracer" in response.data


def test_web_app_browse_with_files(temp_cache_dir):
    """Test browsing cache directory with files."""
    tracer = Tracer(cache_dir=temp_cache_dir)

    # Create some test files
    model = "fake-model"
    history = [{"role": "user", "content_items": [{"type": "text.done", "text": "Test"}]}]
    config = {}
    tracer.save_history(model, history, "agent1/conv1", config)
    tracer.save_history(model, history, "agent1/conv2", config)
    tracer.save_history(model, history, "agent2/conv1", config)

    app = tracer.create_web_app()

    with app.test_client() as client:
        # Browse root
        response = client.get("/")
        assert response.status_code == 200
        assert b"agent1" in response.data
        assert b"agent2" in response.data

        # Browse agent1 directory
        response = client.get("/agent1")
        assert response.status_code == 200
        # Should see both .json and .txt files
        assert b"conv1" in response.data
        assert b"conv2" in response.data

        # View a JSON file
        response = client.get("/agent1/conv1.json")
        assert response.status_code == 200
        assert b"Test" in response.data


def test_web_app_security_check(temp_cache_dir):
    """Test that web app prevents access outside cache directory."""
    tracer = Tracer(cache_dir=temp_cache_dir)
    app = tracer.create_web_app()

    with app.test_client() as client:
        # Try to access parent directory
        response = client.get("/../")
        assert response.status_code == 403


def test_web_app_nonexistent_path(temp_cache_dir):
    """Test accessing a nonexistent path."""
    tracer = Tracer(cache_dir=temp_cache_dir)
    app = tracer.create_web_app()

    with app.test_client() as client:
        response = client.get("/nonexistent")
        assert response.status_code == 404


class ScriptedClient(LLMClient):
    """A client whose provider stream is a fixed list of parts.

    The tracer hook under test lives in the base class's streaming_response (trace_id ->
    save_history), above this seam — so the integration runs for real while no network or
    API key is involved.
    """

    def __init__(self, parts):
        self._model = "fake-model"
        self._history = []
        self._parts = parts

    def transform_uni_config_to_model_config(self, config):
        return None

    def transform_uni_message_to_model_input(self, messages):
        return messages

    def transform_model_output_to_client_parts(self, model_output):
        return [model_output]

    async def _streaming_response_internal(self, messages, config):
        for part in self._parts:
            for client_part in self.transform_model_output_to_client_parts(part):
                yield client_part

    async def list_models(self):
        return []


def _fake_llm_client() -> ScriptedClient:
    return ScriptedClient(
        [
            {"type": "delta", "key": "0", "item": {"type": "text.delta", "text": "Hello "}},
            {"type": "delta", "key": "0", "item": {"type": "text.delta", "text": "there!"}},
            {"type": "done", "key": "0"},
            {
                "type": "finish",
                "usage_metadata": {
                    "cached_tokens": 0,
                    "prompt_tokens": 1,
                    "thoughts_tokens": None,
                    "response_tokens": 2,
                },
                "finish_reason": "stop",
            },
        ]
    )


@pytest.mark.asyncio
async def test_monitoring_integration(temp_cache_dir):
    """Test monitoring integration with a client stream (scripted parts, no real model)."""

    os.environ["AGENTHUB_CACHE_DIR"] = temp_cache_dir
    client = _fake_llm_client()
    config = {"trace_id": "integration_test/conversation.txt"}

    message = {"role": "user", "content_items": [{"type": "text.done", "text": "Say hello"}]}
    async for _ in client.streaming_response_stateful(message=message, config=config):
        pass

    # Verify file was created
    file_path = Path(temp_cache_dir) / "integration_test/conversation.txt"
    assert file_path.exists()

    # Verify content
    content = file_path.read_text()
    assert "Say hello" in content
    assert "USER:" in content
    assert "ASSISTANT:" in content


@pytest.mark.asyncio
async def test_monitoring_updates_on_multiple_messages(temp_cache_dir):
    """Test that monitoring file is updated with each new message."""

    os.environ["AGENTHUB_CACHE_DIR"] = temp_cache_dir
    client = _fake_llm_client()
    config = {"trace_id": "multi_message_test/conversation.txt"}

    # First message
    message1 = {"role": "user", "content_items": [{"type": "text.done", "text": "First question"}]}
    async for _ in client.streaming_response_stateful(message=message1, config=config):
        pass

    file_path = Path(temp_cache_dir) / "multi_message_test/conversation.txt"
    content1 = file_path.read_text()
    assert "First question" in content1

    # Second message
    message2 = {"role": "user", "content_items": [{"type": "text.done", "text": "Second question"}]}
    async for _ in client.streaming_response_stateful(message=message2, config=config):
        pass

    content2 = file_path.read_text()
    assert "First question" in content2
    assert "Second question" in content2


@pytest.mark.asyncio
async def test_traced_response_is_saved_before_its_stop_event(temp_cache_dir, monkeypatch):
    """Test that the trace is on disk by the time the stop event reaches the caller."""
    monkeypatch.setenv("AGENTHUB_CACHE_DIR", temp_cache_dir)
    client = _fake_llm_client()
    message = {"role": "user", "content_items": [{"type": "text.done", "text": "Say hello"}]}

    saved = None
    transcript = ""
    async for event in client.streaming_response_stateful(
        message=message, config={"trace_id": "integration/conversation"}
    ):
        if event["event_type"] == "stop":
            file_base = Path(temp_cache_dir) / "integration" / "conversation"
            with open(file_base.with_suffix(".json"), encoding="utf-8") as f:
                saved = json.load(f)
            transcript = file_base.with_suffix(".txt").read_text(encoding="utf-8")
            break

    assert [saved_message["content_items"] for saved_message in saved["history"]] == [
        [{"type": "text.done", "text": "Say hello"}],
        [{"type": "text.done", "text": "Hello there!"}],
    ]
    assert "Text: Hello there!" in transcript
    assert "Finish Reason: stop" in transcript


@pytest.mark.filterwarnings("ignore:Content item types without the .done suffix")
def test_web_app_shows_trace_files_saved_before_0_5_with_current_item_types(temp_cache_dir):
    """Test that a trace file with the item types used before 0.5.0 renders as the current types."""
    tracer = Tracer(cache_dir=temp_cache_dir)
    legacy_dir = Path(temp_cache_dir) / "legacy"
    legacy_dir.mkdir()
    legacy_trace = {
        "history": [
            {"role": "user", "content_items": [{"type": "text", "text": "Weather in Paris?"}]},
            {
                "role": "assistant",
                "content_items": [
                    {"type": "thinking", "thinking": "Look it up."},
                    {
                        "type": "partial_tool_call",
                        "name": "get_weather",
                        "arguments": '{"city": "Paris"}',
                        "tool_call_id": "call_1",
                    },
                    {
                        "type": "tool_call",
                        "name": "get_weather",
                        "arguments": {"city": "Paris"},
                        "tool_call_id": "call_1",
                    },
                ],
            },
            {"role": "user", "content_items": [{"type": "tool_result", "text": "22 C", "tool_call_id": "call_1"}]},
        ],
        "config": {"model": "fake-model"},
        "timestamp": "2026-01-01T00:00:00",
    }
    (legacy_dir / "conversation.json").write_text(json.dumps(legacy_trace), encoding="utf-8")

    app = tracer.create_web_app()
    with app.test_client() as client:
        response = client.get("/legacy/conversation.json")
        assert response.status_code == 200
        html = response.data.decode()

    for item_type in ["text.done", "thinking.done", "tool_call.done", "tool_result.done"]:
        assert f'mb-2">{item_type}</div>' in html
    assert "Weather in Paris?" in html
    assert "Look it up." in html
    assert 'get_weather(city="Paris")' in html
    assert "22 C" in html
    assert "• 2 item(s)" in html
    assert "partial_tool_call" not in html


def test_format_config_with_system_and_tools(temp_cache_dir):
    """Test formatting config with system prompt and tools."""
    tracer = Tracer(cache_dir=temp_cache_dir)

    model = "fake-model"
    history = [{"role": "user", "content_items": [{"type": "text.done", "text": "Hello"}]}]

    config = {
        "system_prompt": "You are a helpful assistant.",
        "tools": [
            {
                "name": "get_weather",
                "description": "Get the weather for a location",
                "parameters": {
                    "type": "object",
                    "properties": {"location": {"type": "string", "description": "City name"}},
                },
            }
        ],
        "temperature": 0.7,
    }
    file_id = "test/config_render"
    tracer.save_history(model, history, file_id, config)

    # Check TXT file
    txt_path = Path(temp_cache_dir) / (file_id + ".txt")
    txt_content = txt_path.read_text()

    # Check that system_prompt is rendered properly
    assert "system_prompt:" in txt_content
    assert "You are a helpful assistant" in txt_content

    # Check that tools are rendered as JSON
    assert "tools:" in txt_content
    assert "get_weather" in txt_content
    assert "parameters" in txt_content


def test_web_app_sort_by_name(temp_cache_dir):
    """Test directory listing sorted by name."""
    tracer = Tracer(cache_dir=temp_cache_dir)

    model = "fake-model"
    history = [{"role": "user", "content_items": [{"type": "text.done", "text": "Test"}]}]
    config = {}
    tracer.save_history(model, history, "zebra/conv", config)
    tracer.save_history(model, history, "apple/conv", config)
    tracer.save_history(model, history, "mango/conv", config)

    app = tracer.create_web_app()

    with app.test_client() as client:
        response = client.get("/?sort=name")
        assert response.status_code == 200
        html = response.data.decode()

        # Dirs should appear alphabetically: apple, mango, zebra
        pos_apple = html.index("apple")
        pos_mango = html.index("mango")
        pos_zebra = html.index("zebra")
        assert pos_apple < pos_mango < pos_zebra

        # Sort controls should be present
        assert "sort=name" in html
        assert "sort=mtime" in html


def test_web_app_filters_ds_store(temp_cache_dir):
    """Test that macOS metadata files are hidden from directory listings."""
    tracer = Tracer(cache_dir=temp_cache_dir)

    model = "fake-model"
    history = [{"role": "user", "content_items": [{"type": "text.done", "text": "Test"}]}]
    config = {}
    tracer.save_history(model, history, "agent/conv", config)
    (Path(temp_cache_dir) / ".DS_Store").write_text("metadata")
    (Path(temp_cache_dir) / "agent" / ".DS_Store").write_text("metadata")

    app = tracer.create_web_app()

    with app.test_client() as client:
        root_response = client.get("/")
        assert root_response.status_code == 200
        assert ".DS_Store" not in root_response.data.decode()

        nested_response = client.get("/agent")
        assert nested_response.status_code == 200
        assert ".DS_Store" not in nested_response.data.decode()


def test_web_app_sort_by_mtime(temp_cache_dir):
    """Test directory listing sorted by modification time (most recent first)."""
    tracer = Tracer(cache_dir=temp_cache_dir)

    model = "fake-model"
    history = [{"role": "user", "content_items": [{"type": "text.done", "text": "Test"}]}]
    config = {}

    tracer.save_history(model, history, "alpha/conv", config)
    tracer.save_history(model, history, "beta/conv", config)
    tracer.save_history(model, history, "gamma/conv", config)

    # Explicitly set directory mtimes so the order is deterministic
    alpha_dir = Path(temp_cache_dir) / "alpha"
    beta_dir = Path(temp_cache_dir) / "beta"
    gamma_dir = Path(temp_cache_dir) / "gamma"
    os.utime(alpha_dir, (1000, 1000))
    os.utime(beta_dir, (2000, 2000))
    os.utime(gamma_dir, (3000, 3000))

    app = tracer.create_web_app()

    with app.test_client() as client:
        response = client.get("/?sort=mtime")
        assert response.status_code == 200
        html = response.data.decode()

        # Most recently modified directory (gamma, mtime=3000) should appear before alpha (mtime=1000)
        pos_gamma = html.index("gamma")
        pos_alpha = html.index("alpha")
        assert pos_gamma < pos_alpha

        # Sort controls should be present
        assert "sort=name" in html
        assert "sort=mtime" in html


def test_web_app_sort_default_is_name(temp_cache_dir):
    """Test that the default sort order is by name."""
    tracer = Tracer(cache_dir=temp_cache_dir)

    model = "fake-model"
    history = [{"role": "user", "content_items": [{"type": "text.done", "text": "Test"}]}]
    config = {}
    tracer.save_history(model, history, "zebra/conv", config)
    tracer.save_history(model, history, "apple/conv", config)

    app = tracer.create_web_app()

    with app.test_client() as client:
        response = client.get("/")
        assert response.status_code == 200
        html = response.data.decode()

        pos_apple = html.index("apple")
        pos_zebra = html.index("zebra")
        assert pos_apple < pos_zebra
