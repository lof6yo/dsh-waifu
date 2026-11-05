import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore, normalizeSettings, SETTINGS_FILENAME, type PetSettings } from './settings-store.ts'
import { DEFAULT_SETTINGS } from './defaults.ts'

const BASE: PetSettings = {
  enabled: true,
  size: 160,
  maxFps: 30,
  model: 'jian',
  developerMode: false,
  debug: false,
  showTapZones: false,
  canvasPadX: 130,
  canvasPadY: 70,
  homeRight: 16,
  homeBottom: 24,
  bubbleOffsetX: 0,
  bubbleOffsetY: 10,
  bubbleBgColor: '#ffffff',
  bubbleBgOpacity: 92,
  bubbleTextColor: '#222222',
  bubbleMaxSeconds: 30,
  aiEnabled: false,
  aiTouchOnly: false,
  aiTakeover: false,
  interactionMode: 'touch-first',
  aiProvider: 'deepseek-official',
  aiModel: 'deepseek-flash',
  aiHistoryCount: 10,
  thinkingAiDelay: 3,
  thinkingAiInterval: 20,
  thinkingAiMax: 3,
  waitingAiDelay: 4,
  waitingAiInterval: 30,
  waitingAiMax: 3,
  ttsEnabled: true,
  ttsEngine: 'openrouter',
  ttsModel: 'microsoft/mai-voice-2.1-flash',
  ttsVoice: 'zh-CN-Mei:MAI-Voice-2.1-Flash',
  ttsInstructions: 'test',
  lipsyncEnabled: true,
  lipsyncGain: 100,
}

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-waifu-settings-'))
  process.env.DSH_HOME = home
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

describe('normalizeSettings', () => {
  it('非法值回退 base，合法值收敛', () => {
    const v = normalizeSettings({
      enabled: 'yes',
      size: 9999,
      maxFps: 45,
      model: '  custom-a  ',
      debug: true,
    }, BASE)
    expect(v.enabled).toBe(true)
    expect(v.size).toBe(400)
    expect(v.maxFps).toBe(30)
    expect(v.model).toBe('custom-a')
    expect(v.debug).toBe(true)
  })

  it('气泡颜色/透明度/偏移的非法值回退 base，合法值收敛', () => {
    const v = normalizeSettings({
      bubbleBgColor: '#FFAA00',
      bubbleTextColor: 'red',
      bubbleBgOpacity: 150,
      bubbleOffsetY: -99999,
    }, BASE)
    expect(v.bubbleBgColor).toBe('#ffaa00')
    expect(v.bubbleTextColor).toBe('#222222')
    expect(v.bubbleBgOpacity).toBe(100)
    // 无 version 字段按旧语义处理：垂直偏移取反后再 clamp 到 -1000–1000
    expect(v.bubbleOffsetY).toBe(1000)
  })

  it('size 低于下限夹到 40，maxFps 0 允许（不限制）', () => {
    const v = normalizeSettings({ size: 1, maxFps: 0 }, BASE)
    expect(v.size).toBe(40)
    expect(v.maxFps).toBe(0)
  })
})

describe('表情字段迁移（v4）', () => {
  it('旧版基础表情 / 强度字段被忽略，不再出现在结果里', () => {
    const value = normalizeSettings({
      version: 3,
      expression: 'angry',
      exprAngry: 140,
      exprAngry2: -5,
      exprCry: 33.6,
      exprEye: 'x',
    }, BASE)
    expect(value).toEqual({ ...BASE })
  })

  it('v3 文件的 home 百分比与气泡偏移不再被当成旧版语义', () => {
    const value = normalizeSettings({ version: 3, homeRight: 42, homeBottom: 30, bubbleOffsetY: 10 }, BASE)
    expect(value.homeRight).toBe(42)
    expect(value.homeBottom).toBe(30)
    expect(value.bubbleOffsetY).toBe(10)
  })
})

describe('SettingsStore', () => {
  it('首次落地模板文件并读取 base', () => {
    const store = new SettingsStore(BASE)
    expect(store.path).toBe(join(home, 'waifu', SETTINGS_FILENAME))
    expect(store.get()).toEqual(BASE)
    expect(readFileSync(store.path, 'utf8')).toContain('桌宠设置文件')
  })

  it('aiTakeover 默认关、可写、非法值回落 false', () => {
    const store = new SettingsStore(BASE)
    expect(store.get().aiTakeover).toBe(false)
    store.applyOps([{ op: 'set', path: ['aiTakeover'], value: true }])
    expect(store.get().aiTakeover).toBe(true)
    store.applyOps([{ op: 'set', path: ['aiTakeover'], value: 'yes' }])
    expect(store.get().aiTakeover).toBe(false)
  })

  it('interactionMode 默认触摸优先、可写、非法值回落默认（ADR-032）', () => {
    const store = new SettingsStore(BASE)
    expect(store.get().interactionMode).toBe('touch-first')
    store.applyOps([{ op: 'set', path: ['interactionMode'], value: 'event-first' }])
    expect(store.get().interactionMode).toBe('event-first')
    store.applyOps([{ op: 'set', path: ['interactionMode'], value: 'mutual' }])
    expect(store.get().interactionMode).toBe('mutual')
    store.applyOps([{ op: 'set', path: ['interactionMode'], value: 'nonsense' }])
    expect(store.get().interactionMode).toBe('touch-first')
  })

  it('aiTouchOnly 默认关、可写、非法值回落 false', () => {
    const store = new SettingsStore(BASE)
    expect(store.get().aiTouchOnly).toBe(false)
    store.applyOps([{ op: 'set', path: ['aiTouchOnly'], value: true }])
    expect(store.get().aiTouchOnly).toBe(true)
    store.applyOps([{ op: 'set', path: ['aiTouchOnly'], value: 'yes' }])
    expect(store.get().aiTouchOnly).toBe(false)
  })

  it('气泡最长显示：默认 30、可写、越界夹到 0–600（ADR-027）', () => {
    const store = new SettingsStore(BASE)
    expect(store.get().bubbleMaxSeconds).toBe(30)
    store.applyOps([{ op: 'set', path: ['bubbleMaxSeconds'], value: 0 }])
    expect(store.get().bubbleMaxSeconds).toBe(0)
    store.applyOps([{ op: 'set', path: ['bubbleMaxSeconds'], value: 9999 }])
    expect(store.get().bubbleMaxSeconds).toBe(600)
    store.applyOps([{ op: 'set', path: ['bubbleMaxSeconds'], value: 'long' }])
    expect(store.get().bubbleMaxSeconds).toBe(30)
  })

  it('长状态 AI 节奏：默认值、可写、越界夹到区间（ADR-026）', () => {
    const store = new SettingsStore(BASE)
    expect(store.get().thinkingAiDelay).toBe(3)
    expect(store.get().thinkingAiInterval).toBe(20)
    expect(store.get().waitingAiMax).toBe(3)
    store.applyOps([
      { op: 'set', path: ['thinkingAiDelay'], value: 999 },
      { op: 'set', path: ['waitingAiInterval'], value: 1 },
      { op: 'set', path: ['waitingAiMax'], value: 7 },
    ])
    expect(store.get().thinkingAiDelay).toBe(120)
    expect(store.get().waitingAiInterval).toBe(5)
    expect(store.get().waitingAiMax).toBe(7)
    store.applyOps([{ op: 'set', path: ['thinkingAiMax'], value: 'many' }])
    expect(store.get().thinkingAiMax).toBe(3)
  })

  it('applyOps 写回并返回最新视图', () => {
    const store = new SettingsStore(BASE)
    const view = store.applyOps([
      { op: 'set', path: ['size'], value: 240 },
      { op: 'set', path: ['enabled'], value: false },
    ])
    expect(view.value.size).toBe(240)
    expect(view.value.enabled).toBe(false)
    expect(store.get().size).toBe(240)
    // 未知路径与非法值被忽略
    store.applyOps([{ op: 'set', path: ['nope'], value: 1 }])
    store.applyOps([{ op: 'set', path: ['maxFps'], value: 45 }])
    expect(store.get().maxFps).toBe(30)
  })

  it('旧版设置文件（无 version）的 home 语义迁移到新默认（中心点距右/距下）', () => {
    const store = new SettingsStore(BASE)
    writeFileSync(store.path, JSON.stringify({
      enabled: true,
      size: 200,
      maxFps: 60,
      model: 'jian',
      developerMode: false,
      debug: false,
      showTapZones: false,
      canvasPadX: 130,
      canvasPadY: 70,
      homeRight: 24,
      homeBottom: 20,
    }), 'utf8')
    const view = store.view()
    expect(view.value.homeRight).toBe(BASE.homeRight)
    expect(view.value.homeBottom).toBe(BASE.homeBottom)
    expect(view.value.size).toBe(200)
  })

  it('新版本设置文件的 home 值原样保留（0–100 百分比）', () => {
    const store = new SettingsStore(BASE)
    store.applyOps([
      { op: 'set', path: ['homeRight'], value: 42 },
      { op: 'set', path: ['homeBottom'], value: 30 },
    ])
    const view = store.view()
    expect(view.value.homeRight).toBe(42)
    expect(view.value.homeBottom).toBe(30)
    // 百分比上限 100
    store.applyOps([{ op: 'set', path: ['homeRight'], value: 420 }])
    expect(store.view().value.homeRight).toBe(100)
  })

  it('v2 设置迁移到 v3：home 回退默认百分比，气泡垂直偏移取反以保持观感', () => {
    const store = new SettingsStore(BASE)
    const raw = {
      version: 2,
      enabled: true,
      size: 200,
      maxFps: 30,
      homeRight: 300,
      homeBottom: 260,
      bubbleOffsetY: -10,
      bubbleBgColor: '#ffffff',
    }
    writeFileSync(store.path, JSON.stringify(raw), 'utf8')
    const view = store.view()
    expect(view.value.homeRight).toBe(BASE.homeRight)
    expect(view.value.homeBottom).toBe(BASE.homeBottom)
    expect(view.value.bubbleOffsetY).toBe(10)
    expect(view.value.size).toBe(200)
  })

  it('文件损坏时沿用上次好结果并报错', () => {
    const store = new SettingsStore(BASE)
    store.applyOps([{ op: 'set', path: ['size'], value: 200 }])
    writeFileSync(store.path, '{ bad', 'utf8')
    const view = store.view()
    expect(view.error).toContain('解析失败')
    expect(view.value.size).toBe(200)
  })
})

describe('SettingsStore 读取缓存（B1）', () => {
  it('文件没变时不重复解析，文件变了立刻重读', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-waifu-cache-'))
    try {
    const path = join(dir, 'settings.jsonc')
    const store = new SettingsStore({ ...BASE, ...DEFAULT_SETTINGS, model: 'jian' }, path)
    const first = store.get()
    expect(first.size).toBe(DEFAULT_SETTINGS.size)
    // 外部改文件（模拟设置页之外的编辑）→ 时间戳变化后必须重读
    writeFileSync(path, JSON.stringify({ ...DEFAULT_SETTINGS, size: 321 }), 'utf8')
    expect(store.get().size).toBe(321)
    // 再读一次（文件未变）走缓存，值保持一致
    expect(store.get().size).toBe(321)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('注入历史条数（ADR-030）', () => {
  it('默认 10；越界夹到 0–50；非法值回退 base', () => {
    expect(normalizeSettings({}, BASE).aiHistoryCount).toBe(BASE.aiHistoryCount)
    expect(normalizeSettings({ aiHistoryCount: 25 }, BASE).aiHistoryCount).toBe(25)
    expect(normalizeSettings({ aiHistoryCount: 999 }, BASE).aiHistoryCount).toBe(50)
    expect(normalizeSettings({ aiHistoryCount: -3 }, BASE).aiHistoryCount).toBe(0)
    expect(normalizeSettings({ aiHistoryCount: 'abc' }, BASE).aiHistoryCount).toBe(BASE.aiHistoryCount)
    expect(BASE.aiHistoryCount).toBe(10)
  })
})

describe('normalizeSettings · 语音（ADR-033）', () => {
  it('默认值与可写字段', () => {
    const base = normalizeSettings({}, BASE)
    expect(base.ttsEnabled).toBe(true)
    expect(base.ttsModel).toBe('microsoft/mai-voice-2.1-flash')
    expect(base.ttsVoice).toBe('zh-CN-Mei:MAI-Voice-2.1-Flash')
    expect(base.lipsyncEnabled).toBe(true)
    expect(base.lipsyncGain).toBe(100)
    const custom = normalizeSettings({ ttsModel: 'x/y', ttsVoice: 'voice-1', lipsyncGain: 240 }, BASE)
    expect(custom.ttsModel).toBe('x/y')
    expect(custom.ttsVoice).toBe('voice-1')
    expect(custom.lipsyncGain).toBe(240)
  })

  it('口型强度越界夹取，非法值回落 base', () => {
    expect(normalizeSettings({ lipsyncGain: 999 }, BASE).lipsyncGain).toBe(300)
    expect(normalizeSettings({ lipsyncGain: -5 }, BASE).lipsyncGain).toBe(0)
    expect(normalizeSettings({ lipsyncGain: 'abc' }, BASE).lipsyncGain).toBe(BASE.lipsyncGain)
  })

  it('音色与演绎指令允许空串（空 = 模型默认音色）', () => {
    const value = normalizeSettings({ ttsVoice: '   ', ttsInstructions: '' }, BASE)
    expect(value.ttsVoice).toBe('')
    expect(value.ttsInstructions).toBe('')
  })

  it('v4 及更早的「随机音色模型 + 空音色」迁移到音色固定的默认模型', () => {
    const legacy = normalizeSettings({ version: 4, ttsModel: 'fish-audio/drama-3', ttsVoice: '' }, BASE)
    expect(legacy.ttsModel).toBe(BASE.ttsModel)
    expect(legacy.ttsVoice).toBe(BASE.ttsVoice)
  })

  it('已选过音色或别的固定音色模型时原样保留', () => {
    const pinned = normalizeSettings({ version: 4, ttsModel: 'fish-audio/drama-3', ttsVoice: 'alloy' }, BASE)
    expect(pinned.ttsModel).toBe('fish-audio/drama-3')
    expect(pinned.ttsVoice).toBe('alloy')
    const own = normalizeSettings({ version: 4, ttsModel: 'hexgrad/kokoro-82m', ttsVoice: '' }, BASE)
    expect(own.ttsModel).toBe('hexgrad/kokoro-82m')
    expect(own.ttsVoice).toBe('')
  })

  it('已是新版本的文件不再迁移（用户自己切回 Drama 3 时保持原样）', () => {
    const current = normalizeSettings({ version: 5, ttsModel: 'fish-audio/drama-3', ttsVoice: '' }, BASE)
    expect(current.ttsModel).toBe('fish-audio/drama-3')
    expect(current.ttsVoice).toBe('')
  })
})
