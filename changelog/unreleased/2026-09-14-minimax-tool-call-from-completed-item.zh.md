# MiniMax M3 的工具调用改为从已完成的 item 读取，不再取自参数增量

- **Date:** 2026-09-14
- **Type:** fix
- **Scope:** `minimax_m3`, `tests`, `skills`
- **PR:** [#221](https://github.com/Prism-Shadow/agenthub/pull/221)

[English](2026-09-14-minimax-tool-call-from-completed-item.md)

## 变更内容

- `minimax_m3` 不再发送 `partial_tool_call` 片段。每个工具调用都从 `response.output_item.done`
  事件里的 `function_call` item 读取——`call_id`、`name` 与 `arguments`——并在该时刻作为一个完整的
  `tool_call` 交付；`response.output_item.added`、`response.function_call_arguments.delta` 与
  `response.function_call_arguments.done` 一律忽略。只发出完整调用，片段流与完整调用便不可能不一致。
- 已完成 item 的 `arguments` 仍经过 `ToolCallArgumentParseError` 检查：JSON 格式错误、被截断或不是对象时
  抛出异常并附带客户端、工具名与调用 id，而不是交付一个 `tool_call`。
- `MiniMax-M3` 加入两种语言的 tool-call-arguments 用例；Responses 假流补上了服务端在调用参数结束后发送的
  `response.output_item.done` item。
- 开发技能与 data-models 参考记录 `minimax_m3` 是唯一交付已完成 item、而非按增量流式的客户端。
