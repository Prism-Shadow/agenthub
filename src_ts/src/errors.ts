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

import { UsageMetadata } from "./types";

function previewToolCallArguments(raw: string): string {
  const maxLength = 160;
  if (raw.length <= maxLength) {
    return raw;
  }
  const edgeLength = 72;
  return `${raw.slice(0, edgeLength)}...[truncated]...${raw.slice(-edgeLength)}`;
}

export class AgentHubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentHubError";
  }
}

/**
 * Raised when a UniConfig parameter value is not supported by the target model client.
 *
 * Thinking levels never raise this by design: every client maps each ThinkingLevel
 * onto the closest level the model supports. Parameters such as temperature and
 * tool_choice may reject unsupported values with this error.
 */
export class UnsupportedParameterError extends AgentHubError {
  readonly client: string;
  readonly parameter: string;

  constructor(args: { client: string; parameter: string; message: string }) {
    super(args.message);
    this.name = "UnsupportedParameterError";
    this.client = args.client;
    this.parameter = args.parameter;
  }
}

/**
 * Raised when a completed response carries no non-thinking content and no tool calls.
 *
 * Models occasionally finish a turn with thinking output only (reasoning models in
 * particular); replaying such an assistant message on the next turn fails with a 400
 * error, so the response is rejected as soon as the stream completes.
 */
/**
 * Raised when a client cannot perform an operation at all, whatever it is passed.
 *
 * Distinct from UnsupportedParameterError, which rejects a UniConfig parameter value:
 * this one reports a capability the routed client does not have, such as listing models
 * through an SDK client that carries no models endpoint.
 */
export class UnsupportedOperationError extends AgentHubError {
  readonly client: string;
  readonly operation: string;

  constructor(args: { client: string; operation: string; message: string }) {
    super(args.message);
    this.name = "UnsupportedOperationError";
    this.client = args.client;
    this.operation = args.operation;
  }
}

export class EmptyResponseError extends AgentHubError {
  readonly client: string;
  readonly finishReason: string | null;
  // the tokens the rejected response still cost, since no stop event carries them
  readonly usageMetadata: UsageMetadata | null;

  constructor(args: {
    client: string;
    finishReason: string | null;
    usageMetadata?: UsageMetadata | null;
  }) {
    super(
      `${args.client} returned no content other than thinking ` +
        `(finish_reason=${JSON.stringify(args.finishReason)}).`,
    );
    this.name = "EmptyResponseError";
    this.client = args.client;
    this.finishReason = args.finishReason;
    this.usageMetadata = args.usageMetadata ?? null;
  }
}

/**
 * Raised when a client produces a stream that breaks the streaming protocol: a fragment
 * after its item was completed, a second different fidelity within one item, a tool call
 * whose first fragment lacks its name or id, or a fragment of another kind under an item's key.
 *
 * It always reports a bug in the client rather than in the provider's output, so it is
 * raised in every mode instead of being repaired into a stream that breaks the contract.
 */
export class StreamProtocolError extends AgentHubError {
  readonly client: string;

  constructor(args: { client: string; message: string }) {
    super(`${args.client} broke the streaming protocol: ${args.message}`);
    this.name = "StreamProtocolError";
    this.client = args.client;
  }
}

export class ToolCallArgumentParseError extends AgentHubError {
  readonly client: string;
  readonly toolName: string;
  readonly toolCallId: string;
  readonly rawArgumentsLength: number;
  readonly rawArgumentsPreview: string;

  constructor(args: {
    client: string;
    toolName: string;
    toolCallId: string;
    rawArguments: string;
    reason: string;
  }) {
    const preview = previewToolCallArguments(args.rawArguments);
    super(
      `Invalid streamed tool call arguments from ${args.client} for tool "${args.toolName}" ` +
        `(tool_call_id="${args.toolCallId}", length=${args.rawArguments.length}, ` +
        `preview=${JSON.stringify(preview)}): ${args.reason}`,
    );
    this.name = "ToolCallArgumentParseError";
    this.client = args.client;
    this.toolName = args.toolName;
    this.toolCallId = args.toolCallId;
    this.rawArgumentsLength = args.rawArguments.length;
    this.rawArgumentsPreview = preview;
  }
}

export function parseToolCallArguments(
  rawArguments: string | undefined,
  client: string,
  toolName: string,
  toolCallId: string,
): Record<string, unknown> {
  const raw = rawArguments || "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ToolCallArgumentParseError({
      client,
      toolName,
      toolCallId,
      rawArguments: raw,
      reason,
    });
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ToolCallArgumentParseError({
      client,
      toolName,
      toolCallId,
      rawArguments: raw,
      reason: "Expected a JSON object.",
    });
  }

  return parsed as Record<string, unknown>;
}
