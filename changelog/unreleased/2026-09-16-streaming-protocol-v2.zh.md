# 流式协议 v2：`delta` 与 `stop` 事件，`.delta` 与 `.done` 内容项

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `types`, `base_client`, `errors`, `integration`, `skills`
- **PR:** [#223](https://github.com/Prism-Shadow/agenthub/pull/223)
- **Breaking:** yes — 每种内容项类型都加上了 `.delta` 或 `.done` 后缀，`start` 与 `unused` 事件类型以及 `partial_tool_call` 内容项被移除，客户端改为返回 client part 而不再返回事件

[English](2026-09-16-streaming-protocol-v2.md)

## 变更内容

- `EventType` 改为 `"delta" | "stop"`，`UniEvent` 改为 `UniDeltaEvent | UniStopEvent`。一次流由任意多个 `delta` 事件加上恰好一个 `stop` 事件组成，`stop` 事件总在最后。`delta` 事件恰好携带一个内容项，其 `usage_metadata` 与 `finish_reason` 为空；`stop` 事件不携带内容项，其 `usage_metadata` 与 `finish_reason` 均非空。`start` 与 `unused` 事件类型被移除。
- 内容项类型拆分为完整项与流式片段两族。`ContentItem` 改为 `.done` 族——`text.done`、`image_url.done`、`inline_data.done`、`thinking.done`、`inline_thinking.done`、`tool_call.done`、`tool_result.done`、`embedding.done`（`TextDoneItem`、`ImageUrlDoneItem` 等）——也是 `UniMessage` 唯一容纳的一族。新增仅用于事件的 `.delta` 族 `DeltaContentItem`——`text.delta`、`inline_data.delta`、`thinking.delta`、`inline_thinking.delta`、`tool_call.delta`、`embedding.delta`（`TextDeltaItem` 等）——并有 `EventContentItem = DeltaContentItem | ContentItem`。原有的内容项类型（`TextContentItem`、`PartialToolCallContentItem`、`PartialContentItem` 等）被移除，`partial_tool_call` 及其 `item_id` 随之移除。
- 所有客户端都遵循同一套语法：每个内容项先流出一个或多个 `.delta` 片段，再由一个承载完整内容的 `.done` 项收尾——拼接好的文本、思考或字节；参数已解析的工具调用；向量。内容项之间从不交错：某个内容项在另一个仍在流式输出时开始，会被暂存到前一个完成之后。同一内容项中至多一个 `.delta` 携带非空 `fidelity`，且与 `.done` 项的 `fidelity` 相同；只携带 fidelity 的片段内容可以为空（Claude 的 signature、GPT 的 `phase`、Responses 的加密推理）。工具调用的第一个 `tool_call.delta` 携带其 `name` 与 `tool_call_id`，之后的片段只携带 `arguments`。
- `minimax_m3` 把从已完成输出 item 读取的每个工具调用，以一个携带名称、id 与完整参数的 `tool_call.delta` 流出，随后是 `tool_call.done`。
- 工具调用的参数无法解析为 JSON 对象时，`ToolCallArgumentParseError` 在该调用的 `tool_call.done` 位置抛出。
- `EmptyResponseError` 在 `stop` 事件的位置抛出，并新增 `usage_metadata` / `usageMetadata`。流结束时缺少用量或结束原因，同样在 `stop` 事件的位置抛出异常。
- 新增 `StreamProtocolError`（携带 `client` 的 `AgentHubError`），并从包中导出。客户端的输出违反语法时，它在任何模式下都会抛出：内容项完成后又来片段、同一内容项中出现第二个不同的 fidelity、第一个 `tool_call.delta` 缺少名称或 id、某个内容项的 key 下出现另一种类型的片段。
- `streaming_response` / `streamingResponse` 保存 `trace_id` 对应的 trace、`streaming_response_stateful` / `streamingResponseStateful` 把本轮记入历史，都在产出 `stop` 事件之前完成。
- `concat_uni_events_to_uni_message` / `concatUniEventsToUniMessage` 按流中顺序收集 `.done` 项，并从 `stop` 事件取 `usage_metadata`、`finish_reason` 与 `created_at`；其合并启发式规则被移除。
- tracer 与 playground 读取并渲染新的内容项类型；playground 按 `.delta` 项与 `stop` 事件进行流式展示。
- 新增测试辅助函数 `assert_stream_grammar` / `assertStreamGrammar`；共享 e2e 测试用它们检查每个模型的流，并从 `tool_call.done` 读取工具调用。
- README、`skills/agenthub-python` 与 `skills/agenthub-typescript` 参考文档、示例以及开发 skill 均按新协议重写。

## 客户端 part

- `transform_model_output_to_uni_event` / `transformModelOutputToUniEvent` 被 `transform_model_output_to_client_parts` / `transformModelOutputToClientParts` 取代，后者返回 `ClientPart` 列表；`_streaming_response_internal` / `_streamingResponseInternal` 改为产出这些 part 而不是事件。part 分为 `delta`（服务商为该内容项给出的 key 之下的一个 `.delta` 项）、`done`（某个 key 下的内容项已完成）与 `finish`（`usage_metadata` 和/或 `finish_reason`）。没有任何通用内容的线路事件返回 `[]`。
- 基类把 part 组装成事件：拼接片段、解析工具调用参数、逐字段合并分段到达的用量、在服务商的流结束时关闭仍未完成的内容项，并构造 `stop` 事件。各客户端中的工具调用累加器、参数解析、用量合并与合成 stop 的逻辑被移除，基类中针对 `unused` 事件的防护也一并移除。
- key：`claude5` 与 `ant_messages` 使用 content block 的 index；`gpt6`、`openai_responses`、`deepseek_v4` 与 `minimax_m3` 使用输出 item 的 id；`openai_chat`、`openai_chat_vllm_adapter`、`glm5_3` 与 `kimi_k3` 使用序号，流式输出的种类变化或新的工具调用开始时序号递增，同时关闭前一个内容项；`gemini3_8` 使用 step 的 index 加上该 step 内同一内容种类连续段的序号（`<index>.<run>`）；`openai_embedding` 与 `gemini3_8` 的 embedding 使用 `embedding:<i>`。
- fidelity 只附加一次，附在它完整可知的那个增量上：Claude 的 signature 附在一个空的 `thinking.delta` 上，Responses 的推理 fidelity 附在 `response.output_item.done` 时的一个空 `thinking.delta` 上，GPT 的 `phase` 附在 `response.output_item.added` 时的一个空 `text.delta` 上。Chat Completions 客户端给每个推理增量附加的 `reasoning_field` 只输出一次。

## 兼容性

- 流的消费方：只按 `event_type` 的 `delta` / `stop` 分支；从 `stop` 事件读取 `usage_metadata` 与 `finish_reason`，不再跨事件取最新值；从 `.done` 类型读取完整内容项（用 `tool_call.done` 代替 `tool_call`，用 `text.done` 代替累加 `text`），从 `.delta` 类型读取实时片段（用 `tool_call.delta` 代替 `partial_tool_call`）；每个片段都归属于当前正在流式输出的内容项，不再按 `item_id` 归属。
- 只有思考内容的响应不再在 `EmptyResponseError` 之前产出携带用量的事件；请从该异常的 `usage_metadata` / `usageMetadata` 读取用量。
- 构造消息的代码：改用 `.done` 类型（`text.done`、`image_url.done`、`tool_result.done` 等）。使用旧类型的消息在 0.6.0 之前仍可使用，但会给出弃用警告——见[接受 0.5.0 之前记录的内容项](2026-09-16-backward-compatibility.zh.md)。
- 类型导入：`TextContentItem` → `TextDoneItem`，`ImageContentItem` → `ImageUrlDoneItem`，`ToolCallContentItem` → `ToolCallDoneItem`，其余内容项依此类推；`PartialContentItem` → `EventContentItem`。
