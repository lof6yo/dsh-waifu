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
const EXPECTED_GROUPS = ['Idle', 'Nod', 'ShakeHead', 'Tilt', 'Sway', 'Hop']

/**
 * 允许在动作里驱动的参数白名单 + 量纲守护范围。
 * 量纲来自 cdi3 中文名与 Live2D 常规约定（角度 / 0~1 开关 / -1~1 表情）。
 * 物理驱动的输出参数（ParamEyeLSmile 由 ParamMouthForm 驱动、ParamBodyAngle*0）
 * 也按任务要求保留，但幅度保守，且让 ParamMouthForm 作为可见微笑的主驱动。
 */
const SAFE_PARAMS = {
  ParamAngleX: [-30, 30],
  ParamAngleY: [-30, 30],
  ParamAngleZ: [-30, 30],
  ParamAnglePX: [-10, 10],
  ParamAnglePY: [-10, 10],
  ParamBodyAngleX0: [-10, 10],
  ParamBodyAngleY0: [-10, 10],
  ParamBodyAngleZ0: [-10, 10],
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
 * 用于 Idle / Thinking / Waiting 这类纯循环动作。
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
// 自建动作设计（当前只保留 Idle；原始 Scene1 不在此生成）
// ---------------------------------------------------------------------------

/**
 * 动作清单。build() 返回 [{id, ...}]（见 buildCurve 返回结构）。
 * 幅度保守：角度用度（±10 以内），开关/表情用 0~1 或 -1~1。
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
    group: 'Nod',
    file: 'nod.motion3.json',
    duration: 1.3,
    loop: false,
    build: () => [
      // 两次点头：先浅后深（张弛），末尾上抬过冲再刹车回落（Live2D 官方「后坐力/踩刹车」）
      buildCurve('ParamAngleY', kf([
        [0, 0],
        [0.08, 1.2],
        [0.18, 7.2],
        [0.28, 2.4],
        [0.38, 8.6],
        [0.5, 1.2],
        [0.66, -1.6],
        [0.9, 0.4],
        [1.3, 0],
      ]), { loop: false, duration: 1.3 }),
      // 侧倾比俯仰晚一点到位，避免「机器人同帧」
      buildCurve('ParamAngleZ', kf([
        [0, 0],
        [0.22, 1.1],
        [0.52, -0.9],
        [0.85, 0.4],
        [1.3, 0],
      ]), { loop: false, duration: 1.3 }),
      buildCurve('ParamAnglePX', kf([
        [0, 0],
        [0.25, 0.6],
        [0.8, -0.3],
        [1.3, 0],
      ]), { loop: false, duration: 1.3 }),
      // 点头时眼睑跟着压，抬起来之前眨一次
      buildCurve('ParamEyeLOpen', kf([
        [0, 1],
        [0.15, 0.66],
        [0.27, 0.96],
        [0.36, 0.6],
        [0.55, 1],
        [1.05, 1],
        [1.14, 0.06],
        [1.22, 0.04],
        [1.3, 1],
      ]), { loop: false, duration: 1.3 }),
      buildCurve('ParamEyeROpen', kf([
        [0, 1],
        [0.15, 0.66],
        [0.27, 0.96],
        [0.36, 0.6],
        [0.55, 1],
        [1.05, 1],
        [1.14, 0.06],
        [1.22, 0.04],
        [1.3, 1],
      ]), { loop: false, duration: 1.3 }),
      buildCurve('ParamBrowLY', kf([
        [0, 0],
        [0.2, -0.18],
        [0.5, -0.05],
        [1.1, 0.12],
        [1.3, 0],
      ]), { loop: false, duration: 1.3 }),
      buildCurve('ParamBrowRY', kf([
        [0, 0],
        [0.2, -0.18],
        [0.5, -0.05],
        [1.1, 0.12],
        [1.3, 0],
      ]), { loop: false, duration: 1.3 }),
      buildCurve('ParamMouthForm', kf([
        [0, 0],
        [0.3, 0.18],
        [0.9, 0.1],
        [1.3, 0],
      ]), { loop: false, duration: 1.3 }),
    ],
  },
  {
    group: 'ShakeHead',
    file: 'shake-head.motion3.json',
    duration: 1.4,
    loop: false,
    build: () => [
      // 左右摇头：三次幅度递减（大→中→小），收尾轻微过冲
      buildCurve('ParamAngleX', kf([
        [0, 0],
        [0.1, -2.4],
        [0.2, -8.4],
        [0.32, 8],
        [0.44, -6.2],
        [0.56, 4],
        [0.7, -1.8],
        [0.92, 0.6],
        [1.4, 0],
      ]), { loop: false, duration: 1.4 }),
      buildCurve('ParamAngleZ', kf([
        [0, 0],
        [0.16, 1.6],
        [0.32, -2.2],
        [0.5, 1.6],
        [0.72, -0.8],
        [1, 0.2],
        [1.4, 0],
      ]), { loop: false, duration: 1.4 }),
      buildCurve('ParamAngleY', kf([
        [0, 0],
        [0.18, 1.6],
        [0.6, 1.2],
        [1, 0.2],
        [1.4, 0],
      ]), { loop: false, duration: 1.4 }),
      buildCurve('ParamEyeLOpen', kf([
        [0, 1],
        [0.72, 1],
        [0.8, 0.06],
        [0.88, 0.05],
        [0.98, 1],
        [1.4, 1],
      ]), { loop: false, duration: 1.4 }),
      buildCurve('ParamEyeROpen', kf([
        [0, 1],
        [0.72, 1],
        [0.8, 0.06],
        [0.88, 0.05],
        [0.98, 1],
        [1.4, 1],
      ]), { loop: false, duration: 1.4 }),
      buildCurve('ParamBrowLY', kf([
        [0, 0],
        [0.25, -0.26],
        [0.8, -0.2],
        [1.2, 0],
        [1.4, 0],
      ]), { loop: false, duration: 1.4 }),
      buildCurve('ParamBrowRY', kf([
        [0, 0],
        [0.25, -0.26],
        [0.8, -0.2],
        [1.2, 0],
        [1.4, 0],
      ]), { loop: false, duration: 1.4 }),
      buildCurve('ParamMouthForm', kf([
        [0, 0],
        [0.3, -0.2],
        [1, -0.12],
        [1.4, 0],
      ]), { loop: false, duration: 1.4 }),
    ],
  },
  {
    group: 'Tilt',
    file: 'tilt.motion3.json',
    duration: 1.8,
    loop: false,
    build: () => [
      // 歪头：慢起 → 停住看一会儿 → 回正时过冲一次
      buildCurve('ParamAngleZ', kf([
        [0, 0],
        [0.3, 6.5],
        [0.46, 9.2],
        [0.95, 8.8],
        [1.25, 1.6],
        [1.5, -1.2],
        [1.8, 0],
      ]), { loop: false, duration: 1.8 }),
      buildCurve('ParamAngleX', kf([
        [0, 0],
        [0.35, 2.6],
        [1, 2.1],
        [1.45, 0.3],
        [1.8, 0],
      ]), { loop: false, duration: 1.8 }),
      buildCurve('ParamAngleY', kf([
        [0, 0],
        [0.3, -1.6],
        [0.95, -1.3],
        [1.45, 0.4],
        [1.8, 0],
      ]), { loop: false, duration: 1.8 }),
      buildCurve('ParamAnglePX', kf([
        [0, 0],
        [0.35, 0.8],
        [1.1, 0.7],
        [1.6, 0],
        [1.8, 0],
      ]), { loop: false, duration: 1.8 }),
      buildCurve('ParamEyeBallY', kf([
        [0, 0],
        [0.3, 0.34],
        [1, 0.28],
        [1.4, 0],
        [1.8, 0],
      ]), { loop: false, duration: 1.8 }),
      buildCurve('ParamEyeLOpen', kf([
        [0, 1],
        [0.28, 1],
        [1.12, 1],
        [1.2, 0.06],
        [1.3, 0.05],
        [1.4, 1],
        [1.8, 1],
      ]), { loop: false, duration: 1.8 }),
      buildCurve('ParamEyeROpen', kf([
        [0, 1],
        [0.28, 1],
        [1.12, 1],
        [1.2, 0.06],
        [1.3, 0.05],
        [1.4, 1],
        [1.8, 1],
      ]), { loop: false, duration: 1.8 }),
      buildCurve('ParamBrowLY', kf([
        [0, 0],
        [0.32, -0.22],
        [1.05, -0.16],
        [1.5, 0],
        [1.8, 0],
      ]), { loop: false, duration: 1.8 }),
      buildCurve('ParamBrowRY', kf([
        [0, 0],
        [0.32, -0.22],
        [1.05, -0.16],
        [1.5, 0],
        [1.8, 0],
      ]), { loop: false, duration: 1.8 }),
      buildCurve('ParamMouthForm', kf([
        [0, 0],
        [0.34, 0.28],
        [1.1, 0.22],
        [1.6, 0],
        [1.8, 0],
      ]), { loop: false, duration: 1.8 }),
      buildCurve('ParamCheekPuff', kf([
        [0, 0],
        [0.4, 0.15],
        [1.2, 0.1],
        [1.8, 0],
      ]), { loop: false, duration: 1.8 }),
    ],
  },
  {
    group: 'Sway',
    file: 'sway.motion3.json',
    duration: 2.8,
    loop: false,
    build: () => {
      // 左右晃动：两个来回的正弦，加 10% 的头尾包络，保证从静止起、回静止收。
      const duration = 2.8
      const env = (tau) => Math.min(1, tau / 0.12, (1 - tau) / 0.12)
      const wave = (amp, phase) =>
        periodic(duration, 56, (tau) => amp * env(tau) * Math.sin(2 * TAU * 2 * tau + phase))
      return [
        buildCurve('ParamAngleZ', wave(6.5, 0), { loop: false, duration }),
        buildCurve('ParamAngleX', wave(4.2, -0.55), { loop: false, duration }),
        buildCurve('ParamAngleY', wave(1.1, -1.1), { loop: false, duration }),
        buildCurve('ParamAnglePX', wave(2.4, -0.3), { loop: false, duration }),
        buildCurve('ParamEyeLOpen', kf([
          [0, 1],
          [0.86, 1],
          [0.94, 0.06],
          [1.02, 0.05],
          [1.12, 1],
          [2.1, 1],
          [2.18, 0.06],
          [2.26, 0.05],
          [2.36, 1],
          [2.8, 1],
        ]), { loop: false, duration }),
        buildCurve('ParamEyeROpen', kf([
          [0, 1],
          [0.86, 1],
          [0.94, 0.06],
          [1.02, 0.05],
          [1.12, 1],
          [2.1, 1],
          [2.18, 0.06],
          [2.26, 0.05],
          [2.36, 1],
          [2.8, 1],
        ]), { loop: false, duration }),
      ]
    },
  },
  {
    group: 'Hop',
    file: 'hop.motion3.json',
    duration: 1.1,
    loop: false,
    build: () => [
      // 上下轻跳：蓄力下蹲 → 腾空（client 侧同时给 canvas 位移做抛物线）→ 落地缓冲回弹
      buildCurve('ParamAngleY', kf([
        [0, 0],
        [0.1, 2.6],
        [0.16, 4.2],
        [0.3, -2.2],
        [0.45, -2.6],
        [0.6, 3.4],
        [0.72, 0.6],
        [0.88, -0.6],
        [1.1, 0],
      ]), { loop: false, duration: 1.1 }),
      buildCurve('ParamAngleZ', kf([
        [0, 0],
        [0.4, 0.8],
        [0.8, -0.6],
        [1.1, 0],
      ]), { loop: false, duration: 1.1 }),
      buildCurve('ParamEyeLOpen', kf([
        [0, 1],
        [0.14, 0.72],
        [0.3, 1],
        [0.55, 1],
        [0.6, 0.5],
        [0.68, 1],
        [1.1, 1],
      ]), { loop: false, duration: 1.1 }),
      buildCurve('ParamEyeROpen', kf([
        [0, 1],
        [0.14, 0.72],
        [0.3, 1],
        [0.55, 1],
        [0.6, 0.5],
        [0.68, 1],
        [1.1, 1],
      ]), { loop: false, duration: 1.1 }),
      buildCurve('ParamMouthOpenY', kf([
        [0, 0],
        [0.16, 0.1],
        [0.35, 0.28],
        [0.55, 0.22],
        [0.7, 0.05],
        [1.1, 0],
      ]), { loop: false, duration: 1.1 }),
      buildCurve('ParamCheekPuff', kf([
        [0, 0],
        [0.16, 0.2],
        [0.5, 0.1],
        [0.9, 0],
        [1.1, 0],
      ]), { loop: false, duration: 1.1 }),
    ],
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
