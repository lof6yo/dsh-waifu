/**
 * 模型清单与触摸部位的共享类型/纯函数：presets.jsonc（内置策展，只读，JSONC 支持注释）
 * 由 host 侧 `models-host.ts` 负责读取；本模块保持 client 可安全打包。
 *
 * 模型加载：内置模型随包分发（assets/models/<id>/，经 Host 同源 `/waifu-assets/...` 路由），
 * 自定义模型仍支持任意 http(s) URL 或本机绝对路径（spec §6）。
 *
 * 触摸部位（spec §4）：部位完全由用户自定义——每个部位 = 名字 + 若干归一化矩形 box
 * （相对模型包围盒 0–1，左上右下）+ 该部位被触摸时播放的动作组列表。命中判定只用 box，
 * 不再依赖模型自带 HitArea 或空间阈值分档；部位有**图层**概念——parts 数组顺序即图层顺序，
 * 第 0 项最上层，box 重叠时上层部位生效（设置页可排序）。
 * @module dsh-waifu/models
 */

/** 内置策展条目（presets.jsonc 结构）。 */
export interface BuiltinPreset {
  id: string
  name: string
  author: string
  /** .model3.json 地址：随包内置为同源 `/waifu-assets/models/<id>/...` 路径。 */
  modelUrl: string
  license: { type: string; url: string }
  cubism: number
  status: string
  /** 可选：状态动画映射（6 个状态槽位）；缺省用 DEFAULT_MOTION_MAP。 */
  animationMap?: MotionMap
  /** 可选：默认触摸部位（用户自定义部位保存后覆盖它）。 */
  touchParts?: TouchPart[]
}

/** 状态动画映射槽位：6 个宠物状态。每个槽位可配置一个或多个动作组；多选时随机选一个播放。 */
export type AnimationSlot =
  | 'idle' | 'thinking' | 'error' | 'done' | 'waiting' | 'delivered'

/** 全部状态动画映射槽位（设置页表单 / 默认映射共用）。 */
export const ANIMATION_SLOTS: readonly AnimationSlot[] = [
  'idle', 'thinking', 'error', 'done', 'waiting', 'delivered',
]

/**
 * 状态 → 候选动作组集合。
 * 值数组表示该槽位可用的动作组；未配置的槽位由 DEFAULT_MOTION_MAP 兜底。
 */
export type MotionMap = Partial<Record<AnimationSlot, string[]>>

/** 默认动画映射：与旧版内置候选链一致（有序 fallback；配置映射后为随机选择）。 */
export const DEFAULT_MOTION_MAP: MotionMap = {
  idle: ['Idle'],
  thinking: ['Tilt', 'Idle'],
  error: ['ShakeHead', 'Idle'],
  done: ['Hop', 'Idle'],
  waiting: ['Sway', 'Idle'],
  delivered: ['Hop', 'Idle'],
}

/** 宠物事件键（与状态动画槽位同构：空闲/思考/出错/完成/交付/等审批）。 */
export type PetEventKey = AnimationSlot

/** 全部宠物事件（设置页「事件绑定」顺序）。 */
export const PET_EVENTS: readonly PetEventKey[] = ANIMATION_SLOTS

/**
 * 事件绑定：该事件播放的动作组候选 + 台词池。
 * - motions：随机选一个动作组播放（空 = 不播动作）
 * - lines：台词池数组；普通事件只有 1 组，长状态（思考/等审批）按阶段 3 组
 *   （阶段推进时长见 EVENT_STAGE_DELAYS，index 越界时用最后一组）
 */
export interface EventBinding {
  motions: string[]
  lines: string[][]
}

/** 六个事件的绑定表。 */
export type EventBindings = Record<PetEventKey, EventBinding>

/** 长状态的阶段推进时长（ms，距入态偏移）：index 与 EventBinding.lines 对应。 */
export const EVENT_STAGE_DELAYS: Partial<Record<PetEventKey, readonly number[]>> = {
  thinking: [0, 15_000, 40_000],
  waiting: [0, 30_000, 90_000],
}

/** 台词池最多条数（每个阶段）。 */
export const MAX_LINES_PER_POOL = 20

/**
 * 默认事件绑定：中性口吻的默认台词（不再有固定人设；后续可由 LLM 人设提示词接管）。
 * 动作组默认与 DEFAULT_MOTION_MAP 对齐；内置「简」在 presets.jsonc 用 animationMap 覆盖动作组。
 */
export const DEFAULT_EVENT_BINDINGS: EventBindings = {
  idle: {
    motions: ['Idle'],
    lines: [['（安静地待着）', '……在的。', '有什么要做的吗？']],
  },
  thinking: {
    motions: ['Tilt', 'Idle'],
    lines: [
      ['思考中…', '让我想想。'],
      ['还在想，稍等…', '这个问题有点绕。'],
      ['马上就好…', '再给我一点时间。'],
    ],
  },
  error: {
    motions: ['ShakeHead', 'Idle'],
    lines: [['出错了…我再试一次。', '唔，好像不太顺利。']],
  },
  done: {
    motions: ['Hop', 'Idle'],
    lines: [['搞定！', '完成了。', '做完啦。']],
  },
  delivered: {
    motions: ['Hop', 'Idle'],
    lines: [['文件放这儿了。', '交付完成，请查收。']],
  },
  waiting: {
    motions: ['Sway', 'Idle'],
    lines: [
      ['等你确认。', '需要你决定一下。'],
      ['还在等你哦。', '不着急，我等着。'],
      ['考虑好了吗？', '随时可以继续。'],
    ],
  },
}

/** 归一化单个事件绑定：motions 去空去重；lines 清洗为「阶段 → 台词数组」，至少 1 组。 */
function normalizeEventBinding(raw: unknown): EventBinding | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as { motions?: unknown; lines?: unknown }
  const motions = Array.isArray(record.motions)
    ? [...new Set(record.motions.filter((m): m is string => typeof m === 'string' && m.trim().length > 0).map((m) => m.trim()))]
    : []
  const rawLines = Array.isArray(record.lines) ? record.lines : []
  const lines: string[][] = []
  for (const pool of rawLines) {
    if (!Array.isArray(pool)) continue
    const cleaned = [...new Set(
      pool
        .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
        .map((line) => line.trim().slice(0, MAX_LINE_LENGTH))
        .slice(0, MAX_LINES_PER_POOL),
    )]
    lines.push(cleaned)
    if (lines.length >= 3) break
  }
  if (lines.length === 0) lines.push([])
  return { motions, lines }
}

/** 归一化用户事件绑定（只保留合法事件键；缺失事件不出现，由调用方回退默认/内置）。 */
export function normalizeEventBindings(raw: unknown): Partial<EventBindings> {
  const out: Partial<EventBindings> = {}
  if (typeof raw !== 'object' || raw === null) return out
  const record = raw as Record<string, unknown>
  for (const event of PET_EVENTS) {
    const binding = normalizeEventBinding(record[event])
    if (binding) out[event] = binding
  }
  return out
}

/** 合并事件绑定：base 为默认/内置，override 为用户覆盖（整事件替换，阶段数可不同）。 */
export function mergeEventBindings(
  base: EventBindings,
  override?: Partial<EventBindings> | null,
): EventBindings {
  const out = {} as EventBindings
  for (const event of PET_EVENTS) {
    out[event] = override?.[event] ?? base[event]
  }
  return out
}

/**
 * 触摸部位矩形（相对模型包围盒的归一化坐标，0–1，左上右下）。
 * left/top 为左上角，right/bottom 为右下角；加载时自动排序并夹到 0–1。
 */
export interface TouchBox {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * 用户自定义触摸部位（spec §4）：
 * - id：稳定标识（保存时生成，用于部位动画映射与排序）
 * - name：展示名（也是选台词池的提示词，如「头」「手」）
 * - boxes：一到多个矩形，命中任一即算该部位（多个矩形可拼出不规则部位）
 * - motions：触摸该部位时播放的动作组列表（随机选一个；空 = 不播动作，只出气泡）
 * - lines：该部位的自定义台词（一行一条，随机选一条）；留空 = 只播动作、不显示气泡
 *
 * 图层：部位列表（`TouchPart[]`）的顺序就是图层顺序，**第 0 项为最上层**；
 * 设置页「触摸部位」用上移/下移调整，保存后按该顺序持久化。
 */
export interface TouchPart {
  id: string
  name: string
  boxes: TouchBox[]
  motions: string[]
  /** 可选：该部位的自定义台词（随机选一条）；空/缺省 = 只播动作、不显示气泡。 */
  lines?: string[]
}

/** 无默认触摸部位时的空表（用户未创建部位 → 点击不触发互动，spec §4）。 */
export const DEFAULT_TOUCH_PARTS: readonly TouchPart[] = []

/** 单个部位最多 box 数（防止配置失控；设置页同步限制）。 */
export const MAX_BOXES_PER_PART = 12

/** 单个部位最多自定义台词条数。 */
export const MAX_LINES_PER_PART = 30

/** 单条自定义台词最大长度（字符）。 */
export const MAX_LINE_LENGTH = 120

/** 部位 id 合法形式（保存时生成，仅用于持久化与映射键）。 */
export function isValidPartId(value: string): boolean {
  return /^[a-z][a-z0-9_-]*$/i.test(value)
}

/** 把数值夹到 [0,1]；非有限数按 0 处理。 */
function clamp01(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/** 归一化单个 box：夹到 0–1，并保证 left<right / top<bottom（必要时交换）。 */
export function normalizeTouchBox(raw: unknown): TouchBox | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const left = clamp01(record.left)
  const top = clamp01(record.top)
  const right = clamp01(record.right)
  const bottom = clamp01(record.bottom)
  const box: TouchBox = {
    left: Math.min(left, right),
    top: Math.min(top, bottom),
    right: Math.max(left, right),
    bottom: Math.max(top, bottom),
  }
  if (box.right - box.left <= 0.001 || box.bottom - box.top <= 0.001) return null
  return box
}

/**
 * 归一化部位列表：丢弃非法条目、限制 box 数量、去重 id。
 * 供 Host 存储与设置页保存共用（纯函数，client 可安全打包）。
 */
export function normalizeTouchParts(raw: unknown): TouchPart[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: TouchPart[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.trim().slice(0, 24) : ''
    if (!name) continue
    let id = typeof record.id === 'string' ? record.id.trim() : ''
    if (!isValidPartId(id)) id = `part-${out.length + 1}`
    const base = id
    let suffix = 2
    while (seen.has(id)) id = `${base}-${suffix++}`
    const rawBoxes = Array.isArray(record.boxes) ? record.boxes : []
    const boxes: TouchBox[] = []
    for (const rawBox of rawBoxes) {
      const box = normalizeTouchBox(rawBox)
      if (box) boxes.push(box)
      if (boxes.length >= MAX_BOXES_PER_PART) break
    }
    const rawMotions = Array.isArray(record.motions)
      ? record.motions.filter((m): m is string => typeof m === 'string' && m.trim().length > 0).map((m) => m.trim())
      : []
    const motions = [...new Set(rawMotions)]
    const rawLines = Array.isArray(record.lines)
      ? record.lines
        .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)
        .map((line) => line.trim().slice(0, MAX_LINE_LENGTH))
        .slice(0, MAX_LINES_PER_PART)
      : []
    const lines = [...new Set(rawLines)]
    seen.add(id)
    const part: TouchPart = { id, name, boxes, motions }
    if (lines.length > 0) part.lines = lines
    out.push(part)
  }
  return out
}

/** 归一化状态动画映射（只保留 6 个状态槽位 + 字符串数组；未知键丢弃）。 */
export function normalizeMotionMap(raw: unknown): MotionMap {
  const out: MotionMap = {}
  if (typeof raw !== 'object' || raw === null) return out
  const record = raw as Record<string, unknown>
  for (const slot of ANIMATION_SLOTS) {
    const value = record[slot]
    if (!Array.isArray(value)) continue
    const names = [...new Set(value.filter((n): n is string => typeof n === 'string' && n.trim().length > 0).map((n) => n.trim()))]
    if (names.length > 0) out[slot] = names
  }
  return out
}

/** 归一化点击点相对于包围盒的比例坐标（越界返回 null）。 */
export function pointToBoundsRatio(
  localX: number,
  localY: number,
  bounds: { x: number; y: number; width: number; height: number },
): { nx: number; ny: number } | null {
  if (!(bounds.width > 0 && bounds.height > 0)) return null
  const nx = (localX - bounds.x) / bounds.width
  const ny = (localY - bounds.y) / bounds.height
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null
  return { nx, ny }
}

/**
 * 触摸命中判定（spec §4）：按**图层顺序**（parts 数组顺序，第 0 项最上层）遍历，
 * 返回第一个命中任意 box 的部位；box 重叠时上层部位生效，不再按面积比较。
 * 未命中返回 null。
 */
export function hitTestTouchParts(parts: readonly TouchPart[], nx: number, ny: number): TouchPart | null {
  for (const part of parts) {
    for (const box of part.boxes) {
      if (nx < box.left || nx > box.right || ny < box.top || ny > box.bottom) continue
      return part
    }
  }
  return null
}
