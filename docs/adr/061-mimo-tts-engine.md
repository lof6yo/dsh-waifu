# ADR-061：接入小米 MiMo TTS（多供应商引擎 + 风格指令）

- 状态：Accepted
- 日期：2026-11-10

## 背景

语音合成原先只有一条实现：OpenRouter 的 `/api/v1/audio/speech`（ADR-033/051），
把 `{ model, input, voice }` POST 出去、拿回原始音频字节。想用小米 MiMo
（`mimo-v2.5-tts`）时，请求形状完全不同：

- 端点是 OpenAI **Chat Completions** 形状：`https://api.xiaomimimo.com/v1/chat/completions`；
- 台词必须放在 `role: 'assistant'` 的消息里，`role: 'user'` 消息是**可选的风格指令**
  （自然语言描述语气、情绪，甚至导演级的「角色/场景/指导」），不会被念出来；
- 音频不在响应体里，而是 `choices[0].message.audio.data` 的 **base64**；
- key 是另一份凭据 `XIAOMI_API_KEY`（DSH 里已配好 `xiaomi` provider）。

也就是说：同一个设置项 `ttsModel` 下要能出现「形状完全不同的供应商」，
而不是把 MiMo 硬塞进 OpenRouter 的请求里。

## 决策

1. **目录内混排供应商**：`TtsModelOption` 新增可选 `provider?: 'openrouter' | 'mimo'`
   （缺省 = `openrouter`，老配置与目录外模型行为不变），新增
   `ttsModelProvider(id)` 供宿主分派引擎、供设置页决定显示哪些行。
2. **新增 `MiMoTtsEngine`**：与 `OpenRouterTtsEngine` 实现同一个 `TtsEngine` 接口
   （`synthesize(text, options, signal?, onPayload?)`），请求体由纯函数
   `mimoBody()` 生成（assistant 放台词、user 放风格指令、`audio.format: 'mp3'`、
   `stream: false`），应答解析 base64 成 `Buffer`；错误沿用 `tts-http <status>: <原因>`、
   `tts-key-missing`、`tts-empty-audio`。
3. **两种引擎共用磁盘缓存**：都是 mp3，缓存目录与键规则不变；
   `ttsCacheKey` 只在风格指令**非空**时把它并进键，避免旧缓存全体失效。
4. **新增设置 `ttsStyle`**（风格指令，字符串，默认空，最长 200 字）：
   随 `voiceOptions()` 发给引擎；只有 MiMo 引擎消费它，OpenRouter 引擎忽略。
   设置页在选中 MiMo 时显示这一行（单行输入，回车/失焦保存），换回千问时隐藏但不丢值。
5. **目录新增 `mimo-v2.5-tts`**，音色用 MiMo 的预置音色名（中文名直接作为 `voice` 值）：
   冰糖（默认）/ 茉莉 / 苏打 / 白桦 / Mia / Chloe / Milo / Dean。
6. **传输沿用 ADR-051**：`MiMoTtsEngine` 默认 `fetcher` = `directTtsFetcher`（直连 + 失败回落代理 + 自持连接池），
   key 由宿主用 `ctx.credentials.resolve('XIAOMI_API_KEY')` 按需解析。

## 备选方案

- **把 MiMo 包装成 OpenAI `/audio/speech` 兼容层**：需要自建转换代理，多一个进程/端口，
  且 `user` 消息（风格指令）无处安放。
- **只改端点、复用 OpenRouter 的 body**：形状不兼容（没有 `input`/`response_format`，
  音频在 JSON 里），等于新增引擎，不如直说。
- **把风格指令塞进台词前缀（如 `（温柔）台词`）**：会污染气泡显示与历史记录
  （同一句台词多出「（温柔）」），且入口不可控；MiMo 的 `user` 消息正是为此设计。
- **新增独立的「引擎」设置项**：多一个要和模型联动、还要迁移的组合维度；
  目录项自带 `provider` 足够区分，用户只需选模型。

## 影响

- `src/tts.ts`：`TtsVoiceOptions.style`、`TtsPayload.body` 放宽为 `Record<string, unknown>`、
  `ttsCacheKey` 纳入非空 style、`MIMO_SPEECH_URL`、`MiMoTtsEngine`、`mimoBody`。
- `src/defaults.ts`：`TtsProvider`、`TtsModelOption.provider`、MiMo 目录项、
  `ttsModelProvider`、`DEFAULT_TTS_STYLE` / `TTS_STYLE_MAX_CHARS` / `normalizeTtsStyle`、
  `DEFAULT_SETTINGS.ttsStyle`。
- `src/index.ts`：按 `ttsModelProvider(model)` 在 `OpenRouterTtsEngine` / `MiMoTtsEngine` 之间分派；
  凭据解析抽成 `credentialRef(name)`；`voiceOptions()` 带 `style`。
- `src/service.ts` / `src/settings-store.ts` / `src/client/settings.ts`：`ttsStyle` 走一遍
  PetConfig → view → 设置文件（归一化：去空白 + 截断 200）→ 设置页输入行。
- 兼容性：`settings.jsonc` 不必升版本（新字段用 Config 默认值兜底）；老缓存不受影响；
  切到 MiMo 时若没配 `XIAOMI_API_KEY`，会是「没声音但文字照常上屏」的既有容错路径。
- 成本：MiMo 目前限时免费；两种引擎共用 200 段本地缓存与同一套清理策略。
