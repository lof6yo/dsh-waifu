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

import { openTagStart, resolveTag } from './ai.ts'
import { endsAtClauseBreak, splitClauses } from './tts.ts'

/** 正文里的方括号标签（只认目录内的，别的方括号原样保留）。 */
const TAG_ANY = /[[［【(（〔〖]\s*([^\]］】）}〕〗\n]{1,32})\s*[\])］】）}〕〗]/g

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
    // 尾部可能是没闭合的标签（`[No`）：切句/上屏都得等它闭合，否则会把半个标签念出来
    const open = openTagStart(this.buffer)
    const safe = open >= 0 ? this.buffer.slice(0, open) : this.buffer
    const pieces = splitClauses(safe)
    if (pieces.length === 0) return []
    // 已经说到标点上了：这一段可以直接播，不必等下一块凑够两段
    // （首声延迟里那截「等下一个字」就是这么省掉的）
    if (endsAtClauseBreak(safe)) {
      this.buffer = this.buffer.slice(safe.length)
      return this.take(pieces)
    }
    const tail = safe.slice(safe.length - (pieces[pieces.length - 1] ?? '').length)
    this.buffer = `${tail}${this.buffer.slice(safe.length)}`
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

  /**
   * 切成正式的段落对象：抽出标签、剥掉正文、丢掉空段。
   *
   * 归属规则（ADR-048）：标签属于**它之后**的那句话。所以出现在段尾的标签顺延给下一段，
   * 段内的标签留给本段——这样「唔…别、[Nod]别戳了啦」的摇头跟后半句一起发生。
   */
  private take(pieces: readonly string[]): TimelineClause[] {
    const out: TimelineClause[] = []
    for (const piece of pieces) {
      const extracted = extractTags(piece, this.pending)
      this.pending = extracted.carry
      const text = extracted.text
      if (!text) continue
      const cues = [...extracted.cues]
      out.push({ index: this.nextIndex, text, cues })
      this.nextIndex += 1
    }
    return out
  }
}

/**
 * 从一段文字里抽走目录标签：返回干净正文、本段该执行的 cue、以及要顺延给下一段的 cue。
 * 认不出的方括号（例如「[附件]」）原样留在正文里。
 */
function extractTags(
  piece: string,
  pending: readonly TimelineCue[],
): { text: string; cues: TimelineCue[]; carry: TimelineCue[] } {
  const cues: TimelineCue[] = [...pending]
  const carry: TimelineCue[] = []
  let text = ''
  let cursor = 0
  TAG_ANY.lastIndex = 0
  for (let match = TAG_ANY.exec(piece); match !== null; match = TAG_ANY.exec(piece)) {
    const hit = resolveTag(match[1])
    if (hit === null) continue
    text += piece.slice(cursor, match.index)
    cursor = match.index + match[0].length
    const cue: TimelineCue = { kind: hit.kind, id: hit.id }
    // 段尾的标签属于下一句
    const trailing = piece.slice(cursor).trim() === ''
    if (trailing) carry.push(cue)
    else cues.push(cue)
  }
  text += piece.slice(cursor)
  return { text: text.replace(/\s{2,}/g, ' ').trimStart(), cues, carry }
}
