# Gemini on Vertex AI through generateContent

- **Date:** 2026-09-17
- **Type:** feature
- **Scope:** `gemini3_8_generate_content`, `gemini3_8`, `auto_client`, `tests`, `llmsdk_docs`
- **PR:** [#223](https://github.com/Prism-Shadow/agenthub/pull/223)

[中文版](2026-09-17-gemini-vertex-generate-content.zh.md)

## What changed

- `AutoLLMClient` routes a Gemini model to the new `Gemini3_8GenerateContentClient` (Python and TypeScript, `gemini3_8_generate_content/`) when the API key is a Vertex AI service-account JSON key (a key starting with `{`, passed directly or through `GEMINI_API_KEY`), and to `Gemini3_8Client` (Interactions API) for any other key.
- A `client_type` / `clientType` containing `gemini-generate-content` selects `Gemini3_8GenerateContentClient`, and one containing `gemini-interactions` selects `Gemini3_8Client`, whatever the key; `CLIENT_TYPE` takes the same values. The unsupported-client-type error lists both.
- `list_models` / `listModels` through `Gemini3_8GenerateContentClient` keeps only the ids that route to the Gemini family, so a Vertex AI listing drops ids such as `gemini-2.5-flash` and `spicy-mayo`.
- `Gemini3_8GenerateContentClient` is the generateContent client released through 0.4.15 (`models.generateContentStream`, service-account credentials for Vertex AI in the `global` location, `GEMINI_API_KEY` / `GEMINI_BASE_URL`, `default_headers`), moved onto streaming protocol v2.
- Streamed items are numbered in stream order: a new item starts when the kind of part changes (thought text, text, thought image, inline data, function call), for every function call and every image, and after a part carrying a `thoughtSignature`, which closes its item and becomes its `fidelity.signature`.
- Consecutive text parts without a signature join one item, and audio chunks join one `inline_data` item with the mime type as sent (`audio/l16; rate=24000; channels=1`).
- A `functionCall` part streams as one `tool_call.delta` carrying the name, the call id (the name when the API sends no id), the JSON arguments, and the signature, followed by its done item.
- An empty text part carrying a signature (the last chunk of a text answer) streams as an empty `text.delta` with the signature; an empty text part without one is skipped.
- Unrecognized parts (an empty part, `executableCode`, `fileData`) are skipped, or raised under `AGENTHUB_DEBUG`; a chunk carrying neither candidates nor usage (a gateway heartbeat) yields nothing.
- A response that streamed a function call finishes with `tool_call` although the API reports `STOP`. Usage is read from the chunks whose `usageMetadata` carries `promptTokenCount`.
- The Python client records a `thoughtSignature` as base64 text, the same string the TypeScript client records; a signature recorded as bytes still replays.
- Messages are sent as contents with one part per item: text (empty text kept), images inlined as base64 with URLs fetched, inline data, thinking as a `thought` text part, inline thinking as a `thought` inline-data part, tool calls as `functionCall` (without `id` when the id is the function name), and tool results as `functionResponse` with the name looked up from the call and images attached as parts. A part carries its item's `fidelity.signature` as `thoughtSignature`.
- In an assistant message whose first function call carries no signature, the signature of the last thinking item before the call moves onto it; when no thinking item has one, the call carries the placeholder `skip_thought_signature_validator`. A signature left on a thinking item moves to the next part that is neither a thought nor a function response and carries no signature, when there is one, and a thinking part left with empty text and no signature is dropped. A signature on an inline thinking item stays on its part.
- A message mixing function responses with other parts is sent as consecutive contents of the same role, one per run, in order.
- `Gemini3_8Client` (Interactions API): when an item's `fidelity.signature` becomes a `thought` step and the turn opens with a `thought` step carrying no signature, that first step carries the same signature (an unsigned leading thought followed by a signed one was rejected with 400).
- Embedding models send one `embedContent` request per message, in order, each yielding one `embedding.done` item; `prompt_tokens` is the sum of the embeddings' `statistics.tokenCount` (`metadata.billableCharacterCount` when a response carries that instead).
- Rows and cases for `Gemini3_8GenerateContentClient` were added to the shared unit tests `unknown-events`, `message-order`, `reasoning-fidelity`, `reasoning-replay-without-thinking`, `thinking-level-mapping`, `list-models`, and `default-headers`, and `gemini-embedding-2` to the Vertex AI models of the e2e tests.
- `README.md`, `src_py/README.md`, and `src_ts/README.md` describe the Vertex AI key and the two client types; the skills' model references name the service-account key; the `agenthub-dev` skill records how `gemini3_8_generate_content` numbers its items; `llmsdk_docs/gemini_interactions/README.md` gained a Vertex AI section, which `llmsdk_docs/gemini3_8/README.md` links.

## Configuration behavior

| `UniConfig` | generateContent request |
| --- | --- |
| `max_tokens` | `maxOutputTokens` |
| `system_prompt` | `systemInstruction` |
| `thinking_level` | `thinkingConfig.thinkingLevel`: `none` → `MINIMAL`, `low` → `LOW`, `medium` → `MEDIUM`, `high`/`xhigh`/`max` → `HIGH`, clamped per model as on `Gemini3_8Client`: 3.8, 3.7, and every pro model take `LOW`/`MEDIUM`/`HIGH` (`gemini-3-pro` takes `LOW`/`HIGH`), image models `MINIMAL`/`HIGH`, other models all four |
| `thinking_summary` | `thinkingConfig.includeThoughts` |
| `tools` | `tools: [{functionDeclarations}]` |
| `tool_choice` | `toolConfig.functionCallingConfig`: `auto` → `AUTO`, `required` → `ANY`, `none` → `NONE`, a list of names → `ANY` with `allowedFunctionNames` |
| `fast_mode` | `UnsupportedParameterError` |
| `prompt_caching` | only `ENABLE` is accepted |
| `temperature` | `UnsupportedParameterError` |
| `image_config` | `imageConfig: {aspectRatio, imageSize}` |
| `tts_config` | `responseModalities: ["AUDIO"]` and `speechConfig` (`voiceConfig.prebuiltVoiceConfig` for one voice, `multiSpeakerVoiceConfig` for two speakers); a TTS model receives only these, `maxOutputTokens`, and the newest message, which must be text |

| generateContent result | `UniEvent` |
| --- | --- |
| `finishReason: "STOP"` | `finish_reason: "stop"`, or `"tool_call"` when a function call was streamed |
| `finishReason: "MAX_TOKENS"` | `finish_reason: "length"` |
| any other `finishReason` | `finish_reason: "unknown"` |
| `cachedContentTokenCount` | `cached_tokens` (null when absent or 0) |
| `promptTokenCount - cachedContentTokenCount` | `prompt_tokens` |
| `thoughtsTokenCount` | `thoughts_tokens` (null when absent or 0) |
| `candidatesTokenCount` | `response_tokens` (null when absent or 0) |
