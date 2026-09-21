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
Example demonstrating conversation tracing functionality.

This example shows how to:
1. Use trace_id in UniConfig to save conversation history to files
2. Start a web server to browse and view saved conversations
3. Use tool calling with tracing
"""

import asyncio
import os
import threading
import time

from agenthub import AutoLLMClient
from agenthub.integration.tracer import Tracer


def get_weather(location: str) -> str:
    """Mock function to get weather for a location."""
    weather_data = {
        "London": "15°C and cloudy",
        "San Francisco": "18°C and sunny",
        "Tokyo": "22°C and clear",
    }
    return weather_data.get(location, "20°C and partly cloudy")


async def run_traced_chat():
    """Run conversations with tracing enabled."""
    # Get model from environment variable, default to gpt-5.5
    model = os.getenv("MODEL", "gpt-5.5")
    print(f"Using model: {model}")

    client = AutoLLMClient(model=model)

    # Configure with trace_id to save history (no file extension)
    config = {"trace_id": "agent1/conversation_001"}

    query1 = "My name is Alice and I like cats."
    async for _ in client.streaming_response_stateful(
        message={"role": "user", "content_items": [{"type": "text.done", "text": query1}]}, config=config
    ):
        pass

    query2 = "What's my name and what do I like?"
    async for _ in client.streaming_response_stateful(
        message={"role": "user", "content_items": [{"type": "text.done", "text": query2}]}, config=config
    ):
        pass

    print("\nConversation saved to cache/agent1/conversation_001.json and .txt")

    # Second conversation - agent2 (with tool calling)
    client2 = AutoLLMClient(model=model)

    # Define the weather function
    weather_function = {
        "name": "get_weather",
        "description": "Gets the current weather for a given location.",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "The city name, e.g. San Francisco",
                },
            },
            "required": ["location"],
        },
    }
    config2 = {"trace_id": "session_123", "tools": [weather_function]}

    query3 = "What's the weather in London?"
    # First turn - model will request tool call
    events = []
    async for event in client2.streaming_response_stateful(
        message={"role": "user", "content_items": [{"type": "text.done", "text": query3}]}, config=config2
    ):
        events.append(event)

    # Check if there's a tool call in the events
    tool_call = None
    for event in events:
        for item in event["content_items"]:
            if item["type"] == "tool_call.done":
                tool_call = item
                break

        if tool_call:
            break

    if tool_call:
        # Execute the tool
        result = get_weather(tool_call["arguments"]["location"])

        # Send tool result back
        async for _ in client2.streaming_response_stateful(
            message={
                "role": "user",
                "content_items": [
                    {"type": "tool_result.done", "text": result, "tool_call_id": tool_call["tool_call_id"]}
                ],
            },
            config=config2,
        ):
            pass

    print("\nConversation saved to cache/session_123.json and .txt")


def start_web_server():
    """Start the web server in a background thread."""
    tracer = Tracer()
    tracer.start_web_server(host="127.0.0.1", port=25750, debug=False)


async def main():
    """Main function."""
    print("=" * 60)
    print("Conversation Trace Example")
    print("=" * 60)

    print("\n" + "=" * 60)
    print("Starting Web Server")
    print("=" * 60)
    print("\nYou can now browse the conversations at http://127.0.0.1:25750")
    print("Press Ctrl+C to stop the server.\n")

    # Start web server in a background thread
    server_thread = threading.Thread(target=start_web_server, daemon=True)
    server_thread.start()

    # Run traced chat
    await run_traced_chat()

    # Keep the main thread alive
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n\nShutting down...")


if __name__ == "__main__":
    asyncio.run(main())
