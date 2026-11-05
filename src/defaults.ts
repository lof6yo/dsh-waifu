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
 * 选型依据（2026-11 实测）：只列「音色可固定」的模型；Drama 3 没有 `supported_voices`，
 * 每次请求都会换人声，所以单独列出来并标注「音色每次随机」。
 */
export const TTS_MODELS: TtsModelOption[] = [
  {
    id: 'microsoft/mai-voice-2.1-flash',
    label: '微软 MAI-Voice 2.1 Flash（音色固定）',
    voices: [
      { id: 'zh-CN-Mei:MAI-Voice-2.1-Flash', label: 'Mei（中文·女）' },
      { id: 'zh-CN-Lan:MAI-Voice-2.1-Flash', label: 'Lan（中文·女）' },
      { id: 'zh-CN-Wei:MAI-Voice-2.1-Flash', label: 'Wei（中文·男）' },
      { id: 'zh-CN-Bo:MAI-Voice-2.1-Flash', label: 'Bo（中文·男）' },
      { id: 'en-US-Iris:MAI-Voice-2.1-Flash', label: 'Iris（英文·女）' },
    ],
  },
  {
    id: 'qwen/qwen-audio-3.0-tts-plus',
    label: '通义千问 TTS Plus（音色固定）',
    voices: [
      { id: 'longanlingxin', label: '龙安灵心（中文·女）' },
      { id: 'longanlufeng', label: '龙安陆风（中文·男）' },
    ],
  },
  {
    id: 'hexgrad/kokoro-82m',
    label: 'Kokoro 82M（最便宜，音色固定）',
    voices: [
      { id: 'zf_xiaoxiao', label: '晓晓（中文·女）' },
      { id: 'zf_xiaoyi', label: '晓伊（中文·女）' },
      { id: 'zf_xiaobei', label: '晓北（中文·女）' },
      { id: 'zm_yunxi', label: '云希（中文·男）' },
      { id: 'af_heart', label: 'Heart（英文·女）' },
    ],
  },
  {
    id: 'fish-audio/drama-3',
    label: 'Fish Audio Drama 3（表演力强，音色每次随机）',
    voices: [],
    randomVoice: true,
  },
]

/** 默认 TTS 模型：微软 MAI-Voice 2.1 Flash —— 音色可固定，中文自然。 */
export const DEFAULT_TTS_MODEL = 'microsoft/mai-voice-2.1-flash'
/** 默认音色（空 = 用模型默认音色；随机音色的模型必须留空）。 */
export const DEFAULT_TTS_VOICE = 'zh-CN-Mei:MAI-Voice-2.1-Flash'

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
/** 演绎指令：Fish Audio 会把它拼进文本开头当作语气提示。 */
export const DEFAULT_TTS_INSTRUCTIONS = '年轻女性，语气自然，带点得意和小脾气'
/** 口型跟随（按正在播放的音频能量驱动 `ParamMouthOpenY`）。 */
export const DEFAULT_LIPSYNC_ENABLED = true
/** 口型强度（百分比；100 = 标准，0 = 不张嘴）。 */
export const DEFAULT_LIPSYNC_GAIN = 100
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
  ttsEnabled: DEFAULT_TTS_ENABLED,
  ttsEngine: DEFAULT_TTS_ENGINE,
  ttsModel: DEFAULT_TTS_MODEL,
  ttsVoice: DEFAULT_TTS_VOICE,
  ttsInstructions: DEFAULT_TTS_INSTRUCTIONS,
  lipsyncEnabled: DEFAULT_LIPSYNC_ENABLED,
  lipsyncGain: DEFAULT_LIPSYNC_GAIN,
} as const
