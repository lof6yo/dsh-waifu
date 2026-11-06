/**
 * PetService：宠物状态机 + 显示配置 + 持久化。
 * 状态源为 DSH 真实事件（Event.listEvents 实测）：
 *   agent/status（idle⇄running）、agent/error、agent/turn-stopping、approval/request、
 *   session/event 总线上的 deliverables/presented（交付庆祝，ADR-012）。
 * 配置经 getSettings() 读取插件设置文件快照（settings-store，ADR-013）；
 * 事件绑定（动画组 + 台词池）与触摸部位存于 touch-parts.jsonc（ADR-015）。
 * @module dsh-waifu/service
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tool-present/types'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { EventBindings, TouchPart } from './models.ts'
import { DEFAULT_EVENT_BINDINGS, PET_EVENTS, mergeEventBindings } from './models.ts'
import { resolveModelUrl, resolveMotionMap, resolveDefaultTouchParts } from './models-host.ts'
import {
  loadPetPersistDetailed,
  savePetPersist,
  normalizeDisplay,
  DEFAULT_DISPLAY,
  type PetDisplay,
} from './persist.ts'
import type { PetSettings } from './settings-store.ts'
import { TouchPartsStore, type TouchPartsFileView } from './touch-parts.ts'

export type PetState = 'idle' | 'thinking' | 'error' | 'done' | 'waiting' | 'delivered'

/**
 * 一次性「活动」提示（ADR-036）：不进状态机，只让客户端播一个短动作。
 * 工具执行、审批结果、会话开关、子代理进出都走这里，避免把状态机撑爆。
 */
export type PetActivityKind =
  | 'tool-read'
  | 'tool-write'
  | 'tool-run'
  | 'tool-agent'
  | 'tool-other'
  | 'approval-granted'
  | 'approval-denied'
  | 'session-open'
  | 'session-close'
  | 'subagent-start'
  | 'subagent-end'

export interface PetActivity {
  /** 单调递增；客户端只认比上次大的 seq，SSE 重复推送不会重播。 */
  seq: number
  kind: PetActivityKind
}

export interface PetStateView {
  state: PetState
  agent: string
  config: {
    enabled: boolean
    size: number
    /** 渲染帧率上限（30 / 60 / 0=不限制；spec §2/§7）。 */
    maxFps: number
    model: string
    /** 解析后的 .model3.json URL（模型 id → URL，spec §6）。 */
    modelUrl: string | null
    debug: boolean
    /** 显示触摸部位色块（开发者选项，spec §2）。 */
    showTapZones: boolean
    /** 默认位置：显示区中心距视口右侧（px；spec §2）。 */
    homeRight: number
    /** 默认位置：显示区中心距视口底部（px）。 */
    homeBottom: number
    /** 画布水平留白（每侧，size 百分比；spec §7）。 */
    canvasPadX: number
    /** 画布垂直留白（每侧，size 百分比）。 */
    canvasPadY: number
    /** 气泡位置/样式（相对模型顶部中心偏移 + 背景/文字样式；spec §2/§4）。 */
    bubbleOffsetX: number
    bubbleOffsetY: number
    bubbleBgColor: string
    bubbleBgOpacity: number
    /** 气泡最长连续可见秒数（0 = 不限）。 */
    bubbleMaxSeconds: number
    bubbleTextColor: string
    /** AI 回复开关（ADR-025）。 */
    aiEnabled: boolean
    aiTouchOnly: boolean
    aiTakeover: boolean
    idleMotionEnabled: boolean
    interactionMode: string
    /** 交互条位置：`top` | `bottom`。 */
    barPosition: string
    /** 交互条额外偏移（px，正数远离模型）。 */
    barOffset: number
    /** AI 回复用的 provider 路由与模型 id（设置页下拉选中的值，快照透传给宠物半边）。 */
    aiProvider: string
    aiModel: string
    /** 注入到 prompt 的最近对话条数（0 = 不注入，ADR-030）。 */
    aiHistoryCount: number
    /** 长状态 AI 演绎节奏（秒/秒/次，ADR-026）。 */
    thinkingAiDelay: number
    thinkingAiInterval: number
    thinkingAiMax: number
    waitingAiDelay: number
    waitingAiInterval: number
    waitingAiMax: number
    /** 语音合成与口型（ADR-033）。 */
    ttsEnabled: boolean
    ttsModel: string
    ttsVoice: string
    lipsyncEnabled: boolean
    lipsyncGain: number
    focusRange: number
    /** 六个事件的绑定（动画组候选 + 台词池；内置/自定义默认 → 用户覆盖）。 */
    events: EventBindings
    /** 当前模型生效的触摸部位（用户自定义优先，其次内置默认；spec §4）。 */
    touchParts: TouchPart[]
  }
  display: PetDisplay
  /** 是否已有持久化位置（false = 首次启动，客户端按「默认中心位置」套用一次并回写）。 */
  displaySaved: boolean
  version: number
  /** 最近一次活动提示（客户端按 seq 去重后播一次短动作）。 */
  activity: PetActivity | null
}

/** "完成/交付"庆祝状态在回到空闲前的保持时长（ms）。 */
const DONE_HOLD_MS = 3500

/**
 * 同一类活动的最小间隔（ms）：读文件/跑命令一秒好几次，全播会像抽筋（ADR-036）。
 * 只对「同类」节流 —— 否则派子代理时 `tool-agent` 会把紧随其后的 `subagent-start` 吞掉。
 */
const ACTIVITY_THROTTLE_MS = 700

/**
 * 不参与活动提示的工具：上下文压缩、记忆、技能、提问这类内部动作太频繁，
 * 全播会变成一路「顺手做了。」的噪音。
 */
const QUIET_TOOLS = new Set([
  'compress', 'acp_status', 'acp_cache', 'decompress', 'search_context',
  'todo_write', 'skill', 'present', 'ask_user_question',
  'mnemon_runtime_memory', 'mnemon_recall', 'mnemon_remember', 'mnemon_status',
  'mnemon_document_search', 'mnemon_document_create', 'mnemon_document_manage',
  'mnemon_memory_bodies', 'mnemon_memory_body_create', 'mnemon_memory_body_update',
  'mnemon_memory_body_merge', 'mnemon_link', 'mnemon_forget', 'mnemon_related',
])

/** 变化通知监听器（状态/显示/配置变化时触发，供 SSE 推送使用）。 */
type ChangeListener = () => void

export class PetService {
  private state: PetState = 'idle'
  private agent = 'idle'
  private version = 0
  private display: PetDisplay
  private displaySaved = false
  private holdTimerId: ReturnType<typeof setTimeout> | undefined
  private activity: PetActivity | null = null
  private activitySeq = 0
  private lastActivityAtByKind = new Map<PetActivityKind, number>()
  /** 子代理的会话 id：它们的 status/turn-stopping 不该驱动宠物状态（ADR-036 修订）。 */
  private readonly subagentIds = new Set<string>()
  private listeners = new Set<ChangeListener>()

  constructor(
    ctx: Context,
    private readonly getSettings: () => PetSettings,
    private readonly touchPartsStore?: TouchPartsStore,
  ) {
    const loaded = loadPetPersistDetailed(DEFAULT_DISPLAY)
    this.display = loaded.display
    this.displaySaved = loaded.saved
    // 卸载时清理"完成/交付"保持计时器
    ctx.effect(() => () => {
      if (this.holdTimerId) clearTimeout(this.holdTimerId)
    })

    ctx.on('agent/status', (payload) => {
      if (this.isSubagent(payload?.agent)) return
      const status = payload?.status
      if (!status) return
      this.agent = String(status)
      if (status === 'running') {
        this.set('thinking')
      } else if (status === 'idle' && this.state !== 'done' && this.state !== 'delivered') {
        // done/delivered 保持期内到达的 idle 不打断庆祝（由保持计时器负责回收）
        this.set('idle')
      }
    })
    ctx.on('agent/error', (payload) => {
      if (this.isSubagent(payload?.agent)) return
      this.set('error')
    })
    ctx.on('agent/turn-stopping', (payload) => {
      if (this.isSubagent(payload?.agent)) return
      // 交付保持期内紧随的轮次结束不打断交付庆祝（交付是更强的完成时刻，ADR-012）
      if (this.state !== 'delivered') this.setDone()
    })
    // approval/request 是 waterfall 事件：必须调用 next() 放行审批链
    ctx.on('approval/request', async (_req, next) => {
      this.set('waiting')
      const outcome = await next()
      // 批准/拒绝都是「人做了决定」的时刻，值得一个明确的点头/摇头（ADR-036）
      this.noteApproval(String(outcome))
      return outcome
    })
    // 向用户提问（agent 的 ask_user_question 等）同样是「等人做选择」，按 waiting 处理；
    // 这也是 waterfall 事件，必须 next() 放行到真正的 answerer。
    // cordis 的 Events 类型未声明该事件（它由 @deepseek-ai/dsh-user-questions 定义），
    // 这里按字符串事件订阅，运行期等价。
    ;(ctx as unknown as {
      on(event: string, fn: (request: unknown, next?: () => unknown) => unknown): void
    }).on('user-questions/request', (_request: unknown, next?: () => unknown) => {
      this.set('waiting')
      return next?.()
    })
    // 模型经 present 工具交付文件（会话事件总线，ADR-012）
    ctx.on('session/event', (_session, event) => {
      if (event?.type === 'deliverables/presented') this.setDelivered()
    })
    // 工具执行（ADR-036）：按工具名归类成一次性活动，客户端播对应短动作。
    // tools / subagent 的 Events 增强由它们各自的包声明，插件没有直接依赖它们，
    // 因此这里按字符串事件订阅（运行期等价，cordis 只按名字分发）。
    const onLoose = (ctx as unknown as {
      on(event: string, fn: (first: unknown, second: unknown) => unknown): void
    }).on
    onLoose('tools/pre-execute', (exec, next) => {
      this.noteTool((exec as { name?: string } | undefined)?.name)
      return (next as () => Promise<unknown>)()
    })
    onLoose('subagent/start', (info) => {
      const id = (info as { id?: unknown } | undefined)?.id
      if (typeof id === 'string') this.subagentIds.add(id)
      this.noteActivity('subagent-start')
    })
    onLoose('subagent/end', () => this.noteActivity('subagent-end'))
    // 会话开关：只对顶层会话（子代理会话 header 里带 parentSession）打招呼/道别
    const onLooseSession = ctx as unknown as {
      on(event: string, fn: (session: { header?: { parentSession?: string } } | undefined) => void): void
    }
    onLooseSession.on('session/created', (session) => {
      if (!session?.header?.parentSession) this.noteActivity('session-open')
    })
    onLooseSession.on('session/disposed', (session) => {
      if (!session?.header?.parentSession) this.noteActivity('session-close')
    })
  }

  /**
   * 该 agent 是否是子代理。子代理的 turn 结束不该让宠物庆祝「完成」，
   * 否则我每派一个分身它就欢呼一次（ADR-036 修订）。
   */
  private isSubagent(agent: { id?: unknown } | undefined): boolean {
    const id = agent?.id
    return typeof id === 'string' && this.subagentIds.has(id)
  }

  /** 审批结果（approval/request 的返回值）：批准点头、被拒摇头（ADR-036）。 */
  private noteApproval(outcome: string): void {
    if (outcome === 'allowed-once') this.noteActivity('approval-granted')
    else if (outcome === 'rejected') this.noteActivity('approval-denied')
  }

  /** 工具名 → 活动种类（读 / 写 / 跑命令 / 派代理 / 其它）。 */
  private noteTool(name: string | undefined): void {
    if (!name) return
    const tool = name.toLowerCase()
    if (tool.startsWith('mcp__')) return
    if (QUIET_TOOLS.has(tool)) return
    if (/^(bash|terminal|kill|job)/.test(tool)) this.noteActivity('tool-run')
    else if (/^(write|edit|multi_edit|apply_patch|notebook_edit)/.test(tool)) this.noteActivity('tool-write')
    else if (/^(read|glob|grep|ls|list|search|web)/.test(tool)) this.noteActivity('tool-read')
    else if (/^(subagent|agent|workflow|task|team)/.test(tool)) this.noteActivity('tool-agent')
    else this.noteActivity('tool-other')
  }

  /** 记录一次性活动；同类活动 700ms 内只播一次，避免动作乱蹦（ADR-036）。 */
  private noteActivity(kind: PetActivityKind): void {
    const now = Date.now()
    if (now - (this.lastActivityAtByKind.get(kind) ?? 0) < ACTIVITY_THROTTLE_MS) return
    this.lastActivityAtByKind.set(kind, now)
    this.activitySeq += 1
    this.activity = { seq: this.activitySeq, kind }
    this.version += 1
    this.emitChange()
  }

  /** 立即切换状态；取消未完成的"完成/交付"保持计时。 */
  private set(next: PetState): void {
    if (this.holdTimerId) {
      clearTimeout(this.holdTimerId)
      this.holdTimerId = undefined
    }
    if (this.state === next) return
    this.state = next
    this.version += 1
    this.emitChange()
  }

  /** 进入庆祝态（done/delivered）并保持 DONE_HOLD_MS 后回空闲（客户端据此播庆祝动画）。 */
  private setHeld(state: 'done' | 'delivered'): void {
    this.set(state)
    this.holdTimerId = setTimeout(() => {
      this.holdTimerId = undefined
      this.set('idle')
    }, DONE_HOLD_MS)
  }

  private setDone(): void {
    this.setHeld('done')
  }

  private setDelivered(): void {
    this.setHeld('delivered')
  }

  /**
   * 当前模型生效的触摸部位：用户保存过 → 用户文件；否则内置 preset 默认；
   * 再否则空表（点击不触发互动，spec §4）。
   */
  touchPartsFor(model: string): TouchPart[] {
    const saved = this.touchPartsStore?.partsFor(model)
    if (saved) return saved
    return resolveDefaultTouchParts(model)
  }

  /**
   * 当前模型生效的事件绑定：内置默认台词 + 模型动作组（preset/自定义 animationMap），
   * 再叠加用户在该模型上的覆盖（touch-parts.jsonc 的 events；整事件替换）。
   */
  effectiveEvents(model: string): EventBindings {
    const resolvedMotions = resolveMotionMap(model)
    const base = {} as EventBindings
    for (const event of PET_EVENTS) {
      const fallback = DEFAULT_EVENT_BINDINGS[event]
      base[event] = {
        motions: resolvedMotions[event] ?? fallback.motions,
        lines: fallback.lines,
      }
    }
    const override = this.touchPartsStore?.load().models[model]?.events
    return mergeEventBindings(base, override)
  }

  /** 浏览器轮询用的状态快照（配置实时读取设置文件快照，spec §2）。 */
  snapshot(): PetStateView {
    const settings = this.getSettings()
    return {
      state: this.state,
      agent: this.agent,
      activity: this.activity,
      config: {
        enabled: settings.enabled,
        size: settings.size,
        maxFps: settings.maxFps,
        model: settings.model,
        modelUrl: resolveModelUrl(settings.model),
        debug: settings.debug,
        showTapZones: !!settings.showTapZones,
        homeRight: settings.homeRight,
        homeBottom: settings.homeBottom,
        canvasPadX: settings.canvasPadX,
        canvasPadY: settings.canvasPadY,
        bubbleOffsetX: settings.bubbleOffsetX,
        bubbleOffsetY: settings.bubbleOffsetY,
        bubbleBgColor: settings.bubbleBgColor,
        bubbleBgOpacity: settings.bubbleBgOpacity,
        bubbleMaxSeconds: settings.bubbleMaxSeconds,
        bubbleTextColor: settings.bubbleTextColor,
        aiEnabled: settings.aiEnabled,
        aiTouchOnly: settings.aiTouchOnly,
        aiTakeover: settings.aiTakeover,
        idleMotionEnabled: settings.idleMotionEnabled,
        interactionMode: settings.interactionMode,
        barPosition: settings.barPosition,
        barOffset: settings.barOffset,
        aiProvider: settings.aiProvider,
        aiModel: settings.aiModel,
        aiHistoryCount: settings.aiHistoryCount,
        thinkingAiDelay: settings.thinkingAiDelay,
        thinkingAiInterval: settings.thinkingAiInterval,
        thinkingAiMax: settings.thinkingAiMax,
        waitingAiDelay: settings.waitingAiDelay,
        waitingAiInterval: settings.waitingAiInterval,
        waitingAiMax: settings.waitingAiMax,
        ttsEnabled: settings.ttsEnabled,
        ttsModel: settings.ttsModel,
        ttsVoice: settings.ttsVoice,
        lipsyncEnabled: settings.lipsyncEnabled,
        lipsyncGain: settings.lipsyncGain,
        focusRange: settings.focusRange,
        events: this.effectiveEvents(settings.model),
        touchParts: this.touchPartsFor(settings.model),
      },
      display: { ...this.display },
      displaySaved: this.displaySaved,
      version: this.version,
    }
  }

  /** 触摸部位文件视图（设置页读取用）。 */
  touchPartsFile(): TouchPartsFileView {
    return this.touchPartsStore?.load() ?? { models: {}, error: null, path: '' }
  }

  /** 写回某个模型的触摸部位（+ 可选事件绑定覆盖）并推送（设置页保存后调用；spec §4）。 */
  saveTouchParts(
    model: string,
    parts: readonly TouchPart[],
    events?: Partial<EventBindings>,
  ): TouchPartsFileView {
    const view = this.touchPartsStore?.save(model, parts, events) ?? { models: {}, error: null, path: '' }
    this.version += 1
    this.emitChange()
    return view
  }

  /** 更新显示配置（拖动/尺寸）并持久化；数值在服务端按权威边界 clamp。 */
  setDisplay(patch: Partial<PetDisplay>): PetDisplay {
    this.display = normalizeDisplay({
      right: patch.right ?? this.display.right,
      bottom: patch.bottom ?? this.display.bottom,
      size: patch.size ?? this.display.size,
    })
    savePetPersist(this.display)
    this.version += 1
    this.emitChange()
    return { ...this.display }
  }

  /**
   * 重置为内置默认显示配置（调试/API 用）。
   * 注意：设置页「归位」由 Client 按「显示区中心距右/距下」计算后再 setDisplay（需要视口与画布尺寸），
   * 不走本方法（spec §2）。
   */
  resetDisplay(): PetDisplay {
    this.display = { ...DEFAULT_DISPLAY }
    this.displaySaved = true
    savePetPersist(this.display)
    this.version += 1
    this.emitChange()
    return { ...this.display }
  }

  /** 订阅变化推送（状态/显示变化自动触发）；返回退订函数。 */
  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** 设置/配置变化后由外部调用，触发一次推送（ADR-006）。 */
  notifyConfigChanged(): void {
    this.emitChange()
  }

  private emitChange(): void {
    for (const listener of this.listeners) listener()
  }
}
