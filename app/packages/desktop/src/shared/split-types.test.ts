/**
 * 便笺的长度闸。
 *
 * 这一条不是「防御性编程」，它挡的是一件具体的事：
 * 便笺存在**配置文件**里，而配置每改一个字段都要把整份 JSON 重写一遍。
 * 让几 MB 正文躺进去，此后每次换主题、拖分隔线都要连它一起重写。
 *
 * 从前 config.ts 的注释指着一个叫 `MAX_SCRATCH` 的常量，
 * 而那个常量**根本没写过** —— 指着不存在的护栏比没有护栏更糟。
 */

import { describe, expect, it } from 'vitest'
import { MAX_SCRATCH, clampScratch } from './split-types.js'

describe('便笺截长', () => {
  it('没超就原样返回 —— 一个字都不改', () => {
    const s = '摆在旁边的一段设定'
    expect(clampScratch(s)).toBe(s)
  })

  it('空的也不炸', () => {
    expect(clampScratch('')).toBe('')
  })

  it('刚好到上限还是原样 —— 边界上不该无缘无故截一刀', () => {
    const s = '字'.repeat(MAX_SCRATCH)
    expect(clampScratch(s)).toBe(s)
  })

  it('【关键】超了就截 —— 不然几 MB 正文会躺进配置文件', () => {
    const s = '字'.repeat(MAX_SCRATCH + 5000)
    const out = clampScratch(s)
    expect(out.startsWith('字'.repeat(MAX_SCRATCH))).toBe(true)
    // 截出来的那段正文本身不超上限（末尾那句说明是额外的）
    expect(out.slice(0, MAX_SCRATCH)).toBe('字'.repeat(MAX_SCRATCH))
  })

  it('【关键】截了要说一声，还要说清楚少了多少 —— 不说他会以为自己粘漏了', () => {
    const out = clampScratch('字'.repeat(MAX_SCRATCH + 5000))
    expect(out).toContain('5000')
    expect(out).toContain(String(MAX_SCRATCH))
  })

  it('截掉的字数报得准', () => {
    for (const extra of [1, 37, 123456]) {
      expect(clampScratch('字'.repeat(MAX_SCRATCH + extra))).toContain(`还有 ${extra} 个字`)
    }
  })
})
