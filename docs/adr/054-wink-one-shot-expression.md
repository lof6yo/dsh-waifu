# ADR-054：眨眼（wink）用一次性动作实现

日期：2026-11-09
状态：已采纳

## 背景

需求：新增一个「眨眼 / 俏皮单眼 wink」表情，AI 可选用，也能在设置页预览。现有表情系统（ADR-022）是一组 `ParamSwitch*` 常驻开关：选中后参数被写入并一直保持，互斥组去重，临时表情保持约 4.2s。单眼闭合若做成常驻开关，会出现「闭一只眼盯 4.2 秒」的不自然画面；模型本身也没有 wink 开关（cdi3 里只有 `ParamSwitch1`–`9`、`21` 等）。

模型的每帧眨眼由 live2d-display 的 `CubismEyeBlink` 驱动：`InternalModel.update` 里先跑动作，再跑 `eyeBlink.updateParameters()`（每帧把 EyeBlink 组的 `ParamEyeLOpen`/`ParamEyeROpen` 写成 1 / 按间隔闭合）。因此靠客户端每帧写眼参数做 wink 会被眨眼里层覆盖；但动作若包含 EyeBlink 参数曲线，blink 在整段动作期间被跳过，动作的曲线能稳定生效。

## 决策

- 新表情 `wink`（中文名「眨眼」，释义「俏皮地眨一只眼（wink）、抛媚眼」）走**一次性表情**通道：`ExpressionDef` 增加可选 `oneShotMotion?: string`，wink 声明 `oneShotMotion: 'Wink'`、`params` 为空——不写任何 `ParamSwitch*` 常驻开关，也不进临时表情保持窗口。
- 模型新增 `Wink` 动作组（1.2s，非循环，`scripts/gen-jian-motions.mjs` 幂等生成；`简.model3.json` 的 Motions 手动登记）：曲线驱动左眼 `ParamEyeLOpen` 闭合、右眼保持睁开，眼笑由 `ParamMouthForm` 带动（`ParamEye[LR]Smile` 是物理输出，不直接写），另加少量头歪、挑眉、嘟嘴；闭合窗口用 `hold(t) = smoothstep(t, 0.08, 0.2) - smoothstep(t, 0.62, 0.8)`。
- 客户端按路径落地：
  - AI 标签 / cue `expressions` 里出现一次性表情时，挑出动作组名走**串行动作队列**（`enqueueCueMotion`），播放一遍即结束；动作排在队列里，同一轮后续 cue 动作不会把它截断。同一列表里的常驻表情照旧 `holdTemporaryExpression`。
  - 设置页目录预览与调试面板表情预览：一次性表情直接 `startMotionWithPriority([...], MotionPriority.FORCE, { suppressFocus: true, isInteraction: true })` 播一遍；调试面板每次选中/点「播放」都重播。
  - 一次性表情不参与表情互斥组，也不会清除上一张常驻表情：wink 结束后，之前的表情状态照旧保持/到期。
- 新增导出 `expressionOneShotMotion(id)` 供目录、预览与落地逻辑共用；`isExpressionId` / `expressionLabel` / `expressionParams` 等既有接口不变（`expressionParams(['wink'])` 为 `{}`）。
- 提示词目录按 `EXPRESSIONS` 自动生成，wink 默认发给模型；没有新增设置项，`settings.jsonc` 的 schema 版本不变。

## 备选方案

### 每帧直接在客户端写 `ParamEyeLOpen = 0`
否决：每帧 `CubismEyeBlink.updateParameters` 会把它覆写回 1，除非同时停掉 blink，属于和框架打架。

### 把 wink 做成常驻表情（新增 `ParamSwitch` 参数）
否决：模型没有 wink 开关；单眼常闭保持整个表情窗口（约 4.2s）不自然。

### 在 model3.json 里声明 `.exp3` 表情文件
否决：本模型没有表情文件，新增 `.exp3` 需要额外的参数/动作接口与加载路径，改动面比一个动作大。

## 后果

- 眨眼在动作队列里播放，触摸/事件动作繁忙时会稍晚出现；动作期间 `focusSuppressed`，鼠标跟随暂停，播完恢复。
- 眨眼不受表情互斥组约束（它不是常驻开关）；需要「眨眼时不保持上一张表情」的玩法时，AI 在同一条 cue 里再给一个常驻表情即可。
- 提示词目录多一行，system prompt 变长少量；`director.test.ts` 的 golden 哈希随目录同步更新。
