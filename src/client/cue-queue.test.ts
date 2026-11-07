import { describe, expect, it } from 'vitest'
import { MOTION_QUEUE_MAX, pushMotion, readCues, splitCues } from './cue-queue.ts'

/** 测试用的「目录」：只认这几个 id，模拟 isExpressionId / isMotionId。 */
const isExpression = (id: string) => ['blush', 'heart', 'angry'].includes(id)
const isMotion = (id: string) => ['Nod', 'ShakeHead', 'Sway'].includes(id)

describe('cue 解析（ADR-048 P3）', () => {
  it('只收形状正确、且在当前目录里的 cue', () => {
    const cues = readCues(
      [
        { kind: 'expression', id: 'blush' },
        { kind: 'motion', id: 'Nod' },
        { kind: 'expression', id: 'shy' },
        { kind: 'motion', id: 'dance' },
        { kind: 'expression' },
        { id: 'heart' },
        null,
        'blush',
      ],
      isExpression,
      isMotion,
    )
    expect(cues).toEqual([
      { kind: 'expression', id: 'blush' },
      { kind: 'motion', id: 'Nod' },
    ])
  })

  it('旧 Host 没有 cues 字段时给空数组（客户端据此回落到 tags 帧）', () => {
    expect(readCues(undefined, isExpression, isMotion)).toEqual([])
    expect(readCues([], isExpression, isMotion)).toEqual([])
  })

  it('拆成「立刻换的表情」与「排队播的动作」，各自去重且保持顺序', () => {
    expect(
      splitCues([
        { kind: 'expression', id: 'blush' },
        { kind: 'expression', id: 'heart' },
        { kind: 'expression', id: 'blush' },
        { kind: 'motion', id: 'Sway' },
        { kind: 'motion', id: 'Sway' },
      ]),
    ).toEqual({ expressions: ['blush', 'heart'], motions: ['Sway'] })
  })

  it('一格里只有表情时动作列表为空', () => {
    expect(splitCues([{ kind: 'expression', id: 'angry' }])).toEqual({ expressions: ['angry'], motions: [] })
  })
})

describe('动作串行队列', () => {
  it('按顺序入队，不修改原数组', () => {
    const queue: string[] = []
    const result = pushMotion(queue, 'Nod')
    expect(result).toEqual({ queue: ['Nod'], dropped: null })
    expect(queue).toEqual([])
  })

  it('满了丢最旧的，并报告被丢的那个', () => {
    let queue: string[] = []
    for (const name of ['Nod', 'Sway', 'ShakeHead']) {
      const result = pushMotion(queue, name)
      queue = result.queue
      if (name === 'ShakeHead') expect(result.dropped).toBe('Nod')
      else expect(result.dropped).toBe(null)
    }
    expect(queue).toEqual(['Sway', 'ShakeHead'])
    expect(queue.length).toBe(MOTION_QUEUE_MAX)
  })

  it('上限为 1 时永远只留最新的一个', () => {
    const first = pushMotion([], 'Nod', 1)
    const second = pushMotion(first.queue, 'Sway', 1)
    expect(second.queue).toEqual(['Sway'])
    expect(second.dropped).toBe('Nod')
  })

  it('空名字不占位置也不丢东西', () => {
    expect(pushMotion(['Nod'], '')).toEqual({ queue: ['Nod'], dropped: null })
  })
})
