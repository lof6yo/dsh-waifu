# ADR-017：动作集精简为仅 Idle（原始 Scene1 调研后不采用）

- 状态：Accepted
- 日期：2026-11-05
- 关联：部分取代 ADR-014「自建 8 个动作」；spec §6

## 背景

前期为了让桌宠在 6 个 agent 状态与触摸互动下都有动作，插件自建了 8 个 motion（Idle / Thinking / Error / Done / Waiting / TapHead / TapFace / TapBody）。实际使用中：

1. 自建动作的表演幅度、风格与模型不匹配，事件绑定也允许用户自行选择动作组，继续内置全套动作意义不大；
2. 用户希望先用**模型作者原始资产里的动作**，再逐步按需扩充；
3. 原始资产目录 `简/` 自带 `Scene1.motion3.json`，`简.vtube.json` 的 `FileReferences.IdleAnimation` 即指向它——这是该模型在 VTube Studio 里的**待机动画**。

## 原始 Scene1 的调研结果

- 文件：`简/Scene1.motion3.json`，`Version: 3`，`Meta: Duration=3, Fps=30, Loop=true, CurveCount=9, TotalSegmentCount=41, TotalPointCount=122`。
- 9 条曲线引用参数：`Anime_Cry`、`Anime_Cry2`、`Anime_Eye`、`Star_Eye1`、`AnimeAngry3/4/5`、`AnimeFlash1/2`。
- 与导出的 `简.cdi3.json`（236 个参数）交叉比对：**只有 `Anime_Cry`、`Anime_Eye` 存在**；`Anime_Cry2 / Star_Eye1 / AnimeAngry3 / AnimeAngry4 / AnimeAngry5 / AnimeFlash1 / AnimeFlash2` 在导出的 moc3 中不存在。
- Cubism 运行时对 motion 中不存在的参数曲线会忽略，不会报错；因此原样加入后，实际只剩 `Anime_Cry`、`Anime_Eye` 两条曲线，**几乎没有可感知的表演**（模型真正可见的表情开关是 `ParamSwitch1–21`，见 `简/` 下的 `.exp3.json`）。
- 原始文件的贝塞尔控制点存在越界（`AreBeziersRestricted: true` 但控制点不在段端点之间），插件自建动作的严格校验不适用于它。

## 决策

1. **删除**自建的 Thinking / Error / Done / Waiting / TapHead / TapFace / TapBody 七个动作文件与 model3.json 中的对应分组。
2. **保留**自建 `Idle`（由 `scripts/gen-jian-motions.mjs` 幂等生成，仍做参数白名单 / 严格贝塞尔 / Meta 校验）。
3. **不采用原始 Scene1**：验证后确认其缺失参数导致不可见，原样加入没有实际价值；先不放进模型，避免设置页出现「选中了却没反应」的选项。
4. 默认映射收敛为：事件 `idle → Idle`，其余事件与默认触摸部位**不挂动作**（只出气泡 / 台词）。用户后续可通过设置页事件绑定/触摸部位使用 `Idle`。
5. `scripts/gen-jian-motions.mjs` 只生成 Idle，并校验 model3 的 1 个动作组与 motions/ 无孤儿文件。

## 后果

- 模型动作组只剩 `Idle`；设置页动作选项与默认配置都不再引用已删除的组。
- 若以后想恢复 Scene1 的表现：优先**重新导出模型**补齐 `Anime*` 参数；否则需要做参数重映射（把缺失曲线映射到 `ParamSwitch5/4/9/21` 等现有表情开关），这会改变原始表演，届时按新 ADR 再做。
- 后续新增表演动作：扩展 `MOTION_DEFS` 后重跑生成脚本即可。
