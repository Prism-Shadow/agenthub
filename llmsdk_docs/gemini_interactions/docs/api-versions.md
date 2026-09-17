> Source: https://ai.google.dev/gemini-api/docs/api-versions (snapshot 2026-09-16)
>
> Java samples removed.

This document provides a high-level overview of the differences between the `v1`
and `v1beta` versions of the Gemini API.

- **v1** : Stable version of the API. Features in the stable version are fully supported over the lifetime of the major version. If there are any breaking changes, a new major version of the API will be created and the existing version will be deprecated after a reasonable period of time. Non-breaking changes may be introduced to the API without changing the major version. The **Interactions API** and its core features are generally available in `v1`.
- **v1beta** : This version includes early features and capabilities that are actively being developed. While features in `v1beta` may be subject to changes as we refine them based on feedback, it lets you try new capabilities before they are promoted to stable.

## Capability and feature support

The following table details the availability of capabilities across `v1` (GA)
and `v1beta` (Beta). Core API capabilities and tools apply to both
the Interactions API and `generateContent` unless specified otherwise:

> [!NOTE]
> **Note:** All models are supported in both `v1` and `v1beta`. This table tracks the availability of features across the `v1` and `v1beta` **API versions** (endpoint routes and schema parameters).

| Feature | v1 | v1beta |
|---|---|---|
| **Core API capabilities** |   |   |
| [Interactions API](https://ai.google.dev/gemini-api/docs/get-started) | Yes | Yes |
| [Function Calling](https://ai.google.dev/gemini-api/docs/function-calling) | Yes | Yes |
| [Structured Output](https://ai.google.dev/gemini-api/docs/structured-output) | Yes | Yes |
| [Thinking / Reasoning](https://ai.google.dev/gemini-api/docs/thinking) | Yes | Yes |
| [System Instructions](https://ai.google.dev/gemini-api/docs/system-instructions) | Yes | Yes |
| [Audio Output (Speech Config)](https://ai.google.dev/gemini-api/docs/audio) |   | Yes |
| [Service Tier (Priority / Flex)](https://ai.google.dev/gemini-api/docs/priority-inference) |   | Yes |
| **Tools** |   |   |
| [Code Execution Tool](https://ai.google.dev/gemini-api/docs/code-execution) | Yes | Yes |
| [Google Search Grounding](https://ai.google.dev/gemini-api/docs/google-search) | Yes | Yes |
| [Google Maps Grounding](https://ai.google.dev/gemini-api/docs/maps-grounding) | Yes | Yes |
| [URL Context Tool](https://ai.google.dev/gemini-api/docs/url-context) | Yes | Yes |
| [File Search Tool](https://ai.google.dev/gemini-api/docs/file-search) | Yes | Yes |
| [Computer Use Tool](https://ai.google.dev/gemini-api/docs/computer-use) |   | Yes |
| [MCP Servers Tool](https://ai.google.dev/gemini-api/docs/function-calling#mcp) |   | Yes |
| **Realtime APIs** |   |   |
| [Live API (WebSockets)](https://ai.google.dev/gemini-api/docs/live-api) |   | Yes |
| [Live Music API](https://ai.google.dev/gemini-api/docs/realtime-music-generation) |   | Yes |
| [Ephemeral Tokens (Live API)](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens) |   | Yes |
| **Platform APIs** |   |   |
| [Models API](https://ai.google.dev/gemini-api/docs/models) | Yes | Yes |
| [Files Service Route](https://ai.google.dev/gemini-api/docs/files) | Yes | Yes |
| [File Search Stores Route](https://ai.google.dev/gemini-api/docs/file-search) | Yes | Yes |
| [Agents API](https://ai.google.dev/gemini-api/docs/agents) |   | Yes |
| [Webhooks API](https://ai.google.dev/gemini-api/docs/webhooks) |   | Yes |
| [Context Caching](https://ai.google.dev/gemini-api/docs/caching) |   | Yes |

- Yes - Supported

## Configure API version in an SDK

The Gemini API SDKs default to `v1beta`, but you can explicitly specify versions
by setting the API version as shown in the following code sample:

> [!NOTE]
> **Note:** The GenAI SDKs use \`v1beta\` by default to enable access to preview features. You can configure the SDK to use the stable \`v1\` version (as shown below) which also supports the Interactions API.

### Python

    from google import genai

    client = genai.Client(http_options={'api_version': 'v1'})

    interaction = client.interactions.create(
        model='gemini-3.8-flash',
        input="Explain how AI works",
    )

    print(interaction.output_text)

### JavaScript

    import { GoogleGenAI } from "@google/genai";

    const ai = new GoogleGenAI({
      httpOptions: { apiVersion: "v1" },
    });

    async function main() {
      const interaction = await ai.interactions.create({
        model: "gemini-3.8-flash",
        input: "Explain how AI works",
      });
      console.log(interaction.output_text);
    }

    await main();

### REST

    curl -X POST "https://generativelanguage.googleapis.com/v1/interactions" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
      -H 'Content-Type: application/json' \
      -d '{
        "model": "gemini-3.8-flash",
        "input": "Explain how AI works",
      }'
