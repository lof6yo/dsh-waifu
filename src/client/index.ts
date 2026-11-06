/**
 * dsh-waifu 浏览器半区：挂载 Live2D 桌宠 + 「Waifu 设置」页。
 *
 * 架构（ADR-005 / 004，spike pkg-9 实证）：
 * - `shell.overlay` 注册零尺寸锚点（生命周期/设置锚点）
 * - 视觉层用 Popover API（top layer，零 z-index）渲染，旧浏览器回退 body + 最大 z-index
 * - 运行时脚本与预设模型走 Host 同源路由（/waifu-assets/*），无 CDN 依赖
 * - agent 状态经 /api/dsh-waifu/events SSE 推送（首帧快照 + 变更推送，ADR-006）；
 *   标签页隐藏/窗口失焦暂停渲染循环，恢复时继续（spec §7）
 * - 点击/拖动按 6px 阈值判定；自由位置拖动，松手持久化（spec §4）
 * - 触摸部位完全由用户自定义 box 决定（相对模型包围盒 0–1 归一化矩形）；点击命中部位后
 *   播放该部位动作组，有该部位自定义台词时随机说一句；编辑态实时叠加绘制草稿 box（spec §4）
 * - 画布在模型显示尺寸外留白（约 20–25% 边距），避免动作/物理甩尾被裁切；模型缩放仍按
 *   「size = 模型可见宽度」计算（spec §7）
 * - 点击穿透：canvas/容器 pointer-events:none，按触摸部位 box 生成透明命中层承接点击/拖动，
 *   透明区域不拦截下层 UI（spec §4）
 * - 鼠标跟随：document 级 pointermove 调用 model.focus()，头/眼/身体看向鼠标；移出页面复位；
 *   非 idle 动作播放期间抑制 focus，避免动作关键帧被鼠标跟随叠加（spec §4）
 * - 配置（enabled/size/maxFps/debug/model/events）经状态推送运行时应用：开关→显隐+停启渲染、
 *   尺寸→重设画布与模型适配、帧率→ticker.maxFPS、调试→动态面板、模型→按 modelUrl 重载、
 *   事件绑定（动作组 + 台词池）→热更新状态表现（spec §2/§3/§6/§7）
 * @module dsh-waifu/client
 */

import { createElement, useEffect, useRef } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
import type { PetState, PetStateView } from '../service.ts'
import { PetSettingsSection } from './settings.ts'
import { installPetSettingsNavIcon, pawNavIcon } from './paw-icon.ts'
import { stripTimestamps } from '../models.ts'
import { clientLog } from './client-log.ts'
import {
  DEFAULT_EVENT_BINDINGS,
  isLongState,
  type LongState,
  EXPRESSIONS,
  expressionParams,
  EXPRESSION_SWITCH_PARAMS,
  normalizeExpressionId,
  splitMotionSelection,
  hitTestTouchParts,
  pointToBoundsRatio,
  type EventBindings,
  type TouchBox,
  type TouchPart,
} from '../models.ts'
import {
  DEFAULT_BUBBLE_BG_COLOR,
  DEFAULT_BUBBLE_BG_OPACITY,
  DEFAULT_BUBBLE_MAX_SECONDS,
  DEFAULT_SETTINGS,
  DEFAULT_BUBBLE_OFFSET_X,
  DEFAULT_BUBBLE_OFFSET_Y,
  DEFAULT_BUBBLE_TEXT_COLOR,
  DEFAULT_CANVAS_PAD_X,
  DEFAULT_CANVAS_PAD_Y,
  DEFAULT_HOME_BOTTOM,
  DEFAULT_HOME_RIGHT,
  DEFAULT_MAX_FPS,
  DEFAULT_BAR_OFFSET,
  DEFAULT_BAR_POSITION,
  BAR_OFFSET_LIMITS,
  DEFAULT_INTERACTION_MODE,
  normalizeBarPosition,
  type BarPosition,
  normalizeInteractionMode,
  type InteractionMode,
} from '../defaults.ts'
import { onTouchEdit, type TouchEditState } from './touch-edit.ts'
import { homePercentFromPos, onCaptureHome, onRecenter } from './pet-commands.ts'

/** 注入所需服务。 */
export const inject = ['slots']

/** 点击/拖动判定阈值（px）。 */
const DRAG_THRESHOLD = 6
/** 点击互动防抖（ms）：仅挡同一次 pointer 误触双发，不等气泡播完（spec §4）。 */
const TAP_DEBOUNCE_MS = 80
/**
 * 判定「这是点击」的容差（px）：指针按下到抬起的位移不超过它就算点击（位置回滚）。
 * 触屏/触控板按一下常带 6–10px 抖动，若按 `DRAG_THRESHOLD` 直接算拖拽，点击就会被吞掉。
 */
const TAP_SLOP_PX = 12
/**
 * 浏览器所在时区（IANA 名）：宿主可能跑在 UTC，只发「HH:MM」的绝对时间会让模型把深夜当清晨。
 * 时区不会变，算一次缓存住。
 */
const CLIENT_TIME_ZONE: string = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
})()
/**
 * 交互条静音按钮的图标：内联 SVG（`currentColor` 描边）。
 * 不用 emoji——各平台字体渲染差异太大、大小也对不齐。
 */
const ICON_SPEAKER_ON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>'
const ICON_SEND = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12h13"/><path d="m12 6.5 5.5 5.5-5.5 5.5"/></svg>'
const ICON_SPEAKER_OFF = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16.5 9.5 5 5"/><path d="m21.5 9.5-5 5"/></svg>'
/** 瞬态气泡显示时长（ms）：到时自动隐藏或回落阶段文案。 */
const BUBBLE_DISPLAY_MS = 2500
/** 气泡最长连续可见时长兜底（秒）：默认 30；0 = 不限（spec §3，ADR-027）。 */
const BUBBLE_MAX_DEFAULT = DEFAULT_BUBBLE_MAX_SECONDS
/**
 * 与 Host 的 `AI_COOLDOWN_MS` 对齐的客户端冷却：冷却内的点击**不发请求**（Host 会直接拒），
 * 也不能顺手 `stopSpeaking()` 把上一条已经说了一半的台词掐掉——否则连点两下等于「什么都没发生」。
 */
const AI_REQUEST_COOLDOWN_MS = 1200
/** AI 台词最短可见时长：状态切换再快，也要让这句露一脸（ADR-025 补丁）。 */
const AI_BUBBLE_HOLD_MS = 1400
/**
 * 默认渲染帧率上限（spec §2/§7）：未封顶时 PIXI ticker 可达 120–140fps，
 * 长时间挂页会持续占满 GPU/主线程；桌宠动画默认 30fps 足够，用户可在设置中改档。
 * 取值来自 defaults.ts，与 Host schema 单一来源。
 */

/**
 * 画布四周留白（模型可见尺寸之外，每侧）：百分比来自 settings.canvasPadX/Y（0–300，默认 125/50），
 * 实际留白 = max(CANVAS_PAD_MIN, size * pct / 100)。动作/物理甩尾（尾巴等）会超出模型静止包围盒，
 * 留白不足会被 canvas 裁切（spec §7）。
 */
const CANVAS_PAD_MIN = 40
// 留白/气泡/位置的兜底值统一来自 defaults.ts（与 Host schema、设置页 DEFAULT_VALUE 同源）。

/** #rgb/#rrggbb + 0–100 不透明度 → CSS rgba()（非法颜色回退白色，spec §3）。 */
function colorWithOpacity(color: string, opacityPct: number): string {
  const raw = String(color).trim().replace(/^#/, '')
  const hex = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
  const alpha = Math.min(100, Math.max(0, Number.isFinite(opacityPct) ? opacityPct : 100)) / 100
  if (!/^[0-9a-f]{6}$/i.test(hex)) return `rgba(255,255,255,${alpha})`
  const n = Number.parseInt(hex, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/** 渲染分辨率倍数（HiDPI 屏用 2x 缓冲，避免 1x 缓冲被放大产生锯齿；上限 2 控制显存）。 */
function renderScale(): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1
  return Math.min(2, Math.max(1, Number.isFinite(dpr) && dpr > 0 ? dpr : 1))
}

/** pixi-live2d-display MotionPriority（对应库内枚举：NONE=0, IDLE=1, NORMAL=2, FORCE=3）。 */
const MotionPriority = {
  IDLE: 1,
  NORMAL: 2,
  FORCE: 3,
} as const
type MotionPriority = typeof MotionPriority[keyof typeof MotionPriority]

/**
 * 触摸部位 box 叠加层调色板（按部位 index 循环；编辑态高亮部位用更亮描边，
 * spec §2 开发者选项「显示触摸部位」/ 设置页编辑态）。
 */
const TOUCHBOX_PALETTE = [
  { fill: 'rgba(80,160,255,.24)', stroke: 'rgba(160,210,255,.9)' },
  { fill: 'rgba(80,200,120,.24)', stroke: 'rgba(150,255,190,.9)' },
  { fill: 'rgba(255,160,60,.26)', stroke: 'rgba(255,210,140,.9)' },
  { fill: 'rgba(255,120,170,.24)', stroke: 'rgba(255,180,210,.9)' },
  { fill: 'rgba(180,140,255,.24)', stroke: 'rgba(215,190,255,.9)' },
  { fill: 'rgba(100,225,225,.24)', stroke: 'rgba(170,255,255,.9)' },
] as const

/** 表情淡入淡出时长（ms）：切换表情时开关参数按该时长线性逼近目标值。 */
const EXPRESSION_FADE_MS = 280
/** 触摸部位表情的临时保持时长（ms）：到点自动回到当前事件绑定的表情。 */
/** 触摸互动的「保持窗口」：这段时间内触摸拥有气泡与动作（ADR-032）。 */
const TAP_INTERACTION_HOLD_MS = 2600
const EXPRESSION_TEMP_MS = 2200
/** 待机小动作：随机间隔与候选动作组（幅度很小，只为消除「定格动画」感）。 */
/** 模型标注的情绪 → 表情组合（表情 id 见 models.ts 的 EXPRESSIONS）。 */
const EMOTION_EXPRESSIONS: Record<string, readonly string[]> = {
  happy: ['star'],
  angry: ['angry'],
  sad: ['tear'],
  shy: ['blush'],
  surprised: ['whites'],
  smug: ['heart'],
  neutral: [],
}
/** 情绪表情的保持时长：比触摸短表情长一点，念完一句还在。 */
const EMOTION_HOLD_MS = 4200

const IDLE_MICRO_MOTIONS = ['Glance', 'Perk', 'Shift', 'Sigh'] as const
const IDLE_MICRO_MIN_MS = 7000
const IDLE_MICRO_MAX_MS = 16000
/** 被打断（非 idle / 正在互动）后重试的间隔。 */
const IDLE_MICRO_RETRY_MS = 4000

/** 归一化配置帧率档（非法值回落默认 30）。 */
function normalizeMaxFps(raw: unknown): number {
  if (raw === 60 || raw === 0) return raw
  return DEFAULT_MAX_FPS
}
const VENDOR_SCRIPTS = [
  '/waifu-assets/vendor/pixi.min.js',
  '/waifu-assets/vendor/live2dcubismcore.min.js',
  '/waifu-assets/vendor/live2d-display.cubism4.min.js',
]

const PET_API = '/api/dsh-waifu'

/** PIXI 全局（script 注入，非模块导入）。 */
declare const PIXI: {
  Application: new (options: Record<string, unknown>) => {
    stage: { addChild(child: unknown): unknown }
    ticker: {
      addOnce(fn: () => void): unknown
      start(): unknown
      stop(): unknown
      maxFPS?: number
    }
    renderer: { resize(width: number, height: number): unknown }
    destroy(remove: boolean): void
  }
  Point: new (x: number, y: number) => unknown
  live2d?: {
    Live2DModel?: {
      from(url: string, options?: Record<string, unknown>): Promise<unknown>
    }
  }
}

/** 最小 slots 服务结构类型（运行时由 DSH 提供）。 */
interface SlotsLike {
  inject(key: string, callback: () => () => void): () => void
  register(
    options: {
      name: string
      id: string
      order?: number
      label?: string | (() => string)
      /** 设置导航图标：ReactNode 或按尺寸渲染（与 better-sidebar 等同款约定）。 */
      icon?: ReactNode | ((size: number) => ReactNode)
      inject?: () => Record<string, unknown>
    },
    component: (props: unknown) => unknown,
  ): () => void
}

interface DisplayLike { right: number; bottom: number; size: number }

/** 调试预览用：模型中的一个具体动画（动作组 + 组内下标 + 展示名）。 */
interface DebugMotionItem {
  group: string
  index: number
  label: string
}

interface ModelLike {
  width: number
  height: number
  anchor: { set(x: number, y: number): void }
  scale: { set(s: number): void }
  position: { set(x: number, y: number): void }
  /** pixi-live2d-display 真实签名：motion(group, index?, priority?)，只传组名时随机播放该组并默认 NORMAL。 */
  motion(name: string, index?: number, priority?: MotionPriority): Promise<boolean>
  /** pixi-live2d-display 真实签名：focus(x, y) 吃 world space 坐标，内部平滑映射头/眼/身体参数。 */
  focus(x: number, y: number, instant?: boolean): void
  /** 模型在舞台/画布坐标下的包围盒（触摸部位 box 归一化换算用，spec §4）。 */
  getBounds?: () => { x: number; y: number; width: number; height: number }
  internalModel?: {
    /** Cubism4 模型：每帧写入参数（表情开关 / 连续参数）用。 */
    coreModel?: {
      setParameterValueById?(id: string, value: number, weight?: number): void
      getParameterValueById?(id: string): number
    }
    /** InternalModel.update(dt, now)：包装它，在动作与物理生效前写入表情参数。 */
    update?(dt: number, now: number): void
    focusController?: { focus(x: number, y: number, instant?: boolean): void }
    motionManager?: {
      /** MotionManager 事件：motionFinish 是动作真正播完的信号（motion() 的 Promise 只代表开始）。 */
      on?(event: 'motionFinish', listener: () => void): unknown
      off?(event: 'motionFinish', listener: () => void): unknown
      /** 停掉当前队列并复位 MotionState；重播同一动作前需要先调用。 */
      stopAllMotions?(): void
      /** 模型定义的动作组名 → 动作定义列表（debug 预览枚举用）。 */
      definitions?: Record<string, unknown>
    }
  }
}

/** 从台词池随机取一句；可选避开上一条（池 ≥2 时，spec §4）。 */
function pickLine(pool: readonly string[], avoid?: string): string | undefined {
  if (pool.length === 0) return undefined
  if (pool.length === 1) return pool[0]
  const candidates = avoid ? pool.filter((line) => line !== avoid) : pool
  const list = candidates.length > 0 ? candidates : pool
  return list[Math.floor(Math.random() * list.length)]
}

/** JSON 响应读取:非 2xx 抛错——错误响应不得当作合法视图/结果解析。 */
async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`http ${res.status}`)
  return await res.json() as T
}

const api = {
  state: (): Promise<PetStateView> => fetch(`${PET_API}/state`).then((res) => readJson<PetStateView>(res)),
  /** SSE 状态订阅（ADR-006）：每次推送回调最新快照；断线由 EventSource
   *  自动重连（服务端 retry 3s），重连后首帧即全量快照。返回退订函数。 */
  events: (onState: (view: PetStateView) => void, onError: () => void): (() => void) => {
    const es = new EventSource(`${PET_API}/events`)
    es.onmessage = (ev: MessageEvent<string>) => {
      try {
        onState(JSON.parse(ev.data) as PetStateView)
      } catch {
        // 忽略坏帧，等待下一条
      }
    }
    es.onerror = onError
    return () => es.close()
  },
  /** AI 回复（ADR-025）：上报「戳了哪里/变成什么状态」，拿回一句台词（失败返回 ok:false）。 */
  interact: (body: { kind: 'tap' | 'state' | 'chat'; part?: string; state?: string; hint?: string; text?: string; tz?: string }): Promise<{ ok: boolean; text?: string; emotion?: string | null; error?: string }> =>
    fetch(`${PET_API}/interact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((res) => readJson<{ ok: boolean; text?: string; error?: string }>(res)),
  /**
   * 流式演绎（ADR-033）：POST /speak 走 SSE，逐条回调 `text`/`clause`/`audio`/`done`/`error`。
   * 用 fetch + ReadableStream 手动解帧（EventSource 不支持 POST 带 body）。
   */
  speak: async (
    body: { kind: 'tap' | 'state' | 'chat'; part?: string; state?: string; hint?: string; text?: string; tz?: string },
    onEvent: (event: string, data: unknown) => void,
    signal: AbortSignal,
  ): Promise<void> => {
    const res = await fetch(`${PET_API}/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok || !res.body) throw new Error(`http ${res.status}`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let split = buffer.indexOf('\n\n')
      while (split >= 0) {
        const frame = buffer.slice(0, split)
        buffer = buffer.slice(split + 2)
        let event = 'message'
        const dataLines: string[] = []
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
        }
        if (dataLines.length > 0) {
          try {
            onEvent(event, JSON.parse(dataLines.join('\n')) as unknown)
          } catch {
            // 坏帧跳过，等下一帧
          }
        }
        split = buffer.indexOf('\n\n')
      }
    }
  },
  setDisplay: (patch: { right?: number; bottom?: number }): Promise<{ ok: boolean }> =>
    fetch(`${PET_API}/set-display`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((res) => readJson<{ ok: boolean }>(res)),
}

/** vendor 脚本加载去重：同一 src 只注入一次、只等待同一份结果
 * （boot 在 StrictMode/HMR 下会重复执行，避免二次注入与重复初始化）。 */
const scriptPromises = new Map<string, Promise<void>>()

function loadScript(src: string): Promise<void> {
  let pending = scriptPromises.get(src)
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = src
      s.onload = () => resolve()
      s.onerror = () => reject(new Error(`script load failed: ${src}`))
      document.head.appendChild(s)
    })
    scriptPromises.set(src, pending)
  }
  return pending
}

/** 零尺寸锚点组件：占位 shell.overlay 席位，实际渲染在 popover 顶层容器。 */
function PetAnchor(): ReturnType<typeof createElement> {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    clientLog('info', 'anchor mounted')
    return boot(ref.current)
  }, [])
  return createElement('div', { ref, style: { width: 0, height: 0 } })
}

/** 气泡兜底：行首的 `[shy]`、`［害羞］`、`** [smug] **` 一律当控制标签剥掉（客户端没有情绪词表，就看位置）。 */
const LEADING_TAG = /^\s*[*_`~]*\s*[[［【(（〔〖][^\]］】）}〕〗\n]{1,24}[\])］】）}〕〗]\s*[*_`~]*\s*/

function stripLeadingTagText(text: string): string {
  let out = text
  for (let i = 0; i < 3; i += 1) {
    const next = out.replace(LEADING_TAG, '')
    if (next === out) break
    out = next
  }
  return out || text
}

function boot(anchor: HTMLDivElement | null): (() => void) | undefined {
  if (!anchor) { clientLog('warn', 'boot skipped: anchor missing'); return undefined }
  clientLog('info', 'boot start')
  const cleanup: Array<() => void> = []
  const pushCleanup = (fn: () => void) => { cleanup.push(fn) }

  // 卸载守卫：置位后 boot 的异步流程在每个 await 点提前退出，
  // 避免 StrictMode 双挂载 / HMR 重挂载时残留第二份 PIXI app、SSE 订阅与脚本注入。
  let disposed = false
  pushCleanup(() => { disposed = true })
  // 阶段推进/瞬态气泡计时随卸载清理（HMR/StrictMode 重挂载不残留）
  pushCleanup(() => { clearLongState(); clearTapHold(); clearBubbleHideTimer(); clearPendingTap(); stopSpeaking() })
  pushCleanup(() => {
    if (sizeRaf) { window.cancelAnimationFrame(sizeRaf); sizeRaf = 0 }
    pendingSize = null
  })
  pushCleanup(() => { stopOverlayLoop(); showTapZones = false; editState = null })
  // 设置页「编辑触摸部位」事件（spec §4）：编辑态强制显示宠物并实时绘制草稿 box。
  // 退订随挂载清理，避免 StrictMode/HMR 重挂载残留监听。
  pushCleanup(onTouchEdit(handleTouchEdit))
  // 设置页「归位」命令（spec §2）：按配置「显示中心距右/距下」重算位置并持久化。
  // 退订随挂载清理，避免 StrictMode/HMR 重挂载重复响应。
  pushCleanup(onRecenter(() => {
    homePositionFromConfig()
    applyPosToBox()
    persistDisplay()
  }))
  // 设置页「捕捉」命令（spec §2）：把角色当前位置换算成「显示中心距右/距下」的百分比回传，
  // 由设置页写成新的默认位置——位置只有宠物半边知道，换算也只有这里拿得到画布与视口尺寸。
  pushCleanup(onCaptureHome((captured) => {
    const { width, height } = logicalCanvasSize()
    const viewport = {
      width: window.innerWidth || document.documentElement.clientWidth || 0,
      height: window.innerHeight || document.documentElement.clientHeight || 0,
    }
    const home = homePercentFromPos(pos, { width, height }, viewport)
    if (home !== null) captured(home)
  }))

  let box: HTMLDivElement | null = null
  let bubble: HTMLDivElement | null = null
  let debugEl: HTMLDivElement | null = null
  /** 调试面板“动画预览”数据：当前模型 MotionManager 暴露的全部具体动画。 */
  let debugMotionList: DebugMotionItem[] = []
  /** 按模型 URL 缓存原生动画列表，避免重复请求同一份 .model3.json。 */
  const motionListCache = new Map<string, DebugMotionItem[]>()
  let debugMotionSelect: HTMLSelectElement | null = null
  /** 调试面板状态文本容器：与演示按钮/动画预览并列，避免被 textContent 覆盖。 */
  let debugTextEl: HTMLDivElement | null = null
  /** 是否正处于 debug 原生动画预览：预览期间抑制 focus，结束后只恢复跟随，不触发状态恢复。 */
  let previewActive = false
  /** 调试面板顶部（逻辑画布 CSS px；NaN = 不可见/未定位），用于气泡避让（spec §2）。 */
  let debugPanelTopLogical = Number.NaN
  let canvas: HTMLCanvasElement | null = null
  /** 画布外包一层，便于绝对定位触摸部位叠加层。 */
  let petLayer: HTMLDivElement | null = null
  let touchboxOverlay: HTMLCanvasElement | null = null
  /** 开发者选项：显示触摸部位色块（SSE config.showTapZones；编辑态强制显示，spec §2）。 */
  let showTapZones = false
  /** 触摸部位编辑态（设置页草稿；null = 非编辑态）。编辑态强制显示宠物与草稿 box（spec §4）。 */
  let editState: TouchEditState | null = null
  /** 当前模型生效的触摸部位（SSE config.touchParts；编辑态改用 editState.parts，spec §4）。 */
  let touchParts: TouchPart[] = []
  /** 当前模型生效的事件绑定（SSE config.events；缺省 DEFAULT_EVENT_BINDINGS，spec §3）。 */
  let eventBindings: EventBindings = DEFAULT_EVENT_BINDINGS
  /** 事件绑定内容签名：配置变化时刷新长状态当前阶段文案（spec §3）。 */
  let eventBindingsSignature = ''
  /** 统一浮层逐帧循环句柄（命中层 / 触摸色块 / 调试面板 / 气泡共用一条 rAF，spec §3/§4）。 */
  let overlayRaf = 0
  /** 上一次真正执行帧的时间戳：按 settings.maxFps 节流（0 = 不限），不再固定 60fps 空转。 */
  let overlayLastAt = 0
  /** 上一次写入命中层的包围盒签名（0.5px 粒度）：未变则整帧跳过位置写。 */
  let overlayHitKey = ''
  /** 上一次触摸色块绘制的签名（包围盒 + 部位/box + 高亮 + 画布尺寸）。 */
  let overlayPaintKey = ''
  /** petLayer 的视口 rect 缓存：气泡/面板定位用，样式变化时失效（避免每帧强制布局）。 */
  let layerRectCache: DOMRect | null = null
  /** 调试面板尺寸缓存：面板内容变化/窗口 resize 时失效（避免每帧读 offsetWidth/offsetHeight）。 */
  let panelSizeCache: { width: number; height: number } | null = null
  /** 命中层容器（点击穿透，spec §4）：覆盖 canvas，子 div 按触摸部位 box 定位并接收指针事件。 */
  let hitLayer: HTMLDivElement | null = null
  /** 命中 div ↔ 部位 box 归一化坐标的对应关系（每帧按 model.getBounds 更新 CSS 位置）。
   *  `last` 记录上一次写入的值（0.5px 粒度），值没变就不写样式，避免无谓的样式失效。 */
  let hitBoxEntries: Array<{ el: HTMLDivElement; box: TouchBox; last: string }> = []
  /** 当前命中 box 集合签名：部位/box 变化时才重建 div，避免每帧重建。 */
  let hitBoxesSignature = ''
  let app: {
    destroy(remove?: boolean): void
    /** PIXI renderer 的逻辑渲染区（resolution 只放大缓冲，不动逻辑坐标）。 */
    screen?: { width: number; height: number }
    stage: { addChild(child: unknown): unknown }
    ticker: {
      addOnce(fn: () => void): unknown
      start(): unknown
      stop(): unknown
      maxFPS?: number
    }
    renderer: { resize(width: number, height: number): unknown }
  } | null = null
  let model: ModelLike | null = null
  let currentModelUrl: string | null = null
  let fallbackShown = false
  let fallbackEl: HTMLDivElement | null = null
  // 模型基础尺寸（scale=1 时捕获一次；Pixi Container.width 含当前 scale，
  // 若每次 fit 都现读会按 1/s0 累积误差导致越放越大被画布裁剪）
  let baseModelW = 0
  let baseModelH = 0
  // 尺寸变更合并：SSE 连发时只落地最后一档，避免主线程串行多次 WebGL resize（实测单次可达数秒）
  let pendingSize: number | null = null
  let sizeRaf = 0
  let lastTapAt = 0
  /** 各部位自定义台词（part.lines）上一次抽中的句子，按 part.id 记录（部位间互不干扰，spec §4）。 */
  const lastPartLine = new Map<string, string>()
  /** 各事件阶段上一次抽中的台词（key = 状态 + 阶段下标，避开连抽同一句，spec §3）。 */
  const lastEventLine = new Map<string, string>()
  /** 互动动作世代：新互动或新非 idle 状态动作会作废上一次互动的恢复回调。 */
  let interactionGen = 0
  /** 动作启动世代：任何新动作都会使异步 fallback/旧启动失效，避免被 stopAllMotions 打断后继续启动。 */
  let motionSeq = 0
  /** 是否正在播放互动动作（motionFinish 后据此恢复当前状态动作）。 */
  let interactionActive = false
  /** 是否抑制鼠标跟随：非 idle 动作播放期间为 true（spec §4）。 */
  let focusSuppressed = false
  /** 最近一次全局 pointermove 的 client 坐标；动作结束后用于立即恢复跟随。 */
  let lastPointerClient: { x: number; y: number } | null = null
  /** 当前模型 motionManager 的 motionFinish 解绑函数（模型重载/卸载时清理）。 */
  let detachMotionFinish: (() => void) | null = null
  let bubbleHideTimer: number | undefined
  /** 气泡最长可见计时器：从「隐藏 → 可见」那一刻起算，替换文案不重置（ADR-027）。 */
  let bubbleMaxTimer: number | undefined
  let bubbleMaxMs = BUBBLE_MAX_DEFAULT * 1000
  /** 气泡当前是否可见（用于判断一次新的显示是否要重新起算最长时长）。 */
  let bubbleVisible = false
  /** 长状态的 AI 演绎计时器（入态延迟 + 间隔重试，ADR-026）。 */
  let longAiTimers: number[] = []
  /** 当前长状态（thinking/waiting）；非空时气泡常驻。 */
  let longState: LongState | null = null
  /** 长状态常驻气泡的底稿：入态台词，AI 演绎成功后换成 AI 那句。 */
  let bubbleStickyText: string | null = null
  let lastState: PetState | null = null
  let demoState: PetState | null = null
  let view: PetStateView | null = null
  let pos: DisplayLike = { right: 24, bottom: 20, size: 240 }
  // 画布每侧留白百分比（SSE config.canvasPadX/Y；0–300，默认 125/50；spec §7）
  let canvasPadXPct = DEFAULT_CANVAS_PAD_X
  let canvasPadYPct = DEFAULT_CANVAS_PAD_Y
  // 表情：挂在事件绑定/触摸部位上（motions 混选里的表情 id，可叠加）+ 触摸临时表情（spec §5）
  let tempExpressions: string[] = []
  let tempExpressionUntil = 0
  /** 调试面板「表情预览」强制显示的表情（null = 不干预）。 */
  let debugExpression: string | null = null
  let repaintDebugExpressions: (() => void) | null = null
  /** 表达式开关参数当前混合值（每帧向目标逼近 → 淡入淡出）。 */
  const expressionMix = new Map<string, number>()
  /** AI 回复开关（SSE config.aiEnabled；ADR-025）：开启后触摸/状态台词改由 Host 调 LLM 生成。 */
  let aiEnabled = false
  /** 仅触摸（SSE config.aiTouchOnly）：开启后状态气泡只用预置台词，AI 只在触摸时发言。 */
  let aiTouchOnly = false
  /**
   * 全 AI 接管（SSE config.aiTakeover；ADR-031）：不显示任何预置对白，气泡内容全部来自模型；
   * 长状态的「延迟」失效——入态立刻请求一句，之后仍按间隔/上限反复演绎。
   */
  let aiTakeover = false
  /** 说话时的身体语言（点头/挑眉）开关，与口型跟随一起生效。 */
  let bodyLanguageEnabled = true
  /** 待机小动作开关（设置页「待机小动作」）。 */
  let idleMotionEnabled: boolean = DEFAULT_SETTINGS.idleMotionEnabled
  let idleMicroTimer: number | null = null
  /** 语音合成开关（SSE config.ttsEnabled；ADR-033）：开启后走 /speak 流式管线（气泡与语音同步）。 */
  let ttsEnabled: boolean = DEFAULT_SETTINGS.ttsEnabled
  /** 口型跟随开关（SSE config.lipsyncEnabled）：按正在播放的音频能量驱动 ParamMouthOpenY。 */
  let lipsyncEnabled: boolean = DEFAULT_SETTINGS.lipsyncEnabled
  /** 口型强度百分比（0–300，100 = 标准）。 */
  let lipsyncGain: number = DEFAULT_SETTINGS.lipsyncGain
  /** 打断优先级（ADR-032）：触摸互动与状态事件抢气泡/动作/AI 演绎时的规则。 */
  let interactionMode: InteractionMode = DEFAULT_INTERACTION_MODE
  /** 交互条（模型上下的静音按钮 + 对话输入框）位置与 DOM。 */
  let barPosition: BarPosition = DEFAULT_BAR_POSITION
  let barOffset = DEFAULT_BAR_OFFSET
  let barEl: HTMLDivElement | null = null
  let barMuteEl: HTMLButtonElement | null = null
  let barInputEl: HTMLInputElement | null = null
  let barSendEl: HTMLButtonElement | null = null
  /** 交互条尺寸缓存（只在内容/位置变化时重新测量，避免每帧读布局）。 */
  let barW = 0
  let barH = 0
  let barKey = ''
  /** 触摸互动保持窗口的截止时间戳；窗口内状态事件按优先级决定是否接管。 */
  let tapHoldUntil = 0
  let tapResumeTimer: number | undefined
  /** 长状态 AI 演绎节奏（SSE config.*AiDelay/Interval/Max，秒/秒/次；ADR-026）。 */
  let thinkingAiDelay = 3
  let thinkingAiInterval = 20
  let thinkingAiMax = 3
  let waitingAiDelay = 4
  let waitingAiInterval = 30
  let waitingAiMax = 3
  /** AI 回复请求序号：只采用最后一次请求的结果，避免连点时旧回复覆盖新回复。 */
  let aiRequestSeq = 0
  /** 上一次真正发出的 AI 请求时间戳（与 Host 冷却同源，避免发出注定被拒的请求）。 */
  let lastAiRequestAt = 0
  /** 冷却期内被挡下的点击：到点再补一次，让「点快了」不至于白点。 */
  let pendingTap: { part: string; hint?: string } | null = null
  let pendingTapTimer: number | undefined
  /** AI 台词的最短可见时间截止点：其间状态/预置台词先排队，避免「刚到就被状态切走」。 */
  let aiTextUntil = 0
  /** 被 AI 台词短暂压住的预置台词（等 AI 台词显示够久再换上）。 */
  let pendingBubbleText: string | null = null
  let pendingBubbleTimer: number | undefined
  // 气泡偏移（相对模型包围盒顶部中心，px）与背景/文字样式（SSE config.bubble*；spec §3）
  let bubbleOffsetX = DEFAULT_BUBBLE_OFFSET_X
  let bubbleOffsetY = DEFAULT_BUBBLE_OFFSET_Y
  let bubbleBgColor = DEFAULT_BUBBLE_BG_COLOR
  let bubbleBgOpacity = DEFAULT_BUBBLE_BG_OPACITY
  let bubbleTextColor = DEFAULT_BUBBLE_TEXT_COLOR
  /** 首次启动是否已套用配置默认中心位置（displaySaved=false 时只套用并回写一次，spec §2）。 */
  let homeApplied = false
  // 帧率档（settings maxFps → ticker.maxFPS；0 = 不限制）
  let maxFps = DEFAULT_MAX_FPS
  // 渲染开关：插件 enabled（配置）与页面可见性（spec §7）共同决定 ticker 是否运行
  let enabled = true
  let hidden = document.visibilityState !== 'visible'

  /** 宠物是否应可见/渲染：插件开启，或设置页正在编辑触摸部位（编辑态强制显示，spec §4）。 */
  function petShown(): boolean {
    return enabled || editState !== null
  }

  /** 合并 enabled/编辑态/隐藏/失焦状态，启停渲染循环（spec §7：暂停渲染保留最后画面）。 */
  function syncTicker(): void {
    if (!app) return
    const shouldRun = petShown() && !hidden
    if (shouldRun) { try { app.ticker.start() } catch { /* 已启动 */ } }
    else { try { app.ticker.stop() } catch { /* 已停止 */ } }
  }

  /** 按 enabled / 编辑态同步宠物容器显隐（编辑态即使插件关闭也强制显示）。 */
  function syncPetVisibility(): void {
    if (box) box.style.display = petShown() ? '' : 'none'
    syncTicker()
    // 隐藏时不跑浮层逐帧更新（盒容器也一起 display:none）
    syncOverlayLoop()
  }

  /** 应用渲染帧率上限（spec §2/§7；0 = PIXI 不设上限）。 */
  function applyMaxFps(next: number): void {
    maxFps = normalizeMaxFps(next)
    if (!app?.ticker) return
    try { app.ticker.maxFPS = maxFps } catch { /* 旧 ticker */ }
  }

  function clearBubbleHideTimer(): void {
    if (bubbleHideTimer !== undefined) {
      window.clearTimeout(bubbleHideTimer)
      bubbleHideTimer = undefined
    }
  }

  function clearBubbleMaxTimer(): void {
    if (bubbleMaxTimer !== undefined) {
      window.clearTimeout(bubbleMaxTimer)
      bubbleMaxTimer = undefined
    }
  }

  /**
   * 气泡最长可见时长（ADR-027）：出态事件丢失时长状态会永久常驻，这里做兜底。
   * 从「隐藏 → 可见」起算，替换文案不重置；到时连常驻底稿与 AI 演绎一起收掉。
   */
  function armBubbleMaxTimer(): void {
    if (bubbleMaxMs <= 0) { clearBubbleMaxTimer(); return }
    if (bubbleMaxTimer !== undefined) return
    bubbleMaxTimer = window.setTimeout(() => {
      bubbleMaxTimer = undefined
      bubbleVisible = false
      // 长状态的出态事件可能没送到：气泡不能永远挂着，顺手停掉 AI 演绎，避免继续烧 token
      clearLongState()
      if (pendingBubbleTimer !== undefined) {
        window.clearTimeout(pendingBubbleTimer)
        pendingBubbleTimer = undefined
      }
      pendingBubbleText = null
      aiTextUntil = 0
      clearBubbleHideTimer()
      if (bubble) bubble.style.opacity = '0'
    }, bubbleMaxMs)
  }

  /** 应用「气泡最长显示」配置（秒；0 = 不限）；非法值保留当前值。 */
  function applyBubbleMaxConfig(cfg: Partial<PetStateView['config']>): void {
    const raw = cfg.bubbleMaxSeconds
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      const next = Math.round(Math.min(600, Math.max(0, raw)))
      if (next !== bubbleMaxMs / 1000) {
        bubbleMaxMs = next * 1000
        if (bubbleVisible) { clearBubbleMaxTimer(); armBubbleMaxTimer() }
      }
    }
  }

  /** 上一次写入气泡的样式签名：配置没变就不重复写（SSE 每条推送都会走到这里）。 */
  let bubbleStyleKey = ''

  /** 应用气泡样式（背景 rgba / 文字色 / 最大宽度；不重建元素，spec §3）。 */
  function applyBubbleStyle(): void {
    if (!bubble) return
    const maxWidth = Math.max(80, Math.min(320, window.innerWidth - 24))
    const key = `${bubbleBgColor}|${bubbleBgOpacity}|${bubbleTextColor}|${maxWidth}`
    if (key === bubbleStyleKey) return
    bubbleStyleKey = key
    bubble.style.background = colorWithOpacity(bubbleBgColor, bubbleBgOpacity)
    bubble.style.color = bubbleTextColor
    // 长文本换行且不超出屏幕（左右各留 12px）
    bubble.style.maxWidth = `${maxWidth}px`
  }

  /**
   * 气泡相对模型包围盒定位（spec §3）：气泡底部中点贴住
   * (bounds.x + width/2 + bubbleOffsetX, bounds.y - bubbleOffsetY)（画布逻辑 CSS px；
   * bubbleOffsetY 正值向上、负值向下），transform: translate(-50%, -100%) 由样式居中/贴底。
   * 调试面板可见时锚点上移到面板顶部再往上 6px；目标视口 y clamp 到 ≥8，避免跑出视口。
   */
  function updateBubblePosition(boundsArg?: { x: number; y: number; width: number; height: number } | null): void {
    if (!bubble) return
    if (!petLayer || bubble.parentNode !== petLayer) {
      // 无模型层（静态头像降级）时退回容器上方居中
      bubble.style.left = '50%'
      bubble.style.top = '0px'
      return
    }
    const bounds = boundsArg === undefined ? modelBounds() : boundsArg
    if (!bounds) return
    const anchorX = bounds.x + bounds.width / 2 + bubbleOffsetX
    // 调试面板可见时气泡上移避让：锚点 = 面板顶部再往上 6px（spec §2）
    let anchorY = Number.isFinite(debugPanelTopLogical)
      ? debugPanelTopLogical - 6
      : bounds.y - bubbleOffsetY
    // 气泡目标视口 y clamp 到 ≥8（用缓存的 petLayer 视口 rect 换算，面板/模型贴顶时不跑出视口）
    const rect = layerRect()
    if (rect && rect.top + anchorY < 8) anchorY = 8 - rect.top
    bubble.style.left = `${anchorX}px`
    bubble.style.top = `${anchorY}px`
  }

  // ---- 交互条（静音 + 对话输入） ----

  /** 建交互条：圆形静音按钮 + 胶囊输入框，整体贴在模型上方或下方。 */
  function buildBar(): void {
    if (!petLayer || barEl) return
    const bar = document.createElement('div')
    Object.assign(bar.style, {
      position: 'absolute',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 4px 4px 4px',
      borderRadius: '999px',
      background: 'rgba(24,26,34,.82)',
      border: '1px solid rgba(255,255,255,.16)',
      boxShadow: '0 6px 18px rgba(0,0,0,.28)',
      backdropFilter: 'blur(6px)',
      pointerEvents: 'auto',
      zIndex: '4',
      opacity: '0',
      transition: 'opacity .18s ease',
    })
    const mute = document.createElement('button')
    mute.type = 'button'
    mute.title = '静音 / 取消静音'
    Object.assign(mute.style, {
      width: '26px',
      height: '26px',
      flex: '0 0 auto',
      display: 'grid',
      placeItems: 'center',
      borderRadius: '50%',
      border: 'none',
      background: 'rgba(255,255,255,.10)',
      color: '#e8edf7',
      fontSize: '13px',
      lineHeight: '1',
      cursor: 'pointer',
      padding: '0',
    })
    mute.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      void toggleMute()
    })
    const send = document.createElement('button')
    send.type = 'button'
    send.title = '发送'
    send.setAttribute('aria-label', '发送')
    Object.assign(send.style, {
      width: '26px',
      height: '26px',
      flex: '0 0 auto',
      display: 'grid',
      placeItems: 'center',
      borderRadius: '50%',
      border: 'none',
      background: 'rgba(120,170,255,.22)',
      color: '#e8edf7',
      cursor: 'pointer',
      padding: '0',
      transition: 'background .15s ease, opacity .15s ease',
    })
    send.innerHTML = ICON_SEND
    send.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      void sendChat()
    })
    const input = document.createElement('input')
    input.type = 'text'
    input.maxLength = 200
    input.placeholder = '跟我说句话…'
    input.setAttribute('aria-label', '和角色说话')
    Object.assign(input.style, {
      width: '150px',
      background: 'transparent',
      border: 'none',
      outline: 'none',
      color: '#eef2f8',
      fontSize: '12px',
      padding: '0 6px',
      fontFamily: 'inherit',
    })
    input.addEventListener('keydown', (event) => {
      // 输入框里的按键不和页面快捷键抢：整段冒泡都拦下来
      event.stopPropagation()
      if (event.key !== 'Enter' || event.isComposing) return
      event.preventDefault()
      void sendChat()
    })
    // 拖拽/点击判定只认命中层，交互条上的指针事件不要穿到宠物逻辑
    bar.addEventListener('pointerdown', (event) => event.stopPropagation())
    // 输入为空时提交按钮置灰（但仍可点击：留给「点一下聚焦」的机会）
    input.addEventListener('input', syncSendState)
    bar.append(mute, input, send)
    petLayer.appendChild(bar)
    barEl = bar
    barMuteEl = mute
    barInputEl = input
    barSendEl = send
    barW = 0
    barH = 0
    barKey = ''
    syncBarVisual()
    window.requestAnimationFrame(() => {
      bar.style.opacity = '1'
    })
    syncOverlayLoop()
  }

  /** 按当前语音/AI 开关刷新交互条外观（静音图标、禁用态）。 */
  function syncBarVisual(): void {
    if (!barMuteEl || !barInputEl) return
    const muted = !ttsEnabled
    barMuteEl.innerHTML = muted ? ICON_SPEAKER_OFF : ICON_SPEAKER_ON
    barMuteEl.setAttribute('aria-pressed', muted ? 'true' : 'false')
    barMuteEl.title = muted ? '取消静音' : '静音'
    const canChat = aiEnabled
    barInputEl.disabled = !canChat
    barInputEl.placeholder = canChat ? '跟我说句话…' : 'AI 回复未开启'
    barInputEl.style.opacity = canChat ? '1' : '.45'
    syncSendState()
    // 文案/宽度变了，下一帧重新测量
    barW = 0
    barH = 0
    barKey = ''
  }

  /**
   * 发送按钮的可点击状态：只有「AI 开着 + 输入框非空」才算真正可发送。
   * 空输入不硬禁用（点一下能把光标放进输入框），但用 `aria-disabled` 与灰态说清楚它不会发。
   */
  function syncSendState(): void {
    if (!barSendEl || !barInputEl) return
    const hasText = barInputEl.value.trim().length > 0
    const canSend = aiEnabled && hasText
    // 硬禁用只在 AI 关闭时：那时连输入框都是 disabled
    barSendEl.disabled = !aiEnabled
    barSendEl.setAttribute('aria-disabled', canSend ? 'false' : 'true')
    barSendEl.title = !aiEnabled ? 'AI 回复未开启' : hasText ? '发送' : '先输入内容'
    barSendEl.style.opacity = canSend ? '1' : '.4'
    barSendEl.style.background = canSend ? 'rgba(120,170,255,.42)' : 'rgba(255,255,255,.10)'
    barSendEl.style.cursor = canSend ? 'pointer' : 'default'
  }

  /** 静音按钮：直接改设置里的 `ttsEnabled`（持久化，其它端也同步）。 */
  async function toggleMute(): Promise<void> {
    const next = !ttsEnabled
    ttsEnabled = next
    syncBarVisual()
    try {
      await fetch(`${PET_API}/settings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ops: [{ op: 'set', path: ['ttsEnabled'], value: next }] }),
      })
    } catch {
      // 写失败不弹错：SSE 回来的真实配置会把状态纠回去
    }
  }

  /** 交互条输入框回车：把这句话交给模型（人设 + 场景 + 历史），回复照常走气泡/语音。 */
  async function sendChat(): Promise<void> {
    const input = barInputEl
    if (!input) return
    const text = input.value.trim()
    if (text.length === 0) {
      // 空输入点提交：当成「把光标放进输入框」，不打扰模型
      input.focus()
      syncSendState()
      return
    }
    if (!aiEnabled) return
    input.value = ''
    syncSendState()
    if (ttsEnabled) ensureAudio()
    await requestSpeak({ kind: 'chat', text })
  }

  /** 交互条定位：贴模型包围盒上方或下方居中（视口内横向夹取）。 */
  function updateBarPosition(boundsArg?: { x: number; y: number; width: number; height: number } | null): void {
    if (!barEl || !petLayer) return
    // 「不显示」档：整条收起来，别占位置也别留残影
    if (barPosition === 'hidden') {
      barEl.style.display = 'none'
      barKey = ''
      return
    }
    barEl.style.display = 'flex'
    const bounds = boundsArg === undefined ? modelBounds() : boundsArg
    if (!bounds) return
    if (barW === 0 || barH === 0) {
      barW = barEl.offsetWidth
      barH = barEl.offsetHeight
    }
    const rect = layerRect()
    const viewportW = window.innerWidth || document.documentElement.clientWidth
    let left = bounds.x + bounds.width / 2 - barW / 2
    const layerLeft = rect ? rect.left : 0
    // 别跑出视口左边/右边
    left = Math.max(left, 8 - layerLeft)
    left = Math.min(left, viewportW - 8 - barW - layerLeft)
    // 偏移：正数往「远离模型」的方向推，负数可以压住模型边缘
    const top = barPosition === 'top'
      ? bounds.y - barH - 8 - barOffset
      : bounds.y + bounds.height + 8 + barOffset
    barEl.style.left = `${Math.round(left)}px`
    barEl.style.top = `${Math.round(top)}px`
  }

  /** 显示常驻气泡文案：取消瞬态隐藏计时，气泡保持可见直到被取代。 */
  function setBubbleText(text: string): void {
    if (!bubble) return
    clearBubbleHideTimer()
    bubble.textContent = stripLeadingTagText(stripTimestamps(text))
    bubble.style.opacity = '1'
    if (!bubbleVisible) {
      bubbleVisible = true
      armBubbleMaxTimer()
    }
    updateBubblePosition()
  }

  /** 取事件某阶段的台词池：index 越界用最后一组；无台词 → 空数组（不回退固定人设）。 */
  function eventLinesFor(state: PetState, index: number): string[] {
    const pools = eventBindings[state]?.lines ?? []
    if (pools.length === 0) return []
    return pools[Math.min(index, pools.length - 1)] ?? []
  }

  /** 随机取事件某阶段的一句台词（避开该阶段上一条，spec §3）；无台词返回 undefined。 */
  function pickEventLine(state: PetState, index: number): string | undefined {
    const pool = eventLinesFor(state, index)
    if (pool.length === 0) return undefined
    const key = `${state}\u0000${index}`
    const line = pickLine(pool, lastEventLine.get(key))
    if (line !== undefined) lastEventLine.set(key, line)
    return line
  }

  /** 隐藏气泡并取消瞬态隐藏计时（事件台词池为空时不显示气泡，spec §3）。 */
  function hideBubble(): void {
    clearBubbleHideTimer()
    clearBubbleMaxTimer()
    bubbleVisible = false
    if (bubble) bubble.style.opacity = '0'
  }

  /** 重绘长状态的常驻气泡（瞬态气泡到时回落/事件绑定变化或拖拽结束后恢复）。 */
  function showStickyText(): void {
    if (longState === null) return
    if (bubbleStickyText === null) { hideBubble(); return }
    // 走 showBubble：常驻底稿同样要给 AI 台词让出最短可见时间
    showBubble(bubbleStickyText)
  }

  /**
   * 瞬态气泡（交互/短状态，spec §3/§4）：立刻换文案并重置隐藏计时（连点可打断）；
   * 到时隐藏——若正处于阶段演进状态则回落到当前阶段文案（交互短暂抢占常驻气泡，过后归还）。
   */
  function showBubble(text: string): void {
    if (!bubble) return
    // AI 台词刚上来、还没看够就被状态切换顶掉（状态变化比模型出字快）：先排队，
    // 等它的最短可见时间结束后再换；排队期间再有预置台词就只留最后一条。
    const now = Date.now()
    if (now < aiTextUntil) {
      pendingBubbleText = text
      if (pendingBubbleTimer !== undefined) return
      pendingBubbleTimer = window.setTimeout(() => {
        pendingBubbleTimer = undefined
        const next = pendingBubbleText
        pendingBubbleText = null
        if (next !== null) showBubble(next)
      }, aiTextUntil - now)
      return
    }
    showBubbleNow(text)
  }

  /** 立刻替换气泡文案（不经 AI 排队），到时隐藏并回落到阶段文案。 */
  function showBubbleNow(text: string): void {
    if (!bubble) return
    clearBubbleHideTimer()
    setBubbleText(text)
    bubbleHideTimer = window.setTimeout(() => {
      bubbleHideTimer = undefined
      if (longState !== null) showStickyText()
      else {
        bubbleVisible = false
        clearBubbleMaxTimer()
        if (bubble) bubble.style.opacity = '0'
      }
    }, BUBBLE_DISPLAY_MS)
  }

  /** AI 台词上屏：比预置台词多留一点时间，并在这段时间内挡住后面的状态切换。 */
  function showAiBubble(text: string): void {
    if (!bubble) return
    aiTextUntil = Date.now() + AI_BUBBLE_HOLD_MS
    if (pendingBubbleTimer !== undefined) {
      window.clearTimeout(pendingBubbleTimer)
      pendingBubbleTimer = undefined
    }
    pendingBubbleText = null
    showBubbleNow(text)
  }

  // ---- 语音与口型（ADR-033）----
  /** 音频上下文（首次用户手势后才创建，遵守浏览器自动播放策略）。 */
  let audioCtx: AudioContext | null = null
  /** 口型分析器：每段音频接到它上面，按波形 RMS 驱动张嘴。 */
  let lipsyncAnalyser: AnalyserNode | null = null
  let lipsyncData: Uint8Array | null = null
  /** 当前口型开合（0–1，已按 lipsyncGain 缩放）。 */
  let mouthLevel = 0
  /** 本轮演绎的中止器与序号（新的一轮直接作废旧一轮）。 */
  let speakAbort: AbortController | null = null
  let speakSeq = 0
  /** 本轮已经下发的句读（气泡按音频进度逐段显示）。 */
  let speakClauses: { index: number; text: string }[] = []
  /** 已经显示到第几段（-1 = 还没显示）。 */
  let speakRevealed = -1
  /** 音频播放串行链：保证第 0 段播完才播第 1 段。 */
  let speakChain: Promise<void> = Promise.resolve()

  /** 懒创建 AudioContext + 分析器；被浏览器挂起时顺手恢复。 */
  function ensureAudio(): AudioContext | null {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') void audioCtx.resume()
      return audioCtx
    }
    try {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      audioCtx = new Ctor()
      lipsyncAnalyser = audioCtx.createAnalyser()
      lipsyncAnalyser.fftSize = 1024
      lipsyncAnalyser.smoothingTimeConstant = 0.55
      lipsyncData = new Uint8Array(new ArrayBuffer(lipsyncAnalyser.fftSize))
    } catch {
      audioCtx = null
    }
    return audioCtx
  }

  /** 中止当前演绎（新触摸/状态切换/卸载时调用）。 */
  function stopSpeaking(): void {
    if (speakAbort !== null) {
      try { speakAbort.abort() } catch { /* 已结束 */ }
      speakAbort = null
    }
    speakClauses = []
    speakRevealed = -1
    mouthLevel = 0
  }

  /** 解码并播放一段音频（mp3 整段解码 → 播放 → 结束回调）。 */
  function playClip(base64: string, _mime: string): Promise<void> {
    const ctx = ensureAudio()
    const analyser = lipsyncAnalyser
    if (!ctx || !analyser) return Promise.resolve()
    const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0))
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    return new Promise<void>((resolve) => {
      const finish = () => { try { analyser.disconnect() } catch { /* 已断开 */ } resolve() }
      ctx.decodeAudioData(buffer, (decoded) => {
        try {
          const source = ctx.createBufferSource()
          source.buffer = decoded
          source.connect(analyser)
          analyser.connect(ctx.destination)
          source.onended = finish
          source.start()
        } catch {
          finish()
        }
      }, () => resolve())
    })
  }

  /** 把气泡文字补到第 `index` 段（含被跳过的段：合成失败也不能丢字）。 */
  function revealClausesUntil(index: number): void {
    if (index <= speakRevealed) return
    const visible = speakClauses.filter((item) => item.index <= index).map((item) => item.text).join('')
    if (!visible) return
    speakRevealed = index
    showBubbleNow(visible)
  }

  function revealAllClauses(): void {
    const last = speakClauses.length - 1
    if (last >= 0) revealClausesUntil(speakClauses[last]!.index)
  }

  /** 退出长状态：取消演绎计时、清掉常驻底稿。 */
  function clearLongState(): void {
    for (const t of longAiTimers) window.clearTimeout(t)
    longAiTimers = []
    longState = null
    bubbleStickyText = null
  }

  /** 距离下次允许发 AI 请求还有多久（ms）。 */
  function aiCooldownLeft(): number {
    const left = AI_REQUEST_COOLDOWN_MS - (Date.now() - lastAiRequestAt)
    return left > 0 ? left : 0
  }

  /** 冷却期内的点击：记下最后一下，等冷却结束补发（新的点击覆盖旧的）。 */
  function deferTapRequest(input: { part: string; hint?: string }, delay: number): void {
    pendingTap = input
    if (pendingTapTimer !== undefined) window.clearTimeout(pendingTapTimer)
    pendingTapTimer = window.setTimeout(() => {
      pendingTapTimer = undefined
      const next = pendingTap
      pendingTap = null
      if (!next || disposed) return
      void requestSpeak({ kind: 'tap', part: next.part, hint: next.hint })
    }, delay + 30)
  }

  function clearPendingTap(): void {
    pendingTap = null
    if (pendingTapTimer !== undefined) {
      window.clearTimeout(pendingTapTimer)
      pendingTapTimer = undefined
    }
  }

  /** 触摸是否还处于「保持窗口」内（窗口内由 interactionMode 决定谁优先）。 */
  function tapActive(): boolean {
    return Date.now() < tapHoldUntil
  }

  /** 结束触摸保持窗口（事件优先/互相打断里由状态变化调用）。 */
  function clearTapHold(): void {
    tapHoldUntil = 0
    if (tapResumeTimer !== undefined) {
      window.clearTimeout(tapResumeTimer)
      tapResumeTimer = undefined
    }
  }

  /**
   * 触摸接管（ADR-032）：进入保持窗口；非「事件优先」时立刻停掉长状态的演绎计时与
   * 常驻底稿，让触摸台词/AI 台词拥有气泡；窗口结束后若长状态仍在，再把演绎交还。
   */
  function beginTapHold(): void {
    tapHoldUntil = Date.now() + TAP_INTERACTION_HOLD_MS
    if (tapResumeTimer !== undefined) window.clearTimeout(tapResumeTimer)
    if (interactionMode !== 'event-first' && longState !== null) {
      for (const t of longAiTimers) window.clearTimeout(t)
      longAiTimers = []
      bubbleStickyText = null
    }
    tapResumeTimer = window.setTimeout(() => {
      tapResumeTimer = undefined
      if (interactionMode === 'event-first') return
      if (longState !== null && longState === lastState) {
        enterLongState(longState, pickEventLine(longState, 0))
      }
    }, TAP_INTERACTION_HOLD_MS)
  }

  /** 读取长状态 AI 节奏配置（缺省/非法值保留当前值）。 */
  function applyLongAiConfig(cfg: Partial<PetStateView['config']>): void {
    const num = (value: unknown, fallback: number): number =>
      typeof value === 'number' && Number.isFinite(value) ? value : fallback
    thinkingAiDelay = num(cfg.thinkingAiDelay, thinkingAiDelay)
    thinkingAiInterval = num(cfg.thinkingAiInterval, thinkingAiInterval)
    thinkingAiMax = num(cfg.thinkingAiMax, thinkingAiMax)
    waitingAiDelay = num(cfg.waitingAiDelay, waitingAiDelay)
    waitingAiInterval = num(cfg.waitingAiInterval, waitingAiInterval)
    waitingAiMax = num(cfg.waitingAiMax, waitingAiMax)
  }

  /** 长状态的 AI 演绎节奏（秒 → ms）；取自 SSE config，越界值按默认兜底。 */
  function longAiCadence(state: LongState): { delay: number; interval: number; max: number } {
    const delay = state === 'thinking' ? thinkingAiDelay : waitingAiDelay
    const interval = state === 'thinking' ? thinkingAiInterval : waitingAiInterval
    const max = state === 'thinking' ? thinkingAiMax : waitingAiMax
    return {
      delay: Math.max(0, delay),
      interval: Math.max(1, interval),
      max: Math.max(0, Math.round(max)),
    }
  }

  /**
   * 进入长状态（ADR-026）：入态台词常驻，之后按设置节奏让 AI 反复演绎同一状态——
   * 第一次等 `delay` 秒，之后每 `interval` 秒一次，最多 `max` 次；出态即停。
   */
  function enterLongState(state: LongState, hint: string | undefined): void {
    clearLongState()
    longState = state
    // 全 AI 接管：预置对白整段不出（连常驻底稿也留空），气泡只等模型那句。
    // 例外：开了「仅触摸」时状态事件根本不会问模型（下面直接 return），死守接管等于让状态彻底哑掉，
    // 所以此时固定台词照旧显示（ADR-031 修订）。
    const takeover = aiTakeover && aiEnabled && !aiTouchOnly
    bubbleStickyText = takeover ? null : hint ?? null
    if (bubbleStickyText === null) hideBubble()
    else showStickyText()
    if (!aiEnabled || aiTouchOnly) return
    const cadence = longAiCadence(state)
    if (cadence.max <= 0) return
    let attempts = 0
    const tick = (): void => {
      if (longState !== state) return
      attempts += 1
      void requestSpeak({ kind: 'state', state, hint: takeover ? undefined : hint }, { sticky: true })
      if (attempts < cadence.max) {
        longAiTimers.push(window.setTimeout(tick, cadence.interval * 1000))
      }
    }
    // 接管模式下「延迟」不生效：入态立刻问模型（设置页对应输入框会置灰）
    longAiTimers.push(window.setTimeout(tick, takeover ? 0 : cadence.delay * 1000))
  }

  /** canvas 的视口 rect 缓存：pointermove 每次都要用，不能每次读布局。 */
  let canvasRectCache: DOMRect | null = null

  /** 按 client 坐标应用鼠标跟随（model.focus 吃 canvas 本地坐标）。 */
  function applyFocus(clientX: number, clientY: number): void {
    if (!model || !canvas) return
    if (!canvasRectCache) {
      try { canvasRectCache = canvas.getBoundingClientRect() } catch { return }
    }
    model.focus(clientX - canvasRectCache.left, clientY - canvasRectCache.top)
  }

  /** 解除非 idle 动作期间的 focus 抑制；若有最近指针位置则立即恢复跟随。 */
  function releaseFocusSuppression(): void {
    if (!focusSuppressed) return
    focusSuppressed = false
    if (model && lastPointerClient && !dragging && enabled && !hidden) {
      applyFocus(lastPointerClient.x, lastPointerClient.y)
    }
  }

  /**
   * 按候选动作链启动动作，统一处理优先级、重播前 stopAllMotions、布尔返回值 fallback。
   * - idle 用 IDLE 优先级；状态/互动用 FORCE（NORMAL 不能打断 NORMAL，无法满足状态立即切换）。
   * - 非 idle 动作启动时抑制 focus，并等 motionFinish 真正播完后再恢复。
   */
  async function startMotionWithPriority(
    names: readonly string[],
    priority: MotionPriority,
    options: { suppressFocus: boolean; isInteraction: boolean },
  ): Promise<boolean> {
    if (!model || names.length === 0) return false
    const seq = ++motionSeq
    const currentModel = model
    previewActive = false
    if (options.suppressFocus) {
      focusSuppressed = true
      currentModel.internalModel?.focusController?.focus(0, 0, true)
    } else {
      releaseFocusSuppression()
    }
    if (options.isInteraction) interactionActive = true
    // 重播同一动作前必须清 MotionState；否则库会因“同 group+index 已激活”拒绝启动。
    currentModel.internalModel?.motionManager?.stopAllMotions?.()
    for (const name of names) {
      if (seq !== motionSeq || !model) return false
      try {
        const ok = await model.motion(name, undefined, priority)
        if (seq !== motionSeq || !model) return false
        if (ok) return true
      } catch {
        if (seq !== motionSeq || !model) return false
        // 单个候选失败/返回 false 时继续尝试下一个
      }
    }
    // 全部候选都失败：清理本次的互动/焦点标记（若期间已被新动作取代则不动）。
    if (seq === motionSeq) {
      if (options.isInteraction) interactionActive = false
      if (options.suppressFocus) releaseFocusSuppression()
    }
    return false
  }

  /**
   * 播放状态动作：取该事件绑定的动作组随机打乱后逐个尝试；空数组 → 不播动作（spec §3）。
   * 状态动作会取代正在播放的互动/旧状态动作。
   */
  function playState(state: PetState): void {
    if (!model) return
    const motion = splitMotionSelection(eventBindings[state]?.motions ?? []).motion
    if (!motion) return
    const names = [motion]
    interactionGen += 1
    interactionActive = false
    const priority = state === 'idle' ? MotionPriority.IDLE : MotionPriority.FORCE
    void startMotionWithPriority(names, priority, { suppressFocus: state !== 'idle', isInteraction: false })
  }

  /** 待机小动作调度：一次只挂一个 setTimeout（不轮询、空闲无开销），
   * 触发时只有「确实是 idle、没在互动/预览、页面可见」才播，否则延后重试。 */
  function clearIdleMicro(): void {
    if (idleMicroTimer !== null) {
      window.clearTimeout(idleMicroTimer)
      idleMicroTimer = null
    }
  }

  function scheduleIdleMicro(delay?: number): void {
    clearIdleMicro()
    if (!idleMotionEnabled || !model) return
    const ms = delay ?? IDLE_MICRO_MIN_MS + Math.random() * (IDLE_MICRO_MAX_MS - IDLE_MICRO_MIN_MS)
    idleMicroTimer = window.setTimeout(() => {
      idleMicroTimer = null
      playIdleMicro()
    }, ms)
  }

  function playIdleMicro(): void {
    if (!model || !idleMotionEnabled) return
    const busy = previewActive || tapActive() || longState !== null || interactionActive
    if (busy || lastState !== 'idle' || document.visibilityState === 'hidden') {
      scheduleIdleMicro(IDLE_MICRO_RETRY_MS)
      return
    }
    const name = IDLE_MICRO_MOTIONS[Math.floor(Math.random() * IDLE_MICRO_MOTIONS.length)]
    // isInteraction=true 让 motionFinish 后自动回到当前状态动作（Idle 循环）；
    // suppressFocus=true 避免鼠标跟随与微动作抢同一批头部参数。
    void startMotionWithPriority([name], MotionPriority.IDLE, { suppressFocus: true, isInteraction: true })
    scheduleIdleMicro()
  }

  /** MotionManager.motionFinish：动作真正播完。互动结束后恢复当前状态动作并解除 focus 抑制。
   * 注意该事件在库内部 state.complete()/自动回 idle 之前同步触发，恢复动作需延到微任务，
   * 避免在 MotionManager.update 中间重入修改 MotionState。 */
  function handleMotionFinish(): void {
    const wasPreview = previewActive
    previewActive = false
    const wasInteraction = interactionActive
    const gen = interactionGen
    const seq = motionSeq
    interactionActive = false
    queueMicrotask(() => {
      // 若期间已有新动作启动（motionSeq 变化），由新动作接管焦点/恢复，这里不再处理
      if (seq !== motionSeq) return
      releaseFocusSuppression()
      // debug 原生预览结束后只恢复 focus，不触发状态动作恢复
      if (wasPreview) return
      if (wasInteraction && gen === interactionGen && !interactionActive && lastState) {
        playState(lastState)
      }
    })
  }

  /** 上一次应用过的快照签名（display + config）：一致就跳过整段 applyConfig。 */
  let viewSignature = ''

  function applyState(next: PetStateView | null): void {
    const state = demoState ?? next?.state ?? 'idle'
    // 状态变化时播状态气泡与状态动作（spec §3）：长状态（思考/等审批）走
    // 阶段演进常驻气泡，短状态气泡瞬态显示；点击互动另走 handleTap（可连点打断）。
    // 动作只在状态变化（及长状态阶段推进）时触发；startMotionWithPriority 会先
    // stopAllMotions 再按优先级启动，保证状态动作可立即切换、阶段可重播。
    // 台词/动作均来自事件绑定（config.events），无固定人设、无默认回退。
    if (state !== lastState) {
      lastState = state
      refreshExpressionTargets()
      // 打断优先级（ADR-032）：互相打断 = 状态一变立刻收回触摸窗口；触摸优先 = 窗口内
      // 事件不抢气泡/动作/AI 演绎，只在窗口结束后把控制权交还；事件优先 = 照旧。
      if (interactionMode === 'mutual') clearTapHold()
      const touchHolding = interactionMode === 'touch-first' && tapActive()
      const line = pickEventLine(state, 0)
      if (isLongState(state)) {
        if (touchHolding) {
          // 触摸优先：先记住长状态，入态台词与演绎推迟到窗口结束（beginTapHold 的收尾）
          clearLongState()
          longState = state
        } else {
          // 长状态：入态台词常驻，AI 按设置节奏反复演绎替换（ADR-026）
          enterLongState(state, line)
        }
      } else {
        clearLongState()
        // 全 AI 接管：预置对白不显示，气泡留给模型（失败也不回落到固定台词）。
        // 同 enterLongState：开了「仅触摸」就不接管，否则状态事件会一句台词都没有。
        const takeover = aiTakeover && aiEnabled && !aiTouchOnly
        if (touchHolding) {
          // 触摸优先：短状态不抢正在显示的触摸台词，也不另发一次状态请求
        } else if (takeover) hideBubble()
        else if (line !== undefined) showBubble(line)
        else hideBubble()
        if (state !== 'idle' && !touchHolding) {
          void requestSpeak({ kind: 'state', state, hint: takeover ? undefined : line })
        }
      }
      if (!touchHolding) playState(state)
    }
    if (debugTextEl) {
      debugTextEl.textContent =
        `agent: ${next?.agent ?? '-'}  pet: ${state}  v${next?.version ?? '-'}\n` +
        `parts: ${touchParts.length}  expr: ${desiredExpressions().join('+') || 'none'}\n` +
        `pos: ${Math.round(pos.right)},${Math.round(pos.bottom)}  size: ${pos.size}\n` +
        `bounds: ${Math.round(baseModelW)}x${Math.round(baseModelH)}  canvas: ${canvas?.width ?? 0}x${canvas?.height ?? 0}`
    }
  }

  /** 静态头像降级（WebGL 不可用 / 模型加载失败，spec §7）。 */
  function showFallback(): void {
    if (!box || fallbackShown) return
    fallbackShown = true
    fallbackEl = document.createElement('div')
    fallbackEl.style.cssText = 'pointer-events:auto;width:64px;height:64px;display:flex;align-items:center;justify-content:center;font-size:36px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:16px;color:#fff'
    fallbackEl.textContent = '🐾'
    box.appendChild(fallbackEl)
  }

  /** 移除静态头像占位（模型（重新）加载前调用，避免降级与画布叠加）。 */
  function removeFallback(): void {
    if (fallbackEl && fallbackEl.parentNode) fallbackEl.parentNode.removeChild(fallbackEl)
    fallbackEl = null
    fallbackShown = false
  }

  /**
   * 画布逻辑尺寸 = 模型显示尺寸 + 四周留白（spec §7）：留白让动作/物理甩尾（尾巴等）不被
   * 画布裁切。模型缩放仍按「size = 模型可见宽度」计算（fitModel 用 (size-8)/baseW），
   * 模型大小不变、画布更大。每侧留白来自配置 canvasPadX/Y（size 百分比，下限 40px）。
   */
  function modelCanvasSize(baseW: number, baseH: number, size: number): { width: number; height: number } {
    const padX = Math.max(CANVAS_PAD_MIN, Math.round(size * canvasPadXPct / 100))
    const padY = Math.max(CANVAS_PAD_MIN, Math.round(size * canvasPadYPct / 100))
    if (!(baseW > 0 && baseH > 0)) {
      // 首帧/模型尺寸未知：按 size × 1.2 估算 + 留白（模型加载完成后按实际比例重算）
      return { width: size + padX * 2, height: Math.round(size * 1.2) + padY * 2 }
    }
    const scale = (size - 8) / baseW
    const modelW = baseW * scale
    const modelH = baseH * scale
    return {
      width: Math.max(1, Math.round(modelW + padX * 2)),
      height: Math.max(1, Math.round(modelH + padY * 2)),
    }
  }

  /**
   * 画布的逻辑尺寸（CSS px）：PIXI resolution 只放大内部缓冲，
   * 舞台/包围盒/指针坐标都用逻辑尺寸；autoDensity 会把 canvas.style 设成同一 LOGICAL 尺寸。
   */
  function logicalCanvasSize(): { width: number; height: number } {
    try {
      const screen = app?.screen as { width?: number; height?: number } | undefined
      if (screen && Number(screen.width) > 0 && Number(screen.height) > 0) {
        return { width: Number(screen.width), height: Number(screen.height) }
      }
    } catch { /* 旧渲染器无 screen */ }
    const scale = renderScale()
    return {
      width: canvas ? canvas.width / scale : 0,
      height: canvas ? canvas.height / scale : 0,
    }
  }

  /** 同步触摸部位叠加层的缓冲/CSS 尺寸（缓冲按渲染倍数放大，绘制时 ctx 再缩放）。 */
  function resizeOverlay(width: number, height: number): void {
    if (!touchboxOverlay) return
    const scale = renderScale()
    const bufferW = Math.max(1, Math.round(width * scale))
    const bufferH = Math.max(1, Math.round(height * scale))
    if (touchboxOverlay.width !== bufferW) touchboxOverlay.width = bufferW
    if (touchboxOverlay.height !== bufferH) touchboxOverlay.height = bufferH
    touchboxOverlay.style.width = `${width}px`
    touchboxOverlay.style.height = `${height}px`
  }

  /** 按当前尺寸重新适配模型（画布已就绪时调用；基准尺寸为 scale=1 时捕获值）。 */
  function fitModel(size: number): void {
    if (!model || !canvas) return
    const w = baseModelW
    const h = baseModelH
    if (w > 0 && h > 0) {
      const s = (size - 8) / w
      model.scale.set(s)
      model.anchor.set(0.5, 0.5)
      const logical = logicalCanvasSize()
      model.position.set(logical.width / 2, logical.height / 2)
    }
  }

  /**
   * 画布中心点必须留在视口内（允许一半移出窗口，但拖不丢、能拖回来）：逻辑画布 W×H 时
   * right ∈ [-W/2, innerWidth-W/2]，bottom ∈ [-H/2, innerHeight-H/2]（spec §4）。
   */
  function clampPosToViewport(): void {
    const { width: w, height: h } = logicalCanvasSize()
    if (!(w > 0 && h > 0)) return
    const halfW = w / 2
    const halfH = h / 2
    pos.right = Math.min(window.innerWidth - halfW, Math.max(-halfW, pos.right))
    pos.bottom = Math.min(window.innerHeight - halfH, Math.max(-halfH, pos.bottom))
  }

  /** 把当前 pos 应用到宠物容器样式（不写盘；拖动/尺寸/窗口变化时调用）。 */
  function applyPosToBox(): void {
    if (!box) return
    box.style.right = `${Math.round(pos.right)}px`
    box.style.bottom = `${Math.round(pos.bottom)}px`
    invalidateLayout()
  }

  /** 持久化当前位置（right/bottom，px）；失败静默，下次拖动/归位会再写。 */
  function persistDisplay(): void {
    api.setDisplay({ right: Math.round(pos.right), bottom: Math.round(pos.bottom) }).catch(() => {})
  }

  /**
   * 按配置的默认位置计算 pos（spec §2）：「显示区中心点距右/距下」是**视口宽/高的百分比**——
   * 目标中心点 = (视口宽 × homeRight%、视口高 × homeBottom%)（相对右下角量），
   * 画布中心距右 = right + W/2、距下 = bottom + H/2，因此
   * right = 目标中心距右 - W/2、bottom = 目标中心距下 - H/2，最后按视口规则 clamp。
   */
  function homePositionFromConfig(): void {
    const { width: w, height: h } = logicalCanvasSize()
    const cfg = view?.config
    if (!cfg || !(w > 0 && h > 0)) return
    const homeRightPct = Number.isFinite(cfg.homeRight) ? cfg.homeRight : DEFAULT_HOME_RIGHT
    const homeBottomPct = Number.isFinite(cfg.homeBottom) ? cfg.homeBottom : DEFAULT_HOME_BOTTOM
    const viewportW = window.innerWidth || document.documentElement.clientWidth || 0
    const viewportH = window.innerHeight || document.documentElement.clientHeight || 0
    if (!(viewportW > 0 && viewportH > 0)) return
    pos.right = viewportW * homeRightPct / 100 - w / 2
    pos.bottom = viewportH * homeBottomPct / 100 - h / 2
    clampPosToViewport()
  }

  /** 立即应用画布尺寸（size 视为模型可见宽度，高度按模型比例 + 四周留白自适应）。 */
  function applySizeNow(nextSize: number): void {
    if (canvas && app) {
      const canvasSize = modelCanvasSize(baseModelW, baseModelH, nextSize)
      try { app.renderer.resize(canvasSize.width, canvasSize.height) } catch { /* 旧渲染器 */ }
      resizeOverlay(canvasSize.width, canvasSize.height)
      invalidateLayout()
      pos.size = nextSize
      syncDebugPanelWidth()
      if (model) fitModel(nextSize)
      refreshHitBoxes()
      // 画布尺寸变化后重新保证中心点在视口内
      clampPosToViewport()
      applyPosToBox()
      updateDebugPanelPosition()
      updateBubblePosition()
    } else {
      pos.size = nextSize
    }
  }

  /** 合并同帧/连发的尺寸变更：只落地最后一档（防 SSE 风暴卡死主线程）。 */
  function scheduleSize(nextSize: number): void {
    if (nextSize === pos.size && pendingSize === null) return
    pendingSize = nextSize
    if (sizeRaf) return
    sizeRaf = window.requestAnimationFrame(() => {
      sizeRaf = 0
      const size = pendingSize
      pendingSize = null
      if (size !== null && size !== pos.size) applySizeNow(size)
    })
  }

  /** 销毁当前渲染层（app/canvas/模型引用/静态头像占位）。 */
  function teardownLayer(): void {
    // 作废旧模型的所有动作启动/互动恢复；焦点抑制复位
    motionSeq += 1
    interactionGen += 1
    interactionActive = false
    previewActive = false
    focusSuppressed = false
    lastPointerClient = null
    detachMotionFinish?.()
    detachMotionFinish = null
    clearIdleMicro()
    if (sizeRaf) { window.cancelAnimationFrame(sizeRaf); sizeRaf = 0 }
    pendingSize = null
    stopOverlayLoop()
    hitBoxEntries = []
    hitBoxesSignature = ''
    hitLayer = null
    if (app) { try { app.destroy(true) } catch { /* 已销毁 */ } }
    app = null
    model = null
    baseModelW = 0
    baseModelH = 0
    if (touchboxOverlay && touchboxOverlay.parentNode) touchboxOverlay.parentNode.removeChild(touchboxOverlay)
    touchboxOverlay = null
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas)
    canvas = null
    // 气泡临时移回 box，等待下次 petLayer 重建时再挂回（隐藏避免旧位置残影）
    if (bubble && petLayer && bubble.parentNode === petLayer && box) {
      bubble.style.opacity = '0'
      box.appendChild(bubble)
    }
    if (petLayer && petLayer.parentNode) petLayer.parentNode.removeChild(petLayer)
    petLayer = null
    invalidateLayout()
    // 调试面板随旧 petLayer 一起移除，复位避让状态（新层加载后若 debug 仍开会重新挂载）
    debugPanelTopLogical = Number.NaN
    removeFallback()
  }

  /** 加载/重载模型层：销毁旧层 → 新建画布与 PIXI app → 绑定指针事件。 */
  async function loadModelLayer(url: string | null): Promise<void> {
    teardownLayer()
    if (disposed) return
    if (!url || !box) {
      showFallback()
      return
    }
    try {
      petLayer = document.createElement('div')
      petLayer.style.cssText = 'position:relative;display:inline-block;pointer-events:none'
      canvas = document.createElement('canvas')
      const size = pos.size
      // 首次布置用估算尺寸（模型尺寸未知），模型加载后按实际比例 + 留白重算
      const placeholder = modelCanvasSize(0, 0, size)
      canvas.width = placeholder.width
      canvas.height = placeholder.height
      // 点击穿透（spec §4）：canvas 不接收事件，透明区域直接落到下层 UI；命中由 hitLayer 承接
      canvas.style.cssText = 'pointer-events:none;display:block'
      touchboxOverlay = document.createElement('canvas')
      touchboxOverlay.width = Math.round(canvas.width * renderScale())
      touchboxOverlay.height = Math.round(canvas.height * renderScale())
      touchboxOverlay.style.cssText = `position:absolute;left:0;top:0;width:${canvas.width}px;height:${canvas.height}px;pointer-events:none;z-index:2;display:${touchboxOverlayVisible() ? 'block' : 'none'}`
      // 命中层：透明 div 按触摸部位 box 定位，承接点击/拖动（不遮挡下层 UI 的其余区域）
      hitLayer = document.createElement('div')
      hitLayer.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:3'
      petLayer.appendChild(canvas)
      petLayer.appendChild(touchboxOverlay)
      petLayer.appendChild(hitLayer)
      // 气泡改为相对 petLayer 定位，避免调试面板插入后把气泡顶到面板上方
      if (bubble && bubble.parentNode !== petLayer) petLayer.appendChild(bubble)
      buildBar()
      // 调试面板是 petLayer 内的绝对定位浮层（不占布局，重新挂到新画布层）
      if (debugEl) petLayer.appendChild(debugEl)
      box.appendChild(petLayer)

      const M = PIXI.live2d?.Live2DModel
      if (!M) throw new Error('Live2DModel 不可用')

      app = new PIXI.Application({
        view: canvas,
        width: canvas.width,
        height: canvas.height,
        backgroundAlpha: 0,
        // HiDPI + 多重采样抗锯齿（spec §7）：之前 1x 缓冲在 Retina 上被放大，边缘锯齿明显
        antialias: true,
        resolution: renderScale(),
        autoDensity: true,
        powerPreference: 'low-power',
      })
      try { app.ticker.maxFPS = maxFps } catch { /* 旧 ticker */ }
      pushCleanup(() => { try { app?.destroy(true) } catch { /* 已销毁 */ } })

      const loaded = await M.from(url, { autoInteract: false }) as ModelLike
      if (disposed) {
        // 挂载已拆除（StrictMode/HMR）：弃用本层，不绑定事件
        teardownLayer()
        return
      }
      model = loaded
      // 基础尺寸：优先用模型实际包围盒（getBounds），拿不到再退回 loaded.width/height
      baseModelW = Number(loaded.width) || 0
      baseModelH = Number(loaded.height) || 0
      app.stage.addChild(loaded)
      try {
        const b = loaded.getBounds?.()
        if (b && b.width > 0 && b.height > 0) {
          baseModelW = b.width
          baseModelH = b.height
        }
      } catch { /* 包围盒不可用则保留 loaded.width/height */ }
      // 根据模型原始宽高 + 四周留白自适应 canvas（size 视为模型可见宽度）
      const canvasSize = modelCanvasSize(baseModelW, baseModelH, pos.size)
      try { app.renderer.resize(canvasSize.width, canvasSize.height) } catch { /* 旧渲染器 */ }
      resizeOverlay(canvasSize.width, canvasSize.height)
      syncDebugPanelWidth()
      // 动作真正播完信号：motion() 的 Promise 在开始时即 resolve，不能作为恢复/解除 focus 的时机
      const motionManager = loaded.internalModel?.motionManager
      if (motionManager?.on) {
        motionManager.on('motionFinish', handleMotionFinish)
        detachMotionFinish?.()
        detachMotionFinish = () => motionManager.off?.('motionFinish', handleMotionFinish)
      }
      // 模型就绪后开始排待机小动作（定时器单发、随 idle 状态自行延后）
      scheduleIdleMicro()
      // 表情：包装 InternalModel.update，在动作/物理生效前写入开关与连续参数（spec §5）
      const internal = loaded.internalModel
      if (internal && typeof internal.update === 'function') {
        const originalUpdate = internal.update.bind(internal)
        internal.update = (dt = 1 / 60, now = performance.now()) => {
          applyExpressionParams(internal.coreModel, dt)
          applyLipsync(internal.coreModel, dt)
          const result = originalUpdate(dt, now)
          // 口型/表情写完后追加「说话身体语言」，只影响本帧渲染，不触发物理重算
          applySpeakingBody(internal.coreModel)
          return result
        }
      }
      refreshDebugMotionGroups()
      fitModel(pos.size)
      // 首帧尺寸未知时延迟适配
      if (!(baseModelW > 0 && baseModelH > 0)) {
        try { app.ticker.addOnce(() => fitModel(pos.size)) } catch { /* 首帧适配 */ }
      }
      if (lastState) playState(lastState)
      // 触摸部位叠加层：编辑态/开发者选项开启时启动重绘循环（spec §4）
      syncTouchboxOverlay()
      // 命中层：按当前部位 box 建立透明命中 div，并开始逐帧跟随模型包围盒
      refreshHitBoxes()
      // 模型画布尺寸确定后重新 clamp 中心点并应用位置（切换模型/初始加载，不写盘）
      clampPosToViewport()
      applyPosToBox()
      // 布局缓存随新层失效（canvas/petLayer 都是新元素）
      invalidateLayout()
      // 气泡相对模型定位（模型尺寸/位置已就绪）
      applyBubbleStyle()
      // 调试面板宽度/位置随新画布与模型更新，气泡避让已就绪
      syncDebugPanelWidth()
      updateDebugPanelPosition()
      updateBubblePosition()
    } catch (error) {
      // 加载失败 → 静态头像（spec §7）；已卸载则不再展示
      clientLog('error', 'model layer load failed', error)
      teardownLayer()
      if (!disposed) showFallback()
    }
  }

  /** 模型重载队列：串行执行，避免快速切换时并发加载。 */
  let modelLoadQueue: Promise<void> = Promise.resolve()
  function queueModelLoad(url: string | null): void {
    modelLoadQueue = modelLoadQueue.then(() => loadModelLayer(url)).catch(() => {})
  }

  /** 当前是否显示触摸部位叠加层：编辑态强制显示草稿 box，否则看开发者选项（spec §2/§4）。 */
  function touchboxOverlayVisible(): boolean {
    return editState !== null || showTapZones
  }

  /** 模型包围盒（画布逻辑 px）；无效时 null。命中/气泡/色块/面板共用，避免每帧重复取。 */
  function modelBounds(): { x: number; y: number; width: number; height: number } | null {
    try {
      const b = model?.getBounds?.()
      if (b && b.width > 0 && b.height > 0) return { x: b.x, y: b.y, width: b.width, height: b.height }
    } catch { /* 无包围盒 */ }
    return null
  }

  /** 包围盒签名（0.5px 粒度）：只有包围盒真的变了才重排浮层（静止时整帧跳过）。 */
  function boundsKey(bounds: { x: number; y: number; width: number; height: number } | null): string {
    if (!bounds) return ''
    const q = (v: number): number => Math.round(v * 2) / 2
    return `${q(bounds.x)},${q(bounds.y)},${q(bounds.width)},${q(bounds.height)}`
  }

  /** petLayer 的视口 rect（带缓存；位置/尺寸/模型/窗口变化时用 invalidateLayout 失效）。 */
  function layerRect(): DOMRect | null {
    if (!petLayer) return null
    if (!layerRectCache) {
      try { layerRectCache = petLayer.getBoundingClientRect() } catch { return null }
    }
    return layerRectCache
  }

  /** 失效布局缓存（下一次需要时重新测量一次），避免每帧强制同步布局。 */
  function invalidateLayout(): void {
    layerRectCache = null
    panelSizeCache = null
    canvasRectCache = null
    // 交互条的位置依赖层矩形与尺寸缓存，一并失效，下一帧重排
    barKey = ''
    barW = 0
    barH = 0
  }

  /** 浮层循环的帧间隔（跟随 settings.maxFps；0 = 不限，按 rAF 自然节奏）。 */
  function overlayFrameIntervalMs(): number {
    if (!(maxFps > 0)) return 0
    return Math.max(8, 1000 / maxFps)
  }

  /**
   * 单条 rAF 驱动全部浮层跟随（spec §3/§4）：命中层、调试面板、气泡、触摸色块。
   * - 按 settings.maxFps 节流（此前固定 60fps，不受帧率档影响）；
   * - 包围盒未变（待机/静止）时整帧跳过样式写；
   * - 布局读取走缓存，避免每帧 getBoundingClientRect / offsetWidth 触发同步布局。
   */
  function overlayTick(now: number): void {
    if (!overlayRaf || disposed) return
    overlayRaf = window.requestAnimationFrame(overlayTick)
    if (now - overlayLastAt < overlayFrameIntervalMs()) return
    overlayLastAt = now
    const bounds = modelBounds()
    const key = boundsKey(bounds)
    if (key !== overlayHitKey) {
      overlayHitKey = key
      updateHitBoxPositions(bounds)
    }
    updateDebugPanelPosition(bounds)
    updateBubblePosition(bounds)
    // 交互条只在包围盒/位置/尺寸变化时重排，静止时整帧跳过
    if (barEl) {
      const barSig = `${key}|${barPosition}|${barOffset}|${pos.size}|${barW}x${barH}`
      if (barSig !== barKey) {
        barKey = barSig
        updateBarPosition(bounds)
      }
    }
    if (touchboxOverlayVisible()) paintTouchBoxes(bounds, key)
  }

  /** 停止浮层循环（并复位签名，下次启动强制重算一次位置）。 */
  function stopOverlayLoop(): void {
    if (overlayRaf) { window.cancelAnimationFrame(overlayRaf); overlayRaf = 0 }
    overlayLastAt = 0
    overlayHitKey = ''
    overlayPaintKey = ''
  }

  /** 按当前显隐状态启停浮层循环：宠物可见/编辑态才跑，隐藏或卸载即停。 */
  function syncOverlayLoop(): void {
    const needed = (petShown() && hitLayer !== null) || (touchboxOverlayVisible() && touchboxOverlay !== null)
    if (!needed) { stopOverlayLoop(); return }
    if (overlayRaf) return
    overlayLastAt = 0
    overlayHitKey = ''
    overlayPaintKey = ''
    overlayRaf = window.requestAnimationFrame(overlayTick)
  }

  /**
   * 绘制当前触摸部位的全部 box（spec §4）：编辑态用设置页草稿 parts，否则用已保存 parts。
   * box 归一化坐标（相对模型包围盒 0–1）换算成 canvas 像素矩形；半透明填充 + 部位名标签，
   * 不同部位按调色板循环取色，highlightPartId 高亮部位用更亮更粗的描边。
   */
  function paintTouchBoxes(boundsArg?: { x: number; y: number; width: number; height: number } | null, keyHint?: string): void {
    if (!touchboxOverlayVisible() || !touchboxOverlay || !canvas || !model) return
    const { width: w, height: h } = logicalCanvasSize()
    if (!(w > 0 && h > 0)) return
    resizeOverlay(w, h)
    // 尺寸/显隐已由 resizeOverlay 与 syncTouchboxOverlay 处理；这里只保证可见（不再每帧拼 cssText）
    if (touchboxOverlay.style.display !== 'block') touchboxOverlay.style.display = 'block'
    const bounds = boundsArg === undefined ? modelBounds() : boundsArg
    if (!bounds) return
    const parts = editState?.parts ?? touchParts
    const highlightId = editState?.highlightPartId ?? null
    // 绘制签名：包围盒 + 部位/box + 高亮 + 画布尺寸都没变就不重绘（静止/待机零开销）
    const paintKey = `${keyHint ?? boundsKey(bounds)}|${hitBoxesKey()}|${highlightId ?? ''}|${w}x${h}`
    if (paintKey === overlayPaintKey) return
    overlayPaintKey = paintKey
    const overlayScale = touchboxOverlay.width / w
    const ctx = touchboxOverlay.getContext('2d')
    if (!ctx) return
    // 统一放大到缓冲坐标：包围盒/box 都是逻辑坐标，缩放后绘制保持清晰
    ctx.setTransform(overlayScale, 0, 0, overlayScale, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const { x: bx, y: by, width: bw, height: bh } = bounds
    // 图层：parts[0] 最上层，绘制时从底层往上层画（数组倒序），保证上层 box 覆盖下层
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
      const part = parts[partIndex]
      const scheme = TOUCHBOX_PALETTE[partIndex % TOUCHBOX_PALETTE.length]
      const highlighted = highlightId !== null && part.id === highlightId
      for (const box of part.boxes) {
        const x = bx + bw * box.left
        const y = by + bh * box.top
        const rw = bw * (box.right - box.left)
        const rh = bh * (box.bottom - box.top)
        if (!(rw > 0 && rh > 0)) continue
        ctx.fillStyle = scheme.fill
        ctx.fillRect(x, y, rw, rh)
        ctx.lineWidth = highlighted ? 3 : 1.5
        ctx.strokeStyle = highlighted ? 'rgba(255,255,255,.98)' : scheme.stroke
        ctx.strokeRect(x + 0.5, y + 0.5, rw - 1, rh - 1)
        // 部位名标签：白字 + 深色阴影，深浅模型上都可读；裁剪到 box 内避免溢出
        ctx.save()
        ctx.beginPath()
        ctx.rect(x, y, rw, rh)
        ctx.clip()
        ctx.font = 'bold 11px ui-monospace,monospace'
        ctx.fillStyle = 'rgba(255,255,255,.96)'
        ctx.shadowColor = 'rgba(0,0,0,.7)'
        ctx.shadowBlur = 3
        ctx.fillText(part.name, x + 4, y + 14)
        ctx.restore()
      }
    }
  }

  /** 同步叠加层显隐与重绘（编辑态强制显示；非编辑态由 showTapZones 决定，spec §2/§4）。
   *  逐帧重绘由统一浮层循环（overlayTick）驱动，这里只管启停与首帧。 */
  function syncTouchboxOverlay(): void {
    const on = touchboxOverlayVisible()
    if (touchboxOverlay) touchboxOverlay.style.display = on ? 'block' : 'none'
    if (on) {
      overlayPaintKey = ''
      paintTouchBoxes()
    }
    syncOverlayLoop()
  }

  /** 命中判定当前使用的部位列表：预览/编辑态用设置页草稿，否则用已保存部位（spec §4）。 */
  function activeTouchParts(): TouchPart[] {
    return editState?.parts ?? touchParts
  }

  /** 命中 box 集合签名：仅部位/box 变化时重建命中 div（位置每帧单独更新）。 */
  function hitBoxesKey(): string {
    return JSON.stringify(activeTouchParts().flatMap(
      (part) => part.boxes.map((b) => [b.left, b.top, b.right, b.bottom]),
    ))
  }

  /** 每帧按模型当前包围盒把命中 div 换算成 CSS 像素矩形（跟随动作/物理/尺寸变化）。
   *  bounds 由统一浮层循环传入；每格记录上次写入值，值没变就不写样式。 */
  function updateHitBoxPositions(bounds: { x: number; y: number; width: number; height: number } | null = modelBounds()): void {
    if (!hitLayer || hitBoxEntries.length === 0) return
    if (!bounds) {
      for (const entry of hitBoxEntries) {
        if (entry.last === 'hidden') continue
        entry.last = 'hidden'
        entry.el.style.display = 'none'
      }
      return
    }
    const { x: bx, y: by, width: bw, height: bh } = bounds
    for (const entry of hitBoxEntries) {
      const { el, box } = entry
      const x = bx + bw * box.left
      const y = by + bh * box.top
      const w = bw * (box.right - box.left)
      const h = bh * (box.bottom - box.top)
      if (!(w > 0 && h > 0)) {
        if (entry.last !== 'hidden') {
          entry.last = 'hidden'
          el.style.display = 'none'
        }
        continue
      }
      const key = `${Math.round(x * 2) / 2},${Math.round(y * 2) / 2},${Math.round(w * 2) / 2},${Math.round(h * 2) / 2}`
      if (key === entry.last) continue
      entry.last = key
      el.style.display = ''
      el.style.left = `${x}px`
      el.style.top = `${y}px`
      el.style.width = `${Math.max(1, w)}px`
      el.style.height = `${Math.max(1, h)}px`
    }
  }

  /** 指针事件统一挂在命中 div 上（canvas 已 pointer-events:none，命中层外事件穿透下层 UI）。 */
  function bindHitEvents(el: HTMLDivElement): void {
    el.addEventListener('pointerdown', handlePointerDown)
    el.addEventListener('pointermove', handlePointerMove)
    el.addEventListener('pointerup', handlePointerUp)
    el.addEventListener('pointercancel', () => { down = null; dragging = false })
  }

  /** 按当前部位 box 重建命中层 div；无任何 box 时回退为覆盖模型包围盒的一个命中区。 */
  function rebuildHitBoxes(): void {
    if (!hitLayer) return
    hitLayer.textContent = ''
    hitBoxEntries = []
    const boxes: TouchBox[] = activeTouchParts().flatMap((part) => part.boxes)
    // 部位为空（或都没有 box）→ 覆盖模型包围盒的兜底命中区，保证仍能拖动/点击（spec §4）
    if (boxes.length === 0) boxes.push({ left: 0, top: 0, right: 1, bottom: 1 })
    for (const box of boxes) {
      const el = document.createElement('div')
      el.style.cssText = 'position:absolute;pointer-events:auto;background:transparent;touch-action:none'
      bindHitEvents(el)
      hitLayer.appendChild(el)
      hitBoxEntries.push({ el, box, last: '' })
    }
    updateHitBoxPositions()
  }

  /** 部位/box 或尺寸/模型变化后刷新命中层（签名不变时只更新位置，不重建 div）。 */
  function refreshHitBoxes(): void {
    if (!hitLayer) return
    const key = hitBoxesKey()
    if (key !== hitBoxesSignature || hitBoxEntries.length === 0) {
      hitBoxesSignature = key
      rebuildHitBoxes()
    } else {
      updateHitBoxPositions()
    }
    syncOverlayLoop()
  }

  /** 退出触摸部位编辑态：恢复常规显隐逻辑（尊重 enabled）；showTapZones 开启时继续显示已保存部位。 */
  function exitTouchEdit(): void {
    if (!editState) return
    editState = null
    syncPetVisibility()
    syncTouchboxOverlay()
    refreshHitBoxes()
    if (touchboxOverlayVisible()) paintTouchBoxes()
  }

  /**
   * 设置页「编辑触摸部位」事件（spec §4）：编辑态强制显示宠物（即使插件关闭）并实时绘制草稿 box；
   * 编辑事件里的模型与当前快照不一致时忽略该编辑态（设置页负责退出）。
   */
  function handleTouchEdit(state: TouchEditState): void {
    if (!state.active) {
      exitTouchEdit()
      return
    }
    if (view && state.model !== view.config.model) {
      exitTouchEdit()
      return
    }
    editState = state
    syncPetVisibility()
    syncTouchboxOverlay()
    refreshHitBoxes()
    paintTouchBoxes()
  }

  /** 调试面板的动画下拉同步（模型加载/切换时刷新选项）。 */
  function updateDebugMotionSelect(): void {
    if (!debugMotionSelect) return
    const previous = debugMotionSelect.value
    debugMotionSelect.textContent = ''
    if (debugMotionList.length === 0) {
      const opt = document.createElement('option')
      opt.value = ''
      opt.textContent = '（无动画或模型未加载）'
      debugMotionSelect.appendChild(opt)
      debugMotionSelect.value = ''
      return
    }
    const groups = [...new Set(debugMotionList.map((item) => item.group))]
    for (const group of groups) {
      const optgroup = document.createElement('optgroup')
      optgroup.label = group
      for (const item of debugMotionList) {
        if (item.group !== group) continue
        const opt = document.createElement('option')
        opt.value = `${item.group}\u0000${item.index}`
        opt.textContent = item.label
        optgroup.appendChild(opt)
      }
      debugMotionSelect.appendChild(optgroup)
    }
    if (debugMotionList.some((item) => `${item.group}\u0000${item.index}` === previous)) {
      debugMotionSelect.value = previous
    } else {
      debugMotionSelect.value = ''
    }
  }

  /** 从模型原生 .model3.json 拉取全部具体动画列表（不经过插件状态/映射逻辑）。 */
  async function refreshDebugMotionGroups(): Promise<void> {
    const url = currentModelUrl
    const currentModel = model
    if (!url || !currentModel) return
    const cached = motionListCache.get(url)
    if (cached) {
      if (model === currentModel && debugMotionSelect) {
        debugMotionList = cached
        updateDebugMotionSelect()
      }
      return
    }
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as {
        FileReferences?: { Motions?: Record<string, Array<{ File?: unknown } | unknown>> }
        Motions?: Record<string, Array<{ File?: unknown } | unknown>>
      }
      const motions = data?.FileReferences?.Motions ?? data?.Motions ?? {}
      const list: DebugMotionItem[] = []
      for (const [group, items] of Object.entries(motions)) {
        if (!Array.isArray(items)) continue
        items.forEach((motion, index) => {
          const file = typeof motion === 'object' && motion !== null && 'File' in motion
            ? String((motion as { File?: unknown }).File ?? index)
            : String(index)
          list.push({ group, index, label: `${group} / ${file}` })
        })
      }
      motionListCache.set(url, list)
      // 防止异步返回时模型/面板已经切换
      if (model !== currentModel || !debugMotionSelect) return
      debugMotionList = list
      updateDebugMotionSelect()
    } catch {
      // 原生 JSON 拉取失败时，退回到运行时 definitions（至少还能看到列表）
      const defs = currentModel.internalModel?.motionManager?.definitions ?? {}
      const list: DebugMotionItem[] = []
      for (const [group, motions] of Object.entries(defs)) {
        if (!Array.isArray(motions)) continue
        motions.forEach((motion, index) => {
          const file = typeof motion === 'object' && motion !== null && 'File' in motion
            ? String((motion as { File?: unknown }).File ?? index)
            : String(index)
          list.push({ group, index, label: `${group} / ${file}` })
        })
      }
      if (model !== currentModel || !debugMotionSelect) return
      debugMotionList = list
      updateDebugMotionSelect()
    }
  }

  /** debug 预览：直接播放模型原生指定动画（动作组 + 下标）。
   *  每次点击都 stopAllMotions 后重播，因此同一动画也可反复预览；
   *  预览期间抑制 focus，播完只恢复跟随，不触发状态动作恢复。 */
  function previewMotion(value: string): void {
    if (!model || !value) return
    const sep = value.indexOf('\u0000')
    if (sep < 0) return
    const group = value.slice(0, sep)
    const index = Number(value.slice(sep + 1))
    if (!Number.isInteger(index)) return
    const currentModel = model
    ++motionSeq // 作废旧预览/动作的异步回调，避免旧 motionFinish 释放新预览的焦点
    previewActive = true
    focusSuppressed = true
    currentModel.internalModel?.focusController?.focus(0, 0, true)
    currentModel.internalModel?.motionManager?.stopAllMotions?.()
    void currentModel.motion(group, index, MotionPriority.FORCE)
  }

  /** 调试面板宽度/最大高度（浮层不占布局，spec §2）：宽度 min(280, 画布逻辑宽度-16)，
   *  最大高度 min(420, 视口高*0.5) 且可滚动，避免面板过高无处放。 */
  function syncDebugPanelWidth(): void {
    if (!debugEl) return
    // append 阶段 PIXI app 尚未创建，此时 canvas 属性本身就是逻辑尺寸
    const canvasWidth = app ? logicalCanvasSize().width : (canvas?.width ?? pos.size)
    const width = Math.max(120, Math.min(280, Math.round(canvasWidth - 16)))
    debugEl.style.width = `${width}px`
    debugEl.style.boxSizing = 'border-box'
    debugEl.style.maxHeight = `${Math.max(80, Math.min(420, Math.round(window.innerHeight * 0.5)))}px`
    debugEl.style.overflowY = 'auto'
  }

  /**
   * 调试面板定位（spec §2）：浮在模型包围盒**上方**（不覆盖角色），允许伸出画布留白/画布
   * 上边缘（逻辑 top 可为负），但整体保持在视口内。用 petLayer 的视口 rect 换算：
   * 期望视口 top = rect.top + bounds.y - 8 - panelHeight，clamp 到 [8, innerHeight-panelH-8]，
   * 再换算回 petLayer 逻辑 top = clampedTop - rect.top；水平同理。
   * 每帧由命中层 rAF 调用（跟随动作/内容高度变化），并记录逻辑顶部供气泡避让。
   */
  function updateDebugPanelPosition(boundsArg?: { x: number; y: number; width: number; height: number } | null): void {
    debugPanelTopLogical = Number.NaN
    if (!debugEl || !petLayer || debugEl.parentNode !== petLayer || !model) return
    const bounds = boundsArg === undefined ? modelBounds() : boundsArg
    if (!bounds) return
    // 面板尺寸带缓存：内容/窗口变化时由 invalidateLayout 失效，避免每帧读 offsetWidth（强制布局）
    if (!panelSizeCache) {
      const width = debugEl.offsetWidth
      const height = debugEl.offsetHeight
      if (!(width > 0 && height > 0)) return
      panelSizeCache = { width, height }
    }
    const { width: panelWidth, height: panelHeight } = panelSizeCache
    const rect = layerRect()
    if (!rect) return
    // 垂直：贴模型顶部上方 8px；只在视口放不下时才被夹到视口顶部附近
    const maxViewportTop = Math.max(8, window.innerHeight - panelHeight - 8)
    const viewportTop = Math.min(Math.max(rect.top + bounds.y - 8 - panelHeight, 8), maxViewportTop)
    // 水平：面板居中对齐模型，限制在视口内
    const maxViewportLeft = Math.max(8, window.innerWidth - panelWidth - 8)
    const viewportLeft = Math.min(
      Math.max(rect.left + bounds.x + bounds.width / 2 - panelWidth / 2, 8),
      maxViewportLeft,
    )
    const top = viewportTop - rect.top
    const left = viewportLeft - rect.left
    debugEl.style.left = `${left}px`
    debugEl.style.top = `${top}px`
    debugPanelTopLogical = top
  }

  /** 调试面板动态开关（spec §2）。 */
  function ensureDebugPanel(show: boolean): void {
    if (show && !debugEl && box) {
      debugEl = document.createElement('div')
      debugEl.style.cssText = 'position:absolute;z-index:5;pointer-events:auto;padding:10px 12px;background:rgba(24,26,36,.94);color:#e8eaf0;border:1px solid rgba(128,128,128,.22);border-radius:10px;font:12px/1.5 ui-monospace,monospace;box-shadow:0 4px 16px rgba(0,0,0,.35)'

      const debugTitle = document.createElement('div')
      debugTitle.style.cssText = 'font-size:12px;font-weight:600;color:#aeb8cc;letter-spacing:.3px;margin-bottom:2px'
      debugTitle.textContent = '调试面板'
      debugEl.appendChild(debugTitle)

      const sectionLabel = (text: string): HTMLDivElement => {
        const el = document.createElement('div')
        el.style.cssText = 'margin:10px 0 4px;color:#7f8aa0;font-size:11px;font-weight:600;letter-spacing:.3px'
        el.textContent = text
        return el
      }

      // 状态演示：等宽按钮网格（六态两行三列）
      const demoLabel = sectionLabel('状态演示')
      debugEl.appendChild(demoLabel)
      const demoRow = document.createElement('div')
      demoRow.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:4px'
      for (const st of ['idle', 'thinking', 'waiting', 'done', 'delivered', 'error'] as const) {
        const btn = document.createElement('button')
        btn.textContent = st
        btn.style.cssText = 'padding:4px 0;border-radius:6px;border:1px solid rgba(128,128,128,.25);background:rgba(128,128,128,.1);color:#dbe2ef;font-size:11px;font-family:inherit;cursor:pointer;outline:none'
        btn.onmouseenter = () => { btn.style.background = 'rgba(120,170,255,.22)' }
        btn.onmouseleave = () => { btn.style.background = 'rgba(128,128,128,.1)' }
        btn.onclick = () => { demoState = demoState === st ? null : st; applyState(view) }
        demoRow.appendChild(btn)
      }
      debugEl.appendChild(demoRow)

      // 动画预览：原生动画下拉 + 播放按钮
      const motionLabel = sectionLabel('动画预览')
      debugEl.appendChild(motionLabel)
      const motionSelect = document.createElement('select')
      motionSelect.style.cssText = 'flex:1;min-width:0;background:#1c1e28;color:#e8eaf0;border:1px solid rgba(128,128,128,.3);border-radius:6px;font-size:12px;padding:4px 6px;outline:none'
      motionSelect.onchange = () => previewMotion(motionSelect.value)
      const motionPlay = document.createElement('button')
      motionPlay.textContent = '播放'
      motionPlay.style.cssText = 'padding:4px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;background:rgba(120,170,255,.28);color:#e8eaf0;border:1px solid rgba(120,170,255,.35);outline:none'
      motionPlay.onmouseenter = () => { motionPlay.style.background = 'rgba(120,170,255,.4)' }
      motionPlay.onmouseleave = () => { motionPlay.style.background = 'rgba(120,170,255,.28)' }
      motionPlay.onclick = () => previewMotion(motionSelect.value)
      const motionRow = document.createElement('div')
      motionRow.style.cssText = 'display:flex;gap:6px;align-items:center'
      motionRow.appendChild(motionSelect)
      motionRow.appendChild(motionPlay)
      debugMotionSelect = motionSelect
      debugEl.appendChild(motionRow)

      // 表情预览：点选即常驻（再点同一项取消）
      const exprLabel = sectionLabel('表情预览')
      debugEl.appendChild(exprLabel)
      const exprRow = document.createElement('div')
      exprRow.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:4px'
      const exprButtons: { id: string; btn: HTMLButtonElement }[] = []
      repaintDebugExpressions = (): void => paintExprButtons()
      const paintExprButtons = (): void => {
        for (const { id, btn } of exprButtons) {
          const active = (debugExpression ?? 'none') === id
          btn.style.background = active ? 'rgba(120,170,255,.38)' : 'rgba(128,128,128,.1)'
          btn.style.borderColor = active ? 'rgba(120,170,255,.55)' : 'rgba(128,128,128,.25)'
        }
      }
      for (const expression of EXPRESSIONS) {
        const btn = document.createElement('button')
        btn.textContent = expression.name
        btn.style.cssText = 'padding:3px 0;border-radius:6px;border:1px solid rgba(128,128,128,.25);background:rgba(128,128,128,.1);color:#dbe2ef;font-size:11px;font-family:inherit;cursor:pointer;outline:none'
        btn.onclick = () => {
          debugExpression = debugExpression === expression.id ? null : expression.id
          refreshExpressionTargets()
          paintExprButtons()
        }
        exprButtons.push({ id: expression.id, btn })
        exprRow.appendChild(btn)
      }
      paintExprButtons()
      debugEl.appendChild(exprRow)

      // 状态信息：与上方区域分隔
      debugTextEl = document.createElement('div')
      debugTextEl.style.cssText = 'margin-top:10px;padding-top:8px;border-top:1px solid rgba(128,128,128,.18);color:#9aa5b8;font-size:11px;white-space:pre-wrap;word-break:break-all'
      debugEl.appendChild(debugTextEl)
      syncDebugPanelWidth()
      refreshDebugMotionGroups()
      // 浮层挂在 petLayer 内（canvas 坐标系），绝对定位跟随模型包围盒，不占布局
      if (petLayer) petLayer.appendChild(debugEl)
      else box.appendChild(debugEl)
      updateDebugPanelPosition()
      applyState(view)
    } else if (!show && debugEl) {
      previewActive = false
      focusSuppressed = false
      debugEl.parentNode?.removeChild(debugEl)
      debugEl = null
      debugMotionSelect = null
      debugTextEl = null
      debugPanelTopLogical = Number.NaN
    } else if (show && debugEl && !debugEl.parentNode) {
      // 模型层重建/降级后浮层可能被摘掉：重新挂回（绝对定位不占布局）
      if (petLayer) petLayer.appendChild(debugEl)
      else if (box) box.appendChild(debugEl)
      updateDebugPanelPosition()
    }
  }

  /** 当前应显示的表情 id 列表：调试预览 > 触摸临时表情 > 当前事件绑定（spec §5）。 */
  function desiredExpressions(): string[] {
    // 情绪/触摸带来的临时表情优先级最高：调试面板停在上一次选择里时，
    // 不能让「预览」把真实表情吃掉（否则 AI 选了表情画面不动）。
    if (tempExpressions.length > 0) {
      if (Date.now() < tempExpressionUntil) return tempExpressions
      tempExpressions = []
    }
    if (debugExpression) {
      const id = normalizeExpressionId(debugExpression)
      return id === 'none' ? [] : [id]
    }
    if (!lastState) return []
    return splitMotionSelection(eventBindings[lastState]?.motions ?? []).expressions
  }

  /** 表情目标值缓存：只在表情/状态真的变化时重算（此前每帧重新映射 + 分配对象）。 */
  let expressionTargets: Record<string, number> = {}
  /** 目标是否已全部收敛：收敛后整帧跳过写入（动作/物理不会改这些开关参数）。 */
  let expressionSettled = false

  /** 刷新表情目标值（状态/触摸/调试预览变化时调用）。 */
  function refreshExpressionTargets(): void {
    const ids = desiredExpressions()
    expressionTargets = expressionParams(ids)
    expressionSettled = false
    expressionWriteLogged = false
    // 诊断：表情每次切换都留痕，排查「表情不生效」时看 ~/.dsh/waifu/client.log
    clientLog('info', 'expr targets', `${ids.join('+') || 'none'} ${JSON.stringify(expressionTargets)}`)
  }

  /**
   * 写入表情参数：布尔开关按「当前表情」目标值 0/1，带淡入淡出。
   * 在 InternalModel.update 之前调用——动作/物理不会写这些参数，先写即生效。
   */
  let expressionWriteLogged = false
  function applyExpressionParams(
    coreModel: { setParameterValueById?(id: string, value: number, weight?: number): void } | undefined,
    dt: number,
  ): void {
    const set = coreModel?.setParameterValueById
    if (typeof set !== 'function') {
      if (!expressionWriteLogged && Object.keys(expressionTargets).length > 0) {
        expressionWriteLogged = true
        clientLog('warn', 'expr: coreModel.setParameterValueById is missing', String(typeof set))
      }
      return
    }
    // 触摸临时表情到期：回到事件表情（顺带在帧内检查，不额外挂计时器）
    if (tempExpressions.length > 0 && Date.now() >= tempExpressionUntil) {
      tempExpressions = []
      refreshExpressionTargets()
    }
    if (expressionSettled) return
    const fade = Math.min(1, Math.max(0.02, dt * 1000 / EXPRESSION_FADE_MS))
    let settled = true
    for (const param of EXPRESSION_SWITCH_PARAMS) {
      const target = expressionTargets[param] ?? 0
      const current = expressionMix.get(param) ?? 0
      if (Math.abs(target - current) < 0.004) {
        if (current !== target) {
          expressionMix.set(param, target)
          try {
            set.call(coreModel, param, target, 1)
          } catch (error) {
            clientLog('warn', 'expr set failed', `${param}: ${String(error)}`)
          }
        }
        continue
      }
      settled = false
      const next = current + (target - current) * fade
      if (!expressionWriteLogged) {
        expressionWriteLogged = true
        clientLog('info', 'expr write', `${param} ${current.toFixed(2)}→${target} (now ${next.toFixed(2)})`)
      }
      expressionMix.set(param, next)
      try {
        set.call(coreModel, param, next, 1)
      } catch (error) {
        clientLog('warn', 'expr set failed', `${param}: ${String(error)}`)
      }
    }
    expressionSettled = settled
  }

  /**
   * 口型跟随（ADR-033）：按正在播放的音频的波形 RMS 驱动 `ParamMouthOpenY`
   * （model3 里 `Groups.LipSync` 就声明了这个参数，别的参数不碰）。
   * 张得快、收得慢，接近真人说话的包络；没在放音时自然回到闭合。
   */
  /**
   * 说话时的身体语言（优化项 ⑥）：口型张开量顺手带一点点点头与挑眉，
   * 让「说话」看起来有身体参与，而不是纯口型。写值放在 `update()` 之后追加，
   * 所以物理链不会被二次点燃（只做视觉叠加），音量为 0 时自然归零。
   */
  function applySpeakingBody(
    coreModel: {
      setParameterValueById?(id: string, value: number, weight?: number): void
      getParameterValueById?(id: string): number
    } | undefined,
  ): void {
    const set = coreModel?.setParameterValueById
    const get = coreModel?.getParameterValueById
    if (typeof set !== 'function' || typeof get !== 'function') return
    if (!bodyLanguageEnabled) return
    const level = mouthLevel
    if (level <= 0.02) return
    const add = (id: string, delta: number): void => {
      const base = get.call(coreModel, id)
      if (!Number.isFinite(base)) return
      set.call(coreModel, id, base + delta, 1)
    }
    // 点头（说话的重音感）+ 挑眉；幅度压在 3° / 0.12 以内，避免抢动作戏
    add('ParamAngleY', 3.0 * level)
    add('ParamAngleZ', 0.6 * level)
    add('ParamBrowLY', 0.12 * level)
    add('ParamBrowRY', 0.1 * level)
    add('ParamEyeBallY', -0.06 * level)
  }

  function applyLipsync(
    coreModel: { setParameterValueById?(id: string, value: number, weight?: number): void } | undefined,
    dt: number,
  ): void {
    const set = coreModel?.setParameterValueById
    if (typeof set !== 'function') return
    const gain = Math.max(0, Math.min(300, lipsyncGain)) / 100
    let target = 0
    if (lipsyncEnabled && lipsyncAnalyser && lipsyncData) {
      lipsyncAnalyser.getByteTimeDomainData(lipsyncData as Uint8Array<ArrayBuffer>)
      let sum = 0
      for (let i = 0; i < lipsyncData.length; i += 1) {
        const sample = (lipsyncData[i]! - 128) / 128
        sum += sample * sample
      }
      const rms = Math.sqrt(sum / lipsyncData.length)
      // 正常语音 RMS 约 0.04–0.25；放大 6 倍后再按强度缩放，避免一直张满
      target = Math.min(1, rms * 6) * gain
    }
    const approach = (target > mouthLevel ? 0.6 : 0.28) * Math.min(1, dt * 60)
    mouthLevel += (target - mouthLevel) * Math.max(0.05, approach)
    try {
      set.call(coreModel, 'ParamMouthOpenY', Math.max(0, Math.min(1, mouthLevel)), 1)
    } catch {
      // 模型没有该参数：忽略
    }
  }

  /** 运行时应用配置变化（spec §2/§3/§6/§7）：开关 / 尺寸 / 帧率 / 调试 / 触摸部位 / 事件绑定 / 模型。 */
  function applyConfig(next: PetStateView): void {
    const cfg = next.config
    // 开关：显示/隐藏 + 暂停/恢复渲染循环（syncPetVisibility 合并编辑态/隐藏/失焦，spec §7）
    enabled = cfg.enabled
    syncPetVisibility()
    // 事件绑定：随当前模型解析结果热更新（动作组 + 台词池，spec §3）；内容变化时
    // 若正处于长状态且未拖拽，立刻刷新当前阶段文案（不打断阶段计时节奏）。
    // 先于调试面板/状态应用更新，保证首次 applyState 用到的就是最新绑定。
    const nextEvents = cfg.events ?? DEFAULT_EVENT_BINDINGS
    const eventsSignature = JSON.stringify(nextEvents)
    if (eventsSignature !== eventBindingsSignature) {
      eventBindings = nextEvents
      eventBindingsSignature = eventsSignature
      if (longState !== null && !dragging) showStickyText()
    }
    // 调试面板 + 触摸部位色块（开发者选项，互不强制绑定；编辑态强制显示，spec §2/§4）
    ensureDebugPanel(cfg.debug)
    showTapZones = !!cfg.showTapZones
    // 触摸部位：随当前模型解析结果热更新（用户自定义 box，spec §4），并触发叠加层/命中层重绘
    touchParts = Array.isArray(cfg.touchParts) ? cfg.touchParts : []
    syncTouchboxOverlay()
    if (touchboxOverlayVisible()) paintTouchBoxes()
    refreshHitBoxes()
    // 帧率：立刻改 ticker.maxFPS（0 = 不限制）
    applyMaxFps(cfg.maxFps)
    // 画布留白：配置变化时先更新百分比值；尺寸未变则立即按新留白重算画布（spec §7）
    const nextPadX = Number.isFinite(cfg.canvasPadX) ? cfg.canvasPadX : DEFAULT_CANVAS_PAD_X
    const nextPadY = Number.isFinite(cfg.canvasPadY) ? cfg.canvasPadY : DEFAULT_CANVAS_PAD_Y
    const padChanged = nextPadX !== canvasPadXPct || nextPadY !== canvasPadYPct
    canvasPadXPct = nextPadX
    canvasPadYPct = nextPadY
    // 尺寸：合并后重设画布 + 模型适配（避免连发 SSE 同步卡死主线程）
    const nextSize = cfg.size
    if (nextSize !== pos.size) scheduleSize(nextSize)
    else if (padChanged && canvas && app) applySizeNow(nextSize)
    // 模型：modelUrl 变化 → 重载
    const nextUrl = cfg.modelUrl || null
    if (nextUrl !== currentModelUrl) {
      currentModelUrl = nextUrl
      queueModelLoad(nextUrl)
    }
    // 首次启动（尚无持久化位置）：按配置「显示中心距右/距下」套用一次并回写（spec §2）
    if (!next.displaySaved && !homeApplied) {
      homeApplied = true
      homePositionFromConfig()
      applyPosToBox()
      persistDisplay()
    }
    // 位置：快照/配置变化后保证画布中心点不离开视口（初始加载/归位 SSE 同样生效；不写盘）
    clampPosToViewport()
    applyPosToBox()
    // 气泡：偏移/背景/文字色随配置即时生效（不重建气泡，spec §3）
    bubbleOffsetX = Number.isFinite(cfg.bubbleOffsetX) ? cfg.bubbleOffsetX : DEFAULT_BUBBLE_OFFSET_X
    bubbleOffsetY = Number.isFinite(cfg.bubbleOffsetY) ? cfg.bubbleOffsetY : DEFAULT_BUBBLE_OFFSET_Y
    bubbleBgColor = typeof cfg.bubbleBgColor === 'string' && cfg.bubbleBgColor.trim()
      ? cfg.bubbleBgColor
      : DEFAULT_BUBBLE_BG_COLOR
    bubbleBgOpacity = Number.isFinite(cfg.bubbleBgOpacity) ? cfg.bubbleBgOpacity : DEFAULT_BUBBLE_BG_OPACITY
    bubbleTextColor = typeof cfg.bubbleTextColor === 'string' && cfg.bubbleTextColor.trim()
      ? cfg.bubbleTextColor
      : DEFAULT_BUBBLE_TEXT_COLOR
    aiEnabled = cfg.aiEnabled === true
    aiTouchOnly = cfg.aiTouchOnly === true
    aiTakeover = cfg.aiTakeover === true
    idleMotionEnabled = cfg.idleMotionEnabled !== false
    scheduleIdleMicro()
    ttsEnabled = cfg.ttsEnabled !== false
    barPosition = normalizeBarPosition(cfg.barPosition, DEFAULT_BAR_POSITION)
    barOffset = Number.isFinite(cfg.barOffset)
      ? Math.round(Math.min(BAR_OFFSET_LIMITS.max, Math.max(BAR_OFFSET_LIMITS.min, cfg.barOffset)))
      : DEFAULT_BAR_OFFSET
    if (barEl) {
      barKey = ''
      syncBarVisual()
    }
    lipsyncEnabled = cfg.lipsyncEnabled !== false
    bodyLanguageEnabled = cfg.lipsyncEnabled !== false
    lipsyncGain = Number.isFinite(cfg.lipsyncGain) ? cfg.lipsyncGain! : DEFAULT_SETTINGS.lipsyncGain
    interactionMode = normalizeInteractionMode(cfg.interactionMode, interactionMode)
    applyLongAiConfig(cfg)
    applyBubbleMaxConfig(cfg)
    applyBubbleStyle()
    syncDebugPanelWidth()
    updateDebugPanelPosition()
    updateBubblePosition()
  }

  // ---- 指针：点击/拖动判定（6px 阈值，spec §4） ----
  let down: { x: number; y: number; startRight: number; startBottom: number } | null = null
  let dragging = false

  function handlePointerDown(e: PointerEvent): void {
    down = { x: e.clientX, y: e.clientY, startRight: pos.right, startBottom: pos.bottom }
    dragging = false
    // 捕获到命中 div 本身（canvas 已 pointer-events:none，不能作为捕获目标）
    const target = e.currentTarget as HTMLElement | null
    target?.setPointerCapture?.(e.pointerId)
  }
  function handlePointerMove(e: PointerEvent): void {
    if (!down) return
    const dx = e.clientX - down.x
    const dy = e.clientY - down.y
    if (!dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      dragging = true
      if (bubble) bubble.style.opacity = '0'
    }
    if (dragging && box) {
      pos.right = down.startRight - dx
      pos.bottom = down.startBottom - dy
      // 允许拖出窗口，但画布中心点不能离开视口（否则无法拖回）
      clampPosToViewport()
      applyPosToBox()
    }
  }
  function handlePointerUp(e: PointerEvent): void {
    if (!down) return
    const distance = Math.hypot(e.clientX - down.x, e.clientY - down.y)
    // 位移在容差内 = 点击（哪怕中途被判定成拖拽过，也把位置回滚回去）
    if (distance <= TAP_SLOP_PX) {
      if (dragging) {
        pos.right = down.startRight
        pos.bottom = down.startBottom
        applyPosToBox()
      }
      handleTap(e)
    } else if (dragging) {
      api.setDisplay({ right: Math.round(pos.right), bottom: Math.round(pos.bottom) }).catch(() => {})
      // 拖拽中隐藏的常驻气泡恢复当前文案（spec §4：拖拽中暂停、结束恢复）
      showStickyText()
    }
    down = null
    dragging = false
  }

  // ---- 鼠标跟随（spec §4）：全局 pointermove，头/眼/身体看向鼠标 ----
  function handleGlobalPointerMove(e: PointerEvent): void {
    lastPointerClient = { x: e.clientX, y: e.clientY }
    // 非 idle 动作播放期间抑制 focus，避免动作关键帧被鼠标跟随叠加（spec §4）
    if (!model || !canvas || dragging || !petShown() || hidden || focusSuppressed) return
    applyFocus(e.clientX, e.clientY)
  }
  function handleGlobalMouseOut(e: MouseEvent): void {
    // 仅当真正离开页面/窗口时复位；元素间移动会冒泡 mouseout，需排除 relatedTarget 非空
    if (e.relatedTarget) return
    lastPointerClient = null
    if (!model || dragging || !petShown() || hidden) return
    // 非 idle 动作期间 focus 已被归零并抑制，不需要额外复位
    if (!focusSuppressed) {
      // 复位正视前方：FocusController 吃 [-1,1] 归一化目标，直接归零
      model.internalModel?.focusController?.focus(0, 0, true)
    }
  }

  /**
   * AI 回复（ADR-025）：Host 生成一句台词后替换气泡；失败/超时保持预置台词不动。
   * 连点时只采用最新一次请求的结果（`aiRequestSeq`）。
   */
  async function requestAiReply(
    input: { kind: 'tap' | 'state' | 'chat'; part?: string; state?: string; hint?: string; text?: string; tz?: string },
    options?: { sticky?: boolean; ignoreCooldown?: boolean },
  ): Promise<string | null> {
    if (!aiEnabled) return null
    // 仅触摸：状态变化只用预置台词，不打扰模型（状态切换往往只有几百毫秒）
    if (aiTouchOnly && input.kind === 'state') return null
    // 触摸优先/互相打断：触摸保持窗口内不让状态类演绎抢气泡（ADR-032）
    if (input.kind === 'state' && interactionMode !== 'event-first' && tapActive()) return null
    // 冷却内不发（Host 会直接回 cooldown），否则白白作废上一条还在说的台词
    if (!options?.ignoreCooldown && aiCooldownLeft() > 0) return null
    lastAiRequestAt = Date.now()
    const seq = ++aiRequestSeq
    const targetState = input.state
    try {
      const result = await api.interact(input)
      if (seq !== aiRequestSeq) return null
      // 状态类回复：期间状态又变了就丢弃（新状态会自己发请求），否则这句会盖在新状态的气泡上
      if (targetState !== undefined && targetState !== lastState) return null
      if (!result.ok || !result.text) return null
      applyEmotion(result.emotion)
      // 长状态下 AI 那句成为新的常驻底稿，2.5s 后回落时显示的就是它
      if (options?.sticky) bubbleStickyText = result.text
      showAiBubble(result.text)
      return result.text
    } catch {
      // 忽略：保留预置台词（无网络/模型不可用时的降级路径）
      return null
    }
  }

  /**
   * 流式演绎（ADR-033）：/speak 同时给出文本段与音频段，气泡按「音频播到第几段」逐段显示，
   * 口型吃同一段音频的波形。语音关闭或一句都没出来时回落到一次性的 {@link requestAiReply}。
   */
  async function requestSpeak(
    rawInput: { kind: 'tap' | 'state' | 'chat'; part?: string; state?: string; hint?: string; text?: string },
    options?: { sticky?: boolean },
  ): Promise<string | null> {
    // 每个请求都带上浏览器时区，Host 用它换算「现在几点」
    const input = CLIENT_TIME_ZONE ? { ...rawInput, tz: CLIENT_TIME_ZONE } : rawInput
    if (!aiEnabled) return null
    if (aiTouchOnly && input.kind === 'state') return null
    if (input.kind === 'state' && interactionMode !== 'event-first' && tapActive()) return null
    // 冷却内直接返回：**不能**先 stopSpeaking() 再发请求，那会把上一条说了一半的台词掐掉
    if (aiCooldownLeft() > 0) return null
    // 语音关掉：走一次性回复（少一条长连接，行为与 ADR-025 完全一致）
    if (!ttsEnabled) {
      lastAiRequestAt = Date.now()
      return requestAiReply(input, { ...options, ignoreCooldown: true })
    }
    lastAiRequestAt = Date.now()
    const seq = ++speakSeq
    // 新的一轮先掐掉上一轮的播放与合成
    stopSpeaking()
    // 作废可能在飞的 /interact 结果，避免两句台词抢同一个气泡
    aiRequestSeq += 1
    const targetState = input.state
    const controller = new AbortController()
    speakAbort = controller
    speakClauses = []
    speakRevealed = -1
    speakChain = Promise.resolve()
    let finalText: string | null = null
    let sawClause = false
    try {
      await api.speak(input, (event, data) => {
        if (seq !== speakSeq) return
        if (event === 'clause') {
          const item = data as { index?: unknown; text?: unknown }
          if (typeof item.index !== 'number' || typeof item.text !== 'string') return
          sawClause = true
          speakClauses.push({ index: item.index, text: item.text })
          return
        }
        if (event === 'audio') {
          const item = data as { index?: unknown; mime?: unknown; data?: unknown }
          if (typeof item.index !== 'number' || typeof item.data !== 'string') return
          const mime = typeof item.mime === 'string' ? item.mime : 'audio/mpeg'
          const index = item.index
          // 串行播放：后段音频必须等前段播完，口型才对得上
          speakChain = speakChain.then(async () => {
            if (seq !== speakSeq) return
            revealClausesUntil(index)
            await playClip(item.data as string, mime)
          })
          return
        }
        if (event === 'emotion') {
          const payload = data as { emotion?: unknown }
          applyEmotion(payload.emotion)
          return
        }
        if (event === 'done') {
          const payload = data as { text?: unknown }
          finalText = typeof payload.text === 'string' ? payload.text : null
          return
        }
        if (event === 'error') {
          // 交给下面的兜底判断：一句都没有就回落一次性回复
          return
        }
      }, controller.signal)
    } catch {
      // 连接失败/中止：同样走兜底
    }
    if (seq !== speakSeq) return null
    await speakChain.catch(() => undefined)
    if (seq !== speakSeq) return null
    if (targetState !== undefined && targetState !== lastState) return null
    if (!sawClause && finalText === null) {
      // 禁用/冷却/失败/零文本：与改造前一致，回落一次性回复（冷却已在上方可判，这里强制放行）
      return requestAiReply(input, { ...options, ignoreCooldown: true })
    }
    // 合成失败被跳过的段也要补上文字
    revealAllClauses()
    if (finalText !== null) {
      if (options?.sticky) bubbleStickyText = finalText
      showAiBubble(finalText)
      return finalText
    }
    return null
  }

  /** AI 情绪标签落地：临时切到对应表情（到期回落到事件表情）。 */
  function applyEmotion(emotion: unknown): void {
    if (typeof emotion !== 'string' || emotion.length === 0) return
    const list = EMOTION_EXPRESSIONS[emotion]
    if (!list || list.length === 0) return
    tempExpressions = [...list]
    tempExpressionUntil = Date.now() + EMOTION_HOLD_MS
    // 真实表情优先：清掉调试面板残留的预览选择，免得把情绪挡掉
    debugExpression = null
    repaintDebugExpressions?.()
    clientLog('info', 'emotion', `${String(emotion)} → ${list.join('+')}`)
    refreshExpressionTargets()
    clientLog('info', 'emotion applied', `${list.join('+')} → ${JSON.stringify(expressionTargets)}`)
  }

  function handleTap(e: PointerEvent): void {
    if (!canvas || !model) return
    // 用户手势里顺手解锁音频（浏览器不允许无交互自动播放）
    if (aiEnabled && ttsEnabled) ensureAudio()
    const now = Date.now()
    if (now - lastTapAt < TAP_DEBOUNCE_MS) return
    lastTapAt = now
    try {
      const rect = canvas.getBoundingClientRect()
      const localX = e.clientX - rect.left
      const localY = e.clientY - rect.top
      // 命中判定只用用户自定义 box（spec §4）：先取包围盒换算归一化坐标；
      // 无包围盒或点击落在包围盒外 → 不互动。
      const bounds = model.getBounds?.()
      if (!bounds || !(bounds.width > 0 && bounds.height > 0)) return
      const ratio = pointToBoundsRatio(localX, localY, bounds)
      if (!ratio) return
      // 数据源：预览（编辑）态用设置页草稿部位（实时对照），否则用 SSE config.touchParts；
      // 命中最小 box 优先。
      const part = hitTestTouchParts(editState?.parts ?? touchParts, ratio.nx, ratio.ny)
      if (!part) return
      // 触摸接管窗口（ADR-032）：先占住气泡/动作，再决定台词与 AI
      beginTapHold()
      // 台词：该部位自定义台词（part.lines）非空时随机选一条，并避开该部位上一条
      // （按 part.id 记录，部位间互不干扰）；未配置台词 → 不显示气泡，只播部位动作（spec §4）。
      let spoken: string | undefined
      // 全 AI 接管：部位预置台词不显示也不作为 hint，完全交给模型（persona + 场景 + 历史）
      const takeover = aiTakeover && aiEnabled
      if (!takeover && part.lines && part.lines.length > 0) {
        const line = pickLine(part.lines, lastPartLine.get(part.id))
        if (line !== undefined) {
          lastPartLine.set(part.id, line)
          showBubble(line)
          spoken = line
        }
      }
      // AI 回复（ADR-025/033）：预置台词先出、AI 台词到了再替换（失败即保持预置台词）。
      // 冷却期内的点击不丢弃——记下最后一下，冷却结束补发；期间上一条台词继续播完。
      const tapHint = takeover ? undefined : spoken
      const cooldownLeft = aiEnabled ? aiCooldownLeft() : 0
      if (cooldownLeft > 0) deferTapRequest({ part: part.name, hint: tapHint }, cooldownLeft)
      else void requestSpeak({ kind: 'tap', part: part.name, hint: tapHint })
      // 动作组 / 表情：部位混选里 1 个动作组 + 若干表情；表情短暂切过去（EXPRESSION_TEMP_MS 后回落到事件表情）
      const selection = splitMotionSelection(part.motions)
      if (selection.expressions.length > 0) {
        tempExpressions = selection.expressions
        tempExpressionUntil = Date.now() + EXPRESSION_TEMP_MS
        refreshExpressionTargets()
      }
      // 动作：有动作组才播（空 = 只出气泡，spec §4）
      if (selection.motion) void playInteractionMotion([selection.motion])
    } catch {
      // 命中检测异常：忽略本次点击
    }
  }

  /**
   * 播放互动动作（触摸部位动作组）：FORCE 可打断状态动画与上一次互动；动作真正播完
   * （motionFinish）后恢复当前状态动画（spec §4）。motion() 的 Promise 只代表开始，
   * 因此不再用 Promise 完成时间或 3s 兜底来恢复。
   */
  async function playInteractionMotion(names: readonly string[]): Promise<void> {
    if (!model || names.length === 0) return
    ++interactionGen
    await startMotionWithPriority(
      names,
      MotionPriority.FORCE,
      { suppressFocus: true, isInteraction: true },
    )
  }

  // ---- 主流程 ----
  void (async () => {
    try {
      // 1. 初始状态（配置 + 显示位置）
      try { view = await api.state() } catch (error) { /* 首帧前 API 不可用则用默认 */
        clientLog('warn', 'state fetch failed', error)
      }
      if (disposed) return
      if (view) {
        pos = { ...view.display, size: view.config.size }
        // 初始模型加载前先取配置留白，避免先按默认值布置再抖动重算
        canvasPadXPct = Number.isFinite(view.config.canvasPadX) ? view.config.canvasPadX : DEFAULT_CANVAS_PAD_X
        canvasPadYPct = Number.isFinite(view.config.canvasPadY) ? view.config.canvasPadY : DEFAULT_CANVAS_PAD_Y
        // 气泡偏移/样式同样先取配置，创建气泡时即按配置渲染
        bubbleOffsetX = Number.isFinite(view.config.bubbleOffsetX) ? view.config.bubbleOffsetX : DEFAULT_BUBBLE_OFFSET_X
        bubbleOffsetY = Number.isFinite(view.config.bubbleOffsetY) ? view.config.bubbleOffsetY : DEFAULT_BUBBLE_OFFSET_Y
        bubbleBgColor = typeof view.config.bubbleBgColor === 'string' && view.config.bubbleBgColor.trim()
          ? view.config.bubbleBgColor
          : DEFAULT_BUBBLE_BG_COLOR
        bubbleBgOpacity = Number.isFinite(view.config.bubbleBgOpacity) ? view.config.bubbleBgOpacity : DEFAULT_BUBBLE_BG_OPACITY
        bubbleTextColor = typeof view.config.bubbleTextColor === 'string' && view.config.bubbleTextColor.trim()
          ? view.config.bubbleTextColor
          : DEFAULT_BUBBLE_TEXT_COLOR
        aiEnabled = view.config.aiEnabled === true
        aiTouchOnly = view.config.aiTouchOnly === true
        aiTakeover = view.config.aiTakeover === true
        idleMotionEnabled = view.config.idleMotionEnabled !== false
        scheduleIdleMicro()
        ttsEnabled = view.config.ttsEnabled !== false
        barPosition = normalizeBarPosition(view.config.barPosition, DEFAULT_BAR_POSITION)
        barOffset = Number.isFinite(view.config.barOffset)
          ? Math.round(Math.min(BAR_OFFSET_LIMITS.max, Math.max(BAR_OFFSET_LIMITS.min, view.config.barOffset)))
          : DEFAULT_BAR_OFFSET
        lipsyncEnabled = view.config.lipsyncEnabled !== false
        bodyLanguageEnabled = view.config.lipsyncEnabled !== false
        lipsyncGain = Number.isFinite(view.config.lipsyncGain)
          ? view.config.lipsyncGain!
          : DEFAULT_SETTINGS.lipsyncGain
        interactionMode = normalizeInteractionMode(view.config.interactionMode, interactionMode)
        applyLongAiConfig(view.config)
        applyBubbleMaxConfig(view.config)
      }
      clientLog('info', `state ready: model=${view?.config.model ?? '?'} url=${view?.config.modelUrl ?? 'none'}`)

      // 2. 顶层容器（Popover API，回退 body + max z）
      box = document.createElement('div')
      const popoverSupported = typeof box.showPopover === 'function'
      // UA 对 [popover] 默认 inset:0 + margin:auto（居中）、border:solid + Canvas 背景，
      // 必须显式重置（ADR-005 实证：居中 + 边框/背景两处坑）
      box.style.cssText = `position:fixed;inset:auto;top:auto;left:auto;right:${pos.right}px;bottom:${pos.bottom}px;margin:0;padding:0;border:none;background:transparent;width:auto;height:auto;overflow:visible;pointer-events:none${popoverSupported ? '' : ';z-index:2147483647'}`
      if (popoverSupported) box.setAttribute('popover', 'manual')
      document.body.appendChild(box)
      if (popoverSupported) { try { box.showPopover() } catch { /* 已显示 */ } }
      pushCleanup(() => {
        barEl?.parentNode?.removeChild(barEl)
        barEl = null
        barMuteEl = null
        barInputEl = null
      })
      pushCleanup(() => { box?.parentNode?.removeChild(box) })
      clientLog('info', `container created (popover=${String(popoverSupported)})`)

      // 气泡层：绝对定位在 petLayer 上，位置每帧按模型包围盒更新（spec §3）
      bubble = document.createElement('div')
      bubble.style.cssText = 'position:absolute;left:0;top:0;transform:translate(-50%,-100%);padding:4px 10px;border-radius:10px;font:12px/1.5 sans-serif;white-space:normal;word-break:break-word;opacity:0;transition:opacity .2s;pointer-events:none;z-index:4'
      box.appendChild(bubble)
      applyBubbleStyle()

      // 3. vendor 脚本（Host 同源）
      for (const src of VENDOR_SCRIPTS) {
        await loadScript(src)
        if (disposed) return
      }
      clientLog('info', 'vendor scripts loaded')

      // 4. 初始模型（config.modelUrl：Host 解析后的 .model3.json URL，spec §6）
      const initialUrl = view?.config.modelUrl || null
      currentModelUrl = initialUrl
      await loadModelLayer(initialUrl)
      if (disposed) return
      clientLog('info', `model layer loaded: ${initialUrl ?? 'fallback'}`)

      // 4.1 全局鼠标跟随（spec §4）：页面任意位置移动→头/眼/身体看向鼠标；
      //     鼠标移出页面→复位正视前方。监听挂在 document 上，模型重载时无需重绑。
      const onGlobalPointerMove = handleGlobalPointerMove
      const onGlobalMouseOut = handleGlobalMouseOut
      document.addEventListener('pointermove', onGlobalPointerMove, { passive: true })
      document.addEventListener('mouseout', onGlobalMouseOut)
      pushCleanup(() => {
        document.removeEventListener('pointermove', onGlobalPointerMove)
        document.removeEventListener('mouseout', onGlobalMouseOut)
      })

      // 5. 状态订阅（SSE 推送，ADR-006）：替代 v0.1 的 800ms 轮询。
      //    断线由 EventSource 自动重连，重连后首帧即全量快照，无需补偿拉取。
      const handleState = (next: PetStateView): void => {
        if (disposed) return
        view = next
        // 位置取持久化值；渲染尺寸保持现状，由 applyConfig 负责 diff 与更新
        pos = { right: next.display.right, bottom: next.display.bottom, size: pos.size }
        // 每次状态变化都会推整份快照，但 config 通常没变：签个名跳过整段 diff，
        // 只在配置/位置真的变了时才重算布局与浮层（状态本身交给 applyState）。
        const signature = `${next.display.right}|${next.display.bottom}|${next.displaySaved ? 1 : 0}|${JSON.stringify(next.config)}`
        if (signature !== viewSignature) {
          viewSignature = signature
          applyConfig(next)
        }
        applyState(next)
      }
      let closeEvents: (() => void) | undefined
      try {
        closeEvents = api.events(handleState, () => { /* 断线重连中，EventSource 自动重试 */ })
      } catch {
        // EventSource 不可用：保留首帧快照（静态宠物），不再更新
      }
      // 标签页隐藏/窗口失焦 → 暂停渲染循环；恢复时继续（spec §7）
      const onVisibility = () => { hidden = document.visibilityState !== 'visible'; syncTicker() }
      const onBlur = () => { hidden = true; syncTicker() }
      const onFocus = () => { hidden = false; syncTicker() }
      // 视口尺寸变化：重新 clamp 画布中心点并刷新面板/气泡（不写盘，spec §2/§4）
      const onResize = () => {
        invalidateLayout()
        clampPosToViewport()
        applyPosToBox()
        applyBubbleStyle()
        syncDebugPanelWidth()
        updateDebugPanelPosition()
        updateBubblePosition()
      }
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('blur', onBlur)
      window.addEventListener('focus', onFocus)
      window.addEventListener('resize', onResize)
      pushCleanup(() => {
        closeEvents?.()
        document.removeEventListener('visibilitychange', onVisibility)
        window.removeEventListener('blur', onBlur)
        window.removeEventListener('focus', onFocus)
        window.removeEventListener('resize', onResize)
      })

      // 6. 初始应用（含开关/尺寸/调试/模型；SSE 首帧到达前先用已拉到的快照）
      if (view) {
        applyConfig(view)
        applyState(view)
      }
    } catch (error) {
      // 静态头像降级（WebGL 不可用 / 模型加载失败，spec §7）
      clientLog('error', 'boot failed', error)
      showFallback()
    }
  })()

  return () => { for (const fn of cleanup) { try { fn() } catch { /* 忽略清理错误 */ } } }
}

/** 插件入口。 */
export function apply(ctx: ClientContext): void {
  clientLog('info', 'apply entered')
  // 全局异常上报（渲染/脚本加载失败时也能在 Host 日志里看到）
  ctx.effect(() => {
    const onError = (event: ErrorEvent): void => { clientLog('error', `window error: ${event.message}`, event.error) }
    const onRejection = (event: PromiseRejectionEvent): void => { clientLog('error', 'unhandled rejection', event.reason) }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  })
  const slots = ctx.get('slots') as SlotsLike | undefined
  if (slots === undefined) { clientLog('warn', 'apply: slots service unavailable'); return }
  slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: 'waifu' },
    () => createElement(PetAnchor),
  ))

  // Waifu 设置页（settings.section，spec §2）：开关/尺寸/模型列表/事件绑定/触摸部位/调试，
  // 读写经插件自身 API（/api/dsh-waifu/settings，Host 直连插件私有 JSONC 文件；
  // 不走 settingsScope wire，见 docs/research/settings-tab.md「设置服务不可用」根因）。
  // 导航爪印：平台 settings-general 按 id 硬编码图标（未知 id→齿轮），故 register.icon
  // 暂不生效；installPetSettingsNavIcon 在 DOM 层替换，卸载时一并清理。
  slots.inject('settings.section', () => {
    const stopNavIcon = installPetSettingsNavIcon()
    const disposeSection = slots.register(
      {
        name: 'settings.section',
        id: 'waifu',
        order: 200,
        label: () => 'Waifu 设置',
        icon: pawNavIcon,
      },
      () => createElement(PetSettingsSection, {}),
    )
    return () => {
      stopNavIcon()
      disposeSection()
    }
  })
}
