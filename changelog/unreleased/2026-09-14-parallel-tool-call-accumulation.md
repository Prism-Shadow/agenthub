# Keep every function call of an interleaved parallel tool-call turn

- **Date:** 2026-09-14
- **Type:** fix
- **Scope:** `openai_responses`, `gpt6`, `deepseek_v4`, `minimax_m3`, `tests`
- **PR:** [#N](https://github.com/Prism-Shadow/agenthub/pull/218)

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
- Each open call is now accumulated under its own response item id, taken from the
  `response.output_item.added` event; an argument delta is attributed to the call its
  `item_id` names, falling back to the call opened last for servers that send no item id.
  A call closes when its own `response.function_call_arguments.done` arrives, and the end of
  the response closes whatever a gateway never closed on its own.
- Both languages changed together, and the parallel-call suite covers both Responses rows of
  the tool-call-arguments tests.

## Verification

- Reproduced against Console Go (`opencode_go` / `muse-spark-1.3-contributor`), which emits
  the interleaved order above: before the fix the replay carried
  `function_call(B) | function_call_output(B) | function_call_output(A)` and was answered
  with the 400; after it, `reasoning | reasoning | function_call(A) | function_call(B) |
  function_call_output(A) | function_call_output(B)`, and the model answered.
- `tool-call-arguments` suites: 17 passed (TypeScript) and 16 passed (Python); the new case
  fails on the pre-fix client in both languages. The full suites pass except the live
  `:official` cases, which need real API keys.
