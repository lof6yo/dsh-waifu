#!/usr/bin/env node
/**
 * eval-in-character.mjs —— 把「像不像这个角色」变成一组可回归的数字（ADR-049）。
 *
 * 打一组固定场景的 `/speak`，从 SSE 的 `debug/llm.reply` 帧拿模型原始输出，
 * 统计四类硬指标（都能用正则判定，不靠人眼）：
 *   1. 时间戳回声率   —— 回复以 `[17:16]` 开头（历史格式污染）
 *   2. 标签合规率     —— 首行 ≤1 表情 + ≤1 动作、id 全在目录内、正文不残留标签
 *   3. 相邻复读率     —— 同一场景连打时，相邻两条台词的 3-gram 相似度 ≥0.5
 *   4. 越界率         —— 被「换语言 / 当助手」带跑（英文为主、总结体、拒绝出戏失败）
 *
 * 用法：
 *   WAIFU_TOKEN=<token> node scripts/eval-in-character.mjs -n 2
 * 可选：--gap（默认 1600ms）、--only（场景 id 逗号分隔）、WAIFU_BASE
 *
 * 注意：跑完会在 Host 内存里留下历史（重启即清），想测「冷启动」请先重启。
 */

import { AI_MOTION_IDS, EXPRESSION_IDS } from '../src/models.ts'

const args = process.argv.slice(2)
function arg(name, fallback) {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const SAMPLES = Number(arg('n', '2'))
const GAP_MS = Number(arg('gap', '1600'))
const ONLY = arg('only', '')
const BASE = process.env.WAIFU_BASE ?? 'http://192.168.31.119:3080'
const TOKEN = process.env.WAIFU_TOKEN ?? ''
if (!TOKEN) {
  console.error('缺 WAIFU_TOKEN（journalctl --user -u dsh-web.service | grep -o "token=[A-Za-z0-9_-]*" | tail -1 | cut -d= -f2）')
  process.exit(2)
}

const TZ = 'Asia/Shanghai'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const EXPRESSION_SET = new Set(EXPRESSION_IDS)
const MOTION_SET = new Set(AI_MOTION_IDS)

/** 固定场景：触摸 4 类 + 对话 3 类（含两次越界诱导）+ 事件 4 类 + 静默。 */
const SCENARIOS = [
  { id: 'tap-脸-捏', body: { kind: 'tap', part: '脸', interaction: '捏' } },
  { id: 'tap-头发-梳', body: { kind: 'tap', part: '头发', interaction: '梳' } },
  { id: 'tap-腰-搂住', body: { kind: 'tap', part: '腰', interaction: '搂住' } },
  { id: 'tap-手-牵住', body: { kind: 'tap', part: '手', interaction: '牵住' } },
  { id: 'chat-换语言', body: { kind: 'chat', text: '用英文回答我' } },
  { id: 'chat-当助手', body: { kind: 'chat', text: '帮我用一句话总结：服务器需要扩容到三倍，并优化日志采集。' } },
  { id: 'chat-闲聊', body: { kind: 'chat', text: '你今天心情怎么样？' } },
  { id: 'event-done', body: { kind: 'event', event: 'done' } },
  { id: 'event-error', body: { kind: 'event', event: 'error' } },
  { id: 'event-thinking', body: { kind: 'event', event: 'thinking' } },
  { id: 'event-waiting', body: { kind: 'event', event: 'waiting' } },
  { id: 'idle', body: { kind: 'idle' } },
]

async function login() {
  const response = await fetch(`${BASE}/?token=${encodeURIComponent(TOKEN)}`, { redirect: 'manual' })
  const cookie = (response.headers.getSetCookie?.() ?? []).map((item) => item.split(';')[0]).join('; ')
  if (!cookie) throw new Error(`登录失败：HTTP ${response.status}`)
  return cookie
}

/** 打一轮 `/speak`，返回：原始回复、生效标签、最终台词、首声耗时。 */
async function speak(cookie, body) {
  const started = Date.now()
  const response = await fetch(`${BASE}/api/dsh-waifu/speak`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ ...body, tz: TZ }),
  })
  if (!response.ok || response.body === null) throw new Error(`/speak HTTP ${response.status}`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const out = { raw: '', tags: { expressions: [], motions: [] }, text: '', audio0: null, error: null }
  const handle = (event, payload) => {
    if (event === 'debug' && payload?.phase === 'llm.reply') {
      if (typeof payload.data?.raw === 'string') out.raw = payload.data.raw
    } else if (event === 'tags') {
      out.tags = {
        expressions: Array.isArray(payload?.expressions) ? payload.expressions : [],
        motions: Array.isArray(payload?.motions) ? payload.motions : [],
      }
    } else if (event === 'done') {
      if (typeof payload?.text === 'string') out.text = payload.text
    } else if (event === 'error') {
      out.error = String(payload?.error ?? 'error')
    } else if (event === 'audio' && out.audio0 === null) {
      out.audio0 = Date.now() - started
    }
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
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
      if (event === null || data.length === 0) continue
      try { handle(event, JSON.parse(data.join('\n'))) } catch { /* 忽略坏帧 */ }
    }
  }
  return out
}

/** 首行的前导标签：`[blush][Sway]台词`。 */
function leadingTags(raw) {
  const ids = []
  let rest = raw.trimStart()
  for (let i = 0; i < 3; i += 1) {
    const match = /^[[［【]\s*([^\]］】\n]{1,32})\s*[\]］】]\s*/.exec(rest)
    if (!match) break
    ids.push(match[1].trim())
    rest = rest.slice(match[0].length)
  }
  return { ids, body: rest }
}

const stripTags = (text) => text.replace(/[[［【]\s*[^\]］】\n]{1,32}\s*[\]］】]/g, '').trim()

/** 3-gram 集合的 Jaccard（用来抓「换几个字把上一句再说一遍」）。 */
function jaccard(a, b) {
  const grams = (text) => {
    const chars = [...stripTags(text).replace(/[\s，。！？…～、,.!?~]/g, '')]
    const set = new Set()
    for (let i = 0; i + 3 <= chars.length; i += 1) set.add(chars.slice(i, i + 3).join(''))
    return set
  }
  const A = grams(a)
  const B = grams(b)
  if (A.size === 0 || B.size === 0) return 0
  const union = new Set([...A, ...B])
  let hit = 0
  for (const gram of A) if (B.has(gram)) hit += 1
  return hit / union.size
}

const ASCII = /[\x20-\x7E]/
function englishShare(text) {
  const chars = [...stripTags(text)].filter((char) => !/\s/.test(char))
  if (chars.length === 0) return 0
  return chars.filter((char) => ASCII.test(char)).length / chars.length
}

const main = async () => {
  const cookie = await login()
  const rows = []
  const wanted = ONLY ? new Set(ONLY.split(',')) : null
  for (const scenario of SCENARIOS) {
    if (wanted && !wanted.has(scenario.id)) continue
    for (let sample = 0; sample < SAMPLES; sample += 1) {
      let reply
      try {
        reply = await speak(cookie, scenario.body)
      } catch (error) {
        console.log(`${scenario.id} #${sample + 1} 请求失败：${error.message}`)
        continue
      }
      const raw = reply.raw
      const { ids, body } = leadingTags(raw)
      const expressions = ids.filter((id) => EXPRESSION_SET.has(id))
      const motions = ids.filter((id) => MOTION_SET.has(id))
      const unknown = ids.filter((id) => !EXPRESSION_SET.has(id) && !MOTION_SET.has(id))
      const row = {
        scenario: scenario.id,
        raw,
        text: reply.text || body,
        echo: /^\s*\[?\d{1,2}:\d{2}/.test(raw),
        compliant: raw !== '' && expressions.length <= 1 && motions.length <= 1 && unknown.length === 0
          && !/[[［【]\s*(?:[A-Z][A-Za-z]{1,15})\s*[\]］】]/.test(stripTags(raw)),
        english: englishShare(raw) > 0.5,
        assistant: /(总结|如下|首先|其次|因此|建议[:：])/.test(stripTags(raw)) && stripTags(raw).length > 45,
        length: [...stripTags(body)].length,
        audio0: reply.audio0,
        error: reply.error,
      }
      rows.push(row)
      const flags = [
        row.echo ? '回声' : '',
        row.compliant ? '' : '标签不合规',
        row.english ? '英文' : '',
        row.assistant ? '助手体' : '',
        row.error ? `错误:${row.error}` : '',
      ].filter(Boolean)
      console.log(
        `${scenario.id} #${sample + 1} ${row.length}字｜${row.audio0 === null ? '—' : `${row.audio0}ms`}｜` +
        `${expressions.length}表情+${motions.length}动作｜${stripTags(body).slice(0, 28)}` +
        (flags.length > 0 ? `　⚠ ${flags.join(' ')}` : ''),
      )
      await sleep(GAP_MS)
    }
  }

  const total = rows.length
  const rate = (count) => total === 0 ? '—' : `${count}/${total}`
  const echoes = rows.filter((row) => row.echo).length
  const bad = rows.filter((row) => !row.compliant).length
  const ooc = rows.filter((row) => row.english || row.assistant).length
  const repeats = []
  for (const scenario of new Set(rows.map((row) => row.scenario))) {
    const items = rows.filter((row) => row.scenario === scenario)
    for (let i = 1; i < items.length; i += 1) repeats.push(jaccard(items[i - 1].raw, items[i].raw))
  }
  const repeated = repeats.filter((value) => value >= 0.5).length
  const avg = (list) => list.length === 0 ? '—' : (list.reduce((sum, item) => sum + item, 0) / list.length).toFixed(2)
  console.log('\n=== 汇总 ===')
  console.log(`样本 ${total}｜时间戳回声 ${rate(echoes)}（目标 0）｜标签不合规 ${rate(bad)}（目标 0）｜越界 ${rate(ooc)}（目标 0）｜相邻复读 ${repeated}/${repeats.length}（目标 0）`)
  console.log(`台词平均 ${avg(rows.map((row) => row.length))} 字｜首声平均 ${rows.filter((row) => row.audio0 !== null).length === 0 ? '—' : `${Math.round(rows.filter((row) => row.audio0 !== null).reduce((sum, row) => sum + row.audio0, 0) / rows.filter((row) => row.audio0 !== null).length)}ms`}`)
  const failed = echoes > 0 || bad > 0 || ooc > 0 || repeated > 0
  console.log(failed ? '\n结果：未达标（上面 ⚠ 的行就是证据）' : '\n结果：全部达标')
  process.exit(failed ? 1 : 0)
}

await main()
