import { describe, it, expect } from 'vitest'
import {
  ORDER_STEP,
  ORDER_MAX,
  formatOrder,
  parseName,
  buildName,
  orderBetween,
  nextOrder,
  toOrderedItems,
  moveItem,
  renumberAll,
  insertAt,
} from './index.js'
import type { OrderedItem } from './index.js'

/** 便捷：从文件名数组建有序项 */
const items = (...names: string[]): OrderedItem[] => toOrderedItems(names)
const names = (list: readonly OrderedItem[]) => list.map((i) => i.fileName)

describe('序号格式', () => {
  it('补零到四位', () => {
    expect(formatOrder(10)).toBe('0010')
    expect(formatOrder(1)).toBe('0001')
    expect(formatOrder(9999)).toBe('9999')
  })

  it('超出上限被夹住', () => {
    expect(formatOrder(99999)).toBe('9999')
    expect(formatOrder(-5)).toBe('0000')
  })

  it('小数四舍五入', () => {
    expect(formatOrder(10.6)).toBe('0011')
  })
})

describe('parseName / buildName', () => {
  it('解析带序号的文件名', () => {
    expect(parseName('0010-第一章 坠楼.md')).toEqual({ order: 10, rest: '第一章 坠楼.md' })
  })

  it('无序号前缀时 order 为 null', () => {
    expect(parseName('第一章 坠楼.md')).toEqual({ order: null, rest: '第一章 坠楼.md' })
  })

  it('三位或五位数字不算序号前缀', () => {
    expect(parseName('001-甲.md').order).toBeNull()
    expect(parseName('00100-甲.md').order).toBeNull()
  })

  it('名字里本来就有数字不受影响', () => {
    expect(parseName('0010-第2章 第3节.md')).toEqual({ order: 10, rest: '第2章 第3节.md' })
  })

  it('往返一致', () => {
    expect(buildName(10, '第一章 坠楼.md')).toBe('0010-第一章 坠楼.md')
    expect(parseName(buildName(20, '甲.md'))).toEqual({ order: 20, rest: '甲.md' })
  })
})

describe('orderBetween · 求空位', () => {
  it('两个序号之间取中点', () => {
    expect(orderBetween(10, 20)).toBe(15)
    expect(orderBetween(10, 30)).toBe(20)
  })

  it('相邻序号之间没有空位', () => {
    expect(orderBetween(10, 11)).toBeNull()
    expect(orderBetween(10, 10)).toBeNull()
  })

  it('插到最前面时取一半', () => {
    expect(orderBetween(null, 10)).toBe(5)
    expect(orderBetween(null, 4)).toBe(2)
  })

  it('最前面已经是 1 时挤不下', () => {
    expect(orderBetween(null, 1)).toBeNull()
  })

  it('追加到末尾时加一个步长', () => {
    expect(orderBetween(30, null)).toBe(40)
  })

  it('末尾到顶时挤不下', () => {
    expect(orderBetween(ORDER_MAX, null)).toBeNull()
    expect(orderBetween(ORDER_MAX - 5, null)).toBeNull()
  })

  it('空列表返回第一个步长', () => {
    expect(orderBetween(null, null)).toBe(ORDER_STEP)
  })

  it('nextOrder 基于现有最大值', () => {
    expect(nextOrder([])).toBe(10)
    expect(nextOrder([10, 20, 35])).toBe(45)
  })
})

describe('toOrderedItems', () => {
  it('按序号排序而非字典序', () => {
    expect(names(items('0030-丙.md', '0010-甲.md', '0020-乙.md'))).toEqual([
      '0010-甲.md',
      '0020-乙.md',
      '0030-丙.md',
    ])
  })

  it('无序号前缀的文件补到末尾（作者用记事本手动新建的）', () => {
    const list = items('0010-甲.md', '临时想到的一章.md', '0020-乙.md')
    expect(names(list)).toEqual(['0010-甲.md', '0020-乙.md', '临时想到的一章.md'])
    expect(list[2]?.order).toBe(30)
  })

  it('全部无序号时按名字排序并依次编号', () => {
    const list = items('乙.md', '甲.md')
    expect(list.map((i) => i.order)).toEqual([10, 20])
  })

  it('空列表', () => {
    expect(toOrderedItems([])).toEqual([])
  })
})

describe('insertAt · 插入新章', () => {
  it('在两章之间插入只需 0 次重命名', () => {
    const r = insertAt(items('0010-甲.md', '0020-乙.md'), 1, '新章.md')
    expect(r.fileName).toBe('0015-新章.md')
    expect(r.renames).toEqual([])
    expect(r.renumbered).toBe(false)
  })

  it('追加到末尾', () => {
    const r = insertAt(items('0010-甲.md', '0020-乙.md'), 2, '新章.md')
    expect(r.fileName).toBe('0030-新章.md')
    expect(r.renames).toEqual([])
  })

  it('插到最前面', () => {
    const r = insertAt(items('0010-甲.md'), 0, '楔子.md')
    expect(r.fileName).toBe('0005-楔子.md')
    expect(r.renames).toEqual([])
  })

  it('空列表插入', () => {
    const r = insertAt([], 0, '第一章.md')
    expect(r.fileName).toBe('0010-第一章.md')
  })

  it('【关键】在 300 章的书里插一章，只重命名 1 个文件（实为 0 个）', () => {
    const list = toOrderedItems(
      Array.from({ length: 300 }, (_, i) => `${String((i + 1) * 10).padStart(4, '0')}-第${i + 1}章.md`),
    )
    const r = insertAt(list, 1, '插进来的.md')
    expect(r.renames).toHaveLength(0)
    expect(r.fileName).toBe('0015-插进来的.md')
  })

  it('间隔用尽时触发整段重排', () => {
    // 0010 与 0011 之间挤不下
    const r = insertAt(items('0010-甲.md', '0011-乙.md'), 1, '新章.md')
    expect(r.renumbered).toBe(true)
    expect(r.renames).toEqual([{ from: '0011-乙.md', to: '0020-乙.md' }])
    expect(r.fileName).toBe('0015-新章.md')
    expect(names(r.items)).toEqual(['0010-甲.md', '0015-新章.md', '0020-乙.md'])
  })

  it('连续在同一位置插 9 次后触发重排，且顺序始终正确', () => {
    let list = items('0010-甲.md', '0020-乙.md')
    let renumberedCount = 0
    for (let i = 0; i < 12; i++) {
      const r = insertAt(list, 1, `插${i}.md`)
      if (r.renumbered) renumberedCount++
      list = r.items
    }
    expect(renumberedCount).toBeGreaterThan(0)
    expect(list).toHaveLength(14)
    // 序号必须严格递增
    for (let i = 1; i < list.length; i++) {
      expect((list[i] as OrderedItem).order).toBeGreaterThan((list[i - 1] as OrderedItem).order)
    }
    // 第一个和最后一个仍是原来的甲和乙
    expect(list[0]?.rest).toBe('甲.md')
    expect(list[list.length - 1]?.rest).toBe('乙.md')
  })
})

describe('moveItem · 拖拽排序', () => {
  const four = () => items('0010-甲.md', '0020-乙.md', '0030-丙.md', '0040-丁.md')

  it('向后移动一位，只重命名 1 个文件', () => {
    const r = moveItem(four(), 0, 1)
    expect(r.renames).toEqual([{ from: '0010-甲.md', to: '0025-甲.md' }])
    expect(r.items.map((i) => i.rest)).toEqual(['乙.md', '甲.md', '丙.md', '丁.md'])
  })

  it('向前移动一位，只重命名 1 个文件', () => {
    const r = moveItem(four(), 3, 0)
    expect(r.renames).toEqual([{ from: '0040-丁.md', to: '0005-丁.md' }])
    expect(r.items.map((i) => i.rest)).toEqual(['丁.md', '甲.md', '乙.md', '丙.md'])
  })

  it('移到最末尾', () => {
    const r = moveItem(four(), 0, 3)
    expect(r.renames).toEqual([{ from: '0010-甲.md', to: '0050-甲.md' }])
    expect(r.items[3]?.rest).toBe('甲.md')
  })

  it('移到原位不产生重命名', () => {
    expect(moveItem(four(), 1, 1).renames).toEqual([])
  })

  it('越界索引安全返回', () => {
    expect(moveItem(four(), -1, 2).renames).toEqual([])
    expect(moveItem(four(), 0, 99).renames).toEqual([])
  })

  it('挤不下时整段重排，顺序仍然正确', () => {
    const tight = items('0010-甲.md', '0011-乙.md', '0012-丙.md')
    const r = moveItem(tight, 2, 1)
    expect(r.renumbered).toBe(true)
    expect(r.items.map((i) => i.rest)).toEqual(['甲.md', '丙.md', '乙.md'])
    expect(names(r.items)).toEqual(['0010-甲.md', '0020-丙.md', '0030-乙.md'])
  })

  it('反复拖拽 200 次后顺序始终自洽', () => {
    let list = toOrderedItems(
      Array.from({ length: 20 }, (_, i) => `${String((i + 1) * 10).padStart(4, '0')}-第${i}章.md`),
    )
    // 用固定的伪随机序列，保证失败可复现
    let seed = 12345
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    for (let k = 0; k < 200; k++) {
      list = moveItem(list, rnd(list.length), rnd(list.length)).items
    }
    expect(list).toHaveLength(20)
    for (let i = 1; i < list.length; i++) {
      expect((list[i] as OrderedItem).order).toBeGreaterThan((list[i - 1] as OrderedItem).order)
    }
    // 一章都没丢
    expect(new Set(list.map((i) => i.rest)).size).toBe(20)
  })
})

describe('renumberAll', () => {
  it('重排为 0010/0020/0030', () => {
    const r = renumberAll(items('0003-甲.md', '0007-乙.md', '0011-丙.md'))
    expect(names(r.items)).toEqual(['0010-甲.md', '0020-乙.md', '0030-丙.md'])
    expect(r.renames).toHaveLength(3)
  })

  it('已经是标准编号时不产生重命名', () => {
    const r = renumberAll(items('0010-甲.md', '0020-乙.md'))
    expect(r.renames).toEqual([])
  })

  it('空列表', () => {
    expect(renumberAll([])).toEqual({ renames: [], items: [] })
  })
})
