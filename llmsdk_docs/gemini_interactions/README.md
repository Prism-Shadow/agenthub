# Gemini Interactions API Documentation

This directory snapshots Google's official documentation for the Gemini **Interactions API**
(`POST /v1beta/interactions`, SDK `client.interactions.create`), the successor to
`generateContent` for Gemini text, thinking, tool calling, image understanding, image generation
(`gemini-3.1-flash-image`) and speech generation (`gemini-3.1-flash-tts-preview`). Pages were
fetched as raw markdown from https://ai.google.dev/ (`<page>.md.txt`) on 2026-09-16; Java/Go
samples and prompt-writing guides were removed, everything else is verbatim.

The snapshot describes the `steps` schema introduced by the May 2026 breaking change (the legacy
`outputs` schema was removed on 2026-06-08). Live captures that back the notes below are under
`api_captures/gemini_interactions/` (git-ignored).

## Documentation

- [api-reference.md](./docs/api-reference.md) - The v1beta API reference: request body
  (`input`, `system_instruction`, `tools`, `response_format`, `generation_config`, `store`,
  `service_tier`, ...), the `Interaction` resource, `Usage`, `Content` / `Step` / `Tool` data
  models, and the `InteractionSseEvent` / `StepDelta` stream types
- [interactions-overview.md](./docs/interactions-overview.md) - How the API works, stateful
  (`previous_interaction_id`) vs stateless (`store: false`) use, data retention, supported models,
  SDK versions, limitations (no Batch API, no explicit caching, no custom safety settings)
- [api-versions.md](./docs/api-versions.md) - `v1` vs `v1beta`; speech config and service tier
  are `v1beta`-only; SDKs default to `v1beta`
- [breaking-changes-may-2026.md](./docs/breaking-changes-may-2026.md) - `outputs` to `steps`,
  `response_format` replacing `response_mime_type` / `response_modalities` / `image_config`, the
  `Api-Revision` header, new stream event names, stateless history handling
- [migrate-to-interactions.md](./docs/migrate-to-interactions.md) - `generateContent` to
  Interactions side-by-side for multi-turn, multimodal input, structured output, tools and
  function calling
- [streaming.md](./docs/streaming.md) - SSE event flow (`interaction.created`,
  `interaction.status_update`, `step.start` / `step.delta` / `step.stop`,
  `interaction.completed`, `error`), delta types, streaming with function calling, thinking and
  image generation
- [thinking.md](./docs/thinking.md) - `thought` steps (`signature` + `summary`),
  `thinking_summaries`, per-model `thinking_level` support, `max_output_tokens` and `incomplete`,
  thought signatures in stateful and stateless mode
- [function-calling.md](./docs/function-calling.md) - Function declarations, stateless function
  calling, parallel calls, `tool_choice` modes, multimodal `function_result`, streaming tool calls
- [image-understanding.md](./docs/image-understanding.md) - Image input by `uri` or inline
  base64 `data`
- [file-input-methods.md](./docs/file-input-methods.md) - Inline data, File API and external
  URL inputs, with size limits
- [image-generation.md](./docs/image-generation.md) - Nano Banana models, `response_format`
  image entries (`aspect_ratio`, `image_size`), thinking with interim images, interleaved output
- [speech-generation.md](./docs/speech-generation.md) - Single- and multi-speaker TTS with
  `generation_config.speech_config`, streaming audio, voices, limitations
- [text-generation.md](./docs/text-generation.md) - Basic requests, `system_instruction`,
  multi-turn input
- [priority-inference.md](./docs/priority-inference.md) - `service_tier: "priority"`
- [tokens.md](./docs/tokens.md) - The `usage` fields of an interaction
- [embeddings.md](./docs/embeddings.md) - `models.embedContent`; embedding models are not served
  by the Interactions API
- [vertex-interactions-api.md](./docs/vertex-interactions-api.md) - The Interactions API
  reference on Gemini Enterprise Agent Platform (Vertex AI):
  `POST https://aiplatform.googleapis.com/v1beta1/projects/{project}/locations/global/interactions`

## Protocol notes verified against the live API (2026-09-16, `gemini-3.8-flash`)

- Stream order per step: `step.start` (type only; a `function_call` start already carries `id`,
  `name` and `arguments: {}`), then `step.delta`s, then `step.stop`. Deltas carry only the step
  `index`. A `thought` step streams zero or more `thought_summary` deltas and then one
  `thought_signature` delta as its last delta; `function_call` arguments arrive as
  `arguments_delta` with the field `arguments`; text as `text`; images as `image`
  (`mime_type`, base64 `data`); audio as `audio` (`audio/l16`, `sample_rate`, `channels`).
  The stream ends with `interaction.completed` (status + `usage`, no `steps`) and
  `event: done` / `data: [DONE]`.
- Every text-model turn observed starts with a `thought` step, including
  `thinking_summaries: "none"` and omitted `generation_config`; summaries are off unless
  `thinking_summaries: "auto"`. `gemini-3.1-flash-image` sometimes streams a `model_output` text
  step before its first `thought` step (2 of 6 runs with a text-and-image `response_format`).
  Signatures appear only on `thought` steps, never on `model_output` or `function_call`.
- Parallel calls are separate consecutive `function_call` steps, each fully started, streamed and
  stopped before the next.
- With `store: false` the interaction `id` is `""` in stream events and absent from non-streaming
  responses.
- Stateless replay (probe results): the in-progress turn must start with its `thought` step
  carrying the `signature`; `function_result` requires `name`; `thought.summary`,
  `function_call.id` and `function_result.call_id` are optional, but parallel calls sharing one
  `id` are rejected; unknown step fields are rejected; a text content block with empty `text` is
  rejected ("Missing text in content of type text").
- Image-model turns must start with a thought block, and every non-thought image block must be
  preceded by one; the signatures run to hundreds of KB to over 1 MB of base64. A turn streamed
  with its text first is rejected when replayed as streamed; it is accepted with a leading
  `thought` step carrying the documented placeholder signature `skip_thought_signature_validator`
  (or a copy of the turn's own signature).
- `usage.total_tokens = total_input_tokens + total_output_tokens + total_thought_tokens`;
  `total_input_tokens` includes `total_cached_tokens`.
- `gemini-embedding-2` is rejected by the Interactions endpoint (404 model not found).
