/**
 * 默认值单一来源一致性（C4）：schema 默认 ≈ defaults.ts ≈ 设置页兜底。
 * 防止「改了一处忘了另一处」——历史上默认尺寸就曾出现 schema/客户端/持久化三处不同。
 */
import { describe, expect, it } from 'vitest'
import { Config } from './index.ts'
import {
  DEFAULT_SETTINGS,
  DEFAULT_TTS_MODEL,
  DEFAULT_TTS_VOICE,
  TTS_MODELS,
  ttsDefaultVoice,
  ttsModelRandomVoice,
} from './defaults.ts'

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

describe('语音模型目录（ADR-033 修订）', () => {
  it('默认音色属于默认模型，且默认模型不是随机音色', () => {
    const model = TTS_MODELS.find((item) => item.id === DEFAULT_TTS_MODEL)
    expect(model, '默认模型必须在目录里').toBeTruthy()
    expect(model?.randomVoice).not.toBe(true)
    expect(model?.voices.some((voice) => voice.id === DEFAULT_TTS_VOICE)).toBe(true)
    expect(ttsModelRandomVoice(DEFAULT_TTS_MODEL)).toBe(false)
  })

  it('随机音色模型不提供音色列表；固定音色模型的音色 id 不重复', () => {
    for (const model of TTS_MODELS) {
      const ids = model.voices.map((voice) => voice.id)
      expect(new Set(ids).size, `${model.id} 音色去重`).toBe(ids.length)
      if (model.randomVoice) expect(ids, `${model.id} 随机音色不应列音色`).toHaveLength(0)
      else expect(ids.length, `${model.id} 至少一个音色`).toBeGreaterThan(0)
    }
  })

  it('ttsDefaultVoice 取首个音色；随机音色模型返回空串', () => {
    expect(ttsDefaultVoice(DEFAULT_TTS_MODEL)).toBe(DEFAULT_TTS_VOICE)
    expect(ttsDefaultVoice('fish-audio/drama-3')).toBe('')
    expect(ttsDefaultVoice('unknown/model')).toBe('')
  })
})
