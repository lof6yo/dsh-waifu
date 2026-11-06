# ADR-043：开发者选项里的调试控制台（事件 + 原始报文）

- 状态：Accepted
- 日期：2026-11-06

## 背景

排查「模型为什么不回」「语音为什么没声」时，需要看两样东西：

1. **客户端事件流**：什么时候触发、SSE 回了哪些帧（`text`/`clause`/`audio`/`tags`/`memory`/`done`/`error`）；
2. **真正发出去的报文**：system prompt 全文、每条 message、TTS 请求体（模型、音色、input、是否命中缓存）。

此前只能翻 `~/.dsh/waifu/client.log`（只有日志、没有报文）或用 curl 打 `/ai-debug`（只有最后一次、还得手动）。

## 决策

在调试面板（开发者选项）里加一块「控制台」，**手动开启才记录、关闭即清除**：

- 记录源：
  - `clientLog()` 的每一条（通过新增的 `setClientLogObserver()` 同页观察者转发，不改上报行为）；
  - `/speak` 的每个 SSE 帧原文（`audio` 的 base64 换成 `<base64 N KB>`，避免几十 KB 撑爆面板）；
  - `/interact` 的返回体；
  - 每轮结束后拉一次 `/ai-debug`，把 `lastPayload`（provider/model/system/逐条 messages）、
    `lastTtsPayload` / `lastSpeakPayload`（endpoint/body/cached）落成多行。
- 渲染：单行 `<div>` 追加（`时间 | 标签 | 原文`），上限 300 行、单行 4000 字符，超出从头丢弃；
  贴底时自动滚动，翻到上面看历史时不打断。
- 生命周期：`conRecording === false` 时 `conPush()` 直接返回（零开销）；关闭记录清空缓冲区与 DOM；
  调试面板关闭时一并置空引用。

## 后果

- 排查不再需要 curl + 手拼请求；开着控制台点一下角色就能看到完整链路。
- 代价：开启期间每帧 SSE 都会建 DOM 节点（有上限、且只在开发者选项里），关了就没有开销。
- 报文里可能包含人设与记忆正文（都是本机文件内容），控制台不落盘、不发给 Host，仅屏上显示。
