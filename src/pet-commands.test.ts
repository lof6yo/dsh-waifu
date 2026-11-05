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

  it('尺寸非正时返回 null（不写坏配置）', () => {
    expect(homePercentFromPos({ right: 10, bottom: 10 }, { width: 0, height: 200 }, { width: 800, height: 600 })).toBeNull()
    expect(homePercentFromPos({ right: 10, bottom: 10 }, { width: 200, height: 200 }, { width: 800, height: 0 })).toBeNull()
  })
})
