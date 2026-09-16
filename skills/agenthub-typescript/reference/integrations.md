# Tracer & Playground

## Tracer

Tracer saves trace files and serves a local UI for inspecting conversations.

Set `trace_id` to save trace files:

```typescript
import { AutoLLMClient } from "@prismshadow/agenthub";

const client = new AutoLLMClient({ model: "gpt-5.5" });

const config = { trace_id: "agent1/conversation_001" };

for await (const event of client.streamingResponseStateful({
  message: {
    role: "user",
    content_items: [{ type: "text.done", text: "Hello" }],
  },
  config,
})) {
  console.log(event);
}
```

Default cache dir: `cache`, or `AGENTHUB_CACHE_DIR`. For `trace_id="agent1/conversation_001"`, AgentHub writes:

- `cache/agent1/conversation_001.json`: Structured trace data with the full history and config.
- `cache/agent1/conversation_001.txt`: Human-readable conversation transcript.

Trace files saved before 0.5.0 still load: their legacy item types are converted to the `.done` types when read, until 0.6.0.

Browse traces:

```typescript
import { Tracer } from "@prismshadow/agenthub/integration/tracer";

const tracer = new Tracer();
tracer.startWebServer("127.0.0.1", 25750);
```

Open Tracer at `http://127.0.0.1:25750`.

## Playground

Playground starts a local chat UI for manual model checks.

Start Playground for manual chat:

```typescript
import { startPlaygroundServer } from "@prismshadow/agenthub/integration/playground";

startPlaygroundServer("127.0.0.1", 25751);
```

Open Playground at `http://127.0.0.1:25751`.
