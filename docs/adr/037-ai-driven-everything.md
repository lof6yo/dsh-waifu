# ADR-037：全 AI 驱动（台词 / 动作 / 表情 / 记忆全部由模型决定）

- 状态：已采纳（2026-11-06）
- 相关：ADR-025（AI 回复）、ADR-030（历史注入）、ADR-031（全 AI 接管）、ADR-033（TTS 流式）、ADR-035（情绪标签）、ADR-036（活动提示）
- 取代：ADR-031（全 AI 接管开关——本 ADR 后该开关不存在，AI 驱动即接管）、事件绑定表（ADR-015/017 一系）与部位台词池（spec §4 固定台词部分）

## 背景

此前角色的反应分两层：固定对白（事件绑定台词池 + 部位台词）打底，AI 台词到达后替换
（ADR-025/026/031）。问题：

1. 固定台词一旦出过几次就明显复读，维护者也不想再手写台词池；
2. 动作 / 表情全靠人工 mapping（事件→动作组、部位→动作组+表情、情绪→表情），改一处要动 presets / store / client 三处；
3. AI 只有「写台词」一个自由度，角色表现力被 mapping 锁死。

## 决策

彻底去掉固定对白与手动动作/表情 mapping。角色的一切反应 = 一次 AI 演绎：

### 1. 输入（Host 组装，格式固定）

- **人设**：`$DSH_HOME/waifu/persona.md`（沿用 ADR-025）。
- **场景**：`TriggerInput { kind, part?, tapKind?, durationMs?, event?, text?, tz?, merged? }`
  - `tap`：触摸部位 + 三档力度（`light` <250ms 轻碰 / `poke` 250–900ms 戳戳 / `stroke` ≥900ms 抚摸，客户端 pointerdown 计时）；
  - `event`：DSH 状态/活动事件（17 键）与合并窗口里攒下的同类事件（`merged[]`）；
  - `chat`：交互框用户原话；
  - `idle`：静默超时（默认 5 分钟，0=关）。
- **历史**：最近 N 轮对话（ADR-030，轮数可配）带时间戳。
- **记忆**：`$DSH_HOME/waifu/memory.md`（新增）最近 N 条注入；AI 输出 `[记] …` 行由 Host 落盘（每条 ≤120 字，文件 ≤20000 字符，超限丢最旧）。
- **目录**：system prompt 里列出 8 个动作组（Nod/ShakeHead/Tilt/Sway/Glance/Perk/Shift/Sigh，带中文义）与 11 个表情（blush/angry/star/whites/tear/heart/cry/dark/blood/dim，带含义），供模型选择。

### 2. 输出（标签流式）

- 句首标签：`[表情][动作] 正文`（客户端与 Host 各自解析，最多剥 3 个；认 id 或中文名）；
- 句尾记忆行：另起一行 `[记] 要记住的事`（正文之外单独透传，不进气泡）；
- 正文按句读流式（ADR-033 管线不变），`tags` 事件先于正文下发，客户端立刻 `applyTags`（表情保持 4.2s，动作 FORCE 播放）。
- **AI 失败 = 完全静默**：不出气泡、不播动作表情、不回落固定台词（也没有固定台词可回落）。物理反应（拖拽跟随、眨眼、物理摆件）不受影响。

### 3. 触发调度（客户端）

- `tap` / `chat` 必可触发（无开关）；`event` / `idle` 受 `eventTriggers` 16 键开关与 `aiMinIntervalSec`（默认 3s，0=不限）约束；
- 同类事件窗口 `activityWindowSec`（默认 3s）内合并进 `merged[]`，只触发一次；
- `triggerMode`：`interrupt`（默认，新触发掐掉上一轮：`stopSpeaking` + 序号作废）/ `queue`（上一轮「说完」——气泡出完且语音播完——才反应，期间只保留最新一条 pending）；
- 静默超时 `idleTimeoutSec`（默认 300s）：无事件无互动时自动让角色说一句话。

### 4. 设置（v8 迁移）

删：`aiTouchOnly`、`aiTakeover`（本 ADR 即接管）、`interactionMode`（由 triggerMode 取代）、`thinking*` / `waiting*` 六项。
增：`aiMemoryCount`（0–100，默认 20）、`triggerMode`、`aiMinIntervalSec`（0–600，默认 3）、`idleTimeoutSec`（0–3600，默认 300）、`activityWindowSec`（0–300，默认 3）、`eventTriggers`（16 键布尔，v8 以下强制全开）。
设置页：删事件绑定组、部位台词/动作多选、接管/仅触摸/节奏/打断优先级；AI 分组改名「AI 驱动」，新增上述控件 + 记忆卡（查看/编辑/保存，同人设卡）。

### 5. 删除面

- presets：`touchParts[].motions/lines`、`animationMap` 全删；部位只剩 `id/name/boxes`。
- models：`DEFAULT_EVENT_BINDINGS` / `splitMotionSelection` / `LONG_STATES` / `DEFAULT_LONG_AI` 删；`AI_MOTIONS` / `EXPRESSIONS[].meaning` 新增。
- client：气泡预置排队（`aiTextUntil`/`pendingBubbleText`）、`pickLine`、情绪映射链（`EMOTION_EXPRESSIONS`/`applyEmotion`）、长状态底稿全删。

## 后果

- 正面：台词永不重复（模型生成）、表现力从 mapping 的 9×11 组合升到模型自由发挥、维护成本从「手写台词池」降为「调 prompt」；事件绑定表 / 部位台词 / 情绪标签三套机制合并为一套。
- 负面：无 AI（没配 key / 模型挂了 / 网络）时角色彻底沉默——这是接受的行为；每轮反应花一次 LLM 调用（有 1200ms 冷却 + 最小间隔节流）；标签可能被模型念进正文（客户端剥标签兜底，剥不掉就当台词念出来）。
- 兼容：旧 touch-parts.jsonc 的 motions/lines/events 字段读入时被剥；旧 settings v7 自动迁移 v8。

## 修订（2026-11-06）：流式解析必须容忍「切在标签中间」

provider 按 token 切片，切点常落在标签内部（`[blush` / `][` / `Sway` / `] 唔…`）。早期实现把「尾部没闭合的方括号」当成正文立刻放行，于是后面的 `[Sway]` 只能靠念稿时的 `stripInlineTags` 剥掉——文本干净、动作静默丢失（表现为「表情出得来、动作永远不出来」）。

- 规则：流式剥离函数在解析掉已闭合的标签后，若剩余部分仍是**未闭合的标签前缀**（`TAG_PARTIAL`，括号内 ≤16 字且无换行），返回 `needMore`，把这段留在缓冲区等下一块，不进入正文转发模式。
- 已解析出的标签按块立即上报（可以分多次 `tags` 事件），客户端逐个应用；不依赖「一次性拿到完整前缀」。
- 回归测试：`src/ai.test.ts` 两条——`[blush` / `][` / `Sway` / `] …` 分片、`[blush][Sh` + `akeHead]` 分片，都要求 motions 完整上报且正文无标签残留。
- 兼容：上限 16 字是为了不让正文里真正的方括号（如「[笑]…」之外的长开头括号）被无限攒住；超过长度的前缀照旧当正文发出。
