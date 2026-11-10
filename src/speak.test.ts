import { describe, expect, it } from 'vitest'
import { runSpeakPipeline, runWholeSpeakPipeline, type SpeakEmit } from '../src/speak.ts'
import type { ReplyChunk } from '../src/ai.ts'

/** 把若干分块包成异步迭代器（模拟 LLM 流）。 */
async function* fromChunks(chunks: ReplyChunk[]): AsyncGenerator<ReplyChunk> {
  for (const chunk of chunks) {
    await Promise.resolve()
    yield chunk
  }
}

function collector(): { events: { event: string; data: unknown }[]; emit: SpeakEmit } {
  const events: { event: string; data: unknown }[] = []
  return { events, emit: (event, data) => { events.push({ event, data }) } }
}

const audioOf = (text: string) => ({ mime: 'audio/mpeg', audio: Buffer.from(text), cached: false })

describe('runSpeakPipeline', () => {
  it('标签与记忆行透传为 tags/memory 事件，且不进气泡文本（ADR-037）', async () => {
    const { events, emit } = collector()
    const result = await runSpeakPipeline({
      chunks: fromChunks([
        { type: 'tags', expressions: ['blush'], motions: ['Tilt'] },
        { type: 'delta', text: '别、别看了啦。' },
        { type: 'memory', note: '主人爱看我' },
        { type: 'done', text: '别、别看了啦。' },
      ]),
      synthesize: async (text) => audioOf(text),
      emit,
    })
    expect(events[0]).toEqual({ event: 'tags', data: { expressions: ['blush'], motions: ['Tilt'] } })
    expect(result.text).toBe('别、别看了啦。')
    expect(result.memory).toBe('主人爱看我')
    expect(events.some((item) => item.event === 'memory')).toBe(true)
  })

  it('句中残留的表情/动作标签不会念出来（ADR-037 修订）', async () => {
    const { events, emit } = collector()
    const spoken: string[] = []
    const result = await runSpeakPipeline({
      chunks: fromChunks([
        { type: 'delta', text: '哼，[脸红] 又想欺负我。[歪头] 才不理你呢。' },
        { type: 'done', text: '哼，[脸红] 又想欺负我。[歪头] 才不理你呢。' },
      ]),
      synthesize: async (text) => { spoken.push(text); return audioOf(text) },
      emit,
    })
    expect(spoken).toEqual(['哼， 又想欺负我。', '才不理你呢。'])
    expect(spoken.join('')).not.toContain('脸红')
    expect(spoken.join('')).not.toContain('歪头')
    const clauses = events.filter((item) => item.event === 'clause').map((item) => (item.data as { text: string }).text)
    expect(clauses.join('')).not.toMatch(/脸红|歪头/)
    expect(result.text).not.toMatch(/脸红|歪头/)
  })

  it('按句读切段，并先发 clause 再发 audio', async () => {
    const { events, emit } = collector()
    const result = await runSpeakPipeline({
      chunks: fromChunks([
        { type: 'delta', text: '你好呀。' },
        { type: 'delta', text: '今天过得怎么样？' },
        { type: 'done', text: '你好呀。今天过得怎么样？' },
      ]),
      synthesize: async (text) => audioOf(text),
      emit,
    })
    expect(result.text).toBe('你好呀。今天过得怎么样？')
    expect(result.clauses).toBe(2)
    expect(result.audio).toBe(2)
    const order = events.map((item) => item.event)
    expect(order.indexOf('clause')).toBeLessThan(order.indexOf('audio'))
    const clauses = events.filter((item) => item.event === 'clause').map((item) => item.data as { index: number; text: string })
    expect(clauses.map((item) => item.index)).toEqual([0, 1])
    expect(clauses.map((item) => item.text)).toEqual(['你好呀。', '今天过得怎么样？'])
  })

  it('后段先合成好也按序号下发', async () => {
    const { events, emit } = collector()
    await runSpeakPipeline({
      chunks: fromChunks([
        { type: 'delta', text: '第一段。' },
        { type: 'delta', text: '第二段。' },
        { type: 'done', text: '第一段。第二段。' },
      ]),
      // 第一段慢 30ms，第二段立刻好
      synthesize: async (text) => {
        if (text.startsWith('第一段')) await new Promise((resolve) => setTimeout(resolve, 30))
        return audioOf(text)
      },
      emit,
    })
    const audios = events.filter((item) => item.event === 'audio').map((item) => item.data as { index: number })
    expect(audios.map((item) => item.index)).toEqual([0, 1])
  })

  it('合成失败只是这段没声音，管线继续', async () => {
    const { events, emit } = collector()
    const result = await runSpeakPipeline({
      chunks: fromChunks([
        { type: 'delta', text: '第一段。' },
        { type: 'delta', text: '第二段。' },
        { type: 'done', text: '第一段。第二段。' },
      ]),
      synthesize: async () => null,
      emit,
    })
    expect(result.audio).toBe(0)
    expect(events.filter((item) => item.event === 'clause')).toHaveLength(2)
    expect(events.at(-1)?.event).toBe('done')
  })


  it('合成慢时不空转：定时器不会被微任务饿死', async () => {
    const { emit } = collector()
    const order: string[] = []
    const timer = setTimeout(() => { order.push('timer') }, 0)
    await runSpeakPipeline({
      chunks: fromChunks([
        { type: 'delta', text: '第一段。' },
        { type: 'delta', text: '第二段。' },
        { type: 'done', text: '第一段。第二段。' },
      ]),
      // 每段都慢 60ms：旧实现会在收尾的 while 里空转，把定时器拖到最后
      synthesize: async () => {
        await new Promise((resolve) => setTimeout(resolve, 60))
        return audioOf('x')
      },
      emit,
    })
    order.push('end')
    clearTimeout(timer)
    expect(order).toEqual(['timer', 'end'])
  })

  it('LLM 报错时仍把已攒的文本说出来，再报错收尾', async () => {
    const { events, emit } = collector()
    const result = await runSpeakPipeline({
      chunks: fromChunks([
        { type: 'delta', text: '说到一半' },
        { type: 'error', error: 'empty-stream' },
      ]),
      synthesize: async (text) => audioOf(text),
      emit,
    })
    expect(result.text).toBe('说到一半')
    const names = events.map((item) => item.event)
    expect(names).toContain('error')
    expect(names.at(-1)).toBe('done')
  })
})


describe('runWholeSpeakPipeline（ADR-063 整段模式）', () => {
  it('先发 clause(0) 带 cue，再把 PCM 分片逐片下发，收尾补 audio.end 与 done', async () => {
    const { events, emit } = collector()
    const result = await runWholeSpeakPipeline({
      text: '今天也在等你回来。',
      cues: [{ kind: 'expression', id: 'blush' }, { kind: 'motion', id: 'Tilt' }],
      stream: async function* () {
        yield { kind: 'pcm', data: Buffer.alloc(4), sampleRate: 24000, channels: 1 }
        yield { kind: 'pcm', data: Buffer.alloc(4), sampleRate: 24000, channels: 1 }
      },
      synthesize: async () => { throw new Error('不该走到整段合成') },
      emit,
    })
    expect(events[0]).toEqual({
      event: 'clause',
      data: {
        index: 0,
        text: '今天也在等你回来。',
        cues: [{ kind: 'expression', id: 'blush' }, { kind: 'motion', id: 'Tilt' }],
      },
    })
    const chunks = events.filter((item) => item.event === 'audio.chunk')
    expect(chunks).toHaveLength(2)
    expect(chunks[0]!.data).toMatchObject({ index: 0, seq: 0, sampleRate: 24000, channels: 1, format: 's16le' })
    const end = events.find((item) => item.event === 'audio.end')
    // 8 字节 PCM / (24000 × 1 × 2) ≈ 0 秒（四舍五入后 0）
    expect(end).toEqual({ event: 'audio.end', data: { index: 0, seconds: 0 } })
    expect(events[events.length - 1]).toEqual({ event: 'done', data: { text: '今天也在等你回来。' } })
    expect(result).toEqual({ text: '今天也在等你回来。', clauses: 1, audio: 1 })
  })

  it('没有流式（千问 / 未开语音流式）时回落到整段合成，只发一条 audio', async () => {
    const { events, emit } = collector()
    const result = await runWholeSpeakPipeline({
      text: '晚安。',
      cues: [],
      synthesize: async (text) => audioOf(text),
      emit,
    })
    const audios = events.filter((item) => item.event === 'audio')
    expect(audios).toHaveLength(1)
    expect(events.some((item) => item.event === 'audio.end')).toBe(false)
    expect(result.audio).toBe(1)
  })

  it('流式中途报错时不再补发整段，避免同一句播两遍', async () => {
    const { events, emit } = collector()
    let synthesized = 0
    const result = await runWholeSpeakPipeline({
      text: '嗯。',
      cues: [],
      stream: async function* () {
        yield { kind: 'pcm', data: Buffer.alloc(8), sampleRate: 24000, channels: 1 }
        throw new Error('sse-broken')
      },
      synthesize: async () => { synthesized += 1; return audioOf('x') },
      emit,
    })
    expect(synthesized).toBe(0)
    expect(events.filter((item) => item.event === 'audio.chunk')).toHaveLength(1)
    expect(events.some((item) => item.event === 'done')).toBe(true)
    expect(result.audio).toBe(1)
  })

  it('流式首帧就是缓存命中的整段音频时，发一条 audio 而不是分片', async () => {
    const { events, emit } = collector()
    await runWholeSpeakPipeline({
      text: '早。',
      cues: [],
      stream: async function* () {
        yield { kind: 'audio', audio: { mime: 'audio/wav', audio: Buffer.from('RIFFxxxx'), cached: true } }
      },
      synthesize: async () => null,
      emit,
    })
    const audios = events.filter((item) => item.event === 'audio')
    expect(audios).toHaveLength(1)
    expect(audios[0]!.data).toMatchObject({ index: 0, mime: 'audio/wav' })
    expect(events.some((item) => item.event === 'audio.end')).toBe(false)
  })
})
