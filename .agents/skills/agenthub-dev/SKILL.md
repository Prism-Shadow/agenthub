---
name: agenthub-dev
description: Fixed workflow for developing AgentHub itself — adding or updating model support. Use when asked to support a new model or protocol version in this repository, sync llmsdk_docs, or implement a provider client. Covers doc syncing, live API capture, paired Python/TypeScript implementation, and model-scoped e2e testing.
---

# AgentHub Development Workflow

Adding or updating model support follows the stages below, in order. Where a stage says **stop and ask**, pause and ask the user; do not continue until the issue is resolved, and never fill the gap yourself.

## Directory map

```
llmsdk_docs/<model_version>/      Official docs snapshot, one folder per model generation (README.md + docs/)
api_captures/<protocol>/          Git-ignored raw API captures: request payloads + stream events
src_py/agenthub/<protocol>/       Python client, one folder per wire protocol
src_py/agenthub/auto_client.py    Routes model names to protocol clients by explicit version
src_ts/src/<protocol>/            TypeScript client, mirrors the Python folder
src_ts/src/autoClient.ts          TypeScript routing, mirrors auto_client.py
src_py/tests/test_client.py       Parameterized e2e tests (env-gated AVAILABLE_MODELS)
src_ts/tests/client.test.ts       Same for TypeScript
changelog/unreleased/             Where unshipped changes go; renamed to the version at release
changelog/<version>/              Release summary (README.md) plus one detail file per entry
changelog/README.md               The entry format: metadata block, body rules, bilingual pairing
CHANGELOG.md                      One brief line per release linking into changelog/
<name>.zh.md                      Chinese counterpart, required for every file in changelog/
```

## Stage 1 — Sync official docs into `llmsdk_docs/`

- Sources must be the model vendor's official documentation site (e.g. docs.anthropic.com, platform.openai.com, ai.google.dev). Never use third-party mirrors, blog posts, or model memory.
- Save the snapshot under `llmsdk_docs/<model_version>/` following the existing folder conventions, and list the folder in `llmsdk_docs/README.md`. Running this workflow is the explicit request that the repository rule against editing `llmsdk_docs/` asks for.
- When the fetched docs differ from an existing snapshot, the new official docs win: update the old files in place.
- The snapshot must be complete enough to implement from: request/response schemas, streaming event sequence, thinking output, tool calling, usage fields, and error responses.
- **Stop and ask** if the official URL is uncertain or a page cannot be fetched. The user can paste the content manually.

## Stage 2 — Capture a live API exchange into `api_captures/`

- Gate: the provider's API key environment variable must be set and usable. Use the same environment variables and base URLs as `src_py/tests/test_client.py` (`AVAILABLE_MODELS` gating and `_create_client`). **Stop and ask** the user to supply the key if it is missing; the workflow must not continue without it.
- Using the provider's official SDK, or raw HTTP exactly as documented, run one streaming tool-call request with thinking enabled, then send the tool result back so the capture also shows how assistant turns are re-sent.
- Save the complete exchange unmodified under `api_captures/<protocol>/` (git-ignored), e.g. `round1.request.json` plus `round1.stream.jsonl` with every raw stream event in order. Never save credentials.
- When something in the exchange will not serialize to JSON (binary payloads, SDK objects holding non-JSON values), save its `str()` form and analyze from that. Keep the container parseable: wrap the text in a JSON object so the `.jsonl` stays one JSON value per line (`{"unserializable_str": "<str(event)>"}`, keeping the event in stream order), or put the whole exchange in a sibling `.txt` when nothing about it serializes. A `str()` capture is still the authoritative record of what the API returned. Never drop the event, hand-edit it into valid JSON, or fall back to the docs because serialization failed.
- **Stop and ask** on any API error (invalid key, insufficient quota, rate limit). Do not mock the response or continue from docs alone.
- The capture is the primary implementation reference and outranks the docs: where they disagree, implement what the API actually returned.
- Then probe the replay, because the capture only shows what the API *sends*, not what it *needs back*. Re-send the assistant turn repeatedly, each time with one candidate field removed — the reasoning item's id, its content, the whole reasoning item, each field you were tempted to keep — and record which removals the API still accepts with the model's behavior intact. That result, not the shape of the response, decides what Stage 3 stores. Save the probe outcomes next to the capture.

## Stage 3 — Implement the Python and TypeScript clients

- One folder per wire protocol, named after the newest model generation that uses it. Diff the new protocol (capture + docs) against the closest existing folder:
  - Any difference between generations, even a single key name, means a separate folder per generation (e.g. `claude4_6/` vs `claude5/`).
  - Only an identical wire protocol may share a folder; name it after the newest generation (rename and reroute if needed). This is how `claude5/` serves Claude 4.7, 4.8, and 5.
  - When the old and new generations' implementations differ, keep the old model supported: leave its client folder and routing in place and add a new client folder for the new model. Never delete or rewire away an old model's client unless the user explicitly instructs it.
- `auto_client.py` / `autoClient.ts` route model names by explicit version matching only, never a bare substring like `"claude" in model`.
- Replay must be **minimal, not exhaustive**. A replayed assistant turn has to be accepted by the API with the model's behavior intact; it does not have to reproduce the wire item field for field. `fidelity` is an exception channel, not a mirror of the payload: a field earns a place there only when the Stage 2 probe shows the request fails or the model degrades without it. Provider-generated ids the API regenerates or ignores — a reasoning item id, an output-item id — stay out. Fields the API demands go in: GPT-5.5's `phase`, Claude's thinking `signature`, the exact reasoning field name a strict upstream requires.
- Never copy into `fidelity` what a universal field already carries — the thinking text, a tool call's name or parsed arguments. Rebuild the wire item from the universal fields instead.
- `tool_call_id` is not optional: always capture the provider's call id and replay it. Where the wire format carries both an item id and a call id, the call id is the one that correlates a result to its call.
- **Follow the reference client; do not redesign.** `gpt5_5/` is the shape for Responses-style protocols, `openai/` for Chat Completions: same method order, same control flow, same names. A new client should read as a diff against its reference, because that is how it will be reviewed.
- **Keep it readable top to bottom.** A reader should follow one request or response straight through the file without jumping between definitions, so inlining is the default: read the SDK's attributes directly (`model_output.delta`, `model_output.item.call_id`) and keep field access, usage arithmetic, and error text where they are used. Extract a helper only for a genuinely large, self-contained block — the kind that would bury the main flow if inlined, such as fetching and decoding an image — never for a few lines. Mirror the reference client's own private methods (`_convert_thinking_level_*`, `_convert_tool_choice`) instead of inventing a layer beside them; a shim that accepts both dicts and SDK objects is never one of them, because the events are typed with the SDK's own types.
- **Stream on deltas only.** Open a partial tool call on the item-added event (name plus call id), accumulate its arguments from the argument deltas, and emit the complete `tool_call` item at the terminal event, exactly as `gpt5_5` does — every client must emit a complete `tool_call`, not just partials. List completion events (`response.output_item.done` and its equivalents) with the ignored types: never re-read a completed item or cross-check it against what the deltas produced. Leave provider error events (`response.failed`, `response.error`, `error`) to the unknown-event guard rather than translating them into AgentHub errors. `minimax_m3` is the deliberate exception: it reads each call from `response.output_item.done`, ignoring the argument deltas, and announces it as the Gemini clients do — one fragment carrying the whole arguments, then the complete `tool_call`. A client streams on deltas or delivers the completed item, never both, so the fragment stream and the complete call can never disagree.
- **`unused` never leaves the client.** A wire event a client has nothing universal to emit for gets `event_type: "unused"`, and the streaming loop skips it — it is the client's own bookkeeping, not an event a caller may see. The base client drops one that escapes and raises on it under `AGENTHUB_DEBUG`, so a client that forgets the filter fails in CI rather than shipping empty events.
- **The message transform keeps the order of the content items.** Whatever a turn produced — thinking, then text, then a tool call — has to leave the transform in that order. Where a protocol makes an item its own entry (a Responses `reasoning` / `function_call`, say) and the message text is collected separately, flush the collected text before appending the entry; a message appended after the items it preceded is what DeepSeek answers with "No tool output found for tool call". Anthropic Messages and Gemini keep one ordered block list per message, so appending in item order is enough; Chat Completions splits content and `tool_calls` into fields of one message and carries no interleaving at all.
- `UniConfig` keys rarely map one-to-one onto provider config keys. **Stop and ask**: list every non-obvious mapping and confirm it with the user before coding. Never decide silently.
- Every `ThinkingLevel` must stay usable on every client — never raise for a thinking level. Map each level to the closest level the model supports and degrade silently when a level has no exact equivalent (e.g. `gemini3_7` maps `NONE` to `MINIMAL`, or to `low` on the models that reject `minimal`; `kimi_k3` maps `NONE` to `low` because K3 cannot disable reasoning).
- `temperature` and `tool_choice` (and other unsupported parameter values, e.g. `prompt_caching`) may reject with an exception, but must raise the AgentHub-specific `UnsupportedParameterError` from `errors.py` / `errors.ts`, never a bare `ValueError`/`Error`. Keep the message wording consistent with existing clients (containing "not support").
- Implement Python and TypeScript together with identical behavior.

## Stage 4 — Verify

- Register the model in the env-gated `AVAILABLE_MODELS` lists of both test files with correct capability flags. Do not add model-specific test functions or files.
- That `AVAILABLE_MODELS` entry is the **only** test change a new model is entitled to. `src_py/tests/test_client.py` and `src_ts/tests/client.test.ts` are shared contracts every client must already satisfy: never rewrite their bodies, assertions, prompts, or helpers to accommodate one model, and never branch inside them on a model name. A failing shared test means the client is wrong until proven otherwise. **Stop and ask** for explicit approval before any broader test edit, and get it per change — approval for one edit is not approval for the next.
- `AVAILABLE_MODELS` keeps only the newest version of each model family per provider block (e.g. gemini-3.6-flash, not gemini-3.5-flash or 3.5-flash-lite as well). When a newer generation lands, replace the older entry — the old client folder stays supported and routed (see Stage 3) but is no longer e2e-tested.
- Static checks: `make lint` in `src_py/`; `npm run lint` and `npm run build` in `src_ts/`.
- Run only the new model's e2e tests; the full suites are slow and spend real API quota:
  - `cd src_py && uv run pytest -vvv tests/test_client.py -k "<model-name>"`
  - `cd src_ts && npm run test -- -t "<model-name>"`
- Leave unrelated tests to CI.

## Supported-model registry

- `src_py/agenthub/registry.py` / `src_ts/src/registry.ts` list the supported models as entries of (model, base_url, client) plus input/output modalities, context window, and USD-stored pricing keyed by AgentHub's usage buckets. Keep both languages identical; the registry unit test constructs every entry through `AutoLLMClient`.
- For OpenRouter-hosted entries, pull authoritative data from the live models API `GET https://openrouter.ai/api/v1/models` (docs: https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties): `pricing.prompt`/`completion` are USD per token (multiply by 1e6), plus `context_length` and `architecture.input_modalities`/`output_modalities`. The API lists chat models only — embedding models are absent and must be checked via their model pages.
- SiliconFlow publishes no pricing API; declare official CNY list prices with the `cny()` initializer (converted to USD storage at 7 CNY/USD).

## Record and ship

- Unreleased changes all land in `changelog/unreleased/`, named for its state rather than a number because the version is not decided until release. Never create a numbered folder for unshipped work and never invent the next version number; release preparation renames `unreleased/` to the decided version.
- Write `changelog/unreleased/YYYY-MM-DD-<slug>.md` in the format `changelog/README.md` specifies: the metadata block (`Date`, `Type`, `Scope`, `PR`, `Issue`, `Breaking`) directly under the title, then `## What changed` recording what the change did, plus the factual detail it introduced (config mappings, registry metadata, protocol differences) and `## Compatibility` when it breaks something.
- The entry records what was done, never the reasoning behind it and never the state of the codebase. `## Why`, `## Problem`, `## Decision`, `## Alternatives considered`, `## Verification`, `## Risks` do not belong on disk, and neither do claims like "`X` is not exported from `Y`": they read as fact, go stale as the code moves, and every later reader pays to re-check them.
- The reasoning is still required — it goes where it stays tied to its moment. Report it in the conversation as the work happens (what the probes returned, which alternatives you weighed and why the others lost, what the verification actually covered, what you are unsure of), and write it into the PR description. Anyone who needs it later pulls the PR description, `git log`, or `git blame`.
- Link the PR and any issue the change closes as full URLs (`https://github.com/Prism-Shadow/agenthub/pull/N`), in the metadata block and in the release-README line. A bare `#N` is not a link in a Markdown file. The PR number only exists once the PR is open, so open it first, then add both links in a follow-up commit on the same branch.
- Write the Chinese counterpart `changelog/<version>/YYYY-MM-DD-<slug>.zh.md` in the same PR, mirroring the English file section for section. The metadata block stays English verbatim (only the `Breaking` reason is prose to translate), as do code identifiers, model ids, and links; `changelog/README.md` lists the standard heading renderings. An entry without its counterpart is unfinished.
- Add one line at the top of that version's `changelog/<version>/README.md` and the matching line in `README.zh.md`, whose `[详情]` link points at the `.zh.md` entry; the root `CHANGELOG.md` and `CHANGELOG.zh.md` keep one line per release, added at release preparation.
- Commit on a feature branch and open a PR with `gh pr create --base dev`; direct pushes to `dev` are rejected.
