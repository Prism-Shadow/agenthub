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

import { describe, expect, test } from "@jest/globals";
import { StreamProtocolError, ToolCallArgumentParseError } from "../src/errors";
import { StreamItems } from "../src/streamItems";
import { DeltaContentItem } from "../src/types";

// a delta the way a client yields it: the item's id rides in fidelity.item_id
const withId = (
  id: string | undefined,
  item: Record<string, unknown>,
  fidelity?: Record<string, unknown>,
) =>
  ({
    ...item,
    ...(id || fidelity ? { fidelity: { item_id: id, ...fidelity } } : {}),
  }) as DeltaContentItem;
const text = (id: string | undefined, value: string, fidelity?: object) =>
  withId(id, { type: "text.delta", text: value }, fidelity as never);
const thinking = (id: string | undefined, value: string, fidelity?: object) =>
  withId(id, { type: "thinking.delta", thinking: value }, fidelity as never);
const call = (
  id: string | undefined,
  name: string,
  callId: string,
  args = "",
) =>
  withId(id, {
    type: "tool_call.delta",
    name,
    arguments: args,
    tool_call_id: callId,
  });
const args = (id: string | undefined, fragment: string) =>
  call(id, "", "", fragment);
const data = (
  id: string,
  bytes: string,
  mimeType: string,
  type = "inline_data.delta",
) => withId(id, { type, data: Buffer.from(bytes), mime_type: mimeType });

describe("one assembly rule for every kind", () => {
  test("a done item is the first delta with the growing field joined, and item_id never goes out", () => {
    const items = new StreamItems("Test");
    expect(items.delta(text("0", "Hel"))).toEqual([
      { type: "text.delta", text: "Hel" },
    ]);
    expect(items.delta(text("0", "lo"))).toEqual([
      { type: "text.delta", text: "lo" },
    ]);
    expect(items.end()).toEqual([{ type: "text.done", text: "Hello" }]);
  });

  test("a tool call keeps the header of its first delta and parses the joined arguments", () => {
    const items = new StreamItems("Test");
    expect(items.delta(call("1", "get_weather", "toolu_1"))).toEqual([
      {
        type: "tool_call.delta",
        name: "get_weather",
        arguments: "",
        tool_call_id: "toolu_1",
      },
    ]);
    items.delta(args("1", '{"city":'));
    items.delta(args("1", '"Paris"}'));
    expect(items.end()).toEqual([
      {
        type: "tool_call.done",
        name: "get_weather",
        arguments: { city: "Paris" },
        tool_call_id: "toolu_1",
      },
    ]);
  });

  test("malformed arguments raise when the call is done, empty ones parse to an empty object", () => {
    const items = new StreamItems("Test");
    items.delta(call("0", "f", "c", '{"a":'));
    expect(() => items.end()).toThrow(ToolCallArgumentParseError);

    items.delta(call("1", "g", "d"));
    expect(items.end()).toMatchObject([{ arguments: {} }]);
  });

  test("audio chunks join into one buffer, while every image is an item of its own", () => {
    const items = new StreamItems("Test");
    items.delta(data("0", "ab", "audio/L16"));
    items.delta(data("0", "c", "audio/L16"));
    expect(items.end()).toEqual([
      {
        type: "inline_data.done",
        data: Buffer.from("abc"),
        mime_type: "audio/L16",
      },
    ]);

    items.delta(data("0", "one", "image/png"));
    expect(items.delta(data("0", "two", "image/png"))).toMatchObject([
      { type: "inline_data.done", data: Buffer.from("one") },
      { type: "inline_data.delta", data: Buffer.from("two") },
    ]);
    // a thought image too
    expect(
      items.delta(data("0", "three", "image/png", "inline_thinking.delta")),
    ).toMatchObject([
      { type: "inline_data.done", data: Buffer.from("two") },
      { type: "inline_thinking.delta" },
    ]);
  });

  test("a vector is an item of its own, and an empty one goes out all the same", () => {
    const items = new StreamItems("Test");
    expect(
      items.delta({ type: "embedding.delta", embedding: [0.1, 0.2] }),
    ).toEqual([{ type: "embedding.delta", embedding: [0.1, 0.2] }]);
    // it stands for the input it was made of
    expect(items.delta({ type: "embedding.delta", embedding: [] })).toEqual([
      { type: "embedding.done", embedding: [0.1, 0.2] },
      { type: "embedding.delta", embedding: [] },
    ]);
    expect(items.end()).toEqual([{ type: "embedding.done", embedding: [] }]);
  });
});

describe("when an item is done", () => {
  test("a delta under another id ends the item streaming, ahead of the delta", () => {
    const items = new StreamItems("Test");
    items.delta(thinking("reasoning", "Hmm"));
    expect(items.delta(text("content", "Hel"))).toEqual([
      { type: "thinking.done", thinking: "Hmm" },
      { type: "text.delta", text: "Hel" },
    ]);
    items.delta(text("content", "lo"));
    // the same kind under another id is the next item too
    expect(items.delta(text("content_2", "!"))).toEqual([
      { type: "text.done", text: "Hello" },
      { type: "text.delta", text: "!" },
    ]);
  });

  test("a delta of another kind under the same id is the next item", () => {
    // an Interactions thought step going text, image, text
    const items = new StreamItems("Test");
    items.delta(thinking("0", "first"));
    expect(
      items.delta(data("0", "draft", "image/png", "inline_thinking.delta")),
    ).toMatchObject([
      { type: "thinking.done", thinking: "first" },
      { type: "inline_thinking.delta" },
    ]);
    expect(items.delta(thinking("0", "then"))).toMatchObject([
      { type: "inline_thinking.done", data: Buffer.from("draft") },
      { type: "thinking.delta", thinking: "then" },
    ]);
  });

  test("a call's name begins the next call, and its arguments continue it whatever id they carry", () => {
    // Chat Completions: every call under the same wire field
    const items = new StreamItems("Test");
    items.delta(call("tool_calls", "f", "call_1", '{"a":'));
    items.delta(args("tool_calls", "1}"));
    expect(items.delta(call("tool_calls", "g", "call_2"))).toMatchObject([
      { type: "tool_call.done", name: "f", arguments: { a: 1 } },
      { type: "tool_call.delta", name: "g" },
    ]);
    // a gateway announcing a call under one id and streaming its arguments under another
    items.delta(args("fc_other", '{"q":"m"}'));
    expect(items.end()).toMatchObject([
      { type: "tool_call.done", name: "g", arguments: { q: "m" } },
    ]);
  });

  test("a delta without an id continues the item streaming now, which takes the first id it sees", () => {
    const items = new StreamItems("Test");
    items.delta(text(undefined, "a"));
    items.delta(text("msg_1", "b"));
    items.delta(text(undefined, "c"));
    expect(items.delta(text("msg_2", "d"))).toEqual([
      { type: "text.done", text: "abc" },
      { type: "text.delta", text: "d" },
    ]);
  });

  test("the item streaming when the stream ends is done, and nothing is when none streams", () => {
    const items = new StreamItems("Test");
    expect(items.end()).toEqual([]);
    items.delta(text("0", "a"));
    expect(items.end()).toEqual([{ type: "text.done", text: "a" }]);
    expect(items.end()).toEqual([]);
  });
});

describe("fidelity", () => {
  test("the fidelity a delta carries is the done item's, and a repeat of it goes out once", () => {
    const items = new StreamItems("Test");
    const fidelity = { reasoning_field: "reasoning_content" };
    expect(items.delta(thinking("r", "a", fidelity))).toEqual([
      { type: "thinking.delta", thinking: "a", fidelity },
    ]);
    expect(items.delta(thinking("r", "b", fidelity))).toEqual([
      { type: "thinking.delta", thinking: "b" },
    ]);
    expect(items.end()).toEqual([
      { type: "thinking.done", thinking: "ab", fidelity },
    ]);
  });

  test("a signature arriving after the text is a delta of its own carrying only fidelity", () => {
    const items = new StreamItems("Test");
    items.delta(thinking("0", "Let me look"));
    expect(items.delta(thinking("0", "", { signature: "sig" }))).toEqual([
      { type: "thinking.delta", thinking: "", fidelity: { signature: "sig" } },
    ]);
    expect(items.end()).toEqual([
      {
        type: "thinking.done",
        thinking: "Let me look",
        fidelity: { signature: "sig" },
      },
    ]);
  });

  test("two different fidelity payloads in one item raise, naming the item", () => {
    const items = new StreamItems("Test");
    items.delta(thinking("rs_1", "a", { signature: "1" }));
    expect(() => items.delta(thinking("rs_1", "", { signature: "2" }))).toThrow(
      "item rs_1 carried two different fidelity payloads",
    );
  });

  test("fidelity sent alone under the item's id is that item's, whatever kind carries it", () => {
    // an Interactions thought step: an image, then the signature the step ends with
    const items = new StreamItems("Test");
    items.delta(data("0", "draft", "image/png", "inline_thinking.delta"));
    expect(items.delta(thinking("0", "", { signature: "sig" }))).toEqual([
      {
        type: "inline_thinking.delta",
        data: Buffer.alloc(0),
        mime_type: "image/png",
        fidelity: { signature: "sig" },
      },
    ]);
    expect(items.end()).toEqual([
      {
        type: "inline_thinking.done",
        data: Buffer.from("draft"),
        mime_type: "image/png",
        fidelity: { signature: "sig" },
      },
    ]);
  });
});

describe("what goes out", () => {
  test("a delta carrying nothing goes nowhere, and an item nothing went out for has no done item", () => {
    const items = new StreamItems("Test");
    expect(items.delta(text("msg_1", ""))).toEqual([]);
    expect(items.delta(text("msg_2", "a"))).toEqual([
      { type: "text.delta", text: "a" },
    ]);
  });

  test("the first tool_call.delta must carry the name and the tool_call_id", () => {
    const items = new StreamItems("Test");
    expect(() => items.delta(call("1", "g", ""))).toThrow(
      "the first tool_call.delta of item 1 must carry the name and the tool_call_id",
    );
    // arguments with no call streaming
    expect(() => new StreamItems("Test").delta(args(undefined, "{}"))).toThrow(
      "the first tool_call.delta of an item must carry the name and the tool_call_id",
    );
  });

  test("a client yields deltas only", () => {
    const items = new StreamItems("Test");
    expect(() =>
      items.delta({ type: "text.done", text: "a" } as never),
    ).toThrow(StreamProtocolError);
  });
});
