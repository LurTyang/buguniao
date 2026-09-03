/**
 * 每个主题各自记住字号。
 *
 * 这段逻辑错了不会报错，只会**悄悄改掉作者的字号** —— 而字号是他
 * 每天盯着看的东西，被无声地改掉是很让人恼火的一件事。
 */

import { describe, expect, it } from 'vitest'
import { onSizeChange, onThemeSwitch } from './theme-size.js'

describe('换主题时把字号取回来', () => {
  it('记过就换回去', () => {
    expect(onThemeSwitch('night', { light: 18, night: 20 }, 18)).toEqual({ fontSize: 20 })
  })

  it('【关键】没记过就不动 —— 第一次换过去保持当前大小，不许跳', () => {
    expect(onThemeSwitch('night', { light: 18 }, 18)).toEqual({})
    expect(onThemeSwitch('night', {}, 22)).toEqual({})
  })

  it('记的跟现在一样就什么都不做，不白写一次设置', () => {
    expect(onThemeSwitch('night', { night: 18 }, 18)).toEqual({})
  })
})

describe('调字号时记在当前那一档名下', () => {
  it('记下来', () => {
    expect(onSizeChange('night', 20, { light: 18 })).toEqual({
      fontSizeByTheme: { light: 18, night: 20 },
    })
  })

  it('改的是自己那一档，不动别人的', () => {
    const r = onSizeChange('light', 16, { light: 18, night: 22 })
    expect(r.fontSizeByTheme).toEqual({ light: 16, night: 22 })
  })

  it('没变就不写', () => {
    expect(onSizeChange('light', 18, { light: 18 })).toEqual({})
  })

  it('【关键】两档来回换不会互相污染', () => {
    let table: Record<string, number> = {}
    // 在纸白下调到 16
    table = onSizeChange('light', 16, table).fontSizeByTheme ?? table
    // 换到夜间：没记过，字号不动（还是 16），然后他调到 20
    expect(onThemeSwitch('night', table, 16)).toEqual({})
    table = onSizeChange('night', 20, table).fontSizeByTheme ?? table
    // 换回纸白：应该回到 16，而不是被夜间那次污染成 20
    expect(onThemeSwitch('light', table, 20)).toEqual({ fontSize: 16 })
    expect(table).toEqual({ light: 16, night: 20 })
  })
})
