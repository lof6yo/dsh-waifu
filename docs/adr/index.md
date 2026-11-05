# ADR 索引

按时间顺序记录本仓库的**架构决策**。新决策追加编号，勿删旧 ADR；变更时写新 ADR 并标记 supersede。

模板见同目录 [`_template.md`](_template.md)。

| ADR | 标题 | 状态 |
|-----|------|------|
| [001](001-rendering-pixi-live2d-display-advanced.md) | Live2D 渲染选型：pixi-live2d-display-advanced | Superseded by ADR-003 |
| [002](002-pet-mount-and-state-source.md) | 宠物挂载点与状态事件源 | Accepted |
| [003](003-spike-results-and-rendering-stack.md) | 渲染栈落地与 spike 验证结果 | Accepted |
| [004](004-plugin-packaging-and-communication.md) | 插件打包形态与通信架构（DSH 实证调研） | Proposed |
| [005](005-pet-visual-top-layer-popover.md) | 宠物视觉层挂载：Popover API（浏览器顶层），回退 body portal | Accepted |
| [006](006-push-state-sse.md) | Host→Client 状态传输：SSE 推送替代轮询（supersede ADR-004 通信条款） | Accepted |
| [007](007-personas-plugin-owned-jsonc-file.md) | 自定义人设走插件独有 JSONC 文件（不进 DSH settings 体系） | Accepted |
| [008](008-motion-priority-and-focus-suppression.md) | Live2D 动作优先级与 focus 抑制规则 | Accepted |
| [009](009-custom-model-animation-mapping.md) | 自定义模型动画映射与 debug 动画预览 | Superseded by ADR-016 |
| [010](010-local-model-host-route.md) | 本地模型通过 Host 路由加载 | Superseded by ADR-016 |
| [011](011-dsh-0.1.5-rc.1-adaptation.md) | 适配 DSH 0.1.5-rc.1（client-runtime 移除、settings namespace 字符串化、依赖策略对齐官方） | Accepted |
| [012](012-dsh-0.1.5-rc.3-session-plane.md) | 适配 DSH 0.1.5-rc.3 并接入会话面能力（直达打开恢复、交付庆祝） | Accepted |
| [013](013-dsh-0.2.x-settings-plugin-private-file.md) | 适配 DSH 0.2.x settings 服务（插件私有设置文件） | Accepted |
| [014](014-bundled-jian-model-and-touchbox-parts.md) | 内置「简」模型（随包分发 + 自建动作）与用户自定义 touchbox 部位 | Accepted |
| [015](015-event-bindings-replace-personas.md) | 移除固定人设，改为事件绑定（动画 + 台词；后续 LLM 人设） | Accepted（supersede ADR-007） |
| [016](016-rename-to-dsh-waifu-and-drop-custom-models.md) | 插件更名为 dsh-waifu，并移除自定义模型支持 | Accepted（supersede ADR-009/010） |
| [017](017-motion-set-idle-only.md) | 动作集精简为仅 Idle；原始 Scene1 调研后不采用 | Accepted（部分取代 ADR-014） |
| [018](018-motion-set-status-touch-character.md) | 动作集扩充为 15 组（状态 / 触摸反馈 / 人设小动作） | Superseded（ADR-020） |
| [019](019-physics-driven-touch-motions.md) | 触摸动作改为驱动物理输入（不直接写躯干/胸参数） | Superseded（ADR-020 的动作集部分） |
| [020](020-motion-set-reverted-to-idle.md) | 动作集回退为只有 Idle，其余动作待重新设计 | Superseded（ADR-021） |
| [021](021-basic-motion-set-nod-shake-tilt-sway-hop.md) | 基础动作组：点头 / 摇头 / 歪头 / 左右晃 / 上下跳 | Accepted（取代 ADR-020 的「只留 Idle」） |
