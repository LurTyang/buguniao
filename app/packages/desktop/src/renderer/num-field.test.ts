/**
 * 设置里那个数字输入框认哪些写法。
 *
 * 原来是滑动条，作者要求换成文本框：滑动条**调不准** ——
 * 想要 18 号字，拖到 17 还是 19 全看手稳不稳，而字号这种东西
 * 人心里是有确切数字的。
 */

import { describe, expect, it } from 'vitest'
import { clampToStep, parseNumberLoose } from './num-field.js'

describe('从一串文字里抠出一个数', () => {
  it('纯数字', () => {
    expect(parseNumberLoose('18')).toBe(18)
    expect(parseNumberLoose('  20  ')).toBe(20)
  })

  it('带单位的也认 —— 粘一个 18px 进来不该让人先删单位', () => {
    expect(parseNumberLoose('18px')).toBe(18)
    expect(parseNumberLoose('18 px')).toBe(18)
    expect(parseNumberLoose('720PX')).toBe(720)
    expect(parseNumberLoose('2 字')).toBe(2)
  })

  it('小数', () => {
    expect(parseNumberLoose('1.9')).toBe(1.9)
    expect(parseNumberLoose('1.9 倍')).toBe(1.9)
  })

  it('【关键】读不出数就返回 null，不猜', () => {
    expect(parseNumberLoose('')).toBeNull()
    expect(parseNumberLoose('   ')).toBeNull()
    expect(parseNumberLoose('大一点')).toBeNull()
    expect(parseNumberLoose('px')).toBeNull()
  })
})

describe('收进范围', () => {
  it('超出上下限时贴边', () => {
    expect(clampToStep(999, 13, 28, 1)).toBe(28)
    expect(clampToStep(2, 13, 28, 1)).toBe(13)
  })

  it('按步长对齐', () => {
    expect(clampToStep(17.6, 13, 28, 1)).toBe(18)
    expect(clampToStep(723, 480, 1200, 20)).toBe(720)
  })

  it('【关键】小数不留浮点尾巴 —— 1.9000000000000001 摆在设置里很吓人', () => {
    expect(clampToStep(1.9, 1.3, 2.6, 0.1)).toBe(1.9)
    expect(String(clampToStep(1.9, 1.3, 2.6, 0.1))).toBe('1.9')
    expect(String(clampToStep(2.25, 1.3, 2.6, 0.1))).toBe('2.3')
  })
})
