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
- `partial_tool_call` items gain an optional `item_id`: the Responses clients fill it from the
  item id the `output_item.added`, `function_call_arguments.delta` and
  `function_call_arguments.done` events carry, and the streaming loop keys its open calls by it,
  falling back to the call announced last for servers that send none. A call closes when its
  own `function_call_arguments.done` arrives, and the end of the response closes whatever a
  gateway never closed on its own.
- Both languages changed together, and the parallel-call suite covers both Responses rows of
  the tool-call-arguments tests.
