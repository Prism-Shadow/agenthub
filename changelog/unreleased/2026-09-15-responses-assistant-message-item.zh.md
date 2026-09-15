# 通用 Responses 客户端将 assistant 轮次回放为 message item

- **Date:** 2026-09-15
- **Type:** fix
- **Scope:** `openai_responses`, `tests`

[English](2026-09-15-responses-assistant-message-item.md)

## 变更内容

- `OpenaiResponsesClient` 将 assistant 轮次按输出风格的 message item 发回——
  `{"type": "message", "role": "assistant", "content": [{"type": "output_text", ...}]}`——转换过程中
  发出已收集内容的三处都是如此：遇到非内容 item 前的 flush、两个文本 phase 之间的切分，以及结束一条
  消息时的 flush。vLLM 风格的 Responses 服务端在回放该轮次时会对裸的
  `{"role": "assistant", "content": [...]}` item 返回 400；OpenAI、DeepSeek 与 MiniMax 两种形态都接受。
- 回放的 item 不携带这一最小形态之外的任何字段：没有 `id`、`status` 或 `annotations`，客户端从未从服务端
  收到过它们。交错轮次携带的 `phase` 键保持不变。
- user 轮次不变：`{"role": "user", "content": [{"type": "input_text", ...}]}` 仍然不带 `type` 发出。
- `gpt6`、`deepseek_v4` 与 `minimax_m3` 各自保留自己的转换，未作改动。
- message-order 测试在两种语言中固定了 `OpenaiResponsesClient` 对 user → assistant → user 历史的回放形态，
  并按 role 标注带 type 的 message item，使同一份 Responses 顺序仍适用于该协议下的每个客户端。
