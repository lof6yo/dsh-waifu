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
import { petHomeDir, fileStamp } from './home.ts'
import { clampInt } from './clamp.ts'
import {
  ACTIVITY_WINDOW_LIMITS,
  AI_HISTORY_LIMITS,
  AI_MEMORY_LIMITS,
  AI_MIN_INTERVAL_LIMITS,
  BAR_AUTO_HIDE_LIMITS,
  BAR_OFFSET_LIMITS,
  IDLE_TIMEOUT_LIMITS,
  MERGE_MAX_LIMITS,
  TAP_GAP_LIMITS,
  defaultEventTriggers,
  normalizeBarPosition,
  normalizeEventTriggers,
  normalizeEventTexts,
  normalizeMotionTexts,
  normalizeExpressionTexts,
  normalizeMotionEnabled,
  normalizeExpressionEnabled,
  CATALOG_TEXT_MAX,
  EVENT_TEXT_MAX,
  normalizeFocusRange,
  normalizeLipsyncGain,
  normalizeTriggerMode,
  ttsModelOption,
  ttsModelRandomVoice,
  type BarPosition,
  type EventTriggers,
  type TriggerMode,
} from './defaults.ts'
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
  /** 气泡最长连续可见秒数（0 = 不限，默认 10；ADR-027 兜底断流导致的气泡常驻）。 */
  bubbleMaxSeconds: number
  /** AI 驱动总开关（ADR-037）：关闭后角色完全静默（无固定台词可回落）。 */
  aiEnabled: boolean
  /** 待机小动作总开关。 */
  idleMotionEnabled: boolean
  /** AI 使用的 provider 路由（DSH 已配置的 LLM provider，如 `deepseek-official`）。 */
  aiProvider: string
  /** AI 使用的模型 id（provider 下可用模型）。 */
  aiModel: string
  /** 注入的最近对话轮数（1 轮 = 一问一答两条消息；0 = 不注入）。 */
  aiHistoryCount: number
  /** 注入的最近记忆条数（0 = 不注入）。 */
  aiMemoryCount: number
  /** 新触发的处理方式：interrupt = 掐掉上一轮立刻反应，queue = 等上一轮说完再反应。 */
  triggerMode: TriggerMode
  /** 事件类触发的最小间隔（秒，0 = 不限制；触摸/对话不受限）。 */
  aiMinIntervalSec: number
  /** 静默超时（秒，0 = 关闭）：多久没有任何事件/互动就自动让角色说一句话。 */
  idleTimeoutSec: number
  /** 同类 DSH 事件的触发窗口（秒）：窗口内同类事件并进合并队列，不各自触发（ADR-047）。 */
  activityWindowSec: number
  /** 触摸连点窗口（毫秒）：窗口内的连续触摸只保留最后一次（ADR-047）。 */
  tapGapMs: number
  /** 合并上限（条）：一轮场景句里最多拼进多少条被压下的触发（ADR-047）。 */
  mergeMax: number
  /** 按 DSH 事件类型粒度的触发开关（触摸/对话始终可触发，不在此表）。 */
  eventTriggers: EventTriggers
  /** 事件文案覆写（空 = 内置文案；ADR-039）。 */
  eventTexts: Record<string, string>
  /** 动作释义覆写（空 = 内置释义；ADR-040）。 */
  motionTexts: Record<string, string>
  /** 表情释义覆写（空 = 内置释义；ADR-040）。 */
  expressionTexts: Record<string, string>
  /** 动作是否发给模型（缺省 = 全开；ADR-040）。 */
  motionEnabled: Record<string, boolean>
  /** 表情是否发给模型（缺省 = 全开；ADR-040）。 */
  expressionEnabled: Record<string, boolean>
  /** 交互条位置（模型上方 / 下方）。 */
  barPosition: BarPosition
  /** 交互条额外偏移（px，正数远离模型）。 */
  barOffset: number
  /** 交互条无操作自动隐藏（秒；0 = 不自动隐藏）。 */
  barAutoHideSec: number

  /** 语音合成开关（ADR-033）。 */
  ttsEnabled: boolean
  /** 语音模型 slug（OpenRouter 的 speech 模型）。 */
  ttsModel: string
  /** 音色标识（空 = 模型默认）。 */
  ttsVoice: string
  /** 口型跟随开关。 */
  lipsyncEnabled: boolean
  /** 口型强度（0–300，100 = 标准）。 */
  lipsyncGain: number
  /** 鼠标跟随范围（% 模型尺寸；0 = 只在模型框内跟随）。 */
  focusRange: number
}

/** 设置文件视图（设置页读取用）。 */
export interface PetSettingsView {
  value: PetSettings
  error: string | null
  path: string
  writable: boolean
}

const SETTINGS_HEADER = `// 桌宠设置文件（插件私有，JSONC 支持注释）。
// 路径：$DSH_HOME/waifu/settings.jsonc
// 建议通过设置页「Waifu 设置」修改；直接编辑保存后刷新页面生效。
// 字段：enabled / size / maxFps / model / developerMode / debug / showTapZones / canvasPadX / canvasPadY /
//        homeRight / homeBottom / bubbleOffsetX / bubbleOffsetY / bubbleBgColor / bubbleBgOpacity / bubbleTextColor /
//        aiEnabled / aiProvider / aiModel / aiHistoryCount / aiMemoryCount / triggerMode /
//        aiMinIntervalSec / idleTimeoutSec / activityWindowSec / tapGapMs / mergeMax / eventTriggers /
//        barPosition / barOffset / barAutoHideSec /
//        ttsEnabled / ttsModel / ttsVoice / lipsyncEnabled / lipsyncGain`

/**
 * 设置文件结构版本：
 * - 2 起 homeRight/homeBottom 语义 = 显示区中心点距右/距下（px）
 * - 3 起 homeRight/homeBottom 改为**视口宽/高的百分比**（0–100）；bubbleOffsetY 改为负值向下
 * - 4 起去掉基础表情与连续表情强度（`expression` / `expr*`），表情改为挂在事件/触摸部位上（ADR-023）
 * - 5 起默认语音模型换成音色可固定的 MAI-Voice 2.1 Flash（Drama 3 每句都换人声，ADR-033 修订）
 * - 6 起默认回到 Fish Audio Drama 3（MAI-Voice 只存活一个版本）
 * - 7 起语音目录只剩通义千问 TTS，目录外的旧模型（Drama 3 / MAI / Kokoro）统一回落到新默认
 * - 8 起 ADR-037 全 AI 驱动：删 aiTouchOnly、aiTakeover、interactionMode、thinkingAi 与 waitingAi 系列，
 *        加 aiMemoryCount/triggerMode/aiMinIntervalSec/idleTimeoutSec/activityWindowSec/eventTriggers
 */
const SETTINGS_SCHEMA_VERSION = 8

/** home 改成视口百分比的版本（3）；更早的文件 home 语义不同，直接回退 base。 */
const HOME_PERCENT_VERSION = 3

/** 语音默认模型的调整：5 = 换 MAI-Voice，6 = 换回 Drama 3（ADR-033 修订二）。 */
const TTS_VOICE_FIX_VERSION = 5
const TTS_MODEL_RESET_VERSION = 6
/** 语音目录重写（只剩通义千问 TTS）的版本：目录外模型在这里回落到默认。 */
const TTS_CATALOG_VERSION = 7

/**
 * 语音默认值的迁移（ADR-033 修订）：
 * - v5：旧的「随机音色模型 + 没选音色」组合统一换成默认模型；
 * - v6：MAI-Voice 只存活了一个版本，旧文件里的它统一换回默认；
 * - v7：语音目录重写后，目录外的模型统一回落到默认。
 */
function migrateTtsVoice(
  version: number,
  rawModel: unknown,
  rawVoice: unknown,
  base: PetSettings,
): { model: string; voice: string } {
  const model = pickString(rawModel) ?? base.ttsModel
  // 音色允许空串（空 = 模型默认音色），所以不走 pickString
  const voice = typeof rawVoice === 'string' ? rawVoice.trim().slice(0, 64) : base.ttsVoice
  if (version < TTS_MODEL_RESET_VERSION && model === 'microsoft/mai-voice-2.1-flash') {
    return { model: base.ttsModel, voice: base.ttsVoice }
  }
  // 目录外的模型（Drama 3 / Kokoro 等）已经没有可选音色，直接换成新默认，免得请求必然 400
  if (version < TTS_CATALOG_VERSION && !ttsModelOption(model)) {
    return { model: base.ttsModel, voice: base.ttsVoice }
  }
  if (version < TTS_VOICE_FIX_VERSION && voice.length === 0 && ttsModelRandomVoice(model)) {
    return { model: base.ttsModel, voice: base.ttsVoice }
  }
  return { model, voice }
}

function serializeSettings(value: PetSettings): string {
  return `${SETTINGS_HEADER}\n${JSON.stringify({ ...value, version: SETTINGS_SCHEMA_VERSION }, null, 2)}\n`
}

const MAX_FPS_OPTIONS = [30, 60, 0] as const

function clampSize(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  return clampInt(n, 40, 40, 400)
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
  // 数值边界统一走 clamp.ts（此前这里手写了 6 份几乎相同的 clamp）
  const clampPad = (value: unknown, fallback: number): number => clampInt(value, fallback, 0, 300)
  const clampHome = (value: unknown, fallback: number): number => clampInt(value, fallback, 0, 100)
  const clampOffset = (value: unknown, fallback: number): number => clampInt(value, fallback, -1000, 1000)
  const color = (value: unknown, fallback: string): string => {
    const text = typeof value === 'string' ? value.trim() : ''
    return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback
  }
  /** 气泡最长显示秒数：0–600，0 = 不限。 */
  const clampBubbleMax = (value: unknown, fallback: number): number => clampInt(value, fallback, 0, 600)
  const opacity = (value: unknown, fallback: number): number => clampInt(value, fallback, 0, 100)
  // 旧版本迁移：
  // - v1（无 version）：home 语义是「画布右下角距右/距下」；
  // - v2：home 是 px 的「中心点距右/距下」；
  // 两种旧值都无法直接换算成 v3 的视口百分比（旧值依赖当时的窗口尺寸），一律回退 base 默认值。
  // - bubbleOffsetY 在 v3 前是「负值向上」，与新版正好相反，值取反即可保持观感不变。
  const version = typeof record.version === 'number' ? record.version : 0
  const legacyHome = version < HOME_PERCENT_VERSION
  const offsetYRaw = record.bubbleOffsetY
  const offsetY = version < HOME_PERCENT_VERSION && typeof offsetYRaw === 'number' ? -offsetYRaw : offsetYRaw
  // v5 起默认语音模型换成「音色可固定」的 MAI-Voice：旧文件里若还是「随机音色模型 + 没选音色」
  // 就自动迁移过去，否则每句话的人声都不一样（ADR-033 修订）。
  const voiceFix = migrateTtsVoice(version, record.ttsModel, record.ttsVoice, base)
  // v8 起 ADR-037：旧字段（aiTouchOnly/aiTakeover/interactionMode/thinking*/waiting*）在返回对象里
  // 根本没有位置，天然作废；eventTriggers 允许部分写入，缺的键按默认（开）补齐。
  const eventTriggers = normalizeEventTriggers(record.eventTriggers)
  const eventTexts = normalizeEventTexts(record.eventTexts)
  const motionTexts = normalizeMotionTexts(record.motionTexts)
  const expressionTexts = normalizeExpressionTexts(record.expressionTexts)
  const motionEnabled = normalizeMotionEnabled(record.motionEnabled)
  const expressionEnabled = normalizeExpressionEnabled(record.expressionEnabled)
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
    bubbleMaxSeconds: clampBubbleMax(record.bubbleMaxSeconds, base.bubbleMaxSeconds),
    aiEnabled: bool('aiEnabled'),
    idleMotionEnabled: bool('idleMotionEnabled'),
    aiProvider: pickString(record.aiProvider) ?? base.aiProvider,
    aiModel: pickString(record.aiModel) ?? base.aiModel,
    aiHistoryCount: clampInt(record.aiHistoryCount, base.aiHistoryCount, AI_HISTORY_LIMITS.min, AI_HISTORY_LIMITS.max),
    aiMemoryCount: clampInt(record.aiMemoryCount, base.aiMemoryCount, AI_MEMORY_LIMITS.min, AI_MEMORY_LIMITS.max),
    triggerMode: normalizeTriggerMode(record.triggerMode, base.triggerMode),
    aiMinIntervalSec: clampInt(record.aiMinIntervalSec, base.aiMinIntervalSec, AI_MIN_INTERVAL_LIMITS.min, AI_MIN_INTERVAL_LIMITS.max),
    idleTimeoutSec: clampInt(record.idleTimeoutSec, base.idleTimeoutSec, IDLE_TIMEOUT_LIMITS.min, IDLE_TIMEOUT_LIMITS.max),
    activityWindowSec: clampInt(record.activityWindowSec, base.activityWindowSec, ACTIVITY_WINDOW_LIMITS.min, ACTIVITY_WINDOW_LIMITS.max),
    tapGapMs: clampInt(record.tapGapMs, base.tapGapMs, TAP_GAP_LIMITS.min, TAP_GAP_LIMITS.max),
    mergeMax: clampInt(record.mergeMax, base.mergeMax, MERGE_MAX_LIMITS.min, MERGE_MAX_LIMITS.max),
    eventTriggers: version >= SETTINGS_SCHEMA_VERSION ? eventTriggers : defaultEventTriggers(),
    eventTexts,
    motionTexts,
    expressionTexts,
    motionEnabled,
    expressionEnabled,
    barPosition: normalizeBarPosition(record.barPosition, base.barPosition),
    barOffset: clampInt(record.barOffset, base.barOffset, BAR_OFFSET_LIMITS.min, BAR_OFFSET_LIMITS.max),
    barAutoHideSec: clampInt(record.barAutoHideSec, base.barAutoHideSec, BAR_AUTO_HIDE_LIMITS.min, BAR_AUTO_HIDE_LIMITS.max),
    ttsEnabled: bool('ttsEnabled'),
    ttsModel: voiceFix.model,
    // 音色允许空串（空 = 模型默认音色），所以不走 pickString
    ttsVoice: voiceFix.voice,
    lipsyncEnabled: bool('lipsyncEnabled'),
    lipsyncGain: normalizeLipsyncGain(record.lipsyncGain, base.lipsyncGain),
    focusRange: normalizeFocusRange(record.focusRange, base.focusRange),
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
  /** 上次解析对应的文件时间戳（`mtimeMs:size`）：文件没变就直接复用，不再读盘 + 解析。 */
  private lastStamp: string | null = null

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

  /** 现读设置（文件损坏时沿用上一份好结果，错误写进 view；文件没变则复用上次解析）。 */
  get(): PetSettings {
    const stamp = fileStamp(this.path)
    if (stamp !== null && stamp === this.lastStamp) return { ...this.lastGood }
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
    this.lastStamp = stamp
    return { ...this.lastGood }
  }

  /** 设置页读取视图。 */
  view(): PetSettingsView {
    const value = this.get()
    return { value, error: this.lastError, path: this.path, writable: true }
  }

  /**
   * 应用设置页的 path 操作（`{op:'set',path:['size'],value}` / `{op:'unset'}`）。
   * 标量键沿用「一层路径」规则；`eventTriggers` 支持 `['eventTriggers','tool-read']` 二层路径
   * （单个事件开关），也支持 `['eventTriggers']` 整体写入（normalizeSettings 会补齐缺省键）。
   */
  applyOps(ops: readonly SettingsPathOp[]): PetSettingsView {
    const current = this.get()
    // 带上 schema 版本，避免写入路径被「旧版 home 语义迁移」误判
    let next: Record<string, unknown> = { ...current, version: SETTINGS_SCHEMA_VERSION }
    for (const op of ops) {
      if (!Array.isArray(op.path) || op.path.length === 0) continue
      const key = op.path[0]
      if (typeof key !== 'string' || !(key in current)) continue
      if (op.op === 'unset') {
        if (op.path.length === 1) {
          delete next[key]
          continue
        }
        // 二层路径：只删表里的那一项（`['eventTexts','tool-read']`），别把整张表删掉
        const table = next[key]
        if (op.path.length === 2 && typeof op.path[1] === 'string' && table !== null && typeof table === 'object' && !Array.isArray(table)) {
          const copy = { ...(table as Record<string, unknown>) }
          delete copy[op.path[1]]
          next[key] = copy
        }
        continue
      }
      if (key === 'eventTriggers') {
        // 二层路径：单个事件开关
        if (op.path.length === 2 && typeof op.path[1] === 'string') {
          const eventKey = op.path[1]
          const triggers = { ...(next.eventTriggers as Record<string, boolean>) }
          triggers[eventKey] = op.value === true
          next.eventTriggers = triggers
        } else if (op.path.length === 1) {
          next.eventTriggers = op.value
        }
        continue
      }
      if (key === 'motionEnabled' || key === 'expressionEnabled') {
        // 二层路径：单个动作/表情的可用性（布尔；true 写回表格，false 也显式记下）
        if (op.path.length === 2 && typeof op.path[1] === 'string') {
          const catalogId = op.path[1]
          const field = key === 'motionEnabled' ? 'motionEnabled' : 'expressionEnabled'
          const flags = { ...(next[field] as Record<string, boolean>) }
          flags[catalogId] = op.value === true
          next[field] = flags
        } else if (op.path.length === 1) {
          next[key] = op.value
        }
        continue
      }
      if (key === 'motionTexts' || key === 'expressionTexts') {
        // 二层路径：单个动作/表情的释义（空串 = 删掉覆写，回到内置释义）
        if (op.path.length === 2 && typeof op.path[1] === 'string') {
          const catalogId = op.path[1]
          const field = key === 'motionTexts' ? 'motionTexts' : 'expressionTexts'
          const texts = { ...(next[field] as Record<string, string>) }
          const text = typeof op.value === 'string' ? op.value.replace(/\s+/g, ' ').trim().slice(0, CATALOG_TEXT_MAX) : ''
          if (text.length > 0) texts[catalogId] = text
          else delete texts[catalogId]
          next[field] = texts
        } else if (op.path.length === 1) {
          next[key] = op.value
        }
        continue
      }
      if (key === 'eventTexts') {
        // 二层路径：单个事件文案（空串 = 删掉覆写，回到内置文案）
        if (op.path.length === 2 && typeof op.path[1] === 'string') {
          const eventKey = op.path[1]
          const texts = { ...(next.eventTexts as Record<string, string>) }
          const text = typeof op.value === 'string' ? op.value.replace(/\s+/g, ' ').trim().slice(0, EVENT_TEXT_MAX) : ''
          if (text.length > 0) texts[eventKey] = text
          else delete texts[eventKey]
          next.eventTexts = texts
        } else if (op.path.length === 1) {
          next.eventTexts = op.value
        }
        continue
      }
      if (op.path.length !== 1) continue
      next[key] = op.value
    }
    this.lastGood = normalizeSettings(next, this.base)
    try {
      writeFileSync(this.path, serializeSettings(this.lastGood), 'utf8')
      this.lastError = null
      // 自己写完立刻失效：下次 get() 按新时间戳重新解析（size 可能不变，mtime 会变）
      this.lastStamp = null
    } catch (error) {
      this.lastError = `写入失败 ${this.path}：${error instanceof Error ? error.message : String(error)}`
    }
    return this.view()
  }
}
