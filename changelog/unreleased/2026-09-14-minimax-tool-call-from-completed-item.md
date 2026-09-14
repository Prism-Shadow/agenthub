# Read MiniMax M3 tool calls from the completed item, not from the argument deltas

- **Date:** 2026-09-14
- **Type:** fix
- **Scope:** `minimax_m3`, `tests`, `skills`
- **PR:** [#221](https://github.com/Prism-Shadow/agenthub/pull/221)

[中文版](2026-09-14-minimax-tool-call-from-completed-item.zh.md)

## What changed

- `minimax_m3` no longer streams `partial_tool_call` fragments. Each tool call is read from
  the `function_call` item of the `response.output_item.done` event — `call_id`, `name` and
  `arguments` — and delivered as one complete `tool_call` at that point;
  `response.output_item.added`, `response.function_call_arguments.delta` and
  `response.function_call_arguments.done` are ignored. Only the complete call is emitted, so a
  fragment stream and the complete call can never disagree.
- The completed item's `arguments` go through the `ToolCallArgumentParseError` check:
  malformed, truncated or non-object JSON raises with the client, tool name and call id
  attached, instead of yielding a `tool_call`.
- `MiniMax-M3` joined the tool-call-arguments cases in both languages, and the Responses fake
  streams carry the `response.output_item.done` item a server sends once a call's arguments are
  done.
- The dev skill and the data-models references record `minimax_m3` as the one client that
  delivers the completed item instead of streaming on deltas.
