/**
 * 宠物 HTTP 路由：浏览器半区通过同源 JSON 端点（/api/dsh-waifu/*）、
 * SSE 状态推送端点（/api/dsh-waifu/events，ADR-006）与素材静态路由
 * （/waifu-assets/*，含内置模型 assets/models/）。
 * @module dsh-waifu/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { PetService } from './service.ts'
import type { EventBindings, TouchPart } from './models.ts'
import { appendClientLog, clientLogPath } from './client-log.ts'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'

/** 设置读写 API（Host 直连插件设置文件；见 settings-store.ts / ADR-013）。 */
export interface SettingsRoutesApi {
  view(): { value: unknown; writable?: boolean; error?: string | null; path?: string }
  write(ops: readonly SettingsPathOp[]): Promise<unknown> | unknown
}

/** 浏览器侧宠物 API 基路径。 */
export const PET_API_PREFIX = '/api/dsh-waifu'

/** 浏览器侧素材静态路由基路径（vendor 运行时脚本 + 内置模型 assets）。 */
export const PET_ASSET_PREFIX = '/waifu-assets'

/** 包根目录（从本模块自身位置解析）。 */
export function petPackageRoot(importMetaUrl: string): string {
  return fileURLToPath(new URL('../', importMetaUrl))
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function requireMethod(req: IncomingMessage, res: ServerResponse, method: string): boolean {
  if (req.method === method) return true
  json(res, 405, { ok: false, error: 'method-not-allowed' })
  return false
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('body-too-large'))
        queueMicrotask(() => req.destroy())
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid-json'))
      }
    })
    req.on('error', reject)
  })
}

function getRoute(path: string, run: () => Promise<unknown>): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): void => {
      if (!requireMethod(req, res, 'GET')) return
      run().then((value) => json(res, 200, value), (error) => {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    },
  }
}

function postRoute(path: string, run: (body: Record<string, unknown>) => Promise<unknown>): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!requireMethod(req, res, 'POST')) return Promise.resolve()
      return readJsonBody(req).then((body) => {
        const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
        return run(record).then(
          (value) => json(res, 200, value),
          (error) => json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) }),
        )
      }, (error) => {
        json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    },
  }
}

/**
 * 同一 path 上挂 GET + POST（webServer 按 path 唯一注册，不按 method 分表；
 * 见 dsh-host-webserver register：duplicate exact route）。
 */
function getPostRoute(
  path: string,
  get: () => Promise<unknown> | unknown,
  post: (body: Record<string, unknown>) => Promise<unknown> | unknown,
): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): void | Promise<void> => {
      if (req.method === 'GET') {
        return Promise.resolve().then(get).then((value) => json(res, 200, value), (error) => {
          json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        })
      }
      if (req.method === 'POST') {
        return readJsonBody(req).then((body) => {
          const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
          return Promise.resolve().then(() => post(record)).then(
            (value) => json(res, 200, value),
            (error) => json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) }),
          )
        }, (error) => {
          json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        })
      }
      json(res, 405, { ok: false, error: 'method-not-allowed' })
    },
  }
}

/** SSE 心跳间隔（ms）：保持空闲连接活性，防止被中间层/浏览器回收。 */
const SSE_HEARTBEAT_MS = 30_000

/**
 * SSE 状态推送端点（ADR-006）：连接即回发当前快照，之后每次服务变化
 * （状态/显示/配置）推送新快照。EventSource 断线自动重连（retry 3s），
 * 重连后服务端立即回发快照，客户端无需补偿拉取。
 * @param onStream - 路由生命周期钩子：插件卸载时由调用方关闭全部活跃流。
 */
function sseStateRoute(
  path: string,
  service: PetService,
  onStream?: (close: () => void) => void,
): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): void => {
      if (req.method !== 'GET') {
        json(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      // 断线后写入会抛错，吞掉避免未处理异常
      res.on('error', () => {})
      res.write('retry: 3000\n\n')
      const send = () => { res.write(`data: ${JSON.stringify(service.snapshot())}\n\n`) }
      send()
      const unsubscribe = service.onChange(send)
      const heartbeat = setInterval(() => { res.write(': ping\n\n') }, SSE_HEARTBEAT_MS)
      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        unsubscribe()
        clearInterval(heartbeat)
        try { res.end() } catch { /* 连接已关闭 */ }
      }
      req.on('close', close)
      res.on('close', close)
      onStream?.(close)
    },
  }
}

/** 简单 MIME 推断（素材/本地模型路由用）。 */
function mimeForFile(file: string): string {
  const lower = file.toLowerCase()
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.moc3') || lower.endsWith('.bin')) return 'application/octet-stream'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.js')) return 'text/javascript'
  if (lower.endsWith('.css')) return 'text/css'
  if (lower.endsWith('.map')) return 'application/json'
  return 'application/octet-stream'
}

/** 通用静态文件响应（含 HEAD；文件不存在 404）。 */
function serveFile(req: IncomingMessage, res: ServerResponse, file: string): Promise<void> {
  return readFile(file).then((body) => {
    res.writeHead(200, {
      'content-type': mimeForFile(file),
      'content-length': String(body.byteLength),
      'cache-control': 'no-cache',
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(body)
  }, () => {
    res.writeHead(404)
    res.end()
  })
}

/** AI 设置 API（ADR-025）：provider/模型候选（来自 DSH 的 llm 目录）与人设文件读写。 */
export interface AiRoutesApi {
  /** 已注册的 provider 与其模型目录（模型目录可能为空：适配器不提供清单）。 */
  options(): Promise<{ providers: { id: string; name: string }[]; models: Record<string, { id: string; name: string }[]> }>
  /** 读人设文件（缺失时自动写入默认）。 */
  readPersona(): { text: string; path: string }
  /** 写人设文件（超长截断；空白回退默认人设）。 */
  writePersona(text: string): { text: string; path: string }
  /** 用指定（或已保存的）provider/model 跑一次真实请求，把失败原因直接回传。 */
  check?(input?: { provider?: string; model?: string }): Promise<{ ok: boolean; text?: string; error?: string }>
  /** 排查用：历史缓冲 + 最近一次实际发出的载荷。 */
  debug?(): Promise<unknown> | unknown
}

/** AI 回复 API（ADR-025）：Host 侧由 `ctx.llm` 实现，测试可注入假实现。 */
export interface InteractRoutesApi {
  reply(input: { kind: 'tap' | 'state' | 'chat'; part?: string; state?: string; hint?: string; text?: string; tz?: string }): Promise<{
    ok: boolean
    text?: string
    /** 模型标注的情绪（happy / angry / sad / shy / surprised / smug / neutral）。 */
    emotion?: string | null
    error?: string
  }>
}

/** 流式演绎 API（ADR-033）：文本增量 → 句读 → 音频，事件由路由层写成 SSE 帧。 */
export interface SpeakRoutesApi {
  /**
   * 跑一轮流式演绎并把事件写进 `emit`。
   * @param input - 场景（触摸/状态），与 `/interact` 同构。
   * @param emit - `(event, data)`，由路由层转成 `event: …\ndata: …`。
   * @param signal - 连接断开时中止合成。
   */
  stream(
    input: { kind: 'tap' | 'state' | 'chat'; part?: string; state?: string; hint?: string; text?: string; tz?: string },
    emit: (event: 'text' | 'clause' | 'audio' | 'emotion' | 'done' | 'error', data: unknown) => void,
    signal: AbortSignal,
  ): Promise<void>
  /** 单段合成（排查用）：直接回一段音频字节。 */
  synthesize?(text: string): Promise<{ mime: string; audio: Buffer }>
}

/** 构建完整路由族（API + SSE + 素材 + 本地模型）供 ctx.webServer.register。 */
export function makePetRoutes(deps: {
  service: PetService
  packageRoot: string
  settings: SettingsRoutesApi
  /** AI 回复（可选：未接线时不注册 /interact）。 */
  ai?: InteractRoutesApi
  /** AI 设置（可选：未接线时不注册 /ai-options 与 /persona）。 */
  aiSettings?: AiRoutesApi
  /** 流式演绎 + 语音合成（可选：未接线时不注册 /speak 与 /tts）。 */
  speak?: SpeakRoutesApi
  /** SSE 活跃流注册钩子：插件卸载时由调用方逐一 close（ADR-006）。 */
  onStream?: (close: () => void) => void
}): WebRoute[] {
  const { service, packageRoot, settings, ai, aiSettings, speak, onStream } = deps
  const apiRoutes: WebRoute[] = [
    sseStateRoute(`${PET_API_PREFIX}/events`, service, onStream),
    getRoute(`${PET_API_PREFIX}/state`, async () => service.snapshot()),
    // 触摸部位（spec §4）：GET 读当前模型 + 文件视图；POST 保存某模型的部位列表
    getPostRoute(
      `${PET_API_PREFIX}/touch-parts`,
      () => {
        const view = service.touchPartsFile()
        const model = service.snapshot().config.model
        return {
          model,
          parts: service.touchPartsFor(model),
          saved: view.models[model] !== undefined,
          // 当前模型生效的事件绑定（动画组 + 台词池，含用户覆盖）；设置页「事件绑定」据此初始化
          events: service.effectiveEvents(model),
          error: view.error,
          path: view.path,
        }
      },
      (body) => {
        const model = typeof body.model === 'string' ? body.model.trim() : ''
        if (!model) throw new Error('model 不能为空')
        const parts = Array.isArray(body.parts) ? body.parts as TouchPart[] : []
        const events = body.events === undefined
          ? undefined
          : (typeof body.events === 'object' && body.events !== null
            ? body.events as Partial<EventBindings>
            : {})
        const view = service.saveTouchParts(model, parts, events)
        return {
          ok: true,
          model,
          touchParts: service.touchPartsFor(model),
          events: service.effectiveEvents(model),
          error: view.error,
          path: view.path,
        }
      },
    ),
    getPostRoute(
      `${PET_API_PREFIX}/settings`,
      () => settings.view(),
      (body) => {
        const ops = Array.isArray(body.ops) ? body.ops as SettingsPathOp[] : []
        return Promise.resolve(settings.write(ops)).then(() => settings.view())
      },
    ),
    postRoute(`${PET_API_PREFIX}/set-display`, (body) => {
      const patch: { right?: number; bottom?: number; size?: number } = {}
      if (typeof body.right === 'number') patch.right = body.right
      if (typeof body.bottom === 'number') patch.bottom = body.bottom
      if (typeof body.size === 'number') patch.size = body.size
      return Promise.resolve({ ok: true, display: service.setDisplay(patch) })
    }),
    postRoute(`${PET_API_PREFIX}/reset-display`, () => Promise.resolve({ ok: true, display: service.resetDisplay() })),
    // AI 设置（ADR-025）：provider/模型候选 + 人设文件读写（设置页下拉与文本框用）
    ...(aiSettings ? [
      getRoute(`${PET_API_PREFIX}/ai-options`, () => aiSettings.options()),
      getPostRoute(
        `${PET_API_PREFIX}/persona`,
        () => aiSettings.readPersona(),
        (body) => aiSettings.writePersona(typeof body.text === 'string' ? body.text : ''),
      ),
      // 连通性自检：设置页「测试连接」用它把 provider/模型的真实失败原因打出来
      ...(aiSettings.debug ? [getRoute(`${PET_API_PREFIX}/ai-debug`, () => Promise.resolve(aiSettings.debug!()))] : []),
      ...(aiSettings.check ? [postRoute(`${PET_API_PREFIX}/ai-check`, (body) => aiSettings.check!({
        provider: typeof body.provider === 'string' && body.provider.length > 0 ? body.provider : undefined,
        model: typeof body.model === 'string' && body.model.length > 0 ? body.model : undefined,
      }))] : []),
    ] : []),
    // AI 回复（ADR-025）：客户端上报「戳了哪里 / 变成什么状态」，Host 用 ctx.llm 生成一句台词
    ...(ai ? [postRoute(`${PET_API_PREFIX}/interact`, (body) => {
      const kind = body.kind === 'state' ? 'state' as const : body.kind === 'chat' ? 'chat' as const : 'tap' as const
      const part = typeof body.part === 'string' ? body.part.slice(0, 40) : undefined
      const state = typeof body.state === 'string' ? body.state.slice(0, 20) : undefined
      const hint = typeof body.hint === 'string' ? body.hint.slice(0, 120) : undefined
      const text = typeof body.text === 'string' ? body.text.slice(0, 200) : undefined
      const tz = typeof body.tz === 'string' ? body.tz.slice(0, 64) : undefined
      return ai.reply({ kind, part, state, hint, text, tz })
    })] : []),
    // 流式演绎（ADR-033）：SSE 下发 text / clause / audio / done / error，
    // 客户端按 clause 显示气泡、按 audio 播放并用同一段音频驱动口型。
    ...(speak ? [{
      kind: 'exact' as const,
      path: `${PET_API_PREFIX}/speak`,
      handler: (req: IncomingMessage, res: ServerResponse): void => {
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'method-not-allowed' })
          return
        }
        readJsonBody(req).then((body) => {
          const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
          const input = {
            kind: record.kind === 'state' ? 'state' as const : record.kind === 'chat' ? 'chat' as const : 'tap' as const,
            part: typeof record.part === 'string' ? record.part.slice(0, 40) : undefined,
            state: typeof record.state === 'string' ? record.state.slice(0, 20) : undefined,
            hint: typeof record.hint === 'string' ? record.hint.slice(0, 120) : undefined,
            text: typeof record.text === 'string' ? record.text.slice(0, 200) : undefined,
            tz: typeof record.tz === 'string' ? record.tz.slice(0, 64) : undefined,
          }
          res.writeHead(200, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-store',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
          })
          res.on('error', () => {})
          const controller = new AbortController()
          // 看门狗：无论管线卡在哪一步，90s 后一定收尾，绝不把连接一直挂着
          const watchdog = setTimeout(() => {
            emit('error', { error: 'speak-timeout' })
            close()
          }, 90_000)
          function close(): void {
            clearTimeout(watchdog)
            controller.abort()
            try { res.end() } catch { /* 已关闭 */ }
          }
          req.on('close', close)
          res.on('close', close)
          onStream?.(close)
          const emit = (event: string, data: unknown): void => {
            if (controller.signal.aborted) return
            try {
              res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            } catch { /* 连接已断 */ }
          }
          speak.stream(input, emit, controller.signal).catch((error: unknown) => {
            emit('error', { error: error instanceof Error ? error.message : String(error) })
          }).finally(() => {
            try { res.end() } catch { /* 已关闭 */ }
          })
        }, (error: unknown) => {
          json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        })
      },
    }] : []),
    // 单段合成（排查用）：POST {text} → audio/mpeg 字节
    ...(speak?.synthesize ? [postRoute(`${PET_API_PREFIX}/tts`, async (body) => {
      const text = typeof body.text === 'string' ? body.text.slice(0, 400) : ''
      const audio = await speak.synthesize!(text)
      return { ok: true, mime: audio.mime, data: audio.audio.toString('base64') }
    })] : []),
    // 浏览器侧诊断日志（spec §9）：客户端启动里程碑/错误上报，Host 落盘便于无控制台环境排查
    getPostRoute(
      `${PET_API_PREFIX}/client-log`,
      () => ({ ok: true, path: clientLogPath() }),
      (body) => {
        appendClientLog(
          typeof body.level === 'string' ? body.level : 'info',
          typeof body.message === 'string' ? body.message : '',
          typeof body.detail === 'string' ? body.detail : undefined,
        )
        return { ok: true }
      },
    ),
  ]

  // 素材静态路由：vendor 运行时脚本 + 内置模型（assets/models/<id>/……，含 moc3/png/json）
  const assetsRoot = join(packageRoot, 'assets')
  const assetRoute: WebRoute = {
    kind: 'prefix',
    path: PET_ASSET_PREFIX,
    handler: (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return Promise.resolve()
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const relativePath = url.pathname
        .slice(PET_ASSET_PREFIX.length)
        .split('/')
        .filter(Boolean)
        .map((segment) => decodeURIComponent(segment))
        .join('/')
      if (!relativePath || relativePath.includes('\0')) {
        res.writeHead(404)
        res.end()
        return Promise.resolve()
      }
      const file = join(assetsRoot, relativePath)
      // 目录穿越防护：解析后的路径必须仍在 assets 根内
      if (!file.startsWith(`${assetsRoot}${sep}`)) {
        res.writeHead(404)
        res.end()
        return Promise.resolve()
      }
      return serveFile(req, res, file)
    },
  }

  return [...apiRoutes, assetRoute]
}
