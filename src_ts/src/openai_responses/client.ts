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
 * OpenAI Responses-compatible client implementation.
 */
export class OpenaiResponsesClient extends LLMClient {
  protected _model: string;
  private _client: OpenAI;

  /**
   * Initialize OpenAI Responses-compatible client with model, API key, and base URL.
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
   * Convert ThinkingLevel enum to the Responses API reasoning effort.
   */
  private _convertThinkingLevelToEffort(thinkingLevel: ThinkingLevel): string {
    if (thinkingLevel === ThinkingLevel.NONE && this._model.includes("gpt-6")) {
      // a gateway serving GPT-6 forwards the effort to OpenAI, which rejects "none" and
      // "minimal" with a 400 (verified live 2026-09-09 against api.openai.com), so NONE
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
   * Convert ToolChoice to the Responses API tool_choice format with allowed tools support.
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
   * Transform universal configuration to OpenAI Responses-compatible configuration.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transformUniConfigToModelConfig(config: UniConfig): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const openaiConfig: any = {
      model: this._model,
      store: false,
    };

    if (config.system_prompt !== undefined) {
      openaiConfig.instructions = config.system_prompt;
    }

    if (config.max_tokens !== undefined) {
      openaiConfig.max_output_tokens = config.max_tokens;
    }

    if (config.temperature !== undefined) {
      openaiConfig.temperature = config.temperature;
    }

    // Unlike the model-specific Responses clients, the summary stays inside this branch:
    // OpenRouter reads a reasoning object carrying no effort as "reasoning disabled" and
    // refuses it on a forced-thinking model -- "Reasoning is mandatory for this endpoint
    // and cannot be disabled" (400, verified live 2026-09-03 with z-ai/glm-5.3) -- so a
    // summary sent on its own would turn a dropped value into a failed request.
    if (config.thinking_level !== undefined) {
      openaiConfig.reasoning = {
        effort: this._convertThinkingLevelToEffort(config.thinking_level),
      };
      if (config.thinking_summary) {
        openaiConfig.reasoning.summary = "concise";
      }
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
        message: "prompt_caching must be ENABLE for the Responses API.",
      });
    }

    return openaiConfig;
  }

  /**
   * Transform universal message format to OpenAI Responses-compatible input format.
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
        // text collected so far is flushed first to keep the original order: a server that
        // merges a function call into the adjacent assistant message rejects a call whose
        // output does not follow it (DeepSeek answers "No tool output found for tool call")
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
          // the wire shape differs by server: OpenAI-style servers stream summaries and
          // demand the summary key back (with encrypted_content preserved), while
          // DeepSeek/Z.AI/MiniMax-style servers accept a reasoning item rebuilt from the
          // thinking text alone as reasoning_text content
          const fidelity = item.fidelity ?? {};
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const reasoning: any = { type: "reasoning", summary: [] };
          if (fidelity.channel === "summary") {
            if (item.thinking) {
              reasoning.summary = [{ type: "summary_text", text: item.thinking }];
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

          // NOTE: tool results are input items
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const imageParts: any[] = [];

          if (item.images) {
            for (const imageUrl of item.images) {
              imageParts.push(this._convertImageUrl(imageUrl));
            }
          }

          // a plain string is the form every OpenAI-compatible server accepts for a text
          // result; the content-part list is reserved for results carrying images, which
          // only servers with multimodal tool messages take
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
   * Transform OpenAI Responses-compatible streaming event to universal event format.
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
      openaiEventType === "response.reasoning_text.delta" ||
      openaiEventType === "response.reasoning_summary_text.delta"
    ) {
      eventType = "delta";
      contentItems.push({ type: "thinking", thinking: modelOutput.delta });
    } else if (openaiEventType === "response.output_item.added") {
      const item = modelOutput.item;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const phase = (item as any).phase as string | undefined;
      if (item.type === "function_call") {
        eventType = "start";
        contentItems.push({
          type: "partial_tool_call",
          name: item.name,
          arguments: "",
          tool_call_id: item.call_id,
        });
      } else if (item.type === "message" && phase) {
        eventType = "delta";
        contentItems.push({ type: "text", text: "", fidelity: { phase } });
      } else {
        eventType = "unused";
      }
    } else if (openaiEventType === "response.output_item.done") {
      const item = modelOutput.item;
      if (item.type === "reasoning") {
        // record the wire shape of the completed reasoning item so a replay reproduces
        // the channel that carried the thinking plus the fields the server demands back
        eventType = "delta";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fidelity: any = {};
        if (item.summary && item.summary.length > 0) {
          fidelity.channel = "summary";
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
        // some servers drop the detail blocks (e.g. MiniMax on truncation), so default to zero
        const cachedTokens = response.usage.input_tokens_details?.cached_tokens || 0;
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
        "response.output_text.done",
        "response.reasoning_text.done",
        "response.reasoning_summary_part.added",
        "response.reasoning_summary_part.done",
        "response.reasoning_summary_text.done",
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
   * Stream generate using an OpenAI Responses-compatible API with unified conversion methods.
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
