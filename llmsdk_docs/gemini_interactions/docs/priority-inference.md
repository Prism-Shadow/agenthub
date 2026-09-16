> Source: https://ai.google.dev/gemini-api/docs/priority-inference (snapshot 2026-09-16)

<br />

Description: Learn how to optimize latency with the Priority inference tier in the Interactions API

<br />


> [!WARNING]
> **Preview:** The Gemini Priority API is in [Preview](https://cloud.google.com/products#product-launch-stages).

The Gemini Priority API is a premium inference tier designed for
business-critical workloads that require lower latency and the highest
reliability at a premium price point. Priority tier traffic is prioritized above
standard API and Flex tier traffic.

Priority inference is available across the Interactions API endpoints.

## How to use Priority

To use the Priority tier, set the `service_tier` field in your request to `priority`. The default tier is standard if the field is omitted.

### Python

    from google import genai

    client = genai.Client()

    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input="Triage this critical customer support ticket immediately.",
        service_tier='priority'
    )
    print(interaction.output_text)

### JavaScript

    import { GoogleGenAI } from '@google/genai';

    const ai = new GoogleGenAI({});

    async function main() {
        const interaction = await ai.interactions.create({
            model: "gemini-3.8-flash",
            input: "Triage this critical customer support ticket immediately.",
            service_tier: "priority"
        });
        console.log(interaction.output_text);
    }

    await main();

### REST

    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
      -H "Content-Type: application/json" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
      -d '{
        "model": "gemini-3.8-flash",
        "input": "Triage this critical customer support ticket immediately.",
        "service_tier": "priority"
      }'

## How Priority inference works

Priority inference routes requests to high-criticality compute queues, offering
predictable, fast performance for user-facing applications. Its primary
mechanism is a graceful server-side downgrade to standard processing for traffic
that exceeds dynamic limits, ensuring application stability instead of failing
the request.

| Feature | Priority | Standard | Flex | Batch |
|---|---|---|---|---|
| **Pricing** | 75-100% more than Standard | Full price | 50% discount | 50% discount |
| **Latency** | Seconds | Seconds to minutes | Minutes (1--15 min target) | Up to 24 hours |
| **Reliability** | High (Non-sheddable) | High / Medium-high | Best-effort (Sheddable) | High (for throughput) |
| **Interface** | Synchronous | Synchronous | Synchronous | Asynchronous |

### Key benefits

- **Low latency**: Designed for second response times for interactive, user-facing AI tools.
- **High reliability**: Traffic is treated with the highest criticality and is strictly non-sheddable.
- **Graceful degradation**: Traffic spikes exceeding dynamic limits are automatically downgraded to the Standard tier for processing instead of failing, preventing service outages.
- **Low friction** : Uses the same synchronous `create` method as the standard and Flex tiers.

### Use cases

Priority processing is ideal for business-critical workflows where performance
and reliability are paramount.

- **Interactive AI applications**: Customer service chatbots and copilots where users pay a premium and expect fast, consistent responses.
- **Real-time decision engines**: Systems requiring highly reliable, low-latency outcomes, such as live ticket triaging or fraud detection.
- **Premium customer features**: Developers who need to guarantee higher service level objectives (SLOs) for paying customers.

### Rate limits

Priority consumption holds its own rate limits even though consumption is
counted towards [overall interactive traffic rate limits](https://aistudio.google.com/rate-limit). The default rate limits
for Priority inference are **0.3x standard rate limit for Model / Tier**

### Graceful downgrade logic

If Priority limits are exceeded due to congestion, overflow requests are
**automatically and gracefully** downgraded to Standard processing instead of
failing with a 503 or 429 error. Downgraded requests are billed at the standard
rate, not the Priority premium rate.

### Client responsibility

- **Response monitoring** : Developers should monitor the `x-gemini-service-tier` header in the API response to detect if requests are being frequently downgraded to `standard`.
- **Retries** : Clients must implement retry logic/exponential backoff for standard errors, such as `DEADLINE_EXCEEDED`.

## Pricing

Priority inference is priced at 75-100% more than the [standard API](https://ai.google.dev/gemini-api/docs/pricing) and billed per token.

## Supported models

The following models support Priority inference:

| Model | Priority inference |
|---|---|
| [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) | ✔️ |
| [Gemini 3.7 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash) | ✔️ |
| [Gemini 3.6 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash) | ✔️ |
| [Gemini 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) | ✔️ |
| [Gemini 3.5 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash) | ✔️ |
| [Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite) | ✔️ |
| [Gemini 3.1 Pro Preview](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview) | ✔️ |
| [Gemini 3 Flash Preview](https://ai.google.dev/gemini-api/docs/models/gemini-3-flash-preview) | ✔️ |
| [Gemini 2.5 Pro](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro) | ✔️ |
| [Gemini 2.5 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash) | ✔️ |
| [Gemini 2.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite) | ✔️ |

## What's next

- [Flex inference](https://ai.google.dev/gemini-api/docs/flex-inference) for cost reduction.
- [Tokens](https://ai.google.dev/gemini-api/docs/tokens): Understand tokens.
