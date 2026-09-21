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
// A stream is any number of "delta" events closed by exactly one "stop" event, which carries the
// usage and the finish reason; a caller can tell a running stream from a finished one by it.
export type EventType = "delta" | "stop";
export type FinishReason = "stop" | "length" | "tool_call" | "unknown";
export type AspectRatio =
  "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "9:16" | "16:9" | "21:9";
export type ImageSize = "1K" | "2K";

/**
 * Arbitrary JSON-style payload of wire-fidelity data recorded by a client,
 * such as thinking signatures, phase labels, or the upstream reasoning field
 * name. Opaque to consumers: pass it back unchanged so a replay reproduces
 * the original wire message.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Fidelity = Record<string, any>;

// Complete items. A message holds only these, and a stream closes every item it streams with one.

export interface TextDoneItem {
  type: "text.done";
  text: string;
  fidelity?: Fidelity;
}

export interface ImageUrlDoneItem {
  type: "image_url.done";
  image_url: string;
}

export interface InlineDataDoneItem {
  type: "inline_data.done";
  data: Buffer;
  mime_type: string;
  fidelity?: Fidelity;
}

export interface ThinkingDoneItem {
  type: "thinking.done";
  thinking: string;
  fidelity?: Fidelity;
}

export interface InlineThinkingDoneItem {
  type: "inline_thinking.done";
  data: Buffer;
  mime_type: string;
  fidelity?: Fidelity;
}

export interface ToolCallDoneItem {
  type: "tool_call.done";
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  arguments: Record<string, any>;
  tool_call_id: string;
  fidelity?: Fidelity;
}

export interface ToolResultDoneItem {
  type: "tool_result.done";
  text: string;
  images?: string[];
  tool_call_id: string;
}

export interface EmbeddingDoneItem {
  type: "embedding.done";
  embedding: number[];
}

export type ContentItem =
  | TextDoneItem
  | ImageUrlDoneItem
  | InlineDataDoneItem
  | ThinkingDoneItem
  | InlineThinkingDoneItem
  | ToolCallDoneItem
  | ToolResultDoneItem
  | EmbeddingDoneItem;

// Streamed fragments. One or more deltas of a kind are followed by the done item of that kind;
// at most one delta of an item carries fidelity, and it equals the done item's fidelity.

export interface TextDeltaItem {
  type: "text.delta";
  text: string;
  fidelity?: Fidelity;
}

export interface InlineDataDeltaItem {
  type: "inline_data.delta";
  data: Buffer;
  mime_type: string;
  fidelity?: Fidelity;
}

export interface ThinkingDeltaItem {
  type: "thinking.delta";
  thinking: string;
  fidelity?: Fidelity;
}

export interface InlineThinkingDeltaItem {
  type: "inline_thinking.delta";
  data: Buffer;
  mime_type: string;
  fidelity?: Fidelity;
}

export interface ToolCallDeltaItem {
  type: "tool_call.delta";
  // non-empty on the first delta of a call only
  name: string;
  // a fragment of the raw arguments JSON string
  arguments: string;
  // non-empty on the first delta of a call only
  tool_call_id: string;
  fidelity?: Fidelity;
}

export interface EmbeddingDeltaItem {
  type: "embedding.delta";
  embedding: number[];
}

export type DeltaContentItem =
  | TextDeltaItem
  | InlineDataDeltaItem
  | ThinkingDeltaItem
  | InlineThinkingDeltaItem
  | ToolCallDeltaItem
  | EmbeddingDeltaItem;

export type EventContentItem = DeltaContentItem | ContentItem;

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
 * Universal event format for streaming responses: a "delta" event carries exactly one delta or
 * done item and no usage or finish reason; the one "stop" event that ends every successful
 * stream carries no items and both.
 */
export interface UniEvent {
  role: Role;
  event_type: EventType;
  content_items: EventContentItem[];
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
  // fast processing at premium pricing: OpenAI-protocol and Gemini clients send
  // service_tier="priority", Anthropic-protocol clients send speed="fast"; clients without a
  // fast tier reject it
  fast_mode?: boolean;
  image_config?: ImageConfig;
  tts_config?: SpeakerConfig[];
  embedding_config?: EmbeddingConfig;
  trace_id?: string;
}
