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

import re
from typing import Any

import pytest

from agenthub import AutoLLMClient


IMAGE_URL = "https://example.com/image.png"

# The two places the transform can put an input_image on the wire: a user turn's content and a
# function call output.
IMAGE_PART: list[dict[str, Any]] = [
    {
        "role": "user",
        "content_items": [
            {"type": "text", "text": "What is in this image?"},
            {"type": "image_url", "image_url": IMAGE_URL},
        ],
    }
]
TOOL_RESULT_IMAGE: list[dict[str, Any]] = [
    {
        "role": "user",
        "content_items": [
            {
                "type": "tool_result",
                "text": "The screenshot.",
                "tool_call_id": "call_1",
                "images": [IMAGE_URL],
            }
        ],
    }
]

# The bare id decides, so the gateway spellings belong on the list too: OpenRouter names the
# model deepseek/deepseek-v4-flash and SiliconFlow deepseek-ai/DeepSeek-V4-Flash.
TEXT_ONLY_MODELS = [
    "deepseek-v4-flash",
    "deepseek-v4-pro",
    "deepseek-v4-flash-0731",
    "deepseek/deepseek-v4-flash",
    "deepseek-ai/DeepSeek-V4-Flash",
]
IMAGE_MODELS = ["deepseek-v4-flash-vision-exp", "deepseek-v4.1-flash"]


def _deepseek_client(model: str) -> Any:
    client = AutoLLMClient(model=model, api_key="test-key", client_type="deepseek-v4")
    routed_client = client._client  # noqa: SLF001
    assert routed_client.__class__.__name__ == "DeepSeekV4Client"
    return routed_client


@pytest.mark.parametrize("model", TEXT_ONLY_MODELS)
def test_text_only_model_refuses_an_image_part(model: str):
    with pytest.raises(ValueError, match=re.escape(f"DeepSeek {model} does not support image inputs.")):
        _deepseek_client(model).transform_uni_message_to_model_input(IMAGE_PART)


@pytest.mark.parametrize("model", TEXT_ONLY_MODELS)
def test_text_only_model_refuses_an_image_in_a_tool_result(model: str):
    with pytest.raises(ValueError, match=re.escape(f"DeepSeek {model} does not support images in tool results.")):
        _deepseek_client(model).transform_uni_message_to_model_input(TOOL_RESULT_IMAGE)


@pytest.mark.parametrize("model", IMAGE_MODELS)
def test_image_model_forwards_an_image_part(model: str):
    model_input = _deepseek_client(model).transform_uni_message_to_model_input(IMAGE_PART)

    assert {"type": "input_image", "image_url": IMAGE_URL} in model_input[0]["content"]


@pytest.mark.parametrize("model", IMAGE_MODELS)
def test_image_model_forwards_an_image_in_a_tool_result(model: str):
    model_input = _deepseek_client(model).transform_uni_message_to_model_input(TOOL_RESULT_IMAGE)

    assert {"type": "input_image", "image_url": IMAGE_URL} in model_input[0]["output"]
