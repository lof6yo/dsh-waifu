/**
 * dsh-live2d-pets host 半区：注册宠物服务、同源 HTTP 路由与插件私有设置。
 *
 * DSH 0.2.x 适配（ADR-013）：
 * - `ctx.settings` 已从「namespace 注册表」变成「Config schema → 设置页表单」投影，
 *   不再提供 register/get；写入会经 Loader 重新应用插件条目（整插件重载）。
 * - 因此热设置（开关/尺寸/帧率/模型/人设/开发者选项）改存插件私有
 *   `$DSH_HOME/live2d-pet/settings.jsonc`（ADR-013），经 SSE 实时推送；
 *   Config schema 只作为默认值 base 层，并用 `settings.configure({ auto: false })`
 *   隐藏自动生成的设置页（插件自带「桌宠配置」页）。
 * @module dsh-live2d-pets
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { PetService } from './service.ts'
import { makePetRoutes, petPackageRoot, type SettingsRoutesApi } from './routes.ts'
import type { CustomModelEntry } from './models.ts'
import {
  defaultModelId,
  listBuiltinPresets,
  resolveDefaultTouchParts,
  resolveModelUrl,
  resolveMotionMap,
} from './models-host.ts'
import { CustomModelsStore } from './custom-models.ts'
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
  CustomModelEntry,
  AnimationSlot,
  MotionMap,
  TouchBox,
  TouchPart,
} from './models.ts'

/** 稳定 cordis 插件名（对应 cordis.patch.yml insert id）。 */
export const name = 'live2d-pet'

/** 渲染帧率档（spec §2/§7）：30 / 60 / 0（不限制，对应 PIXI maxFPS=0）。 */
export type MaxFpsOption = 30 | 60 | 0

/** 插件配置（cordis.patch.yml 的 config 是 base 层；用户改动落插件私有设置文件，ADR-013）。 */
export interface Config extends Omit<PetSettings, 'maxFps'> {
  /** 渲染帧率档（30 / 60 / 0=不限制；Schema 层用字面量联合校验）。 */
  maxFps: MaxFpsOption
  /** @deprecated 自定义模型已迁移到 $DSH_HOME/live2d-pet/custom-models.jsonc。 */
  customModels?: CustomModelEntry[]
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  size: Schema.number().min(40).max(400).default(160),
  maxFps: Schema.union([
    Schema.const(30),
    Schema.const(60),
    Schema.const(0),
  ]).default(30),
  model: Schema.string().default(defaultModelId()),
  developerMode: Schema.boolean().default(false),
  debug: Schema.boolean().default(false),
  showTapZones: Schema.boolean().default(false),
  canvasPadX: Schema.number().min(0).max(300).default(130),
  canvasPadY: Schema.number().min(0).max(300).default(70),
  homeRight: Schema.number().min(0).max(4000).default(24),
  homeBottom: Schema.number().min(0).max(4000).default(20),
  bubbleOffsetX: Schema.number().min(-1000).max(1000).default(0),
  bubbleOffsetY: Schema.number().min(-1000).max(1000).default(-10),
  bubbleBgColor: Schema.string().default('#ffffff'),
  bubbleBgOpacity: Schema.number().min(0).max(100).default(92),
  bubbleTextColor: Schema.string().default('#222222'),
})

/** 依赖服务：webServer（同源路由）、settings（隐藏自动设置页）。 */
export const inject = ['webServer', 'settings']

/** 注册宠物服务、设置 API 与素材路由。 */
export function apply(ctx: Context, config: Config): void {
  // 插件自带「桌宠配置」设置页；隐藏 0.2.x 自动生成的 Config 表单页，
  // 避免两套入口并存且表单写入会触发整插件重载（ADR-013）。
  ctx.effect(() => ctx.settings.configure({ auto: false }), 'live2d-pet: settings page policy')

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
  }
  const settingsStore = new SettingsStore(baseSettings)

  const customModelsStore = new CustomModelsStore()
  // 旧数据迁移：settings.yaml 里若还有 customModels 且新文件为空，则一次性写入 custom-models.jsonc
  if (config.customModels?.length && customModelsStore.load().models.length === 0) {
    customModelsStore.write(config.customModels)
  }
  const touchPartsStore = new TouchPartsStore()
  const service = new PetService(ctx, () => settingsStore.get(), customModelsStore, touchPartsStore)

  // 设置读写 API：Host 直连插件设置文件；写完成后经 SSE 推送新配置（ADR-006）。
  const settingsApi: SettingsRoutesApi = {
    view: () => settingsStore.view(),
    write: async (ops: readonly SettingsPathOp[]) => {
      const view = settingsStore.applyOps(ops)
      service.notifyConfigChanged()
      return view
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
      onStream: (close) => { openStreams.add(close) },
    })
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const close of openStreams) close()
      for (const dispose of disposers) dispose()
    }
  }, 'live2d-pet: routes')
}
