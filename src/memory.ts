/**
 * 记忆文件（$DSH_HOME/waifu/memory.md，Markdown，插件私有，ADR-037）。
 *
 * 角色的长期记忆：AI 每轮可以用句尾的「[记] …」行追加一条；设置页可查看/编辑/保存。
 * 条目带时间戳前缀（与历史注入同一套 formatStamp），注入 prompt 时取最近 N 条。
 * 文件保持纯 Markdown（`- [MM/DD HH:MM] 内容` 一行一条），用户手写/手删都合法——
 * 解析只认「以 `- ` 开头的行」，其余行原样保留在文件里不动。
 * @module dsh-waifu/memory
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 与 ai.ts 同一套时间戳格式（避免 client 打包时把整个 ai.ts 拉进来，这里单独实现）。 */
function stampNow(timeZone?: string): string {
  const pad2 = (value: number) => String(value).padStart(2, '0')
  const now = new Date()
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false, hourCycle: 'h23',
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(now)
    const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? ''
    return `${Number(pick('month'))}/${Number(pick('day'))} ${pad2(Number(pick('hour')))}:${pad2(Number(pick('minute')))}`
  } catch {
    return `${now.getMonth() + 1}/${now.getDate()} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`
  }
}

/** 记忆文件名（$DSH_HOME/waifu 下）。 */
export const MEMORY_FILENAME = 'memory.md'

/** 记忆文件绝对路径。 */
export function memoryPath(homeDir: string): string {
  return join(homeDir, MEMORY_FILENAME)
}

/** 单条记忆的最大长度（字符；超长截断，防模型跑飞写小作文）。 */
export const MAX_MEMORY_CHARS = 120
/** 文件总长度上限（字符；超出时丢最旧的条目）。 */
export const MAX_MEMORY_FILE_CHARS = 20_000

/** 记忆文件头（首次创建时写入）。 */
const MEMORY_HEADER = `# 简 的记忆

这里存放桌宠自己记下的事（每行一条，带时间戳）。她记忆里在意的细节会体现在反应里。
`

/** 一条记忆。 */
export interface MemoryEntry {
  /** 原始行内容（不含 `- ` 前缀，含时间戳）。 */
  text: string
  /** 解析出的时间戳（epoch ms）；解析失败为 0（按文件顺序保留）。 */
  at: number
}

/** 读记忆文件：缺失时创建模板；解析出条目列表（其余行忽略但保留在原文里）。 */
export function loadMemory(homeDir: string): { text: string; entries: MemoryEntry[] } {
  const file = memoryPath(homeDir)
  let text = ''
  try {
    if (existsSync(file)) text = readFileSync(file, 'utf8')
    else {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, MEMORY_HEADER, 'utf8')
      text = MEMORY_HEADER
    }
  } catch {
    text = ''
  }
  return { text, entries: parseMemory(text) }
}

/**
 * 把记忆文件解析成条目列表：只认「- 」开头的行；`- [MM/DD HH:MM] 内容` 或 `- [HH:MM] 内容`
 * 里能解出时间戳的按时间排序兜底，解不出的按出现顺序（at = 0）。
 * 返回顺序 = 文件顺序（追加写在末尾）。
 */
export function parseMemory(text: string): MemoryEntry[] {
  const entries: MemoryEntry[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('- ')) continue
    const content = trimmed.slice(2).trim()
    if (!content) continue
    entries.push({ text: content, at: parseStamp(content) })
  }
  return entries
}

/** `[MM/DD HH:MM]` / `[HH:MM]` → epoch ms（相对今天/当年；解析失败 = 0）。 */
function parseStamp(content: string): number {
  const match = /^\[(\d{1,2}\/\d{1,2}\s+)?(\d{1,2}):(\d{2})\]\s*(.+)$/.exec(content)
  if (!match) return 0
  const now = new Date()
  const monthDay = match[1] ? Number(match[1].split('/')[0]) : now.getMonth() + 1
  const day = match[1] ? Number(match[1].split('/')[1]) : now.getDate()
  const hour = Number(match[2])
  const minute = Number(match[3])
  const at = new Date(now.getFullYear(), monthDay - 1, day, hour, minute).getTime()
  return Number.isFinite(at) ? at : 0
}

/** 去掉条目开头的时间戳，只留正文（比较去重时用）。 */
function stripStamp(text: string): string {
  return text.replace(/^\[[^\]]*\]\s*/, '').trim()
}

/**
 * 追加一条记忆（AI 输出的「[记] …」行；ADR-037）。
 * 时间戳用 `formatStamp`（浏览器时区由调用方传入）。
 * 最近 5 条里已有同一件事就不重复记（ADR-049：重复条目会白占注入预算）。
 * 文件超长时丢最旧的 `- ` 行（保留文件头与其余内容）。
 */
export function appendMemory(homeDir: string, note: string, timeZone?: string): void {
  const cleaned = note.replace(/\s+/g, ' ').trim().slice(0, MAX_MEMORY_CHARS)
  if (!cleaned) return
  const file = memoryPath(homeDir)
  const { text, entries } = loadMemory(homeDir)
  const duplicate = entries
    .slice(-5)
    .some((entry) => stripStamp(entry.text) === cleaned)
  if (duplicate) return
  const line = `- [${stampNow(timeZone)}] ${cleaned}`
  let next = `${text.trimEnd()}\n${line}\n`
  if (next.length > MAX_MEMORY_FILE_CHARS) {
    // 丢最旧的条目：从第一条「- 」行开始删，直到塞得下
    const lines = next.split(/\r?\n/)
    while (next.length > MAX_MEMORY_FILE_CHARS && lines.some((l) => l.trim().startsWith('- '))) {
      const index = lines.findIndex((l) => l.trim().startsWith('- '))
      lines.splice(index, 1)
      next = lines.join('\n')
    }
  }
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, next, 'utf8')
  } catch {
    // 写失败：这轮记忆丢失（不打断台词）
  }
}

/** 保存整份记忆文件（设置页编辑保存用）；空文本回写模板头。 */
export function saveMemory(homeDir: string, text: string): { text: string; path: string } {
  const file = memoryPath(homeDir)
  const value = text.trim().length > 0 ? text : MEMORY_HEADER
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, value, 'utf8')
  } catch {
    // 写失败：保持原文件
  }
  return { text: value, path: file }
}

/** 最近 N 条记忆的注入文本（oldest → newest，每行一条）。 */
export function memoryContext(entries: readonly MemoryEntry[], count: number): string {
  if (count <= 0 || entries.length === 0) return ''
  const tail = entries.slice(-count)
  return tail.map((entry) => `- ${entry.text}`).join('\n')
}
