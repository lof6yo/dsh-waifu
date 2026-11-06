# ADR-043：开发者选项里的调试控制台（事件 + 原始报文）

- 状态：Accepted
- 日期：2026-11-06

## 背景

排查「模型为什么不回」「语音为什么没声」时，需要看两样东西：

1. **客户端事件流**：什么时候触发、SSE 回了哪些帧（`text`/`clause`/`audio`/`tags`/`memory`/`done`/`error`）；
2. **真正发出去的报文**：system prompt 全文、每条 message、TTS 请求体（模型、音色、input、是否命中缓存）。

此前只能翻 `~/.dsh/waifu/client.log`（只有日志、没有报文）或用 curl 打 `/ai-debug`（只有最后一次、还得手动）。

## 决策

在调试面板（开发者选项）里加一块「控制台」，**手动开启才记录；停止记录只暂停追加、已记录内容保留**（「清空」按钮或关闭面板才清除）：

- 记录源：
  - `clientLog()` 的每一条（通过新增的 `setClientLogObserver()` 同页观察者转发，不改上报行为）；
  - `/speak` 的每个 SSE 帧原文（`audio` 的 base64 换成 `<base64 N KB>`，避免几十 KB 撑爆面板）；
  - `/interact` 的返回体；
  - 每轮结束后拉一次 `/ai-debug`，把 `lastPayload`（provider/model/system/逐条 messages）、
    `lastTtsPayload` / `lastSpeakPayload`（endpoint/body/cached）落成多行。
- 渲染：单行 `<div>` 追加（`时间 | 标签 | 原文`），上限 300 行、单行 4000 字符，超出从头丢弃；
  贴底时自动滚动，翻到上面看历史时不打断。可视区固定 20 行（行高 16px）在框内滚动。
- 「复制」：把 DOM 里现存的全部行按行拼成纯文本（保留时间与标签）写进剪贴板，用于把一次排查原样贴到 issue / 编辑器；
  优先 `navigator.clipboard`（https / localhost 才有），非安全上下文回落 `textarea + execCommand('copy')`，按钮上给「已复制 / 无内容 / 复制失败」1.2s 反馈。
- 生命周期：`conRecording === false` 时 `conPush()` 直接返回（零开销）；**停止记录不清空**——已记录行留在 DOM 里，重新开始记录接着往下追加（排查时经常要「停一下再开始」对照）；「清空」按钮清 DOM，调试面板关闭时一并置空引用（内容随面板消失）。

## 后果

- 排查不再需要 curl + 手拼请求；开着控制台点一下角色就能看到完整链路。
- 代价：开启期间每帧 SSE 都会建 DOM 节点（有上限、且只在开发者选项里），关了就没有开销。
- 报文里可能包含人设与记忆正文（都是本机文件内容），控制台不落盘、不发给 Host，仅屏上显示。

## 修订（2026-11-06）：改为「按发生顺序」的链路记录

**问题**：原实现「每轮结束后拉一次 `/ai-debug`」把 LLM 请求、TTS 请求一股脑倒出来，与 `clause`/`audio` 帧交错错乱——看到的顺序不是发生的顺序，排查时无法判断「这句台词到底配的是哪段语音、哪次请求」。

**决策**：

1. 顺序必须来自**真实时刻**，因此链路记录改由 Host 侧产出：在请求组装完、模型流结束、合成返回这三个时刻各产生一条 `TraceStep { phase, at, data }`（`src/trace.ts`）。
2. 分发方式跟着现有通道走，不新增端点：`/speak` 把每一步 emit 成 SSE `debug` 帧（即时到达），`/interact`（语音关闭的一次性路径）把 steps 放进响应的 `trace` 字段。
3. 载荷完整度按「可读性」取舍：请求给**完整 JSON**（system 提示词全文 + 每条 messages + 采样参数），模型回复给**完整原始输出**（`ai.ts` 新增 `onReply` 勾子，带 `raw`/`finish`/`error`）；TTS 回复只给摘要（`bytes`/`mime`/`cached`/`ms`），音频 base64 仍只报字节数。
4. 客户端不再轮询 `/ai-debug`（该端点保留给 curl 排查），改为在收到帧的当下 `conPushJson`，于是控制台顺序 = 到达顺序 = 发生顺序；`/interact` 的 trace 在响应返回后按数组顺序补齐。
5. `play.*` 行由客户端在**落地时刻**自己写（表情/动作实际应用、每段音频实际播放时长），补上「反应了什么」这一环。

**取舍**：`debug` 帧与业务帧共用一条 SSE，不额外开通道——顺序天然正确，也避免再维护一条连接；代价是 Host 侧每帧多一次 `JSON.stringify`（只在 AiPayload 级别，几十 KB 量级，仅在 /speak 期间发生）。
