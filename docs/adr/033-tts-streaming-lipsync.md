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
模型、音色、演绎指令（`instructions`）全部来自设置项，默认 `fish-audio/drama-3`。

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
- 新增设置项 6 个（`ttsEnabled` / `ttsModel` / `ttsVoice` / `ttsInstructions` /
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

## 修订二：用「音色样本」钉住 Drama 3 的人声（2026-11-05）

修订一把默认换成了音色固定的 MAI-Voice，但用户实测「效果很差」，要求回到 Drama 3。Drama 3 的问题是
**没有固定音色**：模型本身不带 `supported_voices`，每次请求由供应商随机挑一个人声。

两条路：

1. Fish Audio 官方 API 用 `reference_id`（音色模型 id）固定人声，但需要 Fish 账号与 API key，
   本机不可达 `docs.fish.audio`，也无法在没有 key 的情况下枚举可用音色。
2. OpenRouter 支持 **无状态音色克隆**：请求里带
   `input_references: [{ type: 'input_audio', input_audio: { data: 'data:audio/mpeg;base64,…' } }]`，
   只有 endpoints 元数据 `supports_voice_cloning: true` 的模型接受这种请求——`fish-audio/drama-3` 正好是。
   代价是每次请求多传一段参考音频（请求体变大、多几百毫秒），换来的人声完全一致。

选择方案 2：不需要第二把 key，保留 Drama 3 的表演力。

实现：

- 设置项 `ttsReference`（默认空）：只存**文件名**，实际文件在 `$DSH_HOME/waifu/voices/reference.mp3`，
  样本跟着设置目录走，不进仓库也不进 git。
- 设置页「音色样本」行：`生成候选（3 条）` → 用同一句台词连发三次（每次随机人声）→ 逐条「试听」/「用这条」；
  采用后显示「已固定：reference.mp3（N KB）」，另有「清除已固定的样本」。
- Host 端：`GET /api/dsh-waifu/tts-sample`（状态）、`POST /api/dsh-waifu/tts-sample/candidates`（`{count}`）、
  `POST /api/dsh-waifu/tts-sample`（`{data}` 保存 / `{clear:true}` 清除）。保存限制 1 KB–8 MiB。
- `TtsVoiceOptions.reference` 为 data URI；`ttsCacheKey` 把 reference 的哈希算进缓存键，
  换样本自动换缓存，不会拿旧样本的音频顶替。
- `microsoft/mai-voice-2.1-flash` 从 `TTS_MODELS` 删除；默认回到 `fish-audio/drama-3` + 空音色 + 空样本。
- `SETTINGS_SCHEMA_VERSION` 5 → 6：旧文件里的 MAI-Voice 一律回落到 Drama 3（MAI 只存活了一个版本）。

后果：

- 未选样本时音色仍每句随机（这是 Drama 3 的默认行为，设置页会明说）。
- 选样本后每次请求都带一段 base64 音频，首声延迟比不克隆时高一点；音频按 `reference.mp3` 的 `mtimeMs:size`
  缓存成 data URI，不重复读盘转码。
- 样本质量直接决定音色：太短、噪声大或有背景音的样本会让合成变差，建议用插件自己生成的候选。

## 修订三：接入 Fish Audio 原生接口（2026-11-05）

用户提供了 Fish API key 与音色 id，希望在 Fish 侧用 `reference_id` 固定 drama-3 的人声
（比「每次传一段样本」更省流量，也不依赖 OpenRouter 的克隆能力）。

做法：语音层本来就只有一个 `TtsEngine` 接口，这轮把它扩成两个实现，设置页在**模型下拉**里
用两组选项表达「走哪个供应商」：

- `OpenRouter` 组：`fish-audio/drama-3` / `qwen/…-tts-plus` / `hexgrad/kokoro-82m`，
  走 `/api/v1/audio/speech`，drama-3 靠「音色样本」做无状态克隆。
- `Fish Audio` 组：`drama-3` / `s2.1-pro-free` / `s2.1-pro`，走 `POST https://api.fish.audio/v1/tts`，
  `model` 放请求头、`reference_id` 放请求体，音色由 Fish 侧固定，不需要样本。

细节：

- 设置项 `ttsEngine`（`openrouter` | `fish`）、`fishModel`、`fishVoice`（`reference_id`）、`fishApiKey`；
  下拉选中 `fish:x` 就写 `ttsEngine=fish` + `fishModel=x`，切回 OpenRouter 时原来的模型/音色还在。
- key 解析顺序：设置页填的 `fishApiKey` → DSH 凭据 `FISH_API_KEY`（`ctx.credentials`），都不落仓库。
- 两个引擎共用 `synthesizeWithCache()`（缓存键 / 超时 / 中止 / 错误透传一处实现），
  Fish 的错误体是 `{status, message}`，OpenRouter 是 `{error:{message}}`，统一压成
  `tts-http <status>: <原因>`。
- 选 Fish 时隐藏「音色样本」行（无状态克隆用不上），音色改为「音色 ID」文本输入。

已知限制（写在这里避免下次再踩）：

- 本机到 `api.fish.audio` 被 SNI 阻断（curl 报 `TLS connect error: unexpected eof while reading`，
  DoH 解出的 Cloudflare IP 直连同样被断），偶发能通一次。要在本机真正用上 Fish，
  需要在代理里给 `fish.audio` 加一条海外节点规则。
- Fish 的 **API 额度与订阅额度分开**：免费额度只覆盖 `s2.1-pro-free`；`drama-3` 需在
  fish.audio/app/developers/billing 单独充值，否则返回 `402 Insufficient API credit for this model.`
