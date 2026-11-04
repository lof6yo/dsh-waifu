import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TouchPartsStore, TOUCH_PARTS_FILENAME } from './touch-parts.ts'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-live2d-pet-parts-'))
  process.env.DSH_HOME = home
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

describe('TouchPartsStore', () => {
  it('首次构造落地模板文件，partsFor 返回 null 表示未保存', () => {
    const store = new TouchPartsStore()
    expect(store.path).toBe(join(home, 'live2d-pet', TOUCH_PARTS_FILENAME))
    expect(store.load().models).toEqual({})
    expect(store.partsFor('jian')).toBeNull()
    expect(readFileSync(store.path, 'utf8')).toContain('触摸部位配置文件')
  })

  it('save 后按模型读回并写回文件（保留注释头）', () => {
    const store = new TouchPartsStore()
    const parts = [{
      id: 'head',
      name: '头',
      boxes: [{ left: 0.1, top: 0.05, right: 0.9, bottom: 0.7 }],
      motions: ['TapHead'],
    }]
    store.save('jian', parts)
    expect(store.partsFor('jian')).toEqual(parts)
    expect(store.partsFor('other')).toBeNull()
    const text = readFileSync(store.path, 'utf8')
    expect(text).toContain('触摸部位配置文件')
    expect(text).toContain('"jian"')
  })

  it('保存时归一化非法 box / 多余字段', () => {
    const store = new TouchPartsStore()
    store.save('jian', [
      { id: 'a', name: ' A ', boxes: [{ left: 1.5, top: -1, right: 0.5, bottom: 2 }], motions: ['X'] },
    ] as never)
    const parts = store.partsFor('jian')
    expect(parts).toEqual([{ id: 'a', name: 'A', boxes: [{ left: 0.5, top: 0, right: 1, bottom: 1 }], motions: ['X'] }])
  })

  it('文件损坏时沿用上次好结果并给出错误', () => {
    const store = new TouchPartsStore()
    store.save('jian', [{ id: 'x', name: 'X', boxes: [{ left: 0, top: 0, right: 0.2, bottom: 0.2 }], motions: [] }])
    writeFileSync(store.path, '{ broken jsonc', 'utf8')
    const view = store.load()
    expect(view.error).toContain('解析失败')
    expect(view.models.jian?.parts[0].name).toBe('X')
  })

  it('保存事件绑定覆盖层（动画组 + 台词池），并与部位一起读回', () => {
    const store = new TouchPartsStore()
    store.save('jian', [], {
      idle: { motions: ['Idle'], lines: [['在的。']] },
      thinking: { motions: ['Thinking', 'TapHead'], lines: [['想…'], ['还在想…']] },
      bogus: { motions: ['X'], lines: [] },
    } as never)
    const events = store.load().models.jian?.events
    expect(events?.idle).toEqual({ motions: ['Idle'], lines: [['在的。']] })
    expect(events?.thinking?.motions).toEqual(['Thinking', 'TapHead'])
    expect(events?.thinking?.lines).toEqual([['想…'], ['还在想…']])
    expect(events && 'bogus' in events).toBe(false)
  })

  it('events 传 undefined 保留已有覆盖，传 {} 清空覆盖', () => {
    const store = new TouchPartsStore()
    store.save('jian', [], { idle: { motions: ['Idle'], lines: [] } })
    store.save('jian', [], undefined)
    expect(store.load().models.jian?.events?.idle?.motions).toEqual(['Idle'])
    store.save('jian', [], {})
    expect(store.load().models.jian?.events).toBeUndefined()
  })

  it('model id 为空时 save 抛错', () => {
    const store = new TouchPartsStore()
    expect(() => store.save('  ', [])).toThrow()
  })
})
