/**
 * 这一坐写了多少、删了多少、净产出多少。
 *
 * 规范：更新文档/10-0.4规划.md §4.5
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么不是「前后字数一减」】
 *
 * 一减只剩净值，而**改稿那天净产出常常是负的** —— 删掉三百字换来
 * 两百字更好的，一减是 -100，看着像一下午白干。
 *
 * 但他确实干了一下午活。所以三个数都要摆出来：
 * **写了多少、删了多少、净多少。** 这正是要让他看见的东西。
 * ─────────────────────────────────────────────────────────────
 *
 * 纯计算，不碰编辑器 —— 累加这种事写错了不会报错，
 * 只会显示一个不对的数字，而作者会当真。
 */

export interface SessionCount {
  /** 敲进去多少字 */
  added: number
  /** 删掉多少字 */
  removed: number
}

export const EMPTY_SESSION: SessionCount = { added: 0, removed: 0 }

/** 净产出。可以是负的 —— 那天在改稿，不是没干活 */
export const netOf = (c: SessionCount): number => c.added - c.removed

/** 累加一次编辑 */
export function addEdit(cur: SessionCount, added: number, removed: number): SessionCount {
  return { added: cur.added + Math.max(0, added), removed: cur.removed + Math.max(0, removed) }
}

/**
 * 说成一句话。
 *
 * 一个字都没动时返回空串 —— 顶栏上挂一个「写了 0 · 删了 0 · 净 0」
 * 只是噪音，他刚打开软件当然是 0。
 */
export function describe(c: SessionCount): string {
  if (c.added === 0 && c.removed === 0) return ''
  const n = netOf(c)
  const parts = [`写了 ${c.added.toLocaleString()}`]
  if (c.removed > 0) parts.push(`删了 ${c.removed.toLocaleString()}`)
  // 只删没写、或者删得比写的多时，净值才值得单说 ——
  // 没删过东西的时候「净」跟「写了」是同一个数，说两遍是废话
  if (c.removed > 0) parts.push(`净 ${n > 0 ? '+' : ''}${n.toLocaleString()}`)
  return parts.join(' · ')
}
