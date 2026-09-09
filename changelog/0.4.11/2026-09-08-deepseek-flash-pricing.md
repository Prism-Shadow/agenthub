# DeepSeek V4 Flash re-priced for the 2026-09-10 adjustment

- **Date:** 2026-09-08
- **Type:** fix
- **Scope:** `registry`
- **PR:** [#203](https://github.com/Prism-Shadow/agenthub/pull/203)

[中文版](2026-09-08-deepseek-flash-pricing.zh.md)

## What changed

- `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` on the official DeepSeek API took
  DeepSeek's adjusted official list price, effective 2026-09-10: the off-peak tier moved from
  CNY 1.5 / 4.5 (cached 0.05) to CNY 1.0 / 4.0 (cached 0.02) per million tokens. Peak hours —
  Beijing 9:00-12:00 and 14:00-18:00 — remain double the recorded rate.
- `deepseek-v4-pro` kept CNY 4.5 / 13.5 (cached 0.15), and the OpenRouter and SiliconFlow
  DeepSeek entries kept their own platforms' prices.
