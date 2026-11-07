/**
 * 演出时间线（ADR-047 P2）：把「LLM 文本流 + 目录标签」切成带 cue 的台词段。
 *
 * 这是编排引擎的第一块：它只做**排序与归属**——哪一句台词、这一句配哪些表情/动作，
 * 不判断「该演什么」（那是模型的事），也不决定「演得完吗」（那是客户端的队列）。
 *
 * 当前（P2）的行为必须与切分逻辑搬进来之前**逐字节一致**：
 * 段边界、段文本、段序号都不变，只是每段多带一个 `cues` 字段（可为空数组）。
 * 于是 P3 换上「按段执行 cue」的播放器时，仍有旧客户端可以原样跑。
 * @module dsh-waifu/timeline
 */

import { stripInlineTags } from './ai.ts'
import { splitClauses } from './tts.ts'

/** 一个演出指令：改脸/改眼的表情，或一个动作。 */
export interface TimelineCue {
  kind: 'expression' | 'motion'
  id: string
}

/** 一段台词：音频按 `index` 对应，`cues` 在这一段开始播时执行。 */
export interface TimelineClause {
  index: number
  text: string
  cues: TimelineCue[]
}

/**
 * 增量式台词切分器。调用方只要按到达顺序 `push()` 文本增量，
 * 收尾时 `end()`，就能拿到与原来 `speak.ts` 内部 `flush()` 完全一致的段落。
 */
export class ClauseTimeline {
  private buffer = ''
  private nextIndex = 0
  /** 已经收到、还没归属的 cue：挂到下一段切出来的台词上。 */
  private pending: TimelineCue[] = []

  /** 目录标签先于台词到达：挂到之后切出的第一段台词（即「开场的表情/动作」）。 */
  tag(expressions: readonly string[], motions: readonly string[]): void {
    for (const id of expressions) this.pending.push({ kind: 'expression', id })
    for (const id of motions) this.pending.push({ kind: 'motion', id })
  }

  /** 喂一段正文增量，返回已经切完整的段（最后一段可能还没说完，留着等下一块）。 */
  push(delta: string): TimelineClause[] {
    if (!delta) return []
    this.buffer += delta
    const pieces = splitClauses(this.buffer)
    if (pieces.length === 0) return []
    this.buffer = pieces[pieces.length - 1] ?? ''
    return this.take(pieces.slice(0, -1))
  }

  /** 收尾：把缓冲区里剩下的全部切出来（半句也要说完）。 */
  end(): TimelineClause[] {
    if (!this.buffer) return []
    const pieces = splitClauses(this.buffer)
    this.buffer = ''
    return this.take(pieces)
  }

  /** 已切出的段数（下一个段的序号）。 */
  get length(): number {
    return this.nextIndex
  }

  /** 切成正式的段落对象：剥掉句中残留标签、丢掉空段、只给第一段带 cue。 */
  private take(pieces: readonly string[]): TimelineClause[] {
    const out: TimelineClause[] = []
    for (const piece of pieces) {
      const text = stripInlineTags(piece)
      if (!text) continue
      const cues = this.pending
      this.pending = []
      out.push({ index: this.nextIndex, text, cues })
      this.nextIndex += 1
    }
    return out
  }
}
