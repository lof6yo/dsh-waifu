/**
 * 设置页 → 宠物悬浮层的「动作 / 表情预览」命令（同一页面内 window CustomEvent，
 * 与 touch-edit.ts / pet-commands.ts 同款，不引入跨插件依赖）。
 *
 * 设置页「动作与表情」卡片每行右侧的「预览」按钮广播一条 `{kind, id}`；
 * 宠物层收到后按目录播放一次（动作走互动动作通道，表情走临时表情通道），
 * 用来在编辑释义前确认这个动作/表情到底长什么样。
 * @module dsh-waifu/client/catalog-preview
 */

/** 预览目标：动作组或表情。 */
export interface CatalogPreview {
  kind: 'motion' | 'expression'
  /** 目录 id（`Nod` / `blush` / …）。 */
  id: string
}

/** 预览事件名。 */
export const CATALOG_PREVIEW_EVENT = 'dsh-waifu:preview-catalog'

/** 广播预览请求（设置页调用）。 */
export function emitCatalogPreview(target: CatalogPreview): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<CatalogPreview>(CATALOG_PREVIEW_EVENT, { detail: target }))
}

/** 订阅预览请求（宠物层调用）；返回退订函数。 */
export function onCatalogPreview(handler: (target: CatalogPreview) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<CatalogPreview>).detail
    if (detail && typeof detail === 'object') handler(detail)
  }
  window.addEventListener(CATALOG_PREVIEW_EVENT, listener)
  return () => window.removeEventListener(CATALOG_PREVIEW_EVENT, listener)
}
