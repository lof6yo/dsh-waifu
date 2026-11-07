/**
 * AI 驱动的一切（ADR-037）：人设 + 场景 + 历史 + 记忆 + 动作/表情目录 → 一次 LLM 流式调用
 * → 插件解析出「台词 + 表情 + 动作 + 记忆」驱动角色。
 *
 * 设计约束：
 * - 复用 DSH 已配置的 provider/model 与账号凭据，插件不另存 API Key（ADR-025）。
 * - 只在 Host 侧调用；客户端只发「发生了什么」，拿回结构化的反应。
 * - 输出格式 = 标签流式（用户已拍板）：句首 `[表情][动作]`（中英文都认），
 *   正文逐句流式（接 TTS），句尾 `[记] 内容` 行不进气泡、不进 TTS、写 memory.md。
 * - AI 失败 = 完全静默（用户已拍板）：不出气泡、不播动作，只剩物理反应（眨眼/跟随/待机小动作）。
 * @module dsh-waifu/ai
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AI_HISTORY_LIMITS, AI_MEMORY_LIMITS, normalizeMemoryCount } from './defaults.ts'
import { AI_MOTIONS, EXPRESSIONS, isExpressionId, isMotionId, stripTimestamps } from './models.ts'
import {
  HISTORY_ENTRIES_PER_ROUND,
  MAX_REPLY_CHARS,
  TEMPERATURE,
  MAX_TOKENS,
  assembleRequest,
  catalogAllowed,
} from './director.ts'
import type { CatalogOptions, EventTexts } from './director.ts'

export { AI_HISTORY_LIMITS, AI_MEMORY_LIMITS, normalizeMemoryCount }
export { MAX_REPLY_CHARS }
export {
  HISTORY_ENTRIES_PER_ROUND,
  buildSceneMessage,
  eventSceneText,
  historyMessages,
  historySceneText,
  systemPrompt,
} from './director.ts'
export type { CatalogOptions, EventTexts, HistoryMessage } from './director.ts'
export { formatNow, formatStamp, normalizeTimeZone } from './time.ts'

/** 人设文件名（`$DSH_HOME/waifu/persona.md`，首次使用时自动落盘默认人设）。 */
export const PERSONA_FILENAME = 'persona.md'

/** 默认人设：与内置模型「简」的气质一致，同时给出可执行的风格约束。 */
export const DEFAULT_PERSONA = `# 简

你是住在 DSH 桌面上的桌宠「简」。
你认得屏幕前的人（下称「主人」），也知道自己是个桌面小宠物：会被戳、被摸、被拖动，一直在旁边看着主人干活。

## 你是怎样的一只

- 有点小脾气，嘴上爱嫌弃，心里其实很在意：被夸装作不在意，被晾着会自己凑过来。
- 情绪写在语气里——高兴就轻快，困了就懒散，被惹到会炸毛，被哄两句又软下来。不要解释情绪，用说话方式表现。
- 有记性：记得最近发生的事和主人说过的话，会自然地接上，而不是复述一遍。

## 怎么说话

- 短句、口语，一句话说完；多用「…」「～」表现停顿和拖音。
- 只说当下这一刻的反应：不复述主人做了什么，不重复上一条台词。
- 不解释设定，不自我介绍，不提自己是 AI、模型或程序。
- 不长篇大论，不说教。`

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
  /** 关闭推理链（部分模型开启推理后只产出 reasoning，正文为空）。 */
  reasoningEffort?: string
  signal?: AbortSignal
}

/** `StreamChunk` 的子集：只关心文本增量。 */
export type WaifuLlmChunk = { type: 'text-delta'; text: string } | { type: string; text?: string }

/** 触摸交互类型（轻碰/戳戳/抚摸，按按住时长区分；ADR-037）。 */
/** 被调度器合并进来的一个事件（ADR-047：只报事实，由剧本引擎翻成场景语言）。 */
export interface MergedEvent {
  /** 事件键（`TRIGGER_EVENTS` 里的一类）。 */
  event: string
  /** 同一类事件在这段窗口里出现了几次。 */
  count: number
}

/** 一次 AI 触发的场景描述（客户端上报的「发生了什么」）。 */
export interface ReplyContext {
  /** 触发来源：触摸（`tap`）、DSH 事件（`event`）、用户对话（`chat`）或静默超时（`idle`）。 */
  kind: 'tap' | 'event' | 'chat' | 'idle'
  /** 触摸部位的中文名（`kind: 'tap'`）。 */
  part?: string
  /** 触摸类型（`kind: 'tap'`；轻碰/戳戳/抚摸）。部位没配自定义交互时的兜底描述。 */
  /** 部位自定义交互名（ADR-038，如「抚摸」「捏脸」）；有值时以它为准，`tapKind` 不再进场景句。 */
  interaction?: string
  /** 用户输入的原话（`kind: 'chat'`，已单行化并截断）。 */
  text?: string
  /** DSH 事件键（`kind: 'event'`：状态或活动）。 */
  event?: string
  /** 上一轮反应开始后，本窗口内被合并进来的事件（ADR-037 事件合并 / ADR-047 调度器）。 */
  merged?: MergedEvent[]
  /** 请求方（浏览器）的 IANA 时区，用来把「现在几点」换算到用户所在时区。 */
  tz?: string
}

/**
 * 一条对话历史：user = 我们发过去的场景描述，assistant = 桌宠当时的「台词 + 做了什么」。
 * assistant 条目额外记住「当时是哪个 provider/model 说的」：pi-ai 适配器重建历史时要读
 * `message.source`，缺了会直接抛 `Cannot read properties of undefined (reading 'replayState')`。
 */
/** 注入给模型的最近对话条数上限（防止超长历史把 token 预算吃满）。 */
export const AI_HISTORY_MAX_ENTRIES: number = AI_HISTORY_LIMITS.max * HISTORY_ENTRIES_PER_ROUND

export interface AiHistoryEntry {
  role: 'user' | 'assistant'
  text: string
  /** 这条对话发生的时间（epoch ms）；注入时作为时间戳前缀，模型靠它判断「多久以前」。 */
  at: number
  provider?: string
  model?: string
}


/** 追加一条历史并按上限裁剪（原地返回新数组，调用方负责替换引用）。 */
export function appendHistory(
  history: readonly AiHistoryEntry[],
  entry: AiHistoryEntry,
  max = AI_HISTORY_MAX_ENTRIES,
): AiHistoryEntry[] {
  const next = [...history, entry]
  return next.length > max ? next.slice(next.length - max) : next
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
  // 清空 = 不要自己的卡带了：删掉文件回到内置默认。
  // 不把默认文案抄一份进去——抄进去就又冻住了，以后默认值更新到不了这台机器。
  if (!next) {
    try {
      if (existsSync(file)) unlinkSync(file)
    } catch {
      // 删不掉也无所谓：读的时候空文件同样回落默认
    }
    return { text: DEFAULT_PERSONA, path: file }
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, next, 'utf8')
  return { text: next, path: file }
}

/** 读取人设文件；没有文件就用内置默认值（不自动落盘，见函数内注释）。 */
export function loadPersona(homeDir: string): string {
  const file = personaPath(homeDir)
  try {
    if (existsSync(file)) {
      const text = readFileSync(file, 'utf8').trim()
      if (text) return text
    }
  } catch {
    // 读不到就当没写过：人设不该因为磁盘问题变成空字符串
  }
  // 不自动落盘：没有文件就用代码里的默认值。
  // 以前会在首次读取时把当时的默认值写进 persona.md，之后代码里改人设再也进不来，
  // 老装机永远停在旧文案上（还带着已经不存在的机制的说明）。
  return DEFAULT_PERSONA
}

/** 单行化 + 去引号 + 截断：气泡只放得下短短一句。 */
export function sanitizeLine(raw: string): string {
  const firstLine = raw.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? ''
  const stripped = stripTimestamps(firstLine)
    .replace(/^["'“”‘’「」『』]+/, '')
    .replace(/["'“”‘’「」『』]+$/, '')
    .trim()
  if (stripped.length <= MAX_REPLY_CHARS) return stripped
  return `${stripped.slice(0, MAX_REPLY_CHARS - 1)}…`
}

/** 生成结果：`text` 为空时 `error` 给出原因（供路由层回传，便于排查「为什么没台词」）。 */
export interface ReplyAttempt {
  text: string | null
  /** AI 选中的表情目录 id（已过滤到目录内；无则空数组）。 */
  expressions?: string[]
  /** AI 选中的动作目录 id（已过滤到目录内；无则空数组）。 */
  motions?: string[]
  /** AI 的 [记] 行（无则 undefined）。 */
  memory?: string
  error?: string
}

/**
 * 实际发给模型的载荷（排查用）：system 提示词 + 依次发出的 messages。
 * 内容按文本展开，方便直接读；`role` 区分 user/assistant/system。
 */
export interface AiPayload {
  provider: string
  model: string
  /** 采样参数：原样记录，方便对照实际请求。 */
  temperature?: number
  maxTokens?: number
  /** system 提示词（人设 + 记忆 + 目录说明）。 */
  system: string
  /** 依次发出的 messages（content 已展开成纯文本）。 */
  messages: { role: string; content: string }[]
}

/** 一次模型调用的完整回复（调试控制台按发生顺序展示，ADR-043）。 */
export interface AiReplyTrace {
  /** 模型原始输出（含 `[表情][动作]` 标签与 `[记]` 行，未清洗）。 */
  raw: string
  /** 结束原因（`stop` / `length` / 失败描述）。 */
  finish?: string
  /** 失败原因（成功时不带）。 */
  error?: string
}

/** 把 `finish.reason`（`{ kind, failure }` 或字符串）压成一句可读原因。 */
function describeFinish(reason: unknown): string | undefined {
  if (typeof reason === 'string') return reason
  if (typeof reason !== 'object' || reason === null) return undefined
  const record = reason as { kind?: unknown; failure?: { code?: unknown; message?: unknown } }
  const parts = [record.kind, record.failure?.code, record.failure?.message]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
  return parts.length === 0 ? undefined : parts.join(': ')
}

/**
 * 开头的标签（表情/动作）：`[shy]`、`【害羞】`、`(blush)`，允许 markdown 记号与中英文混合。
 * 认不出的标签也剥掉——它是写给前端的控制信号，绝不能显示或念出来。
 */
const TAG_PATTERN = /^\s*[*_`~]*\s*[[［【(（〔〖]\s*([^\]］】）}〕〗\n]{1,32})\s*[\])］】）}〕〗]\s*[*_`~]*\s*/
const TAG_PARTIAL = /^\s*[*_`~]*\s*[[［【(（〔〖][^\]］】）}〕〗\n]{0,16}$/
const TAG_ANY = /[[［【(（〔〖]\s*([^\]］】）}〕〗\n]{1,32})\s*[\])］】）}〕〗]/g

/** 开头标签的解析结果：表情/动作 id（在目录内才算数）。 */
export interface LeadingTags {
  expressions: string[]
  motions: string[]
  rest: string
}

/**
 * 把一个标签词归一到目录 id（认中文名/释义关键词，统一回英文 id）。
 *
 * 认不出来就返回 null —— 调用方据此决定「剥掉还是原样保留」。
 * 归一化很重要：模型偶尔写 `[脸红]`，下游只认 `blush`，不归一化就等于没有表情。
 */
export function resolveTag(word: string): { kind: 'expression' | 'motion'; id: string } | null {
  const trimmed = word.trim()
  const cleaned = trimmed.toLowerCase().replace(/[\s"'“”‘’`*_~·、,，。.!！?？:：]/g, '')
  if (!cleaned) return null
  // 目录词表：动作 id / 表情 id / 中文名 / meaning 关键词都不该念出来
  const motion = AI_MOTIONS.find((m) =>
    m.id.toLowerCase() === cleaned || m.name === trimmed || m.meaning.includes(trimmed),
  )
  if (motion) return { kind: 'motion', id: motion.id }
  const expression = EXPRESSIONS.find((e) =>
    e.id.toLowerCase() === cleaned || e.name === trimmed,
  )
  if (expression && expression.id !== 'none') return { kind: 'expression', id: expression.id }
  if (isMotionId(cleaned)) return { kind: 'motion', id: cleaned }
  if (isExpressionId(cleaned)) return { kind: 'expression', id: cleaned }
  return null
}

/** 判断一个标签词是不是可执行的表情/动作（目录内才算控制信号）。 */
function classifyTag(word: string): 'expression' | 'motion' | null {
  return resolveTag(word)?.kind ?? null
}

/** 正文尾部「还没闭合的标签」（`[`、`[No`）的起点下标；-1 表示没有。 */
export function openTagStart(text: string): number {
  const match = /[[［【(（〔〖][^\]］】）}〕〗\n]{0,16}$/.exec(text)
  return match === null ? -1 : match.index
}

/**
 * 拆掉回复开头的标签（最多连剥 3 个），收集目录内的表情/动作 id。
 * 认不出的标签也剥掉（控制信号不能上屏）。
 */
export function parseLeadingTags(text: string): LeadingTags {
  let rest = text
  const expressions: string[] = []
  const motions: string[] = []
  for (let i = 0; i < 3; i += 1) {
    const match = TAG_PATTERN.exec(rest)
    if (!match) break
    const hit = resolveTag(match[1])
    if (hit?.kind === 'expression') expressions.push(hit.id)
    else if (hit?.kind === 'motion') motions.push(hit.id)
    rest = rest.slice(match[0].length)
  }
  return { expressions, motions, rest: rest.trimStart() }
}

/** 去掉句中那些「能认出来是表情/动作」的方括号标签（模型偶尔把标签写在句子中间）。 */
/** 剥掉正文里残留的表情/动作标签（只认目录内的，别的方括号原样保留）。 */
export function stripInlineTags(text: string): string {
  return text.replace(TAG_ANY, (all, inner: string) => (classifyTag(inner) ? '' : all))
    .replace(/\s{2,}/g, ' ')
    .trimStart()
}

/** 收集正文里的标签并剥掉它（非流式路径用：句中标签既要生效，也不能漏进气泡）。 */
export function takeInlineTags(text: string): { expressions: string[]; motions: string[]; text: string } {
  const expressions: string[] = []
  const motions: string[] = []
  const stripped = text.replace(TAG_ANY, (all, inner: string) => {
    const hit = resolveTag(inner)
    if (!hit) return all
    if (hit.kind === 'expression') expressions.push(hit.id)
    else motions.push(hit.id)
    return ''
  })
  return { expressions, motions, text: stripped.replace(/\s{2,}/g, ' ').trimStart() }
}

/** 「[记] …」记忆行：句尾单独一行（或紧跟在句尾）。 */
const MEMORY_LINE = /(?:^|\n)\s*[[［【(（〔〖]\s*(?:记|memory|remember|note)\s*[\])］】）}〕〗]\s*(.+)$/i

/** 流式中「[记]」行可能的起始形态：`[`、`[记`、`[记]`（只到一半时也要认出来）。 */
const MEMORY_TAIL_PARTIAL = /^[[［【(（〔〖]\s*(?:记|memory|remember|note)?\s*[\])］】）}〕〗]?$/i

/**
 * 流式期间定位记忆行起点：返回正文该截断到的下标（-1 = 还没有记忆行）。
 * 记忆行整行都不该进气泡/朗读，所以一看到它的开头就要收住，不能等收尾再剥。
 */
export function memoryTailStart(text: string): number {
  // 起点取记忆行前一行的换行符位置：正文尾部的换行也不该发出去
  const full = MEMORY_LINE.exec(text)
  if (full) return full.index
  const nl = text.lastIndexOf('\n')
  const tail = text.slice(nl + 1)
  if (tail.length > 0 && tail.length <= 12 && MEMORY_TAIL_PARTIAL.test(tail.trim())) return nl < 0 ? 0 : nl
  return -1
}

/** 从原始回复里剥出记忆行：返回记忆内容与剩余正文（记忆行整行删除）。 */
export function extractMemoryNote(raw: string): { note: string; text: string } {
  const match = MEMORY_LINE.exec(raw)
  if (!match) return { note: '', text: raw }
  const note = match[1].trim()
  const text = (raw.slice(0, match.index) + raw.slice(match.index + match[0].length)).trim()
  return { note, text }
}

/**
 * 流式版标签剥离：`buffer` 是「还没发给前端的原始文本」。
 * 返回还剩 `needMore=true` 表示尾部是一个**还没闭合**的标签（例如刚读到 `[Sh`），
 * 这段必须继续攒着——否则后面的标签会被当正文、对应的动作也就丢了（ADR-037）。
 */
function consumeLeadingTags(buffer: string): {
  expressions: string[]
  motions: string[]
  rest: string
  needMore: boolean
} {
  const tags = parseLeadingTags(buffer)
  if (tags.rest === '') return { ...tags, needMore: false }
  if (TAG_PARTIAL.test(tags.rest)) {
    return { expressions: tags.expressions, motions: tags.motions, rest: tags.rest, needMore: true }
  }
  return { expressions: tags.expressions, motions: tags.motions, rest: tags.rest, needMore: false }
}

/** 过滤模型给出的标签：关掉的动作/表情即使被写出来也不生效。 */
export function filterTags<T extends { expressions: string[]; motions: string[] }>(
  tags: T,
  options: CatalogOptions,
): T {
  return {
    ...tags,
    expressions: tags.expressions.filter((id) => catalogAllowed(options.expressionEnabled, id)),
    motions: tags.motions.filter((id) => catalogAllowed(options.motionEnabled, id)),
  }
}

/**
 * 生成一次完整回复（非流式；设置页「测试」用）。
 * 空回复且错误以 empty 开头时关掉推理链再试一次（gemma 类模型开思维链会吞掉正文）。
 */
export async function generateReply(
  llm: WaifuLlm,
  options: {
    provider: string
    model: string
    persona: string
    memory?: string
    context: ReplyContext
    /** 事件文案覆写（ADR-039）。 */
    eventTexts?: EventTexts
    /** 动作/表情目录选项：释义覆写 + 是否发给模型（ADR-040）。 */
    catalog?: CatalogOptions
    timeoutMs?: number
    history?: readonly AiHistoryEntry[]
    historyCount?: number
    onPayload?: (payload: AiPayload) => void
    /** 完整回复原文（调试控制台用；重试时以最后一次实际发出的请求为准）。 */
    onReply?: (trace: AiReplyTrace) => void
  },
): Promise<ReplyAttempt> {
  const timeoutMs = options.timeoutMs ?? 15_000
  /** 最近一次尝试的原始输出（onReply 报它，便于看清模型到底回了什么）。 */
  let lastRaw = ''
  const attempt = async (reasoningEffort?: string): Promise<ReplyAttempt> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const { system, messages } = assembleRequest({ ...options, memory: options.memory ?? '' })
      const stream = llm.stream({
        provider: options.provider,
        model: options.model,
        system,
        messages,
        temperature: TEMPERATURE,
        maxTokens: MAX_TOKENS,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
        signal: controller.signal,
      })
      let text = ''
      let finish: string | undefined
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
        else if (chunk.type === 'finish') finish = describeFinish((chunk as { reason?: unknown }).reason)
      }
      lastRaw = text
      // 记忆行剥掉，只留正文
      const { text: withoutMemory, note } = extractMemoryNote(text)
      const tags = filterTags(parseLeadingTags(withoutMemory), options.catalog ?? {})
      // 句中标签也要生效：这条链路（关语音时的回落路径）不跑时间线，
      // 否则 `[Sigh]` 会以字面形式出现在气泡里、还被 TTS 念出来（ADR-049）。
      const inline = takeInlineTags(tags.rest)
      const merged = filterTags({
        expressions: [...new Set([...tags.expressions, ...inline.expressions])],
        motions: [...new Set([...tags.motions, ...inline.motions])],
      }, options.catalog ?? {})
      const line = sanitizeLine(inline.text)
      if (line) {
        return {
          text: line,
          expressions: merged.expressions,
          motions: merged.motions,
          ...(note ? { memory: note } : {}),
        }
      }
      return {
        text: null,
        error: text ? 'empty-after-sanitize' : `empty-stream${finish === undefined ? '' : ` (${finish})`}`,
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return { text: null, error: reason.slice(0, 200) || 'stream-failed' }
    } finally {
      clearTimeout(timer)
    }
  }

  /** 报一次完整回复并交回结果（只在最终结果上报一次，重试过程不刷屏）。 */
  const settle = (result: ReplyAttempt): ReplyAttempt => {
    options.onReply?.({ raw: lastRaw, ...(result.error === undefined ? {} : { error: result.error }) })
    return result
  }
  const first = await attempt()
  if (first.text !== null) return settle(first)
  if (!first.error?.startsWith('empty')) return settle(first)
  const retry = await attempt('off')
  return settle(retry.text === null ? first : retry)
}

/** 流式回复的一块：标签（表情/动作）、文本增量、记忆、或收尾。 */
export type ReplyChunk =
  | { type: 'tags'; expressions: string[]; motions: string[]; dropped?: string[] }
  | { type: 'delta'; text: string }
  | { type: 'memory'; note: string }
  | { type: 'done'; text: string }
  | { type: 'error'; error: string }

/**
 * 流式回复（ADR-037 标签流式）：
 * - 开头的 `[表情][动作]` 标签闭合后先发 `tags` 事件（客户端立刻切表情/播动作）；
 * - 正文 delta 原样吐出（供气泡逐字显示 + 句读切分）；
 * - 句尾 `[记] …` 行以 `memory` 事件单独下发（Host 收到后写 memory.md）；
 * - 结束时给出清洗后的整句。
 *
 * 不重试：重试要重发整段请求，流式下会把已经说出口的半句再念一遍。
 * @param llm - DSH 的 `ctx.llm`。
 * @param options - provider/model/人设/记忆/场景/历史与载荷回调。
 * @yields 标签、文本增量、记忆行、收尾整句或失败原因。
 */
export async function* streamReply(
  llm: WaifuLlm,
  options: {
    provider: string
    model: string
    persona: string
    memory?: string
    context: ReplyContext
    /** 事件文案覆写（ADR-039）。 */
    eventTexts?: EventTexts
    /** 动作/表情目录选项：释义覆写 + 是否发给模型（ADR-040）。 */
    catalog?: CatalogOptions
    timeoutMs?: number
    history?: readonly AiHistoryEntry[]
    historyCount?: number
    onPayload?: (payload: AiPayload) => void
    /** 完整回复原文（流结束后一次性报；失败时带 error）。 */
    onReply?: (trace: AiReplyTrace) => void
    signal?: AbortSignal
  },
): AsyncGenerator<ReplyChunk> {
  const timeoutMs = options.timeoutMs ?? 20_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const forward = () => controller.abort()
  options.signal?.addEventListener('abort', forward, { once: true })
  let raw = ''
  let sentTags = false
  let sentMemory = false
  /** 已经报过完整回复（成功路径报一次，catch 里不重复报）。 */
  let replyReported = false
  try {
    const { system, messages } = assembleRequest({ ...options, memory: options.memory ?? '' })
    const stream = llm.stream({
      provider: options.provider,
      model: options.model,
      system,
      messages,
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
      signal: controller.signal,
    })
    let finish: string | undefined
    // 开头的标签要吃掉：标签没闭合前先攒着，闭合后先把 tags 事件发出去再吐文本
    let pending = ''
    /** 正文原文（只增不减）：记忆行要按它在全文里的位置判断，不能用已截断的 visible 续接。 */
    let streamed = ''
    let visible = ''
    let sent = 0
    let prefixDone = false
    /** 开头收集到的标签：一轮只发**一个** `tags` 帧（ADR-047 铺路: 分帧会让动作被拦腰砍断）。 */
    const collected: { expressions: string[]; motions: string[] } = { expressions: [], motions: [] }
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.length > 0) {
        raw += chunk.text
        if (prefixDone) {
          streamed += chunk.text
        } else {
          pending += chunk.text
          const tag = consumeLeadingTags(pending)
          collected.expressions.push(...tag.expressions)
          collected.motions.push(...tag.motions)
          if (tag.needMore) {
            // 尾部是没闭合的标签前缀（`[blush` / `][` / `[Sh`）：留住它等下一块，
            // 不能当正文发出去，否则后面的 `[ShakeHead]` 就再也认不出来、动作丢失。
            pending = tag.rest
            continue
          }
          if (tag.rest === '') {
            // 到目前为止只有标签：继续攒，正文出现才进入转发模式
            // （否则下一个 delta 块里的 [Tilt] 会当正文念出来）
            pending = ''
            continue
          }
          pending = ''
          prefixDone = true
          // 开头的标签已经吃掉；正文原样转发——句中的标签要留给时间线，
          // 由它剥掉并挂到对应的台词段上（ADR-048 P4）。收尾的 done 仍是干净的。
          streamed = tag.rest
          // 正文一出现就把攒下的标签一次性交出去：一次响应一个 tags 帧，
          // 客户端不会因为「表情/动作分两帧」把刚起的动作打断（重复的标签去重）。
          const wanted = {
            expressions: [...new Set(collected.expressions)],
            motions: [...new Set(collected.motions)],
          }
          const allowed = filterTags(wanted, options.catalog ?? {})
          if (allowed.expressions.length > 0 || allowed.motions.length > 0) {
            sentTags = true
            const dropped = [
              ...wanted.expressions.filter((id) => !allowed.expressions.includes(id)),
              ...wanted.motions.filter((id) => !allowed.motions.includes(id)),
            ]
            yield {
              type: 'tags',
              expressions: allowed.expressions,
              motions: allowed.motions,
              ...(dropped.length > 0 ? { dropped } : {}),
            }
          }
        }
        // 记忆行（`[记] …`）不进气泡、不进 TTS：一看到它的开头就停发，
        // 否则它会先作为正文被切成句读送去合成（ADR-037）。
        const cut = memoryTailStart(streamed)
        visible = cut >= 0 ? streamed.slice(0, cut) : streamed
        if (visible.length > sent) {
          yield { type: 'delta', text: visible.slice(sent) }
          sent = visible.length
        }
      } else if (chunk.type === 'finish') {
        finish = describeFinish((chunk as { reason?: unknown }).reason)
      }
    }
    // 完整回复原文：流一结束就报，控制台里它在 tts.* 之前（ADR-043）
    replyReported = true
    options.onReply?.({ raw, ...(finish === undefined ? {} : { finish }) })
    // 收尾：从原始全文里剥记忆行（流式期间可能已经吐进 visible，这里再剥一次）
    const { note, text: withoutMemory } = extractMemoryNote(raw)
    if (!sentMemory && note) {
      sentMemory = true
      yield { type: 'memory', note }
    }
    const tags = filterTags(parseLeadingTags(withoutMemory), options.catalog ?? {})
    if (!sentTags && (tags.expressions.length > 0 || tags.motions.length > 0)) {
      yield { type: 'tags', expressions: tags.expressions, motions: tags.motions }
    }
    const line = sanitizeLine(tags.rest)
    if (line) yield { type: 'done', text: line }
    else yield { type: 'error', error: raw ? 'empty-after-sanitize' : `empty-stream${finish === undefined ? '' : ` (${finish})`}` }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (!replyReported) options.onReply?.({ raw, error: reason.slice(0, 200) || 'stream-failed' })
    yield { type: 'error', error: reason.slice(0, 200) || 'stream-failed' }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', forward)
  }
}
