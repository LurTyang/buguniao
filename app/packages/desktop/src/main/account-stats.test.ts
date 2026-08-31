/**
 * 「哪几个数可以对外」。
 *
 * 这个文件盯的是一件事：**作者的作品信息不许离开这台电脑**。
 * 书名、章节名、正文一个字都不能出现在上传的东西里。
 */

import { describe, it, expect } from 'vitest'
import { publicStatsFrom, weekStart, type PlanReportLike } from './account-stats.js'

const report = (over: Partial<PlanReportLike> = {}): PlanReportLike => ({
  today: '2026-08-26', // 周三
  todayWords: 1200,
  todayTarget: { floor: 1000, ideal: 3000 },
  judged: [
    { day: '2026-08-23', words: 900 }, // 上周日
    { day: '2026-08-24', words: 1500 }, // 周一
    { day: '2026-08-25', words: 800 },
    { day: '2026-08-26', words: 1200 },
    { day: '2026-08-27', words: 999 }, // 还没到的日子
  ],
  streak: { current: 9, best: 21 },
  daysSinceStart: 47,
  ...over,
})

describe('本周从哪天算起', () => {
  it('周一算第一天', () => {
    expect(weekStart('2026-08-26')).toBe('2026-08-24')
    expect(weekStart('2026-08-24')).toBe('2026-08-24')
  })

  it('【关键】周日算上一周的最后一天，不是新一周的第一天', () => {
    // 按周日起算的话，周日那天的字数会被算进「下周」，
    // 作者周日写完看到「本周 0 字」会以为数据丢了
    expect(weekStart('2026-08-23')).toBe('2026-08-17')
  })

  it('日期坏了就原样返回，不炸', () => {
    expect(weekStart('随便写的')).toBe('随便写的')
  })
})

describe('挑出来的那几个数', () => {
  it('本周只算周一到今天', () => {
    // 1500 + 800 + 1200；上周日的 900 和明天的 999 都不算
    expect(publicStatsFrom(report()).weekWords).toBe(3500)
  })

  it('连胜、目标、一起写了多少天都带上', () => {
    expect(publicStatsFrom(report())).toMatchObject({
      date: '2026-08-26',
      todayWords: 1200,
      streak: 9,
      bestStreak: 21,
      dailyFloor: 1000,
      daysTogether: 47,
    })
  })

  it('没设目标时底线是 0', () => {
    expect(publicStatsFrom(report({ todayTarget: { floor: 0, ideal: 0 } })).dailyFloor).toBe(0)
  })

  it('一天都没写过也算得出来', () => {
    const s = publicStatsFrom(report({ judged: [], todayWords: 0, streak: { current: 0, best: 0 } }))
    expect(s.weekWords).toBe(0)
    expect(s.streak).toBe(0)
  })

  it('【关键】上传的字段就是那七个，一个不多', () => {
    // 加字段必须是有人专门来改 publicStatsFrom，
    // 而不是别处多了个字段就自动跟着漏出去
    expect(Object.keys(publicStatsFrom(report())).sort()).toEqual(
      [
        'bestStreak',
        'dailyFloor',
        'date',
        'daysTogether',
        'streak',
        'todayWords',
        'weekWords',
      ].sort(),
    )
  })

  it('【关键】report 里多带的东西不会跟着出去', () => {
    const dirty = {
      ...report(),
      currentBook: '第九神座',
      chapter: '第七章 血战',
      books: ['甲', '乙'],
    }
    const out = JSON.stringify(publicStatsFrom(dirty as PlanReportLike))
    expect(out).not.toContain('第九神座')
    expect(out).not.toContain('第七章')
    expect(out).not.toContain('books')
  })
})
