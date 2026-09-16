> Source: https://ai.google.dev/gemini-api/docs/thinking (snapshot 2026-09-16)
>
> Java samples removed.

The [Gemini 3 and 2.5 series models](https://ai.google.dev/gemini-api/docs/models) use a
"thinking process" that significantly improves their reasoning and multi-step
planning abilities, making them highly effective for complex tasks such as
coding, advanced mathematics, and data analysis.

When you use a thinking model, Gemini reasons internally before responding. The Interactions API surfaces this reasoning via `thought` steps, dedicated steps that appear chronologically alongside function calls, user inputs or model outputs in the `steps` array.

Every thought step contains two fields:

| Field | Required | Description |
|---|---|---|
| `signature` | ✅ Yes | An encrypted representation of the model's internal reasoning state. Always present, even when the model performs minimal reasoning. |
| `summary` | ❌ No | An array of content (text and/or images) summarizing the reasoning. May be empty depending on the [`thinking_summaries`](https://ai.google.dev/api/interactions-api) config, whether the model performed enough reasoning, or the content type (for example, image latents may not have text summaries). |

> [!NOTE]
> **Note:** The Interactions API handles thoughts and signatures differently than the `generateContent` API: - In the `generateContent` API, there are no dedicated thought blocks. Because of this, signatures are metadata that can be attached to any part, such as living inside `functionCall` parts or the final part of a response. - In the Interactions API, thoughts are a first-class representation as dedicated `thought` steps. Because of this signatures are limited exclusively to two known locations, `thought` steps, or built-in tool steps (like `google_search_call`/ `google_search_result`). They never appear on user inputs, model outputs, or standard function calls.

## Interactions with thinking

Initiating an interaction with a thinking model is similar to any other interaction request. Specify one of the [models with thinking support](https://ai.google.dev/gemini-api/docs/thinking#thinking-levels) in the `model` field:

### Python

    from google import genai

    client = genai.Client()

    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input="Explain the concept of Occam's Razor and provide a simple, everyday example."
    )
    print(interaction.output_text)

### JavaScript

    import { GoogleGenAI } from "@google/genai";

    const client = new GoogleGenAI({});

    const interaction = await client.interactions.create({
        model: "gemini-3.8-flash",
        input: "Explain the concept of Occam's Razor and provide a simple, everyday example."
    });
    console.log(interaction.output_text);

### REST

    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
      -H 'Content-Type: application/json' \
      -d '{
        "model": "gemini-3.8-flash",
        "input": "Explain the concept of Occam'\''s Razor and provide a simple example."
      }'

## Thought summaries

Thought summaries provide insights into the model's internal reasoning process.
By default, only the final output is returned. You can enable thought summaries
with `thinking_summaries`:

### Python

    from google import genai

    client = genai.Client()

    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input="What is the sum of the first 50 prime numbers?",
        generation_config={
            "thinking_summaries": "auto"
        }
    )

    for step in interaction.steps:
        if step.type == "thought":
            print("Thought summary:")
            if step.summary:
                for content_block in step.summary:
                    if content_block.type == "text":
                        print(content_block.text)
            print()
        elif step.type == "model_output":
            for content_block in step.content:
                if content_block.type == "text":
                    print("Answer:")
                    print(content_block.text)
                    print()

### JavaScript

    import { GoogleGenAI } from "@google/genai";

    const client = new GoogleGenAI({});

    const interaction = await client.interactions.create({
        model: "gemini-3.8-flash",
        input: "What is the sum of the first 50 prime numbers?",
        generation_config: {
            thinking_summaries: "auto"
        }
    });

    for (const step of interaction.steps) {
        if (step.type === "thought") {
            console.log("Thought summary:");
            if (step.summary) {
                for (const contentBlock of step.summary) {
                    if (contentBlock.type === "text") console.log(contentBlock.text);
                }
            }
        } else if (step.type === "model_output") {
            for (const contentBlock of step.content) {
                if (contentBlock.type === "text") {
                    console.log("Answer:");
                    console.log(contentBlock.text);
                }
            }
        }
    }

### REST

    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
      -H 'Content-Type: application/json' \
      -d '{
        "model": "gemini-3.8-flash",
        "input": "What is the sum of the first 50 prime numbers?",
        "generation_config": {
          "thinking_summaries": "auto"
        }
      }'

A thought block may contain **only a signature with no summary** in these cases:

- Simple requests, where the model didn't reason enough to generate a summary
- `thinking_summaries: "none"`, where summaries are explicitly disabled
- Certain thought content types, such as images, may not have text summaries

Your code should always handle thought blocks where `summary` is empty or absent.

## Streaming with thinking

Use streaming to receive incremental thought summaries during generation.
Thought blocks are delivered using Server-Sent Events (SSE) with two distinct
delta types:

| Delta type | Contains | When sent |
|---|---|---|
| `thought_summary` | Text or image summary content | One or more deltas with incremental summary |
| `thought_signature` | The cryptographic signature | the last delta before `step.stop` |

### Python

    from google import genai

    client = genai.Client()

    prompt = """
    Alice, Bob, and Carol each live in a different house on the same street: red, green, and blue.
    Alice does not live in the red house.
    Bob does not live in the green house.
    Carol does not live in the red or green house.
    Which house does each person live in?
    """

    thoughts = ""
    answer = ""

    stream = client.interactions.create(
        model="gemini-3.8-flash",
        input=prompt,
        generation_config={
            "thinking_summaries": "auto"
        },
        stream=True
    )

    for event in stream:
        if event.event_type == "step.delta":
            if event.delta.type == "thought_summary":
                if not thoughts:
                    print("Thinking...")
                summary_text = event.delta.content.text
                print(f"[Thought] {summary_text}", end="")
                thoughts += summary_text
            elif event.delta.type == "text" and event.delta.text:
                if not answer:
                    print("\nAnswer:")
                print(event.delta.text, end="")
                answer += event.delta.text

### JavaScript

    import { GoogleGenAI } from "@google/genai";

    const client = new GoogleGenAI({});

    const prompt = `Alice, Bob, and Carol each live in a different house on the same
    street: red, green, and blue. Alice does not live in the red house.
    Bob does not live in the green house.
    Carol does not live in the red or green house.
    Which house does each person live in?`;

    let thoughts = "";
    let answer = "";

    const stream = await client.interactions.create({
        model: "gemini-3.8-flash",
        input: prompt,
        generation_config: {
            thinking_summaries: "auto"
        },
        stream: true
    });

    for await (const event of stream) {
        if (event.event_type === "step.delta") {
            if (event.delta.type === "thought_summary") {
                if (!thoughts) console.log("Thinking...");
                const text = event.delta.content?.text || "";
                process.stdout.write(`[Thought] ${text}`);
                thoughts += text;
            } else if (event.delta.type === "text" && event.delta.text) {
                if (!answer) console.log("\nAnswer:");
                process.stdout.write(event.delta.text);
                answer += event.delta.text;
            }
        }
    }

### REST

    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
      -H 'Content-Type: application/json' \
      --no-buffer \
      -d '{
        "model": "gemini-3.8-flash",
        "input": "Alice, Bob, and Carol each live in a different house on the same street: red, green, and blue. Alice does not live in the red house. Bob does not live in the green house. Carol does not live in the red or green house. Which house does each person live in?",
        "generation_config": {
          "thinking_summaries": "auto"
        },
        "stream": true
      }'

The streaming response uses Server-Sent Events (SSE) and is composed of steps
and events, for example:

    event: interaction.created
    data: {"interaction":{"id":"v1_xxx","status":"in_progress","object":"interaction","model":"gemini-3.8-flash"},"event_type":"interaction.created"}

    event: step.start
    data: {"index":0,"step":{"signature":"","summary":[{"text":"**Evaluating the clues**\n\nI'm considering...","type":"text"}],"type":"thought"},"event_type":"step.start"}

    event: step.delta
    data: {"index":0,"delta":{"signature":"EpoGCpcGAXLI2nx/...","type":"thought_signature"},"event_type":"step.delta"}

    event: step.stop
    data: {"index":0,"event_type":"step.stop"}

    event: step.start
    data: {"index":1,"step":{"content":[{"text":"Based on the clues provided, here","type":"text"}],"type":"model_output"},"event_type":"step.start"}

    event: step.delta
    data: {"index":1,"delta":{"text":" is the answer to your question...","type":"text"},"event_type":"step.delta"}

    event: step.stop
    data: {"index":1,"event_type":"step.stop"}

    event: interaction.completed
    data: {"interaction":{"id":"v1_xxx","status":"completed","usage":{"total_tokens":530,"total_input_tokens":62,"total_output_tokens":171,"total_thought_tokens":297}},"event_type":"interaction.completed"}

    event: done
    data: [DONE]

## Controlling thinking

Gemini models engage in dynamic thinking by default, automatically adjusting
the amount of reasoning effort based on the complexity of the request. You can control this behavior using the `thinking_level` parameter.

| Model | Default Thinking | Levels Supported |
|---|---|---|
| gemini-3.8-flash | On (medium) | low, medium, high |
| gemini-3.7-flash | On (medium) | low, medium, high |
| gemini-3.6-flash | On (medium) | minimal, low, medium, high |
| gemini-3.5-flash-lite | On (minimal) | minimal, low, medium, high |
| gemini-3.1-pro-preview | On (high) | low, medium, high |
| gemini-3.1-flash-lite-image | On (minimal) | minimal, high |
| gemini-3-flash-preview | On (high) | minimal, low, medium, high |
| gemini-3-pro-preview | On (high) | low, high |
| gemini-3.5-flash | On (medium) | minimal, low, medium, high |
| gemini-2.5-pro | On | low, medium, high |
| gemini-2.5-flash | On | low, medium, high |
| gemini-2.5-flash-lite | Off | low, medium, high |

### Python

    from google import genai

    client = genai.Client()

    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input="Provide a list of 3 famous physicists and their key contributions",
        generation_config={
            "thinking_level": "low"
        }
    )
    print(interaction.output_text)

### JavaScript

    import { GoogleGenAI } from "@google/genai";

    const client = new GoogleGenAI({});

    const interaction = await client.interactions.create({
        model: "gemini-3.8-flash",
        input: "Provide a list of 3 famous physicists and their key contributions",
        generation_config: {
            thinking_level: "low"
        }
    });
    console.log(interaction.output_text);

### REST

    curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
      -H 'Content-Type: application/json' \
      -d '{
        "model": "gemini-3.8-flash",
        "input": "Provide a list of 3 famous physicists and their key contributions",
        "generation_config": {
          "thinking_level": "low"
        }
      }'

### Token limits and `max_output_tokens`

The [`max_output_tokens`](https://ai.google.dev/api/interactions-api#request-body) generation
parameter sets the maximum number of tokens a response can generate, including
thought tokens.

When set, this parameter acts as a hard cutoff enforced by the infrastructure
without changing how the model allocates its thinking budget
(`thinking_level`).

If the model hits this limit while reasoning, it stops generating with status
`"incomplete"` and returns truncated or empty output (while still billing for
any thinking tokens generated). To reduce cost or latency without truncating
responses, lower `thinking_level` (`low` or `medium`) instead of setting a
small `max_output_tokens`.

## Thought signatures

Thought signatures are encrypted representations of the model's internal reasoning. They are required to maintain reasoning continuity across multi-turn interactions.

The Interactions API makes handling thought signatures much simpler than the `generateContent` API.

### Stateful mode (Recommended)

By default, when you use the Interactions API in stateful mode (by setting `store: true` and passing the `previous_interaction_id` in subsequent turns), the server automatically manages the conversation state, including all thought blocks and signatures. In this mode, you do not need to do anything regarding signatures. They are handled entirely on the server side.

### Stateless mode

If you are managing the conversation state yourself (stateless mode) and passing the full history of inputs and outputs in each request:

- You **MUST** always resend all `thought` blocks exactly as they were received from the model.
- You should **NOT** remove or modify thought blocks from the history, as they contain the signatures required for the model to continue its reasoning.
- When switching models within a session, you should still resend the previous model's thought blocks. The backend manages compatibility.

> [!NOTE]
> **Note:** Built-in tools such as Google Search can carry their own distinct signatures on the call/result blocks. In stateless mode, you must also resend these tool result signatures in subsequent turns.

## Pricing

When thinking is turned on, response pricing is the sum of output
tokens and thinking tokens. You can get the total number of generated thinking
tokens from the `total_thought_tokens` field.

### Python

    print("Thoughts tokens:", interaction.usage.total_thought_tokens)
    print("Output tokens:", interaction.usage.total_output_tokens)

### JavaScript

    console.log(`Thoughts tokens: ${interaction.usage.total_thought_tokens}`);
    console.log(`Output tokens: ${interaction.usage.total_output_tokens}`);

## Best practices

Use thinking models efficiently by following these guidelines.

- **Review reasoning**: Analyze thought summaries to understand failures and improve prompts.
- **Control thinking budget**: Prompt the model to think less for lengthy outputs to save tokens.
- **Simple tasks**: Use minimal or low thinking for fact retrieval or classification (e.g., "Where was DeepMind founded?").
- **Moderate tasks**: Use default thinking for comparing concepts or creative reasoning (e.g., Compare electric and hybrid cars).
- **Complex tasks**: Use maximum thinking for advanced coding, math, or multi-step planning (e.g., Solve AIME math problems).

## What's next

- [Text generation](https://ai.google.dev/gemini-api/docs/text-generation): Basic text responses
- [Function calling](https://ai.google.dev/gemini-api/docs/function-calling): Connect to tools
- [Gemini 3 guide](https://ai.google.dev/gemini-api/docs/gemini-3): Model-specific features
