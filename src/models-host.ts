/**
 * Host 侧模型清单读取与解析：内置 presets.jsonc（JSONC 支持注释）由 Node 读取。
 * 本模块不可被 client 打包引入（依赖 node:fs / node:path / node:url）。
 * 共享类型与默认值见 `models.ts`。
 * ADR-037：animationMap/DEFAULT_MOTION_MAP 已删——状态动画槽位只由 AI 选目录动作驱动；
 * 这里只保留 preset id → modelUrl / 默认触摸部位两组解析。
 * @module dsh-waifu/models-host
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type BuiltinPreset,
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
 * 按当前选中模型解析「默认触摸部位」（内置 preset 随包提供的默认值）：
 * 用户保存过自定义部位时由 TouchPartsStore 覆盖，这里只给回退值。
 * 部位只含 id/name/boxes（ADR-037）。
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
