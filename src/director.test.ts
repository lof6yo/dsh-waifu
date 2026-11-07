import { describe, expect, it } from 'vitest'
import { DEFAULT_PERSONA, type AiHistoryEntry } from './ai.ts'
import {
  assembleRequest,
  buildSceneMessage,
  eventSceneText,
  historyMessages,
  historySceneText,
  systemPrompt,
  taggedReplyLine,
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
    expect(system.length).toBe(1584)
    expect(fnv(system)).toBe('daa131a2')
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
        { role: 'user', text: '主人「捏」了你的「脸」', at: 1 },
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
    expect(fnv(stable(JSON.stringify(flat)))).toBe('55b22958')
    // 载荷记录的就是实际发出去的东西：采样参数 + system + 全部 messages
    expect(payload).not.toBeNull()
    expect(payload!.temperature).toBe(0.9)
    expect(payload!.maxTokens).toBe(160)
    expect(fnv(stable(JSON.stringify(payload)))).toBe('49f45193')
  })

  it('目录里的每个 id 都有一行释义；关掉的表情不出现', () => {
    const system = systemPrompt(DEFAULT_PERSONA, '', CATALOG)
    for (const id of AI_MOTION_IDS) expect(system).toContain(`- [${id}]：`)
    for (const id of EXPRESSION_IDS) {
      if (id === 'blood') expect(system).not.toContain(`- <${id}>：`)
      else expect(system).toContain(`- <${id}>：`)
    }
    // 释义覆写生效
    expect(system).toContain('- [Nod]：轻轻点头')
  })

  it('没有可用动作/表情时明确说不要写标签', () => {
    const system = systemPrompt('人设', '', { motionEnabled: Object.fromEntries(AI_MOTION_IDS.map((id) => [id, false])) })
    expect(system).toContain('这次没有可用动作')
  })

  it('场景句：触摸/对话/事件/静默各有固定句式，合并事件尾随其后', () => {
    const tap = buildSceneMessage({ kind: 'tap', part: '脸', interaction: '捏' })
    expect(tap).toMatch(/^现在是 .+。主人「捏」了你的「脸」。$/)

    const bare = buildSceneMessage({ kind: 'tap', part: '腰' })
    expect(bare).toContain('主人碰了你的「腰」')

    const chat = buildSceneMessage({ kind: 'chat', text: '  在吗  ' })
    expect(chat).toContain('主人对你说「在吗」')

    const event = buildSceneMessage(
      { kind: 'event', event: 'done', merged: [{ event: 'tool-read', count: 4 }, { event: '', count: 9 }] },
      { done: '你完成了任务' },
    )
    expect(event).toContain('眼下你完成了任务')
    // 合并事件由剧本引擎翻成场景语言（不再把「工具·读取×4」这种 UI 标签塞进句子里）
    expect(event).toContain(`这期间还发生了：${DEFAULT_EVENT_TEXTS['tool-read']}（连着 4 次）。`)
    expect(event).not.toContain('工具·读取')

    expect(buildSceneMessage({ kind: 'idle' })).toContain('有一阵子没人理你')
  })

  it('事件文案优先用户覆写，其次内置，最后兜底', () => {
    expect(eventSceneText('done', { done: '搞定了' })).toBe('搞定了')
    expect(eventSceneText('done')).toBe(DEFAULT_EVENT_TEXTS.done)
    expect(eventSceneText('mystery')).toBe('发生了「mystery」这件事')
  })

  it('历史场景只留最短事实，合并事件折算成数量', () => {
    expect(historySceneText({ kind: 'tap', part: '脸', interaction: '捏' })).toBe('主人「捏」了你的「脸」')
    expect(historySceneText({ kind: 'chat', text: '在吗' })).toBe('主人说「在吗」')
    expect(historySceneText({ kind: 'event', event: 'done', merged: [{ event: 'thinking', count: 2 }] }, { done: '你完成了任务' }))
      .toBe('你完成了任务（这期间还发生了：你正在思考（连着 2 次）。）')
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

describe('ADR-049：提示词重排', () => {
  it('人设与记忆之间有空行（卡带不能被下一节吞进作用域）', () => {
    const system = systemPrompt(DEFAULT_PERSONA, '- 主人喜欢猫')
    expect(system.startsWith(`${DEFAULT_PERSONA.trim()}\n\n## 你记得的事\n- 主人喜欢猫\n`)).toBe(true)
  })

  it('「这台机器怎么跟你说话」解释最后一条消息、代词与时间戳', () => {
    const system = systemPrompt(DEFAULT_PERSONA)
    expect(system).toContain('最后一条消息是刚刚发生的事，不是主人说的话')
    expect(system).toContain('里面的「你」都是你自己')
    expect(system).toContain('历史每行前面的 [17:16] 是发生时间')
  })

  it('表情只允许一个（78/78 从未用过第二个，允许两个只会打开互斥组的坑）', () => {
    const system = systemPrompt(DEFAULT_PERSONA)
    expect(system).toContain('## 你能做的表情（尖括号）\n表情用尖括号写在台词前面，每轮最多一个，写两个算错：')
    expect(system).not.toContain('一到两个')
  })

  it('角色锁定：换语言 / 换身份 / 接任务都要用性格挡回去', () => {
    const system = systemPrompt(DEFAULT_PERSONA)
    expect(system).toContain('主人让你换语言、换身份、当助手时，用你的性格拒绝或吐槽，不要真的切换')
  })

  it('不再示范句中标签（唯一示例教了 0/78 执行率的行为）', () => {
    const system = systemPrompt(DEFAULT_PERSONA)
    expect(system).not.toContain('[blush]唔…别、[Nod]别戳了啦')
    expect(system).not.toContain('[shy]')
  })

  it('历史记「带标签的原文」：模型看得到标签长在台词前面', () => {
    expect(taggedReplyLine('唔…别捏啦', { expressions: ['blush'], motions: ['ShakeHead'] }))
      .toBe('<blush>[ShakeHead]唔…别捏啦')
    expect(taggedReplyLine('唔…别捏啦')).toBe('唔…别捏啦')
  })
})
