# Accept content items recorded before 0.5.0 until 0.6.0

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `legacy`, `base_client`, `integration`
- **PR:** [#223](https://github.com/Prism-Shadow/agenthub/pull/223)

[中文版](2026-09-16-backward-compatibility.zh.md)

## What changed

- `normalize_legacy_messages` / `normalizeLegacyMessages` was added in `legacy.py` / `legacy.ts` and exported from the package. It converts the content item types used before [streaming protocol v2](2026-09-16-streaming-protocol-v2.md) — `text`, `image_url`, `inline_data`, `thinking`, `inline_thinking`, `tool_call`, `tool_result`, `embedding` — to their `.done` types (`text` → `text.done`, …), leaves `.done` items as they are, and drops `partial_tool_call` items. A message that needs no conversion is returned as it is; a converted message is returned as a copy, so the caller's data is not modified and `created_at` and every other field carry over.
- The conversion is applied to:
  - the request messages of `streaming_response` / `streamingResponse`, before the client and the `trace_id` trace receive them;
  - the message passed to `streaming_response_stateful` / `streamingResponseStateful`, before it enters the history;
  - the history passed to `set_history` / `setHistory`;
  - trace files loaded by the tracer, including the tracer served inside the playground.
- The first conversion in a process emits one deprecation warning naming 0.6.0: `warnings.warn(..., FutureWarning)` in Python, a category Python shows by default, `process.emitWarning(..., "DeprecationWarning")` in TypeScript.
- Output — events, the stateful history, saved traces — uses the `.done` and `.delta` types only.

## Removal in 0.6.0

- Messages, histories, and trace files with the old item types keep working without changes until 0.6.0; nothing has to be migrated before then. Code that builds messages can switch to the `.done` types at any point, and stored data can be converted once with `normalize_legacy_messages` / `normalizeLegacyMessages`.
- 0.6.0 removes the `legacy` module, the exported function, and every call to it; from then on only the `.done` types are accepted.
