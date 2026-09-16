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

import request from "supertest";
import { describe, test, expect, beforeEach, jest } from "@jest/globals";
import { AutoLLMClient } from "../src/autoClient";
import { createChatApp } from "../src/integration/playground";
import { UniConfig, UniEvent, UniMessage } from "../src/types";

let mockLastStreamingOptions: {
  message: UniMessage;
  config: UniConfig;
  signal?: AbortSignal;
} | null = null;

const mockEvents: UniEvent[] = [
  {
    role: "assistant",
    event_type: "delta",
    content_items: [{ type: "text.delta", text: "Hi" }],
    usage_metadata: null,
    finish_reason: null,
    created_at: 0,
  },
  {
    role: "assistant",
    event_type: "delta",
    content_items: [{ type: "text.done", text: "Hi" }],
    usage_metadata: null,
    finish_reason: null,
    created_at: 0,
  },
  {
    role: "assistant",
    event_type: "stop",
    content_items: [],
    usage_metadata: {
      cached_tokens: null,
      prompt_tokens: 3,
      thoughts_tokens: null,
      response_tokens: 1,
    },
    finish_reason: "stop",
    created_at: 0,
  },
];

function sseEvents(body: string): string[] {
  return body
    .split("\n\n")
    .filter((chunk) => chunk)
    .map((chunk) => chunk.slice("data: ".length));
}

jest.mock("../src/autoClient", () => ({
  AutoLLMClient: jest.fn().mockImplementation(() => ({
    streamingResponseStateful: async function* (options: {
      message: UniMessage;
      config: UniConfig;
      signal?: AbortSignal;
    }): AsyncGenerator<UniEvent> {
      mockLastStreamingOptions = options;
      yield* mockEvents;
    },
    clearHistory: jest.fn(),
    listModels: async (): Promise<string[]> => ["gpt-5.6", "claude-sonnet-5"],
  })),
}));

describe("Playground", () => {
  beforeEach(() => {
    mockLastStreamingOptions = null;
    jest.clearAllMocks();
  });

  test("should render client connection inputs", async () => {
    const app = createChatApp();

    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.text).toContain(
      '<h1 class="text-xl font-semibold">AgentHub</h1>',
    );
    expect(response.text).toContain('id="modelCombobox"');
    expect(response.text).toContain('id="thinkingLevelCombobox"');
    expect(response.text).toContain('id="thinkingSummaryCombobox"');
    expect(response.text).toContain('id="toolChoiceCombobox"');
    expect(response.text).toContain(
      'data-combobox-option data-value="gpt-5.6-luna"',
    );
    expect(response.text).toContain(
      'data-value="text-embedding-3-large" data-client-type="openai-embedding"',
    );
    expect(response.text).toContain("getSelectedClientType()");
    expect(response.text).toContain("toggleCombobox('modelCombobox')");
    expect(response.text).toContain(
      "selectComboboxOption('modelCombobox', this)",
    );
    expect(response.text).toContain("customModelInput");
    expect(response.text).toContain("handleModelSelectChange()");
    expect(response.text).not.toContain("modelDropdown");
    expect(response.text).not.toContain("toggleModelMenu()");
    expect(response.text).not.toContain("<select");
    expect(response.text).not.toContain("<datalist");
    expect(response.text).toContain("apiKeyInput");
    expect(response.text).toContain('id="listModelsButton"');
    expect(response.text).toContain('id="extraHeadersInput"');
    expect(response.text).toContain('id="listModelsError"');
    expect(response.text).toContain("addListedModels(");
    expect(response.text).toContain("getSelectedClientType()");
    expect(response.text).toContain("selectedOptionClientType()");
    expect(response.text).toContain("handleClientTypeInput()");
    expect(response.text).toContain(">Connection</span>");
    expect(response.text).toContain(">Generation</span>");
    expect(response.text).toContain("getExtraHeaders()");
    expect(response.text).toContain("listModels()");
    expect(response.text).toContain("/api/models");
    expect(response.text).toContain("apiKeyVisibilityToggle");
    expect(response.text).toContain("toggleApiKeyVisibility()");
    expect(response.text).toContain('id="stopButton"');
    expect(response.text).toContain("stopGeneration()");
    expect(response.text).toContain("currentAbortController.abort()");
    expect(response.text).toContain("/api/abort");
    expect(response.text).toContain(
      'id="apiKeyVisibilityShowIcon" class="hidden"',
    );
    expect(response.text).toContain('id="apiKeyVisibilityHideIcon" xmlns=');
    expect(response.text).toContain("baseUrlInput");
    expect(response.text).toContain("type: 'text.done', text: message");
    expect(response.text).toContain("type: 'image_url.done', image_url: img");
    expect(response.text).toContain("event.event_type === 'stop'");
    expect(response.text).toContain("item.type === 'text.delta'");
    expect(response.text).toContain("item.type === 'thinking.done'");
    expect(response.text).toContain("item.type === 'tool_call.done'");
    expect(response.text).toContain("item.type.endsWith('.done')");
    expect(response.text).toContain("event.error");
    expect(response.text).not.toContain("partial_tool_call");
    expect(response.text).toContain("renderEmbedding");
    expect(response.text).toContain("item.embedding.slice(0, 5)");
    expect(response.text).toContain("appendAudioChunk(contentDiv, item, audioStream)");
    expect(response.text).toContain("finalizeAudioStream(audioStream)");
    expect(response.text).toContain(
      "renderAudioPlayer(audioStream.mimeType, audioStream.chunks)",
    );
    expect(response.text).toContain("finalizeAudioStream(audioStream, true)");
    expect(response.text).toContain(
      "audioStream.container.querySelector('audio').play()",
    );
    expect(response.text).toContain(
      "assistantCard.insertAdjacentHTML('beforeend', metadataHtml)",
    );
    expect(response.text).toContain("agenthub.playground.config");
    expect(response.text).toContain("restoreConfig()");
    expect(response.text).not.toContain("pcmBase64ToWavDataUrl");
    expect(response.text).not.toContain("assistantCard.innerHTML +=");
    expect(response.text).toContain('href="/tracer/"');
    expect(response.text).toContain('target="_blank"');
    expect(response.text).toContain("Open Tracer");
    expect(
      response.text.indexOf('<h1 class="text-xl font-semibold">'),
    ).toBeLessThan(response.text.indexOf(">GitHub<"));
    expect(response.text.indexOf(">GitHub<")).toBeLessThan(
      response.text.indexOf(">Open Tracer<"),
    );
    expect(response.text).not.toContain("temperatureInput");
    expect(response.text).not.toContain("maxTokensInput");
  });

  test("should list the models the endpoint serves", async () => {
    const app = createChatApp();

    const response = await request(app)
      .post("/api/models")
      .send({
        config: {
          model: "gpt-5.6",
          api_key: "test-key",
          base_url: "https://relay.test/v1",
        },
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ models: ["gpt-5.6", "claude-sonnet-5"] });
    expect(AutoLLMClient).toHaveBeenCalledWith({
      model: "gpt-5.6",
      apiKey: "test-key",
      baseUrl: "https://relay.test/v1",
      clientType: undefined,
    });
  });

  test("should report a failed model listing", async () => {
    (AutoLLMClient as unknown as jest.Mock).mockImplementationOnce(() => ({
      listModels: async (): Promise<string[]> => {
        throw new Error("401 unauthorized");
      },
    }));
    const app = createChatApp();

    const response = await request(app)
      .post("/api/models")
      .send({ config: { model: "gpt-5.6" } });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("401 unauthorized");
  });

  test("should mount tracer on the same app", async () => {
    const app = createChatApp();

    const response = await request(app).get("/tracer/");

    expect(response.status).toBe(200);
    expect(response.text).toContain("Tracer");
    expect(response.text).toContain('href="/tracer/"');
  });

  test("should use client connection options outside request config", async () => {
    const app = createChatApp();
    const message: UniMessage = {
      role: "user",
      content_items: [{ type: "text.done", text: "Hello" }],
    };

    const response = await request(app)
      .post("/api/chat")
      .send({
        session_id: "connection-options",
        message,
        config: {
          model: "gpt-5.5",
          api_key: "test-key",
          base_url: "https://example.test/v1",
          default_headers: { "X-Title": "AgentHub" },
          thinking_level: "low",
        },
      });

    expect(response.status).toBe(200);
    expect(response.text).toContain("data:");
    expect(AutoLLMClient).toHaveBeenCalledWith({
      model: "gpt-5.5",
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      defaultHeaders: { "X-Title": "AgentHub" },
    });
    expect(mockLastStreamingOptions?.config).toEqual({
      thinking_level: "low",
    });
    expect(mockLastStreamingOptions?.signal).toBeInstanceOf(AbortSignal);
  });

  test("should accept image payloads larger than the default JSON limit", async () => {
    const app = createChatApp();
    const largeImage = `data:image/png;base64,${"a".repeat(150_000)}`;
    const message: UniMessage = {
      role: "user",
      content_items: [{ type: "image_url.done", image_url: largeImage }],
    };

    const response = await request(app)
      .post("/api/chat")
      .send({
        session_id: "large-image",
        message,
        config: {
          model: "gpt-5.5",
        },
      });

    expect(response.status).toBe(200);
    expect(response.text).toContain("data:");
    expect(mockLastStreamingOptions?.message.content_items[0]).toEqual({
      type: "image_url.done",
      image_url: largeImage,
    });
    expect(mockLastStreamingOptions?.signal).toBeInstanceOf(AbortSignal);
  });

  test("should stream every event of the response, then the done marker", async () => {
    const app = createChatApp();

    const response = await request(app)
      .post("/api/chat")
      .send({
        session_id: "stream-events",
        message: {
          role: "user",
          content_items: [{ type: "text.done", text: "Hello" }],
        },
        config: { model: "gpt-5.5" },
      });

    expect(response.status).toBe(200);
    const events = sseEvents(response.text);
    expect(events.slice(0, -1).map((event) => JSON.parse(event))).toEqual(
      mockEvents,
    );
    expect(events[events.length - 1]).toBe("[DONE]");
  });

  test("should report a response that fails midway as an error event", async () => {
    (AutoLLMClient as unknown as jest.Mock).mockImplementationOnce(() => ({
      streamingResponseStateful: async function* (): AsyncGenerator<UniEvent> {
        yield mockEvents[0];
        throw new Error("connection reset");
      },
    }));
    const app = createChatApp();

    const response = await request(app)
      .post("/api/chat")
      .send({
        session_id: "failing-stream",
        message: {
          role: "user",
          content_items: [{ type: "text.done", text: "Hello" }],
        },
        config: { model: "gpt-5.5" },
      });

    expect(response.status).toBe(200);
    expect(sseEvents(response.text)).toEqual([
      JSON.stringify(mockEvents[0]),
      JSON.stringify({ error: "connection reset" }),
      "[DONE]",
    ]);
  });

  test("should expose an abort endpoint", async () => {
    const app = createChatApp();

    const response = await request(app).post("/api/abort").send({
      session_id: "idle-session",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "idle" });
  });
});
