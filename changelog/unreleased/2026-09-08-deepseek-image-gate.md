# Images forwarded to every DeepSeek id but the text-only V4 Flash and V4 Pro

- **Date:** 2026-09-08
- **Type:** feature
- **Scope:** `deepseek_v4`
- **PR:** [#203](https://github.com/Prism-Shadow/agenthub/pull/203)

[中文版](2026-09-08-deepseek-image-gate.zh.md)

## What changed

- `DeepSeekV4Client` forwarded images to every DeepSeek id except the text-only
  `deepseek-v4-flash` and `deepseek-v4-pro`; the previous rule forwarded them only to ids
  containing `vision`.
- `deepseek-v4-flash-vision-exp`, `deepseek-v4.1-flash` and every other id outside that list
  sent an `image_url` item as an `input_image` content part and a `tool_result` image as an
  `input_image` inside `function_call_output`.
- `deepseek-v4-flash` and `deepseek-v4-pro` went on refusing both, with
  `DeepSeek <model> does not support image inputs.` and
  `DeepSeek <model> does not support images in tool results.`

## Text-only ids

The model id is normalised to the part after the last `/`, lowercased, so a gateway prefix and
a platform's spelling do not change the verdict: `deepseek/deepseek-v4-flash` and
`deepseek-ai/DeepSeek-V4-Flash` are read as `deepseek-v4-flash`. The bare id is text-only when
it matches:

```
^deepseek-v4-(flash|pro)(-\d{4})?$
```

| Bare id | Images |
| --- | --- |
| `deepseek-v4-flash`, `deepseek-v4-pro` | refused |
| `deepseek-v4-flash-0731`, `deepseek-v4-pro-0813` | refused |
| `deepseek-v4-flash-vision-exp` | forwarded |
| `deepseek-v4.1-flash` | forwarded |
