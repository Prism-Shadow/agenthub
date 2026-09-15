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
  ResponseCreateParamsStreaming,
  ResponseStreamEvent,
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

const DEFAULT_BASE_URL = "https://api.minimax.io/v1";

type MiniMaxReasoningEffort = "none" | "low" | "medium" | "high";

/** MiniMax M3 client using MiniMax's Responses API. */
export class MiniMaxM3Client extends LLMClient {
  protected _model: string;
  private _client: OpenAI;

  constructor(options: {
    model: string;
    apiKey?: string;
    baseUrl?: string | null;
    clientType?: string | null;
    defaultHeaders?: Record<string, string>;
  }) {
    super();
    this._model = options.model;
    // The wrapped OpenAI SDK falls back to OPENAI_API_KEY when handed undefined, which would send
    // an OpenAI credential to the MiniMax host, so resolve the key here and fail loudly instead.
    const apiKey = options.apiKey || process.env.MINIMAX_API_KEY;
    if (!apiKey) {
      throw new Error("MINIMAX_API_KEY is required for MiniMaxM3Client.");
    }
    this._client = new OpenAI({
      apiKey,
      baseURL:
        options.baseUrl || process.env.MINIMAX_BASE_URL || DEFAULT_BASE_URL,
      defaultHeaders: options.defaultHeaders,
    });
  }

  private _convertThinkingLevelToEffort(
    thinkingLevel: ThinkingLevel,
  ): MiniMaxReasoningEffort {
    const mapping: Record<ThinkingLevel, MiniMaxReasoningEffort> = {
      [ThinkingLevel.NONE]: "none",
      [ThinkingLevel.LOW]: "low",
      [ThinkingLevel.MEDIUM]: "medium",
      [ThinkingLevel.HIGH]: "high",
      [ThinkingLevel.XHIGH]: "high",
      // MiniMax stops at "high"
      [ThinkingLevel.MAX]: "high",
    };
    return mapping[thinkingLevel];
  }

  private _convertToolChoice(toolChoice: ToolChoice): "auto" | "none" {
    if (toolChoice === "auto" || toolChoice === "none") {
      return toolChoice;
    }
    throw new UnsupportedParameterError({
      client: this.constructor.name,
      parameter: "tool_choice",
      message:
        "MiniMax Responses API does not support required or named tool selection.",
    });
  }

  /**
   * Transform universal configuration to MiniMax's Responses API payload.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transformUniConfigToModelConfig(config: UniConfig): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const minimaxConfig: any = { model: this._model, store: false };

    if (config.system_prompt !== undefined) {
      minimaxConfig.instructions = config.system_prompt;
    }
    if (config.max_tokens !== undefined) {
      minimaxConfig.max_output_tokens = config.max_tokens;
    }
    if (config.temperature !== undefined) {
      // Written as a positive range test so NaN is rejected too: every `<`/`>` comparison against
      // NaN is false, which would let it through to the provider as a null temperature.
      if (!(config.temperature >= 0 && config.temperature <= 1)) {
        throw new UnsupportedParameterError({
          client: this.constructor.name,
          parameter: "temperature",
          message:
            "MiniMax Responses API does not support temperatures outside the range 0 to 1.",
        });
      }
      minimaxConfig.temperature = config.temperature;
    }
    if (config.thinking_level !== undefined) {
      minimaxConfig.reasoning = {
        effort: this._convertThinkingLevelToEffort(config.thinking_level),
      };
    }
    if (config.tools !== undefined) {
      minimaxConfig.tools = config.tools.map((tool) => ({
        type: "function",
        ...tool,
      }));
    }
    if (config.tool_choice !== undefined) {
      minimaxConfig.tool_choice = this._convertToolChoice(config.tool_choice);
    }
    if (config.fast_mode) {
      minimaxConfig.service_tier = "priority";
    }

    if (config.prompt_caching === PromptCaching.DISABLE) {
      throw new UnsupportedParameterError({
        client: this.constructor.name,
        parameter: "prompt_caching",
        message:
          "MiniMax Responses API does not support disabling its automatic prompt cache.",
      });
    }
    if (config.prompt_caching === PromptCaching.ENHANCE) {
      throw new UnsupportedParameterError({
        client: this.constructor.name,
        parameter: "prompt_caching",
        message:
          "MiniMax Responses API does not support enhancing its automatic prompt cache.",
      });
    }

    return minimaxConfig;
  }

  /**
   * Transform universal messages to MiniMax Responses input items.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transformUniMessageToModelInput(messages: UniMessage[]): any[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputList: any[] = [];

    for (const message of messages) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let contentItems: any[] = [];

      for (const item of message.content_items) {
        // anything that is not message content becomes an input item of its own, so the
        // text collected so far is flushed first to keep the order the model produced
        if (
          item.type !== "text" &&
          item.type !== "image_url" &&
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
            role: message.role,
            content: contentItems,
          });
          contentItems = [];
        }

        if (item.type === "text") {
          contentItems.push({
            type: message.role === "user" ? "input_text" : "output_text",
            text: item.text,
          });
        } else if (item.type === "image_url") {
          contentItems.push({ type: "input_image", image_url: item.image_url });
        } else if (item.type === "thinking") {
          // MiniMax accepts a reasoning item rebuilt from the thinking text alone, so no fidelity
          // is recorded for it.
          inputList.push({
            type: "reasoning",
            content: item.thinking
              ? [{ type: "reasoning_text", text: item.thinking }]
              : [],
          });
        } else if (item.type === "tool_call") {
          inputList.push({
            type: "function_call",
            call_id: item.tool_call_id,
            name: item.name,
            arguments: JSON.stringify(item.arguments),
          });
        } else if (item.type === "tool_result") {
          if (item.tool_call_id === undefined) {
            throw new Error("tool_call_id is required for tool result.");
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let output: any = item.text;
          if (item.images?.length) {
            output = [{ type: "input_text", text: item.text }];
            for (const imageUrl of item.images) {
              output.push({ type: "input_image", image_url: imageUrl });
            }
          }
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
          role: message.role,
          content: contentItems,
        });
      }
    }

    return inputList;
  }

  /**
   * Transform a MiniMax streaming event to AgentHub's universal event format.
   */
  transformModelOutputToUniEvent(modelOutput: ResponseStreamEvent): UniEvent {
    let eventType: EventType = "unused";
    const contentItems: PartialContentItem[] = [];
    let usageMetadata: UsageMetadata | null = null;
    let finishReason: FinishReason | null = null;

    const minimaxEventType = modelOutput.type;
    if (minimaxEventType === "response.output_text.delta") {
      eventType = "delta";
      contentItems.push({ type: "text", text: modelOutput.delta });
    } else if (minimaxEventType === "response.reasoning_text.delta") {
      eventType = "delta";
      contentItems.push({ type: "thinking", thinking: modelOutput.delta });
    } else if (minimaxEventType === "response.output_item.done") {
      // MiniMax's tool calls are read from the completed item alone: the argument deltas are
      // left unread rather than reconciled against this item, and the streaming loop announces
      // the call with one fragment carrying the whole arguments, so what a consumer streams
      // and the call it is handed are one and the same.
      if (modelOutput.item.type === "function_call") {
        eventType = "delta";
        contentItems.push({
          type: "tool_call",
          name: modelOutput.item.name,
          arguments: parseToolCallArguments(
            modelOutput.item.arguments,
            this.constructor.name,
            modelOutput.item.name,
            modelOutput.item.call_id,
          ),
          tool_call_id: modelOutput.item.call_id,
        });
      }
    } else if (
      minimaxEventType === "response.completed" ||
      minimaxEventType === "response.incomplete"
    ) {
      eventType = "stop";
      const response = modelOutput.response;
      const finishReasonMapping: { [key: string]: FinishReason } = {
        completed: "stop",
        incomplete: "length",
      };
      finishReason = finishReasonMapping[response.status ?? ""] ?? "unknown";

      if (response.usage) {
        // MiniMax drops the detail blocks on truncated responses, so default them to zero.
        const cachedTokens =
          response.usage.input_tokens_details?.cached_tokens ?? 0;
        const reasoningTokens =
          response.usage.output_tokens_details?.reasoning_tokens ?? 0;
        usageMetadata = {
          cached_tokens: cachedTokens,
          prompt_tokens: response.usage.input_tokens - cachedTokens,
          thoughts_tokens: reasoningTokens,
          response_tokens: response.usage.output_tokens - reasoningTokens,
        };
      }
    } else if (
      ![
        "response.created",
        "response.in_progress",
        "response.output_item.added",
        "response.output_text.done",
        "response.reasoning_text.done",
        "response.function_call_arguments.delta",
        "response.function_call_arguments.done",
        "response.content_part.added",
        "response.content_part.done",
        // gateway heartbeat on long generations; carries no content
        "keepalive",
      ].includes(minimaxEventType) &&
      isDebugEnabled()
    ) {
      throw new Error(`Unknown output: ${JSON.stringify(modelOutput)}`);
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
   * Stream MiniMax Responses events with unified conversion methods.
   */
  async *_streamingResponseInternal(options: {
    messages: UniMessage[];
    config: UniConfig;
    signal?: AbortSignal;
  }): AsyncGenerator<UniEvent> {
    const minimaxConfig = this.transformUniConfigToModelConfig(options.config);
    const inputList = this.transformUniMessageToModelInput(options.messages);

    // MiniMax accepts output_text assistant inputs and function tools without OpenAI's required
    // strict field, so narrow the compatibility cast to this boundary.
    const params = {
      ...minimaxConfig,
      input: inputList,
      stream: true,
    } as ResponseCreateParamsStreaming;

    const stream = await this._client.responses.create(params, {
      signal: options.signal,
    });
    for await (const event of stream) {
      const uniEvent = this.transformModelOutputToUniEvent(event);
      if (uniEvent.event_type === "unused") {
        continue;
      }

      for (const item of uniEvent.content_items) {
        if (item.type === "tool_call") {
          // the argument deltas are not streamed, so announce the call the way the Gemini
          // client does: one fragment carrying the whole arguments, then the complete call
          yield {
            role: "assistant",
            event_type: "delta",
            content_items: [
              {
                type: "partial_tool_call",
                name: item.name,
                arguments: JSON.stringify(item.arguments),
                tool_call_id: item.tool_call_id,
              },
            ],
            usage_metadata: null,
            finish_reason: null,
          };
        }
      }

      yield uniEvent;
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
