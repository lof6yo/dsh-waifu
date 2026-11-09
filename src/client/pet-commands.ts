/**
 * 设置页 → 宠物悬浮层的命令事件（window CustomEvent，同页面内通信）。
 *
 * `dsh-waifu:recenter`：设置页点「归位」时广播；宠物按「显示区中心距右/距下」的
 * 配置（config.homeRight / config.homeBottom）重新计算位置并持久化（需要视口与画布尺寸，
 * 只有宠物半边知道，所以不在 Host 侧直接重置）。
 * @module dsh-waifu/client/pet-commands
 */

/** 捕捉默认位置：设置页请求「角色现在在哪」，宠物半边算好百分比回调回来。 */
export interface HomePercent {
  /** 显示中心点距视口右侧的百分比（0–100）。 */
  right: number
  /** 显示中心点距视口底部的百分比（0–100）。 */
  bottom: number
}

/**
 * 把「当前 pos（右下角偏移，px）+ 画布尺寸 + 视口尺寸」换算成「画布几何中心距右/距下」的百分比。
 * 与 `homePositionFromConfig` 互逆：中心距右 = right + W/2（ADR-060）。
 * scale = 页面 UI 缩放（视觉 CSS px ÷ 逻辑 px）：换算回视觉视口百分比时要乘它（ADR-060）。
 * 任何尺寸非正时返回 null。
 */
export function homePercentFromPos(
  pos: { right: number; bottom: number },
  canvas: { width: number; height: number },
  viewport: { width: number; height: number },
  scale = 1,
): HomePercent | null {
  if (!(canvas.width > 0 && canvas.height > 0 && viewport.width > 0 && viewport.height > 0)) return null
  const clampPct = (value: number): number => Math.round(Math.min(100, Math.max(0, value)))
  const s = scale > 0 && Number.isFinite(scale) ? scale : 1
  return {
    right: clampPct((pos.right + canvas.width / 2) * s / viewport.width * 100),
    bottom: clampPct((pos.bottom + canvas.height / 2) * s / viewport.height * 100),
  }
}

/** 捕捉命令事件名。 */
export const CAPTURE_HOME_EVENT = 'dsh-waifu:capture-home'

/** 归位命令事件名。 */
export const RECENTER_EVENT = 'dsh-waifu:recenter'

/** 广播归位命令（设置页调用）。 */
export function emitRecenter(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(RECENTER_EVENT))
}

/** 订阅归位命令（宠物悬浮层调用）；返回退订函数。 */
export function onRecenter(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(RECENTER_EVENT, handler)
  return () => window.removeEventListener(RECENTER_EVENT, handler)
}

/**
 * 广播「捕捉当前位置」命令；宠物半边把当前中心点换算成百分比后回调。
 * 没有宠物半边在页面里时不会回调（设置页据此不做任何写入）。
 */
export function emitCaptureHome(captured: (home: HomePercent) => void): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<{ captured: (home: HomePercent) => void }>(CAPTURE_HOME_EVENT, {
    detail: { captured },
  }))
}

/** 订阅「捕捉」命令（宠物悬浮层调用）；返回退订函数。 */
export function onCaptureHome(handler: (captured: (home: HomePercent) => void) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<{ captured?: (home: HomePercent) => void }>).detail
    if (typeof detail?.captured === 'function') handler(detail.captured)
  }
  window.addEventListener(CAPTURE_HOME_EVENT, listener)
  return () => window.removeEventListener(CAPTURE_HOME_EVENT, listener)
}
