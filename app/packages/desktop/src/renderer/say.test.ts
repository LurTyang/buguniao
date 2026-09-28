/**
 * 「还差多少」和「多久以前」。
 *
 * 这两句话都摆在最显眼的位置，而它们错了很难被看见：
 * 差 0 字还写着「还差」、十分钟前写的显示成「昨天」。
 */
import { describe, it, expect } from 'vitest'
import { agoText, charsText, todaySay } from './say.js'

const AT = (y: number, m: number, d: number, h = 0, mi = 0) =>
  new Date(y, m - 1, d, h, mi).getTime()

describe('今天还差多少', () => {
  it('没设目标就不说话 —— 不硬凑一句', () => {
    expect(todaySay({ words: 500, floor: 0, ideal: 0 })).toBe('')
  })

  it('离得远时说还差多少', () => {
    expect(todaySay({ words: 200, floor: 2000, ideal: 3000 })).toBe('还差 1,800 字')
  })

  it('【关键】快到了要换一句 —— 剩两百字的时候人多半会把它写完', () => {
    expect(todaySay({ words: 1850, floor: 2000, ideal: 3000 })).toBe('就差 150 字')
  })

  it('目标小的时候门槛不跟着缩到没有', () => {
    // 目标 500 的一成五只有 75 字，那太苛刻了 —— 至少留两百
    expect(todaySay({ words: 350, floor: 500, ideal: 0 })).toBe('就差 150 字')
  })

  it('够了底线就说达标，并指一下理想线', () => {
    expect(todaySay({ words: 2000, floor: 2000, ideal: 3000 })).toBe('达标了 · 离理想线还差 1,000 字')
  })

  it('理想线也够了', () => {
    expect(todaySay({ words: 3200, floor: 2000, ideal: 3000 })).toBe('理想线也到了')
  })

  it('没设理想线时就一句达标', () => {
    expect(todaySay({ words: 2000, floor: 2000, ideal: 0 })).toBe('今天达标了')
  })

  it('【关键】刚好够的那一下不许还写着「还差」', () => {
    expect(todaySay({ words: 2000, floor: 2000, ideal: 2000 })).not.toContain('还差 0')
  })
})

describe('多久以前', () => {
  const now = AT(2026, 9, 28, 10, 0)

  it('一分钟以内是刚刚', () => {
    expect(agoText(now - 30_000, now)).toBe('刚刚')
  })

  it('一小时以内按分钟', () => {
    expect(agoText(now - 6 * 60_000, now)).toBe('6 分钟前')
  })

  it('同一天按小时', () => {
    expect(agoText(AT(2026, 9, 28, 3, 0), now)).toBe('7 小时前')
  })

  it('【关键】跨天按日历算 —— 昨晚十一点写的，今早看要说「昨天」', () => {
    // 只隔了 11 小时，但它确实是昨天
    expect(agoText(AT(2026, 9, 27, 23, 0), now)).toBe('昨天')
  })

  it('一周内按天', () => {
    expect(agoText(AT(2026, 9, 25, 10, 0), now)).toBe('3 天前')
  })

  it('再久就报日期', () => {
    expect(agoText(AT(2026, 8, 3, 10, 0), now)).toBe('8 月 3 日')
  })

  it('跨年要带上年份 —— 不然「1 月 3 日」不知道是哪一年的', () => {
    expect(agoText(AT(2025, 1, 3, 10, 0), now)).toBe('2025 年 1 月 3 日')
  })

  it('没有时间就不说话', () => {
    expect(agoText(0, now)).toBe('')
  })
})

describe('书架卡片上的字数', () => {
  it('还没索引到就不说话 —— 显示「0 字」看着像这本书空了', () => {
    expect(charsText(0)).toBe('')
  })

  it('一万以下按字', () => {
    expect(charsText(8200)).toBe('8,200 字')
  })

  it('一万以上按万字，整数不拖小数点', () => {
    expect(charsText(124000)).toBe('12.4 万字')
    expect(charsText(120000)).toBe('12 万字')
  })
})
