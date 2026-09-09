# 变更日志

[English](CHANGELOG.md)

在这里，我们记录模型的新增与移除时间、主要功能更新、缺陷修复，以及关键版本的发布时间。每个发布版本在此保留一行简述；逐条目的摘要位于 `changelog/<version>/README.md`，且每个条目都会链接到自己的详情文件。

- [2026-09-09] [版本 0.4.11](changelog/0.4.11/README.zh.md)：注册表新增 GPT-6 Astra，共享的 GPT 客户端按其重命名为 `gpt6`，GPT-6 上的 `none` 思考等级收敛为 `low`；DeepSeek V4 Flash 各行改用 2026-09-10 起生效的价格，DeepSeek 图片改由纯文本拒绝名单把关而非 "vision" 子串，并预先登记 `deepseek-v4.1-flash`；通用 OpenAI Chat 与 Responses 客户端将纯文本工具结果作为纯字符串发送。

- [2026-09-04] [版本 0.4.10](changelog/0.4.10/README.zh.md)：注册表新增 Gemini 3.8 Flash 并将共享的 Gemini 客户端按其重命名，移除 Gemini 2 系列支持；注册表只记牌价、不再保留折扣字段；全部 thinking level 与 thinking summary 取值都保证送达；新增 vLLM 适配客户端，按所服务模型自身 chat template 读取的开关映射思考等级。

- [2026-09-02] [版本 0.4.9](changelog/0.4.9/README.zh.md)：GPT-5.6 对超过 30,000 patch 上限的图片改以高细节读取，不再拒收；提示词与工具返回里的图片都适用，GPT-5.6、OpenAI Responses、OpenAI Chat 三个 client 一并生效。

- [2026-08-26] [版本 0.4.8](changelog/0.4.8/README.zh.md)：注册表新增 `glm-5.3-flash`，提示词与工具返回里的图片都能读；其余 GLM 模型遇到图片条目会直接拒绝，而不是照发。

- [2026-08-25] [版本 0.4.7](changelog/0.4.7/README.zh.md)：Gemini client 把 function response 拆分为独立的 content，修复消息里工具结果与文本混排时（被中断轮次的 carry-over 随下一条 prompt 重发、或工具输出折叠进摘要请求）Vertex AI 报 400 `Requests ending with a model turn are not supported.` 的问题。

- [2026-08-21] [版本 0.4.6](changelog/0.4.6/README.zh.md)：注册表新增 `deepseek-v4-flash-vision-exp`，提示词与工具返回里的图片都能读；DeepSeek client 改用 OpenAI Responses 协议；全部 Responses client 按模型产出的顺序回放内容条目；内部的 `unused` 事件不会流到调用方；Playground 把语音回复合成一条音频播放，并在刷新后保留配置。

- [2026-08-20] [版本 0.4.5](changelog/0.4.5/README.zh.md)：流式 client 默认静默跳过自己不认识的输出，`AGENTHUB_DEBUG` 开启时才抛出；`AutoLLMClient` 可以列出 endpoint 提供的模型 id；全部 client 支持传入默认 header 以对接要求特定 header 的 endpoint；注册表新增 GLM-5.3 与 `claude-opus-5`；OpenRouter 条目改用 `openai-responses` client。

- [2026-08-19] [版本 0.4.4](changelog/0.4.4/README.zh.md)：思考档位在 `XHIGH` 之上新增 `MAX` 一档，各 client 按自家服务方的 effort 取值映射整条档位（DeepSeek 依其当前的 low/high/max 取值重排）。

- [2026-08-18] [版本 0.4.3](changelog/0.4.3/README.zh.md)：所有流式 client 跳过网关在长生成期间注入的心跳事件，覆盖 OpenAI Responses、OpenAI Chat Completions、Anthropic Messages 与 Gemini 四种协议。

- [2026-08-18] [版本 0.4.2](changelog/0.4.2/README.zh.md)：通用 OpenAI Responses 与 Anthropic Messages 协议 client，覆盖 OpenAI、OpenRouter、DeepSeek、Z.AI 与 MiniMax（通用 chat client 重命名为 `openai-chat`），支持 GPT-5.6，新增 `UniConfig.fast_mode`，并统一 Claude 与 Kimi 系列 client、对全家族拒绝 `temperature`。

- [2026-07-22] [版本 0.4.1](changelog/0.4.1/README.zh.md)：支持 Kimi K3、Gemini 3.6 代（gemini-3.6-flash、gemini-3.5-flash-lite）与 GLM-5.2，新增包含美元/人民币定价、上下文窗口与模态信息的受支持模型注册表，以及 `UnsupportedParameterError` 参数错误类。

- [2026-07-20] [版本 0.4.0](changelog/0.4.0/README.zh.md)：以 `fidelity` 内容项载荷取代 `signature`/`phase`（破坏性变更），OpenAI 兼容客户端原样回放上游的 reasoning 字段，支持 Claude 5，并强化了工具调用的流式处理。

- [2026-06-01] [版本 0.3.3](changelog/0.3.3/README.zh.md)：OpenAI 兼容的 embedding 输入格式。

- [2026-05-30] [版本 0.3.2](changelog/0.3.2/README.zh.md)：Claude 4.8、通用的 OpenAI Chat Completions 兼容客户端、中止支持、智能体技能，以及一次大范围的模型更新。

- [2026-04-28] [版本 0.3.1](changelog/0.3.1/README.zh.md)：Gemini TTS 与图像生成、GPT-5.5、UModelVerse 供应商，以及 Claude 的自动缓存。

- [2026-03-11] [版本 0.3.0](changelog/0.3.0/README.zh.md)：具备自适应思考能力的 Claude 4.6、带阶段标签的 GPT-5.4、Amazon Bedrock 上的 Claude，以及 GLM-5。

- [2026-01-22] [版本 0.2.0](changelog/0.2.0/README.zh.md)：Gemini 3、Claude 4.5、GLM-4.7、GPT-5.2 与 Qwen3 模型，以及面向 Claude 的提示缓存。
