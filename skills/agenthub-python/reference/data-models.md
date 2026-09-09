# Data Models

AgentHub uses `UniConfig`, `UniMessage`, and `UniEvent` to represent request options, conversation history, and streamed outputs across providers.

## UniConfig

`UniConfig` is the request config for `streaming_response` and `streaming_response_stateful`. All fields are optional.

```python
config = {
    "max_tokens": 1024,
    "temperature": 1.0,
    "tools": [{
        "name": "get_weather",
        "description": "Get weather.",
        "parameters": {
            "type": "object",
            "properties": {"location": {"type": "string", "description": "City name."}},
            "required": ["location"],
        },
    }],
    "tool_choice": "auto",
    "thinking_summary": True,
    "thinking_level": "high",
    "system_prompt": "You are helpful.",
    "prompt_caching": "enable",
    "image_config": {"aspect_ratio": "4:3", "image_size": "1K"},
    "tts_config": [{"voice": "Kore"}],
    "embedding_config": {"dimensions": 768},
    "trace_id": "agent1/conversation_001",
}
```

Fields:

- `max_tokens` (`int`): Output token limit.
- `temperature` (`float`): Sampling temperature; support varies by model.
- `tools` (`list[ToolSchema]`): Tools with `name`, `description`, and optional JSON Schema `parameters`.
- `thinking_summary` (`bool`): Request a thinking summary when supported. Gemini returns summaries only on some models (3.1-pro does; the 3.5-3.8 flash models do not).
- `thinking_level` (`ThinkingLevel`): `none`, `low`, `medium`, `high`, `xhigh`, or `max`. GPT-6 rejects `none`, so the client sends `low` for it.
- `tool_choice` (`ToolChoice`): `auto`, `required`, `none`, or a list of tool names; support varies by model.
- `system_prompt` (`str`): System instruction text.
- `prompt_caching` (`PromptCaching`): `enable`, `disable`, or `enhance`.
- `image_config` (`ImageConfig`): `aspect_ratio` (`1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `9:16`, `16:9`, `21:9`) and `image_size` (`1K`, `2K`).
- `tts_config` (`list[SpeakerConfig]`): Voice config; each item has `voice` and optional `speaker`.
- `embedding_config` (`EmbeddingConfig`): Embedding config, currently `dimensions`.
- `trace_id` (`str`): Stable ID for tracer output.

## UniMessage

`UniMessage` is the durable message shape used in history.

```python
message = {
    "role": "user",
    "content_items": [
        {"type": "text", "text": "Hello", "fidelity": {"phase": "commentary"}},
        {"type": "image_url", "image_url": "https://example.com/image.jpg"},
        {"type": "inline_data", "data": b"...", "mime_type": "image/png", "fidelity": {"signature": "sig"}},
        {"type": "thinking", "thinking": "Reasoning", "fidelity": {"signature": "sig"}},
        {"type": "inline_thinking", "data": b"...", "mime_type": "image/png", "fidelity": {"signature": "sig"}},
        {"type": "tool_call", "name": "get_weather", "arguments": {"location": "Paris"}, "tool_call_id": "call_1", "fidelity": {"signature": "sig"}},
        {"type": "tool_result", "text": "22 C", "tool_call_id": "call_1"},
        {"type": "embedding", "embedding": [0.1, 0.2]},
    ],
}
```

Fields:

- `role` (`Role`): `user` or `assistant`.
- `content_items` (`list[ContentItem]`): Message payload.
- `usage_metadata` (`UsageMetadata | None`): Optional token counts on completed assistant messages.
- `finish_reason` (`FinishReason | None`): `stop`, `length`, `tool_call`, `unknown`, or `None`.
- `created_at` (`int`): Unix milliseconds.

Content items:

- `text`: Text chunk; may carry `fidelity`.
- `image_url`: Image URL or data URI.
- `inline_data`: Inline media bytes with MIME type; may carry `fidelity`.
- `thinking`: Text reasoning content; may carry `fidelity`.
- `inline_thinking`: Binary reasoning artifact; may carry `fidelity`.
- `tool_call`: Complete model tool request with name, args, ID, and optional `fidelity`.
- `tool_result`: Tool output text for a `tool_call_id`; may include image URLs.
- `embedding`: Numeric embedding vector.

`fidelity` is an arbitrary JSON object of wire-level data the client recorded to reproduce the original message on replay — thinking signatures, phase labels, the upstream reasoning field name, and the like. It is opaque: pass it back unchanged, never modify or drop it.

## UniEvent

`UniEvent` is the streamed output shape. Read token counts from `usage_metadata` here.

```python
event = {
    "role": "assistant",
    "event_type": "delta",
    "content_items": [
        {"type": "partial_tool_call", "name": "get_weather", "arguments": "{\"location\":\"Par", "tool_call_id": "call_1"}
    ],
    "usage_metadata": {"cached_tokens": 0, "prompt_tokens": 10, "thoughts_tokens": None, "response_tokens": 1},
    "finish_reason": None,
    "created_at": 1694502400000,
}
```

Fields:

- `role` (`Role`): `user` or `assistant`.
- `event_type` (`EventType`): `start`, `delta`, `stop`, or `unused`.
- `content_items` (`list[PartialContentItem]`): Stream payload; includes `ContentItem` plus `partial_tool_call`.
- `usage_metadata` (`UsageMetadata | None`): Token counts: `cached_tokens`, `prompt_tokens`, `thoughts_tokens`, `response_tokens`.
  Token math: `input = cached_tokens + prompt_tokens`; `output = thoughts_tokens + response_tokens`; treat `None` as `0`.
- `finish_reason` (`FinishReason | None`): `stop`, `length`, `tool_call`, `unknown`, or `None`.
- `created_at` (`int`): Unix milliseconds.

Event-only content item:

- `partial_tool_call`: Streaming tool-call fragment with `name`, partial JSON `arguments`, and `tool_call_id`.

## Tool-Call Streaming Protocol

Across providers a tool call streams as the same ordered sequence of events, so consumers handle every model the same way:

1. **Announce (name + id first).** The first event for a tool call carries a `partial_tool_call` whose `name` and `tool_call_id` are non-empty and whose `arguments` is a JSON **string fragment** (often `""`). The tool's identity arrives no later than the first argument bytes.
2. **Argument deltas.** Zero or more `delta` events follow, each carrying a `partial_tool_call` whose `arguments` is the next fragment of the arguments JSON string (`name` and `tool_call_id` are empty `""`). Concatenate the fragments in order.
3. **Complete call (last).** One final event carries a complete `tool_call` item: `name`, `tool_call_id`, and `arguments` parsed into a dict. Read tool calls from these `tool_call` items; treat the `partial_tool_call` fragments as live progress only.

The final `arguments` value must parse to a JSON object. If the streamed JSON is malformed, truncated, or parses to a non-object value such as an array, AgentHub raises `ToolCallArgumentParseError` instead of yielding a complete `tool_call`. The error carries `client`, `tool_name`, `tool_call_id`, `raw_arguments_length`, and `raw_arguments_preview` so the caller can log the bad model output and retry or re-prompt without executing a tool from partial arguments.

For consecutive or parallel tool calls, each new call restarts at step 1 with its own `name` and `tool_call_id`, so one call's arguments never bleed into the next. Send each tool result back with the exact `tool_call_id` from its `tool_call`.

## Errors

Errors raised by AgentHub inherit `AgentHubError`, a `ValueError` subclass:

- `ToolCallArgumentParseError` — streamed tool-call arguments were malformed or not a JSON object. It carries `client`, `tool_name`, `tool_call_id`, `raw_arguments_length`, and `raw_arguments_preview`.
- `EmptyResponseError` — the response finished with thinking content only, which fails with a 400 error when sent back on the next turn. It carries `client` and `finish_reason`.
