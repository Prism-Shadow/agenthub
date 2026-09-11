# 在所有 Chat Completions 端点上，工具结果的图片改由其后的 user 消息携带

- **Date:** 2026-09-10
- **Type:** fix
- **Scope:** `openai_chat`, `kimi_k3`, `glm5_3`
- **PR:** [#209](https://github.com/Prism-Shadow/agenthub/pull/209)

[English](2026-09-10-tool-result-images-user-message.md)

## 变更内容

- `openai-chat` 与 `kimi-k3` 此前在除 SiliconFlow 之外的所有端点上，都把工具结果的图片作为
  `image_url` 部件放进 `tool` 消息；`glm-5.3` 对唯一能读图的 GLM id `glm-5.3-flash` 也是如此。
  Chat Completions 的 tool 消息只容纳文本，校验 schema 的服务端
  因此拒绝整个请求：
  `400 Failed to deserialize the JSON body into the target type: data did not match any variant of untagged enum ChatCompletionRequestToolMessageContent`，
  经此类网关用工具读图会直接终止该轮。
- 三个 client 现在在所有端点上都把图片部件放进本轮 tool 消息之后的 user 消息。SiliconFlow 此前
  已作为特例采用这一位置，该特例随之移除。
- 因此每条工具结果都以纯字符串发送：`openai-chat` 沿用
  [0.4.11 引入](../0.4.11/2026-09-09-tool-result-text-form.zh.md)的纯文本形态，`kimi-k3` 放弃
  单部件文本列表，改为 Moonshot 官方示例所用的字符串，`glm-5.3` 原本就发字符串。
- `openai-chat-vllm-adapter` 继承该消息转换，遵循同一规则。
- 离线的 image-detail 测试改从末尾的 user 消息读取工具结果的图片，并在 `openai-chat` 之外覆盖
  `kimi-k3` 与 `glm-5.3-flash`。

## 线上形状

带图片的工具结果 `{"type": "tool_result", "text": "image/png", "images": ["data:…"], "tool_call_id": "call_1"}` 以两条消息发出：

```json
{"role": "tool", "tool_call_id": "call_1", "content": "image/png"}
{"role": "user", "content": [{"type": "image_url", "image_url": {"url": "data:…"}}]}
```
