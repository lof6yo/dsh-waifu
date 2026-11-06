# ADR-042：只在标签页隐藏时暂停渲染

- 状态：Accepted
- 日期：2026-11-06

## 背景

渲染循环的门禁由一个 `hidden` 标志控制（ADR-008 起）：

```ts
let hidden = document.visibilityState !== 'visible'
const onVisibility = () => { hidden = document.visibilityState !== 'visible'; syncTicker() }
const onBlur       = () => { hidden = true;   syncTicker() }
const onFocus      = () => { hidden = false;  syncTicker() }
```

好处是省电，坏处是 `window.blur` 与「标签页隐藏」被混为一谈：用户点到别的窗口、
切到别的应用、甚至只是把焦点放到浏览器外部，角色都会**立刻定格**，看起来像死掉。

## 决策

把两个概念拆开：

- `hidden`：只跟 `document.visibilityState` 走（切标签页、最小化、合盖），**唯一**决定是否停渲染；
- `windowFocused`：只跟 `window.blur` / `focus` 走，仅用于**暂停鼠标跟随**（`handleGlobalPointerMove`
  与 `releaseFocusSuppression` 的守卫），不停 ticker。

`syncTicker()` 的判据从 `petShown() && !hidden` 不变，但现在 `hidden` 不会再被 blur 置真。

## 后果

- 点到别处 / 切到别的应用时，角色继续呼吸、待机小动作、播动作与口型——视觉上「还活着」。
- 标签页隐藏/最小化仍会暂停（保留最后画面），省电行为不变。
- 失焦时鼠标不在页面上，本就收不到 pointermove；恢复焦点后跟随从最后位置接上。
- 代价：窗口被别的应用完全遮住时仍在跑渲染循环（不可见但耗一点 GPU），与「标签页可见就算前台」的浏览器语义一致。

## 修订（2026-11-06）：隐藏时「全停」

页面隐藏（切标签页 / 最小化）时除了停 ticker，还一并停掉一切会花钱的东西：

- `fireTrigger()` 直接返回（活动类触发不排队、不补发），`startTurn()` 兜底再挡一次；
- `scheduleIdleTimer()` 不挂计时器（隐藏时不累积静默触发），恢复可见时重新计时；
- `visibilitychange → hidden` 时 `stopSpeaking()`：`speakAbort.abort()` 断掉 `/speak` SSE，
  服务端 `TtsEngine.synthesize` 随 signal 取消，音频播放同时停止。

关掉网页/标签页时更彻底：客户端 JS 整体销毁，请求由客户端发起，Host 侧没有任何 AI 定时器
（`PetService` 只有一个 2 秒的状态保持计时），所以不会有 LLM/TTS 调用。
