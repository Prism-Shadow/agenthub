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
 * Example demonstrating the AgentHub Tracer.
 *
 * This example shows how to:
 * 1. Create a tracer instance
 * 2. Save conversation history
 * 3. Start the web server to view saved conversations
 */

import { Tracer } from "../src/integration/tracer";
import { UniMessage } from "../src/types";

console.log("=".repeat(60));
console.log("AgentHub Tracer Example");
console.log("=".repeat(60));

const tracer = new Tracer();

const history: UniMessage[] = [
  {
    role: "user",
    content_items: [
      {
        type: "text.done",
        text: "Hello, how are you?",
      },
    ],
  },
  {
    role: "assistant",
    content_items: [
      {
        type: "text.done",
        text: "I'm doing well, thank you! How can I help you today?",
      },
    ],
    usage_metadata: {
      prompt_tokens: 10,
      thoughts_tokens: null,
      response_tokens: 15,
      cached_tokens: null,
    },
    finish_reason: "stop",
  },
];

const config = {
  model: "gpt-5.5",
  temperature: 0.7,
  max_tokens: 1000,
};

console.log("\nSaving example conversation...");
tracer.saveHistory(config.model, history, "example/conversation_001", config);

console.log("\nConversation saved successfully!");
console.log("\nStarting web server...");
console.log(
  "\nOpen http://127.0.0.1:25750 in your browser to view saved conversations!",
);
console.log("Press Ctrl+C to stop the server.\n");

tracer.startWebServer("127.0.0.1", 25750);
