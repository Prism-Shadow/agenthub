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
import { LLMClient } from "../baseClient";
import { parseToolCallArguments, UnsupportedParameterError } from "../errors";
import {
  EventType,
  FinishReason,
  PartialContentItem,
  PromptCaching,
  ThinkingLevel,
  ToolChoice,
  UniConfig,
  UniEvent,
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
 * A `reasoning` input item carrying `text`. The item must carry SOME text: the Responses API
 * refuses an empty `reasoning_text` exactly as it refuses a tool-calling turn with no reasoning
 * item at all (verified live 2026-09-11), so a turn with nothing to replay gets the least this
 * layer can invent.
 */
function reasoningItem(text: string): Record<string, unknown> {
  return {
    type: "reasoning",
    summary: [],
    content: [{ type: "reasoning_text", text: text || " " }],
  };
}

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
      // Whether this turn has already put its chain of thought on the wire (see the
      // placeholder pushed with the first function call below).
      let carriedReasoning = false;

      for (const item of msg.content_items) {
        // anything that is not message content becomes an input item of its own, so the
        // text collected so far is flushed first to keep the original order: DeepSeek
        // merges a function call into the adjacent assistant message and answers a call
        // whose output does not follow it with "No tool output found for tool call"
        // (verified live 2026-08-21)
        if (
          item.type !== "text" &&
          item.type !== "image_url" &&
          contentItems.length > 0
        ) {
          inputList.push({ role: msg.role, content: [...contentItems] });
          contentItems.length = 0;
        }

        if (item.type === "text") {
          if (msg.role === "user") {
            contentItems.push({ type: "input_text", text: item.text });
          } else {
            contentItems.push({ type: "output_text", text: item.text });
          }
        } else if (item.type === "image_url") {
          if (!supportsImage) {
            throw new Error(
              `DeepSeek ${this._model} does not support image inputs.`,
            );
          }

          contentItems.push({ type: "input_image", image_url: item.image_url });
        } else if (item.type === "thinking") {
          // DeepSeek carries the chain of thought as plain reasoning_text and ignores the
          // summary and encrypted_content channels, so the item is rebuilt from the text
          inputList.push(reasoningItem(item.thinking));
          carriedReasoning = true;
        } else if (item.type === "tool_call") {
          if (!carriedReasoning) {
            // A tool-calling turn the model thought nothing on — DeepSeek stops thinking
            // part-way through a long tool chain. Replaying that turn without its chain of
            // thought is rejected with "the reasoning_text in the thinking mode must be passed
            // back to the API"; DeepSeek waives that only for call_ids it recognises as its
            // own, which it cannot once a relay has reissued them.
            inputList.push(reasoningItem(""));
            carriedReasoning = true;
          }

          inputList.push({
            type: "function_call",
            call_id: item.tool_call_id,
            name: item.name,
            arguments: JSON.stringify(item.arguments),
          });
        } else if (item.type === "tool_result") {
          if (!item.tool_call_id) {
            throw new Error("tool_call_id is required for tool result.");
          }

          // NOTE: tool results are input items
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const toolResult: any[] = [{ type: "input_text", text: item.text }];

          if (item.images) {
            if (!supportsImage) {
              throw new Error(
                `DeepSeek ${this._model} does not support images in tool results.`,
              );
            }

            for (const imageUrl of item.images) {
              toolResult.push({ type: "input_image", image_url: imageUrl });
            }
          }

          inputList.push({
            type: "function_call_output",
            call_id: item.tool_call_id,
            output: toolResult,
          });
        } else {
          throw new Error(`Unknown item: ${JSON.stringify(item)}`);
        }
      }

      if (contentItems.length > 0) {
        inputList.push({ role: msg.role, content: contentItems });
      }
    }

    return inputList;
  }

  /**
   * Transform DeepSeek streaming event to universal event format.
   */
  transformModelOutputToUniEvent(modelOutput: ResponseStreamEvent): UniEvent {
    let eventType: EventType | null = null;
    const contentItems: PartialContentItem[] = [];
    let usageMetadata: UsageMetadata | null = null;
    let finishReason: FinishReason | null = null;

    const deepseekEventType = modelOutput.type;
    if (deepseekEventType === "response.output_text.delta") {
      eventType = "delta";
      contentItems.push({ type: "text", text: modelOutput.delta });
    } else if (deepseekEventType === "response.reasoning_text.delta") {
      eventType = "delta";
      contentItems.push({ type: "thinking", thinking: modelOutput.delta });
    } else if (deepseekEventType === "response.output_item.added") {
      const item = modelOutput.item;
      if (item.type === "function_call") {
        eventType = "start";
        contentItems.push({
          type: "partial_tool_call",
          name: item.name,
          arguments: "",
          tool_call_id: item.call_id,
        });
      } else {
        eventType = "unused";
      }
    } else if (deepseekEventType === "response.function_call_arguments.delta") {
      eventType = "delta";
      contentItems.push({
        type: "partial_tool_call",
        name: "",
        arguments: modelOutput.delta,
        tool_call_id: "",
      });
    } else if (deepseekEventType === "response.function_call_arguments.done") {
      eventType = "stop";
    } else if (
      deepseekEventType === "response.completed" ||
      deepseekEventType === "response.incomplete"
    ) {
      eventType = "stop";
      const response = modelOutput.response;
      const finishReasonMapping: { [key: string]: FinishReason } = {
        completed: "stop",
        incomplete: "length",
      };
      if (response.status) {
        finishReason = finishReasonMapping[response.status] || "unknown";
      }
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
    } else if (
      [
        "response.created",
        "response.in_progress",
        "response.output_item.done",
        "response.output_text.done",
        "response.reasoning_text.done",
        "response.content_part.added",
        "response.content_part.done",
        // gateway heartbeat on long generations; carries no content
        "keepalive",
      ].includes(deepseekEventType)
    ) {
      eventType = "unused";
    } else if (isDebugEnabled()) {
      throw new Error(`Unknown output: ${JSON.stringify(modelOutput)}`);
    } else {
      // a gateway injects its own events (heartbeats, cost tickers) into the stream, and
      // killing a long generation over one costs more than dropping it
      eventType = "unused";
    }

    return {
      role: "assistant",
      event_type: eventType,
      content_items: contentItems,
      usage_metadata: usageMetadata,
      finish_reason: finishReason,
    };
  }

  /**
   * Stream generate using DeepSeek's OpenAI-compatible Responses API.
   */
  async *_streamingResponseInternal(options: {
    messages: UniMessage[];
    config: UniConfig;
    signal?: AbortSignal;
  }): AsyncGenerator<UniEvent> {
    const deepseekConfig = this.transformUniConfigToModelConfig(options.config);
    const inputList = this.transformUniMessageToModelInput(
      options.messages,
      options.signal,
    );

    const partialToolCall: {
      name?: string;
      arguments?: string;
      tool_call_id?: string;
    } = {};

    const params: ResponseCreateParamsStreaming = {
      ...deepseekConfig,
      input: inputList,
      stream: true,
    };

    const stream = await this._client.responses.create(params, {
      signal: options.signal,
    });
    for await (const event of stream) {
      const uniEvent = this.transformModelOutputToUniEvent(event);

      if (uniEvent.event_type === "start") {
        for (const item of uniEvent.content_items) {
          if (item.type === "partial_tool_call") {
            partialToolCall.name = item.name;
            partialToolCall.arguments = "";
            partialToolCall.tool_call_id = item.tool_call_id;
            yield uniEvent;
          }
        }
      } else if (uniEvent.event_type === "delta") {
        for (const item of uniEvent.content_items) {
          if (item.type === "partial_tool_call") {
            partialToolCall.arguments =
              (partialToolCall.arguments || "") + item.arguments;
          }
        }

        yield uniEvent;
      } else if (uniEvent.event_type === "stop") {
        if (partialToolCall.name && partialToolCall.arguments !== undefined) {
          yield {
            role: "assistant",
            event_type: "delta",
            content_items: [
              {
                type: "tool_call",
                name: partialToolCall.name,
                arguments: parseToolCallArguments(
                  partialToolCall.arguments,
                  this.constructor.name,
                  partialToolCall.name || "",
                  partialToolCall.tool_call_id || "",
                ),
                tool_call_id: partialToolCall.tool_call_id || "",
              },
            ],
            usage_metadata: null,
            finish_reason: null,
          };
          partialToolCall.name = undefined;
          partialToolCall.arguments = undefined;
          partialToolCall.tool_call_id = undefined;
        }

        if (uniEvent.finish_reason || uniEvent.usage_metadata) {
          yield uniEvent;
        }
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
