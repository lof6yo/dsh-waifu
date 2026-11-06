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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AI_HISTORY_LIMITS, AI_MEMORY_LIMITS, DEFAULT_EVENT_TEXTS, normalizeHistoryCount, normalizeMemoryCount } from './defaults.ts'
import { AI_MOTIONS, EXPRESSIONS, isExpressionId, isMotionId, stripTimestamps } from './models.ts'

export { AI_HISTORY_LIMITS, AI_MEMORY_LIMITS, normalizeHistoryCount, normalizeMemoryCount }

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
  /** 关闭推理链（部分模型开启推理后只产出 reasoning，正文为空）。 */
  reasoningEffort?: string
  signal?: AbortSignal
}

/** `StreamChunk` 的子集：只关心文本增量。 */
export type WaifuLlmChunk = { type: 'text-delta'; text: string } | { type: string; text?: string }

/** 触摸交互类型（轻碰/戳戳/抚摸，按按住时长区分；ADR-037）。 */
/** 一次 AI 触发的场景描述（客户端上报的「发生了什么」）。 */
export interface ReplyContext {
  /** 触发来源：触摸（`tap`）、DSH 事件（`event`）、用户对话（`chat`）或静默超时（`idle`）。 */
  kind: 'tap' | 'event' | 'chat' | 'idle'
  /** 触摸部位的中文名（`kind: 'tap'`）。 */
  part?: string
  /** 触摸类型（`kind: 'tap'`；轻碰/戳戳/抚摸）。部位没配自定义交互时的兜底描述。 */
  /** 部位自定义交互名（ADR-038，如「抚摸」「捏脸」）；有值时以它为准，`tapKind` 不再进场景句。 */
  interaction?: string
  /** 「停留」交互（ADR-038 修订）：由鼠标悬停 box 触发（无按压）。场景句用悬停语义。 */
  hover?: boolean
  /** 触摸按住时长（ms，`kind: 'tap'`）。 */
  durationMs?: number
  /** 用户输入的原话（`kind: 'chat'`，已单行化并截断）。 */
  text?: string
  /** DSH 事件键（`kind: 'event'`：状态或活动）。 */
  event?: string
  /** 上一轮反应开始后，本窗口内被合并进来的事件描述（ADR-037 事件合并）。 */
  merged?: string[]
  /** 请求方（浏览器）的 IANA 时区，用来把「现在几点」换算到用户所在时区。 */
  tz?: string
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
 * 一条对话历史：user = 我们发过去的场景描述，assistant = 桌宠当时的「台词 + 做了什么」。
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

/** 设置里填的是「轮」；一轮 = 用户一句 + 桌宠一句。 */
export const HISTORY_ENTRIES_PER_ROUND = 2
/** 注入给模型的最近对话条数上限（防止超长历史把 token 预算吃满）。 */
export const AI_HISTORY_MAX_ENTRIES: number = AI_HISTORY_LIMITS.max * HISTORY_ENTRIES_PER_ROUND

/**
 * 把历史切成 `messages` 段：取最近 `count` 条，并丢掉开头没有配对提问的 assistant 条目
 * （模型不喜欢以 assistant 开头的上下文）。
 */
export function historyMessages(
  history: readonly AiHistoryEntry[],
  rounds: number,
  fallback: { provider: string; model: string },
  timeZone?: string,
): HistoryMessage[] {
  // 设置页填「轮」：1 轮 = 一问一答，换算成消息条数
  const limit = normalizeHistoryCount(rounds, 0) * HISTORY_ENTRIES_PER_ROUND
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

/** 事件文案覆写（事件键 → 用户自定义那句话；缺省用内置文案）。 */
export type EventTexts = Record<string, string>

/** 事件键 → 场景描述：用户覆写优先，其次内置，最后兜底成「发生了「<键>」这件事」。 */
export function eventSceneText(event: string, texts?: EventTexts): string {
  const custom = texts?.[event]?.trim()
  if (custom) return custom
  return DEFAULT_EVENT_TEXTS[event] ?? `发生了「${event}」这件事`
}

/**
 * 拼「现在发生了什么」的用户消息（模型只看这一句就能接话）。
 * `merged` 是触发频率窗口内被合并进来的事件描述（ADR-037）。
 */
export function buildSceneMessage(context: ReplyContext, eventTexts?: EventTexts): string {
  const now = formatNow(Date.now(), context.tz)
  let where: string
  if (context.kind === 'chat') {
    const said = (context.text ?? '').replace(/\s+/g, ' ').trim()
    where = `主人刚对你说「${said || '（没说话）'}」`
  } else if (context.kind === 'tap') {
    // ADR-038 修订：「停留」= 鼠标悬停（hover），不是按压——场景句用悬停语义，
    // 时长半句只对 tap/double 交互保留（按压类交互仍需要「按了多久」）。
    const custom = (context.interaction ?? '').trim().slice(0, 20)
    const isHold = custom !== '' && context.hover === true
    if (isHold) {
      where = `主人${custom}你的「${context.part || '身体'}」（鼠标一直停在那里）`
    } else if (custom !== '') {
      const duration = context.durationMs !== undefined && context.durationMs > 0
        ? `，按了约 ${(context.durationMs / 1000).toFixed(1)} 秒`
        : ''
      where = `主人${custom}你的「${context.part || '身体'}」${duration}`
    } else {
      // 没有交互名（部位没配交互）就不描述具体动作——绝不回落到内建的「戳了戳」
      where = `主人碰了你的「${context.part || '身体'}」`
    }
  } else if (context.kind === 'idle') {
    where = '有一阵子没人理你，也没发生什么事'
  } else {
    const event = context.event ?? 'idle'
    where = `眼下${eventSceneText(event, eventTexts)}`
  }
  // 事件合并：窗口内被攒下来的事件一起描述（模型自己会挑重点反应）
  const merged = (context.merged ?? []).filter((line) => line.trim().length > 0)
  const mergedText = merged.length > 0 ? `这期间还发生了：${merged.join('；')}。` : ''
  const ask = context.kind === 'chat'
    ? '按你的人设回应主人这句话。'
    : '按你的人设即兴演一下这一刻的反应。'
  return `（现在是 ${now}。${where}。${mergedText}）${ask}`
}

/**
 * 历史里那句「当时发生了什么」（ADR-039）：只留最短的事实，
 * 换成 `[HH:MM] 主人轻碰「脸」` 这种一行式，避免把整段场景句重复注入 N 次。
 */
export function historySceneText(context: ReplyContext, eventTexts?: EventTexts): string {
  if (context.kind === 'chat') {
    const said = (context.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
    return `主人说「${said || '（没说话）'}」`
  }
  if (context.kind === 'tap') {
    const custom = (context.interaction ?? '').trim().slice(0, 20)
    const part = context.part || '身体'
    if (custom !== '' && context.hover === true) return `主人${custom}「${part}」`
    const seconds = context.durationMs !== undefined && context.durationMs >= 1000
      ? `（${(context.durationMs / 1000).toFixed(1)}s）`
      : ''
    return custom !== '' ? `主人${custom}「${part}」${seconds}` : `主人碰了「${part}」`
  }
  if (context.kind === 'idle') return '一阵子没动静'
  const merged = (context.merged ?? []).filter((line) => line.trim().length > 0)
  const main = eventSceneText(context.event ?? 'idle', eventTexts)
  return merged.length > 0 ? `${main}（另有 ${merged.length} 件事）` : main
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
 * 开头的标签（表情/动作）：`[shy]`、`【害羞】`、`(blush)`，允许 markdown 记号与中英文混合。
 * 认不出的标签也剥掉——它是写给前端的控制信号，绝不能显示或念出来。
 */
const TAG_PATTERN = /^\s*[*_`~]*\s*[[［【(（〔〖]\s*([^\]］】）}〕〗\n]{1,32})\s*[\])］】）}〕〗]\s*[*_`~]*\s*/
const TAG_OPEN_ONLY = /^\s*[*_`~]*\s*[[［【(（〔〖][^\]］】）}〕〗\n]{0,32}$/
const TAG_ANY = /[[［【(（〔〖]\s*([^\]］】）}〕〗\n]{1,32})\s*[\])］】）}〕〗]/g

/** 开头标签的解析结果：表情/动作 id（在目录内才算数）。 */
export interface LeadingTags {
  expressions: string[]
  motions: string[]
  rest: string
}

/** 判断一个标签词是不是可执行的表情/动作（目录内才算控制信号）。 */
function classifyTag(word: string): 'expression' | 'motion' | null {
  const cleaned = word.trim().toLowerCase().replace(/[\s"'“”‘’`*_~·、,，。.!！?？:：]/g, '')
  if (!cleaned) return null
  // 目录词表：动作 id / 表情 id / 中文名 / meaning 关键词都不该念出来
  const motion = AI_MOTIONS.find((m) =>
    m.id.toLowerCase() === cleaned || m.name === word.trim() || m.meaning.includes(word.trim()),
  )
  if (motion) return 'motion'
  const expression = EXPRESSIONS.find((e) =>
    e.id.toLowerCase() === cleaned || e.name === word.trim(),
  )
  if (expression) return 'expression'
  if (isMotionId(cleaned)) return 'motion'
  if (isExpressionId(cleaned)) return 'expression'
  return null
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
    const kind = classifyTag(match[1])
    if (kind === 'expression') expressions.push(match[1].trim().toLowerCase())
    else if (kind === 'motion') motions.push(match[1].trim())
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

/** 「[记] …」记忆行：句尾单独一行（或紧跟在句尾）。 */
const MEMORY_LINE = /(?:^|\n)\s*[[［【(（〔〖]\s*(?:记|memory|remember|note)\s*[\])］】）}〕〗]\s*(.+)$/i

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
 * 返回 `resolved=false` 表示它可能还是标签前缀（例如刚读到 `[sh`），继续攒着别发。
 */
function stripLeadingTagStream(buffer: string): { resolved: boolean; expressions: string[]; motions: string[]; rest: string } {
  const tags = parseLeadingTags(buffer)
  if (tags.expressions.length > 0 || tags.motions.length > 0 || tags.rest !== buffer.trimStart()) {
    return { resolved: true, expressions: tags.expressions, motions: tags.motions, rest: stripInlineTags(tags.rest) }
  }
  if (TAG_OPEN_ONLY.test(buffer)) return { resolved: false, expressions: [], motions: [], rest: '' }
  return { resolved: true, expressions: [], motions: [], rest: stripInlineTags(buffer) }
}

/**
 * 拼 system 提示词：人设 + 记忆 + 动作/表情目录 + 输出要求（标签流式）。
 * `memory` 是 memory.md 最近 N 条的注入文本（空串 = 没有记忆）。
 */
export function systemPrompt(persona: string, memory = ''): string {
  const motionLines = AI_MOTIONS.map((motion) => `- ${motion.id}（${motion.name}）：${motion.meaning}`).join('\n')
  const expressionLines = EXPRESSIONS
    .filter((expression) => expression.id !== 'none')
    .map((expression) => `- ${expression.id}（${expression.name}）：${expression.meaning}`)
    .join('\n')
  const memoryBlock = memory ? `\n## 你记得的事\n${memory}\n` : ''
  return `${persona}${memoryBlock}
## 可选动作（一次最多选一个，写在台词开头的标签里）
${motionLines}

## 可选表情（可以选一到两个，写在动作标签后面）
${expressionLines}

输出要求（严格遵守）：
1. 先写方括号标签再写台词，格式：[表情][动作] 台词。例如「[shy][ShakeHead] 别、别戳了啦」。
   不想动就不写动作标签；不想做表情就不写表情标签。标签必须用上面的英文 id。
2. 台词不超过 ${MAX_REPLY_CHARS} 字，单行，不要引号、不要旁白、不要括号动作描写、不要解释。
3. 如果这轮有值得长期记住的事（主人的习惯、约定、你的小心愿），在台词后面另起一行写「[记] 内容」，
   十几个字以内，用第三人称记录（例如「[记] 主人半夜还在赶工」）。没有就别写。
4. 每次换个角度反应，不要重复上一次的说法。
5. 场景里写「主人<某个动作>了你的「<部位>」」时，那个动作是主人**自己给这个部位起的交互名**（比如「抚摸」「捏脸」「弹一下」），
   按字面理解它的意思和亲密程度来演，不要把它当成动作 id，也不要复述这个词。`
}

/** 采样参数：两个入口共用（台词要短、要活，temperature 拉满）。 */
const TEMPERATURE = 1
const MAX_TOKENS = 160

/** 一次请求的「人设 + 历史 + 记忆 + 当前场景」组装。 */
function assembleRequest(options: {
  provider: string
  model: string
  persona: string
  memory: string
  context: ReplyContext
  eventTexts?: EventTexts
  history?: readonly AiHistoryEntry[]
  historyCount?: number
  memoryCount?: number
  onPayload?: (payload: AiPayload) => void
}): { system: string; messages: Parameters<WaifuLlm['stream']>[0]['messages'] } {
  const system = systemPrompt(options.persona, options.memory)
  const history = historyMessages(options.history ?? [], options.historyCount ?? 0, {
    provider: options.provider,
    model: options.model,
  }, options.context.tz)
  const messages = [
    ...history,
    { role: 'user', content: [{ type: 'text' as const, text: buildSceneMessage(options.context, options.eventTexts) }] },
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
    timeoutMs?: number
    history?: readonly AiHistoryEntry[]
    historyCount?: number
    onPayload?: (payload: AiPayload) => void
  },
): Promise<ReplyAttempt> {
  const timeoutMs = options.timeoutMs ?? 15_000
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
      // 记忆行剥掉，只留正文
      const { text: withoutMemory, note } = extractMemoryNote(text)
      const tags = parseLeadingTags(withoutMemory)
      const line = sanitizeLine(tags.rest)
      if (line) {
        return {
          text: line,
          expressions: tags.expressions,
          motions: tags.motions,
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

  const first = await attempt()
  if (first.text !== null) return first
  if (!first.error?.startsWith('empty')) return first
  const retry = await attempt('off')
  return retry.text === null ? first : retry
}

/** 流式回复的一块：标签（表情/动作）、文本增量、记忆、或收尾。 */
export type ReplyChunk =
  | { type: 'tags'; expressions: string[]; motions: string[] }
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
  let sentTags = false
  let sentMemory = false
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
    let visible = ''
    let sent = 0
    let prefixDone = false
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.length > 0) {
        raw += chunk.text
        if (prefixDone) {
          visible += chunk.text
        } else {
          pending += chunk.text
          const tag = stripLeadingTagStream(pending)
          if (!tag.resolved) continue
          sentTags = true
          if (tag.expressions.length > 0 || tag.motions.length > 0) {
            yield { type: 'tags', expressions: tag.expressions, motions: tag.motions }
          }
          if (tag.rest === '') {
            // 到目前为止只有标签：继续攒，正文出现才进入转发模式
            // （否则下一个 delta 块里的 [Tilt] 会当正文念出来）
            pending = ''
            continue
          }
          prefixDone = true
          visible = tag.rest
        }
        if (visible.length > sent) {
          yield { type: 'delta', text: visible.slice(sent) }
          sent = visible.length
        }
      } else if (chunk.type === 'finish') {
        finish = describeFinish((chunk as { reason?: unknown }).reason)
      }
    }
    // 收尾：从原始全文里剥记忆行（流式期间可能已经吐进 visible，这里再剥一次）
    const { note, text: withoutMemory } = extractMemoryNote(raw)
    if (!sentMemory && note) {
      sentMemory = true
      yield { type: 'memory', note }
    }
    const tags = parseLeadingTags(withoutMemory)
    if (!sentTags && (tags.expressions.length > 0 || tags.motions.length > 0)) {
      yield { type: 'tags', expressions: tags.expressions, motions: tags.motions }
    }
    const line = sanitizeLine(tags.rest)
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
