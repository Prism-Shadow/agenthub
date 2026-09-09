# 通用 OpenAI client 将纯文本工具结果作为纯字符串发送

- **Date:** 2026-09-09
- **Type:** fix
- **Scope:** `openai_chat`, `openai_responses`
- **PR:** [#205](https://github.com/Prism-Shadow/agenthub/pull/205)

[English](2026-09-09-tool-result-text-form.md)

## 变更内容

- `openai-responses` 与 `openai-chat` 将不带图片的工具结果作为纯字符串发送，不再把文本包进只有
  一个部件的 content 列表。
- 带图片的工具结果仍使用 content 部件列表——只有这种形态能容纳图片部件。
- 在 SiliconFlow 上，`openai-chat` client 会把图片部件移入其后的 user 消息，因为该端点的 tool
  消息不接受图片。因此形态由实际落入 tool 消息的内容决定：在该端点上，带图片的工具结果同样以
  纯字符串发送，图片部件一如既往留在 user 消息中。
- `openai-chat-vllm-adapter` 继承 `openai-chat` 的消息转换，因而遵循同一规则。
- 第一方的 `gpt5_6`、`deepseek_v4` 与 `minimax_m3` client 未作改动，保持其实况抓包所记录的列表形态。

## 线上形状

| 协议 | 纯文本结果 | 带图片的结果 |
| --- | --- | --- |
| Responses | `{"type": "function_call_output", "call_id": "call_1", "output": "20 degrees."}` | `"output": [{"type": "input_text", "text": "..."}, {"type": "input_image", "image_url": "..."}]` |
| Chat Completions | `{"role": "tool", "tool_call_id": "call_1", "content": "20 degrees."}` | `"content": [{"type": "text", "text": "..."}, {"type": "image_url", "image_url": {"url": "..."}}]` |
