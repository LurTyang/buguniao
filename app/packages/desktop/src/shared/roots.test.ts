/**
 * 作品库目录这一排。
 *
 * 这一层错了的后果分两种，都不轻：
 *   · 同一个目录认成两个 → 列表里两行一模一样的名字，作者不知道点哪个
 *   · 两个目录认成一个   → **索引共用**，在 A 库里搜出 B 库的句子
 */
import { describe, it, expect } from 'vitest'
import {
  addRoot,
  indexFileName,
  normalizeRoot,
  removeRoot,
  rootName,
  sameRoot,
} from './roots.js'

describe('认目录', () => {
  it('反斜杠、末尾斜杠都当成同一个', () => {
    expect(sameRoot('D:\\书\\', 'D:/书')).toBe(true)
  })

  it('【关键】Windows 不分大小写 —— 分了就会有两行一样的', () => {
    expect(sameRoot('D:/书', 'd:/书')).toBe(true)
  })

  it('不同的目录就是不同的', () => {
    expect(sameRoot('D:/书', 'D:/书2')).toBe(false)
    expect(sameRoot('D:/书/甲', 'D:/书/乙')).toBe(false)
  })

  it('盘符根目录不许被削没', () => {
    expect(normalizeRoot('D:/')).toBe('D:/')
    expect(normalizeRoot('D:\\')).toBe('D:/')
  })
})

describe('加与去', () => {
  it('加一个', () => {
    expect(addRoot([], 'D:/书')).toEqual(['D:/书'])
  })

  it('【关键】已经在里头就不动，顺序也不变 —— 列表跳来跳去会让人找不着', () => {
    const list = ['D:/甲', 'D:/乙']
    expect(addRoot(list, 'd:/甲\\')).toEqual(['D:/甲', 'D:/乙'])
  })

  it('空的不加', () => {
    expect(addRoot(['D:/甲'], '   ')).toEqual(['D:/甲'])
  })

  it('去掉一个，别的不动', () => {
    expect(removeRoot(['D:/甲', 'D:/乙'], 'd:/甲')).toEqual(['D:/乙'])
  })
})

describe('显示名', () => {
  it('取最后一段文件夹名', () => {
    expect(rootName('D:/云盘/我的小说')).toBe('我的小说')
    expect(rootName('D:\\云盘\\我的小说\\')).toBe('我的小说')
  })

  it('盘符根目录就显示盘符', () => {
    expect(rootName('D:/')).toBe('D:')
  })
})

describe('索引文件名', () => {
  it('【关键】两个目录不许共用一份索引', () => {
    expect(indexFileName('D:/甲')).not.toBe(indexFileName('D:/乙'))
  })

  it('【关键】同一个目录换个写法，还是同一份索引 —— 不然每换一次写法就重扫一遍', () => {
    expect(indexFileName('D:\\书\\')).toBe(indexFileName('d:/书'))
  })

  it('文件名不带路径分隔符、不带盘符冒号', () => {
    const n = indexFileName('D:/云盘/我的小说')
    expect(n).toMatch(/^index-[^/\\:]*\.db$/)
    expect(n).toContain('我的小说')
  })

  it('目录名全是符号时也给得出名字', () => {
    expect(indexFileName('D:/!!!')).toMatch(/^index-[0-9a-f]{8}\.db$/)
  })
})
