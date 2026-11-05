import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { PetService } from './service.ts'
import type { PetSettings } from './settings-store.ts'
import { TouchPartsStore } from './touch-parts.ts'

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
  aiTouchOnly: false,
  aiTakeover: false,
  interactionMode: 'touch-first',
  aiProvider: 'deepseek-official',
  aiModel: 'deepseek-flash',
  aiHistoryCount: 10,
  thinkingAiDelay: 3,
  thinkingAiInterval: 20,
  thinkingAiMax: 3,
  waitingAiDelay: 4,
  waitingAiInterval: 30,
  waitingAiMax: 3,
  ttsEnabled: true,
  ttsEngine: 'openrouter',
  ttsModel: 'fish-audio/drama-3',
  ttsVoice: '',
  ttsInstructions: 'test',
  lipsyncEnabled: true,
  lipsyncGain: 100,
}

function makeHarness(overrides: Partial<PetSettings> = {}) {
  const handlers = new Map<string, Array<(payload?: unknown, next?: () => void) => unknown>>()
  const effects: Array<() => void> = []
  const ctx = {
    on: (event: string, fn: (payload?: unknown, next?: () => void) => unknown) => {
      const list = handlers.get(event) ?? []
      list.push(fn)
      handlers.set(event, list)
    },
    effect: (fn: () => () => void) => { effects.push(fn()) },
  } as unknown as Context
  const emit = (event: string, payload?: unknown) => {
    const next = vi.fn()
    for (const fn of handlers.get(event) ?? []) fn(payload, next)
    return next
  }
  // 双参事件（如 session/event 的 (session, event) 载荷）
  const emitArgs = (event: string, ...args: unknown[]) => {
    for (const fn of handlers.get(event) ?? []) (fn as (...a: unknown[]) => unknown)(...args)
  }
  const settings = { ...BASE_SETTINGS, ...overrides }
  const touchPartsStore = new TouchPartsStore()
  const service = new PetService(ctx, () => settings, touchPartsStore)
  return { service, emit, emitArgs, touchPartsStore, dispose: () => { for (const fn of effects) fn() } }
}

beforeEach(() => {
  // 隔离持久化：避免读到真实 $DSH_HOME 下的 waifu.json
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-waifu-svc-'))
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(process.env.DSH_HOME!, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

describe('PetService 状态机', () => {
  it('初始为 idle，agent=idle，version 0', () => {
    const { service } = makeHarness()
    const view = service.snapshot()
    expect(view.state).toBe('idle')
    expect(view.agent).toBe('idle')
    expect(view.version).toBe(0)
    expect(view.config.maxFps).toBe(30)
    expect(view.config.model).toBe('jian')
    expect(view.config.events.idle.motions).toEqual(['Idle'])
    expect(view.config.events.thinking.motions).toEqual(['Tilt'])
    expect(view.config.events.done.motions).toEqual(['star'])
    // 默认台词池（无固定人设，中性口吻；长状态 3 阶段）
    expect(view.config.events.idle.lines.length).toBe(1)
    expect(view.config.events.thinking.lines.length).toBe(1)
    expect(view.config.events.error.lines[0].length).toBeGreaterThan(0)
  })

  it('内置「简」默认触摸部位：九个部位且都带台词，box 为 0–1 归一化', () => {
    const { service } = makeHarness()
    const parts = service.snapshot().config.touchParts
    expect(parts.map((p) => p.name)).toEqual(['脸', '头发', '胸', '臀', '腰', '大腿', '手', '小腿', '脚'])
    for (const part of parts) {
      expect(part.boxes.length).toBeGreaterThan(0)
      for (const box of part.boxes) {
        expect(box.left).toBeGreaterThanOrEqual(0)
        expect(box.right).toBeLessThanOrEqual(1)
        expect(box.left).toBeLessThan(box.right)
        expect(box.top).toBeLessThan(box.bottom)
      }
    }
    // 默认每个部位都挂了「动作组 + 表情」（用户本地调好的那套）
    expect(parts[0].motions).toEqual(['Tilt', 'blush'])
    expect(parts[1].motions).toEqual(['Nod', 'blush'])
  })

  it('用户保存触摸部位后覆盖内置默认', () => {
    const { service } = makeHarness()
    const saved = [{
      id: 'custom-hand',
      name: '手',
      boxes: [{ left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 }],
      motions: ['TapHead'],
    }]
    service.saveTouchParts('jian', saved)
    expect(service.snapshot().config.touchParts).toEqual(saved)
    expect(service.snapshot().version).toBe(1)
  })

  it('保存事件绑定覆盖层后 snapshot.config.events 立即生效（整事件替换）', () => {
    const { service } = makeHarness()
    expect(service.snapshot().config.events.thinking.motions).toEqual(['Tilt'])
    service.saveTouchParts('jian', [], {
      thinking: { motions: ['TapHead', 'blush'], lines: [['自己想的台词']] },
    })
    const events = service.snapshot().config.events
    expect(events.thinking.motions).toEqual(['TapHead', 'blush'])
    expect(events.thinking.lines).toEqual([['自己想的台词']])
    // 未覆盖的事件保持默认
    expect(events.idle.motions).toEqual(['Idle'])
    expect(service.effectiveEvents('jian').thinking.lines).toEqual([['自己想的台词']])
  })

  it('部位自定义台词原样保留', () => {
    const { service } = makeHarness()
    service.saveTouchParts('jian', [{
      id: 'face',
      name: '脸',
      boxes: [{ left: 0.3, top: 0.4, right: 0.7, bottom: 0.7 }],
      motions: ['TapFace'],
      lines: ['别捏脸啦', '脸要变形了'],
    }])
    expect(service.snapshot().config.touchParts[0].lines).toEqual(['别捏脸啦', '脸要变形了'])
  })

  it('未知模型的触摸部位为空表', () => {
    const { service } = makeHarness({ model: 'missing' })
    expect(service.snapshot().config.touchParts).toEqual([])
  })

  it('agent running → thinking，idle → idle', () => {
    const { service, emit } = makeHarness()
    emit('agent/status', { status: 'running' })
    expect(service.snapshot().state).toBe('thinking')
    emit('agent/status', { status: 'idle' })
    expect(service.snapshot().state).toBe('idle')
  })

  it('agent/error → error', () => {
    const { service, emit } = makeHarness()
    emit('agent/error', {})
    expect(service.snapshot().state).toBe('error')
  })

  it('approval/request → waiting，且必须放行审批链', () => {
    const { service, emit } = makeHarness()
    const next = emit('approval/request', {})
    expect(service.snapshot().state).toBe('waiting')
    expect(next).toHaveBeenCalled()
  })

  it('user-questions/request → waiting，且放行到 answerer', () => {
    const { service, emit } = makeHarness()
    const next = emit('user-questions/request', {})
    expect(service.snapshot().state).toBe('waiting')
    expect(next).toHaveBeenCalled()
  })

  it('turn-stopping → done；保持期内 idle 不打断，3.5s 后回 idle', () => {
    const { service, emit } = makeHarness()
    emit('agent/turn-stopping', {})
    expect(service.snapshot().state).toBe('done')
    emit('agent/status', { status: 'idle' })
    expect(service.snapshot().state).toBe('done')
    vi.advanceTimersByTime(3500)
    expect(service.snapshot().state).toBe('idle')
  })

  it('done 保持期内 running → thinking 并取消保持计时', () => {
    const { service, emit } = makeHarness()
    emit('agent/turn-stopping', {})
    emit('agent/status', { status: 'running' })
    expect(service.snapshot().state).toBe('thinking')
    vi.advanceTimersByTime(3500)
    expect(service.snapshot().state).toBe('thinking')
  })
  it('deliverables/presented → delivered；保持期内 idle/turn-stopping 不打断，3.5s 后回 idle', () => {
    const { service, emit, emitArgs } = makeHarness()
    emitArgs('session/event', {}, { type: 'deliverables/presented' })
    expect(service.snapshot().state).toBe('delivered')
    emit('agent/status', { status: 'idle' })
    emit('agent/turn-stopping', {})
    expect(service.snapshot().state).toBe('delivered')
    vi.advanceTimersByTime(3500)
    expect(service.snapshot().state).toBe('idle')
  })
  it('无关 session/event 不触发交付态', () => {
    const { service, emitArgs } = makeHarness()
    emitArgs('session/event', {}, { type: 'turn/message' })
    expect(service.snapshot().state).toBe('idle')
  })
  it('done 保持期内交付升级为 delivered；thinking 仍即时打断', () => {
    const { service, emit, emitArgs } = makeHarness()
    emit('agent/turn-stopping', {})
    expect(service.snapshot().state).toBe('done')
    emitArgs('session/event', {}, { type: 'deliverables/presented' })
    expect(service.snapshot().state).toBe('delivered')
    emit('agent/status', { status: 'running' })
    expect(service.snapshot().state).toBe('thinking')
    vi.advanceTimersByTime(3500)
    expect(service.snapshot().state).toBe('thinking')
  })

  it('状态变化递增 version', () => {
    const { service, emit } = makeHarness()
    const v0 = service.snapshot().version
    emit('agent/status', { status: 'running' })
    expect(service.snapshot().version).toBe(v0 + 1)
  })

  it('卸载时清理 done 保持计时器', () => {
    const { service, emit, dispose } = makeHarness()
    emit('agent/turn-stopping', {})
    dispose()
    vi.advanceTimersByTime(3500)
    // 计时器已清理，状态应保持在 done（不再被回收）
    expect(service.snapshot().state).toBe('done')
  })
})

describe('PetService 显示配置', () => {
  it('setDisplay 按权威边界 clamp 越界数值', () => {
    const { service } = makeHarness()
    const d = service.setDisplay({ size: 9999, right: -50, bottom: 1e6 })
    expect(d.size).toBe(400)
    expect(d.right).toBe(-50)
    expect(d.bottom).toBe(8000)
  })

  it('setDisplay 只更新给定字段并递增 version', () => {
    const { service } = makeHarness()
    const v0 = service.snapshot().version
    const d = service.setDisplay({ size: 240 })
    expect(d).toEqual({ right: 24, bottom: 20, size: 240 })
    expect(service.snapshot().version).toBe(v0 + 1)
  })

  it('resetDisplay 回到内置默认显示（归位由客户端按中心点计算）', () => {
    const { service } = makeHarness({ homeRight: 40, homeBottom: 30 })
    service.setDisplay({ size: 300, right: -120, bottom: 800 })
    expect(service.resetDisplay()).toEqual({ right: 24, bottom: 20, size: 240 })
  })

  it('snapshot 解析模型 URL：内置同源路径；失效 id 回退内置', () => {
    const { service } = makeHarness()
    expect(service.snapshot().config.modelUrl).toBe('/waifu-assets/models/jian/简.model3.json')
    // 旧配置的失效模型 id 回退默认内置模型，避免升级后空白
    expect(makeHarness({ model: 'hiyori' }).service.snapshot().config.modelUrl).toBe('/waifu-assets/models/jian/简.model3.json')
  })

})

describe('PetService 变更订阅', () => {
  it('onChange 在状态/显示变化与 notifyConfigChanged 时触发,退订后不再触发', () => {
    const { service, emit } = makeHarness()
    const listener = vi.fn()
    const unsubscribe = service.onChange(listener)
    emit('agent/status', { status: 'running' })
    expect(listener).toHaveBeenCalledTimes(1)
    service.setDisplay({ size: 240 })
    expect(listener).toHaveBeenCalledTimes(2)
    service.notifyConfigChanged()
    expect(listener).toHaveBeenCalledTimes(3)
    unsubscribe()
    emit('agent/error', {})
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('同一状态重复事件不触发通知', () => {
    const { service, emit } = makeHarness()
    const listener = vi.fn()
    service.onChange(listener)
    emit('agent/status', { status: 'running' })
    emit('agent/status', { status: 'running' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('done 保持期计时回收回 idle 也触发通知', () => {
    const { service, emit } = makeHarness()
    const listener = vi.fn()
    service.onChange(listener)
    emit('agent/turn-stopping', {})
    expect(listener).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3500)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
