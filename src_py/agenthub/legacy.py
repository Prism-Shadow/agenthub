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

# Compatibility with the content item types used before 0.5.0. Scheduled for removal in 0.6.0,
# together with every call to normalize_legacy_messages.

import warnings

from .types import UniMessage


_LEGACY_ITEM_TYPES = {
    "text",
    "image_url",
    "inline_data",
    "thinking",
    "inline_thinking",
    "tool_call",
    "tool_result",
    "embedding",
}

_warned = False


def normalize_legacy_messages(messages: list[UniMessage]) -> list[UniMessage]:
    """Convert messages recorded before 0.5.0 to the current content item types.

    A legacy item type such as `text` becomes `text.done`, and a stray `partial_tool_call`
    is dropped. Messages already in the current format are returned as they are; a message
    that needed converting is returned as a copy, so the caller's data is never modified.

    Args:
        messages: Messages that may carry legacy content item types

    Returns:
        The messages with current content item types only
    """
    global _warned
    normalized: list[UniMessage] = []
    for message in messages:
        items = message["content_items"]
        if not any(item["type"] in _LEGACY_ITEM_TYPES or item["type"] == "partial_tool_call" for item in items):
            normalized.append(message)
            continue

        if not _warned:
            _warned = True
            warnings.warn(
                "Content item types without the .done suffix (text, tool_call, ...) are deprecated "
                "and will stop being accepted in AgentHub 0.6.0; use text.done, tool_call.done, ...",
                FutureWarning,
                stacklevel=2,
            )

        normalized.append(
            {
                **message,
                "content_items": [
                    {**item, "type": f"{item['type']}.done"} if item["type"] in _LEGACY_ITEM_TYPES else item
                    for item in items
                    if item["type"] != "partial_tool_call"
                ],
            }
        )

    return normalized
