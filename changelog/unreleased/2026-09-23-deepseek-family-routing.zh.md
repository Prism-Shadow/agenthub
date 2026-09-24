# 路由 DeepSeek 的每一个模型 id，含不带版本号的 id

- **Date:** 2026-09-23
- **Type:** fix
- **Scope:** `auto_client`, `tests`

[English](2026-09-23-deepseek-family-routing.md)

## 变更内容

- `AutoLLMClient` 以子串 `deepseek-v4` 推断 DeepSeek 客户端，于是 DeepSeek 发布的不带版本号的
  id——即 V4.1 Flash 的 `deepseek-flash`——匹配不到任何分支，直接被
  `deepseek-flash is not supported. Supported client types: ...` 拒绝。调用方只能在该模型上
  固定 `client_type="deepseek-v4"` 才能用上它。
- 该分支改为用家族前缀 `deepseek-` 匹配裸 id，即路由令牌最后一个 `/` 之后的部分。
  `deepseek-flash` 以及此后任何不带版本号的 DeepSeek id 都能自行路由到 `DeepSeekV4Client`；
  带版本号的 id（`deepseek-v4-pro`、`deepseek-v4-flash`、`deepseek-v4.1-flash`）路由不变；
  带网关前缀的写法（`deepseek/deepseek-flash`、`deepseek-ai/DeepSeek-V4-Flash`、
  `Pro/deepseek-ai/...`）按裸 id 匹配——这正是 DeepSeek 客户端对自己的纯文本拒绝名单所用的规则。
  裸 id 不属于 DeepSeek 的模型，不会因为路径里出现 `deepseek` 而被这一分支认领。
- `list_models()` 对推断出的客户端按同一规则过滤列表，因此挂在网关前的 DeepSeek 客户端不再丢弃
  端点提供的不带版本号的 id。
- 两种语言同步修改；image-detail 与 list-models 用例表覆盖新增的 id。
