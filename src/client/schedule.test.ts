import { describe, expect, it } from 'vitest'
import {
  dispatchTrigger,
  flushMerged,
  initialScheduleState,
  type ScheduleConfig,
  type ScheduleState,
} from './schedule.ts'

const baseConfig: ScheduleConfig = {
  aiEnabled: true,
  hidden: false,
  busy: false,
  tapGapMs: 1200,
  eventGapMs: 1000,
  sameKindWindowMs: 10000,
  mergeMax: 6,
  triggerMode: 'queue',
}

function config(patch: Partial<ScheduleConfig> = {}): ScheduleConfig {
  return { ...baseConfig, ...patch }
}

function state(patch: Partial<ScheduleState> = {}): ScheduleState {
  return { ...initialScheduleState(), ...patch }
}

describe('触发调度（ADR-047）', () => {
  it('AI 关掉或页面隐藏时一切丢弃，并说清原因', () => {
    const off = dispatchTrigger(state(), { kind: 'tap' }, config({ aiEnabled: false }), 0)
    expect(off.decision).toEqual({ action: 'drop', reason: 'ai disabled' })
    const hidden = dispatchTrigger(state(), { kind: 'event', event: 'done' }, config({ hidden: true }), 0)
    expect(hidden.decision).toEqual({ action: 'drop', reason: 'page hidden' })
  })

  it('触摸：连点窗口内延后，窗口过了就立刻发', () => {
    const first = dispatchTrigger(state(), { kind: 'tap' }, config(), 1000)
    expect(first.decision).toEqual({ action: 'run', merged: [] })
    expect(first.state.lastTapAt).toBe(1000)

    const second = dispatchTrigger(first.state, { kind: 'tap' }, config(), 1500)
    expect(second.decision).toEqual({ action: 'defer', delayMs: 700, reason: 'tap gap' })
    expect(second.state.lastTapAt).toBe(1000)

    const later = dispatchTrigger(first.state, { kind: 'tap' }, config(), 2300)
    expect(later.decision).toEqual({ action: 'run', merged: [] })
  })

  it('触摸恒抢占：上一轮还在演（queue 模式）也照样立刻触发', () => {
    const result = dispatchTrigger(state(), { kind: 'tap' }, config({ busy: true }), 5000)
    expect(result.decision).toEqual({ action: 'run', merged: [] })
  })

  it('事件在最小间隔内合并，并给出补发时刻', () => {
    const first = dispatchTrigger(state(), { kind: 'event', event: 'done' }, config(), 1000)
    expect(first.decision).toEqual({ action: 'run', merged: [] })

    const merged = dispatchTrigger(first.state, { kind: 'event', event: 'error' }, config(), 1300)
    expect(merged.decision).toEqual({
      action: 'merge',
      reason: 'event gap',
      nextAt: 2000,
      overflowed: 0,
    })
    expect(merged.state.merged).toEqual([{ event: 'error', count: 1 }])
  })

  it('queue 模式下上一轮没演完：合并起来等它结束（nextAt = 0）', () => {
    const result = dispatchTrigger(
      state({ lastEventAt: 0 }),
      { kind: 'event', event: 'tool-run' },
      config({ busy: true, eventGapMs: 0, sameKindWindowMs: 0 }),
      5000,
    )
    expect(result.decision).toEqual({ action: 'merge', reason: 'busy', nextAt: 0, overflowed: 0 })
  })

  it('interrupt 模式不排队：上一轮没演完也直接抢占', () => {
    const result = dispatchTrigger(
      state({ lastEventAt: 0 }),
      { kind: 'event', event: 'tool-run' },
      config({ busy: true, triggerMode: 'interrupt', eventGapMs: 0, sameKindWindowMs: 0 }),
      5000,
    )
    expect(result.decision).toEqual({ action: 'run', merged: [] })
  })

  it('同类事件在窗口内合并成一条并累计次数', () => {
    const first = dispatchTrigger(state(), { kind: 'event', event: 'tool-read' }, config(), 1000)
    const second = dispatchTrigger(
      first.state,
      { kind: 'event', event: 'tool-read' },
      config({ eventGapMs: 0 }),
      2000,
    )
    expect(second.decision).toMatchObject({ action: 'merge', reason: 'same kind' })
    const third = dispatchTrigger(second.state, { kind: 'event', event: 'tool-read' }, config({ eventGapMs: 0 }), 3000)
    expect(third.state.merged).toEqual([{ event: 'tool-read', count: 2 }])
  })

  it('合并上限按条数算，超出丢最旧的并报丢了几条', () => {
    let current = state()
    for (const event of ['a', 'b', 'c']) {
      const result = dispatchTrigger(
        current,
        { kind: 'event', event },
        config({ eventGapMs: 100000, mergeMax: 2 }),
        1000,
      )
      current = result.state
    }
    expect(current.merged).toEqual([
      { event: 'b', count: 1 },
      { event: 'c', count: 1 },
    ])
  })

  it('场景开关关掉的事件丢弃且不改状态', () => {
    const before = state({ lastEventAt: 7 })
    const result = dispatchTrigger(before, { kind: 'event', event: 'done', switchOff: true }, config(), 9000)
    expect(result.decision).toEqual({ action: 'drop', reason: 'scene switch off' })
    expect(result.state).toBe(before)
  })

  it('静默撞上进行中的一轮就丢弃（不自己接话）', () => {
    const busy = dispatchTrigger(state(), { kind: 'idle' }, config({ busy: true }), 100)
    expect(busy.decision).toEqual({ action: 'drop', reason: 'busy' })
    const free = dispatchTrigger(state(), { kind: 'idle' }, config(), 100)
    expect(free.decision).toEqual({ action: 'run', merged: [] })
  })

  it('触发时把攒下的合并项带进这一轮，并清空队列', () => {
    const queued = state({ merged: [{ event: 'tool-read', count: 3 }] })
    const result = dispatchTrigger(queued, { kind: 'tap' }, config(), 50000)
    expect(result.decision).toEqual({ action: 'run', merged: [{ event: 'tool-read', count: 3 }] })
    expect(result.state.merged).toEqual([])
  })

  it('flushMerged 用最后一条当主场景，并把整队交出去', () => {
    const queued = state({
      merged: [
        { event: 'tool-read', count: 4 },
        { event: 'done', count: 1 },
      ],
    })
    const flushed = flushMerged(queued)
    expect(flushed.incoming).toEqual({ kind: 'event', event: 'done' })
    expect(flushed.merged).toEqual(queued.merged)
    expect(flushed.state.merged).toEqual([])

    const empty = flushMerged(initialScheduleState())
    expect(empty.incoming).toBeNull()
  })
})
