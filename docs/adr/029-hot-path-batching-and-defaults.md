# ADR-029：每帧浮层合批、配置读取缓存与默认值单一来源

- 状态：Accepted（2026-11-05）
- 相关：ADR-013（插件私有设置）、ADR-027（气泡最长显示）

## 背景

插件跑在别人的浏览器里常驻不关，性能问题会直接变成「风扇一直转」。一次审查（A/B/C 清单）发现三类可测的开销：

1. **每帧热路径**：命中层与触摸叠加层各有一条独立 `requestAnimationFrame`，固定跟显示器刷新率（120–140fps 屏上远超 `maxFps=30`）；即使角色静止、调试面板关着，也每帧写 `left/top/width/height`、每帧 `getBoundingClientRect()`、每帧重拼 `cssText` 并重画整张叠加层 canvas。表情参数每帧重算并固定写 10 个 `ParamSwitch*`，收敛后仍在写。`applyFocus` 每次 `pointermove` 都读 `canvas.getBoundingClientRect()`。
2. **Host 读盘**：`snapshot()` 每次推送都要读三遍配置（`settings` 一次、事件绑定一次、触摸部位一次），每遍 `readFileSync + JSONC 解析`。
3. **默认值散落**：默认尺寸/留白/位置/气泡参数在 5 处各写一份（Config schema、设置页 `DEFAULT_VALUE`、客户端兜底常量、`persist.DEFAULT_DISPLAY`、内置 preset），已经出现过「改了 schema 忘改客户端」的隐患。

## 决策

1. 两条浮层 rAF **合并成一条** `overlayTick`，按 `maxFps` 限频；每帧只算一次 `modelBounds()`，用取整签名（`overlayHitKey` / `overlayPaintKey` / `overlayBubbleKey`）判断「这一帧到底需不需要写 DOM」。屏幕坐标没变就整帧跳过；`updateHitBoxPositions` 每个格子记住上次写入值，只写变化的格子。没有任何浮层需要时 `syncOverlayLoop()` 直接停掉循环。
2. 布局读缓存：`layerRect()` / `panelSizeCache` / `canvasRectCache` 缓存 `getBoundingClientRect` / `offsetWidth` 结果，`invalidateLayout()`（resize、尺寸、模型、位置变化）统一失效，避免每帧触发强制回流。
3. 表情参数：目标值在 `applyState` / `handleTap` / 调试面板切换时刷新（`refreshExpressionTargets()`），每帧只在未收敛时写参数，全部到位后跳过。
4. `applyBubbleStyle` 用样式签名短路：SSE 每条消息都会调它，值没变就不写 style。
5. `SettingsStore` / `TouchPartsStore` 以文件时间戳（`mtimeMs:size`）做缓存，文件没变直接复用上次解析结果；任何写入后自增失效。
6. 新建 `src/defaults.ts` 作为默认值唯一来源，`Config` schema、设置页兜底、客户端渲染兜底、持久化默认全部引用它；`defaults.test.ts` 校验 schema 解析出的默认值与常量逐项一致。

## 后果

- 静止时浮层几乎零写入，CPU/GPU 占用从「跟刷新率走」降到「跟 `maxFps` 走」，且无变化帧直接空转。
- 配置读取从每次 3 次读盘解析降到 0–1 次（缓存命中即 0 次），快照推送开销与文件大小解耦。
- 默认值只有一处可改，改默认值不再需要「五处对齐」的心智负担；测试会拦住漏改。
- 代价：多了一层签名判断，调试时若怀疑「属性没刷新」，需要检查 `invalidateLayout()` 是否在对应场景被调用（已在 `applyPosToBox` / `applySizeNow` / `loadModelLayer` / resize / teardown 处覆盖）。
- 尚未做（后续可拆）：`src/client/settings.ts` 仍是单文件大组件，每键入一个字符会重建整页元素树；拆分「事件/部位/AI/开发者」子组件并 memo 化是下一步优化，需要先稳定各区块的 props 契约。
