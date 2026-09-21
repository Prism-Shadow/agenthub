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
  CreateEmbeddingResponse,
  EmbeddingCreateParams,
} from "openai/resources/embeddings";
import { LLMClient } from "../baseClient";
import { UnsupportedParameterError } from "../errors";
import { UniConfig, UniEvent, UniMessage } from "../types";

/**
 * OpenAI Embeddings-compatible client implementation.
 */
export class OpenaiEmbeddingClient extends LLMClient {
  protected _model: string;
  private _client: OpenAI;

  /**
   * Initialize OpenAI-compatible embedding client with model, API key, and base URL.
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
   * Transform universal configuration to OpenAI Embeddings configuration.
   */
  transformUniConfigToModelConfig(
    config: UniConfig,
  ): Omit<EmbeddingCreateParams, "input"> {
    if (config.fast_mode) {
      throw new UnsupportedParameterError({
        client: this.constructor.name,
        parameter: "fast_mode",
        message: "OpenAI embeddings do not support fast mode.",
      });
    }

    const params: Omit<EmbeddingCreateParams, "input"> = {
      model: this._model as OpenAI.EmbeddingModel,
    };
    const dimensions = config.embedding_config?.dimensions;
    if (dimensions !== undefined) {
      params.dimensions = dimensions;
    }
    return params;
  }

  /**
   * Transform universal messages to OpenAI Embeddings input strings.
   */
  transformUniMessageToModelInput(messages: UniMessage[]): string[] {
    const texts: string[] = [];
    for (const msg of messages) {
      let msgText = "";
      for (const item of msg.content_items) {
        if (item.type !== "text.done") {
          throw new Error("OpenAI embeddings only support text content items.");
        }
        msgText += item.text;
      }
      texts.push(msgText || " ");
    }
    return texts;
  }

  /**
   * Transform an OpenAI Embeddings response into a universal event, one complete item per vector.
   */
  transformModelOutputToUniEvent(
    modelOutput: CreateEmbeddingResponse,
  ): UniEvent {
    return {
      role: "assistant",
      event_type: "stop",
      content_items: modelOutput.data.map((item) => ({
        type: "embedding.delta" as const,
        embedding: item.embedding,
      })),
      usage_metadata: {
        cached_tokens: null,
        prompt_tokens: modelOutput.usage?.prompt_tokens ?? null,
        thoughts_tokens: null,
        response_tokens: null,
      },
      finish_reason: "stop",
    };
  }

  /**
   * Generate embeddings using OpenAI Embeddings-compatible API.
   */
  async *_streamingResponseInternal(options: {
    messages: UniMessage[];
    config: UniConfig;
    signal?: AbortSignal;
  }): AsyncGenerator<UniEvent> {
    const params: EmbeddingCreateParams = {
      ...this.transformUniConfigToModelConfig(options.config),
      input: this.transformUniMessageToModelInput(options.messages),
    };
    const result = await this._client.embeddings.create(params, {
      signal: options.signal,
    });
    yield this.transformModelOutputToUniEvent(result);
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
