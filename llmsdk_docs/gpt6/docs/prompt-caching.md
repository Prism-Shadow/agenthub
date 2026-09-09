# Prompt caching

> For the complete documentation index, see [llms.txt](/llms.txt). Markdown versions of documentation pages are available by appending `.md` to the page URL.

## Why prompt caching matters

Prompt caching reuses work when requests share the same prompt prefix. This provides three main benefits:

- **Compute-efficient:** Avoid recalculating a prompt prefix that the model has already processed.
- **Cheaper input tokens:** Pay the model's reduced cached-input rate for reused tokens, discounted up to 90%.
- **Faster:** Reduce the time spent processing input before the response starts.

Prompt caching is enabled by default for supported OpenAI models. Use the [Prompt Caching Dashboard](https://platform.openai.com/usage?usage_section=prompt-caching) to monitor cache read hit rates and use the [Prompt Cache Diagnostics tool](https://developers.openai.com/api/docs/guides/prompt-caching/diagnostics) to diagnose cache misses and improve cache reuse.

## What is the prompt cache?

When the model processes input tokens, it must calculate intermediate states, known as key-value (KV) states. These states let the model refer back to earlier tokens while processing new input and generating output tokens.

Prompt caching preserves that state for a reusable **prefix**: the unchanged tokens at the beginning of a prompt. When a later request has the same prefix and finds a matching cache entry, the model can reuse the saved state instead of processing those tokens again. It still needs to process any new input to generate a new response.

The prompt cache stores key-value (KV) tensors, not the tokens themselves.



Ask ChatGPT for a deeper explanation



OpenAI caches the model's full rendered context including OpenAI-provided instructions, [developer messages](https://developers.openai.com/api/docs/guides/prompt-engineering#message-roles-and-instruction-following), [tool definitions](https://developers.openai.com/api/docs/guides/function-calling), and [conversation history](https://developers.openai.com/api/docs/guides/conversation-state) containing [text](https://developers.openai.com/api/docs/guides/text), [images](https://developers.openai.com/api/docs/guides/images-vision), [documents](https://developers.openai.com/api/docs/guides/file-inputs), and supported [audio](https://developers.openai.com/api/docs/guides/audio).

Cache reuse requires the entire rendered prefix to match. If content or a relevant setting changes before a breakpoint, the prefix after that change cannot match the existing cache entry.

<a id="which-settings-affect-the-cached-prefix"></a>



### Which settings affect the cached prefix?



Changing a request does not necessarily discard an existing cache entry. What matters is whether a subsequent request has the same prefix and can find an eligible matching breakpoint. The main settings to check are:

| Setting                                                                                                                                                                                                                                                                             | Impact                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`model`](https://developers.openai.com/api/reference/resources/responses/methods/create#%28resource%29%20responses%20%3E%20%28method%29%20create%20%3E%20%28params%29%200.non_streaming%20%3E%20%28param%29%20model%20%3E%20%28schema%29)                                                                       | A different model can use different weights and caching behavior.                                                                                                                                            |
| [`tools`](https://developers.openai.com/api/reference/resources/responses/methods/create#%28resource%29%20responses%20%3E%20%28method%29%20create%20%3E%20%28params%29%200.non_streaming%20%3E%20%28param%29%20tools%20%3E%20%28schema%29)                                                                       | Changes tool names, descriptions, schemas, ordering, or tool-specific instructions.                                                                                                                          |
| [`parallel_tool_calls`](https://developers.openai.com/api/reference/resources/responses/methods/create#%28resource%29%20responses%20%3E%20%28method%29%20create%20%3E%20%28params%29%200.non_streaming%20%3E%20%28param%29%20parallel_tool_calls%20%3E%20%28schema%29)                                           | Can change instructions about calling multiple tools in one turn.                                                                                                                                            |
| [`text.format`](https://developers.openai.com/api/reference/resources/responses/methods/create#%28resource%29%20responses%20%3E%20%28method%29%20create%20%3E%20%28params%29%200.non_streaming%20%3E%20%28param%29%20text%20%3E%20%28schema%29) ([Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs))      | Adds output-format instructions and the requested schema.                                                                                                                                                    |
| [`reasoning.effort`](https://developers.openai.com/api/reference/resources/responses/methods/create#%28resource%29%20responses%20%3E%20%28method%29%20create%20%3E%20%28params%29%200.non_streaming%20%3E%20%28param%29%20reasoning%20%3E%20%28schema%29)                                                        | Can change model-side reasoning instructions. On supported models, use a [configuration update](#change-reasoning-effort-without-rewriting-the-prefix) to change effort while preserving the earlier prefix. |
| [`text.verbosity`](https://developers.openai.com/api/reference/resources/responses/methods/create#%28resource%29%20responses%20%3E%20%28method%29%20create%20%3E%20%28params%29%200.non_streaming%20%3E%20%28param%29%20text%20%3E%20%28schema%29)                                                               | Can change instructions about response detail.                                                                                                                                                               |
| [`context_management`](https://developers.openai.com/api/reference/resources/responses/methods/create#%28resource%29%20responses%20%3E%20%28method%29%20create%20%3E%20%28params%29%200.non_streaming%20%3E%20%28param%29%20context_management%20%3E%20%28schema%29) ([Compaction](https://developers.openai.com/api/docs/guides/compaction)) | Replaces earlier conversation content with a compacted context that can prevent reuse from the first changed token onward.                                                                                   |





## How caching works

A **cache breakpoint** marks the end of a prompt prefix that OpenAI can save to the cache and reuse in later requests. The first request writes an eligible prefix to the cache and subsequent requests look for the longest matching cached prefix available, working backward through eligible breakpoints until they find a match.

A prompt prefix must meet the model's **minimum cacheable token length** before it can be cached. Tokens in the OpenAI-provided hidden system content do not count toward this minimum. The minimum cacheable prompt length is 1,024 tokens for GPT-5.6 and later and varies by request settings for earlier models. See the [model comparison](#summary-of-model-differences) for details.

After the minimum cacheable token length, you can choose where to place cache breakpoints explicitly, or let OpenAI choose their locations implicitly. The available options depend on the model.



<a id="how-caching-works-gpt-5-6-and-later"></a>



### GPT-5.6 and later



For GPT-5.6 and later, cache writes cost 1.25× the standard, uncached input-token rate. It is worth incurring this charge when you know a prefix will be reused, because subsequent reads cost only 0.1× that rate. Writing a prefix once and fully reusing it once costs 1.35× its ordinary input cost, compared with 2× for processing it twice without caching. The savings grow with each additional cache read: across ten requests, one write and nine full reads cost 2.15×, compared with 10× without caching.

Both implicit and explicit caching are supported, where explicit caching gives you more control over which context is written to cache.

**Explicit mode:** You choose where to place cache breakpoints based on your context management.

- Set `prompt_cache_options.mode` to `explicit` to use only developer-selected breakpoints and mark each desired breakpoint by adding `prompt_cache_breakpoint: { "mode": "explicit" }` to a supported content block inside an input message.
- When no explicit breakpoints are placed, the request does not use prompt caching or create cache writes.
- Explicit-only mode lets you choose where cache writes end. Content after the last selected breakpoint is processed at the uncached input-token rate without a cache-write charge, so you can avoid writing changing content that is unlikely to be reused.
- Multiple explicit breakpoints can preserve prefixes that change at different rates. Each request can create up to four cache writes.
- `additional_tools` input items do not currently accept `prompt_cache_breakpoint`.

Top-level `instructions` cannot contain an explicit breakpoint. To mark reusable developer instructions, place them in an `input_text` block inside a developer message.

**Implicit mode:** OpenAI chooses breakpoint locations out of the box that work well for most use cases.

- When `prompt_cache_options.mode` is `implicit`, OpenAI places a breakpoint at the end of the latest eligible message. Eligible messages are:
  - user messages
  - the last tool response in a consecutive group of tool responses
  - the last developer message in the initial consecutive group of developer messages.
- You can add explicit breakpoints without turning off the implicit breakpoint; an implicit breakpoint uses one of the four cache write slots to leave three usable explicit cache write slots.







<a id="how-caching-works-earlier-models"></a>



### Earlier models



Only implicit caching is supported. OpenAI places implicit breakpoints at [model-dependent intervals](#summary-of-model-differences), counted from the beginning of the hidden OpenAI system message. Only breakpoints at or beyond the minimum cacheable length (counted from the end of the hidden context) are eligible.

Reported `cached_tokens` is calculated by subtracting the hidden system tokens from the last matched breakpoint, then rounding down to the nearest multiple of 128.





### How prefix matching works

OpenAI walks through only the **cache lookup boundaries** (explained below) in the incoming request, from longest prefix to shortest, looking for an available matching prefix already cached on the machine.

For GPT-5.6 and later, the cache lookup boundaries in the incoming request are:

- **Explicit-only mode:** The first 2 and latest 50 explicit breakpoints.
- **Implicit mode:** The first 2 and latest 50 explicit breakpoints, the implicit breakpoint, up to 20 earlier eligible message endings, and the endpoint of the initial consecutive block of developer messages. This lets implicit mode reuse a prefix ending at an earlier message without explicit breakpoints there.

## Cache lifetime

Cache entries are not stored indefinitely. A later request can reuse a cached prefix only while its entry remains available, and reusing the prefix refreshes its lifetime without another cache-write charge. The lifetime and retention settings [depend on the model](#summary-of-model-differences).

<a id="prompt-cache-retention"></a>



<a id="cache-lifetime-gpt-5-6-and-later"></a>



### GPT-5.6 and later



Use `prompt_cache_options.ttl` to control the minimum cache lifetime. The only supported value, `30m`, is also the default. A cached prefix remains eligible for reuse for 30 minutes after its most recent write or reuse, though OpenAI may retain it longer.





<a id="extended-prompt-cache-retention"></a>



<a id="cache-lifetime-earlier-models"></a>



### Earlier models



Use `prompt_cache_retention`, with supported values that depend on the model:

- `in_memory`: Entries typically remain active for around 5 to 10 minutes of inactivity, up to one hour.
- `24h`: Extended retention typically keeps entries available for around 30 minutes and can retain them for up to 24 hours.

**Retention defaults and Zero Data Retention**

Prompt caching may store encrypted key/value tensors in GPU-local storage as application state. For models that support both `in_memory` and `24h`, the default depends on your organization's data retention policy:

- Organizations _without_ Zero Data Retention enabled default to `24h`.
- Organizations _with_ Zero Data Retention enabled default to `in_memory`.

Verify the available retention policies for your model and organization before selecting a value.





<a id="where-caching-happens-and-how-long-it-lasts"></a>

<a id="cache-location-and-duration"></a>

<a id="cache-location-and-lifetime"></a>

## Cache location

Cached states live on individual machines, where traffic above 15 requests per minute can lead to overflow routing. A request can reuse a cached prefix only if it reaches a machine holding a matching entry that has not expired. Routing requests to the right machine is therefore important for cache reuse.

Caches are not shared across organizations and cannot be reused across [regional processing boundaries](https://developers.openai.com/api/docs/guides/your-data#data-residency-controls).

OpenAI handles routing automatically. Within an organization and processing region, routing for a given model depends on:

- Current machine load and available capacity.
- A hash of the initial tokens after the hidden OpenAI content, including tool definitions when present. The number of tokens hashed varies by model.
- The optionally supplied [`prompt_cache_key`](#prompt-cache-keys) that controls grouping and distribution during higher-volume traffic, to mitigate request overflow to other machines and, therefore, cache misses.



<a id="prompt-cache-keys"></a>



### Prompt cache keys



When traffic exceeds a machine's available capacity, requests may overflow to another machine. If that machine does not have a matching cache entry, the initial overflow request incurs a cache miss.

Set [`prompt_cache_key`](https://developers.openai.com/api/reference/resources/responses/methods/create#%28resource%29%20responses%20%3E%20%28method%29%20create%20%3E%20%28params%29%200.non_streaming%20%3E%20%28param%29%20prompt_cache_key%20%3E%20%28schema%29) to help requests with the same prefix reach the same cache. Keys influence routing; they do not pin requests to a machine or guarantee a cache read hit. See [how to tune prompt cache keys](#tune-prompt-cache-keys).





<a id="model-differences-at-a-glance"></a>

## Summary of model differences

| Behavior                   | GPT-5.6 and later                                   | GPT-5.5 and GPT-5.5 Pro                                     | Other earlier models                                                            |
| -------------------------- | --------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Implicit breakpoints       | At the end of the latest eligible message.          | Spaced at regular 2,048-token intervals.                    | Spaced at regular, model-dependent intervals.                                   |
| Explicit breakpoints       | Supported                                           | Not supported                                               | Not supported                                                                   |
| Minimum cacheable prefix   | 1,024 visible input tokens                          | Varies by request settings                                  | Varies by request settings                                                      |
| Cached-token reporting     | Exact eligible boundary, excluding hidden tokens    | Excludes hidden tokens and rounds down to a multiple of 128 | Excludes hidden tokens and rounds down to a multiple of 128                     |
| Cache read charge          | 0.1× the uncached input-token rate                  | Model-dependent cached-input rate                           | Model-dependent cached-input rate                                               |
| Cache write charge         | 1.25× the uncached input-token rate                 | No additional cache-write charge                            | No additional cache-write charge                                                |
| Cache lifetime control     | `prompt_cache_options.ttl`                          | `prompt_cache_retention`                                    | `prompt_cache_retention`                                                        |
| Supported retention values | `"30m"`                                             | `"24h"` only                                                | `"in_memory"` or `"24h"`<sup>[\*](#extended-retention-models)</sup>             |
| Cache lifetime             | At least 30 minutes after the latest write or reuse | Typically around 30 minutes, up to 24 hours                 | Typically 5 to 10 minutes inactive for `in_memory`, or up to 24 hours for `24h` |

<a id="extended-retention-models"></a>




\* Extended retention is supported by `gpt-5.5`, `gpt-5.5-pro`, `gpt-5.4`, `gpt-5.2`, `gpt-5.1-codex-max`, `gpt-5.1`, `gpt-5.1-codex`, `gpt-5.1-codex-mini`, `gpt-5.1-chat-latest`, `gpt-5`, `gpt-5-codex`, and `gpt-4.1`.




For models before GPT-5.6, the minimum cacheable input length varies with request settings, including tools, images, output schemas, reasoning effort, and verbosity.

<a id="best-practices"></a>

## How to optimize prompt caching

Focus on [preserving conversation history](#preserve-conversation-history), [keeping tool definitions stable](#manage-tools-with-append-only-updates), and understanding the three main cache controls. Use [`prompt_cache_options.mode` and `prompt_cache_breakpoint`](#choose-a-caching-mode) to choose where caching occurs, and [`prompt_cache_key`](#tune-prompt-cache-keys) to help related requests reach the same cache.



Ask ChatGPT to optimize my prompt caching





<a id="preserve-conversation-history"></a>



### Preserve conversation history



In multi-turn applications, reusing the growing conversation history can save more input tokens than caching only the initial instructions. Preserve earlier messages and tool results so later turns can reuse the full shared prefix.

- **Keep the prefix stable.** Put stable developer instructions and shared reference material first. If developer instructions or shared material contain timestamps, user-specific content, or other dynamic content, place those at the end rather than the beginning, or move them into later conversation messages.
- **Preserve conversation history.** Append new messages rather than rewriting earlier turns. Summarization, [compaction](#compaction-can-reduce-cache-reuse), or context truncation can change the prefix and reset cache reuse.
- **Change reasoning effort without rewriting the prefix.** On GPT-6 Astra, append a `configuration_update` input item to change reasoning effort between responses while keeping request-level `reasoning.effort` unchanged. This preserves the original prefix for cache reuse. See [Change reasoning mid-conversation](https://developers.openai.com/api/docs/guides/reasoning#change-reasoning-mid-conversation) for examples and compatibility limits.

Keep changing content after the breakpoint

```json
{
  "model": "gpt-5.6",
  "reasoning": { "effort": "low", "context": "all_turns" },
  "text": { "verbosity": "medium" },
  "prompt_cache_options": { "mode": "explicit" },
  "input": [
    {
      "role": "developer",
      "content": [
        {
          "type": "input_text",
          "text": "Stable instructions and shared reference material...",
          "prompt_cache_breakpoint": { "mode": "explicit" }
        }
      ]
    },
    {
      "role": "developer",
      "content": "Dynamic developer instructions, such as user-specific content and timestamps..."
    },
    {
      "role": "user",
      "content": "The user's current question..."
    }
  ]
}
```








<a id="change-reasoning-effort-without-rewriting-the-prefix"></a>



### Change reasoning effort without rewriting the prefix



On supported GPT-6 and later models, append a `configuration_update` input item to [change reasoning effort during a conversation](https://developers.openai.com/api/docs/guides/reasoning?api-mode=responses#change-reasoning-mid-conversation) while preserving the earlier cached prefix. Keep the top-level `reasoning.effort` at its original value as changing that setting can rewrite instructions in the hidden system instructions.

The latest configuration update controls the reasoning effort for subsequent responses. For example, append this item to the existing `input` array to switch to `high` reasoning for the subsequent requests:

Item to append to the input array

```json
{
  "type": "configuration_update",
  "reasoning": { "effort": "high" }
}
```








<a id="manage-tools-with-append-only-updates"></a>



### Manage tools with append-only updates



When the tools your application needs vary between requests, change which tools are callable while keeping their definitions stable to preserve reusable prefixes.

- **Keep tools consistent.** Preserve tool definitions, ordering, and schemas.
- **Disable tool use for a request.** Set [`tool_choice`](https://developers.openai.com/api/docs/guides/function-calling#tool-choice) to `"none"` instead of removing the tool definitions.
- **Enable only selected tools.** Use [`allowed_tools`](https://developers.openai.com/api/docs/guides/function-calling#tool-choice) to restrict which tools are callable while keeping the supplied `tools` list stable.
- **Load tools when needed.** Use [tool search](https://developers.openai.com/api/docs/guides/tools-tool-search) with `defer_loading: true` to reduce input tokens spent on tool definitions in early requests of multi-turn threads. Discovered tools are appended at the end of context, preserving earlier reusable content.
- **Preserve tool-loading history.** Use a developer-role [`additional_tools` input item](https://developers.openai.com/api/docs/guides/tools-tool-search#add-tools-at-a-specific-point-in-the-input) to add tools during a thread according to your application's logic.







<a id="choose-a-caching-mode"></a>



### Choose a caching mode



On GPT-5.6 and later, two controls determine where cache breakpoints are placed: `prompt_cache_options.mode` selects implicit or explicit-only caching, and `prompt_cache_breakpoint` marks a boundary you choose.

- **Place breakpoints automatically.** Use implicit caching to place a breakpoint at the end of the latest eligible message. This is convenient for multi-turn threads that append to existing context.
- **Choose breakpoints deliberately.** Place explicit markers at the end of stable content. Use explicit-only mode to avoid unnecessary cache writes for changing suffixes.



> Illustration: In explicit-only mode, tools and schemas precede a stable developer-message prefix and breakpoint 1. One branch adds a variable developer suffix and more conversation turns before breakpoint 2, then splits into new user inputs. Another branch has an unselected variable suffix. Content after each branch's last selected breakpoint is charged at the uncached input rate without a cache-write charge.









<a id="tune-prompt-cache-keys"></a>



### Tune prompt cache keys



- **Group related requests.** Combine a prompt version with a stable user, workspace, session, or thread ID that matches how your application reuses context. For example:
  - `prompt_name_v1:user_123` groups a user's related requests that share a prompt version.
  - `prompt_name_v1:session_456` groups requests within one session.
  - `prompt_name_v1:workspace_acme:shard_3` groups requests within a stable shard of a workspace.
- **Keep keys stable.** Reuse the key while its prefix remains useful; do not generate a new key for every request.
- **Split busy groups.** If a group receives high traffic and cache read hits decline, distribute it across more keys with a stable, deterministic mapping. Keep related requests on the same shard so they can reuse its cache.

Create stable cache keys

```javascript
import { createHash } from "node:crypto";

const tenantId = "acme";
const sessionId = "session-42";
const promptVersion = "support-v3";
// Tune for peak traffic per tenant and reusable prompt group; monitor cache hits.
const shardCount = 16;

const digest = createHash("sha256")
  .update(`${tenantId}:${sessionId}`)
  .digest("hex");
const shard = Number.parseInt(digest.slice(0, 8), 16) % shardCount;
const promptCacheKey = `${promptVersion}:${tenantId}:shard-${shard}`;
```

```python
import hashlib

tenant_id = "acme"
session_id = "session-42"
prompt_version = "support-v3"
# Tune for peak traffic per tenant and reusable prompt group; monitor cache hits.
shard_count = 16

digest = hashlib.sha256(f"{tenant_id}:{session_id}".encode()).hexdigest()
shard = int(digest[:8], 16) % shard_count
prompt_cache_key = f"{prompt_version}:{tenant_id}:shard-{shard}"
```

```java
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

String tenantId = "acme";
String sessionId = "session-42";
String promptVersion = "support-v3";
int shardCount = 16;

String digest =
    HexFormat.of()
        .formatHex(
            MessageDigest.getInstance("SHA-256")
                .digest((tenantId + ":" + sessionId).getBytes(StandardCharsets.UTF_8)));
long shard = Long.parseLong(digest.substring(0, 8), 16) % shardCount;
String promptCacheKey = promptVersion + ":" + tenantId + ":shard-" + shard;
```

```ruby
require "digest"

tenant_id = "acme"
session_id = "session-42"
prompt_version = "support-v3"
# Tune for peak traffic per tenant and reusable prompt group; monitor cache hits.
shard_count = 16

digest = Digest::SHA256.hexdigest("#{tenant_id}:#{session_id}")
shard = digest.slice(0, 8).to_s.to_i(16) % shard_count
prompt_cache_key = "#{prompt_version}:#{tenant_id}:shard-#{shard}"
```






<a id="choose-a-cache-lifetime"></a>



<a id="configure-cache-retention"></a>



### Configure cache retention



For earlier models, prefer setting `prompt_cache_retention` to `"24h"` for extended retention when the model and your data-retention requirements allow it. See [Cache lifetime](#cache-lifetime) for supported settings and defaults.





<a id="a-shared-prefix-just-below-the-caching-minimum"></a>



<a id="escape-the-minimum-cacheable-length-cost-trap"></a>



### Escape the minimum cacheable length cost trap



If many requests reuse the same developer instructions and tool definitions, but that shared prefix falls below the model's [minimum cacheable length](#summary-of-model-differences), consider shortening it or expanding it with useful, stable instructions, examples, or reference material. Measure whether cache reuse offsets the additional input tokens and any cache-write charges, and ensure evaluations and behaviour remain stable.

The chart highlights the minimum cacheable length cost trap where short prefix lengths can cost more uncached than expanding to the minimum cacheable token length.

<a id="mathematical-details"></a>



#### Mathematical details



For a cost-only comparison, let $$M$$ be the minimum cacheable length, $$L < M$$ the original prefix length, $$r$$ the cache-read multiplier, $$w$$ the cache-write multiplier, and $$N$$ the total number of requests. Assume the expanded prefix is exactly $$M$$ tokens, is written once, and is fully reused on every later request. In uncached-input-token equivalents, keeping the original prefix costs $$N \times L$$, while expanding it costs $$M \left[w + (N - 1)r\right]$$. The break-even original length is:

$$
L_{\mathrm{break\text{-}even}} = M\left(r + \frac{w-r}{N}\right)
$$

Expand when $$L > L_{\mathrm{break\text{-}even}}$$; keeping the shorter prefix costs less when $$L < L_{\mathrm{break\text{-}even}}$$. At equality, the costs are the same. The smallest whole-token length for which expansion is cheaper is $$\left\lfloor L_{\mathrm{break\text{-}even}} \right\rfloor + 1$$. Conversely, shrinking a cacheable prefix below $$M$$ loses caching: under the same assumptions, the shorter uncached prefix must fall below $$L_{\mathrm{break\text{-}even}}$$ to cost less than caching $$M$$ tokens. There is no universal maximum-cost prompt length; the crossover depends on reuse and pricing.

For example, with $$M = 1{,}024$$, $$r = 0.1$$, and $$w = 1.25$$, the crossover is $$102.4 + \frac{1{,}177.6}{N}$$ tokens. Across 10 requests, expanding an original prefix of at least 221 tokens to 1,024 tokens is cheaper. As reuse grows, the crossover approaches 102.4 tokens. A 103-token prefix needs at least 1,963 total requests to benefit; a prefix of 102 tokens or fewer never does under these assumptions. This comparison excludes performance, output tokens, and unchanged request costs. Additional misses, writes, or different model rates change the result.











<a id="monitor-cache-performance"></a>



### Monitor cache performance



- **Measure actual cache performance.** Track `usage.input_tokens_details.cached_tokens`, `usage.input_tokens_details.cache_write_tokens`, input-token counts, latency, and realized cost. Track the token cache-hit rate by dividing total cached tokens by total input tokens, aggregating both counts by user, workspace, day, or another useful grouping.
- **Calculate input cost.** Use the token counts in `response.usage` and the model's [prices per million tokens](https://developers.openai.com/api/docs/pricing).
- **Use the prompt caching dashboard.** Monitor cache hit rates in the [Prompt Caching Dashboard](https://platform.openai.com/usage?usage_section=prompt-caching).

Calculate input cost

```javascript
function calculateInputCost(
  usage,
  inputPricePerMillion,
  cacheInputMultiplier = 0.1,
  cacheWriteMultiplier = 1.25
) {
  const inputTokens = usage.input_tokens;
  const cachedTokens = usage.input_tokens_details.cached_tokens;
  const cacheWriteTokens = usage.input_tokens_details.cache_write_tokens;
  const ordinaryInputTokens = inputTokens - cachedTokens - cacheWriteTokens;

  const weightedInputTokens =
    ordinaryInputTokens +
    cachedTokens * cacheInputMultiplier +
    cacheWriteTokens * cacheWriteMultiplier;
  const inputCost = (weightedInputTokens * inputPricePerMillion) / 1_000_000;
  return inputCost;
}
```

```python
from openai.types.responses import ResponseUsage


def calculate_input_cost(
    usage: ResponseUsage,
    input_price_per_million: float,
    cache_input_multiplier: float = 0.1,
    cache_write_multiplier: float = 1.25,
) -> float:
    input_tokens = usage.input_tokens
    cached_tokens = usage.input_tokens_details.cached_tokens
    cache_write_tokens = usage.input_tokens_details.cache_write_tokens
    ordinary_input_tokens = input_tokens - cached_tokens - cache_write_tokens

    weighted_input_tokens = (
        ordinary_input_tokens
        + cached_tokens * cache_input_multiplier
        + cache_write_tokens * cache_write_multiplier
    )
    input_cost = weighted_input_tokens * input_price_per_million / 1_000_000
    return input_cost
```

```ruby
def calculate_input_cost(
  usage,
  input_price_per_million,
  cache_input_multiplier = 0.1,
  cache_write_multiplier = 1.25
)
  input_tokens = usage.input_tokens
  details = usage.input_tokens_details
  cached_tokens = details.cached_tokens
  cache_write_tokens = details.cache_write_tokens
  ordinary_input_tokens = input_tokens - cached_tokens - cache_write_tokens

  weighted_input_tokens =
    ordinary_input_tokens +
    (cached_tokens * cache_input_multiplier) +
    (cache_write_tokens * cache_write_multiplier)
  (weighted_input_tokens * input_price_per_million) / 1_000_000
end
```








<a id="migrate-prompt-caching-from-an-earlier-model-to-gpt-5-6-and-later"></a>



### Migrate prompt caching from an earlier model to GPT-5.6 and later



- Keep existing stable prefixes.
- Keep existing `prompt_cache_key` values.
- Replace `prompt_cache_retention` with `prompt_cache_options.ttl`.
- Confirm that reusable prefixes meet the model's [minimum cacheable length](#summary-of-model-differences).
- If the default breakpoint includes content that changes between requests, add an explicit breakpoint after the stable prefix.
- Use `prompt_cache_options.mode: "explicit"` when later content is not worth writing.
- [Compare `cached_tokens`, `cache_write_tokens`, latency, and total cost](#monitor-cache-performance) before and after migration.





## Examples



<a id="single-turn-llm-as-a-judge"></a>



### Single-turn LLM-as-a-Judge



Consider a single-turn LLM judge that determines whether a completed interaction shows evidence that the user is satisfied after an interaction with a chatbot. Each request uses the same grading rubric and labeled few-shot examples to evaluate a different interaction.

- **Preserving the prefix:** The fixed rubric and examples come first. Their combined length is deliberately kept just above the model's [minimum cacheable length](#summary-of-model-differences), using material that helps calibrate the judge. The interaction being evaluated comes last.
- **Prompt cache key:** A stable `prompt_cache_key`, such as `satisfaction_judge_v1`, groups requests using the same rubric version.
- **Caching mode and breakpoint:** Explicit-only caching is enabled, with a breakpoint after the fixed rubric and examples. The user–chatbot conversation being evaluated comes after that breakpoint and is not written to the cache, avoiding a cache-write charge for content that is unlikely to be reused.

An example deployment using these principles reported a **token cache-hit rate of ~70%**. This figure illustrates a possible outcome. Actual cache-hit rate ceilings will depend upon your context and application usage.

Responses API request for a single-turn judge

```json
{
  "model": "gpt-5.6-sol",
  "reasoning": { "effort": "medium", "context": "all_turns" },
  "text": { "verbosity": "low" },
  "prompt_cache_key": "satisfaction_judge_v1",
  "prompt_cache_options": { "mode": "explicit" },
  "input": [
    {
      "role": "developer",
      "content": [
        {
          "type": "input_text",
          "text": "Judge whether the completed interaction provides evidence that the user is satisfied. Return true or false. Full grading rubric and labeled few-shot examples...",
          "prompt_cache_breakpoint": { "mode": "explicit" }
        }
      ]
    },
    {
      "role": "user",
      "content": "Completed interaction to evaluate..."
    }
  ]
}
```








<a id="multi-turn-agent"></a>



### Multi-turn agent



Consider a multi-turn agent with long, shared developer instructions and frequent tool calls. Typical usage sees users running multiple sessions with the agent at once, and often forking the threads.

- **Preserving the prefix**: Each turn appends new messages, tool calls, and results without rewriting earlier context, so the reusable prefix grows over time.
- **Prompt cache key:** The `prompt_cache_key` is defined for each user-agent pair, shared across that user's sessions with the agent. For example, `agent_123_v1:user_456` groups user 456's sessions and forks with agent 123. The session and thread IDs are kept out of the key when those sessions should share the same reusable prefix.
- **Implicit caching mode:** Implicit caching is enabled so the latest eligible user or tool message provides a breakpoint.
- **Explicit breakpoints:** A breakpoint is added after each tool result to preserve earlier reusable prefixes and improve cache efficiency of forking.

An example deployment using these principles reported a **token cache-hit rate >90%**. This figure illustrates a possible outcome. Actual cache-hit rate ceilings will depend upon your context and application usage.

Responses API request for a multi-turn agent

```json
{
  "model": "gpt-5.6-sol",
  "reasoning": { "effort": "medium", "context": "all_turns" },
  "text": { "verbosity": "medium" },
  "prompt_cache_key": "agent_123_v1:user_456",
  "prompt_cache_options": { "mode": "implicit" },
  "tools": [
    {
      "type": "function",
      "name": "function_name",
      "description": "Function description",
      "parameters": { "...": "..." }
    }
  ],
  "input": [
    {
      "role": "developer",
      "content": "Stable developer instructions and reference material..."
    },
    { "role": "user", "content": "Can you do...?" },
    {
      "type": "function_call",
      "call_id": "call_123",
      "name": "function_name",
      "arguments": "..."
    },
    {
      "type": "function_call_output",
      "call_id": "call_123",
      "output": [
        {
          "type": "input_text",
          "text": "Tool result...",
          "prompt_cache_breakpoint": { "mode": "explicit" }
        }
      ]
    },
    { "role": "assistant", "content": "Assistant response..." },
    { "role": "user", "content": "Can you also do...?" }
  ]
}
```






<a id="troubleshooting"></a>

## Gotchas



<a id="a-shared-prefix-is-not-always-a-cached-prefix"></a>



### A shared prefix is not always a cached prefix



This is particularly prevalent when [migrating from earlier models to GPT-5.6 or later](#migrate-prompt-caching-from-an-earlier-model-to-gpt-5-6-and-later) due to the change in implicit caching behaviour. If requests share a long prefix but have different suffixes, caching the first complete request implicitly-only does not make the shorter shared prefix reusable.

Consider a static developer message followed by a dynamic user message in each request. This request writes through the dynamic content. Changing that content in the next request does not match the longer cached prefix, and there is no separate breakpoint after the static content.

Without a breakpoint after the static content

```json
{
  "model": "gpt-5.6-sol",
  "reasoning": { "effort": "medium", "context": "all_turns" },
  "text": { "verbosity": "low" },
  "prompt_cache_key": "prompt_name_v1",
  "prompt_cache_options": { "mode": "implicit" },
  "input": [
    { "role": "developer", "content": "Static content..." },
    { "role": "user", "content": "Dynamic content..." }
  ]
}
```


To remediate, place an explicit breakpoint after the static content in both requests. The first request writes the reusable prefix; the next can reuse it even when the dynamic content changes. This example uses explicit-only mode to avoid writing the dynamic content to cache.

With a breakpoint after the static content

```json
{
  "model": "gpt-5.6-sol",
  "reasoning": { "effort": "medium", "context": "all_turns" },
  "text": { "verbosity": "low" },
  "prompt_cache_key": "prompt_name_v1",
  "prompt_cache_options": { "mode": "explicit" },
  "input": [
    {
      "role": "developer",
      "content": [{
        "type": "input_text",
        "text": "Static content...",
        "prompt_cache_breakpoint": { "mode": "explicit" }
      }]
    },
    { "role": "user", "content": "Dynamic content..." }
  ]
}
```








<a id="switching-to-explicit-only-mode-can-miss-an-implicit-cache-write"></a>



### Switching to explicit-only mode can miss an implicit cache write



Suppose request 1 uses implicit mode and caches a prefix through the end of a user message, then follow-up request 2 preserves that prefix but switches to `prompt_cache_options.mode: "explicit"`. As explained in [How prefix matching works](#how-prefix-matching-works), request 2 checks only the explicit breakpoints in its own input, so it will not reuse that saved implicit prefix from request 1 (unless one of the explicit breakpoints in request 2 matches the cached endpoint from request 1).

```text
▼ = breakpoint

- Request 1: implicit mode
  [Developer message][User message] ▼

- Request 2: explicit-only mode. Does not hit cache.
  [Developer message][User message][Follow-up] ▼
```

To reuse the implicit prefix from request 1, place an explicit breakpoint at the matching content-block boundary in request 2, or keep implicit mode enabled so the earlier eligible message ending remains a lookup candidate.







<a id="extending-a-message-can-prevent-reuse-of-its-cached-prefix"></a>



### Extending a message can prevent reuse of its cached prefix



Even when both requests use implicit mode, preserving the same initial tokens is not always enough. Suppose request 1 ends with a user message containing `Content A`, then follow-up request 2 extends that same message to `Content A + Content B`. The old endpoint after `Content A` is now inside a message, rather than at its end. As explained in [How prefix matching works](#how-prefix-matching-works), without an explicit breakpoint at that boundary, request 2 does not reuse the prefix saved there.

```text
▼ = breakpoint

- Request 1: implicit mode
  [Developer message][User message: Content A] ▼

- Request 2: implicit mode. Cannot reuse the prefix through Content A.
  [Developer message][User message: Content A + Content B] ▼
```

When the conversation structure permits, preserve the original message and append a new message instead. Otherwise, keep the reusable text in a separate content block and place an explicit breakpoint after it in both requests.







<a id="not-all-developer-messages-are-automatic-implicit-mode-cache-lookup-boundaries"></a>



### Not all developer messages are automatic implicit mode cache lookup boundaries



In implicit mode, developer messages after the initial consecutive block of developer messages are not automatic cache lookup boundaries. Add an explicit breakpoint at the end of the reusable developer message to preserve that breakpoint in subsequent requests so OpenAI can check for a matching cached prefix.







<a id="minimum-cacheable-length-varies-by-model"></a>



### Minimum cacheable length varies by model



A prefix that qualifies for caching on one model may be too short on another. Check the [model comparison](#summary-of-model-differences) and measure the reusable prefix with the model and settings you actually use. When changing models, repeat that check rather than assuming the previous model's threshold still applies.







<a id="compaction-can-reduce-cache-reuse"></a>



### Compaction can reduce cache reuse



[Compaction](https://developers.openai.com/api/docs/guides/compaction) replaces earlier conversation context with a shorter representation. That can change the prefix, so the first request after compaction may reuse less of the previous cache even when the conversation is logically the same.

Keep reusable instructions and reference material stable where possible, then let subsequent turns build on the compacted context. Compare total input cost before and after compaction: fewer input tokens can still save money even when the cache-hit rate falls.





## Frequently asked questions



<a id="does-prompt-caching-affect-output-generation"></a>



### Does prompt caching affect output generation?



No. Prompt caching does not change how the model generates output tokens. The model generates a new response using the cached prefix, so identical requests are not guaranteed to produce identical outputs.







<a id="can-i-manually-clear-the-cache"></a>



### Can I manually clear the cache?



No. Manual cache clearing is not currently available. Cache entries expire according to the model's [cache lifetime](#cache-lifetime) and retention settings.







<a id="do-cached-prompts-count-toward-rate-limits"></a>



### Do cached prompts count toward rate limits?



Yes. Cached input tokens still count toward tokens-per-minute limits. Prompt caching does not change how [rate limits](https://developers.openai.com/api/docs/guides/rate-limits) are calculated.