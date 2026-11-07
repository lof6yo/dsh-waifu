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
import { stripTimestamps, hasDoubleInteraction, pickTapInteraction, DOUBLE_TAP_MS } from '../models.ts'
import { clientLog, setClientLogObserver } from './client-log.ts'
import {
  dispatchTrigger,
  flushMerged,
  initialScheduleState,
  type MergedTrigger,
  type ScheduleConfig,
  type ScheduleState,
} from './schedule.ts'
import {
  EXPRESSIONS,
  expressionParams,
  EXPRESSION_SWITCH_PARAMS,
  isExpressionId,
  isMotionId,
  normalizeExpressionId,
  hitTestTouchParts,
  pointToBoundsRatio,
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
  DEFAULT_FOCUS_RANGE,
  normalizeFocusRange,
  DEFAULT_BAR_OFFSET,
  DEFAULT_BAR_POSITION,
  BAR_OFFSET_LIMITS,
  normalizeBarPosition,
  type BarPosition,
  DEFAULT_TRIGGER_MODE,
  DEFAULT_ACTIVITY_WINDOW_SEC,
  DEFAULT_TAP_GAP_MS,
  DEFAULT_MERGE_MAX,
  normalizeTriggerMode,
  TRIGGER_EVENTS,
  TRIGGER_EVENT_LABELS,
  type TriggerMode,
} from '../defaults.ts'
import { onTouchEdit, type TouchEditState } from './touch-edit.ts'
import { onCatalogPreview, type CatalogPreview } from './catalog-preview.ts'
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
/** 气泡最长连续可见时长兜底（秒）：默认 10；0 = 不限（spec §3，ADR-027）。 */
const BUBBLE_MAX_DEFAULT = DEFAULT_BUBBLE_MAX_SECONDS
/**
 * 调试面板手动摆放（spec §2 / ADR-044）：拖动标题栏移动、拖四角缩放后，几何存浏览器本地。
 * 用 localStorage 而不是设置文件——这是纯客户端的调试工具状态，不该进 Host schema、也不该
 * 跟着设置同步到别的设备；键带版本号，几何结构再变时换键即可让旧记录自然失效。
 */
const DEBUG_PANEL_STORE_KEY = 'dsh-waifu.debug-panel:v1'
/** 面板尺寸下限（px）：再小按钮就点不准了。 */
const DEBUG_PANEL_MIN_W = 180
const DEBUG_PANEL_MIN_H = 140
/** 面板与视口边缘的最小间距（px）。 */
const DEBUG_PANEL_MARGIN = 8
/** AI 台词最短可见时长：状态切换再快，也要让这句露一脸（ADR-025 补丁）。 */
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
/** AI 标签表情的临时保持时长（ms）：到期回落默认表情（ADR-037）。 */
const TAG_EXPRESSION_HOLD_MS = 4200
/** 静默超时兜底步长（ms）：计时器误差容忍，避免和设置值贴边抖动。 */
const IDLE_TIMER_SLACK_MS = 250

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

/** 调试面板手动几何（**视口/client px**，不是 petLayer 逻辑坐标）：用户拖出来的位置与大小。
 *  存视口坐标是为了让面板「钉在屏幕上」——拖动角色时面板不跟着跑（spec §2 / ADR-044）。 */
interface DebugPanelGeometry {
  left: number
  top: number
  width: number
  height: number
}

/** 面板缩放方向（四角）。 */
type PanelCorner = 'nw' | 'ne' | 'sw' | 'se'

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

/** JSON 响应读取:非 2xx 抛错——错误响应不得当作合法视图/结果解析。 */
async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`http ${res.status}`)
  return await res.json() as T
}

/** 触发场景（ADR-037）：与 Host 的 TriggerInput 同构；`merged` 由本侧调度器填。 */
interface TriggerBody {
  kind: 'tap' | 'event' | 'chat' | 'idle'
  part?: string
  /** 部位自定义交互名（ADR-038）：场景句用它描述「主人做了什么」。 */
  interaction?: string
  event?: string
  text?: string
  merged?: string[]
  tz?: string
}

/** `/interact` 的响应（语音关闭时的一次性回复路径）。 */
interface InteractResult {
  ok: boolean
  text?: string
  expressions?: string[]
  motions?: string[]
  error?: string
  /** Host 的链路记录（ADR-043）：LLM 请求/回复，按发生顺序。 */
  trace?: DebugTraceStep[]
}

/** Host 链路记录的一条（`/speak` 的 SSE `debug` 帧与 `/interact` 的 `trace` 同构）。 */
interface DebugTraceStep {
  phase: string
  /** 发生时刻（Host 时钟，epoch ms）。 */
  at?: number
  data: unknown
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
  /** AI 回复（ADR-037）：上报触发场景，拿回台词 + 表情/动作 + 记忆（失败返回 ok:false）。 */
  interact: (body: TriggerBody): Promise<InteractResult> =>
    fetch(`${PET_API}/interact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((res) => readJson<InteractResult>(res)),
  /**
   * 流式演绎（ADR-033）：POST /speak 走 SSE，逐条回调 `text`/`clause`/`audio`/`done`/`error`。
   * 用 fetch + ReadableStream 手动解帧（EventSource 不支持 POST 带 body）。
   */
  speak: async (
    body: TriggerBody,
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
  /** 排查用（ADR-043）：最近一次 LLM / TTS 请求报文与历史。 */
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
  pushCleanup(() => {
    clearIdleTimer()
    clearBubbleHideTimer()
    clearPendingTap()
    clearHover()
    if (mergeTimer !== undefined) {
      window.clearTimeout(mergeTimer)
      mergeTimer = undefined
    }
    stopSpeaking()
  })
  pushCleanup(() => {
    if (sizeRaf) { window.cancelAnimationFrame(sizeRaf); sizeRaf = 0 }
    pendingSize = null
  })
  pushCleanup(() => { stopOverlayLoop(); showTapZones = false; editState = null })
  // 设置页「编辑触摸部位」事件（spec §4）：编辑态强制显示宠物并实时绘制草稿 box。
  // 退订随挂载清理，避免 StrictMode/HMR 重挂载残留监听。
  pushCleanup(onTouchEdit(handleTouchEdit))
  // 设置页「动作 / 表情」预览（ADR-040 修订）：点一下就按目录播一次，用来确认释义对应的表现。
  pushCleanup(onCatalogPreview((target) => { previewCatalog(target) }))
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
  /** 调试面板状态文本容器：与场景演示/动画预览并列，避免被 textContent 覆盖。 */
  let debugTextEl: HTMLDivElement | null = null
  /** 是否正处于 debug 原生动画预览：预览期间抑制 focus，结束后只恢复跟随，不触发状态恢复。 */
  let previewActive = false
  /** 调试面板顶部（逻辑画布 CSS px；NaN = 不可见/未定位），用于气泡避让（spec §2）。 */
  let debugPanelTopLogical = Number.NaN
  /** 调试面板底部（逻辑画布 CSS px；NaN = 不可见/未定位）：气泡避让只在面板整体位于模型上方时生效。 */
  let debugPanelBottomLogical = Number.NaN
  /** 调试面板手动几何（逻辑画布 CSS px；null = 自动跟随模型上方，spec §2 / ADR-044）。 */
  let debugPanelManual: DebugPanelGeometry | null = null
  /** 是否已从 localStorage 读过手动几何（首次建面板时读一次，之后以内存为准）。 */
  let debugPanelGeometryLoaded = false
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
  /** 本次按压开始时间（pointerdown 记，pointerup 算时长 → 轻碰/戳戳/抚摸，ADR-037）。 */
  let tapDownAt = 0
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
  let lastState: PetState | null = null
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
  /** AI 驱动总开关（SSE config.aiEnabled；ADR-037）：关闭后角色完全静默。 */
  let aiEnabled = false
  /** 触发频率（SSE config.triggerMode；ADR-037）：interrupt = 截断抢占，queue = 排队等完成。 */
  let triggerMode: TriggerMode = DEFAULT_TRIGGER_MODE
  /** 事件类触发的最小间隔（秒，0 = 不限；触摸/对话豁免，ADR-037）。 */
  let aiMinIntervalSec = 0
  /** 静默超时（秒，0 = 关闭）：多久没动静就让角色自己说一句（ADR-037）。 */
  let idleTimeoutSec = 0
  /** 同类事件窗口（秒；ADR-047 起由客户端调度器执行，Host 不再节流）。 */
  let activityWindowSec = DEFAULT_ACTIVITY_WINDOW_SEC
  /** 触摸连点窗口（毫秒，ADR-047）。 */
  let tapGapMs = DEFAULT_TAP_GAP_MS
  /** 合并上限（条，ADR-047）。 */
  let mergeMax = DEFAULT_MERGE_MAX
  /** 触发调度的全部窗口/合并状态（ADR-047：唯一的判断来源）。 */
  let scheduleState: ScheduleState = initialScheduleState()
  /** 合并补发计时器（最小间隔到期那一下）。 */
  let mergeTimer: number | undefined
  /** 连点窗口内被延后的一次触摸（新的覆盖旧的）。 */
  let deferredTap: { input: TriggerBody; timer: number } | null = null
  /** 静默超时计时器：任何触发都重排。 */
  let idleTimer: number | undefined
  /** 按 DSH 事件类型的触发开关（SSE config.eventTriggers；触摸/对话不在表内，必触发）。 */
  let eventTriggers: Record<string, boolean> = {}
  /** 上一轮演绎是否还在进行中（调度器的 busy 门）。 */
  let speakingTurnActive = false
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
  /** AI 回复请求序号：只采用最后一次请求的结果，避免连点时旧回复覆盖新回复。 */
  let aiRequestSeq = 0
  /** 部位定义了双击交互时，单击要等一个双击窗口再结算（ADR-038）。 */
  let pendingDoublePart: { id: string; timer: number; flush: () => void } | null = null
  // 悬停（ADR-038 修订）：鼠标停在 box 内不点击，到时触发一次「停留」交互；
  // 移出 box（或按下/开始拖动）就清掉，回来重新计时。窗口期内只触发一次。
  let hoverState: { partId: string; timer: number; fired: boolean } | null = null

  const clearHover = (): void => {
    if (hoverState !== null) window.clearTimeout(hoverState.timer)
    hoverState = null
  }
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
  /** 标签页/窗口是否可见（spec §7：只有它影响渲染循环）。 */
  let hidden = document.visibilityState === 'hidden'
  /** 浏览器窗口是否有焦点：只影响鼠标跟随，不停渲染（用户可在别处时也让角色动）。 */
  let windowFocused = document.hasFocus()

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
      // 出态事件可能没送到：气泡不能永远挂着，顺手掐掉正在说的语音，避免继续烧 token
      stopSpeaking()
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
    // 气泡默认锚在模型包围盒上方（spec §3）
    let anchorY = bounds.y - bubbleOffsetY
    // 调试面板整体位于模型上方时（自动跟随的常态）气泡叠到面板之上避让（spec §2）；
    // 面板被用户拖到别处（侧边/下方）就不再上移，否则气泡会莫名其妙飞到面板顶上。
    if (Number.isFinite(debugPanelTopLogical) && debugPanelBottomLogical <= bounds.y + 1) {
      anchorY = debugPanelTopLogical - 6
    }
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
    await fireTrigger({ kind: 'chat', text })
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

  /** 立刻替换气泡文案（不经 AI 排队），到时隐藏。 */
  function showBubbleNow(text: string): void {
    if (!bubble) return
    clearBubbleHideTimer()
    setBubbleText(text)
    bubbleHideTimer = window.setTimeout(() => {
      bubbleHideTimer = undefined
      bubbleVisible = false
      clearBubbleMaxTimer()
      if (bubble) bubble.style.opacity = '0'
    }, BUBBLE_DISPLAY_MS)
  }

  /** AI 台词上屏（ADR-037：不再有预置台词排队，直接换文案）。 */
  function showAiBubble(text: string): void {
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
  /** 正在播的那一段：stopSpeaking 要真的把它掐掉（只 abort 请求停不下已排队的音频）。 */
  let activeSource: AudioBufferSourceNode | null = null
  /** 对应段的 resolve：掐掉时按 null（没播完）结束，别让链一直挂着。 */
  let activeResolve: ((seconds: number | null) => void) | null = null

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

  /** 中止当前演绎（新触摸/状态切换/隐藏/卸载时调用）：连带掐掉正在播的音频与排队段。 */
  function stopSpeaking(): void {
    if (speakAbort !== null) {
      try { speakAbort.abort() } catch { /* 已结束 */ }
      speakAbort = null
    }
    // 递增序号：已经排进 speakChain 的回调不再往下播（原来只有 interrupt 分支自增，隐藏/卸载停不住）
    speakSeq += 1
    speakChain = Promise.resolve()
    const source = activeSource
    const resolve = activeResolve
    activeSource = null
    activeResolve = null
    if (source !== null) {
      try {
        source.onended = null
        source.stop()
      } catch { /* 已经播完 */ }
    }
    resolve?.(null)
    speakClauses = []
    speakRevealed = -1
    mouthLevel = 0
  }

  /** 解码并播放一段音频（mp3 整段解码 → 播放 → 结束回调）。 */
  /** 播一段音频（驱动口型）。resolve 出这段的实际时长（秒）；播不了给 null。 */
  function playClip(base64: string, _mime: string): Promise<number | null> {
    const ctx = ensureAudio()
    const analyser = lipsyncAnalyser
    if (!ctx || !analyser) return Promise.resolve(null)
    const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0))
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    return new Promise<number | null>((resolve) => {
      const finish = (seconds: number | null) => {
        activeResolve = null
        try { analyser.disconnect() } catch { /* 已断开 */ }
        resolve(seconds)
      }
      ctx.decodeAudioData(buffer, (decoded) => {
        try {
          const source = ctx.createBufferSource()
          source.buffer = decoded
          source.connect(analyser)
          analyser.connect(ctx.destination)
          activeSource = source
          activeResolve = finish
          source.onended = () => {
            if (activeSource === source) activeSource = null
            finish(decoded.duration)
          }
          source.start()
        } catch {
          finish(null)
        }
      }, () => resolve(null))
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

  function clearPendingTap(): void {
    if (pendingDoublePart) {
      window.clearTimeout(pendingDoublePart.timer)
      pendingDoublePart = null
    }
    if (deferredTap) {
      window.clearTimeout(deferredTap.timer)
      deferredTap = null
    }
  }

  // ---- 触发调度（ADR-047：一个入口 + 一张策略表）----
  /**
   * 事件类触发开关（触摸/对话必触发，不在表内）。
   * 表内缺键按「开」处理：设置页只关显式关掉的那些。
   */
  function eventTriggerEnabled(event: string): boolean {
    const value = eventTriggers[event]
    return value !== false
  }

  /** 当前策略配置：所有窗口都来自设置项，调度器自己不存默认值。 */
  function scheduleConfig(): ScheduleConfig {
    return {
      aiEnabled,
      hidden,
      busy: speakingTurnActive,
      tapGapMs,
      eventGapMs: Math.round(aiMinIntervalSec * 1000),
      sameKindWindowMs: Math.round(activityWindowSec * 1000),
      mergeMax,
      triggerMode,
    }
  }

  /** 合并项 → 场景句里的「这期间还发生了…」条目（同类合并成「×N」，主事件不重复报）。 */
  function mergeLines(merged: readonly MergedTrigger[], mainEvent?: string): string[] {
    const lines: string[] = []
    for (const item of merged) {
      const label = TRIGGER_EVENT_LABELS[item.event] ?? item.event
      if (item.event === mainEvent) {
        if (item.count > 1) lines.push(`${label}又来了 ${item.count - 1} 次`)
        continue
      }
      lines.push(item.count > 1 ? `${label}×${item.count}` : label)
    }
    return lines
  }

  /** 连点窗口内的触摸：只留最后一次，到点补发（届时窗口已过，会直接触发）。 */
  function deferTrigger(input: TriggerBody, delayMs: number): void {
    if (deferredTap) window.clearTimeout(deferredTap.timer)
    const timer = window.setTimeout(() => {
      deferredTap = null
      if (disposed) return
      fireTrigger(input)
    }, delayMs + 30)
    deferredTap = { input, timer }
  }

  /** 合并队列到点补发（只在空闲时发；忙的时候交给轮次结束那一刻）。 */
  function flushSchedule(): void {
    if (disposed || !aiEnabled || speakingTurnActive) return
    const flushed = flushMerged(scheduleState)
    if (flushed.incoming === null) return
    scheduleState = flushed.state
    const mainEvent = flushed.incoming.event
    void startTurn({ kind: 'event', event: mainEvent, merged: mergeLines(flushed.merged, mainEvent) })
  }

  /** 事件最小间隔到期后补发合并轮。 */
  function scheduleMergeFlush(nextAt: number): void {
    if (mergeTimer !== undefined) window.clearTimeout(mergeTimer)
    const delay = Math.max(0, nextAt - Date.now())
    mergeTimer = window.setTimeout(() => {
      mergeTimer = undefined
      flushSchedule()
    }, delay + 20)
  }

  /** 静默超时：任何真实触发都重排；0 = 关闭。 */
  function clearIdleTimer(): void {
    if (idleTimer !== undefined) {
      window.clearTimeout(idleTimer)
      idleTimer = undefined
    }
  }

  function scheduleIdleTimer(): void {
    clearIdleTimer()
    // 页面隐藏时不必计时：反正不请求，回来时由下一次活动重新计时
    if (hidden || !(idleTimeoutSec > 0)) return
    idleTimer = window.setTimeout(() => {
      idleTimer = undefined
      if (disposed || !aiEnabled) return
      fireTrigger({ kind: 'idle' })
    }, idleTimeoutSec * 1000 + IDLE_TIMER_SLACK_MS)
  }

  /**
   * 唯一触发入口（ADR-047）：事件与互动**永远先到这里**，由策略表决定怎么处理。
   * - run：立刻开一轮（带上一轮攒下的合并项）；
   * - defer：连点窗口内，等窗口过了再发；
   * - merge：并进下一次触发（同类窗口 / 最小间隔 / 上一轮没演完），丢弃的每一条都有日志；
   * - drop：真的不发（AI 关、页面隐藏、场景开关关、静默撞上进行中的一轮）。
   * `force` 只给调试面板「场景演示」用：显式绕过策略表，也不改窗口状态。
   */
  function fireTrigger(input: TriggerBody, options?: { force?: boolean }): void {
    const label = input.kind === 'event' ? `${input.kind}:${input.event ?? '-'}` : input.kind
    if (options?.force === true) {
      conPush('trigger', `force | ${label}`)
      scheduleIdleTimer()
      void startTurn(input)
      return
    }
    const switchOff = input.kind === 'event' && input.event !== undefined && !eventTriggerEnabled(input.event)
    const { decision, state } = dispatchTrigger(
      scheduleState,
      { kind: input.kind, event: input.event, switchOff },
      scheduleConfig(),
      Date.now(),
    )
    scheduleState = state
    switch (decision.action) {
      case 'run':
        scheduleIdleTimer()
        void startTurn({ ...input, merged: mergeLines(decision.merged, input.event) })
        return
      case 'defer':
        conPush('trigger', `deferred | ${label} | ${decision.reason} ${decision.delayMs}ms`)
        deferTrigger(input, decision.delayMs)
        return
      case 'merge':
        conPush('trigger', `merged | ${label} | ${decision.reason}`)
        if (decision.overflowed > 0) conPush('trigger', `merge overflow | 丢掉最旧 ${decision.overflowed} 条`)
        if (decision.nextAt > 0) scheduleMergeFlush(decision.nextAt)
        return
      case 'drop':
        clientLog('info', `trigger dropped | ${label} | ${decision.reason}`)
        conPush('trigger', `dropped | ${label} | ${decision.reason}`)
        return
    }
  }

  /** 开一轮：interrupt 模式作废旧轮；queue 模式下轮次结束时补发合并队列。 */
  function startTurn(input: TriggerBody): Promise<string | null> {
    if (hidden) return Promise.resolve(null)
    // 控制台第一行永远是「这轮是什么触发的」（ADR-043）
    conPushJson('trigger', input)
    if (triggerMode === 'interrupt') stopSpeaking()
    speakingTurnActive = true
    // 轮次真正结束（语音播完或一次性回复返回）才解锁；queue 模式随即补发攒下的合并项
    return requestSpeak(input).finally(() => {
      speakingTurnActive = false
      flushSchedule()
    })
  }

  /** canvas 的视口 rect 缓存：pointermove 每次都要用，不能每次读布局。 */
  let canvasRectCache: DOMRect | null = null
  /** 鼠标跟随范围（% 模型尺寸，0 = 只在模型框内跟随，spec §4）。 */
  let focusRangePct = DEFAULT_FOCUS_RANGE
  /** 指针当前是否落在跟随范围内；出范围时只复位一次，避免每帧重复写。 */
  let focusInRange = true

  /** 按 client 坐标应用鼠标跟随（model.focus 吃 canvas 本地坐标）。 */
  function applyFocus(clientX: number, clientY: number): void {
    if (!model || !canvas) return
    if (!canvasRectCache) {
      try { canvasRectCache = canvas.getBoundingClientRect() } catch { return }
    }
    const localX = clientX - canvasRectCache.left
    const localY = clientY - canvasRectCache.top
    // 跟随范围（spec §4）：只在模型包围盒外扩 focusRangePct% 的矩形内才跟随，
    // 出范围就回正前方，避免整个屏幕都在看鼠标。
    let bounds: { x: number; y: number; width: number; height: number } | undefined
    try { bounds = model.getBounds?.() } catch { bounds = undefined }
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      const padX = (bounds.width * focusRangePct) / 100
      const padY = (bounds.height * focusRangePct) / 100
      const inside =
        localX >= bounds.x - padX &&
        localX <= bounds.x + bounds.width + padX &&
        localY >= bounds.y - padY &&
        localY <= bounds.y + bounds.height + padY
      if (!inside) {
        if (focusInRange) {
          focusInRange = false
          model.internalModel?.focusController?.focus(0, 0, true)
        }
        return
      }
      focusInRange = true
    }
    model.focus(localX, localY)
  }

  /** 临时表情（AI 标签 / 设置页预览）是否还在保持窗口内。 */
  function expressionHoldActive(): boolean {
    return tempExpressions.length > 0 && Date.now() < tempExpressionUntil
  }

  /**
   * 演出一段临时表情：写目标值 + 这段时间内暂停鼠标跟随。
   * 演出（动作/表情）期间让头眼固定在正前方，避免跟随不断叠加到关键帧上；
   * 表情窗口结束、动作 motionFinish 时再恢复跟随（`releaseFocusSuppression`）。
   */
  function holdTemporaryExpression(ids: readonly string[]): void {
    tempExpressions = [...ids]
    tempExpressionUntil = Date.now() + TAG_EXPRESSION_HOLD_MS
    repaintDebugExpressions?.()
    focusSuppressed = true
    try { model?.internalModel?.focusController?.focus(0, 0, true) } catch { /* 模型未就绪 */ }
    refreshExpressionTargets()
  }

  /** 解除非 idle 动作期间的 focus 抑制；若有最近指针位置则立即恢复跟随。 */
  function releaseFocusSuppression(): void {
    if (!focusSuppressed) return
    // 动作与表情可能同时进行：任一方还在演就先别恢复跟随
    if (interactionActive || expressionHoldActive()) return
    focusSuppressed = false
    if (model && lastPointerClient && !dragging && enabled && !hidden && windowFocused) {
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
    const busy = previewActive || interactionActive
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
      // 互动动作结束后回到 idle 循环（ADR-037：状态动作已由 AI tags 驱动，无固定恢复目标）
      if (wasInteraction && gen === interactionGen && !interactionActive && lastState === 'idle') {
        void startMotionWithPriority(['Idle'], MotionPriority.IDLE, { suppressFocus: false, isInteraction: false })
      }
    })
  }

  /** 上一次应用过的快照签名（display + config）：一致就跳过整段 applyConfig。 */
  let viewSignature = ''

  /** 已播过的活动序号：SSE 每帧都带同一个 activity，靠它去重（不重复播）。 */
  let lastActivitySeq = 0

  /**
   * 一次性活动（工具执行 / 审批结果 / 会话开关 / 子代理进出，ADR-036）→
   * ADR-037 起只作为「触发场景」交给 AI：动作/表情/台词全由模型选，本函数只去重 + 触发。
   */
  function applyActivity(activity: { seq: number; kind: string } | null | undefined): void {
    if (!activity || typeof activity.seq !== 'number') return
    if (activity.seq <= lastActivitySeq) return
    lastActivitySeq = activity.seq
    clientLog('info', `activity | ${activity.kind}`)
    fireTrigger({ kind: 'event', event: activity.kind })
  }

  function applyState(next: PetStateView | null): void {
    const state = next?.state ?? 'idle'
    applyActivity(next?.activity)
    // 状态变化（ADR-037）：动作/表情/台词全部交给 AI——这里只把状态当作触发场景。
    // idle 不是触发；静默超时由 scheduleIdleTimer 单独兜底。
    if (state !== lastState) {
      lastState = state
      if (state !== 'idle') {
        fireTrigger({ kind: 'event', event: state })
      }
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
    debugPanelBottomLogical = Number.NaN
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
      // 模型（重）加载后回到 idle 循环（ADR-037：状态动作已由 AI tags 驱动）
      if (model) void startMotionWithPriority(['Idle'], MotionPriority.IDLE, { suppressFocus: false, isInteraction: false })
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
  function bindHitEvents(el: HTMLDivElement, part: TouchPart): void {
    el.addEventListener('pointerdown', handlePointerDown)
    el.addEventListener('pointermove', handlePointerMove)
    el.addEventListener('pointerup', handlePointerUp)
    el.addEventListener('pointercancel', () => { down = null; dragging = false })
    // 悬停（ADR-038 修订）：鼠标停在该部位 box 内 ≥ holdMs 自动触发「停留」交互；
    // 按下（可能要拖动）或移出都清计时；同一趟悬停只触发一次，移出再回来重新计。
    // 注意：box 之间会互相覆盖（如「头发」完全盖住「脸」），DOM 里后插入的 div 才是指针真正
    // 命中的那个。所以悬停不能直接用这个 div 绑定的 part，必须按坐标重新做一次命中测试，
    // 否则停在脸上只会落到「头发」的 div（没有 hold 交互 → 什么都不发生）。
    el.addEventListener('pointerenter', syncHoverFromPointer)
    el.addEventListener('pointermove', syncHoverFromPointer)
    el.addEventListener('pointerleave', syncHoverFromPointer)
  }

  /** 按指针坐标取当前命中部位（与点击路径同一套：parts 顺序 = 图层顺序，上层优先）。 */
  function hoverPartAt(clientX: number, clientY: number): TouchPart | null {
    if (!canvas || !model) return null
    const bounds = model.getBounds?.()
    if (!bounds || !(bounds.width > 0 && bounds.height > 0)) return null
    if (!canvasRectCache) {
      try { canvasRectCache = canvas.getBoundingClientRect() } catch { return null }
    }
    const rect = canvasRectCache
    const ratio = pointToBoundsRatio(clientX - rect.left, clientY - rect.top, bounds)
    if (!ratio) return null
    return hitTestTouchParts(editState?.parts ?? touchParts, ratio.nx, ratio.ny)
  }

  /** 指针进入/移动/离开命中区时同步悬停计时器（原地不动也保持计时）。 */
  function syncHoverFromPointer(e: PointerEvent): void {
    if (down) return
    const part = hoverPartAt(e.clientX, e.clientY)
    if (!part) {
      if (hoverState !== null) clearHover()
      return
    }
    if (hoverState?.partId === part.id) return
    const holds = (part.interactions ?? []).filter((item) => item.trigger === 'hold')
    if (holds.length === 0) {
      if (hoverState !== null) clearHover()
      return
    }
    beginHover(part)
  }

  function beginHover(part: TouchPart): void {
    const holds = (part.interactions ?? []).filter((item) => item.trigger === 'hold')
    if (holds.length === 0) return
    clearHover()
    // 多个 hold 交互取「最容易达成」的那个（holdMs 最短）：计时也按最短的来，
    // 否则最短 1s / 最长 5s 并存时要干等 5s 才触发
    const hold = [...holds].sort((a, b) => a.holdMs - b.holdMs)[0]
    const holdMs = hold.holdMs
    const timer = window.setTimeout(() => {
      if (hoverState === null) return
      hoverState = null
      if (aiEnabled && ttsEnabled) ensureAudio()
      clientLog('info', `tap | ${part.name} | ${hold.name}(hold 悬停) ${holdMs}ms`)
      fireTrigger({ kind: 'tap', part: part.name, interaction: hold.name })
    }, holdMs)
    hoverState = { partId: part.id, timer, fired: false }
  }

  /** 按当前部位 box 重建命中层 div；无任何 box 时回退为覆盖模型包围盒的一个命中区。 */
  function rebuildHitBoxes(): void {
    if (!hitLayer) return
    hitLayer.textContent = ''
    hitBoxEntries = []
    clearHover()
    // 一个 box 对应一个部位（部位可能多 box）；命中层 div 与部位关联，
    // 悬停（ADR-038 修订）需要知道「停在了谁的 box 上」。
    const entries: Array<{ part: TouchPart; box: TouchBox }> = []
    for (const part of activeTouchParts()) {
      for (const box of part.boxes) entries.push({ part, box })
    }
    // 部位为空（或都没有 box）→ 覆盖模型包围盒的兜底命中区，保证仍能拖动/点击（spec §4）
    if (entries.length === 0) entries.push({ part: { id: '', name: '', boxes: [] }, box: { left: 0, top: 0, right: 1, bottom: 1 } })
    for (const entry of entries) {
      const el = document.createElement('div')
      el.style.cssText = 'position:absolute;pointer-events:auto;background:transparent;touch-action:none'
      bindHitEvents(el, entry.part)
      hitLayer.appendChild(el)
      hitBoxEntries.push({ el, box: entry.box, last: '' })
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

  // ---- 调试面板几何：可拖动 / 可缩放 / 本地记住（spec §2，ADR-044） ----

  /** 面板可用尺寸范围（视口内留 DEBUG_PANEL_MARGIN 边距）。 */
  function debugPanelSizeBounds(): { minW: number; minH: number; maxW: number; maxH: number } {
    const viewportW = window.innerWidth || document.documentElement?.clientWidth || 0
    const viewportH = window.innerHeight || document.documentElement?.clientHeight || 0
    return {
      minW: DEBUG_PANEL_MIN_W,
      minH: DEBUG_PANEL_MIN_H,
      maxW: Math.max(DEBUG_PANEL_MIN_W, viewportW - DEBUG_PANEL_MARGIN * 2),
      maxH: Math.max(DEBUG_PANEL_MIN_H, viewportH - DEBUG_PANEL_MARGIN * 2),
    }
  }

  /** 把几何夹进视口：先收敛宽高，再把整块面板拉回 DEBUG_PANEL_MARGIN 边距内（纯视口坐标，不碰层坐标）。 */
  function clampDebugPanelGeometry(geometry: DebugPanelGeometry): DebugPanelGeometry {
    const { minW, minH, maxW, maxH } = debugPanelSizeBounds()
    const viewportW = window.innerWidth || document.documentElement?.clientWidth || 0
    const viewportH = window.innerHeight || document.documentElement?.clientHeight || 0
    const width = Math.round(Math.min(Math.max(geometry.width, minW), maxW))
    const height = Math.round(Math.min(Math.max(geometry.height, minH), maxH))
    const maxLeft = Math.max(DEBUG_PANEL_MARGIN, viewportW - DEBUG_PANEL_MARGIN - width)
    const maxTop = Math.max(DEBUG_PANEL_MARGIN, viewportH - DEBUG_PANEL_MARGIN - height)
    return {
      left: Math.round(Math.min(Math.max(geometry.left, DEBUG_PANEL_MARGIN), maxLeft)),
      top: Math.round(Math.min(Math.max(geometry.top, DEBUG_PANEL_MARGIN), maxTop)),
      width,
      height,
    }
  }

  /** 读一次本地记住的手动几何（隐私模式/无 localStorage 视为没记过）。 */
  function readDebugPanelGeometry(): DebugPanelGeometry | null {
    if (debugPanelGeometryLoaded) return debugPanelManual
    debugPanelGeometryLoaded = true
    try {
      const raw = window.localStorage.getItem(DEBUG_PANEL_STORE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as Partial<DebugPanelGeometry>
      const values = [parsed.left, parsed.top, parsed.width, parsed.height].map((value) => Number(value))
      if (!values.every((value) => Number.isFinite(value))) return null
      debugPanelManual = { left: values[0], top: values[1], width: values[2], height: values[3] }
    } catch { /* 读不到就当没记过，回落到自动跟随 */ }
    return debugPanelManual
  }

  /** 手动几何写回本地；null = 清除记录（回到自动跟随）。 */
  function writeDebugPanelGeometry(): void {
    try {
      if (debugPanelManual) window.localStorage.setItem(DEBUG_PANEL_STORE_KEY, JSON.stringify(debugPanelManual))
      else window.localStorage.removeItem(DEBUG_PANEL_STORE_KEY)
    } catch { /* 写不进去只影响下次记忆，不影响当前摆放 */ }
  }

  /** 面板当前几何（视口 px）：手动模式取记录值，自动模式量一次 rect（拖动起始时无缝接管）。 */
  function currentDebugPanelGeometry(): DebugPanelGeometry | null {
    if (debugPanelManual) return { ...debugPanelManual }
    if (!debugEl) return null
    let rect: DOMRect
    try { rect = debugEl.getBoundingClientRect() } catch { return null }
    if (!(rect.width > 0 && rect.height > 0)) return null
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  }

  /** 把手动几何落到面板样式：视口坐标换算成 layer 内坐标再写，并记录顶部/底部供气泡避让。 */
  function applyDebugPanelGeometry(geometry: DebugPanelGeometry): void {
    if (!debugEl) return
    const rect = layerRect()
    const originLeft = rect ? rect.left : 0
    const originTop = rect ? rect.top : 0
    debugEl.style.left = `${Math.round(geometry.left - originLeft)}px`
    debugEl.style.top = `${Math.round(geometry.top - originTop)}px`
    debugEl.style.width = `${geometry.width}px`
    debugEl.style.height = `${geometry.height}px`
    debugEl.style.maxHeight = 'none'
    panelSizeCache = { width: geometry.width, height: geometry.height }
    debugPanelTopLogical = geometry.top - originTop
    debugPanelBottomLogical = geometry.top - originTop + geometry.height
  }

  /** 恢复自动跟随（标题栏 ↺ / 双击标题栏）：清掉手动几何与本地记录，重新按模型定位。 */
  function resetDebugPanelGeometry(): void {
    if (!debugPanelManual) return
    debugPanelManual = null
    writeDebugPanelGeometry()
    invalidateLayout()
    syncDebugPanelWidth()
    updateDebugPanelPosition()
  }

  /**
   * 面板拖动/缩放（spec §2 / ADR-044）：mode='move' 为标题栏拖动，否则按四角缩放。
   * 拖动过程只改内存与样式（不写盘、不触发重排循环），松手才落 localStorage。
   */
  function bindDebugPanelPointer(handle: HTMLElement, mode: 'move' | PanelCorner): void {
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      // 标题栏上的按钮（↺）自己处理点击，不当作拖动
      if (mode === 'move' && (event.target as HTMLElement | null)?.closest('button')) return
      const start = currentDebugPanelGeometry()
      if (!start) return
      event.preventDefault()
      event.stopPropagation()
      const startX = event.clientX
      const startY = event.clientY
      // 拖过 2px 才算拖动：单击标题栏不会把面板「粘」到鼠标上
      let dragging = false
      const onMove = (moveEvent: PointerEvent): void => {
        const dx = moveEvent.clientX - startX
        const dy = moveEvent.clientY - startY
        if (!dragging && Math.abs(dx) + Math.abs(dy) < 2) return
        dragging = true
        let next: DebugPanelGeometry
        if (mode === 'move') {
          next = { ...start, left: start.left + dx, top: start.top + dy }
        } else {
          const { minW, minH, maxW, maxH } = debugPanelSizeBounds()
          const right = start.left + start.width
          const bottom = start.top + start.height
          const rawWidth = mode === 'nw' || mode === 'sw' ? start.width - dx : start.width + dx
          const rawHeight = mode === 'nw' || mode === 'ne' ? start.height - dy : start.height + dy
          const width = Math.round(Math.min(Math.max(rawWidth, minW), maxW))
          const height = Math.round(Math.min(Math.max(rawHeight, minH), maxH))
          // 拖左上角时右/下边固定：宽高被夹住后由固定边反推 left/top，把手才跟得住鼠标
          next = {
            left: mode === 'nw' || mode === 'sw' ? right - width : start.left,
            top: mode === 'nw' || mode === 'ne' ? bottom - height : start.top,
            width,
            height,
          }
        }
        debugPanelManual = clampDebugPanelGeometry(next)
        applyDebugPanelGeometry(debugPanelManual)
      }
      const finish = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', finish)
        if (!dragging) return
        writeDebugPanelGeometry()
        invalidateLayout()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', finish)
    })
  }

  /** 调试面板宽度/最大高度（浮层不占布局，spec §2）：宽度 min(280, 画布逻辑宽度-16)，
   *  最大高度 min(420, 视口高*0.5)，内容区自己滚动，避免面板过高无处放。
   *  用户拖过角（手动几何）后不再按画布回写，宽高完全由用户决定（ADR-044）。 */
  function syncDebugPanelWidth(): void {
    if (!debugEl) return
    if (debugPanelManual) {
      applyDebugPanelGeometry(clampDebugPanelGeometry(debugPanelManual))
      return
    }
    // append 阶段 PIXI app 尚未创建，此时 canvas 属性本身就是逻辑尺寸
    const canvasWidth = app ? logicalCanvasSize().width : (canvas?.width ?? pos.size)
    const width = Math.max(120, Math.min(280, Math.round(canvasWidth - 16)))
    debugEl.style.width = `${width}px`
    debugEl.style.boxSizing = 'border-box'
    // 高度回到内容自适应：手动模式写过的 px 高必须清掉，否则恢复自动跟随后面板缩不回去
    debugEl.style.removeProperty('height')
    debugEl.style.maxHeight = `${Math.max(80, Math.min(420, Math.round(window.innerHeight * 0.5)))}px`
  }

  /**
   * 调试面板定位（spec §2）：
   * - 自动模式（默认）：浮在模型包围盒**上方**（不覆盖角色），允许伸出画布留白/画布上边缘
   *   （逻辑 top 可为负），但整体保持在视口内。用 petLayer 的视口 rect 换算：
   *   期望视口 top = rect.top + bounds.y - 8 - panelHeight，clamp 到 [8, innerHeight-panelH-8]，
   *   再换算回 petLayer 逻辑 top = clampedTop - rect.top；水平同理。
   * - 手动模式（用户拖过标题栏/角）：位置与大小都由用户决定，只在视口变化时重新夹回屏幕内。
   * 每帧由命中层 rAF 调用，并记录顶部/底部供气泡避让。
   */
  function updateDebugPanelPosition(boundsArg?: { x: number; y: number; width: number; height: number } | null): void {
    debugPanelTopLogical = Number.NaN
    debugPanelBottomLogical = Number.NaN
    if (!debugEl || !petLayer || debugEl.parentNode !== petLayer || !model) return
    // 手动模式不跟随模型：只保证整块面板还在视口里（窗口缩放/角色挪动后也不丢）
    if (debugPanelManual) {
      applyDebugPanelGeometry(clampDebugPanelGeometry(debugPanelManual))
      return
    }
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
    const maxViewportTop = Math.max(DEBUG_PANEL_MARGIN, window.innerHeight - panelHeight - DEBUG_PANEL_MARGIN)
    const viewportTop = Math.min(Math.max(rect.top + bounds.y - 8 - panelHeight, DEBUG_PANEL_MARGIN), maxViewportTop)
    // 水平：面板居中对齐模型，限制在视口内
    const maxViewportLeft = Math.max(DEBUG_PANEL_MARGIN, window.innerWidth - panelWidth - DEBUG_PANEL_MARGIN)
    const viewportLeft = Math.min(
      Math.max(rect.left + bounds.x + bounds.width / 2 - panelWidth / 2, DEBUG_PANEL_MARGIN),
      maxViewportLeft,
    )
    const top = viewportTop - rect.top
    const left = viewportLeft - rect.left
    debugEl.style.left = `${left}px`
    debugEl.style.top = `${top}px`
    debugPanelTopLogical = top
    debugPanelBottomLogical = top + panelHeight
  }

  // ---- 调试控制台（ADR-043）：开启记录后显示所有客户端事件与 LLM/TTS 原始报文 ----
  /** 是否在记录（关闭即清空缓冲区与 DOM）。 */
  let conRecording = false
  /** 控制台滚动区（面板重建时随之重建）。 */
  let conBody: HTMLDivElement | null = null
  /** 记录行上限：超出从头部丢弃，避免长时间开启吃内存。 */
  const CON_MAX_LINES = 300
  /** 单行原文字符上限（完整请求报文含 system 提示词，可能上万字符）。 */
  const CON_LINE_MAX = 20_000
  /** 控制台可视高度：固定 20 行，超出滚动。 */
  const CON_VIEW_LINES = 20
  /** 控制台行高（px）：font 11px 与 scrollTop 计算共用同一值。 */
  const CON_LINE_HEIGHT = 16
  /** 「复制」按钮的临时文案计时器（只在点过按钮后短暂存在，面板关闭/再次点击即清）。 */
  let conCopyTimer = 0

  /** 复制文本到剪贴板：优先 Clipboard API（https / localhost 才有），失败回落到 textarea + execCommand。 */
  async function copyToClipboard(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        return true
      }
    } catch { /* 权限被拒 / 非安全上下文：走兜底 */ }
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(area)
      return ok
    } catch { return false }
  }

  function conClock(): string {
    const now = new Date()
    const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
    return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`
  }

  /** 追加一条原始报文（未开启记录时直接丢弃）。 */
  function conPush(tag: string, text: string): void {
    if (!conRecording || !conBody) return
    const line = document.createElement('div')
    line.style.cssText = 'white-space:pre-wrap;word-break:break-all;color:#cfd6e6;border-bottom:1px solid rgba(128,128,128,.1);padding:2px 0'
    const time = document.createElement('span')
    time.style.cssText = 'color:#6f7c93'
    time.textContent = `${conClock()} `
    const kind = document.createElement('span')
    kind.style.cssText = 'color:#78aaff;font-weight:600'
    kind.textContent = `${tag} `
    line.appendChild(time)
    line.appendChild(kind)
    line.appendChild(document.createTextNode(text.slice(0, CON_LINE_MAX)))
    conBody.appendChild(line)
    while (conBody.childElementCount > CON_MAX_LINES) conBody.removeChild(conBody.firstElementChild as Element)
    // 贴着底部时才自动滚动，翻上去看历史时不打断
    if (conBody.scrollHeight - conBody.scrollTop - conBody.clientHeight < 40) conBody.scrollTop = conBody.scrollHeight
  }

  /** 「开始/停止记录」：停止只暂停追加，已记录内容保留（要清用「清空」按钮）。 */
  function setConsoleRecording(next: boolean): void {
    conRecording = next
    clientLog('info', `console recording ${next ? 'on' : 'off'}`)
  }

  /** 控制台当前全部记录（按行拼接）：DOM 就是缓冲区，逐行取 innerText 保留「时间 标签 原文」。 */
  function consoleText(): string {
    if (!conBody) return ''
    const lines: string[] = []
    for (const child of Array.from(conBody.children)) {
      const element = child as HTMLElement
      const text = element.innerText ?? element.textContent ?? ''
      if (text.trim()) lines.push(text.replace(/\n+$/, ''))
    }
    return lines.join('\n')
  }

  /** 追加一条报文（JSON 两空格缩进：自读，也方便整段复制出去比对）。 */
  function conPushJson(tag: string, value: unknown): void {
    let text: string
    try {
      text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    } catch {
      text = String(value)
    }
    conPush(tag, text)
  }

  /**
   * SSE 帧 → 控制台一行（ADR-043）：顺序即到达顺序，也就是真实发生顺序。
   * `debug` 帧由 Host 在「请求发出 / 回复收全 / 合成返回」的时刻推来，原样展开；
   * 音频帧只报大小（完整 base64 没有可读性）。
   */
  function conPushFrame(event: string, data: unknown): void {
    if (!conRecording) return
    // 逐字增量没有独立信息量：完整回复在 llm.reply 里已整段给出
    if (event === 'text') return
    if (event === 'debug') {
      const step = data as Partial<DebugTraceStep> | null
      if (step && typeof step.phase === 'string') {
        conPushJson(step.phase, step.data ?? step)
        return
      }
      conPushJson('debug', data)
      return
    }
    if (event === 'audio') {
      const item = data as { index?: unknown; mime?: unknown; data?: unknown }
      const bytes = typeof item.data === 'string' ? Math.round((item.data.length * 3) / 4) : 0
      conPushJson('tts.audio.delta', { index: item.index, mime: item.mime, bytes })
      return
    }
    conPushJson(event, data)
  }

  /** 调试面板动态开关（spec §2）。 */
  function ensureDebugPanel(show: boolean): void {
    if (show && !debugEl && box) {
      // 首次建面板时恢复上次拖出来的位置/大小（spec §2 / ADR-044）
      readDebugPanelGeometry()
      debugEl = document.createElement('div')
      debugEl.style.cssText = `position:absolute;z-index:5;pointer-events:auto;display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;background:rgba(24,26,36,.94);color:#e8eaf0;border:1px solid rgba(128,128,128,.22);border-radius:10px;font:12px/1.5 ui-monospace,monospace;box-shadow:0 4px 16px rgba(0,0,0,.35);min-width:${DEBUG_PANEL_MIN_W}px;min-height:${DEBUG_PANEL_MIN_H}px`

      // 标题栏=拖动把手：按住拖动改位置、双击恢复自动跟随；右侧 ↺ 同效
      const debugHeader = document.createElement('div')
      debugHeader.style.cssText = 'display:flex;align-items:center;gap:6px;flex:0 0 auto;padding:6px 6px 6px 10px;background:rgba(255,255,255,.045);border-bottom:1px solid rgba(128,128,128,.16);cursor:move;user-select:none;-webkit-user-select:none;touch-action:none'
      debugHeader.title = '拖动标题栏移动面板，拖四角改大小，双击标题栏回到自动跟随'
      const debugTitle = document.createElement('div')
      debugTitle.style.cssText = 'flex:1 1 auto;min-width:0;font-size:12px;font-weight:600;color:#aeb8cc;letter-spacing:.3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
      debugTitle.textContent = '调试面板'
      const debugReset = document.createElement('button')
      debugReset.type = 'button'
      debugReset.textContent = '↺'
      debugReset.title = '恢复自动跟随（回到模型上方）'
      debugReset.style.cssText = 'flex:0 0 auto;width:18px;height:18px;padding:0;display:grid;place-items:center;border:none;border-radius:5px;background:rgba(128,128,128,.16);color:#c8d1e2;font-size:12px;line-height:1;cursor:pointer;outline:none'
      debugReset.onmouseenter = () => { debugReset.style.background = 'rgba(120,170,255,.28)' }
      debugReset.onmouseleave = () => { debugReset.style.background = 'rgba(128,128,128,.16)' }
      debugReset.onclick = () => { resetDebugPanelGeometry() }
      // 双击标题栏 = 恢复自动跟随（拖一次就手动接管了，给一个不藏起来的手势）
      debugHeader.ondblclick = () => { resetDebugPanelGeometry() }
      debugHeader.appendChild(debugTitle)
      debugHeader.appendChild(debugReset)
      debugEl.appendChild(debugHeader)
      bindDebugPanelPointer(debugHeader, 'move')

      // 内容区：手动模式下高度被固定，内容自己滚动，标题栏不会跟着滚走
      const debugBody = document.createElement('div')
      debugBody.style.cssText = 'flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:8px 10px;box-sizing:border-box'
      debugEl.appendChild(debugBody)

      // 四角缩放把手（右下角有可见斜纹，其余三角透明但可拖）
      for (const corner of ['nw', 'ne', 'sw', 'se'] as const) {
        const grip = document.createElement('div')
        const horizontal = corner === 'nw' || corner === 'sw' ? 'left' : 'right'
        const vertical = corner === 'nw' || corner === 'ne' ? 'top' : 'bottom'
        grip.style.cssText = `position:absolute;${horizontal}:0;${vertical}:0;width:14px;height:14px;z-index:6;cursor:${corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize'};touch-action:none`
        grip.title = '拖动改面板大小'
        if (corner === 'se') {
          grip.style.background = 'linear-gradient(135deg,transparent 0 55%,rgba(150,180,230,.5) 55% 62%,transparent 62% 72%,rgba(150,180,230,.5) 72% 79%,transparent 79%)'
        }
        bindDebugPanelPointer(grip, corner)
        debugEl.appendChild(grip)
      }

      const sectionLabel = (text: string): HTMLDivElement => {
        const el = document.createElement('div')
        el.style.cssText = 'margin:10px 0 4px;color:#7f8aa0;font-size:11px;font-weight:600;letter-spacing:.3px'
        el.textContent = text
        return el
      }

      // 场景演示：下拉选触发场景 + 播放按钮（与动画/表情预览同一套交互）
      // 走真实触发链路（fireTrigger force）：台词/动作/表情/语音全由 AI 按该场景即兴决定
      debugBody.appendChild(sectionLabel('场景演示'))
      const demoSelect = document.createElement('select')
      demoSelect.style.cssText = 'flex:1;min-width:0;background:#1c1e28;color:#e8eaf0;border:1px solid rgba(128,128,128,.3);border-radius:6px;font-size:12px;padding:4px 6px;outline:none'
      for (const event of TRIGGER_EVENTS) {
        const option = document.createElement('option')
        option.value = event
        option.textContent = TRIGGER_EVENT_LABELS[event] ?? event
        demoSelect.appendChild(option)
      }
      const demoPlay = document.createElement('button')
      demoPlay.textContent = '播放'
      demoPlay.style.cssText = 'padding:4px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;background:rgba(120,170,255,.28);color:#e8eaf0;border:1px solid rgba(120,170,255,.35);outline:none'
      demoPlay.onmouseenter = () => { demoPlay.style.background = 'rgba(120,170,255,.4)' }
      demoPlay.onmouseleave = () => { demoPlay.style.background = 'rgba(120,170,255,.28)' }
      const playScenario = (): void => {
        const event = demoSelect.value
        if (!event) return
        clientLog('info', `demo scenario | ${event}`)
        fireTrigger({ kind: 'event', event }, { force: true })
      }
      demoSelect.onchange = playScenario
      demoPlay.onclick = playScenario
      const demoRow = document.createElement('div')
      demoRow.style.cssText = 'display:flex;gap:6px;align-items:center'
      demoRow.appendChild(demoSelect)
      demoRow.appendChild(demoPlay)
      debugBody.appendChild(demoRow)

      // 动画预览：原生动画下拉 + 播放按钮
      const motionLabel = sectionLabel('动画预览')
      debugBody.appendChild(motionLabel)
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
      debugBody.appendChild(motionRow)

      // 表情预览：下拉选择 + 播放按钮（与动画预览同一套交互）；应用后常驻，选「无」恢复默认脸
      debugBody.appendChild(sectionLabel('表情预览'))
      const exprSelect = document.createElement('select')
      exprSelect.style.cssText = 'flex:1;min-width:0;background:#1c1e28;color:#e8eaf0;border:1px solid rgba(128,128,128,.3);border-radius:6px;font-size:12px;padding:4px 6px;outline:none'
      for (const expression of EXPRESSIONS) {
        const option = document.createElement('option')
        option.value = expression.id
        option.textContent = expression.name
        exprSelect.appendChild(option)
      }
      /** 下拉框跟随当前生效的表情（外部改动/面板重建后同步）。 */
      const syncExprSelect = (): void => { exprSelect.value = debugExpression ?? 'none' }
      /** 应用下拉框当前项：'none' 即清掉预览表情，回到默认脸。 */
      const applyDebugExpression = (): void => {
        const next = exprSelect.value === 'none' ? null : exprSelect.value
        if (next === debugExpression) { syncExprSelect(); return }
        debugExpression = next
        refreshExpressionTargets()
        syncExprSelect()
      }
      repaintDebugExpressions = syncExprSelect
      const exprPlay = document.createElement('button')
      exprPlay.textContent = '播放'
      exprPlay.style.cssText = 'padding:4px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;background:rgba(120,170,255,.28);color:#e8eaf0;border:1px solid rgba(120,170,255,.35);outline:none'
      exprPlay.onmouseenter = () => { exprPlay.style.background = 'rgba(120,170,255,.4)' }
      exprPlay.onmouseleave = () => { exprPlay.style.background = 'rgba(120,170,255,.28)' }
      exprSelect.onchange = applyDebugExpression
      exprPlay.onclick = applyDebugExpression
      const exprRow = document.createElement('div')
      exprRow.style.cssText = 'display:flex;gap:6px;align-items:center'
      exprRow.appendChild(exprSelect)
      exprRow.appendChild(exprPlay)
      syncExprSelect()
      debugBody.appendChild(exprRow)

      // 控制台（ADR-043）：开启后记录所有事件与 LLM/TTS 原始报文
      debugBody.appendChild(sectionLabel('控制台'))
      const conRow = document.createElement('div')
      conRow.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap'
      const conToggle = document.createElement('button')
      conToggle.textContent = '开始记录'
      conToggle.style.cssText = 'padding:4px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;background:rgba(120,170,255,.28);color:#e8eaf0;border:1px solid rgba(120,170,255,.35);outline:none'
      const conClear = document.createElement('button')
      conClear.textContent = '清空'
      conClear.style.cssText = 'padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;background:rgba(128,128,128,.14);color:#dbe2ef;border:1px solid rgba(128,128,128,.3);outline:none'
      // 一键复制：把当前全部记录按行拼成纯文本，粘贴到别处排查/贴 issue
      const conCopy = document.createElement('button')
      conCopy.textContent = '复制'
      conCopy.style.cssText = 'padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;background:rgba(128,128,128,.14);color:#dbe2ef;border:1px solid rgba(128,128,128,.3);outline:none'
      const flashConCopy = (label: string): void => {
        conCopy.textContent = label
        if (conCopyTimer) window.clearTimeout(conCopyTimer)
        conCopyTimer = window.setTimeout(() => { conCopy.textContent = '复制'; conCopyTimer = 0 }, 1200)
      }
      conCopy.onclick = (): void => {
        const text = consoleText()
        if (!text) { flashConCopy('无内容'); return }
        void copyToClipboard(text).then((ok) => flashConCopy(ok ? '已复制' : '复制失败'))
      }
      const conState = document.createElement('span')
      conState.style.cssText = 'color:#7f8aa0;font-size:11px'
      const paintConState = (): void => {
        conToggle.textContent = conRecording ? '停止记录' : '开始记录'
        conToggle.style.background = conRecording ? 'rgba(120,255,170,.26)' : 'rgba(120,170,255,.28)'
        // 停止记录只暂停追加：有内容时提示保留，避免误以为「停了就没了」
        const hasLines = (conBody?.childElementCount ?? 0) > 0
        conState.textContent = conRecording ? '记录中' : hasLines ? '已暂停（内容保留）' : '未记录'
      }
      paintConState()
      conToggle.onclick = () => { setConsoleRecording(!conRecording); paintConState() }
      conClear.onclick = () => { if (conBody) conBody.textContent = ''; paintConState() }
      conRow.appendChild(conToggle)
      conRow.appendChild(conClear)
      conRow.appendChild(conCopy)
      conRow.appendChild(conState)
      debugBody.appendChild(conRow)
      conBody = document.createElement('div')
      // 固定 20 行高（content-box，不含 padding/border），内容超出滚动；行高与字体统一写死，便于按行数算高度
      conBody.style.cssText = `margin-top:6px;height:${CON_VIEW_LINES * CON_LINE_HEIGHT}px;line-height:${CON_LINE_HEIGHT}px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;background:rgba(0,0,0,.32);border:1px solid rgba(128,128,128,.18);border-radius:6px;padding:6px;font:11px/${CON_LINE_HEIGHT}px ui-monospace,monospace;color:#cfd6e6`
      debugBody.appendChild(conBody)

      // 状态信息：与上方区域分隔
      debugTextEl = document.createElement('div')
      debugTextEl.style.cssText = 'margin-top:10px;padding-top:8px;border-top:1px solid rgba(128,128,128,.18);color:#9aa5b8;font-size:11px;white-space:pre-wrap;word-break:break-all'
      debugBody.appendChild(debugTextEl)
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
      conBody = null
      conRecording = false
      if (conCopyTimer) { window.clearTimeout(conCopyTimer); conCopyTimer = 0 }
      // 手动几何留在内存与 localStorage 里：下次开面板还回原位（ADR-044）
      debugPanelTopLogical = Number.NaN
      debugPanelBottomLogical = Number.NaN
    } else if (show && debugEl && !debugEl.parentNode) {
      // 模型层重建/降级后浮层可能被摘掉：重新挂回（绝对定位不占布局）
      if (petLayer) petLayer.appendChild(debugEl)
      else if (box) box.appendChild(debugEl)
      updateDebugPanelPosition()
    }
  }

  /** 当前应显示的表情 id 列表（ADR-037）：调试预览 > AI 标签表情；无则空（默认脸）。 */
  function desiredExpressions(): string[] {
    if (tempExpressions.length > 0) {
      if (Date.now() < tempExpressionUntil) return tempExpressions
      tempExpressions = []
    }
    if (debugExpression) {
      const id = normalizeExpressionId(debugExpression)
      return id === 'none' ? [] : [id]
    }
    return []
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
      // 表情演完：若没有动作在播，恢复鼠标跟随
      releaseFocusSuppression()
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
    const nextTriggerMode = normalizeTriggerMode(cfg.triggerMode, triggerMode)
    const nextMinInterval = Number.isFinite(cfg.aiMinIntervalSec) ? cfg.aiMinIntervalSec! : aiMinIntervalSec
    const nextIdleTimeout = Number.isFinite(cfg.idleTimeoutSec) ? cfg.idleTimeoutSec! : idleTimeoutSec
    const nextTriggers = (cfg.eventTriggers && typeof cfg.eventTriggers === 'object')
      ? cfg.eventTriggers
      : eventTriggers
    const scheduleChanged = nextTriggerMode !== triggerMode
      || nextMinInterval !== aiMinIntervalSec
      || nextIdleTimeout !== idleTimeoutSec
    triggerMode = nextTriggerMode
    aiMinIntervalSec = Math.max(0, nextMinInterval)
    idleTimeoutSec = Math.max(0, nextIdleTimeout)
    eventTriggers = nextTriggers
    if (scheduleChanged) scheduleIdleTimer()
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
    focusRangePct = normalizeFocusRange(cfg.focusRange, DEFAULT_SETTINGS.focusRange)
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
    clearHover()
    down = { x: e.clientX, y: e.clientY, startRight: pos.right, startBottom: pos.bottom }
    dragging = false
    tapDownAt = Date.now()
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
    }
    down = null
    dragging = false
  }

  // ---- 鼠标跟随（spec §4）：全局 pointermove，头/眼/身体看向鼠标 ----
  function handleGlobalPointerMove(e: PointerEvent): void {
    lastPointerClient = { x: e.clientX, y: e.clientY }
    // 非 idle 动作播放期间抑制 focus，避免动作关键帧被鼠标跟随叠加（spec §4）
    if (!model || !canvas || dragging || !petShown() || hidden || !windowFocused || focusSuppressed) return
    applyFocus(e.clientX, e.clientY)
  }
  function handleGlobalMouseOut(e: MouseEvent): void {
    // 仅当真正离开页面/窗口时复位；元素间移动会冒泡 mouseout，需排除 relatedTarget 非空
    if (e.relatedTarget) return
    lastPointerClient = null
    focusInRange = true
    if (!model || dragging || !petShown() || hidden) return
    // 非 idle 动作期间 focus 已被归零并抑制，不需要额外复位
    if (!focusSuppressed) {
      // 复位正视前方：FocusController 吃 [-1,1] 归一化目标，直接归零
      model.internalModel?.focusController?.focus(0, 0, true)
    }
  }

  /**
   * 一次性 AI 回复（ADR-025/037）：/interact 拿一句台词 + 动作/表情标签。
   * 由 startTurn 统一调度（触发过滤/冷却/合并都在那边）；本函数只负责发请求与落地结果。
   */
  async function requestAiReply(input: TriggerBody): Promise<string | null> {
    const seq = ++aiRequestSeq
    try {
      const result = await api.interact(input)
      if (conRecording) {
        // 一次性响应：链路记录随响应回带，按数组顺序补进控制台（ADR-043）
        for (const step of result.trace ?? []) conPushJson(step.phase, step.data)
        conPushJson('interact.result', { ok: result.ok, text: result.text, error: result.error })
      }
      if (seq !== aiRequestSeq) return null
      if (!result.ok || !result.text) return null
      applyTags(result.expressions, result.motions)
      showAiBubble(result.text)
      return result.text
    } catch {
      // AI 失败 = 完全静默（ADR-037 决策）：不出气泡不播动作
      return null
    }
  }

  /**
   * 流式演绎（ADR-033/037）：/speak 下发 text/clause/audio/tags/memory/done/error。
   * 气泡按「音频播到第几段」逐段显示，口型吃同一段音频的波形，tags 立刻换表情/动作。
   * 由 startTurn 统一调度；语音关闭时回落到一次性回复。
   */
  async function requestSpeak(input: TriggerBody): Promise<string | null> {
    const withTz = CLIENT_TIME_ZONE ? { ...input, tz: CLIENT_TIME_ZONE } : input
    if (!ttsEnabled) return requestAiReply(withTz)
    const seq = ++speakSeq
    // 作废可能在飞的 /interact 结果，避免两句台词抢同一个气泡
    aiRequestSeq += 1
    const controller = new AbortController()
    speakAbort = controller
    speakClauses = []
    speakRevealed = -1
    speakChain = Promise.resolve()
    let finalText: string | null = null
    let sawClause = false
    try {
      await api.speak(withTz, (event, data) => {
        conPushFrame(event, data)
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
            const seconds = await playClip(item.data as string, mime)
            conPushJson('play.audio', {
              index,
              mime,
              seconds: seconds === null ? null : Math.round(seconds * 100) / 100,
            })
          })
          return
        }
        if (event === 'tags') {
          const payload = data as { expressions?: unknown; motions?: unknown }
          applyTags(payload.expressions, payload.motions)
          return
        }
        if (event === 'memory') {
          // 记忆行由 Host 落盘 memory.md（ADR-037）；客户端只记日志
          const payload = data as { note?: unknown }
          clientLog('info', 'memory noted', typeof payload.note === 'string' ? payload.note : '')
          return
        }
        if (event === 'done') {
          const payload = data as { text?: unknown }
          finalText = typeof payload.text === 'string' ? payload.text : null
          return
        }
        if (event === 'error') {
          // 交给下面的兜底判断：一句都没有就完全静默
          return
        }
      }, controller.signal)
    } catch {
      // 连接失败/中止：同样静默
    }
    if (seq !== speakSeq) return null
    await speakChain.catch(() => undefined)
    if (seq !== speakSeq) return null
    if (!sawClause && finalText === null) {
      // 失败/零文本 = 完全静默（ADR-037）：不回落固定台词（已不存在）
      return null
    }
    // 合成失败被跳过的段也要补上文字
    revealAllClauses()
    if (finalText !== null) {
      showAiBubble(finalText)
      return finalText
    }
    return null
  }

  /**
   * AI 标签落地（ADR-037）：`[表情][动作]` 目录标签 → 临时表情 + 一次动作。
   * 目录外的 id 直接忽略（不让模型幻觉参数写进渲染层）；为空则什么都不做。
   */
  function applyTags(expressions: unknown, motions: unknown): void {
    // 真实表情优先：清掉调试面板残留的预览选择，免得把 AI 表情挡掉
    debugExpression = null
    const list = Array.isArray(expressions)
      ? expressions.filter((item): item is string => typeof item === 'string' && isExpressionId(item))
      : []
    if (list.length > 0) {
      clientLog('info', 'ai expressions', list.join('+'))
      conPushJson('play.expression', { applied: list })
      holdTemporaryExpression(list)
    }
    const motionList = Array.isArray(motions)
      ? motions.filter((item): item is string => typeof item === 'string' && isMotionId(item))
      : []
    if (motionList.length > 0 && model && !dragging && !previewActive && !hidden) {
      clientLog('info', 'ai motions', motionList.join('+'))
      conPushJson('play.motion', { applied: motionList })
      void playInteractionMotion(motionList)
    }
  }

  /**
   * 设置页预览（ADR-040 修订）：动作走互动动作通道播一次；表情走临时表情通道
   * （与 AI 标签同一套落地逻辑，`TAG_EXPRESSION_HOLD_MS` 后回到常态）。
   */
  function previewCatalog(target: CatalogPreview): void {
    if (target.kind === 'expression') {
      if (!isExpressionId(target.id)) return
      debugExpression = null
      holdTemporaryExpression([target.id])
      clientLog('info', 'preview expression', target.id)
      return
    }
    if (!isMotionId(target.id)) return
    clientLog('info', 'preview motion', target.id)
    void playInteractionMotion([target.id])
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
      // 触摸交互（ADR-038 修订）：只认部位自定义交互，没有匹配的交互就不触发。
      const durationMs = tapDownAt > 0 ? Math.max(0, now - tapDownAt) : 0
      const fireTap = (clickCount: number): void => {
        const picked = pickTapInteraction(part, clickCount)
        // 部位没配交互 = 这个部位不参与互动（ADR-038 修订）：不再回落到时长三档
        if (!picked) {
          clientLog('info', `tap | ${part.name} | 没有匹配的交互，忽略 ${durationMs}ms`)
          return
        }
        const input: TriggerBody = { kind: 'tap', part: part.name, interaction: picked.name }
        clientLog('info', `tap | ${part.name} | ${picked.name}(${picked.trigger}) ${durationMs}ms`)
        // 触摸必触发（不受事件开关/最小间隔限制），冷却由 fireTrigger 内部处理
        fireTrigger(input)
      }
      // 「停留」交互改由悬停触发（ADR-038 修订）：按压只结算单击/双击；
      // 没配双击的部位立即结算，保证跟手
      if (!hasDoubleInteraction(part)) {
        fireTap(1)
        return
      }
      // 有双击交互：第一次点击先压 300ms 看有没有第二下
      if (pendingDoublePart) {
        const previous = pendingDoublePart
        window.clearTimeout(previous.timer)
        pendingDoublePart = null
        if (previous.id === part.id) {
          fireTap(2)
          return
        }
        // 换了部位：把上一个部位欠着的单击立刻补掉，再压这一次
        previous.flush()
      }
      const timer = window.setTimeout(() => {
        pendingDoublePart = null
        fireTap(1)
      }, DOUBLE_TAP_MS)
      pendingDoublePart = { id: part.id, timer, flush: () => fireTap(1) }
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
        triggerMode = normalizeTriggerMode(view.config.triggerMode, triggerMode)
        aiMinIntervalSec = Number.isFinite(view.config.aiMinIntervalSec) ? Math.max(0, view.config.aiMinIntervalSec!) : aiMinIntervalSec
        activityWindowSec = Number.isFinite(view.config.activityWindowSec) ? Math.max(0, view.config.activityWindowSec!) : activityWindowSec
        tapGapMs = Number.isFinite(view.config.tapGapMs) ? Math.max(0, view.config.tapGapMs!) : tapGapMs
        mergeMax = Number.isFinite(view.config.mergeMax) ? Math.max(1, view.config.mergeMax!) : mergeMax
        idleTimeoutSec = Number.isFinite(view.config.idleTimeoutSec) ? Math.max(0, view.config.idleTimeoutSec!) : idleTimeoutSec
        eventTriggers = (view.config.eventTriggers && typeof view.config.eventTriggers === 'object')
          ? view.config.eventTriggers
          : eventTriggers
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
        focusRangePct = normalizeFocusRange(view.config.focusRange, DEFAULT_SETTINGS.focusRange)
        scheduleIdleTimer()
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
      const onVisibility = () => {
        hidden = document.visibilityState === 'hidden'
        // 隐藏即全停：停渲染、掐掉在播/在合成的语音（省算力），回来再重新计时
        if (hidden) stopSpeaking()
        else scheduleIdleTimer()
        syncTicker()
      }
      // 窗口失焦不再停渲染（ADR-042）：用户点到别处时角色继续动，只有标签页隐藏/最小化才暂停
      const onBlur = () => { windowFocused = false }
      const onFocus = () => { windowFocused = true }
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
