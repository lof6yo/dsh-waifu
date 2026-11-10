import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MiMoTtsEngine,
  MIMO_SPEECH_URL,
  mimoBody,
  mimoStreamBody,
  parseMiMoStream,
  pcmToWav,
  TTS_STREAM_SAMPLE_RATE,
  type TtsStreamFetcher,
  type TtsStreamResponseLike,
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

describe('MiMoTtsEngine（ADR-061）', () => {
  function withTempHome(run: (home: string) => Promise<void>): () => Promise<void> {
    return async () => {
      const home = mkdtempSync(join(tmpdir(), 'waifu-mimo-'))
      try {
        await run(home)
      } finally {
        rmSync(home, { recursive: true, force: true })
      }
    }
  }

  const MP3 = Buffer.from('ID3fake-mimo-mp3')
  const reply = (audio: Buffer): Response => new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', audio: { data: audio.toString('base64') } } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })

  it('chat/completions 形状：台词进 assistant、风格指令进 user，解析 base64 音频并缓存', withTempHome(async (home) => {
    const seen: TtsPayload[] = []
    const requests: Array<Record<string, unknown>> = []
    const fetcher = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
      expect(url).toBe(MIMO_SPEECH_URL)
      expect(init.headers.authorization).toBe('Bearer sk-mimo')
      requests.push(JSON.parse(init.body) as Record<string, unknown>)
      return reply(MP3)
    }) as unknown as typeof fetch
    const engine = new MiMoTtsEngine(async () => 'sk-mimo', home, fetcher, (p) => seen.push(p))

    const first = await engine.synthesize('你好呀。', { model: 'mimo-v2.5-tts', voice: '冰糖', style: '温柔、语速稍慢' })
    expect(first.cached).toBe(false)
    expect(first.mime).toBe('audio/mpeg')
    expect(first.audio.toString()).toBe(MP3.toString())
    expect(requests[0]).toEqual({
      model: 'mimo-v2.5-tts',
      messages: [
        { role: 'user', content: '温柔、语速稍慢' },
        { role: 'assistant', content: '你好呀。' },
      ],
      audio: { format: 'mp3', voice: '冰糖' },
      stream: false,
    })
    expect(seen[0].cached).toBe(false)
    expect(seen[0].endpoint).toBe(MIMO_SPEECH_URL)
    expect(seen[0].body).toEqual(requests[0])

    const second = await engine.synthesize('你好呀。', { model: 'mimo-v2.5-tts', voice: '冰糖', style: '温柔、语速稍慢' })
    expect(second.cached).toBe(true)
    expect(seen[1].cached).toBe(true)
    expect(requests).toHaveLength(1)
  }))

  it('没有 key 时直接失败并给出原因', withTempHome(async (home) => {
    const engine = new MiMoTtsEngine(async () => undefined, home, (async () => {
      throw new Error('should-not-call')
    }) as unknown as typeof fetch)
    await expect(engine.synthesize('你好', { model: 'mimo-v2.5-tts' })).rejects.toThrow('tts-key-missing')
  }))

  it('非 200 时把供应商原因带出来', withTempHome(async (home) => {
    const fetcher = (async () => new Response(JSON.stringify({ error: { message: 'invalid voice' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
    const engine = new MiMoTtsEngine(async () => 'k', home, fetcher)
    await expect(engine.synthesize('你好', { model: 'mimo-v2.5-tts' })).rejects.toThrow('tts-http 400: invalid voice')
  }))

  it('应答里没有音频时报错，不写缓存', withTempHome(async (home) => {
    const fetcher = (async () => new Response(JSON.stringify({ choices: [{ message: {} }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
    const engine = new MiMoTtsEngine(async () => 'k', home, fetcher)
    await expect(engine.synthesize('你好', { model: 'mimo-v2.5-tts' })).rejects.toThrow('tts-empty-audio')
  }))
})

describe('mimoBody', () => {
  it('没有风格指令时不带 user 消息，音色为空时不传 voice', () => {
    expect(mimoBody('晚安。', { model: 'mimo-v2.5-tts', voice: '  ' })).toEqual({
      model: 'mimo-v2.5-tts',
      messages: [{ role: 'assistant', content: '晚安。' }],
      audio: { format: 'mp3' },
      stream: false,
    })
  })
})

describe('ttsCacheKey 与风格指令', () => {
  it('风格指令不同则换键；空白风格指令不影响键', () => {
    const base = ttsCacheKey('你好', { model: 'mimo-v2.5-tts', voice: '冰糖' })
    expect(ttsCacheKey('你好', { model: 'mimo-v2.5-tts', voice: '冰糖', style: '  ' })).toBe(base)
    expect(ttsCacheKey('你好', { model: 'mimo-v2.5-tts', voice: '冰糖', style: '慵懒' })).not.toBe(base)
  })
})


describe('MiMo 流式合成（ADR-063）', () => {
  function withTempHome(run: (home: string) => Promise<void>): () => Promise<void> {
    return async () => {
      const home = mkdtempSync(join(tmpdir(), 'waifu-mimo-stream-'))
      try {
        await run(home)
      } finally {
        rmSync(home, { recursive: true, force: true })
      }
    }
  }

  /** 拼一段 SSE 文本：每片音频一个 chunk，按给定的切分点切块喂进去（模拟真实分块到达）。 */
  const sseText = (pieces: number[][]): string => pieces
    .map((pcm) => `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: Buffer.from(pcm).toString('base64') } } }] })}\n\n`)
    .join('')

  const streamingResponse = (text: string, cuts: number[] = []): TtsStreamResponseLike => {
    const parts: string[] = []
    let cursor = 0
    for (const cut of cuts) { parts.push(text.slice(cursor, cut)); cursor = cut }
    parts.push(text.slice(cursor))
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: (async function* () {
        for (const part of parts) yield Buffer.from(part, 'utf8')
      })(),
      text: async () => '',
    }
  }

  it('SSE 分片跨块到达也能逐片解析出 PCM', async () => {
    const text = sseText([[1, 2], [3, 4, 5], [6]])
    const chunks: Buffer[] = []
    // 故意在每个 chunk 中间切一刀：解析器必须自己把半行拼回去
    for await (const pcm of parseMiMoStream((async function* () {
      yield Buffer.from(text.slice(0, 7), 'utf8')
      yield Buffer.from(text.slice(7, 33), 'utf8')
      yield Buffer.from(text.slice(33), 'utf8')
    })())) chunks.push(pcm)
    expect(chunks.map((item) => [...item])).toEqual([[1, 2], [3, 4, 5], [6]])
  })

  it('整段流式：边收边给 PCM 分片，收完把 PCM 包成 WAV 落缓存，第二次命中缓存整段下发', withTempHome(async (home) => {
    const frames = [[5, 6, 7, 8], [9, 10, 11, 12]]
    const sse = sseText(frames)
    let calls = 0
    const streamFetcher: TtsStreamFetcher = async () => {
      calls += 1
      return streamingResponse(sse)
    }
    const seen: TtsPayload[] = []
    const engine = new MiMoTtsEngine(async () => 'k', home, undefined, (payload) => seen.push(payload), streamFetcher)

    const got: Buffer[] = []
    for await (const frame of engine.synthesizeStream('你好呀。', { model: 'mimo-v2.5-tts', voice: '冰糖' })) {
      expect(frame.kind).toBe('pcm')
      if (frame.kind === 'pcm') {
        expect(frame.sampleRate).toBe(TTS_STREAM_SAMPLE_RATE)
        expect(frame.channels).toBe(1)
        got.push(frame.data)
      }
    }
    expect(got.map((item) => [...item])).toEqual(frames)
    expect(seen[0].body).toMatchObject({ stream: true, audio: { format: 'pcm16', voice: '冰糖' } })

    const second: string[] = []
    for await (const frame of engine.synthesizeStream('你好呀。', { model: 'mimo-v2.5-tts', voice: '冰糖' })) {
      if (frame.kind === 'audio') {
        second.push(frame.audio.mime)
        // 缓存里是 WAV：文件头是 RIFF，数据长度 = 两片 PCM
        expect(frame.audio.audio.subarray(0, 4).toString()).toBe('RIFF')
        expect(frame.audio.audio.byteLength).toBe(44 + 8)
      }
    }
    expect(second).toEqual(['audio/wav'])
    expect(calls).toBe(1) // 第二次走缓存，没有再发请求
  }))

  it('流式接口非 200 时带出状态码', withTempHome(async (home) => {
    const streamFetcher: TtsStreamFetcher = async () => ({
      ok: false,
      status: 429,
      headers: { get: () => null },
      body: null,
      text: async () => 'rate limited',
    })
    const engine = new MiMoTtsEngine(async () => 'k', home, undefined, undefined, streamFetcher)
    const iterate = async () => {
      for await (const _ of engine.synthesizeStream('你好', { model: 'mimo-v2.5-tts' })) void _
    }
    await expect(iterate()).rejects.toThrow('tts-http 429: rate limited')
  }))

  it('mimoStreamBody：流式请求必须是 pcm16 + stream:true', () => {
    expect(mimoStreamBody('晚安。', { model: 'mimo-v2.5-tts', voice: '冰糖' }, '慵懒')).toEqual({
      model: 'mimo-v2.5-tts',
      messages: [
        { role: 'user', content: '慵懒' },
        { role: 'assistant', content: '晚安。' },
      ],
      audio: { format: 'pcm16', voice: '冰糖' },
      stream: true,
    })
  })

  it('pcmToWav 写出合法的 44 字节头', () => {
    const pcm = Buffer.from([1, 0, 2, 0])
    const wav = pcmToWav(pcm)
    expect(wav.byteLength).toBe(48)
    expect(wav.subarray(0, 4).toString()).toBe('RIFF')
    expect(wav.readUInt32LE(4)).toBe(36 + pcm.byteLength)
    expect(wav.subarray(8, 12).toString()).toBe('WAVE')
    expect(wav.readUInt16LE(22)).toBe(1)
    expect(wav.readUInt32LE(24)).toBe(TTS_STREAM_SAMPLE_RATE)
    expect(wav.readUInt16LE(34)).toBe(16)
    expect(wav.readUInt32LE(40)).toBe(pcm.byteLength)
  })
})
