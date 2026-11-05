/**
 * 插件默认值的**唯一来源**（ADR-013：Config schema 只作为 base 层，用户改动落插件私有设置文件）。
 *
 * 之前默认值散在 5 处（Config schema、设置页 DEFAULT_VALUE、客户端兜底常量、
 * persist.DEFAULT_DISPLAY、内置 preset），改一个忘一个就会出现「设置页显示 240、实际渲染 160」。
 * 现在统一在这里定义，其余地方只引用；`defaults.test.ts` 校验 schema 与常量的取值一致。
 * @module dsh-waifu/defaults
 */

import { clampInt } from './clamp.ts'

/** 显示/位置持久化默认值（`$DSH_HOME/waifu.json`，px 相对视口右下角）。 */
export const DEFAULT_DISPLAY = { right: 24, bottom: 20, size: 240 } as const

/** 冷启动/快照缺字段时的渲染兜底常量。 */
export const DEFAULT_CANVAS_PAD_X = 125
export const DEFAULT_CANVAS_PAD_Y = 50
export const DEFAULT_HOME_RIGHT = 15
export const DEFAULT_HOME_BOTTOM = 24
export const DEFAULT_BUBBLE_OFFSET_X = 0
export const DEFAULT_BUBBLE_OFFSET_Y = -15
export const DEFAULT_BUBBLE_BG_COLOR = '#ffffff'
export const DEFAULT_BUBBLE_BG_OPACITY = 92
export const DEFAULT_BUBBLE_TEXT_COLOR = '#222222'
/** 气泡最长连续可见时长（秒；0 = 不限，ADR-027）。 */
export const DEFAULT_BUBBLE_MAX_SECONDS = 30
/** 渲染帧率档（30 / 60 / 0=不限制）。 */
export const DEFAULT_MAX_FPS = 30
/** 默认模型 id（与内置 preset 目录一致）。 */
export const DEFAULT_MODEL_ID = 'jian'
/** AI 回复默认路由（DSH 已配置的 provider / 模型，ADR-025）。 */
export const DEFAULT_AI_PROVIDER = 'deepseek-official'
export const DEFAULT_AI_MODEL = 'deepseek-flash'
/** 注入到 prompt 的最近对话条数（0 = 不注入；ADR-030）。 */
export const DEFAULT_AI_HISTORY = 10

/** 注入历史条数的边界（条 = 一条消息；0 = 不注入）。 */
export const AI_HISTORY_LIMITS = { min: 0, max: 50 } as const

/** 归一化注入条数：0–50 的整数，非法值回退默认（Host 归一化与设置页输入共用）。 */
export function normalizeHistoryCount(value: unknown, fallback: number): number {
  return clampInt(value, fallback, AI_HISTORY_LIMITS.min, AI_HISTORY_LIMITS.max)
}

/**
 * 打断优先级（ADR-032）：状态事件与触摸互动抢占同一套「气泡 + 动作 + AI 演绎」通道时的规则。
 * - `mutual`：互相打断——触摸立刻接管，状态一变也立刻收回；
 * - `touch-first`：触摸优先——触摸期间状态事件不改气泡、不恢复演绎（默认）；
 * - `event-first`：事件优先——长状态演绎不被触摸打断，触摸只播动作/表情与 AI 台词。
 */
export const INTERACTION_MODES = ['mutual', 'touch-first', 'event-first'] as const
export type InteractionMode = (typeof INTERACTION_MODES)[number]
export const DEFAULT_INTERACTION_MODE: InteractionMode = 'touch-first'

/** 归一化打断优先级：未知值回退默认。 */
export function normalizeInteractionMode(value: unknown, fallback: InteractionMode): InteractionMode {
  return INTERACTION_MODES.includes(value as InteractionMode) ? (value as InteractionMode) : fallback
}

/**
 * 标量设置默认值（除 `model`：模型 id 由内置 preset 目录动态决定）。
 * 与 `Config` schema 的 `.default()`、设置页 `DEFAULT_VALUE` 保持逐项一致。
 */
export const DEFAULT_SETTINGS = {
  enabled: true,
  size: DEFAULT_DISPLAY.size,
  maxFps: DEFAULT_MAX_FPS,
  developerMode: true,
  debug: false,
  showTapZones: false,
  canvasPadX: DEFAULT_CANVAS_PAD_X,
  canvasPadY: DEFAULT_CANVAS_PAD_Y,
  homeRight: DEFAULT_HOME_RIGHT,
  homeBottom: DEFAULT_HOME_BOTTOM,
  bubbleOffsetX: DEFAULT_BUBBLE_OFFSET_X,
  bubbleOffsetY: DEFAULT_BUBBLE_OFFSET_Y,
  bubbleBgColor: DEFAULT_BUBBLE_BG_COLOR,
  bubbleBgOpacity: DEFAULT_BUBBLE_BG_OPACITY,
  bubbleMaxSeconds: DEFAULT_BUBBLE_MAX_SECONDS,
  bubbleTextColor: DEFAULT_BUBBLE_TEXT_COLOR,
  aiEnabled: true,
  aiTouchOnly: false,
  /** 全 AI 接管：不显示任何预置对白，气泡全靠模型；长状态延迟失效、入态即请求（ADR-031）。 */
  aiTakeover: false,
  aiProvider: DEFAULT_AI_PROVIDER,
  aiModel: DEFAULT_AI_MODEL,
  aiHistoryCount: DEFAULT_AI_HISTORY,
  interactionMode: DEFAULT_INTERACTION_MODE,
} as const
