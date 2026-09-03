/**
 * 挂哪一张奖状。
 *
 * 逻辑很小，但两条边界都是「作者会当场看见的错」：
 * 挂着的那张被撤了之后显示空白，以及只有一张时点了会换成空。
 */

import { describe, expect, it } from 'vitest'
import type { Award } from '@bugu/core'
import { nextAwardId, pickAward } from './award-pick.js'

const a = (id: string, name: string): Award => ({ id, name, note: '', at: `2026-01-0${id}` })
const THREE = [a('1', '亚军'), a('2', '冠军'), a('3', '不咕之星')]

describe('挂哪一张', () => {
  it('一张都没有就不挂 —— 界面上什么都不显示', () => {
    expect(pickAward([], '')).toBeNull()
    expect(pickAward([], 'nope')).toBeNull()
  })

  it('挂指定的那张', () => {
    expect(pickAward(THREE, '2')?.name).toBe('冠军')
  })

  it('没指定就挂最新拿到的那张 —— 新奖状会自己冒出来', () => {
    expect(pickAward(THREE, '')?.name).toBe('不咕之星')
  })

  it('【关键】挂着的那张被撤了，退回最新的，不显示空白', () => {
    expect(pickAward(THREE, '已经撤了')?.name).toBe('不咕之星')
  })

  it('只有一张时就挂它', () => {
    expect(pickAward([a('1', '冠军')], '')?.name).toBe('冠军')
  })
})

describe('点一下换下一张', () => {
  it('按顺序轮，到头绕回第一张', () => {
    expect(nextAwardId(THREE, '1')).toBe('2')
    expect(nextAwardId(THREE, '2')).toBe('3')
    expect(nextAwardId(THREE, '3')).toBe('1')
  })

  it('【关键】只有一张时点了不动 —— 不能换成空', () => {
    const one = [a('1', '冠军')]
    expect(nextAwardId(one, '1')).toBe('1')
    expect(nextAwardId([], '')).toBe('')
  })

  it('当前那张已经不在名单里时，从头开始', () => {
    expect(nextAwardId(THREE, '已经撤了')).toBe('1')
  })
})
