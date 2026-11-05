#!/usr/bin/env node
/**
 * 重建「简」内置 Live2D 模型的自建动作（当前只有 Idle，幂等），并校验 JSON / 参数 / Meta 计数 / 引用。
 *
 * 用法（本机无全局 node，用 App 自带运行时）：
 *   export DSH_DESKTOP_NODE_EXECUTABLE="/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness"
 *   NODE="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/bin/node"
 *   "$NODE" scripts/gen-jian-motions.mjs
 *
 * 产物目录：assets/models/jian/motions/*.motion3.json
 *   Idle / Thinking / Error / Done / Waiting / TapHead / TapFace / TapBody
 *
 * 曲线约定（motion3.json, Version 3）：
 *   Segments = [t0, v0, 1, t1, v1, c1x, c1y, c2x, c2y, ...]
 *   所有段都用 3 次贝塞尔（type=1），控制点时间落在 [t0, t1] 内、值限制在
 *   [min(v0,v1), max(v0,v1)]（AreBeziersRestricted=true 的保守写法），段与段在
 *   关键帧处一阶连续（Catmull-Rom 切线；非循环动作首尾切线为 0，便于缓入缓出）。
 *
 * Meta 计数（与 Cubism 一致，已用官方/VTS motion3 样本反推确认）：
 *   CurveCount        = 曲线条数
 *   TotalSegmentCount = 所有曲线的段数之和
 *   TotalPointCount   = CurveCount + TotalSegmentCount + 2 × 贝塞尔段数
 *   UserDataCount / TotalUserDataSize = 0
 *
 * 只使用 cdi3 中存在的安全参数；不碰 ParamSwitch*、物理内部参数与物理输出驱动链。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const MODEL_DIR = resolve(REPO_ROOT, 'assets/models/jian')
const MOTION_DIR = resolve(MODEL_DIR, 'motions')
const MODEL3_FILE = resolve(MODEL_DIR, '简.model3.json')
const CDI3_FILE = resolve(MODEL_DIR, '简.cdi3.json')

const FPS = 30
/**
 * 动作组清单（顺序即 model3.json 的声明顺序，第 0 组为默认待机）。
 * Idle / Thinking / Waiting / Smug 为循环动作；其余为一次性动作（播完回 Idle）。
 */
const EXPECTED_GROUPS = [
  'Idle',
  'Thinking',
  'Error',
  'Done',
  'Waiting',
  'TapHead',
  'TapFace',
  'TapHand',
  'TapChest',
  'TapWaist',
  'TapHip',
  'TapLeg',
  'Charm',
  'Smug',
  'Shy',
  'Taunt',
  'Stretch',
]

/**
 * 允许在动作里驱动的参数白名单 + 量纲守护范围。
 * 量纲来自 cdi3 中文名与 Live2D 常规约定（角度 / 0~1 开关 / -1~1 表情）。
 * 物理驱动的输出参数（ParamEyeLSmile 由 ParamMouthForm 驱动、ParamBodyAngle*0）
 * 也按任务要求保留，但幅度保守，且让 ParamMouthForm 作为可见微笑的主驱动。
 */
const SAFE_PARAMS = {
  // 头部角度：模型/物理归一化范围 ±10（超出会被 Cubism 夹到 10），动作取满
  ParamAngleX: [-10, 10],
  ParamAngleY: [-10, 10],
  ParamAngleZ: [-10, 10],
  // 头部平移：同样是 ±10 口径，喂给躯干/胯物理（Weight 30）
  ParamAnglePX: [-10, 10],
  ParamAnglePY: [-10, 10],
  // 躯干/胯：模型范围 ±57.3，但物理会按 Output Weight 覆盖掉一部分
  //（X0 30 / Y0 50 / Z0 80），所以动作要写大一些才可见
  ParamBodyAngleX0: [-30, 30],
  ParamBodyAngleY0: [-30, 30],
  ParamBodyAngleZ0: [-30, 30],
  ParamBreath: [0, 1],
  ParamEyeLOpen: [0, 1],
  ParamEyeROpen: [0, 1],
  ParamEyeLSmile: [0, 1],
  ParamEyeRSmile: [0, 1],
  ParamEyeBallX: [-1, 1],
  ParamEyeBallY: [-1, 1],
  ParamBrowLY: [-1, 1],
  ParamBrowRY: [-1, 1],
  ParamMouthOpenY: [0, 1],
  ParamMouthForm: [-1, 1],
  ParamCheekPuff: [0, 1],
}

// ---------------------------------------------------------------------------
// 关键帧 / 曲线构造
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2

function round(n, digits = 4) {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

/** 手写关键帧：[[t, v], ...]（t 递增，首 t=0，末 t=duration）。 */
function kf(pairs) {
  return pairs.map(([t, v]) => ({ t: round(t), v: round(v) }))
}

/**
 * 周期采样关键帧：fn(tau) 在 tau∈[0,1] 上取值；首尾值强制一致，保证循环无缝。
 * 用于 Idle / Thinking / Waiting / Smug 这类纯循环动作。
 */
function periodic(duration, steps, fn) {
  const keys = []
  for (let i = 0; i <= steps; i++) {
    const tau = i / steps
    keys.push({ t: round(tau * duration), v: round(fn(tau)) })
  }
  keys[keys.length - 1].v = keys[0].v
  return keys
}

/**
 * 关键帧 → 贝塞尔 Segments。
 * loop=true 时用循环 Catmull-Rom 切线；非循环时首尾切线取 0（缓入缓出）。
 */
function buildCurve(id, keys, { loop, duration }) {
  if (!Array.isArray(keys) || keys.length < 2) {
    throw new Error(`[${id}] 至少需要 2 个关键帧`)
  }
  if (keys[0].t !== 0) {
    throw new Error(`[${id}] 首个关键帧时间必须为 0，实际 ${keys[0].t}`)
  }
  const lastT = keys[keys.length - 1].t
  if (Math.abs(lastT - duration) > 1e-9) {
    throw new Error(`[${id}] 末个关键帧时间 ${lastT} 与动作时长 ${duration} 不一致`)
  }
  for (let i = 1; i < keys.length; i++) {
    if (!(keys[i].t > keys[i - 1].t)) {
      throw new Error(`[${id}] 关键帧时间必须严格递增：${keys[i - 1].t} -> ${keys[i].t}`)
    }
  }
  if (loop && keys[0].v !== keys[keys.length - 1].v) {
    throw new Error(`[${id}] 循环动作首尾值不一致：${keys[0].v} != ${keys[keys.length - 1].v}`)
  }

  const n = keys.length
  const slopes = new Array(n).fill(0)

  if (loop) {
    // 循环：把「末帧(=首帧)」与「倒数第二帧」当作首帧前后邻居
    const prevT = keys[n - 2].t - duration
    slopes[0] = (keys[1].v - keys[n - 2].v) / (keys[1].t - prevT)
    slopes[n - 1] = slopes[0]
    for (let i = 1; i < n - 1; i++) {
      slopes[i] = (keys[i + 1].v - keys[i - 1].v) / (keys[i + 1].t - keys[i - 1].t)
    }
  } else {
    slopes[0] = 0
    slopes[n - 1] = 0
    for (let i = 1; i < n - 1; i++) {
      slopes[i] = (keys[i + 1].v - keys[i - 1].v) / (keys[i + 1].t - keys[i - 1].t)
    }
  }

  const segments = [round(keys[0].t), round(keys[0].v)]
  let bezierCount = 0

  for (let i = 0; i < n - 1; i++) {
    const p0 = keys[i]
    const p1 = keys[i + 1]
    const dt = p1.t - p0.t
    const lo = Math.min(p0.v, p1.v)
    const hi = Math.max(p0.v, p1.v)
    // Hermite -> Bezier，再按 AreBeziersRestricted 的保守语义夹紧控制点
    const c1y = Math.min(hi, Math.max(lo, p0.v + (slopes[i] * dt) / 3))
    const c2y = Math.min(hi, Math.max(lo, p1.v - (slopes[i + 1] * dt) / 3))
    segments.push(
      1, // CubicBezier
      round(p1.t),
      round(p1.v),
      round(p0.t + dt / 3),
      round(c1y),
      round(p1.t - dt / 3),
      round(c2y),
    )
    bezierCount++
  }

  return {
    id,
    segments,
    segmentCount: n - 1,
    bezierCount,
    keyMin: Math.min(...keys.map((k) => k.v)),
    keyMax: Math.max(...keys.map((k) => k.v)),
  }
}

/** 组装 motion3.json 对象，Meta 全部由实际曲线数据推导。 */
function buildMotion(def) {
  const curves = def.build()
  const ids = new Set()
  let totalSegments = 0
  let totalBeziers = 0

  const curveJson = curves.map((curve) => {
    if (!(curve.id in SAFE_PARAMS)) {
      throw new Error(`[${def.group}] 参数 ${curve.id} 不在安全参数白名单中`)
    }
    if (ids.has(curve.id)) {
      throw new Error(`[${def.group}] 参数 ${curve.id} 出现重复曲线`)
    }
    ids.add(curve.id)
    totalSegments += curve.segmentCount
    totalBeziers += curve.bezierCount
    return { Target: 'Parameter', Id: curve.id, Segments: curve.segments }
  })

  const meta = {
    Duration: def.duration,
    Fps: FPS,
    Loop: def.loop,
    AreBeziersRestricted: true,
    CurveCount: curveJson.length,
    TotalSegmentCount: totalSegments,
    TotalPointCount: curveJson.length + totalSegments + 2 * totalBeziers,
    UserDataCount: 0,
    TotalUserDataSize: 0,
  }

  return {
    json: { Version: 3, Meta: meta, Curves: curveJson },
    curves,
  }
}

// ---------------------------------------------------------------------------
// 自建动作设计
// ---------------------------------------------------------------------------

/**
 * 动作清单。build() 返回 [{id, ...}]（见 buildCurve 返回结构）。
 * 幅度保守：角度用度（±12 以内），开关/表情用 0~1 或 -1~1。
 *
 * 角色设定：绝区零「简·杜」——鼠耳/尾巴的魅魔系美人，慵懒、爱撩、爱挑衅，
 * 被冒犯时会炸毛。动作分三类：
 *   1. 状态：Idle / Thinking / Error / Done / Waiting（供事件绑定使用）
 *   2. 触摸反馈：TapHead / TapFace / TapHand / TapBody / TapLeg（供触摸部位使用）
 *   3. 人设小动作：Charm 撩人 / Smug 得意 / Shy 害羞 / Taunt 挑衅 / Stretch 伸懒腰
 */
const MOTION_DEFS = [
  {
    group: 'Idle',
    file: 'idle.motion3.json',
    duration: 5,
    loop: true,
    build: () => [
      // 呼吸：一次完整起伏 0 -> 0.8 -> 0（自然动作还会叠加少量呼吸，故峰值保守）
      buildCurve('ParamBreath', periodic(5, 20, (tau) => 0.4 * (1 - Math.cos(TAU * tau))), {
        loop: true,
        duration: 5,
      }),
      // 头部轻微左右摆动 + 上下浮 + 侧倾（与呼吸相位错开）
      buildCurve('ParamAngleX', periodic(5, 20, (tau) => 1.8 * Math.cos(TAU * tau)), {
        loop: true,
        duration: 5,
      }),
      buildCurve('ParamAngleY', periodic(5, 20, (tau) => 1.2 * Math.sin(2 * TAU * tau)), {
        loop: true,
        duration: 5,
      }),
      buildCurve('ParamAngleZ', periodic(5, 20, (tau) => 2.4 * Math.sin(TAU * tau)), {
        loop: true,
        duration: 5,
      }),
      // 身体轻微起伏/摇摆（躯干参数是物理输出，物理权重 30/50/80，动作值部分生效）
      buildCurve('ParamBodyAngleX0', periodic(5, 20, (tau) => 1.5 * Math.sin(TAU * tau + Math.PI)), {
        loop: true,
        duration: 5,
      }),
      buildCurve('ParamBodyAngleY0', periodic(5, 20, (tau) => 0.3 * (1 - Math.cos(TAU * tau))), {
        loop: true,
        duration: 5,
      }),
      buildCurve('ParamBodyAngleZ0', periodic(5, 20, (tau) => 2.0 * Math.cos(TAU * tau)), {
        loop: true,
        duration: 5,
      }),
      // 待机眨眼：live2d-display 在「有动作播放」时不跑 EyeBlink，这里手写两次眨眼，
      // 保证 Idle 循环里也有自然眨眼（0.1s 闭 / 0.12s 开）。
      buildCurve('ParamEyeLOpen', kf([
        [0, 1],
        [1.3, 1],
        [1.4, 0.05],
        [1.52, 0.03],
        [1.64, 1],
        [3.4, 1],
        [3.5, 0.05],
        [3.62, 0.03],
        [3.74, 1],
        [5, 1],
      ]), { loop: true, duration: 5 }),
      buildCurve('ParamEyeROpen', kf([
        [0, 1],
        [1.3, 1],
        [1.4, 0.05],
        [1.52, 0.03],
        [1.64, 1],
        [3.4, 1],
        [3.5, 0.05],
        [3.62, 0.03],
        [3.74, 1],
        [5, 1],
      ]), { loop: true, duration: 5 }),
    ],
  },
  {
    // 思考：眼珠往上飘、一边挑眉（「在想坏主意」），头慢慢歪。
    group: 'Thinking',
    file: 'thinking.motion3.json',
    duration: 3.2,
    loop: true,
    build: () => {
      const d = 3.2
      const p = (id, steps, fn) => buildCurve(id, periodic(d, steps, fn), { loop: true, duration: d })
      return [
        p('ParamAngleX', 16, (t) => 2.5 * Math.sin(TAU * t)),
        p('ParamAngleZ', 16, (t) => 3.2 * Math.sin(TAU * t + Math.PI / 3)),
        p('ParamAngleY', 16, (t) => 1.5 - 1.5 * Math.cos(TAU * t)),
        p('ParamEyeBallY', 16, (t) => 0.35 + 0.12 * Math.sin(TAU * t)),
        p('ParamEyeBallX', 16, (t) => 0.18 * Math.sin(TAU * t + Math.PI / 2)),
        p('ParamBrowLY', 16, () => 0.22),
        p('ParamBrowRY', 16, () => -0.12),
        p('ParamMouthForm', 16, (t) => -0.12 + 0.06 * Math.sin(TAU * t)),
        p('ParamBreath', 16, (t) => 0.25 * (1 - Math.cos(TAU * t))),
        p('ParamEyeLOpen', 16, () => 0.92),
        p('ParamEyeROpen', 16, () => 0.92),
      ]
    },
  },
  {
    // 出错/惹到了：瞪眼、倒竖眉、张嘴、头往后一仰、身体一颤，然后缓缓收回。
    group: 'Error',
    file: 'error.motion3.json',
    duration: 2.0,
    loop: false,
    build: () => {
      const d = 2.0
      const c = (id, pairs) => buildCurve(id, kf(pairs), { loop: false, duration: d })
      return [
        c('ParamEyeLOpen', [[0, 1], [0.18, 1], [0.32, 0.78], [1.5, 0.82], [2.0, 1]]),
        c('ParamEyeROpen', [[0, 1], [0.18, 1], [0.32, 0.78], [1.5, 0.82], [2.0, 1]]),
        c('ParamBrowLY', [[0, 0], [0.25, -0.6], [1.4, -0.55], [2.0, 0]]),
        c('ParamBrowRY', [[0, 0], [0.25, -0.6], [1.4, -0.55], [2.0, 0]]),
        c('ParamMouthOpenY', [[0, 0], [0.28, 0.5], [0.9, 0.42], [1.6, 0.1], [2.0, 0]]),
        c('ParamMouthForm', [[0, 0], [0.28, -0.55], [1.4, -0.4], [2.0, 0]]),
        c('ParamAngleY', [[0, 0], [0.3, 6], [0.9, 4.5], [2.0, 0]]),
        c('ParamAngleZ', [[0, 0], [0.35, 3], [1.0, -2], [2.0, 0]]),
        c('ParamBodyAngleY0', [[0, 0], [0.3, -2.5], [1.0, -1.5], [2.0, 0]]),
      ]
    },
  },
  {
    // 完成/交付：开心地点头两下，眼睛笑弯、嘴角上扬、张嘴。
    group: 'Done',
    file: 'done.motion3.json',
    duration: 2.0,
    loop: false,
    build: () => {
      const d = 2.0
      const c = (id, pairs) => buildCurve(id, kf(pairs), { loop: false, duration: d })
      return [
        c('ParamEyeLSmile', [[0, 0], [0.3, 0.85], [1.5, 0.8], [2.0, 0]]),
        c('ParamEyeRSmile', [[0, 0], [0.3, 0.85], [1.5, 0.8], [2.0, 0]]),
        c('ParamEyeLOpen', [[0, 1], [0.3, 0.55], [1.5, 0.6], [2.0, 1]]),
        c('ParamEyeROpen', [[0, 1], [0.3, 0.55], [1.5, 0.6], [2.0, 1]]),
        c('ParamMouthOpenY', [[0, 0], [0.35, 0.42], [1.5, 0.3], [2.0, 0]]),
        c('ParamMouthForm', [[0, 0], [0.3, 0.6], [1.6, 0.55], [2.0, 0]]),
        c('ParamAngleY', [[0, 0], [0.3, -4], [0.6, 2.5], [0.95, -3], [1.3, 0], [2.0, 0]]),
        c('ParamBodyAngleY0', [[0, 0], [0.35, 3], [0.9, 0], [1.3, 1.5], [2.0, 0]]),
      ]
    },
  },
  {
    // 等审批：左看右看、眼珠来回扫、眉微皱（有点不耐烦）。
    group: 'Waiting',
    file: 'waiting.motion3.json',
    duration: 3.0,
    loop: true,
    build: () => {
      const d = 3.0
      const p = (id, steps, fn) => buildCurve(id, periodic(d, steps, fn), { loop: true, duration: d })
      return [
        p('ParamAngleX', 16, (t) => 5 * Math.sin(TAU * t)),
        p('ParamEyeBallX', 16, (t) => 0.5 * Math.sin(TAU * t)),
        p('ParamAngleZ', 16, (t) => 2 * Math.sin(2 * TAU * t)),
        p('ParamAngleY', 16, (t) => 1 - Math.cos(2 * TAU * t) * 0.5),
        p('ParamBrowLY', 16, () => -0.12),
        p('ParamBrowRY', 16, () => -0.12),
        p('ParamMouthForm', 16, () => -0.08),
        p('ParamBodyAngleZ0', 16, (t) => 1.2 * Math.sin(TAU * t + Math.PI)),
        p('ParamEyeLOpen', 16, () => 0.95),
        p('ParamEyeROpen', 16, () => 0.95),
      ]
    },
  },
  {
    // 摸头：被摸得很舒服——整个人往手心歪，眼睛笑到闭上，腮帮子鼓起来。
    group: 'TapHead',
    file: 'tap-head.motion3.json',
    duration: 2.3,
    loop: false,
    build: () => {
      const d = 2.3
      const c = (id, pairs) => buildCurve(id, kf(pairs), { loop: false, duration: d })
      return [
        c('ParamEyeLSmile', [[0, 0], [0.4, 1], [1.5, 0.95], [2.3, 0]]),
        c('ParamEyeRSmile', [[0, 0], [0.4, 1], [1.5, 0.95], [2.3, 0]]),
        c('ParamEyeLOpen', [[0, 1], [0.4, 0.25], [1.5, 0.3], [2.3, 1]]),
        c('ParamEyeROpen', [[0, 1], [0.4, 0.25], [1.5, 0.3], [2.3, 1]]),
        c('ParamAngleZ', [[0, 0], [0.5, 10], [1.4, 10], [2.3, 0]]),
        c('ParamAngleX', [[0, 0], [0.5, 7], [1.4, 6], [2.3, 0]]),
        c('ParamAngleY', [[0, 0], [0.5, 6], [1.4, 5], [2.3, 0]]),
        c('ParamCheekPuff', [[0, 0], [0.6, 0.45], [1.6, 0.4], [2.3, 0]]),
        c('ParamMouthForm', [[0, 0], [0.5, 0.8], [1.5, 0.75], [2.3, 0]]),
        c('ParamBrowLY', [[0, 0], [0.6, 0.6], [1.6, 0.55], [2.3, 0]]),
        c('ParamBrowRY', [[0, 0], [0.6, 0.6], [1.6, 0.55], [2.3, 0]]),
        c('ParamBodyAngleZ0', [[0, 0], [0.6, 3], [1.5, 2.5], [2.3, 0]]),
      ]
    },
  },
  {
    // 捏脸：猛地躲开、皱成一团、眼珠飘到一边，嘟嘴抗议。
    group: 'TapFace',
    file: 'tap-face.motion3.json',
    duration: 2.0,
    loop: false,
    build: () => {
      const d = 2.0
      const c = (id, pairs) => buildCurve(id, kf(pairs), { loop: false, duration: d })
      return [
        c('ParamCheekPuff', [[0, 0], [0.35, 1], [1.2, 0.95], [2.0, 0]]),
        c('ParamAngleX', [[0, 0], [0.45, -10], [1.3, -8], [2.0, 0]]),
        c('ParamAngleZ', [[0, 0], [0.45, -10], [1.3, -7], [2.0, 0]]),
        c('ParamEyeLOpen', [[0, 1], [0.4, 0.35], [1.3, 0.45], [2.0, 1]]),
        c('ParamEyeROpen', [[0, 1], [0.4, 0.35], [1.3, 0.45], [2.0, 1]]),
        c('ParamEyeBallX', [[0, 0], [0.5, -0.8], [1.3, -0.6], [2.0, 0]]),
        c('ParamBrowLY', [[0, 0], [0.5, -0.7], [1.3, -0.6], [2.0, 0]]),
        c('ParamBrowRY', [[0, 0], [0.5, -0.7], [1.3, -0.6], [2.0, 0]]),
        c('ParamMouthForm', [[0, 0], [0.45, -0.8], [1.3, -0.7], [2.0, 0]]),
        c('ParamMouthOpenY', [[0, 0], [0.5, 0.25], [1.3, 0.15], [2.0, 0]]),
        c('ParamBodyAngleZ0', [[0, 0], [0.5, -3], [1.3, -2], [2.0, 0]]),
      ]
    },
  },
  {
    // 摸手：低头盯着手看，眼睛弯成月牙，脸红似的鼓腮——嘴硬但受用。
    group: 'TapHand',
    file: 'tap-hand.motion3.json',
    duration: 2.1,
    loop: false,
    build: () => {
      const d = 2.1
      const c = (id, pairs) => buildCurve(id, kf(pairs), { loop: false, duration: d })
      return [
        c('ParamAngleY', [[0, 0], [0.5, -10], [1.4, -9], [2.1, 0]]),
        c('ParamAngleX', [[0, 0], [0.6, 4], [1.4, 3], [2.1, 0]]),
        c('ParamAngleZ', [[0, 0], [0.6, -6], [1.4, -5], [2.1, 0]]),
        c('ParamEyeBallY', [[0, 0], [0.5, -0.9], [1.4, -0.8], [2.1, 0]]),
        c('ParamEyeLSmile', [[0, 0], [0.5, 1], [1.5, 0.95], [2.1, 0]]),
        c('ParamEyeRSmile', [[0, 0], [0.5, 1], [1.5, 0.95], [2.1, 0]]),
        c('ParamEyeLOpen', [[0, 1], [0.5, 0.5], [1.5, 0.55], [2.1, 1]]),
        c('ParamEyeROpen', [[0, 1], [0.5, 0.5], [1.5, 0.55], [2.1, 1]]),
        c('ParamMouthForm', [[0, 0], [0.5, 0.75], [1.5, 0.7], [2.1, 0]]),
        c('ParamCheekPuff', [[0, 0], [0.7, 0.35], [1.6, 0.3], [2.1, 0]]),
      ]
    },
  },
  {
    // 摸胸：上身被撞——左右甩 + 绕竖轴（Y）转 + 前后仰，三轴一起晃。
    // 幅度说明：头部角度模型上限 ±10（物理归一化），躯干/胯模型范围 ±57 但物理按权重覆盖
    //（BodyAngleX0 30 / Y0 50 / Z0 80 / ChestAngleY 100），所以写大值才能露出来：
    // 头部走满 ±10（它经 ParamInput_Body*/Hip* 以 70% 权重驱动整条摆锤链），躯干走 ±30。
    // 包络 sin(πτ) 保证首尾归零、连续可导；频率压到 1.2 个来回避免与物理刚度打架。
    group: 'TapChest',
    file: 'tap-chest.motion3.json',
    duration: 3.4,
    loop: false,
    build: () => {
      const d = 3.4
      const steps = 34
      const env = (tau, pow = 0.8) => Math.pow(Math.sin(Math.PI * tau), pow)
      const c = (id, fn) => buildCurve(id, periodic(d, steps, fn), { loop: false, duration: d })
      return [
        // 绕竖轴：头部俯仰（AngleY）→ 物理 ParamBodyOutput_BodyY → ParamChestAngleY（胸口转向）
        c('ParamAngleY', (t) => 10 * Math.sin(TAU * 1.2 * t) * env(t)),
        c('ParamBodyAngleY0', (t) => 30 * Math.sin(TAU * 1.2 * t - Math.PI / 6) * env(t)),
        // 左右甩：头部侧倾 + 躯干 Z（相位略滞后，像被撞后跟上）
        c('ParamAngleZ', (t) => 10 * Math.sin(TAU * 1.2 * t + Math.PI / 2) * env(t)),
        c('ParamBodyAngleZ0', (t) => 30 * Math.sin(TAU * 1.2 * t + Math.PI / 3) * env(t)),
        // 前后仰：头部转向 + 躯干 X + 头部平移（喂 BodyX/HipX）
        c('ParamAngleX', (t) => 8 * Math.sin(TAU * 1.2 * t) * env(t)),
        c('ParamBodyAngleX0', (t) => 26 * Math.sin(TAU * 1.2 * t + Math.PI / 4) * env(t)),
        c('ParamAnglePX', (t) => 7 * Math.sin(TAU * 1.2 * t + Math.PI / 2) * env(t)),
        c('ParamAnglePY', (t) => 5 * Math.sin(TAU * 1.2 * t) * env(t)),
        // 表情：被打到时的瞪眼 / 皱眉 / 张嘴
        c('ParamBrowLY', (t) => -0.8 * env(t, 0.5)),
        c('ParamBrowRY', (t) => -0.8 * env(t, 0.5)),
        c('ParamEyeLOpen', (t) => 1 - 0.5 * env(t, 0.5)),
        c('ParamEyeROpen', (t) => 1 - 0.5 * env(t, 0.5)),
        c('ParamEyeBallY', (t) => -0.35 * env(t, 0.7)),
        c('ParamMouthOpenY', (t) => 0.6 * env(t, 0.6)),
        c('ParamMouthForm', (t) => -0.85 * env(t, 0.5)),
      ]
    },
  },
  {
    // 摸腰：扭动——绕竖轴扭 + 侧倾，两个相位差 90° 的振荡合成 8 字形，频率比胸口快一档。
    group: 'TapWaist',
    file: 'tap-waist.motion3.json',
    duration: 2.6,
    loop: false,
    build: () => {
      const d = 2.6
      const steps = 30
      const env = (tau, pow = 0.7) => Math.pow(Math.sin(Math.PI * tau), pow)
      const c = (id, fn) => buildCurve(id, periodic(d, steps, fn), { loop: false, duration: d })
      return [
        c('ParamAngleY', (t) => 9 * Math.sin(TAU * 2.2 * t) * env(t)),
        c('ParamBodyAngleY0', (t) => 28 * Math.sin(TAU * 2.2 * t + Math.PI / 6) * env(t)),
        c('ParamAngleZ', (t) => 10 * Math.sin(TAU * 2.2 * t + Math.PI / 2) * env(t)),
        c('ParamBodyAngleZ0', (t) => 26 * Math.sin(TAU * 2.2 * t + Math.PI / 2) * env(t)),
        c('ParamAngleX', (t) => 7 * Math.sin(TAU * 2.2 * t + Math.PI) * env(t)),
        c('ParamBodyAngleX0', (t) => 22 * Math.sin(TAU * 2.2 * t + Math.PI) * env(t)),
        c('ParamAnglePY', (t) => 4 * Math.sin(TAU * 4.4 * t) * env(t, 0.9)),
        c('ParamEyeLSmile', (t) => 0.6 * env(t, 0.6)),
        c('ParamEyeRSmile', (t) => 0.6 * env(t, 0.6)),
        c('ParamCheekPuff', (t) => 0.55 * env(t, 0.6)),
        c('ParamMouthOpenY', (t) => 0.25 * env(t)),
        c('ParamMouthForm', (t) => -0.5 * env(t, 0.6)),
      ]
    },
  },
  {
    // 摸臀：胯部被撞——下盘 X 轴来回摆 + 上身反向转，绕竖轴的幅度比胸口小、节奏更慢。
    group: 'TapHip',
    file: 'tap-hip.motion3.json',
    duration: 3.0,
    loop: false,
    build: () => {
      const d = 3.0
      const steps = 30
      const env = (tau, pow = 0.8) => Math.pow(Math.sin(Math.PI * tau), pow)
      const c = (id, fn) => buildCurve(id, periodic(d, steps, fn), { loop: false, duration: d })
      return [
        c('ParamAngleX', (t) => 10 * Math.sin(TAU * 1.0 * t) * env(t)),
        c('ParamBodyAngleX0', (t) => 30 * Math.sin(TAU * 1.0 * t - Math.PI / 8) * env(t)),
        c('ParamAnglePX', (t) => 8 * Math.sin(TAU * 1.0 * t) * env(t)),
        c('ParamAngleZ', (t) => 8 * Math.sin(TAU * 1.0 * t + Math.PI / 2) * env(t)),
        c('ParamBodyAngleZ0', (t) => 20 * Math.sin(TAU * 1.0 * t + Math.PI / 2) * env(t)),
        c('ParamAngleY', (t) => 5 * Math.sin(TAU * 1.0 * t + Math.PI) * env(t)),
        c('ParamBodyAngleY0', (t) => 16 * Math.sin(TAU * 1.0 * t + Math.PI) * env(t)),
        c('ParamEyeBallX', (t) => -0.6 * env(t, 0.6)),
        c('ParamBrowLY', (t) => -0.55 * env(t, 0.5)),
        c('ParamBrowRY', (t) => -0.9 * env(t, 0.5)),
        c('ParamEyeLOpen', (t) => 1 - 0.3 * env(t, 0.5)),
        c('ParamEyeROpen', (t) => 1 - 0.3 * env(t, 0.5)),
        c('ParamMouthOpenY', (t) => 0.4 * env(t, 0.6)),
        c('ParamMouthForm', (t) => -0.75 * env(t, 0.5)),
      ]
    },
  },
  {
    // 小腿/脚：怕痒——猛烈一缩、眼睛闭紧、脑袋左右甩三下、嘟嘴。
    group: 'TapLeg',
    file: 'tap-leg.motion3.json',
    duration: 1.6,
    loop: false,
    build: () => {
      const d = 1.6
      const c = (id, pairs) => buildCurve(id, kf(pairs), { loop: false, duration: d })
      return [
        c('ParamAngleZ', [[0, 0], [0.3, -10], [0.6, 9], [0.9, -6], [1.25, 3], [1.6, 0]]),
        c('ParamAngleY', [[0, 0], [0.3, -6], [0.9, -5], [1.6, 0]]),
        c('ParamEyeLOpen', [[0, 1], [0.25, 0.15], [0.8, 0.35], [1.6, 1]]),
        c('ParamEyeROpen', [[0, 1], [0.25, 0.15], [0.8, 0.35], [1.6, 1]]),
        c('ParamCheekPuff', [[0, 0], [0.3, 0.6], [1.0, 0.55], [1.6, 0]]),
        c('ParamMouthOpenY', [[0, 0], [0.3, 0.5], [1.0, 0.25], [1.6, 0]]),
        c('ParamMouthForm', [[0, 0], [0.35, -0.6], [1.1, -0.5], [1.6, 0]]),
        c('ParamBodyAngleZ0', [[0, 0], [0.35, 6], [0.9, -3], [1.6, 0]]),
      ]
    },
  },
  {
    // 撩人：慢慢侧头、眼皮压低、一边挑眉、嘴角一勾——魅魔式的「你在看我？」。
    group: 'Charm',
    file: 'charm.motion3.json',
    duration: 3.2,
    loop: false,
    build: () => {
      const d = 3.2
      const c = (id, pairs) => buildCurve(id, kf(pairs), { loop: false, duration: d })
      return [
        c('ParamAngleZ', [[0, 0], [0.8, 9], [2.2, 8], [3.2, 0]]),
        c('ParamAngleX', [[0, 0], [1.0, 5], [2.2, 4], [3.2, 0]]),
        c('ParamAngleY', [[0, 0], [1.0, 2], [2.2, 1.5], [3.2, 0]]),
        c('ParamEyeLOpen', [[0, 1], [0.9, 0.62], [2.2, 0.6], [3.2, 1]]),
        c('ParamEyeROpen', [[0, 1], [0.9, 0.62], [2.2, 0.6], [3.2, 1]]),
        c('ParamEyeLSmile', [[0, 0], [1.0, 0.8], [2.2, 0.75], [3.2, 0]]),
        c('ParamEyeRSmile', [[0, 0], [1.0, 0.8], [2.2, 0.75], [3.2, 0]]),
        c('ParamBrowLY', [[0, 0], [1.0, 0.45], [2.2, 0.4], [3.2, 0]]),
        c('ParamBrowRY', [[0, 0], [1.0, -0.15], [2.2, -0.12], [3.2, 0]]),
        c('ParamMouthForm', [[0, 0], [1.0, 0.65], [2.2, 0.6], [3.2, 0]]),
        c('ParamMouthOpenY', [[0, 0], [1.2, 0.12], [2.2, 0.1], [3.2, 0]]),
      ]
    },
  },
  {
    // 得意：小幅摇晃 + 眼笑 + 嘴角上扬，循环播放时像在晃着尾巴炫耀。
    group: 'Smug',
    file: 'smug.motion3.json',
    duration: 2.6,
    loop: true,
    build: () => {
      const d = 2.6
      const p = (id, steps, fn) => buildCurve(id, periodic(d, steps, fn), { loop: true, duration: d })
      return [
        p('ParamAngleZ', 16, (t) => 5 * Math.sin(TAU * t)),
        p('ParamAngleX', 16, (t) => 2 * Math.cos(TAU * t)),
        p('ParamBodyAngleZ0', 16, (t) => 2.5 * Math.sin(TAU * t + Math.PI / 2)),
        p('ParamEyeLSmile', 16, () => 0.5),
        p('ParamEyeRSmile', 16, () => 0.5),
        p('ParamEyeLOpen', 16, () => 0.75),
        p('ParamEyeROpen', 16, () => 0.75),
        p('ParamMouthForm', 16, () => 0.45),
        p('ParamBrowLY', 16, () => 0.2),
        p('ParamBrowRY', 16, (t) => -0.1 + 0.1 * Math.sin(TAU * t)),
      ]
    },
  },
  {
    // 害羞：低头、眼珠往下躲、眯眼笑、腮帮子微鼓。
    group: 'Shy',
    file: 'shy.motion3.json',
    duration: 2.4,
    loop: false,
    build: () => {
      const d = 2.4
      const c = (id, pairs) => buildCurve(id, kf(pairs), { loop: false, duration: d })
      return [
        c('ParamAngleY', [[0, 0], [0.7, -9], [1.7, -8], [2.4, 0]]),
        c('ParamAngleZ', [[0, 0], [0.7, -5], [1.7, -4], [2.4, 0]]),
        c('ParamAngleX', [[0, 0], [0.7, -4], [1.7, -3], [2.4, 0]]),
        c('ParamEyeBallY', [[0, 0], [0.7, -0.6], [1.7, -0.5], [2.4, 0]]),
        c('ParamEyeLOpen', [[0, 1], [0.7, 0.5], [1.7, 0.55], [2.4, 1]]),
        c('ParamEyeROpen', [[0, 1], [0.7, 0.5], [1.7, 0.55], [2.4, 1]]),
        c('ParamEyeLSmile', [[0, 0], [0.8, 0.6], [1.7, 0.55], [2.4, 0]]),
        c('ParamEyeRSmile', [[0, 0], [0.8, 0.6], [1.7, 0.55], [2.4, 0]]),
        c('ParamCheekPuff', [[0, 0], [0.8, 0.3], [1.7, 0.28], [2.4, 0]]),
        c('ParamMouthForm', [[0, 0], [0.8, 0.35], [1.7, 0.3], [2.4, 0]]),
      ]
    },
  },
  {
    // 挑衅：下巴微抬、半眯着眼、挑眉歪嘴笑——「就这点本事？」。
    group: 'Taunt',
    file: 'taunt.motion3.json',
    duration: 2.2,
    loop: false,
    build: () => {
      const d = 2.2
      const c = (id, pairs) => buildCurve(id, kf(pairs), { loop: false, duration: d })
      return [
        c('ParamAngleY', [[0, 0], [0.6, 5], [1.5, 4.5], [2.2, 0]]),
        c('ParamAngleZ', [[0, 0], [0.6, -7], [1.5, -6], [2.2, 0]]),
        c('ParamEyeLOpen', [[0, 1], [0.6, 0.45], [1.5, 0.5], [2.2, 1]]),
        c('ParamEyeROpen', [[0, 1], [0.6, 0.45], [1.5, 0.5], [2.2, 1]]),
        c('ParamEyeLSmile', [[0, 0], [0.7, 0.35], [1.6, 0.3], [2.2, 0]]),
        c('ParamBrowRY', [[0, 0], [0.6, 0.5], [1.6, 0.45], [2.2, 0]]),
        c('ParamBrowLY', [[0, 0], [0.6, 0.1], [1.6, 0.08], [2.2, 0]]),
        c('ParamMouthForm', [[0, 0], [0.6, -0.5], [1.6, -0.45], [2.2, 0]]),
        c('ParamEyeBallY', [[0, 0], [0.7, 0.25], [1.6, 0.2], [2.2, 0]]),
      ]
    },
  },
  {
    // 伸懒腰：闭眼、张嘴打哈欠、头往后仰、身体向上抻一下。
    group: 'Stretch',
    file: 'stretch.motion3.json',
    duration: 3.0,
    loop: false,
    build: () => {
      const d = 3.0
      const c = (id, pairs) => buildCurve(id, kf(pairs), { loop: false, duration: d })
      return [
        c('ParamEyeLOpen', [[0, 1], [0.7, 0.05], [1.7, 0.05], [2.6, 1], [3.0, 1]]),
        c('ParamEyeROpen', [[0, 1], [0.7, 0.05], [1.7, 0.05], [2.6, 1], [3.0, 1]]),
        c('ParamMouthOpenY', [[0, 0], [0.9, 0.55], [1.6, 0.5], [2.4, 0.08], [3.0, 0]]),
        c('ParamMouthForm', [[0, 0], [1.0, -0.2], [2.2, -0.1], [3.0, 0]]),
        c('ParamAngleY', [[0, 0], [0.9, 7], [1.8, 6], [3.0, 0]]),
        c('ParamAngleZ', [[0, 0], [0.9, -3], [1.8, -2.5], [3.0, 0]]),
        c('ParamBodyAngleX0', [[0, 0], [0.9, 2.5], [1.8, 2], [3.0, 0]]),
        c('ParamBreath', [[0, 0], [1.0, 0.6], [2.2, 0.35], [3.0, 0]]),
      ]
    },
  },
]

// ---------------------------------------------------------------------------
// 校验工具
// ---------------------------------------------------------------------------

const failures = []
const checks = { passed: 0, failed: 0 }

function check(ok, message) {
  if (ok) {
    checks.passed++
  } else {
    checks.failed++
    failures.push(message)
  }
}

function parseJsonFile(file, label) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    check(false, `${label}: 无法读取 (${error.message})`)
    return null
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    check(false, `${label}: JSON 解析失败 (${error.message})`)
    return null
  }
}

function toRepoPath(file) {
  return relative(REPO_ROOT, file).split(sep).join('/')
}

function isInsideModelDir(file) {
  const rel = relative(MODEL_DIR, file)
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep)
}

/**
 * 解析并校验单条曲线的 Segments 结构；返回段数/贝塞尔段数/点数/末帧时间。
 */
function inspectSegments(curve, label) {
  const seg = curve.Segments
  check(Array.isArray(seg), `${label}: Segments 不是数组`)
  if (!Array.isArray(seg)) {
    return { segments: 0, beziers: 0, points: 0, lastTime: null, lastValue: null }
  }
  check(seg.length >= 5, `${label}: Segments 长度不足`)
  check(typeof seg[0] === 'number' && typeof seg[1] === 'number', `${label}: 首点不是 (t, v)`)
  check(seg[0] === 0, `${label}: 曲线首点时间必须为 0，实际 ${seg[0]}`)
  check(Number.isFinite(seg[0]) && Number.isFinite(seg[1]), `${label}: 首点含非有限数`)

  let i = 2
  let segments = 0
  let beziers = 0
  let points = 1
  let prevT = seg[0]
  let prevValue = seg[1]
  let lastTime = seg[0]
  let lastValue = seg[1]

  while (i < seg.length) {
    const type = seg[i]
    check([0, 1, 2, 3].includes(type), `${label}: 未知段类型 ${type}`)
    if (![0, 1, 2, 3].includes(type)) {
      return { segments, beziers, points, lastTime, lastValue }
    }
    const stride = type === 1 ? 7 : 3
    check(i + stride <= seg.length, `${label}: 段数据被截断 (index ${i})`)
    if (i + stride > seg.length) {
      return { segments, beziers, points, lastTime, lastValue }
    }
    const t = seg[i + 1]
    const v = seg[i + 2]
    check(typeof t === 'number' && Number.isFinite(t), `${label}: 段时间非法`)
    check(typeof v === 'number' && Number.isFinite(v), `${label}: 段值非法`)
    check(t > prevT, `${label}: 段时间未递增 (${prevT} -> ${t})`)
    if (type === 1) {
      const c1x = seg[i + 3]
      const c1y = seg[i + 4]
      const c2x = seg[i + 5]
      const c2y = seg[i + 6]
      check(
        c1x > prevT && c1x < t && c2x > prevT && c2x < t,
        `${label}: 贝塞尔控制点时间越界 (${c1x}, ${c2x}) 不在 (${prevT}, ${t})`,
      )
      const lo = Math.min(prevValue, v)
      const hi = Math.max(prevValue, v)
      check(
        c1y >= lo - 1e-9 && c1y <= hi + 1e-9 && c2y >= lo - 1e-9 && c2y <= hi + 1e-9,
        `${label}: 贝塞尔控制点值未限制在段端点之间`,
      )
      beziers++
      points += 3
    } else {
      points += 1
    }
    prevT = t
    prevValue = v
    lastTime = t
    lastValue = v
    segments++
    i += stride
  }

  return { segments, beziers, points, lastTime, lastValue }
}

function paramRangeText(curve) {
  const values = []
  const seg = curve.Segments
  values.push(seg[1])
  let i = 2
  while (i < seg.length) {
    if (seg[i] === 1) {
      values.push(seg[i + 2])
      i += 7
    } else {
      values.push(seg[i + 2])
      i += 3
    }
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  return `${min}~${max}`
}

/** 校验一个 motion3.json（从磁盘读，确保序列化后的文件本身合法）。 */
function validateMotionFile(file, expected) {
  const label = `${toRepoPath(file)}`
  const motion = parseJsonFile(file, label)
  if (!motion) return null

  check(motion.Version === 3, `${label}: Version 应为 3`)
  check(Array.isArray(motion.Curves) && motion.Curves.length > 0, `${label}: Curves 为空`)

  const meta = motion.Meta
  check(meta && typeof meta === 'object', `${label}: 缺少 Meta`)
  if (!meta) return null

  check(meta.Duration === expected.duration, `${label}: Meta.Duration=${meta.Duration} 应为 ${expected.duration}`)
  check(meta.Fps === FPS, `${label}: Meta.Fps=${meta.Fps} 应为 ${FPS}`)
  check(meta.Loop === expected.loop, `${label}: Meta.Loop=${meta.Loop} 应为 ${expected.loop}`)
  check(meta.AreBeziersRestricted === true, `${label}: 应为 AreBeziersRestricted=true`)
  check(meta.UserDataCount === 0, `${label}: UserDataCount 应为 0`)
  check(meta.TotalUserDataSize === 0, `${label}: TotalUserDataSize 应为 0`)
  check(meta.CurveCount === motion.Curves.length, `${label}: Meta.CurveCount 与曲线数不一致`)

  let totalSegments = 0
  let totalBeziers = 0
  let totalPoints = 0
  let maxLastTime = -Infinity
  let curveCount = 0
  const ids = []

  for (const curve of motion.Curves) {
    curveCount++
    check(curve.Target === 'Parameter', `${label}: 曲线 ${curve.Id} Target 应为 Parameter`)
    check(typeof curve.Id === 'string', `${label}: 曲线 Id 非法`)
    if (typeof curve.Id === 'string') ids.push(curve.Id)
    const info = inspectSegments(curve, `${label}#${curve.Id}`)
    totalSegments += info.segments
    totalBeziers += info.beziers
    totalPoints += info.points
    maxLastTime = Math.max(maxLastTime, info.lastTime ?? -Infinity)

    // 末帧时间必须等于动作时长（duration 与最后关键帧一致）
    check(
      Math.abs((info.lastTime ?? -Infinity) - meta.Duration) < 1e-6,
      `${label}#${curve.Id}: 末帧时间 ${info.lastTime} 与时长 ${meta.Duration} 不一致`,
    )
    // 非循环动作首尾值应回到出发点附近（允许回位；循环动作已在生成期强制首尾一致）
    if (expected.loop) {
      const first = curve.Segments[1]
      const last = info.lastValue
      check(
        typeof last === 'number' && Math.abs(last - first) < 1e-6,
        `${label}#${curve.Id}: 循环曲线首尾值不一致 (${first} vs ${last})`,
      )
    }
  }

  check(new Set(ids).size === ids.length, `${label}: 存在重复参数曲线`)
  check(meta.TotalSegmentCount === totalSegments, `${label}: Meta.TotalSegmentCount 与实算 ${totalSegments} 不一致`)
  check(
    meta.TotalPointCount === totalPoints,
    `${label}: Meta.TotalPointCount 与实算 ${totalPoints}（=曲线数+段数+2×贝塞尔段数）不一致`,
  )
  check(
    meta.TotalPointCount === curveCount + totalSegments + 2 * totalBeziers,
    `${label}: TotalPointCount 不满足 CurveCount + TotalSegmentCount + 2×贝塞尔段数`,
  )
  check(
    Math.abs(maxLastTime - meta.Duration) < 1e-6,
    `${label}: 所有曲线的最末关键帧时间 ${maxLastTime} 与 Meta.Duration 不一致`,
  )

  return { motion, label, segments: totalSegments, beziers: totalBeziers }
}

// ---------------------------------------------------------------------------
// 主流程：生成 → 写盘 → 校验
// ---------------------------------------------------------------------------

function main() {
  console.log('== 「简」内置模型动作生成 / 校验 ==')
  console.log(`仓库: ${REPO_ROOT}`)
  console.log(`模型: ${toRepoPath(MODEL_DIR)}`)
  console.log('')

  // 0. cdi3 作为参数白名单的最终依据
  const cdi3 = parseJsonFile(CDI3_FILE, '简.cdi3.json')
  check(cdi3 && cdi3.Version === 3, '简.cdi3.json: Version 应为 3')
  const cdiParams = new Map(
    ((cdi3 && Array.isArray(cdi3.Parameters) ? cdi3.Parameters : [])).map((p) => [p.Id, p.Name]),
  )
  check(cdiParams.size > 0, '简.cdi3.json: 未解析到 Parameters')
  for (const id of Object.keys(SAFE_PARAMS)) {
    check(cdiParams.has(id), `Safe 参数 ${id} 不存在于 简.cdi3.json`)
  }

  // 1. 生成并写盘（幂等：内容由定义完全决定）
  mkdirSync(MOTION_DIR, { recursive: true })
  const generated = new Map()
  for (const def of MOTION_DEFS) {
    const { json, curves } = buildMotion(def)
    const file = join(MOTION_DIR, def.file)
    writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, 'utf8')
    generated.set(def.group, { file, def, curves, json })
    for (const curve of curves) {
      const [lo, hi] = SAFE_PARAMS[curve.id]
      check(
        curve.keyMin >= lo - 1e-9 && curve.keyMax <= hi + 1e-9,
        `[${def.group}] ${curve.id} 幅度 ${curve.keyMin}~${curve.keyMax} 超出量纲守护范围 ${lo}~${hi}`,
      )
    }
  }
  check(generated.size === MOTION_DEFS.length, `应生成 ${MOTION_DEFS.length} 个自建动作，实际 ${generated.size}`)

  // 2. 逐个动作从磁盘校验
  const reports = []
  for (const def of MOTION_DEFS) {
    const item = generated.get(def.group)
    check(!!item, `缺少动作组 ${def.group}`)
    if (!item) continue
    const result = validateMotionFile(item.file, item.def)
    if (!result) continue
    const segInfo = result.motion.Curves.map((c) => `${c.Id}=${paramRangeText(c)}`)
    reports.push({
      group: def.group,
      file: def.file,
      duration: def.duration,
      loop: def.loop,
      curveCount: result.motion.Meta.CurveCount,
      segments: result.motion.Meta.TotalSegmentCount,
      points: result.motion.Meta.TotalPointCount,
      params: segInfo,
    })
  }
  // 3. model3.json 校验（引用文件存在 / Motions 组名 / Groups / 文件互引）
  const model3 = parseJsonFile(MODEL3_FILE, '简.model3.json')
  if (model3) {
    const fr = model3.FileReferences || {}
    check(model3.Version === 3, '简.model3.json: Version 应为 3')
    check(typeof fr.Moc === 'string' && existsSync(resolve(MODEL_DIR, fr.Moc)), '简.model3.json: Moc 文件不存在')
    check(
      Array.isArray(fr.Textures) && fr.Textures.length > 0,
      '简.model3.json: Textures 应为非空数组',
    )
    for (const texture of fr.Textures || []) {
      check(typeof texture === 'string' && existsSync(resolve(MODEL_DIR, texture)), `简.model3.json: 贴图不存在 ${texture}`)
    }
    check(
      typeof fr.Physics === 'string' && existsSync(resolve(MODEL_DIR, fr.Physics)),
      '简.model3.json: Physics 文件不存在',
    )
    check(
      typeof fr.DisplayInfo === 'string' && existsSync(resolve(MODEL_DIR, fr.DisplayInfo)),
      '简.model3.json: DisplayInfo 文件不存在',
    )

    // Groups
    const groups = Array.isArray(model3.Groups) ? model3.Groups : []
    const eyeBlink = groups.find((g) => g.Name === 'EyeBlink')
    const lipSync = groups.find((g) => g.Name === 'LipSync')
    check(!!eyeBlink && eyeBlink.Target === 'Parameter', '简.model3.json: 缺少 EyeBlink Parameter Group')
    check(
      !!eyeBlink &&
        Array.isArray(eyeBlink.Ids) &&
        eyeBlink.Ids.length === 2 &&
        eyeBlink.Ids[0] === 'ParamEyeLOpen' &&
        eyeBlink.Ids[1] === 'ParamEyeROpen',
      '简.model3.json: EyeBlink Ids 应为 [ParamEyeLOpen, ParamEyeROpen]',
    )
    check(
      !!lipSync &&
        lipSync.Target === 'Parameter' &&
        Array.isArray(lipSync.Ids) &&
        lipSync.Ids.length === 1 &&
        lipSync.Ids[0] === 'ParamMouthOpenY',
      '简.model3.json: LipSync Ids 应为 [ParamMouthOpenY]',
    )
    for (const group of [eyeBlink, lipSync].filter(Boolean)) {
      for (const id of group.Ids || []) {
        check(cdiParams.has(id), `简.model3.json: Group ${group.Name} 的参数 ${id} 不在 cdi3 中`)
      }
    }

    // Motions 组名与文件
    const motionsTable = fr.Motions
    check(motionsTable && typeof motionsTable === 'object', '简.model3.json: 缺少 FileReferences.Motions')
    const groupNames = Object.keys(motionsTable || {})
    check(
      groupNames.length === EXPECTED_GROUPS.length,
      `简.model3.json: Motions 组数 ${groupNames.length} 应为 ${EXPECTED_GROUPS.length}`,
    )
    for (const group of EXPECTED_GROUPS) {
      const list = motionsTable && motionsTable[group]
      check(Array.isArray(list) && list.length === 1, `简.model3.json: 动作组 ${group} 应恰好引用 1 个文件`)
      if (!Array.isArray(list) || !list[0]) continue
      const relPath = list[0].File
      check(typeof relPath === 'string', `简.model3.json: 动作组 ${group} 缺少 File`)
      if (typeof relPath !== 'string') continue
      const file = resolve(MODEL_DIR, relPath)
      check(isInsideModelDir(file), `简.model3.json: 动作组 ${group} 文件越出模型目录 ${relPath}`)
      check(existsSync(file), `简.model3.json: 动作组 ${group} 引用的文件不存在 ${relPath}`)
      const expected = MOTION_DEFS.find((d) => d.group === group)
      check(!!expected, `简.model3.json: 未知动作组 ${group}`)
      if (expected) {
        check(relPath === `motions/${expected.file}`, `简.model3.json: 动作组 ${group} 引用 ${relPath}，应为 motions/${expected.file}`)
      }
    }

    // motions/ 目录里的每个 motion3.json 都应被 model3 引用
    const referenced = new Set(
      Object.values(motionsTable || {})
        .flat()
        .map((entry) => resolve(MODEL_DIR, entry.File)),
    )
    for (const name of readdirSync(MOTION_DIR)) {
      if (!name.endsWith('.motion3.json')) continue
      const file = join(MOTION_DIR, name)
      check(referenced.has(file), `motions/${name} 未被 简.model3.json 引用`)
    }
  }

  // 4. 报告
  console.log('动作清单:')
  for (const report of reports) {
    console.log(
      `  [${report.group}] ${report.file}  时长=${report.duration}s  Loop=${report.loop}  ` +
        `曲线=${report.curveCount} 段=${report.segments} 点=${report.points}`,
    )
    for (const param of report.params) {
      console.log(`      - ${param}`)
    }
  }
  console.log('')
  console.log(`校验: ${checks.passed} 项通过, ${checks.failed} 项失败`)
  if (failures.length > 0) {
    console.error('\n失败明细:')
    for (const failure of failures) {
      console.error(`  ✗ ${failure}`)
    }
    process.exitCode = 1
    return
  }
  console.log('✓ 全部校验通过（JSON 可解析 / 参数均在 cdi3 / Meta 计数自洽 / 引用文件存在）')
}

main()
