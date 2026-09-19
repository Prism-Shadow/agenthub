# DeepSeek、GLM 与 Kimi 客户端不再回退到 `OPENAI_API_KEY`，Anthropic 客户端不再发送 `ANTHROPIC_AUTH_TOKEN`

- **Date:** 2026-09-18
- **Type:** fix
- **Scope:** `deepseek_v4`, `glm5_3`, `kimi_k3`, `claude5`, `ant_messages`
- **PR:** [#224](https://github.com/Prism-Shadow/agenthub/pull/224)
- **Breaking:** yes — 没有自身密钥的 DeepSeek、GLM 或 Kimi 客户端改为抛出异常，不再使用 `OPENAI_API_KEY`；任何客户端都不再读取 `ANTHROPIC_AUTH_TOKEN`

[English](2026-09-18-env-credential-fallbacks.md)

## 变更内容

- `DeepSeekV4Client`、`GLM5_3Client` 与 `KimiK3Client` 只从 `api_key` 或各自的变量——`DEEPSEEK_API_KEY`、
  `ZAI_API_KEY`、`MOONSHOT_API_KEY`——取得密钥，并显式交给 OpenAI SDK。两者都没有时，构造即抛出
  `DEEPSEEK_API_KEY is required for DeepSeekV4Client.`（另两个客户端给出对应的消息），与 `MiniMaxM3Client`
  既有的做法一致。OpenAI SDK 不再用 `OPENAI_API_KEY` 补上缺失的密钥，因此 DeepSeek 客户端不再把 OpenAI 密钥
  发往 `api.deepseek.com`，GLM 与 Kimi 客户端也不再把它发往 `api.z.ai`、`api.moonshot.cn` 或客户端被指定的
  任何 base URL。
- `Claude5Client` 向 Anthropic SDK 传入 `authToken: null`（Python 在构造后清空 `auth_token`），因此
  `ANTHROPIC_AUTH_TOKEN` 不再以 `Authorization: Bearer` 的形式随已配置的密钥发往任何 base URL。
  `AntMessagesClient` 仍通过 `x-api-key` 与 `Authorization: Bearer` 两种请求头发送自己的密钥；未配置密钥时，
  它现在两者都不发送，而不是发送 `ANTHROPIC_AUTH_TOKEN`。
- 在 TypeScript 中，走 Bedrock（`bedrock://<region>`）的 `Claude5Client` 把其 `AnthropicBedrock` 客户端的
  `apiKey` 与 `authToken` 设为 `null`，因此发往 AWS 的请求不再在 SigV4 签名之外携带作为 `x-api-key` 的
  `ANTHROPIC_API_KEY` 或作为 Bearer 请求头的 `ANTHROPIC_AUTH_TOKEN`。
- `OPENAI_API_KEY` 与 `OPENAI_BASE_URL` 继续配置 OpenAI 协议客户端（`gpt-6`、`openai-chat`、
  `openai-responses`、`openai-embedding`、`openai-chat-vllm-adapter`），`ANTHROPIC_API_KEY` 与
  `ANTHROPIC_BASE_URL` 继续配置 Anthropic 客户端。
- 离线测试（`tests/env-credentials.test.ts`、`tests/test_env_credentials.py`）在受控环境下构造上述客户端、
  `MiniMaxM3Client` 与各 OpenAI 协议客户端，并断言厂商 SDK 实例持有的凭据。

## 兼容性

- 此前通过 `OPENAI_API_KEY` 认证的 DeepSeek、GLM 或 Kimi 客户端——例如把网关密钥导出为 `OPENAI_API_KEY`，
  再配合由 `deepseek-v4`、`glm-5.x` 或 `kimi-k*` 提供服务的注册表条目使用——现在会在构造时抛出异常。请把密钥作为
  `api_key` 传入，或设置 `DEEPSEEK_API_KEY`、`ZAI_API_KEY` 或 `MOONSHOT_API_KEY`。
- 此前仅通过 `ANTHROPIC_AUTH_TOKEN` 认证的 `claude-*` 或 `ant-messages` 客户端现在不发送任何凭据，
  Anthropic SDK 会以 "Could not resolve authentication method" 拒绝其请求。请把该令牌作为 `api_key` 传入；
  只接受 `Authorization: Bearer` 的端点需要使用 `client_type="ant-messages"`，它会通过两种请求头发送密钥。
