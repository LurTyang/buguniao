/**
 * 双屏那点算术与规矩的测试。
 *
 * 最要紧的是 `rightSaves` 那一条：判错了就是**两条保存链路抢同一个文件**，
 * 而且两边内容一样，看不出错 —— 直到某一次时序不巧，
 * 丢掉的是刚敲进去的那几句。这种错不能靠肉眼发现。
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_RATIO,
  MAX_RATIO,
  MIN_RATIO,
  clampRatio,
  isSameDoc,
  needsLink,
  paneMode,
  ratioFromDrag,
  rightFollowsLeft,
  rightPersistsScratch,
  rightSaves,
  type RightSide,
} from './split.js'

const doc = (path: string): RightSide => ({ kind: 'doc', path })
const file = (path: string): RightSide => ({ kind: 'file', path })
const scratch = (): RightSide => ({ kind: 'scratch', path: '' })

describe('分隔线的位置', () => {
  it('夹在 0.2–0.8 之间 —— 再窄一行中文都摆不下', () => {
    expect(clampRatio(0.01)).toBe(MIN_RATIO)
    expect(clampRatio(0.99)).toBe(MAX_RATIO)
    expect(clampRatio(0.5)).toBe(0.5)
  })

  it('拿到脏数据时退回一半一半，而不是把界面挤没', () => {
    expect(clampRatio(Number.NaN)).toBe(DEFAULT_RATIO)
    expect(clampRatio(Number.POSITIVE_INFINITY)).toBe(DEFAULT_RATIO)
  })

  it('按鼠标位置算比例', () => {
    expect(ratioFromDrag(300, 1000)).toBeCloseTo(0.3)
    expect(ratioFromDrag(50, 1000)).toBe(MIN_RATIO)
  })

  it('宽度是 0 时不做除法 —— 窗口刚建出来那一帧就是 0', () => {
    expect(ratioFromDrag(100, 0)).toBe(DEFAULT_RATIO)
  })
})

describe('是不是同一份文档', () => {
  it('路径一模一样才算', () => {
    expect(isSameDoc('正文/0010-第一章.md', doc('正文/0010-第一章.md'))).toBe(true)
    expect(isSameDoc('正文/0010-第一章.md', doc('正文/0020-第二章.md'))).toBe(false)
  })

  it('外部文件永远不算 —— 就算路径看着一样', () => {
    // 书里的相对路径和硬盘上的绝对路径不是一个东西，凑巧相等也不能当成同一份
    expect(isSameDoc('a.md', file('a.md'))).toBe(false)
  })

  it('哪边空着都不算', () => {
    expect(isSameDoc(null, doc('a.md'))).toBe(false)
    expect(isSameDoc('a.md', null)).toBe(false)
  })
})

describe('右半边处于哪种状态', () => {
  it('没开就是 off', () => {
    expect(paneMode(false, 'a.md', doc('b.md'))).toBe('off')
  })

  it('开了还没选东西就是 empty', () => {
    expect(paneMode(true, 'a.md', null)).toBe('empty')
    expect(paneMode(true, 'a.md', doc(''))).toBe('empty')
  })

  it('另一篇是 own，同一篇是 shared', () => {
    expect(paneMode(true, 'a.md', doc('b.md'))).toBe('own')
    expect(paneMode(true, 'a.md', doc('a.md'))).toBe('shared')
  })

  it('【关键】外部文件算 ref —— 只读，绝不往书外面的文件写', () => {
    expect(paneMode(true, 'a.md', file('D:/别处/资料.md'))).toBe('ref')
    expect(rightSaves('ref')).toBe(false)
  })

  it('便笺没有路径，但空着也算「有东西」—— 粘进来之前那一格就该是它', () => {
    expect(paneMode(true, 'a.md', scratch())).toBe('scratch')
  })
})

describe('【关键】谁负责存盘', () => {
  it('同一份文档时右边绝不自己存 —— 两条链路抢一个文件会静默丢稿', () => {
    expect(rightSaves('shared')).toBe(false)
  })

  it('是另一份文档时右边自己存', () => {
    expect(rightSaves('own')).toBe(true)
  })

  it('【关键】书外的文件一律不写 —— 那可能是别人给的稿子', () => {
    expect(rightSaves('ref')).toBe(false)
  })

  it('没开、空着都不存', () => {
    expect(rightSaves('off')).toBe(false)
    expect(rightSaves('empty')).toBe(false)
  })

  it('【关键】便笺不写文件 —— 它压根不对应硬盘上任何东西', () => {
    expect(rightSaves('scratch')).toBe(false)
  })

  it('便笺存进配置，别的都不', () => {
    expect(rightPersistsScratch('scratch')).toBe(true)
    for (const m of ['off', 'empty', 'own', 'shared', 'ref'] as const) {
      expect(rightPersistsScratch(m)).toBe(false)
    }
  })
})

describe('什么时候要接那根线', () => {
  it('只有同一份文档才接', () => {
    expect(needsLink('shared')).toBe(true)
    expect(needsLink('own')).toBe(false)
    expect(needsLink('off')).toBe(false)
    expect(needsLink('empty')).toBe(false)
  })

  it('「接线」和「自己存」是互斥的 —— 两个都真就是那个丢稿的组合', () => {
    for (const m of ['off', 'empty', 'own', 'shared', 'scratch', 'ref'] as const) {
      expect(needsLink(m) && rightSaves(m)).toBe(false)
    }
  })
})

describe('左边换文档时右边不跟', () => {
  it('永远不跟 —— 摆在右边就是要一直看着它', () => {
    expect(rightFollowsLeft()).toBe(false)
  })
})
