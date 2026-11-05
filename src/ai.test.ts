import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AI_HISTORY_LIMITS,
  AI_HISTORY_MAX_ENTRIES,
  DEFAULT_PERSONA,
  MAX_PERSONA_CHARS,
  MAX_REPLY_CHARS,
  PERSONA_FILENAME,
  appendHistory,
  buildSceneMessage,
  generateReply,
  historyMessages,
  loadPersona,
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
  const history: AiHistoryEntry[] = [
    { role: 'user', text: '第 1 句' },
    { role: 'assistant', text: '第 2 句' },
    { role: 'user', text: '第 3 句' },
    { role: 'assistant', text: '第 4 句' },
  ]

  it('条数为 0 时不注入', () => {
    expect(historyMessages(history, 0, FALLBACK)).toHaveLength(0)
    expect(historyMessages([], 10, FALLBACK)).toHaveLength(0)
  })

  it('按条数取最近若干条，且丢掉开头没有提问的 assistant', () => {
    expect(historyMessages(history, 2, FALLBACK)).toHaveLength(2)
    expect(historyMessages(history, 2, FALLBACK)[0].role).toBe('user')
    // 取 1 条时末尾是 assistant → 整段丢弃（避免以 assistant 开头的上下文）
    expect(historyMessages(history, 1, FALLBACK)).toHaveLength(0)
    expect(historyMessages(history, 99, FALLBACK)).toHaveLength(4)
  })

  it('注入内容排在当前情景之前', async () => {
    const llm = fakeLlm(['好'])
    await generateReply(llm, {
      provider: 'p',
      model: 'm',
      persona: '人设',
      context: { kind: 'tap', part: '脸' },
      history,
      historyCount: 2,
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

  it('历史只保留上限条数，且默认上限等于 limits.max', () => {
    expect(AI_HISTORY_MAX_ENTRIES).toBe(AI_HISTORY_LIMITS.max)
    let list: AiHistoryEntry[] = []
    for (let i = 0; i < AI_HISTORY_LIMITS.max + 20; i += 1) {
      list = appendHistory(list, { role: i % 2 === 0 ? 'user' : 'assistant', text: `t${i}` })
    }
    expect(list).toHaveLength(AI_HISTORY_LIMITS.max)
    expect(list[list.length - 1].text).toBe(`t${AI_HISTORY_LIMITS.max + 19}`)
  })
})
