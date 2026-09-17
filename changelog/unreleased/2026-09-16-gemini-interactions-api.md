# Gemini client moved to the Interactions API

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `gemini3_8`, `tests`, `llmsdk_docs`
- **PR:** [#223](https://github.com/Prism-Shadow/agenthub/pull/223)
- **Breaking:** yes — the Gemini SDKs moved to a new major version (`@google/genai` 2.x, `google-genai` 2.x), a Gemini turn that calls tools now finishes with `tool_call` instead of `stop`, and `fast_mode` on Gemini sends the priority tier instead of raising

[中文版](2026-09-16-gemini-interactions-api.zh.md)

## What changed

- `Gemini3_8Client` (Python and TypeScript) sends text, image, and TTS requests through the Interactions API (`client.interactions.create`, streamed, `store: false`, the whole history in every request); the generateContent client moved to `gemini3_8_generate_content/` and serves Vertex AI (see [Gemini on Vertex AI through generateContent](2026-09-17-gemini-vertex-generate-content.md)). Embedding models stay on `models.embedContent`, because the Interactions API answers them with 404.
- The SDK requirements were raised to `@google/genai` `^2.22.0` and `google-genai>=2.23.0`.
- Streams are keyed by the step `index`. A step whose content switches kind streams one item per run of a kind, keyed `<index>.<run>`, so an image model's thought summary that goes text, image, text is three items; every image is an item of its own, while audio chunks join into one.
- A `thought` step streams `thought_summary` text as `thinking.delta` and summary images as `inline_thinking.delta`; its `thought_signature` goes out as `fidelity.signature` on an empty delta of the item the step ends with (an empty `thinking.delta` when the step has no summary). Every Gemini text response therefore carries a `thinking.done` item holding the signature, with empty `thinking` when summaries are off.
- A `function_call` step opens its `tool_call.delta` with the call's name and id and streams the arguments as fragments. `model_output` steps stream `text.delta` and `inline_data.delta` for images and audio; TTS audio carries the mime type `audio/l16; rate=<sample_rate>; channels=<channels>`.
- `interaction.completed` sets the finish reason and usage; an `error` event carrying an error raises an error naming the provider's code and message; unknown events, steps, and deltas are skipped, or raised under `AGENTHUB_DEBUG`.
- Messages are sent as Interactions steps: user text and images as `user_input` steps, with images inlined as base64 and URLs fetched; assistant text and media as `model_output` steps; thinking items as one `thought` step per run, carrying the summary and the signature of the item that ends the run; `tool_call.done` as `function_call`; `tool_result.done` as `function_result` with the function `name` looked up from the call, a plain string result for text only, and a text-and-image content list when images are attached. Empty text blocks are left out.
- Histories recorded through the generateContent client carry `fidelity.signature` on text, inline-data, or tool-call items; such an item replays behind a `thought` step carrying its signature. A signature recorded as bytes by the generateContent Python SDK, on thinking items as on the rest, is sent as base64.
- Calls recorded with the function name as their id replay without `id` and `call_id`.
- An assistant message holding a `thought` step that does not open with one (the image model sometimes streams its text before its first thought) replays with a leading `thought` step carrying the placeholder signature `skip_thought_signature_validator`, as does an assistant message with text, media, or tool calls but no `thought` step carrying a signature (a turn another provider produced).
- `thinking_summary: true` streams thought summaries on `gemini-3.8-flash`.
- The Gemini cases of the shared unit tests (`unknown-events`, `message-order`, `thinking-level-mapping`) were rewritten against the Interactions events and steps.
- `llmsdk_docs/gemini_interactions/README.md` records that the image model can stream text before its first thought, that parallel calls sharing one id and empty text blocks are rejected on replay, and the accepted replay of a text-first image turn.

## Configuration behavior

| `UniConfig` | Interactions request |
| --- | --- |
| `max_tokens` | `generation_config.max_output_tokens` |
| `system_prompt` | `system_instruction` |
| `thinking_level` | `generation_config.thinking_level`, lowercase, clamped per model as before: 3.8, 3.7, and every pro model take `low`/`medium`/`high` (`gemini-3-pro` takes `low`/`high`), image models `minimal`/`high`, other models all four |
| `thinking_summary` | `generation_config.thinking_summaries`: `true` → `"auto"`, `false` → `"none"`, unset → omitted |
| `tools` | `tools: [{type: "function", name, description, parameters}]` |
| `tool_choice` | `generation_config.tool_choice`: `auto` → `"auto"`, `required` → `"any"`, `none` → `"none"`, a list of names → `{allowed_tools: {mode: "any", tools: [...]}}` |
| `fast_mode` | `service_tier: "priority"` |
| `prompt_caching` | only `ENABLE` is accepted |
| `temperature` | `UnsupportedParameterError` |
| `image_config` | `response_format: [{type: "text"}, {type: "image", aspect_ratio, image_size}]` |
| `tts_config` | `response_format: {type: "audio"}` and `generation_config.speech_config: [{voice}]` or `[{speaker, voice}, {speaker, voice}]`; a TTS model receives only these, `max_output_tokens`, `service_tier`, and the newest text message |
| every request | `store: false` |

| Interactions result | `UniEvent` |
| --- | --- |
| `status: "completed"` | `finish_reason: "stop"` |
| `status: "requires_action"` | `finish_reason: "tool_call"` |
| `status: "incomplete"` | `finish_reason: "length"` |
| any other status | `finish_reason: "unknown"` |
| `total_cached_tokens` | `cached_tokens` (null when 0) |
| `total_input_tokens - total_cached_tokens` | `prompt_tokens` |
| `total_thought_tokens` | `thoughts_tokens` (null when 0) |
| `total_output_tokens` | `response_tokens` (null when 0) |

## Compatibility

- Install `@google/genai` 2.x (TypeScript) or `google-genai` 2.x (Python) alongside AgentHub; a project pinned to the 1.x SDKs has to lift the pin.
- A Gemini response that calls tools finishes with `finish_reason: "tool_call"` instead of `"stop"`; a tool loop that keys on `"stop"` has to accept `"tool_call"`.
- `fast_mode: true` on a Gemini model no longer raises `UnsupportedParameterError`; it requests the priority tier, which is billed above the standard tier. Leave `fast_mode` unset to keep standard pricing.
