# 除纯文本的 V4 Flash 与 V4 Pro 外，图片转发给所有 DeepSeek 模型 id

- **Date:** 2026-09-08
- **Type:** feature
- **Scope:** `deepseek_v4`
- **PR:** [#203](https://github.com/Prism-Shadow/agenthub/pull/203)

[English](2026-09-08-deepseek-image-gate.md)

## 变更内容

- `DeepSeekV4Client` 除纯文本的 `deepseek-v4-flash` 与 `deepseek-v4-pro` 外，向所有 DeepSeek 模型
  id 转发图片；此前的规则只向 id 中含 `vision` 的模型转发。
- `deepseek-v4-flash-vision-exp`、`deepseek-v4.1-flash` 以及该名单之外的其他 id，都会把
  `image_url` 条目发成 `input_image` 内容块，把 `tool_result` 里的图片发成 `function_call_output`
  内的 `input_image`。
- `deepseek-v4-flash` 与 `deepseek-v4-pro` 仍然拒绝这两种图片，分别报
  `DeepSeek <model> does not support image inputs.` 与
  `DeepSeek <model> does not support images in tool results.`

## 纯文本模型 id

模型 id 先归一化为最后一个 `/` 之后的部分并转小写，因此网关前缀与各平台的拼写不影响判定：
`deepseek/deepseek-v4-flash` 与 `deepseek-ai/DeepSeek-V4-Flash` 都读作 `deepseek-v4-flash`。
归一化后的 id 匹配下式即为纯文本模型：

```
^deepseek-v4-(flash|pro)(-\d{4})?$
```

| 归一化后的 id | 图片 |
| --- | --- |
| `deepseek-v4-flash`、`deepseek-v4-pro` | 拒绝 |
| `deepseek-v4-flash-0731`、`deepseek-v4-pro-0813` | 拒绝 |
| `deepseek-v4-flash-vision-exp` | 转发 |
| `deepseek-v4.1-flash` | 转发 |
