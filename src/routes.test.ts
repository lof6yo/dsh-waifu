import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { makePetRoutes, PET_API_PREFIX, PET_ASSET_PREFIX } from './routes.ts'
import { PetService } from './service.ts'
import { TouchPartsStore } from './touch-parts.ts'
import type { PetSettings } from './settings-store.ts'

/** 伪 IncomingMessage：EventEmitter + method/headers/url；body 在微任务中按 chunk 吐出。 */
type FakeReq = EventEmitter & { method: string; headers: Record<string, string>; url: string }
function fakeReq(method: string, body?: string, url = '/'): IncomingMessage {
  const req = new EventEmitter() as FakeReq
  req.method = method
  req.headers = { 'content-type': 'application/json' }
  req.url = url
  ;(req as unknown as { destroy(): void }).destroy = () => { /* no-op */ }
  if (body === undefined) {
    queueMicrotask(() => req.emit('end'))
  } else {
    queueMicrotask(() => { req.emit('data', Buffer.from(body)); req.emit('end') })
  }
  return req as unknown as IncomingMessage
}

/** 伪 ServerResponse：记录状态码/头/响应体（含流式 write，供 SSE 用例）。 */
function fakeRes() {
  const state = { status: 0, headers: {} as Record<string, string>, body: Buffer.alloc(0) }
  const append = (chunk?: unknown) => {
    if (chunk instanceof Buffer) state.body = Buffer.concat([state.body, chunk])
    else if (chunk !== undefined) state.body = Buffer.concat([state.body, Buffer.from(String(chunk))])
  }
  return {
    state,
    writeHead: (status: number, headers: Record<string, string> = {}) => { state.status = status; state.headers = headers },
    write: append,
    end: append,
    // SSE 处理器会监听 res 的 error/close；测试里连接关闭走 req.emit('close') 触发
    on: () => {},
  }
}

const BASE_SETTINGS: PetSettings = {
  enabled: true,
  size: 200,
  maxFps: 30,
  model: 'jian',
  developerMode: false,
  debug: false,
  showTapZones: false,
  canvasPadX: 125,
  canvasPadY: 50,
  homeRight: 24,
  homeBottom: 20,
  bubbleOffsetX: 0,
  bubbleOffsetY: -10,
  bubbleBgColor: '#ffffff',
  bubbleBgOpacity: 92,
  bubbleTextColor: '#222222',
  aiEnabled: false,
  aiProvider: 'deepseek-official',
  aiModel: 'deepseek-flash',
}

function makeRoutes(ai?: { reply: (input: { kind: 'tap' | 'state'; part?: string; state?: string; hint?: string }) => Promise<{ ok: boolean; text?: string; error?: string }> }) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-waifu-route-'))
  mkdirSync(join(dir, 'assets', 'vendor'), { recursive: true })
  mkdirSync(join(dir, 'assets', 'models', 'jian'), { recursive: true })
  writeFileSync(join(dir, 'assets', 'vendor', 'pixi.min.js'), 'fake-pixi-js')
  writeFileSync(join(dir, 'assets', 'models', 'jian', '简.model3.json'), '{"Version":3}')
  process.env.DSH_HOME = join(dir, 'home')

  const handlers = new Map<string, Array<(payload?: unknown, next?: () => void) => unknown>>()
  const ctx = {
    on: (event: string, fn: (payload?: unknown, next?: () => void) => unknown) => {
      const list = handlers.get(event) ?? []
      list.push(fn)
      handlers.set(event, list)
    },
    effect: (fn: () => () => void) => { fn() },
  } as unknown as Context
  const touchPartsStore = new TouchPartsStore()
  const service = new PetService(ctx, () => BASE_SETTINGS, touchPartsStore)
  const emit = (event: string, payload?: unknown) => {
    const next = vi.fn()
    for (const fn of handlers.get(event) ?? []) fn(payload, next)
    return next
  }
  const view = () => ({ value: BASE_SETTINGS, writable: true, error: null, path: join(dir, 'home', 'waifu', 'settings.jsonc') })
  const settings = {
    view,
    write: vi.fn(async () => {}),
  }
  const openStreams: Array<() => void> = []
  const routes = makePetRoutes({ service, packageRoot: dir, settings, ai, onStream: (close) => { openStreams.push(close) } })
  const route = (path: string) => routes.find((r) => r.path === path)
  const cleanup = () => { delete process.env.DSH_HOME; rmSync(dir, { recursive: true, force: true }) }
  return { route, routes, settings, service, emit, openStreams, dir, cleanup }
}

/** GET 路由的 handler 不返回 Promise，等一个事件循环轮次让异步完成。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('makePetRoutes API 路由', () => {
  it('GET /state 返回 200 + 快照 JSON（含 touchParts/events，不含旧 spatialTap 字段）', async () => {
    const { route, cleanup } = makeRoutes()
    const res = fakeRes()
    route(`${PET_API_PREFIX}/state`)!.handler(fakeReq('GET'), res as never)
    await flush()
    expect(res.state.status).toBe(200)
    const body = JSON.parse(res.state.body.toString('utf8'))
    expect(body.state).toBe('idle')
    expect(body.config.size).toBe(200)
    expect(body.config.spatialTap).toBeUndefined()
    expect(body.config.touchParts.map((p: { name: string }) => p.name)).toEqual(['脸', '头发', '胸', '臀', '腰', '大腿', '手', '小腿', '脚'])
    cleanup()
  })


  it('POST /interact 把部位/状态转给 AI 并返回台词', async () => {
    const reply = vi.fn(async () => ({ ok: true, text: '别戳啦…' }))
    const { route, cleanup } = makeRoutes({ reply })
    const res = fakeRes()
    await route(`${PET_API_PREFIX}/interact`)!.handler(
      fakeReq('POST', JSON.stringify({ kind: 'tap', part: '胸', hint: '呀！那里不能戳啦…' })),
      res as never,
    )
    await flush()
    expect(res.state.status).toBe(200)
    expect(JSON.parse(res.state.body.toString('utf8'))).toEqual({ ok: true, text: '别戳啦…' })
    expect(reply).toHaveBeenCalledWith({ kind: 'tap', part: '胸', state: undefined, hint: '呀！那里不能戳啦…' })
    cleanup()
  })

  it('未接线 AI 时不注册 /interact', () => {
    const { route, cleanup } = makeRoutes()
    expect(route(`${PET_API_PREFIX}/interact`)).toBeUndefined()
    cleanup()
  })

  it('错误方法返回 405', () => {
    const { route, cleanup } = makeRoutes()
    const res = fakeRes()
    route(`${PET_API_PREFIX}/state`)!.handler(fakeReq('POST'), res as never)
    expect(res.state.status).toBe(405)
    cleanup()
  })

  it('GET /touch-parts 返回当前模型部位（内置默认）', async () => {
    const { route, cleanup } = makeRoutes()
    const res = fakeRes()
    route(`${PET_API_PREFIX}/touch-parts`)!.handler(fakeReq('GET'), res as never)
    await flush()
    const body = JSON.parse(res.state.body.toString('utf8'))
    expect(body.model).toBe('jian')
    expect(body.saved).toBe(false)
    expect(body.parts.length).toBe(9)
    // 事件绑定（当前模型生效值，供设置页初始化）
    expect(body.events.idle.motions).toEqual(['Idle'])
    expect(body.events.thinking.lines.length).toBe(3)
    cleanup()
  })

  it('POST /touch-parts 保存部位并被 GET 读回', async () => {
    const { route, cleanup } = makeRoutes()
    const parts = [{ id: 'p1', name: '手', boxes: [{ left: 0.1, top: 0.1, right: 0.4, bottom: 0.5 }], motions: ['TapHead'] }]
    const post = fakeRes()
    await route(`${PET_API_PREFIX}/touch-parts`)!.handler(
      fakeReq('POST', JSON.stringify({ model: 'jian', parts })), post as never,
    )
    expect(JSON.parse(post.state.body.toString('utf8')).ok).toBe(true)

    const get = fakeRes()
    route(`${PET_API_PREFIX}/touch-parts`)!.handler(fakeReq('GET'), get as never)
    await flush()
    const body = JSON.parse(get.state.body.toString('utf8'))
    expect(body.saved).toBe(true)
    expect(body.parts).toEqual(parts)
    cleanup()
  })

  it('POST /touch-parts 可同时保存事件绑定覆盖（动画 + 台词）', async () => {
    const { route, cleanup } = makeRoutes()
    const post = fakeRes()
    await route(`${PET_API_PREFIX}/touch-parts`)!.handler(
      fakeReq('POST', JSON.stringify({
        model: 'jian',
        parts: [{ id: 'face', name: '脸', boxes: [{ left: 0.3, top: 0.4, right: 0.7, bottom: 0.7 }], motions: ['TapFace'] }],
        events: { thinking: { motions: ['TapFace'], lines: [['想不出来…']] } },
      })),
      post as never,
    )
    expect(JSON.parse(post.state.body.toString('utf8')).ok).toBe(true)
    const get = fakeRes()
    route(`${PET_API_PREFIX}/touch-parts`)!.handler(fakeReq('GET'), get as never)
    await flush()
    const body = JSON.parse(get.state.body.toString('utf8'))
    expect(body.parts[0].name).toBe('脸')
    expect(body.events.thinking.motions).toEqual(['TapFace'])
    expect(body.events.thinking.lines).toEqual([['想不出来…']])
    cleanup()
  })

  it('POST /touch-parts 缺 model 返回 400', async () => {
    const { route, cleanup } = makeRoutes()
    const res = fakeRes()
    await route(`${PET_API_PREFIX}/touch-parts`)!.handler(fakeReq('POST', JSON.stringify({ parts: [] })), res as never)
    expect(res.state.status).toBe(400)
    cleanup()
  })

  it('POST /set-display 越界数值在服务端被 clamp', async () => {
    const { route, cleanup } = makeRoutes()
    const res = fakeRes()
    await route(`${PET_API_PREFIX}/set-display`)!.handler(
      fakeReq('POST', JSON.stringify({ size: 1e9, right: -1 })), res as never,
    )
    expect(res.state.status).toBe(200)
    const body = JSON.parse(res.state.body.toString('utf8'))
    expect(body.display.size).toBe(400)
    expect(body.display.right).toBe(-1)
    cleanup()
  })

  it('POST /set-display 非法 JSON 返回 400', async () => {
    const { route, cleanup } = makeRoutes()
    const res = fakeRes()
    await route(`${PET_API_PREFIX}/set-display`)!.handler(fakeReq('POST', '{oops'), res as never)
    expect(res.state.status).toBe(400)
    cleanup()
  })

  it('POST /settings 透传 ops 并返回视图', async () => {
    const { route, settings, cleanup } = makeRoutes()
    const res = fakeRes()
    await route(`${PET_API_PREFIX}/settings`)!.handler(
      fakeReq('POST', JSON.stringify({ ops: [{ op: 'set', path: ['size'], value: 200 }] })), res as never,
    )
    expect(settings.write).toHaveBeenCalledWith([{ op: 'set', path: ['size'], value: 200 }])
    expect(res.state.status).toBe(200)
    cleanup()
  })

  it('请求体超过 64KB 返回 400 body-too-large', async () => {
    const { route, cleanup } = makeRoutes()
    const res = fakeRes()
    const big = JSON.stringify({ ops: [{ op: 'set', path: ['x'], value: 'a'.repeat(70 * 1024) }] })
    await route(`${PET_API_PREFIX}/settings`)!.handler(fakeReq('POST', big), res as never)
    expect(res.state.status).toBe(400)
    const body = JSON.parse(res.state.body.toString('utf8'))
    expect(body.error).toBe('body-too-large')
    cleanup()
  })
})

describe('makePetRoutes SSE 状态推送', () => {
  it('GET /events 首帧回发快照,状态变化后推送新帧', () => {
    const { route, emit, cleanup } = makeRoutes()
    const res = fakeRes()
    const req = fakeReq('GET')
    route(`${PET_API_PREFIX}/events`)!.handler(req, res as never)
    expect(res.state.status).toBe(200)
    expect(res.state.headers['content-type']).toContain('text/event-stream')
    const first = res.state.body.toString('utf8')
    expect(first).toContain('retry: 3000')
    expect(first).toContain('"state":"idle"')
    emit('agent/status', { status: 'running' })
    expect(res.state.body.toString('utf8')).toContain('"state":"thinking"')
    req.emit('close')
    cleanup()
  })

  it('心跳注释帧周期性写入;断连后停止', () => {
    vi.useFakeTimers()
    const { route, cleanup } = makeRoutes()
    const res = fakeRes()
    const req = fakeReq('GET')
    route(`${PET_API_PREFIX}/events`)!.handler(req, res as never)
    vi.advanceTimersByTime(30_000)
    expect(res.state.body.toString('utf8')).toContain(': ping')
    req.emit('close')
    const afterClose = res.state.body.toString('utf8')
    vi.advanceTimersByTime(60_000)
    expect(res.state.body.toString('utf8')).toBe(afterClose)
    vi.useRealTimers()
    cleanup()
  })

  it('onStream 钩子注册活跃流的关闭函数', () => {
    const { route, openStreams, cleanup } = makeRoutes()
    const res = fakeRes()
    const req = fakeReq('GET')
    route(`${PET_API_PREFIX}/events`)!.handler(req, res as never)
    expect(openStreams.length).toBe(1)
    expect(typeof openStreams[0]).toBe('function')
    req.emit('close')
    // 关闭后再次调用是幂等 no-op（closed 守卫）
    openStreams[0]()
    cleanup()
  })

  it('非 GET 返回 405', () => {
    const { route, cleanup } = makeRoutes()
    const res = fakeRes()
    route(`${PET_API_PREFIX}/events`)!.handler(fakeReq('POST'), res as never)
    expect(res.state.status).toBe(405)
    cleanup()
  })
})

describe('makePetRoutes 素材路由（prefix：vendor + 内置模型）', () => {
  const assetRoute = (routes: ReturnType<typeof makeRoutes>['routes']) =>
    routes.find((r) => r.path === PET_ASSET_PREFIX && r.kind === 'prefix')!

  it('命中返回 200 + mime + 内容，HEAD 无 body', async () => {
    const { routes, cleanup } = makeRoutes()
    const get = fakeRes()
    await assetRoute(routes).handler(fakeReq('GET', undefined, '/waifu-assets/vendor/pixi.min.js'), get as never)
    expect(get.state.status).toBe(200)
    expect(get.state.headers['content-type']).toBe('text/javascript')
    expect(get.state.body.toString('utf8')).toBe('fake-pixi-js')

    const head = fakeRes()
    await assetRoute(routes).handler(fakeReq('HEAD', undefined, '/waifu-assets/vendor/pixi.min.js'), head as never)
    expect(head.state.status).toBe(200)
    expect(head.state.body.byteLength).toBe(0)
    cleanup()
  })

  it('内置模型文件（含中文文件名）可访问', async () => {
    const { routes, cleanup } = makeRoutes()
    const res = fakeRes()
    await assetRoute(routes).handler(
      fakeReq('GET', undefined, `/waifu-assets/models/jian/${encodeURIComponent('简.model3.json')}`),
      res as never,
    )
    expect(res.state.status).toBe(200)
    expect(res.state.headers['content-type']).toBe('application/json')
    cleanup()
  })

  it('目录穿越被拒绝（404）', async () => {
    const { routes, cleanup } = makeRoutes()
    const res = fakeRes()
    await assetRoute(routes).handler(fakeReq('GET', undefined, '/waifu-assets/../package.json'), res as never)
    expect(res.state.status).toBe(404)
    cleanup()
  })

  it('文件缺失返回 404；非 GET/HEAD 返回 405', async () => {
    const { routes, cleanup } = makeRoutes()
    const missing = fakeRes()
    await assetRoute(routes).handler(fakeReq('GET', undefined, '/waifu-assets/vendor/nope.js'), missing as never)
    expect(missing.state.status).toBe(404)

    const post = fakeRes()
    await assetRoute(routes).handler(fakeReq('POST', undefined, '/waifu-assets/vendor/pixi.min.js'), post as never)
    expect(post.state.status).toBe(405)
    cleanup()
  })
})
