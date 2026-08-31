/**
 * 「哪几个数可以对外」这件事，只在这一个函数里说了算。
 *
 * 规范：更新文档/08-账号与对外接口.md
 *
 * 单独拎出来是因为它是**唯一一处**决定「作者的什么东西会离开这台电脑」。
 * 散在各处的话，某天有人顺手加个 `currentBook` 就没人拦得住了。
 *
 * 作者的原话：「只吐作者允许公开的那几个数（连胜、今日/本周字数、目标），
 * 不能顺带把书名、章节名带出去。」
 */

import type { PublicStats } from '@bugu/core'

/** planReport() 里这个函数用得到的那几项 */
export interface PlanReportLike {
  today: string
  todayWords: number
  todayTarget: { floor: number; ideal: number }
  judged: Array<{ day: string; words: number }>
  streak: { current: number; best: number }
  daysSinceStart: number
}

/** 本周从哪天算起。按周一算 —— 中文语境里「本周」默认是周一到周日 */
export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return day
  // getUTCDay: 0 是周日，要把它算成第 7 天
  const back = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

/**
 * 从计划总览里挑出**可以对外的那七个数**。
 *
 * 这里是显式构造，不是从 report 里 spread —— 加字段必须是有人专门来改
 * 这个函数，而不是别处多了个字段就自动跟着漏出去。
 */
export function publicStatsFrom(r: PlanReportLike): PublicStats {
  const from = weekStart(r.today)
  let weekWords = 0
  for (const d of r.judged) {
    if (d.day >= from && d.day <= r.today) weekWords += d.words
  }
  return {
    date: r.today,
    todayWords: r.todayWords,
    weekWords,
    streak: r.streak.current,
    bestStreak: r.streak.best,
    dailyFloor: r.todayTarget.floor,
    daysTogether: r.daysSinceStart,
  }
}
