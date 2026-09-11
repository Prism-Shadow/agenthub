# Send a tool result's images in the following user message on every Chat Completions endpoint

- **Date:** 2026-09-10
- **Type:** fix
- **Scope:** `openai_chat`, `kimi_k3`

[中文版](2026-09-10-tool-result-images-user-message.zh.md)

## What changed

- `openai-chat` and `kimi-k3` sent the images of a tool result inside the `tool` message as
  `image_url` parts on every endpoint but SiliconFlow. A Chat Completions tool message holds
  text only, so a server that validates the schema refused the whole request with
  `400 Failed to deserialize the JSON body into the target type: data did not match any variant of untagged enum ChatCompletionRequestToolMessageContent`,
  and reading an image with a tool ended the turn on such a gateway.
- Both clients now put the image parts in the user message that follows the turn's tool
  messages, on every endpoint. SiliconFlow already took this placement as a special case;
  the special case is gone.
- `openai-chat` therefore sends every tool result as a plain string, the text-only form
  [0.4.11 introduced](../0.4.11/2026-09-09-tool-result-text-form.md); `kimi-k3` keeps its
  one-part text list.
- `openai-chat-vllm-adapter` inherits the transform and follows the same rule.
- The offline image-detail test reads the tool result's images from the trailing user
  message and covers `kimi-k3` next to `openai-chat`.

## Wire shape

A tool result carrying an image, `{"type": "tool_result", "text": "image/png", "images": ["data:…"], "tool_call_id": "call_1"}`, goes out as two messages:

```json
{"role": "tool", "tool_call_id": "call_1", "content": "image/png"}
{"role": "user", "content": [{"type": "image_url", "image_url": {"url": "data:…"}}]}
```
