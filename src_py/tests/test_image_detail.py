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

import base64
import inspect
import json
import struct
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import pytest

from agenthub import AutoLLMClient
from agenthub.utils import exceeds_openai_patch_limit, image_dimensions


# Header builders. Only the bytes the parser reads have to be right, so none of these is a
# decodable picture; a real file carries the same leading bytes.
def _png(width: int, height: int) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", width, height)


def _gif(width: int, height: int) -> bytes:
    return b"GIF89a" + struct.pack("<HH", width, height) + bytes(3)


def _sof(width: int, height: int, marker: int = 0xC0) -> bytes:
    """A frame header: baseline (SOF0) by default, progressive with 0xC2."""
    return bytes([0xFF, marker]) + struct.pack(">HBHHB", 8, 8, height, width, 3)


def _jpeg(width: int, height: int, metadata_bytes: int = 0) -> bytes:
    """
    The frame header follows `metadata_bytes` of APP1 payload, the way EXIF does; a segment
    holds at most 65,533 bytes, so a larger amount spans several of them.
    """
    parts = [b"\xff\xd8"]
    remaining = metadata_bytes
    while True:
        payload = min(remaining, 65533)
        parts.append(b"\xff\xe1" + struct.pack(">H", 2 + payload) + bytes(payload))
        remaining -= payload
        if remaining <= 0:
            break

    parts.append(_sof(width, height))
    return b"".join(parts)


def _riff(chunk: bytes, payload: bytes) -> bytes:
    return (
        b"RIFF" + struct.pack("<I", 4 + 8 + len(payload)) + b"WEBP" + chunk + struct.pack("<I", len(payload)) + payload
    )


def _webp_lossy(width: int, height: int) -> bytes:
    """The scaling bits above the 14-bit size are set, to prove they are masked off."""
    return _riff(b"VP8 ", bytes(3) + b"\x9d\x01\x2a" + struct.pack("<HH", width | (2 << 14), height | (1 << 14)))


def _webp_lossless(width: int, height: int) -> bytes:
    """The alpha flag above the two 14-bit sizes is set, to prove it is masked off."""
    bits = (width - 1) | ((height - 1) << 14) | (1 << 28)
    return _riff(b"VP8L", b"\x2f" + struct.pack("<I", bits) + bytes(5))


def _webp_extended(width: int, height: int) -> bytes:
    return _riff(b"VP8X", b"\x10\x00\x00\x00" + (width - 1).to_bytes(3, "little") + (height - 1).to_bytes(3, "little"))


def _data_url(data: bytes, mime: str = "image/png") -> str:
    return f"data:{mime};base64," + base64.b64encode(data).decode("ascii")


# A JPEG whose frame header follows the SOI directly, and a progressive one that puts fill bytes,
# an empty APP1 segment and a restart marker ahead of it.
_SOF_FIRST_JPEG = b"\xff\xd8" + _sof(4032, 3024)
_PROGRESSIVE_JPEG = b"\xff\xd8\xff\xff\xff\xe1\x00\x02\xff\xd0" + _sof(4032, 3024, 0xC2)

# Payloads an encoder other than the clients' own may produce: wrapped at 76 columns the way
# `base64.encodebytes` and MIME tooling do, without its padding, and in the URL-safe alphabet.
_WRAPPED_URL = "data:image/png;base64," + base64.encodebytes(_png(6400, 8608) + bytes(100 * 1024)).decode("ascii")
_UNPADDED_URL = _data_url(_jpeg(8000, 8000, 100 * 1024) + b"\x00", "image/jpeg").rstrip("=")
_URL_SAFE_URL = "data:image/png;base64," + base64.urlsafe_b64encode(
    _png(6400, 8608) + b"\xfb\xff\xbf" * 4 + b"\xfb"
).decode("ascii")


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        pytest.param(_png(6400, 8608), (6400, 8608), id="PNG"),
        pytest.param(_gif(640, 480), (640, 480), id="GIF"),
        pytest.param(_jpeg(4032, 3024), (4032, 3024), id="JPEG"),
        pytest.param(_jpeg(4032, 3024, 100 * 1024), (4032, 3024), id="JPEG behind 100 KiB of metadata"),
        pytest.param(_SOF_FIRST_JPEG, (4032, 3024), id="JPEG whose frame header comes first"),
        pytest.param(_PROGRESSIVE_JPEG, (4032, 3024), id="progressive JPEG behind fill bytes and a restart marker"),
        pytest.param(_webp_lossy(1920, 1080), (1920, 1080), id="lossy WebP"),
        pytest.param(_webp_lossless(1920, 1080), (1920, 1080), id="lossless WebP"),
        pytest.param(_webp_extended(1920, 1080), (1920, 1080), id="extended WebP"),
    ],
)
def test_image_dimensions_reads_the_header(data: bytes, expected: tuple[int, int]):
    assert image_dimensions(data) == expected


@pytest.mark.parametrize(
    "data",
    [
        pytest.param(b"", id="empty input"),
        pytest.param(b"not an image", id="text"),
        pytest.param(_png(6400, 8608)[:16], id="a PNG cut before its IHDR chunk"),
        pytest.param(
            b"\x00PNG" + bytes(8) + b"IHDR" + bytes(8), id="bytes that spell PNG and IHDR without the PNG signature"
        ),
        pytest.param(b"GIFxxx" + bytes(7), id="a GIF signature without its version"),
        pytest.param(_jpeg(4032, 3024, 1024)[:512], id="a JPEG cut inside a metadata segment"),
        pytest.param(b"\xff\xd8\xff\xda\x00\x02\x00\x00", id="a JPEG whose scan starts before any frame header"),
        pytest.param(_riff(b"ALPH", bytes(10)), id="a WebP whose first chunk is not a bitstream"),
    ],
)
def test_image_dimensions_reads_unrecognized_bytes_as_none(data: bytes):
    assert image_dimensions(data) is None


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        pytest.param(_data_url(_png(6400, 8608)), True, id="a 6400x8608 screenshot (53,800 patches)"),
        pytest.param(_data_url(_png(5600, 5600)), True, id="5600x5600 (30,625 patches)"),
        pytest.param(_data_url(_png(6400, 4832)), True, id="6400x4832 (30,200 patches)"),
        pytest.param(_data_url(_png(6400, 4800)), False, id="6400x4800 (exactly 30,000 patches)"),
        pytest.param(_data_url(_png(5504, 5504)), False, id="5504x5504 (29,584 patches)"),
        pytest.param(_data_url(_png(1024, 1024)), False, id="1024x1024"),
        pytest.param(
            _data_url(_jpeg(8000, 8000, 100 * 1024), "image/jpeg"),
            True,
            id="an 8000x8000 JPEG whose frame header sits behind 100 KiB of metadata",
        ),
        pytest.param(
            _data_url(_png(131070, 500)), False, id="a 131070x500 strip, once scaled to the 65,535-pixel side"
        ),
        pytest.param(_data_url(_png(131070, 1500)), True, id="a 131070x1500 strip, still over the limit once scaled"),
        pytest.param(_WRAPPED_URL, True, id="a payload wrapped at 76 columns"),
        pytest.param(_UNPADDED_URL, True, id="an unpadded payload of a JPEG with a deep frame header"),
        pytest.param(_URL_SAFE_URL, True, id="a payload in the URL-safe alphabet"),
        pytest.param(
            "data:image/png;BASE64," + base64.b64encode(_png(6400, 8608)).decode("ascii"),
            True,
            id="an upper-case base64 marker",
        ),
        pytest.param("https://example.com/huge.png", False, id="an http URL"),
        pytest.param("data:image/png," + quote("not base64"), False, id="a data URL that is not base64"),
        pytest.param(_data_url(b"hello"), False, id="a data URL of something that is not an image"),
    ],
)
def test_exceeds_openai_patch_limit(url: str, expected: bool):
    assert exceeds_openai_patch_limit(url) is expected


@dataclass
class ImageDetailCase:
    expected_client: str
    model: str
    client_type: str | None
    protocol: str
    # whether an image over the patch limit goes out at high detail
    shrinks: bool
    # whether the model reads no image parts, so the transform refuses them instead of forwarding them
    refuses_images: bool = False


IMAGE_DETAIL_CASES = [
    ImageDetailCase("GPT6Client", "gpt-5.6-terra", None, "responses", True),
    ImageDetailCase("GPT6Client", "gpt-5.5", None, "responses", False),
    ImageDetailCase("OpenaiResponsesClient", "openai/gpt-5.6-terra", "openai-responses", "responses", True),
    ImageDetailCase("OpenaiResponsesClient", "deepseek-v4-flash-vision-exp", "openai-responses", "responses", False),
    ImageDetailCase("OpenaiChatClient", "GPT-5.6-Sol", "openai-chat", "chat", True),
    ImageDetailCase("OpenaiChatClient", "gpt-5.5", "openai-chat", "chat", False),
    ImageDetailCase("KimiK3Client", "kimi-k3", None, "chat", False),
    # The DeepSeek client forwards images to every id except the text-only V4 Flash / V4 Pro
    # (bare, dated snapshot, any gateway prefix, any case).
    ImageDetailCase("DeepSeekV4Client", "deepseek-v4-flash", None, "responses", False, refuses_images=True),
    ImageDetailCase(
        "DeepSeekV4Client", "deepseek-ai/DeepSeek-V4-Flash", "deepseek-v4", "responses", False, refuses_images=True
    ),
    ImageDetailCase("DeepSeekV4Client", "deepseek-v4-flash-vision-exp", None, "responses", False),
    ImageDetailCase("DeepSeekV4Client", "deepseek-v4.1-flash", None, "responses", False),
]

OVERSIZED = _data_url(_png(6400, 8608))
SMALL = _data_url(_png(1024, 1024))

# A prompt carrying an oversized image next to a small one, and a tool result carrying both again.
MESSAGES: list[dict[str, Any]] = [
    {
        "role": "user",
        "content_items": [
            {"type": "text", "text": "What is in these?"},
            {"type": "image_url", "image_url": OVERSIZED},
            {"type": "image_url", "image_url": SMALL},
        ],
    },
    {
        "role": "assistant",
        "content_items": [
            {"type": "tool_call", "name": "read_image", "arguments": {"path": "shot.png"}, "tool_call_id": "call_1"}
        ],
    },
    {
        "role": "user",
        "content_items": [
            {"type": "tool_result", "text": "image/png", "images": [OVERSIZED, SMALL], "tool_call_id": "call_1"}
        ],
    },
]


def _details(case: ImageDetailCase, model_input: list[dict[str, Any]]) -> list[str]:
    """
    The detail of each image part, in order: the prompt's two images, then the tool result's two.

    An absent key and an explicit None differ on the wire, so the key itself is reported.
    """
    if case.protocol == "responses":
        parts = model_input[0]["content"][1:] + model_input[2]["output"][1:]
    else:
        # Chat Completions takes no image in a tool message: the tool result's images follow it
        # in a user message of their own.
        parts = [part["image_url"] for part in model_input[0]["content"][1:] + model_input[3]["content"]]

    return [part.get("detail", "absent") for part in parts]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case",
    IMAGE_DETAIL_CASES,
    ids=[f"{case.model}:{case.client_type or 'auto'}" for case in IMAGE_DETAIL_CASES],
)
async def test_image_parts_go_out_at_the_detail_the_client_needs_or_are_refused_where_the_model_reads_none(
    case: ImageDetailCase,
):
    client = AutoLLMClient(model=case.model, api_key="test-key", client_type=case.client_type)
    assert client._client.__class__.__name__ == case.expected_client  # noqa: SLF001

    if case.refuses_images:
        with pytest.raises(ValueError, match="does not support image"):
            client._client.transform_uni_message_to_model_input(MESSAGES)  # noqa: SLF001
        return

    model_input = client._client.transform_uni_message_to_model_input(MESSAGES)  # noqa: SLF001
    if inspect.isawaitable(model_input):
        model_input = await model_input

    shrunk = "high" if case.shrinks else "absent"
    assert _details(case, model_input) == [shrunk, "absent", shrunk, "absent"]
    if case.protocol == "responses":
        # the list form is what images require
        assert isinstance(model_input[2]["output"], list)
    else:
        # the tool message carries the text alone, and the images follow it in a user message
        assert len(model_input) == 4
        assert model_input[2]["role"] == "tool"
        assert "image_url" not in json.dumps(model_input[2])
        assert model_input[3]["role"] == "user"
        assert [part["type"] for part in model_input[3]["content"]] == ["image_url", "image_url"]
