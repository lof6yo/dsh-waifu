# ADR-019：触摸动作改为「驱动物理输入」而非直接写躯干参数

- 状态：Accepted
- 日期：2026-11-05
- 关联：ADR-018；`scripts/gen-jian-motions.mjs`；`assets/models/jian/简.physics3.json`；spec §6

## 背景

第一版触摸反馈（`TapChest` / `TapWaist` / `TapHip`）为了让身体「动得大一点」，把
`ParamBodyAngleX0/Y0/Z0` 写成 ±30 的正弦，时长 2.6–3.4s。实际观感是：整块上身像被推着
**刚性**地来回转，没有滞后也没有余振，比鼠标跟随时的自然摆动还差。

查 Cubism 官方实现（`CubismPhysics.cpp`）后找到根因，物理输出参数不是「可以随便写的参数」：

```
weight = Output.Weight / 100
value  = motion * (1 - weight) + physics * weight
```

本模型 `简.physics3.json` 的 Output Weight：

| 参数 | Weight | 含义 |
| --- | --- | --- |
| `ParamChestAngleX` / `ParamChestAngleY` | 100 | 100% 由物理决定，动作写了也没用 |
| `ParamBodyAngleX0` | 30 | 70% 听动作的 → 写成正弦就等于「刚性摆动」 |
| `ParamBodyAngleY0` | 50 | 一半一半 |
| `ParamBodyAngleZ0` | 80 | 大部分由物理决定 |
| `ParamHipAngleX0/Z0`、`ParamBodyAngleRX` | 100 | 全部由物理决定 |

更关键的是**胸口/胸部根本不吃这些参数**：胸的形变链是

```
ParamAngleX/Y/Z（头部角度，Weight 70）+ ParamAnglePX/PY（头部平移，Weight 30）
  → ParamInput_Body*/Hip*  →  摆锤（Mobility/Delay/Acceleration/Radius）
  → ParamBodyOutput_Body*/Hip*
  → ParamChestAngleX/Y（胸口转动）
  → PhysicsSetting67/68 → Chest_S1..S3（挤压）/ Chest_SY*（左右晃）
```

也就是说：写 `BodyAngleX0` 这类参数**不会**让胸部动，只会把躯干按 70/50/20% 的比例
强行掰过去；胸部那套 `Chest_S*` 完全由物理算出来，只能被「激励」。

## 决策

触摸类动作只驱动**物理输入**（头部角度 `ParamAngleX/Y/Z`、平移 `ParamAnglePX/PY`），
用「短促冲量 + 过冲 + 归零 + 留白」的形状，让摆锤自己衰减出滞后与余振；
不再直接写任何 `ParamChestAngle*` / `ParamBodyAngle*0` / `ParamHipAngle*0`。

具体形状：

- **TapChest**（被戳）2.0s：0.08–0.09s 冲到 9–10°，保持 ~0.08s，0.4s 反向过冲，之后归零；
  胸部由此被激励出 ±5–8° 的转动与 0.6–0.9 的 `Chest_SY` 形变（数值见下方验证）。
- **TapWaist**（怕痒）2.0s：4.5Hz、指数衰减（`exp(-2.6τ)`）的小幅冲量串，
  频率高于摆锤固有频率 → 物理跟不上，表现成细密发颤而不是整块转身。
- **TapHip**（被拍）2.2s：单次横向冲量（`ParamAngleX` 10° + `ParamAnglePX` 8°），
  下半身摆锤自己回弹，之后抬头瞪人。

## 验证

用一份按 `CubismPhysics.cpp` 移植的 Python 模拟器（归一化 / 摆锤积分 / 输出合成，
30fps，输入为三条动作的实际曲线）跑出来：

| 动作 | `ParamChestAngleX` | `ParamChestAngleY` | `Chest_SY`（胸左右晃） | `Chest_S1`（胸挤压） |
| --- | --- | --- | --- | --- |
| TapChest | -16.7 … +2.0 | -10.4 … +1.2 | -0.87 … +0.96 | -0.47 … +0.80 |
| TapWaist | -16.6 … +0.6 | -11.5 … +0.3 | -0.81 … +0.96 | -0.44 … +0.78 |

（值里含重力下垂的静态偏移，相对平衡点的摆幅约 ±5–8°；旧写法下胸口这些量恒为 0，
只有躯干按权重被掰动。）

## 后果

- 触摸反馈的身体运动来自物理，和鼠标跟随同一套机制，观感天然一致；代价是幅度受模型
  物理参数（Output Scale）限制，想更大要改 `简.physics3.json` 的 Scale，而不是继续加动作值。
- 动作曲线条数变少（TapChest 12 条、TapWaist 9 条、TapHip 11 条），不再堆躯干参数。
- 其余动作（TapHead / TapFace / TapHand / TapLeg / Charm / Shy / Taunt / Stretch）仍是
  手写关键帧 + 少量躯干参数，后续可按同一原则逐步迁移。
