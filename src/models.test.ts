import { describe, expect, it } from 'vitest'
import {
  listBuiltinPresets,
  resolveModelUrl,
  resolveDefaultTouchParts,
  defaultModelId,
} from './models-host.ts'
import {
  ACTIVITY_EVENTS,
  AI_MOTIONS,
  ANIMATION_SLOTS,
  EXPRESSIONS,
  EXPRESSION_IDS,
  EXPRESSION_SWITCH_PARAMS,
  isExpressionId,
  isMotionId,
  normalizeExpressionId,
  motionLabel,
  expressionLabel,
  expressionParams,
  normalizeInteractions,
  normalizeTouchParts,
  MAX_INTERACTIONS_PER_PART,
  TOUCH_HOLD_DEFAULT_MS,
  TOUCH_HOLD_LIMITS,
  dedupeExpressions,
  hitTestTouchParts,
  normalizeTouchBox,
  pointToBoundsRatio,
  stripTimestamps,
  type TouchPart,
  pickTapInteraction,
} from './models.ts'

describe('listBuiltinPresets', () => {
  it('只保留「简」一个内置模型，字段齐全', () => {
    const presets = listBuiltinPresets()
    expect(presets.length).toBe(1)
    const jian = presets[0]
    expect(jian.id).toBe('jian')
    expect(jian.name).toBe('简')
    expect(jian.modelUrl).toBe('/waifu-assets/models/jian/简.model3.json')
    expect(jian.cubism).toBe(4)
    expect(jian.license.type).toBeTruthy()
    expect(defaultModelId()).toBe('jian')
  })

  it('内置模型带默认触摸部位（ADR-037：部位只剩 id/name/boxes）', () => {
    const jian = listBuiltinPresets()[0]
    expect(jian.touchParts?.map((p) => p.name)).toEqual(['脸', '头发', '胸', '私处', '臀', '腰', '大腿', '手', '小腿', '脚'])
    // 部位不再带 motions/lines —— 台词与动作全部交给 AI
    for (const part of jian.touchParts ?? []) {
      expect(Object.keys(part).sort()).toEqual(['boxes', 'id', 'interactions', 'name'])
    }
    expect(resolveDefaultTouchParts('jian').length).toBe(10)
    expect(resolveDefaultTouchParts('nope')).toEqual([])
  })
})

describe('resolveModelUrl', () => {
  it('preset id 命内置清单（同源素材路径）', () => {
    expect(resolveModelUrl('jian')).toBe('/waifu-assets/models/jian/简.model3.json')
  })

  it('未命中回退默认内置模型（旧配置升级不空白）', () => {
    expect(resolveModelUrl('hiyori')).toBe('/waifu-assets/models/jian/简.model3.json')
  })
})

describe('TouchBox 归一化', () => {
  it('夹到 0–1 并交换左上/右下', () => {
    expect(normalizeTouchBox({ left: 1.2, top: -0.2, right: 0.4, bottom: 0.8 })).toEqual({
      left: 0.4,
      top: 0,
      right: 1,
      bottom: 0.8,
    })
  })

  it('非法/零面积 box 返回 null', () => {
    expect(normalizeTouchBox(null)).toBeNull()
    expect(normalizeTouchBox({ left: 0.5, top: 0.5, right: 0.5, bottom: 0.5 })).toBeNull()
  })
})

describe('normalizeTouchParts', () => {
  it('丢弃无名部位、去重 id，旧版 motions/lines 字段被忽略（ADR-037）', () => {
    const parts = normalizeTouchParts([
      { id: 'head', name: '头', boxes: [{ left: 0, top: 0, right: 0.5, bottom: 0.5 }], motions: ['TapHead', 'TapHead'], lines: ['旧台词'] },
      { id: 'head', name: '头2', boxes: [] },
      { name: '   ', boxes: [] },
      { name: '手', boxes: [] },
    ])
    expect(parts.map((p) => p.name)).toEqual(['头', '头2', '手'])
    expect(parts[0]).toEqual({ id: 'head', name: '头', boxes: [{ left: 0, top: 0, right: 0.5, bottom: 0.5 }] })
    expect(parts[1].id).not.toBe(parts[0].id)
  })
})

describe('hitTestTouchParts（按图层，parts[0] 最上层）', () => {
  // 默认顺序：脸在最上层、头其次、身体最底层（与 presets.jsonc 一致）
  const parts: TouchPart[] = [
    { id: 'face', name: '脸', boxes: [{ left: 0.3, top: 0.3, right: 0.7, bottom: 0.7 }] },
    { id: 'head', name: '头', boxes: [{ left: 0.1, top: 0.0, right: 0.9, bottom: 0.8 }] },
  ]

  it('命中部位返回该部位', () => {
    expect(hitTestTouchParts(parts, 0.2, 0.1)?.id).toBe('head')
  })

  it('重叠时上层部位优先（与 box 面积无关）', () => {
    expect(hitTestTouchParts(parts, 0.5, 0.5)?.id).toBe('face')
    // 上层是大 box 时同样优先于下层小 box
    const bigOnTop: TouchPart[] = [
      { id: 'big', name: '大', boxes: [{ left: 0, top: 0, right: 1, bottom: 1 }] },
      { id: 'small', name: '小', boxes: [{ left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 }] },
    ]
    expect(hitTestTouchParts(bigOnTop, 0.5, 0.5)?.id).toBe('big')
    // 调换图层顺序后由新的上层生效
    expect(hitTestTouchParts([...bigOnTop].reverse(), 0.5, 0.5)?.id).toBe('small')
  })

  it('未命中返回 null', () => {
    expect(hitTestTouchParts(parts, 0.95, 0.9)).toBeNull()
    expect(hitTestTouchParts([], 0.5, 0.5)).toBeNull()
  })

  it('一个部位多个 box 均可命中', () => {
    const multi: TouchPart[] = [{
      id: 'p',
      name: '多框',
      boxes: [
        { left: 0, top: 0, right: 0.2, bottom: 0.2 },
        { left: 0.8, top: 0.8, right: 1, bottom: 1 },
      ],
    }]
    expect(hitTestTouchParts(multi, 0.1, 0.1)?.id).toBe('p')
    expect(hitTestTouchParts(multi, 0.9, 0.9)?.id).toBe('p')
    expect(hitTestTouchParts(multi, 0.5, 0.5)).toBeNull()
  })
})

describe('动作目录（ADR-037 AI_MOTIONS）', () => {
  it('8 个动作组，id 唯一，中文名与释义齐全', () => {
    const ids = AI_MOTIONS.map((motion) => motion.id)
    expect(ids).toEqual(['Nod', 'ShakeHead', 'Tilt', 'Sway', 'Glance', 'Perk', 'Shift', 'Sigh'])
    expect(new Set(ids).size).toBe(ids.length)
    for (const motion of AI_MOTIONS) {
      expect(motion.name.length).toBeGreaterThan(0)
      expect(motion.meaning.length).toBeGreaterThan(0)
      expect(isMotionId(motion.id)).toBe(true)
      expect(motionLabel(motion.id)).toBe(motion.name)
    }
  })

  it('isMotionId 只认目录内；motionLabel 未知回退原名', () => {
    expect(isMotionId('Nod')).toBe(true)
    expect(isMotionId(' nod ')).toBe(false)
    expect(isMotionId('TapBody')).toBe(false)
    expect(motionLabel('Custom')).toBe('Custom')
  })
})

describe('表情（expressions）', () => {
  it('注册表覆盖 10 个开关参数且 id 唯一', () => {
    const ids = EXPRESSIONS.map((expression) => expression.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(EXPRESSIONS.some((expression) => expression.id === 'none')).toBe(true)
    const params = EXPRESSIONS.flatMap((expression) => Object.keys(expression.params))
    expect(new Set(params).size).toBeGreaterThanOrEqual(10)
    for (const param of params) expect(EXPRESSION_SWITCH_PARAMS).toContain(param)
    // ADR-037：每个表情都有给模型看的 meaning（none 除外）
    for (const expression of EXPRESSIONS) {
      if (expression.id === 'none') continue
      expect(expression.meaning.length).toBeGreaterThan(0)
    }
  })

  it('normalizeExpressionId 未知 id 回退 none', () => {
    expect(normalizeExpressionId('blush')).toBe('blush')
    expect(normalizeExpressionId('  angry ')).toBe('angry')
    expect(normalizeExpressionId('bogus')).toBe('none')
    expect(normalizeExpressionId(undefined)).toBe('none')
  })

  it('isExpressionId 只认注册表里的表情', () => {
    expect(isExpressionId('blush')).toBe(true)
    expect(isExpressionId(' angry ')).toBe(true)
    expect(isExpressionId('Idle')).toBe(false)
    expect(EXPRESSION_IDS).not.toContain('none')
  })

  it('expressionParams 合并多个表情的参数（眼 + 皮肤各自生效）', () => {
    expect(expressionParams(['blush', 'cry'])).toEqual({ ParamSwitch2: 1, ParamSwitch9: 1 })
    expect(expressionParams(['angry', 'dim', 'blush'])).toEqual({
      ParamSwitch2: 1, ParamSwitch4: 1, ParamSwitch21: 1,
    })
    expect(expressionParams([])).toEqual({})
    expect(expressionParams(['none'])).toEqual({})
  })

  it('dedupeExpressions 互斥组去重：同组后出现的替换先出现的', () => {
    // blush 与 dark 同为 skin 组：后到的 dark 替换 blush
    expect(dedupeExpressions(['blush', 'dark'])).toEqual(['dark'])
    // 不同组可叠加；同 id 重复时后出现者挪到末尾
    expect(dedupeExpressions(['blush', 'star', 'blush'])).toEqual(['star', 'blush'])
    expect(dedupeExpressions([])).toEqual([])
    expect(dedupeExpressions(['none', 'bogus'])).toEqual([])
  })

  it('表情都有中文显示名（未知 id 回退原名）', () => {
    expect(expressionLabel('blush')).toBe('脸红')
    expect(expressionLabel('nope')).toBe('nope')
  })
})

describe('事件目录', () => {
  it('状态位 + 活动事件合成 PET_EVENTS，与触发开关同源', () => {
    expect(ANIMATION_SLOTS).toEqual(['idle', 'thinking', 'error', 'done', 'waiting', 'delivered'])
    expect(ACTIVITY_EVENTS.length).toBe(11)
  })
})

describe('pickTapInteraction（按压路径只挑单击/双击，ADR-038 修订）', () => {
  const part: TouchPart = {
    id: 'p1', name: '脸', boxes: [{ left: 0, top: 0, right: 1, bottom: 1 }],
    interactions: [
      { id: 'i1', name: '轻碰', trigger: 'tap', holdMs: 3000 },
      { id: 'i2', name: '捏一下', trigger: 'double', holdMs: 3000 },
      { id: 'i3', name: '抚摸', trigger: 'hold', holdMs: 3000 },
    ],
  }
  it('单击挑 tap 交互，即使部位还定义了 hold（hold 已由悬停负责）', () => {
    expect(pickTapInteraction(part, 1)?.name).toBe('轻碰')
  })
  it('双击挑 double 交互', () => {
    expect(pickTapInteraction(part, 2)?.name).toBe('捏一下')
  })
  it('没定义 tap 时单击返回 undefined（不回落 hold）', () => {
    const onlyHold: TouchPart = { id: 'p2', name: '腰', boxes: [], interactions: [{ id: 'h', name: '抚摸', trigger: 'hold', holdMs: 3000 }] }
    expect(pickTapInteraction(onlyHold, 1)).toBeUndefined()
  })
})

describe('pointToBoundsRatio', () => {
  const bounds = { x: 10, y: 20, width: 100, height: 200 }

  it('包围盒内换算 0–1', () => {
    expect(pointToBoundsRatio(60, 120, bounds)).toEqual({ nx: 0.5, ny: 0.5 })
  })

  it('越界或零尺寸返回 null', () => {
    expect(pointToBoundsRatio(5, 120, bounds)).toBeNull()
    expect(pointToBoundsRatio(60, 500, bounds)).toBeNull()
    expect(pointToBoundsRatio(60, 120, { x: 0, y: 0, width: 0, height: 0 })).toBeNull()
  })
})

describe('stripTimestamps', () => {
  it('去掉方括号里的时间与日期', () => {
    expect(stripTimestamps('[14:57] 哼，才不是呢')).toBe('哼，才不是呢')
    expect(stripTimestamps('【2026-11-05 14:57:16】你回来了')).toBe('你回来了')
    expect(stripTimestamps('(22:04) 别闹啦')).toBe('别闹啦')
    expect(stripTimestamps('[2026-11-05] 今天也要好好干')).toBe('今天也要好好干')
  })

  it('去掉行首行尾的裸时间戳与 ISO 时间', () => {
    expect(stripTimestamps('14:57:16 别乱戳')).toBe('别乱戳')
    expect(stripTimestamps('别乱戳 14:57')).toBe('别乱戳')
    expect(stripTimestamps('2026-11-05T14:57:16Z 又来了')).toBe('又来了')
  })

  it('句子中间的时间不动', () => {
    expect(stripTimestamps('都已经 3:00 了还不睡觉')).toBe('都已经 3:00 了还不睡觉')
  })

  it('只有时间戳时不把台词删空', () => {
    expect(stripTimestamps('[14:57]')).toBe('[14:57]')
    expect(stripTimestamps('')).toBe('')
  })

})

describe('部位自定义交互（ADR-038）', () => {
  it('归一化：去空名、去重、夹时长、限量', () => {
    const list = normalizeInteractions([
      { name: '抚摸', trigger: 'hold', holdMs: 20 },
      { name: '', trigger: 'tap' },
      { name: '抚摸', trigger: 'hold' },
      { name: '捏脸', trigger: '什么鬼' },
      { name: '弹一下', trigger: 'double', holdMs: 999999 },
      ...Array.from({ length: 10 }, (_, index) => ({ name: `多余${index}`, trigger: 'tap' })),
    ])
    expect(list.length).toBe(MAX_INTERACTIONS_PER_PART)
    expect(list[0]).toMatchObject({ name: '抚摸', trigger: 'hold', holdMs: TOUCH_HOLD_LIMITS.min })
    expect(list[1]).toMatchObject({ name: '捏脸', trigger: 'tap' })
    expect(list[2]).toMatchObject({ name: '弹一下', trigger: 'double', holdMs: TOUCH_HOLD_LIMITS.max })
    expect(new Set(list.map((item) => item.id)).size).toBe(list.length)
  })

  it('部位归一化保留 interactions，空表不写字段', () => {
    const parts = normalizeTouchParts([
      { id: 'face', name: '脸', boxes: [{ left: 0.1, top: 0.1, right: 0.2, bottom: 0.2 }], interactions: [{ name: '抚摸', trigger: 'hold' }] },
      { id: 'hip', name: '臀', boxes: [] },
    ])
    expect(parts[0].interactions?.[0]).toMatchObject({ name: '抚摸', trigger: 'hold', holdMs: TOUCH_HOLD_DEFAULT_MS })
    expect(parts[1].interactions).toBeUndefined()
  })

})
