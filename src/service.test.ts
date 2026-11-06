import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { PetService } from './service.ts'
import type { PetSettings } from './settings-store.ts'
import { defaultEventTriggers } from './defaults.ts'
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
  eventTriggers: defaultEventTriggers(),
  eventTexts: {},
  motionTexts: {},
  expressionTexts: {},
  ttsEnabled: true,
  ttsEngine: 'openrouter',
  ttsModel: 'qwen/qwen-audio-3.0-tts-plus',
  ttsVoice: 'longanlingxin',
  lipsyncEnabled: true,
  lipsyncGain: 100,
  focusRange: 60,
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
    // ADR-037：不再有 events 绑定 / 固定台词 —— 台词、动作、表情全部由 AI 决定
    expect((view.config as Record<string, unknown>).events).toBeUndefined()
    expect(view.config.triggerMode).toBe('interrupt')
    expect(view.config.aiMemoryCount).toBe(20)
    expect(view.config.eventTriggers).toEqual(defaultEventTriggers())
  })

  it('内置「简」默认触摸部位：十个部位且都带台词，box 为 0–1 归一化', () => {
    const { service } = makeHarness()
    const parts = service.snapshot().config.touchParts
    expect(parts.map((p) => p.name)).toEqual(['脸', '头发', '胸', '私处', '臀', '腰', '大腿', '手', '小腿', '脚'])
    for (const part of parts) {
      expect(part.boxes.length).toBeGreaterThan(0)
      for (const box of part.boxes) {
        expect(box.left).toBeGreaterThanOrEqual(0)
        expect(box.right).toBeLessThanOrEqual(1)
        expect(box.left).toBeLessThan(box.right)
        expect(box.top).toBeLessThan(box.bottom)
      }
    }
    // ADR-037：部位只剩 id/name/boxes（台词与动作由 AI 决定）
    for (const part of parts) {
      expect(Object.keys(part).sort()).toEqual(['boxes', 'id', 'interactions', 'name'])
    }
  })

  it('用户保存触摸部位后覆盖内置默认（旧 motions/lines 被剥掉）', () => {
    const { service } = makeHarness()
    const saved = [{
      id: 'custom-hand',
      name: '手',
      boxes: [{ left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 }],
    }]
    service.saveTouchParts('jian', saved)
    expect(service.snapshot().config.touchParts).toEqual(saved)
    expect(service.snapshot().version).toBe(1)
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
    expect(service.resetDisplay()).toEqual({ right: 24, bottom: 20, size: 300 })
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

describe('PetService 活动提示（ADR-036）', () => {
  it('工具调用按名字归类，同类 3s 内只播一次（不同类互不压制）', () => {
    const { service, emit } = makeHarness()
    expect(service.snapshot().activity).toBeNull()
    emit('tools/pre-execute', { name: 'read' })
    const first = service.snapshot().activity
    expect(first?.kind).toBe('tool-read')
    const seq = first!.seq
    // 同类再来一次：被节流
    emit('tools/pre-execute', { name: 'read' })
    expect(service.snapshot().activity?.seq).toBe(seq)
    // 不同类：立即播（否则派代理会吞掉紧随其后的 subagent/start）
    emit('tools/pre-execute', { name: 'bash' })
    expect(service.snapshot().activity).toMatchObject({ kind: 'tool-run', seq: seq + 1 })
    vi.advanceTimersByTime(3200)
    emit('tools/pre-execute', { name: 'bash' })
    expect(service.snapshot().activity?.seq).toBe(seq + 2)
  })

  it('写文件 / 派子代理 / 其它工具各自归类', () => {
    const { service, emit } = makeHarness()
    emit('tools/pre-execute', { name: 'edit' })
    expect(service.snapshot().activity?.kind).toBe('tool-write')
    vi.advanceTimersByTime(3200)
    emit('tools/pre-execute', { name: 'subagent' })
    expect(service.snapshot().activity?.kind).toBe('tool-agent')
    vi.advanceTimersByTime(3200)
    emit('tools/pre-execute', { name: 'image_generate' })
    expect(service.snapshot().activity?.kind).toBe('tool-other')
  })

  it('内部工具（压缩/记忆/待办/提问）不触发活动', () => {
    const { service, emit } = makeHarness()
    for (const name of ['compress', 'acp_status', 'todo_write', 'mnemon_recall', 'skill', 'ask_user_question']) {
      emit('tools/pre-execute', { name })
    }
    expect(service.snapshot().activity).toBeNull()
  })

  it('派子代理的 tool-agent 不吞掉 subagent/start', () => {
    const { service, emit, emitArgs } = makeHarness()
    emit('tools/pre-execute', { name: 'subagent' })
    expect(service.snapshot().activity?.kind).toBe('tool-agent')
    emitArgs('subagent/start', { id: 'r2' })
    expect(service.snapshot().activity?.kind).toBe('subagent-start')
  })

  it('审批结果：批准 → approval-granted，拒绝 → approval-denied', async () => {
    const { service, emitArgs } = makeHarness()
    emitArgs('approval/request', {}, () => Promise.resolve('rejected'))
    await Promise.resolve()
    await Promise.resolve()
    expect(service.snapshot().activity?.kind).toBe('approval-denied')
    vi.advanceTimersByTime(3200)
    emitArgs('approval/request', {}, () => Promise.resolve('allowed-once'))
    await Promise.resolve()
    await Promise.resolve()
    expect(service.snapshot().activity?.kind).toBe('approval-granted')
    // 审批链必须被放行（waterfall 不吞后续回答者）
  })

  it('顶层会话开关才打招呼/道别，子代理会话忽略', () => {
    const { service, emitArgs } = makeHarness()
    emitArgs('session/created', { header: { parentSession: 'parent-1' } })
    expect(service.snapshot().activity).toBeNull()
    emitArgs('session/created', { header: {} })
    expect(service.snapshot().activity?.kind).toBe('session-open')
    vi.advanceTimersByTime(3200)
    emitArgs('session/disposed', { header: {} })
    expect(service.snapshot().activity?.kind).toBe('session-close')
  })

  it('子代理进出', () => {
    const { service, emitArgs } = makeHarness()
    emitArgs('subagent/start', { runId: 'r1' })
    expect(service.snapshot().activity?.kind).toBe('subagent-start')
    vi.advanceTimersByTime(3200)
    emitArgs('subagent/end', { runId: 'r1' })
    expect(service.snapshot().activity?.kind).toBe('subagent-end')
  })
})

describe('PetService 子代理隔离（ADR-036 修订）', () => {
  it('子代理的 running 与 turn-stopping 不驱动宠物状态', () => {
    const { service, emit, emitArgs } = makeHarness()
    emitArgs('subagent/start', { id: 'child-1' })
    emit('agent/status', { agent: { id: 'child-1' }, status: 'running' })
    expect(service.snapshot().state).toBe('idle')
    emitArgs('agent/turn-stopping', { agent: { id: 'child-1' }, turn: 1 })
    expect(service.snapshot().state).toBe('idle')
    // 主代理照旧
    emit('agent/status', { agent: { id: 'main-1' }, status: 'running' })
    expect(service.snapshot().state).toBe('thinking')
  })
})
