#!/usr/bin/env node
/**
 * spike-inline-cues.mjs —— 实测「模型会不会把标签写在台词中间」（ADR-048 P4 的 go/no-go 数据）。
 *
 * 只看事实，不改代码：
 *   · 每轮几个 `tags` 帧（应该恒为 1）
 *   · 每段 cue 落在第几段（>0 才说明它真的会「中途换动作」）
 *   · 正文有没有漏出方括号/标签名（泄漏）
 *   · 台词长度、耗时
 *
 * 用法：
 *   WAIFU_TOKEN=<从 journalctl 抓的 token> node scripts/spike-inline-cues.mjs -n 12
 * 可选：WAIFU_BASE（默认 http://192.168.31.119:3080）、--gap（默认 1600ms）、--part/--interaction
 */

const args = process.argv.slice(2)
function arg(name, fallback) {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const ROUNDS = Number(arg('n', '12'))
const GAP_MS = Number(arg('gap', '1600'))
const BASE = process.env.WAIFU_BASE ?? 'http://192.168.31.119:3080'
const TOKEN = process.env.WAIFU_TOKEN ?? ''
if (!TOKEN) {
  console.error('缺 WAIFU_TOKEN（journalctl --user -u dsh-web.service | grep -o "token=[A-Za-z0-9_-]*" | tail -1 | cut -d= -f2）')
  process.exit(2)
}

const PAIRS = [
  { part: '脸', interaction: '捏' },
  { part: '腰', interaction: '搂住' },
  { part: '胸', interaction: '揉捏' },
  { part: '头发', interaction: '梳' },
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function login() {
  const response = await fetch(`${BASE}/?token=${encodeURIComponent(TOKEN)}`, { redirect: 'manual' })
  const cookie = (response.headers.getSetCookie?.() ?? []).map((item) => item.split(';')[0]).join('; ')
  if (!cookie) throw new Error(`登录失败：HTTP ${response.status}`)
  return cookie
}

/** 打一轮 /speak，返回结构化结果（SSE 手工分帧，只抽需要的三种事件）。 */
async function speak(cookie, input) {
  const started = Date.now()
  const response = await fetch(`${BASE}/api/dsh-waifu/speak`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ ...input, tz: 'Asia/Shanghai' }),
  })
  if (!response.ok || response.body === null) throw new Error(`/speak HTTP ${response.status}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const clauses = []
  let tagsFrames = 0
  let done = ''
  let error = null
  for (;;) {
    const { value, done: ended } = await reader.read()
    if (ended) break
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
      let payload = null
      try { payload = JSON.parse(data.join('\n')) } catch { payload = null }
      if (event === 'clause' && payload) clauses.push(payload)
      else if (event === 'tags') tagsFrames += 1
      else if (event === 'done' && payload) done = String(payload.text ?? '')
      else if (event === 'error' && payload) error = String(payload.error ?? 'error')
    }
  }
  return { clauses, tagsFrames, done, error, ms: Date.now() - started }
}

/** 正文里不该出现的控制信号（漏出即泄漏）。 */
function leaked(text) {
  return /[[\]［］【】]/.test(text) || /敏感度|绷不住|一碰就炸|过载/.test(text)
}

const main = async () => {
  const cookie = await login()
  const rows = []
  for (let round = 0; round < ROUNDS; round += 1) {
    const pair = PAIRS[round % PAIRS.length]
    let result
    try {
      result = await speak(cookie, { kind: 'tap', ...pair })
    } catch (error) {
      console.log(`#${round + 1} 请求失败：${error.message}`)
      await sleep(GAP_MS)
      continue
    }
    if (result.error === 'cooldown') {
      await sleep(1500)
      try { result = await speak(cookie, { kind: 'tap', ...pair }) } catch { /* 记空轮 */ }
    }
    const cuesByClause = result.clauses.map((clause) => Array.isArray(clause.cues) ? clause.cues : [])
    const cueTotal = cuesByClause.reduce((sum, cues) => sum + cues.length, 0)
    const lateCueClauses = cuesByClause.findIndex((cues, index) => index > 0 && cues.length > 0)
    const row = {
      round: round + 1,
      part: pair.part,
      interaction: pair.interaction,
      clauses: result.clauses.length,
      tagsFrames: result.tagsFrames,
      cueTotal,
      lateAt: lateCueClauses,
      text: result.clauses.map((clause) => clause.text).join(''),
      leak: result.clauses.some((clause) => leaked(String(clause.text ?? ''))),
      ms: result.ms,
      error: result.error ?? null,
    }
    rows.push(row)
    const cueText = cuesByClause
      .map((cues, index) => cues.length === 0 ? null : `#${index}:${cues.map((cue) => `${cue.kind === 'motion' ? 'M' : 'E'}:${cue.id}`).join('+')}`)
      .filter(Boolean)
      .join(' ')
    console.log(`#${String(row.round).padStart(2)} ${pair.part}/${pair.interaction} 段${row.clauses} tags${row.tagsFrames} cue${row.cueTotal} ${cueText || '（无）'} ${row.ms}ms ${row.leak ? '泄漏!' : ''}`)
    await sleep(GAP_MS)
  }

  const done = rows.filter((row) => row.text.length > 0)
  const withCue = done.filter((row) => row.cueTotal > 0)
  const inline = done.filter((row) => row.lateAt > 0)
  const avg = (list, pick) => list.length === 0 ? 0 : Math.round(list.reduce((sum, item) => sum + pick(item), 0) / list.length)
  console.log('\n=== 汇总 ===')
  console.log(`有台词：${done.length}/${rows.length}　带 cue：${withCue.length}/${done.length}　**句中 cue（第 0 段之后）：${inline.length}/${done.length}**`)
  console.log(`平均 cue 数：${(done.length === 0 ? 0 : (done.reduce((sum, row) => sum + row.cueTotal, 0) / done.length).toFixed(2))}　平均段数：${avg(done, (row) => row.clauses)}　平均字数：${avg(done, (row) => row.text.length)}　平均耗时：${avg(done, (row) => row.ms)}ms`)
  console.log(`tags 帧恒为 1：${rows.every((row) => row.tagsFrames === 1) ? '是' : '否'}　泄漏：${rows.filter((row) => row.leak).length} 次　错误：${rows.filter((row) => row.error !== null).length} 次`)
  const verdict = inline.length / Math.max(1, done.length) >= 0.5 && rows.filter((row) => row.leak).length === 0
  console.log(`go/no-go：${verdict ? 'GO（模型能稳定写句中 cue，可以固化进提示词）' : 'NO-GO（句中 cue 太少或有泄漏，先别改提示词）'}`)
}

await main()
