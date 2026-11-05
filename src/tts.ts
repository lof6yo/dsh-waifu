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
}

/** 一次实际发出的合成请求（排查用：设置页/curl 能直接看到发给供应商的 body）。 */
export interface TtsPayload {
  endpoint: string
  /** 发出去的 JSON body（audio 不在这里，只记请求）。 */
  body: { model: string; input: string; response_format?: string; voice?: string }
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

/** TTS 引擎抽象：换供应商只实现这一个接口。 */
export interface TtsEngine {
  synthesize(text: string, options: TtsVoiceOptions, signal?: AbortSignal): Promise<TtsAudio>
}

/** 缓存键：同一段文字 + 同一套语音参数才复用。 */
export function ttsCacheKey(text: string, options: TtsVoiceOptions): string {
  const payload = [options.model, options.voice ?? '', text].join('\u0000')
  return createHash('sha1').update(payload).digest('hex')
}

/** 缓存目录：`$DSH_HOME/waifu/tts-cache`。 */
export function ttsCacheDir(homeDir: string): string {
  return join(homeDir, 'tts-cache')
}

/** 读缓存（缺失返回 undefined）。 */
async function readCache(dir: string, key: string): Promise<Buffer | undefined> {
  try {
    return await readFile(join(dir, `${key}.mp3`))
  } catch {
    return undefined
  }
}

/** 写缓存并按数量上限清理最旧文件（失败不影响播放）。 */
async function writeCache(dir: string, key: string, audio: Buffer): Promise<void> {
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${key}.mp3`), audio)
    const names = (await readdir(dir)).filter((name) => name.endsWith('.mp3'))
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

/** 解析凭据：调用方每次操作都要重新取（凭据更新后无需重启）。 */
export type ApiKeyResolver = () => Promise<string | undefined>

/** OpenRouter TTS 引擎：`POST /api/v1/audio/speech` + 本地磁盘缓存。 */
export class OpenRouterTtsEngine implements TtsEngine {
  constructor(
    private readonly resolveKey: ApiKeyResolver,
    private readonly cacheHome: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly endpoint: string = OPENROUTER_SPEECH_URL,
    /** 排查钩子：每次合成前把要发的 body 报出去（缓存的也报，标 cached）。 */
    private readonly onPayload?: (payload: TtsPayload) => void,
  ) {}

  async synthesize(text: string, options: TtsVoiceOptions, signal?: AbortSignal): Promise<TtsAudio> {
    const trimmed = text.trim()
    if (!trimmed) throw new Error('empty-text')
    const key = ttsCacheKey(trimmed, options)
    const dir = ttsCacheDir(this.cacheHome)
    const hit = await readCache(dir, key)
    if (hit) {
      this.onPayload?.({
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
      this.onPayload?.({ endpoint: this.endpoint, body: body as TtsPayload['body'], cached: false })
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
