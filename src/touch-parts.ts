/**
 * 触摸部位文件（$DSH_HOME/waifu/touch-parts.jsonc，JSONC，插件私有）：
 * 用户自定义的触摸部位按模型 id 分组持久化；首次启动落地模板，保存时写回并保留文件头注释。
 * 与内置 preset 的默认部位的关系：用户保存过该模型 → 以用户文件为准；
 * 没有保存过（或文件被删）→ 回退 preset.touchParts → 再回退空表。
 * @module dsh-waifu/touch-parts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { petHomeDir, fileStamp } from './home.ts'
import type { EventBindings, TouchPart } from './models.ts'
import { normalizeEventBindings, normalizeTouchParts } from './models.ts'
import { stripJsonComments } from './jsonc.ts'

/** 触摸部位文件名（$DSH_HOME/waifu 下）。 */
export const TOUCH_PARTS_FILENAME = 'touch-parts.jsonc'

/** 文件内每个模型 id 的配置。 */
export interface TouchPartsModelEntry {
  parts: TouchPart[]
  /** 可选：该模型的「事件绑定」用户覆盖（设置页「事件绑定」保存：动画组 + 台词池）。 */
  events?: Partial<EventBindings>
}

/** 触摸部位文件视图（路径/错误/按模型分组的数据）。 */
export interface TouchPartsFileView {
  models: Record<string, TouchPartsModelEntry>
  error: string | null
  path: string
}

/** 文件头注释：每次写回时保留，提示用户这是插件私有配置。 */
const TOUCH_PARTS_HEADER = `// 触摸部位配置文件（插件私有，JSONC 支持注释）。
// 路径：$DSH_HOME/waifu/touch-parts.jsonc
// 建议通过设置页「触摸部位」编辑；直接编辑后刷新页面即可生效。
// 结构：models[<模型 id>].parts[] = { id, name, boxes[{left,top,right,bottom}], motions[] }
// left/top/right/bottom 为相对模型包围盒的 0–1 归一化坐标（左上右下）。`

function serializeTouchParts(models: Record<string, TouchPartsModelEntry>): string {
  return `${TOUCH_PARTS_HEADER}\n${JSON.stringify({ version: 1, models }, null, 2)}\n`
}

const TOUCH_PARTS_TEMPLATE = serializeTouchParts({})

/** 旧格式 animationMap（状态 → 动作组）→ events（只填动作组）。 */
function normalizeLegacyMotionMap(raw: unknown): Partial<EventBindings> {
  const out: Partial<EventBindings> = {}
  if (typeof raw !== 'object' || raw === null) return out
  const record = raw as Record<string, unknown>
  for (const [event, value] of Object.entries(record)) {
    if (!Array.isArray(value)) continue
    const motions = [...new Set(value.filter((m): m is string => typeof m === 'string' && m.trim().length > 0).map((m) => m.trim()))]
    if (motions.length === 0) continue
    out[event as keyof EventBindings] = { motions, lines: [[]] }
  }
  return out
}

/** 归一化「模型 id → 部位列表」映射（丢弃空值/非法结构）。 */
function normalizeModelMap(raw: unknown): Record<string, TouchPartsModelEntry> {
  const out: Record<string, TouchPartsModelEntry> = {}
  if (typeof raw !== 'object' || raw === null) return out
  for (const [modelId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!modelId.trim() || typeof value !== 'object' || value === null) continue
    const record = value as { parts?: unknown; events?: unknown; animationMap?: unknown }
    const entry: TouchPartsModelEntry = { parts: normalizeTouchParts(record.parts) }
    const events = normalizeEventBindings(record.events)
    if (Object.keys(events).length > 0) entry.events = events
    else if (record.animationMap && typeof record.animationMap === 'object') {
      // 旧格式迁移：animationMap（状态 → 动作组）→ events（仅动作组，台词用默认）
      const legacy = normalizeLegacyMotionMap(record.animationMap)
      if (Object.keys(legacy).length > 0) entry.events = legacy
    }
    out[modelId] = entry
  }
  return out
}

/**
 * 触摸部位文件存取器：构造时确保目录存在并落地模板（不存在才写），
 * 之后 load() 每次现读；write() 由设置页保存时调用。
 */
export class TouchPartsStore {
  readonly path: string
  private lastGood: Record<string, TouchPartsModelEntry> = {}
  private lastError: string | null = null
  /** 上次解析对应的文件时间戳（`mtimeMs:size`）：文件没变就复用，snapshot 每次推送都要读它。 */
  private lastStamp: string | null = null

  constructor(path?: string) {
    this.path = path ?? join(petHomeDir(), 'waifu', TOUCH_PARTS_FILENAME)
    try {
      mkdirSync(dirname(this.path), { recursive: true })
    } catch {
      // 目录创建失败：后续读写会报错，按空表处理
    }
    try {
      if (!existsSync(this.path)) writeFileSync(this.path, TOUCH_PARTS_TEMPLATE, 'utf8')
    } catch {
      // 落地失败（权限/只读 home）：后续读不到文件按空表处理
    }
  }

  /** 现读并解析；失败时沿用上一份好结果并给出错误消息（文件没变则复用上次结果）。 */
  load(): TouchPartsFileView {
    const stamp = fileStamp(this.path)
    if (stamp !== null && stamp === this.lastStamp) {
      return { models: this.lastGood, error: this.lastError, path: this.path }
    }
    let text: string
    try {
      text = readFileSync(this.path, 'utf8')
    } catch (error) {
      this.lastError = `无法读取 ${this.path}：${error instanceof Error ? error.message : String(error)}`
      return { models: this.lastGood, error: this.lastError, path: this.path }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(stripJsonComments(text))
    } catch (error) {
      this.lastError = `JSONC 解析失败（沿用上次结果）：${error instanceof Error ? error.message : String(error)}`
      return { models: this.lastGood, error: this.lastError, path: this.path }
    }
    const rawModels = (parsed as { models?: unknown })?.models
    if (rawModels !== undefined && typeof rawModels !== 'object') {
      this.lastError = 'JSONC 结构错误："models" 必须是对象（沿用上次结果）'
      return { models: this.lastGood, error: this.lastError, path: this.path }
    }
    this.lastGood = normalizeModelMap(rawModels)
    this.lastError = null
    this.lastStamp = stamp
    return { models: this.lastGood, error: this.lastError, path: this.path }
  }

  /** 按模型 id 取用户保存的部位列表（没有保存过返回 null，由调用方回退默认）。 */
  partsFor(modelId: string): TouchPart[] | null {
    const view = this.load()
    const entry = view.models[modelId]
    return entry ? entry.parts : null
  }

  /**
   * 写回某个模型的部位列表 +（可选）事件绑定覆盖（设置页保存用；保留文件头注释）。
   * events 传 undefined 表示不改动已有覆盖；传 {} 表示清空覆盖（回到内置/自定义默认）。
   */
  save(modelId: string, parts: readonly TouchPart[], events?: Partial<EventBindings>): TouchPartsFileView {
    const id = modelId.trim()
    if (!id) throw new Error('model id 不能为空')
    const view = this.load()
    const previous = view.models[id]
    const entry: TouchPartsModelEntry = { parts: normalizeTouchParts(parts) }
    const mergedEvents = events === undefined
      ? previous?.events
      : normalizeEventBindings(events)
    if (mergedEvents && Object.keys(mergedEvents).length > 0) entry.events = mergedEvents
    const next: Record<string, TouchPartsModelEntry> = { ...view.models, [id]: entry }
    try {
      writeFileSync(this.path, serializeTouchParts(next), 'utf8')
      this.lastGood = next
      this.lastError = null
      this.lastStamp = null
    } catch (error) {
      this.lastError = `写入失败 ${this.path}：${error instanceof Error ? error.message : String(error)}`
    }
    return this.load()
  }
}
