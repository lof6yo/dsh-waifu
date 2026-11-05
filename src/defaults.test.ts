/**
 * 默认值单一来源一致性（C4）：schema 默认 ≈ defaults.ts ≈ 设置页兜底。
 * 防止「改了一处忘了另一处」——历史上默认尺寸就曾出现 schema/客户端/持久化三处不同。
 */
import { describe, expect, it } from 'vitest'
import { Config } from './index.ts'
import { DEFAULT_SETTINGS } from './defaults.ts'

describe('默认值一致性', () => {
  // Schema 的解析结果与 Config 结构化类型不完全一致（schemastery 返回 any），这里按记录读
  const resolved = (Config as unknown as (value: unknown) => Record<string, unknown>)({})

  it('Config schema 的标量默认值与 DEFAULT_SETTINGS 一致', () => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      expect(resolved[key], `schema 默认 ${key}`).toBe(value)
    }
  })

  it('model 默认取内置 preset 的默认模型（非空字符串）', () => {
    expect(typeof resolved.model).toBe('string')
    expect((resolved.model as string).length).toBeGreaterThan(0)
  })

  it('尺寸/留白/位置的默认值互相自洽', () => {
    expect(DEFAULT_SETTINGS.size).toBeGreaterThanOrEqual(40)
    expect(DEFAULT_SETTINGS.size).toBeLessThanOrEqual(400)
    expect(DEFAULT_SETTINGS.homeRight).toBeGreaterThanOrEqual(0)
    expect(DEFAULT_SETTINGS.homeRight).toBeLessThanOrEqual(100)
    expect(DEFAULT_SETTINGS.homeBottom).toBeGreaterThanOrEqual(0)
    expect(DEFAULT_SETTINGS.homeBottom).toBeLessThanOrEqual(100)
  })
})
