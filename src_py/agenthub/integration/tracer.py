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

"""
Conversation tracer module for saving and viewing conversation history.

This module provides functionality to save conversation history to local files
and serve them via a web interface for real-time monitoring.
"""

import base64
import io
import json
import os
import wave
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import Flask, Response, render_template_string, request

from ..legacy import normalize_legacy_messages
from ..types import UniMessage


@dataclass
class Tracer:
    """
    Tracer for saving conversation history to local files.

    This class handles saving conversation history to files in a cache directory
    and provides a web server for browsing and viewing the saved conversations.
    """

    cache_dir: Path = field(default=None, init=True)

    def __post_init__(self) -> None:
        """Initialize cache directory after instance creation."""
        if self.cache_dir is None:
            cache_dir_str = os.getenv("AGENTHUB_CACHE_DIR", "cache")
            self.cache_dir = Path(cache_dir_str).absolute()
        elif isinstance(self.cache_dir, str):
            self.cache_dir = Path(self.cache_dir).absolute()
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _serialize_for_json(self, obj: Any) -> Any:
        """
        Recursively serialize objects for JSON, converting bytes to base64.

        Args:
            obj: Object to serialize

        Returns:
            JSON-serializable object
        """
        if isinstance(obj, bytes):
            return base64.b64encode(obj).decode("utf-8")
        elif isinstance(obj, dict):
            return {k: self._serialize_for_json(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [self._serialize_for_json(item) for item in obj]
        return obj

    @staticmethod
    def _is_browser_playable_audio_mime_type(mime_type: str | None) -> bool:
        """Return whether browsers can usually play this MIME type directly."""
        return (mime_type or "").lower() in {
            "audio/wav",
            "audio/x-wav",
            "audio/mpeg",
            "audio/mp3",
            "audio/ogg",
            "audio/webm",
            "audio/flac",
            "audio/aac",
            "audio/mp4",
        }

    @staticmethod
    def _decode_inline_data(item: dict[str, Any]) -> bytes:
        """Decode inline_data payloads from bytes or base64 text."""
        data = item.get("data") or b""
        if isinstance(data, str):
            return base64.b64decode(data.encode("utf-8"))
        return data

    def _build_wave_bytes_from_pcm(self, item: dict[str, Any]) -> bytes:
        """Wrap raw PCM bytes in a WAV header using Gemini TTS defaults."""
        pcm_bytes = self._decode_inline_data(item)
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(24000)
            wav_file.writeframes(pcm_bytes)
        return buffer.getvalue()

    def _build_inline_data_url(self, item: dict[str, Any]) -> str:
        """Build a browser-friendly data URL for inline_data content."""
        mime_type = item.get("mime_type") or "application/octet-stream"
        raw_bytes = self._decode_inline_data(item)

        if mime_type.startswith("image/"):
            encoded = base64.b64encode(raw_bytes).decode("utf-8")
            return f"data:{mime_type};base64,{encoded}"

        if mime_type.startswith("audio/"):
            if not self._is_browser_playable_audio_mime_type(mime_type):
                mime_type = "audio/wav"
                raw_bytes = self._build_wave_bytes_from_pcm(item)
            encoded = base64.b64encode(raw_bytes).decode("utf-8")
            return f"data:{mime_type};base64,{encoded}"

        encoded = base64.b64encode(raw_bytes).decode("utf-8")
        return f"data:{mime_type};base64,{encoded}"

    def _format_inline_data_summary(self, item: dict[str, Any], *, is_thinking: bool = False) -> str:
        """
        Format inline_data metadata without emitting raw payloads.

        Args:
            item: inline_data content item

        Returns:
            Human-readable summary of the inline payload
        """
        mime_type = item.get("mime_type") or "application/octet-stream"
        data = item.get("data")

        if isinstance(data, str):
            byte_count = len(base64.b64decode(data.encode("utf-8")))
        else:
            byte_count = len(data) if data else 0

        # Convert bytes to KBs and MBs
        kb_count = byte_count / 1024
        mb_count = byte_count / (1024 * 1024)

        label = "Thinking " if is_thinking else ""
        if mime_type.startswith("image/"):
            label += "Inline Image"
        elif mime_type.startswith("audio/"):
            label += "Inline Audio"
        else:
            label += "Inline Data"

        if kb_count < 1000:
            return f"{label}: {mime_type} ({kb_count:.2f} KB)"
        else:
            return f"{label}: {mime_type} ({mb_count:.2f} MB)"

    @staticmethod
    def _format_embedding_preview(item: dict[str, Any]) -> str:
        values = item.get("embedding") or []
        preview = ", ".join(str(value) for value in values[:5])
        return f"Embedding: [{preview}]"

    @staticmethod
    def _normalize_base_path(base_path: str = "") -> str:
        """Normalize a URL prefix used when tracer is mounted inside another app."""
        if not base_path or base_path == "/":
            return ""
        prefixed = base_path if base_path.startswith("/") else f"/{base_path}"
        return prefixed[:-1] if prefixed.endswith("/") else prefixed

    @staticmethod
    def _prefix_url(base_path: str, url: str) -> str:
        """Prefix an internal tracer URL with the mount path."""
        if not base_path:
            return url
        if url == "/":
            return f"{base_path}/"
        return f"{base_path}{url}"

    def save_history(self, model: str, history: list[UniMessage], file_id: str, config: dict[str, Any]) -> None:
        """
        Save conversation history to files.

        Args:
            model: The model name used for this conversation
            history: List of UniMessage objects representing the conversation
            file_id: File identifier without extension (e.g., "agent1/00001")
            config: The UniConfig used for this conversation
        """
        # Create directory if needed
        file_path_base = self.cache_dir / file_id
        file_path_base.parent.mkdir(parents=True, exist_ok=True)

        config_with_model = config.copy()
        config_with_model["model"] = model
        # Save as JSON
        json_path = file_path_base.with_suffix(".json")
        json_data = {
            "history": self._serialize_for_json(history),
            "config": self._serialize_for_json(config_with_model),
            "timestamp": datetime.now().isoformat(),
        }
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(json_data, f, indent=2, ensure_ascii=False)

        # Save as human-readable text
        txt_path = file_path_base.with_suffix(".txt")
        formatted_content = self._format_history(history, config_with_model)
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(formatted_content)

    def _format_history(self, history: list[UniMessage], config: dict[str, Any]) -> str:
        """
        Format conversation history in a readable text format.

        Args:
            history: List of UniMessage objects
            config: The UniConfig used for this conversation

        Returns:
            Formatted string representation of the conversation
        """
        lines = []
        lines.append("=" * 80)
        lines.append(f"Conversation History - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        lines.append("=" * 80)
        lines.append("")

        # Add config information
        lines.append("Configuration:")
        for key, value in config.items():
            if key != "trace_id":  # Don't include trace_id itself
                if key == "tools" and isinstance(value, list):
                    lines.append(f"  {key}:")
                    lines.append(f"    {json.dumps(value, indent=2, ensure_ascii=False)}")
                else:
                    lines.append(f"  {key}: {value}")
        lines.append("")

        for i, message in enumerate(history, 1):
            role = message["role"].upper()
            lines.append(f"[{i}] {role}:")
            lines.append("-" * 80)

            for item in message["content_items"]:
                if item["type"] == "text.done":
                    lines.append(f"Text: {item['text']}")
                elif item["type"] == "thinking.done":
                    lines.append(f"Thinking: {item['thinking']}")
                elif item["type"] == "inline_thinking.done":
                    lines.append(self._format_inline_data_summary(item, is_thinking=True))
                elif item["type"] == "image_url.done":
                    lines.append(f"Image URL: {item['image_url']}")
                elif item["type"] == "inline_data.done":
                    lines.append(self._format_inline_data_summary(item))
                elif item["type"] == "embedding.done":
                    lines.append(self._format_embedding_preview(item))
                elif item["type"] == "tool_call.done":
                    lines.append(f"Tool Call: {item['name']}")
                    lines.append(f"  Arguments: {json.dumps(item['arguments'], indent=2, ensure_ascii=False)}")
                    lines.append(f"  Tool Call ID: {item['tool_call_id']}")
                elif item["type"] == "tool_result.done":
                    lines.append(f"Tool Result (ID: {item['tool_call_id']}): {item['text']}")
                    if "images" in item and item["images"]:
                        for i, image_url in enumerate(item["images"], 1):
                            lines.append(f"  Image {i}: {image_url}")

            # Add usage metadata if available
            if "usage_metadata" in message and message["usage_metadata"]:
                metadata = message["usage_metadata"]
                lines.append("\nUsage Metadata:")
                if metadata.get("cached_tokens") is not None:
                    lines.append(f"  Cached Tokens: {metadata['cached_tokens']}")
                if metadata.get("prompt_tokens") is not None:
                    lines.append(f"  Prompt Tokens: {metadata['prompt_tokens']}")
                if metadata.get("thoughts_tokens") is not None:
                    lines.append(f"  Thoughts Tokens: {metadata['thoughts_tokens']}")
                if metadata.get("response_tokens") is not None:
                    lines.append(f"  Response Tokens: {metadata['response_tokens']}")

                # Calculate and show total tokens
                # Input tokens = cached_tokens + prompt_tokens
                # Output tokens = thoughts_tokens + response_tokens
                # Total tokens = input_tokens + output_tokens
                input_tokens = (metadata.get("cached_tokens") or 0) + (metadata.get("prompt_tokens") or 0)
                output_tokens = (metadata.get("thoughts_tokens") or 0) + (metadata.get("response_tokens") or 0)
                total_tokens = input_tokens + output_tokens
                lines.append(f"  Total Tokens: {total_tokens}")

            # Add finish reason if available
            if "finish_reason" in message:
                lines.append(f"\nFinish Reason: {message['finish_reason']}")

            lines.append("")

        return "\n".join(lines)

    def create_web_app(self, base_path: str = "") -> Flask:
        """
        Create a Flask web application for browsing conversation files.

        Returns:
            Flask application instance
        """
        app = Flask(__name__)
        app.jinja_env.policies["json.dumps_kwargs"] = {"ensure_ascii": False}
        base_path = self._normalize_base_path(base_path)

        @app.template_filter("format_ts")
        def format_ts(ms: int | None) -> str:
            """Format a Unix timestamp in milliseconds as YYYY-MM-DD HH:MM:SS."""
            if ms is None:
                return ""
            return datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%d %H:%M:%S")

        @app.template_filter("inline_data_url")
        def inline_data_url(item: dict[str, Any]) -> str:
            """Build a data URL for inline_data content."""
            return self._build_inline_data_url(item)

        @app.template_filter("inline_data_summary")
        def inline_data_summary(item: dict[str, Any]) -> str:
            """Render a concise inline_data summary."""
            return self._format_inline_data_summary(item)

        @app.template_filter("inline_thinking_summary")
        def inline_thinking_summary(item: dict[str, Any]) -> str:
            """Render a concise inline_thinking summary."""
            return self._format_inline_data_summary(item, is_thinking=True)

        @app.template_filter("embedding_preview")
        def embedding_preview(item: dict[str, Any]) -> str:
            """Render the first five embedding values."""
            return self._format_embedding_preview(item)

        # HTML template for directory listing
        DIRECTORY_TEMPLATE = """
        <!DOCTYPE html>
        <html>
        <head>
            <title>Tracer</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-50 min-h-screen">
            <div class="max-w-5xl mx-auto p-6">
                <div class="flex justify-between items-center mb-6">
                    <h1 class="text-3xl font-bold text-gray-900">Tracer</h1>
                    <a href="https://github.com/Prism-Shadow/AgentHub" target="_blank" class="text-sm text-gray-500 hover:text-gray-700 transition-colors">GitHub</a>
                </div>
                <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
                    <p class="text-sm text-gray-600"><strong>Path:</strong> {{ breadcrumb|safe }}</p>
                </div>
                <div class="flex items-center gap-2 mb-3">
                    <span class="text-xs text-gray-500">Sort by:</span>
                    <a href="{{ sort_name_url }}" class="px-3 py-1 text-xs rounded border transition-colors {% if current_sort == 'name' %}bg-blue-600 text-white border-blue-600{% else %}bg-white text-gray-700 border-gray-300 hover:bg-gray-50{% endif %}">Name</a>
                    <a href="{{ sort_mtime_url }}" class="px-3 py-1 text-xs rounded border transition-colors {% if current_sort == 'mtime' %}bg-blue-600 text-white border-blue-600{% else %}bg-white text-gray-700 border-gray-300 hover:bg-gray-50{% endif %}">Modified Time</a>
                </div>
                <div class="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                    {% if items %}
                        {% for item in items %}
                            <div class="border-b border-gray-200 last:border-b-0 hover:bg-gray-50 transition-colors">
                                <a href="{{ item.url }}" class="flex items-center justify-between p-4 text-blue-600 hover:text-blue-800">
                                    <span class="flex items-center">
                                        <span class="mr-2">{% if item.is_dir %}📁{% else %}📄{% endif %}</span>
                                        <span class="text-sm">{{ item.name }}</span>
                                    </span>
                                    <span class="flex items-center gap-4">
                                        {% if item.size %}
                                        <span class="text-xs text-gray-500">{{ item.size }}</span>
                                        {% endif %}
                                        {% if item.mtime %}
                                        <span class="text-xs text-gray-400">{{ item.mtime }}</span>
                                        {% endif %}
                                    </span>
                                </a>
                            </div>
                        {% endfor %}
                    {% else %}
                        <div class="p-8 text-center text-gray-500 italic">No files or directories found.</div>
                    {% endif %}
                </div>
            </div>
        </body>
        </html>
        """

        # HTML template for JSON conversation viewing
        JSON_VIEWER_TEMPLATE = """
        <!DOCTYPE html>
        <html>
        <head>
            <title>{{ filename }}</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-50 min-h-screen">
            {% set total_rounds = ((history|length) + 1) // 2 %}
            <div class="flex gap-6 p-6 max-w-7xl mx-auto">
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-center mb-4">
                        <h1 class="text-3xl font-bold text-gray-900">{{ filename }}</h1>
                        <a href="https://github.com/Prism-Shadow/AgentHub" target="_blank" class="text-sm text-gray-500 hover:text-gray-700 transition-colors">GitHub</a>
                    </div>
                    <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
                        <p class="text-sm text-gray-600"><strong>Path:</strong> {{ breadcrumb|safe }}</p>
                    </div>
                    <a href="{{ back_url }}" class="inline-block mb-6 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-md border border-gray-300 text-sm transition-colors">
                        ← Back to Directory
                    </a>
                    {% if config %}
                    <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
                        <h2 class="text-xl font-semibold text-gray-900 mb-4">Configuration</h2>
                        {% for key, value in config.items() %}
                            {% if key != 'trace_id' %}
                            <div class="py-2 text-sm">
                                <strong class="text-gray-900">{{ key|e }}:</strong>
                                {% if key == 'system_prompt' and value is not none %}
                                    <button onclick="toggleConfig('{{ key|e }}')" class="ml-2 inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded border border-gray-300 transition-colors"><span id="icon-{{ key|e }}" class="transform transition-transform">▶</span> Show</button>
                                    <div id="content-{{ key|e }}" class="mt-1 p-2 bg-gray-50 rounded text-xs whitespace-pre-wrap hidden">{{ value|e }}</div>
                                {% elif key == 'tools' and value is iterable and value is not string %}
                                    <button onclick="toggleConfig('{{ key|e }}')" class="ml-2 inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded border border-gray-300 transition-colors"><span id="icon-{{ key|e }}" class="transform transition-transform">▶</span> Show</button>
                                    <div id="content-{{ key|e }}" class="mt-1 p-2 bg-gray-50 rounded text-xs whitespace-pre-wrap hidden">{{ value|tojson(indent=2)|e }}</div>
                                {% else %}
                                    <span class="text-gray-600">{{ value|e }}</span>
                                {% endif %}
                            </div>
                            {% endif %}
                        {% endfor %}
                    </div>
                    {% endif %}

                    {% for msg_idx, message in enumerate(history) %}
                    <div class="bg-white rounded-lg shadow-sm border border-gray-200 mb-4 overflow-hidden" id="msg-{{ msg_idx }}">
                        <div class="bg-gray-50 border-b border-gray-200 p-4 cursor-pointer hover:bg-gray-100 transition-colors" onclick="toggleMessage({{ msg_idx }})">
                            <div class="flex justify-between items-center">
                                <div class="flex items-center gap-3">
                                    <span class="font-semibold text-sm uppercase {% if message.role == 'user' %}text-blue-600{% else %}text-green-600{% endif %}">{{ message.role }}</span>
                                    <span class="text-xs text-gray-500">• {{ message.content_items|length }} item(s)</span>
                                    <span class="text-xs text-gray-400">• Round {{ msg_idx // 2 + 1 }} / {{ total_rounds }}</span>
                                </div>
                                <div class="flex items-center gap-3">
                                    {% if msg_idx > 0 and message.created_at and history[msg_idx - 1].created_at %}
                                    <span class="text-xs text-gray-400">Took {{ (message.created_at - history[msg_idx - 1].created_at) | abs }} ms</span>
                                    {% endif %}
                                    {% if message.created_at %}
                                    <span class="text-xs text-gray-400">{{ message.created_at | format_ts }}</span>
                                    {% endif %}
                                    <span class="text-gray-400 transform transition-transform" id="icon-{{ msg_idx }}">▶</span>
                                </div>
                            </div>
                        </div>
                        <div class="p-6 hidden" id="content-{{ msg_idx }}">
                            {% for item in message.content_items %}
                                <div class="mb-4 pb-4 border-b border-gray-100 last:border-b-0 last:mb-0 last:pb-0">
                                    <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{{ item.type|e }}</div>
                                    {% if item.type == 'text.done' %}
                                        <div class="bg-gray-50 p-4 rounded-md font-mono text-sm whitespace-pre-wrap text-gray-800">{{ item.text|e }}</div>
                                    {% elif item.type == 'thinking.done' %}
                                        <div class="bg-blue-50 p-4 rounded-md border-l-4 border-blue-500 font-mono text-sm whitespace-pre-wrap text-gray-800">{{ item.thinking|e }}</div>
                                    {% elif item.type == 'inline_thinking.done' %}
                                        <div class="bg-blue-50 border-blue-500 p-4 rounded-md border-l-4">
                                            <div class="text-xs text-blue-700 mb-2">{{ item|inline_thinking_summary }}</div>
                                            {% if item.mime_type and item.mime_type.startswith('image/') %}
                                                <img src="{{ item|inline_data_url|e }}" class="max-w-xs max-h-48 rounded-md" alt="Thinking Inline Image">
                                            {% else %}
                                                <div class="font-mono text-sm whitespace-pre-wrap text-gray-800">
                                                    {{ item|inline_thinking_summary }}
                                                </div>
                                            {% endif %}
                                        </div>
                                    {% elif item.type == 'tool_call.done' %}
                                        <div class="bg-yellow-50 p-4 rounded-md border-l-4 border-yellow-500">
                                            <div class="font-mono text-sm whitespace-pre-wrap text-gray-800">{{ item.name|e }}({% for key, value in item.arguments.items() %}{{ key|e }}="{{ value|e }}"{% if not loop.last %}, {% endif %}{% endfor %})</div>
                                        </div>
                                    {% elif item.type == 'tool_result.done' %}
                                        <div class="bg-green-50 p-4 rounded-md border-l-4 border-green-500">
                                            <strong class="text-sm text-gray-900">Result:</strong> <span class="text-sm text-gray-700">{{ item.text|e }}</span><br>
                                            <strong class="text-sm text-gray-900">Call ID:</strong> <span class="text-sm text-gray-700">{{ item.tool_call_id|e }}</span>
                                            {% if item.images %}
                                                <div class="mt-2 flex flex-wrap gap-2">
                                                    {% for image_url in item.images %}
                                                        <img src="{{ image_url|e }}" class="max-w-xs max-h-48 rounded-md" alt="Tool Result Image">
                                                    {% endfor %}
                                                </div>
                                            {% endif %}
                                        </div>
                                    {% elif item.type == 'image_url.done' %}
                                        <div class="bg-gray-50 p-4 rounded-md">
                                            <img src="{{ item.image_url|e }}" class="max-w-xs max-h-48 rounded-md" alt="Preview">
                                        </div>
                                    {% elif item.type == 'inline_data.done' %}
                                        <div class="bg-purple-50 border-purple-500 p-4 rounded-md border-l-4">
                                            <div class="text-xs text-purple-700 mb-2">{{ item|inline_data_summary }}</div>
                                            {% if item.mime_type and item.mime_type.startswith('image/') %}
                                                <img src="{{ item|inline_data_url|e }}" class="max-w-xs max-h-48 rounded-md" alt="Inline Image">
                                            {% elif item.mime_type and item.mime_type.startswith('audio/') %}
                                                <audio controls preload="metadata" class="max-w-xs">
                                                    <source src="{{ item|inline_data_url|e }}">
                                                </audio>
                                            {% else %}
                                                <div class="font-mono text-sm whitespace-pre-wrap text-gray-800">
                                                    {{ item|inline_data_summary }}
                                                </div>
                                            {% endif %}
                                        </div>
                                    {% elif item.type == 'embedding.done' %}
                                        <div class="bg-indigo-50 p-4 rounded-md border-l-4 border-indigo-500">
                                            <div class="font-mono text-sm whitespace-pre-wrap text-gray-800">{{ item|embedding_preview|e }}</div>
                                        </div>
                                    {% endif %}
                                </div>
                            {% endfor %}

                            {% if message.usage_metadata or message.finish_reason %}
                            <div class="mt-4 pt-4 border-t border-gray-200 text-right text-xs text-gray-500">
                                {% if message.usage_metadata %}
                                    {% set parts = [] %}
                                    {% if message.usage_metadata.cached_tokens %}{% set _ = parts.append('Cached: ' ~ message.usage_metadata.cached_tokens ~ ' tokens') %}{% endif %}
                                    {% if message.usage_metadata.prompt_tokens %}{% set _ = parts.append('Prompt: ' ~ message.usage_metadata.prompt_tokens ~ ' tokens') %}{% endif %}
                                    {% if message.usage_metadata.thoughts_tokens %}{% set _ = parts.append('Thoughts: ' ~ message.usage_metadata.thoughts_tokens ~ ' tokens') %}{% endif %}
                                    {% if message.usage_metadata.response_tokens %}{% set _ = parts.append('Response: ' ~ message.usage_metadata.response_tokens ~ ' tokens') %}{% endif %}
                                    {% set input_tokens = (message.usage_metadata.cached_tokens or 0) + (message.usage_metadata.prompt_tokens or 0) %}
                                    {% set output_tokens = (message.usage_metadata.thoughts_tokens or 0) + (message.usage_metadata.response_tokens or 0) %}
                                    {% set total_tokens = input_tokens + output_tokens %}
                                    {% set _ = parts.append('Total: ' ~ total_tokens ~ ' tokens') %}
                                    {{ parts|join(' • ') }}
                                {% endif %}
                                {% if message.finish_reason %}{% if message.usage_metadata %} • {% endif %}Finish: {{ message.finish_reason|e }}{% endif %}
                            </div>
                            {% endif %}
                        </div>
                    </div>
                    {% endfor %}
                </div>

                <div class="w-52 flex-shrink-0">
                    <div class="sticky top-6 bg-white rounded-lg shadow-sm border border-gray-200 p-4 max-h-[calc(100vh-3rem)] overflow-y-auto">
                        <h3 class="font-semibold text-sm text-gray-900 mb-3">Rounds ({{ total_rounds }})</h3>
                        {% for round_idx in range(total_rounds) %}
                            {% set user_idx = round_idx * 2 %}
                            {% set assistant_idx = round_idx * 2 + 1 %}
                            <div class="mb-2 flex items-center gap-1">
                                <a href="#msg-{{ user_idx }}" class="text-xs font-medium text-gray-700 hover:text-blue-600">
                                    Round {{ round_idx + 1 }}
                                </a>
                                {% if round_idx > 0 and assistant_idx < history|length and (round_idx - 1) * 2 + 1 < history|length %}
                                    {% set curr_ts = history[assistant_idx].created_at %}
                                    {% set prev_ts = history[(round_idx - 1) * 2 + 1].created_at %}
                                    {% if curr_ts and prev_ts %}
                                    <span class="text-xs text-gray-400">({{ (curr_ts - prev_ts) | abs }} ms)</span>
                                    {% endif %}
                                {% endif %}
                            </div>
                        {% endfor %}
                    </div>
                </div>
            </div>
            <script>
                function toggleConfig(key) {
                    const content = document.getElementById('content-' + key);
                    const icon = document.getElementById('icon-' + key);
                    content.classList.toggle('hidden');
                    icon.classList.toggle('rotate-90');
                }
                function toggleMessage(idx) {
                    const content = document.getElementById('content-' + idx);
                    const icon = document.getElementById('icon-' + idx);
                    content.classList.toggle('hidden');
                    icon.classList.toggle('rotate-90');
                }
                // Expand all messages by default
                const numMessages = {{ history|length }};
                for (let i = 0; i < numMessages; i++) {
                    toggleMessage(i);
                }
            </script>
        </body>
        </html>
        """

        # HTML template for text file viewing
        TEXT_VIEWER_TEMPLATE = """
        <!DOCTYPE html>
        <html>
        <head>
            <title>{{ filename }}</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-50 min-h-screen">
            <div class="max-w-5xl mx-auto p-6">
                <div class="flex justify-between items-center mb-4">
                    <h1 class="text-3xl font-bold text-gray-900">{{ filename }}</h1>
                    <a href="https://github.com/Prism-Shadow/AgentHub" target="_blank" class="text-sm text-gray-500 hover:text-gray-700 transition-colors">GitHub</a>
                </div>
                <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
                    <p class="text-sm text-gray-600"><strong>Path:</strong> {{ breadcrumb|safe }}</p>
                </div>
                <a href="{{ back_url|e }}" class="inline-block mb-6 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-md border border-gray-300 text-sm transition-colors">
                    ← Back to Directory
                </a>
                <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6 overflow-x-auto">
                    <div class="font-mono text-sm text-gray-800 whitespace-pre-wrap">{{ content|e }}</div>
                </div>
            </div>
        </body>
        </html>
        """

        @app.route("/")
        @app.route("/<path:subpath>")
        def browse(subpath: str = "") -> str | Response:
            """Browse files and directories in the cache folder."""
            full_path = self.cache_dir / subpath
            full_path = full_path.resolve()

            # Security check: ensure path is within cache_dir
            if not str(full_path).startswith(str(self.cache_dir.resolve())):
                return "Access denied", 403

            # If path doesn't exist
            if not full_path.exists():
                return "Path not found", 404

            # If it's a file, display its content
            if full_path.is_file():
                try:
                    # Build breadcrumb
                    parts = subpath.split("/") if subpath else []
                    breadcrumb_parts = [f'<a href="{self._prefix_url(base_path, "/")}">cache</a>']
                    for i, part in enumerate(parts[:-1]):
                        path_to_part = "/".join(parts[: i + 1])
                        breadcrumb_parts.append(
                            f'<a href="{self._prefix_url(base_path, "/" + path_to_part)}">{part}</a>'
                        )
                    breadcrumb_parts.append(f"<strong>{parts[-1]}</strong>" if parts else "")
                    breadcrumb = " / ".join(breadcrumb_parts)

                    # Determine back URL
                    back_url = self._prefix_url(
                        base_path,
                        "/" + "/".join(parts[:-1]) if len(parts) > 1 else "/",
                    )

                    # If it's a JSON file, render with the JSON viewer
                    if full_path.suffix == ".json":
                        with open(full_path, "r", encoding="utf-8") as f:
                            data = json.load(f)
                        # trace files written before 0.5.0 carry the legacy content item types
                        history = normalize_legacy_messages(data.get("history", []))

                        return render_template_string(
                            JSON_VIEWER_TEMPLATE,
                            filename=full_path.name,
                            breadcrumb=breadcrumb,
                            back_url=back_url,
                            history=history,
                            config=data.get("config", {}),
                            enumerate=enumerate,
                        )
                    else:
                        # For text files, use simple viewer
                        with open(full_path, "r", encoding="utf-8") as f:
                            content = f.read()

                        return render_template_string(
                            TEXT_VIEWER_TEMPLATE,
                            filename=full_path.name,
                            content=content,
                            breadcrumb=breadcrumb,
                            back_url=back_url,
                        )
                except Exception as e:
                    return f"Error reading file: {str(e)}", 500

            # If it's a directory, list its contents
            sort_by = request.args.get("sort", "name")
            if sort_by not in ("name", "mtime"):
                sort_by = "name"

            items = []
            try:
                with os.scandir(full_path) as scanner:
                    raw_entries = [entry for entry in scanner if entry.name != ".DS_Store"]

                # Filter entries that pass the security check first
                safe_entries: list[tuple[os.DirEntry, Path]] = []
                for entry in raw_entries:
                    try:
                        relative_path = Path(entry.path).resolve().relative_to(self.cache_dir.resolve())
                        safe_entries.append((entry, relative_path))
                    except ValueError:
                        # If relative_to fails, skip this entry for security
                        continue

                # Pre-compute stat for each safe entry exactly once
                entry_stats = {entry.name: entry.stat() for entry, _ in safe_entries}

                if sort_by == "mtime":
                    safe_entries.sort(key=lambda x: (not x[0].is_dir(), -entry_stats[x[0].name].st_mtime))
                else:
                    safe_entries.sort(key=lambda x: (not x[0].is_dir(), x[0].name))

                for entry, relative_path in safe_entries:
                    stat = entry_stats[entry.name]
                    item_info: dict[str, Any] = {
                        "name": entry.name,
                        "is_dir": entry.is_dir(),
                        "url": self._prefix_url(base_path, f"/{relative_path}"),
                        "mtime": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
                    }
                    if entry.is_file():
                        size = stat.st_size
                        if size < 1024:
                            item_info["size"] = f"{size} B"
                        elif size < 1024 * 1024:
                            item_info["size"] = f"{size / 1024:.1f} KB"
                        else:
                            item_info["size"] = f"{size / (1024 * 1024):.1f} MB"
                    items.append(item_info)
            except Exception as e:
                return f"Error listing directory: {str(e)}", 500

            # Build breadcrumb
            parts = subpath.split("/") if subpath else []
            breadcrumb_parts = [f'<a href="{self._prefix_url(base_path, "/")}">cache</a>']
            for i, part in enumerate(parts):
                if part:
                    path_to_part = "/".join(parts[: i + 1])
                    breadcrumb_parts.append(f'<a href="{self._prefix_url(base_path, "/" + path_to_part)}">{part}</a>')
            breadcrumb = " / ".join(breadcrumb_parts)

            base_url = self._prefix_url(base_path, "/" + subpath if subpath else "/")
            sort_name_url = base_url + "?sort=name"
            sort_mtime_url = base_url + "?sort=mtime"

            return render_template_string(
                DIRECTORY_TEMPLATE,
                items=items,
                breadcrumb=breadcrumb,
                current_sort=sort_by,
                sort_name_url=sort_name_url,
                sort_mtime_url=sort_mtime_url,
            )

        return app

    def start_web_server(self, host: str = "127.0.0.1", port: int = 25750, debug: bool = False) -> None:
        """
        Start the web server for browsing conversation files.

        Args:
            host: Host address to bind to
            port: Port number to listen on
            debug: Enable debug mode
        """
        app = self.create_web_app()
        print(f"Starting tracer web server at http://{host}:{port}")
        print(f"Cache directory: {self.cache_dir.resolve()}")
        app.run(host=host, port=port, debug=debug)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Start the Tracer web server for browsing conversation files")
    parser.add_argument("--cache_dir", type=str, default=None, help="Directory to store conversation history files")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host address to bind to")
    parser.add_argument("--port", type=int, default=25750, help="Port number to listen on")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode")

    args = parser.parse_args()

    tracer = Tracer(cache_dir=args.cache_dir)
    tracer.start_web_server(host=args.host, port=args.port, debug=args.debug)
