# DeepSeek, GLM and Kimi clients no longer fall back to `OPENAI_API_KEY`, and the Anthropic clients no longer send `ANTHROPIC_AUTH_TOKEN`

- **Date:** 2026-09-18
- **Type:** fix
- **Scope:** `deepseek_v4`, `glm5_3`, `kimi_k3`, `claude5`, `ant_messages`
- **PR:** [#224](https://github.com/Prism-Shadow/agenthub/pull/224)
- **Breaking:** yes — a DeepSeek, GLM or Kimi client without its own key now raises instead of using `OPENAI_API_KEY`, and no client reads `ANTHROPIC_AUTH_TOKEN` any more

[中文版](2026-09-18-env-credential-fallbacks.zh.md)

## What changed

- `DeepSeekV4Client`, `GLM5_3Client` and `KimiK3Client` take their key from `api_key` or
  from their own variable only — `DEEPSEEK_API_KEY`, `ZAI_API_KEY`, `MOONSHOT_API_KEY` — and
  hand it to the OpenAI SDK explicitly. With neither, construction raises
  `DEEPSEEK_API_KEY is required for DeepSeekV4Client.` (and the matching message for the
  other two), as `MiniMaxM3Client` already did. The OpenAI SDK no longer fills the missing
  key from `OPENAI_API_KEY`, so a DeepSeek client no longer sends an OpenAI key to
  `api.deepseek.com`, nor a GLM or Kimi client to `api.z.ai` or `api.moonshot.cn`, or to
  whatever base URL the client was given.
- `Claude5Client` passes the Anthropic SDK `authToken: null` (in Python it clears
  `auth_token` after construction), so `ANTHROPIC_AUTH_TOKEN` is no longer sent as
  `Authorization: Bearer` beside the configured key, to any base URL. `AntMessagesClient`
  still sends its key through both `x-api-key` and `Authorization: Bearer`, and with no key
  configured it now sends neither instead of `ANTHROPIC_AUTH_TOKEN`.
- In TypeScript, `Claude5Client` on Bedrock (`bedrock://<region>`) sets `apiKey` and
  `authToken` to `null` on its `AnthropicBedrock` client, so requests to AWS no longer carry
  `ANTHROPIC_API_KEY` as `x-api-key` or `ANTHROPIC_AUTH_TOKEN` as a Bearer header beside the
  SigV4 signature.
- `OPENAI_API_KEY` and `OPENAI_BASE_URL` keep configuring the OpenAI protocol clients
  (`gpt-6`, `openai-chat`, `openai-responses`, `openai-embedding`,
  `openai-chat-vllm-adapter`), and `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL` the
  Anthropic ones.
- Offline tests (`tests/env-credentials.test.ts`, `tests/test_env_credentials.py`) build
  each of these clients, `MiniMaxM3Client` and the OpenAI protocol clients under a
  controlled environment and assert which credential the vendor SDK instance holds.

## Compatibility

- A DeepSeek, GLM or Kimi client that authenticated through `OPENAI_API_KEY` — for example a
  gateway key exported as `OPENAI_API_KEY` and used with a registry row served by
  `deepseek-v4`, `glm-5.x` or `kimi-k*` — now raises at construction. Pass the key as
  `api_key`, or set `DEEPSEEK_API_KEY`, `ZAI_API_KEY` or `MOONSHOT_API_KEY`.
- A `claude-*` or `ant-messages` client that authenticated only through
  `ANTHROPIC_AUTH_TOKEN` now sends no credential, and the Anthropic SDK rejects its requests
  with "Could not resolve authentication method". Pass the token as `api_key`; an endpoint
  that accepts only `Authorization: Bearer` needs `client_type="ant-messages"`, which sends
  the key through both headers.
