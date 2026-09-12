# Send a text-only tool result as a plain string on the first-party Responses clients

- **Date:** 2026-09-12
- **Type:** fix
- **Scope:** `deepseek_v4`, `gpt6`
- **PR:** [#215](https://github.com/Prism-Shadow/agenthub/pull/215)
- **Issue:** penguin-harness [#404](https://github.com/Prism-Shadow/penguin-harness/issues/404)

[中文版](2026-09-12-first-party-tool-result-text-form.zh.md)

## What changed

- `deepseek_v4` sent a tool result that carries no image as a plain string, instead of
  wrapping the text in a one-part content list. A strictly validating DeepSeek Responses
  endpoint answered the list form with `400 invalid_json` on every request that replayed a
  tool call.
- `gpt6` took the same form for a tool result that carries no image.
- A tool result that carries images kept the content-part list on both clients, the only
  form that can hold an image part, and `deepseek_v4` kept refusing images on the ids whose
  model reads none.
- The rule reached the two clients that still used the list form, so it covered every
  Responses and Chat Completions client the SDK ships: `gpt6`, `deepseek_v4`, `minimax_m3`
  and `openai_responses` on Responses; `openai_chat`, `openai_chat_vllm_adapter`, `kimi_k3`
  and `glm5_3` on Chat Completions. The generic clients took the form in
  [0.4.11](../0.4.11/2026-09-09-tool-result-text-form.md).
- The message-order suites in both languages dropped their per-client flag and asserted the
  plain string on every Responses and Chat Completions row.

## Wire shapes

| Protocol | Text-only result | Result carrying images |
| --- | --- | --- |
| Responses | `{"type": "function_call_output", "call_id": "call_1", "output": "20 degrees."}` | `"output": [{"type": "input_text", "text": "..."}, {"type": "input_image", "image_url": "..."}]` |
