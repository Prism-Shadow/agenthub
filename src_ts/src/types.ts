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

/**
 * Thinking level for model reasoning.
 */
export enum ThinkingLevel {
  NONE = "none",
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  XHIGH = "xhigh",
  MAX = "max",
}

/**
 * Prompt cache configuration for Claude models.
 */
export enum PromptCaching {
  ENABLE = "enable",
  DISABLE = "disable",
  ENHANCE = "enhance",
}

export type ToolChoice = ("auto" | "required" | "none") | string[];
export type Role = "user" | "assistant";
// "start" opens an item, "delta" carries content, and "stop" closes the response with usage and
// a finish reason. "unused" is a client's own marker for a wire event that carries nothing
// universal, and never leaves the client.
export type EventType = "start" | "delta" | "stop" | "unused";
export type FinishReason = "stop" | "length" | "tool_call" | "unknown";
export type AspectRatio =
  | "1:1"
  | "2:3"
  | "3:2"
  | "3:4"
  | "4:3"
  | "9:16"
  | "16:9"
  | "21:9";
export type ImageSize = "1K" | "2K";

/**
 * Arbitrary JSON-style payload of wire-fidelity data recorded by a client,
 * such as thinking signatures, phase labels, or the upstream reasoning field
 * name. Opaque to consumers: pass it back unchanged so a replay reproduces
 * the original wire message.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Fidelity = Record<string, any>;

export interface TextContentItem {
  type: "text";
  text: string;
  fidelity?: Fidelity;
}

export interface ImageContentItem {
  type: "image_url";
  image_url: string;
}

export interface InlineDataContentItem {
  type: "inline_data";
  data: Buffer;
  mime_type: string;
  fidelity?: Fidelity;
}

export interface ThinkingContentItem {
  type: "thinking";
  thinking: string;
  fidelity?: Fidelity;
}

export interface InlineThinkingContentItem {
  type: "inline_thinking";
  data: Buffer;
  mime_type: string;
  fidelity?: Fidelity;
}

export interface ToolCallContentItem {
  type: "tool_call";
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  arguments: Record<string, any>;
  tool_call_id: string;
  fidelity?: Fidelity;
}

export interface PartialToolCallContentItem {
  type: "partial_tool_call";
  name: string;
  arguments: string;
  tool_call_id: string;
  fidelity?: Fidelity;
}

export interface ToolResultContentItem {
  type: "tool_result";
  text: string;
  images?: string[];
  tool_call_id: string;
}

export interface EmbeddingContentItem {
  type: "embedding";
  embedding: number[];
}

export type ContentItem =
  | TextContentItem
  | ImageContentItem
  | InlineDataContentItem
  | ThinkingContentItem
  | InlineThinkingContentItem
  | ToolCallContentItem
  | ToolResultContentItem
  | EmbeddingContentItem;

export type PartialContentItem = ContentItem | PartialToolCallContentItem;

/**
 * Usage metadata for model response.
 */
export interface UsageMetadata {
  cached_tokens: number | null;
  prompt_tokens: number | null;
  thoughts_tokens: number | null;
  response_tokens: number | null;
}

/**
 * Universal message format for LLM communication.
 */
export interface UniMessage {
  role: Role;
  content_items: ContentItem[];
  usage_metadata?: UsageMetadata | null;
  finish_reason?: FinishReason | null;
  created_at?: number;
}

/**
 * Universal event format for streaming responses.
 */
export interface UniEvent {
  role: Role;
  event_type: EventType;
  content_items: PartialContentItem[];
  usage_metadata: UsageMetadata | null;
  finish_reason: FinishReason | null;
  created_at?: number;
}

/**
 * Available tool schema.
 */
export interface ToolSchema {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters?: Record<string, any>;
}

/**
 * Image generation configuration for models that support image output.
 */
export interface ImageConfig {
  aspect_ratio?: AspectRatio;
  image_size?: ImageSize;
}

/**
 * Speaker and voice assignment for TTS.
 */
export interface SpeakerConfig {
  voice: string;
  speaker?: string;
}

/**
 * Embedding generation configuration.
 */
export interface EmbeddingConfig {
  dimensions?: number;
}

/**
 * Universal configuration format for LLM requests.
 */
export interface UniConfig {
  max_tokens?: number;
  temperature?: number;
  tools?: ToolSchema[];
  thinking_summary?: boolean;
  thinking_level?: ThinkingLevel;
  tool_choice?: ToolChoice;
  system_prompt?: string;
  prompt_caching?: PromptCaching;
  // fast processing at premium pricing: OpenAI-protocol clients send service_tier="priority",
  // Anthropic-protocol clients send speed="fast"; clients without a fast tier reject it
  fast_mode?: boolean;
  image_config?: ImageConfig;
  tts_config?: SpeakerConfig[];
  embedding_config?: EmbeddingConfig;
  trace_id?: string;
}
