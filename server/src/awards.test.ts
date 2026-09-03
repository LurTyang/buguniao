/**
 * 奖状的规矩。
 *
 * 它不是成就系统：没有清单、没有条件、没有自动判定 ——
 * 由人发给人，纪念一件具体的事。所以这里管的只有两件：
 * **发出去的东西合不合规矩**，和**谁能发**。
 */

import { describe, expect, it } from 'vitest'
import { checkAward, parseAdminSubs, toAwardJson } from './awards.js'

describe('一张奖状合不合规矩', () => {
  it('好的', () => {
    const r = checkAward({ id: 'nano-2026', name: '不咕之星', note: '2026 征文一等奖' })
    expect(r.ok && r.value).toEqual({ id: 'nano-2026', name: '不咕之星', note: '2026 征文一等奖' })
  })

  it('id 统一转小写，前后空白吃掉', () => {
    const r = checkAward({ id: '  NANO-2026 ', name: '不咕之星' })
    expect(r.ok && r.value.id).toBe('nano-2026')
  })

  it('说明可以不写', () => {
    const r = checkAward({ id: 'a1', name: '不咕之星' })
    expect(r.ok && r.value.note).toBe('')
  })

  it('奖名按字数算，不按字节 —— 四个汉字是四个字', () => {
    expect(checkAward({ id: 'a1', name: '不咕之星' }).ok).toBe(true)
    expect(checkAward({ id: 'a1', name: '不' }).ok).toBe(false)
    expect(checkAward({ id: 'a1', name: '一二三四五六七' }).ok).toBe(false)
  })

  it('两个字到六个字都行', () => {
    expect(checkAward({ id: 'a1', name: '冠军' }).ok).toBe(true)
    expect(checkAward({ id: 'a1', name: '年度最佳作者' }).ok).toBe(true)
  })

  it('坏 id 都有说得清的理由', () => {
    for (const id of ['', '-abc', 'a b', '中文', 'A'.repeat(41), '_x']) {
      const r = checkAward({ id, name: '冠军' })
      expect(r.ok, String(id)).toBe(false)
      expect(r.ok === false && r.why.length > 0).toBe(true)
    }
  })

  it('奖名里不许有换行 —— 它要显示在一行上', () => {
    expect(checkAward({ id: 'a1', name: '冠\n军' }).ok).toBe(false)
  })

  it('说明太长要拦', () => {
    expect(checkAward({ id: 'a1', name: '冠军', note: '字'.repeat(201) }).ok).toBe(false)
    expect(checkAward({ id: 'a1', name: '冠军', note: '字'.repeat(200) }).ok).toBe(true)
  })

  it('请求体不是对象也不崩', () => {
    expect(checkAward(null).ok).toBe(false)
    expect(checkAward('冠军').ok).toBe(false)
    expect(checkAward([]).ok).toBe(false)
  })

  it('往外发之前再挑一遍字段', () => {
    const dirty = { id: 'a', name: 'b', note: 'c', at: 'd', 书名: '不该在这儿' } as never
    expect(Object.keys(toAwardJson(dirty)).sort()).toEqual(['at', 'id', 'name', 'note'])
  })
})

describe('谁能发奖', () => {
  it('【关键】没配就是空的 —— 忘了配的后果是发不出去，不是谁都能发', () => {
    expect(parseAdminSubs(undefined).size).toBe(0)
    expect(parseAdminSubs('').size).toBe(0)
    expect(parseAdminSubs('   ').size).toBe(0)
  })

  it('逗号、空格、换行都能分隔', () => {
    const s = parseAdminSubs('abc, def\n ghi')
    expect([...s].sort()).toEqual(['abc', 'def', 'ghi'])
  })
})
