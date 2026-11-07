/**
 * 演出 cue 的排队规则（ADR-048 P3）：纯函数，浏览器渲染层只负责执行。
 *
 * 两条规则写在这里的原因：它们是「能不能演」的事实判断（队列满没满），
 * 不是「该演什么」的审美判断——后者归模型，前者归编排器。
 * @module dsh-waifu/client/cue-queue
 */

/** 一个演出指令，形状与 Host 的 `TimelineCue` 一致。 */
export interface Cue {
  kind: 'expression' | 'motion'
  id: string
}

/** 动作队列上限：超过就丢最旧的（宁可少演，也不要排队排到下一轮像抽搐）。 */
export const MOTION_QUEUE_MAX = 2

/** 校验 Host 下发的 `cues`：形状不对直接丢弃，目录外的 id 也不算数。 */
export function readCues(raw: unknown, isExpression: (id: string) => boolean, isMotion: (id: string) => boolean): Cue[] {
  if (!Array.isArray(raw)) return []
  const out: Cue[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const cue = item as { kind?: unknown; id?: unknown }
    if (typeof cue.id !== 'string') continue
    if (cue.kind === 'expression' && isExpression(cue.id)) out.push({ kind: 'expression', id: cue.id })
    else if (cue.kind === 'motion' && isMotion(cue.id)) out.push({ kind: 'motion', id: cue.id })
  }
  return out
}

/** 把一条 cue 拆成「立刻生效的表情」和「要排队播的动作」（一个动作一组，按序串行）。 */
export function splitCues(cues: readonly Cue[]): { expressions: string[]; motions: string[] } {
  const expressions: string[] = []
  const motions: string[] = []
  for (const cue of cues) {
    if (cue.kind === 'expression') {
      if (!expressions.includes(cue.id)) expressions.push(cue.id)
      continue
    }
    if (!motions.includes(cue.id)) motions.push(cue.id)
  }
  return { expressions, motions }
}

/**
 * 入队一个动作；队列满时丢最旧的那个并报告它（调用方负责留痕）。
 * 返回新队列与被丢弃的动作名（没有丢就是 `null`）。
 */
export function pushMotion(
  queue: readonly string[],
  name: string,
  max: number = MOTION_QUEUE_MAX,
): { queue: string[]; dropped: string | null } {
  if (!name) return { queue: [...queue], dropped: null }
  const next = [...queue, name]
  let dropped: string | null = null
  while (next.length > Math.max(1, max)) dropped = next.shift() ?? dropped
  return { queue: next, dropped }
}
