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
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import { LLMClient } from "../baseClient";
import {
  parseToolCallArguments,
  UnsupportedParameterError,
} from "../errors";
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
import { fixOpenrouterUsageMetadata } from "../utils";

/**
 * Unified client for the GLM series, named for the newest generation it serves (5.3).
 *
 * The wire format is shared across GLM-5.1 through 5.3; only the thinking
 * parameter contract differs per generation, handled model-by-model.
 */
export class GLM5_3Client extends LLMClient {
  protected _model: string;
  private _client: OpenAI;

  /**
   * Initialize GLM client with model and API key.
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
    const key = options.apiKey || process.env.ZAI_API_KEY || undefined;
    const url =
      options.baseUrl ||
      process.env.ZAI_BASE_URL ||
      "https://api.z.ai/api/paas/v4/";
    this._client = new OpenAI({
      apiKey: key,
      baseURL: url,
      defaultHeaders: options.defaultHeaders,
    });
  }

  /**
   * Convert ThinkingLevel enum to GLM's thinking configuration.
   *
   * GLM-5.3 uses forced thinking and errors on {"type": "disabled"}, so NONE
   * stays enabled there and degrades through the lightest reasoning effort
   * instead (llmsdk_docs/glm5_3/docs/thinking.md).
   */
  private _convertThinkingLevelToConfig(thinkingLevel: ThinkingLevel): {
    type: string;
    clear_thinking?: boolean;
  } {
    // Provider-hosted ids keep their own casing (e.g. SiliconFlow's zai-org/GLM-5.2),
    // so generation detection is case-insensitive.
    if (
      thinkingLevel === ThinkingLevel.NONE &&
      !this._model.toLowerCase().includes("glm-5.3")
    ) {
      return { type: "disabled" };
    }
    return { type: "enabled", clear_thinking: false };
  }

  /**
   * Convert ThinkingLevel enum to the reasoning_effort the model accepts.
   *
   * GLM-5.3 accepts only low/high/max and errors on anything else, so the
   * client clamps to the closest value; NONE rides on low because 5.3 cannot
   * disable thinking. Every earlier generation takes the vocabulary unchanged:
   * 5.2 maps it server-side (low/medium to high, xhigh to max), and 5.1 and
   * below accept the parameter and ignore it (verified live 2026-09-03 on
   * Z.AI, OpenRouter and SiliconFlow), so the level is forwarded there rather
   * than dropped. Outside 5.3 NONE disables thinking outright, which leaves no
   * effort to send.
   */
  private _convertThinkingLevelToReasoningEffort(
    thinkingLevel: ThinkingLevel,
  ): string | undefined {
    const model = this._model.toLowerCase(); // provider-hosted ids keep their own casing
    if (model.includes("glm-5.3")) {
      const mapping: { [key: string]: string } = {
        [ThinkingLevel.NONE]: "low",
        [ThinkingLevel.LOW]: "low",
        [ThinkingLevel.MEDIUM]: "high",
        [ThinkingLevel.HIGH]: "high",
        [ThinkingLevel.XHIGH]: "max",
        [ThinkingLevel.MAX]: "max",
      };
      return mapping[thinkingLevel];
    }
    const mapping: { [key: string]: string } = {
      [ThinkingLevel.LOW]: "low",
      [ThinkingLevel.MEDIUM]: "medium",
      [ThinkingLevel.HIGH]: "high",
      [ThinkingLevel.XHIGH]: "xhigh",
      [ThinkingLevel.MAX]: "max",
    };
    return mapping[thinkingLevel];
  }

  /**
   * Convert ToolChoice to OpenAI's tool_choice format.
   */
  private _convertToolChoice(toolChoice: ToolChoice): string {
    if (toolChoice === "auto") {
      return "auto";
    } else {
      throw new UnsupportedParameterError({
        client: this.constructor.name,
        parameter: "tool_choice",
        message: 'GLM only supports "auto" for tool_choice.',
      });
    }
  }

  /**
   * Transform universal configuration to GLM-specific configuration.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transformUniConfigToModelConfig(config: UniConfig): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const glmConfig: any = {
      model: this._model,
      stream: true,
      extra_body: { tool_stream: true },
    };

    if (config.max_tokens !== undefined) {
      glmConfig.max_tokens = config.max_tokens;
    }

    if (config.temperature !== undefined) {
      glmConfig.temperature = config.temperature;
    }

    if (config.thinking_level !== undefined) {
      const thinkingConfig = this._convertThinkingLevelToConfig(
        config.thinking_level,
      );
      glmConfig.extra_body = {
        ...(glmConfig.extra_body || {}),
        thinking: thinkingConfig,
      };
      const reasoningEffort = this._convertThinkingLevelToReasoningEffort(
        config.thinking_level,
      );
      if (reasoningEffort !== undefined) {
        glmConfig.reasoning_effort = reasoningEffort;
      }
    }

    if (config.tools !== undefined) {
      glmConfig.tools = config.tools.map((tool) => ({
        type: "function",
        function: tool,
      }));
    }

    if (config.tool_choice !== undefined) {
      glmConfig.tool_choice = this._convertToolChoice(config.tool_choice);
    }

    if (config.fast_mode) {
      throw new UnsupportedParameterError({
        client: this.constructor.name,
        parameter: "fast_mode",
        message: "GLM does not support fast mode.",
      });
    }

    if (
      config.prompt_caching !== undefined &&
      config.prompt_caching !== PromptCaching.ENABLE
    ) {
      throw new UnsupportedParameterError({
        client: this.constructor.name,
        parameter: "prompt_caching",
        message: "prompt_caching must be ENABLE for GLM.",
      });
    }

    return glmConfig;
  }

  /**
   * Transform universal message format to OpenAI's message format.
   */
  transformUniMessageToModelInput(
    messages: UniMessage[],
    _signal?: AbortSignal,
  ): ChatCompletionMessageParam[] {
    // glm-5.3-flash is the natively multimodal GLM and the only one that reads image
    // parts (https://docs.z.ai/guides/vlm/glm-5.3-flash); every other GLM answers a
    // request carrying one with an error, so the item is refused here rather than
    // dropped. Provider-hosted ids keep their own casing (e.g. z-ai/glm-5.3-flash),
    // so the version match is case-insensitive.
    const supportsImage = this._model.toLowerCase().includes("glm-5.3-flash");
    const openaiMessages: ChatCompletionMessageParam[] = [];

    for (const msg of messages) {
      const contentParts: Array<{
        type: string;
        text?: string;
        image_url?: { url: string };
      }> = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolCalls: any[] = [];
      let thinking = "";
      const thinkingFields = new Set<string | undefined>();

      for (const item of msg.content_items) {
        if (item.type === "text") {
          contentParts.push({ type: "text", text: item.text });
        } else if (item.type === "image_url") {
          if (!supportsImage) {
            throw new Error(
              `GLM ${this._model} does not support image inputs.`,
            );
          }

          contentParts.push({
            type: "image_url",
            image_url: { url: item.image_url },
          });
        } else if (item.type === "thinking") {
          thinking += item.thinking;
          thinkingFields.add(item.fidelity?.reasoning_field);
        } else if (item.type === "tool_call") {
          toolCalls.push({
            id: item.tool_call_id,
            type: "function",
            function: {
              name: item.name,
              arguments: JSON.stringify(item.arguments, null, 0),
            },
          });
        } else if (item.type === "tool_result") {
          if (!item.tool_call_id) {
            throw new Error("tool_call_id is required for tool result.");
          }

          // Chat Completions lets a tool message carry text only, and a server that
          // validates the schema rejects the whole request over an image part in one.
          // The images ride in the user message that follows the turn's tool messages,
          // the one place every OpenAI-compatible server reads them.
          if (item.images && item.images.length > 0) {
            if (!supportsImage) {
              throw new Error(
                `GLM ${this._model} does not support images in tool results.`,
              );
            }

            for (const imageUrl of item.images) {
              contentParts.push({
                type: "image_url",
                image_url: { url: imageUrl },
              });
            }
          }

          // the plain string is the only content shape the Chat Completion schema
          // documents for a tool message
          openaiMessages.push({
            role: "tool",
            tool_call_id: item.tool_call_id,
            content: item.text,
          });
        } else {
          throw new Error(
            `Unknown item type: ${(item as { type: string }).type}`,
          );
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const message: any = { role: msg.role };
      if (contentParts.length > 0) {
        message.content = contentParts;
      }

      if (toolCalls.length > 0) {
        message.tool_calls = toolCalls;
      }

      if (thinking) {
        // send thinking back through the exact field the upstream produced (recorded
        // in the item fidelity); servers may reject the spelling they did not emit
        if (
          thinkingFields.size === 1 &&
          thinkingFields.has("reasoning_content")
        ) {
          message.reasoning_content = thinking;
        } else if (
          thinkingFields.size === 1 &&
          thinkingFields.has("reasoning")
        ) {
          message.reasoning = thinking;
        } else {
          message.reasoning_content = thinking; // vLLM & siliconflow compatibility
          message.reasoning = thinking; // openrouter compatibility
        }
      }

      if (Object.keys(message).length > 1) {
        openaiMessages.push(message);
      }
    }

    return openaiMessages;
  }

  /**
   * Transform GLM model output to universal event format.
   */
  transformModelOutputToUniEvent(modelOutput: ChatCompletionChunk): UniEvent {
    let eventType: EventType | null = null;
    const contentItems: PartialContentItem[] = [];
    let usageMetadata: UsageMetadata | null = null;
    let finishReason: FinishReason | null = null;

    // gateways inject content-free heartbeat chunks on long generations, whose
    // choices arrive as undefined rather than an empty list
    if (modelOutput.choices?.length) {
      const choice = modelOutput.choices[0];
      const delta = choice?.delta;

      if (delta?.content) {
        eventType = "delta";
        contentItems.push({ type: "text", text: delta.content });
      }

      // the thinking field name differs by server: vLLM & siliconflow use
      // reasoning_content while openrouter uses reasoning; record the wire
      // field that carried each delta so a replay can reproduce exactly the
      // field the upstream produced
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reasoningContent = (delta as any)?.reasoning_content;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reasoning = (delta as any)?.reasoning;
      if (reasoningContent && reasoning) {
        eventType = "delta";
        // ambiguous origin: record no fidelity so a replay sends both fields back
        contentItems.push({ type: "thinking", thinking: reasoningContent });
      } else if (reasoningContent) {
        eventType = "delta";
        contentItems.push({
          type: "thinking",
          thinking: reasoningContent,
          fidelity: { reasoning_field: "reasoning_content" },
        });
      } else if (reasoning) {
        eventType = "delta";
        contentItems.push({
          type: "thinking",
          thinking: reasoning,
          fidelity: { reasoning_field: "reasoning" },
        });
      }

      if (delta?.tool_calls) {
        eventType = "delta";
        for (const toolCall of delta.tool_calls) {
          contentItems.push({
            type: "partial_tool_call",
            name: toolCall.function?.name || "",
            arguments: toolCall.function?.arguments || "",
            tool_call_id: toolCall.id || "",
          });
        }
      }

      if (choice?.finish_reason) {
        eventType = eventType || "stop";
        const finishReasonMapping: { [key: string]: FinishReason } = {
          stop: "stop",
          length: "length",
          tool_calls: "tool_call",
          content_filter: "stop",
        };
        finishReason = finishReasonMapping[choice.finish_reason] || "unknown";
      }
    }

    if (modelOutput.usage) {
      eventType = eventType || "stop";

      const cachedTokens =
        modelOutput.usage.prompt_tokens_details?.cached_tokens || null;
      const reasoningTokens =
        modelOutput.usage.completion_tokens_details?.reasoning_tokens || null;

      const promptTokens =
        cachedTokens !== null
          ? modelOutput.usage.prompt_tokens - cachedTokens
          : modelOutput.usage.prompt_tokens;
      const responseTokens =
        reasoningTokens !== null
          ? modelOutput.usage.completion_tokens - reasoningTokens
          : modelOutput.usage.completion_tokens;

      usageMetadata = {
        cached_tokens: cachedTokens,
        prompt_tokens: promptTokens,
        thoughts_tokens: reasoningTokens,
        response_tokens: responseTokens,
      };
      usageMetadata = fixOpenrouterUsageMetadata(
        usageMetadata,
        this._client.baseURL,
      );
    }

    return {
      role: "assistant",
      event_type: eventType as EventType,
      content_items: contentItems,
      usage_metadata: usageMetadata,
      finish_reason: finishReason,
    };
  }

  /**
   * Stream generate using GLM SDK with unified conversion methods.
   */
  async *_streamingResponseInternal(options: {
    messages: UniMessage[];
    config: UniConfig;
    signal?: AbortSignal;
  }): AsyncGenerator<UniEvent> {
    const glmConfig = this.transformUniConfigToModelConfig(options.config);
    const glmMessages = this.transformUniMessageToModelInput(
      options.messages,
      options.signal,
    );

    if (options.config.system_prompt) {
      glmMessages.unshift({
        role: "system",
        content: options.config.system_prompt,
      });
    }

    const params: ChatCompletionCreateParamsStreaming = {
      ...glmConfig,
      messages: glmMessages,
      stream: true,
    };

    const stream = await this._client.chat.completions.create(params, {
      signal: options.signal,
    });

    const partialToolCall: {
      name?: string;
      arguments?: string;
      tool_call_id?: string;
    } = {};
    let partialUsage: {
      finish_reason?: FinishReason | null;
      usage_metadata?: UsageMetadata | null;
    } = {};

    for await (const chunk of stream) {
      const event = this.transformModelOutputToUniEvent(chunk);
      // the finish reason and usage metadata should be accumulated
      partialUsage.finish_reason =
        event.finish_reason || partialUsage.finish_reason;
      partialUsage.usage_metadata =
        event.usage_metadata || partialUsage.usage_metadata;
      if (event.event_type === "delta") {
        for (const item of event.content_items) {
          if (item.type === "partial_tool_call") {
            if (!partialToolCall.name) {
              // start a new partial tool call
              partialToolCall.name = item.name;
              partialToolCall.arguments = item.arguments;
              partialToolCall.tool_call_id = item.tool_call_id;
            } else if (item.name) {
              // finish the previous partial tool call
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
              // start a new partial tool call
              partialToolCall.name = item.name;
              partialToolCall.arguments = item.arguments;
              partialToolCall.tool_call_id = item.tool_call_id;
            } else {
              // update partial tool call
              partialToolCall.arguments =
                (partialToolCall.arguments || "") + item.arguments;
            }
          }
        }
        yield event;
      } else if (event.event_type === "stop") {
        if (partialToolCall.name) {
          // finish the partial tool call
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

        if (partialUsage.finish_reason && partialUsage.usage_metadata) {
          yield {
            role: "assistant",
            event_type: "stop",
            content_items: [],
            usage_metadata: partialUsage.usage_metadata,
            finish_reason: partialUsage.finish_reason,
          };
          partialUsage.finish_reason = null;
          partialUsage.usage_metadata = null;
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
