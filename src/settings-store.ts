/**
 * 桌宠设置文件（$DSH_HOME/waifu/settings.jsonc，JSONC，插件私有）。
 *
 * 为什么不再用 DSH settings.yaml：dsh 0.2.x 的 `ctx.settings` 变成「Config schema →
 * 设置页表单」投影，写入会经 Loader 重新应用插件条目（整插件重载），热设置（尺寸滑杆、
 * 帧率、开关）会因此丢失实时性。插件自有设置文件 + 内存快照 + SSE 推送（ADR-006）
 * 保持即时生效，不再触发插件重载（ADR-013）。
 *
 * 内置 preset 的默认值来自 cordis.patch.yml 的 config（作为 base 层），用户改动落到本文件。
 * @module dsh-waifu/settings-store
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { stripJsonComments } from './jsonc.ts'

/** 设置文件名（$DSH_HOME/waifu 下）。 */
export const SETTINGS_FILENAME = 'settings.jsonc'

/** 宠物标量设置（Host Config 同构）。 */
export interface PetSettings {
  /** 插件总开关。 */
  enabled: boolean
  /** 宠物尺寸（px，40–400）。 */
  size: number
  /** 渲染帧率上限（30 / 60 / 0=不限制）。 */
  maxFps: number
  /** 选中模型：内置 preset id、自定义模型 id，或直接 URL。 */
  model: string
  /** 开发者选项总开关。 */
  developerMode: boolean
  /** 调试面板。 */
  debug: boolean
  /** 显示触摸部位色块（开发者选项）。 */
  showTapZones: boolean
  /** 画布水平留白（每侧，size 的百分比 0–300；防动作甩尾被裁切）。 */
  canvasPadX: number
  /** 画布垂直留白（每侧，size 的百分比 0–300）。 */
  canvasPadY: number
  /** 默认位置：显示区**中心点**距视口右侧（视口宽度百分比 0–100，用于「归位」与首次启动）。 */
  homeRight: number
  /** 默认位置：显示区**中心点**距视口底部（视口高度百分比 0–100）。 */
  homeBottom: number
  /** 气泡相对模型顶部中心的水平偏移（px，正值向右）。 */
  bubbleOffsetX: number
  /** 气泡相对模型顶部中心的垂直偏移（px，正值向上、负值向下；默认 10 = 模型上方 10px）。 */
  bubbleOffsetY: number
  /** 气泡背景色（#rrggbb）。 */
  bubbleBgColor: string
  /** 气泡背景不透明度（0–100）。 */
  bubbleBgOpacity: number
  /** 气泡文字颜色（#rrggbb）。 */
  bubbleTextColor: string
  /** AI 回复总开关（ADR-025）：开启后触摸/状态回复改由 `ctx.llm` 生成。 */
  aiEnabled: boolean
  /** 仅触摸：状态变化只用预置台词，AI 只在触摸部位时发言（ADR-025）。 */
  aiTouchOnly: boolean
  /** AI 回复使用的 provider 路由（DSH 已配置的 LLM provider，如 `deepseek-official`）。 */
  aiProvider: string
  /** AI 回复使用的模型 id（provider 下可用模型）。 */
  aiModel: string
}

/** 设置文件视图（设置页读取用）。 */
export interface PetSettingsView {
  value: PetSettings
  error: string | null
  path: string
  writable: boolean
}

/** DSH home 目录（与 persist.ts / touch-parts.ts 同一规则）。 */
function petHomeDir(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

const SETTINGS_HEADER = `// 桌宠设置文件（插件私有，JSONC 支持注释）。
// 路径：$DSH_HOME/waifu/settings.jsonc
// 建议通过设置页「桌宠配置」修改；直接编辑保存后刷新页面生效。
// 字段：enabled / size / maxFps / model / developerMode / debug / showTapZones / canvasPadX / canvasPadY /
//        homeRight / homeBottom / bubbleOffsetX / bubbleOffsetY / bubbleBgColor / bubbleBgOpacity / bubbleTextColor /
//        aiEnabled / aiTouchOnly / aiProvider / aiModel`

/**
 * 设置文件结构版本：
 * - 2 起 homeRight/homeBottom 语义 = 显示区中心点距右/距下（px）
 * - 3 起 homeRight/homeBottom 改为**视口宽/高的百分比**（0–100）；bubbleOffsetY 改为负值向下
 * - 4 起去掉基础表情与连续表情强度（`expression` / `expr*`），表情改为挂在事件/触摸部位上（ADR-023）
 */
const SETTINGS_SCHEMA_VERSION = 4

/** home 改成视口百分比的版本（3）；更早的文件 home 语义不同，直接回退 base。 */
const HOME_PERCENT_VERSION = 3

function serializeSettings(value: PetSettings): string {
  return `${SETTINGS_HEADER}\n${JSON.stringify({ ...value, version: SETTINGS_SCHEMA_VERSION }, null, 2)}\n`
}

const MAX_FPS_OPTIONS = [30, 60, 0] as const

function clampSize(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  return Math.round(Math.min(400, Math.max(40, n)))
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * 归一化设置对象：已知字段按类型收敛，未知字段忽略；非法值回退 base。
 * 纯函数（设置页保存与文件读取共用）。
 */
export function normalizeSettings(raw: unknown, base: PetSettings): PetSettings {
  const record = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  const bool = (key: keyof PetSettings): boolean => {
    const value = record[key]
    return typeof value === 'boolean' ? value : base[key] as boolean
  }
  const maxFpsRaw = typeof record.maxFps === 'number' ? record.maxFps : base.maxFps
  const maxFps = (MAX_FPS_OPTIONS as readonly number[]).includes(maxFpsRaw) ? maxFpsRaw : base.maxFps
  const clampPad = (value: unknown, fallback: number): number => {
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.round(Math.min(300, Math.max(0, n)))
  }
  const clampHome = (value: unknown, fallback: number): number => {
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.round(Math.min(100, Math.max(0, n)))
  }
  const clampOffset = (value: unknown, fallback: number): number => {
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.round(Math.min(1000, Math.max(-1000, n)))
  }
  const color = (value: unknown, fallback: string): string => {
    const text = typeof value === 'string' ? value.trim() : ''
    return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback
  }
  const opacity = (value: unknown, fallback: number): number => {
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.round(Math.min(100, Math.max(0, n)))
  }
  // 旧版本迁移：
  // - v1（无 version）：home 语义是「画布右下角距右/距下」；
  // - v2：home 是 px 的「中心点距右/距下」；
  // 两种旧值都无法直接换算成 v3 的视口百分比（旧值依赖当时的窗口尺寸），一律回退 base 默认值。
  // - bubbleOffsetY 在 v3 前是「负值向上」，与新版正好相反，值取反即可保持观感不变。
  const version = typeof record.version === 'number' ? record.version : 0
  const legacyHome = version < HOME_PERCENT_VERSION
  const offsetYRaw = record.bubbleOffsetY
  const offsetY = version < HOME_PERCENT_VERSION && typeof offsetYRaw === 'number' ? -offsetYRaw : offsetYRaw
  return {
    enabled: bool('enabled'),
    size: clampSize(record.size) ?? base.size,
    maxFps,
    model: pickString(record.model) ?? base.model,
    developerMode: bool('developerMode'),
    debug: bool('debug'),
    showTapZones: bool('showTapZones'),
    canvasPadX: clampPad(record.canvasPadX, base.canvasPadX),
    canvasPadY: clampPad(record.canvasPadY, base.canvasPadY),
    homeRight: legacyHome ? base.homeRight : clampHome(record.homeRight, base.homeRight),
    homeBottom: legacyHome ? base.homeBottom : clampHome(record.homeBottom, base.homeBottom),
    bubbleOffsetX: clampOffset(record.bubbleOffsetX, base.bubbleOffsetX),
    bubbleOffsetY: clampOffset(offsetY, base.bubbleOffsetY),
    bubbleBgColor: color(record.bubbleBgColor, base.bubbleBgColor),
    bubbleBgOpacity: opacity(record.bubbleBgOpacity, base.bubbleBgOpacity),
    bubbleTextColor: color(record.bubbleTextColor, base.bubbleTextColor),
    aiEnabled: bool('aiEnabled'),
    aiTouchOnly: bool('aiTouchOnly'),
    aiProvider: pickString(record.aiProvider) ?? base.aiProvider,
    aiModel: pickString(record.aiModel) ?? base.aiModel,
  }
}

/**
 * 设置文件存取器：构造时确保目录存在并落地模板（不存在才写），之后每次现读；
 * 写入由设置页 API 触发（applyOps）。
 */
export class SettingsStore {
  readonly path: string
  private readonly base: PetSettings
  private lastGood: PetSettings
  private lastError: string | null = null

  constructor(base: PetSettings, path?: string) {
    this.base = { ...base }
    this.lastGood = { ...base }
    this.path = path ?? join(petHomeDir(), 'waifu', SETTINGS_FILENAME)
    try {
      mkdirSync(dirname(this.path), { recursive: true })
    } catch {
      // 目录创建失败：后续读写会报错，按 base 处理
    }
    try {
      // 首次落地：用当前 base（cordis.patch.yml config / schema 默认）作为初始值
      if (!existsSync(this.path)) writeFileSync(this.path, serializeSettings(this.base), 'utf8')
    } catch {
      // 落地失败：按 base 处理
    }
  }

  /** 现读设置（文件损坏时沿用上一份好结果，错误写进 view）。 */
  get(): PetSettings {
    let text: string
    try {
      text = readFileSync(this.path, 'utf8')
    } catch (error) {
      this.lastError = `无法读取 ${this.path}：${error instanceof Error ? error.message : String(error)}`
      return { ...this.lastGood }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(stripJsonComments(text))
    } catch (error) {
      this.lastError = `JSONC 解析失败（沿用上次结果）：${error instanceof Error ? error.message : String(error)}`
      return { ...this.lastGood }
    }
    this.lastGood = normalizeSettings(parsed, this.base)
    this.lastError = null
    return { ...this.lastGood }
  }

  /** 设置页读取视图。 */
  view(): PetSettingsView {
    const value = this.get()
    return { value, error: this.lastError, path: this.path, writable: true }
  }

  /**
   * 应用设置页的 path 操作（`{op:'set',path:['size'],value}` / `{op:'unset'}`），
   * 过滤未知路径与非法值，写回文件并返回最新视图。
   */
  applyOps(ops: readonly SettingsPathOp[]): PetSettingsView {
    const current = this.get()
    // 带上 schema 版本，避免写入路径被「旧版 home 语义迁移」误判
    let next: Record<string, unknown> = { ...current, version: SETTINGS_SCHEMA_VERSION }
    for (const op of ops) {
      if (!Array.isArray(op.path) || op.path.length !== 1) continue
      const key = op.path[0]
      if (typeof key !== 'string' || !(key in current)) continue
      if (op.op === 'unset') {
        delete next[key]
        continue
      }
      next[key] = op.value
    }
    this.lastGood = normalizeSettings(next, this.base)
    try {
      writeFileSync(this.path, serializeSettings(this.lastGood), 'utf8')
      this.lastError = null
    } catch (error) {
      this.lastError = `写入失败 ${this.path}：${error instanceof Error ? error.message : String(error)}`
    }
    return this.view()
  }
}
