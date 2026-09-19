# Unreleased

[English](README.md)

- [2026-09-18] DeepSeek、GLM 与 Kimi 客户端不再回退到 `OPENAI_API_KEY`，Anthropic 客户端不再发送 `ANTHROPIC_AUTH_TOKEN`。([详情](2026-09-18-env-credential-fallbacks.zh.md), [#224](https://github.com/Prism-Shadow/agenthub/pull/224))
- [2026-09-15] Responses 客户端把每个轮次都按带 type 的 message item 发出。([详情](2026-09-15-responses-assistant-message-item.zh.md))
- [2026-09-14] MiniMax M3 的工具调用改为从已完成的输出 item 读取，不再取自参数增量。([详情](2026-09-14-minimax-tool-call-from-completed-item.zh.md), [#221](https://github.com/Prism-Shadow/agenthub/pull/221))
