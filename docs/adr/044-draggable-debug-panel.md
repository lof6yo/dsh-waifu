# ADR-044：调试面板自由摆放（拖动 / 缩放 / 本地记住）

- 状态：Accepted
- 日期：2026-11-06

## 背景

调试面板此前只有一种摆法：水平居中在模型上方、宽度按画布宽度写死（≤280）。实际用起来有两个问题：

1. 面板内容越加越多（状态演示 / 动画预览 / 表情预览 / 控制台 / 状态信息），高度一到上限就只能在小窗口里滚，想看控制台还得滚半天；
2. 模型贴视口右上角时，面板被视口边缘夹住，位置很别扭，还挡着角色；想把它挪到屏幕另一侧没有入口。

## 决策

1. **面板拆成「标题栏 + 内容区」两段**：标题栏是拖动把手（`cursor:move`、双击恢复自动跟随、右侧 `↺` 按钮同效），内容区 `flex:1 1 auto; min-height:0; overflow-y:auto` 自己滚——高度固定后标题栏仍抓得住，不会跟着内容滚走。
2. **四角各挂一个 14px 缩放手柄**（右下角有可见斜纹提示，其余三角透明但可拖）：拖左上/右上角时用「固定对边」反推 `left`/`top`，宽高被最小尺寸/视口上限夹住后手柄仍跟得住鼠标。
3. **两种模式**：`debugPanelManual === null` = 自动跟随（沿用原逻辑：水平居中模型、贴模型上方 8px）；非 null = 手动摆放，完全按用户几何摆，只在窗口 resize 时重新夹回视口。第一次拖动从自动模式当前的 `getBoundingClientRect()` 接管，面板不会跳。
   - 手动几何记的是**视口（client）坐标**而不是 petLayer 里的逻辑坐标：面板虽然挂 `petLayer` 内，但用户拖的是「屏幕上的一块调试面板」，拖动角色时它应该钉在屏幕原位，不该跟着角色跑。落样式时再 `left - rect.left` 换算回层内坐标，气泡避让用的 top/bottom 也同步换算。
4. **持久化走浏览器 `localStorage`**（键 `dsh-waifu.debug-panel:v1`），不写设置文件：这是纯客户端的调试工具状态，不该进 Host schema（会牵动设置版本迁移、设置页表单、SSE 快照），也不该跟着设置同步到别的设备。键带版本号，几何结构再变时换键即可让旧记录自然失效；隐私模式 / 无 `localStorage` 时静默降级为「不记忆」。
5. **气泡避让改为按面板底部判断**：只有面板整体在模型上方（`debugPanelBottomLogical <= bounds.y`）时气泡才上移叠到面板之上；手动拖到侧边/下方后气泡回到模型上方，不会莫名飞到面板顶上。

## 取舍

- 不引入拖拽库（原生 `pointerdown` / `pointermove` / `pointerup` + `pointercancel` 收尾），也不做吸附边缘、多显示器这类花活：调试面板是开发工具，够用即可。
- 尺寸下限 180×140（再小按钮点不准）、视口边距 8px（与面板原有定位边距一致）、上限 = 视口 - 16：拖不死也拖不出屏幕。
- 手动几何不进设置页、不改设置版本：想恢复默认点 `↺` 或双击标题栏即可，不用去设置里翻。

## 影响

- `src/client/index.ts`：新增 `debugPanelSizeBounds()` / `clampDebugPanelGeometry()` / `readDebugPanelGeometry()` / `writeDebugPanelGeometry()` / `currentDebugPanelGeometry()` / `applyDebugPanelGeometry()` / `resetDebugPanelGeometry()` / `bindDebugPanelPointer()`；`syncDebugPanelWidth()` 与 `updateDebugPanelPosition()` 增加手动分支；`ensureDebugPanel()` 结构改为标题栏 + 内容区 + 四角手柄；`updateBubblePosition()` 的避让条件改看面板底部。
- 无 Host 侧改动、无设置 schema 变更、无新增依赖、无新增测试文件（面板为 DOM 交互，沿用项目「客户端 UI 走手动验收」的做法）。
