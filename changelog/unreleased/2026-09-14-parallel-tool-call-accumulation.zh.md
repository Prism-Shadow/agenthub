# 保留并行工具调用轮次中的每一个函数调用

- **Date:** 2026-09-14
- **Type:** fix
- **Scope:** `openai_responses`, `gpt6`, `deepseek_v4`, `minimax_m3`, `tests`
- **PR:** [#218](https://github.com/Prism-Shadow/agenthub/pull/218)

[English](2026-09-14-parallel-tool-call-accumulation.md)

## 变更内容

- 四个 Responses 客户端（`openai_responses`、`gpt6`、`deepseek_v4`、`minimax_m3`）把一次响应里的
  函数调用累积在**同一个**槽位里。若网关先开出全部调用、再逐个收尾，除最后一个之外的调用都会丢失：
  Console Go 的流是 `added(A)`、`deltas(A)`、`added(B)`、`deltas(B)`、`done(A)`、`done(B)`，
  于是 B 的开头覆盖了 A。
- 丢失要到下一个请求才暴露：assistant 消息只回放出 B，而两个调用的工具结果都作为 user 项回放，
  Console Go 于是以 `400 ... No function call found for function_call_output with call_id
  'call_...'` 拒绝这个孤儿项，整轮作废。凡是并行跑两个工具的轮次都会命中。
- 现在每个未收尾的调用各自按响应项 id 累积（取自 `response.output_item.added` 事件）；参数 delta 归属到
  其 `item_id` 指向的调用，对不发 item id 的服务端则回退到最后开出的那个。调用在自己的
  `response.function_call_arguments.done` 到达时收尾，响应结束时再收掉网关始终没有收尾的调用。
- 两种语言同步修改；并行调用用例覆盖 tool-call-arguments 测试中的两个 Responses 用例行。
