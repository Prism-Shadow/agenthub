# Send a text-only tool result as a plain string on the generic OpenAI clients

- **Date:** 2026-09-09
- **Type:** fix
- **Scope:** `openai_chat`, `openai_responses`
- **PR:** [#205](https://github.com/Prism-Shadow/agenthub/pull/205)

[中文版](2026-09-09-tool-result-text-form.zh.md)

## What changed

- `openai-responses` and `openai-chat` sent a tool result that carries no image as a plain
  string, instead of wrapping the text in a one-part content list.
- A tool result that carries images kept the content-part list, the only form that can hold
  an image part.
- The `openai-chat` client moves image parts into the following user message on SiliconFlow,
  which accepts no image in a tool message. The form is therefore decided by what lands in
  the tool message itself, so on that endpoint a tool result with images also went out as a
  plain string, with its image parts in the user message as before.
- `openai-chat-vllm-adapter` inherits the message transform from `openai-chat` and followed
  the same rule.
- The first-party clients were left untouched: `gpt5_6`, `deepseek_v4`, `minimax_m3` and
  `kimi_k3` on the list form their live captures record, and `glm5_3`, which already sent a
  text-only tool result as a plain string.

## Wire shapes

| Protocol | Text-only result | Result carrying images |
| --- | --- | --- |
| Responses | `{"type": "function_call_output", "call_id": "call_1", "output": "20 degrees."}` | `"output": [{"type": "input_text", "text": "..."}, {"type": "input_image", "image_url": "..."}]` |
| Chat Completions | `{"role": "tool", "tool_call_id": "call_1", "content": "20 degrees."}` | `"content": [{"type": "text", "text": "..."}, {"type": "image_url", "image_url": {"url": "..."}}]` |
