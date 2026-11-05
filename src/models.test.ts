import { describe, expect, it } from 'vitest'
import {
  listBuiltinPresets,
  resolveModelUrl,
  resolveDefaultTouchParts,
  resolveMotionMap,
  defaultModelId,
} from './models-host.ts'
import {
  DEFAULT_EVENT_BINDINGS,
  DEFAULT_MOTION_MAP,
  EVENT_STAGE_DELAYS,
  EXPRESSIONS,
  EXPRESSION_IDS,
  EXPRESSION_SWITCH_PARAMS,
  isExpressionId,
  joinMotionSelection,
  normalizeExpressionId,
  normalizeMotionSelection,
  splitMotionSelection,
  hitTestTouchParts,
  mergeEventBindings,
  normalizeEventBindings,
  normalizeTouchBox,
  normalizeTouchParts,
  pointToBoundsRatio,
  type TouchPart,
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

  it('内置模型带状态动画映射与默认触摸部位', () => {
    const jian = listBuiltinPresets()[0]
    expect(jian.animationMap?.idle).toEqual(['Idle'])
    expect(jian.animationMap?.thinking).toEqual(['Tilt'])
    expect(jian.animationMap?.error).toEqual(['ShakeHead', 'angry'])
    expect(jian.animationMap?.done).toEqual(['star'])
    expect(jian.animationMap?.waiting).toEqual(['Sway'])
    expect(jian.animationMap?.delivered).toEqual(['heart'])
    expect(jian.touchParts?.map((p) => p.name)).toEqual(['脸', '头发', '胸', '臀', '腰', '大腿', '手', '小腿', '脚'])
    expect(jian.touchParts?.map((p) => p.motions)).toEqual([
      ['blush'], [], [], [], [], [], [], [], [],
    ])
    expect(resolveDefaultTouchParts('jian').length).toBe(9)
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

describe('resolveMotionMap', () => {
  it('无配置时返回默认映射', () => {
    expect(resolveMotionMap('custom-missing')).toEqual(DEFAULT_MOTION_MAP)
  })


  it('内置 presets 的 animationMap 生效', () => {
    const map = resolveMotionMap('jian')
    expect(map.idle).toEqual(['Idle'])
    expect(map.thinking).toEqual(['Tilt'])
    expect(map.error).toEqual(['ShakeHead', 'angry'])
    expect(map.delivered).toEqual(['heart'])
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
  it('丢弃无名部位、去重 id、限制 motion 去重', () => {
    const parts = normalizeTouchParts([
      { id: 'head', name: '头', boxes: [{ left: 0, top: 0, right: 0.5, bottom: 0.5 }], motions: ['TapHead', 'TapHead'] },
      { id: 'head', name: '头2', boxes: [], motions: [] },
      { name: '   ', boxes: [] },
      { name: '手', boxes: [] },
    ])
    expect(parts.map((p) => p.name)).toEqual(['头', '头2', '手'])
    expect(parts[0].motions).toEqual(['TapHead'])
    expect(parts[1].id).not.toBe(parts[0].id)
  })
})

describe('hitTestTouchParts（按图层，parts[0] 最上层）', () => {
  // 默认顺序：脸在最上层、头其次、身体最底层（与 presets.jsonc 一致）
  const parts: TouchPart[] = [
    { id: 'face', name: '脸', boxes: [{ left: 0.3, top: 0.3, right: 0.7, bottom: 0.7 }], motions: [] },
    { id: 'head', name: '头', boxes: [{ left: 0.1, top: 0.0, right: 0.9, bottom: 0.8 }], motions: [] },
  ]

  it('命中部位返回该部位', () => {
    expect(hitTestTouchParts(parts, 0.2, 0.1)?.id).toBe('head')
  })

  it('重叠时上层部位优先（与 box 面积无关）', () => {
    expect(hitTestTouchParts(parts, 0.5, 0.5)?.id).toBe('face')
    // 上层是大 box 时同样优先于下层小 box
    const bigOnTop: TouchPart[] = [
      { id: 'big', name: '大', boxes: [{ left: 0, top: 0, right: 1, bottom: 1 }], motions: [] },
      { id: 'small', name: '小', boxes: [{ left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 }], motions: [] },
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
      motions: [],
    }]
    expect(hitTestTouchParts(multi, 0.1, 0.1)?.id).toBe('p')
    expect(hitTestTouchParts(multi, 0.9, 0.9)?.id).toBe('p')
    expect(hitTestTouchParts(multi, 0.5, 0.5)).toBeNull()
  })
})

describe('EventBindings（事件绑定）', () => {
  it('默认事件绑定覆盖 6 个事件，长状态有 3 阶段台词', () => {
    expect(Object.keys(DEFAULT_EVENT_BINDINGS).sort()).toEqual(
      ['delivered', 'done', 'error', 'idle', 'thinking', 'waiting'],
    )
    expect(DEFAULT_EVENT_BINDINGS.thinking.lines.length).toBe(3)
    expect(DEFAULT_EVENT_BINDINGS.waiting.lines.length).toBe(3)
    expect(DEFAULT_EVENT_BINDINGS.idle.lines.length).toBe(1)
    expect(EVENT_STAGE_DELAYS.thinking).toEqual([0, 15000, 40000])
    expect(EVENT_STAGE_DELAYS.waiting).toEqual([0, 30000, 90000])
  })

  it('normalizeEventBindings 只保留合法事件/清洗台词/最多 3 阶段', () => {
    const events = normalizeEventBindings({
      idle: { motions: ['Idle', 'Idle', ''], lines: [[' 在的。 ', '在的。', '   ']] },
      thinking: { motions: [], lines: [['a'], ['b'], ['c'], ['d']] },
      bogus: { motions: ['X'], lines: [] },
    })
    expect(events.idle?.motions).toEqual(['Idle'])
    expect(events.idle?.lines).toEqual([['在的。']])
    expect(events.thinking?.lines).toEqual([['a'], ['b'], ['c']])
    expect(events && 'bogus' in events).toBe(false)
  })

  it('mergeEventBindings 整事件替换，未覆盖事件沿用默认', () => {
    const merged = mergeEventBindings(DEFAULT_EVENT_BINDINGS, {
      thinking: { motions: ['TapHead'], lines: [['自定台词']] },
    })
    expect(merged.thinking.motions).toEqual(['TapHead'])
    expect(merged.thinking.lines).toEqual([['自定台词']])
    expect(merged.idle).toBe(DEFAULT_EVENT_BINDINGS.idle)
    expect(merged.error).toBe(DEFAULT_EVENT_BINDINGS.error)
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
  })

  it('normalizeExpressionId 未知 id 回退 none', () => {
    expect(normalizeExpressionId('blush')).toBe('blush')
    expect(normalizeExpressionId('  angry ')).toBe('angry')
    expect(normalizeExpressionId('bogus')).toBe('none')
    expect(normalizeExpressionId(undefined)).toBe('none')
  })

  it('旧版 expression 字段并入 motions 混选，未知表情被丢弃', () => {
    const events = normalizeEventBindings({
      error: { motions: [], lines: [['啊']], expression: 'angry' },
      done: { motions: [], lines: [['好']], expression: 'bogus' },
    })
    expect(events.error?.motions).toEqual(['angry'])
    expect(events.done?.motions).toEqual([])
    const parts = normalizeTouchParts([
      { id: 'head', name: '头', boxes: [], motions: [], expression: 'star' },
      { id: 'hand', name: '手', boxes: [], motions: [], expression: 'nope' },
    ])
    expect(parts[0].motions).toEqual(['star'])
    expect(parts[1].motions).toEqual([])
  })

  it('默认事件绑定：动作组与表情混在同一条目里', () => {
    expect(DEFAULT_EVENT_BINDINGS.error.motions).toEqual(['ShakeHead', 'angry'])
    expect(DEFAULT_EVENT_BINDINGS.done.motions).toEqual(['star'])
    expect(DEFAULT_EVENT_BINDINGS.delivered.motions).toEqual(['heart'])
  })

  it('isExpressionId 只认注册表里的表情', () => {
    expect(isExpressionId('blush')).toBe(true)
    expect(isExpressionId(' angry ')).toBe(true)
    expect(isExpressionId('Idle')).toBe(false)
    expect(EXPRESSION_IDS).not.toContain('none')
  })

  it('混选拆解：最多 1 个动作组 + 1 个表情，顺序固定', () => {
    expect(splitMotionSelection(['Tilt', 'angry'])).toEqual({ motion: 'Tilt', expression: 'angry' })
    expect(splitMotionSelection(['angry', 'Tilt'])).toEqual({ motion: 'Tilt', expression: 'angry' })
    expect(splitMotionSelection(['Tilt', 'Sway', 'angry', 'blush'])).toEqual({ motion: 'Tilt', expression: 'blush' })
    expect(splitMotionSelection([])).toEqual({ motion: '', expression: 'none' })
    expect(joinMotionSelection('Sway', 'none')).toEqual(['Sway'])
    expect(joinMotionSelection('', 'heart')).toEqual(['heart'])
    expect(joinMotionSelection('', 'none')).toEqual([])
  })

  it('normalizeMotionSelection 收敛旧数组（多余项/重复项被裁掉）', () => {
    expect(normalizeMotionSelection(['Tilt', 'Idle', 'angry'])).toEqual(['Tilt', 'angry'])
    expect(normalizeMotionSelection(['angry', 'nope-expression'])).toEqual(['nope-expression', 'angry'])
    expect(normalizeMotionSelection('oops')).toEqual([])
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
