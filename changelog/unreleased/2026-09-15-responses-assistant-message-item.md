# The Responses clients send every turn as a typed message item

- **Date:** 2026-09-15
- **Type:** fix
- **Scope:** `openai_responses`, `gpt6`, `deepseek_v4`, `minimax_m3`, `tests`

[中文版](2026-09-15-responses-assistant-message-item.zh.md)

## What changed

- Every Responses client — the generic `OpenaiResponsesClient` and the routed `gpt6`,
  `deepseek_v4` and `minimax_m3` — sends every turn as a typed message item: the Responses
  API's `EasyInputMessage` shape, `{"type": "message", "role": ..., "content": [...]}`. It
  goes out at each place a transform emits collected content — the flush before a non-content
  item, the split between two text phases where the client has one, and the flush that closes
  a message. A vLLM-style Responses server answers the bare
  `{"role": "assistant", "content": [...]}` item with a 400 on the turn that replays it and
  takes the typed form for every role; OpenAI, DeepSeek and MiniMax accept either shape.
- The item is written out inline at every site, in TypeScript and Python alike — no helper stands
  between the transform and the shape it sends, so each transform reads top to bottom.
- The item carries nothing beyond that minimal shape: no `id`, `status` or `annotations`,
  none of which the client received from the server. The `phase` key an interleaved turn
  carries on `openai_responses` and `gpt6` is unchanged.
- The message-order suites pin the replayed shape of a user → assistant → user history for
  all four clients in both languages, and label a typed message item by its role so the one
  Responses order still reads across every client on that protocol.
