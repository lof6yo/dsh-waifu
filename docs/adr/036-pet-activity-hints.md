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

## 修订（2026-11-06）：子代理不驱动状态

实测发现：主代理还在跑时派一个子代理，子代理 turn 结束会触发 `agent/turn-stopping`，
宠物立刻切成「完成」庆祝（我的分身干完活，它在欢呼）。

改法：`subagent/start` 里记下子代理的 `info.id`（只增不删，id 唯一），
`agent/status` / `agent/error` / `agent/turn-stopping` 先看 `payload.agent.id` 是否在这个集合里，
是就忽略。活动提示不受影响（`subagent-start/end` 仍然播）。

## 修订二（2026-11-06）：活动事件也走事件绑定 + AI

最初活动只播动作。用户要求「这几个新加的事件应该和之前的事件一样触发 llm」，
于是把活动键并入 `PetEventKey`（`ACTIVITY_EVENTS` 11 个），与状态事件共用：

- `EventBindings` 覆盖 17 个键；`DEFAULT_EVENT_BINDINGS` 给每个活动配了默认台词池与动作；
- 客户端 `applyActivity()` 改成：按绑定的动作/表情播放 → 出预置台词 → `requestSpeak({ kind:'state', state: 活动键 })`；
- `buildSceneMessage()` 增加 `ACTIVITY_SCENES`（读文件 / 写文件 / 跑命令 / 派代理 / 审批通过 / 审批被拒 / 新会话 / 会话结束 / 子代理进出），AI 文案据此演绎；
- 设置页「事件绑定」按 `EVENT_ORDER` 列出 17 张卡（状态 6 + 活动 11），可改动作/表情/台词，与状态事件完全一致。

代价：事件绑定区变长；收益：活动不再只有哑动作，能说话、能按人设演。

## 修订三（2026-11-06）：同类节流 + 静默内部工具

实测两个噪音问题：

1. 节流是**全局** 700ms：派代理时 `tool-agent` 刚推完，紧随其后的 `subagent/start` 就被吞掉，
   日志里只看到 `subagent-end`。改成 `lastActivityAtByKind`（按 kind 记账），同类才节流。
2. 一次 turn 里 `compress` / `acp_*` / `todo_write` / `mnemon_*` / `skill` / `present` /
   `ask_user_question` 这些内部工具调用频繁，全都落到 `tool-other` 疯狂「顺手做了。」。
   新增 `QUIET_TOOLS` 白名单式静默；`mcp__*` 与之前一样忽略。

代价：同一类爆发仍会合并；收益：活动提示只对「真正做事」的工具与用户可见事件发声。
