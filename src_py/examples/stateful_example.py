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
Example demonstrating stateful stream generation.

This example shows how to use the AutoLLMClient with automatic conversation history management.
"""

import asyncio
import os

from agenthub import AutoLLMClient, ThinkingLevel


async def main():
    """Example of stateful stream generation."""
    print("=" * 60)
    print("Stateful Example")
    print("=" * 60)

    # Get model from environment variable, default to gpt-5.5
    model = os.getenv("MODEL", "gpt-5.5")
    print(f"Using model: {model}")

    client = AutoLLMClient(model=model)
    config = {"thinking_summary": True, "thinking_level": ThinkingLevel.HIGH}

    # First message
    query1 = "My name is Alice"
    print("User:", query1)
    print("Assistant:")
    async for event in client.streaming_response_stateful(
        message={"role": "user", "content_items": [{"type": "text.done", "text": query1}]}, config=config
    ):
        print(event)

    # Second message - history is maintained
    query2 = "What's my name?"
    print("User:", query2)
    print("Assistant:")
    async for event in client.streaming_response_stateful(
        message={"role": "user", "content_items": [{"type": "text.done", "text": query2}]}, config=config
    ):
        print(event)

    print("History:")
    for i, msg in enumerate(client.get_history(), 1):
        print(f"[{i}] {msg}")


if __name__ == "__main__":
    asyncio.run(main())
