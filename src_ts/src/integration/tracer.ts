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
 * Conversation tracer module for saving and viewing conversation history.
 *
 * This module provides functionality to save conversation history to local files
 * and serve them via a web interface for real-time monitoring.
 */

import * as fs from "fs";
import * as path from "path";
import express, { Express, Request, Response } from "express";
import { normalizeLegacyMessages } from "../legacy";
import { UniConfig, UniMessage } from "../types";

/**
 * Tracer for saving conversation history to local files.
 *
 * This class handles saving conversation history to files in a cache directory.
 */
export class Tracer {
  private cacheDir: string;

  /**
   * Initialize the tracer.
   *
   * @param cacheDir - Directory to store conversation history files
   */
  constructor(cacheDir?: string) {
    this.cacheDir = path.resolve(
      cacheDir || process.env.AGENTHUB_CACHE_DIR || "cache",
    );
    this._ensureDirectoryExists(this.cacheDir);
  }

  /**
   * Ensure directory exists, create if it doesn't.
   *
   * @param dirPath - Directory path to create
   */
  private _ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Recursively serialize objects for JSON, converting Buffer to base64.
   *
   * @param obj - Object to serialize
   * @returns JSON-serializable object
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _serializeForJson(obj: any): any {
    if (Buffer.isBuffer(obj)) {
      return obj.toString("base64");
    } else if (obj && typeof obj === "object") {
      if (Array.isArray(obj)) {
        return obj.map((item) => this._serializeForJson(item));
      } else {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = this._serializeForJson(value);
        }
        return result;
      }
    }
    return obj;
  }

  /**
   * Return whether browsers can usually play this MIME type directly.
   *
   * @param mimeType - MIME type to inspect
   * @returns Whether the browser can typically play the audio type
   */
  private _isBrowserPlayableAudioMimeType(mimeType?: string): boolean {
    return new Set([
      "audio/wav",
      "audio/x-wav",
      "audio/mpeg",
      "audio/mp3",
      "audio/ogg",
      "audio/webm",
      "audio/flac",
      "audio/aac",
      "audio/mp4",
    ]).has((mimeType || "").toLowerCase());
  }

  /**
   * Decode an inline_data payload to raw bytes.
   *
   * @param item - inline_data content item
   * @returns Raw payload bytes
   */
  private _decodeInlineData(item: { data?: Buffer | string }): Buffer {
    if (typeof item.data === "string") {
      return Buffer.from(item.data, "base64");
    }
    return item.data || Buffer.alloc(0);
  }

  /**
   * Wrap raw PCM bytes in a WAV header using Gemini TTS defaults.
   *
   * @param item - inline_data content item
   * @returns WAV bytes
   */
  private _buildWaveBytesFromPcm(item: { data?: Buffer | string }): Buffer {
    const pcmBytes = this._decodeInlineData(item);
    const channels = 1;
    const sampleRate = 24000;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * channels * bitsPerSample) / 8;
    const blockAlign = (channels * bitsPerSample) / 8;
    const header = Buffer.alloc(44);

    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(36 + pcmBytes.length, 4);
    header.write("WAVE", 8, "ascii");
    header.write("fmt ", 12, "ascii");
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write("data", 36, "ascii");
    header.writeUInt32LE(pcmBytes.length, 40);

    return Buffer.concat([header, pcmBytes]);
  }

  /**
   * Format inline_data metadata without emitting raw payloads.
   *
   * @param item - inline_data content item
   * @returns Human-readable summary of the inline payload
   */
  private _formatInlineDataSummary(
    item: {
      mime_type?: string;
      data?: Buffer | string;
    },
    isThinking?: boolean,
  ): string {
    const mimeType = item.mime_type || "application/octet-stream";
    const data = item.data;

    let byteCount = 0;
    if (typeof data === "string") {
      byteCount = Buffer.from(data, "base64").length;
    } else if (Buffer.isBuffer(data)) {
      byteCount = data.length;
    }

    const kbCount = byteCount / 1024;
    const mbCount = byteCount / (1024 * 1024);

    let label = isThinking ? "Thinking " : "";
    if (mimeType.startsWith("image/")) {
      label += "Inline Image";
    } else if (mimeType.startsWith("audio/")) {
      label += "Inline Audio";
    } else {
      label += "Inline Data";
    }

    if (kbCount < 1000) {
      return `${label}: ${mimeType} (${kbCount.toFixed(2)} KB)`;
    }
    return `${label}: ${mimeType} (${mbCount.toFixed(2)} MB)`;
  }

  private _formatEmbeddingPreview(item: { embedding?: number[] }): string {
    const preview = (item.embedding || [])
      .slice(0, 5)
      .map((value) => String(value))
      .join(", ");
    return `Embedding: [${preview}]`;
  }

  /**
   * Build a data URL for inline_data content.
   *
   * @param item - inline_data content item
   * @returns Data URL string
   */
  private _inlineDataUrl(item: {
    mime_type?: string;
    data?: Buffer | string;
  }): string {
    const mimeType = item.mime_type || "application/octet-stream";
    let rawBytes = this._decodeInlineData(item);
    let normalizedMimeType = mimeType;

    if (mimeType.startsWith("audio/")) {
      if (!this._isBrowserPlayableAudioMimeType(mimeType)) {
        normalizedMimeType = "audio/wav";
        rawBytes = this._buildWaveBytesFromPcm(item);
      }
      return `data:${normalizedMimeType};base64,${rawBytes.toString("base64")}`;
    }

    return `data:${normalizedMimeType};base64,${rawBytes.toString("base64")}`;
  }

  /**
   * Return whether inline_data should be rendered as audio.
   *
   * @param item - inline_data content item
   * @returns Whether the payload is audio
   */
  private _inlineDataIsAudio(item: { mime_type?: string }): boolean {
    return (item.mime_type || "").toLowerCase().startsWith("audio/");
  }

  /**
   * Return the browser-facing audio MIME type after any WAV fallback.
   *
   * @param item - inline_data content item
   * @returns Playable audio MIME type
   */
  private _inlineDataAudioType(item: { mime_type?: string }): string {
    const mimeType = item.mime_type || "application/octet-stream";
    if (this._isBrowserPlayableAudioMimeType(mimeType)) {
      return mimeType;
    }
    return "audio/wav";
  }

  /**
   * Save conversation history to files.
   *
   * @param history - List of UniMessage objects representing the conversation
   * @param fileId - File identifier without extension (e.g., "agent1/00001")
   * @param config - The UniConfig used for this conversation
   */
  saveHistory(
    model: string,
    history: UniMessage[],
    fileId: string,
    config: UniConfig,
  ): void {
    const filePathBase = path.join(this.cacheDir, fileId);
    const dirPath = path.dirname(filePathBase);
    this._ensureDirectoryExists(dirPath);

    const configWithModel: UniConfig & { model: string } = {
      ...(config as UniConfig),
      model,
    };

    const jsonPath = filePathBase + ".json";
    const jsonData = {
      history: this._serializeForJson(history),
      config: this._serializeForJson(configWithModel),
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), "utf-8");

    const txtPath = filePathBase + ".txt";
    const formattedContent = this._formatHistory(history, configWithModel);
    fs.writeFileSync(txtPath, formattedContent, "utf-8");
  }

  /**
   * Format conversation history in a readable text format.
   *
   * @param history - List of UniMessage objects
   * @param config - The UniConfig used for this conversation
   * @returns Formatted string representation of the conversation
   */
  private _formatHistory(history: UniMessage[], config: UniConfig): string {
    const lines: string[] = [];
    lines.push("=".repeat(80));
    lines.push(`Conversation History - ${new Date().toLocaleString()}`);
    lines.push("=".repeat(80));
    lines.push("");

    lines.push("Configuration:");
    for (const [key, value] of Object.entries(config)) {
      if (key !== "trace_id") {
        if (key === "tools" && Array.isArray(value)) {
          lines.push(`  ${key}:`);
          lines.push(`    ${JSON.stringify(value, null, 2)}`);
        } else {
          lines.push(`  ${key}: ${value}`);
        }
      }
    }
    lines.push("");

    for (let i = 0; i < history.length; i++) {
      const message = history[i];
      const role = message.role.toUpperCase();
      lines.push(`[${i + 1}] ${role}:`);
      lines.push("-".repeat(80));

      for (const item of message.content_items) {
        if (item.type === "text.done") {
          lines.push(`Text: ${item.text}`);
        } else if (item.type === "thinking.done") {
          lines.push(`Thinking: ${item.thinking}`);
        } else if (item.type === "inline_thinking.done") {
          lines.push(this._formatInlineDataSummary(item, true));
        } else if (item.type === "image_url.done") {
          lines.push(`Image URL: ${item.image_url}`);
        } else if (item.type === "inline_data.done") {
          lines.push(this._formatInlineDataSummary(item));
        } else if (item.type === "embedding.done") {
          lines.push(this._formatEmbeddingPreview(item));
        } else if (item.type === "tool_call.done") {
          lines.push(`Tool Call: ${item.name}`);
          lines.push(`  Arguments: ${JSON.stringify(item.arguments, null, 2)}`);
          lines.push(`  Tool Call ID: ${item.tool_call_id}`);
        } else if (item.type === "tool_result.done") {
          lines.push(`Tool Result (ID: ${item.tool_call_id}): ${item.text}`);
          if (item.images && item.images.length > 0) {
            item.images.forEach((imageUrl, i) => {
              lines.push(`  Image ${i + 1}: ${imageUrl}`);
            });
          }
        }
      }

      if (message.usage_metadata) {
        const metadata = message.usage_metadata;
        lines.push("\nUsage Metadata:");
        if (metadata.cached_tokens !== null) {
          lines.push(`  Cached Tokens: ${metadata.cached_tokens}`);
        }
        if (metadata.prompt_tokens !== null) {
          lines.push(`  Prompt Tokens: ${metadata.prompt_tokens}`);
        }
        if (metadata.thoughts_tokens !== null) {
          lines.push(`  Thoughts Tokens: ${metadata.thoughts_tokens}`);
        }
        if (metadata.response_tokens !== null) {
          lines.push(`  Response Tokens: ${metadata.response_tokens}`);
        }

        const inputTokens =
          (metadata.cached_tokens || 0) + (metadata.prompt_tokens || 0);
        const outputTokens =
          (metadata.thoughts_tokens || 0) + (metadata.response_tokens || 0);
        const totalTokens = inputTokens + outputTokens;
        lines.push(`  Total Tokens: ${totalTokens}`);
      }

      if (message.finish_reason) {
        lines.push(`\nFinish Reason: ${message.finish_reason}`);
      }

      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Create an Express web application for browsing conversation files.
   *
   * @returns Express application instance
   */
  createWebApp(options: { basePath?: string } = {}): Express {
    const app = express();
    const basePath = this._normalizeBasePath(options.basePath);

    const DIRECTORY_TEMPLATE = (
      breadcrumb: string,
      itemsHtml: string,
      currentSort: string,
      sortNameUrl: string,
      sortMtimeUrl: string,
    ) => `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Tracer</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-50 min-h-screen">
        <div class="max-w-5xl mx-auto p-6">
            <div class="flex justify-between items-center mb-6">
                <h1 class="text-3xl font-bold text-gray-900">Tracer</h1>
                <a href="https://github.com/Prism-Shadow/AgentHub" target="_blank" class="text-sm text-gray-500 hover:text-gray-700 transition-colors">GitHub</a>
            </div>
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
                <p class="text-sm text-gray-600"><strong>Path:</strong> ${breadcrumb}</p>
            </div>
            <div class="flex items-center gap-2 mb-3">
                <span class="text-xs text-gray-500">Sort by:</span>
                <a href="${sortNameUrl}" class="px-3 py-1 text-xs rounded border transition-colors ${currentSort === "name" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}">Name</a>
                <a href="${sortMtimeUrl}" class="px-3 py-1 text-xs rounded border transition-colors ${currentSort === "mtime" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}">Modified Time</a>
            </div>
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                ${itemsHtml}
            </div>
        </div>
    </body>
    </html>
    `;

    const JSON_VIEWER_TEMPLATE = (
      filename: string,
      breadcrumb: string,
      backUrl: string,
      configHtml: string,
      historyHtml: string,
      numMessages: number,
      sidebarHtml: string,
    ) => `
    <!DOCTYPE html>
    <html>
    <head>
        <title>${filename}</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-50 min-h-screen">
        <div class="flex gap-6 p-6 max-w-7xl mx-auto">
            <div class="flex-1 min-w-0">
                <div class="flex justify-between items-center mb-4">
                    <h1 class="text-3xl font-bold text-gray-900">${filename}</h1>
                    <a href="https://github.com/Prism-Shadow/AgentHub" target="_blank" class="text-sm text-gray-500 hover:text-gray-700 transition-colors">GitHub</a>
                </div>
                <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
                    <p class="text-sm text-gray-600"><strong>Path:</strong> ${breadcrumb}</p>
                </div>
                <a href="${backUrl}" class="inline-block mb-6 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-md border border-gray-300 text-sm transition-colors">
                    ← Back to Directory
                </a>
                ${configHtml}
                ${historyHtml}
            </div>
            <div class="w-52 flex-shrink-0">
                <div class="sticky top-6 bg-white rounded-lg shadow-sm border border-gray-200 p-4 max-h-[calc(100vh-3rem)] overflow-y-auto">
                    ${sidebarHtml}
                </div>
            </div>
        </div>
        <script>
            function toggleConfig(key) {
                const content = document.getElementById('content-' + key);
                const icon = document.getElementById('icon-' + key);
                content.classList.toggle('hidden');
                icon.classList.toggle('rotate-90');
            }
            function toggleMessage(idx) {
                const content = document.getElementById('content-' + idx);
                const icon = document.getElementById('icon-' + idx);
                content.classList.toggle('hidden');
                icon.classList.toggle('rotate-90');
            }
            // Expand all messages by default
            const numMessages = ${numMessages};
            for (let i = 0; i < numMessages; i++) {
                toggleMessage(i);
            }
        </script>
    </body>
    </html>
    `;

    const TEXT_VIEWER_TEMPLATE = (
      filename: string,
      breadcrumb: string,
      backUrl: string,
      content: string,
    ) => `
    <!DOCTYPE html>
    <html>
    <head>
        <title>${filename}</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-50 min-h-screen">
        <div class="max-w-5xl mx-auto p-6">
            <div class="flex justify-between items-center mb-4">
                <h1 class="text-3xl font-bold text-gray-900">${filename}</h1>
                <a href="https://github.com/Prism-Shadow/AgentHub" target="_blank" class="text-sm text-gray-500 hover:text-gray-700 transition-colors">GitHub</a>
            </div>
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
                <p class="text-sm text-gray-600"><strong>Path:</strong> ${breadcrumb}</p>
            </div>
            <a href="${backUrl}" class="inline-block mb-6 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-md border border-gray-300 text-sm transition-colors">
                ← Back to Directory
            </a>
            <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6 overflow-x-auto">
                <div class="font-mono text-sm text-gray-800 whitespace-pre-wrap">${content}</div>
            </div>
        </div>
    </body>
    </html>
    `;

    app.get("*", (req: Request, res: Response) => {
      const subpath = req.path.slice(1);
      const fullPath = path.resolve(path.join(this.cacheDir, subpath));

      if (!fullPath.startsWith(path.resolve(this.cacheDir))) {
        return res.status(403).send("Access denied");
      }

      if (!fs.existsSync(fullPath)) {
        return res.status(404).send("Path not found");
      }

      if (fs.statSync(fullPath).isFile()) {
        try {
          const parts = subpath ? subpath.split("/") : [];
          const breadcrumbParts = [
            `<a href="${this._prefixUrl(basePath, "/")}" class="text-blue-600 hover:underline">cache</a>`,
          ];

          for (let i = 0; i < parts.length - 1; i++) {
            const pathToPart = parts.slice(0, i + 1).join("/");
            breadcrumbParts.push(
              `<a href="${this._prefixUrl(basePath, "/" + pathToPart)}" class="text-blue-600 hover:underline">${parts[i]}</a>`,
            );
          }

          if (parts.length > 0) {
            breadcrumbParts.push(`<strong>${parts[parts.length - 1]}</strong>`);
          }

          const breadcrumb = breadcrumbParts.join(" / ");
          const backUrl = this._prefixUrl(
            basePath,
            parts.length > 1 ? "/" + parts.slice(0, -1).join("/") : "/",
          );

          if (fullPath.endsWith(".json")) {
            const data = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
            const configItems = Object.entries(data.config || {})
              .filter(([key]) => key !== "trace_id")
              .map(([key, value]) => {
                if (key === "system_prompt" && value != null) {
                  return {
                    key,
                    value: value,
                    isSystemPrompt: true,
                  };
                } else if (key === "tools" && Array.isArray(value)) {
                  return {
                    key,
                    value: JSON.stringify(value, null, 2),
                    isTools: true,
                  };
                } else {
                  return {
                    key,
                    value:
                      typeof value === "object"
                        ? JSON.stringify(value, null, 2)
                        : String(value),
                  };
                }
              });

            const configHtml =
              configItems.length > 0
                ? `<div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
                  <h2 class="text-xl font-semibold text-gray-900 mb-4">Configuration</h2>
                  ${configItems
                    .map((item) => {
                      if (item.isSystemPrompt || item.isTools) {
                        return `<div class="py-2 text-sm"><strong class="text-gray-900">${this._escapeHtml(item.key)}:</strong><button onclick="toggleConfig('${this._escapeHtml(item.key)}')" class="ml-2 inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded border border-gray-300 transition-colors"><span id="icon-${this._escapeHtml(item.key)}" class="transform transition-transform">▶</span> Show</button><div id="content-${this._escapeHtml(item.key)}" class="mt-1 p-2 bg-gray-50 rounded text-xs whitespace-pre-wrap hidden">${this._escapeHtml(String(item.value))}</div></div>`;
                      } else {
                        return `<div class="py-2 text-sm"><strong class="text-gray-900">${item.key}:</strong><span class="text-gray-600">${this._escapeHtml(String(item.value))}</span></div>`;
                      }
                    })
                    .join("")}
                </div>`
                : "";

            // trace files written before 0.5.0 carry the legacy content item types
            const history = normalizeLegacyMessages(data.history || []);
            const totalRounds = Math.ceil(history.length / 2);

            const historyHtml = history
              .map((msg: UniMessage, idx: number) => {
                const contentItemsHtml = msg.content_items
                  .map((item) => {
                    let itemHtml = `<div class="mb-4 pb-4 border-b border-gray-100 last:border-b-0 last:mb-0 last:pb-0"><div class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">${item.type}</div>`;
                    if (item.type === "text.done") {
                      itemHtml += `<div class="bg-gray-50 p-4 rounded-md font-mono text-sm whitespace-pre-wrap text-gray-800">${this._escapeHtml(item.text)}</div>`;
                    } else if (item.type === "thinking.done") {
                      itemHtml += `<div class="bg-blue-50 p-4 rounded-md border-l-4 border-blue-500 font-mono text-sm whitespace-pre-wrap text-gray-800">${this._escapeHtml(item.thinking)}</div>`;
                    } else if (item.type === "inline_thinking.done") {
                      const summary = this._formatInlineDataSummary(item, true);
                      itemHtml += `<div class="bg-blue-50 border-blue-500 p-4 rounded-md border-l-4"><div class="text-xs text-blue-700 mb-2">${this._escapeHtml(summary)}</div>`;
                      if (item.mime_type?.startsWith("image/")) {
                        itemHtml += `<img src="${this._escapeHtml(this._inlineDataUrl(item))}" class="max-w-xs max-h-48 rounded-md" alt="Thinking Inline Image">`;
                      } else {
                        itemHtml += `<div class="font-mono text-sm whitespace-pre-wrap text-gray-800">${this._escapeHtml(summary)}</div>`;
                      }
                      itemHtml += `</div>`;
                    } else if (item.type === "tool_call.done") {
                      const entries = Object.entries(item.arguments);
                      let args = "";
                      for (let i = 0; i < entries.length; i++) {
                        const [key, value] = entries[i];
                        args += `${key}="${this._escapeHtml(String(value))}"`;
                        if (i !== entries.length - 1) {
                          args += ", ";
                        }
                      }
                      itemHtml += `<div class="bg-yellow-50 p-4 rounded-md border-l-4 border-yellow-500"><div class="font-mono text-sm whitespace-pre-wrap text-gray-800">${this._escapeHtml(item.name)}(${args})</div></div>`;
                    } else if (item.type === "tool_result.done") {
                      let resultHtml = `<div class="bg-green-50 p-4 rounded-md border-l-4 border-green-500"><strong class="text-sm text-gray-900">Result:</strong> <span class="text-sm text-gray-700">${this._escapeHtml(item.text)}</span><br><strong class="text-sm text-gray-900">Call ID:</strong> <span class="text-sm text-gray-700">${item.tool_call_id}</span>`;
                      if (item.images && item.images.length > 0) {
                        resultHtml += `<div class="mt-2 flex flex-wrap gap-2">`;
                        for (const imageUrl of item.images) {
                          resultHtml += `<img src="${this._escapeHtml(imageUrl)}" class="max-w-xs max-h-48 rounded-md" alt="Tool Result Image">`;
                        }
                        resultHtml += `</div>`;
                      }
                      resultHtml += `</div>`;
                      itemHtml += resultHtml;
                    } else if (item.type === "image_url.done") {
                      itemHtml += `<div class="bg-gray-50 p-4 rounded-md"><img src="${this._escapeHtml(item.image_url)}" class="max-w-xs max-h-48 rounded-md" alt="Preview"></div>`;
                    } else if (item.type === "inline_data.done") {
                      const summary = this._formatInlineDataSummary(item);
                      itemHtml += `<div class="bg-purple-50 border-purple-500 p-4 rounded-md border-l-4"><div class="text-xs text-purple-700 mb-2">${this._escapeHtml(summary)}</div>`;
                      if (item.mime_type?.startsWith("image/")) {
                        itemHtml += `<img src="${this._escapeHtml(this._inlineDataUrl(item))}" class="max-w-xs max-h-48 rounded-md" alt="Inline Image">`;
                      } else if (this._inlineDataIsAudio(item)) {
                        itemHtml += `<audio controls preload="metadata" class="max-w-xs"><source src="${this._escapeHtml(this._inlineDataUrl(item))}" type="${this._escapeHtml(this._inlineDataAudioType(item))}"></audio>`;
                      } else {
                        itemHtml += `<div class="font-mono text-sm whitespace-pre-wrap text-gray-800">${this._escapeHtml(summary)}</div>`;
                      }
                      itemHtml += `</div>`;
                    } else if (item.type === "embedding.done") {
                      itemHtml += `<div class="bg-indigo-50 p-4 rounded-md border-l-4 border-indigo-500"><div class="font-mono text-sm whitespace-pre-wrap text-gray-800">${this._escapeHtml(this._formatEmbeddingPreview(item))}</div></div>`;
                    }
                    itemHtml += "</div>";
                    return itemHtml;
                  })
                  .join("");

                let metadataHtml = "";
                if (msg.usage_metadata || msg.finish_reason) {
                  metadataHtml +=
                    '<div class="mt-4 pt-4 border-t border-gray-200 text-right text-xs text-gray-500">';
                  if (msg.usage_metadata) {
                    const parts = [];
                    if (msg.usage_metadata.cached_tokens)
                      parts.push(
                        `Cached: ${msg.usage_metadata.cached_tokens} tokens`,
                      );
                    if (msg.usage_metadata.prompt_tokens)
                      parts.push(
                        `Prompt: ${msg.usage_metadata.prompt_tokens} tokens`,
                      );
                    if (msg.usage_metadata.thoughts_tokens)
                      parts.push(
                        `Thoughts: ${msg.usage_metadata.thoughts_tokens} tokens`,
                      );
                    if (msg.usage_metadata.response_tokens)
                      parts.push(
                        `Response: ${msg.usage_metadata.response_tokens} tokens`,
                      );

                    // Calculate and show total tokens
                    const inputTokens =
                      (msg.usage_metadata.cached_tokens || 0) +
                      (msg.usage_metadata.prompt_tokens || 0);
                    const outputTokens =
                      (msg.usage_metadata.thoughts_tokens || 0) +
                      (msg.usage_metadata.response_tokens || 0);
                    const totalTokens = inputTokens + outputTokens;
                    parts.push(`Total: ${totalTokens} tokens`);
                    metadataHtml += parts.join(" • ");
                  }
                  if (msg.finish_reason) {
                    if (msg.usage_metadata) metadataHtml += " • ";
                    metadataHtml += `Finish: ${msg.finish_reason}`;
                  }
                  metadataHtml += "</div>";
                }

                const roleClass =
                  msg.role === "user" ? "text-blue-600" : "text-green-600";
                const roundNum = Math.floor(idx / 2) + 1;
                const timestampHtml = msg.created_at
                  ? `<span class="text-xs text-gray-400">${this._formatTimestamp(msg.created_at)}</span>`
                  : "";
                const prevMsg = idx > 0 ? history[idx - 1] : null;
                const tookHtml =
                  prevMsg && msg.created_at && prevMsg.created_at
                    ? `<span class="text-xs text-gray-400">Took ${Math.abs(msg.created_at - prevMsg.created_at)} ms</span>`
                    : "";
                return `
                  <div class="bg-white rounded-lg shadow-sm border border-gray-200 mb-4 overflow-hidden" id="msg-${idx}">
                    <div class="bg-gray-50 border-b border-gray-200 p-4 cursor-pointer hover:bg-gray-100 transition-colors" onclick="toggleMessage(${idx})">
                      <div class="flex justify-between items-center">
                        <div class="flex items-center gap-3">
                          <span class="font-semibold text-sm uppercase ${roleClass}">${msg.role}</span>
                          <span class="text-xs text-gray-500">• ${msg.content_items.length} item(s)</span>
                          <span class="text-xs text-gray-400">• Round ${roundNum} / ${totalRounds}</span>
                        </div>
                        <div class="flex items-center gap-3">
                          ${tookHtml}
                          ${timestampHtml}
                          <span class="text-gray-400 transform transition-transform" id="icon-${idx}">▶</span>
                        </div>
                      </div>
                    </div>
                    <div class="p-6 hidden" id="content-${idx}">
                      ${contentItemsHtml}
                      ${metadataHtml}
                    </div>
                  </div>
                `;
              })
              .join("");

            const sidebarHtml = this._buildSidebarHtml(totalRounds, history);

            const html = JSON_VIEWER_TEMPLATE(
              path.basename(fullPath),
              breadcrumb,
              backUrl,
              configHtml,
              historyHtml,
              history.length,
              sidebarHtml,
            );

            return res.send(html);
          } else {
            const content = fs.readFileSync(fullPath, "utf-8");
            const html = TEXT_VIEWER_TEMPLATE(
              path.basename(fullPath),
              breadcrumb,
              backUrl,
              this._escapeHtml(content),
            );

            return res.send(html);
          }
        } catch (error) {
          return res.status(500).send(`Error reading file: ${error}`);
        }
      }

      try {
        const sortBy = req.query["sort"] === "mtime" ? "mtime" : "name";

        const entries = fs
          .readdirSync(fullPath, { withFileTypes: true })
          .filter((entry) => entry.name !== ".DS_Store");
        const entryStats = new Map<string, fs.Stats>();
        for (const entry of entries) {
          entryStats.set(
            entry.name,
            fs.statSync(path.join(fullPath, entry.name)),
          );
        }
        entries.sort((a: fs.Dirent, b: fs.Dirent) => {
          const aIsDir = a.isDirectory();
          const bIsDir = b.isDirectory();
          if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
          if (sortBy === "mtime") {
            const aMtime = entryStats.get(a.name)!.mtimeMs;
            const bMtime = entryStats.get(b.name)!.mtimeMs;
            return bMtime - aMtime;
          }
          return a.name.localeCompare(b.name);
        });

        const items = entries.map((entry: fs.Dirent) => {
          const entryPath = path.join(fullPath, entry.name);
          const relativePath = path.relative(this.cacheDir, entryPath);
          const stat = entryStats.get(entry.name)!;
          const isDir = stat.isDirectory();
          let size = "";
          if (!isDir) {
            if (stat.size < 1024) {
              size = `${stat.size} B`;
            } else if (stat.size < 1024 * 1024) {
              size = `${(stat.size / 1024).toFixed(1)} KB`;
            } else {
              size = `${(stat.size / (1024 * 1024)).toFixed(1)} MB`;
            }
          }
          const mtime = this._formatTimestamp(stat.mtimeMs);
          return {
            name: entry.name,
            is_dir: isDir,
            url: this._prefixUrl(
              basePath,
              "/" + relativePath.replace(/\\/g, "/"),
            ),
            size,
            mtime,
          };
        });

        const parts = subpath ? subpath.split("/") : [];
        const breadcrumbParts = [
          `<a href="${this._prefixUrl(basePath, "/")}" class="text-blue-600 hover:underline">cache</a>`,
        ];

        for (let i = 0; i < parts.length; i++) {
          if (parts[i]) {
            const pathToPart = parts.slice(0, i + 1).join("/");
            breadcrumbParts.push(
              `<a href="${this._prefixUrl(basePath, "/" + pathToPart)}" class="text-blue-600 hover:underline">${parts[i]}</a>`,
            );
          }
        }

        const breadcrumb = breadcrumbParts.join(" / ");

        const baseUrl = subpath ? "/" + subpath : "/";
        const sortNameUrl = this._prefixUrl(basePath, baseUrl + "?sort=name");
        const sortMtimeUrl = this._prefixUrl(basePath, baseUrl + "?sort=mtime");

        const itemsHtml = items.length
          ? items
              .map(
                (item: {
                  is_dir: boolean;
                  url: string;
                  name: string;
                  size: string;
                  mtime: string;
                }) => {
                  const icon = item.is_dir ? "📁" : "📄";
                  const sizeHtml = item.size
                    ? `<span class="text-xs text-gray-500">${item.size}</span>`
                    : "";
                  const mtimeHtml = item.mtime
                    ? `<span class="text-xs text-gray-400">${item.mtime}</span>`
                    : "";
                  return `
                  <div class="border-b border-gray-200 last:border-b-0 hover:bg-gray-50 transition-colors">
                    <a href="${item.url}" class="flex items-center justify-between p-4 text-blue-600 hover:text-blue-800">
                      <span class="flex items-center">
                        <span class="mr-2">${icon}</span>
                        <span class="text-sm">${item.name}</span>
                      </span>
                      <span class="flex items-center gap-4">
                        ${sizeHtml}
                        ${mtimeHtml}
                      </span>
                    </a>
                  </div>
                `;
                },
              )
              .join("")
          : '<div class="p-8 text-center text-gray-500 italic">No files or directories found.</div>';

        const html = DIRECTORY_TEMPLATE(
          breadcrumb,
          itemsHtml,
          sortBy,
          sortNameUrl,
          sortMtimeUrl,
        );

        return res.send(html);
      } catch (error) {
        return res.status(500).send(`Error listing directory: ${error}`);
      }
    });

    return app;
  }

  /**
   * Normalize the base path used when tracer is mounted inside another app.
   *
   * @param basePath - Optional URL prefix for tracer routes
   * @returns Normalized URL prefix without a trailing slash
   */
  private _normalizeBasePath(basePath: string = ""): string {
    if (!basePath || basePath === "/") {
      return "";
    }
    const prefixed = basePath.startsWith("/") ? basePath : "/" + basePath;
    return prefixed.endsWith("/") ? prefixed.slice(0, -1) : prefixed;
  }

  /**
   * Prefix an internal tracer URL with the mount path.
   *
   * @param basePath - Normalized tracer mount path
   * @param url - Internal URL beginning with /
   * @returns URL safe to render into tracer links
   */
  private _prefixUrl(basePath: string, url: string): string {
    if (!basePath) {
      return url;
    }
    if (url === "/") {
      return basePath + "/";
    }
    return basePath + url;
  }

  /**
   * Format a Unix timestamp in milliseconds as YYYY-MM-DD HH:MM:SS.
   *
   * @param ms - Unix timestamp in milliseconds
   * @returns Formatted date string
   */
  private _formatTimestamp(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  /**
   * Build the round navigation sidebar HTML.
   *
   * @param totalRounds - Total number of rounds
   * @param history - Full message history array
   * @returns HTML string for the sidebar
   */
  private _buildSidebarHtml(
    totalRounds: number,
    history: UniMessage[],
  ): string {
    let html = `<h3 class="font-semibold text-sm text-gray-900 mb-3">Rounds (${totalRounds})</h3>`;

    for (let roundIdx = 0; roundIdx < totalRounds; roundIdx++) {
      const userIdx = roundIdx * 2;
      const assistantIdx = roundIdx * 2 + 1;

      let tookHtml = "";
      if (roundIdx > 0) {
        const currAssistant = history[assistantIdx];
        const prevAssistant = history[(roundIdx - 1) * 2 + 1];
        if (currAssistant?.created_at && prevAssistant?.created_at) {
          const diffMs = Math.abs(
            currAssistant.created_at - prevAssistant.created_at,
          );
          tookHtml = `<span class="text-xs text-gray-400">(${diffMs} ms)</span>`;
        }
      }

      html += `<div class="mb-2 flex items-center gap-1">
  <a href="#msg-${userIdx}" class="text-xs font-medium text-gray-700 hover:text-blue-600">Round ${roundIdx + 1}</a>
  ${tookHtml}
</div>`;
    }

    return html;
  }

  /**
   * Escape HTML special characters.
   *
   * @param text - Text to escape
   * @returns Escaped text
   */
  private _escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * Start the web server for browsing conversation files.
   *
   * @param host - Host address to bind to
   * @param port - Port number to listen on
   */
  startWebServer(host: string = "127.0.0.1", port: number = 25750): void {
    const app = this.createWebApp();
    app.listen(port, host, () => {
      console.log(`Starting tracer web server at http://${host}:${port}`);
      console.log(`Cache directory: ${path.resolve(this.cacheDir)}`);
    });
  }
}
