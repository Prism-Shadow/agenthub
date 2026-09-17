> Source: https://ai.google.dev/api/interactions-api ("View as markdown": https://ai.google.dev/static/api/interactions.md.txt) (snapshot 2026-09-16)
>
> Java samples removed; everything else verbatim. OpenAPI: https://ai.google.dev/static/api/interactions.openapi.json

<!-- disableFinding(G3DOC_JINJA) -->
<!-- disableFinding(HEADING_FUNCTION) -->
<!-- disableFinding(LINE_OVER_80) -->
<!-- disableFinding(SPACES) -->


# Gemini Interactions API

> **Recommended:** The **Interactions API** is the recommended standard API for all new projects and applications using Gemini. It is optimized for agentic workflows, server-side state management, and real-time conversations.

Note: You are viewing the beta version of the Interactions API. Endpoints are under `/v1beta/`. The stable [v1 version](interactions-api-v1) is also available.

The Gemini Interactions API allows developers to build generative AI applications using Gemini models. Gemini is our most capable model, built from the ground up to be multimodal. It can generalize and seamlessly understand, operate across, and combine different types of information including language, images, audio, video, and code. You can use the Gemini API for use cases like reasoning across text and images, content generation, dialogue agents, summarization and classification systems, and more.

## Interactions

### Creating an interaction

`POST https://generativelanguage.googleapis.com/v1beta/interactions`

Creates a new interaction.

#### Parameters
- **api_version** (`string`) *(Required)* Which version of the API to use.


#### Request Body
- **model** (`ModelOption`) The name of the `Model` used for generating the interaction. <br><strong>Required if `agent` is not provided.</strong>
  Possible values:
  - `gemini-2.5-flash`: Our first hybrid reasoning model which supports a 1M token context window and has thinking budgets.
  - `gemini-2.5-pro`: Our state-of-the-art multipurpose model, which excels at coding and complex reasoning tasks.
  - `gemma-4-26b-a4b-it`: Gemma 4 26B A4B IT
  - `gemma-4-31b-it`: Gemma 4 31B IT
  - `gemini-flash-latest`: Latest release of Gemini Flash
  - `gemini-flash-lite-latest`: Latest release of Gemini Flash-Lite
  - `gemini-pro-latest`: Latest release of Gemini Pro
  - `gemini-2.5-flash-lite`: Our smallest and most cost effective model, built for at scale usage.
  - `gemini-2.5-flash-image`: Our native image generation model, optimized for speed, flexibility, and contextual understanding. Text input and output is priced the same as 2.5 Flash.
  - `gemini-3-flash-preview`: Our most intelligent model built for speed, combining frontier intelligence with superior search and grounding.
  - `gemini-3.1-pro-preview`: Our latest SOTA reasoning model with unprecedented depth and nuance, and powerful multimodal understanding and coding capabilities.
  - `gemini-3.1-pro-preview-customtools`: Gemini 3.1 Pro Preview optimized for custom tool usage
  - `gemini-3.1-flash-lite`: Our most cost-efficient model, optimized for high-volume agentic tasks, translation, and simple data processing.
  - `gemini-3-pro-image`: Gemini 3 Pro Image
  - `nano-banana-pro-preview`: Gemini 3 Pro Image Preview
  - `gemini-3.1-flash-image`: Gemini 3.1 Flash Image.
  - `gemini-3.5-flash`: Gemini 3.5 Flash - Our earlier Flash model, built for speed and foundational performance across routine, high-throughput workloads.
  - `gemini-3.6-flash`: Gemini 3.6 Flash - Our previous generation Flash model, balancing speed and multimodal capabilities across general agentic and everyday tasks.
  - `gemini-3.7-flash`: Gemini 3.7 Flash - Our high-speed, efficient Flash model built for everyday coding, agentic tool use, and reliable multi-step execution.
  - `gemini-3.8-flash`: Gemini 3.8 Flash - Our most intelligent Flash model, engineered for long-horizon software engineering, autonomous agents, and complex enterprise workflows.
  - `lyria-3-clip-preview`: Our low-latency, music generation model optimized for high-fidelity audio clips and precise rhythmic control.
  - `lyria-3-pro-preview`: Our advanced, full-song generative model with deep compositional understanding, optimized for precise structural control and complex transitions across diverse musical styles.
  - `gemini-robotics-er-1.6-preview`: Gemini Robotics-ER 1.6 Preview
  - `gemini-robotics-er-2-preview`: Gemini Robotics Embodied Reasoning 2 Preview

- **agent** (`AgentOption`) The name of the `Agent` used for generating the interaction. <br><strong>Required if `model` is not provided.</strong>
  Possible values:
  - `deep-research-pro-preview-12-2025`: Gemini Deep Research Agent
  - `deep-research-preview-04-2026`: Gemini Deep Research Agent
  - `deep-research-max-preview-04-2026`: Gemini Deep Research Max Agent
  - `antigravity-preview-05-2026`: Use the Antigravity managed agent to perform multi-step tasks that require reasoning, file operations, and tool use.

- **input** (`<a href="#Resource:Content">Content</a> or array (<a href="#Resource:Content">Content</a>) or array (<a href="#Resource:Step">Step</a>) or string`) *(Required)* The inputs for the interaction (common to both Model and Agent).

- **system_instruction** (`string`) System instruction for the interaction.

- **tools** (`array (<a href="#Resource:Tool">Tool</a>)`) A list of tool declarations the model may call during interaction.

- **response_format** (`<a href="#Resource:ResponseFormat">ResponseFormat</a> or array (<a href="#Resource:ResponseFormat">ResponseFormat</a>)`) Enforces that the generated response is a JSON object that complies with the JSON schema specified in this field.

- **stream** (`boolean`) Input only. Whether the interaction will be streamed.

- **store** (`boolean`) Input only. Whether to store the response and request for later retrieval.

- **background** (`boolean`) Input only. Whether to run the model interaction in the background.

- **generation_config** (`GenerationConfig`) <strong>Model Configuration</strong><br>Configuration parameters for the model interaction. <br><em>Alternative to `agent_config`. Only applicable when `model` is set.</em>
  - **max_output_tokens** (`integer`)   The maximum number of tokens to include in the response.

  - **seed** (`integer`)   Seed used in decoding for reproducibility.

  - **speech_config** (`SpeakerConfig or array (SpeechConfig)`)   Optional. Speech and multi-speaker configuration.
    - **speakers** (`array (SpeechConfig)`)     Individual speaker configurations.
      - **language** (`string`)       The language of the speech.

      - **speaker** (`string`)       The speaker's name, it should match the speaker name given in the prompt.

      - **voice** (`string`)       The voice of the speaker.


  - **stop_sequences** (`array (string)`)   A list of character sequences that will stop output interaction.

  - **thinking_level** (`ThinkingLevel`)   The level of thought tokens that the model should generate.
    Possible values:
    - `minimal`: Little to no thinking.
    - `low`: Low thinking level.
    - `medium`: Medium thinking level.
    - `high`: High thinking level.

  - **thinking_summaries** (`ThinkingSummaries`)   Whether to include thought summaries in the response.
    Possible values:
    - `auto`: Auto thinking summaries.
    - `none`: No thinking summaries.

  - **tool_choice** (`<a href="#Resource:ToolChoiceConfig">ToolChoiceConfig</a> or enum (string)`)   The tool choice configuration.
    Possible values:
    - `auto`: Auto tool choice.
    - `any`: Any tool choice.
    - `none`: No tool choice.
    - `validated`: Validated tool choice.

  - **transcription_config** (`TranscriptionConfig`)   Optional. Configuration for speech recognition (transcription). If present, ASR is enabled.
    - **custom_vocabulary** (`array (string)`)     Optional. A list of custom vocabulary phrases to bias the speech recognition model toward recognizing specific terms.

    - **language_codes** (`array (string)`)     Optional. BCP-47 language codes providing hints about the languages present in the audio. If omitted or empty, defaults to automatic language detection.

    - **mode** (`TranscriptionMode or enum (string)`)     Discriminated transcription mode options or enum.
      Possible values:
      - `verbatim`: Verbatim transcription mode.
      - `smart`: Smart transcription mode.
      **Possible Types:**
      - **SmartTranscriptionMode**: Configuration for smart transcription mode.
      - **type** (`object`) *(Required)*
        Value: `smart`
      - **VerbatimTranscriptionMode**: Configuration for verbatim transcription mode.
      - **diarization_mode** (`string`)       Optional. Configures speaker diarization. Supported values: "speaker".

      - **timestamp_granularities** (`array (string)`)       Optional. The granularity of timestamps to include in the transcription output. Supported values: "word". If empty, no timestamps are generated.

      - **type** (`object`) *(Required)*
        Value: `verbatim`


  - **video_config** (`VideoConfig`)   Configuration for video generation.
    - **task** (`enum (string)`)     Optional task mode for video generation. If not specified, the model automatically determines the appropriate mode based on the provided text prompt and input media.
      Possible values:
      - `text_to_video`: Generates video solely from a text prompt.
      - `image_to_video`: Generates video from one or two source images. The first image defines
the starting frame, and the optional second image defines the ending
frame.
      - `reference_to_video`: Generates video using reference media (such as images, audio, or video).
      - `edit`: Modifies an existing input video.
      - `extend`: Extends an existing input video.


- **agent_config** (`AntigravityAgentConfig or CodeMenderAgentConfig or DeepResearchAgentConfig or DynamicAgentConfig`) <strong>Agent Configuration</strong><br>Configuration for the agent. <br><em>Alternative to `generation_config`. Only applicable when `agent` is set.</em>
  **Possible Types:** (Discriminator: `type`)
  - **AntigravityAgentConfig**: Configuration for the Antigravity agent runtime. Provides server-side control over the agent's execution environment and tool configuration.
  - **max_total_tokens** (`string`)   Max total tokens for the agent run.

  - **model** (`string`)   The model to use for agent reasoning.

  - **type** (`object`) *(Required)*
    Value: `antigravity`
  - **DeepResearchAgentConfig**: Configuration for the Deep Research agent.
  - **collaborative_planning** (`boolean`)   Enables human-in-the-loop planning for the Deep Research agent. If set to true, the Deep Research agent will provide a research plan in its response. The agent will then proceed only if the user confirms the plan in the next turn.

  - **thinking_summaries** (`ThinkingSummaries`)   Whether to include thought summaries in the response.
    Possible values:
    - `auto`: Auto thinking summaries.
    - `none`: No thinking summaries.

  - **type** (`object`) *(Required)*
    Value: `deep-research`
  - **visualization** (`enum (string)`)   Whether to include visualizations in the response.
    Possible values:
    - `off`: Do not include visualizations.
    - `auto`: Automatically include visualizations.

  - **DynamicAgentConfig**: Configuration for dynamic agents.
  - **type** (`object`) *(Required)*
    Value: `dynamic`

- **environment** (`<a href="#Resource:EnvironmentConfig">EnvironmentConfig</a> or string`) The environment configuration for the interaction. Can be an object specifying remote environment sources or a string referencing an existing environment ID.

- **labels** (`object`) The labels with user-defined metadata for the request.

- **previous_interaction_id** (`string`) The ID of the previous interaction, if any.

- **safety_settings** (`array (SafetySetting)`) Safety settings for the interaction.

- **service_tier** (`ServiceTier`) The service tier for the interaction.
  Possible values:
  - `flex`: Flex service tier.
  - `standard`: Standard service tier.
  - `priority`: Priority service tier.

- **webhook_config** (`WebhookConfig`) Optional. Webhook configuration for receiving notifications when the interaction completes.
  - **uris** (`array (string)`)   Optional. If set, these webhook URIs will be used for webhook events instead of the registered webhooks.

  - **user_metadata** (`object`)   Optional. The user metadata that will be returned on each event emission to the webhooks.


#### Response
Returns [Interaction](#interaction) resources.

#### Examples
**Simple Request**

**REST**

```sh
curl -X POST https://generativelanguage.googleapis.com/v1beta/interactions \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.6-flash",
    "input": "Hello, how are you?"
  }'
```
**Python**

```python
from google import genai

client = genai.Client()
interaction = client.interactions.create(
    model="gemini-3.6-flash",
    input="Hello, how are you?",
)
print(interaction.output_text)
```
**JavaScript**

```javascript
import {GoogleGenAI} from '@google/genai';

const ai = new GoogleGenAI({});
const interaction = await ai.interactions.create({
    model: 'gemini-3.6-flash',
    input: 'Hello, how are you?',
});
console.log(interaction.output_text);
```
Response:
```json
{
  "created": "2025-11-26T12:25:15Z",
  "id": "v1_ChdPU0F4YWFtNkFwS2kxZThQZ05lbXdROBIXT1NBeGFhbTZBcEtpMWU4UGdOZW13UTg",
  "model": "gemini-3.6-flash",
  "object": "interaction",
  "status": "completed",
  "steps": [
    {
      "type": "model_output",
      "content": [
        {
          "type": "text",
          "text": "Hello! I'm functioning perfectly and ready to assist you.\n\nHow are you doing today?"
        }
      ]
    }
  ],
  "updated": "2025-11-26T12:25:15Z",
  "usage": {
    "input_tokens_by_modality": [
      {
        "modality": "text",
        "tokens": 7
      }
    ],
    "total_cached_tokens": 0,
    "total_input_tokens": 7,
    "total_output_tokens": 20,
    "total_thought_tokens": 22,
    "total_tokens": 49,
    "total_tool_use_tokens": 0
  }
}
```
**Multi-turn**

**REST**

```sh
curl -X POST https://generativelanguage.googleapis.com/v1beta/interactions \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.6-flash",
    "input": [
      { "type": "user_input", "content": [{ "type": "text", "text": "Hello!" }] },
      { "type": "model_output", "content": [{ "type": "text", "text": "Hi there! How can I help you today?" }] },
      { "type": "user_input", "content": [{ "type": "text", "text": "What is the capital of France?" }] }
    ]
  }'
```
**Python**

```python
from google import genai

client = genai.Client()
response = client.interactions.create(
    model="gemini-3.6-flash",
    input=[
        { "type": "user_input", "content": [{ "type": "text", "text": "Hello!" }] },
        { "type": "model_output", "content": [{ "type": "text", "text": "Hi there! How can I help you today?" }] },
        { "type": "user_input", "content": [{ "type": "text", "text": "What is the capital of France?" }] }
    ]
)
print(response.output_text)
```
**JavaScript**

```javascript
import {GoogleGenAI} from '@google/genai';

const ai = new GoogleGenAI({});
const interaction = await ai.interactions.create({
    model: 'gemini-3.6-flash',
    input: [
        { type: 'user_input', content: [{ type: 'text', text: 'Hello' }] },
        { type: 'model_output', content: [{ type: 'text', text: 'Hi there! How can I help you today?' }] },
        { type: 'user_input', content: [{ type: 'text', text: 'What is the capital of France?' }] }
    ]
});
console.log(interaction.output_text);
```
Response:
```json
{
  "created": "2025-11-26T12:22:47Z",
  "id": "v1_ChdPU0F4YWFtNkFwS2kxZThQZ05lbXdROBIXT1NBeGFhbTZBcEtpMWU4UGdOZW13UTg",
  "model": "gemini-3.6-flash",
  "object": "interaction",
  "status": "completed",
  "steps": [
    {
      "type": "model_output",
      "content": [
        {
          "type": "text",
          "text": "The capital of France is Paris."
        }
      ]
    }
  ],
  "updated": "2025-11-26T12:22:47Z",
  "usage": {
    "input_tokens_by_modality": [
      {
        "modality": "text",
        "tokens": 50
      }
    ],
    "total_cached_tokens": 0,
    "total_input_tokens": 50,
    "total_output_tokens": 10,
    "total_thought_tokens": 0,
    "total_tokens": 60,
    "total_tool_use_tokens": 0
  }
}
```
**Image Input**

**REST**

```sh
curl -X POST https://generativelanguage.googleapis.com/v1beta/interactions \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.6-flash",
    "input": [
      {
        "type": "text",
        "text": "What is in this picture?"
      },
      {
        "type": "image",
        "data": "BASE64_ENCODED_IMAGE",
        "mime_type": "image/png"
      }
    ]
  }'
```
**Python**

```python
from google import genai

client = genai.Client()
response = client.interactions.create(
    model="gemini-3.6-flash",
    input=[
      { "type": "text", "text": "What is in this picture?" },
      { "type": "image", "data": "BASE64_ENCODED_IMAGE", "mime_type": "image/png" }
    ]
)
print(response.output_text)
```
**JavaScript**

```javascript
import {GoogleGenAI} from '@google/genai';

const ai = new GoogleGenAI({});
const interaction = await ai.interactions.create({
    model: 'gemini-3.6-flash',
    input: [
      { type: 'text', text: 'What is in this picture?' },
      { type: 'image', data: 'BASE64_ENCODED_IMAGE', mime_type: 'image/png' }
    ]
});
console.log(interaction.output_text);
```
Response:
```json
{
  "created": "2025-11-26T12:22:47Z",
  "id": "v1_ChdPU0F4YWFtNkFwS2kxZThQZ05lbXdROBIXT1NBeGFhbTZBcEtpMWU4UGdOZW13UTg",
  "model": "gemini-3.6-flash",
  "object": "interaction",
  "status": "completed",
  "steps": [
    {
      "type": "model_output",
      "content": [
        {
          "type": "text",
          "text": "A white humanoid robot with glowing blue eyes stands holding a red skateboard."
        }
      ]
    }
  ],
  "updated": "2025-11-26T12:22:47Z",
  "usage": {
    "input_tokens_by_modality": [
      {
        "modality": "text",
        "tokens": 10
      },
      {
        "modality": "image",
        "tokens": 258
      }
    ],
    "total_cached_tokens": 0,
    "total_input_tokens": 268,
    "total_output_tokens": 20,
    "total_thought_tokens": 0,
    "total_tokens": 288,
    "total_tool_use_tokens": 0
  }
}
```
**Function Calling**

**REST**

```sh
curl -X POST https://generativelanguage.googleapis.com/v1beta/interactions \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.6-flash",
    "tools": [
      {
        "type": "function",
        "name": "get_weather",
        "description": "Get the current weather in a given location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {
              "type": "string",
              "description": "The city and state, e.g. San Francisco, CA"
            }
          },
          "required": [
            "location"
          ]
        }
      }
    ],
    "input": "What is the weather like in Boston, MA?"
  }'
```
**Python**

```python
from google import genai

client = genai.Client()
response = client.interactions.create(
    model="gemini-3.6-flash",
    tools=[{
        "type": "function",
        "name": "get_weather",
        "description": "Get the current weather in a given location",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "The city and state, e.g. San Francisco, CA"
                }
            },
            "required": ["location"]
        }
    }],
    input="What is the weather like in Boston, MA?"
)
print(response.steps[-1])
```
**JavaScript**

```javascript
import {GoogleGenAI} from '@google/genai';

const ai = new GoogleGenAI({});
const interaction = await ai.interactions.create({
    model: 'gemini-3.6-flash',
    tools: [{
        type: 'function',
        name: 'get_weather',
        description: 'Get the current weather in a given location',
        parameters: {
            type: 'object',
            properties: {
                location: {
                    type: 'string',
                    description: 'The city and state, e.g. San Francisco, CA'
                }
            },
            required: ['location']
        }
    }],
    input: 'What is the weather like in Boston, MA?'
});
console.log(interaction.steps.at(-1));
```
Response:
```json
{
  "created": "2025-11-26T12:22:47Z",
  "id": "v1_ChdPU0F4YWFtNkFwS2kxZThQZ05lbXdROBIXT1NBeGFhbTZBcEtpMWU4UGdOZW13UTg",
  "model": "gemini-3.6-flash",
  "object": "interaction",
  "status": "requires_action",
  "steps": [
    {
      "name": "get_weather",
      "type": "function_call",
      "arguments": {
        "location": "Boston, MA"
      },
      "id": "gth23981"
    }
  ],
  "updated": "2025-11-26T12:22:47Z",
  "usage": {
    "input_tokens_by_modality": [
      {
        "modality": "text",
        "tokens": 100
      }
    ],
    "total_cached_tokens": 0,
    "total_input_tokens": 100,
    "total_output_tokens": 25,
    "total_thought_tokens": 0,
    "total_tokens": 125,
    "total_tool_use_tokens": 50
  }
}
```
**Deep Research**

**REST**

```sh
curl -X POST https://generativelanguage.googleapis.com/v1beta/interactions \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "deep-research-pro-preview-12-2025",
    "input": "Find a cure to cancer",
    "background": true
  }'
```
**Python**

```python
from google import genai

client = genai.Client()
interaction = client.interactions.create(
    agent="deep-research-pro-preview-12-2025",
    input="find a cure to cancer",
    background=True,
)
print(interaction.status)
```
**JavaScript**

```javascript
import {GoogleGenAI} from '@google/genai';

const ai = new GoogleGenAI({});
const interaction = await ai.interactions.create({
    agent: 'deep-research-pro-preview-12-2025',
    input: 'find a cure to cancer',
    background: true,
});
console.log(interaction.status);
```
Response:
```json
{
  "agent": "deep-research-pro-preview-12-2025",
  "created": "2025-11-26T12:22:47Z",
  "id": "v1_ChdPU0F4YWFtNkFwS2kxZThQZ05lbXdROBIXT1NBeGFhbTZBcEtpMWU4UGdOZW13UTg",
  "object": "interaction",
  "status": "completed",
  "steps": [
    {
      "type": "model_output",
      "content": [
        {
          "type": "text",
          "text": "Here is a comprehensive research report on the current state of cancer research..."
        }
      ]
    }
  ],
  "updated": "2025-11-26T12:22:47Z",
  "usage": {
    "input_tokens_by_modality": [
      {
        "modality": "text",
        "tokens": 20
      }
    ],
    "total_cached_tokens": 0,
    "total_input_tokens": 20,
    "total_output_tokens": 1000,
    "total_thought_tokens": 500,
    "total_tokens": 1520,
    "total_tool_use_tokens": 0
  }
}
```
**Antigravity Agent**

**REST**

```sh
curl -X POST https://generativelanguage.googleapis.com/v1beta/interactions \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "antigravity-preview-05-2026",
    "input": "Read Hacker News, summarize the top 5 stories, and save results as a markdown file.",
    "environment": "remote"
  }'
```
**Python**

```python
from google import genai

client = genai.Client()
interaction = client.interactions.create(
    agent="antigravity-preview-05-2026",
    input="Read Hacker News, summarize the top 5 stories, and save results as a markdown file.",
    environment="remote",
)
print(interaction.output_text)
```
**JavaScript**

```javascript
import {GoogleGenAI} from '@google/genai';

const ai = new GoogleGenAI({});
const interaction = await ai.interactions.create({
    agent: 'antigravity-preview-05-2026',
    input: 'Read Hacker News, summarize the top 5 stories, and save results as a markdown file.',
    environment: 'remote',
});
console.log(interaction.output_text);
```
Response:
```json
{
  "agent": "antigravity-preview-05-2026",
  "created": "2025-11-26T12:22:47Z",
  "environment_id": "env_abc123",
  "id": "v1_ChdPU0F4YWFtNkFwS2kxZThQZ05lbXdROBIXT1NBeGFhbTZBcEtpMWU4UGdOZW13UTg",
  "object": "interaction",
  "status": "completed",
  "steps": [
    {
      "type": "model_output",
      "content": [
        {
          "type": "text",
          "text": "I've summarized the top 5 Hacker News stories and saved the results to /workspace/summary.md."
        }
      ]
    }
  ],
  "updated": "2025-11-26T12:22:47Z",
  "usage": {
    "input_tokens_by_modality": [
      {
        "modality": "text",
        "tokens": 50
      }
    ],
    "total_cached_tokens": 0,
    "total_input_tokens": 50,
    "total_output_tokens": 500,
    "total_thought_tokens": 200,
    "total_tokens": 750,
    "total_tool_use_tokens": 0
  }
}
```
**Reuse Environment**

**REST**

```sh
# Step 1: Create an interaction with a fresh remote environment.
RESPONSE=$(curl -s -X POST https://generativelanguage.googleapis.com/v1beta/interactions \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "antigravity-preview-05-2026",
    "input": "Write a hello world script at /workspace/hello.py.",
    "environment": "remote"
  }')
INTERACTION_ID=$(echo $RESPONSE | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
ENV_ID=$(echo $RESPONSE | python3 -c "import sys,json; print(json.load(sys.stdin)['environment_id'])")

# Step 2: Reuse the same environment in a follow-up interaction.
curl -X POST https://generativelanguage.googleapis.com/v1beta/interactions \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"agent\": \"antigravity-preview-05-2026\",
    \"input\": \"Modify the script to accept a name argument and greet the user.\",
    \"environment\": \"$ENV_ID\",
    \"previous_interaction_id\": \"$INTERACTION_ID\"
  }"
```
**Python**

```python
from google import genai

client = genai.Client()

# Step 1: Create an interaction with a fresh remote environment.
interaction = client.interactions.create(
    agent="antigravity-preview-05-2026",
    input="Write a hello world script at /workspace/hello.py.",
    environment="remote",
)
print(f"Environment ID: {interaction.environment_id}")

# Step 2: Reuse the same environment in a follow-up interaction.
interaction_2 = client.interactions.create(
    agent="antigravity-preview-05-2026",
    input="Modify the script to accept a name argument and greet the user.",
    environment=interaction.environment_id,
    previous_interaction_id=interaction.id,
)
print(interaction_2.output_text)
```
**JavaScript**

```javascript
import {GoogleGenAI} from '@google/genai';

const ai = new GoogleGenAI({});

// Step 1: Create an interaction with a fresh remote environment.
const interaction = await ai.interactions.create({
    agent: 'antigravity-preview-05-2026',
    input: 'Write a hello world script at /workspace/hello.py.',
    environment: 'remote',
});
console.log(`Environment ID: ${interaction.environment_id}`);

// Step 2: Reuse the same environment in a follow-up interaction.
const interaction2 = await ai.interactions.create({
    agent: 'antigravity-preview-05-2026',
    input: 'Modify the script to accept a name argument and greet the user.',
    environment: interaction.environment_id,
    previous_interaction_id: interaction.id,
});
console.log(interaction2.output_text);
```
Response:
```json
{
  "agent": "antigravity-preview-05-2026",
  "created": "2025-11-26T12:23:00Z",
  "environment_id": "env_abc123",
  "id": "v1_Chd2ZTJhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkwMTIzNDU2Nzg",
  "object": "interaction",
  "status": "completed",
  "steps": [
    {
      "type": "model_output",
      "content": [
        {
          "type": "text",
          "text": "I've updated /workspace/hello.py to accept a name argument and greet the user."
        }
      ]
    }
  ],
  "updated": "2025-11-26T12:23:00Z",
  "usage": {
    "input_tokens_by_modality": [
      {
        "modality": "text",
        "tokens": 80
      }
    ],
    "total_cached_tokens": 0,
    "total_input_tokens": 80,
    "total_output_tokens": 200,
    "total_thought_tokens": 100,
    "total_tokens": 380,
    "total_tool_use_tokens": 0
  }
}
```
**With Sources**

**REST**

```sh
curl -X POST https://generativelanguage.googleapis.com/v1beta/interactions \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "antigravity-preview-05-2026",
    "input": "List all files under /workspace and summarize what you find.",
    "environment": {
      "type": "remote",
      "sources": [
        {
          "type": "repository",
          "source": "https://github.com/octocat/Spoon-Knife",
          "target": "/workspace/repo"
        },
        {
          "type": "inline",
          "content": "Focus on Python files only.",
          "target": "/workspace/notes.txt"
        }
      ]
    }
  }'
```
**Python**

```python
from google import genai

client = genai.Client()
interaction = client.interactions.create(
    agent="antigravity-preview-05-2026",
    input="List all files under /workspace and summarize what you find.",
    environment={
        "type": "remote",
        "sources": [
            {
                "type": "repository",
                "source": "https://github.com/octocat/Spoon-Knife",
                "target": "/workspace/repo",
            },
            {
                "type": "inline",
                "content": "Focus on Python files only.",
                "target": "/workspace/notes.txt",
            },
        ],
    },
)
print(interaction.output_text)
```
**JavaScript**

```javascript
import {GoogleGenAI} from '@google/genai';

const ai = new GoogleGenAI({});
const interaction = await ai.interactions.create({
    agent: 'antigravity-preview-05-2026',
    input: 'List all files under /workspace and summarize what you find.',
    environment: {
        type: 'remote',
        sources: [
            {
                type: 'repository',
                source: 'https://github.com/octocat/Spoon-Knife',
                target: '/workspace/repo',
            },
            {
                type: 'inline',
                content: 'Focus on Python files only.',
                target: '/workspace/notes.txt',
            },
        ],
    },
});
console.log(interaction.output_text);
```
**Custom Agent**

**REST**

```sh
# Step 1: Create a custom agent.
curl -X POST https://generativelanguage.googleapis.com/v1beta/agents \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "code-reviewer",
    "base_agent": "antigravity-preview-05-2026",
    "system_instruction": "You are a senior code reviewer. Check every file for bugs, style issues, and security vulnerabilities.",
    "base_environment": {
      "type": "remote",
      "sources": [{
        "type": "repository",
        "source": "https://github.com/octocat/Spoon-Knife",
        "target": "/workspace/repo"
      }]
    }
  }'

# Step 2: Use the custom agent.
curl -X POST https://generativelanguage.googleapis.com/v1beta/interactions \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "code-reviewer",
    "input": "Review the latest changes in /workspace/repo/src and file a summary.",
    "environment": "remote"
  }'
```
**Python**

```python
import uuid
from google import genai

client = genai.Client()

# Step 1: Create a custom agent.
agent_id = f"code-reviewer-{uuid.uuid4().hex[:8]}"
client.agents.create(
    id=agent_id,
    base_agent="antigravity-preview-05-2026",
    system_instruction="You are a senior code reviewer. Check every file for bugs, style issues, and security vulnerabilities.",
    base_environment={
        "type": "remote",
        "sources": [{
            "type": "repository",
            "source": "https://github.com/octocat/Spoon-Knife",
            "target": "/workspace/repo",
        }],
    },
)

# Step 2: Use the custom agent.
result = client.interactions.create(
    agent=agent_id,
    input="Review the latest changes in /workspace/repo/src and file a summary.",
    environment="remote",
)
print(result.output_text)

```
**JavaScript**

```javascript
import {GoogleGenAI} from '@google/genai';

const ai = new GoogleGenAI({});

// Step 1: Create a custom agent.
const agentId = `code-reviewer-${crypto.randomUUID().slice(0, 8)}`;
await ai.agents.create({
    id: agentId,
    base_agent: 'antigravity-preview-05-2026',
    system_instruction: 'You are a senior code reviewer. Check every file for bugs, style issues, and security vulnerabilities.',
    base_environment: {
        type: 'remote',
        sources: [{
            type: 'repository',
            source: 'https://github.com/octocat/Spoon-Knife',
            target: '/workspace/repo',
        }],
    },
});

// Step 2: Use the custom agent.
const result = await ai.interactions.create({
    agent: agentId,
    input: 'Review the latest changes in /workspace/repo/src and file a summary.',
    environment: 'remote',
});
console.log(result.output_text);

```
---
### Canceling an interaction

`POST https://generativelanguage.googleapis.com/v1beta/interactions/{id}/cancel`

Cancels an interaction by id. This only applies to background interactions that are still running.

#### Parameters
- **api_version** (`string`) *(Required)* Which version of the API to use.

- **id** (`string`) *(Required)* The unique identifier of the interaction to cancel.


#### Response
Returns [Interaction](#interaction) resources.

#### Examples
**Cancel Interaction**

**REST**

```sh

curl -X POST "https://generativelanguage.googleapis.com/v1beta/interactions/$INTERACTION_ID/cancel" \
  -H "x-goog-api-key: $GEMINI_API_KEY"
```
**Python**

```python
from google import genai

client = genai.Client()

# Start a background interaction so it stays in-progress.
created = client.interactions.create(
    model="gemini-3.6-flash",
    input="Write a long essay about the history of computing.",
    tools=[{"type": "computer_use"}],
    background=True,
)

# Cancel the in-progress interaction.
interaction = client.interactions.cancel(id=created.id)
print(interaction.status)
```
**JavaScript**

```javascript
import {GoogleGenAI} from '@google/genai';

const ai = new GoogleGenAI({});

// Start a background interaction so it stays in-progress.
const created = await ai.interactions.create({
    model: 'gemini-3.6-flash',
    input: 'Write a long essay about the history of computing.',
    tools: [{ type: 'computer_use' }],
    background: true,
});

// Cancel the in-progress interaction.
const interaction = await ai.interactions.cancel(created.id);
console.log(interaction.status);
```
Response:
```json
{
  "agent": "deep-research-pro-preview-12-2025",
  "created": "2026-06-22T04:55:47Z",
  "id": "v1_ChdVc0E0YXJTYk1zYlV6N0lQcXRXVG1BYxIXVXNBNGFyU2JNc2JVejdJUHF0V1RtQWM",
  "status": "cancelled",
  "steps": [
    {
      "type": "user_input",
      "content": [
        {
          "type": "text",
          "text": "Research the history of the Google TPUs with a focus on 2025 specs."
        }
      ]
    }
  ],
  "updated": "2026-06-22T04:55:47Z"
}
```
---
### Retrieving an interaction

`GET https://generativelanguage.googleapis.com/v1beta/interactions/{id}`

Retrieves the full details of a single interaction based on its `Interaction.id`.

#### Parameters
- **api_version** (`string`) *(Required)* Which version of the API to use.

- **id** (`string`) *(Required)* The unique identifier of the interaction to retrieve.

- **last_event_id** (`string`) Optional. If set, resumes the interaction stream from the next chunk after the event marked by the event id. Can only be used if `stream` is true.

- **stream** (`boolean`) If set to true, the generated content will be streamed incrementally.
  Default: `False`


#### Response
Returns [Interaction](#interaction) resources.

#### Examples
**Get Interaction**

**REST**

```sh

curl -X GET "https://generativelanguage.googleapis.com/v1beta/interactions/$INTERACTION_ID" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
```
**Python**

```python
from google import genai

client = genai.Client()


interaction = client.interactions.get(id=created.id)
print(interaction.status)
```
**JavaScript**

```javascript
import {GoogleGenAI} from '@google/genai';

const ai = new GoogleGenAI({});


const interaction = await ai.interactions.get(created.id);
console.log(interaction.status);
```
Response:
```json
{
  "created": "2025-11-26T12:25:15Z",
  "id": "v1_ChdPU0F4YWFtNkFwS2kxZThQZ05lbXdROBIXT1NBeGFhbTZBcEtpMWU4UGdOZW13UTg",
  "model": "gemini-3.6-flash",
  "object": "interaction",
  "status": "completed",
  "steps": [
    {
      "type": "model_output",
      "content": [
        {
          "type": "text",
          "text": "I'm doing great, thank you for asking! How can I help you today?"
        }
      ]
    }
  ],
  "updated": "2025-11-26T12:25:15Z"
}
```
---
### Deleting an interaction

`DELETE https://generativelanguage.googleapis.com/v1beta/interactions/{id}`

Deletes the interaction by id.

#### Parameters
- **api_version** (`string`) *(Required)* Which version of the API to use.

- **id** (`string`) *(Required)* The unique identifier of the interaction to delete.


#### Response
Empty response.

#### Examples
**Delete**

**REST**

```sh

curl -X DELETE "https://generativelanguage.googleapis.com/v1beta/interactions/$INTERACTION_ID" \
  -H "x-goog-api-key: $GEMINI_API_KEY"
```
**Python**

```python
from google import genai

client = genai.Client()


client.interactions.delete(id=created.id)
print("Interaction deleted successfully.")
```
**JavaScript**

```javascript
import {GoogleGenAI} from '@google/genai';

const ai = new GoogleGenAI({});


await ai.interactions.delete(created.id);
console.log('Interaction deleted successfully.');
```
---

## Resources
### Interaction { #Resource:Interaction }
The Interaction resource.

**Properties:**
- **agent** (`AgentOption`) The name of the `Agent` used for generating the interaction.
  Possible values:
  - `deep-research-pro-preview-12-2025`: Gemini Deep Research Agent
  - `deep-research-preview-04-2026`: Gemini Deep Research Agent
  - `deep-research-max-preview-04-2026`: Gemini Deep Research Max Agent
  - `antigravity-preview-05-2026`: Use the Antigravity managed agent to perform multi-step tasks that require reasoning, file operations, and tool use.

- **agent_config** (`AntigravityAgentConfig or CodeMenderAgentConfig or DeepResearchAgentConfig or DynamicAgentConfig`) Configuration parameters for the agent interaction.
  **Possible Types:** (Discriminator: `type`)
  - **AntigravityAgentConfig**: Configuration for the Antigravity agent runtime. Provides server-side control over the agent's execution environment and tool configuration.
  - **max_total_tokens** (`string`)   Max total tokens for the agent run.

  - **model** (`string`)   The model to use for agent reasoning.

  - **type** (`object`) *(Required)*
    Value: `antigravity`
  - **DeepResearchAgentConfig**: Configuration for the Deep Research agent.
  - **collaborative_planning** (`boolean`)   Enables human-in-the-loop planning for the Deep Research agent. If set to true, the Deep Research agent will provide a research plan in its response. The agent will then proceed only if the user confirms the plan in the next turn.

  - **thinking_summaries** (`ThinkingSummaries`)   Whether to include thought summaries in the response.
    Possible values:
    - `auto`: Auto thinking summaries.
    - `none`: No thinking summaries.

  - **type** (`object`) *(Required)*
    Value: `deep-research`
  - **visualization** (`enum (string)`)   Whether to include visualizations in the response.
    Possible values:
    - `off`: Do not include visualizations.
    - `auto`: Automatically include visualizations.

  - **DynamicAgentConfig**: Configuration for dynamic agents.
  - **type** (`object`) *(Required)*
    Value: `dynamic`

- **created** (`string`) Output only. The time at which the response was created in ISO 8601 format (YYYY-MM-DDThh:mm:ssZ).

- **environment** (`<a href="#Resource:EnvironmentConfig">EnvironmentConfig</a> or string`) The environment configuration for the interaction. Can be an object specifying remote environment sources or a string referencing an existing environment ID.

- **environment_id** (`string`) Output only. The environment ID for the interaction. Only populated if environment config is set in the request.

- **errors** (`array (Error)`) Output only. Diagnostic faults / platform errors recorded on the interaction.
  - **code** (`string`)   A URI that identifies the error type.

  - **message** (`string`)   A human-readable error message.


- **generation_config** (`GenerationConfig`) Input only. Configuration parameters for the model interaction.
  - **max_output_tokens** (`integer`)   The maximum number of tokens to include in the response.

  - **seed** (`integer`)   Seed used in decoding for reproducibility.

  - **speech_config** (`SpeakerConfig or array (SpeechConfig)`)   Optional. Speech and multi-speaker configuration.
    - **speakers** (`array (SpeechConfig)`)     Individual speaker configurations.
      - **language** (`string`)       The language of the speech.

      - **speaker** (`string`)       The speaker's name, it should match the speaker name given in the prompt.

      - **voice** (`string`)       The voice of the speaker.


  - **stop_sequences** (`array (string)`)   A list of character sequences that will stop output interaction.

  - **thinking_level** (`ThinkingLevel`)   The level of thought tokens that the model should generate.
    Possible values:
    - `minimal`: Little to no thinking.
    - `low`: Low thinking level.
    - `medium`: Medium thinking level.
    - `high`: High thinking level.

  - **thinking_summaries** (`ThinkingSummaries`)   Whether to include thought summaries in the response.
    Possible values:
    - `auto`: Auto thinking summaries.
    - `none`: No thinking summaries.

  - **tool_choice** (`<a href="#Resource:ToolChoiceConfig">ToolChoiceConfig</a> or enum (string)`)   The tool choice configuration.
    Possible values:
    - `auto`: Auto tool choice.
    - `any`: Any tool choice.
    - `none`: No tool choice.
    - `validated`: Validated tool choice.

  - **transcription_config** (`TranscriptionConfig`)   Optional. Configuration for speech recognition (transcription). If present, ASR is enabled.
    - **custom_vocabulary** (`array (string)`)     Optional. A list of custom vocabulary phrases to bias the speech recognition model toward recognizing specific terms.

    - **language_codes** (`array (string)`)     Optional. BCP-47 language codes providing hints about the languages present in the audio. If omitted or empty, defaults to automatic language detection.

    - **mode** (`TranscriptionMode or enum (string)`)     Discriminated transcription mode options or enum.
      Possible values:
      - `verbatim`: Verbatim transcription mode.
      - `smart`: Smart transcription mode.
      **Possible Types:**
      - **SmartTranscriptionMode**: Configuration for smart transcription mode.
      - **type** (`object`) *(Required)*
        Value: `smart`
      - **VerbatimTranscriptionMode**: Configuration for verbatim transcription mode.
      - **diarization_mode** (`string`)       Optional. Configures speaker diarization. Supported values: "speaker".

      - **timestamp_granularities** (`array (string)`)       Optional. The granularity of timestamps to include in the transcription output. Supported values: "word". If empty, no timestamps are generated.

      - **type** (`object`) *(Required)*
        Value: `verbatim`


  - **video_config** (`VideoConfig`)   Configuration for video generation.
    - **task** (`enum (string)`)     Optional task mode for video generation. If not specified, the model automatically determines the appropriate mode based on the provided text prompt and input media.
      Possible values:
      - `text_to_video`: Generates video solely from a text prompt.
      - `image_to_video`: Generates video from one or two source images. The first image defines
the starting frame, and the optional second image defines the ending
frame.
      - `reference_to_video`: Generates video using reference media (such as images, audio, or video).
      - `edit`: Modifies an existing input video.
      - `extend`: Extends an existing input video.


- **id** (`string`) Required. Output only. A unique identifier for the interaction completion.
  Default: ``
- **input** (`<a href="#Resource:Content">Content</a> or array (<a href="#Resource:Content">Content</a>) or array (<a href="#Resource:Step">Step</a>) or string`) The input for the interaction.

- **labels** (`object`) The labels with user-defined metadata for the request.

- **model** (`ModelOption`) The name of the `Model` used for generating the interaction.
  Possible values:
  - `gemini-2.5-flash`: Our first hybrid reasoning model which supports a 1M token context window and has thinking budgets.
  - `gemini-2.5-pro`: Our state-of-the-art multipurpose model, which excels at coding and complex reasoning tasks.
  - `gemma-4-26b-a4b-it`: Gemma 4 26B A4B IT
  - `gemma-4-31b-it`: Gemma 4 31B IT
  - `gemini-flash-latest`: Latest release of Gemini Flash
  - `gemini-flash-lite-latest`: Latest release of Gemini Flash-Lite
  - `gemini-pro-latest`: Latest release of Gemini Pro
  - `gemini-2.5-flash-lite`: Our smallest and most cost effective model, built for at scale usage.
  - `gemini-2.5-flash-image`: Our native image generation model, optimized for speed, flexibility, and contextual understanding. Text input and output is priced the same as 2.5 Flash.
  - `gemini-3-flash-preview`: Our most intelligent model built for speed, combining frontier intelligence with superior search and grounding.
  - `gemini-3.1-pro-preview`: Our latest SOTA reasoning model with unprecedented depth and nuance, and powerful multimodal understanding and coding capabilities.
  - `gemini-3.1-pro-preview-customtools`: Gemini 3.1 Pro Preview optimized for custom tool usage
  - `gemini-3.1-flash-lite`: Our most cost-efficient model, optimized for high-volume agentic tasks, translation, and simple data processing.
  - `gemini-3-pro-image`: Gemini 3 Pro Image
  - `nano-banana-pro-preview`: Gemini 3 Pro Image Preview
  - `gemini-3.1-flash-image`: Gemini 3.1 Flash Image.
  - `gemini-3.5-flash`: Gemini 3.5 Flash - Our earlier Flash model, built for speed and foundational performance across routine, high-throughput workloads.
  - `gemini-3.6-flash`: Gemini 3.6 Flash - Our previous generation Flash model, balancing speed and multimodal capabilities across general agentic and everyday tasks.
  - `gemini-3.7-flash`: Gemini 3.7 Flash - Our high-speed, efficient Flash model built for everyday coding, agentic tool use, and reliable multi-step execution.
  - `gemini-3.8-flash`: Gemini 3.8 Flash - Our most intelligent Flash model, engineered for long-horizon software engineering, autonomous agents, and complex enterprise workflows.
  - `lyria-3-clip-preview`: Our low-latency, music generation model optimized for high-fidelity audio clips and precise rhythmic control.
  - `lyria-3-pro-preview`: Our advanced, full-song generative model with deep compositional understanding, optimized for precise structural control and complex transitions across diverse musical styles.
  - `gemini-robotics-er-1.6-preview`: Gemini Robotics-ER 1.6 Preview
  - `gemini-robotics-er-2-preview`: Gemini Robotics Embodied Reasoning 2 Preview

- **previous_interaction_id** (`string`) The ID of the previous interaction, if any.

- **response_format** (`<a href="#Resource:ResponseFormat">ResponseFormat</a> or array (<a href="#Resource:ResponseFormat">ResponseFormat</a>)`) Enforces that the generated response is a JSON object that complies with the JSON schema specified in this field.

- **safety_settings** (`array (SafetySetting)`) Safety settings for the interaction.

- **service_tier** (`ServiceTier`) The service tier for the interaction.
  Possible values:
  - `flex`: Flex service tier.
  - `standard`: Standard service tier.
  - `priority`: Priority service tier.

- **status** (`enum (string)`) *(Required)* Required. Output only. The status of the interaction.
  Possible values:
  - `in_progress`: The interaction is in progress.
  - `requires_action`: The interaction requires action/input from the user.
  - `completed`: The interaction is completed.
  - `failed`: The interaction failed.
  - `cancelled`: The interaction was cancelled.
  - `incomplete`: The interaction is completed, but contains incomplete results (e.g.
hitting max_tokens).
  - `budget_exceeded`: The interaction was halted because the token budget was exceeded.
  - `queued`: The interaction is queued, waiting for processing.

- **steps** (`array (<a href="#Resource:Step">Step</a>)`) Output only. The steps that make up the interaction, when included in the response.

- **system_instruction** (`string`) System instruction for the interaction.

- **tools** (`array (<a href="#Resource:Tool">Tool</a>)`) A list of tool declarations the model may call during interaction.

- **updated** (`string`) Output only. The time at which the response was last updated in ISO 8601 format (YYYY-MM-DDThh:mm:ssZ).

- **usage** (`Usage`) Output only. Statistics on the interaction request's token usage.
  - **cached_tokens_by_modality** (`array (ModalityTokens)`)   A breakdown of cached token usage by modality.
    - **modality** (`ResponseModality`)     The modality associated with the token count.
      Possible values:
      - `text`: Indicates the model should return text.
      - `image`: Indicates the model should return images.
      - `audio`: Indicates the model should return audio.
      - `video`: Indicates the model should return video.
      - `document`: Indicates the model should return documents.

    - **tokens** (`integer`)     Number of tokens for the modality.


  - **grounding_tool_count** (`array (GroundingToolCount)`)   Grounding tool count.
    - **count** (`integer`)     The number of grounding tool counts.

    - **type** (`enum (string)`)     The grounding tool type associated with the count.
      Possible values:
      - `google_search`: Grounding with Google Web Search and Image Search, & Web Grounding
for Enterprise.
      - `google_maps`: Grounding with Google Maps.


  - **input_tokens_by_modality** (`array (ModalityTokens)`)   A breakdown of input token usage by modality.
    - **modality** (`ResponseModality`)     The modality associated with the token count.
      Possible values:
      - `text`: Indicates the model should return text.
      - `image`: Indicates the model should return images.
      - `audio`: Indicates the model should return audio.
      - `video`: Indicates the model should return video.
      - `document`: Indicates the model should return documents.

    - **tokens** (`integer`)     Number of tokens for the modality.


  - **output_tokens_by_modality** (`array (ModalityTokens)`)   A breakdown of output token usage by modality.
    - **modality** (`ResponseModality`)     The modality associated with the token count.
      Possible values:
      - `text`: Indicates the model should return text.
      - `image`: Indicates the model should return images.
      - `audio`: Indicates the model should return audio.
      - `video`: Indicates the model should return video.
      - `document`: Indicates the model should return documents.

    - **tokens** (`integer`)     Number of tokens for the modality.


  - **tool_use_tokens_by_modality** (`array (ModalityTokens)`)   A breakdown of tool-use token usage by modality.
    - **modality** (`ResponseModality`)     The modality associated with the token count.
      Possible values:
      - `text`: Indicates the model should return text.
      - `image`: Indicates the model should return images.
      - `audio`: Indicates the model should return audio.
      - `video`: Indicates the model should return video.
      - `document`: Indicates the model should return documents.

    - **tokens** (`integer`)     Number of tokens for the modality.


  - **total_cached_tokens** (`integer`)   Number of tokens in the cached part of the prompt (the cached content).

  - **total_input_tokens** (`integer`)   Number of tokens in the prompt (context).

  - **total_output_tokens** (`integer`)   Total number of tokens across all the generated responses.

  - **total_thought_tokens** (`integer`)   Number of tokens of thoughts for thinking models.

  - **total_tokens** (`integer`)   Total token count for the interaction request (prompt + responses + other internal tokens).

  - **total_tool_use_tokens** (`integer`)   Number of tokens present in tool-use prompt(s).


- **webhook_config** (`WebhookConfig`) Optional. Webhook configuration for receiving notifications when the interaction completes.
  - **uris** (`array (string)`)   Optional. If set, these webhook URIs will be used for webhook events instead of the registered webhooks.

  - **user_metadata** (`object`)   Optional. The user metadata that will be returned on each event emission to the webhooks.


**JSON Representation:**
```json
{
  "created": "2025-12-04T15:01:45Z",
  "id": "v1_ChdXS0l4YWZXTk9xbk0xZThQczhEcmlROBIXV0tJeGFmV05PcW5NMWU4UHM4RHJpUTg",
  "model": "gemini-3.6-flash",
  "object": "interaction",
  "status": "completed",
  "steps": [
    {
      "type": "model_output",
      "content": [
        {
          "type": "text",
          "text": "Hello! I'm doing well, functioning as expected. Thank you for asking! How are you doing today?"
        }
      ]
    }
  ],
  "updated": "2025-12-04T15:01:45Z",
  "usage": {
    "input_tokens_by_modality": [
      {
        "modality": "text",
        "tokens": 7
      }
    ],
    "total_cached_tokens": 0,
    "total_input_tokens": 7,
    "total_output_tokens": 23,
    "total_thought_tokens": 49,
    "total_tokens": 79,
    "total_tool_use_tokens": 0
  }
}
```

**Examples**
**Example**

```json
{
  "created": "2025-12-04T15:01:45Z",
  "id": "v1_ChdXS0l4YWZXTk9xbk0xZThQczhEcmlROBIXV0tJeGFmV05PcW5NMWU4UHM4RHJpUTg",
  "model": "gemini-3.6-flash",
  "object": "interaction",
  "status": "completed",
  "steps": [
    {
      "type": "model_output",
      "content": [
        {
          "type": "text",
          "text": "Hello! I'm doing well, functioning as expected. Thank you for asking! How are you doing today?"
        }
      ]
    }
  ],
  "updated": "2025-12-04T15:01:45Z",
  "usage": {
    "input_tokens_by_modality": [
      {
        "modality": "text",
        "tokens": 7
      }
    ],
    "total_cached_tokens": 0,
    "total_input_tokens": 7,
    "total_output_tokens": 23,
    "total_thought_tokens": 49,
    "total_tokens": 79,
    "total_tool_use_tokens": 0
  }
}
```


## Data Models
### Content { #Resource:Content }
The content of the response.

**Polymorphic Types:** - **AudioContent**
    - An audio content block.
     - **channels** (`integer`)  The number of audio channels.

     - **data** (`string`)  The audio content.

     - **mime_type** (`enum (string)`)  The mime type of the audio.
   Possible values:
   - `audio/wav`: WAV audio format
   - `audio/mp3`: MP3 audio format
   - `audio/aiff`: AIFF audio format
   - `audio/aac`: AAC audio format
   - `audio/ogg`: OGG audio format
   - `audio/flac`: FLAC audio format
   - `audio/mpeg`: MPEG audio format
   - `audio/m4a`: M4A audio format
   - `audio/l16`: L16 audio format
   - `audio/opus`: OPUS audio format
   - `audio/alaw`: ALAW audio format
   - `audio/mulaw`: MULAW audio format
   - `audio/webm`: WEBM audio format

     - **sample_rate** (`integer`)  The sample rate of the audio.

     - **type** (`object`) *(Required)*
   Value: `audio`
     - **uri** (`string`)  The URI of the audio.

    **Examples**
    **Audio**


    ```json
    {
  "type": "audio",
  "data": "BASE64_ENCODED_AUDIO",
  "mime_type": "audio/wav"
}
    ```
- **DocumentContent**
    - A document content block.
     - **data** (`string`)  The document content.

     - **mime_type** (`enum (string)`)  The mime type of the document.
   Possible values:
   - `application/pdf`: PDF document format
   - `text/csv`: CSV document format

     - **type** (`object`) *(Required)*
   Value: `document`
     - **uri** (`string`)  The URI of the document.

    **Examples**
    **Document**


    ```json
    {
  "type": "document",
  "data": "BASE64_ENCODED_DOCUMENT",
  "mime_type": "application/pdf"
}
    ```
- **ImageContent**
    - An image content block.
     - **data** (`string`)  The image content.

     - **mime_type** (`enum (string)`)  The mime type of the image.
   Possible values:
   - `image/png`: PNG image format
   - `image/jpeg`: JPEG image format
   - `image/webp`: WebP image format
   - `image/heic`: HEIC image format
   - `image/heif`: HEIF image format
   - `image/gif`: GIF image format
   - `image/bmp`: BMP image format
   - `image/tiff`: TIFF image format

     - **resolution** (`MediaResolution`)  The resolution of the media.
   Possible values:
   - `low`: Low resolution.
   - `medium`: Medium resolution.
   - `high`: High resolution.
   - `ultra_high`: Ultra high resolution.

     - **type** (`object`) *(Required)*
   Value: `image`
     - **uri** (`string`)  The URI of the image.

    **Examples**
    **Image**


    ```json
    {
  "type": "image",
  "data": "BASE64_ENCODED_IMAGE",
  "mime_type": "image/png"
}
    ```
- **TextContent**
    - A text content block.
     - **annotations** (`array (Annotation)`)  Citation information for model-generated content.
   **Possible Types:**
   - **FileCitation**: A file citation annotation.
   - **custom_metadata** (`object`)    User provided metadata about the retrieved context.

   - **document_uri** (`string`)    The URI of the file.

   - **end_index** (`integer`)    End of the attributed segment, exclusive.

   - **file_name** (`string`)    The name of the file.

   - **media_id** (`string`)    Media ID in-case of image citations, if applicable.

   - **page_number** (`integer`)    Page number of the cited document, if applicable.

   - **source** (`string`)    Source attributed for a portion of the text.

   - **start_index** (`integer`)    Start of segment of the response that is attributed to this source.  Index indicates the start of the segment, measured in bytes.

   - **type** (`object`) *(Required)*
     Value: `file_citation`
   - **PlaceCitation**: A place citation annotation.
   - **end_index** (`integer`)    End of the attributed segment, exclusive.

   - **name** (`string`)    Title of the place.

   - **place_id** (`string`)    The ID of the place, in `places/{place_id}` format.

   - **review_snippets** (`array (ReviewSnippet)`)    Snippets of reviews that are used to generate answers about the features of a given place in Google Maps.
     - **review_id** (`string`)      The ID of the review snippet.

     - **title** (`string`)      Title of the review.

     - **url** (`string`)      A link that corresponds to the user review on Google Maps.


   - **start_index** (`integer`)    Start of segment of the response that is attributed to this source.  Index indicates the start of the segment, measured in bytes.

   - **type** (`object`) *(Required)*
     Value: `place_citation`
   - **url** (`string`)    URI reference of the place.

   - **UrlCitation**: A URL citation annotation.
   - **end_index** (`integer`)    End of the attributed segment, exclusive.

   - **start_index** (`integer`)    Start of segment of the response that is attributed to this source.  Index indicates the start of the segment, measured in bytes.

   - **title** (`string`)    The title of the URL.

   - **type** (`object`) *(Required)*
     Value: `url_citation`
   - **url** (`string`)    The URL.

   - **WordInfo**: Word-level ASR annotation for transcription output. Carries the word text, optional timing, and optional speaker attribution.
   - **end_index** (`integer`)    End of the attributed segment, exclusive.

   - **end_offset** (`string`)    End offset in time of the word relative to the start of the audio. Present when timestamp_granularities contains "word".

   - **speaker** (`string`)    Optional. Speaker label for this word (e.g. "spk_1", "spk_2"). Present when diarization_mode is set in TranscriptionConfig.

   - **start_index** (`integer`)    Start of segment of the response that is attributed to this source.  Index indicates the start of the segment, measured in bytes.

   - **start_offset** (`string`)    Start offset in time of the word relative to the start of the audio. Present when timestamp_granularities contains "word".

   - **text** (`string`)    The transcribed word.

   - **type** (`object`) *(Required)*
     Value: `word_info`

     - **text** (`string`) *(Required)*  Required. The text content.

     - **type** (`object`) *(Required)*
   Value: `text`
    **Examples**
    **Text**


    ```json
    {
  "type": "text",
  "text": "Hello, how are you?"
}
    ```
- **VideoContent**
    - A video content block.
     - **data** (`string`)  The video content.

     - **mime_type** (`enum (string)`)  The mime type of the video.
   Possible values:
   - `video/mp4`: MP4 video format
   - `video/mpeg`: MPEG video format
   - `video/mpg`: MPG video format
   - `video/mov`: MOV video format
   - `video/avi`: AVI video format
   - `video/x-flv`: FLV video format
   - `video/webm`: WebM video format
   - `video/wmv`: WMV video format
   - `video/3gpp`: 3GPP video format

     - **name** (`string`)  A user-defined name for this content block. Can be referenced by the model in the final response.

     - **processing** (`MediaProcessing or enum (string)`)  How the model processes this video for understanding.
   Possible values:
   - `static`: Fixed-rate frame extraction. All frames placed in context.
   - `agentic`: Model-driven dynamic navigation.

     - **resolution** (`MediaResolution`)  The resolution of the media.
   Possible values:
   - `low`: Low resolution.
   - `medium`: Medium resolution.
   - `high`: High resolution.
   - `ultra_high`: Ultra high resolution.

     - **type** (`object`) *(Required)*
   Value: `video`
     - **uri** (`string`)  The URI of the video.

    **Examples**
    **Video**


    ```json
    {
  "type": "video",
  "uri": "https://www.youtube.com/watch?v=9hE5-98ZeCg"
}
    ```

**JSON Representation:**
```json
{
  "channels": 0,
  "data": "string",
  "mime_type": "audio/wav",
  "sample_rate": 0,
  "type": {},
  "uri": "string"
}
```


### Tool { #Resource:Tool }
A tool that can be used by the model.

**Polymorphic Types:** - **CodeExecution**
    - A tool that can be used by the model to execute code.
     - **type** (`object`) *(Required)*
   Value: `code_execution`
    **Examples**
    **code_execution**

    ```sh
    curl -X POST https://generativelanguage.googleapis.com/v1beta/interactions \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.6-flash",
    "tools": [{
      "type": "code_execution"
    }],
    "input": "Calculate the first 10 Fibonacci numbers"
  }'

    ```
    **code_execution**

    ```python
    from google import genai

client = genai.Client()
response = client.interactions.create(
    model="gemini-3.6-flash",
    tools=[{"type": "code_execution"}],
    input="Calculate the first 10 Fibonacci numbers"
)
print(response.output_text)

    ```
    **code_execution**

    ```javascript
    import {GoogleGenAI} from '@google/genai';

const ai = new GoogleGenAI({});
const interaction = await ai.interactions.create({
    model: 'gemini-3.6-flash',
    tools: [{ type: 'code_execution' }],
    input: 'Calculate the first 10 Fibonacci numbers'
});
console.log(interaction.output_text);

    ```
    **code_execution**

    ```java
    import com.google.genai.Client;
import com.google.genai.gaos.models.interactions.CodeExecution;
import com.google.genai.gaos.models.interactions.CreateModelInteraction;
import com.google.genai.gaos.models.interactions.Interaction;
import com.google.genai.gaos.models.interactions.InteractionsInput;
import com.google.genai.gaos.models.operations.CreateInteractionRequestBody;
import com.google.genai.gaos.models.operations.CreateInteractionResponse;
import java.util.List;

Client client = new Client();
CreateModelInteraction params =
    CreateModelInteraction.builder()
        .model("gemini-3.6-flash")
        .tools(List.of(new CodeExecution()))
        .input(InteractionsInput.of("Calculate the first 10 Fibonacci numbers"))
        .build();
CreateInteractionResponse response =
    client.interactions.create(CreateInteractionRequestBody.of(params));
Interaction interaction =
    response.interaction().orElseThrow(() -> new RuntimeException("No interaction returned"));
System.out.println(interaction.outputText().orElse(""));

    ```
- **ComputerUse**
    - A tool that can be used by the model to interact with the computer.
     - **disabled_safety_policies** (`array (enum (string))`)  Optional. Disabled safety policies for computer use.
   Possible values:
   - `financial_transactions`: Safety policy for financial transactions.
   - `sensitive_data_modification`: Safety policy for sensitive data modification.
   - `communication_tool`: Safety policy for communication tools (e.g. Gmail, Chat, Meet).
   - `account_creation`: Safety policy for account creation.
   - `data_modification`: Safety policy for data modification.
   - `user_consent_management`: Safety policy for user consent management.
   - `legal_terms_and_agreements`: Safety policy for legal terms and agreements.

     - **enable_prompt_injection_detection** (`boolean`)  Whether enable the prompt injection detection check on computer-use request.

     - **environment** (`enum (string)`)  The environment being operated.
   Possible values:
   - `browser`: Operates in a web browser.
   - `mobile`: Operates in a mobile environment.
   - `desktop`: Operates in a desktop environment.

     - **excluded_predefined_functions** (`array (string)`)  The list of predefined functions that are excluded from the model call.

     - **type** (`object`) *(Required)*
   Value: `computer_use`
    **Examples**
    **computer_use**

    ```sh
    curl -X POST https://generativelanguage.googleapis.com/v1beta/interactions \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-computer-use-preview-10-2025",
    "tools": [{
      "type": "computer_use"
    }],
    "input": "Find a flight to Tokyo"
  }'

    ```
    **computer_use**

    ```python
    from google import genai

client = genai.Client()
response = client.interactions.create(
    model="gemini-2.5-computer-use-preview-10-2025",
    tools=[{"type": "computer_use"}],
    input="Find a flight to Tokyo"
)
print(response.output_text)

    ```
    **computer_use**

    ```javascript
    import {GoogleGenAI} from '@google/genai';

const ai = new GoogleGenAI({});
const interaction = await ai.interactions.create({
    model: 'gemini-2.5-computer-use-preview-10-2025',
    tools: [{ type: 'computer_use'}],
    input: 'Find a flight to Tokyo'
});
console.log(interaction.output_text);

    ```
    **computer_use**

    ```java
    import com.google.genai.Client;
import com.google.genai.gaos.models.interactions.ComputerUse;
import com.google.genai.gaos.models.interactions.CreateModelInteraction;
import com.google.genai.gaos.models.interactions.Interaction;
import com.google.genai.gaos.models.interactions.InteractionsInput;
import com.google.genai.gaos.models.operations.CreateInteractionRequestBody;
import com.google.genai.gaos.models.operations.CreateInteractionResponse;
import java.util.List;

Client client = new Client();
CreateModelInteraction params =
    CreateModelInteraction.builder()
        .model("gemini-2.5-computer-use-preview-10-2025")
        .tools(List.of(new ComputerUse()))
        .input(InteractionsInput.of("Find a flight to Tokyo"))
        .build();
CreateInteractionResponse response =
    client.interactions.create(CreateInteractionRequestBody.of(params));
Interaction interaction =
    response.interaction().orElseThrow(() -> new RuntimeException("No interaction returned"));
System.out.println(interaction.outputText().orElse(""));

    ```
- **FileSearch**
    - A tool that can be used by the model to search files.
     - **file_search_store_names** (`array (string)`)  The file search store names to search.

     - **metadata_filter** (`string`)  Metadata filter to apply to the semantic retrieval documents and chunks.

     - **top_k** (`integer`)  The number of semantic retrieval chunks to retrieve.

     - **type** (`object`) *(Required)*
   Value: `file_search`
    **Examples**
    **file_search**

    ```sh
    curl -X POST https://generativelanguage.googleapis.com/v1beta/interactions \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.6-flash",
    "tools": [{
      "type": "file_search",
      "file_search_store_names": ["fileSearchStores/m64d1sevsr4y-xfyawui3fxqg"]
    }],
    "input": "Who is the author of the book?"
  }'

    ```
    **file_search**

    ```python
    from google import genai

client = genai.Client()

# Create a file search store so we have a valid one to use.
store = client.file_search_stores.create()

response = client.interactions.create(
    model="gemini-3.6-flash",
    tools=[{
        "type": "file_search",
        "file_search_store_names": [store.name]
    }],
    input="What documents are available?"
)
print(response.output_text)

# [cleanup]
client.file_search_stores.delete(name=store.name)
# [/cleanup]

    ```
    **file_search**

    ```javascript
    import {GoogleGenAI} from '@google/genai';

const ai = new GoogleGenAI({});

// Create a file search store so we have a valid one to use.
const store = await ai.fileSearchStores.create({});
if (!store.name) {
    throw new Error('Store creation failed: Name is undefined');
}

const interaction = await ai.interactions.create({
    model: 'gemini-3.6-flash',
    tools: [{
        type: 'file_search',
        file_search_store_names: [store.name]
    }],
    input: 'What documents are available?'
});
console.log(interaction.output_text);

// [cleanup]
await ai.fileSearchStores.delete({name: store.name});
// [/cleanup]

    ```
    **file_search**

    ```java
    import com.google.genai.Client;
import com.google.genai.gaos.models.interactions.CreateModelInteraction;
import com.google.genai.gaos.models.interactions.FileSearch;
import com.google.genai.gaos.models.interactions.Interaction;
import com.google.genai.gaos.models.interactions.InteractionsInput;
import com.google.genai.gaos.models.operations.CreateInteractionRequestBody;
import com.google.genai.gaos.models.operations.CreateInteractionResponse;
import com.google.genai.types.CreateFileSearchStoreConfig;
import com.google.genai.types.FileSearchStore;
import java.util.List;

Client client = new Client();

// Create a file search store so we have a valid one to use.
FileSearchStore store = client.fileSearchStores.create(CreateFileSearchStoreConfig.builder().build());
String storeName = store.name().orElseThrow();

FileSearch tool = FileSearch.builder()
    .fileSearchStoreNames(List.of(storeName))
    .build();
CreateModelInteraction params =
    CreateModelInteraction.builder()
        .model("gemini-3.6-flash")
        .tools(List.of(tool))
        .input(InteractionsInput.of("What documents are available?"))
        .build();
CreateInteractionResponse response =
    client.interactions.create(CreateInteractionRequestBody.of(params));
Interaction interaction =
    response.interaction().orElseThrow(() -> new RuntimeException("No interaction returned"));
System.out.println(interaction.outputText().orElse(""));

// [cleanup]
client.fileSearchStores.delete(storeName, null);
// [/cleanup]

    ```
- **Function**
    - A tool that can be used by the model.
     - **description** (`string`)  A description of the function.

     - **name** (`string`)  The name of the function.

     - **parameters** (`object`)  The JSON Schema for the function's parameters.

     - **type** (`object`) *(Required)*
   Value: `function`
    **Examples**
    **function_calling**

    ```sh
    curl -X POST https://generativelanguage.googleapis.com/v1beta/interactions \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.6-flash",
    "tools": [{
      "type": "function",
      "name": "get_weather",
      "description": "Get the current weather in a given location",
      "parameters": {
        "type": "object",
        "properties": {
          "location": {
            "type": "string",
            "description": "The city and state, e.g. San Francisco, CA"
          }
        },
        "required": ["location"]
      }
    }],
    "input": "What is the weather like in Boston, MA?"
  }'

    ```
    **function_calling**

    ```python
    from google import genai

client = genai.Client()
response = client.interactions.create(
    model="gemini-3.6-flash",
    tools=[{
        "type": "function",
        "name": "get_weather",
        "description": "Get the current weather in a given location",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "The city and state, e.g. San Francisco, CA"
                }
            },
            "required": ["location"]
        }
    }],
    input="What is the weather like in Boston?"
)
print(response.steps[-1])

    ```
    **function_calling**

    ```javascript
    import {GoogleGenAI} from '@google/genai';

const ai = new GoogleGenAI({});
const interaction = await ai.interactions.create({
    model: 'gemini-3.6-flash',
    tools: [{
        type: 'function',
        name: 'get_weather',
        description: 'Get the current weather in a given location',
        parameters: {
            type: 'object',
            properties: {
                location: {
                    type: 'string',
                    description: 'The city and state, e.g. San Francisco, CA'
                }
            },
            required: ['location']
        }
    }],
    input: 'What is the weather like in Boston?'
});
console.log(interaction.steps.at(-1));

    ```
    **function_calling**

    ```java
    import com.google.genai.Client;
import com.google.genai.gaos.models.interactions.CreateModelInteraction;
import com.google.genai.gaos.models.interactions.Function;
import com.google.genai.gaos.models.interactions.Interaction;
import com.google.genai.gaos.models.interactions.InteractionsInput;
import com.google.genai.gaos.models.interactions.Step;
import com.google.genai.gaos.models.operations.CreateInteractionRequestBody;
import com.google.genai.gaos.models.operations.CreateInteractionResponse;
import java.util.List;
import java.util.Map;

Client client = new Client();
Map<String, Object> parameters = Map.of(
    "type", "object",
    "properties", Map.of(
        "location", Map.of(
            "type", "string",
            "description", "The city and state, e.g. San Francisco, CA"
        )
    ),
    "required", List.of("location")
);
Function functionTool = Function.builder()
    .name("get_weather")
    .description("Get the current weather in a given location")
    .parameters(parameters)
    .build();
CreateModelInteraction params =
    CreateModelInteraction.builder()
        .model("gemini-3.6-flash")
        .tools(List.of(functionTool))
        .input(InteractionsInput.of("What is the weather like in Boston?"))
        .build();
CreateInteractionResponse response =
    client.interactions.create(CreateInteractionRequestBody.of(params));
Interaction interaction =
    response.interaction().orElseThrow(() -> new RuntimeException("No interaction returned"));
List<Step> steps = interaction.steps().orElse(List.of());
if (!steps.isEmpty()) {
  System.out.println(steps.get(steps.size() - 1));
}

    ```
- **GoogleMaps**
    - A tool that can be used by the model to call Google Maps.
     - **enable_widget** (`boolean`)  Whether to return a widget context token in the tool call result of the response.

     - **latitude** (`number`)  The latitude of the user's location.

     - **longitude** (`number`)  The longitude of the user's location.

     - **type** (`object`) *(Required)*
   Value: `google_maps`
    **Examples**
    **google_maps**

    ```sh
    curl -X POST https://generativelanguage.googleapis.com/v1beta/interactions \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.6-flash",
    "tools": [{
      "type": "google_maps",
      "latitude": 37.7749,
      "longitude": -122.4194
    }],
    "input": "What is the best food near me?"
  }'

    ```
    **google_maps**

    ```python
    from google import genai

client = genai.Client()
response = client.interactions.create(
    model="gemini-3.6-flash",
    tools=[{
        "type": "google_maps",
        "latitude": 37.7749,
        "longitude": -122.4194
    }],
    input="What is the best food near me?"
)
print(response.output_text)

    ```
    **google_maps**

    ```javascript
    import {GoogleGenAI} from '@google/genai';

const ai = new GoogleGenAI({});
const interaction = await ai.interactions.create({
    model: 'gemini-3.6-flash',
    tools: [{
        type: 'google_maps',
        latitude: 37.7749,
        longitude: -122.4194
    }],
    input: 'What is the best food near me?'
});
console.log(interaction.output_text);

    ```
    **google_maps**

    ```java
    import com.google.genai.Client;
import com.google.genai.gaos.models.interactions.CreateModelInteraction;
import com.google.genai.gaos.models.interactions.GoogleMaps;
import com.google.genai.gaos.models.interactions.Interaction;
import com.google.genai.gaos.models.interactions.InteractionsInput;
import com.google.genai.gaos.models.operations.CreateInteractionRequestBody;
import com.google.genai.gaos.models.operations.CreateInteractionResponse;
import java.util.List;

Client client = new Client();
GoogleMaps tool = GoogleMaps.builder()
    .latitude(37.7749)
    .longitude(-122.4194)
    .build();
CreateModelInteraction params =
    CreateModelInteraction.builder()
        .model("gemini-3.6-flash")
        .tools(List.of(tool))
        .input(InteractionsInput.of("What is the best food near me?"))
        .build();
CreateInteractionResponse response =
    client.interactions.create(CreateInteractionRequestBody.of(params));
Interaction interaction =
    response.interaction().orElseThrow(() -> new RuntimeException("No interaction returned"));
System.out.println(interaction.outputText().orElse(""));

    ```
- **GoogleSearch**
    - A tool that can be used by the model to search Google.
     - **search_types** (`array (enum (string))`)  The types of search grounding to enable.
   Possible values:
   - `web_search`: Setting this field enables web search. Only text results are returned.
   - `image_search`: Setting this field enables image search. Image bytes are returned.

     - **type** (`object`) *(Required)*
   Value: `google_search`
    **Examples**
    **google_search**

    ```sh
    curl -X POST https://generativelanguage.googleapis.com/v1beta/interactions \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.6-flash",
    "tools": [{
      "type": "google_search"
    }],
    "input": "Who is the current president of France?"
  }'

    ```
    **google_search**

    ```python
    from google import genai

client = genai.Client()
response = client.interactions.create(
    model="gemini-3.6-flash",
    tools=[{"type": "google_search"}],
    input="Who is the current president of France?"
)
print(response.output_text)

    ```
    **google_search**

    ```javascript
    import {GoogleGenAI} from '@google/genai';

const ai = new GoogleGenAI({});
const interaction = await ai.interactions.create({
    model: 'gemini-3.6-flash',
    tools: [{ type: 'google_search' }],
    input: 'Who is the current president of France?'
});
console.log(interaction.output_text);

    ```
    **google_search**

    ```java
    import com.google.genai.Client;
import com.google.genai.gaos.models.interactions.CreateModelInteraction;
import com.google.genai.gaos.models.interactions.GoogleSearch;
import com.google.genai.gaos.models.interactions.Interaction;
import com.google.genai.gaos.models.interactions.InteractionsInput;
import com.google.genai.gaos.models.operations.CreateInteractionRequestBody;
import com.google.genai.gaos.models.operations.CreateInteractionResponse;
import java.util.List;

Client client = new Client();
CreateModelInteraction params =
    CreateModelInteraction.builder()
        .model("gemini-3.6-flash")
        .tools(List.of(new GoogleSearch()))
        .input(InteractionsInput.of("Who is the current president of France?"))
        .build();
CreateInteractionResponse response =
    client.interactions.create(CreateInteractionRequestBody.of(params));
Interaction interaction =
    response.interaction().orElseThrow(() -> new RuntimeException("No interaction returned"));
System.out.println(interaction.outputText().orElse(""));

    ```
- **McpServer**
    - A MCPServer is a server that can be called by the model to perform actions.
     - **allowed_tools** (`array (AllowedTools)`)  The allowed tools.
   - **mode** (`enum (string)`)    The mode of the tool choice.
     Possible values:
     - `auto`: Auto tool choice.
     - `any`: Any tool choice.
     - `none`: No tool choice.
     - `validated`: Validated tool choice.

   - **tools** (`array (string)`)    The names of the allowed tools.


     - **headers** (`object`)  Optional: Fields for authentication headers, timeouts, etc., if needed.

     - **name** (`string`)  The name of the MCPServer.

     - **type** (`object`) *(Required)*
   Value: `mcp_server`
     - **url** (`string`)  The full URL for the MCPServer endpoint. Example: "https://api.example.com/mcp"

    **Examples**
    **mcp_server**

    ```sh
    curl -X POST https://generativelanguage.googleapis.com/v1beta/interactions \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.6-flash",
    "tools": [{
      "type": "mcp_server",
      "name": "weather_service",
      "url": "https://gemini-api-demos.uc.r.appspot.com/mcp"
    }],
    "input": "Today is 12-05-2025, what is the temperature today in London?"
  }'

    ```
    **mcp_server**

    ```python
    from google import genai

client = genai.Client()
response = client.interactions.create(
    model="gemini-3.6-flash",
    tools=[{
        "type": "mcp_server",
        "name": "weather_service",
        "url": "https://gemini-api-demos.uc.r.appspot.com/mcp"
    }],
    input="Today is 12-05-2025, what is the temperature today in London?"
)
print(response.output_text)

    ```
    **mcp_server**

    ```javascript
    import {GoogleGenAI} from '@google/genai';

const ai = new GoogleGenAI({});
const interaction = await ai.interactions.create({
    model: 'gemini-3.6-flash',
    tools: [{
        type: 'mcp_server',
        name: 'weather_service',
        url: 'https://gemini-api-demos.uc.r.appspot.com/mcp'
    }],
    input: 'Today is 12-05-2025, what is the temperature today in London?'
});
console.log(interaction.output_text);

    ```
    **mcp_server**

    ```java
    import com.google.genai.Client;
import com.google.genai.gaos.models.interactions.CreateModelInteraction;
import com.google.genai.gaos.models.interactions.Interaction;
import com.google.genai.gaos.models.interactions.InteractionsInput;
import com.google.genai.gaos.models.interactions.MCPServer;
import com.google.genai.gaos.models.operations.CreateInteractionRequestBody;
import com.google.genai.gaos.models.operations.CreateInteractionResponse;
import java.util.List;

Client client = new Client();
MCPServer mcpTool = MCPServer.builder()
    .name("weather_service")
    .url("https://gemini-api-demos.uc.r.appspot.com/mcp")
    .build();
CreateModelInteraction params =
    CreateModelInteraction.builder()
        .model("gemini-3.6-flash")
        .tools(List.of(mcpTool))
        .input(InteractionsInput.of("Today is 12-05-2025, what is the temperature today in London?"))
        .build();
CreateInteractionResponse response =
    client.interactions.create(CreateInteractionRequestBody.of(params));
Interaction interaction =
    response.interaction().orElseThrow(() -> new RuntimeException("No interaction returned"));
System.out.println(interaction.outputText().orElse(""));

    ```
- **UrlContext**
    - A tool that can be used by the model to fetch URL context.
     - **type** (`object`) *(Required)*
   Value: `url_context`
    **Examples**
    **url_context**

    ```sh
    curl -X POST https://generativelanguage.googleapis.com/v1beta/interactions \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-3.6-flash",
    "tools": [{
      "type": "url_context"
    }],
    "input": "Summarize https://www.example.com"
  }'

    ```
    **url_context**

    ```python
    from google import genai

client = genai.Client()
response = client.interactions.create(
    model="gemini-3.6-flash",
    tools=[{"type": "url_context"}],
    input="Summarize https://www.example.com"
)
print(response.output_text)

    ```
    **url_context**

    ```javascript
    import {GoogleGenAI} from '@google/genai';

const ai = new GoogleGenAI({});
const interaction = await ai.interactions.create({
    model: 'gemini-3.6-flash',
    tools: [{ type: 'url_context' }],
    input: 'Summarize https://www.example.com'
});
console.log(interaction.output_text);

    ```
    **url_context**

    ```java
    import com.google.genai.Client;
import com.google.genai.gaos.models.interactions.CreateModelInteraction;
import com.google.genai.gaos.models.interactions.Interaction;
import com.google.genai.gaos.models.interactions.InteractionsInput;
import com.google.genai.gaos.models.interactions.URLContext;
import com.google.genai.gaos.models.operations.CreateInteractionRequestBody;
import com.google.genai.gaos.models.operations.CreateInteractionResponse;
import java.util.List;

Client client = new Client();
CreateModelInteraction params =
    CreateModelInteraction.builder()
        .model("gemini-3.6-flash")
        .tools(List.of(new URLContext()))
        .input(InteractionsInput.of("Summarize https://www.example.com"))
        .build();
CreateInteractionResponse response =
    client.interactions.create(CreateInteractionRequestBody.of(params));
Interaction interaction =
    response.interaction().orElseThrow(() -> new RuntimeException("No interaction returned"));
System.out.println(interaction.outputText().orElse(""));

    ```

**JSON Representation:**
```json
{
  "type": {}
}
```


### InteractionSseEvent { #Resource:InteractionSseEvent }


**Polymorphic Types:** (Discriminator: `event_type`)- **ErrorEvent**
    -
     - **error** (`Error`)
   - **code** (`string`)    A URI that identifies the error type.

   - **message** (`string`)    A human-readable error message.


     - **event_id** (`string`)  The event_id token to be used to resume the interaction stream, from this event.

     - **event_type** (`object`) *(Required)*
   Value: `error`
    **Examples**
    **Error Event**


    ```json
    {
  "error": {
    "code": "not_found",
    "message": "Failed to get completed interaction: Result not found."
  },
  "event_type": "error"
}
    ```
- **InteractionCompletedEvent**
    -
     - **event_id** (`string`)  The event_id token to be used to resume the interaction stream, from this event.

     - **event_type** (`object`) *(Required)*
   Value: `interaction.completed`
     - **interaction** (`InteractionSseEventInteraction`) *(Required)*  Partial completed interaction resource emitted at the end of the stream.
   - **agent** (`string`)    The agent to interact with.

   - **created** (`string`)    Output only. The time at which the response was created in ISO 8601 format.

   - **id** (`string`) *(Required)*    Required. Output only. A unique identifier for the interaction completion.

   - **model** (`string`)    The model that will complete your prompt.

   - **object** (`string`)    Output only. The resource type.

   - **service_tier** (`ServiceTier`)    The service tier for the interaction.
     Possible values:
     - `flex`: Flex service tier.
     - `standard`: Standard service tier.
     - `priority`: Priority service tier.

   - **status** (`enum (string)`) *(Required)*    Required. Output only. The status of the interaction.
     Possible values:
     - `in_progress`: The interaction is in progress.
     - `requires_action`: The interaction requires action/input from the user.
     - `completed`: The interaction is completed.
     - `failed`: The interaction failed.
     - `cancelled`: The interaction was cancelled.
     - `incomplete`: The interaction is completed, but contains incomplete results (e.g. hitting max_tokens).

   - **steps** (`array (<a href="#Resource:Step">Step</a>)`)    Output only. The steps that make up the interaction, if included in this event.

   - **updated** (`string`)    Output only. The time at which the response was last updated in ISO 8601 format.

   - **usage** (`Usage`)    Output only. Statistics on the interaction request's token usage.
     - **cached_tokens_by_modality** (`array (ModalityTokens)`)      A breakdown of cached token usage by modality.
       - **modality** (`ResponseModality`)        The modality associated with the token count.
         Possible values:
         - `text`: Indicates the model should return text.
         - `image`: Indicates the model should return images.
         - `audio`: Indicates the model should return audio.
         - `video`: Indicates the model should return video.
         - `document`: Indicates the model should return documents.

       - **tokens** (`integer`)        Number of tokens for the modality.


     - **grounding_tool_count** (`array (GroundingToolCount)`)      Grounding tool count.
       - **count** (`integer`)        The number of grounding tool counts.

       - **type** (`enum (string)`)        The grounding tool type associated with the count.
         Possible values:
         - `google_search`: Grounding with Google Web Search and Image Search, & Web Grounding
for Enterprise.
         - `google_maps`: Grounding with Google Maps.


     - **input_tokens_by_modality** (`array (ModalityTokens)`)      A breakdown of input token usage by modality.
       - **modality** (`ResponseModality`)        The modality associated with the token count.
         Possible values:
         - `text`: Indicates the model should return text.
         - `image`: Indicates the model should return images.
         - `audio`: Indicates the model should return audio.
         - `video`: Indicates the model should return video.
         - `document`: Indicates the model should return documents.

       - **tokens** (`integer`)        Number of tokens for the modality.


     - **output_tokens_by_modality** (`array (ModalityTokens)`)      A breakdown of output token usage by modality.
       - **modality** (`ResponseModality`)        The modality associated with the token count.
         Possible values:
         - `text`: Indicates the model should return text.
         - `image`: Indicates the model should return images.
         - `audio`: Indicates the model should return audio.
         - `video`: Indicates the model should return video.
         - `document`: Indicates the model should return documents.

       - **tokens** (`integer`)        Number of tokens for the modality.


     - **tool_use_tokens_by_modality** (`array (ModalityTokens)`)      A breakdown of tool-use token usage by modality.
       - **modality** (`ResponseModality`)        The modality associated with the token count.
         Possible values:
         - `text`: Indicates the model should return text.
         - `image`: Indicates the model should return images.
         - `audio`: Indicates the model should return audio.
         - `video`: Indicates the model should return video.
         - `document`: Indicates the model should return documents.

       - **tokens** (`integer`)        Number of tokens for the modality.


     - **total_cached_tokens** (`integer`)      Number of tokens in the cached part of the prompt (the cached content).

     - **total_input_tokens** (`integer`)      Number of tokens in the prompt (context).

     - **total_output_tokens** (`integer`)      Total number of tokens across all the generated responses.

     - **total_thought_tokens** (`integer`)      Number of tokens of thoughts for thinking models.

     - **total_tokens** (`integer`)      Total token count for the interaction request (prompt + responses + other internal tokens).

     - **total_tool_use_tokens** (`integer`)      Number of tokens present in tool-use prompt(s).


    **Examples**
    **Interaction Completed**


    ```json
    {
  "event_id": "evt_123",
  "event_type": "interaction.completed",
  "interaction": {
    "created": "2025-12-04T15:01:45Z",
    "id": "v1_ChdXS0l4YWZXTk9xbk0xZThQczhEcmlROBIXV0tJeGFmV05PcW5NMWU4UHM4RHJpUTg",
    "model": "gemini-3.6-flash",
    "status": "completed",
    "updated": "2025-12-04T15:01:45Z"
  }
}
    ```
    **Interaction Completed**


    ```json
    {
  "event_id": "evt_123",
  "event_type": "interaction.completed",
  "interaction": {
    "created": "2025-12-04T15:01:45Z",
    "id": "v1_ChdXS0l4YWZXTk9xbk0xZThQczhEcmlROBIXV0tJeGFmV05PcW5NMWU4UHM4RHJpUTg",
    "model": "gemini-3-flash-preview",
    "object": "interaction",
    "status": "completed",
    "updated": "2025-12-04T15:01:45Z"
  }
}
    ```
- **InteractionCreatedEvent**
    -
     - **event_id** (`string`)  The event_id token to be used to resume the interaction stream, from this event.

     - **event_type** (`object`) *(Required)*
   Value: `interaction.created`
     - **interaction** (`InteractionSseEventInteraction`) *(Required)*  Partial interaction resource emitted when the stream is created.
   - **agent** (`string`)    The agent to interact with.

   - **created** (`string`)    Output only. The time at which the response was created in ISO 8601 format.

   - **id** (`string`) *(Required)*    Required. Output only. A unique identifier for the interaction completion.

   - **model** (`string`)    The model that will complete your prompt.

   - **object** (`string`)    Output only. The resource type.

   - **service_tier** (`ServiceTier`)    The service tier for the interaction.
     Possible values:
     - `flex`: Flex service tier.
     - `standard`: Standard service tier.
     - `priority`: Priority service tier.

   - **status** (`enum (string)`) *(Required)*    Required. Output only. The status of the interaction.
     Possible values:
     - `in_progress`: The interaction is in progress.
     - `requires_action`: The interaction requires action/input from the user.
     - `completed`: The interaction is completed.
     - `failed`: The interaction failed.
     - `cancelled`: The interaction was cancelled.
     - `incomplete`: The interaction is completed, but contains incomplete results (e.g. hitting max_tokens).

   - **steps** (`array (<a href="#Resource:Step">Step</a>)`)    Output only. The steps that make up the interaction, if included in this event.

   - **updated** (`string`)    Output only. The time at which the response was last updated in ISO 8601 format.

   - **usage** (`Usage`)    Output only. Statistics on the interaction request's token usage.
     - **cached_tokens_by_modality** (`array (ModalityTokens)`)      A breakdown of cached token usage by modality.
       - **modality** (`ResponseModality`)        The modality associated with the token count.
         Possible values:
         - `text`: Indicates the model should return text.
         - `image`: Indicates the model should return images.
         - `audio`: Indicates the model should return audio.
         - `video`: Indicates the model should return video.
         - `document`: Indicates the model should return documents.

       - **tokens** (`integer`)        Number of tokens for the modality.


     - **grounding_tool_count** (`array (GroundingToolCount)`)      Grounding tool count.
       - **count** (`integer`)        The number of grounding tool counts.

       - **type** (`enum (string)`)        The grounding tool type associated with the count.
         Possible values:
         - `google_search`: Grounding with Google Web Search and Image Search, & Web Grounding
for Enterprise.
         - `google_maps`: Grounding with Google Maps.


     - **input_tokens_by_modality** (`array (ModalityTokens)`)      A breakdown of input token usage by modality.
       - **modality** (`ResponseModality`)        The modality associated with the token count.
         Possible values:
         - `text`: Indicates the model should return text.
         - `image`: Indicates the model should return images.
         - `audio`: Indicates the model should return audio.
         - `video`: Indicates the model should return video.
         - `document`: Indicates the model should return documents.

       - **tokens** (`integer`)        Number of tokens for the modality.


     - **output_tokens_by_modality** (`array (ModalityTokens)`)      A breakdown of output token usage by modality.
       - **modality** (`ResponseModality`)        The modality associated with the token count.
         Possible values:
         - `text`: Indicates the model should return text.
         - `image`: Indicates the model should return images.
         - `audio`: Indicates the model should return audio.
         - `video`: Indicates the model should return video.
         - `document`: Indicates the model should return documents.

       - **tokens** (`integer`)        Number of tokens for the modality.


     - **tool_use_tokens_by_modality** (`array (ModalityTokens)`)      A breakdown of tool-use token usage by modality.
       - **modality** (`ResponseModality`)        The modality associated with the token count.
         Possible values:
         - `text`: Indicates the model should return text.
         - `image`: Indicates the model should return images.
         - `audio`: Indicates the model should return audio.
         - `video`: Indicates the model should return video.
         - `document`: Indicates the model should return documents.

       - **tokens** (`integer`)        Number of tokens for the modality.


     - **total_cached_tokens** (`integer`)      Number of tokens in the cached part of the prompt (the cached content).

     - **total_input_tokens** (`integer`)      Number of tokens in the prompt (context).

     - **total_output_tokens** (`integer`)      Total number of tokens across all the generated responses.

     - **total_thought_tokens** (`integer`)      Number of tokens of thoughts for thinking models.

     - **total_tokens** (`integer`)      Total token count for the interaction request (prompt + responses + other internal tokens).

     - **total_tool_use_tokens** (`integer`)      Number of tokens present in tool-use prompt(s).


    **Examples**
    **Interaction Created**


    ```json
    {
  "event_id": "evt_123",
  "event_type": "interaction.created",
  "interaction": {
    "created": "2025-12-04T15:01:45Z",
    "id": "v1_ChdXS0l4YWZXTk9xbk0xZThQczhEcmlROBIXV0tJeGFmV05PcW5NMWU4UHM4RHJpUTg",
    "model": "gemini-3.6-flash",
    "status": "in_progress",
    "updated": "2025-12-04T15:01:45Z"
  }
}
    ```
    **Interaction Created**


    ```json
    {
  "event_id": "evt_123",
  "event_type": "interaction.created",
  "interaction": {
    "id": "v1_ChdXS0l4YWZXTk9xbk0xZThQczhEcmlROBIXV0tJeGFmV05PcW5NMWU4UHM4RHJpUTg",
    "model": "gemini-3-flash-preview",
    "object": "interaction",
    "status": "in_progress"
  }
}
    ```
- **InteractionStatusUpdate**
    -
     - **event_id** (`string`)  The event_id token to be used to resume the interaction stream, from this event.

     - **event_type** (`object`) *(Required)*
   Value: `interaction.status_update`
     - **interaction_id** (`string`) *(Required)*

     - **status** (`enum (string)`) *(Required)*
   Possible values:
   - `in_progress`: The interaction is in progress.
   - `requires_action`: The interaction requires action/input from the user.
   - `completed`: The interaction is completed.
   - `failed`: The interaction failed.
   - `cancelled`: The interaction was cancelled.
   - `incomplete`: The interaction is completed, but contains incomplete results (e.g.
hitting max_tokens).
   - `budget_exceeded`: The interaction was halted because the token budget was exceeded.

    **Examples**
    **Interaction Status Update**


    ```json
    {
  "event_type": "interaction.status_update",
  "interaction_id": "v1_ChdTMjQ0YWJ5TUF1TzcxZThQdjRpcnFRcxIXUzI0NGFieU1BdU83MWU4UHY0aXJxUXM",
  "status": "in_progress"
}
    ```
- **StepDelta**
    -
     - **delta** (`StepDeltaData`) *(Required)*
   **Possible Types:**
   - **ArgumentsDelta**:
   - **arguments** (`string`)

   - **type** (`object`) *(Required)*
     Value: `arguments_delta`
   - **AudioDelta**:
   - **channels** (`integer`)    The number of audio channels.

   - **data** (`string`)

   - **mime_type** (`enum (string)`)
     Possible values:
     - `audio/wav`: WAV audio format
     - `audio/mp3`: MP3 audio format
     - `audio/aiff`: AIFF audio format
     - `audio/aac`: AAC audio format
     - `audio/ogg`: OGG audio format
     - `audio/flac`: FLAC audio format
     - `audio/mpeg`: MPEG audio format
     - `audio/m4a`: M4A audio format
     - `audio/l16`: L16 audio format
     - `audio/opus`: OPUS audio format
     - `audio/alaw`: ALAW audio format
     - `audio/mulaw`: MULAW audio format
     - `audio/webm`: WEBM audio format

   - **sample_rate** (`integer`)    The sample rate of the audio.

   - **type** (`object`) *(Required)*
     Value: `audio`
   - **uri** (`string`)

   - **CodeExecutionCallDelta**:
   - **arguments** (`CodeExecutionCallArguments`) *(Required)*
     - **code** (`string`)      The code to be executed.

     - **language** (`enum (string)`)      Programming language of the `code`.
       Possible values:
       - `python`: Python >= 3.10, with numpy and simpy available.


   - **signature** (`string`)    A signature hash for backend validation.

   - **type** (`object`) *(Required)*
     Value: `code_execution_call`
   - **CodeExecutionResultDelta**:
   - **is_error** (`boolean`)

   - **result** (`string`) *(Required)*

   - **signature** (`string`)    A signature hash for backend validation.

   - **type** (`object`) *(Required)*
     Value: `code_execution_result`
   - **DocumentDelta**:
   - **data** (`string`)

   - **mime_type** (`enum (string)`)
     Possible values:
     - `application/pdf`: PDF document format
     - `text/csv`: CSV document format

   - **type** (`object`) *(Required)*
     Value: `document`
   - **uri** (`string`)

   - **FileSearchCallDelta**:
   - **signature** (`string`)    A signature hash for backend validation.

   - **type** (`object`) *(Required)*
     Value: `file_search_call`
   - **FileSearchResultDelta**:
   - **result** (`array (FileSearchResult)`) *(Required)*

   - **signature** (`string`)    A signature hash for backend validation.

   - **type** (`object`) *(Required)*
     Value: `file_search_result`
   - **FunctionResultDelta**:
   - **is_error** (`boolean`)

   - **name** (`string`)

   - **result** (`array (<a href="#Resource:ImageContent">ImageContent</a> or <a href="#Resource:TextContent">TextContent</a>) or object or string`) *(Required)*

   - **type** (`object`) *(Required)*
     Value: `function_result`
   - **GoogleMapsCallDelta**:
   - **arguments** (`GoogleMapsCallArguments`)    The arguments to pass to the Google Maps tool.
     - **queries** (`array (string)`)      The queries to be executed.


   - **signature** (`string`)    A signature hash for backend validation.

   - **type** (`object`) *(Required)*
     Value: `google_maps_call`
   - **GoogleMapsResultDelta**:
   - **result** (`array (GoogleMapsResult)`)    The results of the Google Maps.
     - **places** (`array (Places)`)      The places that were found.
       - **name** (`string`)        Title of the place.

       - **place_id** (`string`)        The ID of the place, in `places/{place_id}` format.

       - **review_snippets** (`array (ReviewSnippet)`)        Snippets of reviews that are used to generate answers about the features of a given place in Google Maps.
         - **review_id** (`string`)          The ID of the review snippet.

         - **title** (`string`)          Title of the review.

         - **url** (`string`)          A link that corresponds to the user review on Google Maps.


       - **url** (`string`)        URI reference of the place.


     - **widget_context_token** (`string`)      Resource name of the Google Maps widget context token.


   - **signature** (`string`)    A signature hash for backend validation.

   - **type** (`object`) *(Required)*
     Value: `google_maps_result`
   - **GoogleSearchCallDelta**:
   - **arguments** (`GoogleSearchCallArguments`) *(Required)*
     - **queries** (`array (string)`)      Web search queries for the following-up web search.


   - **signature** (`string`)    A signature hash for backend validation.

   - **type** (`object`) *(Required)*
     Value: `google_search_call`
   - **GoogleSearchResultDelta**:
   - **is_error** (`boolean`)

   - **result** (`array (GoogleSearchResult)`) *(Required)*
     - **search_suggestions** (`string`)      Web content snippet that can be embedded in a web page or an app webview.


   - **signature** (`string`)    A signature hash for backend validation.

   - **type** (`object`) *(Required)*
     Value: `google_search_result`
   - **ImageDelta**:
   - **data** (`string`)

   - **mime_type** (`enum (string)`)
     Possible values:
     - `image/png`: PNG image format
     - `image/jpeg`: JPEG image format
     - `image/webp`: WebP image format
     - `image/heic`: HEIC image format
     - `image/heif`: HEIF image format
     - `image/gif`: GIF image format
     - `image/bmp`: BMP image format
     - `image/tiff`: TIFF image format

   - **resolution** (`MediaResolution`)    The resolution of the media.
     Possible values:
     - `low`: Low resolution.
     - `medium`: Medium resolution.
     - `high`: High resolution.
     - `ultra_high`: Ultra high resolution.

   - **type** (`object`) *(Required)*
     Value: `image`
   - **uri** (`string`)

   - **McpServerToolCallDelta**:
   - **arguments** (`object`) *(Required)*

   - **name** (`string`) *(Required)*

   - **server_name** (`string`) *(Required)*

   - **type** (`object`) *(Required)*
     Value: `mcp_server_tool_call`
   - **McpServerToolResultDelta**:
   - **name** (`string`)

   - **result** (`array (<a href="#Resource:ImageContent">ImageContent</a> or <a href="#Resource:TextContent">TextContent</a>) or object or string`) *(Required)*

   - **server_name** (`string`)

   - **type** (`object`) *(Required)*
     Value: `mcp_server_tool_result`
   - **ProcessingCallDelta**: Streaming delta for a server-initiated media processing step.
   - **signature** (`string`)    A signature hash for backend validation.

   - **type** (`object`) *(Required)*
     Value: `processing_call`
   - **ProcessingResultDelta**: Streaming delta for the result of a server-initiated media processing step.
   - **signature** (`string`)    A signature hash for backend validation.

   - **type** (`object`) *(Required)*
     Value: `processing_result`
   - **TextAnnotationDelta**:
   - **annotations** (`array (Annotation)`)    Citation information for model-generated content.
     **Possible Types:**
     - **FileCitation**: A file citation annotation.
     - **custom_metadata** (`object`)      User provided metadata about the retrieved context.

     - **document_uri** (`string`)      The URI of the file.

     - **end_index** (`integer`)      End of the attributed segment, exclusive.

     - **file_name** (`string`)      The name of the file.

     - **media_id** (`string`)      Media ID in-case of image citations, if applicable.

     - **page_number** (`integer`)      Page number of the cited document, if applicable.

     - **source** (`string`)      Source attributed for a portion of the text.

     - **start_index** (`integer`)      Start of segment of the response that is attributed to this source.  Index indicates the start of the segment, measured in bytes.

     - **type** (`object`) *(Required)*
       Value: `file_citation`
     - **PlaceCitation**: A place citation annotation.
     - **end_index** (`integer`)      End of the attributed segment, exclusive.

     - **name** (`string`)      Title of the place.

     - **place_id** (`string`)      The ID of the place, in `places/{place_id}` format.

     - **review_snippets** (`array (ReviewSnippet)`)      Snippets of reviews that are used to generate answers about the features of a given place in Google Maps.
       - **review_id** (`string`)        The ID of the review snippet.

       - **title** (`string`)        Title of the review.

       - **url** (`string`)        A link that corresponds to the user review on Google Maps.


     - **start_index** (`integer`)      Start of segment of the response that is attributed to this source.  Index indicates the start of the segment, measured in bytes.

     - **type** (`object`) *(Required)*
       Value: `place_citation`
     - **url** (`string`)      URI reference of the place.

     - **UrlCitation**: A URL citation annotation.
     - **end_index** (`integer`)      End of the attributed segment, exclusive.

     - **start_index** (`integer`)      Start of segment of the response that is attributed to this source.  Index indicates the start of the segment, measured in bytes.

     - **title** (`string`)      The title of the URL.

     - **type** (`object`) *(Required)*
       Value: `url_citation`
     - **url** (`string`)      The URL.

     - **WordInfo**: Word-level ASR annotation for transcription output. Carries the word text, optional timing, and optional speaker attribution.
     - **end_index** (`integer`)      End of the attributed segment, exclusive.

     - **end_offset** (`string`)      End offset in time of the word relative to the start of the audio. Present when timestamp_granularities contains "word".

     - **speaker** (`string`)      Optional. Speaker label for this word (e.g. "spk_1", "spk_2"). Present when diarization_mode is set in TranscriptionConfig.

     - **start_index** (`integer`)      Start of segment of the response that is attributed to this source.  Index indicates the start of the segment, measured in bytes.

     - **start_offset** (`string`)      Start offset in time of the word relative to the start of the audio. Present when timestamp_granularities contains "word".

     - **text** (`string`)      The transcribed word.

     - **type** (`object`) *(Required)*
       Value: `word_info`

   - **type** (`object`) *(Required)*
     Value: `text_annotation_delta`
   - **TextDelta**:
   - **text** (`string`) *(Required)*

   - **type** (`object`) *(Required)*
     Value: `text`
   - **ThoughtSignatureDelta**:
   - **signature** (`string`)    Signature to match the backend source to be part of the generation.

   - **type** (`object`) *(Required)*
     Value: `thought_signature`
   - **ThoughtSummaryDelta**:
   - **content** (`<a href="#Resource:Content">Content</a>`)    A new summary item to be added to the thought.

   - **type** (`object`) *(Required)*
     Value: `thought_summary`
   - **UrlContextCallDelta**:
   - **arguments** (`UrlContextCallArguments`) *(Required)*
     - **urls** (`array (string)`)      The URLs to fetch.


   - **signature** (`string`)    A signature hash for backend validation.

   - **type** (`object`) *(Required)*
     Value: `url_context_call`
   - **UrlContextResultDelta**:
   - **is_error** (`boolean`)

   - **result** (`array (UrlContextResult)`) *(Required)*
     - **status** (`enum (string)`)      The status of the URL retrieval.
       Possible values:
       - `success`: Url retrieval is successful.
       - `error`: Url retrieval is failed due to error.
       - `paywall`: Url retrieval is failed because the content is behind paywall.
       - `unsafe`: Url retrieval is failed because the content is unsafe.

     - **url** (`string`)      The URL that was fetched.


   - **signature** (`string`)    A signature hash for backend validation.

   - **type** (`object`) *(Required)*
     Value: `url_context_result`
   - **VideoDelta**:
   - **data** (`string`)

   - **mime_type** (`enum (string)`)
     Possible values:
     - `video/mp4`: MP4 video format
     - `video/mpeg`: MPEG video format
     - `video/mpg`: MPG video format
     - `video/mov`: MOV video format
     - `video/avi`: AVI video format
     - `video/x-flv`: FLV video format
     - `video/webm`: WebM video format
     - `video/wmv`: WMV video format
     - `video/3gpp`: 3GPP video format
     - `video/jpeg2000`: JPEG 2000 video format

   - **resolution** (`MediaResolution`)    The resolution of the media.
     Possible values:
     - `low`: Low resolution.
     - `medium`: Medium resolution.
     - `high`: High resolution.
     - `ultra_high`: Ultra high resolution.

   - **type** (`object`) *(Required)*
     Value: `video`
   - **uri** (`string`)


     - **event_id** (`string`)  The event_id token to be used to resume the interaction stream, from this event.

     - **event_type** (`object`) *(Required)*
   Value: `step.delta`
     - **index** (`integer`) *(Required)*

     - **metadata** (`StepDeltaMetadata`)
   - **total_usage** (`Usage`)    Statistics on the interaction request's token usage.
     - **cached_tokens_by_modality** (`array (ModalityTokens)`)      A breakdown of cached token usage by modality.
       - **modality** (`ResponseModality`)        The modality associated with the token count.
         Possible values:
         - `text`: Indicates the model should return text.
         - `image`: Indicates the model should return images.
         - `audio`: Indicates the model should return audio.
         - `video`: Indicates the model should return video.
         - `document`: Indicates the model should return documents.

       - **tokens** (`integer`)        Number of tokens for the modality.


     - **grounding_tool_count** (`array (GroundingToolCount)`)      Grounding tool count.
       - **count** (`integer`)        The number of grounding tool counts.

       - **type** (`enum (string)`)        The grounding tool type associated with the count.
         Possible values:
         - `google_search`: Grounding with Google Web Search and Image Search, & Web Grounding
for Enterprise.
         - `google_maps`: Grounding with Google Maps.


     - **input_tokens_by_modality** (`array (ModalityTokens)`)      A breakdown of input token usage by modality.
       - **modality** (`ResponseModality`)        The modality associated with the token count.
         Possible values:
         - `text`: Indicates the model should return text.
         - `image`: Indicates the model should return images.
         - `audio`: Indicates the model should return audio.
         - `video`: Indicates the model should return video.
         - `document`: Indicates the model should return documents.

       - **tokens** (`integer`)        Number of tokens for the modality.


     - **output_tokens_by_modality** (`array (ModalityTokens)`)      A breakdown of output token usage by modality.
       - **modality** (`ResponseModality`)        The modality associated with the token count.
         Possible values:
         - `text`: Indicates the model should return text.
         - `image`: Indicates the model should return images.
         - `audio`: Indicates the model should return audio.
         - `video`: Indicates the model should return video.
         - `document`: Indicates the model should return documents.

       - **tokens** (`integer`)        Number of tokens for the modality.


     - **tool_use_tokens_by_modality** (`array (ModalityTokens)`)      A breakdown of tool-use token usage by modality.
       - **modality** (`ResponseModality`)        The modality associated with the token count.
         Possible values:
         - `text`: Indicates the model should return text.
         - `image`: Indicates the model should return images.
         - `audio`: Indicates the model should return audio.
         - `video`: Indicates the model should return video.
         - `document`: Indicates the model should return documents.

       - **tokens** (`integer`)        Number of tokens for the modality.


     - **total_cached_tokens** (`integer`)      Number of tokens in the cached part of the prompt (the cached content).

     - **total_input_tokens** (`integer`)      Number of tokens in the prompt (context).

     - **total_output_tokens** (`integer`)      Total number of tokens across all the generated responses.

     - **total_thought_tokens** (`integer`)      Number of tokens of thoughts for thinking models.

     - **total_tokens** (`integer`)      Total token count for the interaction request (prompt + responses + other internal tokens).

     - **total_tool_use_tokens** (`integer`)      Number of tokens present in tool-use prompt(s).


    **Examples**
    **Step Delta**


    ```json
    {
  "delta": {
    "type": "text",
    "text": "Hello"
  },
  "event_type": "step.delta",
  "index": 0
}
    ```
- **StepStart**
    -
     - **event_id** (`string`)  The event_id token to be used to resume the interaction stream, from this event.

     - **event_type** (`object`) *(Required)*
   Value: `step.start`
     - **index** (`integer`) *(Required)*

     - **step** (`<a href="#Resource:Step">Step</a>`) *(Required)*

    **Examples**
    **Step Start**


    ```json
    {
  "event_type": "step.start",
  "index": 0,
  "step": {
    "type": "model_output"
  }
}
    ```
- **StepStop**
    -
     - **event_id** (`string`)  The event_id token to be used to resume the interaction stream, from this event.

     - **event_type** (`object`) *(Required)*
   Value: `step.stop`
     - **index** (`integer`) *(Required)*

     - **step_usage** (`Usage`)  Model usage stats for this specific step.
   - **cached_tokens_by_modality** (`array (ModalityTokens)`)    A breakdown of cached token usage by modality.
     - **modality** (`ResponseModality`)      The modality associated with the token count.
       Possible values:
       - `text`: Indicates the model should return text.
       - `image`: Indicates the model should return images.
       - `audio`: Indicates the model should return audio.
       - `video`: Indicates the model should return video.
       - `document`: Indicates the model should return documents.

     - **tokens** (`integer`)      Number of tokens for the modality.


   - **grounding_tool_count** (`array (GroundingToolCount)`)    Grounding tool count.
     - **count** (`integer`)      The number of grounding tool counts.

     - **type** (`enum (string)`)      The grounding tool type associated with the count.
       Possible values:
       - `google_search`: Grounding with Google Web Search and Image Search, & Web Grounding
for Enterprise.
       - `google_maps`: Grounding with Google Maps.


   - **input_tokens_by_modality** (`array (ModalityTokens)`)    A breakdown of input token usage by modality.
     - **modality** (`ResponseModality`)      The modality associated with the token count.
       Possible values:
       - `text`: Indicates the model should return text.
       - `image`: Indicates the model should return images.
       - `audio`: Indicates the model should return audio.
       - `video`: Indicates the model should return video.
       - `document`: Indicates the model should return documents.

     - **tokens** (`integer`)      Number of tokens for the modality.


   - **output_tokens_by_modality** (`array (ModalityTokens)`)    A breakdown of output token usage by modality.
     - **modality** (`ResponseModality`)      The modality associated with the token count.
       Possible values:
       - `text`: Indicates the model should return text.
       - `image`: Indicates the model should return images.
       - `audio`: Indicates the model should return audio.
       - `video`: Indicates the model should return video.
       - `document`: Indicates the model should return documents.

     - **tokens** (`integer`)      Number of tokens for the modality.


   - **tool_use_tokens_by_modality** (`array (ModalityTokens)`)    A breakdown of tool-use token usage by modality.
     - **modality** (`ResponseModality`)      The modality associated with the token count.
       Possible values:
       - `text`: Indicates the model should return text.
       - `image`: Indicates the model should return images.
       - `audio`: Indicates the model should return audio.
       - `video`: Indicates the model should return video.
       - `document`: Indicates the model should return documents.

     - **tokens** (`integer`)      Number of tokens for the modality.


   - **total_cached_tokens** (`integer`)    Number of tokens in the cached part of the prompt (the cached content).

   - **total_input_tokens** (`integer`)    Number of tokens in the prompt (context).

   - **total_output_tokens** (`integer`)    Total number of tokens across all the generated responses.

   - **total_thought_tokens** (`integer`)    Number of tokens of thoughts for thinking models.

   - **total_tokens** (`integer`)    Total token count for the interaction request (prompt + responses + other internal tokens).

   - **total_tool_use_tokens** (`integer`)    Number of tokens present in tool-use prompt(s).


     - **usage** (`Usage`)  Cumulative model usage stats from the start of the session.
   - **cached_tokens_by_modality** (`array (ModalityTokens)`)    A breakdown of cached token usage by modality.
     - **modality** (`ResponseModality`)      The modality associated with the token count.
       Possible values:
       - `text`: Indicates the model should return text.
       - `image`: Indicates the model should return images.
       - `audio`: Indicates the model should return audio.
       - `video`: Indicates the model should return video.
       - `document`: Indicates the model should return documents.

     - **tokens** (`integer`)      Number of tokens for the modality.


   - **grounding_tool_count** (`array (GroundingToolCount)`)    Grounding tool count.
     - **count** (`integer`)      The number of grounding tool counts.

     - **type** (`enum (string)`)      The grounding tool type associated with the count.
       Possible values:
       - `google_search`: Grounding with Google Web Search and Image Search, & Web Grounding
for Enterprise.
       - `google_maps`: Grounding with Google Maps.


   - **input_tokens_by_modality** (`array (ModalityTokens)`)    A breakdown of input token usage by modality.
     - **modality** (`ResponseModality`)      The modality associated with the token count.
       Possible values:
       - `text`: Indicates the model should return text.
       - `image`: Indicates the model should return images.
       - `audio`: Indicates the model should return audio.
       - `video`: Indicates the model should return video.
       - `document`: Indicates the model should return documents.

     - **tokens** (`integer`)      Number of tokens for the modality.


   - **output_tokens_by_modality** (`array (ModalityTokens)`)    A breakdown of output token usage by modality.
     - **modality** (`ResponseModality`)      The modality associated with the token count.
       Possible values:
       - `text`: Indicates the model should return text.
       - `image`: Indicates the model should return images.
       - `audio`: Indicates the model should return audio.
       - `video`: Indicates the model should return video.
       - `document`: Indicates the model should return documents.

     - **tokens** (`integer`)      Number of tokens for the modality.


   - **tool_use_tokens_by_modality** (`array (ModalityTokens)`)    A breakdown of tool-use token usage by modality.
     - **modality** (`ResponseModality`)      The modality associated with the token count.
       Possible values:
       - `text`: Indicates the model should return text.
       - `image`: Indicates the model should return images.
       - `audio`: Indicates the model should return audio.
       - `video`: Indicates the model should return video.
       - `document`: Indicates the model should return documents.

     - **tokens** (`integer`)      Number of tokens for the modality.


   - **total_cached_tokens** (`integer`)    Number of tokens in the cached part of the prompt (the cached content).

   - **total_input_tokens** (`integer`)    Number of tokens in the prompt (context).

   - **total_output_tokens** (`integer`)    Total number of tokens across all the generated responses.

   - **total_thought_tokens** (`integer`)    Number of tokens of thoughts for thinking models.

   - **total_tokens** (`integer`)    Total token count for the interaction request (prompt + responses + other internal tokens).

   - **total_tool_use_tokens** (`integer`)    Number of tokens present in tool-use prompt(s).


    **Examples**
    **Step Stop**


    ```json
    {
  "event_type": "step.stop",
  "index": 0
}
    ```

**JSON Representation:**
```json
{
  "error": {
    "code": "string",
    "message": "string"
  },
  "event_id": "string",
  "event_type": {}
}
```


### ResponseFormat { #Resource:ResponseFormat }


**Polymorphic Types:** - **AudioResponseFormat**
    - Configuration for audio output format.
     - **bit_rate** (`integer`)  Bit rate in bits per second (bps). Only applicable for compressed formats (MP3, Opus).

     - **delivery** (`enum (string)`)  The delivery mode for the audio output.
   Possible values:
   - `inline`: Audio data is returned inline in the response.
   - `uri`: Audio data is returned as a URI.

     - **mime_type** (`enum (string)`)  The MIME type of the audio output.
   Possible values:
   - `audio/mp3`: MP3 audio format.
   - `audio/ogg_opus`: OGG Opus audio format.
   - `audio/l16`: Raw PCM (L16) audio format.
   - `audio/wav`: WAV audio format.
   - `audio/alaw`: A-law audio format.
   - `audio/mulaw`: Mu-law audio format.

     - **sample_rate** (`integer`)  Sample rate in Hz.

     - **type** (`object`) *(Required)*
   Value: `audio`
    **Examples**
    **Audio Output**


    ```json
    {
  "type": "audio",
  "sample_rate": 24000
}
    ```
- **ImageResponseFormat**
    - Configuration for image output format.
     - **aspect_ratio** (`enum (string)`)  The aspect ratio for the image output.
   Possible values:
   - `1:1`: 1:1 aspect ratio.
   - `2:3`: 2:3 aspect ratio.
   - `3:2`: 3:2 aspect ratio.
   - `3:4`: 3:4 aspect ratio.
   - `4:3`: 4:3 aspect ratio.
   - `4:5`: 4:5 aspect ratio.
   - `5:4`: 5:4 aspect ratio.
   - `9:16`: 9:16 aspect ratio.
   - `16:9`: 16:9 aspect ratio.
   - `21:9`: 21:9 aspect ratio.
   - `1:8`: 1:8 aspect ratio.
   - `8:1`: 8:1 aspect ratio.
   - `1:4`: 1:4 aspect ratio.
   - `4:1`: 4:1 aspect ratio.

     - **delivery** (`enum (string)`)  The delivery mode for the image output.
   Possible values:
   - `inline`: Image data is returned inline in the response.
   - `uri`: Image data is returned as a URI.

     - **image_size** (`enum (string)`)  The size of the image output.
   Possible values:
   - `512`: 512px image size.
   - `1K`: 1K image size.
   - `2K`: 2K image size.
   - `4K`: 4K image size.

     - **mime_type** (`enum (string)`)  The MIME type of the image output.
   Possible values:
   - `image/jpeg`: JPEG image format.

     - **type** (`object`) *(Required)*
   Value: `image`
    **Examples**
    **Image Output**


    ```json
    {
  "type": "image",
  "aspect_ratio": "16:9",
  "image_size": "1K",
  "mime_type": "image/jpeg"
}
    ```
- **TextResponseFormat**
    - Configuration for text output format.
     - **mime_type** (`enum (string)`)  The MIME type of the text output.
   Possible values:
   - `application/json`: JSON output format.
   - `text/plain`: Plain text output format.

     - **schema** (`object`)  The JSON schema that the output should conform to. Only applicable when mime_type is application/json.

     - **type** (`object`) *(Required)*
   Value: `text`
    **Examples**
    **Text Output (JSON Schema)**


    ```json
    {
  "type": "text",
  "mime_type": "application/json",
  "schema": {
    "type": "object",
    "properties": {
      "ingredients": {
        "type": "array",
        "items": {
          "type": "string"
        }
      },
      "recipe_name": {
        "type": "string"
      }
    },
    "required": [
      "ingredients",
      "recipe_name"
    ]
  }
}
    ```
- **VideoResponseFormat**
    - Configuration for video output format.
     - **aspect_ratio** (`enum (string)`)  The aspect ratio for the video output.
   Possible values:
   - `16:9`: 16:9 aspect ratio.
   - `9:16`: 9:16 aspect ratio.

     - **delivery** (`enum (string)`)  The delivery mode for the video output.
   Possible values:
   - `inline`: Video data is returned inline in the response.
   - `uri`: Video data is returned as a URI.

     - **duration** (`string`)  The duration for the video output.

     - **resolution** (`enum (string)`)  The video output resolution. Defaults to 720p.
   Possible values:
   - `360p`: 360p resolution.
   - `720p`: 720p resolution.
   - `1080p`: 1080p resolution.
   - `4k`: 4K resolution.

     - **type** (`object`) *(Required)*
   Value: `video`
    **Examples**
    **Video Output**


    ```json
    {
  "type": "video",
  "aspect_ratio": "16:9",
  "delivery": "inline"
}
    ```

**JSON Representation:**
```json
{
  "bit_rate": 0,
  "delivery": "inline",
  "mime_type": "audio/mp3",
  "sample_rate": 0,
  "type": {}
}
```


### Step { #Resource:Step }
A step in the interaction.

**Polymorphic Types:** - **CodeExecutionCallStep**
    - Code execution call step.
     - **arguments** (`CodeExecutionCallStepArguments`) *(Required)*  Required. The arguments to pass to the code execution.
   - **code** (`string`)    The code to be executed.

   - **language** (`enum (string)`)    Programming language of the `code`.
     Possible values:
     - `python`: Python >= 3.10, with numpy and simpy available.


     - **id** (`string`) *(Required)*  Required. A unique ID for this specific tool call.

     - **signature** (`string`)  A signature hash for backend validation.

     - **type** (`object`) *(Required)*
   Value: `code_execution_call`
    **Examples**
    **CodeExecutionCallStep**


    ```json
    {
  "type": "code_execution_call",
  "arguments": {
    "code": "print(sum(range(1, 11)))"
  },
  "id": "code_call_71021"
}
    ```
- **CodeExecutionResultStep**
    - Code execution result step.
     - **call_id** (`string`) *(Required)*  Required. ID to match the ID from the function call block.

     - **is_error** (`boolean`)  Whether the code execution resulted in an error.

     - **result** (`string`) *(Required)*  Required. The output of the code execution.

     - **signature** (`string`)  A signature hash for backend validation.

     - **type** (`object`) *(Required)*
   Value: `code_execution_result`
    **Examples**
    **CodeExecutionResultStep**


    ```json
    {
  "type": "code_execution_result",
  "call_id": "code_call_71021",
  "result": "55\n"
}
    ```
- **FileSearchCallStep**
    - File Search call step.
     - **id** (`string`) *(Required)*  Required. A unique ID for this specific tool call.

     - **signature** (`string`)  A signature hash for backend validation.

     - **type** (`object`) *(Required)*
   Value: `file_search_call`
    **Examples**
    **FileSearchCallStep**


    ```json
    {
  "type": "file_search_call",
  "id": "file_call_88192"
}
    ```
- **FileSearchResultStep**
    - File Search result step.
     - **call_id** (`string`) *(Required)*  Required. ID to match the ID from the function call block.

     - **signature** (`string`)  A signature hash for backend validation.

     - **type** (`object`) *(Required)*
   Value: `file_search_result`
    **Examples**
    **FileSearchResultStep**


    ```json
    {
  "type": "file_search_result",
  "call_id": "file_call_88192"
}
    ```
- **FunctionCallStep**
    - A function tool call step.
     - **arguments** (`object`) *(Required)*  Required. The arguments to pass to the function.

     - **id** (`string`) *(Required)*  Required. A unique ID for this specific tool call.

     - **name** (`string`) *(Required)*  Required. The name of the tool to call.

     - **type** (`object`) *(Required)*
   Value: `function_call`
    **Examples**
    **FunctionCallStep**


    ```json
    {
  "name": "get_weather",
  "type": "function_call",
  "arguments": {
    "location": "Boston, MA"
  },
  "id": "call_98231"
}
    ```
- **FunctionResultStep**
    - Result of a function tool call.
     - **call_id** (`string`) *(Required)*  Required. ID to match the ID from the function call block.

     - **is_error** (`boolean`)  Whether the tool call resulted in an error.

     - **name** (`string`)  The name of the tool that was called.

     - **result** (`array (<a href="#Resource:ImageContent">ImageContent</a> or <a href="#Resource:TextContent">TextContent</a>) or object or string`) *(Required)*  Required. The result of the tool call.

     - **type** (`object`) *(Required)*
   Value: `function_result`
    **Examples**
    **FunctionResultStep**


    ```json
    {
  "name": "get_weather",
  "type": "function_result",
  "call_id": "call_98231",
  "result": [
    {
      "type": "text",
      "text": "{\"weather\":\"sunny\"}"
    }
  ]
}
    ```
- **GoogleMapsCallStep**
    - Google Maps call step.
     - **arguments** (`GoogleMapsCallStepArguments`)  The arguments to pass to the Google Maps tool.
   - **queries** (`array (string)`)    The queries to be executed.


     - **id** (`string`) *(Required)*  Required. A unique ID for this specific tool call.

     - **signature** (`string`)  A signature hash for backend validation.

     - **type** (`object`) *(Required)*
   Value: `google_maps_call`
    **Examples**
    **GoogleMapsCallStep**


    ```json
    {
  "type": "google_maps_call",
  "arguments": {
    "latitude": 37.7749,
    "longitude": -122.4194
  },
  "id": "maps_call_39201"
}
    ```
- **GoogleMapsResultStep**
    - Google Maps result step.
     - **call_id** (`string`) *(Required)*  Required. ID to match the ID from the function call block.

     - **result** (`array (GoogleMapsResultItem)`) *(Required)*
   - **places** (`array (GoogleMapsResultPlaces)`)
     - **name** (`string`)

     - **place_id** (`string`)

     - **review_snippets** (`array (ReviewSnippet)`)
       - **review_id** (`string`)        The ID of the review snippet.

       - **title** (`string`)        Title of the review.

       - **url** (`string`)        A link that corresponds to the user review on Google Maps.


     - **url** (`string`)


   - **widget_context_token** (`string`)


     - **signature** (`string`)  A signature hash for backend validation.

     - **type** (`object`) *(Required)*
   Value: `google_maps_result`
    **Examples**
    **GoogleMapsResultStep**


    ```json
    {
  "type": "google_maps_result",
  "call_id": "maps_call_39201",
  "result": [
    {
      "name": "Golden Gate Park",
      "place_id": "ChIJIQBpAG2ahYAR9R7bNdTLg8M",
      "rating": 4.8
    }
  ]
}
    ```
- **GoogleSearchCallStep**
    - Google Search call step.
     - **arguments** (`GoogleSearchCallStepArguments`) *(Required)*  Required. The arguments to pass to Google Search.
   - **queries** (`array (string)`)    Web search queries for the following-up web search.


     - **id** (`string`) *(Required)*  Required. A unique ID for this specific tool call.

     - **search_type** (`enum (string)`)  The type of search grounding enabled.
   Possible values:
   - `web_search`: Setting this field enables web search. Only text results are returned.
   - `image_search`: Setting this field enables image search. Image bytes are returned.

     - **signature** (`string`)  A signature hash for backend validation.

     - **type** (`object`) *(Required)*
   Value: `google_search_call`
    **Examples**
    **GoogleSearchCallStep**


    ```json
    {
  "type": "google_search_call",
  "arguments": {
    "query": "Who won the men's 100m in Paris 2024?"
  },
  "id": "search_call_19201"
}
    ```
- **GoogleSearchResultStep**
    - Google Search result step.
     - **call_id** (`string`) *(Required)*  Required. ID to match the ID from the function call block.

     - **is_error** (`boolean`)  Whether the Google Search resulted in an error.

     - **result** (`array (GoogleSearchResultItem)`) *(Required)*  Required. The results of the Google Search.
   - **search_suggestions** (`string`)    Web content snippet that can be embedded in a web page or an app webview.


     - **signature** (`string`)  A signature hash for backend validation.

     - **type** (`object`) *(Required)*
   Value: `google_search_result`
    **Examples**
    **GoogleSearchResultStep**


    ```json
    {
  "type": "google_search_result",
  "call_id": "search_call_19201",
  "result": [
    {
      "title": "Paris 2024 Olympics: Noah Lyles wins men's 100m gold",
      "url": "https://olympics.com/en/news/paris-2024-noah-lyles-wins-mens-100m-gold",
      "snippet": "American Noah Lyles won the Olympic men's 100m gold medal in a photo finish."
    }
  ]
}
    ```
- **McpServerToolCallStep**
    - MCPServer tool call step.
     - **arguments** (`object`) *(Required)*  Required. The JSON object of arguments for the function.

     - **id** (`string`) *(Required)*  Required. A unique ID for this specific tool call.

     - **name** (`string`) *(Required)*  Required. The name of the tool which was called.

     - **server_name** (`string`) *(Required)*  Required. The name of the used MCP server.

     - **type** (`object`) *(Required)*
   Value: `mcp_server_tool_call`
    **Examples**
    **McpServerToolCallStep**


    ```json
    {
  "name": "calculate_tax",
  "type": "mcp_server_tool_call",
  "arguments": {
    "income": 120000,
    "state": "CA"
  },
  "id": "mcp_call_29012",
  "server_name": "financial_mcp_server"
}
    ```
- **McpServerToolResultStep**
    - MCPServer tool result step.
     - **call_id** (`string`) *(Required)*  Required. ID to match the ID from the function call block.

     - **name** (`string`)  Name of the tool which is called for this specific tool call.

     - **result** (`array (<a href="#Resource:ImageContent">ImageContent</a> or <a href="#Resource:TextContent">TextContent</a>) or object or string`) *(Required)*  Required. The output from the MCP server call. Can be simple text or rich content.

     - **server_name** (`string`)  The name of the used MCP server.

     - **type** (`object`) *(Required)*
   Value: `mcp_server_tool_result`
    **Examples**
    **McpServerToolResultStep**


    ```json
    {
  "type": "mcp_server_tool_result",
  "call_id": "mcp_call_29012",
  "result": {
    "tax_due": 32400
  }
}
    ```
- **ModelOutputStep**
    - Output generated by the model.
     - **content** (`array (<a href="#Resource:Content">Content</a>)`)

     - **type** (`object`) *(Required)*
   Value: `model_output`
    **Examples**
    **ModelOutputStep**


    ```json
    {
  "type": "model_output",
  "content": [
    {
      "type": "text",
      "text": "The capital of France is Paris."
    }
  ]
}
    ```
- **ProcessingCallStep**
    - A server-initiated processing step for media analysis (e.g. video
understanding).
     - **id** (`string`) *(Required)*  Required. A unique ID for this specific tool call.

     - **signature** (`string`)  A signature hash for backend validation.

     - **type** (`object`) *(Required)*
   Value: `processing_call`
- **ProcessingResultStep**
    - The result of a server-initiated media processing step.
     - **call_id** (`string`) *(Required)*  Required. ID to match the ID from the function call block.

     - **signature** (`string`)  A signature hash for backend validation.

     - **type** (`object`) *(Required)*
   Value: `processing_result`
- **ThoughtStep**
    - A thought step.
     - **signature** (`string`)  A signature hash for backend validation.

     - **summary** (`array (ThoughtSummaryContent)`)  A summary of the thought.
   **Possible Types:** (Discriminator: `type`)
   - **ImageContent**: An image content block.
   - **data** (`string`)    The image content.

   - **mime_type** (`enum (string)`)    The mime type of the image.
     Possible values:
     - `image/png`: PNG image format
     - `image/jpeg`: JPEG image format
     - `image/webp`: WebP image format
     - `image/heic`: HEIC image format
     - `image/heif`: HEIF image format
     - `image/gif`: GIF image format
     - `image/bmp`: BMP image format
     - `image/tiff`: TIFF image format

   - **resolution** (`MediaResolution`)    The resolution of the media.
     Possible values:
     - `low`: Low resolution.
     - `medium`: Medium resolution.
     - `high`: High resolution.
     - `ultra_high`: Ultra high resolution.

   - **type** (`object`) *(Required)*
     Value: `image`
   - **uri** (`string`)    The URI of the image.

   - **TextContent**: A text content block.
   - **annotations** (`array (Annotation)`)    Citation information for model-generated content.
     **Possible Types:**
     - **FileCitation**: A file citation annotation.
     - **custom_metadata** (`object`)      User provided metadata about the retrieved context.

     - **document_uri** (`string`)      The URI of the file.

     - **end_index** (`integer`)      End of the attributed segment, exclusive.

     - **file_name** (`string`)      The name of the file.

     - **media_id** (`string`)      Media ID in-case of image citations, if applicable.

     - **page_number** (`integer`)      Page number of the cited document, if applicable.

     - **source** (`string`)      Source attributed for a portion of the text.

     - **start_index** (`integer`)      Start of segment of the response that is attributed to this source.  Index indicates the start of the segment, measured in bytes.

     - **type** (`object`) *(Required)*
       Value: `file_citation`
     - **PlaceCitation**: A place citation annotation.
     - **end_index** (`integer`)      End of the attributed segment, exclusive.

     - **name** (`string`)      Title of the place.

     - **place_id** (`string`)      The ID of the place, in `places/{place_id}` format.

     - **review_snippets** (`array (ReviewSnippet)`)      Snippets of reviews that are used to generate answers about the features of a given place in Google Maps.
       - **review_id** (`string`)        The ID of the review snippet.

       - **title** (`string`)        Title of the review.

       - **url** (`string`)        A link that corresponds to the user review on Google Maps.


     - **start_index** (`integer`)      Start of segment of the response that is attributed to this source.  Index indicates the start of the segment, measured in bytes.

     - **type** (`object`) *(Required)*
       Value: `place_citation`
     - **url** (`string`)      URI reference of the place.

     - **UrlCitation**: A URL citation annotation.
     - **end_index** (`integer`)      End of the attributed segment, exclusive.

     - **start_index** (`integer`)      Start of segment of the response that is attributed to this source.  Index indicates the start of the segment, measured in bytes.

     - **title** (`string`)      The title of the URL.

     - **type** (`object`) *(Required)*
       Value: `url_citation`
     - **url** (`string`)      The URL.

     - **WordInfo**: Word-level ASR annotation for transcription output. Carries the word text, optional timing, and optional speaker attribution.
     - **end_index** (`integer`)      End of the attributed segment, exclusive.

     - **end_offset** (`string`)      End offset in time of the word relative to the start of the audio. Present when timestamp_granularities contains "word".

     - **speaker** (`string`)      Optional. Speaker label for this word (e.g. "spk_1", "spk_2"). Present when diarization_mode is set in TranscriptionConfig.

     - **start_index** (`integer`)      Start of segment of the response that is attributed to this source.  Index indicates the start of the segment, measured in bytes.

     - **start_offset** (`string`)      Start offset in time of the word relative to the start of the audio. Present when timestamp_granularities contains "word".

     - **text** (`string`)      The transcribed word.

     - **type** (`object`) *(Required)*
       Value: `word_info`

   - **text** (`string`) *(Required)*    Required. The text content.

   - **type** (`object`) *(Required)*
     Value: `text`

     - **type** (`object`) *(Required)*
   Value: `thought`
    **Examples**
    **ThoughtStep**


    ```json
    {
  "type": "thought",
  "signature": "thought_sig_abcd1234",
  "summary": [
    {
      "type": "text",
      "text": "The model is searching Google for the capital of France."
    }
  ]
}
    ```
- **UrlContextCallStep**
    - URL context call step.
     - **arguments** (`UrlContextCallArguments`) *(Required)*  Required. The arguments to pass to the URL context.
   - **urls** (`array (string)`)    The URLs to fetch.


     - **id** (`string`) *(Required)*  Required. A unique ID for this specific tool call.

     - **signature** (`string`)  A signature hash for backend validation.

     - **type** (`object`) *(Required)*
   Value: `url_context_call`
    **Examples**
    **UrlContextCallStep**


    ```json
    {
  "type": "url_context_call",
  "arguments": {
    "urls": [
      "https://www.example.com"
    ]
  },
  "id": "url_call_10219"
}
    ```
- **UrlContextResultStep**
    - URL context result step.
     - **call_id** (`string`) *(Required)*  Required. ID to match the ID from the function call block.

     - **is_error** (`boolean`)  Whether the URL context resulted in an error.

     - **result** (`array (UrlContextResult)`) *(Required)*  Required. The results of the URL context.
   - **status** (`enum (string)`)    The status of the URL retrieval.
     Possible values:
     - `success`: Url retrieval is successful.
     - `error`: Url retrieval is failed due to error.
     - `paywall`: Url retrieval is failed because the content is behind paywall.
     - `unsafe`: Url retrieval is failed because the content is unsafe.

   - **url** (`string`)    The URL that was fetched.


     - **signature** (`string`)  A signature hash for backend validation.

     - **type** (`object`) *(Required)*
   Value: `url_context_result`
    **Examples**
    **UrlContextResultStep**


    ```json
    {
  "type": "url_context_result",
  "call_id": "url_call_10219",
  "result": [
    {
      "title": "Example Domain",
      "url": "https://www.example.com",
      "snippet": "This domain is for use in illustrative examples in documents."
    }
  ]
}
    ```
- **UserInputStep**
    - Input provided by the user.
     - **content** (`array (<a href="#Resource:Content">Content</a>)`)

     - **type** (`object`) *(Required)*
   Value: `user_input`
    **Examples**
    **UserInputStep**


    ```json
    {
  "type": "user_input",
  "content": [
    {
      "type": "text",
      "text": "What is the capital of France?"
    }
  ]
}
    ```

**JSON Representation:**
```json
{
  "arguments": {
    "code": "string",
    "language": "python"
  },
  "id": "string",
  "signature": "string",
  "type": {}
}
```


### EnvironmentConfig { #Resource:EnvironmentConfig }
Configuration for a custom environment.

**Properties:**
- **environment_id** (`string`) Optional. The environment ID for the interaction. If specified, the request will update the existing environment instead of creating a new one.

- **network** (`<a href="#Resource:EnvironmentNetworkEgressAllowlist">EnvironmentNetworkEgressAllowlist</a> or enum (string)`) Network configuration for the environment.
  Possible values:
  - `disabled`: Turns all network off.

- **sources** (`array (Source)`)
  - **content** (`string`)   The inline content if `type` is `INLINE`.

  - **encoding** (`string`)   Optional encoding for inline content (e.g. `base64`).

  - **source** (`string`)   The source of the environment. For Cloud Storage, this is the Cloud Storage path. For GitHub, this is the GitHub path.

  - **target** (`string`)   Where the source should appear in the environment.

  - **type** (`enum (string)`)
    Possible values:
    - `gcs`: A Cloud Storage bucket.
    - `inline`: Inline content.
    - `repository`: A generic repository. The protocol prefix in the source URL
identifies the provider (e.g., github://, gcs://).


- **type** (`object`) *(Required)*
  Value: `remote`

**JSON Representation:**
```json
{
  "environment_id": "string",
  "network": {
    "allowlist": [
      {
        "domain": "github.com",
        "transform": [
          {
            "Authorization": "Bearer your-token"
          }
        ]
      },
      {
        "domain": "*.googleapis.com"
      }
    ]
  },
  "sources": [
    {
      "content": "string",
      "encoding": "string",
      "source": "string",
      "target": "string",
      "type": "gcs"
    }
  ],
  "type": {}
}
```

**Examples**
**Inline Sources**

```json
{
  "type": "remote",
  "sources": [
    {
      "type": "inline",
      "content": "You are a data analyst. Always include visualizations and export results as PDF.",
      "target": ".agents/AGENTS.md"
    },
    {
      "type": "inline",
      "content": "---\nname: slide-maker\ndescription: Create HTML slide decks\n---\n# Slide Maker\n\nWhen asked to create a presentation:\n1. Analyze the input data\n2. Create an HTML slide deck with reveal.js\n3. Save to /workspace/output/slides.html",
      "target": ".agents/skills/slide-maker/SKILL.md"
    }
  ]
}
```
**External Sources**

```json
{
  "type": "remote",
  "sources": [
    {
      "type": "repository",
      "source": "https://github.com/my-org/my-skills.git",
      "target": ".agents/skills"
    },
    {
      "type": "gcs",
      "source": "gs://my-bucket/my-folder",
      "target": "/workspace/data"
    }
  ]
}
```
**Network Allowlist**

```json
{
  "type": "remote",
  "network": {
    "allowlist": [
      {
        "domain": "pypi.org"
      },
      {
        "domain": "*.github.com"
      }
    ]
  }
}
```
**Proxy Credentials**

```json
{
  "type": "remote",
  "network": {
    "allowlist": [
      {
        "domain": "api.github.com",
        "transform": {
          "Authorization": "Bearer YOUR_GITHUB_TOKEN"
        }
      }
    ]
  }
}
```

### EnvironmentNetworkEgressAllowlist { #Resource:EnvironmentNetworkEgressAllowlist }
Outbound networking configuration for the sandbox. Accepts an object with an 'allowlist' array to restrict traffic, or the string 'disabled' to turn off all network access. Omit entirely to allow all outbound traffic with no header injection.


**JSON Representation:**
```json
{
  "allowlist": [
    {
      "domain": "github.com",
      "transform": [
        {
          "Authorization": "Bearer your-token"
        }
      ]
    },
    {
      "domain": "*.googleapis.com"
    }
  ]
}
```

**Examples**
**Example**

```json
{
  "allowlist": [
    {
      "domain": "github.com",
      "transform": [
        {
          "Authorization": "Bearer your-token"
        }
      ]
    },
    {
      "domain": "*.googleapis.com"
    }
  ]
}
```

### ToolChoiceConfig { #Resource:ToolChoiceConfig }
The tool choice configuration containing allowed tools.

**Properties:**
- **allowed_tools** (`AllowedTools`) The allowed tools.
  - **mode** (`enum (string)`)   The mode of the tool choice.
    Possible values:
    - `auto`: Auto tool choice.
    - `any`: Any tool choice.
    - `none`: No tool choice.
    - `validated`: Validated tool choice.

  - **tools** (`array (string)`)   The names of the allowed tools.


**JSON Representation:**
```json
{
  "allowed_tools": {
    "mode": "any",
    "tools": [
      "my_tool"
    ]
  }
}
```

**Examples**
**Example**

```json
{
  "allowed_tools": {
    "mode": "any",
    "tools": [
      "my_tool"
    ]
  }
}
```

### ImageContent { #Resource:ImageContent }
An image content block.

**Properties:**
- **data** (`string`) The image content.

- **mime_type** (`enum (string)`) The mime type of the image.
  Possible values:
  - `image/png`: PNG image format
  - `image/jpeg`: JPEG image format
  - `image/webp`: WebP image format
  - `image/heic`: HEIC image format
  - `image/heif`: HEIF image format
  - `image/gif`: GIF image format
  - `image/bmp`: BMP image format
  - `image/tiff`: TIFF image format

- **resolution** (`MediaResolution`) The resolution of the media.
  Possible values:
  - `low`: Low resolution.
  - `medium`: Medium resolution.
  - `high`: High resolution.
  - `ultra_high`: Ultra high resolution.

- **type** (`object`) *(Required)*
  Value: `image`
- **uri** (`string`) The URI of the image.


**JSON Representation:**
```json
{
  "data": "string",
  "mime_type": "image/png",
  "resolution": "low",
  "type": {},
  "uri": "string"
}
```

**Examples**
**Image**

```json
{
  "type": "image",
  "data": "BASE64_ENCODED_IMAGE",
  "mime_type": "image/png"
}
```

### TextContent { #Resource:TextContent }
A text content block.

**Properties:**
- **annotations** (`array (Annotation)`) Citation information for model-generated content.
  **Possible Types:**
  - **FileCitation**: A file citation annotation.
  - **custom_metadata** (`object`)   User provided metadata about the retrieved context.

  - **document_uri** (`string`)   The URI of the file.

  - **end_index** (`integer`)   End of the attributed segment, exclusive.

  - **file_name** (`string`)   The name of the file.

  - **media_id** (`string`)   Media ID in-case of image citations, if applicable.

  - **page_number** (`integer`)   Page number of the cited document, if applicable.

  - **source** (`string`)   Source attributed for a portion of the text.

  - **start_index** (`integer`)   Start of segment of the response that is attributed to this source.  Index indicates the start of the segment, measured in bytes.

  - **type** (`object`) *(Required)*
    Value: `file_citation`
  - **PlaceCitation**: A place citation annotation.
  - **end_index** (`integer`)   End of the attributed segment, exclusive.

  - **name** (`string`)   Title of the place.

  - **place_id** (`string`)   The ID of the place, in `places/{place_id}` format.

  - **review_snippets** (`array (ReviewSnippet)`)   Snippets of reviews that are used to generate answers about the features of a given place in Google Maps.
    - **review_id** (`string`)     The ID of the review snippet.

    - **title** (`string`)     Title of the review.

    - **url** (`string`)     A link that corresponds to the user review on Google Maps.


  - **start_index** (`integer`)   Start of segment of the response that is attributed to this source.  Index indicates the start of the segment, measured in bytes.

  - **type** (`object`) *(Required)*
    Value: `place_citation`
  - **url** (`string`)   URI reference of the place.

  - **UrlCitation**: A URL citation annotation.
  - **end_index** (`integer`)   End of the attributed segment, exclusive.

  - **start_index** (`integer`)   Start of segment of the response that is attributed to this source.  Index indicates the start of the segment, measured in bytes.

  - **title** (`string`)   The title of the URL.

  - **type** (`object`) *(Required)*
    Value: `url_citation`
  - **url** (`string`)   The URL.

  - **WordInfo**: Word-level ASR annotation for transcription output. Carries the word text, optional timing, and optional speaker attribution.
  - **end_index** (`integer`)   End of the attributed segment, exclusive.

  - **end_offset** (`string`)   End offset in time of the word relative to the start of the audio. Present when timestamp_granularities contains "word".

  - **speaker** (`string`)   Optional. Speaker label for this word (e.g. "spk_1", "spk_2"). Present when diarization_mode is set in TranscriptionConfig.

  - **start_index** (`integer`)   Start of segment of the response that is attributed to this source.  Index indicates the start of the segment, measured in bytes.

  - **start_offset** (`string`)   Start offset in time of the word relative to the start of the audio. Present when timestamp_granularities contains "word".

  - **text** (`string`)   The transcribed word.

  - **type** (`object`) *(Required)*
    Value: `word_info`

- **text** (`string`) *(Required)* Required. The text content.

- **type** (`object`) *(Required)*
  Value: `text`

**JSON Representation:**
```json
{
  "annotations": [
    {
      "custom_metadata": {},
      "document_uri": "string",
      "end_index": 0,
      "file_name": "string",
      "media_id": "string",
      "page_number": 0,
      "source": "string",
      "start_index": 0,
      "type": {}
    }
  ],
  "text": "string",
  "type": {}
}
```

**Examples**
**Text**

```json
{
  "type": "text",
  "text": "Hello, how are you?"
}
```
