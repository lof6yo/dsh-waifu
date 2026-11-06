import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TouchPartsStore, TOUCH_PARTS_FILENAME } from './touch-parts.ts'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-waifu-parts-'))
  process.env.DSH_HOME = home
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

describe('TouchPartsStore', () => {
  it('首次构造落地模板文件，partsFor 返回 null 表示未保存', () => {
    const store = new TouchPartsStore()
    expect(store.path).toBe(join(home, 'waifu', TOUCH_PARTS_FILENAME))
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
    }]
    store.save('jian', parts)
    expect(store.partsFor('jian')).toEqual(parts)
    expect(store.partsFor('other')).toBeNull()
    const text = readFileSync(store.path, 'utf8')
    expect(text).toContain('触摸部位配置文件')
    expect(text).toContain('"jian"')
  })

  it('保存时归一化非法 box / 多余字段（ADR-037：旧 motions/lines 被剥掉）', () => {
    const store = new TouchPartsStore()
    store.save('jian', [
      { id: 'a', name: ' A ', boxes: [{ left: 1.5, top: -1, right: 0.5, bottom: 2 }], motions: ['X'], lines: ['旧台词'] },
    ] as never)
    const parts = store.partsFor('jian')
    expect(parts).toEqual([{ id: 'a', name: 'A', boxes: [{ left: 0.5, top: 0, right: 1, bottom: 1 }] }])
  })

  it('文件损坏时沿用上次好结果并给出错误', () => {
    const store = new TouchPartsStore()
    store.save('jian', [{ id: 'x', name: 'X', boxes: [{ left: 0, top: 0, right: 0.2, bottom: 0.2 }] }])
    writeFileSync(store.path, '{ broken jsonc', 'utf8')
    const view = store.load()
    expect(view.error).toContain('解析失败')
    expect(view.models.jian?.parts[0].name).toBe('X')
  })

  it('旧版文件里带 motions/lines/events 的部位读入时被剥成 id/name/boxes', () => {
    const store = new TouchPartsStore()
    writeFileSync(store.path, JSON.stringify({
      version: 2,
      models: {
        jian: {
          parts: [
            { id: 'face', name: '脸', boxes: [{ left: 0, top: 0, right: 0.5, bottom: 0.5 }], motions: ['Tilt', 'blush'], lines: ['别捏脸'] },
          ],
          events: { idle: { motions: ['Idle'], lines: [['在的。']] } },
        },
      },
    }), 'utf8')
    const entry = store.load().models.jian
    expect(entry?.parts).toEqual([{ id: 'face', name: '脸', boxes: [{ left: 0, top: 0, right: 0.5, bottom: 0.5 }] }])
    expect(entry && 'events' in entry).toBe(false)
  })

  it('model id 为空时 save 抛错', () => {
    const store = new TouchPartsStore()
    expect(() => store.save('  ', [])).toThrow()
  })
})
