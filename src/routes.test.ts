import { afterAll, describe, expect, it, vi } from 'vitest'
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
import { defaultEventTriggers } from './defaults.ts'

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
  bubbleMaxSeconds: 30,
  aiEnabled: false,
  idleMotionEnabled: true,
  barPosition: 'bottom',
  barOffset: 0,
  aiProvider: 'deepseek-official',
  aiModel: 'deepseek-flash',
  aiHistoryCount: 10,
  aiMemoryCount: 20,
  triggerMode: 'interrupt',
  aiMinIntervalSec: 3,
  idleTimeoutSec: 300,
  activityWindowSec: 3,
  tapGapMs: 1200,
  mergeMax: 6,
  eventTriggers: defaultEventTriggers(),
  eventTexts: {},
  motionTexts: {},
  expressionTexts: {},
  motionEnabled: {},
  expressionEnabled: {},
  ttsEnabled: true,
  ttsModel: 'qwen/qwen-audio-3.0-tts-plus',
  ttsVoice: 'longanlingxin',
  lipsyncEnabled: true,
  lipsyncGain: 100,
  focusRange: 60,
}

function makeRoutes(
  ai?: { reply: (input: { kind: 'tap' | 'event' | 'chat' | 'idle'; part?: string; tapKind?: 'light' | 'poke' | 'stroke'; durationMs?: number; event?: string; text?: string; tz?: string; merged?: string[] }) => Promise<{ ok: boolean; text?: string; expressions?: string[]; motions?: string[]; memory?: string; error?: string }> },
  aiSettings?: {
    options: () => Promise<{ providers: { id: string; name: string }[]; models: Record<string, { id: string; name: string }[]> }>
    readPersona: () => { text: string; path: string }
    writePersona: (text: string) => { text: string; path: string }
    check?: (input?: { provider?: string; model?: string }) => Promise<{ ok: boolean; text?: string; error?: string }>
  },
) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-waifu-route-'))
  tempDirs.push(dir)
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
  const releases: Array<() => void> = []
  const routes = makePetRoutes({
    service,
    packageRoot: dir,
    settings,
    ai,
    aiSettings,
    // 返回注销函数：路由在流结束时调用它，把闭包从集合里摘掉（不再只增不减）
    onStream: (close) => { openStreams.push(close); return () => { releases.push(close) } },
  })
  const route = (path: string) => routes.find((r) => r.path === path)
  const cleanup = () => { delete process.env.DSH_HOME; rmSync(dir, { recursive: true, force: true }) }
  return { route, routes, settings, service, emit, openStreams, releases, dir, cleanup }
}

/** GET 路由的 handler 不返回 Promise，等一个事件循环轮次让异步完成。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

/** 本文件建过的临时目录：个别用例只建路由不调用 cleanup，统一在结束时兜底删除。 */
const tempDirs: string[] = []
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

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
    expect(body.config.touchParts.map((p: { name: string }) => p.name)).toEqual(['脸', '头发', '胸', '私处', '臀', '腰', '大腿', '手', '小腿', '脚'])
    cleanup()
  })


  it('POST /interact 把触发场景转给 AI 并返回台词/标签（ADR-037）', async () => {
    const reply = vi.fn(async () => ({ ok: true, text: '别戳啦…', expressions: ['blush'], motions: ['Tilt'], memory: '主人爱戳' }))
    const { route, cleanup } = makeRoutes({ reply })
    const res = fakeRes()
    await route(`${PET_API_PREFIX}/interact`)!.handler(
      fakeReq('POST', JSON.stringify({ kind: 'tap', part: '胸', tapKind: 'poke', durationMs: 420 })),
      res as never,
    )
    await flush()
    expect(res.state.status).toBe(200)
    expect(JSON.parse(res.state.body.toString('utf8'))).toEqual({
      ok: true, text: '别戳啦…', expressions: ['blush'], motions: ['Tilt'], memory: '主人爱戳',
    })
    expect(reply).toHaveBeenCalledWith({ kind: 'tap', part: '胸', interaction: undefined })
    cleanup()
  })

  it('未接线 AI 时不注册 /interact、/ai-options 与 /persona', () => {
    const { route, cleanup } = makeRoutes()
    expect(route(`${PET_API_PREFIX}/interact`)).toBeUndefined()
    expect(route(`${PET_API_PREFIX}/ai-options`)).toBeUndefined()
    expect(route(`${PET_API_PREFIX}/persona`)).toBeUndefined()
    cleanup()
  })

  it('GET /ai-options 返回 provider 与模型目录', async () => {
    const aiSettings = {
      options: async () => ({
        providers: [{ id: 'deepseek-official', name: 'DeepSeek' }],
        models: { 'deepseek-official': [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }] },
      }),
      readPersona: () => ({ text: '', path: '' }),
      writePersona: (text: string) => ({ text, path: '' }),
    }
    const { route, cleanup } = makeRoutes(undefined, aiSettings)
    const res = fakeRes()
    route(`${PET_API_PREFIX}/ai-options`)!.handler(fakeReq('GET'), res as never)
    await flush()
    expect(res.state.status).toBe(200)
    const body = JSON.parse(res.state.body.toString('utf8'))
    expect(body.providers).toEqual([{ id: 'deepseek-official', name: 'DeepSeek' }])
    expect(body.models['deepseek-official']).toEqual([{ id: 'deepseek-flash', name: 'DeepSeek Flash' }])
    cleanup()
  })

  it('GET /persona 读人设、POST /persona 写人设', async () => {
    const writePersona = vi.fn((text: string) => ({ text, path: '/home/waifu/persona.md' }))
    const aiSettings = {
      options: async () => ({ providers: [], models: {} }),
      readPersona: () => ({ text: '你是「简」', path: '/home/waifu/persona.md' }),
      writePersona,
    }
    const { route, cleanup } = makeRoutes(undefined, aiSettings)

    const readRes = fakeRes()
    route(`${PET_API_PREFIX}/persona`)!.handler(fakeReq('GET'), readRes as never)
    await flush()
    expect(readRes.state.status).toBe(200)
    expect(JSON.parse(readRes.state.body.toString('utf8')).text).toBe('你是「简」')

    const writeRes = fakeRes()
    await route(`${PET_API_PREFIX}/persona`)!.handler(fakeReq('POST', JSON.stringify({ text: '新的人设' })), writeRes as never)
    expect(writePersona).toHaveBeenCalledWith('新的人设')
    expect(writeRes.state.status).toBe(200)
    expect(JSON.parse(writeRes.state.body.toString('utf8')).path).toBe('/home/waifu/persona.md')
    cleanup()
  })

  it('exact 路由 path 不重复（dsh webserver 按 path 唯一注册，重复会激活失败）', () => {
    const { routes, cleanup } = makeRoutes()
    const paths = routes.filter((r) => r.kind === 'exact').map((r) => r.path)
    const duplicates = paths.filter((path, index) => paths.indexOf(path) !== index)
    expect(duplicates).toEqual([])
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
    expect(body.parts.length).toBe(10)
    // ADR-037：不再返回 events 绑定
    expect(body.events).toBeUndefined()
    for (const part of body.parts) {
      expect(Object.keys(part).sort()).toEqual(['boxes', 'id', 'interactions', 'name'])
    }
    cleanup()
  })

  it('POST /touch-parts 保存部位并被 GET 读回（旧 motions 被剥掉）', async () => {
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
    expect(body.parts).toEqual([{ id: 'p1', name: '手', boxes: [{ left: 0.1, top: 0.1, right: 0.4, bottom: 0.5 }] }])
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

  it('onStream 钩子注册活跃流的关闭函数，流结束时调用注销函数', () => {
    const { route, openStreams, releases, cleanup } = makeRoutes()
    const res = fakeRes()
    const req = fakeReq('GET')
    route(`${PET_API_PREFIX}/events`)!.handler(req, res as never)
    expect(openStreams.length).toBe(1)
    expect(typeof openStreams[0]).toBe('function')
    req.emit('close')
    // 关闭事件顺带触发注销，避免调用方的集合只增不减
    expect(releases.length).toBe(1)
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

  it('静态素材带 ETag/Last-Modified，条件请求命中返回 304 且不带 body', async () => {
    const { routes, cleanup } = makeRoutes()
    const first = fakeRes()
    const url = '/waifu-assets/vendor/pixi.min.js'
    await assetRoute(routes).handler(fakeReq('GET', undefined, url), first as never)
    expect(first.state.status).toBe(200)
    const etag = first.state.headers.etag
    expect(typeof etag).toBe('string')
    expect(first.state.headers['last-modified']).toBeTruthy()

    const cached = fakeReq('GET', undefined, url)
    cached.headers['if-none-match'] = etag
    const second = fakeRes()
    await assetRoute(routes).handler(cached, second as never)
    expect(second.state.status).toBe(304)
    expect(second.state.body.byteLength).toBe(0)
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
