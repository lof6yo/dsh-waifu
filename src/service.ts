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
    bubbleTextColor: string
    /** 基础表情 id（EXPRESSIONS）+ 连续表情参数强度（0–100）。 */
    expression: string
    exprAngry: number
    exprAngry2: number
    exprCry: number
    exprEye: number
    exprBlush: number
    /** 六个事件的绑定（动画组候选 + 台词池；内置/自定义默认 → 用户覆盖）。 */
    events: EventBindings
    /** 当前模型生效的触摸部位（用户自定义优先，其次内置默认；spec §4）。 */
    touchParts: TouchPart[]
  }
  display: PetDisplay
  /** 是否已有持久化位置（false = 首次启动，客户端按「默认中心位置」套用一次并回写）。 */
  displaySaved: boolean
  version: number
}

/** "完成/交付"庆祝状态在回到空闲前的保持时长（ms）。 */
const DONE_HOLD_MS = 3500

/** 变化通知监听器（状态/显示/配置变化时触发，供 SSE 推送使用）。 */
type ChangeListener = () => void

export class PetService {
  private state: PetState = 'idle'
  private agent = 'idle'
  private version = 0
  private display: PetDisplay
  private displaySaved = false
  private holdTimerId: ReturnType<typeof setTimeout> | undefined
  private listeners = new Set<ChangeListener>()

  constructor(
    private readonly ctx: Context,
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
    ctx.on('agent/error', () => this.set('error'))
    ctx.on('agent/turn-stopping', () => {
      // 交付保持期内紧随的轮次结束不打断交付庆祝（交付是更强的完成时刻，ADR-012）
      if (this.state !== 'delivered') this.setDone()
    })
    // approval/request 是 waterfall 事件：必须调用 next() 放行审批链
    ctx.on('approval/request', (_req, next) => {
      this.set('waiting')
      return next()
    })
    // 模型经 present 工具交付文件（会话事件总线，ADR-012）
    ctx.on('session/event', (_session, event) => {
      if (event?.type === 'deliverables/presented') this.setDelivered()
    })
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
        bubbleTextColor: settings.bubbleTextColor,
        expression: settings.expression,
        exprAngry: settings.exprAngry,
        exprAngry2: settings.exprAngry2,
        exprCry: settings.exprCry,
        exprEye: settings.exprEye,
        exprBlush: settings.exprBlush,
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
