# ADR-036：一次性「活动」提示（工具 / 审批 / 会话 / 子代理）

- 状态：已采纳（2026-11-06）
- 相关：ADR-012（交付庆祝）、ADR-017（打断/保持）、ADR-032（打断优先级）

## 背景

状态机只有 6 个状态（idle / thinking / error / done / waiting / delivered），
都是"一轮对话的粗粒度阶段"。但 DSH 还暴露了大量**瞬时**事件：
工具开始执行、审批被批准/被拒、会话新建/关闭、子代理进出。
这些如果都做成状态，状态机会爆炸、事件绑定表也会变成十几种；
但它们恰恰是"宠物在陪你干活"最有生命力的部分。

## 决策

新增与状态**正交**的「活动」通道：

1. `PetService` 订阅并归类成 11 种 `PetActivityKind`：
   - 工具：`tool-read` / `tool-write` / `tool-run` / `tool-agent` / `tool-other`（按工具名正则归类，`mcp__*` 忽略）
   - 审批：`approval-granted` / `approval-denied`（取 `approval/request` 的 waterfall 返回值）
   - 会话：`session-open` / `session-close`（只看顶层会话，子代理会话 `header.parentSession` 非空则跳过）
   - 子代理：`subagent-start` / `subagent-end`
2. 快照里带 `activity: { seq, kind }`，`seq` 单调递增；客户端只播比上次大的，SSE 重复推送不会重播。
3. 活动**只播短动作**，不写气泡、不进 AI、不改状态；动作复用现有 9 组：
   `tool-read/Glance`、`tool-write/Perk`、`tool-run/Shift`、`tool-agent/Nod`、`tool-other/Tilt`、
   `approval-granted/Nod`、`approval-denied/ShakeHead`、`session-open/Perk`、`session-close/Sigh`、
   `subagent-start/Glance`、`subagent-end/Nod`。
4. 客户端用 `MotionPriority.NORMAL` 播放：不会压状态动作，也不会压触摸的 FORCE。
5. 服务端 700ms 节流：读文件/跑命令一秒好几次，全播会抽筋。

## 后果

- 工具/审批/会话/子代理事件从此有表现，不必给每个事件加状态；
- 动作资源零新增（复用现有动作组），代价是区分度有限（"敲键盘"和"换重心"看起来像）；
- 若以后要更强的区分度，只需给 `ACTIVITY_MOTIONS` 换成新建的专有动作，无需改通道设计；
- 活动在调试预览、拖拽中、宠物隐藏时不播（避免干扰编辑与拖拽）。
