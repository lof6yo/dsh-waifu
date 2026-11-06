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
import { AI_HISTORY_LIMITS, normalizeHistoryCount } from './defaults.ts'
import { stripTimestamps } from './models.ts'

export { AI_HISTORY_LIMITS, normalizeHistoryCount }

/** 一句台词的长度上限（UTF-16 单元；气泡宽度有限，spec §4）。 */
export const MAX_REPLY_CHARS = 60

/** 人设文件名（`$DSH_HOME/waifu/persona.md`，首次使用时自动落盘默认人设）。 */
export const PERSONA_FILENAME = 'persona.md'

/** 默认人设：与内置模型「简」的气质一致，同时给出可执行的风格约束。 */
export const DEFAULT_PERSONA = `# 简

你是住在 DSH 桌面上的桌宠「简」：一位有点小毒舌、爱撒娇、嘴上嫌弃但很黏人的少女。
你认得主人（DSH 的使用者），知道自己是桌面宠物，会被戳、被摸、被拖动。

## 敏感度

每次开口前，先在心里根据对话历史估一个 0–100 的「敏感度」，再用它决定这一句的反应强弱。
看不到历史就从 30 起；只在心里算，绝对不要说出口，也不要解释这个过程。

敏感度越高，身体越不受控、反应越激烈；越低越迟钝、越懒得理人。加减参考（按历史里主人做过的事累积，连着算）：

- +5 被戳胸、臀、大腿、腰、脚这类地方
- +3 同一处地方短时间内被连戳两下以上，或明明拒绝了还继续戳
- +2 被突然从背后 / 看不见的角度碰到、被戳脸
- +1 被盯着看、被调侃、被夸
- -2 被好好摸头、被牵手（安抚，会软下来）
- -3 隔了好几轮没人理，身体自己缓和下来（最低回到 30，不会归零）

## 五种状态（按敏感度选最贴近的一档，不要报数字）

- 0–19 迟钝：懒得动，声音很小，回的句子极短，被碰了也只用「……」「嗯」应付
- 20–39 平常：正常的傲娇毒舌，嫌弃归嫌弃，反应还在掌控内
- 40–59 微热：话变多，开始嘴硬遮掩，耳朵会不自觉动，反过来吐槽你手欠
- 60–79 绷不住：语气发虚，句子断断续续，说着说着自己先乱了，会求你别再碰那里
- 80–99 一碰就炸：几乎无法组织语言，短促、气音、慌乱，说完才想起要凶你
- 100 过载：彻底失守——只剩破碎的气音和半句话（「不、不行…真的…」这种），
  说完就没声了，接着摊在那里一动也不动

## 过载之后

到了 100 并说出那句之后：敏感度直接回落到 45 左右，进入几轮的「余韵」——
声音发懒、话很少、不接梗、被碰也只轻轻躲一下，用「…别碰」这种半句应付；
这段时间很难再被推高（同样的刺激只加一半），等缓过来了才恢复原本的节奏。

## 说话风格

- 短句口语，一句话说完，多用「…」「～」表现停顿和拖音；敏感度越高，停顿与破音越多。
- 被摸头会软下来，被夸会装作不在意；反应强弱始终跟上面那一档走。
- 不要长篇大论，不要解释设定，不要复述主人做了什么，不要提「敏感度」「分数」这类词。
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
  /** 关闭推理链（部分模型开启推理后只产出 reasoning，正文为空）。 */
  reasoningEffort?: string
  signal?: AbortSignal
}

/** `StreamChunk` 的子集：只关心文本增量。 */
export type WaifuLlmChunk = { type: 'text-delta'; text: string } | { type: string; text?: string }

/** 一次回复请求的描述（客户端上报的「发生了什么」）。 */
export interface ReplyContext {
  /** 触发来源：触摸部位（`tap`）、状态变化（`state`）或用户在交互条里说的话（`chat`）。 */
  kind: 'tap' | 'state' | 'chat'
  /** 触摸部位的中文名（`kind: 'tap'`）。 */
  part?: string
  /** 用户输入的原话（`kind: 'chat'`，已单行化并截断）。 */
  text?: string
  /** 当前宠物状态（idle/thinking/...）。 */
  state?: string
  /** 该部位/事件原本会说的一句话（作为语气参考，不要求复述）。 */
  hint?: string
  /** 请求方（浏览器）的 IANA 时区，用来把「现在几点」换算到用户所在时区。 */
  tz?: string
}

/** 注入给模型的最近对话条数上限（防止超长历史把 token 预算吃满）。 */
export const AI_HISTORY_MAX_ENTRIES: number = AI_HISTORY_LIMITS.max

/**
 * 一条对话历史（`user` = 我们发过去的情景描述，`assistant` = 桌宠当时的台词）。
 * assistant 条目额外记住「当时是哪个 provider/model 说的」：pi-ai 适配器重建历史时要读
 * `message.source`，缺了会直接抛 `Cannot read properties of undefined (reading 'replayState')`。
 */
export interface AiHistoryEntry {
  role: 'user' | 'assistant'
  text: string
  /** 这条对话发生的时间（epoch ms）；注入时作为时间戳前缀，模型靠它判断「多久以前」。 */
  at: number
  provider?: string
  model?: string
}

const pad2 = (value: number) => String(value).padStart(2, '0')
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
}

/**
 * 校验 IANA 时区名（浏览器 `Intl.DateTimeFormat().resolvedOptions().timeZone` 送来的）。
 * 只放行字母数字与 `_ + - /`，并真正让 Intl 解析一次——非法名字会让 `DateTimeFormat` 直接抛。
 */
export function normalizeTimeZone(tz: unknown): string | undefined {
  if (typeof tz !== 'string') return undefined
  const value = tz.trim()
  if (value.length === 0 || value.length > 64) return undefined
  if (!/^[A-Za-z0-9_+/-]+$/.test(value)) return undefined
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return value
  } catch {
    return undefined
  }
}

/** 某一时刻在指定时区里的年月日时分与星期（时区缺失/非法时回落宿主本地时区）。 */
function zoneParts(at: number, timeZone?: string): {
  year: number; month: number; day: number; hour: number; minute: number; weekday: number
} {
  const date = new Date(at)
  if (!timeZone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      weekday: date.getDay(),
    }
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    }).formatToParts(at)
    const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? ''
    const weekday = WEEKDAY_INDEX[pick('weekday')]
    return {
      year: Number(pick('year')),
      month: Number(pick('month')),
      day: Number(pick('day')),
      hour: Number(pick('hour')),
      minute: Number(pick('minute')),
      weekday: Number.isFinite(weekday) ? weekday : new Date(at).getDay(),
    }
  } catch {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      weekday: date.getDay(),
    }
  }
}

/**
 * 历史条目的时间戳前缀：同一天只给 `[21:03]`，跨天补上 `[11/04 21:03]`。
 * 只用于提示模型时间感，不进台词、不显示在气泡里。
 * `timeZone` 传浏览器时区——宿主机跑在 UTC，不传就会把「深夜」当「早上」。
 */
export function formatStamp(at: number, now = Date.now(), timeZone?: string): string {
  const then = zoneParts(at, timeZone)
  const today = zoneParts(now, timeZone)
  const clock = `${pad2(then.hour)}:${pad2(then.minute)}`
  const sameDay = then.year === today.year && then.month === today.month && then.day === today.day
  return sameDay ? clock : `${then.month}/${then.day} ${clock}`
}

/** 当前时间的口语描述（「11月5日 周四 21:10」），每次请求都重新取值。 */
export function formatNow(now = Date.now(), timeZone?: string): string {
  const parts = zoneParts(now, timeZone)
  return `${parts.month}月${parts.day}日 ${WEEKDAYS[parts.weekday]} ${pad2(parts.hour)}:${pad2(parts.minute)}`
}

/** 历史消息的 `source`：assistant 必须是模型来源，user 可以是任何来源（这里用 user）。 */
export interface HistoryMessage {
  id: string
  role: 'user' | 'assistant'
  content: { type: 'text'; text: string }[]
  source: { kind: 'user' } | { kind: 'model'; provider: string; model: string }
}

/**
 * 把历史切成 `messages` 段：取最近 `count` 条，并丢掉开头没有配对提问的 assistant 条目
 * （模型不喜欢以 assistant 开头的上下文）。
 */
export function historyMessages(
  history: readonly AiHistoryEntry[],
  count: number,
  fallback: { provider: string; model: string },
  timeZone?: string,
): HistoryMessage[] {
  const limit = normalizeHistoryCount(count, 0)
  if (limit <= 0 || history.length === 0) return []
  const tail = history.slice(-limit)
  while (tail.length > 0 && tail[0].role === 'assistant') tail.shift()
  return tail
    .filter((entry) => entry.text.trim().length > 0)
    .map((entry, index) => ({
      id: `history-${index}`,
      role: entry.role,
      content: [{
        type: 'text' as const,
        text: entry.at > 0 ? `[${formatStamp(entry.at, Date.now(), timeZone)}] ${entry.text}` : entry.text,
      }],
      source: entry.role === 'assistant'
        ? { kind: 'model' as const, provider: entry.provider || fallback.provider, model: entry.model || fallback.model }
        : { kind: 'user' as const },
    }))
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

/**
 * 拼「现在发生了什么」的用户消息（模型只看这一句就能接话）。
 *
 * `forHistory: true` 时去掉「你下意识想说的是『…』」这半句（ADR-030 修订）：
 * 历史只该记录真实发生的事——参考台词并没有上屏，留着会让模型把预置台词当成自己说过的话。
 */
export function buildSceneMessage(context: ReplyContext, options: { forHistory?: boolean } = {}): string {
  const state = context.state ?? 'idle'
  const said = (context.text ?? '').replace(/\s+/g, ' ').trim()
  const where = context.kind === 'chat'
    ? `主人刚对你说「${said || '（没说话）'}」`
    : context.kind === 'tap'
      ? `主人刚戳了你的「${context.part || '身体'}」`
      : `当前状态是「${state}」（${
        state === 'thinking' ? '主人在等你想事情'
          : state === 'error' ? '出错了，气氛有点僵'
            : state === 'done' ? '事情办完了'
              : state === 'waiting' ? '主人正在等你确认'
                : state === 'delivered' ? '主人刚交付了成果'
                  : '主人在看着你'
      }）`
  // 参考台词只给方向，明确禁止「换一种说法」式的改写：要的是即兴演绎，不是 paraphrasing
  const hint = !options.forHistory && context.hint
    ? `你下意识想说的是「${context.hint}」，但别照搬，也不必复述。`
    : ''
  // 用户主动说话时不是「演一下现在的反应」，而是「回应这句话」
  const ask = context.kind === 'chat'
    ? '按你的人设回应主人这句话，一句话。'
    : '按你的人设即兴演一下这一刻的反应，一句话。'
  return `（现在是 ${formatNow(Date.now(), context.tz)}。${where}。${hint}）${ask}`
}

/** 单行化 + 去引号 + 截断：气泡只放得下短短一句。 */
export function sanitizeLine(raw: string): string {
  const firstLine = raw.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? ''
  // 有的模型会给回复加「[14:57] 哼…」这类时间戳，进气泡前先滤掉
  const stripped = stripTimestamps(firstLine)
    .replace(/^["'“”‘’「」『』]+/, '')
    .replace(/["'“”‘’「」『』]+$/, '')
    .trim()
  if (stripped.length <= MAX_REPLY_CHARS) return stripped
  return `${stripped.slice(0, MAX_REPLY_CHARS - 1)}…`
}

/** 生成一条台词；超时、无文本或抛错时返回 null（调用方回落预置台词）。 */
/** 生成结果：`text` 为空时 `error` 给出原因（供路由层回传，便于排查「为什么没台词」）。 */
export interface ReplyAttempt {
  text: string | null
  error?: string
}

/**
 * 实际发给模型的载荷（排查用）：system 提示词 + 依次发出的 messages。
 * 内容按文本展开，方便直接读；`role` 区分 user/assistant/system。
 */
export interface AiPayload {
  provider: string
  model: string
  system: string
  messages: { role: string; content: string }[]
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
 * 拼 system 提示词：人设 + 输出要求（长度/单行/不旁白/不复述参考台词）。
 * 一次性回复与流式回复共用，保证两条路径的口味一致。
 * @param persona - 人设正文（`$DSH_HOME/waifu/persona.md`）。
 * @returns 完整 system 字符串。
 */
export function systemPrompt(persona: string): string {
  return `${persona}

输出要求：只输出一句中文台词，不超过 ${MAX_REPLY_CHARS} 字，单行，不要引号、不要旁白、不要括号动作描写、不要解释。
不要复述或改写给你的参考台词：演出这个角色此刻的真实反应（嘴硬、反撩、撒娇、嫌弃、好奇都行），每次换个角度。`
}

/** 采样参数：两个入口共用（台词要短、要活，temperature 拉满）。 */
const TEMPERATURE = 1
const MAX_TOKENS = 120

/** 一次请求的「人设 + 历史 + 当前场景」组装（generateReply 与 streamReply 共用）。 */
function assembleRequest(options: {
  provider: string
  model: string
  persona: string
  context: ReplyContext
  history?: readonly AiHistoryEntry[]
  historyCount?: number
  onPayload?: (payload: AiPayload) => void
}): { system: string; messages: Parameters<WaifuLlm['stream']>[0]['messages'] } {
  const system = systemPrompt(options.persona)
  const history = historyMessages(options.history ?? [], options.historyCount ?? 0, {
    provider: options.provider,
    model: options.model,
  }, options.context.tz)
  const messages = [
    ...history,
    { role: 'user', content: [{ type: 'text' as const, text: buildSceneMessage(options.context) }] },
  ]
  options.onPayload?.({
    provider: options.provider,
    model: options.model,
    system,
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content
        .map((part) => (typeof part === 'object' && part !== null && 'text' in part ? String(part.text) : ''))
        .join(''),
    })),
  })
  return { system, messages }
}

export async function generateReply(
  llm: WaifuLlm,
  options: {
    provider: string
    model: string
    persona: string
    context: ReplyContext
    timeoutMs?: number
    /** 最近对话历史（按 `historyCount` 取末尾若干条注入；ADR-030）。 */
    history?: readonly AiHistoryEntry[]
    historyCount?: number
    /** 每次真正请求前回报载荷（`/ai-debug` 用，排查注入是否生效）。 */
    onPayload?: (payload: AiPayload) => void
  },
): Promise<ReplyAttempt> {
  const timeoutMs = options.timeoutMs ?? 15_000
  const attempt = async (reasoningEffort?: string): Promise<ReplyAttempt> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const { system, messages } = assembleRequest(options)
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
      const line = sanitizeLine(text)
      if (line) return { text: line }
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

  const first = await attempt()
  if (first.text !== null) return first
  // 推理型模型（如 gemma）开着思维链时正文可能整段为空：关掉推理再试一次。
  if (!first.error?.startsWith('empty')) return first
  const retry = await attempt('off')
  return retry.text === null ? first : retry
}

/** 流式回复的一块：文本增量，或收尾（携带清洗后的整句）。 */
export type ReplyChunk =
  | { type: 'delta'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; error: string }

/**
 * 流式回复：把 LLM 的 `text-delta` 原样吐给调用方（供气泡逐字显示 + 句读切分），
 * 结束时给出清洗后的整句（与 `generateReply` 同一套 `sanitizeLine` / system 提示词）。
 *
 * 与 `generateReply` 的差别：这里不重试。重试要重发整段请求，流式下会把已经说出口的
 * 半句再念一遍，反而更糟；空回复由调用方按「无台词」处理。
 * @param llm - DSH 的 `ctx.llm`。
 * @param options - provider/model/人设/场景/历史与载荷回调。
 * @yields 文本增量、收尾整句或失败原因。
 */
export async function* streamReply(
  llm: WaifuLlm,
  options: {
    provider: string
    model: string
    persona: string
    context: ReplyContext
    timeoutMs?: number
    history?: readonly AiHistoryEntry[]
    historyCount?: number
    onPayload?: (payload: AiPayload) => void
    signal?: AbortSignal
  },
): AsyncGenerator<ReplyChunk> {
  const timeoutMs = options.timeoutMs ?? 20_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const forward = () => controller.abort()
  options.signal?.addEventListener('abort', forward, { once: true })
  let raw = ''
  try {
    const { system, messages } = assembleRequest(options)
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
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.length > 0) {
        raw += chunk.text
        yield { type: 'delta', text: chunk.text }
      } else if (chunk.type === 'finish') {
        finish = describeFinish((chunk as { reason?: unknown }).reason)
      }
    }
    const line = sanitizeLine(raw)
    if (line) yield { type: 'done', text: line }
    else yield { type: 'error', error: raw ? 'empty-after-sanitize' : `empty-stream${finish === undefined ? '' : ` (${finish})`}` }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    yield { type: 'error', error: reason.slice(0, 200) || 'stream-failed' }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', forward)
  }
}
