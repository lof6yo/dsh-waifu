/**
 * Waifu 设置页（`settings.section` 注册体，spec §2）。
 * 单页信息架构（从上到下）：显示（开关 / 尺寸 / 留白 / 位置 / 气泡 / 帧率）/
 * 事件绑定（当前模型：6 事件的动作 / 表情 + 入态台词池）/ 触摸部位
 * （box / 台词 / 动作组）/ 开发者选项。仅内置「简」模型，不再有模型选择/导入、
 * 固定人设、跳转链接或文件路径展示。
 * 读写经插件自己的同源 API `/api/dsh-waifu/settings` 与 `/api/dsh-waifu/touch-parts`
 * （Host 直连插件私有配置文件 settings.jsonc / touch-parts.jsonc，ADR-013）——不走
 * client settingsScope wire，因为 dsh-host-apiproxy 只把内置 allowlist 的 namespace
 * 暴露给浏览器（见 docs/research/settings-tab.md「设置服务不可用」根因）。
 * 不引入任何非平台模块值导入。
 * @module dsh-waifu/client/settings
 */

import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent, FocusEvent, ReactNode, ReactElement } from 'react'
import type { InteractionTrigger, TouchBox, TouchInteraction, TouchPart } from '../models.ts'
import {
  ACTIVITY_EVENTS,
  ANIMATION_SLOTS,
  INTERACTION_NAME_MAX,
  INTERACTION_TRIGGERS,
  INTERACTION_TRIGGER_LABELS,
  MAX_BOXES_PER_PART,
  MAX_INTERACTIONS_PER_PART,
  TOUCH_HOLD_DEFAULT_MS,
  TOUCH_HOLD_LIMITS,
} from '../models.ts'
import {
  ACTIVITY_WINDOW_LIMITS,
  AI_HISTORY_LIMITS,
  AI_MEMORY_LIMITS,
  AI_MIN_INTERVAL_LIMITS,
  BAR_OFFSET_LIMITS,
  DEFAULT_AI_HISTORY,
  DEFAULT_AI_MEMORY,
  DEFAULT_EVENT_TEXTS,
  DEFAULT_MODEL_ID,
  DEFAULT_SETTINGS,
  EVENT_TEXT_MAX,
  FOCUS_RANGE_LIMITS,
  IDLE_TIMEOUT_LIMITS,
  LIPSYNC_GAIN_LIMITS,
  TTS_MODELS,
  normalizeEventTexts,
  normalizeEventTriggers,
  normalizeFocusRange,
  normalizeHistoryCount,
  normalizeLipsyncGain,
  normalizeMemoryCount,
  ttsDefaultVoice,
  ttsModelOption,
  type BarPosition,
} from '../defaults.ts'
import { clientLog } from './client-log.ts'
import { emitCaptureHome, emitRecenter } from './pet-commands.ts'
import { emitTouchEdit } from './touch-edit.ts'

/** 插件 API 前缀（与 index.ts / client-log.ts 保持一致）。 */
const PET_API = '/api/dsh-waifu'

/** 设置解析值（与 Host PetSettings 对齐）。 */
export interface PetSettingsValue {
  enabled: boolean
  size: number
  /** 渲染帧率：30 / 60 / 0（不限制）。 */
  maxFps: number
  /** 画布水平留白（%，0–300；角色四周留白防动作甩尾被裁切）。 */
  canvasPadX: number
  /** 画布垂直留白（%，0–300）。 */
  canvasPadY: number
  /** 默认位置：显示区中心点距右边（视口宽度百分比 0–100）。 */
  homeRight: number
  /** 默认位置：显示区中心点距下边（视口高度百分比 0–100）。 */
  homeBottom: number
  /** 气泡相对角色顶部中心的水平偏移（px，-1000–1000）。 */
  bubbleOffsetX: number
  /** 气泡相对角色顶部中心的垂直偏移（px，-1000–1000，负值向上）。 */
  bubbleOffsetY: number
  /** 气泡背景色（#rrggbb）。 */
  bubbleBgColor: string
  /** 气泡背景不透明度（0–100）。 */
  bubbleBgOpacity: number
  /** 气泡文字颜色（#rrggbb）。 */
  bubbleTextColor: string
  /** 气泡最长连续可见秒数（0 = 不限；ADR-027 兜底长状态收不到出态）。 */
  bubbleMaxSeconds: number
  model: string
  /** 开发者选项总开关：开启后显示调试面板/触摸部位色块等开发者入口。 */
  developerMode: boolean
  /** 调试面板：显示调试面板（开发用）。 */
  debug: boolean
  /** 显示触摸部位色块（开发者选项，spec §2/§4）。 */
  showTapZones: boolean
  /** AI 驱动总开关（ADR-037）：关闭后角色完全静默（无固定台词可回落）。 */
  aiEnabled: boolean
  /** 待机小动作总开关。 */
  idleMotionEnabled: boolean
  /** AI 使用的 provider 路由（DSH 已配置的 LLM provider）。 */
  aiProvider: string
  /** AI 使用的模型 id。 */
  aiModel: string
  /** 交互条位置（模型上方 / 下方 / 隐藏）。 */
  barPosition: BarPosition
  /** 交互条额外偏移（px，正数远离模型）。 */
  barOffset: number
  /** 注入到 prompt 的最近对话轮数（0 = 不注入，ADR-030）。 */
  aiHistoryCount: number
  /** 注入到 prompt 的最近记忆条数（0 = 不注入，ADR-037）。 */
  aiMemoryCount: number
  /** 新触发的处理方式（ADR-037）：interrupt = 掐掉上一轮立刻反应，queue = 排队等说完。 */
  triggerMode: 'interrupt' | 'queue'
  /** 事件类触发的最小间隔（秒，0 = 不限制；触摸/对话不受限）。 */
  aiMinIntervalSec: number
  /** 静默超时（秒，0 = 关闭）：多久没动静就让角色主动说一句。 */
  idleTimeoutSec: number
  /** 同类事件的触发窗口（秒）：窗口内同类事件只触发一次。 */
  activityWindowSec: number
  /** 按 DSH 事件类型的触发开关（触摸/对话始终可触发）。 */
  eventTriggers: Record<string, boolean>
  /** 事件文案覆写（空 = 内置文案；ADR-039）。 */
  eventTexts: Record<string, string>
  /** 语音合成开关（ADR-033）：开启后走 /speak 流式管线。 */
  ttsEnabled: boolean
  /** 语音模型 slug（OpenRouter speech 模型）。 */
  ttsModel: string
  /** 音色标识（空 = 模型默认）。 */
  ttsVoice: string
  /** 口型跟随开关。 */
  lipsyncEnabled: boolean
  /** 口型强度（0–300）。 */
  lipsyncGain: number
  /** 鼠标跟随范围（% 模型尺寸；0 = 只在模型框内跟随）。 */
  focusRange: number
}

/** GET /api/dsh-waifu/settings 视图（settings.jsonc 读取结果）。 */
interface SettingsView {
  value?: PetSettingsValue
  writable?: boolean
  /** 设置文件级问题（解析失败/读取失败；null 无异常）。 */
  error?: string | null
  /** 设置文件绝对路径（不展示，仅类型对齐）。 */
  path?: string
}

/** GET /api/dsh-waifu/ai-options（Host 侧 DSH llm 目录，ADR-025）。 */
interface AiOptionsView {
  providers: { id: string; name: string }[]
  models: Record<string, { id: string; name: string }[]>
}

interface SettingsState {
  status: 'loading' | 'ready' | 'unavailable'
  value?: PetSettingsValue
  writable: boolean
  /** 设置文件级问题（顶部提示；null 无异常）。 */
  error?: string | null
}

/** 设置项兜底值：标量统一取自 defaults.ts（单一来源），模型 id 单独取默认。 */
const DEFAULT_VALUE: PetSettingsValue = {
  ...DEFAULT_SETTINGS,
  model: DEFAULT_MODEL_ID,
}

/** 触发场景中文名（触发开关列表）。 */
const TRIGGER_EVENT_LABELS: Record<string, string> = {
  thinking: '思考中',
  error: '出错',
  done: '完成',
  delivered: '交付成果',
  waiting: '等确认',
  'tool-read': '工具·读取',
  'tool-write': '工具·写入',
  'tool-run': '工具·执行命令',
  'tool-agent': '工具·派出子代理',
  'tool-other': '工具·其他',
  'approval-granted': '审批·通过',
  'approval-denied': '审批·拒绝',
  'session-open': '会话·开启',
  'session-close': '会话·结束',
  'subagent-start': '子代理·出发',
  'subagent-end': '子代理·归来',
}

/** 触发场景开关顺序（ANIMATION_SLOTS 去掉 idle + ACTIVITY_EVENTS）。 */
const TRIGGER_ORDER: readonly string[] = [...ANIMATION_SLOTS.slice(1), ...ACTIVITY_EVENTS]

/** 深拷贝部位草稿（避免设置页草稿与共享对象 / 事件 detail 互相污染）。 */
function cloneTouchParts(parts: readonly TouchPart[]): TouchPart[] {
  return parts.map((part) => ({
    id: part.id,
    name: part.name,
    boxes: part.boxes.map((box) => ({ ...box })),
    ...(part.interactions && part.interactions.length > 0
      ? { interactions: part.interactions.map((item) => ({ ...item })) }
      : {}),
  }))
}

/** 0–1 → 百分比整数（设置页输入框按 0–100 显示）。 */
function toPercent(value: number): number {
  return Math.round(value * 100)
}

/** 百分比输入 → 0–1（clamp 0–100；非有限数按 0）。 */
function fromPercentInput(raw: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n)) / 100
}

/** 归一化草稿 box（与 Host normalizeTouchBox 一致：交换左右/上下顺序）。 */
function orderTouchBox(box: TouchBox): TouchBox {
  return {
    left: Math.min(box.left, box.right),
    top: Math.min(box.top, box.bottom),
    right: Math.max(box.left, box.right),
    bottom: Math.max(box.top, box.bottom),
  }
}

/**
 * 设置页把 box 坐标按**左下角**为原点显示（更符合直觉：上 = box 上边离底边的距离，调大即往上长）。
 * 存储仍是相对左上角的归一化 {left, top, right, bottom}，只在这一层做互补换算。
 */
function boxFieldPercent(box: TouchBox, key: keyof TouchBox): number {
  if (key === 'top') return Math.round((1 - box.top) * 100)
  if (key === 'bottom') return Math.round((1 - box.bottom) * 100)
  return toPercent(box[key])
}

/** 以左下角为原点的百分比输入 → 归一化 box（写回存储前照旧校正左右/上下顺序）。 */
function applyBoxField(box: TouchBox, key: keyof TouchBox, raw: string): TouchBox {
  const value = fromPercentInput(raw)
  if (key === 'top') return orderTouchBox({ ...box, top: 1 - value })
  if (key === 'bottom') return orderTouchBox({ ...box, bottom: 1 - value })
  return orderTouchBox({ ...box, [key]: value })
}

/** 触摸部位每个 box 的四个边（设置页输入框顺序：左 / 上 / 右 / 下；原点在左下角）。 */
const TOUCH_BOX_FIELDS: { key: keyof TouchBox; label: string }[] = [
  { key: 'left', label: '左' },
  { key: 'top', label: '上' },
  { key: 'right', label: '右' },
  { key: 'bottom', label: '下' },
]

/** 新 box 的默认位置（相对包围盒 30%–70%）。 */
const DEFAULT_TOUCH_BOX: TouchBox = { left: 0.3, top: 0.3, right: 0.7, bottom: 0.7 }

/** 生成不重复的部位 id（part-1、part-2……）。 */
function nextTouchPartId(parts: readonly TouchPart[]): string {
  const used = new Set(parts.map((part) => part.id))
  let index = parts.length + 1
  let id = `part-${index}`
  while (used.has(id)) {
    index += 1
    id = `part-${index}`
  }
  return id
}

/** 触摸部位 + 事件绑定文件视图（GET /api/dsh-waifu/touch-parts 响应）。 */
interface TouchPartsView {
  model: string
  parts: TouchPart[]
  saved: boolean
  error: string | null
  path: string
}

/** 读取当前选中模型的部位 + 事件绑定（GET；Host 不可达返回 null）。 */
async function loadTouchParts(): Promise<TouchPartsView | null> {
  try {
    const response = await fetch(TOUCH_PARTS_API)
    if (!response.ok) return null
    return await response.json() as TouchPartsView
  } catch {
    return null
  }
}

/**
 * 保存当前模型的部位草稿（POST；Host 不可达返回 null）。
 */
async function saveTouchPartsToHost(
  model: string,
  parts: TouchPart[],
): Promise<{ ok: boolean; error: string | null } | null> {
  try {
    const response = await fetch(TOUCH_PARTS_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, parts }),
    })
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }
    const data = await response.json() as { ok?: boolean; error?: string | null }
    return { ok: data?.ok !== false, error: data?.error ?? null }
  } catch {
    return null
  }
}

const SETTINGS_API = '/api/dsh-waifu/settings'
const TOUCH_PARTS_API = '/api/dsh-waifu/touch-parts'
const AI_OPTIONS_API = '/api/dsh-waifu/ai-options'
const AI_CHECK_API = '/api/dsh-waifu/ai-check'
const PERSONA_API = '/api/dsh-waifu/persona'
const MEMORY_API = '/api/dsh-waifu/memory'

/* ---- 设计 token（DSH Theme 变量；深/浅色自动适配） ---- */
const C = {
  bgBase: 'var(--dsw-alias-bg-base)',
  bgLayer1: 'var(--dsw-alias-bg-layer-1)',
  bgLayer2: 'var(--dsw-alias-bg-layer-2)',
  bgOverlay: 'var(--dsw-alias-bg-overlay)',
  borderL1: 'var(--dsw-alias-border-l1)',
  borderL2: 'var(--dsw-alias-border-l2)',
  textPrimary: 'var(--dsw-alias-label-primary)',
  textSecondary: 'var(--dsw-alias-label-secondary)',
  brand: 'var(--dsw-alias-brand-primary)',
  error: 'var(--dsw-alias-state-error-primary)',
  success: 'var(--dsw-alias-state-success-primary)',
  warn: 'var(--dsw-alias-state-warn-primary)',
  idle: 'var(--dsw-alias-state-idle-primary)',
} as const

/** 间距网格（4/8/12/16/24/32；分组之间 28）。 */
const GAP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, section: 28 } as const

/** Section：标题 15/600 primary + 说明 12 secondary + 右侧可选操作，组间距 28。 */
const sectionStyle: CSSProperties = { marginTop: GAP.section }
/** 分组头：标题行（标题 + 右侧操作）在上，说明独占整行宽度在下方。 */
const sectionHeaderStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 0,
  marginBottom: GAP.sm,
}
const sectionHeaderTitleRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: GAP.sm,
  minWidth: 0,
}
const sectionHeadingStyle: CSSProperties = {
  margin: 0,
  fontSize: 15,
  fontWeight: 600,
  color: C.textPrimary,
  lineHeight: 1.4,
}
const sectionDescStyle: CSSProperties = {
  margin: '4px 0 0',
  fontSize: 12,
  color: C.textSecondary,
  lineHeight: 1.6,
}
const sectionHeaderActionStyle: CSSProperties = { flexShrink: 0, display: 'flex', alignItems: 'center', gap: GAP.sm }
/** 卡片内标题 13/600 primary。 */
const cardHeadingStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: C.textPrimary,
  marginBottom: GAP.sm,
}

/** 统一 SectionHeader：标题 + 说明（放标题下方）+ 右侧可选操作。 */
/** 表单行左侧的 label：标题一行，说明（可选）挂在下面——说明永远在控件**前面**，不在后面。 */
function FormLabel(props: { title: string; hint?: ReactNode }): ReactElement {
  return createElement('div', { style: formLabelColumnStyle },
    createElement('span', { style: { ...formLabelInlineStyle, flex: 'none' } }, props.title),
    props.hint ? createElement('span', { style: formLabelHintStyle }, props.hint) : null,
  )
}

/** 卡片内的折叠块：头部一行（标题 + 右侧展开/收起），展开内容用左侧细线缩进。 */
const foldHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: GAP.sm,
  minHeight: 26,
}
const foldTitleStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  fontSize: 12,
  color: C.textPrimary,
  lineHeight: 1.5,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}
const foldMetaStyle: CSSProperties = { fontSize: 11, color: C.textSecondary, flexShrink: 0 }
const foldBodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: GAP.sm,
  marginTop: GAP.xs,
  marginLeft: 2,
  paddingLeft: GAP.md,
  borderLeft: `2px solid ${C.borderL1}`,
}
/** 折叠块右侧的展开/收起按钮：与卡片里的次级按钮同款，但更矮更轻。 */
function FoldToggle(props: { open: boolean; disabled?: boolean; onClick: () => void }): ReactElement {
  return createElement('button', {
    type: 'button',
    className: 'dsh-btn dsh-btn-secondary',
    style: { ...buttonSecondaryStyle, height: 22, padding: '0 8px', fontSize: 11, lineHeight: 1, flexShrink: 0 },
    disabled: props.disabled,
    onClick: props.onClick,
  }, props.open ? '收起' : '编辑')
}

function SectionHeader(props: { title: string; description?: ReactNode; action?: ReactNode }): ReactElement {
  const { title, description, action } = props
  return createElement('div', { style: sectionHeaderStyle },
    createElement('div', { style: sectionHeaderTitleRowStyle },
      createElement('h3', { style: sectionHeadingStyle }, title),
      action !== undefined ? createElement('div', { style: sectionHeaderActionStyle }, action) : null,
    ),
    description !== undefined ? createElement('div', { style: sectionDescStyle }, description) : null,
  )
}

/** Card：容器 0 padding；标题行/内容区分别控制，卡片间距 10。 */
const cardStyle: CSSProperties = {
  background: C.bgLayer1,
  border: `1px solid ${C.borderL1}`,
  borderRadius: 10,
  marginBottom: 10,
  color: C.textPrimary,
}
/** 无折叠头部的简单卡片：统一 12/14 内边距。 */
const cardPadStyle: CSSProperties = { ...cardStyle, padding: '12px 14px' }
const rowStyle: CSSProperties = cardPadStyle
const labelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: GAP.sm,
  cursor: 'pointer',
  flex: 1,
  minWidth: 0,
  fontSize: 13,
  color: C.textPrimary,
}
const hintStyle: CSSProperties = { fontSize: 12, color: C.textSecondary, lineHeight: 1.6 }

/** CardHeader：一行 flex；[chevron][标题][摘要 flex1][右侧操作组]。 */
const cardHeaderRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: GAP.sm,
  padding: '12px 14px',
  minHeight: 44,
  boxSizing: 'border-box',
}
const cardBodyStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: GAP.sm, padding: '0 14px 12px' }
const chevronStyle: CSSProperties = {
  width: 20,
  height: 20,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  borderRadius: 6,
  color: C.textSecondary,
  fontSize: 11,
  lineHeight: 1,
  transition: 'transform .15s',
}
const chevronButtonStyle: CSSProperties = {
  ...chevronStyle,
  padding: 0,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
}

/** Buttons：统一 height 28 / padding 0 12 / radius 8 / font 12，明确边框与背景。 */
const buttonBaseStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 28,
  padding: '0 12px',
  borderRadius: 8,
  fontSize: 12,
  lineHeight: 1,
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  cursor: 'pointer',
  border: '1px solid transparent',
  background: 'transparent',
  color: C.textPrimary,
}
/** secondary：layer-2 背景 + 1px border-l2 + label-primary。 */
const buttonSecondaryStyle: CSSProperties = { ...buttonBaseStyle, background: C.bgLayer2, borderColor: C.borderL2 }
/** primary：brand 填充 + 白字。 */
const buttonPrimaryStyle: CSSProperties = {
  ...buttonBaseStyle,
  background: C.brand,
  borderColor: C.brand,
  color: '#ffffff',
}
/** danger：error 边框 + error 文字 + 极浅 error 背景。 */
const buttonDangerStyle: CSSProperties = {
  ...buttonBaseStyle,
  background: `color-mix(in srgb, ${C.error} 10%, transparent)`,
  borderColor: C.error,
  color: C.error,
}

/** Input / Textarea：height 28 / radius 8 / border-l1 / font 13；focus 边框 brand（注入 CSS）。 */
const inputStyle: CSSProperties = {
  boxSizing: 'border-box',
  height: 28,
  padding: '0 8px',
  borderRadius: 8,
  border: `1px solid ${C.borderL1}`,
  background: C.bgBase,
  color: C.textPrimary,
  fontSize: 13,
  fontFamily: 'inherit',
  minWidth: 0,
  flex: 1,
  outline: 'none',
}

/** 原生下拉：和输入框同尺寸（provider / 模型选择用）。 */
const selectStyle: CSSProperties = {
  ...inputStyle,
  appearance: 'none',
  paddingRight: 8,
  cursor: 'pointer',
}
/** 台词输入框：固定高度（不随行数伸缩、不可拖拽），超出滚动。 */
const textareaStyle: CSSProperties = {
  ...inputStyle,
  height: 96,
  minHeight: 96,
  maxHeight: 96,
  padding: '6px 8px',
  lineHeight: 1.45,
  overflowY: 'auto',
  resize: 'none',
}
const chipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 20,
  padding: '0 8px',
  borderRadius: 999,
  background: C.bgLayer2,
  color: C.textSecondary,
  fontSize: 12,
  lineHeight: 1,
  whiteSpace: 'nowrap',
  flexShrink: 0,
}
const statusTextStyle: CSSProperties = { fontSize: 12, lineHeight: 1.5 }
/** 表单行：grid 96px label + 1fr 控件；行距 8；textarea 行顶部对齐。 */
/** 设置项行与下一行之间的统一间距（所有表单行共用，别再逐行覆盖 marginBottom）。 */
const ROW_GAP = 10
const formRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '96px minmax(0,1fr)',
  alignItems: 'center',
  columnGap: GAP.md,
  marginBottom: ROW_GAP,
}
const formRowStartStyle: CSSProperties = { ...formRowStyle, alignItems: 'start' }
const formLabelStyle: CSSProperties = { fontSize: 12, color: C.textSecondary, lineHeight: 1.5 }
const formControlStyle: CSSProperties = { minWidth: 0, display: 'flex', alignItems: 'center', gap: GAP.sm }
/**
 * 单行表单行：label 占满左侧剩余空间（不换行、不被挤扁），控件靠右固定宽度。
 * 比 96px 固定 label 列更省地方——「中心距右（% 窗口宽）」这类长 label 也能一行排下。
 */
const formRowInlineStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: GAP.md,
  marginBottom: ROW_GAP,
}
const formLabelInlineStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  fontSize: 12,
  color: C.textSecondary,
  lineHeight: 1.5,
  whiteSpace: 'nowrap',
}
/** label 列：标题 + 可选说明（说明挂在标题下方，不放到控件后面）。 */
const formLabelColumnStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
}
const formLabelHintStyle: CSSProperties = {
  fontSize: 11,
  color: C.textSecondary,
  lineHeight: 1.5,
  whiteSpace: 'normal',
}
/** 行内控件组：靠右、不参与 label 的拉伸。 */
const formControlInlineStyle: CSSProperties = {
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: GAP.sm,
}

/** box 编辑表格：列宽固定（# 24 / 四项 1fr / 删除 56）。 */
const boxGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '24px repeat(4, minmax(0, 1fr)) 56px',
  columnGap: GAP.sm,
  alignItems: 'center',
}
const boxHeaderCellStyle: CSSProperties = { fontSize: 12, color: C.textSecondary }
const boxCellInputStyle: CSSProperties = { ...inputStyle, width: '100%', flex: 'none' }
/** 卡片头固定尺寸操作按钮。 */
const moveButtonStyle: CSSProperties = { ...buttonSecondaryStyle, width: 34, minWidth: 34, padding: 0 }
const deletePartButtonStyle: CSSProperties = { ...buttonDangerStyle, width: 88, minWidth: 88, padding: 0 }
const deleteBoxButtonStyle: CSSProperties = { ...buttonDangerStyle, width: 56, minWidth: 56, padding: 0 }

/** 状态提示：已保存 success / 未保存 warn / 失败 error / 中性 secondary。 */
const noticeBaseStyle: CSSProperties = { margin: '0 0 8px', fontSize: 12, lineHeight: 1.6 }
const noticeErrorStyle: CSSProperties = { ...noticeBaseStyle, color: C.error }
const noticeMutedStyle: CSSProperties = { ...noticeBaseStyle, color: C.textSecondary }

/** 组内 sticky 保存行（半透明 + 模糊，避免遮挡内容时突兀）。 */
const stickyRowStyle: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: GAP.sm,
  padding: '8px 12px',
  marginBottom: GAP.sm,
  borderRadius: 8,
  background: C.bgLayer2,
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  border: `1px solid ${C.borderL1}`,
}

/** 下拉选项（与设置页其它控件同色板，避免原生 select 的白框/底线）。 */
interface ThemeSelectOption {
  id: string
  name: string
  /** 分组名：有值时下拉列表里按组显示小标题。 */
  group?: string
  /** 互斥键：同键的选项只能选一个（动作组共用 `motion`；表情按模型的互斥组区分）。 */
  exclusive?: string
}

const MAX_FPS_OPTIONS: ThemeSelectOption[] = [
  { id: '30', name: '30' },
  { id: '60', name: '60' },
  { id: '0', name: '不限制帧率' },
]

/** 归一化设置里的帧率档（非法值回落默认 30）。 */
function normalizeMaxFps(raw: unknown): number {
  if (raw === 60 || raw === 0) return raw
  return 30
}

/** 画布留白（%）：clamp 到 0–300 的整数；非法值回落 fallback。 */
function normalizeCanvasPad(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(300, Math.max(0, Math.round(n)))
}

/** 默认停靠位置（px）：clamp 到 0–4000 的整数；非法值回落 fallback。 */
function normalizeHomePosition(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(100, Math.max(0, Math.round(n)))
}

/** 气泡偏移（px）：clamp 到 -1000–1000 的整数；非法值回落 fallback。 */
function normalizeBubbleOffset(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1000, Math.max(-1000, Math.round(n)))
}

/** 气泡背景不透明度（0–100 整数）；非法值回落 fallback。 */
function normalizeBubbleOpacity(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(100, Math.max(0, Math.round(n)))
}

/** 气泡最长显示秒数（0–600 整数，0 = 不限）；非法值回落 fallback。 */
function normalizeBubbleMax(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(600, Math.max(0, Math.round(n)))
}

/** 颜色值统一为小写 #rrggbb；非法值回落 fallback。 */
function normalizeHexColor(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.trim())) return raw.trim().toLowerCase()
  return fallback
}

/** 本地时间 HH:MM:SS（页面级保存状态栏显示「已保存 HH:MM:SS」）。 */
function formatClock(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

interface ThemeRadioGroupProps {
  value: string
  options: ThemeSelectOption[]
  disabled?: boolean
  name: string
  onChange: (id: string) => void
}

/** 选中态强调色（与设置页其它高亮一致，贴近系统 radio 蓝点观感）。 */
const RADIO_ACCENT = C.brand
const RADIO_RING = C.borderL2

/** 自绘圆点：帧率档与模型列表共用，避免原生 radio 深色主题白框。 */
function ThemeRadioDot(props: { selected: boolean }): ReactElement {
  const { selected } = props
  return createElement('span', {
    'aria-hidden': true,
    style: {
      width: 14,
      height: 14,
      borderRadius: '50%',
      boxSizing: 'border-box',
      border: `1.5px solid ${selected ? RADIO_ACCENT : RADIO_RING}`,
      background: 'transparent',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
  },
    selected
      ? createElement('span', {
        style: {
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: RADIO_ACCENT,
        },
      })
      : null,
  )
}

interface ThemeRadioOptionProps {
  selected: boolean
  disabled?: boolean
  onSelect: () => void
  children: ReactNode
  style?: CSSProperties
}

/** 可点的圆点 + 文案行（帧率横排 / 模型行复用）。 */
function ThemeRadioOption(props: ThemeRadioOptionProps): ReactElement {
  const { selected, disabled, onSelect, children, style } = props
  return createElement('button', {
    type: 'button',
    role: 'radio',
    'aria-checked': selected,
    disabled: !!disabled,
    onClick: () => { if (!disabled && !selected) onSelect() },
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      margin: 0,
      padding: 0,
      border: 'none',
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
      fontSize: 13,
      cursor: disabled ? 'not-allowed' : 'pointer',
      outline: 'none',
      minWidth: 0,
      ...style,
    },
  },
    createElement(ThemeRadioDot, { selected }),
    children,
  )
}

/** 自绘圆形单选组：一行多档；圆点走 ThemeRadioDot。 */
function ThemeRadioGroup(props: ThemeRadioGroupProps): ReactElement {
  const { value, options, disabled, name, onChange } = props
  return createElement('div', {
    role: 'radiogroup',
    'aria-label': name,
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: '8px 16px',
      opacity: disabled ? 0.55 : 1,
    },
  },
    options.map((o) => createElement(ThemeRadioOption, {
      key: o.id,
      selected: o.id === value,
      disabled,
      onSelect: () => onChange(o.id),
      children: createElement('span', null, o.name),
    })),
  )
}

interface ThemeSwitchProps {
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}

/** 自绘 switch：用于开发者选项总开关等“组标题右侧开关”场景。 */
function ThemeSwitch(props: ThemeSwitchProps): ReactElement {
  const { checked, disabled, onChange } = props
  return createElement('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': checked,
    disabled: !!disabled,
    onClick: () => { if (!disabled) onChange(!checked) },
    style: {
      position: 'relative',
      width: 38,
      height: 20,
      flexShrink: 0,
      padding: 0,
      border: 'none',
      borderRadius: 10,
      cursor: disabled ? 'not-allowed' : 'pointer',
      background: checked ? RADIO_ACCENT : C.borderL2,
      opacity: disabled ? 0.55 : 1,
      transition: 'background .15s',
      outline: 'none',
    },
  },
    createElement('span', {
      style: {
        position: 'absolute',
        top: 2,
        left: checked ? 20 : 2,
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: C.textPrimary,
        boxShadow: '0 1px 3px rgba(0,0,0,.4)',
        transition: 'left .15s',
      },
    }),
  )
}

/** 设置路径 op（与 Host settings.mutate 对齐）。 */
type SettingsOp = { op: 'set' | 'unset'; path: string[]; value?: unknown }

/** 读取设置（GET）。 */
async function loadSettings(): Promise<SettingsView | null> {
  try {
    const response = await fetch(SETTINGS_API)
    if (!response.ok) return null
    return await response.json() as SettingsView
  } catch {
    return null
  }
}

/** 写入设置（POST 路径 op；返回写后视图）。 */
async function writeSettings(ops: SettingsOp[]): Promise<SettingsView | null> {
  try {
    const response = await fetch(SETTINGS_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ops }),
    })
    if (!response.ok) return null
    return await response.json() as SettingsView
  } catch {
    return null
  }
}

/** 设置页组件 props：保留空对象以便入口 `createElement(PetSettingsSection, {})`。 */
export interface PetSettingsProps {}

export function PetSettingsSection(_props: PetSettingsProps): ReactNode {
  const [state, setState] = useState<SettingsState>({ status: 'loading', writable: false })
  // 最新视图 ref：写入 ops 在出队时按最新状态合成，避免快速操作读到过期闭包
  const stateRef = useRef(state)
  const setSettingsState = (next: SettingsState | ((prev: SettingsState) => SettingsState)): void => {
    const resolved = typeof next === 'function' ? next(stateRef.current) : next
    stateRef.current = resolved
    setState(resolved)
  }
  const reload = useCallback(() => {
    loadSettings().then((view) => {
      if (view === null) {
        setSettingsState((prev) => prev.status === 'ready' ? prev : { status: 'unavailable', writable: false })
        return
      }
      setSettingsState({ status: 'ready', value: view.value, writable: view.writable !== false, error: view.error ?? null })
    })
  }, [])
  useEffect(() => { reload() }, [reload])

  const value = state.value ?? DEFAULT_VALUE
  const writable = state.writable
  /** 当前选中模型（设置未就绪时为空，事件绑定/触摸部位分组暂不加载）。 */
  const selectedModel = state.status === 'ready' ? value.model : ''

  // 尺寸滑杆：拖动中本地草稿，松手/失焦提交（避免拖动写满 settings.jsonc）
  const [draftSize, setDraftSize] = useState<number | null>(null)
  useEffect(() => { setDraftSize(null) }, [value.size])
  const size = draftSize ?? value.size
  const commitSize = () => {
    if (draftSize === null) return
    const nextSize = draftSize
    enqueueWrite(() => [{ op: 'set', path: ['size'], value: nextSize }])
    setDraftSize(null)
  }

  // 归位提示（约 2 秒后消失）
  const [resetNotice, setResetNotice] = useState<string | null>(null)
  const resetNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 归位：广播命令给宠物半边，按「显示区中心距右/距下」重新计算位置并持久化。 */
  const requestRecenter = (): void => {
    emitRecenter()
    setResetNotice('已归位')
    if (resetNoticeTimer.current !== null) clearTimeout(resetNoticeTimer.current)
    resetNoticeTimer.current = setTimeout(() => setResetNotice(null), 2000)
  }

  // 写入串行化：ops 在出队时基于最新视图合成，避免快速操作读到过期状态。
  const writeQueue = useRef<Promise<void>>(Promise.resolve())
  const enqueueWrite = (compose: (current: PetSettingsValue) => SettingsOp[]): void => {
    writeQueue.current = writeQueue.current.then(async () => {
      const current = stateRef.current.value ?? DEFAULT_VALUE
      const view = await writeSettings(compose(current))
      if (view !== null) setSettingsState({ status: 'ready', value: view.value, writable: view.writable !== false, error: view.error ?? null })
    })
  }

  /**
   * 捕捉：向宠物半边要「角色现在的位置」，换算成「显示中心距右/距下」的百分比后写成新的默认位置。
   * 百分比按视口宽/高算（与 homePositionFromConfig 一致），所以换窗口尺寸后仍落在同一相对位置。
   */
  const requestCapture = (): void => {
    emitCaptureHome((home) => {
      enqueueWrite(() => [
        { op: 'set', path: ['homeRight'], value: home.right },
        { op: 'set', path: ['homeBottom'], value: home.bottom },
      ])
      setResetNotice(`已捕捉默认位置：${home.right}% / ${home.bottom}%`)
      if (resetNoticeTimer.current !== null) clearTimeout(resetNoticeTimer.current)
      resetNoticeTimer.current = setTimeout(() => setResetNotice(null), 2400)
    })
  }

  // ---- 事件绑定 + 触摸部位（同一模型、同一份草稿、同一保存队列） ----
  const [aiOptions, setAiOptions] = useState<AiOptionsView | null>(null)
  const [personaDraft, setPersonaDraft] = useState<string | null>(null)
  const [personaStatus, setPersonaStatus] = useState<string | null>(null)
  const [personaSaving, setPersonaSaving] = useState(false)
  const [ttsStatus, setTtsStatus] = useState<string | null>(null)
  const [ttsBusy, setTtsBusy] = useState(false)
  const [aiCheckStatus, setAiCheckStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [aiChecking, setAiChecking] = useState(false)

  /** 连通性自检：真实发一次请求，把成功台词或失败原因就地显示（排查 provider 差异用）。 */
  const checkAi = (): void => {
    if (aiChecking) return
    setAiChecking(true)
    setAiCheckStatus(null)
    void fetch(`${AI_CHECK_API}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: value.aiProvider, model: value.aiModel }),
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ ok?: boolean; text?: string; error?: string }>) : null))
      .then((result) => {
        if (!result) { setAiCheckStatus({ ok: false, text: '请求失败' }); return }
        setAiCheckStatus(result.ok
          ? { ok: true, text: result.text ?? '（空回复）' }
          : { ok: false, text: result.error ?? '未知错误' })
      })
      .catch(() => setAiCheckStatus({ ok: false, text: '请求异常' }))
      .finally(() => setAiChecking(false))
  }

  // AI 回复（ADR-025）：provider/model 候选取 Host 的 llm 目录；人设文件按需读取
  useEffect(() => {
    let cancelled = false
    void fetch(`${AI_OPTIONS_API}`)
      .then((res) => (res.ok ? (res.json() as Promise<AiOptionsView>) : null))
      .then((view) => { if (!cancelled) setAiOptions(view) })
      .catch(() => { if (!cancelled) setAiOptions(null) })
    return () => { cancelled = true }
  }, [])
  const aiEnabled = value.aiEnabled
  useEffect(() => {
    if (!aiEnabled) return
    let cancelled = false
    void fetch(`${PERSONA_API}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ text?: string }>) : null))
      .then((view) => {
        if (cancelled || typeof view?.text !== 'string') return
        setPersonaDraft(view.text)
      })
      .catch(() => { if (!cancelled) setPersonaStatus('人设读取失败') })
    return () => { cancelled = true }
  }, [aiEnabled])

  /** 保存人设到 $DSH_HOME/waifu/persona.md。 */
  const savePersona = (): void => {
    if (personaDraft === null || personaSaving) return
    setPersonaSaving(true)
    setPersonaStatus(null)
    void fetch(`${PERSONA_API}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: personaDraft }),
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ path?: string }>) : null))
      .then((view) => {
        setPersonaStatus(view === null ? '保存失败' : '已保存，下一次触摸生效')
      })
      .catch(() => setPersonaStatus('保存失败'))
      .finally(() => setPersonaSaving(false))
  }
  // 记忆（ADR-037）：memory.md 查看编辑；AI 输出 [记] 行时 Host 会往里追加
  const [memoryDraft, setMemoryDraft] = useState<string | null>(null)
  const [memoryStatus, setMemoryStatus] = useState<string | null>(null)
  const [memorySaving, setMemorySaving] = useState(false)
  useEffect(() => {
    if (!aiEnabled) return
    let cancelled = false
    void fetch(`${MEMORY_API}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ text?: string }>) : null))
      .then((view) => {
        if (cancelled || typeof view?.text !== 'string') return
        setMemoryDraft(view.text)
      })
      .catch(() => setMemoryStatus('记忆读取失败'))
    return () => { cancelled = true }
  }, [aiEnabled])
  const saveMemory = (): void => {
    if (memoryDraft === null || memorySaving) return
    setMemorySaving(true)
    setMemoryStatus(null)
    void fetch(`${MEMORY_API}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: memoryDraft }),
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ path?: string }>) : null))
      .then((view) => {
        setMemoryStatus(view === null ? '保存失败' : '已保存，下一次反应生效')
      })
      .catch(() => setMemoryStatus('保存失败'))
      .finally(() => setMemorySaving(false))
  }
  const memoryLineCount = (memoryDraft ?? '').split('\n').filter((line) => line.trim() !== '').length
  // 设置页折叠态（ADR-039 之后不再写第二行小字，长内容一律折叠）
  const [openScenes, setOpenScenes] = useState<Record<string, boolean>>({})
  const [personaOpen, setPersonaOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const modelDraftRef = useRef('')
  const [touchDraft, setTouchDraft] = useState<TouchPart[]>([])
  const touchDraftRef = useRef<TouchPart[]>([])
  const [partStatus, setPartStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [touchEditing, setTouchEditing] = useState(false)
  const touchEditingRef = useRef(false)
  const [expandedPartId, setExpandedPartId] = useState<string | null>(null)
  const expandedPartRef = useRef<string | null>(null)
  /** 部位粒度 dirty（partId 集合）+ 结构变更（新建/删除/上下移没有卡片可挂提示）。 */
  const [dirtyPartIds, setDirtyPartIds] = useState<Set<string>>(() => new Set())
  const dirtyPartIdsRef = useRef<Set<string>>(new Set())
  const [structureDirty, setStructureDirty] = useState(false)
  const structureDirtyRef = useRef(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle')
  /** 触摸部位分组级「已保存」提示（结构变更保存时，约 3 秒）。 */
  const [touchSavedFlash, setTouchSavedFlash] = useState<string | null>(null)
  /** 部位卡片就地「已保存 HH:MM:SS」提示（仅触发保存的那张卡片，约 3 秒）。 */
  const [savedPartFlash, setSavedPartFlash] = useState<{ partId: string; time: string } | null>(null)
  const savedPartTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 本次保存的来源（部位卡 / 结构行 / 事件卡），用于决定「已保存」提示落在哪里。 */
  const saveSourceRef = useRef<
    { type: 'part'; id: string }
    | { type: 'structure' }
    | null
  >(null)
  const flashTimers = useRef<{ touch?: ReturnType<typeof setTimeout> }>({})
  const partsDirty = dirtyPartIds.size > 0 || structureDirty
  /** 写入串行化：避免并发 POST 在 Host 端出现读改写丢失。 */
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  /** 草稿编辑版本号：保存响应回来时据此判断是否还有更新改动未保存。 */
  const editVersionRef = useRef(0)
  const saveSeq = useRef(0)
  const loadSeq = useRef(0)
  const [reloadKey, setReloadKey] = useState(0)

  const readOnly = !writable || partStatus !== 'ready'

  const setExpandedPart = (id: string | null): void => {
    expandedPartRef.current = id
    setExpandedPartId(id)
  }

  /** 广播当前编辑态草稿（宠物悬浮层实时重绘 box；只影响预览，不影响编辑权限）。 */
  const emitTouchDraft = (active: boolean, parts: readonly TouchPart[], highlight: string | null): void => {
    const model = modelDraftRef.current
    if (!model) return
    emitTouchEdit({ active, model, parts: cloneTouchParts(parts), highlightPartId: highlight })
  }

  /** 触摸部位分组级「已保存 HH:MM:SS」（结构变更保存时，约 3 秒）。 */
  const showTouchSavedFlash = (time: string): void => {
    setTouchSavedFlash(time)
    const existing = flashTimers.current.touch
    if (existing !== undefined) clearTimeout(existing)
    flashTimers.current.touch = setTimeout(() => setTouchSavedFlash(null), 3000)
  }

  /** 部位卡片就地「已保存 HH:MM:SS」（约 3 秒，与脏提示同位置替换）。 */
  const flashSavedPart = (partId: string, time: string): void => {
    setSavedPartFlash({ partId, time })
    // 部位级提示优先：清掉可能还在显示的分组级提示
    setTouchSavedFlash(null)
    if (savedPartTimer.current !== null) clearTimeout(savedPartTimer.current)
    savedPartTimer.current = setTimeout(() => setSavedPartFlash(null), 3000)
  }

  /** 某部位字段变化：只把该部位标记为 dirty。 */
  const markPartDirty = (id: string): void => {
    if (dirtyPartIdsRef.current.has(id)) return
    const next = new Set(dirtyPartIdsRef.current)
    next.add(id)
    dirtyPartIdsRef.current = next
    setDirtyPartIds(next)
  }

  /** 结构变化（新建/删除/上移/下移）：没有卡片可挂提示，置结构 dirty。 */
  const markStructureDirty = (): void => {
    structureDirtyRef.current = true
    setStructureDirty(true)
  }

  /** 保存成功：清空全部部位/结构 dirty。 */
  const clearAllDirty = (): void => {
    dirtyPartIdsRef.current = new Set()
    structureDirtyRef.current = false
    setDirtyPartIds(new Set())
    setStructureDirty(false)
  }

  /** 是否存在未保存的部位字段/结构改动。 */
  const hasPendingParts = (): boolean => dirtyPartIdsRef.current.size > 0 || structureDirtyRef.current

  /**
   * 串行写回草稿（{model, parts}）；响应只更新保存状态，不 refetch 覆盖草稿。
   * quiet=true 用于切模型/卸载的防丢补存：只发请求 + clientLog，不改页面状态栏。
   */
  const persistDraft = (
    model: string,
    parts: TouchPart[],
    editVersion: number,
    quiet = false,
  ): void => {
    const summary = `model=${model} parts=${parts.length}`
    saveQueue.current = saveQueue.current.then(async () => {
      const seq = ++saveSeq.current
      if (!quiet) {
        setSaveState('saving')
      }
      const result = await saveTouchPartsToHost(model, parts)
      // 过期响应（已有更新请求/已切模型）只记录日志，不把旧模型状态显示到新模型上
      const isCurrent = seq === saveSeq.current && model === modelDraftRef.current
      if (result === null) {
        clientLog('error', `touch-parts save failed: ${summary} error=host unreachable`)
        if (!quiet && isCurrent) {
          saveSourceRef.current = null
          setSaveState('error')
        }
        return
      }
      if (!result.ok || result.error) {
        clientLog('error', `touch-parts save failed: ${summary} error=${result.error ?? 'unknown'}`)
        if (!quiet && isCurrent) {
          saveSourceRef.current = null
          setSaveState('error')
        }
        return
      }
      clientLog('info', `touch-parts saved: ${summary}`)
      if (quiet || !isCurrent) return
      // 保存成功后若之后又有新改动，保持 dirty（等用户再次点击保存）
      if (editVersion === editVersionRef.current) clearAllDirty()
      const savedTime = formatClock(new Date())
      const source = saveSourceRef.current
      saveSourceRef.current = null
      if (source?.type === 'part') {
        // 部位卡片触发的保存：就地显示在该卡片头部，不放分组级提示
        flashSavedPart(source.id, savedTime)
      } else if (source?.type === 'structure') {
        // 结构变更保存：分组顶部短暂提示
        showTouchSavedFlash(savedTime)
      }
      setSaveState('idle')
    })
  }

  /** 保存动作（部位卡片「保存」/结构行共用）：显式写回当前完整草稿。 */
  const saveNow = (): void => {
    if (readOnly || !hasPendingParts()) {
      saveSourceRef.current = null
      return
    }
    const model = modelDraftRef.current
    if (!model) return
    persistDraft(model, cloneTouchParts(touchDraftRef.current), editVersionRef.current)
  }

  /** 部位卡片头部「保存」：成功后「已保存 HH:MM:SS」就地显示在该卡片。 */
  const savePartNow = (partId: string): void => {
    saveSourceRef.current = { type: 'part', id: partId }
    saveNow()
  }

  /** 结构变更行「保存」：成功后允许分组级短暂「已保存」提示。 */
  const saveStructureNow = (): void => {
    saveSourceRef.current = { type: 'structure' }
    saveNow()
  }

  /** 触摸部位草稿变更：更新 state/ref；仅对应部位置 dirty（不自动保存、不自动开预览）。 */
  const commitTouchDraft = (next: TouchPart[], highlight?: string | null, dirtyPartId?: string): void => {
    touchDraftRef.current = next
    setTouchDraft(next)
    if (dirtyPartId) markPartDirty(dirtyPartId)
    editVersionRef.current += 1
    setSaveState('idle')
    const highlightId = highlight === undefined ? expandedPartRef.current : highlight
    if (highlight !== undefined) setExpandedPart(highlight)
    // 预览开关只控制宠物上的 box 叠加/强制可见，编辑本身不自动开启预览
    emitTouchDraft(touchEditingRef.current, next, highlightId)
  }

  // 切换选中模型：若有未保存改动先补存（防丢），退出预览，再重新 GET 新模型部位
  useEffect(() => {
    if (state.status !== 'ready' || !selectedModel) return
    const previousModel = modelDraftRef.current
    if (previousModel && previousModel !== selectedModel && hasPendingParts()) {
      // 防丢：自动补存旧模型草稿（静默，不覆盖新模型的状态栏；clientLog 在 persistDraft 内记录）
      persistDraft(previousModel, cloneTouchParts(touchDraftRef.current), editVersionRef.current, true)
    }
    if (touchEditingRef.current) {
      touchEditingRef.current = false
      setTouchEditing(false)
      emitTouchDraft(false, touchDraftRef.current, expandedPartRef.current)
    }
    const seq = ++loadSeq.current
    setPartStatus('loading')
    setLoadError(null)
    setExpandedPart(null)
    setSaveState('idle')
    clearAllDirty()
    setTouchSavedFlash(null)
    setSavedPartFlash(null)
    saveSourceRef.current = null
    if (flashTimers.current.touch !== undefined) {
      clearTimeout(flashTimers.current.touch)
      flashTimers.current.touch = undefined
    }
    if (savedPartTimer.current !== null) {
      clearTimeout(savedPartTimer.current)
      savedPartTimer.current = null
    }
    // 先清空旧模型草稿，避免读取失败时把上一个模型的配置显示成当前模型
    touchDraftRef.current = []
    setTouchDraft([])
    let alive = true
    loadTouchParts().then((view) => {
      if (!alive || seq !== loadSeq.current) return
      if (view === null) {
        setPartStatus('error')
        setLoadError('读取当前模型的配置失败（Host 不可达）')
        return
      }
      modelDraftRef.current = view.model
      const parts = cloneTouchParts(Array.isArray(view.parts) ? view.parts : [])
      touchDraftRef.current = parts
      setTouchDraft(parts)
      setPartStatus('ready')
      setLoadError(view.error ?? null)
    })
    return () => { alive = false }
  }, [selectedModel, state.status, reloadKey])

  // 卸载：若有未保存改动则自动补存（防丢），并通知宠物退出 box 预览
  useEffect(() => () => {
    const model = modelDraftRef.current
    if (!model) return
    if (hasPendingParts()) {
      // 防丢：关闭设置页时自动补存（静默；clientLog 在 persistDraft 内记录）
      persistDraft(model, cloneTouchParts(touchDraftRef.current), editVersionRef.current, true)
    }
    if (flashTimers.current.touch !== undefined) clearTimeout(flashTimers.current.touch)
    if (savedPartTimer.current !== null) clearTimeout(savedPartTimer.current)
    if (resetNoticeTimer.current !== null) clearTimeout(resetNoticeTimer.current)
    emitTouchEdit({ active: false, model, parts: cloneTouchParts(touchDraftRef.current) })
  }, [])

  // ---- 触摸部位操作 ----
  const toggleTouchEditing = (): void => {
    const next = !touchEditingRef.current
    touchEditingRef.current = next
    setTouchEditing(next)
    if (next && !expandedPartRef.current && touchDraftRef.current.length > 0) {
      setExpandedPart(touchDraftRef.current[0].id)
    }
    emitTouchDraft(next, touchDraftRef.current, expandedPartRef.current)
  }

  const updateTouchPart = (id: string, mutate: (part: TouchPart) => TouchPart, highlight?: string | null): void => {
    const next = touchDraftRef.current.map((part) => (part.id === id ? mutate(part) : part))
    commitTouchDraft(next, highlight === undefined ? id : highlight, id)
  }

  const addTouchPart = (): void => {
    const part: TouchPart = { id: nextTouchPartId(touchDraftRef.current), name: '新部位', boxes: [] }
    // 新部位插到数组最前面 = 最上层（parts 数组顺序即图层顺序，第 0 项最上层）
    markStructureDirty()
    commitTouchDraft([part, ...touchDraftRef.current], part.id)
  }

  const removeTouchPart = (id: string): void => {
    const next = touchDraftRef.current.filter((part) => part.id !== id)
    markStructureDirty()
    commitTouchDraft(next, expandedPartRef.current === id ? null : expandedPartRef.current)
  }

  /** 调整图层顺序：direction=-1 上移（更靠顶层，数组索引更小），1 下移。 */
  const moveTouchPart = (id: string, direction: -1 | 1): void => {
    const parts = touchDraftRef.current
    const index = parts.findIndex((part) => part.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= parts.length) return
    const next = [...parts]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    markStructureDirty()
    commitTouchDraft(next)
  }

  const renameTouchPart = (id: string, name: string): void => {
    updateTouchPart(id, (part) => ({ ...part, name: name.slice(0, 24) }))
  }

  const setBoxField = (partId: string, boxIndex: number, key: keyof TouchBox, raw: string): void => {
    updateTouchPart(partId, (part) => ({
      ...part,
      boxes: part.boxes.map((box, index) => (index === boxIndex ? applyBoxField(box, key, raw) : box)),
    }))
  }

  const addBox = (partId: string): void => {
    updateTouchPart(partId, (part) => (part.boxes.length >= MAX_BOXES_PER_PART
      ? part
      : { ...part, boxes: [...part.boxes, { ...DEFAULT_TOUCH_BOX }] }))
  }

  const addInteraction = (partId: string): void => {
    updateTouchPart(partId, (part) => {
      const list = part.interactions ?? []
      if (list.length >= MAX_INTERACTIONS_PER_PART) return part
      const next: TouchInteraction = {
        id: `i${Date.now().toString(36)}${list.length}`,
        name: '新交互',
        trigger: 'tap',
        holdMs: TOUCH_HOLD_DEFAULT_MS,
      }
      return { ...part, interactions: [...list, next] }
    })
  }

  const removeInteraction = (partId: string, interactionId: string): void => {
    updateTouchPart(partId, (part) => {
      const list = (part.interactions ?? []).filter((item) => item.id !== interactionId)
      return list.length > 0 ? { ...part, interactions: list } : { ...part, interactions: undefined }
    })
  }

  const setInteractionName = (partId: string, interactionId: string, raw: string): void => {
    updateTouchPart(partId, (part) => ({
      ...part,
      interactions: (part.interactions ?? []).map((item) =>
        (item.id === interactionId ? { ...item, name: raw.slice(0, INTERACTION_NAME_MAX) } : item)),
    }))
  }

  const setInteractionTrigger = (partId: string, interactionId: string, trigger: InteractionTrigger): void => {
    updateTouchPart(partId, (part) => ({
      ...part,
      interactions: (part.interactions ?? []).map((item) =>
        (item.id === interactionId ? { ...item, trigger } : item)),
    }))
  }

  const setInteractionHoldMs = (partId: string, interactionId: string, raw: string): void => {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return
    const holdMs = Math.round(Math.min(TOUCH_HOLD_LIMITS.max, Math.max(TOUCH_HOLD_LIMITS.min, parsed)))
    updateTouchPart(partId, (part) => ({
      ...part,
      interactions: (part.interactions ?? []).map((item) =>
        (item.id === interactionId ? { ...item, holdMs } : item)),
    }))
  }

  const removeBox = (partId: string, boxIndex: number): void => {
    updateTouchPart(partId, (part) => ({ ...part, boxes: part.boxes.filter((_box, index) => index !== boxIndex) }))
  }

  const reloadAll = (): void => { setReloadKey((key) => key + 1) }

  /** 部位卡片：header = [chevron][层号 chip][名称][↑][↓][删除部位]，统一 28 高垂直居中。 */
  const renderTouchPartCard = (part: TouchPart, index: number): ReactElement => {
    const expanded = expandedPartId === part.id
    const isTopLayer = index === 0
    const isBottomLayer = index === touchDraft.length - 1
    const layerLabel = `#${index + 1}`
    const dirty = dirtyPartIds.has(part.id)
    const toggleExpanded = (): void => {
      const next = expanded ? null : part.id
      setExpandedPart(next)
      emitTouchDraft(touchEditingRef.current, touchDraftRef.current, next)
    }
    return createElement('div', { key: part.id, style: cardStyle },
      createElement('div', { className: 'dsh-card-header-row', style: cardHeaderRowStyle },
        createElement('button', {
          type: 'button',
          title: expanded ? '收起' : '展开',
          'aria-expanded': expanded,
          className: 'dsh-chevron-button',
          style: { ...chevronButtonStyle, transform: expanded ? 'rotate(90deg)' : 'none' },
          onClick: toggleExpanded,
        }, '▸'),
        createElement('span', {
          title: isTopLayer ? `图层 #${index + 1}（最上层，box 重叠时优先）` : `图层 #${index + 1}`,
          style: { ...chipStyle, color: isTopLayer ? C.brand : C.textSecondary },
        }, layerLabel),
        createElement('input', {
          style: { ...inputStyle, flex: 1, minWidth: 80 },
          value: part.name,
          maxLength: 24,
          placeholder: `部位 ${index + 1} 名称（如：头）`,
          disabled: readOnly,
          onChange: (e: ChangeEvent<HTMLInputElement>) => renameTouchPart(part.id, e.target.value),
          onFocus: () => { if (!expanded) { setExpandedPart(part.id); emitTouchDraft(touchEditingRef.current, touchDraftRef.current, part.id) } },
        }),
        createElement('button', {
          type: 'button',
          title: '上移（更靠顶层）',
          'aria-label': '上移',
          className: 'dsh-btn dsh-btn-secondary',
          style: moveButtonStyle,
          disabled: readOnly || isTopLayer,
          onClick: () => moveTouchPart(part.id, -1),
        }, '↑'),
        createElement('button', {
          type: 'button',
          title: '下移（更靠底层）',
          'aria-label': '下移',
          className: 'dsh-btn dsh-btn-secondary',
          style: moveButtonStyle,
          disabled: readOnly || isBottomLayer,
          onClick: () => moveTouchPart(part.id, 1),
        }, '↓'),
        createElement('button', {
          type: 'button',
          className: 'dsh-btn dsh-btn-danger',
          style: deletePartButtonStyle,
          disabled: readOnly,
          onClick: () => removeTouchPart(part.id),
        }, '删除部位'),
      ),
      dirty
        ? createElement('div', {
          key: 'part-dirty',
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: GAP.sm,
            padding: '0 14px 8px',
            fontSize: 12,
            color: C.warn,
          },
        },
          createElement('span', null, '● 未保存改动'),
          createElement('button', {
            type: 'button',
            className: 'dsh-btn dsh-btn-primary',
            style: buttonPrimaryStyle,
            disabled: saveState === 'saving' || readOnly,
            onClick: () => savePartNow(part.id),
          }, '保存'),
        )
        : savedPartFlash?.partId === part.id
          ? createElement('div', {
            key: 'part-saved',
            style: { padding: '0 14px 8px', fontSize: 12, color: C.success },
          }, `已保存 ${savedPartFlash.time}`)
          : null,
      expanded && createElement('div', { style: cardBodyStyle },
        createElement('div', { style: hintStyle },
          '原点在角色左下角（0–100%）：调大「上」= 往上长，调小「下」= 往下长；多个 box 命中任一即算该部位。'),
        part.boxes.length === 0
          ? createElement('div', { style: hintStyle }, '还没有 box，点「+ 添加 box」画出点击区域。')
          : createElement('div', { key: 'box-table', style: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: GAP.sm } },
            createElement('div', { key: 'box-head', style: { ...boxGridStyle, padding: '0 2px' } },
              createElement('span', { style: boxHeaderCellStyle }, '#'),
              ...TOUCH_BOX_FIELDS.map(({ key, label }) => createElement('span', { key, style: boxHeaderCellStyle }, label)),
              createElement('span', { style: boxHeaderCellStyle }, ''),
            ),
            ...part.boxes.map((box, boxIndex) => createElement('div', { key: `box-${boxIndex}`, style: boxGridStyle },
              createElement('span', { style: { fontSize: 12, color: C.textSecondary } }, `#${boxIndex + 1}`),
              ...TOUCH_BOX_FIELDS.map(({ key, label }) => createElement('input', {
                key,
                type: 'number',
                min: 0,
                max: 100,
                step: 1,
                'aria-label': `${label}（%，左下角原点）`,
                value: boxFieldPercent(box, key),
                disabled: readOnly,
                style: boxCellInputStyle,
                onChange: (e: ChangeEvent<HTMLInputElement>) => setBoxField(part.id, boxIndex, key, e.target.value),
              })),
              createElement('button', {
                type: 'button',
                className: 'dsh-btn dsh-btn-danger',
                style: deleteBoxButtonStyle,
                disabled: readOnly,
                onClick: () => removeBox(part.id, boxIndex),
              }, '删除'),
            )),
          ),
        createElement('button', {
          type: 'button',
          className: 'dsh-btn dsh-btn-secondary',
          style: { ...buttonSecondaryStyle, alignSelf: 'flex-start' },
          disabled: readOnly || part.boxes.length >= MAX_BOXES_PER_PART,
          onClick: () => addBox(part.id),
        }, part.boxes.length >= MAX_BOXES_PER_PART ? `box 已达上限（${MAX_BOXES_PER_PART}）` : '+ 添加 box'),
        // 交互（ADR-038）：名字原样透传给模型，触发条件决定什么时候算这一次交互
        createElement('div', { key: 'interactions', style: { marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 } },
          createElement(FormLabel, {
            title: '交互',
            hint: '名字自己起（会原样告诉模型，比如「抚摸」「捏脸」）；这个部位没有交互时，点它不会有任何反应',
          }),
          (part.interactions ?? []).length === 0
            ? createElement('div', { style: hintStyle }, '还没有交互，点「+ 添加交互」造一个。')
            : (part.interactions ?? []).map((item) => createElement('div', {
              key: item.id,
              style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
            },
              createElement('input', {
                type: 'text',
                maxLength: INTERACTION_NAME_MAX,
                'aria-label': '交互名',
                placeholder: '抚摸',
                value: item.name,
                disabled: readOnly,
                style: { ...inputStyle, width: 140 },
                onChange: (e: ChangeEvent<HTMLInputElement>) => setInteractionName(part.id, item.id, e.target.value),
              }),
              createElement('select', {
                value: item.trigger,
                disabled: readOnly,
                style: { ...selectStyle, width: 108 },
                onChange: (e: ChangeEvent<HTMLSelectElement>) => setInteractionTrigger(part.id, item.id, e.target.value as InteractionTrigger),
              }, INTERACTION_TRIGGERS.map((trigger) => createElement('option', { key: trigger, value: trigger },
                trigger === 'hold' ? '停留' : INTERACTION_TRIGGER_LABELS[trigger]))),
              item.trigger === 'hold'
                ? createElement('input', {
                  type: 'number',
                  'aria-label': '停留时长（毫秒）',
                  min: TOUCH_HOLD_LIMITS.min,
                  max: TOUCH_HOLD_LIMITS.max,
                  step: 100,
                  value: item.holdMs,
                  disabled: readOnly,
                  style: { ...numberInputStyle, width: 92 },
                  onChange: (e: ChangeEvent<HTMLInputElement>) => setInteractionHoldMs(part.id, item.id, e.target.value),
                })
                : null,
              item.trigger === 'hold'
                ? createElement('span', { style: { fontSize: 12, color: C.textSecondary } }, 'ms')
                : null,
              createElement('button', {
                type: 'button',
                className: 'dsh-btn dsh-btn-danger',
                style: deleteBoxButtonStyle,
                disabled: readOnly,
                onClick: () => removeInteraction(part.id, item.id),
              }, '删除'),
            )),
          createElement('button', {
            type: 'button',
            className: 'dsh-btn dsh-btn-secondary',
            style: { ...buttonSecondaryStyle, alignSelf: 'flex-start' },
            disabled: readOnly || (part.interactions ?? []).length >= MAX_INTERACTIONS_PER_PART,
            onClick: () => addInteraction(part.id),
          }, (part.interactions ?? []).length >= MAX_INTERACTIONS_PER_PART
            ? `交互已达上限（${MAX_INTERACTIONS_PER_PART}）`
            : '+ 添加交互'),
        ),
      ),
    )
  }

  // ---- 组装页面 ----
  const hasChanges = partsDirty

  /** 组内 sticky 保存行：左侧状态文本（warn/error/success 语义色）+ 右侧 primary 保存按钮。 */
  const saveRow = (
    key: string,
    text: string,
    tone: 'warn' | 'success' | 'error',
    onSave: () => void,
  ): ReactElement => createElement('div', {
    key,
    style: stickyRowStyle,
  },
    createElement('span', {
      style: {
        ...statusTextStyle,
        color: tone === 'success' ? C.success : tone === 'error' ? C.error : C.warn,
      },
    }, text),
    createElement('button', {
      type: 'button',
      className: 'dsh-btn dsh-btn-primary',
      style: buttonPrimaryStyle,
      disabled: saveState === 'saving' || readOnly || !hasChanges,
      onClick: onSave,
    }, '保存'),
  )

  const children: ReactNode[] = [
    createElement('h3', { key: 'title', style: { margin: '0 0 4px', fontSize: 16, fontWeight: 600, color: C.textPrimary } }, 'Waifu 设置'),
    createElement('p', { key: 'sub', style: { ...sectionDescStyle, margin: '0 0 16px' } },
      '设置立即生效；角色的台词、动作、表情由 AI 按人设与场景即兴决定。触摸部位分组修改后点「保存」写入。'),
  ]

  if (state.status !== 'ready') {
    children.push(createElement('div', { key: 'notice', style: noticeMutedStyle },
      state.status === 'unavailable' ? '设置服务不可用（Host 插件未加载）。' : '设置加载中…',
    ))
  }
  if (state.error) {
    children.push(createElement('div', { key: 'settings-error', style: { ...noticeErrorStyle, wordBreak: 'break-all' } },
      `设置文件：${state.error}`,
    ))
  }

  // 1. 显示（Section）：基础显示 / 画布与位置 / 对白气泡
  const maxFps = normalizeMaxFps(value.maxFps)
  const canvasPadX = normalizeCanvasPad(state.value?.canvasPadX, 125)
  const canvasPadY = normalizeCanvasPad(state.value?.canvasPadY, 50)
  const homeRight = normalizeHomePosition(state.value?.homeRight, DEFAULT_VALUE.homeRight)
  const homeBottom = normalizeHomePosition(state.value?.homeBottom, DEFAULT_VALUE.homeBottom)
  const bubbleOffsetX = normalizeBubbleOffset(state.value?.bubbleOffsetX, DEFAULT_VALUE.bubbleOffsetX)
  const bubbleOffsetY = normalizeBubbleOffset(state.value?.bubbleOffsetY, DEFAULT_VALUE.bubbleOffsetY)
  const bubbleBgColor = normalizeHexColor(state.value?.bubbleBgColor, '#ffffff')
  const bubbleBgOpacity = normalizeBubbleOpacity(state.value?.bubbleBgOpacity, 92)
  const bubbleTextColor = normalizeHexColor(state.value?.bubbleTextColor, '#222222')
  const bubbleMaxSeconds = normalizeBubbleMax(state.value?.bubbleMaxSeconds, DEFAULT_VALUE.bubbleMaxSeconds)
  const numberInputStyle: CSSProperties = { ...inputStyle, flex: '0 0 88px', width: 88, textAlign: 'right' }
  /** 偏移类输入（气泡垂直偏移 / 交互条偏移）统一 5px 一档。 */
  const OFFSET_STEP = 5
  // 交互条偏移是本机渲染态：不落盘就会被「关掉设置再打开」重置回 0
  // AI 驱动关闭时会联动关掉语音与交互条；记下关掉前的选择，重新打开时恢复
  const voiceBeforeAiOff = useRef<boolean | null>(null)
  const barBeforeAiOff = useRef<BarPosition | null>(null)
  const [barOffsetDraft, setBarOffsetDraft] = useState<string | null>(null)
  const barOffsetTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (barOffsetTimer.current !== null) window.clearTimeout(barOffsetTimer.current)
  }, [])
  const commitBarOffset = (raw: string): void => {
    const parsed = Number.parseInt(raw, 10)
    const next = Number.isFinite(parsed)
      ? Math.round(Math.min(BAR_OFFSET_LIMITS.max, Math.max(BAR_OFFSET_LIMITS.min, parsed)))
      : 0
    if (next === value.barOffset) return
    enqueueWrite(() => [{ op: 'set', path: ['barOffset'], value: next }])
  }
  const colorInputStyle: CSSProperties = {
    ...inputStyle,
    flex: '0 0 48px',
    width: 48,
    padding: 2,
    cursor: writable ? 'pointer' : 'not-allowed',
  }
  children.push(createElement('div', { key: 'display-section', style: sectionStyle },
    createElement(SectionHeader, {
      title: '显示',
      description: '基础显示、画布与位置、对白气泡。',
    }),
    // A. 基础显示
    createElement('div', { key: 'basic-display', style: rowStyle },
      createElement('div', { style: cardHeadingStyle }, '基础显示'),
      createElement('div', { style: formRowStyle },
        createElement('span', { style: formLabelStyle }, '显示'),
        createElement('label', { style: { ...labelStyle, flex: 'none' } },
          createElement('input', {
            type: 'checkbox',
            checked: !!value.enabled,
            disabled: !writable,
            // 受控 checkbox 的事件期捕获：React 在 onChange 后会同步把 DOM
            // 复位回上次渲染值，若出队时才读 e.target.checked 永远读到旧值
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              const next = e.target.checked
              enqueueWrite(() => [{ op: 'set', path: ['enabled'], value: next }])
            },
          }),
          createElement('span', null, '显示宠物'),
        ),
      ),
      createElement('div', { style: formRowStyle },
        createElement('span', { style: formLabelStyle }, '尺寸'),
        createElement('div', { style: formControlStyle },
          createElement('input', {
            type: 'range',
            min: 40,
            max: 400,
            step: 1,
            value: size,
            disabled: !writable,
            style: { flex: 1, minWidth: 0 },
            onChange: (e: ChangeEvent<HTMLInputElement>) => setDraftSize(Number(e.target.value)),
            onPointerUp: commitSize,
            onKeyUp: commitSize,
            onBlur: commitSize,
          }),
          createElement('span', { style: { width: 56, textAlign: 'right', color: C.textSecondary, fontSize: 12 } }, `${size}px`),
        ),
      ),
      createElement('div', { style: formRowStyle },
        createElement('span', { style: formLabelStyle }, '渲染帧率'),
        createElement('div', { style: formControlStyle },
          createElement(ThemeRadioGroup, {
            name: '渲染帧率',
            value: String(maxFps),
            options: MAX_FPS_OPTIONS,
            disabled: !writable,
            onChange: (id: string) => {
              enqueueWrite(() => [{ op: 'set', path: ['maxFps'], value: normalizeMaxFps(Number(id)) }])
            },
          }),
        ),
      ),
      createElement('div', { style: formRowInlineStyle },
        createElement(FormLabel, { title: '视线跟随鼠标范围（模型尺寸%）' }),
        createElement('div', { style: formControlInlineStyle },
          createElement('input', {
            type: 'number',
            min: FOCUS_RANGE_LIMITS.min,
            max: FOCUS_RANGE_LIMITS.max,
            step: 5,
            style: numberInputStyle,
            value: value.focusRange,
            disabled: !writable,
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              const next = normalizeFocusRange(e.target.value, DEFAULT_SETTINGS.focusRange)
              enqueueWrite(() => [{ op: 'set', path: ['focusRange'], value: next }])
            },
          }),
        ),
      ),
      createElement('div', { style: formRowInlineStyle },
        createElement(FormLabel, { title: '待机小动作' }),
        createElement('div', { style: formControlInlineStyle },
          createElement(ThemeSwitch, {
            checked: value.idleMotionEnabled !== false,
            disabled: !writable,
            onChange: (next: boolean) => enqueueWrite(() => [{ op: 'set', path: ['idleMotionEnabled'], value: next }]),
          }),
        ),
      ),
    ),
    // B. 画布与位置
    createElement('div', { key: 'canvas-home', style: rowStyle },
      createElement('div', { style: cardHeadingStyle }, '画布与位置'),
      createElement('div', { style: formRowInlineStyle },
        createElement('span', { style: formLabelInlineStyle }, '水平留白（% 模型宽）'),
        createElement('div', { style: formControlInlineStyle },
          createElement('input', {
            type: 'number',
            min: 0,
            max: 300,
            step: 5,
            value: canvasPadX,
            disabled: !writable,
            style: numberInputStyle,
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              const next = normalizeCanvasPad(e.target.value, 0)
              enqueueWrite(() => [{ op: 'set', path: ['canvasPadX'], value: next }])
            },
          }),
        ),
      ),
      createElement('div', { style: formRowInlineStyle },
        createElement('span', { style: formLabelInlineStyle }, '垂直留白（% 模型高）'),
        createElement('div', { style: formControlInlineStyle },
          createElement('input', {
            type: 'number',
            min: 0,
            max: 300,
            step: 5,
            value: canvasPadY,
            disabled: !writable,
            style: numberInputStyle,
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              const next = normalizeCanvasPad(e.target.value, 0)
              enqueueWrite(() => [{ op: 'set', path: ['canvasPadY'], value: next }])
            },
          }),
        ),
      ),
      createElement('div', { style: formRowInlineStyle },
        createElement('span', { style: formLabelInlineStyle }, '中心距右（% 窗口宽）'),
        createElement('div', { style: formControlInlineStyle },
          createElement('input', {
            type: 'number',
            min: 0,
            max: 100,
            step: 1,
            value: homeRight,
            disabled: !writable,
            style: numberInputStyle,
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              const next = normalizeHomePosition(e.target.value, 0)
              enqueueWrite(() => [{ op: 'set', path: ['homeRight'], value: next }])
            },
          }),
        ),
      ),
      createElement('div', { style: formRowInlineStyle },
        createElement('span', { style: formLabelInlineStyle }, '中心距下（% 窗口高）'),
        createElement('div', { style: formControlInlineStyle },
          createElement('input', {
            type: 'number',
            min: 0,
            max: 100,
            step: 1,
            value: homeBottom,
            disabled: !writable,
            style: numberInputStyle,
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              const next = normalizeHomePosition(e.target.value, 0)
              enqueueWrite(() => [{ op: 'set', path: ['homeBottom'], value: next }])
            },
          }),
        ),
      ),
      // 「归位 / 捕捉」独占一行：贴着数字输入会挤掉输入框宽度，动作类按钮也更好点
      createElement('div', { style: formRowInlineStyle },
        createElement('span', { style: formLabelInlineStyle }, '默认位置'),
        createElement('div', { style: formControlInlineStyle },
          createElement('button', {
            type: 'button',
            className: 'dsh-btn dsh-btn-secondary',
            style: buttonSecondaryStyle,
            disabled: !writable,
            onClick: requestRecenter,
          }, '归位'),
          createElement('button', {
            type: 'button',
            className: 'dsh-btn dsh-btn-secondary',
            style: buttonSecondaryStyle,
            title: '把角色现在的位置设为默认位置',
            disabled: !writable,
            onClick: requestCapture,
          }, '捕捉'),
        ),
      ),
      resetNotice
        ? createElement('div', {
          key: 'reset-notice',
          style: { ...statusTextStyle, color: C.success, marginTop: 2 },
        }, resetNotice)
        : null,
    ),
    // C. 对白气泡
    createElement('div', { key: 'bubble-style', style: rowStyle },
      createElement('div', { style: cardHeadingStyle }, '对白气泡'),
      createElement('div', { style: formRowInlineStyle },
        createElement('span', { style: formLabelInlineStyle }, '水平偏移（px）'),
        createElement('div', { style: formControlInlineStyle },
          createElement('input', {
            type: 'number',
            min: -1000,
            max: 1000,
            step: OFFSET_STEP,
            value: bubbleOffsetX,
            disabled: !writable,
            style: numberInputStyle,
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              const next = normalizeBubbleOffset(e.target.value, 0)
              enqueueWrite(() => [{ op: 'set', path: ['bubbleOffsetX'], value: next }])
            },
          }),
        ),
      ),
      createElement('div', { style: formRowInlineStyle },
        createElement('span', { style: formLabelInlineStyle }, '垂直偏移（px）'),
        createElement('div', { style: formControlInlineStyle },
          createElement('input', {
            type: 'number',
            min: -1000,
            max: 1000,
            step: OFFSET_STEP,
            value: bubbleOffsetY,
            disabled: !writable,
            style: numberInputStyle,
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              const next = normalizeBubbleOffset(e.target.value, 0)
              enqueueWrite(() => [{ op: 'set', path: ['bubbleOffsetY'], value: next }])
            },
          }),
        ),
      ),
      createElement('div', { style: formRowInlineStyle },
        createElement('span', { style: formLabelInlineStyle }, '背景不透明度'),
        createElement('div', { style: formControlInlineStyle },
          createElement('input', {
            type: 'number',
            min: 0,
            max: 100,
            step: 1,
            value: bubbleBgOpacity,
            disabled: !writable,
            style: numberInputStyle,
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              const next = normalizeBubbleOpacity(e.target.value, 0)
              enqueueWrite(() => [{ op: 'set', path: ['bubbleBgOpacity'], value: next }])
            },
          }),
        ),
      ),
      // 背景色 / 文字色 同一行：两个色块并排，右侧跟当前色值
      createElement('div', { style: formRowInlineStyle },
        createElement('span', { style: formLabelInlineStyle }, '背景色 / 文字色'),
        createElement('div', { style: formControlInlineStyle },
          createElement('input', {
            type: 'color',
            value: bubbleBgColor,
            title: `背景色 ${bubbleBgColor}`,
            disabled: !writable,
            style: colorInputStyle,
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              const next = normalizeHexColor(e.target.value, '#ffffff')
              enqueueWrite(() => [{ op: 'set', path: ['bubbleBgColor'], value: next }])
            },
          }),
          createElement('input', {
            type: 'color',
            value: bubbleTextColor,
            title: `文字颜色 ${bubbleTextColor}`,
            disabled: !writable,
            style: colorInputStyle,
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              const next = normalizeHexColor(e.target.value, '#222222')
              enqueueWrite(() => [{ op: 'set', path: ['bubbleTextColor'], value: next }])
            },
          }),
        ),
      ),
      createElement('div', { style: formRowInlineStyle },
        createElement('span', { style: formLabelInlineStyle }, '最长显示（秒，0 = 不限）'),
        createElement('div', { style: formControlInlineStyle },
          createElement('input', {
            type: 'number',
            min: 0,
            max: 600,
            step: 5,
            value: bubbleMaxSeconds,
            disabled: !writable,
            style: numberInputStyle,
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              const next = normalizeBubbleMax(e.target.value, 0)
              enqueueWrite(() => [{ op: 'set', path: ['bubbleMaxSeconds'], value: next }])
            },
          }),
        ),
      ),
    ),
  ))

  // 5. 触摸部位（当前模型）：所有输入始终可编辑；预览开关只控制宠物上的 box 叠加
  children.push(createElement('div', { key: 'touch-parts', style: sectionStyle },
    createElement(SectionHeader, {
      title: '触摸部位（当前模型）',
      description: createElement('div', null,
        '#1 在最上层，box 重叠时上层优先，用 ↑ / ↓ 调层级；预览只控制角色上的 box 显示，不影响编辑与保存。'),
      action: createElement('button', {
        type: 'button',
        className: 'dsh-btn dsh-btn-secondary',
        style: buttonSecondaryStyle,
        disabled: readOnly,
        onClick: toggleTouchEditing,
      }, touchEditing ? '退出预览' : '预览 box'),
    }),
    structureDirty
      ? saveRow('touch-structure-save-row', '部位顺序/新增/删除未保存', 'warn', saveStructureNow)
      : null,
    touchSavedFlash && !structureDirty
      ? createElement('div', { key: 'touch-saved-flash', style: stickyRowStyle },
        createElement('span', { style: { ...statusTextStyle, color: C.success } }, `已保存 ${touchSavedFlash}`))
      : null,
    partStatus === 'loading'
      ? createElement('div', { key: 'touch-loading', style: noticeMutedStyle }, '正在读取当前模型的配置…')
      : partStatus === 'error'
        ? createElement('div', { key: 'touch-error', style: noticeErrorStyle },
          loadError ?? '读取失败',
          createElement('button', { className: 'dsh-btn dsh-btn-secondary', style: { ...buttonSecondaryStyle, marginLeft: 8 }, onClick: reloadAll }, '重新读取'),
        )
        : null,
    partStatus === 'ready' && loadError
      ? createElement('div', { key: 'touch-warn', style: noticeErrorStyle },
        loadError,
        createElement('button', { className: 'dsh-btn dsh-btn-secondary', style: { ...buttonSecondaryStyle, marginLeft: 8 }, onClick: reloadAll }, '重新读取'),
      )
      : null,
    partStatus === 'ready' && touchDraft.length === 0
      ? createElement('div', { key: 'touch-empty', style: noticeMutedStyle },
        '这个模型还没有触摸部位：新建部位后画 box，角色被摸到相应区域时就会触发反应。')
      : null,
    ...touchDraft.map((part, index) => renderTouchPartCard(part, index)),
    createElement('button', {
      key: 'add-part',
      className: 'dsh-btn dsh-btn-primary',
      style: { ...buttonPrimaryStyle, marginTop: 2, alignSelf: 'flex-start' },
      disabled: readOnly,
      onClick: addTouchPart,
    }, '+ 新建部位'),
  ))

  // AI 回复候选：来自 Host 的 llm 目录；目录为空时回落成手填输入框
  const providerChoices = aiOptions === null
    ? []
    : (aiOptions.providers.some((provider) => provider.id === value.aiProvider)
      ? aiOptions.providers
      : [{ id: value.aiProvider, name: value.aiProvider }, ...aiOptions.providers])
  const modelChoices = aiOptions?.models?.[value.aiProvider] ?? []
  const modelOptions = modelChoices.some((model) => model.id === value.aiModel)
    ? modelChoices
    : [{ id: value.aiModel, name: value.aiModel }, ...modelChoices]

  /** 试听：把一句样例发给 /tts，拿回 mp3 直接播（不写缓存文件、不改设置）。 */
  const auditionVoice = async (): Promise<void> => {
    if (ttsBusy) return
    setTtsBusy(true)
    setTtsStatus('合成中…')
    try {
      const res = await fetch(`${PET_API}/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '哼，主人又在偷看我了？我可没那么好哄哦。' }),
      })
      const payload = await res.json() as { ok?: boolean; data?: string; error?: string }
      if (!payload.ok || !payload.data) throw new Error(payload.error ?? `http ${res.status}`)
      const audio = new Audio(`data:audio/mpeg;base64,${payload.data}`)
      void audio.play().catch(() => undefined)
      setTtsStatus('试听已播放')
    } catch (error) {
      setTtsStatus(`试听失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setTtsBusy(false)
    }
  }

  // 6. AI 驱动（ADR-037）：复用 DSH 已配置的 provider/model；台词/动作/表情/记忆全由模型决定
  children.push(createElement('div', { key: 'ai-reply', style: sectionStyle },
    createElement(SectionHeader, {
      title: 'AI 驱动',
      description: '角色的台词、动作、表情全部由模型按人设 + 场景 + 历史 + 记忆即兴决定；关闭后角色完全静默（语音与交互条一并关闭）。',
      action: createElement(ThemeSwitch, {
        checked: !!value.aiEnabled,
        disabled: !writable,
        onChange: (next) => {
          if (next) {
            // 重新打开：把关闭时联动关掉的语音 / 交互条恢复成用户原来的选择
            const ops: SettingsOp[] = [{ op: 'set', path: ['aiEnabled'], value: true }]
            if (voiceBeforeAiOff.current !== null) {
              ops.push({ op: 'set', path: ['ttsEnabled'], value: voiceBeforeAiOff.current })
              voiceBeforeAiOff.current = null
            }
            const bar = barBeforeAiOff.current
            if (bar !== null) {
              if (bar !== 'hidden') ops.push({ op: 'set', path: ['barPosition'], value: bar })
              barBeforeAiOff.current = null
            }
            enqueueWrite(() => ops)
            return
          }
          // 关闭：记下当前选择，再联动关掉语音与交互条（角色不能说话时留着它们只会误点）
          voiceBeforeAiOff.current = value.ttsEnabled
          barBeforeAiOff.current = value.barPosition
          enqueueWrite(() => [
            { op: 'set', path: ['aiEnabled'], value: false },
            { op: 'set', path: ['ttsEnabled'], value: false },
            { op: 'set', path: ['barPosition'], value: 'hidden' },
          ])
        },
      }),
    }),
    !!value.aiEnabled && createElement('div', null,
      createElement('div', { key: 'ai-model-card', style: rowStyle },
        createElement('div', { style: cardHeadingStyle }, '模型'),
        createElement('div', { style: formRowStyle },
          createElement(FormLabel, { title: 'Provider' }),
        createElement('div', { style: formControlStyle },
          providerChoices.length > 0
            ? createElement('select', {
              key: `ai-provider-${value.aiProvider}-${providerChoices.length}`,
              value: value.aiProvider,
              style: selectStyle,
              disabled: !writable,
              onChange: (e: ChangeEvent<HTMLSelectElement>) => {
                const next = e.target.value
                if (!next || next === value.aiProvider) return
                const firstModel = aiOptions?.models?.[next]?.[0]?.id
                enqueueWrite(() => (firstModel
                  ? [{ op: 'set', path: ['aiProvider'], value: next }, { op: 'set', path: ['aiModel'], value: firstModel }]
                  : [{ op: 'set', path: ['aiProvider'], value: next }]))
              },
            }, providerChoices.map((provider) => createElement('option', { key: provider.id, value: provider.id }, provider.name)))
            : createElement('input', {
              type: 'text',
              defaultValue: value.aiProvider,
              style: inputStyle,
              disabled: !writable,
              placeholder: 'deepseek-official',
              onBlur: (e: FocusEvent<HTMLInputElement>) => {
                const next = e.target.value.trim()
                if (next && next !== value.aiProvider) enqueueWrite(() => [{ op: 'set', path: ['aiProvider'], value: next }])
              },
            }),
        ),
      ),
      createElement('div', { style: formRowStyle },
        createElement(FormLabel, { title: '模型' }),
        createElement('div', { style: formControlStyle },
          modelOptions.length > 0
            ? createElement('select', {
              key: `ai-model-${value.aiModel}-${modelOptions.length}`,
              value: value.aiModel,
              style: selectStyle,
              disabled: !writable,
              onChange: (e: ChangeEvent<HTMLSelectElement>) => {
                const next = e.target.value
                if (next && next !== value.aiModel) enqueueWrite(() => [{ op: 'set', path: ['aiModel'], value: next }])
              },
            }, modelOptions.map((model) => createElement('option', { key: model.id, value: model.id }, model.name)))
            : createElement('input', {
              type: 'text',
              defaultValue: value.aiModel,
              style: inputStyle,
              disabled: !writable,
              placeholder: 'deepseek-flash',
              onBlur: (e: FocusEvent<HTMLInputElement>) => {
                const next = e.target.value.trim()
                if (next && next !== value.aiModel) enqueueWrite(() => [{ op: 'set', path: ['aiModel'], value: next }])
              },
            }),
          createElement('button', {
            type: 'button',
            style: { ...buttonPrimaryStyle, marginLeft: 8, opacity: aiChecking ? 0.6 : 1 },
            disabled: aiChecking,
            onClick: () => checkAi(),
          }, aiChecking ? '测试中…' : '测试'),
        ),
      ),
        !!aiCheckStatus && createElement('div', { style: formRowStyle },
          createElement(FormLabel, { title: '自检' }),
          createElement('div', {
            style: {
              ...formControlStyle,
              color: aiCheckStatus.ok ? C.success : C.error,
              fontSize: 12,
              lineHeight: 1.5,
              wordBreak: 'break-all',
              maxHeight: 96,
              overflowY: 'auto',
            },
          }, aiCheckStatus.text),
        ),
      ),
      createElement('div', { key: 'ai-context-card', style: rowStyle },
        createElement('div', { style: cardHeadingStyle }, '上下文'),
        createElement('div', { style: formRowInlineStyle },
          createElement(FormLabel, { title: '注入对话历史（轮）' }),
        createElement('div', { style: formControlInlineStyle },
          createElement('input', {
            type: 'number',
            min: AI_HISTORY_LIMITS.min,
            max: AI_HISTORY_LIMITS.max,
            step: 1,
            value: value.aiHistoryCount,
            disabled: !writable,
            style: numberInputStyle,
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              const next = normalizeHistoryCount(e.target.value, DEFAULT_AI_HISTORY)
              enqueueWrite(() => [{ op: 'set', path: ['aiHistoryCount'], value: next }])
            },
          }),
        ),
      ),
      createElement('div', { style: formRowInlineStyle },
        createElement(FormLabel, { title: '注入记忆（条）' }),
        createElement('div', { style: formControlInlineStyle },
          createElement('input', {
            type: 'number',
            min: AI_MEMORY_LIMITS.min,
            max: AI_MEMORY_LIMITS.max,
            step: 1,
            value: value.aiMemoryCount,
            disabled: !writable,
            style: numberInputStyle,
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              const next = normalizeMemoryCount(e.target.value, DEFAULT_AI_MEMORY)
              enqueueWrite(() => [{ op: 'set', path: ['aiMemoryCount'], value: next }])
            },
          }),
        ),
      ),
      ),
      createElement('div', { key: 'ai-trigger-card', style: rowStyle },
        createElement('div', { style: cardHeadingStyle }, '触发'),
        createElement('div', { style: formRowStyle },
          createElement(FormLabel, { title: '触发方式' }),
        createElement('div', { style: formControlStyle },
          createElement('select', {
            value: value.triggerMode,
            disabled: !writable,
            style: { ...selectStyle, width: 260 },
            onChange: (e: ChangeEvent<HTMLSelectElement>) => {
              const next = e.target.value === 'queue' ? 'queue' : 'interrupt'
              if (next !== value.triggerMode) enqueueWrite(() => [{ op: 'set', path: ['triggerMode'], value: next }])
            },
          },
            createElement('option', { value: 'interrupt' }, '截断抢占（新事件立刻掐掉上一轮，话可能说一半）'),
            createElement('option', { value: 'queue' }, '排队等说完（等上一轮说完再开始，攒着的事件合并）'),
          ),
        ),
      ),
      createElement('div', { style: formRowInlineStyle },
        createElement(FormLabel, { title: '最小间隔（秒）', hint: '事件类触发的冷却：间隔内的 DSH 事件不再触发（0 = 不限）' }),
        createElement('div', { style: formControlInlineStyle },
          createElement('input', {
            type: 'number',
            min: AI_MIN_INTERVAL_LIMITS.min,
            max: AI_MIN_INTERVAL_LIMITS.max,
            step: 1,
            value: value.aiMinIntervalSec,
            disabled: !writable,
            style: numberInputStyle,
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              const parsed = Number(e.target.value)
              if (!Number.isFinite(parsed)) return
              const next = Math.round(Math.min(AI_MIN_INTERVAL_LIMITS.max, Math.max(AI_MIN_INTERVAL_LIMITS.min, parsed)))
              if (next !== value.aiMinIntervalSec) enqueueWrite(() => [{ op: 'set', path: ['aiMinIntervalSec'], value: next }])
            },
          }),
        ),
      ),
      createElement('div', { style: formRowInlineStyle },
        createElement(FormLabel, { title: '静默超时（分钟）', hint: '多久没有任何事件/互动就主动说一句（0 = 关闭）' }),
        createElement('div', { style: formControlInlineStyle },
          createElement('input', {
            type: 'number',
            min: 0,
            max: Math.floor(IDLE_TIMEOUT_LIMITS.max / 60),
            step: 1,
            value: Math.round(value.idleTimeoutSec / 60),
            disabled: !writable,
            style: numberInputStyle,
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              const parsed = Number(e.target.value)
              if (!Number.isFinite(parsed)) return
              const minutes = Math.round(Math.min(Math.floor(IDLE_TIMEOUT_LIMITS.max / 60), Math.max(0, parsed)))
              const next = minutes * 60
              if (next !== value.idleTimeoutSec) enqueueWrite(() => [{ op: 'set', path: ['idleTimeoutSec'], value: next }])
            },
          }),
        ),
      ),
      createElement('div', { style: formRowInlineStyle },
        createElement(FormLabel, { title: '同类事件窗口（秒）', hint: '窗口内同类 DSH 事件只触发一次（如连续读文件）；Host 侧同样有这层节流' }),
        createElement('div', { style: formControlInlineStyle },
          createElement('input', {
            type: 'number',
            min: ACTIVITY_WINDOW_LIMITS.min,
            max: ACTIVITY_WINDOW_LIMITS.max,
            step: 1,
            value: value.activityWindowSec,
            disabled: !writable,
            style: numberInputStyle,
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              const parsed = Number(e.target.value)
              if (!Number.isFinite(parsed)) return
              const next = Math.round(Math.min(ACTIVITY_WINDOW_LIMITS.max, Math.max(ACTIVITY_WINDOW_LIMITS.min, parsed)))
              if (next !== value.activityWindowSec) enqueueWrite(() => [{ op: 'set', path: ['activityWindowSec'], value: next }])
            },
          }),
        ),
      ),
      // 交互条（ADR-037 修订）：AI 驱动的对话输入入口
      createElement('div', { style: formRowInlineStyle },
        createElement(FormLabel, { title: '交互条' }),
        createElement('div', { style: formControlInlineStyle },
          createElement('select', {
            style: selectStyle,
            value: value.barPosition,
            disabled: !writable,
            onChange: (e: ChangeEvent<HTMLSelectElement>) => {
              const next = e.target.value as BarPosition
              enqueueWrite(() => [{ op: 'set', path: ['barPosition'], value: next }])
            },
          },
            createElement('option', { value: 'bottom' }, '模型下方'),
            createElement('option', { value: 'top' }, '模型上方'),
            createElement('option', { value: 'hidden' }, '不显示'),
          ),
          createElement('input', {
            type: 'number',
            title: '偏移（px）：正数离模型更远，负数贴近/压住模型',
            min: BAR_OFFSET_LIMITS.min,
            max: BAR_OFFSET_LIMITS.max,
            // 与「垂直偏移」同一档步进：方向键一次 5px，想精确就手输
            step: OFFSET_STEP,
            value: barOffsetDraft ?? String(value.barOffset),
            disabled: !writable || value.barPosition === 'hidden',
            style: numberInputStyle,
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              // 每键都写一遍太难打字（"1"→"-"→"-3"），200ms 防抖后再落盘
              const raw = e.target.value
              setBarOffsetDraft(raw)
              if (barOffsetTimer.current !== null) window.clearTimeout(barOffsetTimer.current)
              barOffsetTimer.current = window.setTimeout(() => commitBarOffset(raw), 200)
            },
            onBlur: (e: FocusEvent<HTMLInputElement>) => {
              if (barOffsetTimer.current !== null) window.clearTimeout(barOffsetTimer.current)
              barOffsetTimer.current = null
              commitBarOffset(e.target.value)
              setBarOffsetDraft(null)
            },
          }),
        ),
      ),
      // 触发场景：默认只列开关，展开才显示「怎么描述给模型」的输入框与 prompt 预览
      createElement('div', { style: formRowStartStyle },
        createElement(FormLabel, {
          title: '触发场景',
          hint: '打开的事件才会让角色反应；触摸与对话始终可触发。展开可改「这件事怎么描述给模型」，留空用内置文案',
        }),
        createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: GAP.xs } },
          TRIGGER_ORDER.map((event) => {
            const enabled = normalizeEventTriggers(value.eventTriggers)[event] !== false
            const custom = normalizeEventTexts(value.eventTexts)[event] ?? ''
            const open = openScenes[event] === true
            const preview = custom.trim() !== '' ? custom.trim() : (DEFAULT_EVENT_TEXTS[event] ?? event)
            return createElement('div', {
              key: `trigger-${event}`,
              style: { display: 'flex', flexDirection: 'column', paddingBottom: GAP.xs },
            },
              createElement('div', { style: foldHeadStyle },
                createElement('label', {
                  style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textPrimary, whiteSpace: 'nowrap', cursor: 'pointer' },
                },
                  createElement('input', {
                    type: 'checkbox',
                    checked: enabled,
                    disabled: !writable,
                    onChange: (e: ChangeEvent<HTMLInputElement>) => {
                      const next = e.target.checked
                      enqueueWrite(() => [{ op: 'set', path: ['eventTriggers', event], value: next }])
                    },
                  }),
                  TRIGGER_EVENT_LABELS[event] ?? event,
                ),
                createElement('span', { style: foldMetaStyle }, custom.trim() !== '' ? '已自定义' : ''),
                createElement(FoldToggle, { open, disabled: !writable, onClick: () => setOpenScenes((prev) => ({ ...prev, [event]: !open })) }),
              ),
              open && createElement('div', { style: foldBodyStyle },
                createElement('input', {
                  type: 'text',
                  value: custom,
                  placeholder: `内置：${DEFAULT_EVENT_TEXTS[event] ?? event}`,
                  maxLength: EVENT_TEXT_MAX,
                  disabled: !writable,
                  style: { ...inputStyle, width: '100%', height: 28, fontSize: 12 },
                  onChange: (e: ChangeEvent<HTMLInputElement>) => {
                    const next = e.target.value
                    enqueueWrite(() => [{ op: 'set', path: ['eventTexts', event], value: next }])
                  },
                }),
                createElement('div', { style: { fontSize: 11, color: C.textSecondary, lineHeight: 1.6, wordBreak: 'break-all' } },
                  `prompt 预览：${preview}`),
              ),
            )
          }),
        ),
      ),
      ),
      createElement('div', { key: 'ai-prompt-card', style: rowStyle },
        createElement('div', { style: cardHeadingStyle }, '人设与记忆'),
        // 人设：默认折叠，展开才给编辑框（ADR-039 之后说明一律不写第二行小字）
        createElement('div', { style: formRowStartStyle },
          createElement(FormLabel, { title: '人设' }),
        createElement('div', { style: { ...formControlStyle, flexDirection: 'column', alignItems: 'stretch' } },
          createElement('div', { style: foldHeadStyle },
            createElement('span', { style: foldTitleStyle }, personaStatus ?? '保存后立即写入 persona.md，下一次触摸生效'),
            createElement('span', { style: foldMetaStyle }, personaDraft === null ? '' : `${personaDraft.length} 字`),
            createElement(FoldToggle, {
              open: personaOpen,
              disabled: !writable || personaDraft === null,
              onClick: () => setPersonaOpen((prev) => !prev),
            }),
          ),
          personaOpen && createElement('div', { style: foldBodyStyle },
            createElement('textarea', {
              key: 'ai-persona',
              rows: 8,
              value: personaDraft ?? '',
              style: { ...textareaStyle, height: 148, minHeight: 148, maxHeight: 148, lineHeight: 1.5, flex: 'none', width: '100%' },
              disabled: !writable || personaDraft === null,
              placeholder: personaDraft === null ? '读取中…' : '写下「简」的人设与说话风格',
              onChange: (e: ChangeEvent<HTMLTextAreaElement>) => setPersonaDraft(e.target.value),
            }),
            createElement('div', { style: { display: 'flex', alignItems: 'center', gap: GAP.sm } },
              createElement('button', {
                type: 'button',
                style: { ...buttonPrimaryStyle, opacity: personaSaving ? 0.6 : 1 },
                disabled: !writable || personaSaving || personaDraft === null,
                onClick: () => savePersona(),
              }, personaSaving ? '保存中…' : '保存人设'),
            ),
          ),
        ),
      ),
      // 记忆（ADR-037）：AI 自己写进来的长期记忆；折叠查看/编辑
      createElement('div', { style: formRowStartStyle },
        createElement(FormLabel, { title: '记忆' }),
        createElement('div', { style: { ...formControlStyle, flexDirection: 'column', alignItems: 'stretch' } },
          createElement('div', { style: foldHeadStyle },
            createElement('span', { style: foldTitleStyle }, memoryStatus ?? 'AI 觉得值得记的事会带时间戳写进来'),
            createElement('span', { style: foldMetaStyle }, memoryDraft === null ? '' : `${memoryLineCount} 条`),
            createElement(FoldToggle, {
              open: memoryOpen,
              disabled: !writable || memoryDraft === null,
              onClick: () => setMemoryOpen((prev) => !prev),
            }),
          ),
          memoryOpen && createElement('div', { style: foldBodyStyle },
            createElement('textarea', {
              key: 'ai-memory',
              rows: 8,
              value: memoryDraft ?? '',
              style: { ...textareaStyle, height: 148, minHeight: 148, maxHeight: 148, lineHeight: 1.5, flex: 'none', width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 12 },
              disabled: !writable || memoryDraft === null,
              placeholder: memoryDraft === null ? '读取中…' : '- [11-06 14:30] 主人喜欢…\n（一行一条，带时间戳）',
              onChange: (e: ChangeEvent<HTMLTextAreaElement>) => setMemoryDraft(e.target.value),
            }),
            createElement('div', { style: { display: 'flex', alignItems: 'center', gap: GAP.sm } },
              createElement('button', {
                type: 'button',
                style: { ...buttonPrimaryStyle, opacity: memorySaving ? 0.6 : 1 },
                disabled: !writable || memorySaving || memoryDraft === null,
                onClick: () => saveMemory(),
              }, memorySaving ? '保存中…' : '保存记忆'),
            ),
          ),
        ),
      ),
      ),
    ),
  ))

  // 7. 语音（ADR-033）：OpenRouter 的 /api/v1/audio/speech；模型/音色留成设置项，
  // 将来接 ElevenLabs/MiniMax 的真流式实现时只需加引擎，不动这页。
  // 模型与音色都走目录下拉：Drama 3 这类没有 `supported_voices` 的模型每句都会换人声，
  // 只能用「音色可固定」的模型才稳定（ADR-033 修订）。
  const voiceModel = ttsModelOption(value.ttsModel)
  const randomVoice = voiceModel?.randomVoice === true
  const voiceOptions = voiceModel?.voices ?? []
  children.push(createElement('div', { key: 'voice', style: sectionStyle },
    createElement(SectionHeader, {
      title: '语音',
      description: value.aiEnabled
        ? '开启后 AI 台词按句读逐段合成并播放，气泡跟着语音逐段显示，口型跟随音频。'
        : 'AI 驱动已关闭，没有台词可念，语音随之关闭；重新打开 AI 驱动会恢复原来的选择。',
      action: createElement(ThemeSwitch, {
        checked: !!value.ttsEnabled,
        disabled: !writable || !value.aiEnabled,
        onChange: (next) => {
          enqueueWrite(() => [{ op: 'set', path: ['ttsEnabled'], value: next }])
        },
      }),
    }),
    !!value.ttsEnabled && createElement('div', { key: 'voice-card', style: rowStyle },
      createElement('div', { style: cardHeadingStyle }, '语音'),
      createElement('div', { style: formRowInlineStyle },
        createElement('span', { style: formLabelInlineStyle }, '语音模型'),
        createElement('div', { style: formControlInlineStyle },
          createElement('select', {
            value: value.ttsModel,
            disabled: !writable,
            style: { ...selectStyle, width: 260 },
            onChange: (e: ChangeEvent<HTMLSelectElement>) => {
              const next = e.target.value
              if (next === value.ttsModel) return
              // 换模型时音色跟着换成该模型的首个音色（随机音色模型则清空）
              const voice = ttsDefaultVoice(next)
              enqueueWrite(() => [
                { op: 'set', path: ['ttsModel'], value: next },
                { op: 'set', path: ['ttsVoice'], value: voice },
              ])
            },
          },
          // 目录外的旧模型 id 也要能显示出来，否则下拉会静默跳到第一项
          (ttsModelOption(value.ttsModel) ? [] : [value.ttsModel])
            .concat(TTS_MODELS.map((item) => item.id))
            .map((id) => createElement('option', { key: id, value: id },
              ttsModelOption(id)?.label ?? `自定义：${id}`)),
          ),
        ),
      ),
      createElement('div', { style: formRowInlineStyle },
        createElement(FormLabel, { title: '音色' }),
        createElement('div', { style: { ...formControlInlineStyle, gap: GAP.sm } },
          createElement('select', {
            value: value.ttsVoice,
            disabled: !writable || randomVoice,
            style: { ...selectStyle, width: 260 },
            onChange: (e: ChangeEvent<HTMLSelectElement>) => {
              const next = e.target.value
              if (next === value.ttsVoice) return
              enqueueWrite(() => [{ op: 'set', path: ['ttsVoice'], value: next }])
            },
          },
          (voiceOptions.length > 0 ? voiceOptions : [{ id: '', label: '模型默认音色' }])
            .concat(
              // 存档里的音色不在目录里时也要列出来，否则下拉会显示成第一项
              value.ttsVoice && !voiceOptions.some((item) => item.id === value.ttsVoice)
                ? [{ id: value.ttsVoice, label: `自定义：${value.ttsVoice}` }]
                : [],
            )
            .map((item) => createElement('option', { key: item.id, value: item.id }, item.label)),
          ),
        ),
      ),
      createElement('div', { style: formRowInlineStyle },
        createElement(FormLabel, { title: '口型跟随' }),
        createElement('div', { style: formControlInlineStyle },
          createElement(ThemeSwitch, {
            checked: !!value.lipsyncEnabled,
            disabled: !writable,
            onChange: (next) => {
              enqueueWrite(() => [{ op: 'set', path: ['lipsyncEnabled'], value: next }])
            },
          }),
        ),
      ),
      createElement('div', { style: formRowInlineStyle },
        createElement('span', { style: formLabelInlineStyle }, '口型强度'),
        createElement('div', { style: { ...formControlInlineStyle, gap: GAP.sm } },
          createElement('input', {
            type: 'range',
            min: LIPSYNC_GAIN_LIMITS.min,
            max: LIPSYNC_GAIN_LIMITS.max,
            step: 10,
            value: value.lipsyncGain,
            disabled: !writable,
            style: { width: 180 },
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              const next = normalizeLipsyncGain(e.target.value, DEFAULT_SETTINGS.lipsyncGain)
              enqueueWrite(() => [{ op: 'set', path: ['lipsyncGain'], value: next }])
            },
          }),
          createElement('span', { style: { fontSize: 12, color: C.textSecondary } }, `${value.lipsyncGain}%`),
        ),
      ),
      createElement('div', { style: formRowInlineStyle },
        createElement(FormLabel, { title: '试听' }),
        createElement('div', { style: { ...formControlInlineStyle, gap: GAP.sm } },
          createElement('button', {
            type: 'button',
            style: { ...buttonPrimaryStyle, opacity: ttsBusy ? 0.6 : 1 },
            disabled: !writable || ttsBusy,
            onClick: () => { void auditionVoice() },
          }, ttsBusy ? '合成中…' : '试听一句'),
          ttsStatus
            ? createElement('span', { style: { ...noticeBaseStyle, margin: 0, color: C.textSecondary } }, ttsStatus)
            : null,
        ),
      ),
    ),
  ))

  // 8. 开发者选项
  children.push(createElement('div', { key: 'devtools', style: sectionStyle },
    createElement(SectionHeader, {
      title: '开发者选项',
      description: '调试面板与触摸部位色块叠加（仅开发排查用）。',
      action: createElement(ThemeSwitch, {
        checked: !!value.developerMode,
        disabled: !writable,
        onChange: (next) => {
          enqueueWrite(() => [{ op: 'set', path: ['developerMode'], value: next }])
        },
      }),
    }),
    !!value.developerMode && createElement('div', { style: rowStyle },
      createElement('label', { style: labelStyle },
        createElement('input', {
          type: 'checkbox',
          checked: !!value.debug,
          disabled: !writable,
          onChange: (e: ChangeEvent<HTMLInputElement>) => {
            const next = e.target.checked
            enqueueWrite(() => [{ op: 'set', path: ['debug'], value: next }])
          },
        }),
        createElement('span', null, '调试面板'),
      ),
      createElement('label', { style: { ...labelStyle, marginTop: 12 } },
        createElement('input', {
          type: 'checkbox',
          checked: !!value.showTapZones,
          disabled: !writable,
          onChange: (e: ChangeEvent<HTMLInputElement>) => {
            const next = e.target.checked
            enqueueWrite(() => [{ op: 'set', path: ['showTapZones'], value: next }])
          },
        }),
        createElement('span', null, '显示触摸部位色块'),
      ),
    ),
  ))

  return createElement('div', {
    className: 'dsh-waifu-settings',
    style: { padding: '16px 20px', maxWidth: 560, color: C.textPrimary, fontSize: 13 },
  },
    // 统一 focus / hover 态（内联样式无法表达伪类，注入一次局部 CSS）
    createElement('style', { key: 'dsh-waifu-settings-css' },
      '.dsh-waifu-settings input:focus, .dsh-waifu-settings textarea:focus { border-color: var(--dsw-alias-brand-primary) !important; outline: none; }' +
      '.dsh-waifu-settings input[type="checkbox"], .dsh-waifu-settings input[type="range"] { accent-color: var(--dsw-alias-brand-primary); }' +
      '.dsh-waifu-settings button:focus-visible { outline: 1px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }' +
      '.dsh-waifu-settings .dsh-card-header { border-radius: 6px; transition: background .15s; }' +
      '.dsh-waifu-settings .dsh-card-header-row { border-radius: 10px 10px 0 0; transition: background .15s; }' +
      '.dsh-waifu-settings .dsh-card-header-row:hover { background: var(--dsw-alias-bg-layer-2); }' +
      '.dsh-waifu-settings .dsh-card-header:hover { background: var(--dsw-alias-bg-layer-2); }' +
      '.dsh-waifu-settings .dsh-chevron-button:hover { background: var(--dsw-alias-bg-layer-2); border-radius: 6px; }' +
      '.dsh-waifu-settings .dsh-btn { transition: background .12s, border-color .12s; }' +
      '.dsh-waifu-settings .dsh-btn:disabled { opacity: .55; cursor: not-allowed; }' +
      '.dsh-waifu-settings .dsh-btn-secondary:enabled:hover { background: var(--dsw-alias-bg-overlay); border-color: var(--dsw-alias-border-l2); }' +
      '.dsh-waifu-settings .dsh-btn-secondary:enabled:active { background: var(--dsw-alias-bg-base); }' +
      '.dsh-waifu-settings .dsh-btn-primary:enabled:hover { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 86%, var(--dsw-alias-label-primary)); }' +
      '.dsh-waifu-settings .dsh-btn-primary:enabled:active { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 78%, var(--dsw-alias-label-primary)); }' +
      '.dsh-waifu-settings .dsh-btn-danger:enabled:hover { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 18%, transparent); }' +
      '.dsh-waifu-settings .dsh-btn-danger:enabled:active { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 26%, transparent); }' +
      '.dsh-waifu-settings ::placeholder { color: var(--dsw-alias-label-secondary); opacity: .85; }',
    ),
    ...children,
  )
}
