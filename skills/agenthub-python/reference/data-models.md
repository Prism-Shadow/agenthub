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
- `thinking_summary` (`bool`): Request a thinking summary when supported; whether a model returns one is model-dependent (gemini-3.8-flash and gemini-3.1-pro do).
- `thinking_level` (`ThinkingLevel`): `none`, `low`, `medium`, `high`, `xhigh`, or `max`. AgentHub maps each level to the closest effort the model supports, so any level is safe to pass.
- `tool_choice` (`ToolChoice`): `auto`, `required`, `none`, or a list of tool names; support varies by model.
- `system_prompt` (`str`): System instruction text.
- `prompt_caching` (`PromptCaching`): `enable`, `disable`, or `enhance`.
- `image_config` (`ImageConfig`): `aspect_ratio` (`1:1`, `2:3`, `3:2`, `3:4`, `4:3`, `9:16`, `16:9`, `21:9`) and `image_size` (`1K`, `2K`).
- `tts_config` (`list[SpeakerConfig]`): Voice config; each item has `voice` and optional `speaker`.
- `embedding_config` (`EmbeddingConfig`): Embedding config, currently `dimensions`.
- `trace_id` (`str`): Stable ID for tracer output.

## UniMessage

`UniMessage` is the durable message shape used in history. Every content item in a message is a complete item, typed with a `.done` suffix.

```python
message = {
    "role": "user",
    "content_items": [
        {"type": "text.done", "text": "Hello", "fidelity": {"phase": "commentary"}},
        {"type": "image_url.done", "image_url": "https://example.com/image.jpg"},
        {"type": "inline_data.done", "data": b"...", "mime_type": "image/png", "fidelity": {"signature": "sig"}},
        {"type": "thinking.done", "thinking": "Reasoning", "fidelity": {"signature": "sig"}},
        {"type": "inline_thinking.done", "data": b"...", "mime_type": "image/png", "fidelity": {"signature": "sig"}},
        {"type": "tool_call.done", "name": "get_weather", "arguments": {"location": "Paris"}, "tool_call_id": "call_1", "fidelity": {"signature": "sig"}},
        {"type": "tool_result.done", "text": "22 C", "tool_call_id": "call_1"},
        {"type": "embedding.done", "embedding": [0.1, 0.2]},
    ],
}
```

Fields:

- `role` (`Role`): `user` or `assistant`.
- `content_items` (`list[ContentItem]`): Message payload.
- `usage_metadata` (`UsageMetadata | None`): Optional token counts on completed assistant messages.
- `finish_reason` (`FinishReason | None`): `stop`, `length`, `tool_call`, `unknown`, or `None`.
- `created_at` (`int`): Unix milliseconds.

Content items (`ContentItem`):

- `text.done`: Text; may carry `fidelity`.
- `image_url.done`: Image URL or data URI.
- `inline_data.done`: Inline media bytes with MIME type; may carry `fidelity`.
- `thinking.done`: Text reasoning content; may carry `fidelity`.
- `inline_thinking.done`: Binary reasoning artifact; may carry `fidelity`.
- `tool_call.done`: Complete model tool request with `name`, `arguments` parsed into a dict, `tool_call_id`, and optional `fidelity`.
- `tool_result.done`: Tool output text for a `tool_call_id`; may include image URLs.
- `embedding.done`: Numeric embedding vector.

`fidelity` is an arbitrary JSON object of wire-level data the client recorded to reproduce the original message on replay — thinking signatures, phase labels, the upstream reasoning field name, and the like. It is opaque: pass it back unchanged, never modify or drop it.

### Legacy item types

Messages saved before 0.5.0 use item types without the suffix (`text`, `tool_call`, …). Until 0.6.0 AgentHub still accepts them and converts them to the `.done` types, dropping stray `partial_tool_call` items and emitting one `FutureWarning` per process. The conversion applies to request messages, the stateful message, `set_history`, and trace files loaded by the tracer; output always uses the new types. To migrate stored data, call `normalize_legacy_messages(messages)`: it returns converted copies and leaves current messages untouched. The conversion is removed in 0.6.0.

## UniEvent

`UniEvent` is the streamed output shape: `delta` events while the response is running, then exactly one `stop` event.

```python
delta_event = {
    "role": "assistant",
    "event_type": "delta",
    "content_items": [{"type": "text.delta", "text": "Hel"}],
    "usage_metadata": None,
    "finish_reason": None,
    "created_at": 1694502400000,
}

stop_event = {
    "role": "assistant",
    "event_type": "stop",
    "content_items": [],
    "usage_metadata": {"cached_tokens": 0, "prompt_tokens": 10, "thoughts_tokens": None, "response_tokens": 5},
    "finish_reason": "stop",
    "created_at": 1694502400100,
}
```

Fields:

- `role` (`Role`): `assistant`.
- `event_type` (`EventType`): `delta` while the response is running; `stop` once it has finished.
- `content_items` (`list[EventContentItem]`): Exactly one `.delta` or `.done` item on a `delta` event; empty on the `stop` event.
- `usage_metadata` (`UsageMetadata | None`): `None` on `delta` events; on the `stop` event, the request's token counts: `cached_tokens`, `prompt_tokens`, `thoughts_tokens`, `response_tokens`.
  Token math: `input = cached_tokens + prompt_tokens`; `output = thoughts_tokens + response_tokens`; treat `None` as `0`.
- `finish_reason` (`FinishReason | None`): `None` on `delta` events; `stop`, `length`, `tool_call`, or `unknown` on the `stop` event.
- `created_at` (`int`): Unix milliseconds.

Delta items (`DeltaContentItem`, events only):

- `text.delta`: A `text` fragment; may carry `fidelity`.
- `thinking.delta`: A `thinking` fragment; may carry `fidelity`.
- `inline_data.delta`: A chunk of `data` bytes with `mime_type`; may carry `fidelity`.
- `inline_thinking.delta`: A chunk of binary reasoning bytes with `mime_type`; may carry `fidelity`.
- `tool_call.delta`: A raw JSON string fragment of `arguments`; `name` and `tool_call_id` are non-empty on the first fragment of a call and `""` afterwards; may carry `fidelity`.
- `embedding.delta`: An embedding vector.

`image_url` and `tool_result` are input-only and have no delta form.

## Streaming Protocol

Every client streams by the same grammar:

```text
stream := delta_event* stop_event
items  := group*                     the items of the delta events, one per event, in order
group  := K.delta+ K.done            K = text | thinking | tool_call | inline_data | inline_thinking | embedding
```

- **One item per delta event.** Taken in order, the items of the `delta` events form groups: one or more `K.delta` fragments, then one `K.done` holding the complete item — the concatenated text, thinking, or bytes; the parsed tool call; the vector.
- **The `.done` items are the message.** In stream order, with the `stop` event's `usage_metadata` and `finish_reason`, they form the assistant message that `streaming_response_stateful` records in history.
- **Groups never interleave.** A group's `.done` arrives before the next group's first `.delta`, so every fragment belongs to the group currently open and no id is needed to attribute it. When a provider streams several items at once, such as parallel tool calls, AgentHub holds the later item back until the earlier one is done.
- **`stop` is always last.** It arrives exactly once, carries no content items, and always carries non-null `usage_metadata` and `finish_reason`. While events are `delta`, the response is still running; after `stop`, it has finished and nothing follows. Read usage from the `stop` event; do not add it up across events.
- **Fidelity appears at most once per item.** Within a group at most one `.delta` carries a non-empty `fidelity`, and it equals the `.done` item's `fidelity`; when no fragment carries one, neither does the `.done` item. That fragment may be otherwise empty, such as a thinking signature arriving after the thinking text.

A Claude turn that thinks, then calls a tool, streams these items:

```text
delta  thinking.delta   thinking="Let me"
delta  thinking.delta   thinking=" check"
delta  thinking.delta   thinking=""  fidelity={"signature": "..."}
delta  thinking.done    thinking="Let me check"  fidelity={"signature": "..."}
delta  tool_call.delta  name="get_weather"  tool_call_id="toolu_1"  arguments=""
delta  tool_call.delta  name=""  tool_call_id=""  arguments="{\"location\": "
delta  tool_call.delta  name=""  tool_call_id=""  arguments="\"Paris\"}"
delta  tool_call.done   name="get_weather"  tool_call_id="toolu_1"  arguments={"location": "Paris"}
stop   usage_metadata={...}  finish_reason="tool_call"
```

### Tool calls

- The first `tool_call.delta` of a call carries non-empty `name` and `tool_call_id`, and its `arguments` is a JSON string fragment (often `""`). Later fragments carry only `arguments`.
- `tool_call.done` carries `name`, `tool_call_id`, and `arguments` parsed into a dict. Read tool calls from `tool_call.done` items; treat `tool_call.delta` fragments as live progress only. Send each tool result back with the exact `tool_call_id` from its `tool_call.done`.
- `minimax-m3` reads each call from the server's completed output item rather than from the argument deltas, so its calls stream as a single `tool_call.delta` carrying the name, id, and whole arguments string, then the `tool_call.done`. The rules above apply unchanged.
- The final arguments must parse to a JSON object. If the streamed JSON is malformed, truncated, or parses to a non-object value such as an array, AgentHub raises `ToolCallArgumentParseError` in place of the `tool_call.done`, so a tool is never executed from partial arguments.

## Errors

Errors raised by AgentHub inherit `AgentHubError`, a `ValueError` subclass. A stream ends either with its `stop` event or with an exception, never both:

- `ToolCallArgumentParseError` — streamed tool-call arguments were malformed or not a JSON object. It carries `client`, `tool_name`, `tool_call_id`, `raw_arguments_length`, and `raw_arguments_preview` so the caller can log the bad model output and retry or re-prompt.
- `EmptyResponseError` — the response finished with thinking content only, which fails with a 400 error when sent back on the next turn. It is raised instead of the `stop` event, leaves the stateful history unchanged, and carries `client`, `finish_reason`, and `usage_metadata` so the tokens of the rejected response can still be accounted for.
- `StreamProtocolError` — a client produced a stream that breaks the protocol above. It reports a bug in AgentHub rather than in the model output, is raised whether or not `AGENTHUB_DEBUG` is set, and carries `client`.
