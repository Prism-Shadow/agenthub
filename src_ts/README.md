# AgentHub TypeScript Implementation

This directory contains the TypeScript implementation of AgentHub, mirroring the Python implementation in `src_py/`.

## Building

```bash
make install  # Install dependencies
make build    # Build TypeScript to JavaScript
make lint     # Run ESLint
make test     # Run tests
```

## Usage

### Basic Client Usage

```typescript
import { AutoLLMClient } from "@prismshadow/agenthub";

process.env.OPENAI_API_KEY = "your-openai-api-key";

async function main() {
  const client = new AutoLLMClient({ model: "gpt-5.5" });
  // For OpenAI Chat Completions-compatible endpoints:
  // const client = new AutoLLMClient({ model: "custom-model", clientType: "openai" });
  // For Gemini on Google Vertex AI, the service-account JSON key is the API key:
  // const client = new AutoLLMClient({ model: "gemini-3.8-flash", apiKey: fs.readFileSync("service-account.json", "utf8") });

  for await (const event of client.streamingResponseStateful({
    message: {
      role: "user",
      content_items: [{ type: "text.done", text: "Hello!" }],
    },
    config: {},
  })) {
    console.log(event);
  }
}

main().catch(console.error);
```

A Vertex AI service-account key is served through generateContent, because Vertex AI's Interactions endpoint serves none of the Gemini models; any other Gemini key uses the Interactions API. `clientType: "gemini-interactions"` and `clientType: "gemini-generate-content"` pin the wire protocol explicitly, the latter also for gateways that proxy generateContent only.

Both streaming methods yield `delta` events, each carrying exactly one content item, then exactly one `stop` event, always last, carrying `usage_metadata` and `finish_reason`. Each item streams as one or more `.delta` fragments (`text.delta`, `tool_call.delta`, …) followed by its complete `.done` item (`text.done`, `tool_call.done`, …); items never interleave.

### History Management

```typescript
// Get current history
const history = client.getHistory();

// Clear all history
client.clearHistory();

// Replace history with a saved copy
client.setHistory(history);
```

Messages hold complete items only, typed with a `.done` suffix. Item types without the suffix, saved before 0.5.0, are still accepted with a deprecation warning until 0.6.0; `normalizeLegacyMessages(messages)` converts stored messages.

### Tracer Usage

Save and browse conversation history with a web interface:

```typescript
import { Tracer } from "@prismshadow/agenthub/integration/tracer";

// Create a tracer instance
const tracer = new Tracer("./cache");

// Save conversation history
const model = "gpt-5.5";
const history = [
  { role: "user", content_items: [{ type: "text.done", text: "Hello!" }] },
  { role: "assistant", content_items: [{ type: "text.done", text: "Hi there!" }] },
];
const config = {};
tracer.saveHistory(model, history, "session/conv_001", config);

// Start web server to view saved conversations
tracer.startWebServer("127.0.0.1", 25750);
// Open http://127.0.0.1:25750 in your browser
```

### Playground Usage

Interactive web interface for chatting with LLMs:

```typescript
import { startPlaygroundServer } from "@prismshadow/agenthub/integration/playground";

// Start the playground server
startPlaygroundServer("127.0.0.1", 25751);
// Open http://127.0.0.1:25751 in your browser
// Open http://127.0.0.1:25751/tracer/ to browse traces
```

## Examples

Run the examples:

```bash
# Build the project
npm run build

# Run tracer example
npm run tracer

# Run playground example
npm run playground
```
