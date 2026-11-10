/**
 * 流式演绎管线（ADR-033 / ADR-037）：LLM 文本增量 → 句读切分 → 逐段合成 → 按序下发。
 *
 * 为什么按「句读」而不是按字流式：
 * - 一句台词只有十几个字，按标点切开后每段 4–24 字，第一段合成完就能出声；
 * - 客户端拿到的每个 `clause` 事件都带序号，音频也带同一序号，于是
 *   **气泡显示哪一段** 与 **正在播哪一段音频** 天然对齐（口型吃同一段音频的能量）。
 *
 * 事件顺序保证：`clause(i)` 一定先于 `audio(i)`；`audio(0..n)` 严格按序下发，
 * 即使后段合成先返回也会排队等前段（否则口型会对错嘴）。
 *
 * ADR-037：chunk 里不再是 `emotion`，而是 `tags`（表情/动作目录 id）与收尾的
 * `memory`（AI 的 [记] 行）——都原样透传给客户端。
 * @module dsh-waifu/speak
 */

import { type TtsAudio, type TtsStreamFrame } from './tts.ts'
import { stripInlineTags } from './ai.ts'
import type { ReplyChunk } from './ai.ts'
import { ClauseTimeline, type TimelineClause, type TimelineCue } from './timeline.ts'

/** 单次演绎最多合成的字符数（防止模型跑飞把一句话拉成一段独白）。 */
export const SPEAK_MAX_CHARS = 400

/** 事件下发函数（由路由层转成 SSE 帧）。 */
export type SpeakEmit = (
  event:
    | 'mode'
    | 'text'
    | 'clause'
    | 'audio'
    | 'audio.chunk'
    | 'audio.end'
    | 'tags'
    | 'memory'
    | 'done'
    | 'error'
    | 'debug',
  data: unknown,
) => void

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

/** 管线结果：最终整句 + 实际下发的段数 + AI 留下的记忆行 + 这轮的标签。 */
export interface SpeakResult {
  text: string
  clauses: number
  audio: number
  memory?: string
  /** 这轮实际生效的标签（写历史用，ADR-049：让模型看得到「标签长在台词里」）。 */
  tags?: { expressions: string[]; motions: string[] }
}

/**
 * 跑一轮流式演绎。
 * @param options - 文本流、合成函数与事件出口。
 * @returns 最终整句、段数、成功出声的段数与记忆行。
 */
export async function runSpeakPipeline(options: SpeakPipelineOptions): Promise<SpeakResult> {
  const { chunks, synthesize, emit, signal } = options
  const tasks = new Map<number, Promise<TtsAudio | null>>()
  let pumpIndex = 0
  let audioCount = 0
  let tagsOut: { expressions: string[]; motions: string[] } | undefined
  let total = ''
  let result = ''
  let memory: string | undefined
  /**
   * 串行下发链：所有「把音频发出去」的动作都挂在这条链上，
   * 于是同一时刻只会有一个 drain 在跑，不需要 `pumping` 标志位那种
   * 「已经在跑就直接返回」的写法——那种写法会让调用方的
   * `while (pumpIndex < nextIndex) await pump()` 变成空转的微任务死循环，
   * 把事件循环饿死（v0.4.3 的事故：DSH 所有请求一起卡住）。
   */
  let chain: Promise<void> = Promise.resolve()

  /** 按序把已就绪的音频发出去（后段先好也要等前段）；本函数自身不会再被重入。 */
  const drain = async (): Promise<void> => {
    while (true) {
      const task = tasks.get(pumpIndex)
      if (!task) return
      const index = pumpIndex
      tasks.delete(index)
      const audio = await task
      if (audio && !signal?.aborted) {
        audioCount += 1
        emit('audio', { index, mime: audio.mime, data: audio.audio.toString('base64') })
      }
      // 只有真正处理完这一段才前进，避免「索引前进但任务还在」的错位
      pumpIndex = index + 1
    }
  }

  /** 排队一次 drain；返回的是这条链的尾部，调用方可按需 await。 */
  const kick = (): Promise<void> => {
    chain = chain.then(drain, drain)
    return chain
  }

  /** 时间线：切段 + 把 cue 挂到对应的段上（ADR-047 P2，切分规则与旧实现逐字节一致）。 */
  const timeline = new ClauseTimeline()

  /** 把切好的段发出去并开始合成（先登记任务再启动，避免 pump 抢跑时任务还没进 Map）。 */
  const emitClauses = (clauses: readonly TimelineClause[]): void => {
    for (const clause of clauses) {
      emit('clause', clause)
      const task = synthesize(clause.text).catch(() => null)
      tasks.set(clause.index, task)
      void kick()
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
        emitClauses(timeline.push(delta))
      }
      continue
    }
    if (chunk.type === 'tags') {
      // 目录标签先于台词到达：转给前端驱动表情/动作，不进气泡也不进 TTS。
      // 同时登记到时间线上——P3 起客户端按「段」执行 cue，老客户端仍只认这个帧。
      timeline.tag(chunk.expressions, chunk.motions)
      tagsOut = { expressions: chunk.expressions, motions: chunk.motions }
      emit('tags', {
        expressions: chunk.expressions,
        motions: chunk.motions,
        ...(chunk.dropped === undefined ? {} : { dropped: chunk.dropped }),
      })
      continue
    }
    if (chunk.type === 'memory') {
      // AI 的 [记] 行（ADR-037）：Host 落盘，客户端只做日志
      memory = chunk.note
      emit('memory', { note: chunk.note })
      continue
    }
    if (chunk.type === 'done') {
      result = chunk.text
      continue
    }
    if (chunk.type === 'error') {
      // 出错也要把已经攒下的半句说出来，别让气泡空着
      emitClauses(timeline.end())
      await kick()
      emit('error', { error: chunk.error })
      emit('done', { text: stripInlineTags(result || total) })
      return {
        text: stripInlineTags(result || total),
        clauses: timeline.length,
        audio: audioCount,
        memory,
        ...(tagsOut === undefined ? {} : { tags: tagsOut }),
      }
    }
  }

  emitClauses(timeline.end())
  // 收尾：段数可能在 drain 期间继续增加，所以循环到索引 drained 完为止；
  // 每轮都真正 await 一次 drain（不会空转）
  while (pumpIndex < timeline.length) {
    if (!tasks.has(pumpIndex)) {
      pumpIndex += 1
      continue
    }
    await kick()
  }
  emit('done', { text: stripInlineTags(result || total) })
  return {
    text: stripInlineTags(result || total),
    clauses: timeline.length,
    audio: audioCount,
    memory,
    ...(tagsOut === undefined ? {} : { tags: tagsOut }),
  }
}


/** 整段演绎依赖（ADR-063）：一条台词一次合成，可选流式（MiMo）。 */
export interface WholeSpeakOptions {
  /** 已剥掉标签的整段台词。 */
  text: string
  /** 这一段开始播时要执行的演出指令。 */
  cues: readonly TimelineCue[]
  /** 流式合成：每片增量 PCM 直接下发（MiMo）；不给则回落到整段合成。 */
  stream?: () => AsyncGenerator<TtsStreamFrame>
  /** 整段合成（没有流式时用）：返回整段可解码音频，null = 没合成出来。 */
  synthesize: (text: string) => Promise<TtsAudio | null>
  emit: SpeakEmit
  signal?: AbortSignal
}

/**
 * 跑一轮「整段」演绎（ADR-063）：台词只有一段，合成粒度是整段而不是逐句。
 *
 * 事件顺序：先 `clause(0)`（气泡一次显示整段、cue 一次执行），再逐片 `audio.chunk`
 * 或一条 `audio`；流式播放完补一个 `audio.end`（带总时长），最后 `done`。
 * 流式中途出错时不再回退重发（避免同一段播两遍），只把已收到的部分播完。
 */
export async function runWholeSpeakPipeline(options: WholeSpeakOptions): Promise<SpeakResult> {
  const { text, cues, stream, synthesize, emit, signal } = options
  const trimmed = text.trim()
  if (!trimmed) {
    emit('done', { text: '' })
    return { text: '', clauses: 0, audio: 0 }
  }

  emit('clause', { index: 0, text: trimmed, cues: [...cues] })

  let audioCount = 0
  let chunkCount = 0
  let pcmBytes = 0
  let sampleRate = 24_000
  let channels = 1

  if (stream) {
    try {
      for await (const frame of stream()) {
        if (signal?.aborted) break
        if (frame.kind === 'audio') {
          audioCount += 1
          emit('audio', { index: 0, mime: frame.audio.mime, data: frame.audio.audio.toString('base64') })
          continue
        }
        sampleRate = frame.sampleRate
        channels = frame.channels
        pcmBytes += frame.data.byteLength
        emit('audio.chunk', {
          index: 0,
          seq: chunkCount,
          sampleRate: frame.sampleRate,
          channels: frame.channels,
          format: 's16le',
          data: frame.data.toString('base64'),
        })
        chunkCount += 1
      }
    } catch {
      // 流式失败：已经发出去的片段照常播，不再补发整段（否则会重复出声）
    }
  }

  // 没有任何音频时才回落到整段合成：流式断流但已经播了一部分的不重复
  if (audioCount === 0 && chunkCount === 0 && !signal?.aborted) {
    const audio = await synthesize(trimmed).catch(() => null)
    if (audio) {
      audioCount += 1
      emit('audio', { index: 0, mime: audio.mime, data: audio.audio.toString('base64') })
    }
  }

  const seconds = pcmBytes > 0 ? pcmBytes / (sampleRate * channels * 2) : 0
  if (chunkCount > 0) {
    emit('audio.end', { index: 0, seconds: Math.round(seconds * 100) / 100 })
  }
  emit('done', { text: trimmed })
  return { text: trimmed, clauses: 1, audio: Math.max(audioCount, chunkCount > 0 ? 1 : 0) }
}
