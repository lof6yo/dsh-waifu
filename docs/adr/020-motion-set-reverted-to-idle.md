# ADR-020：动作集回退为只有 Idle，其余动作待重新设计

- 状态：Accepted
- 日期：2026-11-05
- 关联：取代 ADR-018、ADR-019 的动作集部分；spec §5/§6；`scripts/gen-jian-motions.mjs`

## 背景

ADR-018 一次性补了 16 个自建动作（状态 5 + 触摸 7 + 人设 5，去重后共 17 组），
ADR-019 又把胸部/腰部/胯部改成「驱动物理输入」。实际观感仍然不对：胸部/躯干的
反馈看起来像被人推着晃，和鼠标跟随时的自然摆动差得更远。

排查结论（`CubismPhysics.cpp` 的合成公式 + `简.physics3.json` 的权重）：

```
value = motion * (1 - weight) + physics * weight
ParamChestAngleX/Y = 100   // 完全由物理算
ParamBodyAngleX0 = 30 / Y0 = 50 / Z0 = 80
胸部形变 Chest_S1..S3 / Chest_SY* = 100（只能被 ChestAngle 激励）
```

也就是说：躯干/胸这些参数天然是「物理输出」，想靠手写关键帧去演一个可信的
受击/被摸反应，需要同时拿捏冲量形状、摆锤固有频率、衰减与身体各段相位，
靠试错堆参数很难收敛；而做错时的观感损失（比无动作更差）比收益大。

## 决策

1. 移除除 `Idle` 以外的全部动作组与 `.motion3.json`；`简.model3.json` 只声明 `Idle`。
2. `presets.jsonc` 的 `animationMap` 只保留 `idle → Idle`，其余槽位为空；默认触摸部位不挂动作。
3. `DEFAULT_MOTION_MAP` / `DEFAULT_EVENT_BINDINGS` 回到 ADR-017 时的候选链（`Thinking`/`Working`/`Idle` 等，
   不存在的组由解析器按顺序 fallback 到 `Idle`），保证用户在设置页仍可手动挂动作组。
4. 用户本地运行时 `$DSH_HOME/waifu/touch-parts.jsonc` 的 `motions` 一并清空。

## 后续

新动作等用户点名「几个简单的」之后再实现，且实现前先做资料调研（Live2D 官方物理/动作文档、
同类桌宠（如 VTube Studio、Live2D 示例模型）的呼吸/点头/受击做法），先出方案再写曲线，
不再一次性批量生产。

## 后果

- 桌宠回到「呼吸 + 眨眼 + 微摆」的稳定状态，事件与触摸只有气泡反馈。
- 设置页的动作组多选仍然可用：用户可把 `Idle` 挂到任意事件或部位。
- ADR-018/019 保留作为历史记录，动作集部分已被本 ADR 取代。
