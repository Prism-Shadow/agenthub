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

import { expect } from "@jest/globals";
import { isDeepStrictEqual } from "util";
import { EventContentItem, UniEvent } from "../src/types";

/**
 * Assert that a finished stream follows the streaming protocol every client promises:
 * delta events carrying one item each, then exactly one stop event with usage and a
 * finish reason; every item streams as contiguous deltas closed by its done item; at most
 * one delta of an item carries fidelity, equal to the done item's; the done item holds
 * what its deltas streamed; the first tool_call.delta names the call.
 */
export function assertStreamGrammar(events: UniEvent[]): void {
  expect(events.length).toBeGreaterThan(0);
  const stop = events[events.length - 1];
  expect(stop.event_type).toBe("stop");
  expect(stop.content_items).toEqual([]);
  expect(stop.usage_metadata).not.toBeNull();
  expect(stop.finish_reason).not.toBeNull();

  let open: EventContentItem[] = [];
  for (const event of events.slice(0, -1)) {
    expect(event.event_type).toBe("delta");
    expect(event.usage_metadata).toBeNull();
    expect(event.finish_reason).toBeNull();
    expect(event.content_items).toHaveLength(1);

    const item = event.content_items[0];
    const [kind, phase] = item.type.split(".");
    expect(["delta", "done"]).toContain(phase);
    if (open.length > 0) {
      // an item must be done before the next one starts
      expect(open[0].type).toBe(`${kind}.delta`);
    }

    if (phase === "delta") {
      if (open.length === 0 && item.type === "tool_call.delta") {
        expect(item.name).not.toBe("");
        expect(item.tool_call_id).not.toBe("");
      }
      open.push(item);
      continue;
    }

    expect(open.length).toBeGreaterThan(0);
    const withFidelity = open.filter(
      (delta) =>
        "fidelity" in delta &&
        delta.fidelity != null &&
        Object.keys(delta.fidelity).length > 0,
    );
    expect(withFidelity.length).toBeLessThanOrEqual(1);
    const doneFidelity = "fidelity" in item ? item.fidelity : undefined;
    const deltaFidelity =
      withFidelity.length > 0 && "fidelity" in withFidelity[0]
        ? withFidelity[0].fidelity
        : undefined;
    expect(isDeepStrictEqual(deltaFidelity ?? {}, doneFidelity ?? {})).toBe(
      true,
    );

    if (item.type === "text.done") {
      expect(item.text).toBe(
        open.map((delta) => ("text" in delta ? delta.text : "")).join(""),
      );
    } else if (item.type === "thinking.done") {
      expect(item.thinking).toBe(
        open
          .map((delta) => ("thinking" in delta ? delta.thinking : ""))
          .join(""),
      );
    } else if (item.type === "tool_call.done") {
      const raw = open
        .map((delta) =>
          delta.type === "tool_call.delta" ? delta.arguments : "",
        )
        .join("");
      expect(item.arguments).toEqual(JSON.parse(raw || "{}"));
      expect(item.name).toBe(
        open[0].type === "tool_call.delta" ? open[0].name : "",
      );
      expect(item.tool_call_id).toBe(
        open[0].type === "tool_call.delta" ? open[0].tool_call_id : "",
      );
    }
    open = [];
  }
  expect(open).toEqual([]);
}
