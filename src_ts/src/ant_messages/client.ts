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

import Anthropic from "@anthropic-ai/sdk";
import {
  BetaMessageParam,
  BetaRawMessageStreamEvent,
} from "@anthropic-ai/sdk/resources/beta/messages";
import { Stream } from "@anthropic-ai/sdk/core/streaming";
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
import {
  fixOpenrouterUsageMetadata,
  isDebugEnabled,
} from "../utils";

const REDACTED_THINKING = "_REDACTED_THINKING";

/**
 * Anthropic Messages-compatible client implementation.
 */
export class AntMessagesClient extends LLMClient {
  protected _model: string;
  private _client: Anthropic;

  /**
   * Initialize Anthropic Messages-compatible client with model, API key, and base URL.
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
    const key = options.apiKey || process.env.ANTHROPIC_API_KEY || undefined;
    const url = options.baseUrl || process.env.ANTHROPIC_BASE_URL || undefined;
    // send the credential through both header conventions: Anthropic and DeepSeek read
    // x-api-key while gateways such as OpenRouter and Z.AI read Authorization: Bearer. With no
    // credential the token has to be null, not undefined, or the SDK fills it from
    // ANTHROPIC_AUTH_TOKEN.
    this._client = new Anthropic({
      apiKey: key,
      authToken: key ?? null,
      baseURL: url,
      defaultHeaders: options.defaultHeaders,
    });
  }

  /**
   * Convert image URL to an Anthropic image source block.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _convertImageUrlToSource(url: string): any {
    if (url.startsWith("data:")) {
      const match = url.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        throw new Error(`Invalid base64 image: ${url}`);
      }

      return {
        type: "image",
        source: { type: "base64", media_type: match[1], data: match[2] },
      };
    }

    return { type: "image", source: { type: "url", url } };
  }

  /**
   * Convert ThinkingLevel enum to the Messages API thinking config.
   */
  private _convertThinkingLevelToThinkingConfig(thinkingLevel: ThinkingLevel): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  } {
    // NONE is explicit rather than omitted because some servers (e.g. Z.AI) think by default
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapping: { [key: string]: any } = {
      [ThinkingLevel.NONE]: { thinking: { type: "disabled" } },
      [ThinkingLevel.LOW]: {
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
      },
      [ThinkingLevel.MEDIUM]: {
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
      },
      [ThinkingLevel.HIGH]: {
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
      },
      [ThinkingLevel.XHIGH]: {
        thinking: { type: "adaptive" },
        output_config: { effort: "xhigh" },
      },
      [ThinkingLevel.MAX]: {
        thinking: { type: "adaptive" },
        output_config: { effort: "max" },
      },
    };
    return mapping[thinkingLevel];
  }

  /**
   * Convert ToolChoice to the Messages API tool_choice format.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _convertToolChoice(toolChoice: ToolChoice): any {
    if (Array.isArray(toolChoice)) {
      if (toolChoice.length > 1) {
        throw new UnsupportedParameterError({
          client: this.constructor.name,
          parameter: "tool_choice",
          message: "The Messages API does not support multiple tool choices.",
        });
      }

      return { type: "tool", name: toolChoice[0] };
    } else if (toolChoice === "none") {
      return { type: "none" };
    } else if (toolChoice === "auto") {
      return { type: "auto" };
    } else if (toolChoice === "required") {
      return { type: "any" };
    }
  }

  /**
   * Transform universal configuration to Anthropic Messages-compatible configuration.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transformUniConfigToModelConfig(config: UniConfig): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const antConfig: any = { model: this._model, stream: true };

    if (config.system_prompt !== undefined) {
      antConfig.system = config.system_prompt;
    }

    if (config.max_tokens !== undefined) {
      antConfig.max_tokens = config.max_tokens;
    } else {
      // the Messages API requires max_tokens to be specified
      antConfig.max_tokens = 64000;
    }

    if (config.temperature !== undefined) {
      antConfig.temperature = config.temperature;
    }

    if (config.thinking_level !== undefined) {
      Object.assign(
        antConfig,
        this._convertThinkingLevelToThinkingConfig(config.thinking_level),
      );
    }

    if (config.thinking_summary !== undefined) {
      // display lives on the thinking block, so a summary asked for on its own selects
      // adaptive thinking. A disabled block is the one place it cannot ride along --
      // "thinking.disabled.display: Extra inputs are not permitted" (400, verified live
      // 2026-09-03) -- and thinking_level NONE disables thinking, leaving nothing to show.
      antConfig.thinking = antConfig.thinking ?? { type: "adaptive" };
      if (antConfig.thinking.type !== "disabled") {
        antConfig.thinking.display = config.thinking_summary
          ? "summarized"
          : "omitted";
      }
    }

    // Convert tools to the Messages API tool schema
    if (config.tools !== undefined) {
      antConfig.tools = config.tools.map((tool) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const antTool: any = {};
        for (const [key, value] of Object.entries(tool)) {
          antTool[key.replace("parameters", "input_schema")] = value;
        }
        return antTool;
      });
    }

    // Convert tool_choice
    if (config.tool_choice !== undefined) {
      antConfig.tool_choice = this._convertToolChoice(config.tool_choice);
    }

    if (config.fast_mode) {
      antConfig.speed = "fast";
      antConfig.betas = ["fast-mode-2026-02-01"];
    }

    if (
      config.prompt_caching !== undefined &&
      config.prompt_caching !== PromptCaching.ENABLE
    ) {
      throw new UnsupportedParameterError({
        client: this.constructor.name,
        parameter: "prompt_caching",
        message: "prompt_caching must be ENABLE for the Messages API.",
      });
    }

    return antConfig;
  }

  /**
   * Transform universal message format to the Messages API BetaMessageParam format.
   */
  transformUniMessageToModelInput(
    messages: UniMessage[],
    _signal?: AbortSignal,
  ): BetaMessageParam[] {
    const antMessages: BetaMessageParam[] = [];

    for (const msg of messages) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contentBlocks: any[] = [];
      for (const item of msg.content_items) {
        if (item.type === "text") {
          contentBlocks.push({ type: "text", text: item.text });
        } else if (item.type === "image_url") {
          contentBlocks.push(this._convertImageUrlToSource(item.image_url));
        } else if (item.type === "thinking") {
          if (item.thinking === REDACTED_THINKING) {
            contentBlocks.push({
              type: "redacted_thinking",
              data: item.fidelity?.signature,
            });
          } else {
            // third-party servers accept thinking without a signature, but the
            // official API requires the one it emitted
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const thinkingBlock: any = {
              type: "thinking",
              thinking: item.thinking,
            };
            if (item.fidelity?.signature != null) {
              thinkingBlock.signature = item.fidelity.signature;
            }

            contentBlocks.push(thinkingBlock);
          }
        } else if (item.type === "tool_call") {
          contentBlocks.push({
            type: "tool_use",
            id: item.tool_call_id,
            name: item.name,
            input: item.arguments,
          });
        } else if (item.type === "tool_result") {
          if (!item.tool_call_id) {
            throw new Error("tool_call_id is required for tool result.");
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const toolResult: any[] = [{ type: "text", text: item.text }];
          if (item.images) {
            for (const imageUrl of item.images) {
              toolResult.push(this._convertImageUrlToSource(imageUrl));
            }
          }

          contentBlocks.push({
            type: "tool_result",
            content: toolResult,
            tool_use_id: item.tool_call_id,
          });
        } else {
          throw new Error(`Unknown item: ${JSON.stringify(item)}`);
        }
      }

      antMessages.push({ role: msg.role, content: contentBlocks });
    }

    return antMessages;
  }

  /**
   * Transform a Messages API streaming event to universal event format.
   *
   * NOTE: the Messages API always has only one content item per event.
   */
  transformModelOutputToUniEvent(
    modelOutput: BetaRawMessageStreamEvent,
  ): UniEvent {
    let eventType: EventType | null = null;
    const contentItems: PartialContentItem[] = [];
    let usageMetadata: UsageMetadata | null = null;
    let finishReason: FinishReason | null = null;

    const antEventType = modelOutput.type;
    if (antEventType === "content_block_start") {
      eventType = "start";
      const block = modelOutput.content_block;
      if (block.type === "tool_use") {
        contentItems.push({
          type: "partial_tool_call",
          name: block.name,
          arguments: "",
          tool_call_id: block.id,
        });
      } else if (block.type === "redacted_thinking") {
        contentItems.push({
          type: "thinking",
          thinking: REDACTED_THINKING,
          fidelity: { signature: block.data },
        });
      }
    } else if (antEventType === "content_block_delta") {
      eventType = "delta";
      const delta = modelOutput.delta;
      if (delta.type === "thinking_delta") {
        contentItems.push({ type: "thinking", thinking: delta.thinking });
      } else if (delta.type === "text_delta") {
        contentItems.push({ type: "text", text: delta.text });
      } else if (delta.type === "input_json_delta") {
        contentItems.push({
          type: "partial_tool_call",
          name: "",
          arguments: delta.partial_json,
          tool_call_id: "",
        });
      } else if (delta.type === "signature_delta") {
        contentItems.push({
          type: "thinking",
          thinking: "",
          fidelity: { signature: delta.signature },
        });
      }
    } else if (antEventType === "content_block_stop") {
      eventType = "stop";
    } else if (antEventType === "message_start") {
      eventType = "start";
      const message = modelOutput.message;
      if (message.usage) {
        const cacheCreationTokens =
          message.usage.cache_creation_input_tokens || 0;
        usageMetadata = {
          cached_tokens: message.usage.cache_read_input_tokens,
          prompt_tokens: message.usage.input_tokens + cacheCreationTokens,
          thoughts_tokens: null,
          response_tokens: null,
        };
      }
    } else if (antEventType === "message_delta") {
      eventType = "stop";
      const delta = modelOutput.delta;
      if (delta.stop_reason) {
        const stopReasonMapping: { [key: string]: FinishReason } = {
          end_turn: "stop",
          max_tokens: "length",
          stop_sequence: "stop",
          tool_use: "tool_call",
        };
        finishReason = stopReasonMapping[delta.stop_reason] || "unknown";
      }

      const usage = modelOutput.usage;
      if (usage) {
        // gateways report zero usage in message_start and the full counts here, so the
        // delta also carries the input-side fields (null on servers that omit them)
        const promptTokens =
          usage.input_tokens != null
            ? usage.input_tokens + (usage.cache_creation_input_tokens || 0)
            : null;
        const thinkingTokens =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (usage as any).output_tokens_details?.thinking_tokens ?? null;
        usageMetadata = {
          cached_tokens: usage.cache_read_input_tokens ?? null,
          prompt_tokens: promptTokens,
          thoughts_tokens: thinkingTokens,
          response_tokens: usage.output_tokens - (thinkingTokens || 0),
        };
      }
    } else if (antEventType === "message_stop") {
      eventType = "stop";
    } else if (
      ["text", "thinking", "signature", "input_json", "ping"].includes(
        antEventType,
      )
    ) {
      // the SDK drops the "ping" heartbeat at the SSE layer; it reaches here only
      // from gateways that relabel it onto another event
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
   * Stream generate using an Anthropic Messages-compatible API with unified conversion methods.
   */
  async *_streamingResponseInternal(options: {
    messages: UniMessage[];
    config: UniConfig;
    signal?: AbortSignal;
  }): AsyncGenerator<UniEvent> {
    const antConfig = this.transformUniConfigToModelConfig(options.config);
    const antMessages = this.transformUniMessageToModelInput(
      options.messages,
      options.signal,
    );

    // Stream generate
    const partialToolCall: {
      name?: string;
      arguments?: string;
      tool_call_id?: string;
    } = {};
    const partialUsage: {
      prompt_tokens?: number | null;
      cached_tokens?: number | null;
    } = {};

    const stream = (await this._client.beta.messages.create(
      {
        ...antConfig,
        messages: antMessages,
      },
      {
        signal: options.signal,
      },
    )) as unknown as Stream<BetaRawMessageStreamEvent>;

    for await (const event of stream) {
      const uniEvent = this.transformModelOutputToUniEvent(event);
      if (uniEvent.event_type === "start") {
        for (const item of uniEvent.content_items) {
          if (item.type === "partial_tool_call") {
            partialToolCall.name = item.name;
            partialToolCall.arguments = "";
            partialToolCall.tool_call_id = item.tool_call_id;
          }
        }

        if (uniEvent.content_items.length > 0) {
          yield uniEvent;
        }

        if (uniEvent.usage_metadata !== null) {
          partialUsage.prompt_tokens = uniEvent.usage_metadata.prompt_tokens;
          partialUsage.cached_tokens = uniEvent.usage_metadata.cached_tokens;
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

        if (uniEvent.usage_metadata !== null) {
          // finish partial usage: the message_delta counts win over message_start
          const deltaUsage = uniEvent.usage_metadata;
          const usageMetadata: UsageMetadata = {
            prompt_tokens:
              deltaUsage.prompt_tokens !== null
                ? deltaUsage.prompt_tokens
                : (partialUsage.prompt_tokens ?? null),
            cached_tokens:
              deltaUsage.cached_tokens !== null
                ? deltaUsage.cached_tokens
                : (partialUsage.cached_tokens ?? null),
            thoughts_tokens: deltaUsage.thoughts_tokens,
            response_tokens: deltaUsage.response_tokens,
          };
          yield {
            role: "assistant",
            event_type: "stop",
            content_items: [],
            usage_metadata: fixOpenrouterUsageMetadata(
              usageMetadata,
              this._client.baseURL,
            ),
            finish_reason: uniEvent.finish_reason,
          };
          partialUsage.prompt_tokens = undefined;
          partialUsage.cached_tokens = undefined;
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
