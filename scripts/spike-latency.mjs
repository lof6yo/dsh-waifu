#!/usr/bin/env node
/**
 * spike-latency.mjs —— 量「用户按下到听见」的时间线（ADR-048 后续优化的基线工具）。
 *
 * 只读：打若干轮 `/speak`，记录每种 SSE 帧的到达时刻与下行字节，
 * 用来回答三个问题：
 *   1. 第一声（`audio` 第 0 段）离请求发出多久？
 *   2. 第一段台词（`clause` 第 0 段）离第一字节多久？
 *   3. 音频占下行多少（音频帧和文本帧同走一条 SSE）？
 *
 * 用法：
 *   WAIFU_TOKEN=<token> node scripts/spike-latency.mjs -n 4
 * 可选：WAIFU_BASE、--gap（默认 1800ms）、--part/--interaction
 */

const args = process.argv.slice(2)
function arg(name, fallback) {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const ROUNDS = Number(arg('n', '4'))
const GAP_MS = Number(arg('gap', '1800'))
const PART = arg('part', '腰')
const INTERACTION = arg('interaction', '搂住')
const BASE = process.env.WAIFU_BASE ?? 'http://192.168.31.119:3080'
const TOKEN = process.env.WAIFU_TOKEN ?? ''
if (!TOKEN) {
  console.error('缺 WAIFU_TOKEN（journalctl --user -u dsh-web.service | grep -o "token=[A-Za-z0-9_-]*" | tail -1 | cut -d= -f2）')
  process.exit(2)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function login() {
  const response = await fetch(`${BASE}/?token=${encodeURIComponent(TOKEN)}`, { redirect: 'manual' })
  const cookie = (response.headers.getSetCookie?.() ?? []).map((item) => item.split(';')[0]).join('; ')
  if (!cookie) throw new Error(`登录失败：HTTP ${response.status}`)
  return cookie
}

/** 打一轮，返回各阶段相对毫秒与下行字节。 */
async function speak(cookie) {
  const started = Date.now()
  const marks = {}
  let bytes = 0
  let audioBytes = 0
  let clauses = 0
  let audioFrames = 0
  const response = await fetch(`${BASE}/api/dsh-waifu/speak`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ kind: 'tap', part: PART, interaction: INTERACTION, tz: 'Asia/Shanghai' }),
  })
  if (!response.ok || response.body === null) throw new Error(`/speak HTTP ${response.status}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const mark = (name) => { if (marks[name] === undefined) marks[name] = Date.now() - started }
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    bytes += value?.byteLength ?? 0
    mark('bytes')
    buffer += decoder.decode(value, { stream: true })
    let split = buffer.indexOf('\n\n')
    while (split >= 0) {
      const block = buffer.slice(0, split)
      buffer = buffer.slice(split + 2)
      split = buffer.indexOf('\n\n')
      let event = null
      const data = []
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7).trim()
        else if (line.startsWith('data: ')) data.push(line.slice(6))
      }
      if (event === null) continue
      if (event === 'clause') {
        clauses += 1
        if (clauses === 1) mark('clause0')
        mark('clause')
      } else if (event === 'audio') {
        audioFrames += 1
        if (audioFrames === 1) mark('audio0')
        audioBytes += block.length
        mark('audio')
      } else if (event === 'tags') {
        mark('tags')
      } else if (event === 'done') {
        mark('done')
      } else if (event === 'error') {
        mark('error')
      }
    }
  }
  return { marks, bytes, audioBytes, clauses, audioFrames }
}

const main = async () => {
  const cookie = await login()
  const rows = []
  for (let round = 0; round < ROUNDS; round += 1) {
    const row = await speak(cookie)
    rows.push(row)
    const at = (name) => row.marks[name] === undefined ? '—' : `${row.marks[name]}ms`
    console.log(
      `#${round + 1} 首字节 ${at('bytes')}｜tags ${at('tags')}｜clause0 ${at('clause0')}｜` +
      `**首声 ${at('audio0')}**｜done ${at('done')}｜段 ${row.clauses}｜下行 ${(row.bytes / 1024).toFixed(0)}KiB（音频 ${(row.audioBytes / 1024).toFixed(0)}KiB）`,
    )
    await sleep(GAP_MS)
  }
  const pick = (name) => rows.map((row) => row.marks[name]).filter((value) => typeof value === 'number')
  const avg = (list) => list.length === 0 ? '—' : `${Math.round(list.reduce((sum, item) => sum + item, 0) / list.length)}ms`
  const audioShare = rows.reduce((sum, row) => sum + row.audioBytes, 0) / Math.max(1, rows.reduce((sum, row) => sum + row.bytes, 0))
  console.log('\n=== 汇总（${ROUNDS} 轮 *. 平均值）===')
  console.log(`首字节 ${avg(pick('bytes'))}｜clause0 ${avg(pick('clause0'))}｜**首声 ${avg(pick('audio0'))}**｜done ${avg(pick('done'))}`)
  console.log(`下行平均 ${Math.round(rows.reduce((sum, row) => sum + row.bytes, 0) / rows.length / 1024)}KiB，其中音频 ${(audioShare * 100).toFixed(0)}%`)
}

await main()
