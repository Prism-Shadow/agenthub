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
Example demonstrating image understanding capability.

This example shows how to use the AutoLLMClient to analyze images.
"""

import asyncio
import os

from agenthub import AutoLLMClient


async def main():
    """Example of image understanding with AutoLLMClient."""
    print("=" * 60)
    print("Image Understanding Example")
    print("=" * 60)

    # Get model from environment variable, default to gpt-5.5
    model = os.getenv("MODEL", "gpt-5.5")
    print(f"Using model: {model}")

    client = AutoLLMClient(model=model)
    config = {}

    # Image URL from the problem statement
    image_url = "https://cdn.britannica.com/80/120980-050-D1DA5C61/Poet-narcissus.jpg"

    query = "What's in this image? Please describe what you see."
    print(f"User: {query}")
    print(f"Image: {image_url}")
    print("Assistant:")

    async for event in client.streaming_response(
        messages=[
            {
                "role": "user",
                "content_items": [
                    {"type": "text.done", "text": query},
                    {"type": "image_url.done", "image_url": image_url},
                ],
            }
        ],
        config=config,
    ):
        print(event)

    print("\n" + "=" * 60)
    print("Image analysis complete!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
