# Changelog

## [Unreleased]

### Changed
- **动作集精简**：删除自建的 Thinking / Error / Done / Waiting / TapHead / TapFace / TapBody，只保留 `Idle`；原始资产 `Scene1` 经调研确认缺失参数（9 条曲线 7 条无效）几乎无可见表演，未采用（ADR-017）。默认映射仅 `idle → Idle`，其余事件/默认触摸部位不挂动作；`scripts/gen-jian-motions.mjs` 改为只生成 Idle
- 调试面板改为浮在角色模型上方的绝对定位浮层（不再占据布局把画布往下推）；调试面板可见时对白气泡避让叠在其上方
- **插件更名**：包名/插件 id/bundle 行统一为 `dsh-waifu`；API 前缀改为 `/api/dsh-waifu`、素材路由 `/waifu-assets`、插件私有目录 `$DSH_HOME/waifu/`（ADR-016）
- **移除自定义模型支持**：删除模型选择/导入 UI、`/models`、`/custom-models`、`/pet-local-models` 路由与 local-models/custom-models 模块（ADR-016，supersede ADR-009/010）
- **移除固定人设体系**：删除内置六人设与 `personas.jsonc` 自定义人设、`reload-personas` 路由、设置页「人设台词」分组及「自定义人设 ↗」跳转；改由**事件绑定**（空闲/思考/出错/完成/交付/等审批 → 动作组 + 台词池）驱动，长状态保留三阶段台词（ADR-015）
- **设置页重做为单页流程**：显示 → 模型 → 事件绑定 → 触摸部位 → 开发者选项；去掉弹窗/文件跳转链接/配置路径展示，「我的模型」只保留名称+URL
- 设置页状态流转重做：显式保存；事件绑定分组按需显示保存状态行，触摸部位按**部位粒度**提示「● 未保存改动 · 保存」并在结构变更时分组顶部提示；「预览 box」只控制角色上的叠加显示，预览态点击角色可正常触发部位台词/动作
- 宠物显示区域外扩（画布留白做成设置项：水平/垂直 0–300%，默认 130/70），避免尾巴等大幅动作甩到画布边缘被裁切；宠物画布透明区域**点击穿透**（只有触摸部位 box 接收交互），不再挡住 DSH UI；拖动改为全界面自由移动（允许一半移出窗口，但画布中心点始终约束在视口内，不会拖丢）
- 新增「默认位置（中心点距右/距下 px）」设置与「归位」按钮（客户端按视口+画布尺寸计算中心点位置，只改位置、尺寸不变）
- 对白气泡改为相对**角色模型**定位（不再随画布留白跑远），并新增位置偏移/背景色/背景不透明度/文字颜色设置；长文本自动换行限宽
- 设置界面 UI 规范化：统一使用 DSH 主题 token（背景/边框/文字/品牌色/状态色）、共享 Section/Card/CardHeader/按钮/输入/徽标样式与 4/8/12/16/24/32 间距网格；事件卡与部位卡折叠交互统一
- 触摸部位台词改为独立台词池：`part.lines` 为空 = 只播动作不出气泡（不再回退固定人设池）
- **内置模型**：删除 Hiyori / Haru / Mao / Mark / Natori 五条策展 URL，内置模型收敛为唯一「简」并随插件包分发（`assets/models/jian/`，经 `/waifu-assets/*` 同源路由）
- **触摸部位彻底重做**：移除模型 HitArea 判定、空间回退阈值（`spatialTap`）与固定「头/腿/手/身体」四档；部位改为用户自定义 touchbox（名字 + 多个归一化矩形 + 触摸动作组），命中按 box、重叠时最小 box 优先（ADR-014）
- **设置存储**：DSH 0.2.x 的 `ctx.settings` 不再提供 namespace 注册/读取，且写入会整插件重载；热设置改存插件私有 `$DSH_HOME/waifu/settings.jsonc`，隐藏自动生成的设置页（ADR-013）
- 自定义模型面板去掉「空间分区覆盖」；动画映射只保留 6 个状态槽位
- 开发者选项「显示点击分区」改为「显示触摸部位色块」

### Added
- 事件绑定配置与 API：`EventBindings`（6 事件 × 动作组 × 台词池，长状态 3 阶段）、`DEFAULT_EVENT_BINDINGS`、`EVENT_STAGE_DELAYS`；用户覆盖存 `touch-parts.jsonc` 的 `models[<id>].events`；设置页「恢复默认」
- 内置「简」默认触摸部位升级为 脸 / 头 / 胸 / 臀（按实际构图调好，含示例台词与部位动作）
- 内置「简」的 8 个自建动作（Idle / Thinking / Error / Done / Waiting / TapHead / TapFace / TapBody）+ `scripts/gen-jian-motions.mjs` 幂等生成与校验脚本；model3.json 声明 EyeBlink / LipSync 参数组
- 设置页「触摸部位」分组：编辑态（宠物实时显示 box）、新建部位、一个部位多个 box、左上右下百分比输入、按部位多选触摸动作组、debounce 自动保存
- 触摸部位文件 `$DSH_HOME/waifu/touch-parts.jsonc` 与对应 API `GET/POST /api/dsh-waifu/touch-parts`
- 内置「简」的默认触摸部位：脸 / 头 / 身体（用户保存后覆盖）
- 触摸部位**图层**：部位列表顺序即图层顺序（第 0 项最上层），重叠时上层部位生效；设置页支持上移/下移排序、显示层号，新建部位插入最上层
- 触摸部位**自定义台词**：每个部位可填一行一条的台词，解决「脸/头」共用同一台词池无法区分的问题
- **状态动画映射编辑**：设置页可为当前模型（含内置「简」）覆盖 6 个状态的动作组，存于 touch-parts.jsonc 的模型条目
- 内置贴图从 8192² 降采样到 4096²（28MB→4.9MB，包体约 13MB）；渲染缓冲按 devicePixelRatio（上限 2x）放大 + antialias，修复 Retina 锯齿
- 浏览器侧诊断日志：`POST /api/dsh-waifu/client-log` → `$DSH_HOME/waifu/client.log`（启动里程碑/错误上报，便于无控制台环境排查）

### Removed
- 旧「空间分区覆盖」设置项与 `SpatialTapConfig` / `DEFAULT_SPATIAL_TAP` / `mergeSpatialTap` 等共享类型与逻辑
- 旧四档互动动画槽位（head / leg / arm / body）

## [0.1.1] - 2026-08-14

### Changed
- 模型边界：预设从「可再分发、随包分发」改为「策展模型 URL 清单（纯 URL 直载、不打包）」；清单门槛降为「许可可标注」（NC 模型标注"仅限非商用"），默认模型 Hiyori（商用安全）
- 依赖安装改用 bun（替换 npm）

### Added
- README 快速开始：提示词安装方式（复制给 DSH agent 自动安装）+ 手动安装 + 自定义配置 + 卸载

### Removed
- npm 锁文件（package-lock.json），改用 bun.lock
