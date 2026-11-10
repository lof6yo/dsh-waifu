# ADR-063: 文字流式与语音流式拆成两个开关，MiMo 走整段流式合成

## Status

Accepted

## Date

2026-11-10

## Context

ADR-033 起，演绎管线是「LLM 文本增量 → 按句读切段 → 每段单独合成 → 按序下发播放」。这样首声快：第一句说完（几十字）就能开口，不必等整段回复写完。

但它有一个固有代价：**每段音频是独立请求**。TTS 不知道前后文，逐段的语气、语速、句尾收束都各自为政。千问的音色比较平，段与段接缝听起来只是「略微顿一下」；MiMo 的语气起伏大，同样的接缝听起来就是「一句一句在念稿」，也就是用户说的「比较难听」。

MiMo 从 2026-11 起提供流式合成（`stream: true` + `audio.format: 'pcm16'`，SSE 的 `choices[0].delta.audio.data` 是 base64 的 PCM 分片）。整段台词一次请求、边收边播，语气就是连贯的一整段。实测同一条 51 字回复：

- MiMo 整段非流式 mp3：2959 ms 才拿到音频（整段 75 KB）；
- MiMo 整段流式 pcm16：**803 ms 出第一片音频**，2757 ms 收完（30 片，468 KB，约 9.8 s 音频）；
- 千问整段（经 OpenRouter，无流式）：2643 ms。

也就是说：整段合成必须有流式兜着，否则 MiMo 会先静默约 3 秒。同时，「等整段回复写完再合成」和「边生成边合成」是两个独立的取舍，分别对应用户已经习惯的两种体验：

- 千问：文字流式开、语音流式关 = 现在这样（首声快，接缝略顿，可接受）；
- MiMo：文字流式关、语音流式开 = 等整段写完，再一次流式合成（首声 = 整段写完 + 0.8 s，但语气连贯）。

OpenRouter 的 `/api/v1/audio/speech` 没有流式语义（实测加 `stream: true` 返回字节数完全一样，参数被忽略），千问要真流式只能直连 DashScope 并另配 `DASHSCOPE_API_KEY`，因此语音流式目前只有 MiMo 能兑现。

## Decision

1. **两个独立开关**，都在「语音」卡片里：
   - `llmStreaming`（「文字流式」，**默认开**）：LLM 回复是否流式拿。开 = 边生成边切句；关 = 用 `generateReply` 一次性拿完整回复。
   - `ttsStreaming`（「语音流式」，**默认关**）：整段台词是否一次合成并流式播放。**只在选中 MiMo 时显示**（与 ADR-062 的「风格控制」同口径），其它模型下整行隐藏、值不参与逻辑。
2. **合成粒度由两个开关共同决定**（宿主的 speak 路由里一处判定，客户端不需要知道）：
   - `ttsStreaming` 开 → **整段一次合成**（MiMo 走 SSE 流式）；
   - 否则 `llmStreaming` 开 → **逐句合成**（现状，ADR-033）；
   - 否则 → **整段一次合成，非流式**（整段音频一次下发）。
   于是千问默认组合与改动前逐字节一致；MiMo 推荐组合（文字关 + 语音开）走整段流式。
3. **MiMo 流式实现**：`MiMoTtsEngine.synthesizeStream()` 用 `stream: true` + `audio.format: 'pcm16'` 发同一 endpoint，解析 SSE，把每个 `delta.audio.data` 解码成 PCM 分片 yield 出去；同时累积，结束后写成 **WAV** 放进同一套缓存（键仍含 model/voice/style/text）。下次命中缓存就直接整段 PCM 下发（不再请求）。
4. **SSE 新帧**：`audio.chunk`（`{ index, seq, sampleRate, channels, format: 's16le', data }`）与 `audio.end`（`{ index, seconds }`）。逐句模式与「整段非流式」仍用原来的 `audio` 帧（`{ index, mime, data }`），客户端两条路径都要支持。
5. **客户端增量播放**（`src/client/index.ts`）：PCM 分片 → `Int16Array` → `Float32Array` → `AudioBuffer(1, n, 24000)` → 用 `nextStartTime = max(ctx.currentTime + 0.05, nextStartTime)` 排进时间轴，天然无缝；口型分析器改成**常连 `destination`**（`playClip` 只断自己的 source），打断时停止所有已调度的 source。
6. **整段模式的表现**：气泡一次显示整段（`clause` 帧只有一段）；表情/动作 cue 仍走 `clause.cues`，在该段开始播时一次执行（整段模式没有「第 N 句」可以错开）。逐句模式的行为完全不变。
7. 调试：控制台里 `tts.request` 的 body 能看出这轮是 `stream:true/pcm16` 还是 `mp3`；`audio.end` 帧带总时长，`play.audio` 在整段模式下记一条汇总。

## Alternatives Considered

### 备选方案 A：只把 MiMo 非流式格式从 mp3 换成 wav

- Pros: 一行改动，省掉 mp3 编码等待。
- Cons: 整段仍要等 3–4 s 才有声音；且逐句拼接的根本问题没解决。
- Rejected: 延迟更差，问题也没解决。

### 备选方案 B：客户端把逐句音频拼成一条播放

- Pros: 不改宿主、不改接口。
- Cons: 拼接只能消掉「段间静默」，消不掉每段各自生成的语气与句尾收束——听起来仍是逐句念稿。
- Rejected: 症状在合成端，不在播放端。

### 备选方案 C：每段合成时把前后文一起带上（让 TTS 知道上下文）

- Pros: 只改 prompt/请求，不动播放器。
- Cons: 每段都要重发整段文字、费用与延迟翻倍；MiMo 的每段请求仍是独立生成，语气依旧不连续。
- Rejected: 成本高、收益不确定。

### 备选方案 D：千问也直连 DashScope 走真流式

- Pros: 千问也能整段流式，首声更快。
- Cons: 需要另外配置 `DASHSCOPE_API_KEY`，且要维护第二套供应商协议；当前 OpenRouter 通道整段 2.6 s 已经可接受。
- Rejected: 这次的目标是 MiMo 衔接，不为千问引入新依赖。

### 备选方案 E：只用一个「流式」开关同时控制两端

- Pros: 设置页简洁。
- Cons: 两个取舍正交（要不要边写边播 vs 要不要整段语气连贯），合并后无法表达「文字流式 + 整段非流式」这种组合，也无法让千问保持现状。
- Rejected: 用两个开关，各自独立。

## Consequences

- 设置页「语音」卡片新增两行：「文字流式」（默认开）与「语音流式」（默认关、仅 MiMo 显示）。
- 整段模式下首声延迟 = LLM 整段写完的时间 + TTS 首片（MiMo 约 0.8 s）；逐句模式不变。
- 整段模式的气泡一次性出现、表情/动作集中在开头；这是「语气连贯」换来的，用户可在两个开关间自行取舍。
- MiMo 缓存从 mp3 变成 WAV（24 kHz 单声道 16 bit ≈ 48 KB/s，一条 10 s 台词的音频约 480 KB），缓存条数上限仍按文件数算（200），清理逻辑按 `.mp3`/`.wav` 两种后缀一起统计。
- 千问路径、逐句管线的请求形状与提示词完全不变；`/interact`（一次性回复）不受影响。
- 客户端新增一条音频调度路径；`analyser` 从「每段接一次、播完断开」改成常连，需要保证 `stopSpeaking` 时把已调度的 source 全部停掉，否则会出现「声音停了口型还在动」。
