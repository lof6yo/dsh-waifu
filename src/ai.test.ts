import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AI_HISTORY_LIMITS,
  AI_HISTORY_MAX_ENTRIES,
  DEFAULT_PERSONA,
  MAX_PERSONA_CHARS,
  formatNow,
  normalizeTimeZone,
  formatStamp,
  MAX_REPLY_CHARS,
  PERSONA_FILENAME,
  appendHistory,
  buildSceneMessage,
  generateReply,
  historyMessages,
  loadPersona,
  parseEmotionTag,
  personaPath,
  sanitizeLine,
  savePersona,
  type AiHistoryEntry,
  type WaifuLlm,
  type WaifuLlmRequest,
} from './ai.ts'

/** 假 LLM：按预设文本推送若干 text-delta（可配置抛错）。 */
function fakeLlm(chunks: string[], options: { throwAt?: number } = {}): WaifuLlm & { calls: WaifuLlmRequest[] } {
  const calls: WaifuLlmRequest[] = []
  return {
    calls,
    stream(request: WaifuLlmRequest) {
      calls.push(request)
      return (async function* () {
        for (let i = 0; i < chunks.length; i += 1) {
          if (options.throwAt === i) throw new Error('boom')
          yield { type: 'text-delta', text: chunks[i] }
        }
      })()
    },
  }
}

describe('sanitizeLine', () => {
  it('取第一行、去引号与首尾空白', () => {
    expect(sanitizeLine('「别戳啦…」\n下一行')).toBe('别戳啦…')
    expect(sanitizeLine('  嗯…  ')).toBe('嗯…')
  })

  it('超长台词截断并补省略号', () => {
    const long = '啊'.repeat(MAX_REPLY_CHARS + 20)
    const line = sanitizeLine(long)
    expect(line.length).toBe(MAX_REPLY_CHARS)
    expect(line.endsWith('…')).toBe(true)
  })

  it('空文本返回空串', () => {
    expect(sanitizeLine('\n  \n')).toBe('')
    // 模型偶尔会给回复加时间戳：进气泡前就得滤掉（否则气泡里会冒出「[14:57]」）
    expect(sanitizeLine('[14:57] 哼，才不要呢')).toBe('哼，才不要呢')
    expect(sanitizeLine('2026-11-05T14:57:16Z 「别乱戳」')).toBe('别乱戳')
  })
})

describe('时区', () => {
  const at = Date.parse('2026-11-05T16:47:00Z')

  it('formatNow 按浏览器时区换算（宿主在 UTC、用户在 +08 时不能报成 16:47）', () => {
    expect(formatNow(at, 'Asia/Shanghai')).toBe('11月6日 周五 00:47')
    expect(formatNow(at, 'UTC')).toBe('11月5日 周四 16:47')
  })

  it('formatStamp 的「今天」也在同一时区里判断', () => {
    const now = at // UTC 是 11/5 16:47，上海已经是 11/6 00:47
    expect(formatStamp(Date.parse('2026-11-05T15:30:00Z'), now, 'Asia/Shanghai')).toBe('11/5 23:30')
    expect(formatStamp(Date.parse('2026-11-05T16:20:00Z'), now, 'Asia/Shanghai')).toBe('00:20')
    expect(formatStamp(Date.parse('2026-11-05T16:20:00Z'), now, 'UTC')).toBe('16:20')
  })

  it('normalizeTimeZone 只放行合法 IANA 名', () => {
    expect(normalizeTimeZone('Asia/Shanghai')).toBe('Asia/Shanghai')
    expect(normalizeTimeZone('UTC')).toBe('UTC')
    expect(normalizeTimeZone('')).toBeUndefined()
    expect(normalizeTimeZone('Not/AZone')).toBeUndefined()
    expect(normalizeTimeZone('../../etc/passwd')).toBeUndefined()
    expect(normalizeTimeZone(42)).toBeUndefined()
  })

  it('buildSceneMessage 带上时区换算后的「现在」', () => {
    // 不注入 at，只断言形状：时区参数不会让文案崩掉
    expect(buildSceneMessage({ kind: 'tap', part: '胸', tz: 'Asia/Shanghai' })).toContain('现在是')
  })
})

describe('buildSceneMessage', () => {
  it('触摸情景包含部位名与参考台词，并要求即兴演绎而非改写', () => {
    const message = buildSceneMessage({ kind: 'tap', part: '胸', hint: '呀！那里不能戳啦…' })
    expect(message).toContain('胸')
    expect(message).toContain('呀！那里不能戳啦…')
    expect(message).toContain('一句话')
    expect(message).toContain('别照搬')
    expect(message).not.toContain('换个说法')
  })

  it('状态情景按状态给出不同描述', () => {
    expect(buildSceneMessage({ kind: 'state', state: 'thinking' })).toContain('等你想事情')
    expect(buildSceneMessage({ kind: 'state', state: 'error' })).toContain('出错了')
    expect(buildSceneMessage({ kind: 'state', state: 'idle' })).toContain('看着你')
  })
})

describe('loadPersona', () => {
  it('缺失时落盘默认人设并返回内容', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-waifu-persona-'))
    try {
      const text = loadPersona(dir)
      expect(text).toBe(DEFAULT_PERSONA)
      expect(existsSync(join(dir, PERSONA_FILENAME))).toBe(true)
      expect(readFileSync(join(dir, PERSONA_FILENAME), 'utf8')).toBe(DEFAULT_PERSONA)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('generateReply', () => {
  it('拼接文本增量并清理成单行台词', async () => {
    const llm = fakeLlm(['「好', '吧…', '就一下」\n多余行'])
    const attempt = await generateReply(llm, {
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      persona: DEFAULT_PERSONA,
      context: { kind: 'tap', part: '手' },
    })
    expect(attempt.text).toBe('好吧…就一下')
    // 请求带上 provider/model 与人设前缀
    expect(llm.calls).toHaveLength(1)
    expect(llm.calls[0].provider).toBe('deepseek-official')
    expect(llm.calls[0].model).toBe('deepseek-flash')
    expect(llm.calls[0].system).toContain(DEFAULT_PERSONA)
    expect(llm.calls[0].maxTokens).toBe(120)
  })

  it('流中断或空文本返回 null + 原因（调用方回落预置台词）', async () => {
    const broken = fakeLlm(['啊', '哦'], { throwAt: 1 })
    const failed = await generateReply(broken, { provider: 'p', model: 'm', persona: 'x', context: { kind: 'tap', part: '脸' } })
    expect(failed.text).toBeNull()
    expect(failed.error).toBeTruthy()
    const empty = fakeLlm(['   '])
    const blank = await generateReply(empty, { provider: 'p', model: 'm', persona: 'x', context: { kind: 'state', state: 'idle' } })
    expect(blank.text).toBeNull()
    expect(blank.error).toBe('empty-after-sanitize')
  })
})

describe('generateReply 推理模型兜底', () => {
  it('首轮只产出空正文时关掉推理重试', async () => {
    const calls: WaifuLlmRequest[] = []
    const llm: WaifuLlm = {
      stream(request: WaifuLlmRequest) {
        calls.push(request)
        const first = calls.length === 1
        return (async function* () {
          if (!first) yield { type: 'text-delta', text: '哼，手拿开。' }
        })()
      },
    }
    const attempt = await generateReply(llm, { provider: 'openrouter', model: 'google/gemma-4-31b-it', persona: 'x', context: { kind: 'tap', part: '脸' } })
    expect(attempt.text).toBe('哼，手拿开。')
    expect(calls).toHaveLength(2)
    expect(calls[0].reasoningEffort).toBeUndefined()
    expect(calls[1].reasoningEffort).toBe('off')
  })
})

describe('generateReply 结束原因', () => {
  it('把 finish.failure 带进错误码', async () => {
    const llm: WaifuLlm = {
      stream() {
        return (async function* () {
          yield { type: 'finish', reason: { kind: 'error', failure: { code: 'UNKNOWN_MODEL', message: 'no model x' } } }
        })()
      },
    }
    const attempt = await generateReply(llm, { provider: 'p', model: 'm', persona: 'x', context: { kind: 'tap', part: '脸' } })
    expect(attempt.text).toBeNull()
    expect(attempt.error).toContain('UNKNOWN_MODEL')
    expect(attempt.error).toContain('no model x')
  })
})

describe('savePersona', () => {
  it('写入人设文件并返回内容与路径', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-waifu-persona-'))
    const result = savePersona(dir, '  你是「简」，说话带刺但心软。  ')
    expect(result.text).toBe('你是「简」，说话带刺但心软。')
    expect(result.path).toBe(personaPath(dir))
    expect(readFileSync(join(dir, PERSONA_FILENAME), 'utf8')).toBe(result.text)
    rmSync(dir, { recursive: true, force: true })
  })

  it('空白内容回落默认人设、超长内容截断', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-waifu-persona-'))
    expect(savePersona(dir, '   ').text).toBe(DEFAULT_PERSONA)
    const long = '人'.repeat(MAX_PERSONA_CHARS + 50)
    expect(savePersona(dir, long).text.length).toBe(MAX_PERSONA_CHARS)
    expect(loadPersona(dir).length).toBe(MAX_PERSONA_CHARS)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('最近对话注入（ADR-030）', () => {
  const FALLBACK = { provider: 'p', model: 'm' }
  // 时间戳相对「现在」构造：时间戳前缀里同日只给 HH:MM、跨天补日期，
  // 写死日期会让这条用例在第二天必然失败（曾经就在跨 11/5→11/6 时挂过）。
  const T = Date.now() - 60_000
  const history: AiHistoryEntry[] = [
    { role: 'user', text: '第 1 句', at: T - 4000 },
    { role: 'assistant', text: '第 2 句', at: T - 3000, provider: 'p', model: 'm' },
    { role: 'user', text: '第 3 句', at: T - 2000 },
    { role: 'assistant', text: '第 4 句', at: T - 1000, provider: 'p', model: 'm' },
  ]

  it('轮数为 0 时不注入', () => {
    expect(historyMessages(history, 0, FALLBACK)).toHaveLength(0)
    expect(historyMessages([], 10, FALLBACK)).toHaveLength(0)
  })

  it('按「轮」取最近若干轮（1 轮 = 一问一答两条），且丢掉开头没有提问的 assistant', () => {
    expect(historyMessages(history, 1, FALLBACK)).toHaveLength(2)
    expect(historyMessages(history, 1, FALLBACK)[0].role).toBe('user')
    expect(historyMessages(history, 2, FALLBACK)).toHaveLength(4)
    expect(historyMessages(history, 99, FALLBACK)).toHaveLength(4)
  })

  it('注入的历史带时间戳前缀（同一天只给时分，跨天补日期）', () => {
    const rows = historyMessages(history, 1, FALLBACK)
    // fixture 用的是「一分钟前」，必然落在今天 → 只带 HH:MM
    const clock = `${String(new Date(T - 2000).getHours()).padStart(2, '0')}:${String(new Date(T - 2000).getMinutes()).padStart(2, '0')}`
    expect(rows[0].content[0].text).toBe(`[${clock}] 第 3 句`)
    const now = new Date('2026-11-05T21:10:00').getTime()
    expect(formatStamp(new Date('2026-11-05T20:03:00').getTime(), now)).toBe('20:03')
    expect(formatStamp(new Date('2026-11-04T20:03:00').getTime(), now)).toBe('11/4 20:03')
  })

  it('chat 场景：原话进「主人刚对你说」，并要求回应这句话', () => {
    const text = buildSceneMessage({ kind: 'chat', text: '今天累不累？' })
    expect(text).toContain('主人刚对你说「今天累不累？」')
    expect(text).toContain('回应主人这句话')
    expect(text).not.toContain('即兴演一下这一刻的反应')
    // 历史里不写「回应」指令，只记发生过的事
    expect(buildSceneMessage({ kind: 'chat', text: '今天累不累？' }, { forHistory: true }))
      .toContain('主人刚对你说「今天累不累？」')
  })

  it('场景描述注入当前时间', () => {
    const text = buildSceneMessage({ kind: 'tap', part: '头' })
    expect(text).toMatch(/现在是 \d+月\d+日 周[一二三四五六日] \d{2}:\d{2}/)
    expect(formatNow(new Date('2026-11-05T21:10:00').getTime())).toBe('11月5日 周四 21:10')
  })

  it('onPayload 回报实际发出的 system 与逐条 messages', async () => {
    const llm = fakeLlm(['好'])
    const payloads: { system: string; messages: { role: string; content: string }[] }[] = []
    await generateReply(llm, {
      provider: 'p',
      model: 'm',
      persona: '人设',
      context: { kind: 'tap', part: '脸', hint: '别捏脸啦～' },
      history,
      historyCount: 1,
      onPayload: (payload) => payloads.push(payload),
    })
    expect(payloads).toHaveLength(1)
    expect(payloads[0].system).toContain('人设')
    expect(payloads[0].messages).toHaveLength(3)
    expect(payloads[0].messages[2].content).toContain('主人刚戳了你的「脸」')
    expect(payloads[0].messages[2].content).toContain('别捏脸啦～')
    expect(payloads[0].messages[0].content).not.toContain('别捏脸啦')
  })

  it('注入内容排在当前情景之前', async () => {
    const llm = fakeLlm(['好'])
    await generateReply(llm, {
      provider: 'p',
      model: 'm',
      persona: '人设',
      context: { kind: 'tap', part: '脸' },
      history,
      historyCount: 1,
    })
    const messages = llm.calls[0].messages
    expect(messages).toHaveLength(3)
    expect(messages[0].role).toBe('user')
    expect(messages[1].role).toBe('assistant')
    expect(messages[2].role).toBe('user')
    expect(JSON.stringify(messages[0])).toContain('第 3 句')
    // assistant 历史必须带 source（否则 pi-ai 重建历史时读 message.source.replayState 崩）
    expect(messages[1]).toMatchObject({ role: 'assistant', source: { kind: 'model' } })
    expect(JSON.stringify(messages[2])).toContain('主人刚戳了你的「脸」')
  })

  it('历史版情景描述不含参考台词', () => {
    const live = buildSceneMessage({ kind: 'tap', part: '脸', hint: '别捏脸啦～' })
    const forHistory = buildSceneMessage({ kind: 'tap', part: '脸', hint: '别捏脸啦～' }, { forHistory: true })
    expect(live).toContain('你下意识想说的是「别捏脸啦～」')
    expect(forHistory).not.toContain('你下意识想说的是')
    expect(forHistory).not.toContain('别捏脸啦')
    expect(forHistory).toContain('主人刚戳了你的「脸」')
  })

  it('历史只保留上限条数，且默认上限等于 limits.max', () => {
    expect(AI_HISTORY_MAX_ENTRIES).toBe(AI_HISTORY_LIMITS.max * 2)
    let list: AiHistoryEntry[] = []
    for (let i = 0; i < AI_HISTORY_MAX_ENTRIES + 20; i += 1) {
      list = appendHistory(list, { role: i % 2 === 0 ? 'user' : 'assistant', text: `t${i}`, at: 1_700_000_000_000 + i })
    }
    expect(list).toHaveLength(AI_HISTORY_MAX_ENTRIES)
    expect(list[list.length - 1].text).toBe(`t${AI_HISTORY_MAX_ENTRIES + 19}`)
  })
})

describe('情绪标签', () => {
  it('拆掉开头的方括号标签并识别情绪', () => {
    expect(parseEmotionTag('[shy] 别、别看了啦')).toEqual({ emotion: 'shy', rest: '别、别看了啦' })
    expect(parseEmotionTag('【害羞】别看了')).toEqual({ emotion: 'shy', rest: '别看了' })
    expect(parseEmotionTag('(angry)喂！')).toEqual({ emotion: 'angry', rest: '喂！' })
  })
  it('没有标签或标签不认识时原样返回', () => {
    expect(parseEmotionTag('别看了啦')).toEqual({ emotion: null, rest: '别看了啦' })
    expect(parseEmotionTag('[dunno] 喂')).toEqual({ emotion: null, rest: '[dunno] 喂' })
  })
  it('生成结果带上情绪', async () => {
    const llm = fakeLlm(['[smug] 就这点本事？'])
    const result = await generateReply(llm, {
      provider: 'p', model: 'm', persona: '人设', context: { kind: 'tap', part: '头' },
    })
    expect(result.text).toBe('就这点本事？')
    expect(result.emotion).toBe('smug')
  })
})
