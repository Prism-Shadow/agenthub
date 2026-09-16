# Unreleased

[中文版](README.zh.md)

- [2026-09-16] Streaming protocol v2: a stream is `delta` events closed by one `stop` event, and every content item streams as `.delta` fragments closed by its `.done` item. ([details](2026-09-16-streaming-protocol-v2.md), TBD)
- [2026-09-16] Content items recorded before 0.5.0 are still accepted, converted to the `.done` types, until 0.6.0. ([details](2026-09-16-backward-compatibility.md), TBD)
- [2026-09-15] The Responses clients send every turn as a typed message item. ([details](2026-09-15-responses-assistant-message-item.md))
- [2026-09-14] Read MiniMax M3 tool calls from the completed output item instead of the argument deltas. ([details](2026-09-14-minimax-tool-call-from-completed-item.md), [#221](https://github.com/Prism-Shadow/agenthub/pull/221))
