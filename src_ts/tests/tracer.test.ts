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

import * as fs from "fs";
import * as path from "path";
import { ClientPart, LLMClient } from "../src/baseClient";
import { Tracer } from "../src/integration/tracer";
import { UniMessage } from "../src/types";
import {
  expect,
  describe,
  test,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

/**
 * A client whose provider stream is a fixed list of parts. The tracer hook lives in the base
 * class's streamingResponse, above this seam, so a traced response runs for real without a
 * network or an API key.
 */
class ScriptedClient extends LLMClient {
  constructor(private readonly parts: ClientPart[]) {
    super();
    this._model = "fake-model";
  }

  transformUniConfigToModelConfig(): undefined {
    return undefined;
  }

  transformUniMessageToModelInput(messages: UniMessage[]): UniMessage[] {
    return messages;
  }

  transformModelOutputToClientParts(modelOutput: ClientPart): ClientPart[] {
    return [modelOutput];
  }

  async *_streamingResponseInternal(): AsyncGenerator<ClientPart> {
    for (const part of this.parts) {
      yield* this.transformModelOutputToClientParts(part);
    }
  }

  async listModels(): Promise<string[]> {
    return [];
  }
}

describe("Tracer", () => {
  let tempCacheDir: string;

  beforeEach(() => {
    tempCacheDir = fs.mkdtempSync(path.join(process.cwd(), "test-cache-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempCacheDir)) {
      fs.rmSync(tempCacheDir, { recursive: true, force: true });
    }
  });

  test("should initialize with cache directory", () => {
    const tracer = new Tracer(tempCacheDir);
    expect(fs.existsSync(tempCacheDir)).toBe(true);
  });

  test("should save conversation history to files", () => {
    const tracer = new Tracer(tempCacheDir);

    const model = "fake-model";
    const history: UniMessage[] = [
      {
        role: "user",
        content_items: [{ type: "text.done", text: "Hello" }],
      },
      {
        role: "assistant",
        content_items: [{ type: "text.done", text: "Hi there!" }],
      },
    ];

    const config = { temperature: 0.7 };
    const configWithModel = { ...config, model };
    const fileId = "test/conversation";

    tracer.saveHistory(model, history, fileId, config);

    const jsonPath = path.join(tempCacheDir, fileId + ".json");
    const txtPath = path.join(tempCacheDir, fileId + ".txt");

    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(txtPath)).toBe(true);

    const txtContent = fs.readFileSync(txtPath, "utf-8");
    expect(txtContent).toContain("USER:");
    expect(txtContent).toContain("ASSISTANT:");
    expect(txtContent).toContain("Hello");
    expect(txtContent).toContain("Hi there!");
    expect(txtContent).toContain("temperature");

    const jsonContent = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    expect(jsonContent.history).toHaveLength(2);
    expect(jsonContent.config).toEqual(configWithModel);
    expect(jsonContent.timestamp).toBeDefined();
  });

  test("should create necessary directories when saving history", () => {
    const tracer = new Tracer(tempCacheDir);

    const model = "fake-model";
    const history: UniMessage[] = [
      {
        role: "user",
        content_items: [{ type: "text.done", text: "Test" }],
      },
    ];

    const fileId = "agent1/subfolder/conversation";
    const config = {};

    tracer.saveHistory(model, history, fileId, config);

    const jsonPath = path.join(tempCacheDir, fileId + ".json");
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(path.dirname(jsonPath))).toBe(true);
  });

  test("should overwrite existing files", () => {
    const tracer = new Tracer(tempCacheDir);

    const model = "fake-model";
    const history1: UniMessage[] = [
      {
        role: "user",
        content_items: [{ type: "text.done", text: "First message" }],
      },
    ];

    const history2: UniMessage[] = [
      {
        role: "user",
        content_items: [{ type: "text.done", text: "Second message" }],
      },
    ];

    const fileId = "test/conversation";
    const config = {};

    tracer.saveHistory(model, history1, fileId, config);
    tracer.saveHistory(model, history2, fileId, config);

    const jsonPath = path.join(tempCacheDir, fileId + ".json");
    const jsonContent = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

    expect(jsonContent.history).toHaveLength(1);
    expect(jsonContent.history[0].content_items[0].text).toBe("Second message");
  });

  test("should handle relative paths", () => {
    const tracer = new Tracer(tempCacheDir);

    const model = "fake-model";
    const history: UniMessage[] = [
      {
        role: "user",
        content_items: [{ type: "text.done", text: "Test" }],
      },
    ];

    const relativePath = "conversations/conv1";
    const config = {};

    tracer.saveHistory(model, history, relativePath, config);

    const jsonPath = path.join(tempCacheDir, relativePath + ".json");
    expect(fs.existsSync(jsonPath)).toBe(true);
  });

  test("should create web app", () => {
    const tracer = new Tracer(tempCacheDir);
    const app = tracer.createWebApp();
    expect(app).toBeDefined();
  });

  test("should format history with usage metadata", () => {
    const tracer = new Tracer(tempCacheDir);

    const model = "fake-model";
    const history: UniMessage[] = [
      {
        role: "user",
        content_items: [{ type: "text.done", text: "Hello" }],
      },
      {
        role: "assistant",
        content_items: [{ type: "text.done", text: "Hi!" }],
        usage_metadata: {
          prompt_tokens: 10,
          thoughts_tokens: 5,
          response_tokens: 15,
          cached_tokens: 2,
        },
        finish_reason: "stop",
      },
    ];

    const config = {};
    const fileId = "test/metadata_test";

    tracer.saveHistory(model, history, fileId, config);

    const txtPath = path.join(tempCacheDir, fileId + ".txt");
    const txtContent = fs.readFileSync(txtPath, "utf-8");

    expect(txtContent).toContain("Prompt Tokens: 10");
    expect(txtContent).toContain("Thoughts Tokens: 5");
    expect(txtContent).toContain("Response Tokens: 15");
    expect(txtContent).toContain("Cached Tokens: 2");
    expect(txtContent).toContain("Finish Reason: stop");
  });

  test("should pre-render system and tools in config", () => {
    const tracer = new Tracer(tempCacheDir);

    const model = "fake-model";
    const history: UniMessage[] = [
      {
        role: "user",
        content_items: [{ type: "text.done", text: "Hello" }],
      },
    ];

    const config = {
      system_prompt: "You are a helpful assistant.",
      tools: [
        {
          name: "get_weather",
          description: "Get the weather for a location",
          parameters: {
            type: "object",
            properties: {
              location: { type: "string", description: "City name" },
            },
          },
        },
      ],
      temperature: 0.7,
    };
    const fileId = "test/config_render_test";

    tracer.saveHistory(model, history, fileId, config);

    const txtPath = path.join(tempCacheDir, fileId + ".txt");
    const txtContent = fs.readFileSync(txtPath, "utf-8");

    // Check that system_prompt is rendered with proper formatting
    expect(txtContent).toContain("system_prompt:");
    expect(txtContent).toContain("You are a helpful assistant");

    // Check that tools are rendered as JSON
    expect(txtContent).toContain("tools:");
    expect(txtContent).toContain("get_weather");
    expect(txtContent).toContain("parameters");
  });

  test("should format audio inline data in history export", () => {
    const tracer = new Tracer(tempCacheDir);

    const model = "fake-model";
    const history: UniMessage[] = [
      {
        role: "user",
        content_items: [{ type: "text.done", text: "Hello" }],
      },
      {
        role: "assistant",
        content_items: [
          {
            type: "inline_data.done",
            data: Buffer.from([0x00, 0x01, 0x02, 0x03]),
            mime_type: "audio/pcm",
          },
        ],
      },
    ];

    const fileId = "test/audio_inline_data";
    const config = {};

    tracer.saveHistory(model, history, fileId, config);

    const txtPath = path.join(tempCacheDir, fileId + ".txt");
    const txtContent = fs.readFileSync(txtPath, "utf-8");

    expect(txtContent).toContain("Inline Audio: audio/pcm");
  });

  test("should render embedding previews with the first five values", async () => {
    const tracer = new Tracer(tempCacheDir);

    const model = "fake-model";
    const history: UniMessage[] = [
      {
        role: "assistant",
        content_items: [
          {
            type: "embedding.done",
            embedding: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
          },
        ],
      },
    ];
    const fileId = "test/embedding_preview";

    tracer.saveHistory(model, history, fileId, {});

    const txtPath = path.join(tempCacheDir, fileId + ".txt");
    const txtContent = fs.readFileSync(txtPath, "utf-8");
    expect(txtContent).toContain("Embedding: [0.1, 0.2, 0.3, 0.4, 0.5]");
    expect(txtContent).not.toContain("0.6");

    const app = tracer.createWebApp();
    const supertest = await import("supertest");
    const response = await supertest
      .default(app)
      .get("/test/embedding_preview.json");
    expect(response.status).toBe(200);
    expect(response.text).toContain("Embedding: [0.1, 0.2, 0.3, 0.4, 0.5]");
    expect(response.text).not.toContain("0.6");
  });

  test("should show trace files saved before 0.5.0 with the current item types", async () => {
    const warn = jest
      .spyOn(process, "emitWarning")
      .mockImplementation(() => undefined);
    const tracer = new Tracer(tempCacheDir);
    fs.mkdirSync(path.join(tempCacheDir, "legacy"));
    fs.writeFileSync(
      path.join(tempCacheDir, "legacy", "conversation.json"),
      JSON.stringify({
        history: [
          {
            role: "user",
            content_items: [{ type: "text", text: "Weather in Paris?" }],
          },
          {
            role: "assistant",
            content_items: [
              { type: "thinking", thinking: "Look it up." },
              {
                type: "partial_tool_call",
                name: "get_weather",
                arguments: '{"city": "Paris"}',
                tool_call_id: "call_1",
              },
              {
                type: "tool_call",
                name: "get_weather",
                arguments: { city: "Paris" },
                tool_call_id: "call_1",
              },
            ],
          },
          {
            role: "user",
            content_items: [
              { type: "tool_result", text: "22 C", tool_call_id: "call_1" },
            ],
          },
        ],
        config: { model: "fake-model" },
        timestamp: "2026-01-01T00:00:00",
      }),
    );

    const app = tracer.createWebApp();
    const supertest = await import("supertest");
    const response = await supertest
      .default(app)
      .get("/legacy/conversation.json");

    expect(response.status).toBe(200);
    for (const type of [
      "text.done",
      "thinking.done",
      "tool_call.done",
      "tool_result.done",
    ]) {
      expect(response.text).toContain(`mb-2">${type}</div>`);
    }
    expect(response.text).toContain("Weather in Paris?");
    expect(response.text).toContain("Look it up.");
    expect(response.text).toContain('get_weather(city="Paris")');
    expect(response.text).toContain("22 C");
    expect(response.text).toContain("• 2 item(s)");
    expect(response.text).not.toContain("partial_tool_call");
    warn.mockRestore();
  });

  test("should save a traced response before its stop event is yielded", async () => {
    const previousCacheDir = process.env.AGENTHUB_CACHE_DIR;
    process.env.AGENTHUB_CACHE_DIR = tempCacheDir;
    const client = new ScriptedClient([
      { type: "delta", key: "0", item: { type: "text.delta", text: "Hello " } },
      { type: "delta", key: "0", item: { type: "text.delta", text: "there!" } },
      { type: "done", key: "0" },
      {
        type: "finish",
        usage_metadata: {
          cached_tokens: 0,
          prompt_tokens: 1,
          thoughts_tokens: null,
          response_tokens: 2,
        },
        finish_reason: "stop",
      },
    ]);

    let saved: { history: UniMessage[] } | null = null;
    let transcript = "";
    try {
      for await (const event of client.streamingResponseStateful({
        message: {
          role: "user",
          content_items: [{ type: "text.done", text: "Say hello" }],
        },
        config: { trace_id: "integration/conversation" },
      })) {
        if (event.event_type === "stop") {
          const fileBase = path.join(
            tempCacheDir,
            "integration",
            "conversation",
          );
          saved = JSON.parse(fs.readFileSync(fileBase + ".json", "utf-8"));
          transcript = fs.readFileSync(fileBase + ".txt", "utf-8");
          break;
        }
      }
    } finally {
      if (previousCacheDir === undefined) {
        delete process.env.AGENTHUB_CACHE_DIR;
      } else {
        process.env.AGENTHUB_CACHE_DIR = previousCacheDir;
      }
    }

    expect(saved?.history.map((message) => message.content_items)).toEqual([
      [{ type: "text.done", text: "Say hello" }],
      [{ type: "text.done", text: "Hello there!" }],
    ]);
    expect(transcript).toContain("Text: Hello there!");
    expect(transcript).toContain("Finish Reason: stop");
  });

  test("should sort directory listing by name", async () => {
    const tracer = new Tracer(tempCacheDir);
    const model = "fake-model";
    const history: UniMessage[] = [
      { role: "user", content_items: [{ type: "text.done", text: "Test" }] },
    ];
    const config = {};

    tracer.saveHistory(model, history, "zebra/conv", config);
    tracer.saveHistory(model, history, "apple/conv", config);
    tracer.saveHistory(model, history, "mango/conv", config);

    const app = tracer.createWebApp();
    const supertest = await import("supertest");
    const response = await supertest.default(app).get("/?sort=name");

    expect(response.status).toBe(200);
    const html = response.text;

    const posApple = html.indexOf("apple");
    const posMango = html.indexOf("mango");
    const posZebra = html.indexOf("zebra");
    expect(posApple).toBeGreaterThan(-1);
    expect(posMango).toBeGreaterThan(-1);
    expect(posZebra).toBeGreaterThan(-1);
    expect(posApple).toBeLessThan(posMango);
    expect(posMango).toBeLessThan(posZebra);

    expect(html).toContain("sort=name");
    expect(html).toContain("sort=mtime");
  });

  test("should filter .DS_Store from directory listings", async () => {
    const tracer = new Tracer(tempCacheDir);
    const model = "fake-model";
    const history: UniMessage[] = [
      { role: "user", content_items: [{ type: "text.done", text: "Test" }] },
    ];
    const config = {};

    tracer.saveHistory(model, history, "agent/conv", config);
    fs.writeFileSync(path.join(tempCacheDir, ".DS_Store"), "metadata");
    fs.writeFileSync(path.join(tempCacheDir, "agent", ".DS_Store"), "metadata");

    const app = tracer.createWebApp();
    const supertest = await import("supertest");

    const rootResponse = await supertest.default(app).get("/");
    expect(rootResponse.status).toBe(200);
    expect(rootResponse.text).not.toContain(".DS_Store");

    const nestedResponse = await supertest.default(app).get("/agent");
    expect(nestedResponse.status).toBe(200);
    expect(nestedResponse.text).not.toContain(".DS_Store");
  });

  test("should sort directory listing by mtime", async () => {
    const tracer = new Tracer(tempCacheDir);
    const model = "fake-model";
    const history: UniMessage[] = [
      { role: "user", content_items: [{ type: "text.done", text: "Test" }] },
    ];
    const config = {};

    tracer.saveHistory(model, history, "alpha/conv", config);
    tracer.saveHistory(model, history, "beta/conv", config);
    tracer.saveHistory(model, history, "gamma/conv", config);

    // Explicitly set directory mtimes for deterministic ordering
    const alphaDir = path.join(tempCacheDir, "alpha");
    const betaDir = path.join(tempCacheDir, "beta");
    const gammaDir = path.join(tempCacheDir, "gamma");
    fs.utimesSync(alphaDir, new Date(1000000), new Date(1000000));
    fs.utimesSync(betaDir, new Date(2000000), new Date(2000000));
    fs.utimesSync(gammaDir, new Date(3000000), new Date(3000000));

    const app = tracer.createWebApp();
    const supertest = await import("supertest");
    const response = await supertest.default(app).get("/?sort=mtime");

    expect(response.status).toBe(200);
    const html = response.text;

    const posGamma = html.indexOf("gamma");
    const posAlpha = html.indexOf("alpha");
    expect(posGamma).toBeGreaterThan(-1);
    expect(posAlpha).toBeGreaterThan(-1);
    // Most recently modified (gamma, mtime=3000000ms) should appear before oldest (alpha, mtime=1000000ms)
    expect(posGamma).toBeLessThan(posAlpha);

    expect(html).toContain("sort=name");
    expect(html).toContain("sort=mtime");
  });

  test("should default to name sort when no sort param provided", async () => {
    const tracer = new Tracer(tempCacheDir);
    const model = "fake-model";
    const history: UniMessage[] = [
      { role: "user", content_items: [{ type: "text.done", text: "Test" }] },
    ];
    const config = {};

    tracer.saveHistory(model, history, "zebra/conv", config);
    tracer.saveHistory(model, history, "apple/conv", config);

    const app = tracer.createWebApp();
    const supertest = await import("supertest");
    const response = await supertest.default(app).get("/");

    expect(response.status).toBe(200);
    const html = response.text;

    const posApple = html.indexOf("apple");
    const posZebra = html.indexOf("zebra");
    expect(posApple).toBeLessThan(posZebra);
  });
});
