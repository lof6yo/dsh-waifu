/**
 * dsh-waifu host 半区：注册宠物服务、同源 HTTP 路由与插件私有设置。
 *
 * DSH 0.2.x 适配（ADR-013）：
 * - `ctx.settings` 已从「namespace 注册表」变成「Config schema → 设置页表单」投影，
 *   不再提供 register/get；写入会经 Loader 重新应用插件条目（整插件重载）。
 * - 因此热设置（开关/尺寸/帧率/模型/人设/开发者选项）改存插件私有
 *   `$DSH_HOME/waifu/settings.jsonc`（ADR-013），经 SSE 实时推送；
 *   Config schema 只作为默认值 base 层，并用 `settings.configure({ auto: false })`
 *   隐藏自动生成的设置页（插件自带「Waifu 设置」页）。
 * @module dsh-waifu
 */

import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import { PetService } from './service.ts'
import { DEFAULT_LONG_AI } from './models.ts'
import {
  DEFAULT_AI_HISTORY,
  DEFAULT_AI_MODEL,
  DEFAULT_AI_PROVIDER,
  BAR_OFFSET_LIMITS,
  DEFAULT_BAR_OFFSET,
  DEFAULT_BAR_POSITION,
  DEFAULT_INTERACTION_MODE,
  DEFAULT_BUBBLE_BG_COLOR,
  DEFAULT_BUBBLE_BG_OPACITY,
  DEFAULT_BUBBLE_MAX_SECONDS,
  DEFAULT_BUBBLE_OFFSET_X,
  DEFAULT_BUBBLE_OFFSET_Y,
  DEFAULT_BUBBLE_TEXT_COLOR,
  DEFAULT_CANVAS_PAD_X,
  DEFAULT_CANVAS_PAD_Y,
  DEFAULT_HOME_BOTTOM,
  DEFAULT_HOME_RIGHT,
  DEFAULT_MAX_FPS,
  DEFAULT_SETTINGS,
  FOCUS_RANGE_LIMITS,
  LIPSYNC_GAIN_LIMITS,
} from './defaults.ts'
import {
  makePetRoutes,
  petPackageRoot,
  type AiRoutesApi,
  type InteractRoutesApi,
  type SettingsRoutesApi,
  type SpeakRoutesApi,
} from './routes.ts'
import {
  AI_HISTORY_MAX_ENTRIES,
  appendHistory,
  buildSceneMessage,
  normalizeTimeZone,
  generateReply,
  loadPersona,
  streamReply,
  personaPath,
  savePersona,
  type AiHistoryEntry,
  type AiPayload,
  type ReplyContext,
} from './ai.ts'
import {
  defaultModelId,
  listBuiltinPresets,
  resolveDefaultTouchParts,
  resolveModelUrl,
  resolveMotionMap,
} from './models-host.ts'
import { SettingsStore, type PetSettings } from './settings-store.ts'
import { OPENROUTER_SPEECH_URL } from './tts.ts'
import { OpenRouterTtsEngine, type TtsAudio, type TtsPayload, type TtsVoiceOptions } from './tts.ts'
import { runSpeakPipeline } from './speak.ts'
import { TouchPartsStore } from './touch-parts.ts'

export { PetService } from './service.ts'
export type { PetState, PetStateView } from './service.ts'
export { makePetRoutes, petPackageRoot, PET_API_PREFIX, PET_ASSET_PREFIX } from './routes.ts'
// 再导出（复用上面的 import，避免同一模块被 import + export-from 各写一遍）
export { listBuiltinPresets, resolveModelUrl, resolveMotionMap, resolveDefaultTouchParts, defaultModelId }
export {
  DEFAULT_MOTION_MAP,
  DEFAULT_LONG_AI,
  LONG_AI_LIMITS,
  LONG_STATES,
  isLongState,
  ANIMATION_SLOTS,
  DEFAULT_TOUCH_PARTS,
  MAX_BOXES_PER_PART,
  hitTestTouchParts,
  normalizeTouchParts,
  normalizeTouchBox,
  pointToBoundsRatio,
} from './models.ts'
export type {
  BuiltinPreset,
  AnimationSlot,
  MotionMap,
  TouchBox,
  TouchPart,
} from './models.ts'

/** 稳定 cordis 插件名（对应 cordis.patch.yml insert id）。 */
export const name = 'dsh-waifu'

/** 渲染帧率档（spec §2/§7）：30 / 60 / 0（不限制，对应 PIXI maxFPS=0）。 */
export type MaxFpsOption = 30 | 60 | 0

/** 插件配置（cordis.patch.yml 的 config 是 base 层；用户改动落插件私有设置文件，ADR-013）。 */
export interface Config extends Omit<PetSettings, 'maxFps'> {
  /** 渲染帧率档（30 / 60 / 0=不限制；Schema 层用字面量联合校验）。 */
  maxFps: MaxFpsOption
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(DEFAULT_SETTINGS.enabled),
  size: Schema.number().min(40).max(400).default(DEFAULT_SETTINGS.size),
  maxFps: Schema.union([
    Schema.const(30),
    Schema.const(60),
    Schema.const(0),
  ]).default(DEFAULT_MAX_FPS),
  model: Schema.string().default(defaultModelId()),
  developerMode: Schema.boolean().default(DEFAULT_SETTINGS.developerMode),
  debug: Schema.boolean().default(DEFAULT_SETTINGS.debug),
  showTapZones: Schema.boolean().default(DEFAULT_SETTINGS.showTapZones),
  canvasPadX: Schema.number().min(0).max(300).default(DEFAULT_CANVAS_PAD_X),
  canvasPadY: Schema.number().min(0).max(300).default(DEFAULT_CANVAS_PAD_Y),
  homeRight: Schema.number().min(0).max(100).default(DEFAULT_HOME_RIGHT),
  homeBottom: Schema.number().min(0).max(100).default(DEFAULT_HOME_BOTTOM),
  bubbleOffsetX: Schema.number().min(-1000).max(1000).default(DEFAULT_BUBBLE_OFFSET_X),
  bubbleOffsetY: Schema.number().min(-1000).max(1000).default(DEFAULT_BUBBLE_OFFSET_Y),
  bubbleBgColor: Schema.string().default(DEFAULT_BUBBLE_BG_COLOR),
  bubbleBgOpacity: Schema.number().min(0).max(100).default(DEFAULT_BUBBLE_BG_OPACITY),
  /** 气泡最长连续可见秒数（0 = 不限）；默认 30。 */
  bubbleMaxSeconds: Schema.number().min(0).max(600).default(DEFAULT_BUBBLE_MAX_SECONDS),
  bubbleTextColor: Schema.string().default(DEFAULT_BUBBLE_TEXT_COLOR),
  aiEnabled: Schema.boolean().default(DEFAULT_SETTINGS.aiEnabled),
  aiTouchOnly: Schema.boolean().default(DEFAULT_SETTINGS.aiTouchOnly),
  aiTakeover: Schema.boolean().default(DEFAULT_SETTINGS.aiTakeover),
  /** 待机小动作：每隔十几秒随机来一个微动作，避免像定格动画。 */
  idleMotionEnabled: Schema.boolean().default(DEFAULT_SETTINGS.idleMotionEnabled),
  aiProvider: Schema.string().default(DEFAULT_AI_PROVIDER),
  aiModel: Schema.string().default(DEFAULT_AI_MODEL),
  interactionMode: Schema.union([
    Schema.const('mutual'),
    Schema.const('touch-first'),
    Schema.const('event-first'),
  ]).default(DEFAULT_INTERACTION_MODE),
  /** 交互条贴在模型上方 / 下方，或干脆不显示（静音 + 对话输入）。 */
  barPosition: Schema.union([
    Schema.const('top'),
    Schema.const('bottom'),
    Schema.const('hidden'),
  ]).default(DEFAULT_BAR_POSITION),
  /** 交互条沿吸附边的额外偏移（px，正数远离模型）。 */
  barOffset: Schema.number().min(BAR_OFFSET_LIMITS.min).max(BAR_OFFSET_LIMITS.max).default(DEFAULT_BAR_OFFSET),
  /** 注入到 prompt 的最近对话轮数（1 轮 = 一问一答；0 = 不注入；ADR-030）。 */
  aiHistoryCount: Schema.number().min(0).max(50).default(DEFAULT_AI_HISTORY),
  // 长状态 AI 演绎节奏（ADR-026）：入态延迟、演绎间隔、每次入态最大次数（思考/等待各自一套）
  thinkingAiDelay: Schema.number().min(0).max(120).default(DEFAULT_LONG_AI.thinking.delay),
  thinkingAiInterval: Schema.number().min(5).max(600).default(DEFAULT_LONG_AI.thinking.interval),
  thinkingAiMax: Schema.number().min(1).max(10).default(DEFAULT_LONG_AI.thinking.max),
  waitingAiDelay: Schema.number().min(0).max(120).default(DEFAULT_LONG_AI.waiting.delay),
  waitingAiInterval: Schema.number().min(5).max(600).default(DEFAULT_LONG_AI.waiting.interval),
  waitingAiMax: Schema.number().min(1).max(10).default(DEFAULT_LONG_AI.waiting.max),
  // 语音合成与口型（ADR-033）：模型/音色留成设置项，换供应商只加引擎实现
  ttsEnabled: Schema.boolean().default(DEFAULT_SETTINGS.ttsEnabled),
  ttsEngine: Schema.string().default(DEFAULT_SETTINGS.ttsEngine),
  ttsModel: Schema.string().default(DEFAULT_SETTINGS.ttsModel),
  ttsVoice: Schema.string().default(DEFAULT_SETTINGS.ttsVoice),
  lipsyncEnabled: Schema.boolean().default(DEFAULT_SETTINGS.lipsyncEnabled),
  lipsyncGain: Schema.number().min(LIPSYNC_GAIN_LIMITS.min).max(LIPSYNC_GAIN_LIMITS.max).default(DEFAULT_SETTINGS.lipsyncGain),
  focusRange: Schema.number().min(FOCUS_RANGE_LIMITS.min).max(FOCUS_RANGE_LIMITS.max).default(DEFAULT_SETTINGS.focusRange),
})

/** 依赖服务：webServer（同源路由）、settings（隐藏自动设置页）、llm（AI 回复，ADR-025）。 */
export const inject = ['webServer', 'settings', 'llm', 'credentials']

/** 注册宠物服务、设置 API 与素材路由。 */
export function apply(ctx: Context, config: Config): void {
  // 插件自带「Waifu 设置」页；隐藏 0.2.x 自动生成的 Config 表单页，
  // 避免两套入口并存且表单写入会触发整插件重载（ADR-013）。
  ctx.effect(() => ctx.settings.configure({ auto: false }), 'waifu: settings page policy')

  // 热设置：插件私有 settings.jsonc（base = Config 解析值）
  const baseSettings: PetSettings = {
    enabled: config.enabled,
    size: config.size,
    maxFps: config.maxFps,
    model: config.model,
    developerMode: config.developerMode,
    debug: config.debug,
    showTapZones: config.showTapZones,
    canvasPadX: config.canvasPadX,
    canvasPadY: config.canvasPadY,
    homeRight: config.homeRight,
    homeBottom: config.homeBottom,
    bubbleOffsetX: config.bubbleOffsetX,
    bubbleOffsetY: config.bubbleOffsetY,
    bubbleBgColor: config.bubbleBgColor,
    bubbleBgOpacity: config.bubbleBgOpacity,
    bubbleMaxSeconds: config.bubbleMaxSeconds,
    bubbleTextColor: config.bubbleTextColor,
    aiEnabled: config.aiEnabled,
    aiTouchOnly: config.aiTouchOnly,
    aiTakeover: config.aiTakeover,
    idleMotionEnabled: config.idleMotionEnabled,
    aiProvider: config.aiProvider,
    aiModel: config.aiModel,
    interactionMode: config.interactionMode,
    barPosition: config.barPosition,
    barOffset: config.barOffset,
    aiHistoryCount: config.aiHistoryCount,
    thinkingAiDelay: config.thinkingAiDelay,
    thinkingAiInterval: config.thinkingAiInterval,
    thinkingAiMax: config.thinkingAiMax,
    waitingAiDelay: config.waitingAiDelay,
    waitingAiInterval: config.waitingAiInterval,
    waitingAiMax: config.waitingAiMax,
    ttsEnabled: config.ttsEnabled,
    ttsEngine: config.ttsEngine,
    ttsModel: config.ttsModel,
    ttsVoice: config.ttsVoice,
    lipsyncEnabled: config.lipsyncEnabled,
    lipsyncGain: config.lipsyncGain,
    focusRange: config.focusRange,
  }
  const settingsStore = new SettingsStore(baseSettings)

  const touchPartsStore = new TouchPartsStore()
  const service = new PetService(ctx, () => settingsStore.get(), touchPartsStore)

  // 设置读写 API：Host 直连插件设置文件；写完成后经 SSE 推送新配置（ADR-006）。
  const settingsApi: SettingsRoutesApi = {
    view: () => settingsStore.view(),
    write: async (ops: readonly SettingsPathOp[]) => {
      const view = settingsStore.applyOps(ops)
      service.notifyConfigChanged()
      return view
    },
  }

  // AI 回复（ADR-025）：复用 DSH 已配置的 provider/model 与账号，人设读 $DSH_HOME/waifu/persona.md。
  // 冷却：同类触发（tap/state）1.2s 内只回一次，避免连点刷屏与刷 token。
  const AI_COOLDOWN_MS = 1200
  let lastAiAt = 0
  // 最近对话（ADR-030）：只存内存，进程重启即清空；条数由设置页 `aiHistoryCount` 决定注入多少
  let aiHistory: AiHistoryEntry[] = []
  // 最近一次真正发给模型的载荷（排查注入是否生效；ADR-030 追加 /ai-debug）
  let lastAiPayload: AiPayload | null = null
  let lastTtsPayload: TtsPayload | null = null
  let lastSpeakPayload: TtsPayload | null = null
  let payloadSink: 'tts' | 'speak' = 'tts'
  /**
   * AI 触发的公共前置（/interact 与 /speak 共用，ADR-025/028/031）：
   * 开关 → 1.2s 冷却 → 全 AI 接管时丢掉参考台词（旧客户端/手工调用也不再泄露固定对白）。
   */
  const beginAiTurn = (
    input: ReplyContext,
  ): { ok: true; settings: PetSettings; context: ReplyContext } | { ok: false; error: string } => {
    const settings = settingsStore.get()
    if (!settings.aiEnabled) return { ok: false, error: 'ai-disabled' }
    const now = Date.now()
    if (now - lastAiAt < AI_COOLDOWN_MS) return { ok: false, error: 'cooldown' }
    lastAiAt = now
    // 时区来自浏览器（宿主可能在 UTC 上跑），非法或缺省时 formatNow 会回落本地时区
    const tz = normalizeTimeZone(input.tz)
    const context: ReplyContext = settings.aiTakeover
      ? { ...input, hint: undefined, tz }
      : { ...input, tz }
    return { ok: true, settings, context }
  }

  /** 两个入口共用的请求参数（provider/model/人设/历史注入）。 */
  const aiRequest = (
    settings: PetSettings,
    context: ReplyContext,
    onPayload: (payload: AiPayload) => void,
    signal?: AbortSignal,
  ) => ({
    provider: settings.aiProvider,
    model: settings.aiModel,
    persona: loadPersona(dirname(settingsStore.path)),
    context,
    history: aiHistory,
    historyCount: settings.aiHistoryCount,
    onPayload,
    signal,
  })

  /** 只记录成功的往来：失败的请求不该污染上下文；参考台词不进历史（ADR-030）。 */
  const recordAiTurn = (context: ReplyContext, text: string, settings: PetSettings): void => {
    const at = Date.now()
    aiHistory = appendHistory(aiHistory, {
      role: 'user',
      text: buildSceneMessage(context, { forHistory: true }),
      at,
    })
    aiHistory = appendHistory(
      aiHistory,
      { role: 'assistant', text, at: Date.now(), provider: settings.aiProvider, model: settings.aiModel },
      AI_HISTORY_MAX_ENTRIES,
    )
  }

  const aiApi: InteractRoutesApi = {
    reply: async (input) => {
      const turn = beginAiTurn(input)
      if (!turn.ok) return { ok: false, error: turn.error }
      const attempt = await generateReply(ctx.llm, aiRequest(turn.settings, turn.context, (payload) => {
        lastAiPayload = payload
      }))
      if (attempt.text) {
        recordAiTurn(turn.context, attempt.text, turn.settings)
        return { ok: true, text: attempt.text, emotion: attempt.emotion ?? null }
      }
      // 失败原因回传（ADR-028）：设置页/排查时能直接看到是「没配 provider」还是「模型空回复」
      return { ok: false, error: `no-reply: ${attempt.error ?? 'unknown'}` }
    },
  }

  // AI 设置（ADR-025）：provider / 模型候选直接取 DSH 的 llm 目录；人设读 $DSH_HOME/waifu/persona.md
  const aiSettingsApi: AiRoutesApi = {
    // 排查用：当前历史缓冲 + 最近一次实际发出的载荷（含 system 与逐条 messages）
    debug: () => ({
      history: aiHistory,
      historyCount: settingsStore.get().aiHistoryCount,
      lastPayload: lastAiPayload,
      lastTtsPayload,
      lastSpeakPayload,
    }),
    options: async () => {
      const providers = ctx.llm.listProviders().map((p) => ({ id: p.id, name: p.name }))
      const models: Record<string, { id: string; name: string }[]> = {}
      for (const provider of providers) {
        try {
          models[provider.id] = (await ctx.llm.listModels(provider.id))
            .map((m) => ({ id: m.id, name: m.name }))
        } catch {
          // 适配器不提供目录：留空，设置页回落成手填
          models[provider.id] = []
        }
      }
      return { providers, models }
    },
    readPersona: () => {
      const home = dirname(settingsStore.path)
      return { text: loadPersona(home), path: personaPath(home) }
    },
    writePersona: (text) => savePersona(dirname(settingsStore.path), text),
    // 连通性自检（设置页「测试连接」）：用显式 provider/model 或已保存配置真实发一次请求
    check: async (input) => {
      const settings = settingsStore.get()
      const attempt = await generateReply(ctx.llm, {
        provider: input?.provider || settings.aiProvider,
        model: input?.model || settings.aiModel,
        persona: loadPersona(dirname(settingsStore.path)),
        context: { kind: 'tap', part: '脸', hint: '有人戳了戳你的脸' },
        timeoutMs: 20000,
      })
      if (attempt.text) return { ok: true, text: attempt.text }
      return { ok: false, error: attempt.error ?? 'unknown' }
    },
  }

  // 语音合成（ADR-033）：OpenRouter 的 `/api/v1/audio/speech`。
  // key 从 DSH 凭据服务按需解析（不落插件配置、不缓存跨操作），与 llm-pi-ai 用同一份 OPENROUTER_API_KEY。
  // 只声明用到的那一个方法：避免为一行调用引入 @deepseek-ai/dsh-credentials 这个依赖。
  const credentials = (ctx as unknown as {
    credentials?: { resolve(ref: unknown): Promise<{ value: string } | undefined> }
  }).credentials
  const resolveOpenRouterKey = async (): Promise<string | undefined> => {
    if (!credentials) return undefined
    try {
      const resolved = await credentials.resolve('OPENROUTER_API_KEY')
      return resolved?.value
    } catch {
      return undefined
    }
  }
  const ttsEngine = new OpenRouterTtsEngine(
    resolveOpenRouterKey,
    dirname(settingsStore.path),
    fetch,
    OPENROUTER_SPEECH_URL,
    (payload) => {
      // /speak 流与 /tts 试听分开记，方便对照同一次调用的两条请求
      if (payloadSink === 'speak') lastSpeakPayload = payload
      else lastTtsPayload = payload
    },
  )
  const voiceOptions = (): TtsVoiceOptions => {
    const settings = settingsStore.get()
    return {
      model: settings.ttsModel,
      voice: settings.ttsVoice.trim() || undefined,
    }
  }

  const speakApi: SpeakRoutesApi = {
    // 排查用单段合成：设置页「试听」与 curl 都走这里
    synthesize: async (text) => {
      payloadSink = 'tts'
      const audio = await ttsEngine.synthesize(text, voiceOptions())
      return { mime: audio.mime, audio: audio.audio }
    },
    stream: async (input, emit, signal) => {
      const turn = beginAiTurn(input)
      if (!turn.ok) {
        emit('error', { error: turn.error })
        return
      }
      const { settings, context } = turn
      const speakOn = settings.ttsEnabled && settings.ttsModel.trim().length > 0
      const chunks = streamReply(ctx.llm, aiRequest(settings, context, (payload) => {
        lastAiPayload = payload
      }, signal))
      const speakOptions = voiceOptions()
      payloadSink = 'speak'
      const synthesize = async (text: string): Promise<TtsAudio | null> => {
        if (!speakOn || signal.aborted) return null
        try {
          return await ttsEngine.synthesize(text, speakOptions, signal)
        } catch {
          // 合成失败不让气泡断掉：这一段没声音，文字照常上屏
          return null
        }
      }
      const result = await runSpeakPipeline({ chunks, synthesize, emit, signal })
      if (result.text) recordAiTurn(context, result.text, settings)
    },
  }

  // 路由随插件生命周期注册/清理。插件卸载时同时关闭全部活跃 SSE 流（onStream），
  // 避免旧流在路由注销后空转心跳。
  ctx.effect(() => {
    const openStreams = new Set<() => void>()
    const routes = makePetRoutes({
      service,
      packageRoot: petPackageRoot(import.meta.url),
      settings: settingsApi,
      ai: aiApi,
      aiSettings: aiSettingsApi,
      speak: speakApi,
      onStream: (close) => { openStreams.add(close) },
    })
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const close of openStreams) close()
      for (const dispose of disposers) dispose()
    }
  }, 'waifu: routes')
}
