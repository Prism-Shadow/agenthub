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

import OpenAI from "openai";
import type {
  ResponseInputItem,
  ResponseStreamEvent,
  ResponseCreateParamsStreaming,
} from "openai/resources/responses/responses";
import { ClientPart, LLMClient } from "../baseClient";
import { UnsupportedParameterError } from "../errors";
import {
  FinishReason,
  PromptCaching,
  ThinkingLevel,
  ToolChoice,
  UniConfig,
  UniMessage,
  UsageMetadata,
} from "../types";
import { isDebugEnabled } from "../utils";

/**
 * The DeepSeek ids that read no image: the current V4 Flash and V4 Pro, bare or with a
 * dated snapshot suffix (`deepseek-v4-flash-0731`). Every other id forwards its images.
 * Matched against the bare id — the part after the last `/`, lowercased — so a gateway
 * prefix (`deepseek/`, `deepseek-ai/`) and the spelling a platform uses do not change the
 * verdict.
 */
const TEXT_ONLY_MODELS = /^deepseek-v4-(flash|pro)(-\d{4})?$/;

/**
 * DeepSeek V4-specific LLM client implementation using the OpenAI-compatible Responses API.
 */
export class DeepSeekV4Client extends LLMClient {
  protected _model: string;
  private _client: OpenAI;

  /**
   * Initialize DeepSeek client with model, API key, and base URL.
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
    const key = options.apiKey || process.env.DEEPSEEK_API_KEY || undefined;
    const url =
      options.baseUrl ||
      process.env.DEEPSEEK_BASE_URL ||
      "https://api.deepseek.com";
    this._client = new OpenAI({
      apiKey: key,
      baseURL: url,
      defaultHeaders: options.defaultHeaders,
    });
  }

  /**
   * Convert ThinkingLevel enum to DeepSeek's reasoning effort.
   *
   * DeepSeek accepts low/high/max and maps medium and xhigh onto high server-side
   * (llmsdk_docs/deepseek_v4/docs/thinking-mode.md), so this sends the value the server
   * would settle on anyway. Effort "none" is what turns thinking off on this endpoint:
   * the Chat Completions `thinking` toggle is ignored here (verified live 2026-08-21).
   */
  private _convertThinkingLevelToEffort(thinkingLevel: ThinkingLevel): string {
    const mapping: { [key: string]: string } = {
      [ThinkingLevel.NONE]: "none",
      [ThinkingLevel.LOW]: "low",
      [ThinkingLevel.MEDIUM]: "high",
      [ThinkingLevel.HIGH]: "high",
      [ThinkingLevel.XHIGH]: "high",
      [ThinkingLevel.MAX]: "max",
    };
    return mapping[thinkingLevel];
  }

  /**
   * Convert ToolChoice to DeepSeek's Responses-compatible tool_choice format.
   */
  private _convertToolChoice(toolChoice: ToolChoice): string {
    if (toolChoice === "auto" || toolChoice === "none") {
      return toolChoice;
    }

    throw new UnsupportedParameterError({
      client: this.constructor.name,
      parameter: "tool_choice",
      message: "DeepSeek V4 only supports 'auto' and 'none' for tool_choice.",
    });
  }

  /**
   * Transform universal configuration to DeepSeek-specific configuration.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transformUniConfigToModelConfig(config: UniConfig): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deepseekConfig: any = {
      model: this._model,
      store: false,
    };

    if (config.system_prompt !== undefined) {
      deepseekConfig.instructions = config.system_prompt;
    }

    if (config.max_tokens !== undefined) {
      deepseekConfig.max_output_tokens = config.max_tokens;
    }

    if (config.temperature !== undefined && config.temperature !== 1.0) {
      throw new UnsupportedParameterError({
        client: this.constructor.name,
        parameter: "temperature",
        message: "DeepSeek V4 does not support setting temperature.",
      });
    }

    if (config.thinking_level !== undefined) {
      deepseekConfig.reasoning = {
        effort: this._convertThinkingLevelToEffort(config.thinking_level),
      };
    }

    if (config.thinking_summary) {
      // DeepSeek takes reasoning.summary with or without an effort and returns an empty
      // summary list for now (verified live 2026-09-03 on api.deepseek.com and
      // OpenRouter), so the request carries the preference instead of dropping it and
      // picks up summaries as soon as the vendor generates them. False needs no key:
      // the Responses API returns no summary unless one is asked for.
      deepseekConfig.reasoning = deepseekConfig.reasoning ?? {};
      deepseekConfig.reasoning.summary = "concise";
    }

    if (config.tools !== undefined) {
      deepseekConfig.tools = config.tools.map((tool) => ({
        type: "function",
        ...tool,
      }));
    }

    if (config.tool_choice !== undefined) {
      deepseekConfig.tool_choice = this._convertToolChoice(config.tool_choice);
    }

    if (config.fast_mode) {
      throw new UnsupportedParameterError({
        client: this.constructor.name,
        parameter: "fast_mode",
        message: "DeepSeek V4 does not support fast mode.",
      });
    }

    if (
      config.prompt_caching !== undefined &&
      config.prompt_caching !== PromptCaching.ENABLE
    ) {
      throw new UnsupportedParameterError({
        client: this.constructor.name,
        parameter: "prompt_caching",
        message: "prompt_caching must be ENABLE for DeepSeek.",
      });
    }

    return deepseekConfig;
  }

  /**
   * Transform universal message format to DeepSeek's Responses-compatible input format.
   */
  transformUniMessageToModelInput(
    messages: UniMessage[],
    _signal?: AbortSignal,
  ): ResponseInputItem[] {
    // a text-only model answers from a placeholder instead of failing
    // (llmsdk_docs/deepseek_v4/docs/responses-api.md), so an image is refused here rather
    // than silently dropped
    const supportsImage = !TEXT_ONLY_MODELS.test(
      this._model.toLowerCase().replace(/^.*\//, ""),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputList: any[] = [];

    for (const msg of messages) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contentItems: any[] = [];

      for (const item of msg.content_items) {
        // anything that is not message content becomes an input item of its own, so the
        // text collected so far is flushed first to keep the original order: DeepSeek
        // merges a function call into the adjacent assistant message and answers a call
        // whose output does not follow it with "No tool output found for tool call"
        // (verified live 2026-08-21)
        if (
          item.type !== "text.done" &&
          item.type !== "image_url.done" &&
          contentItems.length > 0
        ) {
          // Every turn goes back as a typed message item — the Responses API's EasyInputMessage
          // shape, where type "message" is valid for any role. A vLLM-style Responses server
          // answers a bare { role: "assistant", content: [...] } item with a 400 on the turn that
          // replays it and takes the typed form for every role; OpenAI, DeepSeek and MiniMax accept
          // either shape. Nothing beyond that minimal shape goes out: an id or a status the server
          // never sent would be an invention.
          inputList.push({
            type: "message",
            role: msg.role,
            content: [...contentItems],
          });
          contentItems.length = 0;
        }

        if (item.type === "text.done") {
          if (msg.role === "user") {
            contentItems.push({ type: "input_text", text: item.text });
          } else {
            contentItems.push({ type: "output_text", text: item.text });
          }
        } else if (item.type === "image_url.done") {
          if (!supportsImage) {
            throw new Error(
              `DeepSeek ${this._model} does not support image inputs.`,
            );
          }

          contentItems.push({ type: "input_image", image_url: item.image_url });
        } else if (item.type === "thinking.done") {
          // DeepSeek carries the chain of thought as plain reasoning_text and ignores the
          // summary and encrypted_content channels, so the item is rebuilt from the text
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const reasoning: any = { type: "reasoning", summary: [] };
          if (item.thinking) {
            reasoning.content = [
              { type: "reasoning_text", text: item.thinking },
            ];
          }

          inputList.push(reasoning);
        } else if (item.type === "tool_call.done") {
          inputList.push({
            type: "function_call",
            call_id: item.tool_call_id,
            name: item.name,
            arguments: JSON.stringify(item.arguments),
          });
        } else if (item.type === "tool_result.done") {
          if (!item.tool_call_id) {
            throw new Error("tool_call_id is required for tool result.");
          }

          // NOTE: tool results are input items
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const imageParts: any[] = [];

          if (item.images) {
            if (!supportsImage) {
              throw new Error(
                `DeepSeek ${this._model} does not support images in tool results.`,
              );
            }

            for (const imageUrl of item.images) {
              imageParts.push({ type: "input_image", image_url: imageUrl });
            }
          }

          // a plain string is the form the Responses API documents for a text
          // result and the one every endpoint fronting this model accepts; the
          // content-part list is reserved for results carrying images
          const output =
            imageParts.length > 0
              ? [{ type: "input_text", text: item.text }, ...imageParts]
              : item.text;

          inputList.push({
            type: "function_call_output",
            call_id: item.tool_call_id,
            output,
          });
        } else {
          throw new Error(`Unknown item: ${JSON.stringify(item)}`);
        }
      }

      if (contentItems.length > 0) {
        inputList.push({
          type: "message",
          role: msg.role,
          content: contentItems,
        });
      }
    }

    return inputList;
  }

  /**
   * Transform one DeepSeek stream event into client parts, keyed by output item id.
   */
  transformModelOutputToClientParts(
    modelOutput: ResponseStreamEvent,
  ): ClientPart[] {
    const deepseekEventType = modelOutput.type;
    if (deepseekEventType === "response.output_text.delta") {
      return [
        {
          type: "delta",
          key: modelOutput.item_id,
          item: { type: "text.delta", text: modelOutput.delta },
        },
      ];
    } else if (deepseekEventType === "response.reasoning_text.delta") {
      return [
        {
          type: "delta",
          key: modelOutput.item_id,
          item: { type: "thinking.delta", thinking: modelOutput.delta },
        },
      ];
    } else if (deepseekEventType === "response.output_item.added") {
      // every item is announced with a delta, empty unless it carries the call, so a fragment
      // a server sends without its item id belongs to the item announced last
      const item = modelOutput.item;
      if (item.type === "function_call") {
        return [
          {
            type: "delta",
            // a server that sends no item id still sends the call id
            key: item.id || item.call_id,
            item: {
              type: "tool_call.delta",
              name: item.name,
              arguments: "",
              tool_call_id: item.call_id,
            },
          },
        ];
      } else if (item.type === "message") {
        return [
          {
            type: "delta",
            key: item.id,
            item: { type: "text.delta", text: "" },
          },
        ];
      } else if (item.type === "reasoning") {
        return [
          {
            type: "delta",
            key: item.id,
            item: { type: "thinking.delta", thinking: "" },
          },
        ];
      }
      return [];
    } else if (deepseekEventType === "response.output_item.done") {
      const item = modelOutput.item;
      if (item.type === "function_call") {
        return [{ type: "done", key: item.id || item.call_id }];
      } else if (item.type === "message" || item.type === "reasoning") {
        return [{ type: "done", key: item.id }];
      }
      return [];
    } else if (deepseekEventType === "response.function_call_arguments.delta") {
      return [
        {
          type: "delta",
          key: modelOutput.item_id,
          item: {
            type: "tool_call.delta",
            name: "",
            arguments: modelOutput.delta,
            tool_call_id: "",
          },
        },
      ];
    } else if (deepseekEventType === "response.function_call_arguments.done") {
      // the call's output_item.done completes it instead: its item still names the call where
      // a server leaves the item id off this event, and a call whose output_item.done never
      // arrives is completed when the stream ends
      return [];
    } else if (
      deepseekEventType === "response.completed" ||
      deepseekEventType === "response.incomplete"
    ) {
      const response = modelOutput.response;
      const finishReasonMapping: { [key: string]: FinishReason } = {
        completed: "stop",
        incomplete: "length",
      };
      let usageMetadata: UsageMetadata | null = null;
      if (response.usage) {
        const cachedTokens =
          response.usage.input_tokens_details?.cached_tokens || 0;
        const reasoningTokens =
          response.usage.output_tokens_details?.reasoning_tokens || 0;

        usageMetadata = {
          cached_tokens: cachedTokens,
          prompt_tokens: response.usage.input_tokens - cachedTokens,
          thoughts_tokens: reasoningTokens,
          response_tokens: response.usage.output_tokens - reasoningTokens,
        };
      }
      return [
        {
          type: "finish",
          usage_metadata: usageMetadata,
          finish_reason: response.status
            ? finishReasonMapping[response.status] || "unknown"
            : null,
        },
      ];
    } else if (
      [
        "response.created",
        "response.in_progress",
        "response.output_text.done",
        "response.reasoning_text.done",
        "response.content_part.added",
        "response.content_part.done",
        // gateway heartbeat on long generations; carries no content
        "keepalive",
      ].includes(deepseekEventType)
    ) {
      return [];
    } else if (isDebugEnabled()) {
      throw new Error(`Unknown output: ${JSON.stringify(modelOutput)}`);
    } else {
      // a gateway injects its own events (heartbeats, cost tickers) into the stream, and
      // killing a long generation over one costs more than dropping it
      return [];
    }
  }

  /**
   * Stream generate using DeepSeek's OpenAI-compatible Responses API.
   */
  async *_streamingResponseInternal(options: {
    messages: UniMessage[];
    config: UniConfig;
    signal?: AbortSignal;
  }): AsyncGenerator<ClientPart> {
    const deepseekConfig = this.transformUniConfigToModelConfig(options.config);
    const inputList = this.transformUniMessageToModelInput(
      options.messages,
      options.signal,
    );

    // A server may leave the item ids out. A part without one belongs to the item announced or
    // streamed last while that item is open and of the same kind, and starts an item of its own
    // otherwise; an argument fragment whose id names no announced call counts as one without.
    const announcedCalls = new Set<string>();
    let lastKey = "";
    let lastType = "";
    let unkeyedItems = 0;

    const params: ResponseCreateParamsStreaming = {
      ...deepseekConfig,
      input: inputList,
      stream: true,
    };

    const stream = await this._client.responses.create(params, {
      signal: options.signal,
    });
    for await (const event of stream) {
      for (const part of this.transformModelOutputToClientParts(event)) {
        if (part.type === "delta") {
          const item = part.item;
          if (item.type === "tool_call.delta" && item.tool_call_id) {
            announcedCalls.add(part.key);
          } else if (
            !part.key ||
            (item.type === "tool_call.delta" && !announcedCalls.has(part.key))
          ) {
            part.key =
              lastType === item.type ? lastKey : `unkeyed-${unkeyedItems++}`;
          }
          lastKey = part.key;
          lastType = item.type;
        } else if (part.type === "done") {
          if (!part.key && !lastKey) {
            continue;
          }
          part.key = part.key || lastKey;
          if (part.key === lastKey) {
            lastKey = "";
            lastType = "";
          }
        }
        yield part;
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
    for await (const model of this._client.models.list()) {
      models.push(model.id);
    }

    return models;
  }
}
