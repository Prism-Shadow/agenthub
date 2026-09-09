# GPT-6 SDK Documentation

This directory contains the official-documentation snapshot for OpenAI's GPT-6 generation
(`gpt-6-astra`, its only snapshot and its own alias), snapshotted as raw markdown from
https://developers.openai.com/ on 2026-09-09.

## Documentation

- [gpt-6-astra.md](./docs/gpt-6-astra.md) - The model page: context window, token limits,
  knowledge cutoff, modalities, endpoints, feature list, per-million-token pricing and the
  272K-input surcharge
- [latest-model.md](./docs/latest-model.md) - Using GPT-6 Astra: what is new (async tool calling,
  mid-turn steering, `configuration_update` items, misalignment monitoring), prompting guidance,
  and the migration checklist from GPT-5.6
- [reasoning.md](./docs/reasoning.md) - The reasoning guide: the `reasoning.effort` scale,
  `reasoning.mode`, persisted reasoning with `encrypted_content` under `store: false`, and the
  `phase` parameter
- [prompt-caching.md](./docs/prompt-caching.md) - Prompt caching on GPT-5.6 and later:
  `prompt_cache_options`, explicit breakpoints, and cache writes billed at 1.25x the uncached
  input rate

## Key protocol notes vs GPT-5.6

- The wire protocol is identical to GPT-5.6 (verified with live captures under
  `api_captures/openai_responses/gpt-6-astra/`): reasoning summaries stream via
  `response.reasoning_summary_text.delta`, reasoning items carry `id` + `encrypted_content`,
  assistant messages carry `phase` (`commentary`, then `final_answer`), and a replayed reasoning
  item must include the `summary` key — the API answers 400
  `Missing required parameter: 'input[N].summary'` without it, exactly as GPT-5.6 does. No stream
  event outside the set the shared client already handles appeared in any capture. GPT-6 Astra
  therefore shares its client with GPT-5.4, GPT-5.5 and GPT-5.6.
- `reasoning.effort` accepts `low`, `medium`, `high`, `xhigh` and `max`. `none` and `minimal` are
  both rejected with HTTP 400 `Unsupported value: '<value>' is not supported with the
  'gpt-6-astra' model.`, so `ThinkingLevel.NONE` degrades to `low` on this generation.
- A reasoning item's `encrypted_content` is present on `response.output_item.added` as well as on
  `response.output_item.done`, but the two are different ciphertexts and the added one may be
  truncated; only the `done` value is safe to replay. See
  [../openai_responses/docs/openai-responses-streaming-events.md](../openai_responses/docs/openai-responses-streaming-events.md).
- `usage.input_tokens_details` gained `cache_write_tokens` beside `cached_tokens`; cache writes
  bill at 1.25x the uncached input rate.
- `service_tier: "priority"` is accepted and echoed back as `service_tier: "fast"`, where GPT-5.6
  echoed `"priority"`.
- The GPT-5.6 documentation snapshot remains in [`../gpt5_6/`](../gpt5_6/README.md); the Chat
  Completions to Responses migration guide there applies unchanged.

## Official sources

- https://developers.openai.com/api/docs/models/gpt-6-astra
- https://developers.openai.com/api/docs/guides/latest-model
- https://developers.openai.com/api/docs/guides/reasoning
- https://developers.openai.com/api/docs/guides/prompt-caching
- https://developers.openai.com/api/reference/resources/responses/methods/create
  (snapshotted in [`../openai_responses/docs/openai-responses-create.md`](../openai_responses/docs/openai-responses-create.md))
- https://developers.openai.com/api/reference/resources/responses/streaming-events
  (excerpted in [`../openai_responses/docs/openai-responses-streaming-events.md`](../openai_responses/docs/openai-responses-streaming-events.md))
