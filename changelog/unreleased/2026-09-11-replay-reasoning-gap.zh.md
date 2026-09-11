# 回放没有思考内容的工具调用轮时补上 reasoning 字段

- **Date:** 2026-09-11
- **Type:** fix
- **Scope:** `openai_chat`
- **PR:** [#212](https://github.com/Prism-Shadow/agenthub/pull/212)

[English](2026-09-11-replay-reasoning-gap.md)

## 变更内容

- `openai-chat` 对「带工具调用但没有思考内容」的 assistant 消息完全不发 reasoning 字段。只要该
  轮还处在正在续跑的那条工具调用链上，DeepSeek 就会以
  ``400 invalid_request_error: The `reasoning_content` in the thinking mode must be passed back to the API.``
  拒绝整个请求；而这种轮次正是它自己产出的——长链跑过头几步之后，它会直接给出工具调用、一点
  reasoning 都不带。该校验只对 DeepSeek 自己签发的 `tool_call` id 网开一面，因此重新签发 id 的
  端点会让这道豁免失效。
- `openai-chat` 现在记下该上游在本次会话中产出过的 reasoning 字段名，并在没有自带思考内容的工具
  调用消息上把该字段以空字符串发出。字段名沿用与非空回放相同的 fidelity 规则
  （`reasoning_content`、`reasoning`，来源不明确时两个都发）。从未产出过 reasoning 字段的会话不
  会平白收到一个。
- `openai-chat-vllm-adapter` 继承该转换。

## 线上形状

没有思考内容的工具调用轮，在 Chat Completions 上回放为：

```json
{"role": "assistant", "reasoning_content": "", "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "exec_command", "arguments": "{}"}}]}
```
