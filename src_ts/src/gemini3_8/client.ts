// Copyright 2025 Prism Shadow. and/or its affiliates
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {
  Content,
  EmbedContentConfig,
  GoogleGenAI,
  Interactions,
  Part,
} from "@google/genai";
import * as path from "path";
import { ClientPart, LLMClient } from "../baseClient";
import { UnsupportedParameterError } from "../errors";
import {
  DeltaContentItem,
  FinishReason,
  PromptCaching,
  ThinkingLevel,
  ToolChoice,
  UniConfig,
  UniMessage,
} from "../types";
import { isDebugEnabled } from "../utils";

type GeminiThinkingLevel = "minimal" | "low" | "medium" | "high";

type InteractionRequest = Omit<
  Interactions.CreateModelInteractionParamsStreaming,
  "input"
>;

// the text and image blocks a thought summary or a function result is made of
type TextImageBlocks = NonNullable<Interactions.ThoughtStep["summary"]>;

/**
 * Unified client for the Gemini family, named for the newest generation it
 * serves (3.8). It speaks the Interactions API statelessly (store=false, the
 * whole history in every request) for 3.8 back through the 3.x text, image,
 * and TTS models with an API key; Vertex AI is served by
 * gemini3_8_generate_content. It embeds through embedContent, because the
 * Interactions API does not serve the embedding models, and applies the
 * 3.6-generation parameter contract to the whole family: temperature is
 * rejected everywhere.
 *
 * Starting with the 3.6 generation the API deprecates the temperature/top_p/top_k
 * sampling parameters (silently ignored today, HTTP 400 in future
 * generations), so this client rejects them instead of sending a no-op.
 */
export class Gemini3_8Client extends LLMClient {
  protected _model: string;
  private _client: GoogleGenAI;

  /**
   * Initialize Gemini 3.8 client with model and API key.
   */
  constructor(options: {
    model: string;
    apiKey?: string;
    baseUrl?: string | null;
    clientType?: string | null;
    defaultHeaders?: Record<string, string>;
  }) {
    super();
    this._model = options.model;
    const key = options.apiKey || process.env.GEMINI_API_KEY || undefined;
    const url = options.baseUrl || process.env.GEMINI_BASE_URL || undefined;
    // the Gemini SDK carries connection headers inside httpOptions rather than its own argument
    const httpOptions: { baseUrl?: string; headers?: Record<string, string> } =
      {};
    if (url) {
      httpOptions.baseUrl = url;
    }
    if (options.defaultHeaders) {
      httpOptions.headers = options.defaultHeaders;
    }
    if (key && key.startsWith("{")) {
      const credentials = JSON.parse(key);
      const googleAuthOptions = {
        credentials,
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      };
      this._client = new GoogleGenAI({
        vertexai: true,
        location: "global",
        project: credentials.project_id,
        googleAuthOptions,
        httpOptions,
      });
    } else {
      this._client = new GoogleGenAI({
        apiKey: key,
        httpOptions,
      });
    }
  }

  /**
   * Detect MIME type from URL extension for image.
   */
  private _detectImageMimeType(url: string): string {
    const ext = path.extname(url).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
      ".bmp": "image/bmp",
      ".gif": "image/gif",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".tiff": "image/tiff",
      ".webp": "image/webp",
    };
    return mimeTypes[ext] || "image/jpeg";
  }

  /**
   * Get image bytes and MIME type from URL.
   */
  private async _getImageBytesAndMimeType(
    url: string,
    signal?: AbortSignal,
  ): Promise<{ data: Buffer; mimeType: string }> {
    if (url.startsWith("data:")) {
      const match = url.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const mimeType = match[1];
        const base64Data = match[2];
        const data = Buffer.from(base64Data, "base64");
        return { data, mimeType };
      } else {
        throw new Error(`Invalid base64 image: ${url}`);
      }
    } else {
      const response = await fetch(url, { signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${url}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const data = Buffer.from(arrayBuffer);
      const mimeType = this._detectImageMimeType(url);
      return { data, mimeType };
    }
  }

  // Gemini thinking levels from weakest to strongest, used to pick the
  // closest supported level when a model rejects the requested one.
  private static readonly GEMINI_LEVEL_ORDER: GeminiThinkingLevel[] = [
    "minimal",
    "low",
    "medium",
    "high",
  ];

  /**
   * Thinking levels the target model accepts (llmsdk_docs/gemini_interactions/docs/thinking.md).
   *
   * An empty array means the model rejects the thinking_level parameter
   * entirely, so it must be omitted from the request.
   */
  private _supportedThinkingLevels(): GeminiThinkingLevel[] {
    if (this._model.includes("-image")) {
      return ["minimal", "high"];
    }
    if (this._model.includes("gemini-3-pro")) {
      // The only pro generation without "medium".
      return ["low", "high"];
    }
    if (this._model.includes("-pro")) {
      // Every pro generation rejects "minimal"; matching broadly keeps
      // future pro models on the safe side (clamping a level the model
      // would have accepted costs a little accuracy, forwarding an
      // unsupported one is a 400).
      return ["low", "medium", "high"];
    }
    if (
      this._model.includes("gemini-3.7") ||
      this._model.includes("gemini-3.8")
    ) {
      // Both generations reject "minimal" with a 400 (3.7 verified live 2026-08-13,
      // 3.7 and 3.8 again through the Interactions API 2026-09-16).
      return ["low", "medium", "high"];
    }
    return Gemini3_8Client.GEMINI_LEVEL_ORDER;
  }

  /**
   * Convert ThinkingLevel enum to the closest Gemini thinking level the model supports.
   */
  private _convertThinkingLevel(
    thinkingLevel: ThinkingLevel | undefined,
  ): GeminiThinkingLevel | undefined {
    if (!thinkingLevel) return undefined;

    const mapping: { [key: string]: GeminiThinkingLevel } = {
      [ThinkingLevel.NONE]: "minimal",
      [ThinkingLevel.LOW]: "low",
      [ThinkingLevel.MEDIUM]: "medium",
      [ThinkingLevel.HIGH]: "high",
      [ThinkingLevel.XHIGH]: "high",
      // Gemini stops at "high", so both top levels land there before per-model clamping
      [ThinkingLevel.MAX]: "high",
    };
    const level = mapping[thinkingLevel];
    if (level === undefined) {
      return undefined;
    }
    const supported = this._supportedThinkingLevels();
    if (supported.length === 0) {
      // A model that takes no thinking_level at all has nothing to clamp onto, so the
      // parameter is omitted rather than turned into a failed request. thinking_summary
      // is unaffected -- thinking_summaries still rides along.
      return undefined;
    }
    if (supported.includes(level)) {
      return level;
    }
    // Degrade silently to the nearest supported level; ties round up,
    // e.g. MEDIUM becomes HIGH on gemini-3-pro and NONE maps to LOW on
    // gemini-3.7-flash. `supported` is non-empty here, so the
    // initial-value-less reduce cannot throw.
    const order = Gemini3_8Client.GEMINI_LEVEL_ORDER;
    const index = order.indexOf(level);
    return supported.reduce((best, candidate) => {
      const bestDistance = Math.abs(order.indexOf(best) - index);
      const candidateDistance = Math.abs(order.indexOf(candidate) - index);
      if (candidateDistance !== bestDistance) {
        return candidateDistance < bestDistance ? candidate : best;
      }
      return order.indexOf(candidate) > order.indexOf(best) ? candidate : best;
    });
  }

  /**
   * Convert ToolChoice to the Interactions API tool_choice.
   */
  private _convertToolChoice(
    toolChoice: ToolChoice,
  ): Interactions.GenerationConfig["tool_choice"] {
    if (Array.isArray(toolChoice)) {
      // allowed_tools takes only the "any" and "validated" modes (verified live 2026-09-16)
      return { allowed_tools: { mode: "any", tools: toolChoice } };
    } else if (toolChoice === "none") {
      return "none";
    } else if (toolChoice === "auto") {
      return "auto";
    } else if (toolChoice === "required") {
      return "any";
    }
    return undefined;
  }

  /**
   * Transform universal configuration to an Interactions API request without its input.
   */
  transformUniConfigToModelConfig(config: UniConfig): InteractionRequest {
    if (config.temperature !== undefined) {
      throw new UnsupportedParameterError({
        client: this.constructor.name,
        parameter: "temperature",
        message:
          "Gemini models do not support setting temperature; the API deprecated " +
          "sampling parameters starting with the 3.6 generation.",
      });
    }

    if (
      config.prompt_caching !== undefined &&
      config.prompt_caching !== PromptCaching.ENABLE
    ) {
      throw new UnsupportedParameterError({
        client: this.constructor.name,
        parameter: "prompt_caching",
        message: "prompt_caching must be ENABLE for Gemini.",
      });
    }

    // the history travels in every request, so nothing needs to be stored server-side
    const geminiConfig: InteractionRequest = {
      model: this._model,
      stream: true,
      store: false,
    };
    const generationConfig: Interactions.GenerationConfig = {};

    if (config.max_tokens !== undefined) {
      generationConfig.max_output_tokens = config.max_tokens;
    }

    if (config.fast_mode) {
      geminiConfig.service_tier = "priority";
    }

    // A TTS model takes the speech settings and nothing else: a system instruction, a
    // thinking config, or a tool declaration each comes back as a 400 (verified live
    // 2026-08-20, again through the Interactions API 2026-09-16), so the rest of the
    // universal config never reaches the request.
    if (this._model.toLowerCase().includes("tts")) {
      const ttsConfig = config.tts_config ?? [{ voice: "Kore" }];
      if (![1, 2].includes(ttsConfig.length)) {
        throw new Error("tts_config must contain 1 or 2 entries.");
      }

      geminiConfig.response_format = { type: "audio" };
      generationConfig.speech_config =
        ttsConfig.length === 1
          ? [{ voice: ttsConfig[0].voice }]
          : ttsConfig.map((speakerConfig) => {
              if (!speakerConfig.speaker) {
                throw new Error(
                  "speaker is required when tts_config has 2 entries.",
                );
              }
              return {
                speaker: speakerConfig.speaker,
                voice: speakerConfig.voice,
              };
            });
      geminiConfig.generation_config = generationConfig;
      return geminiConfig;
    }

    if (config.system_prompt !== undefined) {
      geminiConfig.system_instruction = config.system_prompt;
    }

    const thinkingLevel = this._convertThinkingLevel(config.thinking_level);
    if (thinkingLevel !== undefined) {
      generationConfig.thinking_level = thinkingLevel;
    }

    if (config.thinking_summary !== undefined) {
      generationConfig.thinking_summaries = config.thinking_summary
        ? "auto"
        : "none";
    }

    if (config.tools !== undefined) {
      geminiConfig.tools = config.tools.map((tool) => ({
        type: "function",
        ...tool,
      }));
      if (config.tool_choice !== undefined) {
        generationConfig.tool_choice = this._convertToolChoice(
          config.tool_choice,
        );
      }
    }

    if (config.image_config !== undefined) {
      // an image entry alone suppresses the text the model writes beside its images
      geminiConfig.response_format = [
        { type: "text" },
        { type: "image", ...config.image_config },
      ];
    }

    if (Object.keys(generationConfig).length > 0) {
      geminiConfig.generation_config = generationConfig;
    }

    return geminiConfig;
  }

  /**
   * Transform universal message format to Interactions API input steps.
   */
  async transformUniMessageToModelInput(
    messages: UniMessage[],
    signal?: AbortSignal,
  ): Promise<Interactions.Step[]> {
    const steps: Interactions.Step[] = [];
    // A function_result must name its function (HTTP 400 without it), but a universal
    // tool_result carries only the call id, so remember each call's name.
    const callNames = new Map<string, string>();
    for (const msg of messages) {
      const messageStart = steps.length;
      // consecutive text and media of a message share one user_input or model_output step
      let content: Interactions.Content[] | null = null;
      // consecutive thinking items share one thought step, which ends at the item carrying
      // the signature: a stream closes every thought step with its signature
      let thought: {
        type: "thought";
        summary: TextImageBlocks;
        signature?: string;
      } | null = null;

      for (const item of msg.content_items) {
        if (
          item.type === "thinking.done" ||
          item.type === "inline_thinking.done"
        ) {
          content = null;
          const signature = item.fidelity?.signature;
          const summary: TextImageBlocks = [];
          if (item.type === "inline_thinking.done") {
            summary.push({
              type: "image",
              data: item.data.toString("base64"),
              mime_type: item.mime_type,
            });
          } else if (item.thinking) {
            summary.push({ type: "text", text: item.thinking });
          }
          if (summary.length === 0 && !signature) {
            continue;
          }

          if (thought === null) {
            thought = { type: "thought", summary: [] };
            steps.push(thought);
          }
          thought.summary.push(...summary);
          if (signature) {
            thought.signature = signature;
            thought = null;
          }
          continue;
        }

        thought = null;
        if ("fidelity" in item && item.fidelity?.signature) {
          // Histories recorded through generateContent carry the signature on the text,
          // image or call it came with and hold no thinking item; the Interactions API takes
          // it back as a thought step in front of that item (verified live 2026-09-16).
          steps.push({ type: "thought", signature: item.fidelity.signature });
          content = null;
          // A thought summary such a history holds is unsigned, and a turn opening with an unsigned
          // thought is rejected ("Request contains an invalid argument") while the same signature
          // on two thoughts is accepted (verified live 2026-09-17), so the opening thought takes it too.
          const first = steps[messageStart];
          if (first.type === "thought" && !first.signature) {
            first.signature = item.fidelity.signature;
          }
        }

        if (
          item.type === "text.done" ||
          item.type === "image_url.done" ||
          item.type === "inline_data.done"
        ) {
          let block: Interactions.Content;
          if (item.type === "text.done") {
            // an empty text block is rejected: "Missing text in content of type text"
            if (!item.text) {
              continue;
            }
            block = { type: "text", text: item.text };
          } else {
            const { data, mimeType } =
              item.type === "image_url.done"
                ? await this._getImageBytesAndMimeType(item.image_url, signal)
                : { data: item.data, mimeType: item.mime_type };
            // the block type follows the MIME type: image/jpeg is an image, application/pdf a document
            const kind = mimeType.split("/")[0];
            block = {
              type: ["image", "audio", "video"].includes(kind)
                ? kind
                : "document",
              data: data.toString("base64"),
              mime_type: mimeType,
            } as Interactions.Content;
          }

          if (content === null) {
            content = [];
            steps.push({
              type: msg.role === "user" ? "user_input" : "model_output",
              content,
            } as Interactions.Step);
          }
          content.push(block);
        } else if (item.type === "tool_call.done") {
          content = null;
          callNames.set(item.tool_call_id, item.name);
          // Histories from before ids were stored carry the name as the tool_call_id; replay
          // those without an id, because parallel calls sharing one id are rejected with a
          // 400 (verified live 2026-09-16).
          steps.push({
            type: "function_call",
            ...(item.tool_call_id !== item.name
              ? { id: item.tool_call_id }
              : {}),
            name: item.name,
            arguments: item.arguments,
          } as Interactions.FunctionCallStep);
        } else if (item.type === "tool_result.done") {
          content = null;
          if (!item.tool_call_id) {
            throw new Error("tool_call_id is required for tool result.");
          }

          let result: Interactions.FunctionResultStep["result"] = item.text;
          if (item.images) {
            // an empty text block is rejected, while a result of images alone is accepted
            const resultContent: TextImageBlocks = item.text
              ? [{ type: "text", text: item.text }]
              : [];
            for (const imageUrl of item.images) {
              const imageData = await this._getImageBytesAndMimeType(
                imageUrl,
                signal,
              );
              resultContent.push({
                type: "image",
                data: imageData.data.toString("base64"),
                mime_type: imageData.mimeType,
              });
            }
            result = resultContent;
          }

          const functionName =
            callNames.get(item.tool_call_id) ?? item.tool_call_id;
          steps.push({
            type: "function_result",
            ...(item.tool_call_id !== functionName
              ? { call_id: item.tool_call_id }
              : {}),
            name: functionName,
            result,
          } as Interactions.FunctionResultStep);
        } else {
          throw new Error(`Unknown item: ${JSON.stringify(item)}`);
        }
      }

      // An image model sometimes streams its text before its first thought step, but the API
      // takes a turn holding a thought back only when the turn opens with one: "Model turns with
      // images must start with a thought block" (verified live 2026-09-16). A turn another
      // provider produced holds no signed thought at all, which the API rejects once the turn
      // continues with its tool results (verified live 2026-09-16). Both open with the
      // placeholder signature Google documents for thoughts it did not produce.
      const turn = steps.slice(messageStart);
      if (
        (turn.some((step) => step.type === "thought") &&
          turn[0].type !== "thought") ||
        (turn.some(
          (step) =>
            step.type === "model_output" || step.type === "function_call",
        ) &&
          !turn.some((step) => step.type === "thought" && step.signature))
      ) {
        steps.splice(messageStart, 0, {
          type: "thought",
          signature: "skip_thought_signature_validator",
        });
      }
    }

    return steps;
  }

  /**
   * Transform one Interactions API stream event into client parts, keyed by step index.
   */
  transformModelOutputToClientParts(
    modelOutput: Interactions.InteractionSSEEvent,
  ): ClientPart[] {
    if (modelOutput.event_type === "step.start") {
      const step = modelOutput.step;
      if (step.type === "function_call") {
        // the start names the call; its arguments stream as deltas behind an empty object
        const startArguments =
          Object.keys(step.arguments ?? {}).length > 0
            ? JSON.stringify(step.arguments)
            : "";
        return [
          {
            type: "delta",
            key: String(modelOutput.index),
            item: {
              type: "tool_call.delta",
              name: step.name,
              arguments: startArguments,
              tool_call_id: step.id,
            },
          },
        ];
      } else if (step.type === "thought" || step.type === "model_output") {
        return [];
      }
    } else if (modelOutput.event_type === "step.delta") {
      const key = String(modelOutput.index);
      const delta = modelOutput.delta;
      if (delta.type === "thought_summary") {
        if (delta.content?.type === "text") {
          return [
            {
              type: "delta",
              key,
              item: { type: "thinking.delta", thinking: delta.content.text },
            },
          ];
        } else if (delta.content?.type === "image") {
          // image models summarize their thinking with interim images too
          return [
            {
              type: "delta",
              key,
              item: {
                type: "inline_thinking.delta",
                data: Buffer.from(delta.content.data || "", "base64"),
                mime_type: delta.content.mime_type || "image/jpeg",
              },
            },
          ];
        }
      } else if (delta.type === "thought_signature") {
        // the signature is the last delta of its thought step
        return [
          {
            type: "delta",
            key,
            item: {
              type: "thinking.delta",
              thinking: "",
              fidelity: { signature: delta.signature },
            },
          },
        ];
      } else if (delta.type === "arguments_delta") {
        return [
          {
            type: "delta",
            key,
            item: {
              type: "tool_call.delta",
              name: "",
              arguments: delta.arguments || "",
              tool_call_id: "",
            },
          },
        ];
      } else if (delta.type === "text") {
        return [
          {
            type: "delta",
            key,
            item: { type: "text.delta", text: delta.text },
          },
        ];
      } else if (delta.type === "image") {
        return [
          {
            type: "delta",
            key,
            item: {
              type: "inline_data.delta",
              data: Buffer.from(delta.data || "", "base64"),
              mime_type: delta.mime_type || "image/jpeg",
            },
          },
        ];
      } else if (delta.type === "audio") {
        // TTS streams raw PCM in 40 ms chunks; the MIME type carries the format a player needs
        return [
          {
            type: "delta",
            key,
            item: {
              type: "inline_data.delta",
              data: Buffer.from(delta.data || "", "base64"),
              mime_type: `${delta.mime_type}; rate=${delta.sample_rate}; channels=${delta.channels}`,
            },
          },
        ];
      }
    } else if (modelOutput.event_type === "step.stop") {
      return [{ type: "done", key: String(modelOutput.index) }];
    } else if (modelOutput.event_type === "interaction.completed") {
      const statusMapping: { [key: string]: FinishReason } = {
        completed: "stop",
        requires_action: "tool_call",
        incomplete: "length",
      };
      const usage = modelOutput.interaction.usage;
      // total_input_tokens includes the cached tokens; total_output_tokens excludes the thoughts
      return [
        {
          type: "finish",
          finish_reason:
            statusMapping[modelOutput.interaction.status] || "unknown",
          usage_metadata: {
            cached_tokens: usage?.total_cached_tokens || null,
            prompt_tokens:
              (usage?.total_input_tokens || 0) -
              (usage?.total_cached_tokens || 0),
            thoughts_tokens: usage?.total_thought_tokens || null,
            response_tokens: usage?.total_output_tokens || null,
          },
        },
      ];
    } else if (modelOutput.event_type === "error" && modelOutput.error) {
      // Neither Interactions SDK raises on an error event inside an open stream, so the provider's
      // failure is raised here rather than lost; an error event without an error, which the Python
      // SDK makes of a gateway heartbeat, stays with the unknown-event guard.
      throw new Error(
        `Gemini stream error ${modelOutput.error.code}: ${modelOutput.error.message}`,
      );
    } else if (
      ["interaction.created", "interaction.status_update"].includes(
        modelOutput.event_type,
      )
    ) {
      return [];
    }

    if (isDebugEnabled()) {
      throw new Error(`Unknown output: ${JSON.stringify(modelOutput)}`);
    }
    // the API adds event, step and delta types over time, and killing a long generation
    // over one costs more than dropping it
    return [];
  }

  private async *_embedMessagesInternal(options: {
    messages: UniMessage[];
    config: UniConfig;
    signal?: AbortSignal;
  }): AsyncGenerator<ClientPart> {
    // the Interactions API does not serve embedding models (HTTP 404, verified live
    // 2026-09-16), so they stay on embedContent
    const contents: Content[] = [];
    for (const msg of options.messages) {
      const parts: Part[] = [];
      for (const item of msg.content_items) {
        if (item.type === "text.done") {
          parts.push({ text: item.text });
        } else if (item.type === "image_url.done") {
          const imageData = await this._getImageBytesAndMimeType(
            item.image_url,
            options.signal,
          );
          parts.push({
            inlineData: {
              mimeType: imageData.mimeType,
              data: imageData.data.toString("base64"),
            },
          });
        } else if (item.type === "inline_data.done") {
          parts.push({
            inlineData: {
              mimeType: item.mime_type,
              data: item.data.toString("base64"),
            },
          });
        } else {
          throw new Error(`Unknown item: ${JSON.stringify(item)}`);
        }
      }
      contents.push({
        role: msg.role === "user" ? "user" : "model",
        parts,
      });
    }

    const geminiConfig: EmbedContentConfig = { abortSignal: options.signal };
    if (options.config.embedding_config?.dimensions != null) {
      geminiConfig.outputDimensionality =
        options.config.embedding_config.dimensions;
    }

    const result = await this._client.models.embedContent({
      model: this._model,
      contents,
      config: geminiConfig,
    });

    for (const [i, embedding] of (result.embeddings ?? []).entries()) {
      const key = `embedding:${i}`;
      yield {
        type: "delta",
        key,
        item: { type: "embedding.delta", embedding: embedding.values ?? [] },
      };
      yield { type: "done", key };
    }
    yield {
      type: "finish",
      usage_metadata: {
        cached_tokens: null,
        prompt_tokens: result.metadata?.billableCharacterCount ?? null,
        thoughts_tokens: null,
        response_tokens: null,
      },
      finish_reason: "stop",
    };
  }

  /**
   * Stream generate through the Interactions API with unified conversion methods.
   */
  async *_streamingResponseInternal(options: {
    messages: UniMessage[];
    config: UniConfig;
    signal?: AbortSignal;
  }): AsyncGenerator<ClientPart> {
    if (this._model.toLowerCase().includes("embedding")) {
      yield* this._embedMessagesInternal(options);
      return;
    }

    // A TTS model synthesizes a single text turn: a conversation comes back as "Multiturn chat
    // is not enabled for this model" and an audio part as "Audio input modality is not enabled
    // for this model" (verified live 2026-08-20), so only the newest message is sent and the
    // audio a stateful session records stays out of the request.
    let messages = options.messages;
    if (this._model.toLowerCase().includes("tts")) {
      messages = messages.slice(-1);
      const invalidItem = messages
        .flatMap((message) => message.content_items)
        .find((item) => item.type !== "text.done");
      if (invalidItem) {
        throw new Error(
          `Gemini TTS only supports text input, got content item type=${JSON.stringify(invalidItem.type)}.`,
        );
      }
    }

    const geminiConfig = this.transformUniConfigToModelConfig(options.config);
    const input = await this.transformUniMessageToModelInput(
      messages,
      options.signal,
    );

    const stream = await this._client.interactions.create(
      { ...geminiConfig, input, stream: true },
      { signal: options.signal },
    );

    // A step streams one item per run of a content kind: an image model's thought summary can
    // go text, image, text, which is three items, so an item's key is its step index and the
    // number of the run within the step. Every image delta is a whole image and a run of its
    // own, while audio streams in chunks of one run.
    let stepKey = "";
    let run = 0;
    let runItem: DeltaContentItem | null = null;
    for await (const event of stream) {
      for (const part of this.transformModelOutputToClientParts(event)) {
        if (part.type === "finish") {
          yield part;
          continue;
        }

        if (part.key !== stepKey) {
          stepKey = part.key;
          run = 0;
          runItem = null;
        }
        if (part.type === "done") {
          yield { type: "done", key: `${stepKey}.${run}` };
          continue;
        }

        let item = part.item;
        if (
          item.type === "thinking.delta" &&
          item.fidelity &&
          runItem?.type === "inline_thinking.delta"
        ) {
          // the signature closes the run its thought step ends with, an image one included
          item = {
            type: "inline_thinking.delta",
            data: Buffer.alloc(0),
            mime_type: runItem.mime_type,
            fidelity: item.fidelity,
          };
        } else if (
          runItem !== null &&
          (runItem.type !== item.type ||
            item.type === "inline_thinking.delta" ||
            (item.type === "inline_data.delta" &&
              item.mime_type.startsWith("image/")))
        ) {
          yield { type: "done", key: `${stepKey}.${run}` };
          run += 1;
        }
        runItem = item;
        yield { type: "delta", key: `${stepKey}.${run}`, item };
      }
    }
  }

  /**
   * List the model ids the configured endpoint serves.
   *
   * @returns The model ids, in the order the endpoint returned them.
   */
  async listModels(): Promise<string[]> {
    const models: string[] = [];
    for await (const model of await this._client.models.list()) {
      // the API returns path-qualified names: models/gemini-3.7-flash,
      // publishers/google/models/gemini-3.7-flash
      const id = model.name?.split("/").pop();
      if (id) {
        models.push(id);
      }
    }

    return models;
  }
}
