/**
 * 插件私有数据目录与文件时间戳（settings / touch-parts / persist / client-log 共用）。
 * 路径规则：`$DSH_HOME/waifu/*`（DSH_HOME 缺失时回退 `~/.dsh`），见 spec §2。
 * @module dsh-waifu/home
 */

import { statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** DSH home 目录（与 DSH 自身解析规则一致：优先环境变量）。 */
export function petHomeDir(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** 插件私有 waifu 目录下的文件路径。 */
export function petWaifuPath(...segments: string[]): string {
  return join(petHomeDir(), 'waifu', ...segments)
}

/**
 * 文件时间戳签名（`mtimeMs:size`）：内容没变时调用方可以复用上次解析结果，
 * 避免每次读取都 readFileSync + JSONC 解析（snapshot 每次推送都要读两份配置）。
 * 读不到（不存在/无权限）返回 null，表示「不要用缓存」。
 */
export function fileStamp(path: string): string | null {
  try {
    const stat = statSync(path)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return null
  }
}
