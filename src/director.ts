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
import type { AiHistoryEntry, AiPayload, ReplyContext, WaifuLlm } from './ai.ts'

/** 一句台词的长度上限（UTF-16 单元；气泡宽度有限，spec §4）。 */
export const MAX_REPLY_CHARS = 60

/** 设置里填的是「轮」；一轮 = 用户一句 + 桌宠一句。 */
export const HISTORY_ENTRIES_PER_ROUND = 2

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
 * 句式统一为「<场景>。按你的人设回应。」，触发方式不进场景句。
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
  // 事件合并：窗口内被攒下来的事件一起描述（模型自己会挑重点反应）
  const merged = (context.merged ?? []).filter((line) => line.trim().length > 0)
  const mergedText = merged.length > 0 ? `这期间还发生了：${merged.join('；')}。` : ''
  return `现在是 ${now}。${body}。${mergedText}按你的人设回应。`
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
    return custom !== '' ? `主人「${custom}」了「${part}」` : `主人碰了「${part}」`
  }
  if (context.kind === 'idle') return '一阵子没动静'
  const merged = (context.merged ?? []).filter((line) => line.trim().length > 0)
  const main = eventSceneText(context.event ?? 'idle', eventTexts)
  return merged.length > 0 ? `${main}（另有 ${merged.length} 件事）` : main
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

export function systemPrompt(persona: string, memory = '', catalog: CatalogOptions = {}): string {
  const motionLines = AI_MOTIONS
    .filter((motion) => catalogAllowed(catalog.motionEnabled, motion.id))
    .map((motion) => `- ${motion.id}：${catalog.motionTexts?.[motion.id] ?? motion.meaning}`)
    .join('\n')
  const expressionLines = EXPRESSIONS
    .filter((expression) => expression.id !== 'none' && catalogAllowed(catalog.expressionEnabled, expression.id))
    .map((expression) => `- ${expression.id}：${catalog.expressionTexts?.[expression.id] ?? expression.meaning}`)
    .join('\n')
  const memoryBlock = memory ? `\n## 你记得的事\n${memory}\n` : ''
  return `${persona}${memoryBlock}
## 可选动作（一次最多选一个，写成方括号标签放在台词里）
${motionLines || '（这次没有可用动作，不要写动作标签）'}

## 可选表情（可以选一到两个，写成方括号标签放在台词里）
${expressionLines || '（这次没有可用表情，不要写表情标签）'}

输出要求（严格遵守）：
1. 表情和动作都写成方括号标签，放在台词里：可以整轮开头写一次，也可以写在需要它的那一句前面。
   例如「[blush]唔…别、[Nod]别戳了啦」——脸红从头到尾，摇头只跟着后半句。
   整轮最多 3 个标签（表情最多 2 个、动作最多 1 个）；标签必须用上面的英文 id，
   写完标签紧接着写台词，不要加标点。不想动就不写动作标签；不想做表情就不写表情标签。
2. 台词不超过 ${MAX_REPLY_CHARS} 字，单行，不要引号、不要旁白、不要括号动作描写、不要解释。
3. 如果这轮有值得长期记住的事（主人的习惯、约定、你的小心愿），在台词后面另起一行写「[记] 内容」，
   十几个字以内，用第三人称记录（例如「[记] 主人半夜还在赶工」）。没有就别写。
4. 每次换个角度反应，不要重复上一次的说法。
5. 场景里写「主人<某个动作>了你的「<部位>」」时，那个动作是主人**自己给这个部位起的交互名**（比如「抚摸」「捏脸」「弹一下」），
   按字面理解它的意思和亲密程度来演，不要把它当成动作 id，也不要复述这个词。`
}

/** 采样参数：两个入口共用（台词要短、要活，temperature 拉满）。 */
export const TEMPERATURE = 1
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
