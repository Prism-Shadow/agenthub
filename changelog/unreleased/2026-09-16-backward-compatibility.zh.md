# 在 0.6.0 之前接受 0.5.0 之前记录的内容项

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `legacy`, `base_client`, `integration`
- **PR:** [#223](https://github.com/Prism-Shadow/agenthub/pull/223)

[English](2026-09-16-backward-compatibility.md)

## 变更内容

- 在 `legacy.py` / `legacy.ts` 中新增 `normalize_legacy_messages` / `normalizeLegacyMessages`，并从包中导出。它把[流式协议 v2](2026-09-16-streaming-protocol-v2.zh.md) 之前使用的内容项类型——`text`、`image_url`、`inline_data`、`thinking`、`inline_thinking`、`tool_call`、`tool_result`、`embedding`——转换为对应的 `.done` 类型（`text` → `text.done` 等），`.done` 项保持原样，`partial_tool_call` 项被丢弃。无需转换的消息原样返回；经过转换的消息以副本返回，因此调用方的数据不会被修改，`created_at` 及其他所有字段都会保留。
- 转换作用于：
  - `streaming_response` / `streamingResponse` 的请求消息，在客户端与 `trace_id` 对应的 trace 接收它们之前；
  - 传给 `streaming_response_stateful` / `streamingResponseStateful` 的消息，在它进入历史之前；
  - 传给 `set_history` / `setHistory` 的历史；
  - tracer 加载的 trace 文件，包括 playground 内提供的 tracer。
- 每个进程中的第一次转换会给出一条提及 0.6.0 的弃用警告：Python 中为 `warnings.warn(..., FutureWarning)`（Python 默认显示该类别），TypeScript 中为 `process.emitWarning(..., "DeprecationWarning")`。
- 输出——事件、有状态历史、保存的 trace——只使用 `.done` 与 `.delta` 类型。

## 0.6.0 中移除

- 使用旧内容项类型的消息、历史与 trace 文件在 0.6.0 之前无需任何改动即可继续使用；在此之前不必迁移任何内容。构造消息的代码可以随时改用 `.done` 类型，已存储的数据可以用 `normalize_legacy_messages` / `normalizeLegacyMessages` 一次性转换。
- 0.6.0 会移除 `legacy` 模块、导出的函数及其所有调用；此后只接受 `.done` 类型。
