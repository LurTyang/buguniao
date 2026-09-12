/**
 * 标点替换的规则。
 *
 * 这一层出的错是「作者打出来的字被悄悄换成了别的」——
 * 不报错、不提示，只有他自己在通读的时候才会发现。
 *
 * 0.4 里作者定死了两条设计：
 *   - **规则存在即生效，不存在即删除**，没有开关
 *   - 出厂那几条**没有特殊地位**，一样能改能删
 */

import { describe, expect, it } from 'vitest'
import {
  SEED_RULES,
  liveRules,
  makeRule,
  pairSide,
  replaceOn,
  shownAs,
  wrapWith,
  WRAP_PAIRS,
  WRAP_SAME,
  type PairRule,
  type Rule,
} from './smart-replace.js'

const DEF = liveRules(SEED_RULES, true)
const only = (id: string): Rule[] => DEF.filter((r) => r.id === id)

describe('成对的符号', () => {
  it('单引号打出双引号，第一个是开的', () => {
    expect(replaceOn('他说：', "'", DEF)?.insert).toBe('“')
  })

  it('第二个是关引号', () => {
    expect(replaceOn('他说：“你好', "'", DEF)?.insert).toBe('”')
  })

  it('关上之后再打又是开的', () => {
    expect(replaceOn('他说：“你好”，然后', "'", DEF)?.insert).toBe('“')
  })

  it('双引号打出直角引号', () => {
    expect(replaceOn('', '"', DEF)?.insert).toBe('「')
    expect(replaceOn('「里头', '"', DEF)?.insert).toBe('」')
  })

  it('小于号打出书名号', () => {
    expect(replaceOn('看了', '<', DEF)?.insert).toBe('《')
    expect(replaceOn('看了《红楼', '<', DEF)?.insert).toBe('》')
  })

  it('数的是这一行 —— 上一行的引号不影响这一行', () => {
    const q = SEED_RULES.find((r) => r.id === 'squote-to-dquote') as PairRule
    expect(pairSide('“没关上', q)).toBe('close')
    expect(pairSide('', q)).toBe('open')
  })
})

describe('直来直去的替换', () => {
  it('分号变冒号 —— 中文里分号远不如冒号常用', () => {
    expect(replaceOn('他说', ';', DEF)).toEqual({ back: 0, insert: '：', ruleId: 'semi-to-colon' })
  })

  it('打第二个减号时变破折号，并把第一个删掉', () => {
    expect(replaceOn('他说-', '-', only('dash'))).toEqual({ back: 1, insert: '——', ruleId: 'dash' })
  })

  it('打第三个句点时变省略号，往回删两个', () => {
    expect(replaceOn('然后..', '.', only('ellipsis'))).toEqual({
      back: 2,
      insert: '……',
      ruleId: 'ellipsis',
    })
  })

  it('只打一个减号不动它 —— 那可能是个连字符', () => {
    expect(replaceOn('他说', '-', only('dash'))).toBeNull()
  })
})

describe('存在即生效，不存在即删除', () => {
  it('【关键】规则里没有 enabled —— 「关掉」和「删掉」不该是两个操作', () => {
    for (const r of SEED_RULES) expect('enabled' in r).toBe(false)
  })

  it('总开关关着时一条都不生效', () => {
    expect(liveRules(SEED_RULES, false)).toEqual([])
    expect(replaceOn('他说：', '"', [])).toBeNull()
  })

  it('删掉一条它就不生效了', () => {
    const rest = DEF.filter((r) => r.id !== 'semi-to-colon')
    expect(replaceOn('他说', ';', rest)).toBeNull()
  })

  it('【关键】「打什么」是空的直接丢掉 —— 空 from 会匹配每一次输入', () => {
    const bad = [makeRule('', 'x', 'c1')]
    expect(liveRules(bad, true)).toEqual([])
    expect(replaceOn('随便', '字', liveRules(bad, true))).toBeNull()
  })
})

describe('什么时候不插手', () => {
  it('【关键】输入法一次上屏一整个词时不插手', () => {
    expect(replaceOn('', '你好', DEF)).toBeNull()
    expect(replaceOn('然后..', '..', DEF)).toBeNull()
  })

  it('普通汉字什么都不做', () => {
    expect(replaceOn('他说', '好', DEF)).toBeNull()
  })
})

describe('出厂那几条', () => {
  it('每个触发键只出现一次 —— 抢同一个键会「时灵时不灵」', () => {
    const keys = SEED_RULES.map((r) => r.from)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('表格里「变成什么」那一格怎么显示', () => {
    expect(shownAs(SEED_RULES.find((r) => r.id === 'dquote-to-corner')!)).toBe('「」')
    expect(shownAs(SEED_RULES.find((r) => r.id === 'dash')!)).toBe('——')
  })
})

describe('自己加的规则', () => {
  it('加一条就生效', () => {
    const mine = [...SEED_RULES, makeRule('~~', '～', 'c1')]
    expect(replaceOn('啊~', '~', liveRules(mine, true))).toEqual({
      back: 1,
      insert: '～',
      ruleId: 'c1',
    })
  })

  it('排在前面的先匹配 —— 顺序就是优先级', () => {
    const mine = [makeRule('"', 'X', 'c1'), ...SEED_RULES]
    expect(replaceOn('', '"', liveRules(mine, true))?.ruleId).toBe('c1')
  })
})

describe('配置文件会变老，这一层不许被它炸', () => {
  it('【关键】老的开关对象喂进来当没有，不抛 —— 抛了就是整块稿纸白屏', () => {
    expect(liveRules({ 'quote-curly': true } as never, true)).toEqual([])
    expect(() => liveRules({} as never, true)).not.toThrow()
  })

  it('null / undefined / 字符串都当没有', () => {
    expect(liveRules(null, true)).toEqual([])
    expect(liveRules(undefined, true)).toEqual([])
    expect(liveRules('乱写的' as never, true)).toEqual([])
  })

  it('数组里混进 null 不影响别的规则', () => {
    expect(liveRules([null, makeRule(';', '：', 'a')] as never, true)).toHaveLength(1)
  })
})

describe('选中一段字再打符号：裹起来，不是换掉', () => {
  it('【关键】引号给的是一对，不是一个', () => {
    expect(wrapWith("'", DEF)).toEqual({ open: '“', close: '”' })
    expect(wrapWith('"', DEF)).toEqual({ open: '「', close: '」' })
  })

  it('【关键】书名号也是一对', () => {
    expect(wrapWith('<', DEF)).toEqual({ open: '《', close: '》' })
  })

  it('【关键】裹第二次还是一对 —— 不数这一行里已有几个引号', () => {
    // 光标是点的时候要交替（pairSide），裹选区时**绝不能**交替：
    // 交替一次就给出 ”句子”，两个都是关引号，而且看着很像对的
    expect(wrapWith("'", DEF)).toEqual(wrapWith("'", DEF))
  })

  it('Markdown 那几个前后一样：* _ ~ 反引号', () => {
    expect(wrapWith('*', DEF)).toEqual({ open: '*', close: '*' })
    expect(wrapWith('~', DEF)).toEqual({ open: '~', close: '~' })
    expect(wrapWith('_', DEF)).toEqual({ open: '_', close: '_' })
    expect(wrapWith('`', DEF)).toEqual({ open: '`', close: '`' })
  })

  it('输入法直接上屏的中文标点也认', () => {
    expect(wrapWith('“', [])).toEqual({ open: '“', close: '”' })
    expect(wrapWith('《', [])).toEqual({ open: '《', close: '》' })
    expect(wrapWith('【', [])).toEqual({ open: '【', close: '】' })
  })

  it('【关键】上屏的是关的那一半，照样给一整对', () => {
    // 输入法记着上一个引号，这一下给你的是 ”。人的意思没变
    expect(wrapWith('”', [])).toEqual({ open: '“', close: '”' })
    expect(wrapWith('》', [])).toEqual({ open: '《', close: '》' })
  })

  it('【关键】总开关关着时，裹这件事不跟着关', () => {
    // 关掉的是「把我打的符号换成中文标点」，不是「可以把我选中的字吃掉」
    expect(wrapWith('"', liveRules(SEED_RULES, false))).toEqual({ open: '"', close: '"' })
    expect(wrapWith('*', [])).toEqual({ open: '*', close: '*' })
  })

  it('作者改了规则，裹出来的跟着改', () => {
    const mine = liveRules([{ id: 'c1', kind: 'pair', from: "'", open: '『', close: '』' }], true)
    expect(wrapWith("'", mine)).toEqual({ open: '『', close: '』' })
  })

  it('裹不了的照旧不插手 —— 汉字、句号，那时候人确实是想改写', () => {
    expect(wrapWith('好', DEF)).toBeNull()
    expect(wrapWith('。', DEF)).toBeNull()
    expect(wrapWith('；', DEF)).toBeNull()
  })

  it('【关键】直来直去的替换规则不参与 —— 它没有开关两头', () => {
    // ; → ： 裹不了东西：裹出来会是 ：句子：
    expect(wrapWith(';', DEF)).toBeNull()
  })

  it('输入法一次上屏一整个词时不插手', () => {
    expect(wrapWith('你好', DEF)).toBeNull()
    expect(wrapWith('', DEF)).toBeNull()
  })

  it('两张内置表不许抢同一个字符 —— 抢了就「时灵时不灵」', () => {
    const both = [...WRAP_PAIRS.flatMap((p) => [p.open, p.close]), ...WRAP_SAME]
    expect(new Set(both).size).toBe(both.length)
  })
})
