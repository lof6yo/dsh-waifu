import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_PERSONA,
  MAX_PERSONA_CHARS,
  MAX_REPLY_CHARS,
  PERSONA_FILENAME,
  buildSceneMessage,
  generateReply,
  loadPersona,
  personaPath,
  sanitizeLine,
  savePersona,
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
    const text = await generateReply(llm, {
      provider: 'deepseek-official',
      model: 'deepseek-flash',
      persona: DEFAULT_PERSONA,
      context: { kind: 'tap', part: '手' },
    })
    expect(text).toBe('好吧…就一下')
    // 请求带上 provider/model 与人设前缀
    expect(llm.calls).toHaveLength(1)
    expect(llm.calls[0].provider).toBe('deepseek-official')
    expect(llm.calls[0].model).toBe('deepseek-flash')
    expect(llm.calls[0].system).toContain(DEFAULT_PERSONA)
    expect(llm.calls[0].maxTokens).toBe(80)
  })

  it('流中断或空文本返回 null（调用方回落预置台词）', async () => {
    const broken = fakeLlm(['啊', '哦'], { throwAt: 1 })
    expect(await generateReply(broken, { provider: 'p', model: 'm', persona: 'x', context: { kind: 'tap', part: '脸' } })).toBeNull()
    const empty = fakeLlm(['   '])
    expect(await generateReply(empty, { provider: 'p', model: 'm', persona: 'x', context: { kind: 'state', state: 'idle' } })).toBeNull()
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
