# ADR-041：演出手势（动作 / 表情）期间暂停鼠标跟随

- 状态：Accepted
- 日期：2026-11-06

## 背景

鼠标跟随（ADR-008 起）每帧把「头 / 眼 / 身体看向鼠标」写进 `ParamAngleX/Y`、眼球参数。
动作播放时，动作关键帧也要写同一批参数，两者叠加会让动作变形——所以非 idle 动作
从 ADR-008 起就用 `focusSuppressed` 抑制跟随，`motionFinish` 后再恢复。

但 ADR-037 之后「演出」不再只有动作：模型可以只挑表情（`[blush]`、`[star]`…），
时长由 `TAG_EXPRESSION_HOLD_MS`（4.2s）决定。表情走 `ParamSwitch*`，与角度参数不冲突，
所以当时没做抑制——结果就是**表情亮着 4 秒，头还在跟着鼠标转**，看起来像在演一半被拽走。

## 决策

把「演出期间暂停跟随」的判定从「有动作」扩展成「有动作 **或** 有临时表情」：

- 新增 `holdTemporaryExpression(ids)` 作为临时表情的唯一入口（AI 标签与设置页「预览」共用）：
  写目标值的同时置 `focusSuppressed = true`，并把 `focusController` 归零（头眼立刻回正前方）。
- `releaseFocusSuppression()` 增加门禁：`interactionActive || expressionHoldActive()` 为真时**不恢复**，
  所以动作与表情同时进行时，先结束的一方不会把跟随提前放回来。
- 表情窗口到时（`applyExpressionParams` 帧内检查）调一次 `releaseFocusSuppression()`：
  没有动作在播就立刻恢复跟随（沿用 `lastPointerClient` 的位置，不要求鼠标再动一下）。

## 后果

- 演出期间角色「定住」看正前方，动作与表情不被跟随叠加，观感更完整。
- 代价：演出这几秒内鼠标移动不会立刻被角色跟随，松手感略有延迟——演出结束后一次性补上。
- 待机小动作（`IDLE_MICRO_MOTIONS`）本来就走 `suppressFocus: true`，行为不变。
- 状态动作（thinking 等）在 ADR-037 后已由 AI 标签驱动，不再单独抑制。
