/**
 * 设置页 ↔ 宠物悬浮层的「触摸部位编辑态」通信（同一页面内 window CustomEvent，
 * 不引入跨插件依赖、不需要 React context）。
 *
 * 数据流（spec §4）：
 * 1. 设置页点「编辑触摸部位」→ emitTouchEdit({active:true, model, parts})；
 * 2. 用户在设置页改部位/box（含未保存草稿）→ 每次变更 emitTouchEdit 最新草稿，
 *    宠物悬浮层据此实时重绘 box（box 实时显示在角色上）；
 * 3. 退出编辑 → emitTouchEdit({active:false, ...})，宠物恢复常规显示；
 * 4. 保存成功 → Host 经 SSE 推送新配置，宠物用 config.touchParts 作为非编辑态数据源。
 * @module dsh-live2d-pets/client/touch-edit
 */

import type { TouchPart } from '../models.ts'

/** 编辑态状态。 */
export interface TouchEditState {
  /** 是否处于编辑态（宠物强制可见并显示 box）。 */
  active: boolean
  /** 正在编辑的模型（preset id / 自定义模型 id / URL）。 */
  model: string
  /** 当前草稿部位（含未保存改动；宠物实时绘制它）。 */
  parts: TouchPart[]
  /** 高亮部位 id（设置页当前展开/编辑的部位；null 不高亮）。 */
  highlightPartId?: string | null
}

/** 编辑态事件名。 */
export const TOUCH_EDIT_EVENT = 'dsh-live2d-pets:touch-edit'

/** 广播编辑态（设置页调用）。 */
export function emitTouchEdit(state: TouchEditState): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<TouchEditState>(TOUCH_EDIT_EVENT, { detail: state }))
}

/** 订阅编辑态（宠物悬浮层调用）；返回退订函数。 */
export function onTouchEdit(handler: (state: TouchEditState) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<TouchEditState>).detail
    if (detail && typeof detail === 'object') handler(detail)
  }
  window.addEventListener(TOUCH_EDIT_EVENT, listener)
  return () => window.removeEventListener(TOUCH_EDIT_EVENT, listener)
}
