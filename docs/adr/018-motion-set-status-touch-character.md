# ADR-018：动作集扩充为 15 组（状态 / 触摸反馈 / 人设小动作）

- 状态：Accepted
- 日期：2026-11-05
- 关联：部分取代 ADR-017「动作集精简为仅 Idle」；spec §6；`scripts/gen-jian-motions.mjs`

## 背景

ADR-017 把动作集收敛到只有 `Idle`，理由是用模型作者原始资产、避免自建动作风格不匹配。但实际使用下来暴露出问题：6 个事件槽位与 9 个触摸部位**全都没有动作**，桌宠只在呼吸和微摆，出错/完成/被摸的反馈只剩气泡，模型里那套表情能力也没机会体现。

复查模型资产（`assets/models/jian/`）后确认：

- `简.cdi3.json` 有 236 个参数、15 个参数组、41 个 Part，可用表情参数齐全（`ParamEyeLSmile/R`、`ParamBrowLY/RY`、`ParamMouthForm`、`ParamMouthOpenY`、`ParamCheekPuff`、`ParamEyeBallX/Y` 等）；
- `简.physics3.json` 96 组物理、184 个输出参数，头部/身体角度一动，头发/马尾/衣摆会跟着动，等于免费获得次级动态；
- 原始 Scene1 仍不可用（ADR-017 的调研结论不变：引用的 Anime_* 参数大多不在 moc3 里）。

## 决策

用 `scripts/gen-jian-motions.mjs` 重建 **15 个动作组**，分三类：

1. **状态动作**（供事件绑定）：`Idle`（循环）、`Thinking`（循环：眼珠上飘 + 挑眉）、`Error`（瞪眼/倒竖眉/张嘴 + 头后仰一颤）、`Done`（眼笑 + 点头两下 + 小跳）、`Waiting`（循环：左右张望 + 眼珠扫）
2. **触摸反馈**（供触摸部位）：`TapHead`（眯眼笑 + 头往手心歪）、`TapFace`（嘟嘴 + 皱眉 + 躲开）、`TapHand`（低头看手 + 眼笑）、`TapBody`（炸毛：倒竖眉 + 张嘴 + 后仰 + 身体一缩）、`TapLeg`（怕痒：闭眼缩身 + 脑袋左右抖）
3. **人设小动作**（绝区零「简·杜」魅魔系设定）：`Charm`（慢侧头 + 压眼皮 + 单边挑眉 + 嘴角一勾）、`Smug`（循环小幅摇晃炫耀）、`Shy`（低头 + 眼珠下躲 + 腮帮子微鼓）、`Taunt`（抬下巴 + 半眯眼 + 挑眉歪嘴）、`Stretch`（闭眼张嘴伸懒腰）

约束与做法：

- 只用 `SAFE_PARAMS` 白名单内的参数，**不碰** `ParamSwitch*` 表情开关、物理内部参数与物理输出驱动链（表情开关留给后续的「参数动画」层，见 spec 后续计划）；
- 循环动作首尾值一致、一次性动作结束回到中立值，交替时不会跳变；
- 幅度保守（角度 ≤ 9°、身体 ≤ 3°），靠物理链放大次级动态；
- 每个动作仍走脚本的严格校验（参数存在于 cdi3、贝塞尔控制点受限、Meta 计数自洽、model3 引用一致、motions/ 无孤儿文件）。

配套默认映射：

- `presets.jsonc` 的 `animationMap`：`idle→Idle`、`thinking→Thinking`、`error→Error`、`done→Done`、`waiting→Waiting`、`delivered→Done`；
- `DEFAULT_MOTION_MAP` / `DEFAULT_EVENT_BINDINGS` 同步改成真实存在的组名（原 `Failed`/`Sad`/`Jumping`/`Working` 是历史遗留的空候选）；
- 默认触摸部位：脸→`TapFace`、头发→`TapHead`、手→`TapHand`、胸/臀/腰→`TapBody`、大腿/小腿/脚→`TapLeg`。

## 影响

- 事件切换与触摸现在都有可见表演，且每个动作会带动头发/衣摆物理；
- 设置页「动作组」下拉里从 1 项变成 15 项，用户可自行改映射；
- 动作文件总增量约 20 KB（Json 文本），构建产物不变；
- 后续「表情开关」层只需要在动作之上叠加 `ParamSwitch*`，与本次的动作曲线不冲突。
