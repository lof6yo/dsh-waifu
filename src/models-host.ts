/**
 * Host 侧模型清单读取与解析：内置 presets.jsonc（JSONC 支持注释）由 Node 读取。
 * 本模块不可被 client 打包引入（依赖 node:fs / node:path / node:url）。
 * 共享类型与默认值见 `models.ts`。
 * @module dsh-waifu/models-host
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_MOTION_MAP,
  type BuiltinPreset,
  type MotionMap,
  type TouchPart,
} from './models.ts'

/** 简易 JSONC 解析：去掉行注释和块注释（字符串内的注释保留）后 JSON.parse。 */
function parseJsonc(text: string): unknown {
  let out = ''
  let inString = false
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]
    if (inString) {
      out += ch
      if (ch === '\\') {
        out += next ?? ''
        i++
      } else if (ch === quote) {
        inString = false
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = true
      quote = ch
      out += ch
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i + 1 < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
      continue
    }
    out += ch
  }
  return JSON.parse(out)
}

/** 包根目录（从本模块位置解析：源码测试时指向仓库根，构建后 lib/ 的上一级即包根）。 */
function packageRoot(): string {
  return fileURLToPath(new URL('../', import.meta.url))
}

const presetsData = parseJsonc(
  readFileSync(join(packageRoot(), 'src/presets/presets.jsonc'), 'utf8'),
) as { presets: BuiltinPreset[] }

/** 内置策展清单（只读，来自 presets.jsonc）。 */
export function listBuiltinPresets(): BuiltinPreset[] {
  return presetsData.presets
}

/** 默认内置模型 id（presets.jsonc 第一条；配置里的旧模型 id 失配时也回退到它）。 */
export function defaultModelId(): string {
  return presetsData.presets[0]?.id ?? 'jian'
}

/**
 * 按当前模型解析生效状态动画映射：内置 preset 的 animationMap 覆盖默认映射。
 * 只做浅合并：配置过的槽位覆盖，未配置槽位沿用默认。
 */
export function resolveMotionMap(model: string): MotionMap {
  const preset = presetsData.presets.find((p) => p.id === model)
  if (preset?.animationMap) return { ...DEFAULT_MOTION_MAP, ...preset.animationMap }
  return { ...DEFAULT_MOTION_MAP }
}

/**
 * 按当前选中模型解析「默认触摸部位」（内置 preset 随包提供的默认值）：
 * 用户保存过自定义部位时由 TouchPartsStore 覆盖，这里只给回退值。
 */
export function resolveDefaultTouchParts(model: string): TouchPart[] {
  const preset = presetsData.presets.find((p) => p.id === model)
  return preset?.touchParts ? preset.touchParts.map((part) => ({ ...part })) : []
}

/**
 * 把 `config.model` 解析为可加载的 `.model3.json` URL：
 * - preset id → presets.jsonc 匹配
 * - 旧配置里的失效模型 id → 回退默认内置模型（避免升级后宠物空白）
 */
export function resolveModelUrl(model: string): string | null {
  const preset = presetsData.presets.find((p) => p.id === model)
  if (preset) return preset.modelUrl
  const fallback = presetsData.presets[0]
  return fallback ? fallback.modelUrl : null
}
