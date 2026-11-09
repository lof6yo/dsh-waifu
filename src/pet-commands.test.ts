import { describe, expect, it } from 'vitest'
import { homePercentFromPos } from './client/pet-commands.ts'

describe('homePercentFromPos（捕捉当前位置 → 默认位置百分比）', () => {
  it('画布中心落在视口右/下角指定百分比处', () => {
    // 视口 1920×1080、画布 200×200、pos={right:300,bottom:260}
    // 中心距右 = 300+100 = 400 → 400/1920 = 20.8% → 21
    // 中心距下 = 260+100 = 360 → 360/1080 = 33.3% → 33
    expect(homePercentFromPos({ right: 300, bottom: 260 }, { width: 200, height: 200 }, { width: 1920, height: 1080 }))
      .toEqual({ right: 21, bottom: 33 })
  })

  it('与 homePositionFromConfig 互逆（取整误差 ≤1%）', () => {
    const viewport = { width: 1600, height: 900 }
    const canvas = { width: 240, height: 320 }
    const home = homePercentFromPos({ right: 320, bottom: 120 }, canvas, viewport)
    expect(home).not.toBeNull()
    const backRight = viewport.width * (home as { right: number }).right / 100 - canvas.width / 2
    const backBottom = viewport.height * (home as { bottom: number }).bottom / 100 - canvas.height / 2
    expect(Math.abs(backRight - 320)).toBeLessThanOrEqual(viewport.width / 100)
    expect(Math.abs(backBottom - 120)).toBeLessThanOrEqual(viewport.height / 100)
  })

  it('夹到 0–100（角色被拖到视口外也能存）', () => {
    expect(homePercentFromPos({ right: -9000, bottom: 9000 }, { width: 200, height: 200 }, { width: 1000, height: 1000 }))
      .toEqual({ right: 0, bottom: 100 })
  })

  it('可见轮廓偏移参与换算（ADR-059）', () => {
    // 视口 1600×900、画布 240×320、可见轮廓中心相对画布中心偏 (+12, -8)
    const canvas = { width: 240, height: 320 }
    const viewport = { width: 1600, height: 900 }
    const offset = { x: 12, y: -8 }
    const home = homePercentFromPos({ right: 300, bottom: 100 }, canvas, viewport, offset)
    expect(home).not.toBeNull()
    const h = home as { right: number; bottom: number }
    // 与 homePositionFromConfig 的公式互逆：pos = 百分比 - W/2 + offset
    const backRight = viewport.width * h.right / 100 - canvas.width / 2 + offset.x
    const backBottom = viewport.height * h.bottom / 100 - canvas.height / 2 + offset.y
    expect(Math.abs(backRight - 300)).toBeLessThanOrEqual(viewport.width / 100)
    expect(Math.abs(backBottom - 100)).toBeLessThanOrEqual(viewport.height / 100)
  })

  it('页面 UI 缩放参与换算（视觉视口百分比，ADR-059）', () => {
    // 手机竖屏 440×702、逻辑画布 832×728、UI 缩放 0.8：拖到夹取上限时
    // 可见中心正好落在视口左上角 → 捕捉结果应为 100%（距右/距下都是整个视口）
    const canvas = { width: 832, height: 728 }
    const viewport = { width: 440, height: 702 }
    const offset = { x: -17, y: -34 }
    const scale = 0.8
    const pos = {
      right: viewport.width / scale + offset.x - canvas.width / 2,
      bottom: viewport.height / scale + offset.y - canvas.height / 2,
    }
    expect(homePercentFromPos(pos, canvas, viewport, offset, scale)).toEqual({ right: 100, bottom: 100 })
  })

  it('尺寸非正时返回 null（不写坏配置）', () => {
    expect(homePercentFromPos({ right: 10, bottom: 10 }, { width: 0, height: 200 }, { width: 800, height: 600 })).toBeNull()
    expect(homePercentFromPos({ right: 10, bottom: 10 }, { width: 200, height: 200 }, { width: 800, height: 0 })).toBeNull()
  })
})
