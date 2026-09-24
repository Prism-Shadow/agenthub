# Route every DeepSeek id, version-free ones included

- **Date:** 2026-09-23
- **Type:** fix
- **Scope:** `auto_client`, `tests`

[中文版](2026-09-23-deepseek-family-routing.zh.md)

## What changed

- `AutoLLMClient` deduced the DeepSeek client from the substring `deepseek-v4`, so an id
  DeepSeek ships without a version number in it — `deepseek-flash`, the released V4.1 Flash —
  matched no branch at all and was rejected with `deepseek-flash is not supported. Supported
  client types: ...`. A caller could only reach the model by pinning `client_type="deepseek-v4"`
  on it.
- The branch now matches the family prefix `deepseek-` against the bare id, the part of the
  routing token after the last `/`. `deepseek-flash` and any later version-free DeepSeek id
  route to `DeepSeekV4Client` on their own, the versioned ids (`deepseek-v4-pro`,
  `deepseek-v4-flash`, `deepseek-v4.1-flash`) route exactly as before, and a gateway-qualified
  spelling (`deepseek/deepseek-flash`, `deepseek-ai/DeepSeek-V4-Flash`, `Pro/deepseek-ai/...`)
  is matched on its bare id — the rule the DeepSeek client already applies to its own text-only
  deny-list. An id whose bare part is not a DeepSeek one is not claimed by a `deepseek` that
  only appears in the path.
- `list_models()` filters a deduced client's listing by the same rule, so a DeepSeek client
  fronting a gateway now keeps the version-free ids the endpoint serves instead of dropping
  them.
- Both languages changed together; the image-detail and list-models tables cover the new ids.
