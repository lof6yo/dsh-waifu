# ADR-040：动作/表情的「给模型的释义」可在设置页编辑

- 状态：Accepted
- 日期：2026-11-06

## 背景

ADR-037 之后，角色的动作与表情完全由 AI 从两份固定目录里挑：
`AI_MOTIONS`（8 个动作组）与 `EXPRESSIONS`（10 个表情，`none` 除外）。
每条目录项带一句写给模型看的释义（`meaning`），拼进 system prompt 的
「可选动作 / 可选表情」两节。

这句话直接决定模型会不会在合适的时机选它（比如 `Nod` 写成「同意、得意、敷衍地应一声」，
模型就只会在这三种语气下点头）。之前它硬编码在 `src/models.ts`，改一次要发版，
而「这个动作对我这个角色意味着什么」是纯作者口味，属于设置而不是代码。

## 决策

新增两个设置项，与 ADR-039 的 `eventTexts` 同构（覆写表，空 = 用内置）：

- `motionTexts: Record<string, string>`：键为动作 id（`Nod` / `ShakeHead` / …），值覆盖 `meaning`。
- `expressionTexts: Record<string, string>`：键为表情 id（`blush` / `angry` / …，不含 `none`），值覆盖 `meaning`。

- 归一化 `normalizeMotionTexts` / `normalizeExpressionTexts`（`src/defaults.ts`）：
  只留目录内 id、压空白、截断到 `CATALOG_TEXT_MAX = 80` 字；空串等于删除覆写。
- `applyOps` 支持二层路径 `['motionTexts', 'Nod']` / `['expressionTexts', 'blush']`（与 `eventTexts` 同款）。
- `systemPrompt(persona, memory, motionTexts?, expressionTexts?)` 逐行取
  `motionTexts[id] ?? motion.meaning`，未覆写的继续用内置释义。
- 设置页在「AI 驱动」分组里新增卡片「动作与表情」，布局与「触发场景」一致：
  分组标题 + 每项一行（`id（中文名）` + 「已自定义」标记 + 编辑按钮），展开后是两行文本框，
  placeholder 显示内置释义；回车或失焦即保存。

## 修订（2026-11-06）：可关闭单个动作/表情

模型不一定需要看见全部 18 项。新增两张开关表 `motionEnabled` / `expressionEnabled`
（`Record<string, boolean>`，缺省 = 开），设置页每行左侧一个勾选框：

- 关掉的项**不进 system prompt 的目录**——模型不知道它存在，也就不会选。
- 即使模型凭历史/nuance 写出来了，`filterTags()` 也会把它从 `tags` 事件与 `/interact` 返回值里剔掉，
  所以关闭是「对模型不可见 + 不生效」双重保证。
- 全关时目录段回落成一句「（这次没有可用动作，不要写动作标签）」，避免出现空的目录标题。

## 后果

- 改释义不用发版，也不需要重启：释义在每次请求时从设置读取并拼 prompt。
- 目录本身（有哪些动作/表情、id 与中文名）仍由模型决定，设置页只改「怎么向模型解释它」。
- 每个模型有自己的动作集，但目录目前仍按内置「简」在 `src/models.ts` 里定义；
  换模型若要换目录，需要另开一轮（当前 presets 只有一个模型，暂不做动态发现）。
- 设置文件多两个覆写表；默认都是 `{}`，对未改过的用户零影响。
