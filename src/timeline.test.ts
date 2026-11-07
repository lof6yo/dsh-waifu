import { describe, expect, it } from 'vitest'
import { ClauseTimeline } from './timeline.ts'
import { runSpeakPipeline } from './speak.ts'
import type { ReplyChunk } from './ai.ts'

/**
 * 演出时间线（ADR-047 P2）。
 *
 * 第一组是**等价性**测试：把 `speak.ts` 里原来的切分逻辑搬进 `ClauseTimeline` 之后，
 * 四类输入产生的帧序列必须与搬迁前记录的快照一模一样（`clause` 只多一个 `cues` 字段）。
 * 这份快照是在重构前用当时的 `runSpeakPipeline` 现场录的，不是手写的。
 */
const GOLDEN: Record<string, { event: string; data: unknown }[]> = {
  "tags-then-two-clauses": [
    {
      "event": "tags",
      "data": {
        "expressions": [
          "blush"
        ],
        "motions": [
          "ShakeHead"
        ]
      }
    },
    {
      "event": "text",
      "data": {
        "delta": "唔…别、别戳了啦"
      }
    },
    {
      "event": "clause",
      "data": {
        "index": 0,
        "text": "唔…别、"
      }
    },
    {
      "event": "text",
      "data": {
        "delta": "，人家会害羞的。"
      }
    },
    {
      "event": "clause",
      "data": {
        "index": 1,
        "text": "别戳了啦，"
      }
    },
    {
      "event": "clause",
      "data": {
        "index": 2,
        "text": "人家会害羞的。"
      }
    },
    {
      "event": "done",
      "data": {
        "text": "唔…别、别戳了啦，人家会害羞的。"
      }
    }
  ],
  "single-clause-no-punct": [
    {
      "event": "text",
      "data": {
        "delta": "才不要"
      }
    },
    {
      "event": "clause",
      "data": {
        "index": 0,
        "text": "才不要"
      }
    },
    {
      "event": "done",
      "data": {
        "text": "才不要"
      }
    }
  ],
  "inline-tag-in-body": [
    {
      "event": "text",
      "data": {
        "delta": "好呀"
      }
    },
    {
      "event": "text",
      "data": {
        "delta": "[Nod]我当然乐意"
      }
    },
    {
      "event": "clause",
      "data": {
        "index": 0,
        "text": "好呀我当然乐意"
      }
    },
    {
      "event": "done",
      "data": {
        "text": "好呀我当然乐意"
      }
    }
  ],
  "memory-then-error": [
    {
      "event": "text",
      "data": {
        "delta": "我记住啦"
      }
    },
    {
      "event": "memory",
      "data": {
        "note": "主人喜欢猫"
      }
    },
    {
      "event": "clause",
      "data": {
        "index": 0,
        "text": "我记住啦"
      }
    },
    {
      "event": "error",
      "data": {
        "error": "stream-failed"
      }
    },
    {
      "event": "done",
      "data": {
        "text": "我记住啦"
      }
    }
  ]
}

const SAMPLES: { name: string; chunks: ReplyChunk[] }[] = [
  {
    name: 'tags-then-two-clauses',
    chunks: [
      { type: 'tags', expressions: ['blush'], motions: ['ShakeHead'] },
      { type: 'delta', text: '唔…别、别戳了啦' },
      { type: 'delta', text: '，人家会害羞的。' },
      { type: 'done', text: '唔…别、别戳了啦，人家会害羞的。' },
    ],
  },
  {
    name: 'single-clause-no-punct',
    chunks: [
      { type: 'delta', text: '才不要' },
      { type: 'done', text: '才不要' },
    ],
  },
  {
    name: 'inline-tag-in-body',
    chunks: [
      { type: 'delta', text: '好呀' },
      { type: 'delta', text: '[Nod]我当然乐意' },
      { type: 'done', text: '好呀我当然乐意' },
    ],
  },
  {
    name: 'memory-then-error',
    chunks: [
      { type: 'delta', text: '我记住啦' },
      { type: 'memory', note: '主人喜欢猫' },
      { type: 'error', error: 'stream-failed' },
    ],
  },
]

async function run(chunks: ReplyChunk[]) {
  const frames: { event: string; data: unknown }[] = []
  const result = await runSpeakPipeline({
    chunks: (async function* () { for (const chunk of chunks) yield chunk })(),
    synthesize: async () => null,
    emit: (event, data) => { frames.push({ event, data }) },
  })
  return { frames, result }
}

/** 去掉 P2 新增的 `cues` 字段，得到「旧版本会收到的帧」。 */
function withoutCues(frames: { event: string; data: unknown }[]) {
  return frames.map((frame) => {
    if (frame.event !== 'clause') return frame
    const data = frame.data as { index: number; text: string }
    return { event: frame.event, data: { index: data.index, text: data.text } }
  })
}

describe('演出时间线：切分与旧实现逐字节等价（ADR-047 P2）', () => {
  for (const sample of SAMPLES) {
    it(`${sample.name} 的帧序列与搬迁前一致`, async () => {
      const { frames } = await run(sample.chunks)
      expect(withoutCues(frames)).toEqual(GOLDEN[sample.name])
    })
  }

  it('开场的目录标签作为 cue 挂到第一段上（其余段为空）', async () => {
    const { frames } = await run(SAMPLES[0].chunks)
    const clauses = frames.filter((frame) => frame.event === 'clause').map((frame) => frame.data as {
      index: number; text: string; cues: { kind: string; id: string }[]
    })
    expect(clauses.map((clause) => clause.text)).toEqual(['唔…别、', '别戳了啦，', '人家会害羞的。'])
    expect(clauses[0].cues).toEqual([
      { kind: 'expression', id: 'blush' },
      { kind: 'motion', id: 'ShakeHead' },
    ])
    expect(clauses[1].cues).toEqual([])
    expect(clauses[2].cues).toEqual([])
  })

  it('没有标签时每段的 cues 都是空数组（客户端可以直接遍历）', async () => {
    const { frames } = await run(SAMPLES[1].chunks)
    const clause = frames.find((frame) => frame.event === 'clause')!.data as { cues: unknown[] }
    expect(clause.cues).toEqual([])
  })
})

describe('ClauseTimeline', () => {
  it('按句读切段，最后一段留给下一次', () => {
    const timeline = new ClauseTimeline()
    expect(timeline.push('唔…别、别戳了啦')).toEqual([{ index: 0, text: '唔…别、', cues: [] }])
    expect(timeline.push('，人家会害羞的。')).toEqual([{ index: 1, text: '别戳了啦，', cues: [] }])
    expect(timeline.push('然后呢')).toEqual([])
    // 收尾时最后一段整块交出（段内不再二次切分，保持旧实现的行为）
    expect(timeline.end()).toEqual([{ index: 2, text: '人家会害羞的。然后呢', cues: [] }])
    expect(timeline.length).toBe(3)
  })

  it('句中的目录标签变成本段 cue，认不出的方括号原样保留（ADR-048 P4）', () => {
    const fresh = new ClauseTimeline()
    fresh.push('好呀[Nod]我当然乐意。')
    expect(fresh.end()).toEqual([
      { index: 0, text: '好呀我当然乐意。', cues: [{ kind: 'motion', id: 'Nod' }] },
    ])
    const keep = new ClauseTimeline()
    keep.push('参见 [附件] 一节。')
    expect(keep.end()).toEqual([{ index: 0, text: '参见 [附件] 一节。', cues: [] }])
  })

  it('尾巴上的标签顺延给下一句（「别、[Nod]」→ 摇头跟着后半句）', () => {
    const timeline = new ClauseTimeline()
    expect(timeline.push('唔…别、[Nod]别戳了啦')).toEqual([{ index: 0, text: '唔…别、', cues: [] }])
    expect(timeline.end()).toEqual([{ index: 1, text: '别戳了啦', cues: [{ kind: 'motion', id: 'Nod' }] }])
  })

  it('没闭合的标签先扣住，不住正文里漏出半个标签', () => {
    const timeline = new ClauseTimeline()
    expect(timeline.push('好呀[No')).toEqual([])
    expect(timeline.push('d]我当然乐意。')).toEqual([])
    expect(timeline.end()).toEqual([
      { index: 0, text: '好呀我当然乐意。', cues: [{ kind: 'motion', id: 'Nod' }] },
    ])
  })

  it('中文名标签归一到目录 id（[脸红] → blush）', () => {
    const timeline = new ClauseTimeline()
    timeline.push('唔…[脸红]别看我。')
    expect(timeline.end()).toEqual([
      { index: 0, text: '唔…别看我。', cues: [{ kind: 'expression', id: 'blush' }] },
    ])
  })

  it('cue 只归属第一段，空段被丢掉且不占序号', () => {
    const timeline = new ClauseTimeline()
    timeline.tag(['blush'], ['Nod'])
    timeline.push('。')
    const clauses = timeline.end()
    expect(clauses).toEqual([{ index: 0, text: '。', cues: [{ kind: 'expression', id: 'blush' }, { kind: 'motion', id: 'Nod' }] }])
  })

  it('没有正文时 end 不产生段（避免凭空造一句空台词）', () => {
    const timeline = new ClauseTimeline()
    timeline.tag(['blush'], [])
    expect(timeline.end()).toEqual([])
    expect(timeline.length).toBe(0)
  })
})
