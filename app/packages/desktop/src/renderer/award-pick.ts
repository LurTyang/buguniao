/**
 * 挂哪一张奖状 —— 纯计算的那一半。
 *
 * 单独一个文件是为了能不碰 DOM 就测：组件里那份要 `window.bugu`，
 * 而这两条恰恰是「作者会当场看见的错」——
 * 挂着的那张被撤了之后显示空白，和只有一张时点一下换成了空。
 */

import type { Award } from '@bugu/core'

/**
 * 现在该挂哪一张。
 *
 * 没指定就挂**最后拿到的那张** —— 新拿到的奖状自己冒出来，
 * 比「拿了奖但界面上没动静」要好。
 */
export function pickAward(awards: readonly Award[], pinned: string): Award | null {
  if (awards.length === 0) return null
  const hit = awards.find((a) => a.id === pinned)
  // 挂着的那张被撤了：退回最新的一张，别显示空白
  return hit ?? awards[awards.length - 1] ?? null
}

/** 点一下轮到下一张。只有一张时原地不动 —— 不能换成空 */
export function nextAwardId(awards: readonly Award[], current: string): string {
  if (awards.length < 2) return current
  const at = awards.findIndex((a) => a.id === current)
  return awards[(at + 1) % awards.length]?.id ?? current
}
