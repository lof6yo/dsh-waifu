/**
 * 设置页 → 宠物悬浮层的命令事件（window CustomEvent，同页面内通信）。
 *
 * `dsh-waifu:recenter`：设置页点「归位」时广播；宠物按「显示区中心距右/距下」的
 * 配置（config.homeRight / config.homeBottom）重新计算位置并持久化（需要视口与画布尺寸，
 * 只有宠物半边知道，所以不在 Host 侧直接重置）。
 * @module dsh-waifu/client/pet-commands
 */

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
