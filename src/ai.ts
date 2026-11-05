/**
 * AI 回复（ADR-025）：人设文件 + 情景提示 → DSH LLM（`ctx.llm`）流式接口 → 一句台词。
 *
 * 设计约束：
 * - 复用 DSH 已配置的 provider/model 与账号凭据，插件不另存 API Key（ADR-025）。
 * - 只在 Host 侧调用；客户端只发「发生了什么」，拿回一句文本填进气泡。
 * - 台词必须短、单行、无旁白：`sanitizeLine` 统一裁剪，超时/失败由调用方回落预置台词池。
 * @module dsh-waifu/ai
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 一句台词的长度上限（UTF-16 单元；气泡宽度有限，spec §4）。 */
export const MAX_REPLY_CHARS = 60

/** 人设文件名（`$DSH_HOME/waifu/persona.md`，首次使用时自动落盘默认人设）。 */
export const PERSONA_FILENAME = 'persona.md'

/** 默认人设：与内置模型「简」的气质一致，同时给出可执行的风格约束。 */
export const DEFAULT_PERSONA = `# 简

你是住在 DSH 桌面上的桌宠「简」：一位有点小毒舌、爱撒娇、嘴上嫌弃但很黏人的少女。
你认得主人（DSH 的使用者），知道自己是桌面宠物，会被戳、被摸、被拖动。

说话风格：
- 短句口语，一句话说完，多用「…」「～」表现停顿和拖音。
- 被戳到敏感部位会害羞/炸毛，被摸头会软下来，被夸会装作不在意。
- 不要长篇大论，不要解释设定，不要复述主人做了什么。
- 不要自称 AI、模型或程序。`

/** `ctx.llm` 的最小结构面（只用到流式接口，避免绑定具体类型版本）。 */
export interface WaifuLlm {
  stream(options: WaifuLlmRequest): AsyncIterable<WaifuLlmChunk>
}

/** `GenerateOptions` 的子集：手写一次性请求只需要这些字段。 */
export interface WaifuLlmRequest {
  provider: string
  model: string
  system?: string
  messages: { role: string; content: readonly unknown[] }[]
  temperature?: number
  maxTokens?: number
  stop?: string[]
  signal?: AbortSignal
}

/** `StreamChunk` 的子集：只关心文本增量。 */
export type WaifuLlmChunk = { type: 'text-delta'; text: string } | { type: string; text?: string }

/** 一次回复请求的描述（客户端上报的「发生了什么」）。 */
export interface ReplyContext {
  /** 触发来源：触摸部位（`tap`）或状态变化（`state`）。 */
  kind: 'tap' | 'state'
  /** 触摸部位的中文名（`kind: 'tap'`）。 */
  part?: string
  /** 当前宠物状态（idle/thinking/...）。 */
  state?: string
  /** 该部位/事件原本会说的一句话（作为语气参考，不要求复述）。 */
  hint?: string
}

/** 人设文件的人设长度上限（字符）：够写一大段设定，也挡住误粘贴的超大文本。 */
export const MAX_PERSONA_CHARS = 8_000

/** 人设文件绝对路径（`$DSH_HOME/waifu/persona.md`）。 */
export function personaPath(homeDir: string): string {
  return join(homeDir, PERSONA_FILENAME)
}

/** 写入人设文件（设置页保存用）；超长截断，空白落盘默认人设。 */
export function savePersona(homeDir: string, text: string): { text: string; path: string } {
  const file = personaPath(homeDir)
  const next = text.trim().slice(0, MAX_PERSONA_CHARS)
  const value = next || DEFAULT_PERSONA
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, value, 'utf8')
  return { text: value, path: file }
}

/** 读取人设文件；缺失时写入默认人设。读取失败回落到内置默认值。 */
export function loadPersona(homeDir: string): string {
  const file = personaPath(homeDir)
  try {
    if (existsSync(file)) {
      const text = readFileSync(file, 'utf8').trim()
      if (text) return text
    }
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, DEFAULT_PERSONA, 'utf8')
    return DEFAULT_PERSONA
  } catch {
    return DEFAULT_PERSONA
  }
}

/** 拼「现在发生了什么」的用户消息（模型只看这一句就能接话）。 */
export function buildSceneMessage(context: ReplyContext): string {
  const state = context.state ?? 'idle'
  const where = context.kind === 'tap'
    ? `主人刚戳了你的「${context.part || '身体'}」`
    : `当前状态是「${state}」（${
      state === 'thinking' ? '主人在等你想事情'
        : state === 'error' ? '出错了，气氛有点僵'
          : state === 'done' ? '事情办完了'
            : state === 'waiting' ? '主人正在等你确认'
              : state === 'delivered' ? '主人刚交付了成果'
                : '主人在看着你'
    }）`
  const hint = context.hint ? `你原本会说的台词是：「${context.hint}」，可以换个说法。` : ''
  return `（${where}。${hint}）请用一句话回应。`
}

/** 单行化 + 去引号 + 截断：气泡只放得下短短一句。 */
export function sanitizeLine(raw: string): string {
  const firstLine = raw.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? ''
  const stripped = firstLine
    .replace(/^["'“”‘’「」『』]+/, '')
    .replace(/["'“”‘’「」『』]+$/, '')
    .trim()
  if (stripped.length <= MAX_REPLY_CHARS) return stripped
  return `${stripped.slice(0, MAX_REPLY_CHARS - 1)}…`
}

/** 生成一条台词；超时、无文本或抛错时返回 null（调用方回落预置台词）。 */
export async function generateReply(
  llm: WaifuLlm,
  options: {
    provider: string
    model: string
    persona: string
    context: ReplyContext
    timeoutMs?: number
  },
): Promise<string | null> {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 12_000
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const stream = llm.stream({
      provider: options.provider,
      model: options.model,
      system: `${options.persona}

输出要求：只输出一句中文台词，不超过 ${MAX_REPLY_CHARS} 字，单行，不要引号、不要旁白、不要括号动作描写、不要解释。`,
      messages: [{ role: 'user', content: [{ type: 'text', text: buildSceneMessage(options.context) }] }],
      temperature: 1,
      maxTokens: 80,
      stop: ['\n'],
      signal: controller.signal,
    })
    let text = ''
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
    }
    const line = sanitizeLine(text)
    return line || null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
