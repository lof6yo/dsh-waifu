/**
 * 宠物显示偏好持久化：$DSH_HOME/waifu.json（拖动位置/尺寸）。
 * v0.1 采用简单同步读写；原子写入（dsh-atomic-write）留待后续。
 * @module dsh-waifu/persist
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface PetDisplay {
  right: number
  bottom: number
  size: number
}

export const DEFAULT_DISPLAY: PetDisplay = { right: 24, bottom: 20, size: 200 }

const DISPLAY_MIN = 40
const DISPLAY_MAX = 400
/**
 * 位置偏移边界：允许负值（right/bottom 为相对视口右下角的距离），
 * 这样角色可以拖到窗口边缘外一半（spec §4 自由拖动）。
 */
const INSET_MIN = -4000
const INSET_MAX = 8000

function clamp(value: number, min: number, max: number): number {
  if (Number.isFinite(value)) return Math.min(max, Math.max(min, value))
  return min
}

/** 位置偏移归一化：非法值回 0（而不是最小负边界）。 */
function clampInset(value: number): number {
  if (Number.isFinite(value)) return Math.min(INSET_MAX, Math.max(INSET_MIN, value))
  return 0
}

/** 归一化显示配置到合法边界（持久化读取与 API 写入共用同一权威规则）。 */
export function normalizeDisplay(display: PetDisplay): PetDisplay {
  return {
    right: clampInset(display.right),
    bottom: clampInset(display.bottom),
    size: clamp(display.size, DISPLAY_MIN, DISPLAY_MAX),
  }
}

function petHomeDir(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

function petFile(): string {
  return join(petHomeDir(), 'waifu.json')
}

/**
 * 读取持久化显示配置；不存在或损坏时回退默认值。
 * @param defaults 首次运行/文件损坏时的回退值（默认位置可由设置页配置，spec §2）。
 */
export function loadPetPersist(defaults: PetDisplay = DEFAULT_DISPLAY): PetDisplay {
  return loadPetPersistDetailed(defaults).display
}

/** 读取显示配置并返回「是否已有持久化文件」（客户端首次启动据此套用「默认位置」）。 */
export function loadPetPersistDetailed(defaults: PetDisplay = DEFAULT_DISPLAY): { display: PetDisplay; saved: boolean } {
  try {
    const raw = JSON.parse(readFileSync(petFile(), 'utf8')) as Partial<PetDisplay>
    return {
      display: normalizeDisplay({
        right: raw.right ?? defaults.right,
        bottom: raw.bottom ?? defaults.bottom,
        size: raw.size ?? defaults.size,
      }),
      saved: true,
    }
  } catch {
    return { display: { ...normalizeDisplay(defaults) }, saved: false }
  }
}

/** 保存显示配置（尽力而为，失败不阻断交互）。 */
export function savePetPersist(display: PetDisplay): void {
  try {
    writeFileSync(petFile(), JSON.stringify(display, null, 2), 'utf8')
  } catch {
    // 忽略持久化失败；下次启动回退默认值。
  }
}
