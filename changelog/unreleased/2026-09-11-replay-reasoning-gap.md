# Replay a tool-calling turn the model thought nothing on with its reasoning field still present

- **Date:** 2026-09-11
- **Type:** fix
- **Scope:** `openai_chat`
- **PR:** [#212](https://github.com/Prism-Shadow/agenthub/pull/212)

[中文版](2026-09-11-replay-reasoning-gap.zh.md)

## What changed

- `openai-chat` omitted the reasoning field entirely for an assistant message that carried
  tool calls but no chain-of-thought. DeepSeek refuses such a request with
  ``400 invalid_request_error: The `reasoning_content` in the thinking mode must be passed back to the API.``
  whenever that turn is part of the tool-call chain still being continued, and it produces
  exactly those turns itself: past the first few steps of a long chain it answers with a tool
  call and no reasoning at all. The rejection is waived only for `tool_call` ids DeepSeek
  issued, so an endpoint that reissues ids removes the waiver.
- `openai-chat` now records the reasoning field the upstream has produced in the conversation
  and sends that field as an empty string on a tool-calling message with no thinking of its
  own. The field name follows the same fidelity rule as a non-empty replay
  (`reasoning_content`, `reasoning`, or both when the origin is ambiguous). A conversation
  that never produced a reasoning field never receives one.
- `openai-chat-vllm-adapter` inherits the transform.

## Wire shape

An assistant turn of tool calls with no chain-of-thought, replayed on Chat Completions:

```json
{"role": "assistant", "reasoning_content": "", "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "exec_command", "arguments": "{}"}}]}
```
