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

import * as path from "path";
import OpenAI from "openai";
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
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
import { fixOpenrouterUsageMetadata } from "../utils";

/**
 * Kimi K3-specific LLM client implementation using OpenAI-compatible API (also serves K2.5 and K2.6).
 */
export class KimiK3Client extends LLMClient {
  protected _model: string;
  private _client: OpenAI;

  /**
   * Initialize Kimi K3 client with model and API key.
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
    const key = options.apiKey || process.env.MOONSHOT_API_KEY || undefined;
    const url =
      options.baseUrl ||
      process.env.MOONSHOT_BASE_URL ||
      "https://api.moonshot.cn/v1";
    this._client = new OpenAI({
      apiKey: key,
      baseURL: url,
      defaultHeaders: options.defaultHeaders,
    });
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
   * Convert image URL to base64-encoded data URL.
   */
  private async _convertImageUrlToBase64(
    url: string,
    signal?: AbortSignal,
  ): Promise<string> {
    if (url.startsWith("data:")) {
      return url;
    }

    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch image: ${response.status} ${response.statusText}`,
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = this._detectImageMimeType(url);
    const base64String = buffer.toString("base64");
    return `data:${mimeType};base64,${base64String}`;
  }

  /**
   * Convert ThinkingLevel enum to the K2-generation thinking configuration.
   */
  private _convertThinkingLevelToThinkingConfig(thinkingLevel: ThinkingLevel): {
    [key: string]: string;
  } {
    const mapping: { [key: string]: { [key: string]: string } } = {
      [ThinkingLevel.NONE]: { type: "disabled" },
      [ThinkingLevel.LOW]: { type: "enabled", keep: "all" },
      [ThinkingLevel.MEDIUM]: { type: "enabled", keep: "all" },
      [ThinkingLevel.HIGH]: { type: "enabled", keep: "all" },
      [ThinkingLevel.XHIGH]: { type: "enabled", keep: "all" },
      [ThinkingLevel.MAX]: { type: "enabled", keep: "all" },
    };
    return mapping[thinkingLevel];
  }

  /**
   * Convert ThinkingLevel enum to Kimi K3's reasoning_effort.
   *
   * K3 cannot disable reasoning, so NONE degrades to the lowest effort
   * instead of throwing.
   */
  private _convertThinkingLevelToReasoningEffort(
    thinkingLevel: ThinkingLevel,
  ): string {
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

  /**
   * Convert ToolChoice to OpenAI's tool_choice format.
   */
  private _convertToolChoice(toolChoice: ToolChoice): string {
    if (toolChoice === "auto") {
      return "auto";
    } else if (toolChoice === "none") {
      return "none";
    } else if (
      toolChoice === "required" &&
      !this._model.toLowerCase().includes("k2.")
    ) {
      return "required";
    } else {
      // the K2 generation rejects "required"; forcing a specific tool is
      // unsupported family-wide
      throw new UnsupportedParameterError({
        client: this.constructor.name,
        parameter: "tool_choice",
        message:
          "Kimi does not support this tool_choice ('required' needs Kimi K3).",
      });
    }
  }

  /**
   * Transform universal configuration to Kimi K3-specific configuration.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transformUniConfigToModelConfig(config: UniConfig): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kimiConfig: any = {
      model: this._model,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (config.max_tokens !== undefined) {
      kimiConfig.max_completion_tokens = config.max_tokens;
    }

    if (config.temperature !== undefined && config.temperature !== 1.0) {
      throw new UnsupportedParameterError({
        client: this.constructor.name,
        parameter: "temperature",
        message: "Kimi does not support setting temperature.",
      });
    }

    if (config.thinking_level !== undefined) {
      // the K2 generation configures thinking through extra_body and can disable
      // it; K3 uses reasoning_effort and cannot
      if (this._model.toLowerCase().includes("k2.")) {
        kimiConfig.extra_body = kimiConfig.extra_body || {};
        kimiConfig.extra_body.thinking =
          this._convertThinkingLevelToThinkingConfig(config.thinking_level);
      } else {
        kimiConfig.reasoning_effort =
          this._convertThinkingLevelToReasoningEffort(config.thinking_level);
      }
    }

    if (config.tools !== undefined) {
      kimiConfig.tools = config.tools.map((tool) => ({
        type: "function",
        function: tool,
      }));
    }

    if (config.tool_choice !== undefined) {
      kimiConfig.tool_choice = this._convertToolChoice(config.tool_choice);
    }

    if (config.fast_mode) {
      throw new UnsupportedParameterError({
        client: this.constructor.name,
        parameter: "fast_mode",
        message: "Kimi does not support fast mode.",
      });
    }

    if (
      config.prompt_caching !== undefined &&
      config.prompt_caching !== PromptCaching.ENABLE
    ) {
      throw new UnsupportedParameterError({
        client: this.constructor.name,
        parameter: "prompt_caching",
        message: "prompt_caching must be ENABLE for Kimi.",
      });
    }

    // K3 context caching is automatic; the K2 generation keys its prompt
    // cache on trace_id
    if (
      config.trace_id !== undefined &&
      this._model.toLowerCase().includes("k2.")
    ) {
      kimiConfig.prompt_cache_key = config.trace_id;
    }

    return kimiConfig;
  }

  /**
   * Transform universal message format to OpenAI's message format.
   */
  async transformUniMessageToModelInput(
    messages: UniMessage[],
    signal?: AbortSignal,
  ): Promise<ChatCompletionMessageParam[]> {
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
        if (item.type === "text.done") {
          contentParts.push({ type: "text", text: item.text });
        } else if (item.type === "image_url.done") {
          const base64Image = await this._convertImageUrlToBase64(
            item.image_url,
            signal,
          );
          contentParts.push({
            type: "image_url",
            image_url: { url: base64Image },
          });
        } else if (item.type === "thinking.done") {
          thinking += item.thinking;
          thinkingFields.add(item.fidelity?.reasoning_field);
        } else if (item.type === "tool_call.done") {
          toolCalls.push({
            id: item.tool_call_id,
            type: "function",
            function: {
              name: item.name,
              arguments: JSON.stringify(item.arguments, null, 0),
            },
          });
        } else if (item.type === "tool_result.done") {
          if (!item.tool_call_id) {
            throw new Error("tool_call_id is required for tool result.");
          }

          // Chat Completions lets a tool message carry text only, and a server that
          // validates the schema rejects the whole request over an image part in one.
          // The images ride in the user message that follows the turn's tool messages,
          // the one place every OpenAI-compatible server reads them.
          if (item.images && item.images.length > 0) {
            for (const imageUrl of item.images) {
              const base64Image = await this._convertImageUrlToBase64(
                imageUrl,
                signal,
              );
              contentParts.push({
                type: "image_url",
                image_url: { url: base64Image },
              });
            }
          }

          // the plain string is the form Moonshot's own tool-call examples send and every
          // OpenAI-compatible server accepts
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
   * Transform one Kimi K3 streaming chunk into client parts.
   *
   * Chat Completions gives an item no identity, so each delta is keyed by the wire field
   * that carried it; _streamingResponseInternal turns those into one key per item.
   */
  transformModelOutputToClientParts(
    modelOutput: ChatCompletionChunk,
  ): ClientPart[] {
    const parts: ClientPart[] = [];

    // gateways inject content-free heartbeat chunks on long generations, whose
    // choices arrive as undefined rather than an empty list
    if (modelOutput.choices?.length) {
      const choice = modelOutput.choices[0];
      const delta = choice?.delta;

      // the thinking field name differs by server: vLLM & siliconflow use
      // reasoning_content while openrouter uses reasoning; record the wire
      // field that carried each delta so a replay can reproduce exactly the
      // field the upstream produced. The reasoning goes before the content
      // because a chunk may end the reasoning and begin the answer.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reasoningContent = (delta as any)?.reasoning_content;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reasoning = (delta as any)?.reasoning;
      if (reasoningContent && reasoning) {
        // ambiguous origin: record no fidelity so a replay sends both fields back
        parts.push({
          type: "delta",
          key: "reasoning_content",
          item: { type: "thinking.delta", thinking: reasoningContent },
        });
      } else if (reasoningContent) {
        parts.push({
          type: "delta",
          key: "reasoning_content",
          item: {
            type: "thinking.delta",
            thinking: reasoningContent,
            fidelity: { reasoning_field: "reasoning_content" },
          },
        });
      } else if (reasoning) {
        parts.push({
          type: "delta",
          key: "reasoning",
          item: {
            type: "thinking.delta",
            thinking: reasoning,
            fidelity: { reasoning_field: "reasoning" },
          },
        });
      }

      if (delta?.content) {
        parts.push({
          type: "delta",
          key: "content",
          item: { type: "text.delta", text: delta.content },
        });
      }

      if (delta?.tool_calls) {
        for (const toolCall of delta.tool_calls) {
          parts.push({
            type: "delta",
            key: "tool_calls",
            item: {
              type: "tool_call.delta",
              name: toolCall.function?.name || "",
              arguments: toolCall.function?.arguments || "",
              tool_call_id: toolCall.id || "",
            },
          });
        }
      }

      if (choice?.finish_reason) {
        const finishReasonMapping: { [key: string]: FinishReason } = {
          stop: "stop",
          length: "length",
          tool_calls: "tool_call",
          content_filter: "stop",
        };
        parts.push({
          type: "finish",
          finish_reason: finishReasonMapping[choice.finish_reason] || "unknown",
        });
      }
    }

    if (modelOutput.usage) {
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

      const usageMetadata: UsageMetadata = {
        cached_tokens: cachedTokens,
        prompt_tokens: promptTokens,
        thoughts_tokens: reasoningTokens,
        response_tokens: responseTokens,
      };
      parts.push({
        type: "finish",
        usage_metadata: fixOpenrouterUsageMetadata(
          usageMetadata,
          this._client.baseURL,
        ),
      });
    }

    return parts;
  }

  /**
   * Stream generate using Kimi SDK with unified conversion methods.
   */
  async *_streamingResponseInternal(options: {
    messages: UniMessage[];
    config: UniConfig;
    signal?: AbortSignal;
  }): AsyncGenerator<ClientPart> {
    const kimiConfig = this.transformUniConfigToModelConfig(options.config);
    const kimiMessages = await this.transformUniMessageToModelInput(
      options.messages,
      options.signal,
    );

    if (options.config.system_prompt) {
      kimiMessages.unshift({
        role: "system",
        content: options.config.system_prompt,
      });
    }

    const params: ChatCompletionCreateParamsStreaming = {
      ...kimiConfig,
      messages: kimiMessages,
      stream: true,
    };

    const stream = await this._client.chat.completions.create(params, {
      signal: options.signal,
    });

    // Chat Completions never signals that an item ended either: an item runs until a delta
    // arrives from another wire field or names the next tool call
    let itemIndex = -1;
    let openField: string | null = null;
    for await (const chunk of stream) {
      for (const part of this.transformModelOutputToClientParts(chunk)) {
        if (part.type !== "delta") {
          yield part;
          continue;
        }

        if (
          part.key !== openField ||
          (part.item.type === "tool_call.delta" && part.item.name)
        ) {
          if (openField !== null) {
            yield { type: "done", key: String(itemIndex) };
          }
          itemIndex += 1;
          openField = part.key;
        }
        yield { ...part, key: String(itemIndex) };
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
