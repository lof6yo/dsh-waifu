/**
 * 宠物 HTTP 路由：浏览器半区通过同源 JSON 端点（/api/live2d-pet/*）、
 * SSE 状态推送端点（/api/live2d-pet/events，ADR-006）与素材静态路由
 * （/pet-assets/*，含内置模型 assets/models/），以及本地模型虚拟路由通信。
 * @module dsh-live2d-pets/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { PetService } from './service.ts'
import { listBuiltinPresets } from './models-host.ts'
import type { CustomModelEntry, EventBindings, TouchPart } from './models.ts'
import { isLocalModelPath } from './models.ts'
import { resolveLocalModelFile } from './local-models.ts'
import { appendClientLog, clientLogPath } from './client-log.ts'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'

/** 设置读写 API（Host 直连插件设置文件；见 settings-store.ts / ADR-013）。 */
export interface SettingsRoutesApi {
  view(): { value: unknown; writable?: boolean; error?: string | null; path?: string }
  write(ops: readonly SettingsPathOp[]): Promise<unknown> | unknown
}

/** 浏览器侧宠物 API 基路径。 */
export const PET_API_PREFIX = '/api/live2d-pet'

/** 浏览器侧素材静态路由基路径（vendor 运行时脚本 + 内置模型 assets）。 */
export const PET_ASSET_PREFIX = '/pet-assets'

/** 本地模型静态路由基路径（Host 按自定义模型 id 映射到用户本地路径）。 */
export const PET_LOCAL_MODELS_PREFIX = '/pet-local-models'

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

/** 构建完整路由族（API + SSE + 素材 + 本地模型）供 ctx.webServer.register。 */
export function makePetRoutes(deps: {
  service: PetService
  packageRoot: string
  settings: SettingsRoutesApi
  /** SSE 活跃流注册钩子：插件卸载时由调用方逐一 close（ADR-006）。 */
  onStream?: (close: () => void) => void
}): WebRoute[] {
  const { service, packageRoot, settings, onStream } = deps
  const apiRoutes: WebRoute[] = [
    sseStateRoute(`${PET_API_PREFIX}/events`, service, onStream),
    getRoute(`${PET_API_PREFIX}/state`, async () => service.snapshot()),
    getRoute(`${PET_API_PREFIX}/models`, async () => ({
      builtin: listBuiltinPresets(),
      custom: service.listCustomModels(),
      presetsPath: join(packageRoot, 'src', 'presets', 'presets.jsonc'),
      customModelsPath: service.customModelsFile().path,
      touchPartsPath: service.touchPartsFile().path,
    })),
    getPostRoute(
      `${PET_API_PREFIX}/custom-models`,
      async () => service.customModelsFile(),
      (body) => {
        const models = Array.isArray(body.models) ? body.models as CustomModelEntry[] : []
        return Promise.resolve(service.saveCustomModels(models))
      },
    ),
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

  const localModelRoute: WebRoute = {
    kind: 'prefix',
    path: PET_LOCAL_MODELS_PREFIX,
    handler: (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return Promise.resolve()
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const parts = url.pathname.split('/').filter(Boolean)
      // /pet-local-models/<id>/<relative...>
      if (parts.length < 3) {
        res.writeHead(404)
        res.end()
        return Promise.resolve()
      }
      const id = decodeURIComponent(parts[1])
      const relativePath = parts.slice(2).map(decodeURIComponent).join('/')
      const entry = service.listCustomModels().find((c) => c.id === id)
      if (!entry || !isLocalModelPath(entry.modelUrl)) {
        res.writeHead(404)
        res.end()
        return Promise.resolve()
      }
      const file = resolveLocalModelFile(entry.modelUrl, relativePath)
      if (!file) {
        res.writeHead(404)
        res.end()
        return Promise.resolve()
      }
      return serveFile(req, res, file)
    },
  }

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

  return [...apiRoutes, assetRoute, localModelRoute]
}
