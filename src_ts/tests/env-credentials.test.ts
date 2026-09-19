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

import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { AutoLLMClient } from "../src";

// Each case builds a client under a controlled environment and reads the credential its vendor
// SDK instance ends up holding; nothing here reaches the network. The OpenAI and Anthropic SDKs
// fill every credential they are not handed from their own environment variables, so a client
// that hands them undefined sends whatever those variables hold to its own host.

const CREDENTIAL_ENV = [
  "CLIENT_TYPE",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "ZAI_API_KEY",
  "ZAI_BASE_URL",
  "MOONSHOT_API_KEY",
  "MOONSHOT_BASE_URL",
  "MINIMAX_API_KEY",
  "MINIMAX_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_BEDROCK_BASE_URL",
];

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(
    CREDENTIAL_ENV.map((name) => [name, process.env[name]]),
  );
  for (const name of CREDENTIAL_ENV) {
    delete process.env[name];
  }
});

afterEach(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

function routedClientName(client: AutoLLMClient): string {
  return (client as unknown as { _client: object })._client.constructor.name;
}

function sdkOf(client: AutoLLMClient): unknown {
  return (client as unknown as { _client: { _client: unknown } })._client
    ._client;
}

function openaiCredentialOf(client: AutoLLMClient): {
  apiKey: string;
  baseURL: string;
} {
  const sdk = sdkOf(client) as { apiKey: string; baseURL: string };
  return { apiKey: sdk.apiKey, baseURL: sdk.baseURL };
}

// The headers the Anthropic SDK attaches to every request it sends.
async function anthropicAuthHeadersOf(
  client: AutoLLMClient,
): Promise<Record<string, string>> {
  const sdk = sdkOf(client) as {
    authHeaders(opts: object): Promise<{ values: Headers } | undefined>;
  };
  const headers = await sdk.authHeaders({});
  return Object.fromEntries(headers ? [...headers.values.entries()] : []);
}

interface VendorCase {
  expectedClient: string;
  model: string;
  keyEnv: string;
}

// The vendor clients built on the OpenAI SDK: each reads its own variable and nothing else.
const VENDOR_CASES: VendorCase[] = [
  {
    expectedClient: "DeepSeekV4Client",
    model: "deepseek-v4-flash",
    keyEnv: "DEEPSEEK_API_KEY",
  },
  { expectedClient: "GLM5_3Client", model: "glm-5.3", keyEnv: "ZAI_API_KEY" },
  {
    expectedClient: "KimiK3Client",
    model: "kimi-k3",
    keyEnv: "MOONSHOT_API_KEY",
  },
  {
    expectedClient: "MiniMaxM3Client",
    model: "MiniMax-M3",
    keyEnv: "MINIMAX_API_KEY",
  },
];

describe.each(VENDOR_CASES)("$expectedClient credentials", (testCase) => {
  const missing = `${testCase.keyEnv} is required for ${testCase.expectedClient}.`;

  test("with only OPENAI_API_KEY set, refuses to build rather than send it", () => {
    process.env.OPENAI_API_KEY = "sk-openai-PROBE";

    expect(() => new AutoLLMClient({ model: testCase.model })).toThrow(missing);
  });

  test("with no key at all, names its own variable", () => {
    expect(() => new AutoLLMClient({ model: testCase.model })).toThrow(missing);
  });

  test("uses its own variable, not OPENAI_API_KEY", () => {
    process.env.OPENAI_API_KEY = "sk-openai-PROBE";
    process.env[testCase.keyEnv] = "sk-vendor-PROBE";

    const client = new AutoLLMClient({ model: testCase.model });

    expect(routedClientName(client)).toBe(testCase.expectedClient);
    expect(openaiCredentialOf(client).apiKey).toBe("sk-vendor-PROBE");
  });

  test("uses an explicit key over both variables", () => {
    process.env.OPENAI_API_KEY = "sk-openai-PROBE";
    process.env[testCase.keyEnv] = "sk-vendor-PROBE";

    const client = new AutoLLMClient({
      model: testCase.model,
      apiKey: "sk-explicit-PROBE",
    });

    expect(openaiCredentialOf(client).apiKey).toBe("sk-explicit-PROBE");
  });
});

interface OpenaiCase {
  expectedClient: string;
  model: string;
  clientType?: string;
}

// The OpenAI protocol clients, which OPENAI_API_KEY and OPENAI_BASE_URL belong to.
const OPENAI_CASES: OpenaiCase[] = [
  { expectedClient: "GPT6Client", model: "gpt-6-astra" },
  {
    expectedClient: "OpenaiChatClient",
    model: "gpt-5.6",
    clientType: "openai-chat",
  },
  {
    expectedClient: "OpenaiResponsesClient",
    model: "gpt-5.6",
    clientType: "openai-responses",
  },
  {
    expectedClient: "OpenaiEmbeddingClient",
    model: "text-embedding-3-large",
    clientType: "openai-embedding",
  },
  {
    expectedClient: "OpenaiChatVllmAdapterClient",
    model: "Qwen/Qwen3.6-35B-A3B",
    clientType: "openai-chat-vllm-adapter",
  },
];

describe.each(OPENAI_CASES)("$expectedClient credentials", (testCase) => {
  test("reads OPENAI_API_KEY and OPENAI_BASE_URL", () => {
    process.env.OPENAI_API_KEY = "sk-openai-PROBE";
    process.env.OPENAI_BASE_URL = "https://gateway.example/v1/";

    const client = new AutoLLMClient({
      model: testCase.model,
      clientType: testCase.clientType,
    });

    expect(routedClientName(client)).toBe(testCase.expectedClient);
    expect(openaiCredentialOf(client)).toEqual({
      apiKey: "sk-openai-PROBE",
      baseURL: "https://gateway.example/v1/",
    });
  });
});

interface AnthropicCase {
  expectedClient: string;
  model: string;
  clientType?: string;
  // ant-messages sends its key through both header conventions, claude-5 as x-api-key only
  keyAsBearer: boolean;
}

const ANTHROPIC_CASES: AnthropicCase[] = [
  {
    expectedClient: "Claude5Client",
    model: "claude-sonnet-5",
    keyAsBearer: false,
  },
  {
    expectedClient: "AntMessagesClient",
    model: "claude-sonnet-5",
    clientType: "ant-messages",
    keyAsBearer: true,
  },
];

function keyHeaders(key: string, keyAsBearer: boolean): Record<string, string> {
  return keyAsBearer
    ? { "x-api-key": key, authorization: `Bearer ${key}` }
    : { "x-api-key": key };
}

describe.each(ANTHROPIC_CASES)("$expectedClient credentials", (testCase) => {
  test("a configured key goes out without ANTHROPIC_AUTH_TOKEN", async () => {
    process.env.ANTHROPIC_AUTH_TOKEN = "tok-env-PROBE";

    const client = new AutoLLMClient({
      model: testCase.model,
      clientType: testCase.clientType,
      apiKey: "sk-row-KEY",
      baseUrl: "https://proxy.example/anthropic",
    });

    expect(routedClientName(client)).toBe(testCase.expectedClient);
    expect(await anthropicAuthHeadersOf(client)).toEqual(
      keyHeaders("sk-row-KEY", testCase.keyAsBearer),
    );
  });

  test("ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL still apply, ANTHROPIC_AUTH_TOKEN does not", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-PROBE";
    process.env.ANTHROPIC_BASE_URL = "https://gateway.example/anthropic/";
    process.env.ANTHROPIC_AUTH_TOKEN = "tok-env-PROBE";

    const client = new AutoLLMClient({
      model: testCase.model,
      clientType: testCase.clientType,
    });

    expect((sdkOf(client) as { baseURL: string }).baseURL).toBe(
      "https://gateway.example/anthropic/",
    );
    expect(await anthropicAuthHeadersOf(client)).toEqual(
      keyHeaders("sk-ant-PROBE", testCase.keyAsBearer),
    );
  });

  test("with no key configured, ANTHROPIC_AUTH_TOKEN is not sent either", async () => {
    process.env.ANTHROPIC_AUTH_TOKEN = "tok-env-PROBE";

    const client = new AutoLLMClient({
      model: testCase.model,
      clientType: testCase.clientType,
    });

    expect(await anthropicAuthHeadersOf(client)).toEqual({});
  });
});

describe("Claude5Client on Bedrock", () => {
  test("sends no Anthropic credential to AWS", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-PROBE";
    process.env.ANTHROPIC_AUTH_TOKEN = "tok-env-PROBE";

    const client = new AutoLLMClient({
      model: "claude-sonnet-5",
      apiKey: "AKIAEXAMPLE,secret-EXAMPLE",
      baseUrl: "bedrock://us-east-1",
    });

    expect((sdkOf(client) as object).constructor.name).toBe("AnthropicBedrock");
    expect(await anthropicAuthHeadersOf(client)).toEqual({});
  });
});
