# Streaming protocol v2: `delta` and `stop` events, `.delta` and `.done` content items

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `types`, `base_client`, `errors`, `integration`, `skills`
- **PR:** TBD
- **Breaking:** yes — every content item type gained a `.delta` or `.done` suffix, the `start` and `unused` event types and the `partial_tool_call` item were removed, and clients return client parts instead of events

[中文版](2026-09-16-streaming-protocol-v2.zh.md)

## What changed

- `EventType` became `"delta" | "stop"` and `UniEvent` became `UniDeltaEvent | UniStopEvent`. A stream is any number of `delta` events followed by exactly one `stop` event, always last. A `delta` event carries exactly one content item, with null `usage_metadata` and `finish_reason`; the `stop` event carries no content items and a non-null `usage_metadata` and `finish_reason`. The `start` and `unused` event types were removed.
- Content item types were split into complete items and streamed fragments. `ContentItem` became the `.done` family — `text.done`, `image_url.done`, `inline_data.done`, `thinking.done`, `inline_thinking.done`, `tool_call.done`, `tool_result.done`, `embedding.done` (`TextDoneItem`, `ImageUrlDoneItem`, …) — and is the only family a `UniMessage` holds. `DeltaContentItem` was added as the event-only `.delta` family — `text.delta`, `inline_data.delta`, `thinking.delta`, `inline_thinking.delta`, `tool_call.delta`, `embedding.delta` (`TextDeltaItem`, …) — with `EventContentItem = DeltaContentItem | ContentItem`. The previous item types (`TextContentItem`, `PartialToolCallContentItem`, `PartialContentItem`, …) were removed, and with them `partial_tool_call` and its `item_id`.
- Every client streams by one grammar: each item streams as one or more `.delta` fragments followed by one `.done` item holding the complete content — the concatenated text, thinking, or bytes; the tool call with its `arguments` parsed; the vector. Items never interleave: an item that starts while another is still streaming is held back until that one is done. Within an item at most one `.delta` carries a non-empty `fidelity`, and it equals the `.done` item's; a fragment carrying only fidelity may have empty content (a Claude signature, a GPT `phase`, Responses encrypted reasoning). The first `tool_call.delta` of a call carries its `name` and `tool_call_id`; later fragments carry only `arguments`.
- `minimax_m3` streams each tool call read from the completed output item as one `tool_call.delta` carrying the name, id, and whole arguments, then the `tool_call.done`.
- `ToolCallArgumentParseError` is raised in place of the `tool_call.done` of a call whose arguments do not parse to a JSON object.
- `EmptyResponseError` is raised in place of the `stop` event and gained `usage_metadata` / `usageMetadata`. A stream that ends without usage or a finish reason also raises in place of the `stop` event.
- `StreamProtocolError` (an `AgentHubError` carrying `client`) was added and exported from the package. It is raised in every mode when a client's output breaks the grammar: a fragment after its item is done, a second different fidelity within one item, a first `tool_call.delta` without a name or id, or a fragment of another kind under an item's key.
- `streaming_response` / `streamingResponse` saves the `trace_id` trace, and `streaming_response_stateful` / `streamingResponseStateful` records the turn in history, before yielding the `stop` event.
- `concat_uni_events_to_uni_message` / `concatUniEventsToUniMessage` collects the `.done` items in stream order and takes `usage_metadata`, `finish_reason`, and `created_at` from the `stop` event; its merge heuristics were removed.
- The tracer and playground read and render the new item types; the playground streams on `.delta` items and the `stop` event.
- The test helpers `assert_stream_grammar` / `assertStreamGrammar` were added; the shared e2e tests check every model's stream with them and read tool calls from `tool_call.done`.
- The READMEs, the `skills/agenthub-python` and `skills/agenthub-typescript` references, the examples, and the dev skill were rewritten for the new protocol.

## Client parts

- `transform_model_output_to_uni_event` / `transformModelOutputToUniEvent` was replaced by `transform_model_output_to_client_parts` / `transformModelOutputToClientParts`, which returns a list of `ClientPart`s, and `_streaming_response_internal` / `_streamingResponseInternal` yields those parts instead of events. A part is `delta` (one `.delta` item under the provider's key for the item), `done` (the item under a key is complete), or `finish` (`usage_metadata` and/or `finish_reason`). A wire event with nothing universal returns `[]`.
- The base class assembles the parts into events: it concatenates fragments, parses tool-call arguments, merges usage pieces field by field, closes items still open when the provider stream ends, and builds the `stop` event. The per-client tool-call accumulators, argument parsing, usage merging, and stop synthesis were removed, as was the base-class guard for `unused` events.
- Keys: the content block index on `claude5` and `ant_messages`; the output item id on `gpt6`, `openai_responses`, `deepseek_v4`, and `minimax_m3`; a sequence number on `openai_chat`, `openai_chat_vllm_adapter`, `glm5_3`, and `kimi_k3`, which advances when the streamed kind changes or a new tool call starts, with the previous item closed at that point; the step index plus the run of one content kind within the step (`<index>.<run>`) on `gemini3_8`; `embedding:<i>` on `openai_embedding` and for `gemini3_8` embeddings.
- Fidelity is attached once, to the delta at which it is complete: the Claude signature on an empty `thinking.delta`, the Responses reasoning fidelity on an empty `thinking.delta` at `response.output_item.done`, the GPT `phase` on an empty `text.delta` at `response.output_item.added`. The `reasoning_field` the Chat Completions clients attach to every reasoning delta goes out once.

## Compatibility

- Stream consumers: branch on `event_type` `delta` / `stop` only; read `usage_metadata` and `finish_reason` from the `stop` event instead of taking the latest values across events; read complete items from the `.done` types (`tool_call.done` instead of `tool_call`, `text.done` instead of summing `text`) and live fragments from the `.delta` types (`tool_call.delta` instead of `partial_tool_call`); attribute every fragment to the item currently streaming instead of by `item_id`.
- A thinking-only response no longer yields events carrying its usage before `EmptyResponseError`; read the usage from the error's `usage_metadata` / `usageMetadata`.
- Code that builds messages: write the `.done` types (`text.done`, `image_url.done`, `tool_result.done`, …). Messages with the old types keep working, with a deprecation warning, until 0.6.0 — see [accepting content items recorded before 0.5.0](2026-09-16-backward-compatibility.md).
- Type imports: `TextContentItem` → `TextDoneItem`, `ImageContentItem` → `ImageUrlDoneItem`, `ToolCallContentItem` → `ToolCallDoneItem`, and so on for each item; `PartialContentItem` → `EventContentItem`.
