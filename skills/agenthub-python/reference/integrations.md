# Tracer & Playground

## Tracer

Tracer saves trace files and serves a local UI for inspecting conversations.

Set `trace_id` to save trace files:

```python
from agenthub import AutoLLMClient

client = AutoLLMClient(model="gpt-5.5")

config = {"trace_id": "agent1/conversation_001"}

async for event in client.streaming_response_stateful(
    message={"role": "user", "content_items": [{"type": "text.done", "text": "Hello"}]},
    config=config
):
    pass
```

Default cache dir: `cache`, or `AGENTHUB_CACHE_DIR`. For `trace_id="agent1/conversation_001"`, AgentHub writes:

- `cache/agent1/conversation_001.json`: Structured trace data with the full history and config.
- `cache/agent1/conversation_001.txt`: Human-readable conversation transcript.

Trace files saved before 0.5.0 still load: their legacy item types are converted to the `.done` types when read, until 0.6.0.

Browse traces:

```python
from agenthub.integration.tracer import Tracer

Tracer().start_web_server(host="127.0.0.1", port=25750)
```

Or CLI:

```bash
python -m agenthub.integration.tracer --cache_dir ./cache --host 127.0.0.1 --port 25750
```

Open Tracer at `http://127.0.0.1:25750`.

## Playground

Playground starts a local chat UI for manual model checks.

Start Playground for manual chat:

```python
from agenthub.integration.playground import start_playground_server

start_playground_server(host="127.0.0.1", port=25751)
```

Open Playground at `http://127.0.0.1:25751`.
