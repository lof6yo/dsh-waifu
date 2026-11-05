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

/** 状态动画映射槽位：6 个宠物状态。每个槽位 = 一个动作组（可选）+ 一个表情（可选，见 MotionSelection）。 */
export type AnimationSlot =
  | 'idle' | 'thinking' | 'error' | 'done' | 'waiting' | 'delivered'

/** 全部状态动画映射槽位（设置页表单 / 默认映射共用）。 */
export const ANIMATION_SLOTS: readonly AnimationSlot[] = [
  'idle', 'thinking', 'error', 'done', 'waiting', 'delivered',
]

/**
 * 状态 → 候选动作组集合。
 * 值数组 = 该槽位的「动作组 / 表情」混选；未配置的槽位由 DEFAULT_MOTION_MAP 兜底。
 */
export type MotionMap = Partial<Record<AnimationSlot, string[]>>

/** 默认动画映射：动作组 + 表情混选（表情 id 与动作组同列存放，见 MotionSelection）。 */
export const DEFAULT_MOTION_MAP: MotionMap = {
  idle: ['Idle'],
  thinking: ['Tilt'],
  error: ['ShakeHead', 'whites', 'dark'],
  done: ['Nod', 'star'],
  waiting: ['Sway'],
  delivered: ['Tilt', 'star'],
}

/**
 * 内置表情：模型里的布尔开关参数（`ParamSwitch*`）组合。
 *
 * 这些开关不是动作，而是常驻参数——需要每帧把「当前表情」对应的开关写成 1、其余写成 0，
 * 切换时做几百毫秒的淡入淡出（见 client 的 ExpressionMixer）。`ParamSwitch10/11` 是
 * 左右手姿势开关，不属于表情，未收录。
 */
export interface ExpressionDef {
  id: string
  name: string
  /** 参数 → 目标值（未列出的开关按 0 处理，即关闭）。 */
  params: Record<string, number>
  /**
   * 互斥组：同一组里只能同时开一个（例如眼部表情）。
   * 缺省 = 可以任意叠加（脸红、生气这类互不冲突的开关）。
   */
  exclusive?: string
}

/** 全部内置表情（设置页下拉、事件绑定、触摸部位共用；`none` 表示恢复无表情）。 */
export const EXPRESSIONS: readonly ExpressionDef[] = [
  { id: 'none', name: '无', params: {} },
  { id: 'blush', name: '脸红', params: { ParamSwitch2: 1 }, exclusive: 'skin' },
  { id: 'angry', name: '生气', params: { ParamSwitch4: 1 } },
  { id: 'star', name: '星星眼', params: { ParamSwitch5: 1 }, exclusive: 'eye' },
  { id: 'whites', name: '白眼', params: { ParamSwitch6: 1 }, exclusive: 'eye' },
  { id: 'tear', name: '泪花', params: { ParamSwitch7: 1 }, exclusive: 'eye' },
  { id: 'heart', name: '爱心眼', params: { ParamSwitch8: 1 }, exclusive: 'eye' },
  { id: 'cry', name: '眼泪', params: { ParamSwitch9: 1 }, exclusive: 'eye' },
  { id: 'dark', name: '脸黑', params: { ParamSwitch1: 1 }, exclusive: 'skin' },
  { id: 'blood', name: '血', params: { ParamSwitch3: 1 }, exclusive: 'skin' },
  { id: 'dim', name: '高光消失', params: { ParamSwitch21: 1 } },
]

/** 动作组的显示名（下拉与卡片摘要用；未收录的自定义动作组回退成原名）。 */
export const MOTION_LABELS: Readonly<Record<string, string>> = {
  Idle: '待机',
  Nod: '点头',
  ShakeHead: '摇头',
  Tilt: '歪头',
  Sway: '左右晃',
}

/** 动作组的显示名（未知动作组回退原 id）。 */
export function motionLabel(id: string): string {
  return MOTION_LABELS[id] ?? id
}

/** 表情的互斥组（没有则返回空串 = 可自由叠加）。 */
export function expressionExclusiveGroup(id: string): string {
  return EXPRESSIONS.find((expression) => expression.id === id)?.exclusive ?? ''
}

/** 表情的显示名（未知 id 回退原值）。 */
export function expressionLabel(id: string): string {
  return EXPRESSIONS.find((expression) => expression.id === id)?.name ?? id
}

/** 表情会触及的全部开关参数（未选中的一律淡出到 0，避免多个表情叠着）。 */
export const EXPRESSION_SWITCH_PARAMS: readonly string[] = [
  'ParamSwitch1', 'ParamSwitch2', 'ParamSwitch3', 'ParamSwitch4', 'ParamSwitch5',
  'ParamSwitch6', 'ParamSwitch7', 'ParamSwitch8', 'ParamSwitch9', 'ParamSwitch21',
]

/** 可选表情 id（不含 `none`）。 */
export const EXPRESSION_IDS: readonly string[] = EXPRESSIONS
  .filter((expression) => expression.id !== 'none')
  .map((expression) => expression.id)

/** 表情 id 是否合法（未知 id 回退 `none`）。 */
export function normalizeExpressionId(value: unknown): string {
  if (typeof value !== 'string') return 'none'
  const id = value.trim()
  return EXPRESSIONS.some((expression) => expression.id === id) ? id : 'none'
}

/** 该名字是否是表情 id（「动作组」混选列表里靠它区分动作与表情）。 */
export function isExpressionId(value: string): boolean {
  return EXPRESSION_IDS.includes(value.trim())
}

/**
 * 「动作组 / 表情」混选：事件绑定与触摸部位共用一套列表（ADR-023 / ADR-024）。
 * 语义 = 最多 1 个动作组 + 若干表情，同时触发；两项都可留空。
 * 表情之间只有互斥组（眼部 / 皮肤）内才二选一，其余可以叠：脸红 + 眼泪、生气 + 星星眼……
 */
export interface MotionSelection {
  /** 动作组名（空 = 不播动作）。 */
  motion: string
  /** 表情 id 列表（空 = 不改表情）；顺序 = 选择顺序。 */
  expressions: string[]
}

/**
 * 拆解混选数组：第一个非表情名当动作组，其余都当表情；
 * 同一互斥组里后出现的替换先出现的，重复项只留最后一个。
 */
export function splitMotionSelection(list: readonly unknown[]): MotionSelection {
  let motion = ''
  const expressions: string[] = []
  for (const raw of list) {
    if (typeof raw !== 'string') continue
    const id = raw.trim()
    if (!id) continue
    if (!isExpressionId(id)) {
      if (!motion) motion = id
      continue
    }
    const group = expressionExclusiveGroup(id)
    for (let i = expressions.length - 1; i >= 0; i -= 1) {
      const other = expressions[i]
      if (other === id) {
        expressions.splice(i, 1)
        continue
      }
      if (group && expressionExclusiveGroup(other) === group) expressions.splice(i, 1)
    }
    expressions.push(id)
  }
  return { motion, expressions }
}

/** 由动作组 + 表情列表拼出混选数组（顺序固定：动作组在前，空项省略）。 */
export function joinMotionSelection(motion: string, expressions: readonly string[]): string[] {
  const out: string[] = []
  const name = typeof motion === 'string' ? motion.trim() : ''
  if (name) out.push(name)
  for (const raw of expressions) {
    if (typeof raw !== 'string') continue
    const expr = normalizeExpressionId(raw)
    if (expr !== 'none' && !out.includes(expr)) out.push(expr)
  }
  return out
}

/** 归一化混选数组（动作组最多 1 项、表情按互斥组收敛；非数组返回空）。 */
export function normalizeMotionSelection(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const { motion, expressions } = splitMotionSelection(raw)
  return joinMotionSelection(motion, expressions)
}

/** 表情列表 → 需要写 1 的参数集合（多个表情叠加时取并集）。 */
export function expressionParams(ids: readonly string[]): Record<string, number> {
  const params: Record<string, number> = {}
  for (const id of ids) {
    const def = EXPRESSIONS.find((expression) => expression.id === id)
    if (!def) continue
    for (const [param, value] of Object.entries(def.params)) params[param] = value
  }
  return params
}

/** 宠物事件键（与状态动画槽位同构：空闲/思考/出错/完成/交付/等审批）。 */
export type PetEventKey = AnimationSlot

/** 全部宠物事件（设置页「事件绑定」顺序）。 */
export const PET_EVENTS: readonly PetEventKey[] = ANIMATION_SLOTS

/**
 * 事件绑定：该事件触发的「动作组 / 表情」+ 台词池。
 * - motions：混选数组（见 MotionSelection）——最多 1 个动作组 + 1 个表情，同时触发
 * - lines：台词池数组；普通事件只有 1 组，长状态（思考/等审批）按阶段 3 组
 *   （阶段推进时长见 EVENT_STAGE_DELAYS，index 越界时用最后一组）
 */
export interface EventBinding {
  motions: string[]
  lines: string[][]
}

/** 六个事件的绑定表。 */
export type EventBindings = Record<PetEventKey, EventBinding>

/** 长状态（思考/等确认）：入态台词常驻，之后由 AI 演绎按节奏刷新（ADR-026）。 */
export const LONG_STATES = ['thinking', 'waiting'] as const

/** 长状态键。 */
export type LongState = typeof LONG_STATES[number]

/** 是否长状态：气泡常驻、台词可被 AI 反复演绎替换。 */
export function isLongState(state: PetEventKey): state is LongState {
  return (LONG_STATES as readonly string[]).includes(state)
}

/** 长状态 AI 演绎的默认节奏（delay/interval 单位秒，max 为每次入态最多演绎次数）。 */
export const DEFAULT_LONG_AI: Record<LongState, { delay: number; interval: number; max: number }> = {
  thinking: { delay: 5, interval: 10, max: 3 },
  waiting: { delay: 5, interval: 20, max: 3 },
}

/** 长状态 AI 演绎节奏的取值范围（设置页滑杆/校验共用）。 */
export const LONG_AI_LIMITS = {
  delay: { min: 0, max: 120 },
  interval: { min: 5, max: 600 },
  max: { min: 1, max: 10 },
} as const

/** 台词池最多条数（每个阶段）。 */
export const MAX_LINES_PER_POOL = 20

/**
 * 默认事件绑定：中性口吻的默认台词（不再有固定人设；后续可由 LLM 人设提示词接管）。
 * motions 末位的表情 id（angry/star/heart）与动作组同时触发。
 */
export const DEFAULT_EVENT_BINDINGS: EventBindings = {
  idle: {
    motions: ['Idle'],
    lines: [['（安静地待着）', '……在的。', '有什么要做的吗？']],
  },
  thinking: {
    motions: ['Tilt'],
    lines: [['思考中…']],
  },
  error: {
    motions: ['ShakeHead', 'whites', 'dark'],
    lines: [['出错了…']],
  },
  done: {
    motions: ['Nod', 'star'],
    lines: [['搞定！']],
  },
  delivered: {
    motions: ['Tilt', 'star'],
    lines: [['交付！']],
  },
  waiting: {
    motions: ['Sway'],
    lines: [['喂，你定一下啦！']],
  },
}

/**
 * 归一化单个事件绑定：motions 收敛为「动作组 + 表情」混选（旧版 `expression` 字段并入）；
 * lines 只保留**入态**一组（ADR-026 取消多阶段固定台词，其余阶段丢弃；旧文件的多阶段
 * 二维数组取第一组）。
 */
function normalizeEventBinding(raw: unknown): EventBinding | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as { motions?: unknown; lines?: unknown; expression?: unknown }
  const legacyExpression = normalizeExpressionId(record.expression)
  const motions = normalizeMotionSelection([
    ...(Array.isArray(record.motions) ? record.motions : []),
    ...(legacyExpression === 'none' ? [] : [legacyExpression]),
  ])
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
    break
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
 * - motions：混选数组（见 MotionSelection）——最多 1 个动作组 + 1 个表情，点中即同时触发
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
    const legacyExpression = normalizeExpressionId(record.expression)
    const motions = normalizeMotionSelection([
      ...(Array.isArray(record.motions) ? record.motions : []),
      ...(legacyExpression === 'none' ? [] : [legacyExpression]),
    ])
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

/** 时间戳样式：`[2026-11-05 14:57:16]`、`【14:57】`、`(22:04)`、`[2026-11-05]` 这类整块方括号时间。 */
const BRACKETED_TIMESTAMP = /[[【(（]\s*(?:\d{2,4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?|\d{1,2}:\d{2}(?::\d{2})?)\s*[\]】)）]/g

/** 裸 ISO 时间戳：`2026-11-05T14:57:16Z`、`2026-11-05 14:57:16`。 */
const ISO_TIMESTAMP = /\b\d{4}-\d{1,2}-\d{1,2}[T ]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?\b/g

/** 行首的裸时间戳（`14:57:16 哼…`）与行尾孤零零的时间戳。 */
const LEADING_TIMESTAMP = /^\s*\d{1,2}:\d{2}(?::\d{2})?\s*[,，:：、.·-]?\s*/
const TRAILING_TIMESTAMP = /\s*[,，:：、.·-]?\s*\d{1,2}:\d{2}(?::\d{2})?\s*$/

/**
 * 过滤台词里混进来的时间戳（模型偶尔会像聊天记录那样给回复加时间）。
 * 只处理「整块时间」与行首/行尾孤立的 `HH:MM(:SS)`，句子中间的时间（「已经 3:00 了」）不动；
 * 全部删空时回退原文，避免气泡变成空白。
 */
export function stripTimestamps(input: string): string {
  if (!input) return input
  const stripped = input
    .replace(BRACKETED_TIMESTAMP, '')
    .replace(ISO_TIMESTAMP, '')
    .replace(LEADING_TIMESTAMP, '')
    .replace(TRAILING_TIMESTAMP, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return stripped.length > 0 ? stripped : input
}
