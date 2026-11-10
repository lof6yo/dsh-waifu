/**
 * 语音合成（TTS）：把一句台词切成句读，逐段合成音频（ADR-032）。
 *
 * 设计要点：
 * - 引擎抽象成 {@link TtsEngine}，当前只实现 OpenRouter 的
 *   `POST /api/v1/audio/speech`（OpenAI 兼容）；换 ElevenLabs / MiniMax 的
 *   真流式实现时只需再加一个实现，上层（路由与客户端）不动。
 * - 句读切分放在这里（纯函数）：客户端与宿主共用同一套切分规则，气泡与音频
 *   才能按同一粒度对齐。
 * - 合成结果按 `model|voice|text` 哈希缓存到
 *   `$DSH_HOME/waifu/tts-cache/`，同一句重复播报不再花钱。
 * @module dsh-waifu/tts
 */

import { createHash } from 'node:crypto'
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 单段最长字符数：超过就硬切，避免一段音频太长导致首声延迟。 */
export const CLAUSE_MAX_CHARS = 24

/** 单段最短字符数：短于此的片段并入下一段（避免「呀」「唔」单独合成）。 */
export const CLAUSE_MIN_CHARS = 4

/** 合成超时（ms）：TTS 失败不该拖住气泡。 */
export const TTS_TIMEOUT_MS = 20_000

/** 缓存最多保留多少个音频文件（超出按 mtime 删最旧）。 */
export const TTS_CACHE_MAX_FILES = 200

/** 句读切分用的标点（保留在段尾，念出来才有停顿感）。 */
const CLAUSE_BREAKS = new Set(['。', '！', '？', '…', '；', '，', '、', '!', '?', ';', ',', '\n', '—', '~', '～'])

/** 文本最后一个非空字符是不是句读标点（是 = 这一段已经说完了，不必再等下一块）。 */
export function endsAtClauseBreak(text: string): boolean {
  const trimmed = text.trimEnd()
  if (!trimmed) return false
  return CLAUSE_BREAKS.has(trimmed[trimmed.length - 1]!)
}

/**
 * 把台词切成句读分段（纯函数）：
 * - 在标点后断开，标点跟随前一段；
 * - 过短的片段并入下一段，过长的片段按上限硬切；
 * - 去掉首尾空白与空段，全空文本返回空数组。
 * @param text - 待切分的台词。
 * @returns 分段列表（按原顺序）。
 */
export function splitClauses(text: string): string[] {
  const source = text.replace(/\r/g, '').trim()
  if (!source) return []
  const raw: string[] = []
  let current = ''
  for (const char of source) {
    current += char
    if (CLAUSE_BREAKS.has(char)) {
      raw.push(current)
      current = ''
    }
  }
  if (current) raw.push(current)

  const merged: string[] = []
  let pending = ''
  for (const piece of raw) {
    const trimmed = piece.trim()
    if (!trimmed) continue
    const joined = pending ? `${pending}${trimmed}` : trimmed
    if (joined.length < CLAUSE_MIN_CHARS) {
      pending = joined
      continue
    }
    merged.push(joined)
    pending = ''
  }
  if (pending) {
    if (merged.length > 0) merged[merged.length - 1] = `${merged[merged.length - 1]}${pending}`
    else merged.push(pending)
  }

  // 仍然过长的段按上限硬切（保留标点）
  const result: string[] = []
  for (const piece of merged) {
    let rest = piece
    while (rest.length > CLAUSE_MAX_CHARS) {
      result.push(rest.slice(0, CLAUSE_MAX_CHARS))
      rest = rest.slice(CLAUSE_MAX_CHARS)
    }
    if (rest) result.push(rest)
  }
  return result.filter((piece) => piece.trim().length > 0)
}

/** 一次合成请求的语音参数（都来自设置页，留口子给未来的编辑器）。 */
export interface TtsVoiceOptions {
  /** 模型 slug，例如 `qwen/qwen-audio-3.0-tts-plus`。 */
  model: string
  /** 音色标识；空字符串表示用模型默认音色。 */
  voice?: string
  /** 风格指令（自然语言）：目前只有小米 MiMo 引擎用它，其他引擎忽略（ADR-061）。 */
  style?: string
}

/** 一次实际发出的合成请求（排查用：设置页/curl 能直接看到发给供应商的 body）。 */
export interface TtsPayload {
  endpoint: string
  /**
   * 发出去的 JSON body（音频字节不在这里，只记请求）。
   * 各供应商形状不同：OpenRouter 是 `{ model, input, response_format, voice }`，
   * 小米 MiMo 是 chat/completions 形状（`{ model, messages, audio }`，ADR-061）。
   */
  body: Record<string, unknown>
  /** 是否命中本地缓存（命中时不会真的发请求）。 */
  cached: boolean
}

/** 合成结果。 */
export interface TtsAudio {
  /** MIME（目前总是 audio/mpeg）。 */
  mime: string
  /** 音频字节。 */
  audio: Buffer
  /** 是否命中本地缓存。 */
  cached: boolean
}

/** 流式合成的一帧：增量 PCM 分片，或缓存命中时的一整段可解码音频（ADR-063）。 */
export type TtsStreamFrame =
  | { kind: 'pcm'; data: Buffer; sampleRate: number; channels: number }
  | { kind: 'audio'; audio: TtsAudio }

/** 流式合成的采样参数（MiMo 固定 24 kHz 单声道 16 bit 小端）。 */
export const TTS_STREAM_SAMPLE_RATE = 24_000
export const TTS_STREAM_CHANNELS = 1

/** 流式合成的整体超时（ms）：整段台词可能十几秒，比单句宽一些。 */
export const TTS_STREAM_TIMEOUT_MS = 60_000

/** TTS 引擎抽象：换供应商只实现这一个接口。 */
export interface TtsEngine {
  synthesize(text: string, options: TtsVoiceOptions, signal?: AbortSignal): Promise<TtsAudio>
  /**
   * 流式合成（可选，ADR-063）：整段文本一次请求，边收边给音频帧。
   * 目前只有 MiMo 实现；没有实现的引擎由上层回落「整段非流式」。
   */
  synthesizeStream?(
    text: string,
    options: TtsVoiceOptions,
    signal?: AbortSignal,
    onPayload?: (payload: TtsPayload) => void,
  ): AsyncGenerator<TtsStreamFrame>
}

/** 缓存键：同一段文字 + 同一套语音参数才复用（风格指令不同也算不同音频）。 */
export function ttsCacheKey(text: string, options: TtsVoiceOptions): string {
  const parts = [options.model, options.voice ?? '']
  const style = options.style?.trim()
  if (style) parts.push(`style:${style}`)
  parts.push(text)
  return createHash('sha1').update(parts.join('\u0000')).digest('hex')
}

/** 缓存目录：`$DSH_HOME/waifu/tts-cache`。 */
export function ttsCacheDir(homeDir: string): string {
  return join(homeDir, 'tts-cache')
}

/** 读缓存（缺失返回 undefined）。`ext` 区分整段 mp3 与流式合成的 wav（ADR-063）。 */
async function readCache(dir: string, key: string, ext = 'mp3'): Promise<Buffer | undefined> {
  try {
    return await readFile(join(dir, `${key}.${ext}`))
  } catch {
    return undefined
  }
}

/** 每写这么多次缓存才清理一次（readdir + stat 全目录不便宜，没必要每段都做）。 */
const PRUNE_EVERY_WRITES = 20
let writesSincePrune = 0

/** 写缓存并按数量上限清理最旧文件（失败不影响播放）。 */
async function writeCache(dir: string, key: string, audio: Buffer, ext = 'mp3'): Promise<void> {
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${key}.${ext}`), audio)
    writesSincePrune += 1
    if (writesSincePrune < PRUNE_EVERY_WRITES) return
    writesSincePrune = 0
    const names = (await readdir(dir)).filter((name) => /\.(mp3|wav)$/.test(name))
    if (names.length <= TTS_CACHE_MAX_FILES) return
    const stamped = await Promise.all(names.map(async (name) => {
      const info = await stat(join(dir, name)).catch(() => null)
      return { name, at: info?.mtimeMs ?? 0 }
    }))
    stamped.sort((a, b) => a.at - b.at)
    for (const item of stamped.slice(0, stamped.length - TTS_CACHE_MAX_FILES)) {
      await unlink(join(dir, item.name)).catch(() => {})
    }
  } catch {
    // 缓存写失败只影响下次是否重复合成
  }
}

/** OpenRouter 的语音端点（OpenAI 兼容，返回原始音频字节）。 */
export const OPENROUTER_SPEECH_URL = 'https://openrouter.ai/api/v1/audio/speech'

/**
 * 合成专用连接池。
 *
 * 两个目的（ADR-051）：
 * - **绕开系统 HTTP 代理**：`NODE_USE_ENV_PROXY=1` 时全局 `fetch` 会走
 *   `HTTPS_PROXY`，跨境代理的 TLS 握手实测 0.6–1.3 s；直连 0.4 s，且少一跳。
 * - **跨轮保持连接**：`keepAlive` 60 s，同一轮的第 2、3 段与下一轮都能复用同一条
 *   TLS 连接，不再每轮重新握手（全局 fetch 的空闲窗口只有 4 s，等下一次开口
 *   早就断了）。
 */
const ttsAgent = new HttpsAgent({ keepAlive: true, keepAliveMsecs: 60_000, maxSockets: 4, maxFreeSockets: 2 })

/** 合成请求的应答（只用到这几样，方便测试注入假实现）。 */
export interface TtsResponseLike {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
  arrayBuffer(): Promise<ArrayBuffer>
}

/** 合成请求的发送器类型：默认直连，测试可注入假实现。 */
export type TtsFetcher = (endpoint: string, init: {
  method: string
  headers: Record<string, string>
  body: string
  signal: AbortSignal
}) => Promise<TtsResponseLike>

/**
 * 直连发送器：`node:https` 不读 `HTTPS_PROXY`，配合 {@link ttsAgent} 复用连接。
 * 设 `WAIFU_TTS_DIRECT=0` 时退回全局 `fetch`（只给「必须走代理才能出网」的环境用）。
 */
/** 退回全局 `fetch`（会走 `HTTPS_PROXY`）：直连不通时的兜底，免得整台机器没声音。 */
const proxiedTtsFetcher: TtsFetcher = async (endpoint, init) => {
  const response = await fetch(endpoint, { ...init })
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    json: () => response.json(),
    arrayBuffer: () => response.arrayBuffer(),
  }
}

export const directTtsFetcher: TtsFetcher = async (endpoint, init) => {
  if (process.env.WAIFU_TTS_DIRECT === '0') return await proxiedTtsFetcher(endpoint, init)
  try {
    return await directPost(endpoint, init)
  } catch {
    // 直连不通（公司网/被墙/DNS 污染）时退回代理：宁可慢一点，也不要没声音。
    return await proxiedTtsFetcher(endpoint, init)
  }
}

const directPost: TtsFetcher = async (endpoint, init) => {
  const url = new URL(endpoint)
  const payload = Buffer.from(init.body, 'utf8')
  return await new Promise<TtsResponseLike>((resolve, reject) => {
    const request = httpsRequest(
      {
        method: init.method,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        agent: ttsAgent,
        headers: { ...init.headers, 'content-length': String(payload.byteLength) },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('error', reject)
        response.on('end', () => {
          const body = Buffer.concat(chunks)
          const status = response.statusCode ?? 0
          resolve({
            ok: status >= 200 && status < 300,
            status,
            headers: {
              get: (name: string) => {
                const value = response.headers[name.toLowerCase()]
                return Array.isArray(value) ? value.join(', ') : value ?? null
              },
            },
            json: async () => JSON.parse(body.toString('utf8')) as unknown,
            arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
          })
        })
      },
    )
    request.on('error', reject)
    const abort = () => request.destroy(new Error('tts-aborted'))
    if (init.signal.aborted) abort()
    else init.signal.addEventListener('abort', abort, { once: true })
    request.end(payload)
  })
}

/** 流式应答（SSE）：正文按块给出，不必等整段音频缓冲完（ADR-063）。 */
export interface TtsStreamResponseLike {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  body: AsyncIterable<Uint8Array> | null
  text(): Promise<string>
}

/** 流式请求的发送器类型：默认直连，测试可注入假实现。 */
export type TtsStreamFetcher = (endpoint: string, init: {
  method: string
  headers: Record<string, string>
  body: string
  signal: AbortSignal
}) => Promise<TtsStreamResponseLike>

const proxiedStreamFetcher: TtsStreamFetcher = async (endpoint, init) => {
  const response = await fetch(endpoint, { ...init })
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    body: response.body as unknown as AsyncIterable<Uint8Array> | null,
    text: () => response.text(),
  }
}

const directStreamPost: TtsStreamFetcher = async (endpoint, init) => {
  const url = new URL(endpoint)
  const payload = Buffer.from(init.body, 'utf8')
  return await new Promise<TtsStreamResponseLike>((resolve, reject) => {
    const request = httpsRequest(
      {
        method: init.method,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        agent: ttsAgent,
        headers: { ...init.headers, 'content-length': String(payload.byteLength) },
      },
      (response) => {
        const status = response.statusCode ?? 0
        resolve({
          ok: status >= 200 && status < 300,
          status,
          headers: {
            get: (name: string) => {
              const value = response.headers[name.toLowerCase()]
              return Array.isArray(value) ? value.join(', ') : value ?? null
            },
          },
          // IncomingMessage 本身就是 AsyncIterable<Buffer>：边收边给，不缓冲整段
          body: response as unknown as AsyncIterable<Uint8Array>,
          text: () => new Promise<string>((done, fail) => {
            const chunks: Buffer[] = []
            response.on('data', (chunk: Buffer) => chunks.push(chunk))
            response.on('end', () => done(Buffer.concat(chunks).toString('utf8')))
            response.on('error', fail)
          }),
        })
      },
    )
    request.on('error', reject)
    const abort = () => request.destroy(new Error('tts-aborted'))
    if (init.signal.aborted) abort()
    else init.signal.addEventListener('abort', abort, { once: true })
    request.end(payload)
  })
}

/** 流式发送器：与 {@link directTtsFetcher} 同策略——先直连，失败退代理。 */
export const directTtsStreamFetcher: TtsStreamFetcher = async (endpoint, init) => {
  if (process.env.WAIFU_TTS_DIRECT === '0') return await proxiedStreamFetcher(endpoint, init)
  try {
    return await directStreamPost(endpoint, init)
  } catch {
    return await proxiedStreamFetcher(endpoint, init)
  }
}

/** 一行 SSE → PCM 分片（不是音频行返回 undefined）。 */
function pcmFromSseLine(line: string): Buffer | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return undefined
  const payload = trimmed.slice(5).trim()
  if (!payload || payload === '[DONE]') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return undefined
  }
  const encoded = (parsed as { choices?: Array<{ delta?: { audio?: { data?: unknown } } }> })
    .choices?.[0]?.delta?.audio?.data
  if (typeof encoded !== 'string' || encoded.length === 0) return undefined
  const pcm = Buffer.from(encoded, 'base64')
  return pcm.byteLength > 0 ? pcm : undefined
}

/**
 * 解析 MiMo 流式应答（SSE）：音频在 `choices[0].delta.audio.data`，base64 的 PCM 分片。
 * @param body - 应答正文（按块到达）。
 */
export async function* parseMiMoStream(body: AsyncIterable<Uint8Array>): AsyncGenerator<Buffer> {
  const decoder = new TextDecoder()
  let pending = ''
  for await (const chunk of body) {
    pending += decoder.decode(chunk, { stream: true })
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ''
    for (const line of lines) {
      const pcm = pcmFromSseLine(line)
      if (pcm !== undefined) yield pcm
    }
  }
  pending += decoder.decode()
  for (const line of pending.split(/\r?\n/)) {
    const pcm = pcmFromSseLine(line)
    if (pcm !== undefined) yield pcm
  }
}

/** 把 PCM16 小端分片包成 WAV（缓存用：下次命中整段下发，客户端可一次解码）。 */
export function pcmToWav(
  pcm: Buffer,
  sampleRate = TTS_STREAM_SAMPLE_RATE,
  channels = TTS_STREAM_CHANNELS,
): Buffer {
  const header = Buffer.alloc(44)
  const byteRate = sampleRate * channels * 2
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.byteLength, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(channels * 2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.byteLength, 40)
  return Buffer.concat([header, pcm])
}

/** 解析凭据：调用方每次操作都要重新取（凭据更新后无需重启）。 */
export type ApiKeyResolver = () => Promise<string | undefined>

/** OpenRouter TTS 引擎：`POST /api/v1/audio/speech` + 本地磁盘缓存。 */
export class OpenRouterTtsEngine implements TtsEngine {
  constructor(
    private readonly resolveKey: ApiKeyResolver,
    private readonly cacheHome: string,
    private readonly fetcher: TtsFetcher = directTtsFetcher,
    private readonly endpoint: string = OPENROUTER_SPEECH_URL,
    /** 排查钩子：每次合成前把要发的 body 报出去（缓存的也报，标 cached）。 */
    private readonly onPayload?: (payload: TtsPayload) => void,
  ) {}

  async synthesize(
    text: string,
    options: TtsVoiceOptions,
    signal?: AbortSignal,
    /** 本次调用的报文钩子（覆盖构造时的全局钩子）：调试控制台按发生顺序记。 */
    onPayload?: (payload: TtsPayload) => void,
  ): Promise<TtsAudio> {
    const report = onPayload ?? this.onPayload
    const trimmed = text.trim()
    if (!trimmed) throw new Error('empty-text')
    const key = ttsCacheKey(trimmed, options)
    const dir = ttsCacheDir(this.cacheHome)
    const hit = await readCache(dir, key)
    if (hit) {
      report?.({
        endpoint: this.endpoint,
        body: { model: options.model, input: trimmed, response_format: 'mp3', ...(options.voice ? { voice: options.voice } : {}) },
        cached: true,
      })
      return { mime: 'audio/mpeg', audio: hit, cached: true }
    }

    const apiKey = await this.resolveKey()
    if (!apiKey) throw new Error('tts-key-missing')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS)
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const body: Record<string, unknown> = {
        model: options.model,
        input: trimmed,
        response_format: 'mp3',
      }
      if (options.voice) body.voice = options.voice
      report?.({ endpoint: this.endpoint, body: body as TtsPayload['body'], cached: false })
      const response = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'http-referer': 'https://github.com/lof6yo/dsh-waifu',
          'x-title': 'dsh-waifu',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) {
        // 非 200 时返回 JSON 错误体，尽量把原因带出来（ADR-028 的排查思路）
        let detail = ''
        try {
          const payload = await response.json() as { error?: { message?: string } | string }
          detail = typeof payload.error === 'string' ? payload.error : payload.error?.message ?? ''
        } catch {
          detail = ''
        }
        throw new Error(`tts-http ${response.status}${detail ? `: ${detail}` : ''}`)
      }
      const audio = Buffer.from(await response.arrayBuffer())
      if (audio.byteLength === 0) throw new Error('tts-empty-audio')
      const mime = response.headers.get('content-type') ?? 'audio/mpeg'
      await writeCache(dir, key, audio)
      return { mime, audio, cached: false }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
}

/** 小米 MiMo 的语音端点是 OpenAI Chat Completions 形状（ADR-061）。 */
export const MIMO_SPEECH_URL = 'https://api.xiaomimimo.com/v1/chat/completions'

/** MiMo 应答里只关心这几个字段（OpenAI chat 形状 + audio 扩展）。 */
interface MiMoReply {
  error?: { message?: string } | string
  choices?: Array<{
    message?: {
      audio?: { data?: string }
    }
  }>
}

/**
 * 小米 MiMo TTS 引擎（ADR-061）：
 * - 文本必须放在 `role: 'assistant'` 的消息里；可选的 `role: 'user'` 消息承载
 *   自然语言风格指令（不会被念出来），对应设置页的「风格指令」；
 * - 请求 `audio.format: 'mp3'`，应答是 base64 音频（`choices[0].message.audio.data`）；
 * - 与 OpenRouter 引擎共用本地磁盘缓存，命中/写盘规则一致。
 */
export class MiMoTtsEngine implements TtsEngine {
  constructor(
    private readonly resolveKey: ApiKeyResolver,
    private readonly cacheHome: string,
    private readonly fetcher: TtsFetcher = directTtsFetcher,
    /** 排查钩子：每次合成前把要发的 body 报出去（缓存的也报，标 cached）。 */
    private readonly onPayload?: (payload: TtsPayload) => void,
    /** 流式发送器（ADR-063）：与 {@link fetcher} 分开注入，测试各自可假。 */
    private readonly streamFetcher: TtsStreamFetcher = directTtsStreamFetcher,
  ) {}

  async synthesize(
    text: string,
    options: TtsVoiceOptions,
    signal?: AbortSignal,
    /** 本次调用的报文钩子（覆盖构造时的全局钩子）：调试控制台按发生顺序记。 */
    onPayload?: (payload: TtsPayload) => void,
  ): Promise<TtsAudio> {
    const report = onPayload ?? this.onPayload
    const trimmed = text.trim()
    if (!trimmed) throw new Error('empty-text')
    const style = options.style?.trim() ?? ''
    const key = ttsCacheKey(trimmed, options)
    const dir = ttsCacheDir(this.cacheHome)
    const body = mimoBody(trimmed, options, style)
    const hit = await readCache(dir, key)
    if (hit) {
      report?.({ endpoint: MIMO_SPEECH_URL, body, cached: true })
      return { mime: 'audio/mpeg', audio: hit, cached: true }
    }

    const apiKey = await this.resolveKey()
    if (!apiKey) throw new Error('tts-key-missing')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS)
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      report?.({ endpoint: MIMO_SPEECH_URL, body, cached: false })
      const response = await this.fetcher(MIMO_SPEECH_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'http-referer': 'https://github.com/lof6yo/dsh-waifu',
          'x-title': 'dsh-waifu',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) {
        let detail = ''
        try {
          const payload = await response.json() as MiMoReply
          detail = typeof payload.error === 'string' ? payload.error : payload.error?.message ?? ''
        } catch {
          detail = ''
        }
        throw new Error(`tts-http ${response.status}${detail ? `: ${detail}` : ''}`)
      }
      const payload = await response.json() as MiMoReply
      const encoded = payload.choices?.[0]?.message?.audio?.data
      if (!encoded) throw new Error('tts-empty-audio')
      const audio = Buffer.from(encoded, 'base64')
      if (audio.byteLength === 0) throw new Error('tts-empty-audio')
      await writeCache(dir, key, audio)
      return { mime: 'audio/mpeg', audio, cached: false }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }

  /**
   * 整段流式合成（ADR-063）：一次请求把整段台词发过去，SSE 里每片 PCM 收到就 yield，
   * 客户端因此能边收边播；收完把 PCM 包成 WAV 落缓存，下次同一段直接整段下发。
   */
  async *synthesizeStream(
    text: string,
    options: TtsVoiceOptions,
    signal?: AbortSignal,
    onPayload?: (payload: TtsPayload) => void,
  ): AsyncGenerator<TtsStreamFrame> {
    const report = onPayload ?? this.onPayload
    const trimmed = text.trim()
    if (!trimmed) throw new Error('empty-text')
    const style = options.style?.trim() ?? ''
    const key = ttsCacheKey(trimmed, options)
    const dir = ttsCacheDir(this.cacheHome)
    const body = mimoStreamBody(trimmed, options, style)
    const hit = await readCache(dir, key, 'wav')
    if (hit) {
      report?.({ endpoint: MIMO_SPEECH_URL, body, cached: true })
      yield { kind: 'audio', audio: { mime: 'audio/wav', audio: hit, cached: true } }
      return
    }

    const apiKey = await this.resolveKey()
    if (!apiKey) throw new Error('tts-key-missing')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TTS_STREAM_TIMEOUT_MS)
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      report?.({ endpoint: MIMO_SPEECH_URL, body, cached: false })
      const response = await this.streamFetcher(MIMO_SPEECH_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'http-referer': 'https://github.com/lof6yo/dsh-waifu',
          'x-title': 'dsh-waifu',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) {
        let detail = ''
        try {
          detail = (await response.text()).slice(0, 200).trim()
        } catch {
          detail = ''
        }
        throw new Error(`tts-http ${response.status}${detail ? `: ${detail}` : ''}`)
      }
      if (!response.body) throw new Error('tts-empty-audio')
      const pieces: Buffer[] = []
      for await (const pcm of parseMiMoStream(response.body)) {
        pieces.push(pcm)
        yield { kind: 'pcm', data: pcm, sampleRate: TTS_STREAM_SAMPLE_RATE, channels: TTS_STREAM_CHANNELS }
      }
      if (pieces.length === 0) throw new Error('tts-empty-audio')
      await writeCache(dir, key, pcmToWav(Buffer.concat(pieces)), 'wav')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
  }
}

/** MiMo 的请求体（纯函数，测试直接比对）：assistant 放台词，user 可选放风格指令。 */
export function mimoBody(text: string, options: TtsVoiceOptions, style = ''): Record<string, unknown> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []
  if (style) messages.push({ role: 'user', content: style })
  messages.push({ role: 'assistant', content: text })
  const audio: Record<string, unknown> = { format: 'mp3' }
  const voice = options.voice?.trim()
  if (voice) audio.voice = voice
  return { model: options.model, messages, audio, stream: false }
}

/** MiMo 的流式请求体：与 {@link mimoBody} 同形，但 `stream: true` 且音频格式必须是 `pcm16`。 */
export function mimoStreamBody(text: string, options: TtsVoiceOptions, style = ''): Record<string, unknown> {
  const body = mimoBody(text, options, style)
  const audio = { ...(body.audio as Record<string, unknown>), format: 'pcm16' }
  return { ...body, audio, stream: true }
}
