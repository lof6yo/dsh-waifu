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
export const DEFAULT_DISPLAY = { right: 24, bottom: 20, size: 300 } as const

/** 冷启动/快照缺字段时的渲染兜底常量。 */
export const DEFAULT_CANVAS_PAD_X = 125
export const DEFAULT_CANVAS_PAD_Y = 50
export const DEFAULT_HOME_RIGHT = 12
export const DEFAULT_HOME_BOTTOM = 31
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
export const DEFAULT_AI_PROVIDER = 'openrouter'
export const DEFAULT_AI_MODEL = 'google/gemma-4-31b-it'
/** 注入到 prompt 的最近对话条数（0 = 不注入；ADR-030）。 */
/** 注入的最近对话轮数（1 轮 = 用户一句 + 桌宠一句）。 */
export const DEFAULT_AI_HISTORY = 20

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

/** 默认 TTS 模型：通义千问 TTS Plus（旗舰音色）。 */
export const DEFAULT_TTS_MODEL = 'qwen/qwen-audio-3.0-tts-flash'
/** 默认音色：Flash 的「龙安小昕」（22 岁·亲切活泼）。 */
export const DEFAULT_TTS_VOICE = 'longanxiaoxin'
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
export const DEFAULT_LIPSYNC_GAIN = 140
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

/**
 * 打断优先级（ADR-032）：状态事件与触摸互动抢占同一套「气泡 + 动作 + AI 演绎」通道时的规则。
 * - `mutual`：互相打断——触摸立刻接管，状态一变也立刻收回；
 * - `touch-first`：触摸优先——触摸期间状态事件不改气泡、不恢复演绎（默认）；
 * - `event-first`：事件优先——长状态演绎不被触摸打断，触摸只播动作/表情与 AI 台词。
 */
export const INTERACTION_MODES = ['mutual', 'touch-first', 'event-first'] as const
export type InteractionMode = (typeof INTERACTION_MODES)[number]
export const DEFAULT_INTERACTION_MODE: InteractionMode = 'touch-first'

/** 交互条（模型上方/下方的静音按钮 + 对话输入框）的位置：上方 `top` / 下方 `bottom`。 */
export const BAR_POSITIONS = ['top', 'bottom', 'hidden'] as const
/** `hidden` = 不显示交互条（只留模型本体）。 */
export type BarPosition = (typeof BAR_POSITIONS)[number]
export const DEFAULT_BAR_POSITION: BarPosition = 'bottom'
/** 交互条沿「吸附边」的额外偏移（px，正数 = 远离模型；默认 0）。 */
export const DEFAULT_BAR_OFFSET = 0
export const BAR_OFFSET_LIMITS = { min: -200, max: 200 } as const

/** 归一化交互条位置：未知值回退默认。 */
export function normalizeBarPosition(value: unknown, fallback: BarPosition): BarPosition {
  return BAR_POSITIONS.includes(value as BarPosition) ? (value as BarPosition) : fallback
}

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
  developerMode: false,
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
  aiTakeover: true,
  /** 待机小动作（偶尔偏头/抬眉/换重心/叹气），关掉后只有 Idle 循环。 */
  idleMotionEnabled: true,
  aiProvider: DEFAULT_AI_PROVIDER,
  aiModel: DEFAULT_AI_MODEL,
  aiHistoryCount: DEFAULT_AI_HISTORY,
  interactionMode: DEFAULT_INTERACTION_MODE,
  /** 交互条：模型上下的静音按钮 + 对话输入框。 */
  barPosition: DEFAULT_BAR_POSITION,
  barOffset: DEFAULT_BAR_OFFSET,
  ttsEnabled: DEFAULT_TTS_ENABLED,
  ttsEngine: DEFAULT_TTS_ENGINE,
  ttsModel: DEFAULT_TTS_MODEL,
  ttsVoice: DEFAULT_TTS_VOICE,
  lipsyncEnabled: DEFAULT_LIPSYNC_ENABLED,
  lipsyncGain: DEFAULT_LIPSYNC_GAIN,
} as const
