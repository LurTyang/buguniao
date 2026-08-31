/**
 * 右键菜单摆在哪儿。
 *
 * 作者的原话是「复制粘贴的时候文本内容可能会被跳出来的项目挡住」——
 * 稿纸上的菜单有十几条，从光标处往下开正好盖住刚选中的那一段，
 * 想核对一眼「我选对了没有」都看不见。
 *
 * 这段算术一坏就是「菜单缺半截」或者「菜单又盖回去了」，两种都只能靠人眼盯。
 * 所以它是个纯函数，在这儿钉住。
 */

import { describe, expect, it } from 'vitest'
import { placeMenu } from './components/ContextMenu.js'

const VIEW = { width: 1200, height: 800 }
const MENU = { width: 200, height: 300 }

const at = (x: number, y: number, avoid?: Parameters<typeof placeMenu>[0]['avoid']) =>
  placeMenu({ x, y, menu: MENU, view: VIEW, avoid: avoid ?? null })

/** 菜单摆在 p 处时，跟这块区域压上了吗 */
const hits = (p: { x: number; y: number }, a: { left: number; top: number; right: number; bottom: number }) =>
  p.x < a.right && p.x + MENU.width > a.left && p.y < a.bottom && p.y + MENU.height > a.top

describe('不躲任何东西的时候', () => {
  it('就摆在点的那儿', () => {
    expect(at(300, 200)).toEqual({ x: 300, y: 200 })
  })

  it('贴右边时往左翻，不跑出窗口', () => {
    const p = at(1150, 200)
    expect(p.x + MENU.width).toBeLessThanOrEqual(VIEW.width)
  })

  it('贴下边时往上翻', () => {
    const p = at(300, 780)
    expect(p.y + MENU.height).toBeLessThanOrEqual(VIEW.height)
  })

  it('右下角同时翻两个方向', () => {
    const p = at(1190, 790)
    expect(p.x + MENU.width).toBeLessThanOrEqual(VIEW.width)
    expect(p.y + MENU.height).toBeLessThanOrEqual(VIEW.height)
  })
})

describe('躲开选中的那一段', () => {
  const SEL = { left: 280, top: 180, right: 520, bottom: 260 }

  it('【关键】不压住选区', () => {
    const p = at(300, 200, SEL)
    expect(hits(p, SEL)).toBe(false)
  })

  it('优先往右挪 —— 选中的那一段还在原地，菜单摆它旁边', () => {
    const p = at(300, 200, SEL)
    expect(p.x).toBeGreaterThanOrEqual(SEL.right)
  })

  it('右边放不下就往左', () => {
    // 选区右边只剩 60px，塞不下 200 宽的菜单
    const sel = { left: 900, top: 180, right: 1140, bottom: 260 }
    const p = at(950, 200, sel)
    expect(hits(p, sel)).toBe(false)
    expect(p.x + MENU.width).toBeLessThanOrEqual(sel.left)
  })

  it('左右都放不下就往下', () => {
    // 选区横着占满，只能上下躲
    const sel = { left: 0, top: 100, right: 1200, bottom: 200 }
    const p = at(400, 150, sel)
    expect(hits(p, sel)).toBe(false)
    expect(p.y).toBeGreaterThanOrEqual(sel.bottom)
  })

  it('下面放不下就翻到上面去', () => {
    const sel = { left: 0, top: 560, right: 1200, bottom: 660 }
    const p = at(400, 600, sel)
    expect(hits(p, sel)).toBe(false)
    expect(p.y + MENU.height).toBeLessThanOrEqual(sel.top)
  })

  it('躲开之后仍然在窗口里', () => {
    for (const sel of [
      { left: 280, top: 180, right: 520, bottom: 260 },
      { left: 900, top: 600, right: 1180, bottom: 780 },
      { left: 0, top: 0, right: 1200, bottom: 120 },
    ]) {
      const p = at(sel.left + 10, sel.top + 10, sel)
      expect(p.x).toBeGreaterThanOrEqual(4)
      expect(p.y).toBeGreaterThanOrEqual(4)
      expect(p.x + MENU.width).toBeLessThanOrEqual(VIEW.width)
      expect(p.y + MENU.height).toBeLessThanOrEqual(VIEW.height)
    }
  })

  it('选区大到占满屏幕时就不挪了 —— 挪到更糟的地方还不如不挪', () => {
    const sel = { left: 0, top: 0, right: 1200, bottom: 800 }
    const p = at(300, 200, sel)
    // 躲不开，但至少还在窗口里、还在点的那一带
    expect(p).toEqual({ x: 300, y: 200 })
  })

  it('本来就没压住的话，一步都不挪', () => {
    const sel = { left: 800, top: 600, right: 900, bottom: 700 }
    expect(at(100, 100, sel)).toEqual({ x: 100, y: 100 })
  })
})
