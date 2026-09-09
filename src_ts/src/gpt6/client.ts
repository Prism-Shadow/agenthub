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
import {
  parseToolCallArguments,
  UnsupportedParameterError,
} from "../errors";
import {
  EventType,
  FinishReason,
  PartialContentItem,
  ThinkingLevel,
  ToolChoice,
  UniConfig,
  UniEvent,
  UniMessage,
  PromptCaching,
  UsageMetadata,
} from "../types";
import { isDebugEnabled, openaiImageDetail } from "../utils";

/**
 * GPT-6-specific LLM client implementation (also serves GPT-5.6, GPT-5.5 and GPT-5.4).
 */
export class GPT6Client extends LLMClient {
  protected _model: string;
  private _client: OpenAI;

  /**
   * Initialize GPT-6 client with model and API key.
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
    const key = options.apiKey || process.env.OPENAI_API_KEY || undefined;
    const url = options.baseUrl || process.env.OPENAI_BASE_URL || undefined;
    this._client = new OpenAI({
      apiKey: key,
      baseURL: url,
      defaultHeaders: options.defaultHeaders,
    });
  }

  /**
   * Convert ThinkingLevel enum to OpenAI's reasoning effort.
   */
  private _convertThinkingLevelToEffort(thinkingLevel: ThinkingLevel): string {
    if (thinkingLevel === ThinkingLevel.NONE && this._model.includes("gpt-6")) {
      // GPT-6 rejects both "none" and "minimal" with a 400 (verified live 2026-09-09:
      // "Unsupported value: 'none' is not supported with the 'gpt-6-astra' model.
      // Supported values are: 'low', 'medium', 'high', 'xhigh', and 'max'."), so NONE
      // degrades to the lowest effort the generation accepts.
      return "low";
    }

    const mapping: { [key: string]: string } = {
      [ThinkingLevel.NONE]: "none",
      [ThinkingLevel.LOW]: "low",
      [ThinkingLevel.MEDIUM]: "medium",
      [ThinkingLevel.HIGH]: "high",
      [ThinkingLevel.XHIGH]: "xhigh",
      [ThinkingLevel.MAX]: "max",
    };
    return mapping[thinkingLevel];
  }

  /**
   * Convert ToolChoice to OpenAI's tool_choice format with allowed tools support.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _convertToolChoice(toolChoice: ToolChoice): any {
    if (Array.isArray(toolChoice)) {
      return {
        mode: "required",
        tools: toolChoice.map((name) => ({ type: "function", name })),
      };
    }

    return toolChoice;
  }

  /**
   * Convert an image URL to an input_image item, at the detail the API needs
   * to read it.
   */
  private _convertImageUrl(imageUrl: string): {
    type: "input_image";
    image_url: string;
    detail?: "high";
  } {
    const detail = openaiImageDetail(this._model, imageUrl);
    return detail
      ? { type: "input_image", image_url: imageUrl, detail }
      : { type: "input_image", image_url: imageUrl };
  }

  /**
   * Transform universal configuration to OpenAI Responses API configuration.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transformUniConfigToModelConfig(config: UniConfig): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const openaiConfig: any = {
      model: this._model,
      store: false,
      include: ["reasoning.encrypted_content"],
    };

    if (config.system_prompt !== undefined) {
      openaiConfig.instructions = config.system_prompt;
    }

    if (config.max_tokens !== undefined) {
      openaiConfig.max_output_tokens = config.max_tokens;
    }

    if (config.temperature !== undefined && config.temperature !== 1.0) {
      throw new UnsupportedParameterError({
        client: this.constructor.name,
        parameter: "temperature",
        message: "GPT-6 does not support setting temperature.",
      });
    }

    if (config.thinking_level !== undefined) {
      openaiConfig.reasoning = {
        effort: this._convertThinkingLevelToEffort(config.thinking_level),
      };
    }

    if (config.thinking_summary) {
      // reasoning.summary stands on its own, with or without an effort (verified live
      // 2026-09-03 on the OpenAI and OpenRouter endpoints). False needs no key: the
      // Responses API returns no summary unless one is asked for.
      openaiConfig.reasoning = openaiConfig.reasoning ?? {};
      openaiConfig.reasoning.summary = "concise";
    }

    if (config.tools !== undefined) {
      openaiConfig.tools = config.tools.map((tool) => ({
        type: "function",
        ...tool,
      }));
    }

    if (config.tool_choice !== undefined) {
      openaiConfig.tool_choice = this._convertToolChoice(config.tool_choice);
    }

    if (config.fast_mode) {
      openaiConfig.service_tier = "priority";
    }

    if (
      config.prompt_caching !== undefined &&
      config.prompt_caching !== PromptCaching.ENABLE
    ) {
      throw new UnsupportedParameterError({
        client: this.constructor.name,
        parameter: "prompt_caching",
        message: "prompt_caching must be ENABLE for GPT-6.",
      });
    }

    return openaiConfig;
  }

  /**
   * Transform universal message format to OpenAI Responses API input format.
   */
  transformUniMessageToModelInput(
    messages: UniMessage[],
    _signal?: AbortSignal,
  ): ResponseInputItem[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputList: any[] = [];

    for (const msg of messages) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let contentItems: any[] = [];
      let lastPhase: string | null = null;

      for (const item of msg.content_items) {
        // anything that is not message content becomes an input item of its own, so the
        // text collected so far is flushed first to keep the order the model produced
        if (
          item.type !== "text" &&
          item.type !== "image_url" &&
          contentItems.length > 0
        ) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const entry: any = { role: msg.role, content: contentItems };
          if (lastPhase !== null) {
            entry.phase = lastPhase;
          }

          inputList.push(entry);
          contentItems = [];
        }

        if (item.type === "text") {
          const phase = item.fidelity?.phase;
          if (msg.role === "assistant" && phase) {
            // split different phases
            if (
              lastPhase !== null &&
              lastPhase !== phase &&
              contentItems.length > 0
            ) {
              inputList.push({
                role: msg.role,
                content: contentItems,
                phase: lastPhase,
              });
              contentItems = [];
            }
            lastPhase = phase;
          }
          if (msg.role === "user") {
            contentItems.push({ type: "input_text", text: item.text });
          } else {
            contentItems.push({ type: "output_text", text: item.text });
          }
        } else if (item.type === "image_url") {
          contentItems.push(this._convertImageUrl(item.image_url));
        } else if (item.type === "thinking") {
          // rebuild the reasoning item from the recorded wire fields: the thinking
          // text goes back through the channel that carried it (histories recorded
          // by the pre-channel client carry encrypted_content and stream summaries)
          const fidelity = item.fidelity ?? {};
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const reasoning: any = { type: "reasoning", summary: [] };
          const summaryChannel =
            fidelity.channel === "summary" ||
            (!("channel" in fidelity) && fidelity.encrypted_content != null);
          if (summaryChannel) {
            if (item.thinking) {
              reasoning.summary = [
                { type: "summary_text", text: item.thinking },
              ];
            }
          } else if (item.thinking) {
            reasoning.content = [
              { type: "reasoning_text", text: item.thinking },
            ];
          }

          for (const key of ["encrypted_content", "signature", "format"]) {
            if (fidelity[key] != null) {
              reasoning[key] = fidelity[key];
            }
          }

          inputList.push(reasoning);
        } else if (item.type === "tool_call") {
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

          // Tool results are input items
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const toolResult: any[] = [{ type: "input_text", text: item.text }];

          if (item.images) {
            for (const imageUrl of item.images) {
              toolResult.push(this._convertImageUrl(imageUrl));
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const entry: any = { role: msg.role, content: contentItems };
        if (lastPhase !== null) {
          entry.phase = lastPhase;
        }
        inputList.push(entry);
      }
    }

    return inputList;
  }

  /**
   * Transform OpenAI Responses API streaming event to universal event format.
   */
  transformModelOutputToUniEvent(modelOutput: ResponseStreamEvent): UniEvent {
    let eventType: EventType | null = null;
    const contentItems: PartialContentItem[] = [];
    let usageMetadata: UsageMetadata | null = null;
    let finishReason: FinishReason | null = null;

    const openaiEventType = modelOutput.type;
    if (openaiEventType === "response.output_text.delta") {
      eventType = "delta";
      contentItems.push({ type: "text", text: modelOutput.delta });
    } else if (
      openaiEventType === "response.reasoning_summary_text.delta" ||
      openaiEventType === "response.reasoning_text.delta"
    ) {
      eventType = "delta";
      contentItems.push({ type: "thinking", thinking: modelOutput.delta });
    } else if (openaiEventType === "response.output_item.added") {
      const item = modelOutput.item;
      if (item.type === "function_call") {
        eventType = "start";
        contentItems.push({
          type: "partial_tool_call",
          name: item.name,
          arguments: "",
          tool_call_id: item.call_id,
        });
      } else if (item.type === "message") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const phase = (item as any).phase as string | undefined;
        if (phase != null) {
          eventType = "delta";
          contentItems.push({ type: "text", text: "", fidelity: { phase } });
        } else {
          eventType = "unused";
        }
      } else {
        eventType = "unused";
      }
    } else if (openaiEventType === "response.output_item.done") {
      const item = modelOutput.item;
      if (item.type === "reasoning") {
        // the completed item carries the canonical wire fields to send back on the
        // next turn (identical to the response.completed copy, but adjacent to the
        // thinking deltas so the fidelity lands on the item that carried the text);
        // record the channel plus the fields the server demands back. This event is the
        // only source of encrypted_content, because the streaming-events reference says
        // of response.output_item.added: "For reasoning items, encrypted_content may be
        // incomplete while the item is in progress. Use the reasoning item from the
        // corresponding response.output_item.done event when passing it as input to a
        // subsequent request."
        eventType = "delta";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fidelity: any = {};
        if (item.summary && item.summary.length > 0) {
          fidelity.channel = "summary";
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } else if ((item as any).content?.length > 0) {
          fidelity.channel = "content";
        }
        for (const key of ["encrypted_content", "signature", "format"]) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if ((item as any)[key] != null) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            fidelity[key] = (item as any)[key];
          }
        }
        contentItems.push({ type: "thinking", thinking: "", fidelity });
      } else {
        eventType = "unused";
      }
    } else if (openaiEventType === "response.function_call_arguments.delta") {
      eventType = "delta";
      contentItems.push({
        type: "partial_tool_call",
        name: "",
        arguments: modelOutput.delta,
        tool_call_id: "",
      });
    } else if (openaiEventType === "response.function_call_arguments.done") {
      eventType = "stop";
    } else if (
      openaiEventType === "response.completed" ||
      openaiEventType === "response.incomplete"
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
        const inputTokens = response.usage.input_tokens;
        const outputTokens = response.usage.output_tokens;

        const cachedTokens = response.usage.input_tokens_details.cached_tokens;
        const reasoningTokens =
          response.usage.output_tokens_details.reasoning_tokens;

        usageMetadata = {
          cached_tokens: cachedTokens,
          prompt_tokens: inputTokens - cachedTokens,
          thoughts_tokens: reasoningTokens,
          response_tokens: outputTokens - reasoningTokens,
        };
      }
    } else if (
      [
        "response.created",
        "response.in_progress",
        "response.output_text.done",
        "response.reasoning_summary_part.added",
        "response.reasoning_summary_part.done",
        "response.reasoning_summary_text.done",
        "response.reasoning_text.done",
        "response.content_part.added",
        "response.content_part.done",
        // gateway heartbeat on long generations; carries no content
        "keepalive",
      ].includes(openaiEventType)
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
   * Stream generate using OpenAI Responses API with unified conversion methods.
   */
  async *_streamingResponseInternal(options: {
    messages: UniMessage[];
    config: UniConfig;
    signal?: AbortSignal;
  }): AsyncGenerator<UniEvent> {
    const openaiConfig = this.transformUniConfigToModelConfig(options.config);
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
      ...openaiConfig,
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
