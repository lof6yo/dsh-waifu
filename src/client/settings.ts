/**
 * 桌宠配置设置页（`settings.section` 注册体，spec §2）。
 * 单页信息架构（从上到下）：显示（开关 / 尺寸 / 留白 / 位置 / 气泡 / 帧率）/
 * 事件绑定（当前模型：6 事件的动作组 + 分阶段台词池）/ 触摸部位
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
import type { CSSProperties, ChangeEvent, MouseEvent, ReactNode, ReactElement } from 'react'
import type {
  EventBinding,
  EventBindings,
  PetEventKey,
  TouchBox,
  TouchPart,
} from '../models.ts'
import {
  DEFAULT_EVENT_BINDINGS,
  EVENT_STAGE_DELAYS,
  MAX_BOXES_PER_PART,
  MAX_LINE_LENGTH,
  MAX_LINES_PER_PART,
  MAX_LINES_PER_POOL,
  PET_EVENTS,
  mergeEventBindings,
  normalizeEventBindings,
} from '../models.ts'
import { clientLog } from './client-log.ts'
import { emitRecenter } from './pet-commands.ts'
import { emitTouchEdit } from './touch-edit.ts'

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
  model: string
  /** 开发者选项总开关：开启后显示调试面板/触摸部位色块等开发者入口。 */
  developerMode: boolean
  /** 调试面板：显示调试面板（开发用）。 */
  debug: boolean
  /** 显示触摸部位色块（开发者选项，spec §2/§4）。 */
  showTapZones: boolean
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

interface SettingsState {
  status: 'loading' | 'ready' | 'unavailable'
  value?: PetSettingsValue
  writable: boolean
  /** 设置文件级问题（顶部提示；null 无异常）。 */
  error?: string | null
}

const DEFAULT_VALUE: PetSettingsValue = {
  enabled: true,
  size: 200,
  maxFps: 30,
  canvasPadX: 125,
  canvasPadY: 50,
  homeRight: 16,
  homeBottom: 24,
  bubbleOffsetX: 0,
  bubbleOffsetY: 10,
  bubbleBgColor: '#ffffff',
  bubbleBgOpacity: 92,
  bubbleTextColor: '#222222',
  model: 'jian',
  developerMode: false,
  debug: false,
  showTapZones: false,
}

/** 事件卡片展示顺序（空闲/思考中/出错/完成/交付/等审批）。 */
const EVENT_ORDER: readonly PetEventKey[] = ['idle', 'thinking', 'error', 'done', 'delivered', 'waiting']

/** 事件中文名（事件绑定卡片标题）。 */
const EVENT_LABELS: Record<PetEventKey, string> = {
  idle: '空闲',
  thinking: '思考中',
  error: '出错',
  done: '完成',
  delivered: '交付',
  waiting: '等审批',
}

/** 事件台词池的阶段名（thinking/waiting 有 3 个阶段，其余 1 个）。 */
function eventStageLabels(event: PetEventKey): string[] {
  const delays = EVENT_STAGE_DELAYS[event] ?? [0]
  return delays.map((delay, index) => (index === 0 ? '入态' : `${Math.round(delay / 1000)} 秒后`))
}

/** 深拷贝事件绑定（避免草稿与 API 对象 / 默认常量互相污染）。 */
function cloneEventBindings(bindings: EventBindings): EventBindings {
  const out = {} as EventBindings
  for (const event of PET_EVENTS) {
    const binding = bindings[event]
    out[event] = {
      motions: [...binding.motions],
      lines: binding.lines.map((pool) => [...pool]),
    }
  }
  return out
}

/** 把某事件绑定补齐/裁剪到该事件的阶段数（普通事件 1 组、thinking/waiting 3 组）。 */
function normalizeEventDraft(binding: EventBinding, event: PetEventKey): EventBinding {
  const stageCount = eventStageLabels(event).length
  const lines = Array.from({ length: stageCount }, (_, stage) => [...(binding.lines[stage] ?? [])])
  return { motions: [...binding.motions], lines }
}

/** GET /state 的事件绑定（完整表）→ 可编辑草稿（补齐阶段数）。 */
function eventBindingsFromApi(raw: unknown): EventBindings {
  const merged = mergeEventBindings(DEFAULT_EVENT_BINDINGS, normalizeEventBindings(raw))
  const out = {} as EventBindings
  for (const event of PET_EVENTS) out[event] = normalizeEventDraft(merged[event], event)
  return out
}

/** 解析事件台词池 textarea：一行一条 → trim/去空/截断 120 字/去重/最多 20 条。 */
function parseEventLines(raw: string): string[] {
  const cleaned = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.slice(0, MAX_LINE_LENGTH))
    .slice(0, MAX_LINES_PER_POOL)
  return [...new Set(cleaned)]
}

/** 从 .model3.json 解析动作组名列表（FileReferences.Motions 或顶层 Motions）。 */
async function fetchMotionGroups(url: string): Promise<string[]> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json() as {
    FileReferences?: { Motions?: Record<string, unknown> }
    Motions?: Record<string, unknown>
  }
  const motions = data?.FileReferences?.Motions ?? data?.Motions ?? {}
  return Object.keys(motions)
}

/** 深拷贝部位草稿（避免设置页草稿与共享对象 / 事件 detail 互相污染）。 */
function cloneTouchParts(parts: readonly TouchPart[]): TouchPart[] {
  return parts.map((part) => ({
    id: part.id,
    name: part.name,
    boxes: part.boxes.map((box) => ({ ...box })),
    motions: [...part.motions],
    ...(part.lines && part.lines.length > 0 ? { lines: [...part.lines] } : {}),
  }))
}

/** 解析部位台词 textarea：一行一条 → trim/去空/截断 120 字/去重/最多 30 条。 */
function parsePartLines(raw: string): string[] {
  const cleaned = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.slice(0, MAX_LINE_LENGTH))
    .slice(0, MAX_LINES_PER_PART)
  return [...new Set(cleaned)]
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
  /** 当前模型生效的事件绑定（含用户覆盖；「事件绑定」分组初始化用）。 */
  events?: EventBindings | null
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
 * 保存当前模型的部位草稿 + 可选事件绑定覆盖层（POST；Host 不可达返回 null）。
 * events 为 undefined 时**不写**该字段（保留已有覆盖）；传对象时整表写入。
 */
async function saveTouchPartsToHost(
  model: string,
  parts: TouchPart[],
  events?: EventBindings,
): Promise<{ ok: boolean; error: string | null } | null> {
  try {
    const response = await fetch(TOUCH_PARTS_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        parts,
        ...(events !== undefined ? { events } : {}),
      }),
    })
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }
    const data = await response.json() as { ok?: boolean; error?: string | null }
    return { ok: data?.ok !== false, error: data?.error ?? null }
  } catch {
    return null
  }
}

/** GET /state 的当前生效事件绑定（GET 的 events 缺失时兜底）。 */
async function loadStateEvents(): Promise<EventBindings> {
  try {
    const response = await fetch(STATE_API)
    if (!response.ok) return cloneEventBindings(DEFAULT_EVENT_BINDINGS)
    const view = await response.json() as { config?: { events?: unknown } }
    return eventBindingsFromApi(view?.config?.events)
  } catch {
    return cloneEventBindings(DEFAULT_EVENT_BINDINGS)
  }
}

/**
 * 当前模型 → 可 fetch 的 .model3.json URL（仅内置「简」）：从 /state 的
 * config.modelUrl 取；不可达/尚未同步时返回 null（动作组多选降级为空）。
 */
async function resolveSelectedModelUrl(model: string): Promise<string | null> {
  try {
    const response = await fetch(STATE_API)
    if (!response.ok) return null
    const view = await response.json() as { config?: { model?: string; modelUrl?: string | null } }
    const config = view?.config
    if (config?.model === model && typeof config.modelUrl === 'string' && config.modelUrl) {
      return config.modelUrl
    }
  } catch {
    // ignore
  }
  return null
}

const SETTINGS_API = '/api/dsh-waifu/settings'
const STATE_API = '/api/dsh-waifu/state'
const TOUCH_PARTS_API = '/api/dsh-waifu/touch-parts'

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
const sectionHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: GAP.sm,
  marginBottom: GAP.sm,
}
const sectionHeaderMainStyle: CSSProperties = { flex: 1, minWidth: 0 }
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
function SectionHeader(props: { title: string; description?: ReactNode; action?: ReactNode }): ReactElement {
  const { title, description, action } = props
  return createElement('div', { style: sectionHeaderStyle },
    createElement('div', { style: sectionHeaderMainStyle },
      createElement('h3', { style: sectionHeadingStyle }, title),
      description !== undefined ? createElement('div', { style: sectionDescStyle }, description) : null,
    ),
    action !== undefined ? createElement('div', { style: sectionHeaderActionStyle }, action) : null,
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
const cardHeaderButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: GAP.sm,
  flex: 1,
  minWidth: 0,
  margin: 0,
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  fontFamily: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  outline: 'none',
}
const cardHeaderActionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 6,
  flexShrink: 0,
}
const cardTitleStyle: CSSProperties = { fontSize: 13, fontWeight: 600, color: C.textPrimary }
const cardSummaryStyle: CSSProperties = {
  fontSize: 12,
  color: C.textSecondary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
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
const textareaStyle: CSSProperties = {
  ...inputStyle,
  height: 'auto',
  minHeight: 64,
  padding: '6px 8px',
  lineHeight: 1.45,
  resize: 'vertical',
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
const formRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '96px minmax(0,1fr)',
  alignItems: 'center',
  columnGap: GAP.md,
  marginBottom: GAP.sm,
}
const formRowStartStyle: CSSProperties = { ...formRowStyle, alignItems: 'start' }
const formLabelStyle: CSSProperties = { fontSize: 12, color: C.textSecondary, lineHeight: 1.5 }
const formLabelStartStyle: CSSProperties = { ...formLabelStyle, paddingTop: 6 }
const formControlStyle: CSSProperties = { minWidth: 0, display: 'flex', alignItems: 'center', gap: GAP.sm }

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

interface ThemeMultiSelectProps {
  value: string[]
  options: ThemeSelectOption[]
  disabled?: boolean
  placeholder?: string
  onChange: (next: string[]) => void
}

/** 多选下拉：选中项以 tag 展示在主按钮内；点击下拉项切换选中，保持打开以支持连续多选。 */
function ThemeMultiSelect(props: ThemeMultiSelectProps): ReactElement {
  const { value, options, disabled, placeholder, onChange } = props
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: Event) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const nameOf = (id: string) => options.find((o) => o.id === id)?.name ?? id

  return createElement('div', {
    ref: rootRef,
    style: { position: 'relative', flex: 1, minWidth: 0 },
  },
    createElement('button', {
      type: 'button',
      disabled: !!disabled,
      'aria-haspopup': 'listbox',
      'aria-expanded': open,
      onClick: () => { if (!disabled) setOpen((v) => !v) },
      style: {
        ...inputStyle,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        width: '100%',
        minHeight: 28,
        textAlign: 'left',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: C.bgLayer2,
        outline: 'none',
        boxShadow: 'none',
        opacity: disabled ? 0.55 : 1,
      },
    },
      createElement('span', {
        style: { display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', flex: 1, minWidth: 0 },
      },
        value.length === 0
          ? createElement('span', { style: { color: C.textSecondary } }, placeholder ?? '选择动作组')
          : value.map((id) => createElement('span', {
            key: id,
            style: {
              height: 20,
              padding: '0 8px',
              display: 'inline-flex',
              alignItems: 'center',
              borderRadius: 999,
              background: C.bgLayer2,
              color: C.textPrimary,
              fontSize: 12,
              whiteSpace: 'nowrap',
            },
          }, nameOf(id))),
      ),
      createElement('span', { style: { color: C.textSecondary, fontSize: 10, flexShrink: 0 } }, open ? '▴' : '▾'),
    ),
    open && createElement('div', {
      role: 'listbox',
      'aria-multiselectable': true,
      style: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 'calc(100% + 4px)',
        zIndex: 20,
        margin: 0,
        padding: 4,
        borderRadius: 8,
        border: `1px solid ${C.borderL1}`,
        background: C.bgOverlay,
        color: C.textPrimary,
        boxShadow: '0 8px 24px rgba(0,0,0,.45)',
        maxHeight: 240,
        overflowY: 'auto',
      },
    },
      options.map((o) => {
        const selected = value.includes(o.id)
        return createElement('button', {
          key: o.id,
          type: 'button',
          role: 'option',
          'aria-selected': selected,
          onClick: () => {
            const next = selected ? value.filter((v) => v !== o.id) : [...value, o.id]
            onChange(next)
          },
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            width: '100%',
            margin: 0,
            padding: '6px 10px',
            border: 'none',
            borderRadius: 6,
            textAlign: 'left',
            cursor: 'pointer',
            fontSize: 13,
            color: C.textPrimary,
            background: selected ? C.bgLayer2 : 'transparent',
            outline: 'none',
          },
          onMouseEnter: (e: MouseEvent<HTMLButtonElement>) => {
            if (!selected) e.currentTarget.style.background = C.bgLayer2
          },
          onMouseLeave: (e: MouseEvent<HTMLButtonElement>) => {
            e.currentTarget.style.background = selected ? C.bgLayer2 : 'transparent'
          },
        },
          createElement('span', { style: { width: 14, flexShrink: 0, textAlign: 'center' } }, selected ? '☑' : '☐'),
          o.name,
        )
      }),
    ),
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

  // ---- 事件绑定 + 触摸部位（同一模型、同一份草稿、同一保存队列） ----
  const [modelDraft, setModelDraft] = useState('')
  const modelDraftRef = useRef('')
  const [touchDraft, setTouchDraft] = useState<TouchPart[]>([])
  const touchDraftRef = useRef<TouchPart[]>([])
  const [eventBindings, setEventBindings] = useState<EventBindings>(() => cloneEventBindings(DEFAULT_EVENT_BINDINGS))
  const eventBindingsRef = useRef<EventBindings>(eventBindings)
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
  /** 事件粒度 dirty（event key 集合）。 */
  const [dirtyEventKeys, setDirtyEventKeys] = useState<Set<PetEventKey>>(() => new Set())
  const dirtyEventKeysRef = useRef<Set<PetEventKey>>(new Set())
  const eventsDirty = dirtyEventKeys.size > 0
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  /** 触摸部位分组级「已保存」提示（结构变更保存时，约 3 秒）。 */
  const [touchSavedFlash, setTouchSavedFlash] = useState<string | null>(null)
  /** 部位卡片就地「已保存 HH:MM:SS」提示（仅触发保存的那张卡片，约 3 秒）。 */
  const [savedPartFlash, setSavedPartFlash] = useState<{ partId: string; time: string } | null>(null)
  const savedPartTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 事件卡片就地「已保存 HH:MM:SS」提示（仅触发保存的那张卡片，约 3 秒）。 */
  const [savedEventFlash, setSavedEventFlash] = useState<{ event: PetEventKey; time: string } | null>(null)
  const savedEventTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 本次保存的来源（部位卡 / 结构行 / 事件卡），用于决定「已保存」提示落在哪里。 */
  const saveSourceRef = useRef<
    { type: 'part'; id: string }
    | { type: 'structure' }
    | { type: 'event-card'; event: PetEventKey }
    | null
  >(null)
  const flashTimers = useRef<{ touch?: ReturnType<typeof setTimeout> }>({})
  /** 事件卡片展开状态（默认全部折叠；切换模型时重置）。 */
  const [expandedEventKeys, setExpandedEventKeys] = useState<Set<PetEventKey>>(() => new Set())
  const partsDirty = dirtyPartIds.size > 0 || structureDirty
  const [motionGroups, setMotionGroups] = useState<string[]>([])
  const [motionGroupsStatus, setMotionGroupsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  /** 写入串行化：避免并发 POST 在 Host 端出现读改写丢失。 */
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  /** 草稿编辑版本号：保存响应回来时据此判断是否还有更新改动未保存。 */
  const editVersionRef = useRef(0)
  const saveSeq = useRef(0)
  const loadSeq = useRef(0)
  const [reloadKey, setReloadKey] = useState(0)
  /** 动作组解析重试。 */
  const [motionReloadKey, setMotionReloadKey] = useState(0)
  /** 部位台词 textarea 原始输入缓冲（按部位 id）：保留换行/空行，落盘前再清洗。 */
  const [partLineDrafts, setPartLineDrafts] = useState<Record<string, string>>({})
  /** 事件台词 textarea 原始输入缓冲（按 `${event}:${stage}`）：同上。 */
  const [eventLineDrafts, setEventLineDrafts] = useState<Record<string, string>>({})

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

  /** 事件卡片就地「已保存 HH:MM:SS」（约 3 秒）。 */
  const flashSavedEvent = (event: PetEventKey, time: string): void => {
    setSavedEventFlash({ event, time })
    if (savedEventTimer.current !== null) clearTimeout(savedEventTimer.current)
    savedEventTimer.current = setTimeout(() => setSavedEventFlash(null), 3000)
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

  /** 事件卡片字段变化：只把该事件标记为 dirty。 */
  const markEventDirty = (event: PetEventKey): void => {
    if (dirtyEventKeysRef.current.has(event)) return
    const next = new Set(dirtyEventKeysRef.current)
    next.add(event)
    dirtyEventKeysRef.current = next
    setDirtyEventKeys(next)
  }

  /** 保存成功：清空全部部位/结构/事件 dirty。 */
  const clearAllDirty = (): void => {
    dirtyPartIdsRef.current = new Set()
    structureDirtyRef.current = false
    dirtyEventKeysRef.current = new Set()
    setDirtyPartIds(new Set())
    setStructureDirty(false)
    setDirtyEventKeys(new Set())
  }

  /** 是否存在未保存的部位字段/结构改动。 */
  const hasPendingParts = (): boolean => dirtyPartIdsRef.current.size > 0 || structureDirtyRef.current

  /** 保存 payload 中的事件绑定：仅用户实际改过时携带（否则 undefined = 不写覆盖层）。 */
  const eventsForSave = (): EventBindings | undefined => (
    dirtyEventKeysRef.current.size > 0 ? cloneEventBindings(eventBindingsRef.current) : undefined
  )

  /**
   * 串行写回草稿（{model, parts, events?}）；响应只更新保存状态，不 refetch 覆盖草稿。
   * quiet=true 用于切模型/卸载的防丢补存：只发请求 + clientLog，不改页面状态栏。
   */
  const persistDraft = (
    model: string,
    parts: TouchPart[],
    events: EventBindings | undefined,
    editVersion: number,
    quiet = false,
  ): void => {
    const summary = `model=${model} parts=${parts.length} events=${events !== undefined ? 'yes' : 'no'}`
    saveQueue.current = saveQueue.current.then(async () => {
      const seq = ++saveSeq.current
      if (!quiet) {
        setSaveState('saving')
        setSaveError(null)
      }
      const result = await saveTouchPartsToHost(model, parts, events)
      // 过期响应（已有更新请求/已切模型）只记录日志，不把旧模型状态显示到新模型上
      const isCurrent = seq === saveSeq.current && model === modelDraftRef.current
      if (result === null) {
        clientLog('error', `touch-parts save failed: ${summary} error=host unreachable`)
        if (!quiet && isCurrent) {
          saveSourceRef.current = null
          setSaveState('error')
          setSaveError('保存失败（Host 不可达）')
        }
        return
      }
      if (!result.ok || result.error) {
        clientLog('error', `touch-parts save failed: ${summary} error=${result.error ?? 'unknown'}`)
        if (!quiet && isCurrent) {
          saveSourceRef.current = null
          setSaveState('error')
          setSaveError(`保存失败：${result.error ?? '未知错误'}`)
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
      } else if (source?.type === 'event-card') {
        // 事件卡片触发的保存：就地显示在该卡片头部
        flashSavedEvent(source.event, savedTime)
      }
      setSaveState('idle')
      setSaveError(null)
    })
  }

  /** 保存动作（部位卡片「保存」/结构行/事件保存行共用）：显式写回当前完整草稿。 */
  const saveNow = (): void => {
    if (readOnly || (!hasPendingParts() && dirtyEventKeysRef.current.size === 0)) {
      saveSourceRef.current = null
      return
    }
    const model = modelDraftRef.current
    if (!model) return
    persistDraft(model, cloneTouchParts(touchDraftRef.current), eventsForSave(), editVersionRef.current)
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

  /** 事件卡片头部「保存」：成功后「已保存 HH:MM:SS」就地显示在该卡片。 */
  const saveEventCardNow = (event: PetEventKey): void => {
    saveSourceRef.current = { type: 'event-card', event }
    saveNow()
  }

  /** 触摸部位草稿变更：更新 state/ref；仅对应部位置 dirty（不自动保存、不自动开预览）。 */
  const commitTouchDraft = (next: TouchPart[], highlight?: string | null, dirtyPartId?: string): void => {
    touchDraftRef.current = next
    setTouchDraft(next)
    if (dirtyPartId) markPartDirty(dirtyPartId)
    editVersionRef.current += 1
    setSaveState('idle')
    setSaveError(null)
    const highlightId = highlight === undefined ? expandedPartRef.current : highlight
    if (highlight !== undefined) setExpandedPart(highlight)
    // 预览开关只控制宠物上的 box 叠加/强制可见，编辑本身不自动开启预览
    emitTouchDraft(touchEditingRef.current, next, highlightId)
  }

  /** 事件绑定草稿变更：更新 ref/state，只把对应事件标脏（不自动保存）。 */
  const commitEventBindings = (next: EventBindings, dirtyEvent?: PetEventKey): void => {
    eventBindingsRef.current = next
    setEventBindings(next)
    if (dirtyEvent) markEventDirty(dirtyEvent)
    editVersionRef.current += 1
    setSaveState('idle')
    setSaveError(null)
  }

  // 切换选中模型：若有未保存改动先补存（防丢），退出预览，再重新 GET 新模型部位 + 事件绑定
  useEffect(() => {
    if (state.status !== 'ready' || !selectedModel) return
    const previousModel = modelDraftRef.current
    const hadUnsaved = hasPendingParts() || dirtyEventKeysRef.current.size > 0
    if (previousModel && previousModel !== selectedModel && hadUnsaved) {
      // 防丢：自动补存旧模型草稿（静默，不覆盖新模型的状态栏；clientLog 在 persistDraft 内记录）
      persistDraft(previousModel, cloneTouchParts(touchDraftRef.current), eventsForSave(), editVersionRef.current, true)
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
    setSaveError(null)
    clearAllDirty()
    setTouchSavedFlash(null)
    setSavedPartFlash(null)
    setSavedEventFlash(null)
    saveSourceRef.current = null
    setExpandedEventKeys(new Set())
    if (flashTimers.current.touch !== undefined) {
      clearTimeout(flashTimers.current.touch)
      flashTimers.current.touch = undefined
    }
    if (savedPartTimer.current !== null) {
      clearTimeout(savedPartTimer.current)
      savedPartTimer.current = null
    }
    if (savedEventTimer.current !== null) {
      clearTimeout(savedEventTimer.current)
      savedEventTimer.current = null
    }
    // 先清空旧模型草稿，避免读取失败时把上一个模型的配置显示成当前模型
    touchDraftRef.current = []
    setTouchDraft([])
    eventBindingsRef.current = cloneEventBindings(DEFAULT_EVENT_BINDINGS)
    setEventBindings(eventBindingsRef.current)
    setPartLineDrafts({})
    setEventLineDrafts({})
    let alive = true
    loadTouchParts().then((view) => {
      if (!alive || seq !== loadSeq.current) return
      if (view === null) {
        setPartStatus('error')
        setLoadError('读取当前模型的配置失败（Host 不可达）')
        return
      }
      modelDraftRef.current = view.model
      setModelDraft(view.model)
      const parts = cloneTouchParts(Array.isArray(view.parts) ? view.parts : [])
      touchDraftRef.current = parts
      setTouchDraft(parts)
      // 事件绑定：GET 已返回当前生效值；缺失时回退 /state 的 config.events
      if (view.events) {
        const draft = eventBindingsFromApi(view.events)
        eventBindingsRef.current = draft
        setEventBindings(draft)
      } else {
        void loadStateEvents().then((draft) => {
          if (!alive || seq !== loadSeq.current) return
          eventBindingsRef.current = draft
          setEventBindings(draft)
        })
      }
      setPartStatus('ready')
      setLoadError(view.error ?? null)
    })
    return () => { alive = false }
  }, [selectedModel, state.status, reloadKey])

  // 解析当前模型的 .model3.json 动作组名（事件绑定 / 触摸部位共用）
  useEffect(() => {
    if (state.status !== 'ready' || !selectedModel) return
    let alive = true
    setMotionGroupsStatus('loading')
    void resolveSelectedModelUrl(selectedModel).then((url) => {
      if (!alive) return
      if (!url) {
        setMotionGroups([])
        setMotionGroupsStatus('error')
        return
      }
      return fetchMotionGroups(url).then((groups) => {
        if (!alive) return
        setMotionGroups(groups)
        setMotionGroupsStatus('ready')
      }).catch(() => {
        if (!alive) return
        setMotionGroups([])
        setMotionGroupsStatus('error')
      })
    })
    return () => { alive = false }
  }, [selectedModel, state.status, motionReloadKey])

  // 卸载：若有未保存改动则自动补存（防丢），并通知宠物退出 box 预览
  useEffect(() => () => {
    const model = modelDraftRef.current
    if (!model) return
    if (hasPendingParts() || dirtyEventKeysRef.current.size > 0) {
      // 防丢：关闭设置页时自动补存（静默；clientLog 在 persistDraft 内记录）
      persistDraft(model, cloneTouchParts(touchDraftRef.current), eventsForSave(), editVersionRef.current, true)
    }
    if (flashTimers.current.touch !== undefined) clearTimeout(flashTimers.current.touch)
    if (savedPartTimer.current !== null) clearTimeout(savedPartTimer.current)
    if (savedEventTimer.current !== null) clearTimeout(savedEventTimer.current)
    if (resetNoticeTimer.current !== null) clearTimeout(resetNoticeTimer.current)
    emitTouchEdit({ active: false, model, parts: cloneTouchParts(touchDraftRef.current) })
  }, [])

  // ---- 事件绑定操作 ----
  const setEventBinding = (event: PetEventKey, binding: EventBinding): void => {
    commitEventBindings({ ...eventBindingsRef.current, [event]: binding }, event)
  }

  const toggleEventMotion = (event: PetEventKey, group: string, checked: boolean): void => {
    const current = eventBindingsRef.current[event]
    const motions = checked
      ? (current.motions.includes(group) ? current.motions : [...current.motions, group])
      : current.motions.filter((motion) => motion !== group)
    setEventBinding(event, { ...current, motions })
  }

  const setEventLinePool = (event: PetEventKey, stage: number, raw: string): void => {
    const current = eventBindingsRef.current[event]
    const pool = parseEventLines(raw)
    const lines = current.lines.map((existing, index) => (index === stage ? pool : existing))
    setEventBinding(event, { ...current, lines })
  }

  /** 恢复某个事件为 DEFAULT_EVENT_BINDINGS 的动作组 + 台词池。 */
  const resetEventBinding = (event: PetEventKey): void => {
    if (readOnly) return
    const draft = normalizeEventDraft(DEFAULT_EVENT_BINDINGS[event], event)
    commitEventBindings({ ...eventBindingsRef.current, [event]: draft }, event)
    setEventLineDrafts((prev) => {
      const next = { ...prev }
      for (const key of Object.keys(next)) {
        if (key.startsWith(`${event}:`)) delete next[key]
      }
      return next
    })
  }

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
    const part: TouchPart = { id: nextTouchPartId(touchDraftRef.current), name: '新部位', boxes: [], motions: [] }
    // 新部位插到数组最前面 = 最上层（parts 数组顺序即图层顺序，第 0 项最上层）
    markStructureDirty()
    commitTouchDraft([part, ...touchDraftRef.current], part.id)
  }

  const removeTouchPart = (id: string): void => {
    const next = touchDraftRef.current.filter((part) => part.id !== id)
    setPartLineDrafts((prev) => {
      if (!(id in prev)) return prev
      const cleared = { ...prev }
      delete cleared[id]
      return cleared
    })
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

  const removeBox = (partId: string, boxIndex: number): void => {
    updateTouchPart(partId, (part) => ({ ...part, boxes: part.boxes.filter((_box, index) => index !== boxIndex) }))
  }

  const setPartMotions = (partId: string, next: string[]): void => {
    updateTouchPart(partId, (part) => ({ ...part, motions: [...next] }))
  }

  /** 部位台词变更：一行一条；全空时删除 lines 字段（回退全局默认台词）。 */
  const setPartLines = (partId: string, raw: string): void => {
    const lines = parsePartLines(raw)
    updateTouchPart(partId, (part) => {
      const next = { ...part }
      if (lines.length > 0) next.lines = lines
      else delete next.lines
      return next
    })
  }

  const reloadAll = (): void => { setReloadKey((key) => key + 1) }
  const retryMotionGroups = (): void => { setMotionReloadKey((key) => key + 1) }

  /** 事件绑定卡片：header = [chevron][事件名][摘要][右侧操作组：脏提示/保存/恢复默认]。 */
  const renderEventCard = (event: PetEventKey): ReactElement => {
    const binding = eventBindings[event]
    const stages = eventStageLabels(event)
    const expanded = expandedEventKeys.has(event)
    const dirty = dirtyEventKeys.has(event)
    const summary = `${binding.motions.length} 个动作组 · ${stages.length} 阶段台词`
    const options: ThemeSelectOption[] = [
      ...motionGroups,
      ...binding.motions.filter((motion) => !motionGroups.includes(motion)),
    ].map((id) => ({ id, name: id }))
    const toggleExpanded = (): void => {
      setExpandedEventKeys((prev) => {
        const next = new Set(prev)
        if (next.has(event)) next.delete(event)
        else next.add(event)
        return next
      })
    }
    return createElement('div', { key: event, style: cardStyle },
      createElement('div', { className: 'dsh-card-header-row', style: cardHeaderRowStyle },
        createElement('button', {
          type: 'button',
          'aria-expanded': expanded,
          onClick: toggleExpanded,
          className: 'dsh-card-header',
          style: cardHeaderButtonStyle,
        },
          createElement('span', { style: { ...chevronStyle, transform: expanded ? 'rotate(90deg)' : 'none' } }, '▸'),
          createElement('span', { style: cardTitleStyle }, EVENT_LABELS[event]),
          createElement('span', { style: { ...cardSummaryStyle, flex: 1, minWidth: 0 } }, summary),
        ),
        createElement('div', { style: cardHeaderActionsStyle },
          dirty
            ? createElement('span', { style: { ...statusTextStyle, color: C.warn } }, '● 未保存改动')
            : savedEventFlash?.event === event
              ? createElement('span', { style: { ...statusTextStyle, color: C.success } }, `已保存 ${savedEventFlash.time}`)
              : null,
          dirty
            ? createElement('button', {
              type: 'button',
              className: 'dsh-btn dsh-btn-primary',
              style: buttonPrimaryStyle,
              disabled: saveState === 'saving' || readOnly,
              onClick: () => saveEventCardNow(event),
            }, '保存')
            : null,
          createElement('button', {
            type: 'button',
            className: 'dsh-btn dsh-btn-secondary',
            style: buttonSecondaryStyle,
            disabled: readOnly,
            onClick: () => resetEventBinding(event),
          }, '恢复默认'),
        ),
      ),
      expanded && createElement('div', { style: cardBodyStyle },
        createElement('div', { style: { ...formRowStyle, marginBottom: 0 } },
          createElement('span', { style: formLabelStyle }, '动作组'),
          createElement(ThemeMultiSelect, {
            value: binding.motions,
            options,
            disabled: readOnly || motionGroupsStatus !== 'ready',
            placeholder: '不选 = 不播动作',
            onChange: (next) => {
              const current = eventBindingsRef.current[event]
              setEventBinding(event, { ...current, motions: [...next] })
            },
          }),
        ),
        ...stages.map((stageLabel, stage) => {
          const draftKey = `${event}:${stage}`
          const pool = binding.lines[stage] ?? []
          return createElement('div', { key: `stage-${stage}`, style: { ...formRowStartStyle, marginBottom: 0 } },
            createElement('span', { style: formLabelStartStyle }, `台词池 · ${stageLabel}`),
            createElement('textarea', {
              style: textareaStyle,
              value: eventLineDrafts[draftKey] ?? pool.join('\n'),
              placeholder: '一行一条；留空 = 该阶段不显示气泡',
              disabled: readOnly,
              onChange: (e: ChangeEvent<HTMLTextAreaElement>) => {
                const raw = e.target.value
                // 保留原始输入（否则空行/末尾换行被清洗掉，无法继续输入下一行）
                setEventLineDrafts((prev) => ({ ...prev, [draftKey]: raw }))
                setEventLinePool(event, stage, raw)
              },
              onBlur: () => setEventLineDrafts((prev) => {
                if (!(draftKey in prev)) return prev
                const next = { ...prev }
                delete next[draftKey]
                return next
              }),
            }),
          )
        }),
      ),
    )
  }

  /** 部位卡片：header = [chevron][层号 chip][名称][↑][↓][删除部位]，统一 28 高垂直居中。 */
  const renderTouchPartCard = (part: TouchPart, index: number): ReactElement => {
    const expanded = expandedPartId === part.id
    const isTopLayer = index === 0
    const isBottomLayer = index === touchDraft.length - 1
    const layerLabel = `#${index + 1}${isTopLayer ? ' 顶层' : ''}${isBottomLayer && !isTopLayer ? ' 底层' : ''}`
    const groups = [...motionGroups, ...part.motions.filter((motion) => !motionGroups.includes(motion))]
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
          title: isTopLayer ? '最上层（box 重叠时优先）' : (isBottomLayer ? '最底层' : '图层'),
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
          '坐标以角色包围盒的左下角为原点（0–100%）：「上」变大 = box 往上长，「下」变小 = box 往下长；',
          '一个部位可有多个 box，命中任一即算该部位。'),
        part.boxes.length === 0
          ? createElement('div', { style: { ...hintStyle, marginBottom: GAP.sm } }, '还没有 box，点「+ 添加 box」画出点击区域。')
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
        createElement('div', { key: 'part-lines', style: { ...formRowStartStyle, marginBottom: 0 } },
          createElement('span', { style: formLabelStartStyle }, '台词'),
          createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: GAP.xs, minWidth: 0 } },
            createElement('div', { style: hintStyle }, '一行一条；留空 = 使用全局默认台词池'),
            createElement('textarea', {
              style: textareaStyle,
              value: partLineDrafts[part.id] ?? (part.lines ?? []).join('\n'),
              placeholder: '留空 = 使用全局默认台词池；一行一条',
              disabled: readOnly,
              onChange: (e: ChangeEvent<HTMLTextAreaElement>) => {
                const raw = e.target.value
                // 原始输入保留在缓冲里（否则空行/末尾换行被清洗掉，没法继续输入下一行）
                setPartLineDrafts((prev) => ({ ...prev, [part.id]: raw }))
                setPartLines(part.id, raw)
              },
              onBlur: () => setPartLineDrafts((prev) => {
                if (!(part.id in prev)) return prev
                const next = { ...prev }
                delete next[part.id]
                return next
              }),
            }),
            createElement('div', { style: { fontSize: 12, color: C.textSecondary } },
              part.lines && part.lines.length > 0
                ? `${part.lines.length} 条（随机选一条）`
                : `最多 ${MAX_LINES_PER_PART} 条 × ${MAX_LINE_LENGTH} 字`),
          ),
        ),
        createElement('div', { key: 'part-motions', style: { ...formRowStyle, marginBottom: 0 } },
          createElement('span', { style: formLabelStyle }, '动作组'),
          motionGroupsStatus === 'loading'
            ? createElement('div', { style: { fontSize: 12, color: C.textSecondary } }, '正在解析动作列表…')
            : motionGroupsStatus === 'error'
              ? createElement('div', { style: { fontSize: 12, color: C.error } }, '无法解析动画列表（动作组可留空，部位仍会保存）')
              : groups.length === 0
                ? createElement('div', { style: { fontSize: 12, color: C.textSecondary } }, '该模型没有定义动作组')
                : createElement(ThemeMultiSelect, {
                  value: part.motions,
                  options: groups.map((group) => ({ id: group, name: group })),
                  disabled: readOnly || motionGroupsStatus !== 'ready',
                  placeholder: '不选 = 只出气泡',
                  onChange: (next: string[]) => setPartMotions(part.id, next),
                }),
        ),
      ),
    )
  }

  // ---- 组装页面 ----
  const hasChanges = partsDirty || eventsDirty
  const motionGroupsHint = motionGroupsStatus === 'loading'
    ? '正在解析模型动画列表…'
    : motionGroupsStatus === 'error'
      ? '无法解析动画列表（动作组可留空，配置仍会保存）'
      : motionGroupsStatus === 'ready'
        ? `已解析到 ${motionGroups.length} 个动作组`
        : null

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
    createElement('h3', { key: 'title', style: { margin: '0 0 4px', fontSize: 16, fontWeight: 600, color: C.textPrimary } }, '桌宠配置'),
    createElement('p', { key: 'sub', style: { ...sectionDescStyle, margin: '0 0 16px' } },
      '设置立即生效；动画与台词按「事件」绑定，触摸部位可单独覆盖触摸时的表现。修改后点击分组内「保存」写入。'),
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
  const numberInputStyle: CSSProperties = { ...inputStyle, flex: '0 0 88px', width: 88, textAlign: 'right' }
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
      description: '基础显示、画布与默认位置，以及对白气泡的位置与配色。',
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
      createElement('div', { style: { ...formRowStyle, marginBottom: 0 } },
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
    ),
    // B. 画布与位置
    createElement('div', { key: 'canvas-home', style: rowStyle },
      createElement('div', { style: cardHeadingStyle }, '画布与位置'),
      createElement('div', { style: formRowStyle },
        createElement('span', { style: formLabelStyle }, '水平留白（%）'),
        createElement('div', { style: formControlStyle },
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
      createElement('div', { style: formRowStyle },
        createElement('span', { style: formLabelStyle }, '垂直留白（%）'),
        createElement('div', { style: formControlStyle },
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
      createElement('div', { style: formRowStyle },
        createElement('span', { style: formLabelStyle }, '中心距右（% 窗口宽）'),
        createElement('div', { style: formControlStyle },
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
      createElement('div', { style: formRowStyle },
        createElement('span', { style: formLabelStyle }, '中心距下（% 窗口高）'),
        createElement('div', { style: formControlStyle },
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
          createElement('button', {
            type: 'button',
            className: 'dsh-btn dsh-btn-secondary',
            style: buttonSecondaryStyle,
            disabled: !writable,
            onClick: requestRecenter,
          }, '归位'),
          resetNotice
            ? createElement('span', {
              key: 'reset-notice',
              style: { ...statusTextStyle, color: C.success },
            }, resetNotice)
            : null,
        ),
      ),
    ),
    // C. 对白气泡
    createElement('div', { key: 'bubble-style', style: rowStyle },
      createElement('div', { style: cardHeadingStyle }, '对白气泡'),
      createElement('div', { style: formRowStyle },
        createElement('span', { style: formLabelStyle }, '水平偏移（px）'),
        createElement('div', { style: formControlStyle },
          createElement('input', {
            type: 'number',
            min: -1000,
            max: 1000,
            step: 5,
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
      createElement('div', { style: formRowStyle },
        createElement('span', { style: formLabelStyle }, '垂直偏移（px）'),
        createElement('div', { style: formControlStyle },
          createElement('input', {
            type: 'number',
            min: -1000,
            max: 1000,
            step: 5,
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
      createElement('div', { style: formRowStyle },
        createElement('span', { style: formLabelStyle }, '背景色'),
        createElement('div', { style: formControlStyle },
          createElement('input', {
            type: 'color',
            value: bubbleBgColor,
            disabled: !writable,
            style: colorInputStyle,
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              const next = normalizeHexColor(e.target.value, '#ffffff')
              enqueueWrite(() => [{ op: 'set', path: ['bubbleBgColor'], value: next }])
            },
          }),
        ),
      ),
      createElement('div', { style: formRowStyle },
        createElement('span', { style: formLabelStyle }, '背景不透明度'),
        createElement('div', { style: formControlStyle },
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
      createElement('div', { style: { ...formRowStyle, marginBottom: 0 } },
        createElement('span', { style: formLabelStyle }, '文字颜色'),
        createElement('div', { style: formControlStyle },
          createElement('input', {
            type: 'color',
            value: bubbleTextColor,
            disabled: !writable,
            style: colorInputStyle,
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              const next = normalizeHexColor(e.target.value, '#222222')
              enqueueWrite(() => [{ op: 'set', path: ['bubbleTextColor'], value: next }])
            },
          }),
        ),
      ),
    ),
  ))

  // 4. 事件绑定（当前模型）：6 事件的动作组 + 分阶段台词池
  children.push(createElement('div', { key: 'event-bindings', style: sectionStyle },
    createElement(SectionHeader, {
      title: '事件绑定（当前模型）',
      description: createElement('div', null,
        '每个事件可配置动作组与台词池：动作组来自当前模型 Motions（不选 = 不播动作）；',
        createElement('br'),
        '台词一行一条，留空 = 该阶段不显示气泡；修改后点击对应事件卡里的「保存」写入。',
        motionGroupsStatus === 'error'
          ? createElement('div', { style: { ...noticeErrorStyle, marginTop: 8, marginBottom: 0 } },
            '无法解析当前模型的动作组，动作多选暂不可用（可稍后重试）。',
            createElement('button', { className: 'dsh-btn dsh-btn-secondary', style: { ...buttonSecondaryStyle, marginLeft: 8 }, onClick: retryMotionGroups }, '重试'),
          )
          : null,
      ),
      action: motionGroupsHint
        ? createElement('span', { style: statusTextStyle, color: C.textSecondary }, motionGroupsHint)
        : undefined,
    }),
    ...EVENT_ORDER.map((event) => renderEventCard(event)),
  ))

  // 5. 触摸部位（当前模型）：所有输入始终可编辑；预览开关只控制宠物上的 box 叠加
  children.push(createElement('div', { key: 'touch-parts', style: sectionStyle },
    createElement(SectionHeader, {
      title: '触摸部位（当前模型）',
      description: '预览只控制角色上的 box 叠加/强制可见，不影响编辑与保存。',
      action: createElement('button', {
        type: 'button',
        className: 'dsh-btn dsh-btn-secondary',
        style: buttonSecondaryStyle,
        disabled: readOnly,
        onClick: toggleTouchEditing,
      }, touchEditing ? '退出预览' : '预览 box（在角色上显示）'),
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
        '这个模型还没有触摸部位：新建部位后画 box、勾选动作，角色被摸到相应区域时就会有反应。')
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

  // 6. 开发者选项
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
