# Vertex AI 上的 Gemini 改走 generateContent

- **Date:** 2026-09-17
- **Type:** feature
- **Scope:** `gemini3_8_generate_content`, `gemini3_8`, `auto_client`, `tests`, `llmsdk_docs`
- **PR:** [#223](https://github.com/Prism-Shadow/agenthub/pull/223)

[English](2026-09-17-gemini-vertex-generate-content.md)

## 变更内容

- API key 为 Vertex AI 服务账号 JSON 密钥（以 `{` 开头的 key，直接传入或经 `GEMINI_API_KEY` 读取）时，`AutoLLMClient` 把 Gemini 模型路由到新增的 `Gemini3_8GenerateContentClient`（Python 与 TypeScript，`gemini3_8_generate_content/`）；其他 key 仍路由到 `Gemini3_8Client`（Interactions API）。
- 包含 `gemini-generate-content` 的 `client_type` / `clientType` 选择 `Gemini3_8GenerateContentClient`，包含 `gemini-interactions` 的选择 `Gemini3_8Client`，与 key 无关；`CLIENT_TYPE` 接受同样的取值。不支持的 client type 的报错信息列出了这两个取值。
- 经 `Gemini3_8GenerateContentClient` 调用 `list_models` / `listModels` 时，只保留路由到 Gemini 系列的 id，因此 Vertex AI 的模型列表会去掉 `gemini-2.5-flash`、`spicy-mayo` 这类 id。
- `Gemini3_8GenerateContentClient` 即截至 0.4.15 发布的 generateContent 客户端（`models.generateContentStream`，Vertex AI 在 `global` location 使用服务账号凭据，`GEMINI_API_KEY` / `GEMINI_BASE_URL`，`default_headers`），迁移到流式协议 v2。
- 流出的内容项按流中顺序编号：part 的种类改变时（思考文本、文本、思考图像、内联数据、函数调用）、每个函数调用与每张图像、以及携带 `thoughtSignature` 的 part 之后，都开始一个新内容项；该 signature 结束其所在内容项，并成为它的 `fidelity.signature`。
- 不带 signature 的连续文本 part 合为一个内容项，音频片段合为一个 `inline_data` 内容项，mime type 保持原样（`audio/l16; rate=24000; channels=1`）。
- `functionCall` part 以一个 `tool_call.delta` 流出，携带名称、调用 id（API 未给 id 时取名称）、JSON 参数与 signature，随后是其 done 内容项。
- 携带 signature 的空文本 part（文本回答的最后一个片段）以带该 signature 的空 `text.delta` 流出；不带 signature 的空文本 part 被跳过。
- 无法识别的 part（空 part、`executableCode`、`fileData`）被跳过，在 `AGENTHUB_DEBUG` 下抛出异常；既没有 candidates 也没有用量的 chunk（网关心跳）不产生任何内容。
- 流出过函数调用的响应以 `tool_call` 结束，尽管 API 报告的是 `STOP`。用量取自 `usageMetadata` 带有 `promptTokenCount` 的 chunk。
- Python 客户端把 `thoughtSignature` 记录为 base64 文本，与 TypeScript 客户端记录的字符串相同；以 bytes 记录的 signature 仍可回放。
- 消息以 contents 发送，每个内容项对应一个 part：文本（保留空文本）；图像以 base64 内联，URL 先行下载；内联数据；思考为 `thought` 文本 part；内联思考为 `thought` 内联数据 part；工具调用为 `functionCall`（id 等于函数名时不带 `id`）；工具结果为 `functionResponse`，函数名取自对应的调用，图像作为其 parts 附带。part 把所属内容项的 `fidelity.signature` 作为 `thoughtSignature` 携带。
- 助手消息中第一个函数调用不带 signature 时，调用之前最后一个思考内容项的 signature 移到该调用上；没有任何思考内容项带 signature 时，该调用携带占位 signature `skip_thought_signature_validator`。仍留在思考内容项上的 signature 移到其后第一个既不是思考、也不是函数响应、且不带 signature 的 part 上（存在这样的 part 时），文本为空且不再带 signature 的思考 part 被去掉。内联思考内容项上的 signature 留在其自身的 part 上。
- 函数响应与其他 part 混在一起的消息，按连续段拆成多个同角色的 content 依次发送。
- `Gemini3_8Client`（Interactions API）：某个内容项的 `fidelity.signature` 转为 `thought` step、而该轮次以一个不带 signature 的 `thought` step 开头时，这个开头的 step 也带上同一个 signature（未签名的开头思考后接已签名思考会被以 400 拒绝）。
- embedding 模型对每条消息依次发送一次 `embedContent` 请求，每次产生一个 `embedding.done` 内容项；`prompt_tokens` 为各 embedding 的 `statistics.tokenCount` 之和（响应改为携带 `metadata.billableCharacterCount` 时取该值）。
- 共享单元测试 `unknown-events`、`message-order`、`reasoning-fidelity`、`reasoning-replay-without-thinking`、`thinking-level-mapping`、`list-models` 与 `default-headers` 增加了 `Gemini3_8GenerateContentClient` 的行与用例，e2e 测试的 Vertex AI 模型增加了 `gemini-embedding-2`。
- `README.md`、`src_py/README.md` 与 `src_ts/README.md` 说明了 Vertex AI 密钥与这两个 client type；skills 的模型参考注明了服务账号密钥；`agenthub-dev` skill 记录了 `gemini3_8_generate_content` 如何为内容项编号；`llmsdk_docs/gemini_interactions/README.md` 新增 Vertex AI 一节，`llmsdk_docs/gemini3_8/README.md` 链接到该节。

## 配置行为

| `UniConfig` | generateContent 请求 |
| --- | --- |
| `max_tokens` | `maxOutputTokens` |
| `system_prompt` | `systemInstruction` |
| `thinking_level` | `thinkingConfig.thinkingLevel`：`none` → `MINIMAL`，`low` → `LOW`，`medium` → `MEDIUM`，`high`/`xhigh`/`max` → `HIGH`，并沿用 `Gemini3_8Client` 的各模型钳制规则：3.8、3.7 与所有 pro 模型接受 `LOW`/`MEDIUM`/`HIGH`（`gemini-3-pro` 接受 `LOW`/`HIGH`），图像模型接受 `MINIMAL`/`HIGH`，其余模型四档均可 |
| `thinking_summary` | `thinkingConfig.includeThoughts` |
| `tools` | `tools: [{functionDeclarations}]` |
| `tool_choice` | `toolConfig.functionCallingConfig`：`auto` → `AUTO`，`required` → `ANY`，`none` → `NONE`，名称列表 → `ANY` 加 `allowedFunctionNames` |
| `fast_mode` | `UnsupportedParameterError` |
| `prompt_caching` | 只接受 `ENABLE` |
| `temperature` | `UnsupportedParameterError` |
| `image_config` | `imageConfig: {aspectRatio, imageSize}` |
| `tts_config` | `responseModalities: ["AUDIO"]` 与 `speechConfig`（单一音色为 `voiceConfig.prebuiltVoiceConfig`，两位说话人为 `multiSpeakerVoiceConfig`）；TTS 模型只收到这些设置、`maxOutputTokens` 以及最新一条消息，且该消息必须是文本 |

| generateContent 结果 | `UniEvent` |
| --- | --- |
| `finishReason: "STOP"` | `finish_reason: "stop"`；流出过函数调用时为 `"tool_call"` |
| `finishReason: "MAX_TOKENS"` | `finish_reason: "length"` |
| 其他 `finishReason` | `finish_reason: "unknown"` |
| `cachedContentTokenCount` | `cached_tokens`（缺失或为 0 时为 null） |
| `promptTokenCount - cachedContentTokenCount` | `prompt_tokens` |
| `thoughtsTokenCount` | `thoughts_tokens`（缺失或为 0 时为 null） |
| `candidatesTokenCount` | `response_tokens`（缺失或为 0 时为 null） |
