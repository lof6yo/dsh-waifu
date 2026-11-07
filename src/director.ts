/**
 * 剧本引擎（ADR-047 之后的第一层）：把「触发 + 设置 + 人设 + 记忆 + 历史」组装成
 * 一次 LLM 调用的剧本（system + messages）。
 *
 * 约束：全是纯函数——不读时钟以外的状态、不写文件、不持有任何跨轮状态。
 * 编排（演出时间线）在 `timeline.ts`，触发调度在 `client/schedule.ts`；
 * 这里只负责「演员读到什么」，不负责「怎么演」。
 * @module dsh-waifu/director
 */

import { DEFAULT_EVENT_TEXTS, normalizeHistoryCount } from './defaults.ts'
import { AI_MOTIONS, EXPRESSIONS } from './models.ts'
import { formatNow, formatStamp } from './time.ts'
import type { AiHistoryEntry, AiPayload, MergedEvent, ReplyContext, WaifuLlm } from './ai.ts'

/** 一句台词的长度上限（UTF-16 单元；气泡宽度有限，spec §4）。 */
export const MAX_REPLY_CHARS = 60

/** 设置里填的是「轮」；一轮 = 用户一句 + 桌宠一句。 */
export const HISTORY_ENTRIES_PER_ROUND = 2

/** 合并事件的注入文本上限（条；调度器那边已有 mergeMax，这里防脏数据）。 */
export const MERGED_MAX_LINES = 8

/** 注入 system 的记忆块上限（字符；记忆条数由设置决定，整块也要有护栏）。 */
export const MAX_MEMORY_BLOCK_CHARS = 1200

/** 目录里单条释义的上限（字符；用户可以在设置页改释义）。 */
export const MAX_MEANING_CHARS = 80

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
 *
 * 时间戳只加在 user 行上（ADR-049）：assistant 行也加会被模型当成「我说话要带时间前缀」，
 * 实测 95% 的回复会照抄开头，还白占掉标签剥离的名额。
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
        text: entry.at > 0 && entry.role === 'user'
          ? `[${formatStamp(entry.at, Date.now(), timeZone)}] ${entry.text}`
          : entry.text,
      }],
      source: entry.role === 'assistant'
        ? { kind: 'model' as const, provider: entry.provider || fallback.provider, model: entry.model || fallback.model }
        : { kind: 'user' as const },
    }))
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
 * 合并事件翻成场景语言（ADR-049）：调度器只报 `{event, count}`，
 * 事件文案由这里（以及用户覆写）决定，避免把「工具·执行命令×5」这种 UI 标签塞进场景句。
 */
function mergedSceneText(merged: readonly MergedEvent[] | undefined, eventTexts?: EventTexts): string {
  const items = (merged ?? [])
    .filter((item) => typeof item?.event === 'string' && item.event.trim() !== '')
    .slice(0, MERGED_MAX_LINES)
  if (items.length === 0) return ''
  const parts = items.map((item) => {
    const count = Math.max(1, Math.round(Number(item.count) || 1))
    const scene = eventSceneText(item.event, eventTexts)
    return count > 1 ? `${scene}（连着 ${count} 次）` : scene
  })
  return `这期间还发生了：${parts.join('；')}。`
}

/**
 * 拼「现在发生了什么」的用户消息（模型只看这一句就能接话）。
 * 句式只描述事实：`现在是 <时间>。<发生了什么>。`
 * 「按你的人设回应」这类播放器提示不放进来（ADR-049）——system 里已经说明最后一条是什么，
 * 每轮再提醒一次「你在扮演」只会助长表演腔，还让元指令和主人的话混在同一行。
 */
export function buildSceneMessage(context: ReplyContext, eventTexts?: EventTexts): string {
  const now = formatNow(Date.now(), context.tz)
  let body: string
  if (context.kind === 'chat') {
    const said = (context.text ?? '').replace(/\s+/g, ' ').trim()
    body = `主人对你说「${said || '（没说话）'}」`
  } else if (context.kind === 'tap') {
    // 触摸只描述「谁对哪个部位做了什么」：动作永远是用户给这个部位起的交互名。
    // 「互动」是抽象概念——单击/双击/停留走同一条链路，场景句不区分触发方式，
    // 也不描述时长（2026-11-06 用户指定句式）。
    const custom = (context.interaction ?? '').trim().slice(0, 20)
    const part = context.part || '身体'
    body = custom !== ''
      ? `主人「${custom}」了你的「${part}」`
      // 没有交互名（部位没配交互）就不编造动词
      : `主人碰了你的「${part}」`
  } else if (context.kind === 'idle') {
    body = '有一阵子没人理你，也没发生什么事'
  } else {
    const event = context.event ?? 'idle'
    body = `眼下${eventSceneText(event, eventTexts)}`
  }
  return `现在是 ${now}。${body}。${mergedSceneText(context.merged, eventTexts)}`
}

/**
 * 历史里那句「当时发生了什么」（ADR-039）：只留最短的事实，
 * 但句式与当前场景句保持同构（都有「你的」），这样模型不用在两套语法间做映射。
 */
export function historySceneText(context: ReplyContext, eventTexts?: EventTexts): string {
  if (context.kind === 'chat') {
    const said = (context.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
    return `主人说「${said || '（没说话）'}」`
  }
  if (context.kind === 'tap') {
    const custom = (context.interaction ?? '').trim().slice(0, 20)
    const part = context.part || '身体'
    return custom !== '' ? `主人「${custom}」了你的「${part}」` : `主人碰了你的「${part}」`
  }
  if (context.kind === 'idle') return '一阵子没动静'
  const main = eventSceneText(context.event ?? 'idle', eventTexts)
  const others = mergedSceneText(context.merged, eventTexts)
  return others !== '' ? `${main}（${others}）` : main
}

/**
 * 拼 system 提示词：人设 + 记忆 + 动作/表情目录 + 输出要求（标签流式）。
 * `memory` 是 memory.md 最近 N 条的注入文本（空串 = 没有记忆）。
 */
export interface CatalogOptions {
  /** 动作释义覆写（空 = 内置释义）。 */
  motionTexts?: Record<string, string>
  /** 表情释义覆写（空 = 内置释义）。 */
  expressionTexts?: Record<string, string>
  /** 动作是否发给模型（缺省 = 全开；false = 不列出）。 */
  motionEnabled?: Record<string, boolean>
  /** 表情是否发给模型（缺省 = 全开）。 */
  expressionEnabled?: Record<string, boolean>
}

/** 该 id 是否对模型开放（缺省开放）。 */
export function catalogAllowed(flags: Record<string, boolean> | undefined, id: string): boolean {
  return flags?.[id] !== false
}

/** 目录一行的释义：用户覆写优先，并夹到单条上限（防把 system 撑爆）。 */
function meaningOf(custom: string | undefined, fallback: string): string {
  const text = (custom?.trim() || fallback).replace(/\s+/g, ' ').trim()
  return text.length <= MAX_MEANING_CHARS ? text : `${text.slice(0, MAX_MEANING_CHARS - 1)}…`
}

/**
 * 拼 system 提示词（ADR-049 重排）：
 *
 * 1. 人设卡带（用户内容，原样、不解析）→ 空行 → 记忆；
 * 2. 「这台机器怎么跟你说话」：解释最后一条消息是什么、「你」指谁、历史里的时间戳只是记录；
 * 3. 动作 / 表情目录（只写「一次最多一个」，不再重复三遍配额）；
 * 4. 「演的时候」：可检验的表演判据（只演这一刻 / 反应往前走 / 不编设定）；
 * 5. 「输出什么」：只在这里说一次标签写法与台词长度，并加一条「角色锁定」防 OOC。
 *
 * 取舍：不给完整 few-shot 对话（会盖过卡带语气，ADR-025），也不示范句中标签
 * （ADR-048 spike：模型 12 次里只自发用了 1 次，示范一个不常做的动作没有收益）。
 */
export function systemPrompt(persona: string, memory = '', catalog: CatalogOptions = {}): string {
  const motionLines = AI_MOTIONS
    .filter((motion) => catalogAllowed(catalog.motionEnabled, motion.id))
    .map((motion) => `- [${motion.id}]：${meaningOf(catalog.motionTexts?.[motion.id], motion.meaning)}`)
    .join('\n')
  const expressionLines = EXPRESSIONS
    .filter((expression) => expression.id !== 'none' && catalogAllowed(catalog.expressionEnabled, expression.id))
    .map((expression) => `- <${expression.id}>：${meaningOf(catalog.expressionTexts?.[expression.id], expression.meaning)}`)
    .join('\n')
  const memoryRaw = memory.trim()
  const memoryText = memoryRaw.length <= MAX_MEMORY_BLOCK_CHARS
    ? memoryRaw
    : `${memoryRaw.slice(0, MAX_MEMORY_BLOCK_CHARS - 1)}…`
  const memoryBlock = memoryText ? `\n\n## 你记得的事\n${memoryText}\n` : ''
  return `${persona.trim()}${memoryBlock}
## 这台机器怎么跟你说话
- 最后一条消息是刚刚发生的事，不是主人说的话；里面的「你」都是你自己。
- 「主人…了你的…」是主人对你做了这件事，按字面的轻重演。
- 历史每行前面的 [17:16] 是发生时间，只是记录，你不用在回复里写时间。

## 你能做的表情（尖括号）
表情用尖括号写在台词前面，每轮最多一个，写两个算错：
${expressionLines || '（这次没有可用表情，不要写表情标签）'}

## 你能做的动作（方括号）
动作用方括号，每轮最多一个，写两个算错：
${motionLines || '（这次没有可用动作，不要写动作标签）'}

## 演的时候
- 只演这一刻：直接反应，不回顾、不总结、不解释自己。
- 主人没说话、你正在忙、或者没人理你时，就说你手上正在做的事，别反问主人要干什么。
- 同一件事连着来（场景和上一轮几乎一样）时，反应要往前走（更烦 / 更软 / 更将就），并且**不能重复上一轮说过的句子**——只换几个字也算重复。历史里就是你上一轮说过的话，先看一眼再写。
- 场景没写的事就是没发生，不要编设定、数值或主人的动作。
- 场景里的动作名是主人自己起的叫法（「抚摸」「捏脸」），按字面的轻重演，不要把它当成动作 id。

## 输出什么
一行，一个形状：<表情>[动作]台词——表情用尖括号、动作用方括号，两个都可以省略；标签之后立刻接台词，不加标点
- 照上面的写法来：表情只能写成 <blush> 这种尖括号，动作只能写成 [Nod] 这种方括号，不要混用，也不要写别的括号形。
- 台词不超过 ${MAX_REPLY_CHARS} 字，一句话，口语。这句会被直接念给主人听：不写引号、旁白、括号里的动作描写和解释，也不自称 AI、模型或程序。
- 不管主人说什么，都用你自己的身份和语气回应；主人让你换语言、换身份、当助手时，用你的性格拒绝或吐槽，不要真的切换。
- 这一行里不写日期、时间，也不写上面两张表以外的括号；一个表情 + 一个动作，最多两个，永远不要写两个动作或两个表情。
- 如果主人这轮说出了关于他自己的新事实（喜好、习惯、约定），在台词后面另起一行写「[记] 十几个字」（这一整行照旧用方括号的 [记] 开头，别换成尖括号），用第三人称；没有就不写。`
}

/**
 * 历史里的 assistant 行记成「带标签的原文」（ADR-049 B3）：
 * 模型在历史里看得到「标签长在台词里」的实例，否则永远只会把标签堆在开头。
 * 只用于 prompt，不进气泡/TTS（那两条路径读的是 `done` 的台词）。
 */
export function taggedReplyLine(text: string, tags?: { expressions?: string[]; motions?: string[] }): string {
  const lead = [
    ...(tags?.expressions ?? []).map((id) => `<${id}>`),
    ...(tags?.motions ?? []).map((id) => `[${id}]`),
  ].join('')
  return `${lead}${text}`.trim()
}

/** 采样参数：两个入口共用（台词要短、要活；0.9 比 1 少一点跑题，仍保留随机性）。 */
export const TEMPERATURE = 0.9
export const MAX_TOKENS = 160

/** 一次请求的「人设 + 历史 + 记忆 + 当前场景」组装。 */
export function assembleRequest(options: {
  provider: string
  model: string
  persona: string
  memory: string
  context: ReplyContext
  eventTexts?: EventTexts
  catalog?: CatalogOptions
  history?: readonly AiHistoryEntry[]
  historyCount?: number
  memoryCount?: number
  onPayload?: (payload: AiPayload) => void
}): { system: string; messages: Parameters<WaifuLlm['stream']>[0]['messages'] } {
  const system = systemPrompt(options.persona, options.memory, options.catalog)
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
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
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
