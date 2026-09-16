> Source: https://ai.google.dev/gemini-api/docs/tokens (snapshot 2026-09-16)
>
> Java samples removed.

Gemini and other generative AI models process input and output at a granularity
called a *token*.

**For Gemini models, a token is equivalent to about 4 characters.
100 tokens is equal to about 60-80 English words.**

## About tokens

Tokens can be single characters like `z` or whole words like `cat`. Long words
are broken up into several tokens. The set of all tokens used by the model is
called the vocabulary, and the process of splitting text into tokens is called
*tokenization*.

When billing is enabled, the [cost of a call to the Gemini API](https://ai.google.dev/pricing) is
determined in part by the number of input and output tokens, so knowing how to
count tokens can be helpful.

## Count tokens

All input to and output from the Gemini API is tokenized, including text, image
files, and other non-text modalities.

You can count tokens in the following ways:

- **Call `count_tokens` with the input of the request.** Returns the total
  number of tokens in *the input only*. Make this call before sending input
  to check the size of your requests.

- **Use the `usage` on the interaction response.** Returns token
  counts for input (`total_input_tokens`), output (`total_output_tokens`),
  thinking (`total_thought_tokens`), cached content
  (`total_cached_tokens`), tool use (`total_tool_use_tokens`),
  and total (`total_tokens`).

### Count text tokens

### Python

    # This will only work for SDK newer than 2.0.0
    from google import genai

    client = genai.Client()
    prompt = "The quick brown fox jumps over the lazy dog."

    # Count tokens before sending
    total_tokens = client.models.count_tokens(
        model="gemini-3.8-flash",
        contents=prompt
    )
    print("total_tokens:", total_tokens.total_tokens)

    # Get usage from interaction
    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input=prompt
    )
    print(interaction.usage)

### JavaScript

    // This will only work for SDK newer than 2.0.0
    import { GoogleGenAI } from '@google/genai';

    const client = new GoogleGenAI({});
    const prompt = "The quick brown fox jumps over the lazy dog.";

    // Count tokens before sending
    const countResponse = await client.models.countTokens({
        model: "gemini-3.8-flash",
        contents: prompt,
    });
    console.log(countResponse.totalTokens);

    // Get usage from interaction
    const interaction = await client.interactions.create({
        model: "gemini-3.8-flash",
        input: prompt,
    });
    console.log(interaction.usage);

### REST

    # Specifies the API revision to avoid breaking changes when they become default
    curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:countTokens" \
      -H "x-goog-api-key: $GEMINI_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"contents": [{"parts": [{"text": "The quick brown fox."}]}]}'

### Count multi-turn tokens

Count tokens across conversation history using `previous_interaction_id`:

### Python

    # This will only work for SDK newer than 2.0.0
    # First interaction
    interaction1 = client.interactions.create(
        model="gemini-3.8-flash",
        input="Hi, my name is Bob"
    )

    # Second interaction continues the conversation
    interaction2 = client.interactions.create(
        model="gemini-3.8-flash",
        input="What's my name?",
        previous_interaction_id=interaction1.id
    )

    # Usage includes tokens from both turns
    print(f"Input tokens: {interaction2.usage.total_input_tokens}")
    print(f"Output tokens: {interaction2.usage.total_output_tokens}")
    print(f"Total tokens: {interaction2.usage.total_tokens}")

### JavaScript

    // This will only work for SDK newer than 2.0.0
    // First interaction
    const interaction1 = await client.interactions.create({
        model: "gemini-3.8-flash",
        input: "Hi, my name is Bob"
    });

    // Second interaction continues the conversation
    const interaction2 = await client.interactions.create({
        model: "gemini-3.8-flash",
        input: "What's my name?",
        previous_interaction_id: interaction1.id
    });

    console.log(`Input tokens: ${interaction2.usage.total_input_tokens}`);
    console.log(`Output tokens: ${interaction2.usage.total_output_tokens}`);

### Count multimodal tokens

All input to the Gemini API is tokenized, including images, video, and audio.
Key points about tokenization:

- **Images**: Images ≤384 pixels in both dimensions count as 258 tokens. Larger images are tiled into 768x768 pixel tiles, each counting as 258 tokens.
- **Video** : 263 tokens per second (applies to static processing). For agentic processing, token usage varies. See [Video token usage by processing mode](https://ai.google.dev/gemini-api/docs/tokens#video-token-usage).
- **Audio**: 32 tokens per second

#### Image tokens

### Python

    # This will only work for SDK newer than 2.0.0
    uploaded_file = client.files.upload(file="path/to/image.jpg")

    # Count tokens for image + text
    total_tokens = client.models.count_tokens(
        model="gemini-3.8-flash",
        contents=["Tell me about this image", uploaded_file]
    )
    print(f"Total tokens: {total_tokens}")

    # Generate with image
    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input=[
            {"type": "text", "text": "Tell me about this image"},
            {"type": "image", "uri": uploaded_file.uri, "mime_type": uploaded_file.mime_type}
        ]
    )
    print(interaction.usage)

### JavaScript

    // This will only work for SDK newer than 2.0.0
    const uploadedFile = await client.files.upload({
        file: "path/to/image.jpg",
        config: { mimeType: "image/jpeg" }
    });

    // Count tokens
    const countResponse = await client.models.countTokens({
        model: "gemini-3.8-flash",
        contents: [
            { text: "Tell me about this image" },
            { fileData: { fileUri: uploadedFile.uri, mimeType: uploadedFile.mimeType } }
        ]
    });
    console.log(countResponse.totalTokens);

### Python

    # This will only work for SDK newer than 2.0.0
    import base64

    with open('image.jpg', 'rb') as f:
        image_bytes = f.read()

    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input=[
            {"type": "text", "text": "Describe this image"},
            {
                "type": "image",
                "data": base64.b64encode(image_bytes).decode('utf-8'),
                "mime_type": "image/jpeg"
            }
        ]
    )
    print(interaction.usage)

#### Video tokens

### Python

    # This will only work for SDK newer than 2.0.0
    import time

    video_file = client.files.upload(file="path/to/video.mp4")

    while not video_file.state or video_file.state.name != "ACTIVE":
        print("Processing video...")
        time.sleep(5)
        video_file = client.files.get(name=video_file.name)

    # A 60-second video is approximately 100 * 60 = 6,000 tokens
    total_tokens = client.models.count_tokens(
        model="gemini-3.8-flash",
        contents=["Summarize this video", video_file]
    )
    print(f"Total tokens: {total_tokens}")

    # Generate with video
    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input=[
            {"type": "text", "text": "Summarize this video"},
            {"type": "video", "uri": video_file.uri, "mime_type": video_file.mime_type}
        ]
    )
    print(interaction.usage)

#### Video token usage by processing mode

Token usage for video depends on the processing mode:

| **Processing mode** | **Token calculation** | **Typical usage** |
|---|---|---|
| **Static** (default) | \~100 tokens/second by default (low resolution) or \~300 tokens/second (high resolution). All frames sampled at 1 FPS. | Predictable, proportional to video duration. |
| **Agentic** | Varies by content complexity. The model loads only the transcript and/or frames and/or audio needed to answer the prompt. | Up to 88% fewer tokens for long-form content. |

With agentic processing, a 1-hour lecture that would use \~1.08M tokens in
static mode might use \~108K tokens, depending on the prompt and content.

> [!NOTE]
> **Note:** For static processing, token calculations assume the default sampling rate of 1 FPS. If you set a [custom frame rate](https://ai.google.dev/gemini-api/docs/generate-content/video-understanding#custom-frame-rate) in the GenerateContent API, token usage scales proportionally with the configured FPS.

To check actual token usage for a request, inspect `interaction.usage`. Agentic video tokens are reported across the following fields:

- **Initial prompt** (video reference + user prompt): `total_input_tokens`
- **Navigation thinking** : `total_thought_tokens`
- **Transcript, frames, and audio loaded on demand** : `total_tool_use_tokens`
- **Final answer** : `total_output_tokens`

#### Audio tokens

### Python

    # This will only work for SDK newer than 2.0.0
    audio_file = client.files.upload(file="path/to/audio.mp3")

    # A 60-second audio clip is approximately 32 * 60 = 1,920 tokens
    total_tokens = client.models.count_tokens(
        model="gemini-3.8-flash",
        contents=["Transcribe this audio", audio_file]
    )
    print(f"Total tokens: {total_tokens}")

    # Generate with audio
    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input=[
            {"type": "text", "text": "Transcribe this audio"},
            {"type": "audio", "uri": audio_file.uri, "mime_type": audio_file.mime_type}
        ]
    )
    print(interaction.usage)

### Count system instruction tokens

System instructions are counted as part of the input tokens:

### Python

    # This will only work for SDK newer than 2.0.0
    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input="Hello!",
        system_instruction="You are a helpful assistant who speaks like a pirate."
    )

    # system_instruction tokens included in total_input_tokens
    print(f"Input tokens: {interaction.usage.total_input_tokens}")

### Count tool tokens

Tools (functions, code execution, Google Search) are also counted:

### Python

    # This will only work for SDK newer than 2.0.0
    tools = [
        {
            "type": "function",
            "name": "get_weather",
            "description": "Get current weather",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string"}
                }
            }
        }
    ]

    interaction = client.interactions.create(
        model="gemini-3.8-flash",
        input="What's the weather in Tokyo?",
        tools=tools
    )

    print(f"Input tokens: {interaction.usage.total_input_tokens}")
    print(f"Tool use tokens: {interaction.usage.total_tool_use_tokens}")

## Context window

Each Gemini model has a maximum number of tokens it can handle. The context
window defines the combined limit of input and output tokens.

### Get context window size programmatically

### Python

    # This will only work for SDK newer than 2.0.0
    model_info = client.models.get(model="gemini-3.8-flash")
    print(f"Input token limit: {model_info.input_token_limit}")
    print(f"Output token limit: {model_info.output_token_limit}")

### JavaScript

    // This will only work for SDK newer than 2.0.0
    const modelInfo = await client.models.get({ model: "gemini-3.8-flash" });
    console.log(`Input token limit: ${modelInfo.inputTokenLimit}`);
    console.log(`Output token limit: ${modelInfo.outputTokenLimit}`);

## What's next

- [Text generation](https://ai.google.dev/gemini-api/docs/text-generation): Generation basics
- [Caching](https://ai.google.dev/gemini-api/docs/caching): Reduce costs with caching
- [Pricing](https://ai.google.dev/gemini-api/docs/pricing): Understand costs
