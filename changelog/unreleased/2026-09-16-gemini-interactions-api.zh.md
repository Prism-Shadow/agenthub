# Gemini 客户端改用 Interactions API

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `gemini3_8`, `tests`, `llmsdk_docs`
- **PR:** TBD
- **Breaking:** yes — Gemini SDK 升级到新的主版本（`@google/genai` 2.x、`google-genai` 2.x），调用工具的 Gemini 轮次改以 `tool_call` 而不是 `stop` 结束，Gemini 上的 `fast_mode` 改为请求 priority 服务层级而不再抛出异常

[English](2026-09-16-gemini-interactions-api.md)

## 变更内容

- `Gemini3_8Client`（Python 与 TypeScript）通过 Interactions API（`client.interactions.create`，流式，`store: false`，每次请求携带完整历史）发送文本、图像与 TTS 请求；generateContent 路径被移除。embedding 模型仍使用 `models.embedContent`，因为 Interactions API 对它们返回 404。
- SDK 依赖提升为 `@google/genai` `^2.22.0` 与 `google-genai>=2.23.0`。
- 流以 step 的 `index` 作为 key。某个 step 的内容切换种类时，每一段同种类内容流出一个内容项，key 为 `<index>.<run>`，因此图像模型先文本、再图像、再文本的思考摘要是三个内容项。
- `thought` step 的 `thought_summary` 文本以 `thinking.delta` 流出，摘要图像以 `inline_thinking.delta` 流出；其 `thought_signature` 作为 `fidelity.signature`，挂在该 step 最后一个内容项同种类的空增量上（step 没有摘要时为空的 `thinking.delta`）。因此每个 Gemini 文本响应都带有一个承载 signature 的 `thinking.done` 项，摘要关闭时其 `thinking` 为空。
- `function_call` step 以携带调用名称与 id 的 `tool_call.delta` 开始，参数以片段流出。`model_output` step 流出 `text.delta`，图像与音频流出 `inline_data.delta`；TTS 音频的 mime type 为 `audio/l16; rate=<sample_rate>; channels=<channels>`。
- `interaction.completed` 设置结束原因与用量；未知的事件、step 与增量被跳过，在 `AGENTHUB_DEBUG` 下抛出异常。
- 消息以 Interactions step 发出：用户文本与图像为 `user_input` step，图像以 base64 内联、URL 先行下载；助手的文本与媒体为 `model_output` step；思考内容项每一段连续内容合为一个 `thought` step，携带摘要以及结束该段的内容项的 signature；`tool_call.done` 为 `function_call`；`tool_result.done` 为 `function_result`，函数 `name` 取自对应的调用，纯文本结果为字符串，附带图像时为文本加图像的内容列表。空文本块不发送。
- 经 generateContent 客户端记录的历史把 `fidelity.signature` 放在文本、内联数据或工具调用内容项上；这样的内容项回放时，前面加一个携带其 signature 的 `thought` step。generateContent Python SDK 以 bytes 记录的 signature 以 base64 发送。
- 以函数名作为 id 记录的调用，回放时不带 `id` 与 `call_id`。
- 含有 `thought` step 却不以其开头的助手消息（图像模型有时在第一个思考之前先流出文本），回放时以一个携带占位 signature `skip_thought_signature_validator` 的 `thought` step 开头。
- `thinking_summary: true` 时，`gemini-3.8-flash` 会流出思考摘要。
- 共享单元测试中的 Gemini 用例（`unknown-events`、`message-order`、`thinking-level-mapping`）按 Interactions 的事件与 step 重写。
- `llmsdk_docs/gemini_interactions/README.md` 记录了图像模型可能在第一个思考之前先流出文本、回放时共用同一 id 的并行调用与空文本块会被拒绝，以及先文本的图像轮次可被接受的回放形式。

## 配置行为

| `UniConfig` | Interactions 请求 |
| --- | --- |
| `max_tokens` | `generation_config.max_output_tokens` |
| `system_prompt` | `system_instruction` |
| `thinking_level` | `generation_config.thinking_level`，小写，沿用各模型的钳制规则：3.8、3.7 与所有 pro 模型接受 `low`/`medium`/`high`（`gemini-3-pro` 接受 `low`/`high`），图像模型接受 `minimal`/`high`，其余模型四档均可 |
| `thinking_summary` | `generation_config.thinking_summaries`：`true` → `"auto"`，`false` → `"none"`，未设置则省略 |
| `tools` | `tools: [{type: "function", name, description, parameters}]` |
| `tool_choice` | `generation_config.tool_choice`：`auto` → `"auto"`，`required` → `"any"`，`none` → `"none"`，名称列表 → `{allowed_tools: {mode: "any", tools: [...]}}` |
| `fast_mode` | `service_tier: "priority"` |
| `prompt_caching` | 只接受 `ENABLE` |
| `temperature` | `UnsupportedParameterError` |
| `image_config` | `response_format: [{type: "text"}, {type: "image", aspect_ratio, image_size}]` |
| `tts_config` | `response_format: {type: "audio"}` 与 `generation_config.speech_config: [{voice}]` 或 `[{speaker, voice}, {speaker, voice}]`；TTS 模型只收到这些设置、`max_output_tokens`、`service_tier` 以及最新一条文本消息 |
| 每次请求 | `store: false` |

| Interactions 结果 | `UniEvent` |
| --- | --- |
| `status: "completed"` | `finish_reason: "stop"` |
| `status: "requires_action"` | `finish_reason: "tool_call"` |
| `status: "incomplete"` | `finish_reason: "length"` |
| 其他状态 | `finish_reason: "unknown"` |
| `total_cached_tokens` | `cached_tokens`（为 0 时为 null） |
| `total_input_tokens - total_cached_tokens` | `prompt_tokens` |
| `total_thought_tokens` | `thoughts_tokens`（为 0 时为 null） |
| `total_output_tokens` | `response_tokens`（为 0 时为 null） |

## 兼容性

- 与 AgentHub 一同安装 `@google/genai` 2.x（TypeScript）或 `google-genai` 2.x（Python）；固定在 1.x SDK 的项目需要放开版本限制。
- 调用工具的 Gemini 响应以 `finish_reason: "tool_call"` 而不是 `"stop"` 结束；依据 `"stop"` 判断的工具循环需要接受 `"tool_call"`。
- 在 Gemini 模型上设置 `fast_mode: true` 不再抛出 `UnsupportedParameterError`，而是请求 priority 服务层级，其计费高于 standard 层级。不设置 `fast_mode` 即保持标准计费。
