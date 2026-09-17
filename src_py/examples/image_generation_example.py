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
Example demonstrating streamed Gemini image editing.

This example sends a public cat image URL plus a text edit instruction, then prints
each streamed event with binary fields redacted so the event structure is easy
to inspect in the terminal.
"""

import asyncio
import os
from io import BytesIO
from pathlib import Path

from PIL import Image

from agenthub import AutoLLMClient, ThinkingLevel


CAT_IMAGE_URL = "https://images.unsplash.com/photo-1519052537078-e6302a4968d4?auto=format&fit=crop&w=800&q=80"


async def main() -> None:
    print("=" * 60)
    print("Image Generation Example")
    print("=" * 60)

    model = os.getenv("MODEL", "gemini-3.1-flash-image-preview")
    print(f"Using model: {model}")

    client = AutoLLMClient(model=model)
    prompt = "Create a picture of my cat eating a nano-banana in a fancy restaurant under the Gemini constellation."
    print(f"User: {prompt}")
    print(f"Image: {CAT_IMAGE_URL}")
    print("Assistant:")

    config = {
        "image_config": {"aspect_ratio": "16:9", "image_size": "1K"},
        "thinking_summary": True,
        "thinking_level": ThinkingLevel.HIGH,
    }

    i = 0
    async for event in client.streaming_response(
        messages=[
            {
                "role": "user",
                "content_items": [
                    {"type": "text.done", "text": prompt},
                    # edit the input image or generate a new one
                    {"type": "image_url.done", "image_url": CAT_IMAGE_URL},
                ],
            }
        ],
        config=config,
    ):
        for item in event["content_items"]:
            if item["type"] == "text.done":
                print(f"Text: {item['text']}")
            elif item["type"] == "inline_data.done":
                i += 1
                image = Image.open(BytesIO(item["data"]))
                output_format = image.format or "PNG"
                output_path = Path.cwd() / f"generated_image_{i}.{output_format.lower()}"
                image.save(output_path, format=output_format)
                print(f"Saved image to: {output_path}")

    print("\n" + "=" * 60)
    print("Image generation complete!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
