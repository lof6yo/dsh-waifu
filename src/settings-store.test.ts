import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore, normalizeSettings, SETTINGS_FILENAME, type PetSettings } from './settings-store.ts'
import { DEFAULT_SETTINGS, defaultEventTriggers, TRIGGER_EVENTS } from './defaults.ts'

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
  idleMotionEnabled: true,
  barPosition: 'bottom',
  barOffset: 0,
  aiProvider: 'deepseek-official',
  aiModel: 'deepseek-flash',
  aiHistoryCount: 10,
  aiMemoryCount: 20,
  triggerMode: 'interrupt',
  aiMinIntervalSec: 3,
  idleTimeoutSec: 300,
  activityWindowSec: 3,
  eventTriggers: defaultEventTriggers(),
  ttsEnabled: true,
  ttsEngine: 'openrouter',
  ttsModel: 'qwen/qwen-audio-3.0-tts-plus',
  ttsVoice: 'longanlingxin',
  lipsyncEnabled: true,
  lipsyncGain: 100,
  focusRange: 60,
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
      // ADR-037 前的旧字段也一并忽略（结果里没有位置）
      aiTouchOnly: true,
      aiTakeover: true,
      interactionMode: 'event-first',
      thinkingAiDelay: 9,
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

  it('触发节奏（ADR-037）：triggerMode 可写、非法值回落；最小间隔越界夹取', () => {
    const store = new SettingsStore(BASE)
    expect(store.get().triggerMode).toBe('interrupt')
    store.applyOps([{ op: 'set', path: ['triggerMode'], value: 'queue' }])
    expect(store.get().triggerMode).toBe('queue')
    store.applyOps([{ op: 'set', path: ['triggerMode'], value: 'nonsense' }])
    expect(store.get().triggerMode).toBe('interrupt')
    store.applyOps([{ op: 'set', path: ['aiMinIntervalSec'], value: 999 }])
    expect(store.get().aiMinIntervalSec).toBe(600)
    store.applyOps([{ op: 'set', path: ['aiMinIntervalSec'], value: 'soon' }])
    expect(store.get().aiMinIntervalSec).toBe(3)
  })

  it('静默超时与同类事件窗口可写、越界夹取（ADR-037）', () => {
    const store = new SettingsStore(BASE)
    expect(store.get().idleTimeoutSec).toBe(300)
    store.applyOps([{ op: 'set', path: ['idleTimeoutSec'], value: 0 }])
    expect(store.get().idleTimeoutSec).toBe(0)
    store.applyOps([{ op: 'set', path: ['idleTimeoutSec'], value: 99999 }])
    expect(store.get().idleTimeoutSec).toBe(3600)
    store.applyOps([{ op: 'set', path: ['activityWindowSec'], value: 999 }])
    expect(store.get().activityWindowSec).toBe(300)
  })

  it('注入记忆条数可写、越界夹取（ADR-037）', () => {
    const store = new SettingsStore(BASE)
    expect(store.get().aiMemoryCount).toBe(20)
    store.applyOps([{ op: 'set', path: ['aiMemoryCount'], value: 0 }])
    expect(store.get().aiMemoryCount).toBe(0)
    store.applyOps([{ op: 'set', path: ['aiMemoryCount'], value: 999 }])
    expect(store.get().aiMemoryCount).toBe(100)
    store.applyOps([{ op: 'set', path: ['aiMemoryCount'], value: 'lots' }])
    expect(store.get().aiMemoryCount).toBe(20)
  })

  it('barPosition 默认下方、可写、非法值回落（交互条位置）', () => {
    const store = new SettingsStore(BASE)
    expect(store.get().barPosition).toBe('bottom')
    store.applyOps([{ op: 'set', path: ['barPosition'], value: 'top' }])
    expect(store.get().barPosition).toBe('top')
    store.applyOps([{ op: 'set', path: ['barPosition'], value: 'hidden' }])
    expect(store.get().barPosition).toBe('hidden')
    store.applyOps([{ op: 'set', path: ['barPosition'], value: 'left' }])
    expect(store.get().barPosition).toBe('bottom')
  })

  it('barOffset 默认 0、可写、越界夹取（交互条偏移）', () => {
    const store = new SettingsStore(BASE)
    expect(store.get().barOffset).toBe(0)
    store.applyOps([{ op: 'set', path: ['barOffset'], value: -36 }])
    expect(store.get().barOffset).toBe(-36)
    store.applyOps([{ op: 'set', path: ['barOffset'], value: 999 }])
    expect(store.get().barOffset).toBe(200)
    store.applyOps([{ op: 'set', path: ['barOffset'], value: -999 }])
    expect(store.get().barOffset).toBe(-200)
    store.applyOps([{ op: 'set', path: ['barOffset'], value: 'nope' }])
    expect(store.get().barOffset).toBe(0)
  })

  it('eventTriggers 二层路径可单开关写入，非法值回落 true（ADR-037）', () => {
    const store = new SettingsStore(BASE)
    expect(store.get().eventTriggers).toEqual(defaultEventTriggers())
    store.applyOps([{ op: 'set', path: ['eventTriggers', 'tool-read'], value: false }])
    expect(store.get().eventTriggers['tool-read']).toBe(false)
    expect(store.get().eventTriggers['thinking']).toBe(true)
    // 开关只认布尔：非 true 一律视为关（normalizeEventTriggers 保留 boolean 值）
    store.applyOps([{ op: 'set', path: ['eventTriggers', 'tool-run'], value: 'nope' }])
    expect(store.get().eventTriggers['tool-run']).toBe(false)
    store.applyOps([{ op: 'set', path: ['eventTriggers', 'tool-run'], value: true }])
    expect(store.get().eventTriggers['tool-run']).toBe(true)
    // 整体写入会补齐缺省键
    store.applyOps([{ op: 'set', path: ['eventTriggers'], value: { error: false } }])
    const triggers = store.get().eventTriggers
    expect(triggers['error']).toBe(false)
    for (const key of TRIGGER_EVENTS) {
      if (key === 'error') continue
      expect(triggers[key], `整体写入后 ${key} 应回默认开`).toBe(true)
    }
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

describe('v8 迁移（ADR-037）', () => {
  it('version < 8 的文件 eventTriggers 强制全开（旧文件没有开关表）', () => {
    const store = new SettingsStore(BASE)
    writeFileSync(store.path, JSON.stringify({
      version: 7,
      enabled: true,
      size: 200,
      aiTouchOnly: true,
      aiTakeover: true,
      interactionMode: 'mutual',
      thinkingAiDelay: 9,
    }), 'utf8')
    const view = store.view()
    expect(view.value.eventTriggers).toEqual(defaultEventTriggers())
    // 旧字段在结果里没有位置
    expect((view.value as unknown as Record<string, unknown>).aiTakeover).toBeUndefined()
    expect((view.value as unknown as Record<string, unknown>).interactionMode).toBeUndefined()
    expect((view.value as unknown as Record<string, unknown>).thinkingAiDelay).toBeUndefined()
  })

  it('v8 文件的 eventTriggers 部分开关原样保留', () => {
    const store = new SettingsStore(BASE)
    store.applyOps([{ op: 'set', path: ['eventTriggers', 'tool-read'], value: false }])
    const text = readFileSync(store.path, 'utf8')
    const raw = JSON.parse(text.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')) as {
      version: number
      eventTriggers: Record<string, boolean>
    }
    expect(raw.version).toBe(8)
    expect(raw.eventTriggers['tool-read']).toBe(false)
    expect(store.view().value.eventTriggers['tool-read']).toBe(false)
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
    expect(base.ttsModel).toBe('qwen/qwen-audio-3.0-tts-plus')
    expect(base.ttsVoice).toBe('longanlingxin')
    expect(base.lipsyncEnabled).toBe(true)
    expect(base.lipsyncGain).toBe(100)
    // 目录外模型在旧文件（version < 7）里会被迁移回默认，新文件里原样保留
    const custom = normalizeSettings({ version: 7, ttsModel: 'x/y', ttsVoice: 'voice-1', lipsyncGain: 240 }, BASE)
    expect(custom.ttsModel).toBe('x/y')
    expect(custom.ttsVoice).toBe('voice-1')
    expect(custom.lipsyncGain).toBe(240)
    const legacy = normalizeSettings({ version: 6, ttsModel: 'fish-audio/drama-3', ttsVoice: '' }, BASE)
    expect(legacy.ttsModel).toBe(BASE.ttsModel)
    expect(legacy.ttsVoice).toBe(BASE.ttsVoice)
  })

  it('口型强度越界夹取，非法值回落 base', () => {
    expect(normalizeSettings({ lipsyncGain: 999 }, BASE).lipsyncGain).toBe(300)
    expect(normalizeSettings({ lipsyncGain: -5 }, BASE).lipsyncGain).toBe(0)
    expect(normalizeSettings({ lipsyncGain: 'abc' }, BASE).lipsyncGain).toBe(BASE.lipsyncGain)
  })

  it('跟随范围越界夹取，非法值回落 base', () => {
    expect(normalizeSettings({ focusRange: 999 }, BASE).focusRange).toBe(300)
    expect(normalizeSettings({ focusRange: -5 }, BASE).focusRange).toBe(0)
    expect(normalizeSettings({ focusRange: 35 }, BASE).focusRange).toBe(35)
    expect(normalizeSettings({ focusRange: 'abc' }, BASE).focusRange).toBe(BASE.focusRange)
  })

  it('音色允许空串（空 = 模型默认音色）', () => {
    expect(normalizeSettings({ ttsVoice: '   ' }, BASE).ttsVoice).toBe('')
  })

  it('v5 文件里的 MAI-Voice 回落到默认 Drama 3', () => {
    const legacy = normalizeSettings(
      { version: 5, ttsModel: 'microsoft/mai-voice-2.1-flash', ttsVoice: 'zh-CN-Mei:MAI-Voice-2.1-Flash' },
      BASE,
    )
    expect(legacy.ttsModel).toBe(BASE.ttsModel)
    expect(legacy.ttsVoice).toBe(BASE.ttsVoice)
  })

  it('目录内的模型与音色原样保留；v7 之前目录外的模型回落到默认', () => {
    const pinned = normalizeSettings({ version: 7, ttsModel: 'qwen/qwen-audio-3.0-tts-flash', ttsVoice: 'longanlingxi' }, BASE)
    expect(pinned.ttsModel).toBe('qwen/qwen-audio-3.0-tts-flash')
    expect(pinned.ttsVoice).toBe('longanlingxi')
    const removed = normalizeSettings({ version: 6, ttsModel: 'hexgrad/kokoro-82m', ttsVoice: '' }, BASE)
    expect(removed.ttsModel).toBe(BASE.ttsModel)
    expect(removed.ttsVoice).toBe(BASE.ttsVoice)
  })
})
