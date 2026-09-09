![Header](.github/images/header.png)

# AgentHub SDK - Unified and Precise LLM SDK

[![GitHub Repo stars](https://img.shields.io/github/stars/Prism-Shadow/AgentHub?style=social)](https://github.com/Prism-Shadow/AgentHub/stargazers)
[![GitHub last commit](https://img.shields.io/github/last-commit/Prism-Shadow/AgentHub)](https://github.com/Prism-Shadow/AgentHub/commits/main)
[![GitHub contributors](https://img.shields.io/github/contributors/Prism-Shadow/AgentHub?color=orange)](https://github.com/Prism-Shadow/AgentHub/graphs/contributors)
[![Python tests](https://github.com/Prism-Shadow/AgentHub/actions/workflows/pytest.yml/badge.svg)](https://github.com/Prism-Shadow/AgentHub/actions/workflows/pytest.yml)
[![Javascript tests](https://github.com/Prism-Shadow/AgentHub/actions/workflows/jest.yml/badge.svg)](https://github.com/Prism-Shadow/AgentHub/actions/workflows/jest.yml)
[![PyPI](https://img.shields.io/pypi/v/agenthub-python)](https://pypi.org/project/agenthub-python/)
[![NPM](https://img.shields.io/npm/v/@prismshadow/agenthub)](https://www.npmjs.com/package/@prismshadow/agenthub)

AgentHub is the LLM API Hub for the Agent era, built for high-precision autonomous agents.

Using a coding agent? Install the AgentHub SKILL files from [`skills/`](skills/) so it can use AgentHub correctly in generated code.

📢 Follow us on X: [![Twitter](https://img.shields.io/twitter/follow/prismshadow_ai)](https://twitter.com/prismshadow_ai) or join our [Discord Community](https://discord.gg/4TQ2bsSb)

## Why AgentHub?

- 🔗 **Unified**: A consistent and intuitive interface for developing **agents** across different LLMs.

- 🎯 **Precise**: Automatically handles **[interleaved thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking#interleaved-thinking)** during multi-step tool calls, preventing performance degradation.

- 🧭 **Traceable**: Provides lightweight yet fine-grained **tracing** for debugging and auditing LLM executions.

## Features

### AutoLLMClient (Python & TypeScript)

Switch different LLMs with **zero code changes** and **no performance loss**.

![AgentHub](.github/images/agenthub.png)

### Built-in Observability

Audit LLM executions by adding **a single `trace_id` parameter**, no database required.

https://github.com/user-attachments/assets/c49a21a1-5bf9-4768-a76d-f73c9a03ca87

## Supported Models

| Model Name     | Vendor                              | Example Model ID       | Input Modalities | Output Modalities              |
| -------------- | ----------------------------------- | ---------------------- | ---------------- | ------------------------------ |
| Gemini 3-3.8   | Official/Google Vertex AI           | `gemini-3.8-flash`     | Text, Image      | Text, Image, Speech, Embedding |
| Claude 4.6-5   | Official/Amazon Bedrock/UModelVerse | `claude-opus-5`        | Text, Image      | Text                           |
| GPT-5.4-6      | Official/OpenRouter/UModelVerse     | `gpt-6-astra`          | Text, Image      | Text, Embedding                |
| Kimi-K2.5/K2.6/K3 | Official/OpenRouter/SiliconFlow  | `kimi-k3`              | Text, Image      | Text                           |
| DeepSeek V4    | Official/OpenRouter/SiliconFlow     | `deepseek-v4-pro`      | Text, Image      | Text                           |
| GLM-5.1-5.3    | Official/OpenRouter/SiliconFlow     | `glm-5.3`              | Text, Image      | Text                           |
| MiniMax-M3     | Official                            | `MiniMax-M3`           | Text, Image      | Text                           |
| Qwen3.6        | OpenRouter/SiliconFlow/vLLM         | `qwen/qwen3.6-35b-a3b` | Text, Image      | Text, Embedding                |

Beyond the model-specific clients, four generic protocol clients call any compatible
endpoint:

- **`client_type="openai-chat"`** — OpenAI Chat Completions. Bare `"openai"` is an alias.
- **`client_type="openai-chat-vllm-adapter"`** — Chat Completions as served by vLLM, mapping
  `thinking_level` onto the `chat_template_kwargs` the served model's template reads.
- **`client_type="openai-responses"`** — OpenAI Responses, served by OpenAI, OpenRouter,
  DeepSeek, Z.AI, and MiniMax.
- **`client_type="ant-messages"`** — Anthropic Messages, served by Anthropic, OpenRouter,
  DeepSeek, Z.AI, and MiniMax.

Where a gateway serves more than one, prefer `"openai-responses"`: OpenRouter serves it for
every model it hosts, while SiliconFlow serves Chat Completions only.

The full machine-readable list — model, base URL, client, input/output modalities, context
window, and per-million-token list pricing in USD or CNY:

```python
from agenthub import list_supported_models

models = list_supported_models(currency="CNY")  # "USD" by default
```

```typescript
import { listSupportedModels } from "@prismshadow/agenthub";

const models = listSupportedModels("CNY"); // "USD" by default
```

## Installation

### Python package

Install from PyPI:

```bash
uv add agenthub-python
# or
pip install agenthub-python
```

Build from source:

```bash
cd src_py && make
```

See [src_py/README.md](src_py/README.md) for comprehensive usage examples and API documentation.

### TypeScript package

Install from npm:

```bash
npm install @prismshadow/agenthub
```

Build from source:

```bash
cd src_ts && make install && make build
```

See [src_ts/README.md](src_ts/README.md) for comprehensive usage examples and API documentation.

## Agent Skills

AgentHub provides Codex/Claude Code skill files for assistants that need to help users consume the SDK packages:

- Python skill: [`skills/agenthub-python/SKILL.md`](skills/agenthub-python/SKILL.md)
- TypeScript skill: [`skills/agenthub-typescript/SKILL.md`](skills/agenthub-typescript/SKILL.md)

## APIs

`AutoLLMClient` is the main class for interacting with the AgentHub SDK. It is constructed with `model`, plus optional `api_key`, `base_url`, `client_type`, and `default_headers` — headers sent with every request, for endpoints that demand their own. It provides the following methods:

- `(async) streaming_response(messages, config)`: Streams the response of LLMs in a stateless manner.
- `(async) streaming_response_stateful(message, config)`: Streams the response of LLMs in a stateful manner.
- `(async) list_models()`: Lists the model ids the configured endpoint serves. A protocol client (`openai-chat`, `openai-chat-vllm-adapter`, `openai-responses`, `ant-messages`, `openai-embedding`) is named explicitly and lists everything the endpoint serves; a client deduced from a model id lists only the ids that deduce back to it.
- `clear_history()`: Clears the history of the stateful LLM client.
- `get_history()`: Returns the history of the stateful LLM client.
- `set_history(history)`: Replaces the history of the stateful LLM client with a copy of the provided list.

Streaming clients skip output they do not recognize, so a gateway's own frames cannot end a generation, and an event a client has nothing universal to emit for never reaches you. Set `AGENTHUB_DEBUG` to anything other than `0`, `false`, `no` or `off` to make both raise instead.

## Basic Usage

> [!NOTE]
> We recommend using the **stateful interface** when calling the AgentHub SDK.

### OpenAI GPT-5.6

Python Example:

```python
import asyncio
import os
from agenthub import AutoLLMClient

os.environ["OPENAI_API_KEY"] = "your-openai-api-key"

async def main():
    client = AutoLLMClient(model="gpt-5.6-sol")
    async for event in client.streaming_response_stateful(
        message={
            "role": "user",
            "content_items": [{"type": "text", "text": "Say 'Hello, World!'"}]
        },
        config={"temperature": 1.0}
    ):
        print(event)

asyncio.run(main())
# {'role': 'assistant', 'event_type': 'delta', 'content_items': [{'type': 'text', 'text': 'Hello'}], 'usage_metadata': None, 'finish_reason': None}
# {'role': 'assistant', 'event_type': 'delta', 'content_items': [{'type': 'text', 'text': ','}], 'usage_metadata': None, 'finish_reason': None}
# {'role': 'assistant', 'event_type': 'delta', 'content_items': [{'type': 'text', 'text': ' World'}], 'usage_metadata': None, 'finish_reason': None}
# {'role': 'assistant', 'event_type': 'delta', 'content_items': [{'type': 'text', 'text': '!'}], 'usage_metadata': None, 'finish_reason': None}
# {'role': 'assistant', 'event_type': 'stop', 'content_items': [], 'usage_metadata': {'cached_tokens': 0, 'prompt_tokens': 12, 'thoughts_tokens': 0, 'response_tokens': 8}, 'finish_reason': 'stop'}
```

TypeScript Example:

```typescript
import { AutoLLMClient } from "@prismshadow/agenthub";

process.env.OPENAI_API_KEY = "your-openai-api-key";

async function main() {
  const client = new AutoLLMClient({ model: "gpt-5.6-sol" });
  for await (const event of client.streamingResponseStateful({
    message: {
      role: "user",
      content_items: [{ type: "text", text: "Say 'Hello, World!'" }]
    },
    config: {}
  })) {
    console.log(event);
  }
}

main().catch(console.error);
// {'role': 'assistant', 'event_type': 'delta', 'content_items': [{'type': 'text', 'text': 'Hello'}], 'usage_metadata': null, 'finish_reason': null}
// {'role': 'assistant', 'event_type': 'delta', 'content_items': [{'type': 'text', 'text': ','}], 'usage_metadata': null, 'finish_reason': null}
// {'role': 'assistant', 'event_type': 'delta', 'content_items': [{'type': 'text', 'text': ' World'}], 'usage_metadata': null, 'finish_reason': null}
// {'role': 'assistant', 'event_type': 'delta', 'content_items': [{'type': 'text', 'text': '!'}], 'usage_metadata': null, 'finish_reason': null}
// {'role': 'assistant', 'event_type': 'stop', 'content_items': [], 'usage_metadata': {'cached_tokens': 0, 'prompt_tokens': 12, 'thoughts_tokens': 0, 'response_tokens': 8}, 'finish_reason': 'stop'}
```

### Anthropic Claude Opus 5

<details><summary><strong>Python Example</strong></summary>

```python
import asyncio
import os
from agenthub import AutoLLMClient

os.environ["ANTHROPIC_API_KEY"] = "your-anthropic-api-key"

async def main():
    client = AutoLLMClient(model="claude-opus-5")
    async for event in client.streaming_response_stateful(
        message={
            "role": "user",
            "content_items": [{"type": "text", "text": "Say 'Hello, World!'"}]
        },
        config={}
    ):
        print(event)

asyncio.run(main())
```

</details>

<details><summary><strong>TypeScript Example</strong></summary>

```typescript
import { AutoLLMClient } from "@prismshadow/agenthub";

process.env.ANTHROPIC_API_KEY = "your-anthropic-api-key";

async function main() {
  const client = new AutoLLMClient({ model: "claude-opus-5" });
  for await (const event of client.streamingResponseStateful({
    message: {
      role: "user",
      content_items: [{"type": "text", "text": "Say 'Hello, World!'"}]
    },
    config: {}
  })) {
    console.log(event);
  }
}

main().catch(console.error);
```

</details>

### OpenRouter GLM-5.3

<details><summary><strong>Python Example</strong></summary>

```python
import asyncio
import os
from agenthub import AutoLLMClient

os.environ["ZAI_API_KEY"] = "your-openrouter-api-key"
os.environ["ZAI_BASE_URL"] = "https://openrouter.ai/api/v1"

async def main():
    client = AutoLLMClient(model="z-ai/glm-5.3")
    async for event in client.streaming_response_stateful(
        message={
            "role": "user",
            "content_items": [{"type": "text", "text": "Say 'Hello, World!'"}]
        },
        config={}
    ):
        print(event)

asyncio.run(main())
```

</details>
<details><summary><strong>TypeScript Example</strong></summary>

```typescript
import { AutoLLMClient } from "@prismshadow/agenthub";

process.env.ZAI_API_KEY = "your-openrouter-api-key";
process.env.ZAI_BASE_URL = "https://openrouter.ai/api/v1";

async function main() {
  const client = new AutoLLMClient({ model: "z-ai/glm-5.3" });
  for await (const event of client.streamingResponseStateful({
    message: {
      role: "user",
      content_items: [{"type": "text", "text": "Say 'Hello, World!'"}]
    },
    config: {}
  })) {
    console.log(event);
  }
}

main().catch(console.error);
```
</details>

### SiliconFlow Qwen3.6 35B via OpenAI-compatible API

<details><summary><strong>Python Example</strong></summary>

```python
import asyncio
import os
from agenthub import AutoLLMClient

os.environ["OPENAI_API_KEY"] = "your-siliconflow-api-key"
os.environ["OPENAI_BASE_URL"] = "https://api.siliconflow.cn/v1"

async def main():
    client = AutoLLMClient(model="Qwen/Qwen3.6-35B-A3B", client_type="openai-chat")
    async for event in client.streaming_response_stateful(
        message={
            "role": "user",
            "content_items": [{"type": "text", "text": "Say 'Hello, World!'"}]
        },
        config={}
    ):
        print(event)

asyncio.run(main())
```

</details>
<details><summary><strong>TypeScript Example</strong></summary>

```typescript
import { AutoLLMClient } from "@prismshadow/agenthub";

process.env.OPENAI_API_KEY = "your-siliconflow-api-key";
process.env.OPENAI_BASE_URL = "https://api.siliconflow.cn/v1";

async function main() {
  const client = new AutoLLMClient({
    model: "Qwen/Qwen3.6-35B-A3B",
    clientType: "openai-chat",
  });
  for await (const event of client.streamingResponseStateful({
    message: {
      role: "user",
      content_items: [{ type: "text", text: "Say 'Hello, World!'" }],
    },
    config: {}
  })) {
    console.log(event);
  }
}

main().catch(console.error);
```
</details>

### SiliconFlow Qwen3 Embedding 0.6B via OpenAI-compatible API

<details><summary><strong>Python Example</strong></summary>

```python
import asyncio
import os
from agenthub import AutoLLMClient

os.environ["OPENAI_API_KEY"] = "your-siliconflow-api-key"
os.environ["OPENAI_BASE_URL"] = "https://api.siliconflow.cn/v1"

async def main():
    client = AutoLLMClient(model="Qwen/Qwen3-Embedding-0.6B", client_type="openai-embedding")

    async for event in client.streaming_response_stateful(
        message={
            "role": "user",
            "content_items": [{"type": "text", "text": "Hello world"}],
        },
        config={},
    ):
        print(event)

asyncio.run(main())
```
</details>

<details><summary><strong>TypeScript Example</strong></summary>

```typescript
import { AutoLLMClient } from "@prismshadow/agenthub";

process.env.OPENAI_API_KEY = "your-siliconflow-api-key";
process.env.OPENAI_BASE_URL = "https://api.siliconflow.cn/v1";

async function main() {
  const client = new AutoLLMClient({
    model: "Qwen/Qwen3-Embedding-0.6B",
    clientType: "openai-embedding",
  });
  for await (const event of client.streamingResponseStateful({
    message: {
      role: "user",
      content_items: [{ type: "text", text: "Hello world" }],
    },
    config: {},
  })) {
    console.log(event);
  }
}

main().catch(console.error);
```
</details>

### DeepSeek via the OpenAI Responses protocol

Any compatible endpoint can be called through the generic protocol clients by picking the
client type (`openai-chat` / `openai-responses` / `ant-messages`) and the provider's base
URL for that protocol:

<details><summary><strong>Python Example</strong></summary>

```python
import asyncio
import os
from agenthub import AutoLLMClient

async def main():
    client = AutoLLMClient(
        model="deepseek-v4-flash",
        api_key=os.environ["DEEPSEEK_API_KEY"],
        base_url="https://api.deepseek.com",
        client_type="openai-responses",
    )
    async for event in client.streaming_response_stateful(
        message={
            "role": "user",
            "content_items": [{"type": "text", "text": "Say 'Hello, World!'"}]
        },
        config={}
    ):
        print(event)

asyncio.run(main())
```
</details>

<details><summary><strong>TypeScript Example</strong></summary>

```typescript
import { AutoLLMClient } from "@prismshadow/agenthub";

async function main() {
  const client = new AutoLLMClient({
    model: "deepseek-v4-flash",
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: "https://api.deepseek.com",
    clientType: "openai-responses",
  });
  for await (const event of client.streamingResponseStateful({
    message: {
      role: "user",
      content_items: [{ type: "text", text: "Say 'Hello, World!'" }],
    },
    config: {},
  })) {
    console.log(event);
  }
}

main();
```
</details>

### DeepSeek via the Anthropic Messages protocol

<details><summary><strong>Python Example</strong></summary>

```python
import asyncio
import os
from agenthub import AutoLLMClient

async def main():
    client = AutoLLMClient(
        model="deepseek-v4-flash",
        api_key=os.environ["DEEPSEEK_API_KEY"],
        base_url="https://api.deepseek.com/anthropic",
        client_type="ant-messages",
    )
    async for event in client.streaming_response_stateful(
        message={
            "role": "user",
            "content_items": [{"type": "text", "text": "Say 'Hello, World!'"}]
        },
        config={}
    ):
        print(event)

asyncio.run(main())
```
</details>

<details><summary><strong>TypeScript Example</strong></summary>

```typescript
import { AutoLLMClient } from "@prismshadow/agenthub";

async function main() {
  const client = new AutoLLMClient({
    model: "deepseek-v4-flash",
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: "https://api.deepseek.com/anthropic",
    clientType: "ant-messages",
  });
  for await (const event of client.streamingResponseStateful({
    message: {
      role: "user",
      content_items: [{ type: "text", text: "Say 'Hello, World!'" }],
    },
    config: {},
  })) {
    console.log(event);
  }
}

main();
```
</details>

The same model works over `client_type="openai-chat"` (base URL
`https://api.deepseek.com`); OpenRouter, Z.AI, and MiniMax expose all three protocols the
same way.

## Concepts: UniConfig, UniMessage and UniEvent

### UniConfig

UniConfig is an object that contains the configuration for LLMs.

Example UniConfig:

```json
{
  "max_tokens": 1024,
  "temperature": 1.0,
  "tools": [
    {
      "name": "get_current_weather",
      "description": "Get the current weather in a given location",
      "parameters": {
          "type": "object",
          "properties": {
              "location": {
                  "type": "string",
                  "description": "The city and state, e.g. San Francisco, CA"
              }
          },
          "required": ["location"]
      }
    }
  ],
  "thinking_summary": true,
  "thinking_level": "none | low | medium | high | xhigh | max",
  "tool_choice": "auto | required | none | a list of allowed tool names",
  "system_prompt": "You are a helpful assistant.",
  "prompt_caching": "enable | disable | enhance",
  "fast_mode": false,
  "image_config": {"aspect_ratio": "4:3", "image_size": "1K"},
  "tts_config": [{"voice": "Kore"}],
  "embedding_config": {"dimensions": 768},
  "trace_id": null
}
```

### UniMessage

UniMessage is an object that contains the input for LLMs.

Example UniMessage:

```json
{
  "role": "user | assistant",
  "content_items": [
    {"type": "text", "text": "How are you doing?"},
    {"type": "image_url", "image_url": "https://example.com/image.jpg"},
    {"type": "inline_data", "mime_type": "image/jpeg", "data": "base64-encoded-image"},
    {"type": "thinking", "thinking": "I am thinking.", "fidelity": {"signature": "0x123456"}},
    {"type": "inline_thinking", "mime_type": "image/jpeg", "data": "base64-encoded-image"},
    {"type": "tool_call", "name": "math", "arguments": {"expression": "2 + 3"}, "tool_call_id": "123"},
    {"type": "tool_result", "text": "2 + 3 = 5", "images": [], "tool_call_id": "123"}
  ]
}
```

### UniEvent

UniEvent is an object that contains streaming output of LLMs.

Example UniEvent:

```json
{
  "role": "assistant",
  "event_type": "delta",
  "content_items": [
    {"type": "partial_tool_call", "name": "math", "arguments": "", "tool_call_id": "123"}
  ],
  "usage_metadata": {
    "cached_tokens": null,
    "prompt_tokens": 10,
    "thoughts_tokens": null,
    "response_tokens": 1
  },
  "finish_reason": null,
  "created_at": 1694502400000
}
```

## Token Usage

AgentHub provides detailed token usage information through the `usage_metadata` field in streaming events.

The `usage_metadata` object contains four fields:
- `cached_tokens`: Cached input tokens
- `prompt_tokens`: Non-cached input tokens
- `thoughts_tokens`: Chain-of-thought output tokens
- `response_tokens`: Non-chain-of-thought output tokens

You can calculate the total token usage as follows:
- `input_tokens = cached_tokens + prompt_tokens`
- `output_tokens = thoughts_tokens + response_tokens`
- `total_tokens = input_tokens + output_tokens`

```
█████████████  ░░░░░░░░░░░░░ → LLM → ███████████████  ░░░░░░░░░░░░░░░
cached_tokens  prompt_tokens         thoughts_tokens  response_tokens
        input_tokens                          output_tokens
```

## Tracing LLM Executions

![Tracer Screenshot](.github/images/tracer.png)

We provide a tracer to help you monitor and debug your LLM executions. You can enable tracing by setting the `trace_id` parameter to a unique identifier in the `config` object.

```python
async for event in client.streaming_response_stateful(
    message={
        "role": "user",
        "content_items": [{"type": "text", "text": "Say 'Hello, World!'"}]
    },
    config={"trace_id": "unique-trace-id"}
):
    print(event)
```

```bash
cd src_py && uv run python -m agenthub.integration.tracer --host 127.0.0.1 --port 25750
```

```bash
cd src_ts && npm run tracer
```

Then you can view the tracing output in the dashboard at `http://localhost:25750/`.

## LLM Playground

![Playground Screenshot](.github/images/playground.png)

We provide a LLM playground to help you test your LLMs.

```bash
cd src_py && uv run python -m agenthub.integration.playground --host 127.0.0.1 --port 25751
```

```bash
cd src_ts && npm run playground
```

You can access the playground at `http://localhost:25751/`.
The integrated tracer is available at `http://localhost:25751/tracer/`.

## Wire Protocols

Every client speaks one vendor protocol on the wire, whichever `client_type` reaches it:

| `client_type`                                              | Wire protocol      |
| ---------------------------------------------------------- | ------------------ |
| `gemini-3.8`, `gemini-3.7`, `gemini-3`, `gemini-embedding` | `google-genai`     |
| `claude-5`, `claude-4-8`, `claude-4-7`, `claude-4-6`       | `ant-messages`     |
| `ant-messages`                                             | `ant-messages`     |
| `gpt-6`, `gpt-5.6`, `gpt-5.5`, `gpt-5.4`                   | `openai-responses` |
| `deepseek-v4`                                              | `openai-responses` |
| `minimax-m3`                                               | `openai-responses` |
| `openai-responses`                                         | `openai-responses` |
| `glm-5.3`, `glm-5.2`, `glm-5.1`                            | `openai-chat`      |
| `kimi-k3`, `kimi-k2.6`, `kimi-k2.5`                        | `openai-chat`      |
| `openai-chat` (alias `openai`)                             | `openai-chat`      |
| `openai-chat-vllm-adapter`                                 | `openai-chat`      |
| `openai-embedding`                                         | `openai-embedding` |

## Related Work

- [OpenRouter](https://openrouter.ai/)
- [Open Responses](https://www.openresponses.org/)

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.

## Used By

Projects built on AgentHub:

- [PenguinHarness](https://github.com/Prism-Shadow/penguin-harness)
