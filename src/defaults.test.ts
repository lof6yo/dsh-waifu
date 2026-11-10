/**
 * 默认值单一来源一致性（C4）：schema 默认 ≈ defaults.ts ≈ 设置页兜底。
 * 防止「改了一处忘了另一处」——历史上默认尺寸就曾出现 schema/客户端/持久化三处不同。
 */
import { describe, expect, it } from 'vitest'
import { Config } from './index.ts'
import {
  BAR_AUTO_HIDE_LIMITS,
  DEFAULT_BAR_AUTO_HIDE_SEC,
  DEFAULT_SETTINGS,
  DEFAULT_TTS_MODEL,
  DEFAULT_TTS_VOICE,
  TRIGGER_EVENTS,
  TTS_MODELS,
  TTS_STYLE_MAX_CHARS,
  normalizeBarAutoHideSec,
  normalizeTtsStyle,
  ttsDefaultVoice,
  ttsModelProvider,
  ttsModelRandomVoice,
} from './defaults.ts'

describe('默认值一致性', () => {
  // Schema 的解析结果与 Config 结构化类型不完全一致（schemastery 返回 any），这里按记录读
  const resolved = (Config as unknown as (value: unknown) => Record<string, unknown>)({})

  it('Config schema 的标量默认值与 DEFAULT_SETTINGS 一致', () => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      // eventTriggers 不进 cordis schema（解析对象不带该键），由 Host baseSettings 用
      // defaultEventTriggers() 生成——单独断言其形状，避免「schema 里查不到」的假失败。
      if (key === 'eventTriggers') {
        expect(Object.keys(value as Record<string, boolean>).sort()).toEqual(
          [...TRIGGER_EVENTS].sort(),
        )
        continue
      }
      // eventTexts / motionTexts / expressionTexts 同理：覆写表由用户填写，schema 里没有该键
      if (key === 'eventTexts' || key === 'motionTexts' || key === 'expressionTexts' || key === 'motionEnabled') {
        expect(value).toEqual({})
        continue
      }
      // expressionEnabled 有内置默认（羞愤默认不发给模型），同样不进 schema，单独校验
      if (key === 'expressionEnabled') {
        expect(value).toEqual({ blood: false })
        continue
      }
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

describe('交互条自动隐藏（ADR-053）', () => {
  it('默认 10 秒；非法值回退默认，越界夹取', () => {
    expect(DEFAULT_SETTINGS.barAutoHideSec).toBe(DEFAULT_BAR_AUTO_HIDE_SEC)
    expect(DEFAULT_BAR_AUTO_HIDE_SEC).toBe(10)
    expect(normalizeBarAutoHideSec(30, DEFAULT_BAR_AUTO_HIDE_SEC)).toBe(30)
    expect(normalizeBarAutoHideSec(0, DEFAULT_BAR_AUTO_HIDE_SEC)).toBe(0)
    expect(normalizeBarAutoHideSec('nope', DEFAULT_BAR_AUTO_HIDE_SEC)).toBe(DEFAULT_BAR_AUTO_HIDE_SEC)
    expect(normalizeBarAutoHideSec(-5, DEFAULT_BAR_AUTO_HIDE_SEC)).toBe(BAR_AUTO_HIDE_LIMITS.min)
    expect(normalizeBarAutoHideSec(99999, DEFAULT_BAR_AUTO_HIDE_SEC)).toBe(BAR_AUTO_HIDE_LIMITS.max)
  })
})

describe('语音模型目录（ADR-033 修订）', () => {
  it('默认模型在目录里，且默认音色属于它', () => {
    const model = TTS_MODELS.find((item) => item.id === DEFAULT_TTS_MODEL)
    expect(model, '默认模型必须在目录里').toBeTruthy()
    expect(model!.voices.some((voice) => voice.id === DEFAULT_TTS_VOICE)).toBe(true)
    expect(ttsModelRandomVoice(DEFAULT_TTS_MODEL)).toBe(false)
    expect(model!.voices.some((voice) => voice.id === DEFAULT_TTS_VOICE)).toBe(true)
  })

  it('目录含通义千问 Plus / Flash 与小米 MiMo，且每个模型都有音色', () => {
    expect(TTS_MODELS.map((item) => item.id)).toEqual([
      'qwen/qwen-audio-3.0-tts-plus',
      'qwen/qwen-audio-3.0-tts-flash',
      'mimo-v2.5-tts',
    ])
    for (const model of TTS_MODELS) {
      expect(model.voices.length, `${model.id} 至少一个音色`).toBeGreaterThan(0)
      expect(model.randomVoice, `${model.id} 不应标随机音色`).toBeFalsy()
    }
  })

  it('目录模型能查到供应商：qwen 走 openrouter、MiMo 走 mimo（ADR-061）', () => {
    expect(ttsModelProvider('qwen/qwen-audio-3.0-tts-flash')).toBe('openrouter')
    expect(ttsModelProvider('mimo-v2.5-tts')).toBe('mimo')
    // 目录外的老配置仍按 openrouter 处理（保持原行为）
    expect(ttsModelProvider('fish-audio/drama-3')).toBe('openrouter')
  })

  it('风格指令归一化：去空白、截断、非法值回退（ADR-061）', () => {
    expect(normalizeTtsStyle('  温柔、语速稍慢  ', '')).toBe('温柔、语速稍慢')
    expect(normalizeTtsStyle(undefined, '')).toBe('')
    expect(normalizeTtsStyle(42, '')).toBe('')
    expect(normalizeTtsStyle('啊'.repeat(500), '')).toHaveLength(TTS_STYLE_MAX_CHARS)
    expect(DEFAULT_SETTINGS.ttsStyle).toBe('')
  })

  it('音色 id 在目录内不重复', () => {
    for (const model of TTS_MODELS) {
      const ids = model.voices.map((voice) => voice.id)
      expect(new Set(ids).size, `${model.id} 音色去重`).toBe(ids.length)
    }
  })

  it('ttsDefaultVoice 取首个音色；目录外模型返回空串', () => {
    expect(ttsDefaultVoice(DEFAULT_TTS_MODEL)).toBe(
      TTS_MODELS.find((item) => item.id === DEFAULT_TTS_MODEL)!.voices[0].id,
    )
    expect(ttsDefaultVoice('fish-audio/drama-3')).toBe('')
    expect(ttsDefaultVoice('unknown/model')).toBe('')
  })
})
