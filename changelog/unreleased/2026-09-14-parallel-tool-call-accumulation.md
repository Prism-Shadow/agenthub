# Keep every function call of an interleaved parallel tool-call turn

- **Date:** 2026-09-14
- **Type:** fix
- **Scope:** `openai_responses`, `gpt6`, `deepseek_v4`, `minimax_m3`, `tests`
- **PR:** [#218](https://github.com/Prism-Shadow/agenthub/pull/218)

[中文版](2026-09-14-parallel-tool-call-accumulation.zh.md)

## What changed

- The four Responses clients (`openai_responses`, `gpt6`, `deepseek_v4`, `minimax_m3`)
  accumulated a response's function calls in a **single** slot. A gateway that opens every
  call before closing any of them lost all but the last one: Console Go streams
  `added(A)`, `deltas(A)`, `added(B)`, `deltas(B)`, `done(A)`, `done(B)`, so B's opening
  overwrote A's.
- The loss surfaced one request later, not in the turn it happened: the assistant message
  replayed only B, while the tool results of both calls were replayed as user items, and
  Console Go rejected the orphan with `400 ... No function call found for
  function_call_output with call_id 'call_...'` — the whole turn was lost. Every harness
  turn that ran two tools in parallel hit it.
- Each Responses client now accumulates the function calls of a response by their output item
  id inside `transform_model_output_to_uni_event`: `output_item.added` opens a call,
  `function_call_arguments.delta` appends to the call its item id names (or to the call opened
  last when a server sends none), `function_call_arguments.done` yields the complete `tool_call`,
  and the end of the response closes whatever a gateway never closed on its own. The streaming
  loop only forwards the events; the uni events are unchanged and the item id never leaves the
  client.
- Both languages changed together, and the parallel-call suite covers both Responses rows of
  the tool-call-arguments tests.
