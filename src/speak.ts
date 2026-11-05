/**
 * 流式演绎管线（ADR-033）：LLM 文本增量 → 句读切分 → 逐段合成 → 按序下发。
 *
 * 为什么按「句读」而不是按字流式：
 * - 一句台词只有十几个字，按标点切开后每段 4–24 字，第一段合成完就能出声；
 * - 客户端拿到的每个 `clause` 事件都带序号，音频也带同一序号，于是
 *   **气泡显示哪一段** 与 **正在播哪一段音频** 天然对齐（口型吃同一段音频的能量）。
 *
 * 事件顺序保证：`clause(i)` 一定先于 `audio(i)`；`audio(0..n)` 严格按序下发，
 * 即使后段合成先返回也会排队等前段（否则口型会对错嘴）。
 * @module dsh-waifu/speak
 */

import { splitClauses, type TtsAudio } from './tts.ts'
import type { ReplyChunk } from './ai.ts'

/** 单次演绎最多合成的字符数（防止模型跑飞把一句话拉成一段独白）。 */
export const SPEAK_MAX_CHARS = 400

/** 事件下发函数（由路由层转成 SSE 帧）。 */
export type SpeakEmit = (event: 'text' | 'clause' | 'audio' | 'done' | 'error', data: unknown) => void

/** 管线依赖：假实现即可测试（见 speak.test.ts）。 */
export interface SpeakPipelineOptions {
  /** LLM 文本流（`streamReply`）。 */
  chunks: AsyncIterable<ReplyChunk>
  /** 合成一段音频；返回 null 表示这段没合成出来（管线继续，只是没声音）。 */
  synthesize: (text: string) => Promise<TtsAudio | null>
  /** 事件出口。 */
  emit: SpeakEmit
  /** 中止信号（连接断开时停止后续合成）。 */
  signal?: AbortSignal
}

/** 管线结果：最终整句 + 实际下发的段数。 */
export interface SpeakResult {
  text: string
  clauses: number
  audio: number
}

/**
 * 跑一轮流式演绎。
 * @param options - 文本流、合成函数与事件出口。
 * @returns 最终整句、段数与成功出声的段数。
 */
export async function runSpeakPipeline(options: SpeakPipelineOptions): Promise<SpeakResult> {
  const { chunks, synthesize, emit, signal } = options
  const tasks = new Map<number, Promise<TtsAudio | null>>()
  let nextIndex = 0
  let pumpIndex = 0
  let audioCount = 0
  let buffer = ''
  let total = ''
  let result = ''
  let pumping = false

  /** 按序把已就绪的音频发出去（后段先好也要等前段）。 */
  const pump = async (): Promise<void> => {
    if (pumping) return
    pumping = true
    try {
      while (true) {
        const task = tasks.get(pumpIndex)
        if (!task) break
        const audio = await task
        tasks.delete(pumpIndex)
        if (audio && !signal?.aborted) {
          audioCount += 1
          emit('audio', { index: pumpIndex, mime: audio.mime, data: audio.audio.toString('base64') })
        }
        pumpIndex += 1
      }
    } finally {
      pumping = false
    }
  }

  /** 把缓冲区里已完整的段落切出去（最后一段可能还没说完，留到下次）。 */
  const flush = (final: boolean): void => {
    if (!buffer) return
    const pieces = splitClauses(buffer)
    if (pieces.length === 0) {
      if (final) buffer = ''
      return
    }
    const ready = final ? pieces : pieces.slice(0, -1)
    buffer = final ? '' : pieces[pieces.length - 1] ?? ''
    for (const piece of ready) {
      const index = nextIndex
      nextIndex += 1
      emit('clause', { index, text: piece })
      // 先登记任务再启动，避免 pump 抢跑时任务还没进 Map
      const task = synthesize(piece).catch(() => null)
      tasks.set(index, task)
      void pump()
    }
  }

  for await (const chunk of chunks) {
    if (signal?.aborted) break
    if (chunk.type === 'delta') {
      emit('text', { delta: chunk.text })
      if (total.length < SPEAK_MAX_CHARS) {
        const room = SPEAK_MAX_CHARS - total.length
        const delta = chunk.text.slice(0, room)
        total += delta
        buffer = `${buffer}${delta}`
        flush(false)
      }
      continue
    }
    if (chunk.type === 'done') {
      result = chunk.text
      continue
    }
    if (chunk.type === 'error') {
      // 出错也要把已经攒下的半句说出来，别让气泡空着
      flush(true)
      await pump()
      emit('error', { error: chunk.error })
      emit('done', { text: result || total })
      return { text: result || total, clauses: nextIndex, audio: audioCount }
    }
  }

  flush(true)
  await pump()
  while (pumpIndex < nextIndex) await pump()
  emit('done', { text: result || total })
  return { text: result || total, clauses: nextIndex, audio: audioCount }
}
