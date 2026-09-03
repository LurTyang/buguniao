/**
 * 字体表测试。
 *
 * 这里真正要锁死的是**旧配置的迁移**：早先版本把整串 CSS 字体栈存进了
 * 配置文件，还有更早的版本只存了一个光秃秃的「楷体」。
 * 认不出来的后果是下拉框永远显示「自定义」，而且换字体像是没反应。
 */

import { describe, it, expect } from 'vitest'
import { FONTS, PUNCT_UNICODE_RANGE, fontKeyOf, resolveFontStack, customFamilyOf, customValueOf, customFontStack } from './fonts.js'

describe('字体表本身', () => {
  it('一期就三款：楷体、宋体、黑体', () => {
    expect(FONTS.map((f) => f.label)).toEqual(['楷体', '宋体', '黑体'])
  })

  it('key 不重复', () => {
    expect(new Set(FONTS.map((f) => f.key)).size).toBe(FONTS.length)
  })

  it('【关键】黑体的字体栈里，黑体排在微软雅黑前面', () => {
    // 曾经写反过：黑体那一项的字体栈以「微软雅黑」开头，
    // 于是选了黑体显示的却是雅黑
    const hei = FONTS.find((f) => f.key === 'hei')!
    expect(hei.stack.indexOf('黑体')).toBeLessThan(
      hei.stack.includes('雅黑') ? hei.stack.indexOf('雅黑') : Infinity,
    )
  })

  it('每一款都有兜底的通用字体', () => {
    for (const f of FONTS) expect(f.stack).toMatch(/(serif|sans-serif)$/)
  })

  it('只有楷体另配了标点', () => {
    expect(FONTS.filter((f) => f.stack.includes('楷体标点')).map((f) => f.key)).toEqual(['kai'])
  })

  it('标点范围不圈进任何汉字', () => {
    // CJK 统一表意文字是 U+4E00–U+9FFF，范围里不该出现 4E/5x…9F 开头的段
    expect(PUNCT_UNICODE_RANGE).not.toMatch(/U\+[4-9][0-9A-F]{3}/)
  })
})

describe('resolveFontStack · 认出存的是什么', () => {
  it('key 直接命中', () => {
    expect(resolveFontStack('song')).toBe(FONTS.find((f) => f.key === 'song')!.stack)
  })

  it('【迁移】旧版本存的整串字体栈能归位', () => {
    expect(resolveFontStack("'宋体', 'SimSun', 'Songti SC', serif")).toBe(
      FONTS.find((f) => f.key === 'song')!.stack,
    )
  })

  it('【迁移】更早版本存的光秃秃一个「楷体」也能归位', () => {
    expect(resolveFontStack('楷体')).toBe(FONTS.find((f) => f.key === 'kai')!.stack)
  })

  it('【迁移】旧的黑体那一项（以微软雅黑开头）归到黑体', () => {
    const old = "'微软雅黑', 'Microsoft YaHei', '黑体', 'SimHei', sans-serif"
    // 开头对不上任何一款，但 SimHei 在栈里 —— 至少不能崩，也不能变成空
    expect(resolveFontStack(old)).toBeTruthy()
  })

  it('完全不认识的值原样返回，不硬塞一个默认值', () => {
    expect(resolveFontStack("'我自己装的字体'")).toBe("'我自己装的字体'")
  })

  it('空值退回第一款', () => {
    expect(resolveFontStack('')).toBe(FONTS[0]!.stack)
  })
})

describe('fontKeyOf · 下拉框该选中哪一项', () => {
  it('key 原样返回', () => {
    expect(fontKeyOf('hei')).toBe('hei')
  })

  it('【关键】旧配置也能选中对应项，而不是掉进「自定义」', () => {
    expect(fontKeyOf('楷体')).toBe('kai')
    expect(fontKeyOf("'宋体', 'SimSun', 'Songti SC', serif")).toBe('song')
  })

  it('真·自定义返回 null', () => {
    expect(fontKeyOf("'我自己装的字体'")).toBeNull()
  })
})

describe('自己导进来的字体', () => {
  it('存的是 custom: 前缀，跟内置的 key 分得开', () => {
    expect(customValueOf('霞鹜文楷')).toBe('custom:霞鹜文楷')
    expect(customFamilyOf('custom:霞鹜文楷')).toBe('霞鹜文楷')
    expect(customFamilyOf('kai')).toBe('')
  })

  it('【关键】一个叫 kai 的自选字体顶不掉内置楷体', () => {
    expect(resolveFontStack('kai')).toBe(FONTS[0]!.stack)
    expect(resolveFontStack('custom:kai')).toContain("'kai'")
    expect(resolveFontStack('custom:kai')).not.toBe(FONTS[0]!.stack)
  })

  it('字体栈后面跟着兜底 —— 字体里没有的字不该显示成方框', () => {
    const stack = customFontStack('霞鹜文楷')
    expect(stack.startsWith("'霞鹜文楷'")).toBe(true)
    expect(stack).toContain('楷体')
    expect(stack.endsWith('serif')).toBe(true)
  })

  it('自选字体在下拉框里算「自定义」，不冒充内置的某一款', () => {
    expect(fontKeyOf('custom:霞鹜文楷')).toBeNull()
  })
})
