> Source: https://ai.google.dev/gemini-api/docs/migrate-to-interactions (snapshot 2026-09-16)
>
> Java samples removed.

This guide helps you migrate from the `generateContent` API to the Interactions API.

The Interactions API is our simplest and best way to build with Gemini models and agents. While `generateContent` remains fully supported, we recommend the Interactions API for all new development.

> [!NOTE]
> **Automate this migration with a coding agent.** If you use
> a coding agent that supports skills (like Gemini CLI or Jules), install the
> [Gemini
> API development skill](https://ai.google.dev/gemini-api/docs/coding-agents#gemini-api-dev) and run:
>
> ```
> /gemini-api-dev migrate my app to the interactions api
> ```
>
> The skill applies the API changes described in this guide.

### Why migrate?

The Interactions API is our simplest and best way to build with Gemini models and agents:

- **Server-side history management** : Simplified multi-turn flows via `previous_interaction_id`. The server enables state by default (`store=true`), but you can opt into stateless behavior by setting `store=false`.
- **Observable execution steps**: Typed steps make it easy to debug complex flows and render UI for intermediate events (like thoughts or search widgets).
- **Tool use and agentic workflows**: Native support for multi-step tool use, orchestration, and complex reasoning flows through typed execution steps.
- **Long-running and background tasks** : Supports offloading time-intensive operations like Deep Think and Deep Research to background processes using `background=true`.

## Basic input/output

This section shows how to migrate a simple text generation request.

### Before (`generateContent`)

The `generateContent` API is stateless and returns the response directly. The response structure wraps the output in a list of `candidates`, each containing `content` with a list of `parts` to parse.

### Python

    from google import genai

    client = genai.Client()

    response = client.models.generate_content(
        model="gemini-2.5-flash-lite", contents="Tell me a joke."
    )
    print(response.text)

### JavaScript

    import { GoogleGenAI } from '@google/genai';

    const ai = new GoogleGenAI({});

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: "Tell me a joke.",
    });
    console.log(response.text);

### REST

    # Request
    curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent" \
    -H "Content-Type: application/json" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -d '{
        "contents": \[{
    "parts": \[{
    "text": "Tell me a joke."
    }\]
    }\]
    }'

    # Response
    {
      "candidates": \[
    {
    "content": {
    "parts": \[
    {
    "text": "Why did the chicken cross the road? To get to the other side!"
    }
    \],
    "role": "model"
    },
    "finishReason": "STOP",
    "index": 0
    }
    \],
      "usageMetadata": {
        "promptTokenCount": 4,
        "candidatesTokenCount": 12,
        "totalTokenCount": 16
      }
    }

The Interactions API returns a stored interaction resource with a `steps`
timeline. While you can inspect the `steps` array manually to find intermediate
events, the Google GenAI SDKs provide convenience properties
directly on the returned `Interaction` object to access the final output.

The most common convenience property is **`.output_text`** (String), which
automatically extracts and joins consecutive `TextContent` blocks at the
end of the model's response. While this works perfectly for simple responses,
it does not include earlier text blocks separated by non-text content (such
as thoughts, images, audio, or tool calls). For complex or interleaved
multimodal responses, you must manually iterate over `steps` instead.

> [!NOTE]
> **Note:** For details on other SDK convenience properties (including `.output_image` and `.output_audio`), see [Access outputs with SDK convenience properties](https://ai.google.dev/gemini-api/docs/interactions-overview#sdk-sugar) in the overview.

### Python

    from google import genai

    client = genai.Client()

    interaction = client.interactions.create(
        model="gemini-3.8-flash", input="Tell me a joke."
    )

    print(interaction.output_text)

### JavaScript

    import { GoogleGenAI } from '@google/genai';

    const client = new GoogleGenAI({});

    let interaction = await client.interactions.create({
        model: 'gemini-3.8-flash',
        input: 'Tell me a joke.'
    });

    console.log(interaction.output_text);

### REST

    # Request
    curl -X POST "https://generativelanguage.googleapis.com/v1beta2/interactions" \
    -H "Content-Type: application/json" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -d '{
        "model": "gemini-3.8-flash",
        "input": "Tell me a joke."
    }'

    # Response
    {
      "id": "int_123",
      "status": "completed",
      "steps": \[
    {
    "type": "user_input",
    "status": "done",
    "content": \[
    {
    "type": "text",
    "text": "Tell me a joke."
    }
    \]
    },
    {
    "type": "model_output",
    "status": "done",
    "content": \[
    {
    "type": "text",
    "text": "Why did the chicken cross the road?"
    }
    \]
    }
    \]
    }

## Multi-turn conversations

The Interactions API stores interactions by default, enabling server-side state management for multi-turn conversations.

### Before (`generateContent`)

In `generateContent`, you must manually manage conversation history using the `contents` array or a client-side chat helper.

### Python

**Using the chat helper (recommended)**

    from google import genai

    client = genai.Client()

    chat = client.chats.create(model="gemini-2.5-flash-lite")
    response1 = chat.send_message("Hi, my name is Phil.")
    print(response1.text)

    response2 = chat.send_message("What is my name?")
    print(response2.text)

**Manually managing history**

    from google import genai
    from google.genai import types

    client = genai.Client()

    response = client.models.generate_content(
        model="gemini-2.5-flash-lite",
        contents=[
            types.Content(
                role="user", parts=[types.Part.from_text(text="Hi, my name is Phil.")]
            ),
            types.Content(
                role="model",
                parts=[types.Part.from_text(text="Hi Phil, how can I help you?")],
            ),
            types.Content(
                role="user", parts=[types.Part.from_text(text="What is my name?")]
            ),
        ],
    )
    print(response.text)

### JavaScript

**Using the chat helper (recommended)**

    import { GoogleGenAI } from '@google/genai';

    const client = new GoogleGenAI({});

    const chat = client.chats.create({ model: 'gemini-2.5-flash-lite' });
    let response = await chat.sendMessage({ message: 'Hi, my name is Phil.' });
    console.log(response.text);

    response = await chat.sendMessage({ message: 'What is my name?' });
    console.log(response.text);

### REST

    # Request (the second turn requires sending the entire history)
    curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent" \
    -H "Content-Type: application/json" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -d '{
        "contents": \[
    {"role": "user", "parts": \[{"text": "Hi, my name is Phil."}\]},
    {"role": "model", "parts": \[{"text": "Hi Phil, how can I help you?"}\]},
    {"role": "user", "parts": \[{"text": "What is my name?"}\]}
    \]
    }'

    # Response
    {
      "candidates": \[
    {
    "content": {
    "parts": \[
    {
    "text": "Your name is Phil."
    }
    \],
    "role": "model"
    },
    "finishReason": "STOP",
    "index": 0
    }
    \]
    }

### After (Interactions API)

The Interactions API manages state on the server. You continue a conversation by referencing the `previous_interaction_id`.

### Python

    from google import genai

    client = genai.Client()

    interaction1 = client.interactions.create(
        model="gemini-3.8-flash", input="Hi, my name is Phil."
    )
    print("Response 1:", interaction1.output_text)

    interaction2 = client.interactions.create(
        model="gemini-3.8-flash",
        previous_interaction_id=interaction1.id,
        input="What is my name?",
    )
    print("Response 2:", interaction2.output_text)

### JavaScript

    import { GoogleGenAI } from '@google/genai';

    const client = new GoogleGenAI({});

    let interaction = await client.interactions.create({
        model: 'gemini-3.8-flash',
        input: 'Hi, my name is Phil.'
    });
    console.log("Response 1:", interaction.output_text);

    interaction = await client.interactions.create({
        model: 'gemini-3.8-flash',
        previous_interaction_id: interaction.id,
        input: 'What is my name?'
    });
    console.log("Response 2:", interaction.output_text);

### REST

    # First Request
    curl -X POST "https://generativelanguage.googleapis.com/v1beta2/interactions" \
    -H "Content-Type: application/json" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -d '{
        "model": "gemini-3.8-flash",
        "input": "Hi, my name is Phil."
    }'

    # Second Request (using ID from first response)
    curl -X POST "https://generativelanguage.googleapis.com/v1beta2/interactions" \
    -H "Content-Type: application/json" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -d '{
        "model": "gemini-3.8-flash",
        "previous_interaction_id": "int_123",
    "input": "What is my name?"
    }'

    # Response to Second Request
    {
      "id": "int_123",
      "steps": \[
    {
    "type": "user_input",
    "status": "done",
    "content": \[{ "type": "text", "text": "Hi, my name is Phil." }\]
    },
    {
    "type": "model_output",
    "status": "done",
    "content": \[{ "type": "text", "text": "Hello Phil! How can I help you today?" }\]
    },
    {
    "type": "user_input",
    "status": "done",
    "content": \[{ "type": "text", "text": "What is my name?" }\]
    },
    {
    "type": "model_output",
    "status": "done",
    "content": \[{ "type": "text", "text": "Your name is Phil." }\]
    }
    \]
    }

## Multimodal inputs

Both APIs support multimodal inputs (text, images, video, etc.).

### Before (`generateContent`)

In `generateContent`, you pass a list of `parts` within the `contents` array. The response returns output in the `parts` of the first candidate.

### Python

    from google import genai
    from google.genai import types

    client = genai.Client()

    with open("sample.jpg", "rb") as f:
        image_bytes = f.read()

    response = client.models.generate_content(
        model="gemini-2.5-flash-lite",
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
            "Describe this image.",
        ],
    )
    print(response.text)

### JavaScript

    import { GoogleGenAI } from '@google/genai';
    import * as fs from 'fs';

    const client = new GoogleGenAI({});

    const imageBytes = fs.readFileSync('sample.jpg').toString('base64');

    const response = await client.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: [
            {
                inlineData: {
                    data: imageBytes,
                    mimeType: 'image/jpeg',
                },
            },
            'Describe this image.',
        ],
    });
    console.log(response.text);

### REST

    # Request
    curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent" \
    -H "Content-Type: application/json" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -d '{
        "contents": \[{
    "parts": \[
    {
    "inlineData": {
    "mimeType": "image/jpeg",
    "data": "..."
    }
    },
    {
    "text": "Describe this image."
    }
    \]
    }\]
    }'

    # Response
    {
      "candidates": \[
    {
    "content": {
    "parts": \[
    {
    "text": "This is a picture of a beautiful sunset."
    }
    \],
    "role": "model"
    }
    }
    \]
    }

### After (Interactions API)

In the Interactions API, you pass an array to the `input` field. You retrieve output content by finding the `model_output` step in the timeline.

### Python

    import base64
    from google import genai

    client = genai.Client()

    with open("sample.jpg", "rb") as f:
        image_bytes = f.read()
    image_b64 = base64.b64encode(image_bytes).decode("utf-8")

    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input=[
            {
                "type": "image",
                "mime_type": "image/jpeg",
                "data": image_b64,
            },
            {"type": "text", "text": "Describe this image."},
        ],
    )
    print(interaction.output_text)

### JavaScript

    import { GoogleGenAI } from '@google/genai';
    import * as fs from 'fs';

    const client = new GoogleGenAI({});

    const imageBytes = fs.readFileSync('sample.jpg').toString('base64');

    const interaction = await client.interactions.create({
        model: 'gemini-3.8-flash',
        input: [
            {
                type: 'image',
                mime_type: 'image/jpeg',
                data: imageBytes
            },
            {
                type: 'text',
                text: 'Describe this image.'
            }
        ]
    });
    console.log(interaction.output_text);

### REST

    # Request
    curl -X POST "https://generativelanguage.googleapis.com/v1beta2/interactions" \
    -H "Content-Type: application/json" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -d '{
        "model": "gemini-3.8-flash",
        "input": \[
    {
    "type": "image",
    "mime_type": "image/jpeg",
    "data": "..."
    },
    {
    "type": "text",
    "text": "Describe this image."
    }
    \]
    }'

    # Response
    {
      "id": "int_multimodal",
      "steps": \[
    {
    "type": "user_input",
    "status": "done",
    "content": \[
    {
    "type": "image",
    "mime_type": "image/jpeg",
    "data": "..."
    },
    {
    "type": "text",
    "text": "Describe this image."
    }
    \]
    },
    {
    "type": "model_output",
    "status": "done",
    "content": \[
    {
    "type": "text",
    "text": "This is a picture of a beautiful sunset over the mountains."
    }
    \]
    }
    \]
    }

## Structured output

To make the model return JSON matching a specific schema, configure the response format.

### Before (`generateContent`)

In `generateContent`, you configure output format using the `response_mime_type` and `response_schema` fields nested inside the `config` (or `generationConfig`) object.

### Python

    from google import genai
    from google.genai import types
    from pydantic import BaseModel

    client = genai.Client()

    class Recipe(BaseModel):
        recipe_name: str
        ingredients: list[str]

    response = client.models.generate_content(
        model="gemini-2.5-flash-lite",
        contents="Give me a recipe for chocolate chip cookies.",
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=Recipe,
        ),
    )
    print(response.text)

### JavaScript

    import { GoogleGenAI, Type } from '@google/genai';

    const ai = new GoogleGenAI({});

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: 'Give me a recipe for chocolate chip cookies.',
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    recipe_name: { type: Type.STRING },
                    ingredients: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                    },
                },
                required: ['recipe_name', 'ingredients'],
            },
        },
    });
    console.log(response.text);

### REST

    # Request
    curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent" \
    -H "Content-Type: application/json" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -d '{
        "contents": \[{
    "parts": \[{
    "text": "Give me a recipe for chocolate chip cookies."
    }\]
    }\],
    "generationConfig": {
    "responseMimeType": "application/json",
    "responseSchema": {
    "type": "OBJECT",
    "properties": {
    "recipe_name": { "type": "STRING" },
    "ingredients": {
    "type": "ARRAY",
    "items": { "type": "STRING" }
    }
    },
    "required": \["recipe_name", "ingredients"\]
    }
    }
    }'

    # Response
    {
      "candidates": \[
    {
    "content": {
    "parts": \[
    {
    "text": "{\\n \\"recipe_name\\": \\"Chocolate Chip Cookies\\",\\n \\"ingredients\\": \[\\n \\"1 cup butter\\",\\n \\"1 cup sugar\\",\\n \\"2 cups flour\\",\\n \\"1 cup chocolate chips\\"\\n \]\\n}"
    }
    \],
    "role": "model"
    }
    }
    \]
    }

### After (Interactions API)

In the Interactions API, output format controls move to a top-level `response_format` array.

### Python

    from google import genai
    from pydantic import BaseModel

    client = genai.Client()

    class Recipe(BaseModel):
        recipe_name: str
        ingredients: list[str]

    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input="Give me a recipe for chocolate chip cookies.",
        response_format=[
            {
                "type": "text",
                "mime_type": "application/json",
                "schema": Recipe.model_json_schema(),
            }
        ],
    )

    print(interaction.output_text)

### JavaScript

    import { GoogleGenAI } from '@google/genai';

    const client = new GoogleGenAI({});

    const interaction = await client.interactions.create({
        model: 'gemini-3.8-flash',
        input: 'Give me a recipe for chocolate chip cookies.',
        response_format: [
            {
                type: 'text',
                mime_type: 'application/json',
                schema: {
                    type: 'object',
                    properties: {
                        recipe_name: { type: 'string' },
                        ingredients: {
                            type: 'array',
                            items: { type: 'string' }
                        }
                    },
                    required: ['recipe_name', 'ingredients']
                }
            }
        ]
    });
    console.log(interaction.output_text);

### REST

    # Request
    curl -X POST "https://generativelanguage.googleapis.com/v1beta2/interactions" \
    -H "Content-Type: application/json" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -d '{
        "model": "gemini-3.8-flash",
        "input": "Give me a recipe for chocolate chip cookies.",
    "response_format": \[
    {
    "type": "text",
    "mime_type": "application/json",
    "schema": {
    "type": "OBJECT",
    "properties": {
    "recipe_name": { "type": "STRING" },
    "ingredients": {
    "type": "ARRAY",
    "items": { "type": "STRING" }
    }
    },
    "required": \["recipe_name", "ingredients"\]
    }
    }
    \]
    }'

    # Response
    {
      "id": "int_structured",
      "steps": \[
    {
    "type": "user_input",
    "status": "done",
    "content": \[{ "type": "text", "text": "Give me a recipe for chocolate chip cookies." }\]
    },
    {
    "type": "model_output",
    "status": "done",
    "content": \[
    {
    "type": "text",
    "text": "{\\n \\"recipe_name\\": \\"Chocolate Chip Cookies\\",\\n \\"ingredients\\": \[\\n \\"1 cup butter\\",\\n \\"1 cup sugar\\",\\n \\"2 cups flour\\",\\n \\"1 cup chocolate chips\\"\\n \]\\n}"
    }
    \]
    }
    \]
    }

## Multimodal generation

When generating content in modalities beyond text (such as images or audio), the primary difference is how the response structures the generated media.

### Before (`generateContent`)

In `generateContent`, the response returns generated media directly in the `parts` of the candidate, typically as base64 data in `inlineData`.

    # Response structure concept
    {
      "candidates": \[
    {
    "content": {
    "parts": \[
    {
    "text": "Here is your generated image:"
    },
    {
    "inlineData": {
    "mimeType": "image/jpeg",
    "data": "...base64..."
    }
    }
    \]
    }
    }
    \]
    }

### After (Interactions API)

In the Interactions API, generated media appears as distinct items within the `content` array of a `model_output` step in the timeline, maintaining the chronological flow of the interaction.

    # Response structure concept
    {
      "id": "int_123",
      "steps": \[
    {
    "type": "model_output",
    "status": "done",
    "content": \[
    {
    "type": "text",
    "text": "Here is your generated image:"
    },
    {
    "type": "image",
    "mime_type": "image/jpeg",
    "data": "...base64..." // Or a reference URL in future
    }
    \]
    }
    \]
    }

This keeps the response parsing consistent with how inputs and text outputs are handled---everything is a step in the timeline.

## Server-side tools

Gemini supports built-in server-side tools like Google Search grounding. The primary difference is how the response represents tool execution.

### Before (`generateContent`)

In `generateContent`, server-side tools are largely opaque. You enable the tool and get a final answer with a separate `groundingMetadata` object. Crucially, citations are not inline; `groundingSupports` use character indices to map text segments back to web sources in `groundingChunks`.

### Python

    from google import genai
    from google.genai import types

    client = genai.Client()

    response = client.models.generate_content(
        model="gemini-2.5-flash-lite",
        contents="Who won Euro 2024?",
        config=types.GenerateContentConfig(
            tools=[{"google_search": {}}]
        ),
    )

    metadata = response.candidates[0].grounding_metadata
    if metadata.search_entry_point:
        print(f"Search Entry Point: {metadata.search_entry_point.rendered_content}")

    for support in metadata.grounding_supports:
        print(f"Citation: {support.segment.text}")

### JavaScript

    import { GoogleGenAI } from '@google/genai';

    const client = new GoogleGenAI({});

    const response = await client.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: 'Who won Euro 2024?',
        config: {
            tools: [{ google_search: {} }]
        }
    });

    const metadata = response.candidates[0].groundingMetadata;
    if (metadata.searchEntryPoint) {
        console.log(`Search Entry Point: ${metadata.searchEntryPoint.renderedContent}`);
    }
    for (const support of metadata.groundingSupports) {
        console.log(`Citation: ${support.segment.text}`);
    }

### REST

    # Request
    curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent" \
    -H "Content-Type: application/json" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -d '{
        "contents": \[{
    "parts": \[{
    "text": "Who won Euro 2024?"
    }\]
    }\],
    "tools": \[{
    "googleSearchRetrieval": {}
    }\]
    }'

    # Response
    {
      "candidates": \[
    {
    "content": {
    "parts": \[
    {
    "text": "Spain won Euro 2024, defeating England 2-1 in the final. This victory marks Spain's record fourth European Championship title."
    }
    \],
    "role": "model"
    },
    "groundingMetadata": {
    "webSearchQueries": \[
    "UEFA Euro 2024 winner",
    "who won euro 2024"
    \],
    "searchEntryPoint": {
    "renderedContent": "\<!-- HTML and CSS for the search widget --\>"
    },
    "groundingChunks": \[
    {"web": {"uri": "https://vertexaisearch.cloud.google.com.....", "title": "aljazeera.com"}},
    {"web": {"uri": "https://vertexaisearch.cloud.google.com.....", "title": "uefa.com"}}
    \],
    "groundingSupports": \[
    {
    "segment": {"startIndex": 0, "endIndex": 85, "text": "Spain won Euro 2024, defeatin..."},
    "groundingChunkIndices": \[0\]
    },
    {
    "segment": {"startIndex": 86, "endIndex": 210, "text": "This victory marks Spain's..."},
    "groundingChunkIndices": \[0, 1\]
    }
    \]
    }
    }
    \]
    }

### After (Interactions API)

In the Interactions API, server-side tools provide full timeline transparency. The API records the call and result as distinct execution `steps` (`google_search_call` and `google_search_result`), exposing exactly what data the model retrieved.

Furthermore, the API returns citations **inline** . Instead of mapping indices from a separate metadata object, the text item within the `model_output` step contains its own `annotations` array linking directly to the source.

### Python

    from google import genai

    client = genai.Client()

    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input="Who won Euro 2024?",
        tools=[{"type": "google_search"}],
    )

    for step in interaction.steps:
        if step.type == "google_search_result":
            print(f"Search Suggestions: {step.result[0].search_suggestions}")
        elif step.type == "model_output":
            print(f"Answer: {step.content[0].text}")
            if step.content[0].annotations:
                for anno in step.content[0].annotations:
                    print(f"Citation: {anno.title} ({anno.uri})")

### JavaScript

    import { GoogleGenAI } from '@google/genai';

    const client = new GoogleGenAI({});

    const interaction = await client.interactions.create({
        model: 'gemini-3.8-flash',
        input: 'Who won Euro 2024?',
        tools: [{ type: 'google_search' }]
    });

    for (const step of interaction.steps) {
        if (step.type === 'google_search_result') {
            console.log(`Search Suggestions: ${step.result[0].search_suggestions}`);
        } else if (step.type === 'model_output') {
            console.log(`Answer: ${step.content[0].text}`);
            if (step.content[0].annotations) {
                for (const anno of step.content[0].annotations) {
                    console.log(`Citation: ${anno.title} (${anno.uri})`);
                }
            }
        }
    }

### REST

    # Request
    curl -X POST "https://generativelanguage.googleapis.com/v1beta2/interactions" \
    -H "Content-Type: application/json" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -d '{
        "model": "gemini-3.8-flash",
        "input": "Who won Euro 2024?",
    "tools": \[{"type": "google_search"}\]
    }'

    # Response (showing grounding)
    {
      "id": "int_grounded",
      "steps": \[
    {
    "type": "user_input",
    "status": "done",
    "content": \[{ "type": "text", "text": "Who won Euro 2024?" }\]
    },
    {
    "type": "google_search_call",
    "status": "done",
    "content": \[{ "type": "text", "text": "UEFA Euro 2024 winner" }\]
    },
    {
    "type": "google_search_result",
    "status": "done",
    "content": \[
    {
    "type": "text",
    "text": "Spain won Euro 2024..."
    }
    \]
    },
    {
    "type": "model_output",
    "status": "done",
    "content": \[
    {
    "type": "text",
    "text": "Spain won Euro 2024, defeating England 2-1.",
    "annotations": \[
    {
    "start_index": 0,
    "end_index": 42,
    "uri": "https://vertexaisearch...",
    "title": "aljazeera.com"
    }
    \]
    }
    \]
    }
    \]
    }

## Function calling

The structure of function calls and results has also changed to fit the Steps schema.

### Before (`generateContent`)

In `generateContent`, the response returns function calls within the candidates.\* {Python}

    ```python
    from google import genai
    from google.genai import types

    client = genai.Client()

    response = client.models.generate_content(
        model="gemini-2.5-flash-lite",
        contents="What's the weather in Boston?",
        config=types.GenerateContentConfig(tools=[weather_tool]),
    )

    function_call = response.candidates[0].content.parts[0].function_call
    print(f"Requested tool: {function_call.name}")

    result = "52°F and rain"

    response = client.models.generate_content(
        model="gemini-2.5-flash-lite",
        contents=[
            types.Content(
                role="user",
                parts=[
                    types.Part.from_text(text="What's the weather in Boston?")
                ],
            ),
            response.candidates[0].content,
            types.Content(
                role="user",
                parts=[
                    types.Part.from_function_response(
                        name=function_call.name,
                        response={"result": result},
                    )
                ],
            ),
        ],
        config=types.GenerateContentConfig(tools=[weather_tool]),
    )
    print(response.text)
    ```

### JavaScript

    import { GoogleGenAI } from '@google/genai';

    const client = new GoogleGenAI({});

    let response = await client.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: "What's the weather in Boston?",
        config: { tools: [weatherTool] }
    });

    const functionCall = response.candidates[0].content.parts[0].functionCall;
    console.log(`Requested tool: ${functionCall.name}`);

    const result = "52°F and rain";

    response = await client.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: [
            { role: 'user', parts: [{ text: "What's the weather in Boston?" }] },
            response.candidates[0].content,
            {
                role: 'user',
                parts: [{
                    functionResponse: {
                        name: functionCall.name,
                        response: { result: result }
                    }
                }]
            }
        ],
        config: { tools: [weatherTool] }
    });
    console.log(response.text);

### REST

    # Request
    curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent" \
    -H "Content-Type: application/json" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -d '{
        "contents": \[{
    "parts": \[{
    "text": "What is the weather like in Boston, MA?"
    }\]
    }\],
    "tools": \[{
    "functionDeclarations": \[{
    "name": "get_weather",
    "description": "Get the current weather",
    "parameters": {
    "type": "OBJECT",
    "properties": {
    "location": {"type": "STRING"}
    },
    "required": \["location"\]
    }
    }\]
    }\]
    }'

    # Response
    {
      "candidates": \[
    {
    "content": {
    "parts": \[
    {
    "functionCall": {
    "name": "get_weather",
    "args": { "location": "Boston, MA" }
    }
    }
    \],
    "role": "model"
    },
    "finishReason": "STOP",
    "index": 0
    }
    \]
    }

### After (Interactions API)

Tool calls and results are now distinct steps in the timeline.

### Python

    from google import genai

    client = genai.Client()

    weather_tool = {
        "type": "function",
        "name": "get_weather",
        "description": "Gets weather",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {"type": "string"}
            },
        },
    }

    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input="What's the weather in Boston?",
        tools=[weather_tool],
    )

    for step in interaction.steps:
        if step.type == "function_call":
            print(f"Executing {step.name} for {step.arguments}")

            result = "52°F and rain"

            interaction = client.interactions.create(
                model="gemini-3.8-flash",
                previous_interaction_id=interaction.id,
                input=[
                    {
                        "type": "function_result",
                        "call_id": step.id,
                        "name": step.name,
                        "result": [{"type": "text", "text": result}],
                    }
                ],
            )
            print(interaction.output_text)

### JavaScript

    import { GoogleGenAI } from '@google/genai';

    const client = new GoogleGenAI({});

    const weatherTool = {
        type: "function",
        name: "get_weather",
        description: "Get weather for a location",
        parameters: {
            type: "object",
            properties: {
                location: { type: "string" }
            },
            required: ["location"]
        }
    };

    const interaction = await client.interactions.create({
        model: 'gemini-3.8-flash',
        input: "What's the weather in Boston?",
        tools: [weatherTool]
    });

    for (const step of interaction.steps) {
        if (step.type === 'function_call') {
            console.log(`Executing ${step.name} for ${JSON.stringify(step.arguments)}`);

            const result = "52°F and rain";

            const nextInteraction = await client.interactions.create({
                model: 'gemini-3.8-flash',
                previous_interaction_id: interaction.id,
                input: [
                    {
                        type: 'function_result',
                        call_id: step.id,
                        name: step.name,
                        result: [{ type: 'text', text: result }]
                    }
                ]
            });

            console.log(nextInteraction.output_text);
        }
    }

### REST

    # Initial Request
    curl -X POST "https://generativelanguage.googleapis.com/v1beta2/interactions" \
    -H "Content-Type: application/json" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -d '{
        "model": "gemini-3.8-flash",
        "input": "What's the weather in Boston?",
    "tools": \[{
    "type": "function",
    "name": "get_weather",
    "description": "Get weather for a location",
    "parameters": {
    "type": "object",
    "properties": {
    "location": { "type": "string" }
    },
    "required": \["location"\]
    }
    }\]
    }'

    # Response (requires action)
    {
      "id": "int_001",
      "status": "requires_action",
      "steps": \[
    {
    "type": "user_input",
    "status": "done",
    "content": \[
    { "type": "text", "text": "What's the weather in Boston?" }
    \]
    },
    {
    "type": "function_call",
    "status": "waiting",
    "id": "fc_1",
    "name": "get_weather",
    "arguments": { "location": "Boston, MA" }
    }
    \]
    }

    # Submit Tool Result Request
    curl -X POST "https://generativelanguage.googleapis.com/v1beta2/interactions" \
    -H "Content-Type: application/json" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -d '{
        "model": "gemini-3.8-flash",
        "previous_interaction_id": "int_001",
    "input": {
    "type": "function_result",
    "call_id": "fc_1",
    "name": "get_weather",
    "result": \[
    { "type": "text", "text": "52°F with rain" }
    \]
    }
    }'

    # Final Response
    {
      "id": "int_002",
      "status": "completed",
      "steps": \[
    {
    "type": "function_result",
    "call_id": "fc_1",
    "name": "get_weather",
    "result": \[
    { "type": "text", "text": "52°F with rain" }
    \]
    },
    {
    "type": "model_output",
    "status": "done",
    "content": \[
    { "type": "text", "text": "It's 52°F with rain in Boston." }
    \]
    }
    \]
    }

## Streaming

A key difference in streaming is that the Interactions API uses the same endpoint with `"stream": true` in the request body, whereas the `generateContent` API required calling a dedicated endpoint (`:streamGenerateContent`).

Additionally, streaming events now use specialized types to monitor the interaction lifecycle and track execution steps along the timeline.

### Before (`generateContentStream`)

With `generateContent`, you consume a stream of response chunks.

### Python

    from google import genai

    client = genai.Client()

    response = client.models.generate_content_stream(
        model="gemini-2.5-flash-lite", contents="Tell me a story"
    )
    for chunk in response:
        print(chunk.text, end="")

### JavaScript

    const responseStream = await client.models.generateContentStream({
        model: 'gemini-2.5-flash-lite',
        contents: 'Tell me a story',
    });
    for await (const chunk of responseStream) {
        process.stdout.write(chunk.text);
    }

### REST

    # Request
    curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:streamGenerateContent" \
    -H "Content-Type: application/json" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -d '{
        "contents": \[{
    "parts": \[{
    "text": "Tell me a story"
    }\]
    }\]
    }'

    # Response stream
    event: content.start
    data: {"event_type": "content.start", "index": 0, "content": {"type": "thought"}}
    event: content.delta
    data: {"event_type": "content.delta", "index": 0, "delta": {"type": "thought_summary", "text": "User wants an explanation."}}
    event: content.stop
    data: {"event_type": "content.stop", "index": 0}
    event: content.start
    data: {"event_type": "content.start", "index": 1, "content": {"type": "text"}}
    event: content.delta
    data: {"event_type": "content.delta", "index": 1, "delta": {"type": "text", "text": "Hello"}}
    event: content.stop
    data: {"event_type": "content.stop", "index": 1}

### After (Interactions API)

In the Interactions API, streaming uses Server-Sent Events (SSE) and specialized delta types to represent execution steps as they happen.

### Python

    from google import genai

    client = genai.Client()

    stream = client.interactions.create(
        model="gemini-3.8-flash",
        input="Tell me a story",
        stream=True,
    )

    for event in stream:
        if event.event_type == "step.delta" and event.delta:
            if getattr(event.delta, "type", None) == "text" and getattr(event.delta, "text", None):
                print(event.delta.text, end="", flush=True)
        elif event.event_type == "interaction.completed":
            print(f"\n\n--- Stream Finished ---")

### JavaScript

    import { GoogleGenAI } from '@google/genai';

    const client = new GoogleGenAI({});

    const stream = await client.interactions.create({
        model: 'gemini-3.8-flash',
        input: 'Tell me a story',
        stream: true,
    });

    for await (const event of stream) {
        if (event.event_type === 'step.delta' && event.delta) {
            if (event.delta.type === 'text' && event.delta.text) {
                process.stdout.write(event.delta.text);
            }
        } else if (event.event_type === 'interaction.completed') {
            console.log('\n\n--- Stream Finished ---');
        }
    }

### REST

# Example SSE stream output
**event: interaction.created
data: {"type": "interaction.created", "interaction": {"id": "int_xyz", "status": "created"}}
event: interaction.in_progress
data: {"type": "interaction.in_progress", "interaction": {"id": "int_xyz", "status": "in_progress"}}
event: step.start
data: {"type": "step.start", "index": 0, "step": {"type": "thought"}}
event: step.delta
data: {"type": "step.delta", "index": 0, "delta": {"type": "thought", "text": "User wants an explanation."}}
event: step.stop
data: {"type": "step.stop", "index": 0, "status": "done"}
event: step.start
data: {"type": "step.start", "index": 1, "step": {"type": "model_output"}}
event: step.delta
data: {"type": "step.delta", "index": 1, "delta": {"type": "text", "text": "Hello"}}
event: step.stop
data: {"type": "step.stop", "index": 1, "status": "done"}
event: interaction.completed
data: {"type": "interaction.completed", "interaction": {"id": "int_xyz", "status": "completed", "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}}**
\`\`\`

### Streaming tools and function calls

The way tools behave in the stream has shifted significantly from `generateContent` to provide more granular control and visibility.

#### Before (`generateContent`)

With `generateContent`, streaming function calls arrived complete in a single chunk. You could not see the arguments being generated in real-time, so the handler simply checked for a complete `functionCall` object.

### Python

    from google import genai
    from google.genai import types

    client = genai.Client()

    stream = client.models.generate_content_stream(
        model="gemini-2.5-flash-lite",
        contents="What's the weather in Boston?",
        config=types.GenerateContentConfig(tools=[weather_tool]),
    )

    for chunk in stream:
        # Function calls arrived complete --- no partial arguments
        if chunk.candidates[0].content.parts[0].function_call:
            fc = chunk.candidates[0].content.parts[0].function_call
            print(f"Call: {fc.name}({fc.args})")
        elif chunk.text:
            print(chunk.text, end="")

### JavaScript

    import { GoogleGenAI } from '@google/genai';

    const client = new GoogleGenAI({});

    const stream = await client.models.generateContentStream({
        model: 'gemini-2.5-flash-lite',
        contents: "What's the weather in Boston?",
        config: { tools: [weatherTool] }
    });

    for await (const chunk of stream) {
        const part = chunk.candidates[0].content.parts[0];
        if (part.functionCall) {
            console.log(`Call: ${part.functionCall.name}(${JSON.stringify(part.functionCall.args)})`);
        } else if (part.text) {
            process.stdout.write(part.text);
        }
    }

### REST

    # Request
    curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:streamGenerateContent" \
    -H "Content-Type: application/json" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -d '{
        "contents": \[{"parts": \[{"text": "What is the weather in Boston?"}\]}\],
    "tools": \[{"functionDeclarations": \[{"name": "get_weather", "parameters": {"type": "OBJECT", "properties": {"location": {"type": "STRING"}}}}\]}\]
    }'

    # Response stream --- function call arrives complete in one chunk
    {"candidates": \[{"content": {"parts": \[{"functionCall": {"name": "get_weather", "args": {"location": "Boston, MA"}}}\]}}\]}

#### After (Interactions API)

The Interactions API streams function call arguments character-by-character as `arguments` events. The entire tool lifecycle --- thought, call, result, and output --- plays out as a series of distinct steps.

### Python

    from google import genai

    client = genai.Client()

    stream = client.interactions.create(
        model="gemini-3.8-flash",
        input="What's the weather in Boston?",
        tools=[get_weather_tool],
        stream=True,
    )

    for event in stream:
        if event.event_type == "step.start" and event.step:
            if getattr(event.step, "type", None) == "function_call":
                print(f"Calling: {event.step.name}")
        elif event.event_type == "step.delta" and event.delta:
            if getattr(event.delta, "type", None) == "arguments":
                print(f"  args: {event.delta.partial_arguments}")
            elif getattr(event.delta, "type", None) == "text" and getattr(event.delta, "text", None):
                print(event.delta.text, end="")
        elif event.event_type == "interaction.completed":
            print("\n--- Done ---")

### JavaScript

    import { GoogleGenAI } from '@google/genai';

    const client = new GoogleGenAI({});

    const stream = await client.interactions.create({
        model: 'gemini-3.8-flash',
        input: "What's the weather in Boston?",
        tools: [getWeatherTool],
        stream: true,
    });

    for await (const event of stream) {
        if (event.event_type === 'step.start' && event.step) {
            if (event.step.type === 'function_call') {
                console.log(`Calling: ${event.step.name}`);
            }
        } else if (event.event_type === 'step.delta' && event.delta) {
            if (event.delta.type === 'arguments' && event.delta.partial_arguments) {
                console.log(`  args: ${event.delta.partial_arguments}`);
            } else if (event.delta.type === 'text' && event.delta.text) {
                process.stdout.write(event.delta.text);
            }
        } else if (event.event_type === 'interaction.completed') {
            console.log('\n--- Done ---');
        }
    }

### REST

    # Request
    curl -X POST "https://generativelanguage.googleapis.com/v1beta2/interactions" \
    -H "Content-Type: application/json" \
    -H "x-goog-api-key: $GEMINI_API_KEY" \
    -d '{
        "model": "gemini-3.8-flash",
        "input": "What is the weather in Boston?",
    "tools": \[{"type": "function", "name": "get_weather", "parameters": {"type": "object", "properties": {"location": {"type": "string"}}}}\],
    "stream": true
    }'

    # Response stream
    // Interaction created
    event: interaction.created
    data: {"type": "interaction.created", "interaction": {"id": "int_xyz", "status": "created"}}

    event: interaction.in_progress
    data: {"type": "interaction.in_progress", "interaction": {"id": "int_xyz", "status": "in_progress"}}

    // ── Step 0: Thought ──────────────────────────────────
    event: step.start
    data: {"type": "step.start", "index": 0, "step": {"type": "thought"}}

    event: step.delta
    data: {"type": "step.delta", "index": 0, "delta": {"type": "thought", "text": "The user wants weather data for Boston. I'll call the get_weather tool."}}

    event: step.stop
    data: {"type": "step.stop", "index": 0, "status": "done"}

    // ── Step 1: Function Call (arguments streamed) ───────
    event: step.start
    data: {"type": "step.start", "index": 1, "step": {"type": "function_call", "id": "fc_1", "name": "get_weather"}}

    event: step.delta
    data: {"type": "step.delta", "index": 1, "delta": {"type": "arguments", "partial_arguments": "{\"location\": \"Boston, MA\"}"}}

    event: step.stop
    data: {"type": "step.stop", "index": 1, "status": "waiting"}

    // The interaction pauses --- the model needs the tool result before continuing.
    event: interaction.requires_action
    data: {"type": "interaction.requires_action", "interaction": {"id": "int_xyz", "status": "requires_action"}}

    // ── (Client submits the tool result) ──────────────────
    // The client calls interactions.create with the function_result as input
    // and the previous interaction's ID, then resumes consuming the stream.

    event: interaction.in_progress
    data: {"type": "interaction.in_progress", "interaction": {"id": "int_xyz", "status": "in_progress"}}

    // ── Step 2: Function Result (echoed back, no deltas) ─
    event: step.start
    data: {"type": "step.start", "index": 2, "step": {"type": "function_result", "call_id": "fc_1", "name": "get_weather", "result": [{"type": "text", "text": "52°F, rain"}]}}

    event: step.stop
    data: {"type": "step.stop", "index": 2, "status": "done"}

    // ── Step 3: Thought ──────────────────────────────────
    event: step.start
    data: {"type": "step.start", "index": 3, "step": {"type": "thought"}}

    event: step.delta
    data: {"type": "step.delta", "index": 3, "delta": {"type": "thought", "text": "Got weather data. Composing the final response."}}

    event: step.stop
    data: {"type": "step.stop", "index": 3, "status": "done"}

    // ── Step 4: Model Output (text streamed) ─────────────
    event: step.start
    data: {"type": "step.start", "index": 4, "step": {"type": "model_output"}}

    event: step.delta
    data: {"type": "step.delta", "index": 4, "delta": {"type": "text", "text": "It's currently 52°F and rainy in Boston."}}

    event: step.stop
    data: {"type": "step.stop", "index": 4, "status": "done"}

    // ── Interaction complete ─────────────────────────────
    event: interaction.completed
    data: {"type": "interaction.completed", "interaction": {"id": "int_xyz", "status": "completed", "usage": {"prompt_tokens": 256, "completion_tokens": 128, "total_tokens": 384}}}
