# Responses 客户端把每个轮次都按带 type 的 message item 发出

- **Date:** 2026-09-15
- **Type:** fix
- **Scope:** `openai_responses`, `gpt6`, `deepseek_v4`, `minimax_m3`, `tests`

[English](2026-09-15-responses-assistant-message-item.md)

## 变更内容

- 每个 Responses 客户端——通用的 `OpenaiResponsesClient` 与路由到各厂商的 `gpt6`、`deepseek_v4`、
  `minimax_m3`——都把每个轮次按带 type 的 message item 发出：即 Responses API 的 `EasyInputMessage`
  形态 `{"type": "message", "role": ..., "content": [...]}`。转换过程中发出已收集内容的每一处都是如此：
  遇到非内容 item 前的 flush、客户端若有 phase 则两个文本 phase 之间的切分，以及结束一条消息时的 flush。
  vLLM 风格的 Responses 服务端在回放 assistant 轮次时会对裸的
  `{"role": "assistant", "content": [...]}` item 返回 400，而各 role 的带 type 形态都接受；
  OpenAI、DeepSeek 与 MiniMax 两种形态都接受。
- 该 item 在每一处发出点都直接写出，TypeScript 与 Python 均是如此——转换过程与它发出的形态之间
  不再隔着一个 helper，每个转换从上到下顺着读即可。
- 该 item 不携带这一最小形态之外的任何字段：没有 `id`、`status` 或 `annotations`，客户端从未从服务端
  收到过它们。`openai_responses` 与 `gpt6` 上交错轮次携带的 `phase` 键保持不变。
- message-order 测试在两种语言中固定了四个客户端对 user → assistant → user 历史的回放形态，
  并按 role 标注带 type 的 message item，使同一份 Responses 顺序仍适用于该协议下的每个客户端。
