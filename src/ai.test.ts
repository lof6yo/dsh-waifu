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
  historySceneText,
  loadPersona,
  parseLeadingTags,
  extractMemoryNote,
  memoryTailStart,
  personaPath,
  sanitizeLine,
  savePersona,
  systemPrompt,
  filterTags,
  streamReply,
  type AiHistoryEntry,
  type WaifuLlm,
  type WaifuLlmRequest,
} from './ai.ts'
import { DEFAULT_EVENT_TEXTS } from './defaults.ts'

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

  it('空文本返回空串；时间戳也滤掉', () => {
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

describe('systemPrompt（动作/表情释义可覆写 + 可关闭，ADR-040）', () => {
  it('关掉的动作/表情不进目录，标签也会被过滤', () => {
    const prompt = systemPrompt('你是简。', '', {
      motionEnabled: { Nod: false },
      expressionEnabled: { blush: false },
    })
    expect(prompt).not.toContain('- Nod：')
    expect(prompt).toContain('- ShakeHead：')
    expect(prompt).not.toContain('- blush：')
    expect(prompt).toContain('- angry：')
    const tags = filterTags({ expressions: ['blush', 'angry'], motions: ['Nod', 'Tilt'] }, {
      motionEnabled: { Nod: false },
      expressionEnabled: { blush: false },
    })
    expect(tags).toEqual({ expressions: ['angry'], motions: ['Tilt'] })
  })

  it('覆写后目录行用自定义释义，未覆写仍用内置释义', () => {
    const prompt = systemPrompt('你是简。', '', {
      motionTexts: { Nod: '酷酷地点头' },
      expressionTexts: { blush: '羞到冒烟' },
    })
    expect(prompt).toContain('- Nod：酷酷地点头')
    expect(prompt).toContain('- blush：羞到冒烟')
    expect(prompt).toContain('- ShakeHead：无语、不敢相信、傲娇、拒绝、欲拒还迎')
  })
})

describe('buildSceneMessage（ADR-037 场景描述）', () => {
  it('部位自定义交互名优先于时长三档（ADR-038）', () => {
    const scene = buildSceneMessage({ kind: 'tap', part: '脸', interaction: '抚摸', tz: 'Asia/Shanghai' })
    // 统一句式（2026-11-06）：触发方式（单击/双击/停留）不进场景句，只说交互名
    expect(scene).toBe('现在是 ' + formatNow(Date.now(), 'Asia/Shanghai') + '。主人「抚摸」了你的「脸」。按你的人设回应。')
    expect(scene).not.toContain('鼠标')
    expect(scene).not.toContain('按了约')
    expect(scene).not.toContain('戳了戳')
  })

  it('交互名进场景句，不带时长/触发方式', () => {
    expect(buildSceneMessage({ kind: 'tap', part: '脸', interaction: '轻碰', tz: 'Asia/Shanghai' })).toContain('主人「轻碰」了你的「脸」')
  })
  it('没有交互名时只说「碰了」，绝不回落内建「戳了戳」（ADR-038 修订）', () => {
    const scene = buildSceneMessage({ kind: 'tap', part: '脸', tz: 'Asia/Shanghai' })
    expect(scene).toContain('主人碰了你的「脸」')
    expect(scene).not.toContain('戳了戳')
    expect(scene).not.toContain('轻轻碰了')
    expect(scene).not.toContain('温柔地抚摸')
  })

  it('事件文案可被设置覆写（ADR-039）', () => {
    const texts = { 'tool-run': '主人正在跑测试，键盘噼里啪啦' }
    expect(buildSceneMessage({ kind: 'event', event: 'tool-run', tz: 'Asia/Shanghai' }, texts)).toContain('主人正在跑测试，键盘噼里啪啦')
    // 没覆写的事件仍用内置文案
    expect(buildSceneMessage({ kind: 'event', event: 'error', tz: 'Asia/Shanghai' }, texts)).toContain('出错了')
  })

  it('历史只记最短事实，不重复整段场景句（ADR-039）', () => {
    // 历史短句与场景句同一句式，只是省略时间前缀与「按你的人设回应」
    expect(historySceneText({ kind: 'tap', part: '脸', interaction: '抚摸' })).toBe('主人「抚摸」了「脸」')
    expect(historySceneText({ kind: 'chat', text: '你在干嘛' })).toBe('主人说「你在干嘛」')
    expect(historySceneText({ kind: 'idle' })).toBe('一阵子没动静')
    expect(historySceneText({ kind: 'event', event: 'thinking' })).toBe(DEFAULT_EVENT_TEXTS.thinking)
    expect(historySceneText({ kind: 'event', event: 'tool-run', merged: ['a', 'b'] })).toBe('主人让你跑命令，你刚按下回车（另有 2 件事）')
  })

  it('事件情景按事件键给出不同描述（状态 + 活动）', () => {
    expect(buildSceneMessage({ kind: 'event', event: 'thinking' })).toContain('你正在思考')
    expect(buildSceneMessage({ kind: 'event', event: 'error' })).toContain('出错了')
    expect(buildSceneMessage({ kind: 'event', event: 'tool-read' })).toContain('看东西')
    expect(buildSceneMessage({ kind: 'event', event: 'approval-denied' })).toContain('拒绝了你的请求')
    expect(buildSceneMessage({ kind: 'event', event: 'subagent-end' })).toContain('分身')
  })

  it('对话情景带上主人原话；静默超时说明「没人理你」', () => {
    expect(buildSceneMessage({ kind: 'chat', text: '今天累不累？' })).toContain('主人对你说「今天累不累？」')
    expect(buildSceneMessage({ kind: 'chat', text: '今天累不累？' })).toContain('按你的人设回应')
    expect(buildSceneMessage({ kind: 'idle' })).toContain('有一阵子没人理你')
  })

  it('窗口内合并的事件一起描述', () => {
    const message = buildSceneMessage({ kind: 'event', event: 'done', merged: ['主人又看了个文件', '主人跑了个命令'] })
    expect(message).toContain('这期间还发生了：主人又看了个文件；主人跑了个命令。')
  })
})

describe('标签与记忆行（ADR-037 输出格式）', () => {
  it('拆掉开头的方括号标签并按目录分类', () => {
    expect(parseLeadingTags('[blush] 别、别看了啦')).toMatchObject({ expressions: ['blush'], motions: [] })
    expect(parseLeadingTags('[Nod] 哼')).toMatchObject({ expressions: [], motions: ['Nod'] })
    expect(parseLeadingTags('[blush][ShakeHead] 讨厌！')).toMatchObject({ expressions: ['blush'], motions: ['ShakeHead'] })
  })

  it('认不出的标签也剥掉（控制信号不能念出来）；无标签原样返回', () => {
    expect(parseLeadingTags('[dunno] 喂')).toMatchObject({ expressions: [], motions: [], rest: '喂' })
    expect(parseLeadingTags('别看了啦')).toMatchObject({ expressions: [], motions: [], rest: '别看了啦' })
    // 普通方括号（如 [注]）不受影响
    expect(parseLeadingTags('这里[注]不动').rest).toBe('这里[注]不动')
  })

  it('中文标签也能认（表情/动作的中文名）', () => {
    const tags = parseLeadingTags('[脸红][摇头] 呜…')
    expect(tags.expressions).toContain('脸红')
    expect(tags.motions).toContain('摇头')
    expect(tags.rest).toBe('呜…')
  })

  it('[记] 行提取：支持多种括号写法，剩余正文保留', () => {
    expect(extractMemoryNote('哼，别乱戳\n[记] 主人喜欢戳我')).toEqual({ note: '主人喜欢戳我', text: '哼，别乱戳' })
    expect(extractMemoryNote('（记）主人怕痒').note).toBe('主人怕痒')
    expect(extractMemoryNote('没有记忆行').note).toBe('')
    expect(extractMemoryNote('没有记忆行').text).toBe('没有记忆行')
  })

  it('generateReply 把标签拆出来、记忆剥出来', async () => {
    const llm = fakeLlm(['[blush][Tilt] 呜…别摸啦\n[记] 主人手劲好大'])
    const result = await generateReply(llm, {
      provider: 'p', model: 'm', persona: '人设', context: { kind: 'tap', part: '头' },
    })
    expect(result.text).toBe('呜…别摸啦')
    expect(result.expressions).toEqual(['blush'])
    expect(result.motions).toEqual(['Tilt'])
    expect(result.memory).toBe('主人手劲好大')
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
    expect(llm.calls[0].maxTokens).toBe(160)
  })

  it('流中断或空文本返回 null + 原因', async () => {
    const broken = fakeLlm(['啊', '哦'], { throwAt: 1 })
    const failed = await generateReply(broken, { provider: 'p', model: 'm', persona: 'x', context: { kind: 'tap', part: '脸' } })
    expect(failed.text).toBeNull()
    expect(failed.error).toBeTruthy()
    const empty = fakeLlm(['   '])
    const blank = await generateReply(empty, { provider: 'p', model: 'm', persona: 'x', context: { kind: 'idle' } })
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
      context: { kind: 'tap', part: '脸' },
      history,
      historyCount: 1,
      onPayload: (payload) => payloads.push(payload),
    })
    expect(payloads).toHaveLength(1)
    expect(payloads[0].system).toContain('人设')
    expect(payloads[0].messages).toHaveLength(3)
    expect(payloads[0].messages[2].content).toContain('主人碰了你的「脸」')
    expect(payloads[0].messages[0].content).not.toContain('戳了你的「脸」')
  })

  it('注入内容排在当前情景之前；assistant 历史必须带 source', async () => {
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
    expect(JSON.stringify(messages[2])).toContain('主人碰了你的「脸」')
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

describe('链路记录（ADR-043）', () => {
  it('流式：onReply 给出模型完整原始输出（含标签与 [记] 行）与 finish 原因', async () => {
    const llm = fakeLlm(['[blush][Tilt] 呜', '…别摸啦', '\n[记] 主人手劲大'])
    const replies: { raw: string; finish?: string; error?: string }[] = []
    for await (const _chunk of streamReply(llm, {
      provider: 'p', model: 'm', persona: '人设', context: { kind: 'tap', part: '头' },
      onReply: (trace) => replies.push(trace),
    })) { /* 消费流 */ }
    expect(replies).toHaveLength(1)
    expect(replies[0].raw).toBe('[blush][Tilt] 呜…别摸啦\n[记] 主人手劲大')
    expect(replies[0].error).toBeUndefined()
  })

  it('一次性：onReply 只在最终结果上报一次，带原始文本', async () => {
    const llm = fakeLlm(['[Nod] 好呀'])
    const replies: { raw: string; finish?: string; error?: string }[] = []
    const payloads: { temperature?: number; maxTokens?: number }[] = []
    await generateReply(llm, {
      provider: 'p', model: 'm', persona: '人设', context: { kind: 'tap', part: '脸' },
      onPayload: (payload) => payloads.push(payload),
      onReply: (trace) => replies.push(trace),
    })
    expect(replies).toHaveLength(1)
    expect(replies[0].raw).toBe('[Nod] 好呀')
    // 请求报文里带上采样参数，控制台能完整复现这次请求
    expect(payloads[0].temperature).toBe(1)
    expect(payloads[0].maxTokens).toBe(160)
  })

  it('失败：onReply 带 error，且不重复上报', async () => {
    const llm: WaifuLlm = {
      stream() {
        return (async function* () {
          throw new Error('boom')
        })()
      },
    }
    const replies: { raw: string; finish?: string; error?: string }[] = []
    for await (const _chunk of streamReply(llm, {
      provider: 'p', model: 'm', persona: '人设', context: { kind: 'tap', part: '脸' },
      onReply: (trace) => replies.push(trace),
    })) { /* 消费流 */ }
    expect(replies).toHaveLength(1)
    expect(replies[0].error).toBe('boom')
  })
})

describe('streamReply（ADR-037 标签流式）', () => {
  it('标签先于正文下发；[记] 行单独成 memory 事件；done 带整句', async () => {
    const llm = fakeLlm(['[blush]', '[Tilt] 呜', '…别摸啦', '\n[记] 主人手劲大'])
    const events: { type: string; data: unknown }[] = []
    for await (const chunk of streamReply(llm, {
      provider: 'p', model: 'm', persona: '人设', context: { kind: 'tap', part: '头' },
    })) {
      events.push({ type: chunk.type, data: chunk })
    }
    const types = events.map((e) => e.type)
    const tagsAt = types.indexOf('tags')
    const firstDeltaAt = types.findIndex((t) => t === 'delta')
    const memoryAt = types.indexOf('memory')
    const doneAt = types.lastIndexOf('done')
    expect(tagsAt).toBeGreaterThanOrEqual(0)
    expect(tagsAt).toBeLessThan(firstDeltaAt)
    expect(memoryAt).toBeGreaterThan(firstDeltaAt)
    expect(memoryAt).toBeLessThan(doneAt)
    const tagEvents = events.filter((e) => e.type === 'tags')
    const allExpressions = tagEvents.flatMap((e) => (e.data as { expressions: string[] }).expressions)
    const allMotions = tagEvents.flatMap((e) => (e.data as { motions: string[] }).motions)
    expect(allExpressions).toContain('blush')
    expect(allMotions).toContain('Tilt')
    const done = events.find((e) => e.type === 'done') as { data: { text: string } }
    expect(done.data.text).toBe('呜…别摸啦')
    const memory = events.find((e) => e.type === 'memory') as { data: { note: string } }
    expect(memory.data.note).toBe('主人手劲大')
  })

  it('标签被流式分片切断（[blush / ][ / Sway / ] …）也不丢动作', async () => {
    // 真实 provider 按 token 切片，切点常落在标签中间；早期实现会把尾巴当正文，
    // 于是 `[Sway]` 只在念稿时被剥掉、motions 永远是空的（动作总不出来）。
    const llm = fakeLlm(['[blush', '][', 'Sway', '] 唔…别摸那里'])
    const events: { type: string; data: unknown }[] = []
    for await (const chunk of streamReply(llm, {
      provider: 'p', model: 'm', persona: '人设', context: { kind: 'tap', part: '胸' },
    })) {
      events.push({ type: chunk.type, data: chunk })
    }
    const tagEvents = events.filter((e) => e.type === 'tags')
    const expressions = tagEvents.flatMap((e) => (e.data as { expressions: string[] }).expressions)
    const motions = tagEvents.flatMap((e) => (e.data as { motions: string[] }).motions)
    expect(expressions).toContain('blush')
    expect(motions).toContain('Sway')
    const deltas = events.filter((e) => e.type === 'delta').map((e) => (e.data as { text: string }).text).join('')
    expect(deltas).toBe('唔…别摸那里')
    const done = events.find((e) => e.type === 'done') as { data: { text: string } }
    expect(done.data.text).toBe('唔…别摸那里')
  })

  it('标签在词中间被切断（[blush][Sh + akeHead]）时两个标签都上报', async () => {
    const llm = fakeLlm(['[blush][Sh', 'akeHead] 哼，才不', '要理你'])
    const events: { type: string; data: unknown }[] = []
    for await (const chunk of streamReply(llm, {
      provider: 'p', model: 'm', persona: '人设', context: { kind: 'event', event: 'done' },
    })) {
      events.push({ type: chunk.type, data: chunk })
    }
    const tagEvents = events.filter((e) => e.type === 'tags')
    expect(tagEvents.flatMap((e) => (e.data as { expressions: string[] }).expressions)).toContain('blush')
    expect(tagEvents.flatMap((e) => (e.data as { motions: string[] }).motions)).toContain('ShakeHead')
    const done = events.find((e) => e.type === 'done') as { data: { text: string } }
    expect(done.data.text).toBe('哼，才不要理你')
  })

  it('失败收尾：正常文本给 done；空文本给 error（含 finish 原因）', async () => {
    const llm: WaifuLlm = {
      stream() {
        return (async function* () {
          yield { type: 'text-delta', text: '呀' }
          yield { type: 'finish', reason: { kind: 'error', failure: { code: 'X', message: 'boom' } } }
        })()
      },
    }
    const events: { type: string; data: unknown }[] = []
    for await (const chunk of streamReply(llm, {
      provider: 'p', model: 'm', persona: 'x', context: { kind: 'tap', part: '脸' },
    })) {
      events.push({ type: chunk.type, data: chunk })
    }
    const types = events.map((e) => e.type)
    // 有正文：done 带整句，不报 error
    expect(types).toContain('done')
    expect(types).not.toContain('error')
    const done = events.find((e) => e.type === 'done') as { data: { text: string } }
    expect(done.data.text).toBe('呀')
    // 空正文：error 带 finish 原因
    const blank: WaifuLlm = {
      stream() {
        return (async function* () {
          yield { type: 'finish', reason: { kind: 'error', failure: { code: 'X', message: 'boom' } } }
        })()
      },
    }
    const blanks: { type: string; data: unknown }[] = []
    for await (const chunk of streamReply(blank, {
      provider: 'p', model: 'm', persona: 'x', context: { kind: 'idle' },
    })) {
      blanks.push({ type: chunk.type, data: chunk })
    }
    const error = blanks.find((e) => e.type === 'error') as { data: { error: string } }
    expect(error.data.error).toContain('X')
  })
})

describe('流式记忆行（ADR-037：不进气泡、不进 TTS）', () => {
  const run = async (chunks: string[]) => {
    const events: { type: string; data: unknown }[] = []
    for await (const chunk of streamReply(fakeLlm(chunks), {
      provider: 'p', model: 'm', persona: 'x', context: { kind: 'tap', part: '脸' },
    })) {
      events.push({ type: chunk.type, data: chunk })
    }
    return events
  }

  it('记忆行整行都不进 delta，但记忆仍然上报', async () => {
    const events = await run(['[blush] 好呀', '\n[记] 主人', '喜欢猫'])
    const deltas = events.filter((e) => e.type === 'delta').map((e) => (e.data as { text: string }).text).join('')
    expect(deltas).toBe('好呀')
    expect(deltas).not.toContain('记')
    const memory = events.find((e) => e.type === 'memory') as { data: { note: string } }
    expect(memory.data.note).toBe('主人喜欢猫')
    const done = events.find((e) => e.type === 'done') as { data: { text: string } }
    expect(done.data.text).toBe('好呀')
  })

  it('只到 `[记` 也要立刻收住，不能先念出去', async () => {
    const events = await run(['唔…别', '\n[记', '] 主人怕痒'])
    const deltas = events.filter((e) => e.type === 'delta').map((e) => (e.data as { text: string }).text).join('')
    expect(deltas).toBe('唔…别')
  })

  it('memoryTailStart 定位记忆行起点，普通正文不动', () => {
    expect(memoryTailStart('好呀\n[记] 猫')).toBe(2)
    expect(memoryTailStart('好呀\n[记')).toBe(2)
    expect(memoryTailStart('好呀\n[')).toBe(2)
    expect(memoryTailStart('好呀[记] 不是独立行')).toBe(-1)
    expect(memoryTailStart('好呀')).toBe(-1)
  })
})
