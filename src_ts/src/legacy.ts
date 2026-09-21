// Copyright 2025 Prism Shadow. and/or its affiliates
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Compatibility with the content item types used before 0.5.0. Scheduled for removal in 0.6.0,
// together with every call to normalizeLegacyMessages.

import { UniMessage } from "./types";

const LEGACY_ITEM_TYPES = new Set([
  "text",
  "image_url",
  "inline_data",
  "thinking",
  "inline_thinking",
  "tool_call",
  "tool_result",
  "embedding",
]);

let warned = false;

/**
 * Convert messages recorded before 0.5.0 to the current content item types.
 *
 * A legacy item type such as `text` becomes `text.done`, and a stray `partial_tool_call`
 * is dropped. Messages already in the current format are returned as they are; a message
 * that needed converting is returned as a copy, so the caller's data is never modified.
 *
 * @param messages - Messages that may carry legacy content item types
 * @returns The messages with current content item types only
 */
export function normalizeLegacyMessages(messages: UniMessage[]): UniMessage[] {
  return messages.map((message) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = message.content_items as any[];
    if (
      !items.some(
        (item) =>
          LEGACY_ITEM_TYPES.has(item.type) || item.type === "partial_tool_call",
      )
    ) {
      return message;
    }

    if (!warned) {
      warned = true;
      process.emitWarning(
        "Content item types without the .done suffix (text, tool_call, ...) are deprecated " +
          "and will stop being accepted in AgentHub 0.6.0; use text.done, tool_call.done, ...",
        "DeprecationWarning",
      );
    }

    return {
      ...message,
      content_items: items
        .filter((item) => item.type !== "partial_tool_call")
        .map((item) =>
          LEGACY_ITEM_TYPES.has(item.type)
            ? { ...item, type: `${item.type}.done` }
            : item,
        ),
    };
  });
}
