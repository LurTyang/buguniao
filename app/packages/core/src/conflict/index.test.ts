/**
 * 冲突副本测试。
 *
 * 这个模块的每一个 bug 都是「作者丢了一版稿子」，所以测得细一点。
 */

import { describe, it, expect } from 'vitest'
import { compareTexts, describeConflict, originalFileName, originalPathOf, pairConflicts } from './index.js'

describe('originalFileName · 从副本名还原正本名', () => {
  it('去掉中文冲突标记', () => {
    expect(originalFileName('0010-第一章 (冲突文件 2026-08-25 明听).md')).toBe('0010-第一章.md')
  })

  it('全角括号也认', () => {
    expect(originalFileName('0010-第一章（冲突文件 2026-08-25）.md')).toBe('0010-第一章.md')
  })

  it('英文 conflicted copy 也认', () => {
    expect(originalFileName("chapter (Mingting's conflicted copy 2026-08-25).md")).toBe('chapter.md')
  })

  it('【关键】编号前缀原样保留 —— 丢了它章节顺序就乱了', () => {
    expect(originalFileName('0230-第二十三章 玉佩 (冲突文件 2026-08-25).md')).toBe('0230-第二十三章 玉佩.md')
  })

  it('书名本身带括号不受影响', () => {
    expect(originalFileName('0010-第一章（上）(冲突文件 2026-08-25).md')).toBe('0010-第一章（上）.md')
  })

  it('不是冲突副本时原样返回', () => {
    expect(originalFileName('0010-第一章.md')).toBe('0010-第一章.md')
  })

  it('标记出现在扩展名之后也能去掉', () => {
    expect(originalFileName('0010-第一章.md (冲突文件 2026-08-25)')).toBe('0010-第一章.md')
  })
})

describe('originalPathOf · 路径级', () => {
  it('目录不变，只改文件名', () => {
    expect(originalPathOf('某某传/正文/第一卷/0010-第一章 (冲突文件 2026-08-25).md')).toBe(
      '某某传/正文/第一卷/0010-第一章.md',
    )
  })

  it('没有目录时也不炸', () => {
    expect(originalPathOf('0010-第一章 (冲突文件 x).md')).toBe('0010-第一章.md')
  })
})

describe('compareTexts · 左右对齐', () => {
  it('完全一样时标记 identical', () => {
    const r = compareTexts('他掉下去了。', '他掉下去了。')
    expect(r.identical).toBe(true)
    expect(r.added).toBe(0)
    expect(r.removed).toBe(0)
  })

  it('相同的行左右都在，行号各自递增', () => {
    const r = compareTexts('甲\n乙', '甲\n乙')
    expect(r.rows).toHaveLength(2)
    expect(r.rows[1]).toMatchObject({ kind: 'same', left: '乙', right: '乙', leftNo: 2, rightNo: 2 })
  })

  it('副本多一段', () => {
    const r = compareTexts('甲', '甲\n乙')
    expect(r.added).toBe(1)
    expect(r.removed).toBe(0)
    expect(r.rows.find((x) => x.kind === 'add')).toMatchObject({ right: '乙', left: null })
  })

  it('副本少一段', () => {
    const r = compareTexts('甲\n乙', '甲')
    expect(r.removed).toBe(1)
    expect(r.rows.find((x) => x.kind === 'del')).toMatchObject({ left: '乙', right: null })
  })

  it('改了一段显示成一删一增', () => {
    const r = compareTexts('他掉下去了。', '他还是掉下去了。')
    expect(r.added).toBe(1)
    expect(r.removed).toBe(1)
    expect(r.identical).toBe(false)
  })

  it('【关键】CRLF 与 LF 的差别不算冲突内容', () => {
    const r = compareTexts('甲\r\n乙\r\n丙', '甲\n乙\n丙')
    expect(r.identical).toBe(true)
  })

  it('正文中间的空行留着 —— 那是自然段分隔', () => {
    const r = compareTexts('甲\n\n乙', '甲\n\n乙')
    expect(r.rows.map((x) => x.left)).toEqual(['甲', '', '乙'])
  })

  it('一边为空时整篇算新增', () => {
    const r = compareTexts('', '甲\n乙')
    expect(r.added).toBe(2)
    expect(r.removed).toBe(0)
  })

  it('两边都空不炸', () => {
    expect(compareTexts('', '').identical).toBe(true)
  })

  it('行号只在自己那一栏里数', () => {
    // 正本 3 行，副本把第二行换了
    const r = compareTexts('甲\n乙\n丙', '甲\n乙改\n丙')
    const last = r.rows[r.rows.length - 1]!
    expect(last).toMatchObject({ kind: 'same', leftNo: 3, rightNo: 3 })
  })

  it('长文也能对齐，不丢行', () => {
    const left = Array.from({ length: 200 }, (_, i) => `第${i}段`).join('\n')
    const right = left.replace('第100段', '第100段（改过）')
    const r = compareTexts(left, right)
    expect(r.rows.filter((x) => x.kind === 'same')).toHaveLength(199)
    expect(r.added).toBe(1)
    expect(r.removed).toBe(1)
  })
})

describe('describeConflict · 一句话说清', () => {
  it('一样时直说可以删', () => {
    expect(describeConflict(compareTexts('甲', '甲'))).toContain('删掉副本')
  })

  it('多出来的行数说出来', () => {
    expect(describeConflict(compareTexts('甲', '甲\n乙\n丙'))).toContain('副本多 2 行')
  })

  it('两边都有增删时都说', () => {
    const d = describeConflict(compareTexts('甲\n乙', '甲改\n丙\n丁'))
    expect(d).toContain('多')
    expect(d).toContain('少')
  })
})

describe('pairConflicts · 配对清单', () => {
  it('配出正本路径与显示名', () => {
    const [p] = pairConflicts(['书/正文/0010-第一章 (冲突文件 2026-08-25).md'])
    expect(p).toEqual({
      conflictPath: '书/正文/0010-第一章 (冲突文件 2026-08-25).md',
      originalPath: '书/正文/0010-第一章.md',
      fileName: '0010-第一章 (冲突文件 2026-08-25).md',
    })
  })

  it('不是冲突副本的路径被剔掉', () => {
    expect(pairConflicts(['书/正文/0010-第一章.md'])).toEqual([])
  })

  it('空清单返回空数组', () => {
    expect(pairConflicts([])).toEqual([])
  })
})

describe('回归：作者会连着撞上的坑', () => {
  it('【关键】处理成「另一版」之后不能再被认成冲突副本', () => {
    // 冲突副本的标题是从文件名来的，直接拼后缀会把标记也带过去，
    // 于是新文件下次扫描又是冲突副本，作者永远处理不完
    const title = originalFileName('0010-第一章 (冲突文件 2026-08-25 明听)')
    expect(pairConflicts([`书/正文/0020-${title}（另一版）.md`])).toEqual([])
  })

  it('同一个文件名连着两次冲突标记也能剥干净', () => {
    expect(originalFileName('0010-第一章 (冲突文件 2026-08-24) (冲突文件 2026-08-25).md')).toBe('0010-第一章.md')
  })
})
