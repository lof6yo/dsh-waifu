import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore, normalizeSettings, SETTINGS_FILENAME, type PetSettings } from './settings-store.ts'

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
  homeRight: 24,
  homeBottom: 20,
  bubbleOffsetX: 0,
  bubbleOffsetY: -10,
  bubbleBgColor: '#ffffff',
  bubbleBgOpacity: 92,
  bubbleTextColor: '#222222',
}

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-live2d-pet-settings-'))
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
    expect(v.bubbleOffsetY).toBe(-1000)
  })

  it('size 低于下限夹到 40，maxFps 0 允许（不限制）', () => {
    const v = normalizeSettings({ size: 1, maxFps: 0 }, BASE)
    expect(v.size).toBe(40)
    expect(v.maxFps).toBe(0)
  })
})

describe('SettingsStore', () => {
  it('首次落地模板文件并读取 base', () => {
    const store = new SettingsStore(BASE)
    expect(store.path).toBe(join(home, 'live2d-pet', SETTINGS_FILENAME))
    expect(store.get()).toEqual(BASE)
    expect(readFileSync(store.path, 'utf8')).toContain('桌宠设置文件')
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

  it('文件损坏时沿用上次好结果并报错', () => {
    const store = new SettingsStore(BASE)
    store.applyOps([{ op: 'set', path: ['size'], value: 200 }])
    writeFileSync(store.path, '{ bad', 'utf8')
    const view = store.view()
    expect(view.error).toContain('解析失败')
    expect(view.value.size).toBe(200)
  })
})
