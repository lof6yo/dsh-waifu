# ADR-014：内置「简」模型（随包分发 + 自建动作）与用户自定义 touchbox 部位

- 状态：Accepted（**动作集部分已被 ADR-017 取代**：现在只有 Idle）
- 日期：2026-11-04
- 关联：ADR-003（渲染栈）、ADR-009（动画映射）、ADR-010（本地模型路由）

## 背景

用户提出三条产品级改动：

1. 删除全部内置角色模型；
2. 使用「简」作为唯一内置模型；该模型默认动画很少，需要为它新建动作；
3. 重做触摸部位判定与设置面板：部位抽象改为用户自定义的 touchbox（点「编辑触摸部位」→ 模型进入编辑态并显示当前 box → 新建部位、输入名称、添加 box、输入左上右下值、box 实时显示；一个部位可多个 box；部位建立后动画映射设置中出现该部位的触摸动画选项）。

旧实现（v0.3.0）的两处前提与新需求冲突：

- 内置模型是「策展 URL 清单」，模型一律 URL 直载、**不随包分发**（intent 明确 out of scope「随包分发模型文件」）；
- 触摸部位是**固定四档**（头/腿/手/身体），靠模型 HitArea + 空间回退阈值（`spatialTap`）判定，用户只能微调阈值，不能定义自己的部位。

「简」是 VTube Studio 导出的 Cubism 4 半身像模型（无 HitAreas、无 Motions 定义，只有 1 个动作）。要让桌面宠物有状态表现，必须随包分发模型并自建动作。

## 决策

### 1. 模型随包分发

- 内置模型资源放在 `assets/models/<id>/`（moc3 / texture / physics3 / cdi3 / model3.json / motions），由 Host 的 `/waifu-assets/*` prefix 路由同源提供（复用素材路由，带目录穿越防护）。
- `presets.jsonc` 只剩 `jian` 一条：`modelUrl: "/waifu-assets/models/jian/简.model3.json"`。许可证字段标注「用户自备模型（随包内置；公开分发前请确认模型授权）」。
- 自定义模型能力保留（任意 http(s) URL / 本机绝对路径，ADR-010）。
- 旧配置里的失效模型 id（如 `hiyori`）由 `resolveModelUrl` 回退默认内置模型，升级后不空白。

### 2. 自建动作

- 新增 `scripts/gen-jian-motions.mjs` 幂等生成 8 个 `.motion3.json`：
  - 状态组：`Idle`（循环呼吸/微摆）、`Thinking`（歪头/眼珠上移）、`Error`（垂头/眉眼下垂）、`Done`（开心点头/笑眼）、`Waiting`（左右张望）
  - 触摸组：`TapHead`、`TapFace`、`TapBody`
- `简.model3.json` 里声明 `Motions` 分组、`EyeBlink`（ParamEyeLOpen/ROpen）与 `LipSync`（ParamMouthOpenY）参数组，让模型有自动眨眼/口型基础能力。
- 只使用可控的演出参数（ParamAngle* / ParamEye* / ParamBrow* / ParamMouth* / ParamBreath / ParamBodyAngle*0 / ParamCheekPuff），不碰物理与 ParamSwitch* 开关参数。

### 3. 用户自定义 touchbox 部位

数据模型（`src/models.ts`）：

- `TouchPart { id, name, boxes: TouchBox[], motions: string[] }`
- `TouchBox { left, top, right, bottom }`：相对**模型包围盒**的 0–1 归一化坐标（左上右下）。
- 命中判定 `hitTestTouchParts(parts, nx, ny)`：只用 box；**部位有图层（parts 数组顺序，第 0 项最上层），重叠时上层部位生效**（设置页可上移/下移排序），未命中不响应。
- 部位数据按模型 id 存在插件私有 `$DSH_HOME/waifu/touch-parts.jsonc`；用户没保存过时回退 `presets.jsonc` 的默认部位（简：头/脸/身体）。

交互/设置流：

1. 设置页「触摸部位」分组点「编辑触摸部位」→ 通过 window CustomEvent（`src/client/touch-edit.ts`）广播编辑态与草稿部位；
2. 宠物悬浮层强制可见并实时绘制所有 box（部位名标签、高亮当前部位）——功能与旧「显示点击分区」同源但数据换成用户部位；
3. 用户新建部位 / 输入名称 / 添加 box / 输入左上右下百分比 / 增删 box；每次变更立即重绘（未保存也实时）；
4. 每个部位可多选动作组（来自当前模型 `.model3.json` 的 Motions），作为该部位被触摸时的动画候选；
5. 变更 debounce 保存到 touch-parts.jsonc，Host 版本号 + SSE 推送，宠物即时用新部位判定。

同时移除：`spatialTap` 全部类型/合并逻辑/设置 UI/空间回退分档/固定四档动画槽位（`head/leg/arm/body`）。`AnimationSlot` 只剩 6 个状态槽位。

## 后果

- 部位完全可配置，不依赖模型 HitArea；同一部位可用多个 box 拼不规则区域。
- 「简」随包分发使 npm 包体积增加约 9MB（moc3 8.3MB + 纹理），换取开箱可用；后续如需瘦身可改为首次使用时下载。
- 用户升级后旧 `spatialTap` / 旧四档 mapping 字段被忽略（配置里保留但不再读取），不会报错。
- 默认触摸部位按「简」实际渲染构图调好（脸/头/胸/臀；脸在最上层，含示例台词），用户可在编辑态按实际渲染效果微调。
- 贴图从 VTube 原始 8192² 降采样到 4096²（28MB→4.9MB，包体约 13MB），显著缩短首次加载；Cubism 不使用 mipmap，贴图尺寸越接近显示尺寸、缩小时的锯齿越轻。
- 渲染缓冲按 devicePixelRatio（上限 2x）放大并开启 antialias，修复 Retina 下 1x 缓冲放大的锯齿；叠加层按同倍率缩放绘制。
- 部位动画与状态动画分离：状态动画仍走 `animationMap`（presets 内置/自定义条目），部位动画走 `part.motions`。
