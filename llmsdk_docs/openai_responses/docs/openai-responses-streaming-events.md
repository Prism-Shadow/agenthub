# OpenAI Responses streaming events (excerpt)

> Excerpt of https://developers.openai.com/api/reference/resources/responses/streaming-events
> (raw markdown served at the same URL with `.md` appended), fetched 2026-09-09.
>
> The upstream page is ~15.6 MB of generated schema JSON and is not snapshotted whole. This
> file keeps the events AgentHub's Responses-protocol clients act on: the two output-item
> lifecycle events, the reasoning item they carry, every `response.reasoning_*` event, the
> terminal events, and the usage object. Event descriptions, field docstrings and `Example`
> payloads are copied from the page unchanged in wording; the generated schema dumps around
> them are omitted, and hard-wrapped docstrings are reflowed.

## response.output_item.added

Emitted when a new output item is added.

### Fields

- `item: ResponseOutputItem`

  The output item that was added. For reasoning items, `encrypted_content` may be incomplete while
  the item is in progress. Use the reasoning item from the corresponding
  `response.output_item.done` event when passing it as input to a subsequent request.

- `output_index: number`

  The index of the output item that was added.

- `sequence_number: number`

  The sequence number of this event.

- `type: union`

  The type of the event. Always `response.output_item.added`.

### Example

```json
{
  "type": "response.output_item.added",
  "output_index": 0,
  "item": {
    "id": "msg_123",
    "status": "in_progress",
    "type": "message",
    "role": "assistant",
    "content": []
  },
  "sequence_number": 1
}
```

### `reasoning` output item (union variant of `ResponseOutputItem`)

A description of the chain of thought used by a reasoning model while generating a response.
Be sure to include these items in your `input` to the Responses API for subsequent turns of a
conversation if you are manually [managing context](/api/docs/guides/conversation-state).

- `id: string`

  The unique identifier of the reasoning content.

- `summary: array`

  Reasoning summary content.

- `type: union`

  The type of the object. Always `reasoning`.

- `content: optional array`

  Reasoning text content.

- `encrypted_content: optional string`

  The encrypted content of the reasoning item. This is populated by default for reasoning items
  returned by `POST /v1/responses` and WebSocket `response.create` requests.

  When streaming, use the completed reasoning item and its `encrypted_content` from the
  `response.output_item.done` event in subsequent requests. The `encrypted_content` in
  `response.output_item.added` may be incomplete. This is especially important when `store` is
  `false` or when using Zero Data Retention.

- `status: optional union`

  The status of the item. One of `in_progress`, `completed`, or `incomplete`. Populated when items
  are returned via API.

## response.output_item.done

Emitted when an output item is marked done.

### Fields

- `item: ResponseOutputItem`

  The output item that was marked done.

- `output_index: number`

  The index of the output item that was marked done.

- `sequence_number: number`

  The sequence number of this event.

- `type: union`

  The type of the event. Always `response.output_item.done`.

### Example

```json
{
  "type": "response.output_item.done",
  "output_index": 0,
  "item": {
    "id": "msg_123",
    "status": "completed",
    "type": "message",
    "role": "assistant",
    "content": [
      {
        "type": "output_text",
        "text": "In a shimmering forest under a sky full of stars, a lonely unicorn named Lila discovered a hidden pond that glowed with moonlight. Every night, she would leave sparkling, magical flowers by the water's edge, hoping to share her beauty with others. One enchanting evening, she woke to find a group of friendly animals gathered around, eager to be friends and share in her magic.",
        "annotations": []
      }
    ]
  },
  "sequence_number": 1
}
```

## response.reasoning_summary_part.added

Emitted when a new reasoning summary part is added.

### Fields

- `item_id: string`

  The ID of the item this summary part is associated with.

- `output_index: number`

  The index of the output item this summary part is associated with.

- `part: object`

  The summary part that was added.

- `sequence_number: number`

  The sequence number of this event.

- `summary_index: number`

  The index of the summary part within the reasoning summary.

- `type: union`

  The type of the event. Always `response.reasoning_summary_part.added`.

### Example

```json
{
  "type": "response.reasoning_summary_part.added",
  "item_id": "rs_6806bfca0b2481918a5748308061a2600d3ce51bdffd5476",
  "output_index": 0,
  "summary_index": 0,
  "part": {
    "type": "summary_text",
    "text": ""
  },
  "sequence_number": 1
}
```

## response.reasoning_summary_part.done

Emitted when a reasoning summary part is completed.

### Fields

- `item_id: string`

  The ID of the item this summary part is associated with.

- `output_index: number`

  The index of the output item this summary part is associated with.

- `part: object`

  The completed summary part.

- `sequence_number: number`

  The sequence number of this event.

- `summary_index: number`

  The index of the summary part within the reasoning summary.

- `type: union`

  The type of the event. Always `response.reasoning_summary_part.done`.

- `status: optional union`

  The completion status of the summary part. Omitted when the part completed normally and set to
  `incomplete` when generation was interrupted.

### Example

```json
{
  "type": "response.reasoning_summary_part.done",
  "item_id": "rs_6806bfca0b2481918a5748308061a2600d3ce51bdffd5476",
  "output_index": 0,
  "summary_index": 0,
  "part": {
    "type": "summary_text",
    "text": "**Responding to a greeting**\n\nThe user just said, \"Hello!\" So, it seems I need to engage. I'll greet them back and offer help since they're looking to chat. I could say something like, \"Hello! How can I assist you today?\" That feels friendly and open. They didn't ask a specific question, so this approach will work well for starting a conversation. Let's see where it goes from there!"
  },
  "sequence_number": 1
}
```

## response.reasoning_summary_text.delta

Emitted when a delta is added to a reasoning summary text.

### Fields

- `delta: string`

  The text delta that was added to the summary.

- `item_id: string`

  The ID of the item this summary text delta is associated with.

- `output_index: number`

  The index of the output item this summary text delta is associated with.

- `sequence_number: number`

  The sequence number of this event.

- `summary_index: number`

  The index of the summary part within the reasoning summary.

- `type: union`

  The type of the event. Always `response.reasoning_summary_text.delta`.

### Example

```json
{
  "type": "response.reasoning_summary_text.delta",
  "item_id": "rs_6806bfca0b2481918a5748308061a2600d3ce51bdffd5476",
  "output_index": 0,
  "summary_index": 0,
  "delta": "**Responding to a greeting**\n\nThe user just said, \"Hello!\" So, it seems I need to engage. I'll greet them back and offer help since they're looking to chat. I could say something like, \"Hello! How can I assist you today?\" That feels friendly and open. They didn't ask a specific question, so this approach will work well for starting a conversation. Let's see where it goes from there!",
  "sequence_number": 1
}
```

## response.reasoning_summary_text.done

Emitted when a reasoning summary text is completed.

### Fields

- `item_id: string`

  The ID of the item this summary text is associated with.

- `output_index: number`

  The index of the output item this summary text is associated with.

- `sequence_number: number`

  The sequence number of this event.

- `summary_index: number`

  The index of the summary part within the reasoning summary.

- `text: string`

  The full text of the completed reasoning summary.

- `type: union`

  The type of the event. Always `response.reasoning_summary_text.done`.

### Example

```json
{
  "type": "response.reasoning_summary_text.done",
  "item_id": "rs_6806bfca0b2481918a5748308061a2600d3ce51bdffd5476",
  "output_index": 0,
  "summary_index": 0,
  "text": "**Responding to a greeting**\n\nThe user just said, \"Hello!\" So, it seems I need to engage. I'll greet them back and offer help since they're looking to chat. I could say something like, \"Hello! How can I assist you today?\" That feels friendly and open. They didn't ask a specific question, so this approach will work well for starting a conversation. Let's see where it goes from there!",
  "sequence_number": 1
}
```

## response.reasoning_text.delta

Emitted when a delta is added to a reasoning text.

### Fields

- `content_index: number`

  The index of the reasoning content part this delta is associated with.

- `delta: string`

  The text delta that was added to the reasoning content.

- `item_id: string`

  The ID of the item this reasoning text delta is associated with.

- `output_index: number`

  The index of the output item this reasoning text delta is associated with.

- `sequence_number: number`

  The sequence number of this event.

- `type: union`

  The type of the event. Always `response.reasoning_text.delta`.

### Example

```json
{
  "type": "response.reasoning_text.delta",
  "item_id": "rs_123",
  "output_index": 0,
  "content_index": 0,
  "delta": "The",
  "sequence_number": 1
}
```

## response.reasoning_text.done

Emitted when a reasoning text is completed.

### Fields

- `content_index: number`

  The index of the reasoning content part.

- `item_id: string`

  The ID of the item this reasoning text is associated with.

- `output_index: number`

  The index of the output item this reasoning text is associated with.

- `sequence_number: number`

  The sequence number of this event.

- `text: string`

  The full text of the completed reasoning content.

- `type: union`

  The type of the event. Always `response.reasoning_text.done`.

### Example

```json
{
  "type": "response.reasoning_text.done",
  "item_id": "rs_123",
  "output_index": 0,
  "content_index": 0,
  "text": "The user is asking...",
  "sequence_number": 4
}
```

## response.completed

Emitted when the model response is complete.

### Fields

- `response: Response`

  Properties of the completed response.

- `sequence_number: number`

  The sequence number for this event.

- `type: union`

  The type of the event. Always `response.completed`.

### Example

```json
{
  "type": "response.completed",
  "response": {
    "id": "resp_123",
    "object": "response",
    "created_at": 1740855869,
    "status": "completed",
    "completed_at": 1740855870,
    "error": null,
    "incomplete_details": null,
    "input": [],
    "instructions": null,
    "max_output_tokens": null,
    "model": "gpt-6-astra",
    "output": [
      {
        "id": "msg_123",
        "type": "message",
        "role": "assistant",
        "content": [
          {
            "type": "output_text",
            "text": "In a shimmering forest under a sky full of stars, a lonely unicorn named Lila discovered a hidden pond that glowed with moonlight. Every night, she would leave sparkling, magical flowers by the water's edge, hoping to share her beauty with others. One enchanting evening, she woke to find a group of friendly animals gathered around, eager to be friends and share in her magic.",
            "annotations": []
          }
        ]
      }
    ],
    "previous_response_id": null,
    "reasoning_effort": null,
    "store": false,
    "temperature": 1,
    "text": {
      "format": {
        "type": "text"
      }
    },
    "tool_choice": "auto",
    "tools": [],
    "top_p": 1,
    "truncation": "disabled",
    "usage": {
      "input_tokens": 0,
      "output_tokens": 0,
      "output_tokens_details": {
        "reasoning_tokens": 0
      },
      "total_tokens": 0
    },
    "user": null,
    "metadata": {}
  },
  "sequence_number": 1
}
```

## response.incomplete

An event that is emitted when a response finishes as incomplete.

Over WebSocket, steering can finish a response with
`response.incomplete_details.reason` set to `steered`, followed automatically
by a successor `response.created` that commits the queued steering input.

### Fields

- `response: Response`

  The response that was incomplete.

- `sequence_number: number`

  The sequence number of this event.

- `type: union`

  The type of the event. Always `response.incomplete`.

### Example

```json
{
  "type": "response.incomplete",
  "response": {
    "id": "resp_123",
    "object": "response",
    "created_at": 1740855869,
    "status": "incomplete",
    "completed_at": null,
    "error": null,
    "incomplete_details": {
      "reason": "max_tokens"
    },
    "instructions": null,
    "max_output_tokens": null,
    "model": "gpt-6-astra",
    "output": [],
    "previous_response_id": null,
    "reasoning_effort": null,
    "store": false,
    "temperature": 1,
    "text": {
      "format": {
        "type": "text"
      }
    },
    "tool_choice": "auto",
    "tools": [],
    "top_p": 1,
    "truncation": "disabled",
    "usage": null,
    "user": null,
    "metadata": {}
  },
  "sequence_number": 1
}
```

## response.failed

An event that is emitted when a response fails.

### Fields

- `response: Response`

  The response that failed.

- `sequence_number: number`

  The sequence number of this event.

- `type: union`

  The type of the event. Always `response.failed`.

### Example

```json
{
  "type": "response.failed",
  "response": {
    "id": "resp_123",
    "object": "response",
    "created_at": 1740855869,
    "status": "failed",
    "completed_at": null,
    "error": {
      "code": "server_error",
      "message": "The model failed to generate a response."
    },
    "incomplete_details": null,
    "instructions": null,
    "max_output_tokens": null,
    "model": "gpt-6-astra",
    "output": [],
    "previous_response_id": null,
    "reasoning_effort": null,
    "store": false,
    "temperature": 1,
    "text": {
      "format": {
        "type": "text"
      }
    },
    "tool_choice": "auto",
    "tools": [],
    "top_p": 1,
    "truncation": "disabled",
    "usage": null,
    "user": null,
    "metadata": {}
  }
}
```

## error

Emitted when an error occurs.

### Fields

- `code: string`

  The error code.

- `message: string`

  The error message.

- `param: string`

  The error parameter.

- `sequence_number: number`

  The sequence number of this event.

- `type: union`

  The type of the event. Always `error`.

### Example

```json
{
  "type": "error",
  "code": "ERR_SOMETHING",
  "message": "Something went wrong",
  "param": null,
  "sequence_number": 1
}
```

## Response object fields read by the terminal events

The `response` payload of `response.completed`, `response.incomplete` and `response.failed`
is the full Response object. Only the fields the clients read are kept here.

- `error: ResponseError`

  An error object returned when the model fails to generate a Response.

- `incomplete_details: object`

  Details about why the response is incomplete.

- `model: ResponsesModel`

  Model ID used to generate the response, like `gpt-6-astra`. OpenAI offers a wide range of models
  with different capabilities, performance characteristics, and price points. Refer to the [model
  guide](/api/docs/models) to browse and compare available models.

- `service_tier: optional ServiceTier`

  Specifies the processing type used for serving the request. - If set to 'auto', then the request
  will be processed with the service tier configured in the Project settings. Unless otherwise
  configured, the Project will use 'default'. - If set to 'default', then the request will be
  processed with the standard pricing and performance for the selected model. - If set to
  '[flex](/api/docs/guides/flex-processing)', then the request will be processed with the Flex
  Processing service tier. - To opt-in to [Fast mode](/api/docs/guides/fast-mode) at the request
  level, include the `service_tier=fast` or `service_tier=priority` parameter for Responses or
  Chat Completions. The response will show `service_tier=priority` regardless of if you specify
  `service_tier=fast` or `priority` in your request. - If set to 'ultrafast', then the request
  will be processed with the access-controlled Ultrafast Processing service tier. This tier is
  currently available for `gpt-5.6-sol`; a response served through it will show
  `service_tier=ultrafast`. - When not set, the default behavior is 'auto'.

  When the `service_tier` parameter is set, the response body will include the `service_tier`
  value based on the processing mode actually used to serve the request. This response value may
  be different from the value set in the parameter.

- `status: optional ResponseStatus`

  The status of the response generation. One of `completed`, `failed`, `in_progress`, `cancelled`,
  `queued`, or `incomplete`.

- `usage: optional ResponseUsage`

  Represents token usage details including input tokens, output tokens, a breakdown of output
  tokens, and the total tokens used.

## Usage object

Represents token usage details including input tokens, output tokens, a breakdown of output
tokens, and the total tokens used.

- `input_tokens: number`

  The number of input tokens.

- `input_tokens_details: object`

  A detailed breakdown of the input tokens.

- `output_tokens: number`

  The number of output tokens.

- `output_tokens_details: object`

  A detailed breakdown of the output tokens.

- `total_tokens: number`

  The total number of tokens used.

### `usage.input_tokens_details`

- `cache_write_tokens: number`

  The number of input tokens that were written to the cache.

- `cached_tokens: number`

  The number of tokens that were retrieved from the cache. [More on prompt
  caching](/api/docs/guides/prompt-caching).

### `usage.output_tokens_details`

- `reasoning_tokens: number`

  The number of reasoning tokens.
