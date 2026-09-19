# Unreleased

[中文版](README.zh.md)

- [2026-09-18] DeepSeek, GLM and Kimi clients no longer fall back to `OPENAI_API_KEY`, and the Anthropic clients no longer send `ANTHROPIC_AUTH_TOKEN`. ([details](2026-09-18-env-credential-fallbacks.md), [#224](https://github.com/Prism-Shadow/agenthub/pull/224))
- [2026-09-15] The Responses clients send every turn as a typed message item. ([details](2026-09-15-responses-assistant-message-item.md))
- [2026-09-14] Read MiniMax M3 tool calls from the completed output item instead of the argument deltas. ([details](2026-09-14-minimax-tool-call-from-completed-item.md), [#221](https://github.com/Prism-Shadow/agenthub/pull/221))
