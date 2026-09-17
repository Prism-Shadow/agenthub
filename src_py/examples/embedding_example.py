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
Example demonstrating text embedding with dimensions configuration.

This example shows how to generate embeddings through streaming_response
with a specified output dimensionality.
"""

import asyncio
import os

from agenthub import AutoLLMClient


async def main():
    """Example of text embedding with dimensionality configuration."""
    print("=" * 60)
    print("Text Embedding Example")
    print("=" * 60)

    model = os.getenv("MODEL", "gemini-embedding-2")
    print(f"Using model: {model}")

    client = AutoLLMClient(model=model)

    texts = [
        "What is the meaning of life?",
        "What is the purpose of existence?",
        "How do I bake a cake?",
    ]

    print(f"Generating embeddings for {len(texts)} texts with dimensions=768...")
    events = []
    async for event in client.streaming_response(
        messages=[{"role": "user", "content_items": [{"type": "text.done", "text": text}]} for text in texts],
        config={"embedding_config": {"dimensions": 768}},
    ):
        events.append(event)

    embeddings = [
        item["embedding"] for event in events for item in event["content_items"] if item["type"] == "embedding.done"
    ]

    for i, embedding in enumerate(embeddings):
        print(f'\nText {i}: "{texts[i]}"')
        print(f"  Embedding dimension: {len(embedding)}")
        print(f"  First 5 values: {embedding[:5]}")

    print(f"\nModel: {model}")
    print("\n" + "=" * 60)
    print("Text embedding complete!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
