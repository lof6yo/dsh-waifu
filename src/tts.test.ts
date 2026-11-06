import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OpenRouterTtsEngine,
  splitClauses,
  ttsCacheKey,
  type TtsPayload,
  type TtsVoiceOptions,
} from '../src/tts.ts'

const VOICE: TtsVoiceOptions = { model: 'qwen/qwen-audio-3.0-tts-plus', voice: 'longanlingxin' }
const tmpDirs: string[] = []

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

  it('非 200 时把供应商原因带出来', withTempHome(async (home) => {
    const fetcher = (async () => new Response(JSON.stringify({ error: { message: 'bad voice' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
    const engine = new OpenRouterTtsEngine(async () => 'sk-test', home, fetcher)
    await expect(engine.synthesize('你好', VOICE)).rejects.toThrow('tts-http 400: bad voice')
  }))
})

describe('onPayload 排查钩子', () => {
  it('每次调用的钩子覆盖构造钩子：控制台按发生顺序记录（ADR-043）', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-waifu-tts-trace-'))
    tmpDirs.push(home)
    const global: TtsPayload[] = []
    const perCall: TtsPayload[] = []
    const fetcher = (async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as unknown as typeof fetch
    const engine = new OpenRouterTtsEngine(async () => 'k', home, fetcher, undefined, (p) => global.push(p))
    try {
      await engine.synthesize('哼。', { model: 'm', voice: 'v' }, undefined, (p) => perCall.push(p))
      expect(perCall).toHaveLength(1)
      expect(global).toHaveLength(0)
      expect(perCall[0].body.input).toBe('哼。')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('发请求前回报 body（含 model/voice/input），命中缓存标 cached', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-waifu-tts-payload-'))
    const seen: TtsPayload[] = []
    const fetcher = (async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as unknown as typeof fetch
    const engine = new OpenRouterTtsEngine(async () => 'k', home, fetcher, undefined, (p) => seen.push(p))
    tmpDirs.push(home)
    try {
      await engine.synthesize('哼。', { model: 'qwen/qwen-audio-3.0-tts-plus', voice: 'longanlingxin' })
      expect(seen).toHaveLength(1)
      expect(seen[0].cached).toBe(false)
      expect(seen[0].body).toEqual({
        model: 'qwen/qwen-audio-3.0-tts-plus',
        input: '哼。',
        response_format: 'mp3',
        voice: 'longanlingxin',
      })
      expect(seen[0].endpoint).toContain('/api/v1/audio/speech')
      await engine.synthesize('哼。', { model: 'qwen/qwen-audio-3.0-tts-plus', voice: 'longanlingxin' })
      expect(seen[1].cached).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
