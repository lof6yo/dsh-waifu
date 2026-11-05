/**
 * dsh-waifu 浏览器半区：挂载 Live2D 桌宠 + 「桌宠配置」设置页。
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
import { clientLog } from './client-log.ts'
import {
  DEFAULT_EVENT_BINDINGS,
  EVENT_STAGE_DELAYS,
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
import { onTouchEdit, type TouchEditState } from './touch-edit.ts'
import { onRecenter } from './pet-commands.ts'

/** 注入所需服务。 */
export const inject = ['slots']

/** 点击/拖动判定阈值（px）。 */
const DRAG_THRESHOLD = 6
/** 点击互动防抖（ms）：仅挡同一次 pointer 误触双发，不等气泡播完（spec §4）。 */
const TAP_DEBOUNCE_MS = 80
/** 瞬态气泡显示时长（ms）：到时自动隐藏或回落阶段文案。 */
const BUBBLE_DISPLAY_MS = 2500
/**
 * 默认渲染帧率上限（spec §2/§7）：未封顶时 PIXI ticker 可达 120–140fps，
 * 长时间挂页会持续占满 GPU/主线程；桌宠动画默认 30fps 足够，用户可在设置中改档。
 */
const DEFAULT_MAX_FPS = 30

/**
 * 画布四周留白（模型可见尺寸之外，每侧）：百分比来自 settings.canvasPadX/Y（0–300，默认 125/50），
 * 实际留白 = max(CANVAS_PAD_MIN, size * pct / 100)。动作/物理甩尾（尾巴等）会超出模型静止包围盒，
 * 留白不足会被 canvas 裁切（spec §7）。
 */
const CANVAS_PAD_MIN = 40
/** 留白默认百分比（每侧）：Host 默认 125/50；首帧/旧快照缺字段时兜底。 */
const DEFAULT_CANVAS_PAD_X = 125
const DEFAULT_CANVAS_PAD_Y = 50

/** 气泡默认偏移（相对模型包围盒顶部中心）与默认配色（Host 默认 0/-10、#ffffff/92%/#222222）。 */
const DEFAULT_BUBBLE_OFFSET_X = 0
const DEFAULT_BUBBLE_OFFSET_Y = 10
const DEFAULT_BUBBLE_BG_COLOR = '#ffffff'
const DEFAULT_BUBBLE_BG_OPACITY = 92
const DEFAULT_BUBBLE_TEXT_COLOR = '#222222'

/** 默认位置（显示区中心点距右/距下，视口宽/高百分比；Host 默认 16/24，spec §2）。 */
const DEFAULT_HOME_RIGHT = 16
const DEFAULT_HOME_BOTTOM = 24

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
const EXPRESSION_TEMP_MS = 2200

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
    coreModel?: { setParameterValueById?(id: string, value: number, weight?: number): void }
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

/** 随机打乱（返回新数组，不改入参）。 */
function shuffled<T>(items: readonly T[]): T[] {
  const list = [...items]
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
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
  pushCleanup(() => { clearStages(); clearBubbleHideTimer() })
  pushCleanup(() => {
    if (sizeRaf) { window.cancelAnimationFrame(sizeRaf); sizeRaf = 0 }
    pendingSize = null
  })
  pushCleanup(() => { stopTouchboxLoop(); stopHitLayerLoop(); showTapZones = false; editState = null })
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
  let touchboxRaf = 0
  /** 命中层容器（点击穿透，spec §4）：覆盖 canvas，子 div 按触摸部位 box 定位并接收指针事件。 */
  let hitLayer: HTMLDivElement | null = null
  /** 命中 div ↔ 部位 box 归一化坐标的对应关系（每帧按 model.getBounds 更新 CSS 位置）。 */
  let hitBoxEntries: Array<{ el: HTMLDivElement; box: TouchBox }> = []
  /** 命中层逐帧位置更新循环（跟随模型动作/物理/尺寸）。 */
  let hitLayerRaf = 0
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
  let stageTimers: number[] = []
  let stagedState: PetState | null = null
  let stageIndex = 0
  let lastState: PetState | null = null
  let demoState: PetState | null = null
  let view: PetStateView | null = null
  let pos: DisplayLike = { right: 24, bottom: 20, size: 200 }
  // 画布每侧留白百分比（SSE config.canvasPadX/Y；0–300，默认 125/50；spec §7）
  let canvasPadXPct = DEFAULT_CANVAS_PAD_X
  let canvasPadYPct = DEFAULT_CANVAS_PAD_Y
  // 表情：挂在事件绑定/触摸部位上（motions 混选里的表情 id，可叠加）+ 触摸临时表情（spec §5）
  let tempExpressions: string[] = []
  let tempExpressionUntil = 0
  /** 调试面板「表情预览」强制显示的表情（null = 不干预）。 */
  let debugExpression: string | null = null
  /** 表达式开关参数当前混合值（每帧向目标逼近 → 淡入淡出）。 */
  const expressionMix = new Map<string, number>()
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
    // 隐藏时不跑命中层逐帧更新（盒容器也一起 display:none）
    if (petShown()) startHitLayerLoop()
    else stopHitLayerLoop()
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

  /** 应用气泡样式（背景 rgba / 文字色 / 最大宽度；不重建元素，spec §3）。 */
  function applyBubbleStyle(): void {
    if (!bubble) return
    bubble.style.background = colorWithOpacity(bubbleBgColor, bubbleBgOpacity)
    bubble.style.color = bubbleTextColor
    // 长文本换行且不超出屏幕（左右各留 12px）
    bubble.style.maxWidth = `${Math.max(80, Math.min(320, window.innerWidth - 24))}px`
  }

  /**
   * 气泡相对模型包围盒定位（spec §3）：气泡底部中点贴住
   * (bounds.x + width/2 + bubbleOffsetX, bounds.y - bubbleOffsetY)（画布逻辑 CSS px；
   * bubbleOffsetY 正值向上、负值向下），transform: translate(-50%, -100%) 由样式居中/贴底。
   * 调试面板可见时锚点上移到面板顶部再往上 6px；目标视口 y clamp 到 ≥8，避免跑出视口。
   */
  function updateBubblePosition(): void {
    if (!bubble) return
    if (!petLayer || bubble.parentNode !== petLayer) {
      // 无模型层（静态头像降级）时退回容器上方居中
      bubble.style.left = '50%'
      bubble.style.top = '0px'
      return
    }
    let bounds: { x: number; y: number; width: number; height: number } | null = null
    try {
      const b = model?.getBounds?.()
      if (b && b.width > 0 && b.height > 0) bounds = { x: b.x, y: b.y, width: b.width, height: b.height }
    } catch { /* 无包围盒 */ }
    if (!bounds) return
    const anchorX = bounds.x + bounds.width / 2 + bubbleOffsetX
    // 调试面板可见时气泡上移避让：锚点 = 面板顶部再往上 6px（spec §2）
    let anchorY = Number.isFinite(debugPanelTopLogical)
      ? debugPanelTopLogical - 6
      : bounds.y - bubbleOffsetY
    // 气泡目标视口 y clamp 到 ≥8（用 petLayer 视口 rect 换算，面板/模型贴顶时不跑出视口）
    try {
      const rect = petLayer.getBoundingClientRect()
      if (rect.top + anchorY < 8) anchorY = 8 - rect.top
    } catch { /* 无 rect 时保持原锚点 */ }
    bubble.style.left = `${anchorX}px`
    bubble.style.top = `${anchorY}px`
  }

  /** 显示常驻气泡文案：取消瞬态隐藏计时，气泡保持可见直到被取代。 */
  function setBubbleText(text: string): void {
    if (!bubble) return
    clearBubbleHideTimer()
    bubble.textContent = text
    bubble.style.opacity = '1'
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
    if (bubble) bubble.style.opacity = '0'
  }

  /** 重绘当前阶段文案（阶段推进/瞬态气泡到时回落/事件绑定变化或拖拽结束后恢复）。 */
  function showStageText(): void {
    if (!stagedState) return
    const line = pickEventLine(stagedState, stageIndex)
    if (line === undefined) { hideBubble(); return }
    setBubbleText(line)
  }

  /**
   * 瞬态气泡（交互/短状态，spec §3/§4）：立刻换文案并重置隐藏计时（连点可打断）；
   * 到时隐藏——若正处于阶段演进状态则回落到当前阶段文案（交互短暂抢占常驻气泡，过后归还）。
   */
  function showBubble(text: string): void {
    if (!bubble) return
    clearBubbleHideTimer()
    setBubbleText(text)
    bubbleHideTimer = window.setTimeout(() => {
      bubbleHideTimer = undefined
      if (stagedState) showStageText()
      else if (bubble) bubble.style.opacity = '0'
    }, BUBBLE_DISPLAY_MS)
  }

  /** 退出阶段演进状态：取消全部阶段计时并复位标记。 */
  function clearStages(): void {
    for (const t of stageTimers) window.clearTimeout(t)
    stageTimers = []
    stagedState = null
    stageIndex = 0
  }

  /** 进入阶段演进状态：立即显示阶段 0 并按偏移调度后续阶段（spec §3）。 */
  function enterStaged(state: PetState): void {
    clearStages()
    const delays = EVENT_STAGE_DELAYS[state]
    if (!delays || delays.length === 0) return
    stagedState = state
    stageIndex = 0
    showStageText()
    for (let i = 1; i < delays.length; i++) {
      stageTimers.push(window.setTimeout(() => {
        stageIndex = i
        // 拖拽中暂停气泡与动作（spec §4），阶段静默推进、松手后恢复新阶段
        if (!dragging) {
          showStageText()
          playState(state)
        }
      }, delays[i]))
    }
  }

  /** 按 client 坐标应用鼠标跟随（model.focus 吃 canvas 本地坐标）。 */
  function applyFocus(clientX: number, clientY: number): void {
    if (!model || !canvas) return
    const rect = canvas.getBoundingClientRect()
    model.focus(clientX - rect.left, clientY - rect.top)
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

  function applyState(next: PetStateView | null): void {
    const state = demoState ?? next?.state ?? 'idle'
    // 状态变化时播状态气泡与状态动作（spec §3）：长状态（思考/等审批）走
    // 阶段演进常驻气泡，短状态气泡瞬态显示；点击互动另走 handleTap（可连点打断）。
    // 动作只在状态变化（及长状态阶段推进）时触发；startMotionWithPriority 会先
    // stopAllMotions 再按优先级启动，保证状态动作可立即切换、阶段可重播。
    // 台词/动作均来自事件绑定（config.events），无固定人设、无默认回退。
    if (state !== lastState) {
      lastState = state
      if (EVENT_STAGE_DELAYS[state]) {
        enterStaged(state)
      } else {
        clearStages()
        const line = pickEventLine(state, 0)
        if (line !== undefined) showBubble(line)
        else hideBubble()
      }
      playState(state)
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
    if (sizeRaf) { window.cancelAnimationFrame(sizeRaf); sizeRaf = 0 }
    pendingSize = null
    stopTouchboxLoop()
    stopHitLayerLoop()
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
      // 表情：包装 InternalModel.update，在动作/物理生效前写入开关与连续参数（spec §5）
      const internal = loaded.internalModel
      if (internal && typeof internal.update === 'function') {
        const originalUpdate = internal.update.bind(internal)
        internal.update = (dt = 1 / 60, now = performance.now()) => {
          applyExpressionParams(internal.coreModel, dt)
          return originalUpdate(dt, now)
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

  /** 停止触摸部位叠加层重绘循环。 */
  function stopTouchboxLoop(): void {
    if (touchboxRaf) { window.cancelAnimationFrame(touchboxRaf); touchboxRaf = 0 }
  }

  /**
   * 绘制当前触摸部位的全部 box（spec §4）：编辑态用设置页草稿 parts，否则用已保存 parts。
   * box 归一化坐标（相对模型包围盒 0–1）换算成 canvas 像素矩形；半透明填充 + 部位名标签，
   * 不同部位按调色板循环取色，highlightPartId 高亮部位用更亮更粗的描边。
   */
  function paintTouchBoxes(): void {
    if (!touchboxOverlayVisible() || !touchboxOverlay || !canvas || !model) return
    const { width: w, height: h } = logicalCanvasSize()
    if (!(w > 0 && h > 0)) return
    resizeOverlay(w, h)
    const overlayScale = touchboxOverlay.width / w
    touchboxOverlay.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;pointer-events:none;z-index:2;display:block`
    const ctx = touchboxOverlay.getContext('2d')
    if (!ctx) return
    // 统一放大到缓冲坐标：包围盒/box 都是逻辑坐标，缩放后绘制保持清晰
    ctx.setTransform(overlayScale, 0, 0, overlayScale, 0, 0)
    ctx.clearRect(0, 0, w, h)
    let bounds: { x: number; y: number; width: number; height: number } | null = null
    try {
      const b = model.getBounds?.()
      if (b && b.width > 0 && b.height > 0) bounds = { x: b.x, y: b.y, width: b.width, height: b.height }
    } catch { /* 无包围盒 */ }
    if (!bounds) return
    const { x: bx, y: by, width: bw, height: bh } = bounds
    const parts = editState?.parts ?? touchParts
    const highlightId = editState?.highlightPartId ?? null
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

  /** 启动触摸部位叠加层重绘循环（跟随模型动作/尺寸变化，spec §4）。 */
  function startTouchboxLoop(): void {
    stopTouchboxLoop()
    if (!touchboxOverlayVisible() || !touchboxOverlay) return
    const tick = () => {
      paintTouchBoxes()
      touchboxRaf = window.requestAnimationFrame(tick)
    }
    touchboxRaf = window.requestAnimationFrame(tick)
  }

  /** 同步叠加层显隐与重绘循环（编辑态强制显示；非编辑态由 showTapZones 决定，spec §2/§4）。 */
  function syncTouchboxOverlay(): void {
    const on = touchboxOverlayVisible()
    if (touchboxOverlay) touchboxOverlay.style.display = on ? 'block' : 'none'
    if (on) startTouchboxLoop()
    else stopTouchboxLoop()
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

  /** 停止命中层逐帧位置更新。 */
  function stopHitLayerLoop(): void {
    if (hitLayerRaf) { window.cancelAnimationFrame(hitLayerRaf); hitLayerRaf = 0 }
  }

  /** 每帧按模型当前包围盒把命中 div 换算成 CSS 像素矩形（跟随动作/物理/尺寸变化）。 */
  function updateHitBoxPositions(): void {
    if (!hitLayer || hitBoxEntries.length === 0) return
    let bounds: { x: number; y: number; width: number; height: number } | null = null
    try {
      const b = model?.getBounds?.()
      if (b && b.width > 0 && b.height > 0) bounds = { x: b.x, y: b.y, width: b.width, height: b.height }
    } catch { /* 无包围盒 */ }
    if (!bounds) {
      for (const { el } of hitBoxEntries) el.style.display = 'none'
      return
    }
    const { x: bx, y: by, width: bw, height: bh } = bounds
    for (const { el, box } of hitBoxEntries) {
      const x = bx + bw * box.left
      const y = by + bh * box.top
      const w = bw * (box.right - box.left)
      const h = bh * (box.bottom - box.top)
      if (!(w > 0 && h > 0)) { el.style.display = 'none'; continue }
      el.style.display = ''
      el.style.left = `${x}px`
      el.style.top = `${y}px`
      el.style.width = `${Math.max(1, w)}px`
      el.style.height = `${Math.max(1, h)}px`
    }
  }

  /** 逐帧更新命中层位置（模型动作/物理每帧改变包围盒），并同步气泡跟随模型。 */
  function startHitLayerLoop(): void {
    stopHitLayerLoop()
    if (!hitLayer || !petShown()) return
    const tick = () => {
      updateHitBoxPositions()
      updateDebugPanelPosition()
      updateBubblePosition()
      hitLayerRaf = window.requestAnimationFrame(tick)
    }
    hitLayerRaf = window.requestAnimationFrame(tick)
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
      hitBoxEntries.push({ el, box })
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
    startHitLayerLoop()
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
  function updateDebugPanelPosition(): void {
    debugPanelTopLogical = Number.NaN
    if (!debugEl || !petLayer || debugEl.parentNode !== petLayer || !model) return
    let bounds: { x: number; y: number; width: number; height: number } | null = null
    try {
      const b = model.getBounds?.()
      if (b && b.width > 0 && b.height > 0) bounds = { x: b.x, y: b.y, width: b.width, height: b.height }
    } catch { /* 无包围盒 */ }
    if (!bounds) return
    const panelWidth = debugEl.offsetWidth
    const panelHeight = debugEl.offsetHeight
    if (!(panelWidth > 0 && panelHeight > 0)) return
    const rect = petLayer.getBoundingClientRect()
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
    if (debugExpression) {
      const id = normalizeExpressionId(debugExpression)
      return id === 'none' ? [] : [id]
    }
    if (tempExpressions.length > 0) {
      if (Date.now() < tempExpressionUntil) return tempExpressions
      tempExpressions = []
    }
    if (!lastState) return []
    return splitMotionSelection(eventBindings[lastState]?.motions ?? []).expressions
  }

  /**
   * 写入表情参数：布尔开关按「当前表情」目标值 0/1，带淡入淡出。
   * 在 InternalModel.update 之前调用——动作/物理不会写这些参数，先写即生效。
   */
  function applyExpressionParams(
    coreModel: { setParameterValueById?(id: string, value: number, weight?: number): void } | undefined,
    dt: number,
  ): void {
    const set = coreModel?.setParameterValueById
    if (typeof set !== 'function') return
    const fade = Math.min(1, Math.max(0.02, dt * 1000 / EXPRESSION_FADE_MS))
    const targets = expressionParams(desiredExpressions())
    for (const param of EXPRESSION_SWITCH_PARAMS) {
      const target = targets[param] ?? 0
      const current = expressionMix.get(param) ?? 0
      const next = Math.abs(target - current) < 0.004 ? target : current + (target - current) * fade
      expressionMix.set(param, next)
      try { set.call(coreModel, param, next, 1) } catch { /* 模型没有该参数 */ }
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
      if (stagedState && !dragging) showStageText()
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
    if (dragging) {
      api.setDisplay({ right: Math.round(pos.right), bottom: Math.round(pos.bottom) }).catch(() => {})
      // 拖拽中隐藏的常驻气泡恢复当前阶段文案（spec §4：拖拽中暂停、结束恢复）
      showStageText()
    } else {
      handleTap(e)
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

  function handleTap(e: PointerEvent): void {
    if (!canvas || !model) return
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
      // 台词：该部位自定义台词（part.lines）非空时随机选一条，并避开该部位上一条
      // （按 part.id 记录，部位间互不干扰）；未配置台词 → 不显示气泡，只播部位动作（spec §4）。
      if (part.lines && part.lines.length > 0) {
        const line = pickLine(part.lines, lastPartLine.get(part.id))
        if (line !== undefined) {
          lastPartLine.set(part.id, line)
          showBubble(line)
        }
      }
      // 动作组 / 表情：部位混选里 1 个动作组 + 若干表情；表情短暂切过去（EXPRESSION_TEMP_MS 后回落到事件表情）
      const selection = splitMotionSelection(part.motions)
      if (selection.expressions.length > 0) {
        tempExpressions = selection.expressions
        tempExpressionUntil = Date.now() + EXPRESSION_TEMP_MS
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
        applyConfig(next)
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

  // 桌宠配置设置页（settings.section，spec §2）：开关/尺寸/模型列表/事件绑定/触摸部位/调试，
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
        label: () => '桌宠配置',
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
