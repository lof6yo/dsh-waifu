import { runSpeakPipeline } from './src/speak.ts'
import type { ReplyChunk } from './src/ai.ts'

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

const out: Record<string, unknown[]> = {}
for (const sample of SAMPLES) {
  const frames: unknown[] = []
  await runSpeakPipeline({
    chunks: (async function* () { for (const chunk of sample.chunks) yield chunk })(),
    synthesize: async () => null,
    emit: (event, data) => { frames.push({ event, data }) },
  })
  out[sample.name] = frames
}
console.log(JSON.stringify(out, null, 2))
