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
  baseName,
  MAX_RATIO,
  MIN_RATIO,
  clampRatio,
  isSameDoc,
  needsLink,
  paneMode,
  ratioFromDrag,
  rightFollowsLeft,
  rightCounts,
  rightPersistsScratch,
  rightSaves,
  safeToSave,
  countsName,
  countsSide,
  shownCounts,
  ZERO_COUNTS,
  type Counts,
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

describe('存之前核对「手里这份是不是就是它」', () => {
  it('对得上才存', () => {
    expect(safeToSave('own', '甲.md', '甲.md')).toBe(true)
  })

  it('【关键】手里还是上一篇 → 绝不存 —— 存了就是一篇覆盖另一篇', () => {
    expect(safeToSave('own', '甲.md', '乙.md')).toBe(false)
  })

  it('【关键】还没读到任何内容 → 绝不存 —— 空内容存下去等于清空这一篇', () => {
    expect(safeToSave('own', null, '乙.md')).toBe(false)
  })

  it('不该自己存的那几种，对得上也不存', () => {
    for (const m of ['off', 'empty', 'shared', 'scratch', 'ref'] as const) {
      expect(safeToSave(m, '甲.md', '甲.md')).toBe(false)
    }
  })

  it('没有路径就没得存', () => {
    expect(safeToSave('own', '', '')).toBe(false)
  })

  it('比 rightSaves 只严不松 —— 它说不存的，这儿一定也不存', () => {
    for (const m of ['off', 'empty', 'own', 'shared', 'scratch', 'ref'] as const) {
      if (!rightSaves(m)) expect(safeToSave(m, '甲.md', '甲.md')).toBe(false)
    }
  })
})

describe('从路径里抠文件名', () => {
  it('书里的路径用 /', () => {
    expect(baseName('正文/0003-第三章 出门.md')).toBe('0003-第三章 出门.md')
  })

  it('【关键】Windows 的反斜杠也要切 —— 拖进来的参考文件就长这样', () => {
    expect(baseName('D:\\参考\\旧稿.txt')).toBe('旧稿.txt')
    expect(baseName('C:\\Users\\某人\\Desktop\\设定.md')).toBe('设定.md')
  })

  it('混着用也认', () => {
    expect(baseName('D:\\参考/子目录\\稿.txt')).toBe('稿.txt')
  })

  it('本来就只有一段就原样给回去', () => {
    expect(baseName('稿.md')).toBe('稿.md')
  })

  it('末尾多一个分隔符不该切出空串来', () => {
    expect(baseName('正文/子目录/')).toBe('子目录')
    expect(baseName('D:\\参考\\')).toBe('参考')
  })

  it('空的不炸', () => {
    expect(baseName('')).toBe('')
  })
})

describe('左边换文档时右边不跟', () => {
  it('永远不跟 —— 摆在右边就是要一直看着它', () => {
    expect(rightFollowsLeft()).toBe(false)
  })
})

describe('字数：光标在哪一篇就数哪一篇', () => {
  const c = (w: number, n: number): Counts => ({ withPunctuation: w, withoutPunctuation: n })
  const L = c(3200, 2800)
  const R = c(800, 700)

  it('没开双屏时右边没有自己的字数 —— 根本没有右边', () => {
    expect(rightCounts('off')).toBe(false)
    expect(rightCounts('empty')).toBe(false)
  })

  it('右边是另一篇、是便笺、是书外参考，各有各的一份字数', () => {
    expect(rightCounts('own')).toBe(true)
    expect(rightCounts('scratch')).toBe(true)
    expect(rightCounts('ref')).toBe(true)
  })

  it('光标在左边就数左边', () => {
    expect(countsSide('own', 'left')).toBe('left')
    expect(shownCounts(L, R, 'own', 'left')).toEqual(L)
  })

  it('【关键】光标在右边就数右边 —— 不再是两边合计', () => {
    // 合计的毛病：右边摆一份两千字的参考，这个数就凭空多两千，
    // 而「这一章写到三千了没有」正是作者盯着它要问的那件事
    expect(countsSide('own', 'right')).toBe('right')
    expect(shownCounts(L, R, 'own', 'right')).toEqual(R)
    expect(shownCounts(L, R, 'ref', 'right')).toEqual(R)
    expect(shownCounts(L, R, 'scratch', 'right')).toEqual(R)
  })

  it('⚠️ 同一份文档的两个视图：光标在哪边都数同一篇', () => {
    // 左右是同一章的两个视图，光标挪到右边并没有换一篇 ——
    // 这时候报「右边」既是错的，也会让那一章的字数看着像变了
    expect(countsSide('shared', 'right')).toBe('left')
    expect(shownCounts(L, c(3200, 2800), 'shared', 'right')).toEqual(L)
    expect(countsName('shared', 'right')).toBe('本章')
  })

  it('右边还没读到（null）就先报左边，不报 0', () => {
    // 读盘是异步的。报 0 的话，点到右边那一瞬会先闪一个 0 再跳到真数 ——
    // 而 0 这个数在字数这件事上看着就像「稿子没了」
    expect(shownCounts(L, null, 'own', 'right')).toEqual(L)
  })

  it('右边空着（0 字）就老实报 0 —— 那是真的 0', () => {
    expect(shownCounts(L, ZERO_COUNTS, 'own', 'right')).toEqual(ZERO_COUNTS)
  })

  it('数字旁边写着数的是哪一篇 —— 不写的话它看着就是在乱跳', () => {
    expect(countsName('off', 'left')).toBe('本章')
    expect(countsName('own', 'left')).toBe('本章')
    expect(countsName('own', 'right')).toBe('右边')
    expect(countsName('ref', 'right')).toBe('右边')
  })

  it('右半边关掉之后，「在右边」这个状态不该还能生效', () => {
    // 界面那边靠这一条把焦点收回左边（splitMode 变了就重置）
    expect(countsSide('off', 'right')).toBe('left')
    expect(countsSide('empty', 'right')).toBe('left')
  })
})
