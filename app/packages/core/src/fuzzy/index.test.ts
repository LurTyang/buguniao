import { describe, it, expect } from 'vitest'
import { fuzzyFilter, scoreOne } from './index.js'

describe('scoreOne', () => {
  it('连续子串命中', () => {
    const r = scoreOne('玉佩', '第三章 玉佩的来历')
    expect(r).not.toBeNull()
    expect(r!.matched).toEqual([4, 5])
  })

  it('子序列也能命中', () => {
    const r = scoreOne('三玉', '第三章 玉佩的来历')
    expect(r).not.toBeNull()
    expect(r!.matched).toEqual([1, 4])
  })

  it('顺序不对就不算命中', () => {
    expect(scoreOne('玉三', '第三章 玉佩')).toBeNull()
  })

  it('完全没有的字返回 null', () => {
    expect(scoreOne('龙', '第三章 玉佩')).toBeNull()
  })

  it('空查询命中一切，分数为 0', () => {
    expect(scoreOne('', '随便什么')).toEqual({ score: 0, matched: [] })
  })

  it('英文不分大小写', () => {
    expect(scoreOne('CH', 'chapter one')).not.toBeNull()
  })

  it('【关键】连续子串一定排在子序列前面', () => {
    const exact = scoreOne('玉佩', '玉佩')!
    const loose = scoreOne('玉佩', '玉器店的佩饰')!
    expect(exact.score).toBeGreaterThan(loose.score)
  })

  it('命中位置越靠前分越高', () => {
    const front = scoreOne('玉佩', '玉佩的来历')!
    const back = scoreOne('玉佩', '第三章 说的是玉佩')!
    expect(front.score).toBeGreaterThan(back.score)
  })
})

describe('fuzzyFilter', () => {
  const chapters = ['第一章 坠楼', '第二章 醒来', '第三章 玉佩的来历', '玉佩终章']

  it('挑出所有命中的', () => {
    expect(fuzzyFilter('玉佩', chapters, (c) => c).map((h) => h.item)).toEqual([
      '玉佩终章',
      '第三章 玉佩的来历',
    ])
  })

  it('空查询把全部原样返回', () => {
    expect(fuzzyFilter('', chapters, (c) => c)).toHaveLength(4)
  })

  it('空查询时保持原有顺序 —— 那就是章节顺序', () => {
    expect(fuzzyFilter('', chapters, (c) => c).map((h) => h.item)).toEqual(chapters)
  })

  it('limit 截断', () => {
    expect(fuzzyFilter('章', chapters, (c) => c, 2)).toHaveLength(2)
  })

  it('一个都没命中时返回空数组', () => {
    expect(fuzzyFilter('恐龙', chapters, (c) => c)).toEqual([])
  })

  it('候选为空不炸', () => {
    expect(fuzzyFilter('玉', [], (c: string) => c)).toEqual([])
  })
})
