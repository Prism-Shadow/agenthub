# OpenAI Responses Protocol Documentation

This directory contains the official-documentation snapshot used to implement AgentHub's
generic `openai_responses` client - the OpenAI Responses-compatible protocol as served by
OpenAI, OpenRouter, DeepSeek, Z.AI, and MiniMax.

## Documentation

- [openai-responses-create.md](./docs/openai-responses-create.md) - OpenAI's
  `POST /v1/responses` reference: complete Body Parameters section (input items, reasoning,
  tools, `service_tier`) plus the streaming example; the Response-object schema section is
  omitted (the live captures under `api_captures/openai_responses/` record the streamed shapes)
- [openai-responses-streaming-events.md](./docs/openai-responses-streaming-events.md) - Labelled
  excerpt of OpenAI's streaming-events reference: `response.output_item.added` /
  `response.output_item.done` and the reasoning item they carry, every `response.reasoning_*`
  event, `response.completed` / `response.incomplete` / `response.failed` / `error`, and the
  usage object (the full page is ~15.6 MB of generated schema JSON)
- [openrouter-create-a-response.md](./docs/openrouter-create-a-response.md) - OpenRouter's
  `POST /api/v1/responses` OpenAPI spec (OpenResponses dialect: reasoning items with
  `content`/`signature`/`format`/`encrypted_content`, assistant message `phase`)
- [deepseek-responses-api.md](./docs/deepseek-responses-api.md) - DeepSeek's Responses API
  compatibility tables (`base_url` `https://api.deepseek.com`): supported parameters, input
  items, streaming event list; unsupported parameters are silently ignored
- [zai-coding-endpoints.md](./docs/zai-coding-endpoints.md) - Z.AI GLM Coding Plan base URLs
  for the three protocols (OpenAI Responses: `https://api.z.ai/api/v1`)
- [openai-fast-mode.md](./docs/openai-fast-mode.md) - Fast mode via
  `service_tier: "priority"` / `"fast"`
- MiniMax's `POST /v1/responses` reference is snapshotted in
  [`../minimax_m3/docs/responses-create.md`](../minimax_m3/docs/responses-create.md)

## Cross-provider differences (verified with live captures)

| Behavior | OpenAI / OpenRouter (GPT) | DeepSeek / Z.AI / MiniMax |
|----|----|----|
| Thinking stream | `response.reasoning_summary_text.delta` | `response.reasoning_text.delta` |
| Reasoning item | `summary` + `encrypted_content` (+ `format` on OpenRouter) | `content: [{type: "reasoning_text"}]` |
| Reasoning replay | `summary` key required (OpenAI 400s without it); `encrypted_content` preserved | fully tolerant - a reasoning item rebuilt from the thinking text alone is accepted |
| `phase` on messages | emitted and must be resent (OpenRouter degrades without it) | emitted by DeepSeek, tolerated everywhere |
| `service_tier: "priority"` | accepted, echoed in response | MiniMax accepted; DeepSeek/Z.AI silently ignored |
| `temperature` | adapted/dropped for GPT by OpenRouter | supported |
| usage detail blocks | always present | MiniMax omits `output_tokens_details` on truncation |

The captures under `api_captures/openai_responses/` (git-ignored) are the authoritative wire
reference; replay-minimality probe results live next to each capture in `probes.json`.

## Official sources

- https://developers.openai.com/api/reference/resources/responses/methods/create
- https://developers.openai.com/api/reference/resources/responses/streaming-events
- https://openrouter.ai/docs/api/api-reference/responses/create-a-response
- https://api-docs.deepseek.com/guides/responses_api
- https://platform.minimax.io/docs/api-reference/responses-create
- https://docs.z.ai/devpack/tool/others
- https://developers.openai.com/api/docs/guides/fast-mode
