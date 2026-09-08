# DeepSeek V4 Flash 按 2026-09-10 调价重新定价

- **Date:** 2026-09-08
- **Type:** fix
- **Scope:** `registry`
- **PR:** [#203](https://github.com/Prism-Shadow/agenthub/pull/203)

[English](2026-09-08-deepseek-flash-pricing.md)

## 变更内容

- 官方 DeepSeek API 上的 `deepseek-v4-flash` 与 `deepseek-v4-flash-vision-exp` 改用 DeepSeek 自
  2026-09-10 起生效的调整后官方牌价：空闲时段档位由每百万 token CNY 1.5/4.5（缓存 0.05）调整为
  CNY 1.0/4.0（缓存 0.02）。高峰时段——北京时间 9:00-12:00 与 14:00-18:00——仍为所记价格的两倍。
- `deepseek-v4-pro` 维持 CNY 4.5/13.5（缓存 0.15），OpenRouter 与 SiliconFlow 的 DeepSeek 条目
  保持各自平台的价格。
