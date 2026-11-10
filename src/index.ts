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
 *
 * ADR-037（全 AI 驱动）：固定对白与手动动作/表情映射全部移除，Host 只负责
 * 场景打包（时间/事件/触摸类型/静默超时）→ LLM（人设+记忆+历史+目录）
 * → 解析输出（标签流式：[表情][动作] 台词 + [记] 记忆行）→ 控制角色 + 落盘记忆。
 * @module dsh-waifu
 */

import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import { PetService } from './service.ts'
import {
  DEFAULT_AI_HISTORY,
  DEFAULT_AI_MEMORY,
  defaultEventTriggers,
  DEFAULT_AI_MODEL,
  DEFAULT_AI_PROVIDER,
  DEFAULT_AI_MIN_INTERVAL_SEC,
  DEFAULT_IDLE_TIMEOUT_SEC,
  DEFAULT_ACTIVITY_WINDOW_SEC,
  DEFAULT_MERGE_MAX,
  DEFAULT_TAP_GAP_MS,
  MERGE_MAX_LIMITS,
  TAP_GAP_LIMITS,
  DEFAULT_TRIGGER_MODE,
  BAR_OFFSET_LIMITS,
  BAR_AUTO_HIDE_LIMITS,
  DEFAULT_BAR_AUTO_HIDE_SEC,
  DEFAULT_BAR_OFFSET,
  DEFAULT_BAR_POSITION,
  DEFAULT_BUBBLE_BG_COLOR,
  DEFAULT_BUBBLE_BG_OPACITY,
  DEFAULT_BUBBLE_MAX_SECONDS,
  DEFAULT_BUBBLE_OFFSET_X,
  DEFAULT_BUBBLE_TEXT_COLOR,
  DEFAULT_CANVAS_PAD_X,
  DEFAULT_CANVAS_PAD_Y,
  DEFAULT_HOME_BOTTOM,
  DEFAULT_HOME_RIGHT,
  DEFAULT_MAX_FPS,
  DEFAULT_SETTINGS,
  FOCUS_RANGE_LIMITS,
  LIPSYNC_GAIN_LIMITS,
  ttsModelProvider,
  DEFAULT_LLM_STREAMING,
  DEFAULT_TTS_STREAMING,
} from './defaults.ts'
import {
  makePetRoutes,
  petPackageRoot,
  type AiRoutesApi,
  type InteractRoutesApi,
  type MemoryRoutesApi,
  type SettingsRoutesApi,
  type SpeakRoutesApi,
  type TriggerInput,
} from './routes.ts'
import {
  AI_HISTORY_MAX_ENTRIES,
  appendHistory,
  historySceneText,
  normalizeTimeZone,
  generateReply,
  loadPersona,
  streamReply,
  personaPath,
  savePersona,
  type AiHistoryEntry,
  type AiPayload,
  type AiReplyTrace,
  type ReplyChunk,
  type ReplyContext,
} from './ai.ts'
import { taggedReplyLine } from './director.ts'
import {
  loadMemory,
  appendMemory,
  saveMemory,
  memoryContext,
  memoryPath,
} from './memory.ts'
import { traceStep, type TraceStep } from './trace.ts'
import {
  defaultModelId,
  listBuiltinPresets,
  resolveDefaultTouchParts,
  resolveModelUrl,
} from './models-host.ts'
import { SettingsStore, type PetSettings } from './settings-store.ts'
import { OPENROUTER_SPEECH_URL } from './tts.ts'
import {
  MiMoTtsEngine,
  OpenRouterTtsEngine,
  type TtsAudio,
  type TtsEngine,
  type TtsPayload,
  type TtsStreamFrame,
  type TtsVoiceOptions,
} from './tts.ts'
import { runSpeakPipeline, runWholeSpeakPipeline } from './speak.ts'
import type { TimelineCue } from './timeline.ts'
import { TouchPartsStore } from './touch-parts.ts'

export { PetService } from './service.ts'
export type { PetState, PetStateView } from './service.ts'
export { makePetRoutes, petPackageRoot, PET_API_PREFIX, PET_ASSET_PREFIX } from './routes.ts'
// 再导出（复用上面的 import，避免同一模块被 import + export-from 各写一遍）
export { listBuiltinPresets, resolveModelUrl, resolveDefaultTouchParts, defaultModelId }
export {
  AI_MOTIONS,
  AI_MOTION_IDS,
  ANIMATION_SLOTS,
  DEFAULT_TOUCH_PARTS,
  MAX_BOXES_PER_PART,
  hitTestTouchParts,
  normalizeTouchParts,
  normalizeTouchBox,
  pointToBoundsRatio,
  isMotionId,
} from './models.ts'
export type {
  BuiltinPreset,
  AnimationSlot,
  MotionDef,
  TouchBox,
  TouchPart,
} from './models.ts'

/** 稳定 cordis 插件名（对应 cordis.patch.yml insert id）。 */
export const name = 'dsh-waifu'

/** 渲染帧率档（spec §2/§7）：30 / 60 / 0（不限制，对应 PIXI maxFPS=0）。 */
export type MaxFpsOption = 30 | 60 | 0

/** 插件配置（cordis.patch.yml 的 config 是 base 层；用户改动落插件私有设置文件，ADR-013）。 */
export interface Config extends Omit<PetSettings, 'maxFps' | 'eventTriggers' | 'eventTexts' | 'motionTexts' | 'expressionTexts' | 'motionEnabled' | 'expressionEnabled'> {
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
  bubbleBgColor: Schema.string().default(DEFAULT_BUBBLE_BG_COLOR),
  bubbleBgOpacity: Schema.number().min(0).max(100).default(DEFAULT_BUBBLE_BG_OPACITY),
  /** 气泡最长连续可见秒数（0 = 不限）；默认 10。 */
  bubbleMaxSeconds: Schema.number().min(0).max(600).default(DEFAULT_BUBBLE_MAX_SECONDS),
  bubbleTextColor: Schema.string().default(DEFAULT_BUBBLE_TEXT_COLOR),
  /** AI 驱动总开关（ADR-037）：关闭后角色完全静默（无固定台词可回落）。 */
  aiEnabled: Schema.boolean().default(DEFAULT_SETTINGS.aiEnabled),
  /** 待机小动作：每隔十几秒随机来一个微动作，避免像定格动画。 */
  idleMotionEnabled: Schema.boolean().default(DEFAULT_SETTINGS.idleMotionEnabled),
  aiProvider: Schema.string().default(DEFAULT_AI_PROVIDER),
  aiModel: Schema.string().default(DEFAULT_AI_MODEL),
  /** 注入到 prompt 的最近对话轮数（1 轮 = 一问一答；0 = 不注入；ADR-030）。 */
  aiHistoryCount: Schema.number().min(0).max(50).default(DEFAULT_AI_HISTORY),
  /** 注入到 prompt 的最近记忆条数（0 = 不注入；ADR-037）。 */
  aiMemoryCount: Schema.number().min(0).max(100).default(DEFAULT_AI_MEMORY),
  /** 新触发的处理方式：interrupt = 掐掉上一轮立刻反应，queue = 等上一轮说完再反应（ADR-037）。 */
  triggerMode: Schema.union([
    Schema.const('interrupt'),
    Schema.const('queue'),
  ]).default(DEFAULT_TRIGGER_MODE),
  /** 事件类触发的最小间隔（秒，0 = 不限制；触摸/对话不受限；ADR-037）。 */
  aiMinIntervalSec: Schema.number().min(0).max(600).default(DEFAULT_AI_MIN_INTERVAL_SEC),
  /** 静默超时（秒，0 = 关闭）：多久没有任何事件/互动就自动让角色说一句话（ADR-037）。 */
  idleTimeoutSec: Schema.number().min(0).max(3600).default(DEFAULT_IDLE_TIMEOUT_SEC),
  /** 同类 DSH 事件的触发窗口（秒）：窗口内同类事件并进合并队列（ADR-047）。 */
  activityWindowSec: Schema.number().min(0).max(300).default(DEFAULT_ACTIVITY_WINDOW_SEC),
  /** 触摸连点窗口（毫秒，0 = 不合并）：窗口内的连续触摸只保留最后一次（ADR-047）。 */
  tapGapMs: Schema.number().min(TAP_GAP_LIMITS.min).max(TAP_GAP_LIMITS.max).default(DEFAULT_TAP_GAP_MS),
  /** 合并上限（条）：一轮场景句里最多拼进多少条被压下的触发（ADR-047）。 */
  mergeMax: Schema.number().min(MERGE_MAX_LIMITS.min).max(MERGE_MAX_LIMITS.max).default(DEFAULT_MERGE_MAX),
  /** 交互条贴在模型上方 / 下方，或干脆不显示（静音 + 对话输入）。 */
  barPosition: Schema.union([
    Schema.const('top'),
    Schema.const('bottom'),
    Schema.const('hidden'),
  ]).default(DEFAULT_BAR_POSITION),
  /** 交互条沿吸附边的额外偏移（px，正数远离模型）。 */
  barOffset: Schema.number().min(BAR_OFFSET_LIMITS.min).max(BAR_OFFSET_LIMITS.max).default(DEFAULT_BAR_OFFSET),
  /** 交互条无操作自动隐藏（秒，0 = 不自动隐藏）：到点收起，鼠标移到模型上重新出现。 */
  barAutoHideSec: Schema.number().min(BAR_AUTO_HIDE_LIMITS.min).max(BAR_AUTO_HIDE_LIMITS.max).default(DEFAULT_BAR_AUTO_HIDE_SEC),
  // 语音合成与口型（ADR-033）：模型/音色留成设置项，换供应商只加引擎实现
  ttsEnabled: Schema.boolean().default(DEFAULT_SETTINGS.ttsEnabled),
  ttsModel: Schema.string().default(DEFAULT_SETTINGS.ttsModel),
  ttsVoice: Schema.string().default(DEFAULT_SETTINGS.ttsVoice),
  ttsStyleControl: Schema.boolean().default(DEFAULT_SETTINGS.ttsStyleControl),
  /** 文字流式（ADR-063）：关闭后等整段回复写完再处理（整段合成）。 */
  llmStreaming: Schema.boolean().default(DEFAULT_LLM_STREAMING),
  /** 语音流式（ADR-063）：整段一次合成、边收边播（目前只有 MiMo 支持）。 */
  ttsStreaming: Schema.boolean().default(DEFAULT_TTS_STREAMING),
  lipsyncEnabled: Schema.boolean().default(DEFAULT_SETTINGS.lipsyncEnabled),
  lipsyncGain: Schema.number().min(LIPSYNC_GAIN_LIMITS.min).max(LIPSYNC_GAIN_LIMITS.max).default(DEFAULT_SETTINGS.lipsyncGain),
  focusRange: Schema.number().min(FOCUS_RANGE_LIMITS.min).max(FOCUS_RANGE_LIMITS.max).default(DEFAULT_SETTINGS.focusRange),
})

/** 依赖服务：webServer（同源路由）、settings（隐藏自动设置页）、llm（AI 驱动，ADR-037）。 */
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
    bubbleBgColor: config.bubbleBgColor,
    bubbleBgOpacity: config.bubbleBgOpacity,
    bubbleMaxSeconds: config.bubbleMaxSeconds,
    bubbleTextColor: config.bubbleTextColor,
    aiEnabled: config.aiEnabled,
    idleMotionEnabled: config.idleMotionEnabled,
    aiProvider: config.aiProvider,
    aiModel: config.aiModel,
    aiHistoryCount: config.aiHistoryCount,
    aiMemoryCount: config.aiMemoryCount,
    triggerMode: config.triggerMode,
    aiMinIntervalSec: config.aiMinIntervalSec,
    idleTimeoutSec: config.idleTimeoutSec,
    activityWindowSec: config.activityWindowSec,
    tapGapMs: config.tapGapMs,
    mergeMax: config.mergeMax,
    eventTriggers: defaultEventTriggers(),
    eventTexts: {},
    motionTexts: {},
    expressionTexts: {},
    motionEnabled: {},
    expressionEnabled: { ...DEFAULT_SETTINGS.expressionEnabled },
    barPosition: config.barPosition,
    barOffset: config.barOffset,
    barAutoHideSec: config.barAutoHideSec,
    ttsEnabled: config.ttsEnabled,
    ttsModel: config.ttsModel,
    ttsVoice: config.ttsVoice,
    ttsStyleControl: config.ttsStyleControl,
    llmStreaming: config.llmStreaming,
    ttsStreaming: config.ttsStreaming,
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

  // 记忆文件（ADR-037）：$DSH_HOME/waifu/memory.md；设置页查看/编辑；AI 输出 [记] 行时追加
  const waifuHome = dirname(settingsStore.path)
  const memoryApi: MemoryRoutesApi = {
    read: () => ({ text: loadMemory(waifuHome).text, path: memoryPath(waifuHome) }),
    write: (text) => saveMemory(waifuHome, text),
  }

  // AI 驱动（ADR-037）：全部反应（台词/动作/表情/记忆）由一次 LLM 调用产生。
  // 频率控制一律在客户端调度器里（ADR-047）：Host 不按时间拒绝，只如实转发。
  // 最近对话（ADR-030）：只存内存，进程重启即清空；条数由设置页 `aiHistoryCount` 决定注入多少
  let aiHistory: AiHistoryEntry[] = []
  // 最近一次真正发给模型的载荷（排查注入是否生效；ADR-030 追加 /ai-debug）
  let lastAiPayload: AiPayload | null = null
  let lastTtsPayload: TtsPayload | null = null
  let lastSpeakPayload: TtsPayload | null = null
  /**
   * AI 触发的公共前置（/interact 与 /speak 共用）：开关 → 时区归一化。
   * 触发频率策略（interrupt/queue / 各种窗口）全在客户端调度器里执行（ADR-047）：
   * Host 只是传感器与转发层，不按频率拒绝、也不替角色做任何状态推导。
   */
  const beginAiTurn = (
    input: TriggerInput,
  ): { ok: true; settings: PetSettings; context: ReplyContext } | { ok: false; error: string } => {
    const settings = settingsStore.get()
    if (!settings.aiEnabled) return { ok: false, error: 'ai-disabled' }
    // 时区来自浏览器（宿主可能在 UTC 上跑），非法或缺省时 formatNow 会回落本地时区
    const tz = normalizeTimeZone(input.tz)
    const context: ReplyContext = {
      kind: input.kind,
      part: input.part,
      interaction: input.interaction,
      event: input.event,
      text: input.text,
      merged: input.merged,
      tz,
    }
    return { ok: true, settings, context }
  }

  /** 两个入口共用的请求参数（provider/model/人设+记忆/历史注入）。 */
  const aiRequest = (
    settings: PetSettings,
    context: ReplyContext,
    onPayload: (payload: AiPayload) => void,
    signal?: AbortSignal,
    onReply?: (trace: AiReplyTrace) => void,
  ) => {
    const memories = loadMemory(waifuHome).entries
    return {
      provider: settings.aiProvider,
      model: settings.aiModel,
      persona: loadPersona(waifuHome),
      memory: memoryContext(memories, settings.aiMemoryCount),
      context,
      eventTexts: settings.eventTexts,
      catalog: {
        motionTexts: settings.motionTexts,
        expressionTexts: settings.expressionTexts,
        motionEnabled: settings.motionEnabled,
        expressionEnabled: settings.expressionEnabled,
        // 风格控制只对 MiMo 生效（ADR-062）：千问不写这段 prompt，行为完全不变
        styleControl: settings.ttsStyleControl && ttsModelProvider(settings.ttsModel) === 'mimo',
      },
      history: aiHistory,
      historyCount: settings.aiHistoryCount,
      onPayload,
      onReply,
      signal,
    }
  }

  /** 记忆落盘（ADR-037）：AI 输出的 [记] 行追加进 memory.md（带时间戳，用触发方时区）。 */
  const rememberNote = (note: string, tz?: string): void => {
    const trimmed = note.trim()
    if (!trimmed) return
    appendMemory(waifuHome, trimmed, tz)
  }

  /** 只记录成功的往来：失败的请求不该污染上下文；场景描述不携带参考台词（ADR-030/037）。 */
  const recordAiTurn = (
    context: ReplyContext,
    text: string,
    settings: PetSettings,
    tags?: { expressions?: string[]; motions?: string[]; style?: string },
  ): void => {
    const at = Date.now()
    aiHistory = appendHistory(aiHistory, {
      role: 'user',
      // 历史只记最短事实（ADR-039）：整段场景句重复注入 N 次太占 token
      text: historySceneText(context, settings.eventTexts),
      at,
    })
    // assistant 记「带标签的原文」（ADR-049 B3）：模型才能在历史里看到标签长在台词里的样子。
    aiHistory = appendHistory(
      aiHistory,
      {
        role: 'assistant',
        text: taggedReplyLine(text, tags),
        at: Date.now(),
        provider: settings.aiProvider,
        model: settings.aiModel,
      },
      AI_HISTORY_MAX_ENTRIES,
    )
  }

  const aiApi: InteractRoutesApi = {
    reply: async (input) => {
      const turn = beginAiTurn(input)
      if (!turn.ok) return { ok: false, error: turn.error }
      // 一次性响应没有流：链路记录随响应回带，客户端按数组顺序展出（ADR-043）
      const trace: TraceStep[] = []
      const attempt = await generateReply(ctx.llm, aiRequest(turn.settings, turn.context, (payload) => {
        lastAiPayload = payload
        trace.push(traceStep('llm.request', payload))
      }, undefined, (reply: AiReplyTrace) => {
        trace.push(traceStep('llm.reply', reply))
      }))
      if (attempt.text) {
        recordAiTurn(turn.context, attempt.text, turn.settings, {
          expressions: attempt.expressions,
          motions: attempt.motions,
          ...(attempt.style === undefined ? {} : { style: attempt.style }),
        })
        if (attempt.memory) rememberNote(attempt.memory, input.tz)
        return {
          ok: true,
          text: attempt.text,
          expressions: attempt.expressions,
          motions: attempt.motions,
          memory: attempt.memory,
          trace,
        }
      }
      // 失败原因回传（ADR-028）：设置页/排查时能直接看到是「没配 provider」还是「模型空回复」
      return { ok: false, error: `no-reply: ${attempt.error ?? 'unknown'}`, trace }
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
      return { text: loadPersona(waifuHome), path: personaPath(waifuHome) }
    },
    writePersona: (text) => savePersona(waifuHome, text),
    // 连通性自检（设置页「测试连接」）：用显式 provider/model 或已保存配置真实发一次请求
    check: async (input) => {
      const settings = settingsStore.get()
      const attempt = await generateReply(ctx.llm, {
        provider: input?.provider || settings.aiProvider,
        model: input?.model || settings.aiModel,
        persona: loadPersona(waifuHome),
        memory: memoryContext(loadMemory(waifuHome).entries, settings.aiMemoryCount),
        context: { kind: 'tap', part: '脸', interaction: '轻碰' },
        // 与真实链路用同一套目录与事件文案：否则「自检」看到的 system 和线上不是同一个
        // （目录会被替换成「这次没有可用动作」，据此调提示词会被误导）。
        eventTexts: settings.eventTexts,
        catalog: {
          motionTexts: settings.motionTexts,
          expressionTexts: settings.expressionTexts,
          motionEnabled: settings.motionEnabled,
          expressionEnabled: settings.expressionEnabled,
        },
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
  const credentialRef = async (name: string): Promise<string | undefined> => {
    if (!credentials) return undefined
    try {
      const resolved = await credentials.resolve(name)
      return resolved?.value
    } catch {
      return undefined
    }
  }
  // OpenRouter（默认）与小米 MiMo 各建一个引擎：按当前设置的模型 id 分派（ADR-061）
  const resolveOpenRouterKey = () => credentialRef('OPENROUTER_API_KEY')
  const resolveXiaomiKey = () => credentialRef('XIAOMI_API_KEY')
  // 每条请求自己带 sink 钩子：不再用跨请求共享的全局，避免 /tts 与 /speak 并发时串台
  const openRouterTtsEngine = new OpenRouterTtsEngine(
    resolveOpenRouterKey,
    waifuHome,
    fetch,
    OPENROUTER_SPEECH_URL,
  )
  const mimoTtsEngine = new MiMoTtsEngine(resolveXiaomiKey, waifuHome)
  const ttsEngineFor = (model: string): OpenRouterTtsEngine | MiMoTtsEngine =>
    ttsModelProvider(model) === 'mimo' ? mimoTtsEngine : openRouterTtsEngine
  const voiceOptions = (): TtsVoiceOptions => {
    const settings = settingsStore.get()
    return {
      model: settings.ttsModel,
      voice: settings.ttsVoice.trim() || undefined,
      // 风格指令由 LLM 每轮给出（ADR-062），这里不写死；见 speak 管线里的 replyStyle
    }
  }

  const speakApi: SpeakRoutesApi = {
    // 排查用单段合成：设置页「试听」与 curl 都走这里
    synthesize: async (text) => {
      const options = voiceOptions()
      const audio = await ttsEngineFor(options.model).synthesize(text, options, undefined, (payload) => {
        lastTtsPayload = payload
      })
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
      const speakOptions = voiceOptions()
      // 链路记录（ADR-043）：请求/回复在真正发生的时刻发成 SSE `debug` 帧，
      // 客户端按到达顺序落进控制台，于是顺序永远等于真实顺序。
      const replyChunks = streamReply(ctx.llm, aiRequest(settings, context, (payload) => {
        lastAiPayload = payload
        emit('debug', traceStep('llm.request', payload))
      }, signal, (reply: AiReplyTrace) => {
        emit('debug', traceStep('llm.reply', reply))
      }))
      /** LLM 这轮写的语气指令（ADR-062）：只对 MiMo 生效，且必须开关打开。 */
      const styleOn = settings.ttsStyleControl && ttsModelProvider(speakOptions.model) === 'mimo'
      let replyStyle = ''
      /**
       * 两个开关（ADR-063）：
       * - 文字流式开 → LLM 边生成边切句；关 → 一次性拿整段再处理；
       * - 语音流式开（仅 MiMo）→ 整段一次合成、边收边播。
       * 合成粒度：语音流式开 或 文字流式关 ⇒ 整段；否则逐句（现状）。
       */
      const ttsStreamOn = speakOn && settings.ttsStreaming && ttsModelProvider(speakOptions.model) === 'mimo'
      const wholeMode = ttsStreamOn || !settings.llmStreaming
      // 语气帧不进客户端：它只影响合成请求（气泡/历史里都不该出现），在这里被吃掉
      async function* styledChunks(): AsyncGenerator<ReplyChunk> {
        for await (const chunk of replyChunks) {
          if (chunk.type === 'style') {
            if (styleOn) replyStyle = chunk.style
            continue
          }
          yield chunk
        }
      }
      const synthesize = async (text: string): Promise<TtsAudio | null> => {
        if (!speakOn || signal.aborted) return null
        const startedAt = Date.now()
        const options: TtsVoiceOptions = replyStyle ? { ...speakOptions, style: replyStyle } : speakOptions
        try {
          const audio = await ttsEngineFor(options.model).synthesize(text, options, signal, (payload) => {
            lastSpeakPayload = payload
            emit('debug', traceStep('tts.request', payload))
          })
          // 回复只报摘要：完整音频字节没有任何可读性（ADR-043）
          emit('debug', traceStep('tts.reply', {
            ok: true,
            bytes: audio.audio.length,
            mime: audio.mime,
            cached: audio.cached,
            ms: Date.now() - startedAt,
          }))
          return audio
        } catch (error) {
          emit('debug', traceStep('tts.reply', {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            ms: Date.now() - startedAt,
          }))
          // 合成失败不让气泡断掉：这一段没声音，文字照常上屏
          return null
        }
      }

      // ---- 整段模式（ADR-063）：先把整段回复拿全，再一次性交给 TTS ----
      if (wholeMode) {
        // 两个开关各管一件事（ADR-063 修订）：整段合成是「语音」侧的取舍，
        // 不代表气泡要把台词憋到最后——文字流式开着就照常把增量转给客户端。
        emit('mode', { whole: true, liveText: settings.llmStreaming })
        let rawText = ''
        let replyTags: { expressions: string[]; motions: string[] } | undefined
        let replyMemory: string | undefined
        if (settings.llmStreaming) {
          // 文字流式：消费同一路 chunk，只是不在中途合成
          for await (const chunk of styledChunks()) {
            if (chunk.type === 'delta') {
              rawText += chunk.text
              emit('text', { delta: chunk.text })
              continue
            }
            if (chunk.type === 'tags') {
              replyTags = { expressions: chunk.expressions, motions: chunk.motions }
              emit('tags', {
                expressions: chunk.expressions,
                motions: chunk.motions,
                ...(chunk.dropped === undefined ? {} : { dropped: chunk.dropped }),
              })
              continue
            }
            if (chunk.type === 'memory') {
              replyMemory = chunk.note
              emit('memory', { note: chunk.note })
              continue
            }
            if (chunk.type === 'done') {
              rawText = chunk.text
              continue
            }
            if (chunk.type === 'error') emit('error', { error: chunk.error })
          }
        } else {
          // 文字非流式：一次性拿整段（带标签/记忆/语气）
          const attempt = await generateReply(ctx.llm, aiRequest(settings, context, (payload) => {
            lastAiPayload = payload
            emit('debug', traceStep('llm.request', payload))
          }, signal, (reply: AiReplyTrace) => {
            emit('debug', traceStep('llm.reply', reply))
          }))
          if (attempt.error !== undefined || !attempt.text) {
            emit('error', { error: attempt.error ?? 'empty-reply' })
            emit('done', { text: '' })
            return
          }
          if (styleOn && attempt.style !== undefined) replyStyle = attempt.style
          rawText = attempt.text
          replyTags = { expressions: attempt.expressions ?? [], motions: attempt.motions ?? [] }
          replyMemory = attempt.memory
          emit('tags', replyTags)
          if (replyMemory !== undefined) emit('memory', { note: replyMemory })
        }

        const text = rawText.trim()
        const cues: TimelineCue[] = [
          ...(replyTags?.expressions ?? []).map((id): TimelineCue => ({ kind: 'expression', id })),
          ...(replyTags?.motions ?? []).map((id): TimelineCue => ({ kind: 'motion', id })),
        ]
        const options: TtsVoiceOptions = replyStyle ? { ...speakOptions, style: replyStyle } : speakOptions
        const engine: TtsEngine = ttsEngineFor(options.model)
        const canStream = speakOn && ttsStreamOn && typeof engine.synthesizeStream === 'function'
        const streamFactory = canStream
          ? (): AsyncGenerator<TtsStreamFrame> => (async function* () {
            const startedAt = Date.now()
            let bytes = 0
            try {
              for await (const frame of engine.synthesizeStream!(text, options, signal, (payload) => {
                lastSpeakPayload = payload
                emit('debug', traceStep('tts.request', payload))
              })) {
                bytes += frame.kind === 'pcm' ? frame.data.byteLength : frame.audio.audio.byteLength
                yield frame
              }
              emit('debug', traceStep('tts.reply', {
                ok: true,
                stream: true,
                bytes,
                mime: 'audio/pcm',
                ms: Date.now() - startedAt,
              }))
            } catch (error) {
              emit('debug', traceStep('tts.reply', {
                ok: false,
                stream: true,
                bytes,
                error: error instanceof Error ? error.message : String(error),
                ms: Date.now() - startedAt,
              }))
              throw error
            }
          })()
          : undefined
        const result = await runWholeSpeakPipeline({
          text,
          cues,
          ...(streamFactory === undefined ? {} : { stream: streamFactory }),
          synthesize,
          emit,
          signal,
        })
        if (result.text) {
          recordAiTurn(context, result.text, settings, {
            ...(replyTags ?? {}),
            ...(replyStyle ? { style: replyStyle } : {}),
          })
        }
        if (replyMemory !== undefined) rememberNote(replyMemory, input.tz)
        return
      }

      // ---- 逐句模式（现状，ADR-033 / ADR-037）----
      const result = await runSpeakPipeline({ chunks: styledChunks(), synthesize, emit, signal })
      if (result.text) {
        recordAiTurn(context, result.text, settings, {
          ...result.tags,
          ...(replyStyle ? { style: replyStyle } : {}),
        })
      }
      // 记忆行（ADR-037）：管线收尾时若 AI 留了 [记]，落盘 memory.md
      if (result.memory) rememberNote(result.memory, input.tz)
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
      memory: memoryApi,
      speak: speakApi,
      // 返回注销函数：流结束时把自己从集合里摘掉，否则每轮 /speak、每次 SSE 重连都留一个闭包
      onStream: (close) => {
        openStreams.add(close)
        return () => { openStreams.delete(close) }
      },
    })
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const close of openStreams) close()
      for (const dispose of disposers) dispose()
    }
  }, 'waifu: routes')
}
