import { describe, expect, it } from 'vitest'
import { runSpeakPipeline } from '../src/speak.ts'
import type { ReplyChunk } from '../src/ai.ts'

/** 把若干分块包成异步迭代器（模拟 LLM 流）。 */
async function* fromChunks(chunks: ReplyChunk[]): AsyncGenerator<ReplyChunk> {
  for (const chunk of chunks) {
    await Promise.resolve()
    yield chunk
  }
}

function collector(): { events: { event: string; data: unknown }[]; emit: (event: 'text' | 'clause' | 'audio' | 'emotion' | 'done' | 'error', data: unknown) => void } {
  const events: { event: string; data: unknown }[] = []
  return { events, emit: (event, data) => { events.push({ event, data }) } }
}

const audioOf = (text: string) => ({ mime: 'audio/mpeg', audio: Buffer.from(text), cached: false })

describe('runSpeakPipeline', () => {
  it('情绪标签透传为 emotion 事件，且不进气泡文本', async () => {
    const { events, emit } = collector()
    const result = await runSpeakPipeline({
      chunks: fromChunks([
        { type: 'emotion', emotion: 'shy' },
        { type: 'delta', text: '别、别看了啦。' },
        { type: 'done', text: '别、别看了啦。' },
      ]),
      synthesize: async (text) => audioOf(text),
      emit,
    })
    expect(events[0]).toEqual({ event: 'emotion', data: { emotion: 'shy' } })
    expect(result.text).toBe('别、别看了啦。')
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
