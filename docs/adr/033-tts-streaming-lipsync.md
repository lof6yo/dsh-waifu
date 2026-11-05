# ADR-033：语音合成按句读流式，气泡与口型吃同一段音频

## 背景

「简」能演、能说话（AI 一句台词），但没有声音。目标是把台词说出来，并且三件事同步：

1. 气泡显示的文字，与正在播放的语音是同一句；
2. 口型（`ParamMouthOpenY`）跟着真实音频的张合，而不是按字数瞎动；
3. 首声别等整句都出来——一句台词十几个字，等模型写完再合成太慢。

约束：

- 模型 `简.model3.json` 的 `Groups` 只有 `EyeBlink` 与 `LipSync: ['ParamMouthOpenY']`，没有表情组；
- vendor 的 `live2d-display.cubism4.min.js` **没有** `speak()` / AudioContext 封装（grep `speak` 命中 0），口型必须自己驱动；
- 现有 5 个动作只写 `ParamMouthForm`，不碰 `ParamMouthOpenY`，不会和口型打架；
- 用户的 key 已在 DSH 凭据服务里（`OPENROUTER_API_KEY`），不应在插件配置里再存一份。

## 决策

### 1. 引擎抽象成 `TtsEngine`，默认实现走 OpenRouter

`src/tts.ts` 定义 `TtsEngine.synthesize(text, voice, signal)`，默认实现 `OpenRouterTtsEngine` 打
`POST https://openrouter.ai/api/v1/audio/speech`（OpenAI 兼容，返回原始 `audio/mpeg` 字节）。
模型与音色全部来自设置项，默认 `fish-audio/drama-3`。

换供应商（ElevenLabs / MiniMax 的 PCM 真流式）只加一个实现，路由、客户端不动。key 每次合成时
通过 `ctx.credentials.resolve('OPENROUTER_API_KEY')` 取，不缓存、不落盘、不进插件配置。

### 2. 按「句读」流式，而不是按字

`src/ai.ts` 新增 `streamReply()`（复用 `generateReply` 的 system 提示词与 `sanitizeLine`），
把 LLM 的 `text-delta` 原样吐出来；`src/speak.ts` 的 `runSpeakPipeline()` 做三件事：

1. 累计增量，遇到标点（`。！？…，、；` 等）就把已完整的段切出来，**最后一段可能还没说完，留在缓冲区**；
2. 每切出一段立刻丢给 TTS 合成，`clause(i)` 事件先下发；
3. 音频**按序号严格串行下发**——后段先合成好也要等前段播完，否则口型会对错嘴。

切分与合并规则（`splitClauses`，纯函数、有测试）：过短的片段并入下一段（避免「呀」单独合成一次），
超过 24 字硬切，空文本不产生段。

### 3. 气泡按音频进度逐段显示

客户端不按 `clause` 事件直接写字，而是**在对应音频开始播放时**才把气泡补到那一段
（`revealClausesUntil(index)`）。这样文字与声音永远同段；某段合成失败（返回 null、没有 `audio` 事件）
时，后一段开播会把被跳过的段一起补上，不会丢字。

### 4. 口型吃同一段音频的波形

`playClip()` 把每段 mp3 解码后接到一个共享 `AnalyserNode`，渲染循环里读时域波形算 RMS，
`ParamMouthOpenY = clamp(RMS × 6 × 强度)`，张得快（0.6）、收得慢（0.28）模拟真人的包络。
`lipsyncGain` 是 0–300% 的强度，`lipsyncEnabled` 可整体关掉。

浏览器自动播放策略：`AudioContext` 在**用户手势**里创建/恢复（`handleTap` 与命中层点击），
不在加载时抢跑。

### 5. 失败一律降级，不阻塞说话

- 语音关（`ttsEnabled=false`）→ 客户端走原来的一次性 `/interact`，行为与 ADR-025 完全一致；
- 流里一句都没出来（禁用/冷却/零文本）→ 同样回落 `/interact`；
- 个别段合成失败 → 只是没声音，文字照常上屏；
- 全文超过 400 字 → 截断合成（防止模型跑飞把气泡拖成独白）。

## 后果

- 首声延迟 ≈ 首段合成时间（Fish Audio 中文短句约 0.8–1.5s），而不是整句写完再合成；
- 多花一个 HTTP 请求量：每句台词 = 1 次 LLM 流 + N 次 TTS（N = 句读数，通常 2–4），
  同文同参数命中本地缓存（`$DSH_HOME/waifu/tts-cache`，最多留 200 个 mp3）后不再计费；
- 台词与气泡严格同段，代价是气泡不是「打字机」逐字出现，而是逐段出现——用户明确要的是
  「气泡和语音和 lipsync 一起」，逐段出现在观感上更像人在说话；
- 新增设置项 4 个（`ttsEnabled` / `ttsModel` / `ttsVoice` /
  `lipsyncEnabled` / `lipsyncGain`），Host 变更需重启 dsh-web 才生效；
- 真流式（PCM 边收边播）留给将来的引擎实现：`TtsEngine` 接口不变，客户端只需支持
  「一段音频分多个 chunk 到达」。

## 修订：音色必须可固定（2026-11-05）

初版默认 `fish-audio/drama-3` + 空音色。实测发现 Drama 3 在 OpenRouter 上没有 `supported_voices`
（`/api/v1/models/fish-audio/drama-3-20261013/endpoints` 返回 `supported_voices: null`），
每次请求都会挑新的人声——同一句话连发两次，音色完全不同。

决策：

- 新增 `TTS_MODELS` 目录（`src/defaults.ts`），只收「音色可固定」的模型：微软 MAI-Voice 2.1 Flash
  （`zh-CN-Mei` / `zh-CN-Lan` / `zh-CN-Wei` / `zh-CN-Bo` / `en-US-Iris`）、通义千问 TTS Plus
  （`longanlingxin` / `longanlufeng`）、Kokoro 82M（`zf_xiaoxiao` 等）。Drama 3 保留但标注
  `randomVoice: true`，选中时音色下拉禁用并提示「每句都会换人声」。
- 默认改成 `microsoft/mai-voice-2.1-flash` + `zh-CN-Mei:MAI-Voice-2.1-Flash`。
- 设置页模型/音色从文本框改成下拉；换模型时音色自动跟到该模型首个音色；存档里的目录外
  模型/音色仍作为「自定义」项显示，不会被静默改写。
- `SETTINGS_SCHEMA_VERSION` 4 → 5：旧文件若为「随机音色模型 + 空音色」，加载时迁移到新默认
  （其余情况原样保留）。

## 修订二：去掉「音色样本」与「演绎指令」（2026-11-05）

音色样本（无状态克隆）与演绎指令（`instructions`）两条路都试过后被用户否决：设置页多两行、多三个接口，
实际收益不足以抵消维护成本与请求体积。现在的语音链路只保留三件事：

- 模型（下拉，`TTS_MODELS` 目录）与音色（下拉；随机音色模型没有音色列表）；
- 句读级流式合成 + 气泡跟随音频 + 口型跟随；
- 本地缓存（`$DSH_HOME/waifu/tts-cache`）。

随之删除：`ttsReference` / `ttsInstructions` 两个设置项、`voices/` 目录、`GET|POST /tts-sample*` 三个接口、
`TtsVoiceOptions.reference` 与 `TtsVoiceOptions.instructions`。`fish-audio/drama-3` 仍是默认模型
（它本身没有固定音色，每句人声会变）；想固定音色请换用 `TTS_MODELS` 里带音色列表的模型（qwen / kokoro）。

`SETTINGS_SCHEMA_VERSION` 保持 6：旧文件里的这两个键会被忽略（未知键不报错），下次保存即消失。
