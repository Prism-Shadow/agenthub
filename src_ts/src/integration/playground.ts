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
 * Playground for interacting with LLMs.
 *
 * This module provides a web interface for chatting with language models,
 * with support for config editing, streaming responses, and message cards
 * showing token usage and stop reasons.
 */

import express, { Express, NextFunction, Request, Response } from "express";
import { AutoLLMClient } from "../autoClient";
import { UniMessage, UniConfig } from "../types";
import { Tracer } from "./tracer";

const sessionClients: Map<string, AutoLLMClient> = new Map();
const sessionClientOptions: Map<string, PlaygroundClientOptions> = new Map();
const sessionAbortControllers: Map<string, AbortController> = new Map();

interface PlaygroundConfig extends UniConfig {
  model?: string;
  api_key?: string;
  base_url?: string;
  client_type?: string;
  default_headers?: Record<string, string>;
}

interface PlaygroundClientOptions {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  clientType?: string;
  defaultHeaders?: Record<string, string>;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getClientOptions(config: PlaygroundConfig): PlaygroundClientOptions {
  return {
    model: normalizeOptionalString(config.model) || "gpt-5.6-luna",
    apiKey: normalizeOptionalString(config.api_key),
    baseUrl: normalizeOptionalString(config.base_url),
    clientType: normalizeOptionalString(config.client_type),
    defaultHeaders: config.default_headers,
  };
}

function getRequestConfig(config: PlaygroundConfig): UniConfig {
  const requestConfig = { ...config };
  delete requestConfig.model;
  delete requestConfig.api_key;
  delete requestConfig.base_url;
  delete requestConfig.client_type;
  delete requestConfig.default_headers;
  return requestConfig;
}

function clientOptionsChanged(
  previous: PlaygroundClientOptions | undefined,
  next: PlaygroundClientOptions,
): boolean {
  return (
    !previous ||
    previous.model !== next.model ||
    previous.apiKey !== next.apiKey ||
    previous.baseUrl !== next.baseUrl ||
    previous.clientType !== next.clientType ||
    JSON.stringify(previous.defaultHeaders) !== JSON.stringify(next.defaultHeaders)
  );
}

/**
 * Serialize objects for JSON, converting Buffer to base64.
 *
 * @param obj - Object to serialize
 * @returns JSON-serializable object
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeForJson(obj: any): any {
  if (Buffer.isBuffer(obj)) {
    return obj.toString("base64");
  } else if (obj && typeof obj === "object") {
    if (Array.isArray(obj)) {
      return obj.map((item) => serializeForJson(item));
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = serializeForJson(value);
      }
      return result;
    }
  }
  return obj;
}

/**
 * Create an Express web application for chatting with LLMs.
 *
 * @returns Express application instance
 */
export function createChatApp(): Express {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(
    (
      err: { message?: string; status?: number; type?: string },
      _req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      if (err.status === 413 || err.type === "entity.too.large") {
        return res.status(413).json({
          error:
            "Request body is too large. Please upload fewer or smaller images.",
        });
      }
      next(err);
    },
  );
  app.use("/tracer", new Tracer().createWebApp({ basePath: "/tracer" }));

  const CHAT_TEMPLATE = `
  <!DOCTYPE html>
  <html>
  <head>
      <title>AgentHub Playground</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
          [data-combobox-menu] [data-combobox-option] {
              font-size: 0.875rem;
              line-height: 1.25rem;
          }

          [data-combobox-menu] [data-combobox-option] span {
              font-size: inherit;
              line-height: inherit;
          }

          [data-combobox-menu] [data-combobox-option]::after {
              content: attr(data-description);
              display: block;
              margin-top: 0.125rem;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              font-size: 0.75rem;
              line-height: 1rem;
              color: rgb(107 114 128);
          }
      </style>
  </head>
  <body class="bg-gray-50 flex flex-col h-screen">
      <div class="bg-gray-900 text-white px-6 py-4 border-b border-gray-700 flex justify-between items-center">
          <h1 class="text-xl font-semibold">AgentHub</h1>
          <div class="flex items-center gap-4">
              <a href="https://github.com/Prism-Shadow/AgentHub" target="_blank" rel="noopener noreferrer" class="text-gray-400 hover:text-white text-sm transition-colors">GitHub</a>
              <a href="/tracer/" target="_blank" rel="noopener noreferrer" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm transition-colors">Open Tracer</a>
              <button class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md text-sm transition-colors" onclick="toggleConfig()">
                  ⚙️ Config
              </button>
          </div>
      </div>

      <div class="bg-white border-b border-gray-200 px-6 py-4" id="configPanel">
          <div class="flex items-center gap-3 mb-2">
              <span class="text-xs font-semibold uppercase tracking-wider text-gray-500">Connection</span>
              <span class="h-px flex-1 bg-gray-200"></span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-4 gap-y-3 mb-4">
              <div class="flex flex-col">
                  <div class="flex items-center justify-between mb-1">
                      <label class="text-sm font-semibold text-gray-900" for="modelComboboxButton">Model</label>
                      <div class="flex items-center gap-2">
                          <span id="listModelsStatus" class="text-xs text-gray-500"></span>
                          <button type="button" id="listModelsButton" class="text-xs font-medium text-blue-600 transition hover:text-blue-700 focus:outline-none focus:underline disabled:opacity-50" onclick="listModels()">List models</button>
                      </div>
                  </div>
                  <div id="modelCombobox" class="relative" data-combobox>
                      <input id="modelSelect" type="hidden" value="gpt-5.6-luna" data-combobox-value>
                      <button
                          id="modelComboboxButton"
                          type="button"
                          role="combobox"
                          aria-controls="modelComboboxMenu"
                          aria-expanded="false"
                          class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-left shadow-sm transition hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          onclick="toggleCombobox('modelCombobox')"
                          onkeydown="handleComboboxKeydown(event, 'modelCombobox')"
                          data-combobox-button
                      >
                          <span class="flex items-center justify-between gap-3">
                              <span class="min-w-0">
                                  <span class="block truncate text-sm font-medium text-gray-900" data-combobox-label>GPT 5.6 Luna</span>
                              </span>
                              <svg class="h-4 w-4 flex-none text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                  <path d="m6 9 6 6 6-6"></path>
                              </svg>
                          </span>
                      </button>
                      <div id="modelComboboxMenu" class="hidden absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg" role="listbox" aria-labelledby="modelComboboxButton" data-combobox-menu>
                          <button type="button" role="option" aria-selected="true" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none bg-blue-50" data-combobox-option data-value="gpt-5.6-luna" data-label="GPT 5.6 Luna" data-description="gpt-5.6-luna" onclick="selectComboboxOption('modelCombobox', this)">
                              <span class="block truncate text-sm font-medium text-gray-900">GPT 5.6 Luna</span>
                          </button>
                          <button type="button" role="option" aria-selected="false" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" data-combobox-option data-value="text-embedding-3-large" data-client-type="openai-embedding" data-label="Text Embedding 3 Large" data-description="text-embedding-3-large" onclick="selectComboboxOption('modelCombobox', this)">
                              <span class="block truncate text-sm font-medium text-gray-900">Text Embedding 3 Large</span>
                          </button>
                          <button type="button" role="option" aria-selected="false" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" data-combobox-option data-value="gemini-3.7-flash" data-label="Gemini 3.7 Flash" data-description="gemini-3.7-flash" onclick="selectComboboxOption('modelCombobox', this)">
                              <span class="block truncate text-sm font-medium text-gray-900">Gemini 3.7 Flash</span>
                          </button>
                          <button type="button" role="option" aria-selected="false" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" data-combobox-option data-value="gemini-3.1-flash-image" data-label="Gemini 3.1 Flash Image" data-description="gemini-3.1-flash-image" onclick="selectComboboxOption('modelCombobox', this)">
                              <span class="block truncate text-sm font-medium text-gray-900">Gemini 3.1 Flash Image</span>
                          </button>
                          <button type="button" role="option" aria-selected="false" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" data-combobox-option data-value="gemini-3.1-flash-tts-preview" data-label="Gemini 3.1 Flash TTS" data-description="gemini-3.1-flash-tts-preview" onclick="selectComboboxOption('modelCombobox', this)">
                              <span class="block truncate text-sm font-medium text-gray-900">Gemini 3.1 Flash TTS</span>
                          </button>
                          <button type="button" role="option" aria-selected="false" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" data-combobox-option data-value="gemini-embedding-2" data-label="Gemini Embedding 2" data-description="gemini-embedding-2" onclick="selectComboboxOption('modelCombobox', this)">
                              <span class="block truncate text-sm font-medium text-gray-900">Gemini Embedding 2</span>
                          </button>
                          <button type="button" role="option" aria-selected="false" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" data-combobox-option data-value="claude-sonnet-5" data-label="Claude Sonnet 5" data-description="claude-sonnet-5" onclick="selectComboboxOption('modelCombobox', this)">
                              <span class="block truncate text-sm font-medium text-gray-900">Claude Sonnet 5</span>
                          </button>
                          <button type="button" role="option" aria-selected="false" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" data-combobox-option data-value="glm-5.3-flash" data-label="GLM 5.3 Flash" data-description="glm-5.3-flash" onclick="selectComboboxOption('modelCombobox', this)">
                              <span class="block truncate text-sm font-medium text-gray-900">GLM 5.3 Flash</span>
                          </button>
                          <button type="button" role="option" aria-selected="false" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" data-combobox-option data-value="kimi-k3" data-label="Kimi K3" data-description="kimi-k3" onclick="selectComboboxOption('modelCombobox', this)">
                              <span class="block truncate text-sm font-medium text-gray-900">Kimi K3</span>
                          </button>
                          <button type="button" role="option" aria-selected="false" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" data-combobox-option data-value="MiniMax-M3" data-label="MiniMax M3" data-description="MiniMax-M3" onclick="selectComboboxOption('modelCombobox', this)">
                              <span class="block truncate text-sm font-medium text-gray-900">MiniMax M3</span>
                          </button>
                          <button type="button" role="option" aria-selected="false" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" data-combobox-option data-value="deepseek-v4-flash" data-label="DeepSeek V4 Flash" data-description="deepseek-v4-flash" onclick="selectComboboxOption('modelCombobox', this)">
                              <span class="block truncate text-sm font-medium text-gray-900">DeepSeek V4 Flash</span>
                          </button>
                          <button type="button" role="option" aria-selected="false" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" data-combobox-option data-value="__custom__" data-label="Custom model" data-description="Enter a model id" onclick="selectComboboxOption('modelCombobox', this)">
                              <span class="block truncate text-sm font-medium text-gray-900">Custom model</span>
                          </button>
                      </div>
                  </div>
                  <p id="listModelsError" class="hidden mt-1 text-xs text-red-600 break-words"></p>
                  <div id="customModelWrapper" class="hidden mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                          id="customModelInput"
                          type="text"
                          autocomplete="off"
                          placeholder="Custom model id"
                          class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                      <input
                          id="customClientTypeInput"
                          oninput="handleClientTypeInput()"
                          type="text"
                          autocomplete="off"
                          placeholder="Client type"
                          class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                  </div>
              </div>
              <div class="flex flex-col">
                  <label class="text-sm font-semibold text-gray-900 mb-1" for="apiKeyInput">API Key</label>
                  <div class="relative">
                      <input type="password" id="apiKeyInput" autocomplete="off" placeholder="Use environment variable when empty" class="w-full px-3 py-2 pr-12 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                      <button type="button" id="apiKeyVisibilityToggle" aria-label="Show API key" title="Show API key" class="absolute inset-y-0 right-1 my-1 px-3 text-gray-500 hover:text-gray-900 rounded focus:outline-none focus:ring-2 focus:ring-blue-500" onclick="toggleApiKeyVisibility()">
                          <svg id="apiKeyVisibilityShowIcon" class="hidden" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"></path>
                              <circle cx="12" cy="12" r="3"></circle>
                          </svg>
                          <svg id="apiKeyVisibilityHideIcon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                              <path d="M10.7 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-3.3 4.3"></path>
                              <path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a10.9 10.9 0 0 0 5.4-1.4"></path>
                              <path d="M9.9 9.9A3 3 0 0 0 14.1 14.1"></path>
                              <path d="M3 3l18 18"></path>
                          </svg>
                      </button>
                  </div>
              </div>
              <div class="flex flex-col">
                  <label class="text-sm font-semibold text-gray-900 mb-1" for="baseUrlInput">Base URL</label>
                  <input type="url" id="baseUrlInput" placeholder="Use provider default when empty" class="px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
              </div>
              <div class="flex flex-col">
                  <label class="text-sm font-semibold text-gray-900 mb-1" for="extraHeadersInput">Extra Headers</label>
                  <textarea id="extraHeadersInput" rows="2" spellcheck="false" placeholder='JSON, e.g. {"X-Title": "AgentHub"} — for endpoints that demand their own' class="px-3 py-2 border border-gray-300 rounded-md text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"></textarea>
              </div>
          </div>
          <div class="flex items-center gap-3 mb-2">
              <span class="text-xs font-semibold uppercase tracking-wider text-gray-500">Generation</span>
              <span class="h-px flex-1 bg-gray-200"></span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-4 gap-y-3">
              <div class="flex flex-col">
                  <label class="text-sm font-semibold text-gray-900 mb-1" for="thinkingLevelComboboxButton">Thinking Level</label>
                  <div id="thinkingLevelCombobox" class="relative" data-combobox>
                      <input id="thinkingLevelSelect" type="hidden" value="" data-combobox-value>
                      <button id="thinkingLevelComboboxButton" type="button" role="combobox" aria-controls="thinkingLevelComboboxMenu" aria-expanded="false" class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-left shadow-sm transition hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500" onclick="toggleCombobox('thinkingLevelCombobox')" onkeydown="handleComboboxKeydown(event, 'thinkingLevelCombobox')" data-combobox-button>
                          <span class="flex items-center justify-between gap-3">
                              <span class="min-w-0">
                                  <span class="block truncate text-sm font-medium text-gray-900" data-combobox-label>Unspecified</span>
                              </span>
                              <svg class="h-4 w-4 flex-none text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                  <path d="m6 9 6 6 6-6"></path>
                              </svg>
                          </span>
                      </button>
                      <div id="thinkingLevelComboboxMenu" class="hidden absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg" role="listbox" aria-labelledby="thinkingLevelComboboxButton" data-combobox-menu>
                          <button type="button" role="option" aria-selected="true" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none bg-blue-50" data-combobox-option data-value="" data-label="Unspecified" data-description="Provider default" onclick="selectComboboxOption('thinkingLevelCombobox', this)">Unspecified</button>
                          <button type="button" role="option" aria-selected="false" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" data-combobox-option data-value="none" data-label="None" data-description="Disable thinking" onclick="selectComboboxOption('thinkingLevelCombobox', this)">None</button>
                          <button type="button" role="option" aria-selected="false" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" data-combobox-option data-value="low" data-label="Low" data-description="Low thinking budget" onclick="selectComboboxOption('thinkingLevelCombobox', this)">Low</button>
                          <button type="button" role="option" aria-selected="false" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" data-combobox-option data-value="medium" data-label="Medium" data-description="Medium thinking budget" onclick="selectComboboxOption('thinkingLevelCombobox', this)">Medium</button>
                          <button type="button" role="option" aria-selected="false" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" data-combobox-option data-value="high" data-label="High" data-description="High thinking budget" onclick="selectComboboxOption('thinkingLevelCombobox', this)">High</button>
                          <button type="button" role="option" aria-selected="false" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" data-combobox-option data-value="xhigh" data-label="XHigh" data-description="Extended thinking budget" onclick="selectComboboxOption('thinkingLevelCombobox', this)">XHigh</button>
                          <button type="button" role="option" aria-selected="false" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" data-combobox-option data-value="max" data-label="Max" data-description="Maximum thinking budget" onclick="selectComboboxOption('thinkingLevelCombobox', this)">Max</button>
                      </div>
                  </div>
              </div>
              <div class="flex flex-col">
                  <label class="text-sm font-semibold text-gray-900 mb-1" for="thinkingSummaryComboboxButton">Thinking Summary</label>
                  <div id="thinkingSummaryCombobox" class="relative" data-combobox>
                      <input id="thinkingSummaryCheckbox" type="hidden" value="" data-combobox-value>
                      <button id="thinkingSummaryComboboxButton" type="button" role="combobox" aria-controls="thinkingSummaryComboboxMenu" aria-expanded="false" class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-left shadow-sm transition hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500" onclick="toggleCombobox('thinkingSummaryCombobox')" onkeydown="handleComboboxKeydown(event, 'thinkingSummaryCombobox')" data-combobox-button>
                          <span class="flex items-center justify-between gap-3">
                              <span class="min-w-0">
                                  <span class="block truncate text-sm font-medium text-gray-900" data-combobox-label>Unspecified</span>
                              </span>
                              <svg class="h-4 w-4 flex-none text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                  <path d="m6 9 6 6 6-6"></path>
                              </svg>
                          </span>
                      </button>
                      <div id="thinkingSummaryComboboxMenu" class="hidden absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg" role="listbox" aria-labelledby="thinkingSummaryComboboxButton" data-combobox-menu>
                          <button type="button" role="option" aria-selected="true" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none bg-blue-50" data-combobox-option data-value="" data-label="Unspecified" data-description="Provider default" onclick="selectComboboxOption('thinkingSummaryCombobox', this)">Unspecified</button>
                          <button type="button" role="option" aria-selected="false" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" data-combobox-option data-value="true" data-label="True" data-description="Request summaries" onclick="selectComboboxOption('thinkingSummaryCombobox', this)">True</button>
                          <button type="button" role="option" aria-selected="false" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" data-combobox-option data-value="false" data-label="False" data-description="Hide summaries" onclick="selectComboboxOption('thinkingSummaryCombobox', this)">False</button>
                      </div>
                  </div>
              </div>
              <div class="flex flex-col">
                  <label class="text-sm font-semibold text-gray-900 mb-1" for="toolChoiceComboboxButton">Tool Choice</label>
                  <div id="toolChoiceCombobox" class="relative" data-combobox>
                      <input id="toolChoiceSelect" type="hidden" value="" data-combobox-value>
                      <button id="toolChoiceComboboxButton" type="button" role="combobox" aria-controls="toolChoiceComboboxMenu" aria-expanded="false" class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-left shadow-sm transition hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500" onclick="toggleCombobox('toolChoiceCombobox')" onkeydown="handleComboboxKeydown(event, 'toolChoiceCombobox')" data-combobox-button>
                          <span class="flex items-center justify-between gap-3">
                              <span class="min-w-0">
                                  <span class="block truncate text-sm font-medium text-gray-900" data-combobox-label>Unspecified</span>
                              </span>
                              <svg class="h-4 w-4 flex-none text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                  <path d="m6 9 6 6 6-6"></path>
                              </svg>
                          </span>
                      </button>
                      <div id="toolChoiceComboboxMenu" class="hidden absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg" role="listbox" aria-labelledby="toolChoiceComboboxButton" data-combobox-menu>
                          <button type="button" role="option" aria-selected="true" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none bg-blue-50" data-combobox-option data-value="" data-label="Unspecified" data-description="SDK default" onclick="selectComboboxOption('toolChoiceCombobox', this)">Unspecified</button>
                          <button type="button" role="option" aria-selected="false" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" data-combobox-option data-value="auto" data-label="Auto" data-description="Model may call tools" onclick="selectComboboxOption('toolChoiceCombobox', this)">Auto</button>
                          <button type="button" role="option" aria-selected="false" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" data-combobox-option data-value="required" data-label="Required" data-description="Model must call tools" onclick="selectComboboxOption('toolChoiceCombobox', this)">Required</button>
                          <button type="button" role="option" aria-selected="false" class="w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" data-combobox-option data-value="none" data-label="None" data-description="Do not call tools" onclick="selectComboboxOption('toolChoiceCombobox', this)">None</button>
                      </div>
                  </div>
              </div>
              <div class="flex flex-col">
                  <label class="text-sm font-semibold text-gray-900 mb-1" for="traceIdInput">Trace ID</label>
                  <input type="text" id="traceIdInput" placeholder="e.g., session_001" class="px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
              </div>
              <div class="flex flex-col sm:col-span-2">
                  <label class="text-sm font-semibold text-gray-900 mb-1" for="systemPromptInput">System Prompt</label>
                  <textarea id="systemPromptInput" rows="3" class="px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"></textarea>
              </div>
              <div class="flex flex-col sm:col-span-2">
                  <label class="text-sm font-semibold text-gray-900 mb-1" for="toolsInput">Tools (JSON Array)</label>
                  <textarea id="toolsInput" rows="3" placeholder='[{"name": "function_name", "description": "...", "parameters": {...}}]' class="px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"></textarea>
              </div>
          </div>
      </div>

      <div class="flex-1 overflow-y-auto px-6 py-6" id="messagesContainer">
          <div class="text-center text-gray-500 py-10">
              <h2 class="text-2xl font-semibold mb-2">Start a conversation</h2>
              <p class="text-sm">Type your message below to begin chatting with the AI.</p>
          </div>
      </div>

      <div class="bg-white border-t border-gray-200 px-6 py-4">
          <div id="imagePreviewContainer" class="mb-3 max-w-5xl mx-auto hidden"></div>
          <div class="flex gap-3 max-w-5xl mx-auto">
              <input type="file" id="imageInput" accept="image/*" multiple class="hidden" onchange="handleImageSelect(event)">
              <button class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-md text-sm font-semibold whitespace-nowrap transition-colors" onclick="document.getElementById('imageInput').click()">📎 Image</button>
              <textarea id="messageInput" class="flex-1 px-4 py-3 border border-gray-300 rounded-md text-sm resize-none overflow-y-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="Type your message here..." rows="1"></textarea>
              <button class="bg-green-600 hover:bg-green-700 disabled:bg-green-300 disabled:cursor-not-allowed text-white px-6 py-3 rounded-md text-sm font-semibold whitespace-nowrap transition-colors" id="sendButton" onclick="sendMessage()">Send</button>
              <button class="hidden bg-orange-600 hover:bg-orange-700 disabled:bg-orange-300 disabled:cursor-not-allowed text-white px-6 py-3 rounded-md text-sm font-semibold whitespace-nowrap transition-colors" id="stopButton" onclick="stopGeneration()" disabled>Stop</button>
              <button class="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-md text-sm font-semibold transition-colors" onclick="clearChat()">Clear</button>
          </div>
      </div>

      <script>
          let isStreaming = false;
          let sessionId = Math.random().toString(36).substring(7);
          let selectedImages = [];
          let lastMessageTimestamp = null;
          let currentAbortController = null;

          function escapeHtml(text) {
              const div = document.createElement('div');
              div.textContent = text;
              return div.innerHTML;
          }

          function formatTimestamp(ms) {
              if (!ms) return '';
              const d = new Date(ms);
              const pad = n => n.toString().padStart(2, '0');
              return \`\${d.getFullYear()}-\${pad(d.getMonth()+1)}-\${pad(d.getDate())} \${pad(d.getHours())}:\${pad(d.getMinutes())}:\${pad(d.getSeconds())}\`;
          }

          const AUDIO_MIME_TYPES = ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/webm', 'audio/flac', 'audio/aac', 'audio/mp4'];

          function isAudioMimeType(mimeType) {
              const value = (mimeType || '').toLowerCase();
              return !value || value === 'application/octet-stream' || value.startsWith('audio/');
          }

          function base64ToBytes(base64) {
              const binary = atob(base64);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) {
                  bytes[i] = binary.charCodeAt(i);
              }
              return bytes;
          }

          function bytesToBase64(bytes) {
              let binary = '';
              const chunkSize = 0x8000;
              for (let i = 0; i < bytes.length; i += chunkSize) {
                  binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
              }
              return btoa(binary);
          }

          function concatBase64Chunks(chunks) {
              const parts = chunks.map(base64ToBytes);
              const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
              let offset = 0;
              for (const part of parts) {
                  bytes.set(part, offset);
                  offset += part.length;
              }
              return bytes;
          }

          function pcmFormatFromMimeType(mimeType) {
              // Gemini TTS labels its raw PCM as "audio/l16; rate=24000; channels=1"
              const params = {};
              for (const parameter of (mimeType || '').split(';').slice(1)) {
                  const [key, value] = parameter.split('=');
                  params[key.trim()] = Number(value);
              }
              return { sampleRate: params.rate || 24000, channels: params.channels || 1 };
          }

          function pcmBytesToWavDataUrl(pcmBytes, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
              const header = new ArrayBuffer(44);
              const view = new DataView(header);
              const byteRate = sampleRate * channels * bitsPerSample / 8;
              const blockAlign = channels * bitsPerSample / 8;

              const writeString = (offset, value) => {
                  for (let i = 0; i < value.length; i++) {
                      view.setUint8(offset + i, value.charCodeAt(i));
                  }
              };

              writeString(0, 'RIFF');
              view.setUint32(4, 36 + pcmBytes.length, true);
              writeString(8, 'WAVE');
              writeString(12, 'fmt ');
              view.setUint32(16, 16, true);
              view.setUint16(20, 1, true);
              view.setUint16(22, channels, true);
              view.setUint32(24, sampleRate, true);
              view.setUint32(28, byteRate, true);
              view.setUint16(32, blockAlign, true);
              view.setUint16(34, bitsPerSample, true);
              writeString(36, 'data');
              view.setUint32(40, pcmBytes.length, true);

              const wavBytes = new Uint8Array(44 + pcmBytes.length);
              wavBytes.set(new Uint8Array(header), 0);
              wavBytes.set(pcmBytes, 44);
              return \`data:audio/wav;base64,\${bytesToBase64(wavBytes)}\`;
          }

          function renderAudioPlayer(mimeType, chunks) {
              const bytes = concatBase64Chunks(chunks);
              if (AUDIO_MIME_TYPES.includes(mimeType)) {
                  return \`<audio controls preload="metadata" class="max-w-xs"><source src="data:\${mimeType};base64,\${bytesToBase64(bytes)}" type="\${mimeType}"></audio>\`;
              }

              const format = pcmFormatFromMimeType(mimeType);
              const wavDataUrl = pcmBytesToWavDataUrl(bytes, format.sampleRate, format.channels);
              return \`<audio controls preload="metadata" class="max-w-xs"><source src="\${wavDataUrl}" type="audio/wav"></audio>\`;
          }

          function audioProgressLabel(audioStream) {
              if (AUDIO_MIME_TYPES.includes(audioStream.mimeType)) {
                  return \`🔊 Receiving audio... \${Math.round(audioStream.bytes / 1024)} KB\`;
              }

              // raw PCM carries no duration, so 16-bit samples turn the byte count into seconds
              const format = pcmFormatFromMimeType(audioStream.mimeType);
              const seconds = audioStream.bytes / (format.sampleRate * format.channels * 2);
              return \`🔊 Receiving audio... \${seconds.toFixed(1)}s\`;
          }

          function appendAudioChunk(contentDiv, item, audioStream) {
              if (!audioStream.container) {
                  audioStream.mimeType = (item.mime_type || '').toLowerCase();
                  audioStream.container = document.createElement('div');
                  audioStream.container.className = 'mb-3 text-sm text-gray-500';
                  contentDiv.appendChild(audioStream.container);
              }

              audioStream.chunks.push(item.data);
              audioStream.bytes += Math.floor(item.data.length * 3 / 4);
              audioStream.container.textContent = audioProgressLabel(audioStream);
          }

          function finalizeAudioStream(audioStream, autoplay = false) {
              if (audioStream.finalized || !audioStream.container) {
                  return;
              }

              audioStream.finalized = true;
              audioStream.container.className = 'mb-3';
              audioStream.container.innerHTML = renderAudioPlayer(audioStream.mimeType, audioStream.chunks);
              if (autoplay) {
                  // a browser that blocks autoplay leaves the player sitting there ready to press
                  audioStream.container.querySelector('audio').play().catch(() => {});
              }
          }

          function renderInlineData(item) {
              const mimeType = (item.mime_type || '').toLowerCase();
              if (mimeType.startsWith('image/')) {
                  return \`<div class="mb-3"><img src="data:\${mimeType || 'image/png'};base64,\${item.data}" class="max-w-xs rounded border border-gray-300"></div>\`;
              }

              return \`<div class="mb-3 rounded border border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-600">Inline data: \${escapeHtml(item.mime_type || 'application/octet-stream')}</div>\`;
          }

          function renderEmbedding(item) {
              const values = Array.isArray(item.embedding) ? item.embedding.slice(0, 5) : [];
              const preview = escapeHtml(\`[\${values.join(', ')}]\`);
              return \`<div class="embedding-content mb-2 rounded-md border-l-4 border-indigo-500 bg-indigo-50 p-3 whitespace-normal"><div class="flex items-start gap-2 text-sm"><strong class="shrink-0 text-gray-900">Embedding:</strong><code class="font-mono text-xs text-gray-800 break-all">\${preview}</code></div></div>\`;
          }

          function openStreamItem(contentDiv, className) {
              const container = document.createElement('div');
              container.className = className;
              contentDiv.appendChild(container);
              return { container, text: '', name: '' };
          }

          function handleImageSelect(event) {
              const files = event.target.files;
              if (!files || files.length === 0) return;

              const maxFileSize = 10 * 1024 * 1024;
              const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

              Array.from(files).forEach(file => {
                  if (!allowedTypes.includes(file.type)) {
                      alert(\`File "\${file.name}" is not a valid image type. Please upload JPEG, PNG, GIF, or WebP images.\`);
                      return;
                  }

                  if (file.size > maxFileSize) {
                      alert(\`File "\${file.name}" is too large. Maximum file size is 10MB.\`);
                      return;
                  }

                  const reader = new FileReader();
                  reader.onload = function(e) {
                      const base64Data = e.target.result;
                      if (typeof base64Data === 'string' && base64Data.startsWith('data:image/')) {
                          selectedImages.push(base64Data);
                          updateImagePreview();
                      }
                  };
                  reader.readAsDataURL(file);
              });

              event.target.value = '';
          }

          function updateImagePreview() {
              const container = document.getElementById('imagePreviewContainer');
              if (selectedImages.length === 0) {
                  container.classList.add('hidden');
                  container.innerHTML = '';
                  return;
              }

              container.classList.remove('hidden');
              container.innerHTML = selectedImages.map((img, idx) => \`
                  <div class="inline-block relative mr-2 mb-2">
                      <img src="\${img}" class="h-20 w-20 object-cover rounded border border-gray-300">
                      <button onclick="removeImage(\${idx})" class="absolute -top-2 -right-2 bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-700">×</button>
                  </div>
              \`).join('');
          }

          function removeImage(idx) {
              selectedImages.splice(idx, 1);
              updateImagePreview();
          }

          function toggleConfig() {
              const panel = document.getElementById('configPanel');
              panel.classList.toggle('hidden');
          }

          function closeCombobox(comboboxId) {
              const root = document.getElementById(comboboxId);
              if (!root) {
                  return;
              }
              const menu = root.querySelector('[data-combobox-menu]');
              const button = root.querySelector('[data-combobox-button]');
              menu.classList.add('hidden');
              button.setAttribute('aria-expanded', 'false');
          }

          function closeComboboxes(exceptId) {
              document.querySelectorAll('[data-combobox]').forEach((root) => {
                  if (root.id !== exceptId) {
                      closeCombobox(root.id);
                  }
              });
          }

          function toggleCombobox(comboboxId) {
              const root = document.getElementById(comboboxId);
              const menu = root.querySelector('[data-combobox-menu]');
              const isOpen = !menu.classList.contains('hidden');
              closeComboboxes(comboboxId);
              if (isOpen) {
                  closeCombobox(comboboxId);
                  return;
              }
              menu.classList.remove('hidden');
              root.querySelector('[data-combobox-button]').setAttribute('aria-expanded', 'true');
          }

          function selectComboboxOption(comboboxId, option) {
              const root = document.getElementById(comboboxId);
              root.querySelector('[data-combobox-value]').value = option.dataset.value || '';
              root.querySelector('[data-combobox-label]').textContent = option.dataset.label || 'Unspecified';
              const description = root.querySelector('[data-combobox-description]');
              if (description) {
                  description.textContent = option.dataset.description || option.dataset.value || 'Default';
              }

              root.querySelectorAll('[data-combobox-option]').forEach((item) => {
                  const isSelected = item === option;
                  item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
                  item.classList.toggle('bg-blue-50', isSelected);
              });

              closeCombobox(comboboxId);
              if (comboboxId === 'modelCombobox') {
                  handleModelSelectChange();
              }

              saveConfig();
          }

          function handleComboboxKeydown(event, comboboxId) {
              if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
                  event.preventDefault();
                  toggleCombobox(comboboxId);
              } else if (event.key === 'Escape') {
                  closeCombobox(comboboxId);
              }
          }

          document.addEventListener('click', (event) => {
              const target = event.target;
              if (!(target instanceof Element)) {
                  return;
              }
              if (!target.closest('[data-combobox]')) {
                  closeComboboxes();
              }
          });

          function selectedOptionClientType() {
              const modelSelect = document.getElementById('modelSelect');
              if (modelSelect.value === '__custom__') {
                  return '';
              }

              // a built-in whose id does not route on its own declares data-client-type, and a
              // listed model carries the client type its listing ran under
              const option = document.querySelector(
                  '#modelComboboxMenu [data-combobox-option][data-value="' + modelSelect.value + '"]'
              );
              return (option && option.dataset.clientType) || '';
          }

          function handleClientTypeInput() {
              const modelSelect = document.getElementById('modelSelect');
              if (modelSelect.value === '__custom__') {
                  return;
              }

              // the option carries the protocol for its id, so an edit belongs on the option and
              // not only in the box, which the next selection refills
              const option = document.querySelector(
                  '#modelComboboxMenu [data-combobox-option][data-value="' + modelSelect.value + '"]'
              );
              if (option) {
                  option.dataset.clientType = document.getElementById('customClientTypeInput').value.trim();
              }
          }

          function handleModelSelectChange() {
              const useCustom = document.getElementById('modelSelect').value === '__custom__';
              const modelInput = document.getElementById('customModelInput');
              const clientTypeInput = document.getElementById('customClientTypeInput');
              // a listed model's protocol is known only from its listing, so it is shown and can be
              // corrected; a built-in declares its own and keeps it
              const showClientType = useCustom || selectedOptionIsListed();
              if (!useCustom) {
                  clientTypeInput.value = showClientType ? selectedOptionClientType() : '';
              }

              modelInput.classList.toggle('hidden', !useCustom);
              clientTypeInput.classList.toggle('hidden', !showClientType);
              // with the model id field hidden it is the only control in the row
              clientTypeInput.classList.toggle('sm:col-span-2', !useCustom);
              document.getElementById('customModelWrapper').classList.toggle('hidden', !showClientType);
              if (useCustom) {
                  modelInput.focus();
              }
          }

          function getSelectedModel() {
              const modelSelect = document.getElementById('modelSelect');
              if (modelSelect.value === '__custom__') {
                  return document.getElementById('customModelInput').value.trim();
              }
              return modelSelect.value;
          }

          function toggleApiKeyVisibility() {
              const input = document.getElementById('apiKeyInput');
              const toggle = document.getElementById('apiKeyVisibilityToggle');
              const showIcon = document.getElementById('apiKeyVisibilityShowIcon');
              const hideIcon = document.getElementById('apiKeyVisibilityHideIcon');
              const shouldShow = input.type === 'password';

              input.type = shouldShow ? 'text' : 'password';
              toggle.setAttribute('aria-label', shouldShow ? 'Hide API key' : 'Show API key');
              toggle.setAttribute('title', shouldShow ? 'Hide API key' : 'Show API key');
              showIcon.classList.toggle('hidden', !shouldShow);
              hideIcon.classList.toggle('hidden', shouldShow);
          }

          function selectedOptionIsListed() {
              const modelSelect = document.getElementById('modelSelect');
              const option = document.querySelector(
                  '#modelComboboxMenu [data-combobox-option][data-value="' + modelSelect.value + '"]'
              );
              return Boolean(option && option.dataset.listed);
          }

          function getSelectedClientType() {
              // the box is on screen for a custom or a listed model and is then the one source; a
              // built-in keeps the client type it declares for itself
              const wrapper = document.getElementById('customModelWrapper');
              const clientTypeInput = document.getElementById('customClientTypeInput');
              if (!wrapper.classList.contains('hidden') && !clientTypeInput.classList.contains('hidden')) {
                  return clientTypeInput.value.trim();
              }

              return selectedOptionClientType();
          }

          function addListedModels(modelIds) {
              const menu = document.getElementById('modelComboboxMenu');
              const options = Array.from(menu.querySelectorAll('[data-combobox-option]'));
              const known = new Set(options.map((option) => option.dataset.value));
              const customOption = options.find((option) => option.dataset.value === '__custom__') || null;
              const clientType = getSelectedClientType();

              let added = 0;
              modelIds.forEach((modelId) => {
                  if (known.has(modelId)) {
                      return;
                  }

                  const option = document.createElement('button');
                  option.type = 'button';
                  option.setAttribute('role', 'option');
                  option.setAttribute('aria-selected', 'false');
                  option.className = 'w-full px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none';
                  option.setAttribute('data-combobox-option', '');
                  option.dataset.value = modelId;
                  option.dataset.label = modelId;
                  option.dataset.description = modelId;
                  option.dataset.listed = 'true';
                  if (clientType) {
                      option.dataset.clientType = clientType;
                  }
                  option.onclick = () => selectComboboxOption('modelCombobox', option);

                  const label = document.createElement('span');
                  label.className = 'block truncate text-sm font-medium text-gray-900';
                  label.textContent = modelId;
                  option.appendChild(label);
                  menu.insertBefore(option, customOption);
                  known.add(modelId);
                  added += 1;
              });

              return added;
          }

          async function listModels() {
              const button = document.getElementById('listModelsButton');
              const status = document.getElementById('listModelsStatus');
              const error = document.getElementById('listModelsError');

              button.disabled = true;
              status.textContent = 'Listing...';
              error.classList.add('hidden');
              try {
                  const response = await fetch('/api/models', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ config: getConfig() })
                  });
                  const data = await response.json();
                  if (!response.ok) {
                      throw new Error(data.error || 'Request failed');
                  }

                  const added = addListedModels(data.models);
                  status.textContent = data.models.length + ' models, ' + added + ' added';
              } catch (err) {
                  status.textContent = 'Failed';
                  error.textContent = err.message || String(err);
                  error.classList.remove('hidden');
              } finally {
                  button.disabled = false;
              }
          }

          function getExtraHeaders() {
              const input = document.getElementById('extraHeadersInput');
              const raw = input.value.trim();
              input.classList.remove('border-red-500');
              if (!raw) {
                  return null;
              }
              try {
                  const parsed = JSON.parse(raw);
                  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                      return parsed;
                  }
              } catch (error) {
                  // the invalid marker below covers both a parse failure and a non-object
              }
              input.classList.add('border-red-500');
              return null;
          }

          function getConfig() {
              const config = {
                  model: getSelectedModel()
              };

              const apiKey = document.getElementById('apiKeyInput').value.trim();
              if (apiKey) {
                  config.api_key = apiKey;
              }

              const clientType = getSelectedClientType();
              if (clientType) {
                  config.client_type = clientType;
              }

              const baseUrl = document.getElementById('baseUrlInput').value.trim();
              if (baseUrl) {
                  config.base_url = baseUrl;
              }

              const extraHeaders = getExtraHeaders();
              if (extraHeaders) {
                  config.default_headers = extraHeaders;
              }

              const thinkingLevel = document.getElementById('thinkingLevelSelect').value;
              if (thinkingLevel) {
                  config.thinking_level = thinkingLevel;
              }

              const thinkingSummary = document.getElementById('thinkingSummaryCheckbox').value;
              if (thinkingSummary) {
                  config.thinking_summary = JSON.parse(thinkingSummary);
              }

              const toolChoice = document.getElementById('toolChoiceSelect').value;
              if (toolChoice && toolChoice !== 'auto') {
                  config.tool_choice = toolChoice;
              }

              const systemPrompt = document.getElementById('systemPromptInput').value.trim();
              if (systemPrompt) {
                  config.system_prompt = systemPrompt;
              }

              const toolsInput = document.getElementById('toolsInput').value.trim();
              if (toolsInput) {
                  try {
                      config.tools = JSON.parse(toolsInput);
                  } catch (e) {
                      console.error('Invalid JSON in tools field:', e);
                      alert('Invalid JSON format in Tools field. Please check your syntax.');
                  }
              }

              const traceId = document.getElementById('traceIdInput').value.trim();
              if (traceId) {
                  config.trace_id = traceId;
              }

              return config;
          }

          const CONFIG_STORAGE_KEY = 'agenthub.playground.config';
          // saved as typed rather than as parsed values, so an unfinished JSON edit survives too
          const CONFIG_TEXT_INPUTS = [
              'apiKeyInput', 'baseUrlInput', 'extraHeadersInput', 'systemPromptInput', 'toolsInput', 'traceIdInput'
          ];
          const CONFIG_COMBOBOXES = [
              ['thinkingLevelCombobox', 'thinkingLevelSelect'],
              ['thinkingSummaryCombobox', 'thinkingSummaryCheckbox'],
              ['toolChoiceCombobox', 'toolChoiceSelect']
          ];
          let restoringConfig = false;

          function comboboxOption(comboboxId, value) {
              return document.querySelector('#' + comboboxId + ' [data-combobox-option][data-value="' + value + '"]');
          }

          function saveConfig() {
              if (restoringConfig) {
                  return;
              }

              const saved = { model: getSelectedModel(), client_type: getSelectedClientType() };
              CONFIG_TEXT_INPUTS.forEach((id) => {
                  saved[id] = document.getElementById(id).value;
              });
              CONFIG_COMBOBOXES.forEach(([, valueId]) => {
                  saved[valueId] = document.getElementById(valueId).value;
              });
              try {
                  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(saved));
              } catch (error) {
                  // a browser that refuses storage still runs the playground, just without the memory
              }
          }

          function restoreConfig() {
              let saved = null;
              try {
                  saved = JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || 'null');
              } catch (error) {
                  saved = null;
              }
              if (!saved) {
                  return;
              }

              restoringConfig = true;
              try {
                  CONFIG_TEXT_INPUTS.forEach((id) => {
                      if (typeof saved[id] === 'string') {
                          document.getElementById(id).value = saved[id];
                      }
                  });
                  CONFIG_COMBOBOXES.forEach(([comboboxId, valueId]) => {
                      const option = comboboxOption(comboboxId, saved[valueId] || '');
                      if (option) {
                          selectComboboxOption(comboboxId, option);
                      }
                  });

                  // a model the menu does not list — one that was listed, or typed in — comes back as a custom entry
                  const modelOption = saved.model ? comboboxOption('modelCombobox', saved.model) : null;
                  if (modelOption) {
                      selectComboboxOption('modelCombobox', modelOption);
                  } else if (saved.model) {
                      document.getElementById('customModelInput').value = saved.model;
                      selectComboboxOption('modelCombobox', comboboxOption('modelCombobox', '__custom__'));
                      // the custom option focuses its id field on selection, which a page load should not do
                      document.getElementById('customModelInput').blur();
                  }
                  if (saved.client_type) {
                      document.getElementById('customClientTypeInput').value = saved.client_type;
                      handleClientTypeInput();
                  }
              } finally {
                  restoringConfig = false;
              }
          }

          function addMessageCard(role, content, metadata = null, images = [], timestamp = null, tookMs = null) {
              const container = document.getElementById('messagesContainer');

              if (container.children.length === 1 && container.children[0].className.includes('text-center')) {
                  container.innerHTML = '';
              }

              const card = document.createElement('div');
              const isUser = role === 'user';
              card.className = \`max-w-3xl rounded-lg shadow-sm border p-4 mb-4 \${isUser ? 'ml-auto bg-blue-50 border-blue-200' : 'mr-auto bg-white border-gray-200'}\`;

              let html = \`
                  <div class="flex justify-between items-center mb-3">
                      <span class="font-semibold text-sm uppercase \${isUser ? 'text-blue-600' : 'text-green-600'}">\${role}</span>
                      <div class="flex items-center gap-2">
                          <span class="msg-took text-xs text-gray-400">\${tookMs !== null ? 'Took ' + tookMs + ' ms' : ''}</span>
                          <span class="text-xs text-gray-400 msg-timestamp">\${timestamp ? formatTimestamp(timestamp) : ''}</span>
                      </div>
                  </div>
              \`;

              if (images && images.length > 0) {
                  html += '<div class="mb-3 flex flex-wrap gap-2">';
                  images.forEach(img => {
                      html += \`<img src="\${img}" class="max-w-xs rounded border border-gray-300">\`;
                  });
                  html += '</div>';
              }

              html += \`<div class="message-content text-sm leading-relaxed whitespace-pre-wrap">\${escapeHtml(content || '')}</div>\`;

              if (metadata) {
                  html += '<div class="flex justify-end gap-3 mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500">';
                  if (metadata.tokens) {
                      html += \`<div class="flex items-center gap-1">📊 \${metadata.tokens} tokens</div>\`;
                  }
                  if (metadata.finish_reason) {
                      html += \`<div class="flex items-center gap-1">🏁 \${metadata.finish_reason}</div>\`;
                  }
                  html += '</div>';
              }

              card.innerHTML = html;
              container.appendChild(card);
              container.scrollTop = container.scrollHeight;

              return card;
          }

          function setStreamingControls(streaming) {
              const sendButton = document.getElementById('sendButton');
              const stopButton = document.getElementById('stopButton');
              sendButton.disabled = streaming;
              stopButton.disabled = !streaming;
              stopButton.classList.toggle('hidden', !streaming);
          }

          function stopGeneration() {
              if (!isStreaming) return;

              fetch('/api/abort', {
                  method: 'POST',
                  headers: {
                      'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                      session_id: sessionId
                  }),
                  keepalive: true
              }).catch(error => {
                  console.error('Error interrupting chat:', error);
              });

              if (currentAbortController) {
                  currentAbortController.abort();
              }
          }

          function markInterrupted(contentDiv) {
              if (!contentDiv.textContent.trim() && contentDiv.children.length === 0) {
                  contentDiv.textContent = 'Interrupted.';
                  return;
              }

              const interruptedDiv = document.createElement('div');
              interruptedDiv.className = 'mt-3 text-xs font-semibold text-orange-600';
              interruptedDiv.textContent = 'Interrupted';
              contentDiv.appendChild(interruptedDiv);
          }

          async function sendMessage() {
              const input = document.getElementById('messageInput');
              const container = document.getElementById('messagesContainer');
              const message = input.value.trim();

              if ((!message && selectedImages.length === 0) || isStreaming) return;

              isStreaming = true;
              currentAbortController = new AbortController();
              setStreamingControls(true);
              input.value = '';
              resizeMessageInput();

              const currentImages = [...selectedImages];
              selectedImages = [];
              updateImagePreview();

              const userSendTime = Date.now();
              const timeSinceLastResponse = lastMessageTimestamp !== null ? userSendTime - lastMessageTimestamp : null;
              addMessageCard('user', message, null, currentImages, userSendTime, timeSinceLastResponse);

              const assistantCard = addMessageCard('assistant', '');
              const contentDiv = assistantCard.querySelector('.message-content');
              // items never interleave in a stream, so every delta belongs to the one item still open
              let openItem = null;
              // a spoken response streams as many small chunks that only play as one clip
              let audioStream = null;

              try {
                  const config = getConfig();
                  const content_items = [];

                  if (message) {
                      content_items.push({ type: 'text.done', text: message });
                  }

                  currentImages.forEach(img => {
                      content_items.push({ type: 'image_url.done', image_url: img });
                  });

                  const response = await fetch('/api/chat', {
                      method: 'POST',
                      headers: {
                          'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({
                          message: {
                              role: 'user',
                              content_items: content_items
                          },
                          config: config,
                          session_id: sessionId
                      }),
                      signal: currentAbortController.signal
                  });

                  if (!response.ok || !response.body) {
                      let errorMessage = \`Request failed with status \${response.status}\`;
                      try {
                          const errorPayload = await response.clone().json();
                          if (errorPayload && errorPayload.error) {
                              errorMessage = errorPayload.error;
                          }
                      } catch (e) {
                          const errorText = await response.text();
                          if (errorText) {
                              errorMessage = errorText;
                          }
                      }
                      throw new Error(errorMessage);
                  }

                  const reader = response.body.getReader();
                  const decoder = new TextDecoder();
                  let metadata = null;
                  let lastCreatedAt = null;
                  let buffer = '';

                  while (true) {
                      const { done, value } = await reader.read();
                      if (done) break;

                      const chunk = decoder.decode(value);
                      buffer += chunk;
                      if (!buffer.endsWith('\\n\\n')) continue;

                      const lines = buffer.split('\\n');
                      buffer = '';
                      for (const line of lines) {
                          if (line.startsWith('data: ')) {
                              const data = line.slice(6);
                              if (data === '[DONE]') continue;

                              try {
                                  const event = JSON.parse(data);

                                  if (event.error) {
                                      const errorDiv = document.createElement('div');
                                      errorDiv.className = 'mt-2 text-sm text-red-600';
                                      errorDiv.textContent = \`Error: \${event.error}\`;
                                      contentDiv.appendChild(errorDiv);
                                      continue;
                                  }

                                  if (event.event_type === 'stop') {
                                      const usage = event.usage_metadata;
                                      const inputTokens = (usage.cached_tokens || 0) + (usage.prompt_tokens || 0);
                                      const outputTokens = (usage.thoughts_tokens || 0) + (usage.response_tokens || 0);
                                      const totalTokens = inputTokens + outputTokens;
                                      metadata = {
                                          cached_tokens: usage.cached_tokens || 0,
                                          prompt_tokens: usage.prompt_tokens || 0,
                                          thoughts_tokens: usage.thoughts_tokens || 0,
                                          response_tokens: usage.response_tokens || 0,
                                          total_tokens: totalTokens,
                                          finish_reason: event.finish_reason
                                      };
                                      lastCreatedAt = event.created_at;
                                      continue;
                                  }

                                  // a delta event carries a fragment of the open item or its done item, whose complete
                                  // content replaces the fragments shown so far; an image or an embedding shows once
                                  // done, and thinking inline data not at all
                                  for (const item of event.content_items) {
                                      if (item.type === 'text.delta' || item.type === 'text.done') {
                                          openItem = openItem || openStreamItem(contentDiv, 'text-content');
                                          openItem.text = item.type === 'text.done' ? item.text : openItem.text + item.text;
                                          openItem.container.textContent = openItem.text;
                                      } else if (item.type === 'thinking.delta' || item.type === 'thinking.done') {
                                          openItem = openItem || openStreamItem(contentDiv, 'thinking-content bg-blue-50 p-3 rounded-md border-l-4 border-blue-500 mb-2 italic');
                                          openItem.text = item.type === 'thinking.done' ? item.thinking : openItem.text + item.thinking;
                                          openItem.container.textContent = \`💭 \${openItem.text}\`;
                                      } else if (item.type === 'tool_call.delta' || item.type === 'tool_call.done') {
                                          openItem = openItem || openStreamItem(contentDiv, 'toolcall-content bg-yellow-50 p-3 rounded-md border-l-4 border-yellow-500 mb-2');
                                          // only the first delta names the call, and only the done item has parsed arguments
                                          openItem.name = item.name || openItem.name;
                                          openItem.text = item.type === 'tool_call.done' ? JSON.stringify(item.arguments) : openItem.text + item.arguments;
                                          openItem.container.innerHTML = \`<strong class="text-sm">🛠️ Tool Call:</strong> \${escapeHtml(openItem.name)}<br><div class="mt-1 text-xs whitespace-pre-wrap">\${escapeHtml(openItem.text)}</div>\`;
                                      } else if (item.type === 'inline_data.delta' && isAudioMimeType(item.mime_type)) {
                                          audioStream = audioStream || { mimeType: '', chunks: [], bytes: 0, container: null, finalized: false };
                                          appendAudioChunk(contentDiv, item, audioStream);
                                      } else if (item.type === 'inline_data.done' && isAudioMimeType(item.mime_type)) {
                                          audioStream.chunks = [item.data];
                                          finalizeAudioStream(audioStream, true);
                                          audioStream = null;
                                      } else if (item.type === 'inline_data.done') {
                                          const inlineDataDiv = document.createElement('div');
                                          inlineDataDiv.innerHTML = renderInlineData(item);
                                          if (inlineDataDiv.firstChild) {
                                              contentDiv.appendChild(inlineDataDiv.firstChild);
                                          }
                                      } else if (item.type === 'embedding.done') {
                                          const embeddingDiv = document.createElement('div');
                                          embeddingDiv.innerHTML = renderEmbedding(item);
                                          if (embeddingDiv.firstChild) {
                                              contentDiv.appendChild(embeddingDiv.firstChild);
                                          }
                                      }

                                      if (item.type.endsWith('.done')) {
                                          openItem = null;
                                      }
                                  }

                                  container.scrollTop = container.scrollHeight;
                              } catch (e) {
                                  console.error('Error parsing event:', e);
                              }
                          }
                      }
                  }

                  if (lastCreatedAt) {
                      const timestampEl = assistantCard.querySelector('.msg-timestamp');
                      if (timestampEl) {
                          timestampEl.textContent = formatTimestamp(lastCreatedAt);
                      }
                  }

                  const endTime = Date.now();
                  const responseTimeMs = endTime - userSendTime;
                  lastMessageTimestamp = endTime;
                  const tookEl = assistantCard.querySelector('.msg-took');
                  if (tookEl) {
                      tookEl.textContent = \`Took \${responseTimeMs} ms\`;
                  }

                  if (metadata) {
                      let metadataHtml = '<div class="flex justify-end gap-3 mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500">';
                      const parts = [];
                      if (metadata.cached_tokens) parts.push(\`Cached: \${metadata.cached_tokens}\`);
                      if (metadata.prompt_tokens) parts.push(\`Prompt: \${metadata.prompt_tokens}\`);
                      if (metadata.thoughts_tokens) parts.push(\`Thoughts: \${metadata.thoughts_tokens}\`);
                      if (metadata.response_tokens) parts.push(\`Response: \${metadata.response_tokens}\`);
                      if (metadata.total_tokens) parts.push(\`Total: \${metadata.total_tokens}\`);
                      metadataHtml += \`<div class="flex items-center gap-1">📊 \${parts.join(' | ')}</div>\`;
                      if (metadata.finish_reason) {
                          metadataHtml += \`<div class="flex items-center gap-1">🏁 \${metadata.finish_reason}</div>\`;
                      }
                      metadataHtml += '</div>';
                      // appended rather than re-parsed into the card, which would restart a playing clip
                      assistantCard.insertAdjacentHTML('beforeend', metadataHtml);
                  }

              } catch (error) {
                  if (error.name === 'AbortError') {
                      if (audioStream) {
                          finalizeAudioStream(audioStream);
                      }
                      markInterrupted(contentDiv);
                  } else {
                      contentDiv.textContent = \`Error: \${error.message}\`;
                      console.error('Error:', error);
                  }
                  lastMessageTimestamp = Date.now();
              } finally {
                  isStreaming = false;
                  currentAbortController = null;
                  setStreamingControls(false);
              }
          }

          function clearChat() {
              if (confirm('Are you sure you want to clear the conversation?')) {
                  fetch('/api/clear', {
                      method: 'POST',
                      headers: {
                          'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({
                          session_id: sessionId
                      })
                  }).then(() => {
                      sessionId = Math.random().toString(36).substring(7);
                      lastMessageTimestamp = null;
                      const container = document.getElementById('messagesContainer');
                      container.innerHTML = \`
                          <div class="text-center text-gray-500 py-10">
                              <h2 class="text-2xl font-semibold mb-2">Start a conversation</h2>
                              <p class="text-sm">Type your message below to begin chatting with the AI.</p>
                          </div>
                      \`;
                  }).catch(error => {
                      console.error('Error clearing chat:', error);
                  });
              }
          }

          document.getElementById('messageInput').addEventListener('keydown', function(e) {
              if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                  e.preventDefault();
                  sendMessage();
              }
          });

          const textarea = document.getElementById('messageInput');
          function resizeMessageInput() {
              const maxHeight = 200;
              textarea.style.height = 'auto';
              const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
              textarea.style.height = nextHeight + 'px';
              textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
          }
          textarea.addEventListener('input', resizeMessageInput);
          resizeMessageInput();

          document.getElementById('configPanel').addEventListener('input', saveConfig);
          restoreConfig();

      </script>
  </body>
  </html>
  `;

  app.get("/", (_req: Request, res: Response) => {
    res.send(CHAT_TEMPLATE);
  });

  app.post("/api/chat", async (req: Request, res: Response) => {
    const { message, config, session_id } = req.body as {
      message: UniMessage;
      config: PlaygroundConfig;
      session_id: string;
    };

    if (!message) {
      return res.status(400).json({ error: "No message provided" });
    }
    const sessionId = session_id || "default";

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const abortController = new AbortController();
    sessionAbortControllers.get(sessionId)?.abort();
    sessionAbortControllers.set(sessionId, abortController);
    let completed = false;
    res.on("close", () => {
      if (!completed) {
        abortController.abort();
      }
    });

    try {
      const clientOptions = getClientOptions(config || {});
      if (
        !sessionClients.has(sessionId) ||
        clientOptionsChanged(sessionClientOptions.get(sessionId), clientOptions)
      ) {
        sessionClients.set(sessionId, new AutoLLMClient(clientOptions));
        sessionClientOptions.set(sessionId, clientOptions);
      }

      const client = sessionClients.get(sessionId)!;
      const requestConfig = getRequestConfig(config || {});

      for await (const event of client.streamingResponseStateful({
        message,
        config: requestConfig,
        signal: abortController.signal,
      })) {
        const serializedEvent = serializeForJson(event);
        res.write(`data: ${JSON.stringify(serializedEvent)}\n\n`);
      }

      completed = true;
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error) {
      if (abortController.signal.aborted) {
        completed = true;
        if (!res.writableEnded && !res.destroyed) {
          res.write("data: [DONE]\n\n");
          res.end();
        }
        return;
      }

      // a failed response has no stop event, so the page gets the error as an event of its own
      const errorEvent = {
        error: error instanceof Error ? error.message : String(error),
      };
      completed = true;
      res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    } finally {
      if (sessionAbortControllers.get(sessionId) === abortController) {
        sessionAbortControllers.delete(sessionId);
      }
    }
  });

  app.post("/api/abort", (req: Request, res: Response) => {
    const { session_id } = req.body as { session_id?: string };
    const sessionId = session_id || "default";
    const abortController = sessionAbortControllers.get(sessionId);
    if (!abortController) {
      return res.json({ status: "idle" });
    }

    abortController.abort();
    return res.json({ status: "aborted" });
  });

  app.post("/api/clear", (req: Request, res: Response) => {
    const { session_id } = req.body as { session_id: string };
    const sessionId = session_id || "default";

    const abortController = sessionAbortControllers.get(sessionId);
    if (abortController) {
      abortController.abort();
      sessionAbortControllers.delete(sessionId);
    }

    if (sessionClients.has(sessionId)) {
      const client = sessionClients.get(sessionId)!;
      client.clearHistory();
      sessionClients.delete(sessionId);
      sessionClientOptions.delete(sessionId);
    }

    res.json({ status: "success" });
  });

  app.post("/api/models", async (req: Request, res: Response) => {
    const { config } = req.body as { config?: PlaygroundConfig };

    try {
      const client = new AutoLLMClient(getClientOptions(config || {}));
      res.json({ models: await client.listModels() });
    } catch (error) {
      // a rejected key, an unreachable base URL, or a client that cannot list
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return app;
}

/**
 * Start the playground web server.
 *
 * @param host - Host address to bind to
 * @param port - Port number to listen on
 */
export function startPlaygroundServer(
  host: string = "127.0.0.1",
  port: number = 25751,
): void {
  // the playground exists to show what a model and its endpoint actually send, so unknown
  // stream output fails loudly here unless the caller says otherwise
  process.env.AGENTHUB_DEBUG = process.env.AGENTHUB_DEBUG ?? "1";
  const app = createChatApp();
  app.listen(port, host, () => {
    console.log(`Starting LLM Playground at http://${host}:${port}`);
  });
}
