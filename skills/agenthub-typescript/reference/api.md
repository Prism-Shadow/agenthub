# APIs

`AutoLLMClient` exposes five basic APIs. Prefer the stateful stream for agent loops. See [Basic Usage](../SKILL.md#basic-usage) for a full tool-use example.

## Initialization

Initialize `AutoLLMClient` in one of three common ways:

```typescript
// Initialize with model name
const clientByModel = new AutoLLMClient({ model: "gpt-5.5" });

// Optionally specify API key (if not using environment variables)
const clientWithEndpoint = new AutoLLMClient({
  model: "gpt-5.5",
  apiKey: "your-openai-api-key",
  baseUrl: "https://api.openai.com/v1",
});

// Use OpenAI Chat Completions-compatible routing explicitly
const clientWithType = new AutoLLMClient({
  model: "custom-model",
  clientType: "openai-chat",
});
```

## Method signatures

```typescript
/** Stream one stateless response from a full message list: delta events, then one stop event. */
streamingResponse(options: { messages: UniMessage[]; config: UniConfig }): AsyncGenerator<UniEvent>;

/** Stream one stateful response and update client history before yielding the stop event. */
streamingResponseStateful(options: { message: UniMessage; config: UniConfig }): AsyncGenerator<UniEvent>;

/** Return a copy of stateful history. */
getHistory(): UniMessage[];

/** Replace stateful history with a copy. */
setHistory(history: UniMessage[]): void;

/** Clear stateful history. */
clearHistory(): void;
```

## Module-level helpers

```typescript
/**
 * List supported models covering official endpoints plus OpenRouter and
 * SiliconFlow. Each entry carries (model, base_url, client) - mapping onto the
 * AutoLLMClient constructor (model, baseUrl, clientType) - plus input/output
 * modalities (Text/Image/Video/Audio/Embed), context_window, and
 * per-million-token pricing in the requested currency (official list prices,
 * converted at 7 CNY/USD).
 */
function listSupportedModels(currency?: "USD" | "CNY"): SupportedModel[];

/**
 * Convert messages saved before 0.5.0 to the `.done` item types; messages already
 * current are returned as they are. Removed in 0.6.0.
 */
function normalizeLegacyMessages(messages: UniMessage[]): UniMessage[];
```

## Errors

All AgentHub errors subclass `AgentHubError`. Unsupported `UniConfig` values (e.g.
`temperature` or `tool_choice` on models that reject them) throw
`UnsupportedParameterError`, which carries `client` and `parameter` fields. Thinking
levels never throw: every client maps each `ThinkingLevel` to the closest supported level.
Errors thrown while streaming (`ToolCallArgumentParseError`, `EmptyResponseError`,
`StreamProtocolError`) are listed in [Data models](data-models.md#errors).
