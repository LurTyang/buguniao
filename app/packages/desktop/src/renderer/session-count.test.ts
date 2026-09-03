/**
 * 这一坐写了多少、删了多少。
 *
 * 累加写错了不会报错，只会显示一个不对的数字 —— 而作者会当真。
 */

import { describe as d, expect, it } from 'vitest'
import { EMPTY_SESSION, addEdit, describe as say, netOf } from './session-count.js'

d('累加', () => {
  it('一开始都是 0', () => {
    expect(EMPTY_SESSION).toEqual({ added: 0, removed: 0 })
  })

  it('写和删分开记', () => {
    let c = addEdit(EMPTY_SESSION, 100, 0)
    c = addEdit(c, 50, 30)
    expect(c).toEqual({ added: 150, removed: 30 })
  })

  it('负数当 0 —— 编辑器给的增删量不该是负的，给了也不能把总数拉回去', () => {
    expect(addEdit(EMPTY_SESSION, -5, -5)).toEqual({ added: 0, removed: 0 })
  })
})

d('净产出', () => {
  it('写得多就是正的', () => {
    expect(netOf({ added: 300, removed: 100 })).toBe(200)
  })

  it('【关键】删得多就是负的 —— 改稿那天本来就是这样，不许瞒着', () => {
    expect(netOf({ added: 100, removed: 300 })).toBe(-200)
  })
})

d('说成一句话', () => {
  it('一个字都没动时什么都不说', () => {
    expect(say(EMPTY_SESSION)).toBe('')
  })

  it('只写没删时不啰嗦「净」—— 那跟「写了」是同一个数', () => {
    expect(say({ added: 1200, removed: 0 })).toBe('写了 1,200')
  })

  it('删过就三个数都摆出来', () => {
    expect(say({ added: 1240, removed: 380 })).toBe('写了 1,240 · 删了 380 · 净 +860')
  })

  it('净是负的也照说 —— 删掉三百字不是没干活', () => {
    expect(say({ added: 100, removed: 300 })).toBe('写了 100 · 删了 300 · 净 -200')
  })
})
