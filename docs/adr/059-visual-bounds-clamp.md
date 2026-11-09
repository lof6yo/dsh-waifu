# ADR-059: 拖动与归位按角色可见轮廓中心

## Status

已废弃（由 [ADR-060](./060-canvas-center-clamp.md) 取代；测量代码保留为调试信息）

## Date

2026-11-09

## Context

宠物画布 = 模型画布 + 四周留白（设置项「画布留白」，默认水平 125% / 垂直 50%），因此 PIXI 的逻辑画布远大于角色可见部分（size 240 时画布 832×728、模型画布 232×488）。拖动夹取、归位、捕捉一直按「逻辑画布中心点留在视口内」计算（spec §4），等价于假设「可见角色中心 = 画布中心」。

真机数据（dsh-web-mobile，Android Chrome，视口 744×398、画布 832×728）显示：拖到最左下 `pos: 328,-364`、最左上 `pos: 328,34`，正是夹取公式的两个边界（`pos.bottom = −H/2` 与 `vh − H/2`、`pos.right = vw − W/2`）——夹取确实到达了设计边界，但视觉上左/上方向只出去约 1/4–1/3 个角色。原因是可见角色轮廓在画布内并不居中（留白 + 动作/物理外溢），按画布中心夹取时可见轮廓中心早已越出视口边缘，而画布边还没到。

## Decision

模型加载后测量一次「角色可见轮廓」包围盒，后续夹取/归位/捕捉都改用可见轮廓中心：

1. 把当前帧离屏渲染到与逻辑画布同尺寸的 `PIXI.RenderTexture`（`renderer.render(stage, { renderTexture, clear: true })`）。
2. `gl.readPixels` 读回 RGBA（注意 WebGL 行序自下而上），alpha > 8 的像素求包围盒。
3. 记录「可见轮廓中心 − 画布中心」的比例偏移 `visualOffsetXFrac/visualOffsetYFrac`（相对画布逻辑宽高），运行时换算成 px。
4. `clampPosToViewport` 改为约束可见轮廓中心：`right ∈ [offsetX − W/2, vw/s + offsetX − W/2]`，垂直同理。
5. `homePositionFromConfig`（默认位置/归位）与设置页「捕捉」也按「可见轮廓中心距右/距下」的百分比语义（`pos = viewport × pct / s − W/2 + offset`，捕捉为其逆运算）。
6. 调试面板状态文本末尾新增 `vis: x,y px`（未测得时 `n/a`），便于排查移动范围。
7. 测量在首帧渲染后执行（`ticker.addOnce` + 900ms 兜底），失败或拿不到 WebGL 上下文时偏移为 0，等价旧行为；换模型/换层时清零并重测。
8. 计入「页面 UI 缩放」`s`：真机（dsh-web-mobile，Android Chrome）上整页被祖先施加了 CSS `zoom`（实测 0.8），`getBoundingClientRect()` 返回视觉坐标，而画布逻辑尺寸与 `right/bottom` 仍是缩放后的 CSS px。`uiScale()` 用 `canvas.getBoundingClientRect().width / 逻辑画布宽` 测得 s（取不到时为 1），夹取/归位/捕捉都按 s 归一化，拖动位移按 `dx / s` 换算，保证视觉上 1:1 跟手；调试状态行同时显示 `s:` 便于确认。

## Alternatives Considered

### 备选方案 A：按 `model.getBounds()` 修正

- Pros：实现最省事。
- Cons：live2d-display 的 `getBounds()` 返回的是 internalModel 画布矩形（`_calculateBounds` 用 `0,0,width,height` 的 frame），中心恒等于画布中心，改了等于没改。
- Rejected：语义不对，实测无效果。

### 备选方案 B：按模型静态写死一个偏移常量

- Pros：无需运行时测量。
- Cons：动作/表情会改变可见轮廓，换模型不通用；写死的偏移会随姿态漂移。
- Rejected：不通用且会随演出幅度失准。

### 备选方案 C：离线用 moc3 顶点范围算轮廓

- Pros：零运行时开销。
- Cons：drawable 顶点包含隐藏/裁切部件，默认姿态的顶点范围不等同「实际渲染出的角色」；方向与可见性难以离线复现（已试算，结论不可靠）。
- Rejected：精度不可信。

## Consequences

- 正面：桌面与手机一致，四边都能按「可见角色」拖到一半出画；调试面板能直接看到测得的偏移。
- 正面：页面被外壳整体缩放（CSS `zoom`）时也按视觉比例正确工作，不再出现「拖到极限还整只停在屏幕内」。
- 代价：每次加载模型多一次离屏渲染 + `readPixels`（一次性，几 ms）；测得偏移反映加载后首帧（Idle 待机）的轮廓，之后姿态变化不重测。
- 「显示区中心」的百分比语义变为可见轮廓中心：老配置的 `homeRight/homeBottom` 会按新语义略微位移（通常更符合视觉预期）。
