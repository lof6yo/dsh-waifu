# ADR-025：AI 回复（复用 DSH 的 llm 服务 + 人设文件）

- 状态：Accepted
- 日期：2026-11-05

## 背景

桌宠的台词目前全部是写死的预置文本（`presets.jsonc` / `touch-parts.jsonc`），用户希望它能"活"起来：
设定一个人设，模型感知到事件（事件绑定、触摸部位）之后自己接一句话。

插件已经适配 DSH 0.2.x 的插件模型（ADR-013），Host 半区有 `ctx`，
而 DSH 提供了 provider 中立的 LLM 服务 `@deepseek-ai/dsh-llm`：

- `ctx.llm.stream(options: GenerateOptions): AsyncIterable<StreamChunk>`，
  `options` 里只需 `provider` / `model` / `messages`（可选 `system` / `temperature` / `maxTokens` / `stop` / `signal`）；
- `provider` 与 `model` 就是 DSH 设置里已配置好的路由（本机实测为 `deepseek-official` / `deepseek-flash`），
  凭据由 DSH 的 credentials 层托管，插件不需要、也不应该再存一份 API Key。

## 决策

1. **走 Host，不走浏览器**：客户端只 POST `/api/dsh-waifu/interact`（"戳了哪里 / 变成什么状态"），
   Host 调 LLM 后把一句文本回传。理由：API Key 不能进浏览器；而且这样客户端在模型未加载时也能用。
2. **复用 DSH 已配置的模型**：设置项 `aiProvider` / `aiModel` 默认 `deepseek-official` / `deepseek-flash`，
   用户可改；`inject` 增加 `llm`。
3. **人设文件**：`$DSH_HOME/waifu/persona.md`，首次使用自动落盘默认模板（点 1：短句口语、不要旁白、不自称 AI）。
   放文件而不是设置页文本框：人设是长文本，值得单独版本管理、手改更方便。
4. **一句一台词**：`maxTokens: 80`、`stop: ['\n']`、`temperature: 1`；
   `sanitizeLine()` 取第一行、去引号、超过 60 字截断（气泡宽度有限，spec §4）。
5. **预置台词做兜底**：客户端先显示预置台词（体验上零延迟），AI 台词到了再替换；
   请求失败 / 超时（12s）/ 模型返回空 → 保持预置台词，不弹错误。
6. **触发策略**：触摸每次命中都请求；状态只在非 `idle` 切换时请求；
   Host 侧 1.2s 全局冷却（`cooldown`），客户端侧只采用最后一次请求的结果（连点不叠加）。
7. **不做流式渲染**：先一次性拿完整句（气泡很短，流式的收益极小），等将来做长对话再考虑 SSE 增量。

## 后果

- 插件多一个运行时依赖（`llm` 服务），在没有任何 LLM provider 的 DSH 里 `inject` 会让插件加载失败；
  这是可接受的取舍（DSH 默认就带 deepseek provider）。若要更保守，可改为 `ctx.get('llm')` 探测式接线。
- 每次触摸都会消耗 token（一句 ≤80 token），默认 `aiEnabled: false`，由用户显式开启。
- 台词质量取决于人设文件；调语气 = 改 `persona.md`，不需要改代码。
