import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OpenRouterTtsEngine,
  splitClauses,
  ttsCacheKey,
  type TtsVoiceOptions,
} from '../src/tts.ts'

const VOICE: TtsVoiceOptions = { model: 'fish-audio/drama-3', voice: '', instructions: 'test' }

describe('splitClauses', () => {
  it('按句读切分并保留标点', () => {
    expect(splitClauses('你好呀。今天过得怎么样？')).toEqual(['你好呀。', '今天过得怎么样？'])
  })

  it('过短的片段并入下一段', () => {
    expect(splitClauses('呀！真的吗？')).toEqual(['呀！真的吗？'])
  })

  it('没有标点时整句一段', () => {
    expect(splitClauses('你这个人真是奇怪')).toEqual(['你这个人真是奇怪'])
  })

  it('超长片段按上限硬切', () => {
    const text = '啊'.repeat(30)
    const pieces = splitClauses(text)
    expect(pieces.every((piece) => piece.length <= 24)).toBe(true)
    expect(pieces.join('')).toBe(text)
  })

  it('空文本返回空数组', () => {
    expect(splitClauses('   ')).toEqual([])
  })
})

describe('ttsCacheKey', () => {
  it('同参数同文本命中同一键，音色变化换键', () => {
    const a = ttsCacheKey('你好', VOICE)
    expect(ttsCacheKey('你好', { ...VOICE })).toBe(a)
    expect(ttsCacheKey('你好', { ...VOICE, voice: 'x' })).not.toBe(a)
    expect(ttsCacheKey('晚安', VOICE)).not.toBe(a)
  })
})

describe('OpenRouterTtsEngine', () => {
  function withTempHome(run: (home: string) => Promise<void>): () => Promise<void> {
    return async () => {
      const home = mkdtempSync(join(tmpdir(), 'waifu-tts-'))
      try {
        await run(home)
      } finally {
        rmSync(home, { recursive: true, force: true })
      }
    }
  }

  it('合成一次后命中本地缓存', withTempHome(async (home) => {
    let calls = 0
    const fetcher = (async () => {
      calls += 1
      return new Response(Buffer.from('ID3fake-mp3'), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      })
    }) as unknown as typeof fetch
    const engine = new OpenRouterTtsEngine(async () => 'sk-test', home, fetcher)
    const first = await engine.synthesize('你好呀。', VOICE)
    expect(first.cached).toBe(false)
    expect(first.mime).toBe('audio/mpeg')
    expect(first.audio.toString()).toBe('ID3fake-mp3')
    const second = await engine.synthesize('你好呀。', VOICE)
    expect(second.cached).toBe(true)
    expect(calls).toBe(1)
  }))

  it('没有 key 时直接失败并给出原因', withTempHome(async (home) => {
    const engine = new OpenRouterTtsEngine(async () => undefined, home, (async () => {
      throw new Error('should-not-call')
    }) as unknown as typeof fetch)
    await expect(engine.synthesize('你好', VOICE)).rejects.toThrow('tts-key-missing')
  }))

  it('带音色样本时请求体里出现 input_references，且缓存键随样本变化', withTempHome(async (home) => {
    const bodies: any[] = []
    const fetcher = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')))
      return new Response(Buffer.from('ID3fake-mp3'), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      })
    }) as unknown as typeof fetch
    const engine = new OpenRouterTtsEngine(async () => 'sk-test', home, fetcher)
    const sampleA = 'data:audio/mpeg;base64,AAAA'
    const sampleB = 'data:audio/mpeg;base64,BBBB'
    await engine.synthesize('你好呀。', { ...VOICE, reference: sampleA })
    expect(bodies[0].input_references).toEqual([{ type: 'input_audio', input_audio: { data: sampleA } }])
    // 换样本后不能命中上一条样本的缓存
    const second = await engine.synthesize('你好呀。', { ...VOICE, reference: sampleB })
    expect(second.cached).toBe(false)
    expect(bodies[1].input_references[0].input_audio.data).toBe(sampleB)
    // 不带样本的请求体里没有这个字段
    await engine.synthesize('换一句。', VOICE)
    expect(bodies[2].input_references).toBeUndefined()
    expect(ttsCacheKey('你好呀。', VOICE)).not.toBe(ttsCacheKey('你好呀。', { ...VOICE, reference: sampleA }))
  }))

  it('非 200 时把供应商原因带出来', withTempHome(async (home) => {
    const fetcher = (async () => new Response(JSON.stringify({ error: { message: 'bad voice' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
    const engine = new OpenRouterTtsEngine(async () => 'sk-test', home, fetcher)
    await expect(engine.synthesize('你好', VOICE)).rejects.toThrow('tts-http 400: bad voice')
  }))
})
