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

const text = (value: string, fidelity?: Record<string, unknown>) =>
  ({
    type: "text.delta",
    text: value,
    ...(fidelity ? { fidelity } : {}),
  }) as DeltaContentItem;
const thinking = (value: string, fidelity?: Record<string, unknown>) =>
  ({
    type: "thinking.delta",
    thinking: value,
    ...(fidelity ? { fidelity } : {}),
  }) as DeltaContentItem;
const call = (name: string, id: string, args = "") =>
  ({
    type: "tool_call.delta",
    name,
    arguments: args,
    tool_call_id: id,
  }) as DeltaContentItem;
const args = (fragment: string) => call("", "", fragment);
const image = (bytes: string, type = "inline_thinking.delta") =>
  ({
    type,
    data: Buffer.from(bytes),
    mime_type: "image/png",
  }) as DeltaContentItem;

describe("one assembly rule for every kind", () => {
  test("a done item is the first delta with the growing field joined, numbered within the stream", () => {
    const items = new StreamItems("Test");
    expect(items.delta("0", text("Hel"))).toEqual([
      { type: "text.delta", text: "Hel", fidelity: { item_id: "1" } },
    ]);
    expect(items.delta("0", text("lo"))).toEqual([
      { type: "text.delta", text: "lo", fidelity: { item_id: "1" } },
    ]);
    expect(items.done("0")).toEqual([
      { type: "text.done", text: "Hello", fidelity: { item_id: "1" } },
    ]);
    expect(items.delta("1", thinking("hmm"))).toEqual([
      { type: "thinking.delta", thinking: "hmm", fidelity: { item_id: "2" } },
    ]);
    expect(items.done("1")).toEqual([
      { type: "thinking.done", thinking: "hmm", fidelity: { item_id: "2" } },
    ]);
  });

  test("a tool call keeps the header of its first delta and parses the joined arguments", () => {
    const items = new StreamItems("Test");
    expect(items.delta("1", call("get_weather", "toolu_1"))).toEqual([
      {
        type: "tool_call.delta",
        name: "get_weather",
        arguments: "",
        tool_call_id: "toolu_1",
        fidelity: { item_id: "1" },
      },
    ]);
    items.delta("1", args('{"city":'));
    items.delta("1", args('"Paris"}'));
    expect(items.done("1")).toEqual([
      {
        type: "tool_call.done",
        name: "get_weather",
        arguments: { city: "Paris" },
        tool_call_id: "toolu_1",
        fidelity: { item_id: "1" },
      },
    ]);
    // the fields keep the order of the first delta, whatever the client's
    const reordered = new StreamItems("Test");
    reordered.delta("1", {
      type: "tool_call.delta",
      tool_call_id: "c",
      name: "f",
      arguments: "{}",
    });
    expect(Object.keys(reordered.done("1")[0])).toEqual([
      "type",
      "tool_call_id",
      "name",
      "arguments",
      "fidelity",
    ]);
  });

  test("malformed arguments raise when the call is done, empty ones parse to an empty object", () => {
    const items = new StreamItems("Test");
    items.delta("1", call("f", "c", '{"a":'));
    expect(() => items.done("1")).toThrow(ToolCallArgumentParseError);

    const empty = new StreamItems("Test");
    empty.delta("1", call("f", "c"));
    expect(empty.done("1")[0]).toMatchObject({ arguments: {} });
  });

  test("bytes join into one buffer and an embedding is one whole vector", () => {
    const items = new StreamItems("Test");
    items.delta("0", {
      type: "inline_data.delta",
      data: Buffer.from([1, 2]),
      mime_type: "audio/L16",
    });
    items.delta("0", {
      type: "inline_data.delta",
      data: Buffer.from([3]),
      mime_type: "audio/L16",
    });
    expect(items.done("0")).toEqual([
      {
        type: "inline_data.done",
        data: Buffer.from([1, 2, 3]),
        mime_type: "audio/L16",
        fidelity: { item_id: "1" },
      },
    ]);
    expect(
      items.delta("v", { type: "embedding.delta", embedding: [0.1, 0.2] }),
    ).toEqual([
      {
        type: "embedding.delta",
        embedding: [0.1, 0.2],
        fidelity: { item_id: "2" },
      },
    ]);
    expect(items.done("v")).toEqual([
      {
        type: "embedding.done",
        embedding: [0.1, 0.2],
        fidelity: { item_id: "2" },
      },
    ]);
  });

  test("an empty vector goes out all the same: it stands for the input it was made of", () => {
    const items = new StreamItems("Test");
    expect([
      ...items.delta(undefined, { type: "embedding.delta", embedding: [] }),
      ...items.done(),
    ]).toEqual([
      { type: "embedding.delta", embedding: [], fidelity: { item_id: "1" } },
      { type: "embedding.done", embedding: [], fidelity: { item_id: "1" } },
    ]);
  });
});

describe("fidelity", () => {
  test("the fidelity a delta carries is the done item's, and a repeat of it goes out once", () => {
    const items = new StreamItems("Test");
    const fidelity = { reasoning_field: "reasoning_content" };
    expect(items.delta("r", thinking("a", fidelity))).toEqual([
      {
        type: "thinking.delta",
        thinking: "a",
        fidelity: { item_id: "1", ...fidelity },
      },
    ]);
    expect(items.delta("r", thinking("b", fidelity))).toEqual([
      { type: "thinking.delta", thinking: "b", fidelity: { item_id: "1" } },
    ]);
    // a repeat that leaves the fragment carrying nothing goes out nowhere
    expect(items.delta("r", thinking("", fidelity))).toEqual([]);
    expect(items.done("r")).toEqual([
      {
        type: "thinking.done",
        thinking: "ab",
        fidelity: { item_id: "1", ...fidelity },
      },
    ]);
  });

  test("a signature arriving after the text is a fragment of its own carrying only fidelity", () => {
    const items = new StreamItems("Test");
    items.delta("0", thinking("Let me look"));
    expect(items.delta("0", thinking("", { signature: "sig" }))).toEqual([
      {
        type: "thinking.delta",
        thinking: "",
        fidelity: { item_id: "1", signature: "sig" },
      },
    ]);
    expect(items.done("0")).toEqual([
      {
        type: "thinking.done",
        thinking: "Let me look",
        fidelity: { item_id: "1", signature: "sig" },
      },
    ]);
  });

  test("two different fidelity payloads in one item raise, naming the provider's id", () => {
    const items = new StreamItems("Test");
    items.delta("0", thinking("a", { signature: "1" }));
    expect(() => items.delta("0", thinking("", { signature: "2" }))).toThrow(
      "item 0 carried two different fidelity payloads",
    );
  });

  test("fidelity sent under an item's id belongs to that item whatever kind it streams", () => {
    // an Interactions thought step: an image, then the signature that closes the step
    const items = new StreamItems("Test", { sequential: true });
    items.delta("0", image("draft"));
    expect(items.delta("0", thinking("", { signature: "sig" }))).toEqual([
      {
        type: "inline_thinking.delta",
        data: Buffer.alloc(0),
        mime_type: "image/png",
        fidelity: { item_id: "1", signature: "sig" },
      },
    ]);
    expect(items.done("0")).toEqual([
      {
        type: "inline_thinking.done",
        data: Buffer.from("draft"),
        mime_type: "image/png",
        fidelity: { item_id: "1", signature: "sig" },
      },
    ]);
  });
});

describe("what goes out", () => {
  test("a fragment carrying nothing registers its item and goes out nowhere", () => {
    const items = new StreamItems("Test");
    expect(items.delta("msg", text(""))).toEqual([]);
    expect(items.delta("msg", text("a"))).toEqual([
      { type: "text.delta", text: "a", fidelity: { item_id: "1" } },
    ]);
    expect(items.delta("msg", text(""))).toEqual([]);
    expect(items.done("msg")).toEqual([
      { type: "text.done", text: "a", fidelity: { item_id: "1" } },
    ]);
    // an announce the header rides on is not nothing
    expect(items.delta("fc", call("f", "c"))).toHaveLength(1);
  });

  test("an item nothing went out for yet streams the kind of the first fragment that does", () => {
    // a tool_use block announced without its name, then a thinking block under the same index
    const items = new StreamItems("Test");
    expect(items.delta("1", call("", ""))).toEqual([]);
    expect(items.delta("1", thinking("hmm"))).toEqual([
      { type: "thinking.delta", thinking: "hmm", fidelity: { item_id: "1" } },
    ]);
    expect(items.done("1")).toEqual([
      { type: "thinking.done", thinking: "hmm", fidelity: { item_id: "1" } },
    ]);
  });

  test("an item no fragment of which went out has no done item", () => {
    const items = new StreamItems("Test");
    items.delta("msg", text(""));
    expect(items.done("msg")).toEqual([]);
    expect(items.done("never")).toEqual([]);
    expect(items.done()).toEqual([]);
  });

  test("the first tool_call.delta must carry the name and the tool_call_id", () => {
    const items = new StreamItems("Test");
    expect(() => items.delta("0", call("f", "", "{}"))).toThrow(
      "the first tool_call.delta of item 0 must carry the name and the tool_call_id",
    );
    expect(() => new StreamItems("Test").delta(undefined, args("{}"))).toThrow(
      "the first tool_call.delta of item unkeyed-0 must carry the name and the tool_call_id",
    );
  });
});

describe("which item a fragment belongs to", () => {
  test("a fragment without an id belongs to the item streamed last while it is open and of the kind", () => {
    const items = new StreamItems("Test");
    items.delta("rs_1", thinking(""));
    expect(items.delta(undefined, thinking("Plan"))).toEqual([
      { type: "thinking.delta", thinking: "Plan", fidelity: { item_id: "1" } },
    ]);
    // another kind starts an item of its own
    expect(items.delta(undefined, text("Answer"))).toEqual([
      { type: "text.delta", text: "Answer", fidelity: { item_id: "2" } },
    ]);
    // the item streamed last ends with an id-less done
    expect(items.done()).toEqual([
      { type: "text.done", text: "Answer", fidelity: { item_id: "2" } },
    ]);
    expect(items.done("rs_1")).toEqual([
      { type: "thinking.done", thinking: "Plan", fidelity: { item_id: "1" } },
    ]);
    // nothing open any more: a new item
    expect(items.delta(undefined, text("More"))).toEqual([
      { type: "text.delta", text: "More", fidelity: { item_id: "3" } },
    ]);
  });

  test("a continuation whose id names nothing belongs to the item streamed last", () => {
    // a gateway announcing a call under one id and streaming its arguments under another
    const items = new StreamItems("Test");
    items.delta("fc_real", call("lookup", "call_m"));
    items.delta("fc_other", args('{"q":"m"}'));
    expect(items.done("fc_real")).toEqual([
      {
        type: "tool_call.done",
        name: "lookup",
        arguments: { q: "m" },
        tool_call_id: "call_m",
        fidelity: { item_id: "1" },
      },
    ]);
  });

  test("a fragment carrying part of its header is a malformed start, not a continuation", () => {
    const items = new StreamItems("Test");
    items.delta("0", call("f", "toolu_0"));
    expect(() => items.delta("1", call("g", ""))).toThrow(
      "the first tool_call.delta of item 1 must carry the name and the tool_call_id",
    );
    expect(() => items.delta(undefined, call("", "toolu_2"))).toThrow(
      "the first tool_call.delta of item unkeyed-0 must carry the name and the tool_call_id",
    );
  });

  test("a fragment that can start an item starts one under a new id", () => {
    const items = new StreamItems("Test");
    items.delta("msg_1", text("a"));
    expect(items.delta("msg_2", text("b"))).toEqual([
      { type: "text.delta", text: "b", fidelity: { item_id: "2" } },
    ]);
    expect(items.delta("fc", call("f", "c"))).toEqual([
      {
        type: "tool_call.delta",
        name: "f",
        arguments: "",
        tool_call_id: "c",
        fidelity: { item_id: "3" },
      },
    ]);
  });
});

describe("items that end on done", () => {
  test("items may interleave; each is done under its own id", () => {
    const items = new StreamItems("Test");
    items.delta("a", call("f", "call_a"));
    items.delta("b", call("g", "call_b"));
    items.delta("a", args('{"x":'));
    items.delta("b", args('{"y":2}'));
    items.delta("a", args("1}"));
    expect(items.done("b")[0]).toMatchObject({
      arguments: { y: 2 },
      fidelity: { item_id: "2" },
    });
    expect(items.done("a")[0]).toMatchObject({
      arguments: { x: 1 },
      fidelity: { item_id: "1" },
    });
  });

  test("the id of a done item is closed for good", () => {
    const items = new StreamItems("Test");
    items.delta("0", text("a"));
    items.done("0");
    expect(() => items.delta("0", text("b"))).toThrow(
      "text.delta arrived after item 0 was done",
    );
    expect(() => items.done("0")).toThrow("item 0 was done twice");
    // a done for an item that never streamed closes the id too
    items.done("5");
    expect(() => items.delta("5", text("late"))).toThrow(StreamProtocolError);
  });

  test("a done without an id closes the id of the item it ended too", () => {
    // a gateway that leaves the item id off output_item.done
    const items = new StreamItems("Test");
    items.delta("msg_1", text("a"));
    items.done();
    expect(() => items.delta("msg_1", text("b"))).toThrow(
      "text.delta arrived after item msg_1 was done",
    );
    expect(() => items.done("msg_1")).toThrow("item msg_1 was done twice");
  });

  test("a fragment of another kind under an open item's id is a protocol error", () => {
    const items = new StreamItems("Test");
    items.delta("0", text("a"));
    expect(() => items.delta("0", thinking("b"))).toThrow(
      "thinking.delta arrived for item 0, which streams text",
    );
  });
});

describe("items that end on the next item", () => {
  test("the first fragment of the next item ends the previous one, ahead of the fragment", () => {
    const items = new StreamItems("Test", { sequential: true });
    items.delta("reasoning", thinking("Hmm"));
    expect(items.delta("content", text("Hel"))).toEqual([
      { type: "thinking.done", thinking: "Hmm", fidelity: { item_id: "1" } },
      { type: "text.delta", text: "Hel", fidelity: { item_id: "2" } },
    ]);
    expect(items.delta("content", text("lo"))).toEqual([
      { type: "text.delta", text: "lo", fidelity: { item_id: "2" } },
    ]);
    expect(items.end()).toEqual([
      { type: "text.done", text: "Hello", fidelity: { item_id: "2" } },
    ]);
  });

  test("a fragment of another kind under the open item's id is the next item", () => {
    // a thought step going text, image, text
    const items = new StreamItems("Test", { sequential: true });
    items.delta("0", thinking("first"));
    expect(items.delta("0", image("draft"))).toEqual([
      { type: "thinking.done", thinking: "first", fidelity: { item_id: "1" } },
      {
        type: "inline_thinking.delta",
        data: Buffer.from("draft"),
        mime_type: "image/png",
        fidelity: { item_id: "2" },
      },
    ]);
    expect(items.delta("0", thinking("then"))).toEqual([
      {
        type: "inline_thinking.done",
        data: Buffer.from("draft"),
        mime_type: "image/png",
        fidelity: { item_id: "2" },
      },
      { type: "thinking.delta", thinking: "then", fidelity: { item_id: "3" } },
    ]);
  });

  test("an id is reused once its item is done, and a done still ends an item on the spot", () => {
    // generateContent: every function call is an item of its own under the part kind
    const items = new StreamItems("Test", { sequential: true });
    expect([
      ...items.delta("function_call", call("f", "call_1", '{"a":1}')),
      ...items.done("function_call"),
    ]).toMatchObject([
      { type: "tool_call.delta", fidelity: { item_id: "1" } },
      {
        type: "tool_call.done",
        arguments: { a: 1 },
        fidelity: { item_id: "1" },
      },
    ]);
    expect([
      ...items.delta("function_call", call("g", "call_2", "{}")),
      ...items.done("function_call"),
    ]).toMatchObject([
      { type: "tool_call.delta", fidelity: { item_id: "2" } },
      { type: "tool_call.done", fidelity: { item_id: "2" } },
    ]);
    // each image its own item: the done goes before the image, which stays open for a signature
    expect([
      ...items.delta("img", image("one", "inline_data.delta")),
      ...items.done("img"),
      ...items.delta("img", image("two", "inline_data.delta")),
    ]).toMatchObject([
      { type: "inline_data.delta", fidelity: { item_id: "3" } },
      { type: "inline_data.done", fidelity: { item_id: "3" } },
      { type: "inline_data.delta", fidelity: { item_id: "4" } },
    ]);
  });
});

describe("the end of the stream", () => {
  test("every item still open is done, in the order they started", () => {
    const items = new StreamItems("Test");
    items.delta("a", text("a"));
    items.delta("b", text("b"));
    items.delta("c", text(""));
    expect(items.end()).toEqual([
      { type: "text.done", text: "a", fidelity: { item_id: "1" } },
      { type: "text.done", text: "b", fidelity: { item_id: "2" } },
    ]);
    expect(items.end()).toEqual([]);
  });
});
