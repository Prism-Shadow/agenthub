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

import { expect, describe, test } from "@jest/globals";
import { AutoLLMClient, UniMessage } from "../src";

const IMAGE_URL = "https://example.com/image.png";

// The two places the transform can put an `input_image` on the wire: a user turn's content
// and a function call output.
const IMAGE_PART: UniMessage[] = [
  {
    role: "user",
    content_items: [
      { type: "text", text: "What is in this image?" },
      { type: "image_url", image_url: IMAGE_URL },
    ],
  },
];
const TOOL_RESULT_IMAGE: UniMessage[] = [
  {
    role: "user",
    content_items: [
      {
        type: "tool_result",
        text: "The screenshot.",
        tool_call_id: "call_1",
        images: [IMAGE_URL],
      },
    ],
  },
];

// The bare id decides, so the gateway spellings belong on the list too: OpenRouter names the
// model `deepseek/deepseek-v4-flash` and SiliconFlow `deepseek-ai/DeepSeek-V4-Flash`.
const TEXT_ONLY_MODELS = [
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "deepseek-v4-flash-0731",
  "deepseek/deepseek-v4-flash",
  "deepseek-ai/DeepSeek-V4-Flash",
];
const IMAGE_MODELS = ["deepseek-v4-flash-vision-exp", "deepseek-v4.1-flash"];

/* eslint-disable @typescript-eslint/no-explicit-any */
function deepseekClient(model: string): {
  transformUniMessageToModelInput(messages: UniMessage[]): any[];
} {
  const client = new AutoLLMClient({
    model,
    apiKey: "test-key",
    clientType: "deepseek-v4",
  });
  const routedClient = (
    client as unknown as {
      _client: {
        constructor: { name: string };
        transformUniMessageToModelInput(messages: UniMessage[]): any[];
      };
    }
  )._client;
  expect(routedClient.constructor.name).toBe("DeepSeekV4Client");
  return routedClient;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe.each(TEXT_ONLY_MODELS)("Images for text-only %s", (model) => {
  test("refuses an image part", () => {
    expect(() =>
      deepseekClient(model).transformUniMessageToModelInput(IMAGE_PART),
    ).toThrow(`DeepSeek ${model} does not support image inputs.`);
  });

  test("refuses an image in a tool result", () => {
    expect(() =>
      deepseekClient(model).transformUniMessageToModelInput(TOOL_RESULT_IMAGE),
    ).toThrow(`DeepSeek ${model} does not support images in tool results.`);
  });
});

describe.each(IMAGE_MODELS)("Images for %s", (model) => {
  test("forwards an image part", () => {
    const modelInput =
      deepseekClient(model).transformUniMessageToModelInput(IMAGE_PART);

    expect(modelInput[0].content).toContainEqual({
      type: "input_image",
      image_url: IMAGE_URL,
    });
  });

  test("forwards an image in a tool result", () => {
    const modelInput =
      deepseekClient(model).transformUniMessageToModelInput(TOOL_RESULT_IMAGE);

    expect(modelInput[0].output).toContainEqual({
      type: "input_image",
      image_url: IMAGE_URL,
    });
  });
});
