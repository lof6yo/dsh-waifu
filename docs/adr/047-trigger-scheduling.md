# ADR-047：触发调度归一化（一个调度器 + 一张策略表）

- 状态：已采纳（Accepted，2026-11-07 实现）
- 日期：2026-11-07

## 背景

「什么时候真的去请求 LLM」这件事，现在由 **15 个互不相干的判断**决定，分散在 Host 和客户端两个进程里，而且其中三处已经跑偏：

| # | 位置 | 机制 | 值 | 触发源 | 拦下后 |
|---|---|---|---|---|---|
| 1 | `src/index.ts:294` `beginAiTurn` | Host 硬冷却 | `AI_COOLDOWN_MS = 1200` | 全部 | 返回 `error: cooldown`，客户端收到后静默丢弃 |
| 2 | `src/client/index.ts:1165` `eventIntervalPassed` | 事件最小间隔 | `aiMinIntervalSec`（默认 1s） | 事件 | 直接丢弃，无提示 |
| 3 | `src/client/index.ts:1201` `fireTrigger` | 场景开关 | `eventTriggers`（16 个 key） | 事件 | 丢弃 |
| 4 | `src/client/index.ts:1123` `aiCooldownLeft` | 触摸防抖 | `AI_REQUEST_COOLDOWN_MS = 1200` | 触摸 | 延后补发（**死代码**） |
| 5 | `src/client/index.ts:1228` `fireTrigger` | 排队 | `triggerMode === 'queue'` | 事件 | 塞进 `pendingTrigger`，只留最新一条 |
| 6 | `src/client/index.ts:1250` `startTurn` | 抢占 | `triggerMode === 'interrupt'` | 事件 | `speakSeq += 1` 作废上一轮 |
| 7 | `src/client/index.ts:1241` `startTurn` | 合并 | `merged` 数组 | 事件 | 并进下一轮场景句 |
| 8 | `src/client/index.ts:1445` `applyActivity` | seq 去重 | `lastActivitySeq` | 事件 | 丢弃重复帧 |
| 9 | `src/client/index.ts:1203` `fireTrigger` | 页面隐藏 | `hidden` | 全部 | 丢弃 |
| 10 | `src/client/index.ts:1202` `fireTrigger` | AI 总开关 | `aiEnabled` | 全部 | 丢弃 |
| 11 | `src/client/index.ts:1182` `scheduleIdleTimer` | 静默计时 | `idleTimeoutSec` | idle | 独立入口，绕过上面所有门 |
| 12 | `src/service.ts:280` `noteActivity` | 同类活动节流 | `ACTIVITY_THROTTLE_MS = 3000` | 事件 | Host 层就吞掉，客户端根本收不到 |
| 13 | `src/service.ts:147` | 静默工具表 | `QUIET_TOOLS`（30 个） | 事件 | Host 层不产生 activity |
| 14 | `src/service.ts` `isSubagent` | 子代理过滤 | 硬编码 | 事件 | Host 层不产生 activity |
| 15 | `src/service.ts:288` `setDone` | 庆祝保持 | `DONE_HOLD_MS = 3500` | 状态 | 保持期内吞掉 idle 状态 |

三个必须记录的病灶：

1. **`activityWindowSec` 是死设置**：设置页能改、schema 会校验、`/state` 会下发（`src/service.ts:363`），但 Host 实际用的是写死的 `ACTIVITY_THROTTLE_MS = 3000`，客户端也从没读过它；`src/service.ts:131` 的注释还写着「窗口时长来自设置项 activityWindowSec」。用户把「同类事件窗口」改成 10 秒，实际毫无效果。
2. **`lastAiRequestAt` 从未赋值**（`src/client/index.ts:642` 只声明、`:1124` 只读）→ 第 4 行那套「冷却内延后补发」从上线起就没跑过。用户感知到的「冷却」全部来自第 1 行那道 Host 硬拒。
3. **注释口径漂移**：`noteActivity` 注释写「同类活动 700ms 内只播一次」，常量是 3000。

用户难预期的根因不是参数多，而是**同一件事有三种处理方式**（丢弃 / 延后 / 合并），而「丢弃」有 8 处不同实现、其中 5 处不留任何痕迹。

## 决策

### 1. Host 只当传感器，不再决定「要不要演」

Host 只负责回答「发生了什么、什么时候发生的」，把每个 DSH 事件作为 `activity(seq, kind, at)` 逐条推给客户端（现状的 SSE 快照 + seq 已满足有序逐条投递，无需改传输）。

`QUIET_TOOLS`、同类节流、子代理过滤**全部搬到客户端调度器的过滤阶段**——这样任何一次「没反应」都能在策略表里找到对应行。Host 不删除「哪些状态值得上报」的分类逻辑（工具名 → `tool-read` / `tool-write` / `tool-run` / `tool-agent` / `tool-other` 的归类仍属采集），但不再据此丢弃。

### 2. 所有触发源走同一个入口

```
tap / chat / event / idle  →  dispatch(trigger)  →  startTurn(trigger, merged[])
```

`dispatch` 内部四步，顺序固定：

1. **过滤（谓词，返回 boolean）**：`aiEnabled`、`hidden`、`eventTriggers[event]`、同类聚合窗口、seq 去重
2. **时间门**：本源的 `gap`，由策略表给出
3. **占用门**：上一轮还在说时怎么办（`interrupt` / `queue` / `drop`）
4. **被拦动作**：`drop` / `defer(ms)` / `merge`

### 3. 三个动作，语义固定

| 动作 | 定义 | 用户可见后果 |
|---|---|---|
| `drop` | 丢弃，永不补发 | 完全没有反应；控制台留一行 `trigger dropped \| reason=…` |
| `defer` | 记住最后一次，到点补发 | 反应延后，不会消失 |
| `merge` | 带原始时间与来源排进 `merged[]`，并入下一轮场景句 | 下一轮台词里会提到「这期间还发生了…」 |

`merged` 上限由设置项 `mergeMax`（默认 6，1–20）决定，超出按时间丢最旧并记 `merge overflow`。

### 4. 策略表（唯一真值）

| 触发源 | `gap` | 占用门（上一轮进行中） | 被拦动作 | 合并 |
|---|---|---|---|---|
| `tap`（触摸） | `tapGapMs`（设置项，默认 1200ms，0–5000） | 恒为 `interrupt`（打断上一轮） | `defer` | 否 |
| `chat`（对话框） | 0 | 恒为 `interrupt` | `drop` | 否 |
| `event`（DSH 事件） | `aiMinIntervalSec`（0 = 不限） | `triggerMode`（`queue` / `interrupt`） | 间隔内 `merge`；忙时按占用门 | 是 |
| `idle`（静默超时） | 0（由 `idleTimeoutSec` 控制时机） | 恒为 `drop` | `drop` | 否 |

触摸恒抢占、事件听 `triggerMode`、idle 绝不插话——这三条是手感决定，不下放成设置；窗口长度则全部下放（`tapGapMs` / `aiMinIntervalSec` / `activityWindowSec` / `mergeMax`）。

### 5. 事件的两种「窗口」分工明确

- **同类聚合**（`activityWindowSec`，默认 10s）：同一 `kind` 的事件在窗口内聚成一条，记 `merged` 次数。用于 `read` / `glob` 一秒好几次这类噪音。
- **事件最小间隔**（`aiMinIntervalSec`，默认 1s）：任意事件两次**触发**之间的最小时间差；间隔内的事件不丢弃，改为进 `merged[]` 等下一次。

两者都是「合并」，只是键不同（同类 vs 任意）。

### 6. 删除 Host 频率冷却

`AI_COOLDOWN_MS` / `lastAiAt` / `beginAiTurn` 的拒绝分支整体删除。全系统的频率控制只在客户端策略表出现一次。触摸的「连点只留最后一次」不再依赖 `lastAiRequestAt`（那是个从没赋过值的死变量），改由调度器状态 `lastTapAt` 承担。

### 7. 每条丢弃都必须留痕

`dispatch` 对 `drop` 一律写一行控制台日志：`trigger dropped | tap | ai disabled` / `trigger dropped | event thinking | switch off` / `trigger deferred | tap | 720ms` / `trigger merged | event tool-run x4`。这是「可预期」的兑现方式——用户不需要猜。

## 取舍

- **为什么不用 JSON 结构化提示词替掉这些门**：调度发生在请求之前，与提示词无关；两者正交。
- **为什么规则放在客户端而不是 Host**：与「宿主只如实转发」的准则一致（ADR-046 的教训：Host 一旦开始规则化推导，就会长出 `MOOD` 这种特化状态机）。客户端本来就是「谁在说话、何时说」的持有者（`triggerMode`、`speakSeq`、音频队列都在这里），放同一侧才不会出现两套时钟。
- **为什么触摸恒抢占**：桌宠的核心手感是「戳一下必须有反应」；把它做成可配置等于把最容易出错的选择交给用户。
- **为什么 `merged` 有上限**：场景句是自然语言拼出来的，超过 6 条就该让模型看到「很多事发生」而不是一份流水账。
- **为什么保留 `triggerMode`**：它描述的是「抢占还是排队」这一产品选择，与「间隔多久」是两件事，合并会丢掉表达力。
- **代价**：Host 不再做兜底；多标签页同时开着时，每个页面各发一次请求（现状已如此，归一化不改变）。
- **代价**：事件全量上报后客户端处理量上升（现在被 Host 吞掉的那些事件会真的到达），由同类聚合窗口吸收。

## 影响

- 新增 `src/client/schedule.ts`：策略表 + 纯函数 `dispatchTrigger(state, incoming, config, now)` / `flushMerged(state)`，不读时钟、不碰 DOM。
- 改 `src/client/index.ts`：`fireTrigger` 收敛成调度器调用方；`startTurn` 在轮次结束补发合并队列；删掉 `pendingTrigger` / `pendingTap` / `lastAiRequestAt` / `AI_REQUEST_COOLDOWN_MS` 等旧门与死代码。
- 改 `src/service.ts`：`noteActivity` 去掉同类节流与 `QUIET_TOOLS` 过滤（保留 kind 归类），`activityWindowSec` 移交客户端。
- 改 `src/index.ts`：删 `AI_COOLDOWN_MS` 与拒绝分支；新增 `tapGapMs` / `mergeMax` 设置项（schema + 快照下发）。
- 改 `src/settings-store.ts` / `src/defaults.ts`：两个新设置项的默认值（1200ms / 6）与夹取范围。
- 改 `src/client/settings.ts`：AI 驱动分组新增「触摸连点窗口」「合并上限」两行；三行数字设置统一用 `NumberRow`。
- 测试：`src/client/schedule.test.ts` 12 条纯函数用例（假时钟）；`src/service.test.ts` 两条旧断言改为「Host 不节流」；全量 209 条通过。
- 文档：spec §3.2 触发调度；本 ADR；README 默认值表；CHANGELOG。

## 实现（2026-11-07）

按原计划五步落地，行为细节三处与提议稿不同，以本节为准：

1. **事件与互动「永远先到调度器」**：`applyActivity` / `applyState` / 触摸 / 对话 / 静默五个来源都只调 `fireTrigger`，没有任何一处再自行判断频率。
2. **合并轮什么时候发**：`merge` 只把事件攒进队列；真正补发有两个时机——① 当前轮结束（`startTurn` 的 `finally`）；② 最小间隔到期（`scheduleMergeFlush` 定时器，`nextAt > 0` 时）。因此「一次事件风暴」= 立刻一轮 + 补发一轮，而不是把中间的事件全丢掉。
3. **`force` 是唯一绕过**：调试面板「场景演示」直接 `startTurn`，不进策略表、也不改窗口状态（否则演示会污染真实节奏）。

设置项（设置页「AI 驱动」分组，本次新增两项）：

| 设置项 | key | 范围 / 默认 | 作用 |
|---|---|---|---|
| 触摸连点窗口（毫秒） | `tapGapMs` | 0–5000 / 1200 | 窗口内连点只留最后一次，到点补发 |
| 合并上限（条） | `mergeMax` | 1–20 / 6 | 一轮场景句最多拼进多少条被压下的触发 |

## 明确不做

- 不做跨源全局冷却（那正是要被删掉的 `AI_COOLDOWN_MS`）。
- 不做重试、不做优先级队列、不做按部位加权。
- 不在 Host 侧记录任何调度状态。
