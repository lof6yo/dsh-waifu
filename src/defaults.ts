/**
 * 插件默认值的**唯一来源**（ADR-013：Config schema 只作为 base 层，用户改动落插件私有设置文件）。
 *
 * 之前默认值散在 5 处（Config schema、设置页 DEFAULT_VALUE、客户端兜底常量、
 * persist.DEFAULT_DISPLAY、内置 preset），改一个忘一个就会出现「设置页显示 240、实际渲染 160」。
 * 现在统一在这里定义，其余地方只引用；`defaults.test.ts` 校验 schema 与常量的取值一致。
 *
 * 全 AI 驱动（ADR-037）的新设置也在这里：触发频率策略 / 最小间隔 / 静默超时 /
 * 场景触发开关 / 同类事件窗口 / 记忆注入条数。
 * @module dsh-waifu/defaults
 */

import { clampInt } from './clamp.ts'
import { ACTIVITY_EVENTS, AI_MOTION_IDS, ANIMATION_SLOTS, EXPRESSION_IDS, type PetEventKey } from './models.ts'

/** 显示/位置持久化默认值（`$DSH_HOME/waifu.json`，px 相对视口右下角）。 */
export const DEFAULT_DISPLAY = { right: 10, bottom: 0, size: 280 } as const

/** 冷启动/快照缺字段时的渲染兜底常量。 */
export const DEFAULT_CANVAS_PAD_X = 125
export const DEFAULT_CANVAS_PAD_Y = 50
export const DEFAULT_HOME_RIGHT = 10
export const DEFAULT_HOME_BOTTOM = 0
export const DEFAULT_BUBBLE_OFFSET_X = 0
export const DEFAULT_BUBBLE_OFFSET_Y = 24
export const DEFAULT_BUBBLE_BG_COLOR = '#ffffff'
export const DEFAULT_BUBBLE_BG_OPACITY = 92
export const DEFAULT_BUBBLE_TEXT_COLOR = '#222222'
/** 气泡最长连续可见时长（秒；0 = 不限，ADR-027）。 */
export const DEFAULT_BUBBLE_MAX_SECONDS = 10
/** 渲染帧率档（30 / 60 / 0=不限制）。 */
export const DEFAULT_MAX_FPS = 30
/** 默认模型 id（与内置 preset 目录一致）。 */
export const DEFAULT_MODEL_ID = 'jian'
/** AI 回复默认路由（DSH 已配置的 provider / 模型，ADR-025）。 */
export const DEFAULT_AI_PROVIDER = 'openrouter'
export const DEFAULT_AI_MODEL = 'google/gemma-4-31b-it'
/** 注入的最近对话轮数（1 轮 = 用户一句 + 桌宠一句；0 = 不注入；ADR-030）。 */
export const DEFAULT_AI_HISTORY = 20
/** 注入的记忆条数（memory.md 最近 N 条；0 = 不注入；ADR-037）。 */
export const DEFAULT_AI_MEMORY = 20

/**
 * 触发频率策略（ADR-037）：
 * - `interrupt`：截断抢占——新触发直接掐掉上一轮（说话/语音立刻断，动作表情立刻换）；
 * - `queue`：排队等完成——上一轮「气泡出完 + 语音念完」后才处理下一条（只留最新一条，
 *   等待期间到达的事件合并进下一条的场景里）。
 */
export const TRIGGER_MODES = ['interrupt', 'queue'] as const
export type TriggerMode = (typeof TRIGGER_MODES)[number]
export const DEFAULT_TRIGGER_MODE: TriggerMode = 'queue'

/** 归一化触发频率策略：未知值回退默认。 */
export function normalizeTriggerMode(value: unknown, fallback: TriggerMode): TriggerMode {
  return TRIGGER_MODES.includes(value as TriggerMode) ? (value as TriggerMode) : fallback
}

/** 事件类触发的最小间隔（秒）：上一次 AI 反应开始后多久内不再因 DSH 事件触发；触摸/对话不受限。 */
export const DEFAULT_AI_MIN_INTERVAL_SEC = 1
export const AI_MIN_INTERVAL_LIMITS = { min: 0, max: 600 } as const

/** 静默超时（秒）：多久没有任何事件/互动就自动触发一轮；0 = 关闭。 */
export const DEFAULT_IDLE_TIMEOUT_SEC = 600
export const IDLE_TIMEOUT_LIMITS = { min: 0, max: 3600 } as const

/** 同类事件触发窗口（秒，Host 节流）：窗口内同类活动只触发一次。 */
export const DEFAULT_ACTIVITY_WINDOW_SEC = 10
export const ACTIVITY_WINDOW_LIMITS = { min: 0, max: 300 } as const

/** 场景开关表（Record 形式持久化在 settings.jsonc）。 */
export type EventTriggers = Record<string, boolean>

/** 可触发场景目录（设置页勾选；`idle` 是静息态不算触发键）。 */
export const TRIGGER_EVENTS: readonly PetEventKey[] = [...ANIMATION_SLOTS.slice(1), ...ACTIVITY_EVENTS]

/** 触发场景中文名（设置页开关列表与调试面板场景演示共用）。 */
export const TRIGGER_EVENT_LABELS: Readonly<Record<string, string>> = {
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

/** 默认关闭的场景（工具调用类噪音大、会话结束/子代理与桌面宠物关系远；可在设置页打开）。 */
const TRIGGER_EVENTS_OFF: readonly string[] = [
  'tool-read',
  'tool-write',
  'tool-run',
  'tool-agent',
  'tool-other',
  'session-close',
  'subagent-start',
  'subagent-end',
]

/** 默认场景开关（Record 形式持久化在 settings.jsonc）：除 TRIGGER_EVENTS_OFF 外全开。 */
export function defaultEventTriggers(): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const key of TRIGGER_EVENTS) out[key] = !TRIGGER_EVENTS_OFF.includes(key)
  return out
}

/** 事件键 → 内置场景文案（ADR-039：用户可在设置页覆写，空 = 用这里的）。 */
export const DEFAULT_EVENT_TEXTS: Readonly<Record<string, string>> = {
  thinking: '你正在思考',
  error: '运行出错了',
  done: '你完成了任务',
  waiting: '你要等主人确认',
  delivered: '你交付了成果',
  'tool-read': '主人让你看东西，你正翻着资料',
  'tool-write': '主人让你写/改东西，你刚动完笔',
  'tool-run': '主人让你跑命令，你刚按下回车',
  'tool-agent': '主人派你去办事，你正准备出发',
  'tool-other': '主人让你用了件别的工具，你顺手做了',
  'approval-granted': '主人刚刚批准了你的请求',
  'approval-denied': '主人刚刚拒绝了你的请求',
  'session-open': '主人刚开了一个新会话，才见到你',
  'session-close': '这轮会话结束了，主人要走了',
  'subagent-start': '你的分身刚被派出去干活',
  'subagent-end': '你的分身干完活回来了',
}

/** 事件文案的字符上限（设置页输入框与归一化共用）。 */
export const EVENT_TEXT_MAX = 60

/** 归一化事件文案：只留已知事件键、压空白、截断；空串 = 用内置文案。 */
export function normalizeEventTexts(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const record = raw as Record<string, unknown>
  for (const key of TRIGGER_EVENTS) {
    const value = record[key]
    if (typeof value !== 'string') continue
    const text = value.replace(/\s+/g, ' ').trim().slice(0, EVENT_TEXT_MAX)
    if (text.length > 0) out[key] = text
  }
  return out
}

/** 动作/表情给模型的释义：字符上限（设置页输入框与归一化共用）。 */
export const CATALOG_TEXT_MAX = 80

/** 归一化「动作是否发给模型」：只留目录内 id，缺省为 true（默认全部可选）。 */
export function normalizeMotionEnabled(raw: unknown): Record<string, boolean> {
  return normalizeCatalogEnabled(raw, AI_MOTION_IDS)
}

/** 归一化「表情是否发给模型」：只留目录内 id（不含 none），缺省为 true。 */
export function normalizeExpressionEnabled(raw: unknown): Record<string, boolean> {
  return normalizeCatalogEnabled(raw, EXPRESSION_IDS.filter((id) => id !== 'none'))
}

function normalizeCatalogEnabled(raw: unknown, ids: readonly string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const record = raw as Record<string, unknown>
  for (const id of ids) {
    if (typeof record[id] === 'boolean') out[id] = record[id]
  }
  return out
}

/** 归一化「动作释义覆写」：只留目录内 id、压空白、截断；空串 = 用内置释义。 */
export function normalizeMotionTexts(raw: unknown): Record<string, string> {
  return normalizeCatalogTexts(raw, AI_MOTION_IDS)
}

/** 归一化「表情释义覆写」：只留目录内 id（不含 none）、压空白、截断；空串 = 用内置释义。 */
export function normalizeExpressionTexts(raw: unknown): Record<string, string> {
  return normalizeCatalogTexts(raw, EXPRESSION_IDS)
}

function normalizeCatalogTexts(raw: unknown, ids: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const record = raw as Record<string, unknown>
  for (const id of ids) {
    const value = record[id]
    if (typeof value !== 'string') continue
    const text = value.replace(/\s+/g, ' ').trim().slice(0, CATALOG_TEXT_MAX)
    if (text.length > 0) out[id] = text
  }
  return out
}

/** 归一化场景开关：未知键忽略；缺失的键补 true（新场景默认开）。 */
export function normalizeEventTriggers(raw: unknown): Record<string, boolean> {
  const out = defaultEventTriggers()
  if (typeof raw !== 'object' || raw === null) return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'boolean' && key in out) out[key] = value
  }
  return out
}

/** 语音合成（TTS，ADR-033）：默认引擎 = OpenRouter 的 `/api/v1/audio/speech`。 */
export const DEFAULT_TTS_ENABLED = true
/** 引擎 id（目前只有 openrouter；留给将来直连 ElevenLabs / MiniMax 的实现）。 */
export const DEFAULT_TTS_ENGINE = 'openrouter'
/** 候选音色：`id` 直接透传给 `/audio/speech` 的 `voice` 字段。 */
export interface TtsVoiceOption {
  id: string
  label: string
}

/** 设置页可选的语音模型（ADR-033 修订）。 */
export interface TtsModelOption {
  id: string
  label: string
  /** 模型自带的固定音色；空数组表示该模型每次合成都会随机挑一个音色。 */
  voices: TtsVoiceOption[]
  /** 是否每次随机音色（例如 Drama 3 这种「表演模型」）。 */
  randomVoice?: boolean
}

/**
 * 语音模型目录：Host 校验与设置页下拉共用同一份。
 * 只列 OpenRouter 上「音色固定、且是女声」的两个通义千问 TTS 模型（2026-11 实测）：
 * `voice` 直接透传音色参数（如 `longanlingxin`），按模型区分，跨模型使用会被供应商拒 400。
 * 音色来源：https://platform.qianwenai.com/docs/developer-guides/speech/voice-list/qwen-audio-tts
 * （只取「性别：女」的条目；龙泡泡是 5 岁儿童音、loongmary/loongeva 是英文音，排在最后）。
 */
export const TTS_MODELS: TtsModelOption[] = [
  {
    id: 'qwen/qwen-audio-3.0-tts-plus',
    label: '通义千问 TTS Plus（旗舰音色，支持指令控制）',
    voices: [{ id: 'longanlingxin', label: '龙安灵心（25 岁·知心温暖）' }],
  },
  {
    id: 'qwen/qwen-audio-3.0-tts-flash',
    label: '通义千问 TTS Flash（女声最多，便宜）',
    voices: [
      { id: 'longanyuanfei', label: '龙安元妃（30 岁·高傲妃子）' },
      { id: 'longanfengyue', label: '龙安风悦（30 岁·自然亲切）' },
      { id: 'longanlingxi', label: '龙安灵希（25 岁·可爱甜美）' },
      { id: 'longanxiaoxin', label: '龙安小昕（22 岁·亲切活泼）' },
      { id: 'longanhuan_v3.6', label: '龙安欢（25 岁·活泼）' },
      { id: 'longpaopao_v3.6', label: '龙泡泡（儿童·软糯可爱）' },
      { id: 'loongmary', label: 'loongmary（20 岁·英式英语）' },
      { id: 'loongeva_v3.6', label: 'loongeva（28 岁·美式英语）' },
    ],
  },
]

/** 默认 TTS 模型：通义千问 TTS Flash（女声最多、便宜）。 */
export const DEFAULT_TTS_MODEL = 'qwen/qwen-audio-3.0-tts-flash'
/** 默认音色：Flash 的「龙安灵希」（25 岁·可爱甜美）。 */
export const DEFAULT_TTS_VOICE = 'longanlingxi'
/** 按 id 查模型选项。 */
export function ttsModelOption(id: string): TtsModelOption | undefined {
  return TTS_MODELS.find((item) => item.id === id)
}

/** 该模型是否每次随机音色。 */
export function ttsModelRandomVoice(id: string): boolean {
  return ttsModelOption(id)?.randomVoice === true
}

/** 模型的首个音色（随机音色模型返回空串）。 */
export function ttsDefaultVoice(model: string): string {
  const option = ttsModelOption(model)
  return option && !option.randomVoice ? (option.voices[0]?.id ?? '') : ''
}
/** 口型跟随（按正在播放的音频能量驱动 `ParamMouthOpenY`）。 */
export const DEFAULT_LIPSYNC_ENABLED = true
/** 口型强度（百分比；100 = 标准，0 = 不张嘴）。 */
export const DEFAULT_LIPSYNC_GAIN = 130

/** 鼠标跟随范围：以模型包围盒为基准向外扩展的百分比（0 = 只在模型框内跟随）。 */
export const DEFAULT_FOCUS_RANGE = 100

export const FOCUS_RANGE_LIMITS = { min: 0, max: 300 } as const

/** 跟随范围归一化：整数百分比，越界夹取，非法回落。 */
export function normalizeFocusRange(value: unknown, fallback: number): number {
  return clampInt(value, fallback, FOCUS_RANGE_LIMITS.min, FOCUS_RANGE_LIMITS.max)
}
/** 口型强度边界。 */
export const LIPSYNC_GAIN_LIMITS = { min: 0, max: 300 } as const

/** 归一化口型强度：0–300 的整数，非法值回退默认。 */
export function normalizeLipsyncGain(value: unknown, fallback: number): number {
  return clampInt(value, fallback, LIPSYNC_GAIN_LIMITS.min, LIPSYNC_GAIN_LIMITS.max)
}

/** 注入历史条数的边界（条 = 一条消息；0 = 不注入）。 */
export const AI_HISTORY_LIMITS = { min: 0, max: 50 } as const

/** 归一化注入条数：0–50 的整数，非法值回退默认（Host 归一化与设置页输入共用）。 */
export function normalizeHistoryCount(value: unknown, fallback: number): number {
  return clampInt(value, fallback, AI_HISTORY_LIMITS.min, AI_HISTORY_LIMITS.max)
}

/** 注入记忆条数的边界（0 = 不注入）。 */
export const AI_MEMORY_LIMITS = { min: 0, max: 100 } as const

/** 归一化注入记忆条数。 */
export function normalizeMemoryCount(value: unknown, fallback: number): number {
  return clampInt(value, fallback, AI_MEMORY_LIMITS.min, AI_MEMORY_LIMITS.max)
}

/** 交互条（模型上方/下方的静音按钮 + 对话输入框）的位置：上方 `top` / 下方 `bottom`。 */
export const BAR_POSITIONS = ['top', 'bottom', 'hidden'] as const
/** `hidden` = 不显示交互条（只留模型本体）。 */
export type BarPosition = (typeof BAR_POSITIONS)[number]
export const DEFAULT_BAR_POSITION: BarPosition = 'top'
/** 交互条沿「吸附边」的额外偏移（px，正数 = 远离模型；默认 0）。 */
export const DEFAULT_BAR_OFFSET = -30
export const BAR_OFFSET_LIMITS = { min: -200, max: 200 } as const

/** 归一化交互条位置：未知值回退默认。 */
export function normalizeBarPosition(value: unknown, fallback: BarPosition): BarPosition {
  return BAR_POSITIONS.includes(value as BarPosition) ? (value as BarPosition) : fallback
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
  debug: true,
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
  /** AI 总开关（ADR-037：关掉 = 角色完全静默，只剩物理反应）。 */
  aiEnabled: true,
  aiProvider: DEFAULT_AI_PROVIDER,
  aiModel: DEFAULT_AI_MODEL,
  aiHistoryCount: DEFAULT_AI_HISTORY,
  aiMemoryCount: DEFAULT_AI_MEMORY,
  /** 触发频率策略（截断抢占 / 排队等完成）。 */
  triggerMode: DEFAULT_TRIGGER_MODE,
  /** 事件类触发的最小间隔（秒；触摸/对话不受限）。 */
  aiMinIntervalSec: DEFAULT_AI_MIN_INTERVAL_SEC,
  /** 静默超时（秒；0 = 关闭）。 */
  idleTimeoutSec: DEFAULT_IDLE_TIMEOUT_SEC,
  /** 同类事件触发窗口（秒）。 */
  activityWindowSec: DEFAULT_ACTIVITY_WINDOW_SEC,
  /** 按事件类型的触发开关（v8 起持久化；normalizeSettings 会补全键）。 */
  eventTriggers: defaultEventTriggers(),
  /** 事件文案覆写（空 = 用内置文案；键为事件键）。 */
  eventTexts: {} as Record<string, string>,
  /** 动作释义覆写（空 = 用内置释义；键为动作 id）。 */
  motionTexts: {} as Record<string, string>,
  /** 表情释义覆写（空 = 用内置释义；键为表情 id）。 */
  expressionTexts: {} as Record<string, string>,
  /** 动作是否发给模型供选择（缺省 = 全开；false = 不列进提示词、也不接受该标签）。 */
  motionEnabled: {} as Record<string, boolean>,
  /** 表情是否发给模型供选择（缺省 = 全开；`blood` 羞愤默认不给）。 */
  expressionEnabled: { blood: false } as Record<string, boolean>,
  /** 待机小动作（偶尔偏头/抬眉/换重心/叹气），关掉后只有 Idle 循环。 */
  idleMotionEnabled: true,
  /** 交互条：模型上下的静音按钮 + 对话输入框。 */
  barPosition: DEFAULT_BAR_POSITION,
  barOffset: DEFAULT_BAR_OFFSET,
  ttsEnabled: DEFAULT_TTS_ENABLED,
  ttsEngine: DEFAULT_TTS_ENGINE,
  ttsModel: DEFAULT_TTS_MODEL,
  ttsVoice: DEFAULT_TTS_VOICE,
  lipsyncEnabled: DEFAULT_LIPSYNC_ENABLED,
  lipsyncGain: DEFAULT_LIPSYNC_GAIN,
  focusRange: DEFAULT_FOCUS_RANGE,
} as const
