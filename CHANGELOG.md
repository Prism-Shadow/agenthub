# Changelog

[中文版](CHANGELOG.zh.md)

Here, we record the addition and removal times of models, major functional updates, bug fixes, and release times of key versions. Each release keeps one brief line here; the per-entry summaries live in `changelog/<version>/README.md`, and every entry links its detail file.

- [2026-09-12] [Version 0.4.14](changelog/0.4.14/README.md): the first-party DeepSeek V4 and GPT Responses clients send a text-only tool result as a plain string, so a strictly validating DeepSeek Responses endpoint no longer rejects every request after a tool call with `400 invalid_json`.

- [2026-09-12] [Version 0.4.13](changelog/0.4.13/README.md): the OpenAI Chat client replays a tool-calling assistant turn with its reasoning field present even when the model produced no chain of thought, so a DeepSeek tool chain reached through an endpoint that reissues tool_call ids is no longer rejected part-way through.

- [2026-09-11] [Version 0.4.12](changelog/0.4.12/README.md): the OpenAI Chat, Kimi K3 and GLM clients send a tool result's images in the user message that follows the tool messages, so an image read by a tool works behind a gateway that validates the Chat Completions schema, and every tool result on those clients goes out as a plain string.

- [2026-09-09] [Version 0.4.11](changelog/0.4.11/README.md): GPT-6 Astra joins the registry and the shared GPT client is renamed `gpt6` for it, with `none` thinking clamping to `low` on GPT-6; the DeepSeek V4 Flash rows move to the price effective 2026-09-10, DeepSeek images are gated by a text-only deny-list instead of the "vision" substring, and `deepseek-v4.1-flash` is pre-registered; and the generic OpenAI Chat and Responses clients send a text-only tool result as a plain string.

- [2026-09-04] [Version 0.4.10](changelog/0.4.10/README.md): Gemini 3.8 Flash joins the registry and the shared Gemini client is renamed for it, the Gemini 2 series is dropped, registry rows record the list price with no discount field, every thinking level and thinking summary value stays on the wire, and a vLLM adapter client maps the thinking level onto whatever switch each served model's own chat template reads.

- [2026-09-02] [Version 0.4.9](changelog/0.4.9/README.md): GPT-5.6 reads an image over the 30,000-patch limit at high detail instead of rejecting it, in a prompt and in a tool result, on the GPT-5.6, OpenAI Responses and OpenAI Chat clients.

- [2026-08-26] [Version 0.4.8](changelog/0.4.8/README.md): `glm-5.3-flash` joins the registry and reads images in a prompt and in a tool result, while every other GLM model refuses an image item instead of sending one.

- [2026-08-25] [Version 0.4.7](changelog/0.4.7/README.md): the Gemini client splits function responses into their own contents, fixing the Vertex AI 400 `Requests ending with a model turn are not supported.` on messages that mix a tool result with text — an interrupted turn's carry-over resent with the next prompt, or tool outputs folded into a summarization request.

- [2026-08-21] [Version 0.4.6](changelog/0.4.6/README.md): `deepseek-v4-flash-vision-exp` joins the registry and reads images in a prompt and in a tool result, the DeepSeek client moves onto the OpenAI Responses protocol, every Responses client replays content items in the order the model produced them, an internal `unused` event never reaches a caller, and the playground plays a spoken answer as one clip and keeps its configuration across a reload.

- [2026-08-20] [Version 0.4.5](changelog/0.4.5/README.md): streaming clients skip output they do not recognize unless `AGENTHUB_DEBUG` is set, `AutoLLMClient` lists the model ids an endpoint serves, every client accepts default headers for endpoints that demand their own, GLM-5.3 and `claude-opus-5` join the registry, and the OpenRouter entries move to the `openai-responses` client.

- [2026-08-19] [Version 0.4.4](changelog/0.4.4/README.md): thinking levels gain a `MAX` tier above `XHIGH`, and each client maps the ladder onto its vendor's effort vocabulary (DeepSeek re-mapped to its current low/high/max values).

- [2026-08-18] [Version 0.4.3](changelog/0.4.3/README.md): every streaming client skips the heartbeat events gateways inject on long generations, across the OpenAI Responses, OpenAI Chat Completions, Anthropic Messages, and Gemini protocols.

- [2026-08-18] [Version 0.4.2](changelog/0.4.2/README.md): generic OpenAI Responses and Anthropic Messages protocol clients covering OpenAI, OpenRouter, DeepSeek, Z.AI, and MiniMax (the generic chat client renames to `openai-chat`), GPT-5.6 support, `UniConfig.fast_mode`, and the Claude and Kimi series clients unified with family-wide `temperature` rejection.

- [2026-07-22] [Version 0.4.1](changelog/0.4.1/README.md): Kimi K3, the Gemini 3.6 generation (gemini-3.6-flash, gemini-3.5-flash-lite), and GLM-5.2 support, a supported-model registry with USD/CNY pricing, context windows, and modalities, and the `UnsupportedParameterError` parameter error class.

- [2026-07-20] [Version 0.4.0](changelog/0.4.0/README.md): the `fidelity` content-item payload replaces `signature`/`phase` (breaking), OpenAI-compatible clients replay the exact upstream reasoning field, Claude 5 support, and hardened tool-call streaming.

- [2026-06-01] [Version 0.3.3](changelog/0.3.3/README.md): OpenAI-compatible embedding input format.

- [2026-05-30] [Version 0.3.2](changelog/0.3.2/README.md): Claude 4.8, a generic OpenAI Chat Completions-compatible client, abort support, agent skills, and a broad model refresh.

- [2026-04-28] [Version 0.3.1](changelog/0.3.1/README.md): Gemini TTS and image generation, GPT-5.5, the UModelVerse vendor, and automatic Claude caching.

- [2026-03-11] [Version 0.3.0](changelog/0.3.0/README.md): Claude 4.6 with adaptive thinking, GPT-5.4 with phase labels, Claude on Amazon Bedrock, and GLM-5.

- [2026-01-22] [Version 0.2.0](changelog/0.2.0/README.md): Gemini 3, Claude 4.5, GLM-4.7, GPT-5.2, and Qwen3 models, with prompt caching for Claude.
