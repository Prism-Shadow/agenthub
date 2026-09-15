# Replay an assistant turn as a message item on the generic Responses client

- **Date:** 2026-09-15
- **Type:** fix
- **Scope:** `openai_responses`, `tests`

[中文版](2026-09-15-responses-assistant-message-item.zh.md)

## What changed

- `OpenaiResponsesClient` sends an assistant turn back as an output-style message item —
  `{"type": "message", "role": "assistant", "content": [{"type": "output_text", ...}]}` — at each
  of the three places the transform emits collected content: the flush before a non-content item,
  the split between two text phases, and the flush that closes a message. A vLLM-style Responses
  server answers the bare `{"role": "assistant", "content": [...]}` item with a 400 on the turn
  that replays it; OpenAI, DeepSeek and MiniMax accept either shape.
- The replayed item carries nothing beyond that minimal shape: no `id`, `status` or `annotations`,
  none of which the client received from the server. The `phase` key an interleaved turn carries
  is unchanged.
- User turns are untouched: `{"role": "user", "content": [{"type": "input_text", ...}]}` still goes
  out with no `type`.
- `gpt6`, `deepseek_v4` and `minimax_m3` keep transforms of their own and were not changed.
- The message-order suites pin the replayed shape of a user → assistant → user history for
  `OpenaiResponsesClient` in both languages, and label a typed message item by its role so the one
  Responses order still reads across every client on that protocol.
