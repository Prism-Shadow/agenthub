# Model SDK Documentation

This directory contains documentation and examples for all supported AI model SDKs.

## Available Models

To use a specific model, please refer to its dedicated README:

- **[Anthropic Messages protocol](./ant_messages/README.md)** - The Anthropic Messages-compatible protocol across Anthropic, OpenRouter, DeepSeek, Z.AI, and MiniMax (generic `ant_messages` client)
- **[Claude 4.6](./claude4_6/README.md)** - Anthropic's Claude 4.6 API documentation and examples
- **[Claude 4.7](./claude4_7/README.md)** - Anthropic's Claude 4.7 API documentation and examples
- **[Claude 4.8](./claude4_8/README.md)** - Anthropic's Claude 4.8 API documentation and examples
- **[DeepSeek V4](./deepseek_v4/README.md)** - DeepSeek V4 API documentation and OpenAI-compatible usage guides
- **[Gemini 3](./gemini3/README.md)** - Google's Gemini 3 API documentation and examples
- **[Gemini 3.6](./gemini3_6/README.md)** - Google's Gemini 3.6 generation (gemini-3.6-flash, gemini-3.5-flash-lite): sampling-parameter deprecation and thinking levels
- **[Gemini 3.7](./gemini3_7/README.md)** - Google's Gemini 3.7 generation (gemini-3.7-flash): same wire contract as 3.6, drops the `minimal` thinking level
- **[Gemini 3.8](./gemini3_8/README.md)** - Google's Gemini 3.8 generation (gemini-3.8-flash): same wire contract, capabilities and price table as 3.7
- **[GLM-5.1](./glm5_1/README.md)** - Z.AI's GLM-5.1 API documentation and examples
- **[GLM-5.2](./glm5_2/README.md)** - Z.AI's GLM-5.2 API documentation (reasoning_effort, thinking modes, tool streaming)
- **[GLM-5.3](./glm5_3/README.md)** - Z.AI's GLM-5.3 API documentation (forced thinking, reasoning_effort restricted to low/high/max)
- **[GPT-5.5](./gpt5_5/README.md)** - OpenAI's GPT-5.5 API documentation and examples
- **[GPT-5.6](./gpt5_6/README.md)** - OpenAI's GPT-5.6 generation (sol/terra/luna): reasoning modes, fast mode, and Responses migration
- **[GPT-6](./gpt6/README.md)** - OpenAI's GPT-6 generation (gpt-6-astra): same Responses wire contract as GPT-5.6, `reasoning.effort` without `none`/`minimal`, cache-write billing
- **[Kimi K3](./kimi_k3/README.md)** - Moonshot's Kimi K3 API documentation (reasoning_effort, tool calling, vision, caching)
- **[MiniMax M-series](./minimax_m3/README.md)** - Responses API-compatible documentation for MiniMax M3 and M2.7, plus Token Plan Subscription Key integration
- **[openai-chat-vllm-adapter model artifacts](./openai_chat_vllm_adapter/README.md)** - Upstream chat templates for the Qwen models served through vLLM, and the encoding module that stands in for one on DeepSeek V4; the source behind the adapter's per-model thinking switch
- **[OpenAI Responses protocol](./openai_responses/README.md)** - The OpenAI Responses-compatible protocol across OpenAI, OpenRouter, DeepSeek, Z.AI, and MiniMax (generic `openai_responses` client)

Each model directory contains:
- `docs/` - Detailed documentation for the model's features and capabilities
- `examples/` - Code examples demonstrating usage, when available
- `quickstart*.md` - Quickstart usage guide
