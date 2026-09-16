# Unreleased

[English](README.md)

- [2026-09-16] Gemini 文本、图像与 TTS 模型改用 Interactions API，SDK 升级到 google-genai / @google/genai 2.x；调用工具的轮次以 tool_call 结束，fast_mode 改为请求 priority 服务层级。([详情](2026-09-16-gemini-interactions-api.zh.md), TBD)
- [2026-09-16] 流式协议 v2：一次流由若干 `delta` 事件和最后唯一的 `stop` 事件组成，每个内容项以 `.delta` 片段流出、再由其 `.done` 项收尾。([详情](2026-09-16-streaming-protocol-v2.zh.md), TBD)
- [2026-09-16] 0.5.0 之前记录的内容项在 0.6.0 之前仍被接受，并转换为 `.done` 类型。([详情](2026-09-16-backward-compatibility.zh.md), TBD)
- [2026-09-15] Responses 客户端把每个轮次都按带 type 的 message item 发出。([详情](2026-09-15-responses-assistant-message-item.zh.md))
- [2026-09-14] MiniMax M3 的工具调用改为从已完成的输出 item 读取，不再取自参数增量。([详情](2026-09-14-minimax-tool-call-from-completed-item.zh.md), [#221](https://github.com/Prism-Shadow/agenthub/pull/221))
