/**
 * dsh-waifu host 半区：注册宠物服务、同源 HTTP 路由与插件私有设置。
 *
 * DSH 0.2.x 适配（ADR-013）：
 * - `ctx.settings` 已从「namespace 注册表」变成「Config schema → 设置页表单」投影，
 *   不再提供 register/get；写入会经 Loader 重新应用插件条目（整插件重载）。
 * - 因此热设置（开关/尺寸/帧率/模型/人设/开发者选项）改存插件私有
 *   `$DSH_HOME/waifu/settings.jsonc`（ADR-013），经 SSE 实时推送；
 *   Config schema 只作为默认值 base 层，并用 `settings.configure({ auto: false })`
 *   隐藏自动生成的设置页（插件自带「桌宠配置」页）。
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
  makePetRoutes,
  petPackageRoot,
  type AiRoutesApi,
  type InteractRoutesApi,
  type SettingsRoutesApi,
} from './routes.ts'
import { generateReply, loadPersona, personaPath, savePersona } from './ai.ts'
import {
  defaultModelId,
  listBuiltinPresets,
  resolveDefaultTouchParts,
  resolveModelUrl,
  resolveMotionMap,
} from './models-host.ts'
import { SettingsStore, type PetSettings } from './settings-store.ts'
import { TouchPartsStore } from './touch-parts.ts'

export { PetService } from './service.ts'
export type { PetState, PetStateView } from './service.ts'
export { makePetRoutes, petPackageRoot, PET_API_PREFIX, PET_ASSET_PREFIX } from './routes.ts'
export {
  listBuiltinPresets,
  resolveModelUrl,
  resolveMotionMap,
  resolveDefaultTouchParts,
  defaultModelId,
} from './models-host.ts'
export {
  DEFAULT_MOTION_MAP,
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
  enabled: Schema.boolean().default(true),
  size: Schema.number().min(40).max(400).default(200),
  maxFps: Schema.union([
    Schema.const(30),
    Schema.const(60),
    Schema.const(0),
  ]).default(30),
  model: Schema.string().default(defaultModelId()),
  developerMode: Schema.boolean().default(false),
  debug: Schema.boolean().default(false),
  showTapZones: Schema.boolean().default(false),
  canvasPadX: Schema.number().min(0).max(300).default(125),
  canvasPadY: Schema.number().min(0).max(300).default(50),
  homeRight: Schema.number().min(0).max(100).default(16),
  homeBottom: Schema.number().min(0).max(100).default(24),
  bubbleOffsetX: Schema.number().min(-1000).max(1000).default(0),
  bubbleOffsetY: Schema.number().min(-1000).max(1000).default(10),
  bubbleBgColor: Schema.string().default('#ffffff'),
  bubbleBgOpacity: Schema.number().min(0).max(100).default(92),
  bubbleTextColor: Schema.string().default('#222222'),
  aiEnabled: Schema.boolean().default(false),
  aiTouchOnly: Schema.boolean().default(false),
  aiProvider: Schema.string().default('deepseek-official'),
  aiModel: Schema.string().default('deepseek-flash'),
})

/** 依赖服务：webServer（同源路由）、settings（隐藏自动设置页）、llm（AI 回复，ADR-025）。 */
export const inject = ['webServer', 'settings', 'llm']

/** 注册宠物服务、设置 API 与素材路由。 */
export function apply(ctx: Context, config: Config): void {
  // 插件自带「桌宠配置」设置页；隐藏 0.2.x 自动生成的 Config 表单页，
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
    bubbleTextColor: config.bubbleTextColor,
    aiEnabled: config.aiEnabled,
    aiTouchOnly: config.aiTouchOnly,
    aiProvider: config.aiProvider,
    aiModel: config.aiModel,
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
  let lastAiAt = 0
  const aiApi: InteractRoutesApi = {
    reply: async (input) => {
      const settings = settingsStore.get()
      if (!settings.aiEnabled) return { ok: false, error: 'ai-disabled' }
      const now = Date.now()
      if (now - lastAiAt < 1200) return { ok: false, error: 'cooldown' }
      lastAiAt = now
      const text = await generateReply(ctx.llm, {
        provider: settings.aiProvider,
        model: settings.aiModel,
        persona: loadPersona(dirname(settingsStore.path)),
        context: input,
      })
      return text ? { ok: true, text } : { ok: false, error: 'no-reply' }
    },
  }

  // AI 设置（ADR-025）：provider / 模型候选直接取 DSH 的 llm 目录；人设读 $DSH_HOME/waifu/persona.md
  const aiSettingsApi: AiRoutesApi = {
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
      onStream: (close) => { openStreams.add(close) },
    })
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const close of openStreams) close()
      for (const dispose of disposers) dispose()
    }
  }, 'waifu: routes')
}
