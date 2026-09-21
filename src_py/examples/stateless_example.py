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
Example demonstrating stateless stream generation.

This example shows how to use the AutoLLMClient without maintaining conversation history.
"""

import asyncio
import os

from agenthub import AutoLLMClient


async def main():
    """Example of stateless stream generation."""
    print("=" * 60)
    print("Stateless Example")
    print("=" * 60)

    # Get model from environment variable, default to gpt-5.5
    model = os.getenv("MODEL", "gpt-5.5")
    print(f"Using model: {model}")

    client = AutoLLMClient(model=model)
    config = {}

    query = "Hello! What's 2+2?"
    print("User:", query)
    print("Assistant:")
    async for event in client.streaming_response(
        messages=[{"role": "user", "content_items": [{"type": "text.done", "text": query}]}], config=config
    ):
        print(event)


if __name__ == "__main__":
    asyncio.run(main())
