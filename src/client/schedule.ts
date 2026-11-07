/**
 * 触发调度（ADR-047）：**所有**触发——触摸、对话、DSH 事件、静默——都先到这里，
 * 由这张策略表决定「立刻触发 / 延后 / 合并 / 丢弃」，客户端只负责执行决定。
 *
 * 为什么是这个形状：
 * - 判断原本散在十几处（Host 冷却、Host 同类节流、客户端窗口、队列、去重…），
 *   用户点一下到底会不会有反应，谁也说不准。归一后只有这一张表。
 * - 纯函数 + 显式状态：不读时钟、不碰 DOM，单测直接喂时间戳。
 * - 三种被拦动作各有含义：`defer`（等一会儿再发，只用于触摸连点）、
 *   `merge`（并入下一次触发，事件专用）、`drop`（真的不发，且必须写清原因）。
 *
 * @module dsh-waifu/client/schedule
 */

/** 触发来源：触摸 / 对话 / DSH 事件 / 静默超时。 */
export type ScheduleSource = 'tap' | 'chat' | 'event' | 'idle'

/** 调度配置（全部来自设置项，见 settings.jsonc）。 */
export interface ScheduleConfig {
  /** AI 驱动总开关：关掉后一切丢弃。 */
  aiEnabled: boolean
  /** 页面是否隐藏（切标签页 / 最小化）：隐藏时一切丢弃。 */
  hidden: boolean
  /** 上一轮演绎是否还在进行中。 */
  busy: boolean
  /** 触摸连点窗口（毫秒，0 = 不合并）。 */
  tapGapMs: number
  /** 事件最小间隔（毫秒，0 = 不限）。 */
  eventGapMs: number
  /** 同类事件窗口（毫秒，0 = 不合并同类）。 */
  sameKindWindowMs: number
  /** 合并上限（条）。 */
  mergeMax: number
  /** 上一轮还没说完时新事件怎么办：queue = 合并等它说完，interrupt = 直接抢占。 */
  triggerMode: 'queue' | 'interrupt'
}

/** 一次进来的触发。 */
export interface ScheduleIncoming {
  kind: ScheduleSource
  /** 事件键（kind === 'event' 时必填）。 */
  event?: string
  /** 场景开关是否关掉了这个事件（客户端先查表再交进来）。 */
  switchOff?: boolean
}

/** 被合并下来的一条（同类只留一条，靠 count 记次数）。 */
export interface MergedTrigger {
  event: string
  count: number
}

/** 调度器状态（客户端持有，跨触发累积）。 */
export interface ScheduleState {
  /** 上次触摸触发的时间。 */
  lastTapAt: number
  /** 上次事件触发的时间。 */
  lastEventAt: number
  /** 每个事件键上次出现的时间（同类窗口用）。 */
  lastSeenAt: Record<string, number>
  /** 攒着的合并项（按事件键聚合，最多 mergeMax 条）。 */
  merged: MergedTrigger[]
}

/** 调度决定。 */
export type Decision =
  | { action: 'run'; merged: MergedTrigger[] }
  | { action: 'drop'; reason: string }
  | { action: 'defer'; delayMs: number; reason: string }
  | { action: 'merge'; reason: string; nextAt: number; overflowed: number }

/** 一次调度的结果：决定 + 新状态（不修改入参）。 */
export interface DispatchResult {
  decision: Decision
  state: ScheduleState
}

/** 空状态。 */
export function initialScheduleState(): ScheduleState {
  return { lastTapAt: 0, lastEventAt: 0, lastSeenAt: {}, merged: [] }
}

/** 把一条事件塞进合并队列（同类聚合、超出上限丢最旧）。 */
function pushMerged(
  merged: readonly MergedTrigger[],
  event: string,
  max: number,
): { merged: MergedTrigger[]; overflowed: number } {
  const index = merged.findIndex((item) => item.event === event)
  if (index >= 0) {
    const next = merged.slice()
    next[index] = { event, count: next[index]!.count + 1 }
    return { merged: next, overflowed: 0 }
  }
  const next = [...merged, { event, count: 1 }]
  const limit = Math.max(1, max)
  if (next.length <= limit) return { merged: next, overflowed: 0 }
  // 超上限：丢最旧的（数组头部）
  return { merged: next.slice(next.length - limit), overflowed: next.length - limit }
}

/**
 * 调度一支触发。
 *
 * @param state 调度器状态
 * @param incoming 这次进来的触发
 * @param config 策略配置
 * @param now 当前时间戳（由调用方注入，便于测试）
 */
export function dispatchTrigger(
  state: ScheduleState,
  incoming: ScheduleIncoming,
  config: ScheduleConfig,
  now: number,
): DispatchResult {
  if (!config.aiEnabled) return { decision: { action: 'drop', reason: 'ai disabled' }, state }
  if (config.hidden) return { decision: { action: 'drop', reason: 'page hidden' }, state }

  // 静默：永远不插话——上一轮还在演的时候直接丢（用户不看「说完又自己接一句」）
  if (incoming.kind === 'idle') {
    if (config.busy) return { decision: { action: 'drop', reason: 'busy' }, state }
    return { decision: { action: 'run', merged: [] }, state }
  }

  // 触摸 / 对话：永不被别人挡住（触摸恒抢占）
  if (incoming.kind === 'tap' || incoming.kind === 'chat') {
    if (incoming.kind === 'tap' && config.tapGapMs > 0 && state.lastTapAt > 0) {
      const left = state.lastTapAt + config.tapGapMs - now
      if (left > 0) return { decision: { action: 'defer', delayMs: left, reason: 'tap gap' }, state }
    }
    const next: ScheduleState = {
      ...state,
      lastTapAt: incoming.kind === 'tap' ? now : state.lastTapAt,
      merged: [],
    }
    return { decision: { action: 'run', merged: state.merged }, state: next }
  }

  // 事件类
  const event = incoming.event
  if (event === undefined) return { decision: { action: 'drop', reason: 'event without key' }, state }
  if (incoming.switchOff) return { decision: { action: 'drop', reason: 'scene switch off' }, state }

  // 0 = 「还没发生过」：不能当时间戳比，否则第一支事件会被自己的默认值挡在窗口里
  const seenAt = state.lastSeenAt[event]
  const inGap = config.eventGapMs > 0 && state.lastEventAt > 0 && now - state.lastEventAt < config.eventGapMs
  const sameKind = config.sameKindWindowMs > 0 && seenAt !== undefined && now - seenAt < config.sameKindWindowMs
  const busyQueue = config.busy && config.triggerMode === 'queue'
  const seenState: ScheduleState = { ...state, lastSeenAt: { ...state.lastSeenAt, [event]: now } }

  if (inGap || sameKind || busyQueue) {
    const pushed = pushMerged(seenState.merged, event, config.mergeMax)
    const reason = busyQueue ? 'busy' : inGap ? 'event gap' : 'same kind'
    // 忙的时候等这一轮结束再补发（nextAt = 0 表示「没有时间门，交给轮次结束」）；
    // 否则等到最小间隔到期的那一刻补发。
    const nextAt = busyQueue || state.lastEventAt <= 0 ? 0 : Math.max(now, state.lastEventAt + config.eventGapMs)
    return {
      decision: { action: 'merge', reason, nextAt, overflowed: pushed.overflowed },
      state: { ...seenState, merged: pushed.merged },
    }
  }

  const next: ScheduleState = { ...seenState, lastEventAt: now, merged: [] }
  return { decision: { action: 'run', merged: state.merged }, state: next }
}

/**
 * 取走合并队列，凑成一次「补发」的触发（轮次结束或最小间隔到期时调用）。
 * 最后进来的那条当主场景，其余条目交给调用方拼进「这期间还发生了…」。
 */
export function flushMerged(state: ScheduleState): {
  incoming: ScheduleIncoming | null
  merged: MergedTrigger[]
  state: ScheduleState
} {
  if (state.merged.length === 0) return { incoming: null, merged: [], state }
  const last = state.merged[state.merged.length - 1]!
  return {
    incoming: { kind: 'event', event: last.event },
    merged: state.merged,
    state: { ...state, merged: [] },
  }
}
