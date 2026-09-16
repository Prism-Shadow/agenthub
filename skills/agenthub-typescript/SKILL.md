---
name: agenthub-typescript
description: Guidance for using the AgentHub TypeScript SDK (`@prismshadow/agenthub`). Use when developing agents that call different LLM APIs, need a unified interface for LLM providers, mention AgentHub, request `@prismshadow/agenthub`, or already import it.
---

# AgentHub TypeScript

AgentHub is a unified SDK for calling LLMs across providers with shared data models, tool calling, tracing, and playground support.

## Installation

```bash
npm install @prismshadow/agenthub
```

For model IDs, API keys, and base URLs, see [Model selection](reference/models.md).

## Basic Usage

This example asks GPT to call a weather tool, runs the tool, then sends the result back.

```typescript
import { AutoLLMClient, ToolCallDoneItem } from "@prismshadow/agenthub";

function getWeather(location: string): string {
  return `Temperature in ${location}: 22 C`;
}

// Map tool names to their implementations so calls can be dispatched by name.
const TOOLS: Record<string, (args: Record<string, any>) => string> = {
  get_weather: (args) => getWeather(args.location as string),
};

async function main(): Promise<void> {
  const weatherTool = {
    name: "get_weather",
    description: "Gets the current weather for a given location.",
    parameters: {
      type: "object" as const,
      properties: {
        location: {
          type: "string" as const,
          description: "The city name",
        },
      },
      required: ["location"],
    },
  };

  const client = new AutoLLMClient({ model: "gpt-5.5" });
  const config = { tools: [weatherTool] };

  let toolCall: ToolCallDoneItem | null = null;
  for await (const event of client.streamingResponseStateful({
    message: {
      role: "user",
      content_items: [{ type: "text.done", text: "What's the weather in London?" }],
    },
    config,
  })) {
    if (event.event_type === "stop") {
      // Always the last event, exactly once: the response has finished.
      console.log(event.finish_reason, event.usage_metadata);
    }
    for (const item of event.content_items) {
      if (item.type === "tool_call.done") {
        toolCall = item; // the complete call; tool_call.delta items are fragments
      }
    }
  }

  if (toolCall) {
    // Dispatch by tool name instead of hardcoding the function.
    const result = TOOLS[toolCall.name](toolCall.arguments);

    for await (const event of client.streamingResponseStateful({
      message: {
        role: "user",
        content_items: [
          {
            type: "tool_result.done",
            text: result,
            tool_call_id: toolCall.tool_call_id,
          },
        ],
      },
      config,
    })) {
      console.log(event);
      // Streams the answer as text.delta fragments, closes it with text.done, then one stop event carrying usage:
      // { role: 'assistant', event_type: 'delta', content_items: [ { type: 'text.delta', text: 'The' } ], usage_metadata: null, finish_reason: null }
      // { role: 'assistant', event_type: 'delta', content_items: [ { type: 'text.delta', text: ' weather' } ], usage_metadata: null, finish_reason: null }
      // { role: 'assistant', event_type: 'delta', content_items: [ { type: 'text.delta', text: ' is 22 C.' } ], usage_metadata: null, finish_reason: null }
      // { role: 'assistant', event_type: 'delta', content_items: [ { type: 'text.done', text: 'The weather is 22 C.' } ], usage_metadata: null, finish_reason: null }
      // { role: 'assistant', event_type: 'stop', content_items: [], usage_metadata: { cached_tokens: 0, prompt_tokens: 12, thoughts_tokens: 0, response_tokens: 8 }, finish_reason: 'stop' }
    }
  }
}

void main();
```

## Notes

Keep these points in mind for agent loops:

- Read tool calls from `tool_call.done` items. `tool_call.delta` items are argument fragments for live display only.
- Send every tool result with the exact `tool_call_id` from its originating `tool_call.done`. Do not invent, normalize, or reuse IDs across unrelated tool calls.
- If streamed tool-call arguments cannot be parsed, AgentHub throws `ToolCallArgumentParseError` in place of the `tool_call.done`. Do not execute the tool from partial arguments; let the agent runtime retry or re-prompt the model.
- Read usage and the finish reason from the `stop` event: it is always the last event, arrives exactly once, and always carries both. `delta` events carry `null` for both. A thinking-only response throws `EmptyResponseError` instead of the `stop` event; its `usageMetadata` still reports the tokens.
- Write message items with the `.done` types (`text.done`, `tool_result.done`, …). Types without the suffix are still accepted, with a deprecation warning, until 0.6.0.
- Preserve `thinking.done` and `inline_thinking.done` items. Do not strip or modify `fidelity` fields.
- For embedding models, each `UniMessage` in the `messages` array produces **one embedding vector**. Within a single message, all items in `content_items` are aggregated into a single embedding. Set `embedding_config.dimensions` in the config to control vector size.

## Reference

- [Model selection](reference/models.md) — model IDs, API keys, base URLs, and OpenAI-compatible routing.
- [Data models](reference/data-models.md) — `UniConfig`, `UniMessage`, `UniEvent`, the streaming protocol, and errors.
- [APIs](reference/api.md) — client initialization and method signatures.
- [Tracer & Playground](reference/integrations.md) — local tracing UI and the manual chat playground.
