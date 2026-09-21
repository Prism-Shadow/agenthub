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
Example demonstrating speech generation.

This example sends a text-only prompt with transcript tags such as [excitedly],
collects the returned audio chunks, and saves the final output as a WAV file.
"""

import asyncio
import os
import wave
from pathlib import Path

from agenthub import AutoLLMClient


async def main():
    """Example of speech generation."""
    print("=" * 60)
    print("Speech Generation Example")
    print("=" * 60)

    # Get model from environment variable, default to gemini-3.1-flash-tts-preview
    model = os.getenv("MODEL", "gemini-3.1-flash-tts-preview")
    print(f"Using model: {model}")

    client = AutoLLMClient(model=model)
    prompt = """Synthesize speech for the transcript below using a single speaker.

### TRANSCRIPT
[excitedly] Welcome to AgentHub! We just added Gemini text-to-speech support.
[very slow] This demo saves the generated audio as a WAV file so you can play it back right away.
[whispers] And yes, prompt tags like this can shape the performance.
"""

    print(f"User: {prompt}")
    print("Assistant:")

    audio_chunks: list[bytes] = []
    async for event in client.streaming_response(
        messages=[{"role": "user", "content_items": [{"type": "text.done", "text": prompt}]}],
        config={"tts_config": [{"voice": "Kore"}]},
    ):
        for item in event["content_items"]:
            if item["type"] == "inline_data.done":
                audio_chunks.append(item["data"])

    if not audio_chunks:
        raise RuntimeError("No audio data was returned by the model.")

    output_path = Path.cwd() / "generated_audio.wav"
    with wave.open(str(output_path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(24000)
        wav_file.writeframes(b"".join(audio_chunks))

    print(f"Saved WAV file to: {output_path}")
    print("\n" + "=" * 60)
    print("Gemini TTS complete!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
