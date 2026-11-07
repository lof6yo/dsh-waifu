import { describe, expect, it } from 'vitest'
import { DEFAULT_PERSONA, type AiHistoryEntry } from './ai.ts'
import {
  assembleRequest,
  buildSceneMessage,
  eventSceneText,
  historyMessages,
  historySceneText,
  systemPrompt,
} from './director.ts'
import { DEFAULT_EVENT_TEXTS } from './defaults.ts'
import { AI_MOTION_IDS, EXPRESSION_IDS } from './models.ts'

/**
 * 剧本引擎的 golden 测试：剧本是纯数据，改提示词/搬代码都必须在这里留下 diff。
 * 哈希而不是全文，是为了让断言只关心「有没有变」，具体改了什么看 git diff。
 */
function fnv(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** 时间相关片段归一化：剧本里唯一的非确定性来源是「现在几点」和历史时间戳。 */
function stable(text: string): string {
  return text
    .replace(/现在是 [^。]*。/g, '现在是 <NOW>。')
    .replace(/\[(?:\d{1,2}\/\d{1,2} )?\d\d:\d\d\]/g, '[<TIME>]')
}

const CATALOG = { motionTexts: { Nod: '轻轻点头' }, expressionEnabled: { blood: false } }

describe('剧本引擎（纯函数，ADR-047 P1）', () => {
  it('system 提示词的内容稳定（golden 哈希）', () => {
    const system = systemPrompt(DEFAULT_PERSONA, '- 主人喜欢猫\n- 主人怕痒', CATALOG)
    expect(system.length).toBe(1191)
    expect(fnv(system)).toBe('ca46c5e5')
  })

  it('同一输入两次组装结果完全一致（不读状态、不累积）', () => {
    const build = () => {
      const { system, messages } = assembleRequest({
        provider: 'openrouter',
        model: 'google/gemma-4-31b-it',
        persona: DEFAULT_PERSONA,
        memory: '- 主人喜欢猫',
        context: { kind: 'tap', part: '脸', interaction: '捏' },
        history: [],
        historyCount: 10,
      })
      return { system, text: JSON.stringify(messages) }
    }
    expect(stable(build().text)).toBe(stable(build().text))
  })

  it('assembled messages 的内容稳定（golden 哈希）', () => {
    let payload: { system: string; messages: { role: string; content: string }[]; temperature?: number; maxTokens?: number } | null = null
    const { messages } = assembleRequest({
      provider: 'openrouter',
      model: 'google/gemma-4-31b-it',
      persona: DEFAULT_PERSONA,
      memory: '- 主人喜欢猫',
      context: { kind: 'tap', part: '脸', interaction: '捏', tz: 'Asia/Shanghai' },
      history: [
        { role: 'user', text: '主人「捏」了「脸」', at: 1 },
        { role: 'assistant', text: '唔…别、别捏啦', at: 2, provider: 'openrouter', model: 'google/gemma-4-31b-it' },
      ],
      historyCount: 10,
      onPayload: (value) => { payload = value as typeof payload },
    })
    const flat = messages.map((message) => ({
      role: message.role,
      content: message.content.map((part) => String((part as { text?: unknown }).text ?? '')).join(''),
    }))
    expect(flat.length).toBe(3)
    expect(fnv(stable(JSON.stringify(flat)))).toBe('b991a75a')
    // 载荷记录的就是实际发出去的东西：采样参数 + system + 全部 messages
    expect(payload).not.toBeNull()
    expect(payload!.temperature).toBe(1)
    expect(payload!.maxTokens).toBe(160)
    expect(fnv(stable(JSON.stringify(payload)))).toBe('0d3d5dae')
  })

  it('目录里的每个 id 都有一行释义；关掉的表情不出现', () => {
    const system = systemPrompt(DEFAULT_PERSONA, '', CATALOG)
    for (const id of AI_MOTION_IDS) expect(system).toContain(`- ${id}：`)
    for (const id of EXPRESSION_IDS) {
      if (id === 'blood') expect(system).not.toContain(`- ${id}：`)
      else expect(system).toContain(`- ${id}：`)
    }
    // 释义覆写生效
    expect(system).toContain('- Nod：轻轻点头')
  })

  it('没有可用动作/表情时明确说不要写标签', () => {
    const system = systemPrompt('人设', '', { motionEnabled: Object.fromEntries(AI_MOTION_IDS.map((id) => [id, false])) })
    expect(system).toContain('这次没有可用动作')
  })

  it('场景句：触摸/对话/事件/静默各有固定句式，合并事件尾随其后', () => {
    const tap = buildSceneMessage({ kind: 'tap', part: '脸', interaction: '捏' })
    expect(tap).toMatch(/^现在是 .+。主人「捏」了你的「脸」。按你的人设回应。$/)

    const bare = buildSceneMessage({ kind: 'tap', part: '腰' })
    expect(bare).toContain('主人碰了你的「腰」')

    const chat = buildSceneMessage({ kind: 'chat', text: '  在吗  ' })
    expect(chat).toContain('主人对你说「在吗」')

    const event = buildSceneMessage(
      { kind: 'event', event: 'done', merged: ['工具·读取×4', '  '] },
      { done: '你完成了任务' },
    )
    expect(event).toContain('眼下你完成了任务')
    expect(event).toContain('这期间还发生了：工具·读取×4。')

    expect(buildSceneMessage({ kind: 'idle' })).toContain('有一阵子没人理你')
  })

  it('事件文案优先用户覆写，其次内置，最后兜底', () => {
    expect(eventSceneText('done', { done: '搞定了' })).toBe('搞定了')
    expect(eventSceneText('done')).toBe(DEFAULT_EVENT_TEXTS.done)
    expect(eventSceneText('mystery')).toBe('发生了「mystery」这件事')
  })

  it('历史场景只留最短事实，合并事件折算成数量', () => {
    expect(historySceneText({ kind: 'tap', part: '脸', interaction: '捏' })).toBe('主人「捏」了「脸」')
    expect(historySceneText({ kind: 'chat', text: '在吗' })).toBe('主人说「在吗」')
    expect(historySceneText({ kind: 'event', event: 'done', merged: ['a', 'b'] }, { done: '你完成了任务' }))
      .toBe('你完成了任务（另有 2 件事）')
  })

  it('历史消息：按轮换算条数、丢掉开头的 assistant、空文本过滤', () => {
    const history: AiHistoryEntry[] = [
      { role: 'assistant', text: '孤立的回答', at: 0 },
      { role: 'user', text: '第一问', at: 0 },
      { role: 'assistant', text: '第一答', at: 0 },
      { role: 'user', text: '   ', at: 0 },
      { role: 'user', text: '第二问', at: 0 },
      { role: 'assistant', text: '第二答', at: 0 },
    ]
    // 3 轮 = 6 条：开头的孤立 assistant 被丢掉，空文本被过滤
    const messages = historyMessages(history, 3, { provider: 'p', model: 'm' })
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(messages[0].content[0].text).toBe('第一问')
    expect(messages[1].source).toEqual({ kind: 'model', provider: 'p', model: 'm' })
    expect(messages[0].source).toEqual({ kind: 'user' })
    // 2 轮 = 4 条：只留最后两条有效对话
    const tail = historyMessages(history, 2, { provider: 'p', model: 'm' })
    expect(tail.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(tail[0].content[0].text).toBe('第二问')
    expect(historyMessages(history, 0, { provider: 'p', model: 'm' })).toEqual([])
    expect(historyMessages([], 5, { provider: 'p', model: 'm' })).toEqual([])
  })

  it('历史消息带时间戳前缀（同一天只有时分，跨天补日期）', () => {
    const stamped = historyMessages(
      [{ role: 'user', text: '刚才', at: Date.now() - 60_000 }],
      1,
      { provider: 'p', model: 'm' },
      'UTC',
    )
    expect(stamped[0].content[0].text).toMatch(/^\[(?:\d{1,2}\/\d{1,2} )?\d\d:\d\d\] 刚才$/)
  })
})
