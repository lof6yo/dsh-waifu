/**
 * 模型清单与触摸部位的共享类型/纯函数：presets.jsonc（内置策展，只读，JSONC 支持注释）
 * 由 host 侧 `models-host.ts` 负责读取；本模块保持 client 可安全打包。
 *
 * 全 AI 驱动（ADR-037）：不再有「事件绑定（动作组 + 台词池）」——角色说什么、做什么动作、
 * 摆什么表情全部由模型决定，这里只保留两类事实数据：
 * - 触摸部位：id + 名字 + box（命中判定与场景描述用）；
 * - 动作/表情目录：给模型的「可做什么」清单（system 提示词与标签解析共用）。
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
  /** 兼容字段：旧版的默认触摸部位（可能还带 motions/lines，载入时会被裁掉）。 */
  touchParts?: TouchPart[]
}

/** 宠物状态（状态机；ADR-037 起状态只作为「场景」喂给模型，不再绑定动作）。 */
export type AnimationSlot =
  | 'idle' | 'thinking' | 'error' | 'done' | 'waiting' | 'delivered'

/** 全部状态槽位（设置页「可触发场景」的状态组；`idle` 是静息态，不作为触发键）。 */
export const ANIMATION_SLOTS: readonly AnimationSlot[] = [
  'idle', 'thinking', 'error', 'done', 'waiting', 'delivered',
]

/**
 * 活动事件键（ADR-036）：一次性触发（工具/审批/会话/子代理），不进状态机。
 * 全 AI 驱动后它们与状态事件一样，只是「场景」的一种。
 */
export type ActivityKey =
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

/** 全部活动事件（设置页「可触发场景」的活动组顺序）。 */
export const ACTIVITY_EVENTS: readonly ActivityKey[] = [
  'tool-read', 'tool-write', 'tool-run', 'tool-agent', 'tool-other',
  'approval-granted', 'approval-denied',
  'session-open', 'session-close',
  'subagent-start', 'subagent-end',
]

/** 是否是活动事件。 */
export function isActivityKey(value: unknown): value is ActivityKey {
  return typeof value === 'string' && (ACTIVITY_EVENTS as readonly string[]).includes(value)
}

/** 全部可作为 AI 触发场景的事件键（设置页勾选用；idle 永远不算触发）。 */
export type PetEventKey = AnimationSlot | ActivityKey

export const PET_EVENTS: readonly PetEventKey[] = [...ANIMATION_SLOTS, ...ACTIVITY_EVENTS]

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
  /** 给模型看的一句话释义（system 提示词的「表情目录」用）。 */
  meaning: string
}

/** 全部内置表情（`none` 表示恢复无表情；目录同时是 AI 可选表情与设置页勾选清单）。 */
export const EXPRESSIONS: readonly ExpressionDef[] = [
  { id: 'none', name: '无', params: {}, meaning: '' },
  { id: 'blush', name: '脸红', params: { ParamSwitch2: 1 }, exclusive: 'skin', meaning: '害羞、被戳中软处' },
  { id: 'angry', name: '生气', params: { ParamSwitch4: 1 }, meaning: '恼火、炸毛' },
  { id: 'star', name: '星星眼', params: { ParamSwitch5: 1 }, exclusive: 'eye', meaning: '开心、崇拜、两眼放光' },
  { id: 'whites', name: '白眼', params: { ParamSwitch6: 1 }, exclusive: 'eye', meaning: '无语、嫌弃、不屑' },
  { id: 'tear', name: '泪花', params: { ParamSwitch7: 1 }, exclusive: 'eye', meaning: '委屈、含着泪' },
  { id: 'heart', name: '爱心眼', params: { ParamSwitch8: 1 }, exclusive: 'eye', meaning: '喜欢、心里小鹿乱撞' },
  { id: 'cry', name: '眼泪', params: { ParamSwitch9: 1 }, exclusive: 'eye', meaning: '哭出来、伤心' },
  { id: 'dark', name: '脸黑', params: { ParamSwitch1: 1 }, exclusive: 'skin', meaning: '不爽、阴沉下来' },
  { id: 'blood', name: '羞愤', params: { ParamSwitch3: 1 }, exclusive: 'skin', meaning: '又羞又气、脸上挂不住' },
  { id: 'dim', name: '高光消失', params: { ParamSwitch21: 1 }, meaning: '失落、没精神、蔫了' },
]

/** AI 可选动作组目录（标签解析与 system 提示词共用；不含 Idle——那是状态机的活）。 */
export interface MotionDef {
  id: string
  name: string
  /** 给模型看的一句话释义。 */
  meaning: string
}

export const AI_MOTIONS: readonly MotionDef[] = [
  { id: 'Nod', name: '点头', meaning: '同意、得意、敷衍地应一声' },
  { id: 'ShakeHead', name: '摇头', meaning: '拒绝、无奈、不敢相信' },
  { id: 'Tilt', name: '歪头', meaning: '好奇、疑惑、没听懂' },
  { id: 'Sway', name: '左右晃', meaning: '撒娇、放松、哼着小曲' },
  { id: 'Glance', name: '瞥一眼', meaning: '偷瞄、在意又嘴硬' },
  { id: 'Perk', name: '竖起耳朵', meaning: '来了兴致、警觉、竖起耳朵' },
  { id: 'Shift', name: '换重心', meaning: '准备动手、活动身体' },
  { id: 'Sigh', name: '叹气', meaning: '无奈、松一口气' },
]

/** AI 可选动作组 id 列表。 */
export const AI_MOTION_IDS: readonly string[] = AI_MOTIONS.map((motion) => motion.id)

/** 动作组的显示名（未知动作组回退原 id）。 */
export function motionLabel(id: string): string {
  return AI_MOTIONS.find((motion) => motion.id === id)?.name ?? id
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

/** 该名字是否是表情 id。 */
export function isExpressionId(value: string): boolean {
  return EXPRESSION_IDS.includes(value.trim())
}

/** 该名字是否是 AI 动作组 id。 */
export function isMotionId(value: string): boolean {
  return (AI_MOTION_IDS as readonly string[]).includes(value.trim())
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

/** 互斥组去重：同一组后出现的替换先出现的（AI 可能给出叠加标签）。 */
export function dedupeExpressions(ids: readonly string[]): string[] {
  const out: string[] = []
  for (const raw of ids) {
    const id = normalizeExpressionId(raw)
    if (id === 'none') continue
    const group = expressionExclusiveGroup(id)
    for (let i = out.length - 1; i >= 0; i -= 1) {
      const other = out[i]
      if (other === id) { out.splice(i, 1); continue }
      if (group && expressionExclusiveGroup(other) === group) out.splice(i, 1)
    }
    out.push(id)
  }
  return out
}

/**
 * 触摸部位矩形（相对模型包围盒的归一化坐标，0–1，左上右下）。
 */
export interface TouchBox {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * 用户自定义触摸部位（ADR-037 起只保留「id + 名字 + box」）：
 * 名字用于向模型描述「主人碰了你哪里」，box 只做命中判定；反应交给 AI。
 * 图层：parts 数组顺序即图层顺序，**第 0 项为最上层**，box 重叠时上层部位生效。
 */
/** 交互触发条件（ADR-038）：单击 / 双击 / 悬停停留（鼠标停在 box 内，无需按下）。 */
export type InteractionTrigger = 'tap' | 'double' | 'hold'

/** 全部触发条件（设置页下拉顺序）。 */
export const INTERACTION_TRIGGERS: readonly InteractionTrigger[] = ['tap', 'double', 'hold']

/** 触发条件的中文名。 */
export const INTERACTION_TRIGGER_LABELS: Record<InteractionTrigger, string> = {
  tap: '单击',
  double: '双击',
  hold: '悬停',
}

/** 单个部位最多交互数（防止配置失控；设置页同步限制）。 */
export const MAX_INTERACTIONS_PER_PART = 8
/** 交互名最大长度（更长的截断）。 */
export const INTERACTION_NAME_MAX = 20
/** 「悬停停留」默认时长与允许范围（ms）：鼠标停在部位 box 内多久触发。 */
export const TOUCH_HOLD_DEFAULT_MS = 3000
export const TOUCH_HOLD_LIMITS = { min: 300, max: 10000 } as const
/** 双击判定窗口（ms）：两次点击间隔小于它算双击。 */
export const DOUBLE_TAP_MS = 300

/**
 * 部位自定义交互（ADR-038）：用户给一个名字 + 一个触发条件，
 * 名字原样透传给模型（模型按字面理解「抚摸」「捏脸」这类语义）。
 */
export interface TouchInteraction {
  id: string
  name: string
  trigger: InteractionTrigger
  /** 仅 `hold` 有意义：鼠标悬停多久算「停留」（ms）。 */
  holdMs: number
}

export interface TouchPart {
  id: string
  name: string
  boxes: TouchBox[]
  /** 自定义交互；空/缺省 = 回落内建的轻碰/戳戳/抚摸三档。 */
  interactions?: TouchInteraction[]
}

/** 无默认触摸部位时的空表（用户未创建部位 → 点击不触发互动）。 */
export const DEFAULT_TOUCH_PARTS: readonly TouchPart[] = []

/** 单个部位最多 box 数（防止配置失控；设置页同步限制）。 */
export const MAX_BOXES_PER_PART = 12

/** 部位 id 合法形式（保存时生成，仅用于持久化与排序）。 */
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
 * 旧文件里的 `motions` / `lines` 字段（ADR-037 前的部位绑定）直接忽略。
 */
/** 归一化一个部位的交互列表：丢空名、去重（同名同触发条件）、夹时长、限量。 */
export function normalizeInteractions(raw: unknown): TouchInteraction[] {
  if (!Array.isArray(raw)) return []
  const out: TouchInteraction[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.trim().slice(0, INTERACTION_NAME_MAX) : ''
    if (!name) continue
    const trigger = INTERACTION_TRIGGERS.includes(record.trigger as InteractionTrigger)
      ? (record.trigger as InteractionTrigger)
      : 'tap'
    const key = `${trigger}:${name}`
    if (seen.has(key)) continue
    seen.add(key)
    const rawHold = Number(record.holdMs)
    const holdMs = Number.isFinite(rawHold)
      ? Math.round(Math.min(TOUCH_HOLD_LIMITS.max, Math.max(TOUCH_HOLD_LIMITS.min, rawHold)))
      : TOUCH_HOLD_DEFAULT_MS
    out.push({ id: `i${out.length + 1}`, name, trigger, holdMs })
    if (out.length >= MAX_INTERACTIONS_PER_PART) break
  }
  return out
}

/** 该部位是否定义了双击交互（决定单击要不要等 300ms 判双）。 */
export function hasDoubleInteraction(part: TouchPart): boolean {
  return (part.interactions ?? []).some((item) => item.trigger === 'double')
}

/**
 * 按压（点击）路径挑交互（ADR-038 修订）：「停留」已改成鼠标悬停触发，
 * 不再参与按压判定；这里只看单击/双击。
 */
export function pickTapInteraction(part: TouchPart, clickCount: number): TouchInteraction | undefined {
  const list = part.interactions ?? []
  if (list.length === 0) return undefined
  if (clickCount >= 2) {
    const double = list.find((item) => item.trigger === 'double')
    if (double) return double
  }
  return list.find((item) => item.trigger === 'tap')
}

/**
 * 按按压时长与连击数挑一个交互（ADR-038）：
 * 1. 停留类优先（时长 ≥ 该交互的 holdMs，取最长的那个）；
 * 2. 连击 ≥ 2 且定义了双击 → 双击；
 * 3. 否则单击交互；
 * 4. 都没有返回 undefined（调用方回落内建轻碰/戳戳/抚摸）。
 */
export function pickInteraction(
  part: TouchPart,
  durationMs: number,
  clickCount: number,
): TouchInteraction | undefined {
  const list = part.interactions ?? []
  if (list.length === 0) return undefined
  const holds = list
    .filter((item) => item.trigger === 'hold' && durationMs >= item.holdMs)
    .sort((a, b) => b.holdMs - a.holdMs)
  if (holds.length > 0) return holds[0]
  if (clickCount >= 2) {
    const double = list.find((item) => item.trigger === 'double')
    if (double) return double
  }
  return list.find((item) => item.trigger === 'tap')
}

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
    seen.add(id)
    const interactions = normalizeInteractions(record.interactions)
    out.push(interactions.length > 0 ? { id, name, boxes, interactions } : { id, name, boxes })
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
 * 触摸命中判定：按**图层顺序**（parts 数组顺序，第 0 项最上层）遍历，
 * 返回第一个命中任意 box 的部位；未命中返回 null。
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
