# Gemini 3.8 SDK Documentation

This directory documents the Gemini 3.8 protocol generation, which starts with
`gemini-3.8-flash`. Content is snapshotted from the official documentation
(https://ai.google.dev/gemini-api/docs/latest-model).

The request/response wire format and the parameter contract are identical to the
Gemini 3.7 generation (see [../gemini3_7/](../gemini3_7/README.md)): sampling
parameters stay deprecated, model turn prefill stays disallowed, thinking is
configured with the `thinking_level` enum, and `minimal` thinking stays unsupported.
Nothing model-visible changed — `gemini-3.8-flash` is a newer build carrying the
same limits (1,048,576 in / 65,536 out), the same capability set, and the same
price table, launch discount included. Its model page is dated September 2026,
one month on from the 3.7 page.

## Documentation

- [latest-model.md](./docs/latest-model.md) - The generation overview and pricing
- [gemini-3.8-flash.md](./docs/gemini-3.8-flash.md) - Gemini 3.8 Flash model spec
- [thinking.md](./docs/thinking.md) - Thinking levels across Gemini 3.x models

For the SDK usage guides (function calling, streaming, thought signatures, TTS, image
generation, embeddings), refer to [../gemini3/docs/](../gemini3/README.md); they apply
unchanged to this generation.

On Vertex AI this generation is served through generateContent only; see
[Vertex AI](../gemini_interactions/README.md#vertex-ai-verified-2026-09-17) in the Interactions notes.
