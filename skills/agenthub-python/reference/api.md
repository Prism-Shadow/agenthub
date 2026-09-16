# APIs

`AutoLLMClient` exposes five basic APIs. Prefer the stateful stream for agent loops. See [Basic Usage](../SKILL.md#basic-usage) for a full tool-use example.

## Initialization

Initialize `AutoLLMClient` in one of three common ways:

```python
# Initialize with model name
client = AutoLLMClient(model="gpt-5.5")

# Optionally specify API key (if not using environment variables)
client = AutoLLMClient(
    model="gpt-5.5",
    api_key="your-openai-api-key",
    base_url="https://api.openai.com/v1",
)

# Use OpenAI Chat Completions-compatible routing explicitly
client = AutoLLMClient(model="custom-model", client_type="openai-chat")
```

## Method signatures

```python
async def streaming_response(messages: list[UniMessage], config: UniConfig) -> AsyncIterator[UniEvent]:
    """Stream one stateless response from a full message list: delta events, then one stop event."""

async def streaming_response_stateful(message: UniMessage, config: UniConfig) -> AsyncIterator[UniEvent]:
    """Stream one stateful response and update client history before yielding the stop event."""

def get_history() -> list[UniMessage]:
    """Return a copy of stateful history."""

def set_history(history: list[UniMessage]) -> None:
    """Replace stateful history with a copy."""

def clear_history() -> None:
    """Clear stateful history."""
```

## Module-level helpers

```python
def list_supported_models(currency: Literal["USD", "CNY"] = "USD") -> list[SupportedModel]:
    """List supported models covering official endpoints plus OpenRouter and SiliconFlow.
    Each entry carries (model, base_url, client) - mapping onto the AutoLLMClient
    constructor (model, base_url, client_type) - plus input/output modalities
    (Text/Image/Video/Audio/Embed), context_window, and per-million-token pricing in the
    requested currency (official list prices, converted at 7 CNY/USD)."""

def normalize_legacy_messages(messages: list[UniMessage]) -> list[UniMessage]:
    """Convert messages saved before 0.5.0 to the `.done` item types; messages already
    current are returned as they are. Removed in 0.6.0."""
```

## Errors

All AgentHub errors subclass `AgentHubError` (a `ValueError`). Unsupported `UniConfig`
values (e.g. `temperature` or `tool_choice` on models that reject them) raise
`UnsupportedParameterError`, which carries `client` and `parameter` attributes. Thinking
levels never raise: every client maps each `ThinkingLevel` to the closest supported level.
Errors raised while streaming (`ToolCallArgumentParseError`, `EmptyResponseError`,
`StreamProtocolError`) are listed in [Data models](data-models.md#errors).
