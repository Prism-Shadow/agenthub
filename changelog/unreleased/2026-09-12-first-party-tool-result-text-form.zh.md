# 第一方 Responses client 将纯文本工具结果作为纯字符串发送

- **Date:** 2026-09-12
- **Type:** fix
- **Scope:** `deepseek_v4`, `gpt6`
- **PR:** [#215](https://github.com/Prism-Shadow/agenthub/pull/215)
- **Issue:** penguin-harness [#404](https://github.com/Prism-Shadow/penguin-harness/issues/404)

[English](2026-09-12-first-party-tool-result-text-form.md)

## 变更内容

- `deepseek_v4` 将不带图片的工具结果作为纯字符串发送，不再把文本包进只有一个部件的 content
  列表。校验严格的 DeepSeek Responses 端点对列表形态的回应是 `400 invalid_json`，凡是回放了工具
  调用的请求都会命中。
- `gpt6` 对不带图片的工具结果采用同一形态。
- 两个 client 的带图片工具结果仍使用 content 部件列表——只有这种形态能容纳图片部件；
  `deepseek_v4` 对模型不读图片的 id 依旧拒绝图片。
- 此规则覆盖了最后两个仍用列表形态的 client，至此涉及 SDK 提供的全部 Responses 与 Chat
  Completions client：Responses 一侧为 `gpt6`、`deepseek_v4`、`minimax_m3` 与
  `openai_responses`，Chat Completions 一侧为 `openai_chat`、`openai_chat_vllm_adapter`、
  `kimi_k3` 与 `glm5_3`。通用 client 在
  [0.4.11](../0.4.11/2026-09-09-tool-result-text-form.zh.md) 中已改为该形态。
- 两种语言的 message-order 测试套件去掉了按 client 设置的开关，改为对每个 Responses 与 Chat
  Completions 用例一律断言纯字符串。

## 线上形状

| 协议 | 纯文本结果 | 带图片的结果 |
| --- | --- | --- |
| Responses | `{"type": "function_call_output", "call_id": "call_1", "output": "20 degrees."}` | `"output": [{"type": "input_text", "text": "..."}, {"type": "input_image", "image_url": "..."}]` |
