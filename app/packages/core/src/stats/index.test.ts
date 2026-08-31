import { describe, it, expect } from 'vitest'
import {
  writingDayOfSessionStart,
  currentWritingDay,
  addDays,
  DAY_CUTOFF_HOUR,
  SESSION_GAP_MS,
  SIGN_IN_WORDS,
  MAKEUP_WORDS,
  parseStatsJsonl,
  toStatsJsonl,
  mergeStats,
  buildSessions,
  byDay,
  fillDays,
  byWeek,
  byMonth,
  computeSignIns,
  computeStreak,
  todayStat,
  heatmap,
  createStatRecord,
  totalWords,
} from './index.js'
import type { DayStat } from './index.js'
import type { StatRecord } from '../types/index.js'

/** 造一个本地时间戳，避免测试受时区影响 */
const at = (y: number, m: number, d: number, h = 12, min = 0): number =>
  new Date(y, m - 1, d, h, min, 0, 0).getTime()

const R = (o: Partial<StatRecord> & { ts: number; delta: number }): StatRecord => ({
  schemaVersion: 1,
  dev: 'pc-01',
  doc: 'ch-a',
  total: 0,
  session: 's-1',
  ...o,
})

const D = (day: string, words: number): DayStat => ({
  day,
  words,
  saves: 1,
  pomoWords: 0,
  sessions: 1,
  activeMs: 0,
})

// ═════════════════════════ 写作日归属 ═════════════════════════

describe('写作日归属 · 会话起点决定日期', () => {
  it('白天开写算当天', () => {
    expect(writingDayOfSessionStart(at(2026, 8, 25, 14))).toBe('2026-08-25')
  })

  it('凌晨两点开写算前一天', () => {
    expect(writingDayOfSessionStart(at(2026, 8, 26, 2))).toBe('2026-08-25')
  })

  it('凌晨 4 点整开写算新的一天', () => {
    expect(writingDayOfSessionStart(at(2026, 8, 26, DAY_CUTOFF_HOUR))).toBe('2026-08-26')
    expect(writingDayOfSessionStart(at(2026, 8, 26, DAY_CUTOFF_HOUR - 1))).toBe('2026-08-25')
  })

  it('跨月跨年边界正确', () => {
    expect(writingDayOfSessionStart(at(2026, 9, 1, 1))).toBe('2026-08-31')
    expect(writingDayOfSessionStart(at(2027, 1, 1, 1))).toBe('2026-12-31')
  })

  it('currentWritingDay 与之一致', () => {
    expect(currentWritingDay(at(2026, 8, 26, 2))).toBe('2026-08-25')
  })
})

describe('addDays', () => {
  it('前后加减', () => {
    expect(addDays('2026-08-25', 1)).toBe('2026-08-26')
    expect(addDays('2026-08-25', -1)).toBe('2026-08-24')
  })
  it('跨月', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31')
  })
  it('闰年二月', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })
})

// ═════════════════════════ 会话 ═════════════════════════

describe('buildSessions · 会话切分与日期归属', () => {
  it('连续写作算一场', () => {
    const s = buildSessions([
      R({ ts: at(2026, 8, 25, 20, 0), delta: 100 }),
      R({ ts: at(2026, 8, 25, 20, 10), delta: 200 }),
      R({ ts: at(2026, 8, 25, 20, 25), delta: 150 }),
    ])
    expect(s).toHaveLength(1)
    expect(s[0]?.words).toBe(450)
    expect(s[0]?.saves).toBe(3)
  })

  it('中断超过 30 分钟切成两场', () => {
    expect(
      buildSessions([
        R({ ts: at(2026, 8, 25, 20, 0), delta: 100 }),
        R({ ts: at(2026, 8, 25, 21, 0), delta: 200 }),
      ]),
    ).toHaveLength(2)
  })

  it('恰好 30 分钟算同一场', () => {
    expect(
      buildSessions([
        R({ ts: at(2026, 8, 25, 20, 0), delta: 100 }),
        R({ ts: at(2026, 8, 25, 20, 0) + SESSION_GAP_MS, delta: 200 }),
      ]),
    ).toHaveLength(1)
  })

  it('【核心】一场写到第二天中午，整场仍算开始那天', () => {
    // 周一 22:00 开写，每 20 分钟保存一次，一直写到周二 12:00
    const recs: StatRecord[] = []
    for (let i = 0; i * 20 <= 14 * 60; i++) {
      recs.push(R({ ts: at(2026, 8, 24, 22, 0) + i * 20 * 60_000, delta: 100 }))
    }
    const s = buildSessions(recs)
    expect(s).toHaveLength(1)
    expect(s[0]?.day).toBe('2026-08-24')
    expect(s[0]?.crossedMidnight).toBe(true)
  })

  it('凌晨 3 点重新开写仍算前一天', () => {
    const s = buildSessions([
      R({ ts: at(2026, 8, 24, 23, 0), delta: 100 }),
      R({ ts: at(2026, 8, 25, 3, 0), delta: 100 }), // 中断 4 小时 → 新的一场
    ])
    expect(s).toHaveLength(2)
    expect(s.map((x) => x.day)).toEqual(['2026-08-24', '2026-08-24'])
  })

  it('凌晨 5 点重新开写才算新的一天', () => {
    const s = buildSessions([
      R({ ts: at(2026, 8, 24, 23, 0), delta: 100 }),
      R({ ts: at(2026, 8, 25, 5, 0), delta: 100 }),
    ])
    expect(s.map((x) => x.day)).toEqual(['2026-08-24', '2026-08-25'])
  })

  it('计算持续时长与字/小时', () => {
    const s = buildSessions(
      [R({ ts: at(2026, 8, 25, 20, 0), delta: 0 }), R({ ts: at(2026, 8, 25, 21, 0), delta: 3000 })],
      { gapMs: 2 * 3600_000 },
    )
    expect(s[0]?.durationMs).toBe(3600_000)
    expect(s[0]?.wordsPerHour).toBe(3000)
  })

  it('记录涉及的所有文档，不重复', () => {
    const s = buildSessions([
      R({ ts: at(2026, 8, 25, 20, 0), delta: 1, doc: 'ch-a' }),
      R({ ts: at(2026, 8, 25, 20, 5), delta: 1, doc: 'ch-b' }),
      R({ ts: at(2026, 8, 25, 20, 9), delta: 1, doc: 'ch-a' }),
    ])
    expect(s[0]?.docs).toEqual(['ch-a', 'ch-b'])
  })

  it('任一次保存在番茄钟内则整场标记为 pomo', () => {
    const s = buildSessions([
      R({ ts: at(2026, 8, 25, 20, 0), delta: 1 }),
      R({ ts: at(2026, 8, 25, 20, 5), delta: 1, pomo: true }),
    ])
    expect(s[0]?.pomo).toBe(true)
  })

  it('输入乱序也能正确切分', () => {
    const s = buildSessions([
      R({ ts: at(2026, 8, 25, 21, 0), delta: 2 }),
      R({ ts: at(2026, 8, 25, 20, 0), delta: 1 }),
    ])
    expect(s).toHaveLength(2)
    expect(s[0]?.words).toBe(1)
  })

  it('空输入', () => {
    expect(buildSessions([])).toEqual([])
  })
})

// ═════════════════════════ 按日聚合 ═════════════════════════

describe('byDay · 按会话归属聚合', () => {
  it('【核心】通宵写作全部算在开写那天', () => {
    const recs: StatRecord[] = []
    for (let i = 0; i < 30; i++) {
      recs.push(R({ ts: at(2026, 8, 24, 22, 0) + i * 20 * 60_000, delta: 500 }))
    }
    const days = byDay(recs)
    expect(days).toHaveLength(1)
    expect(days[0]?.day).toBe('2026-08-24')
    expect(days[0]?.words).toBe(15000)
  })

  it('同一天的多场合并', () => {
    const days = byDay([
      R({ ts: at(2026, 8, 25, 10), delta: 1000 }),
      R({ ts: at(2026, 8, 25, 15), delta: 2000 }),
      R({ ts: at(2026, 8, 25, 22), delta: 3000 }),
    ])
    expect(days[0]?.words).toBe(6000)
    expect(days[0]?.sessions).toBe(3)
  })

  it('统计保存次数与场次', () => {
    const days = byDay([
      R({ ts: at(2026, 8, 25, 10, 0), delta: 100 }),
      R({ ts: at(2026, 8, 25, 10, 5), delta: 100 }),
      R({ ts: at(2026, 8, 25, 20, 0), delta: 100 }),
    ])
    expect(days[0]?.saves).toBe(3)
    expect(days[0]?.sessions).toBe(2)
  })

  it('单独统计番茄钟内的产出', () => {
    const days = byDay([
      R({ ts: at(2026, 8, 25, 10), delta: 1000 }),
      R({ ts: at(2026, 8, 25, 10, 10), delta: 800, pomo: true }),
    ])
    expect(days[0]?.pomoWords).toBe(800)
  })

  it('按日期升序', () => {
    const days = byDay([R({ ts: at(2026, 8, 27, 10), delta: 1 }), R({ ts: at(2026, 8, 25, 10), delta: 1 })])
    expect(days.map((d) => d.day)).toEqual(['2026-08-25', '2026-08-27'])
  })

  it('净增可以为负', () => {
    const days = byDay([
      R({ ts: at(2026, 8, 25, 10, 0), delta: 1000 }),
      R({ ts: at(2026, 8, 25, 10, 5), delta: -1500 }),
    ])
    expect(days[0]?.words).toBe(-500)
  })
})

describe('fillDays / byWeek / byMonth', () => {
  it('把没写的日子补成 0', () => {
    const days = byDay([R({ ts: at(2026, 8, 25, 10), delta: 1000 }), R({ ts: at(2026, 8, 28, 10), delta: 500 })])
    expect(fillDays(days, '2026-08-25', '2026-08-28').map((d) => d.words)).toEqual([1000, 0, 0, 500])
  })

  it('单日区间', () => {
    expect(fillDays([], '2026-08-25', '2026-08-25')).toHaveLength(1)
  })

  it('跨闰年二月补齐', () => {
    expect(fillDays([], '2028-02-27', '2028-03-01').map((d) => d.day)).toEqual([
      '2028-02-27',
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ])
  })

  it('区间反了不死循环', () => {
    expect(fillDays([], '2026-08-28', '2026-08-25')).toEqual([])
  })

  it('按周聚合，周一为一周之始', () => {
    // 2026-08-24 是周一
    const days = [D('2026-08-24', 100), D('2026-08-30', 200), D('2026-08-31', 300)]
    expect(byWeek(days)).toEqual([
      { weekStart: '2026-08-24', words: 300 },
      { weekStart: '2026-08-31', words: 300 },
    ])
  })

  it('按月聚合', () => {
    expect(byMonth([D('2026-08-25', 100), D('2026-08-26', 200), D('2026-09-01', 300)])).toEqual([
      { month: '2026-08', words: 300 },
      { month: '2026-09', words: 300 },
    ])
  })
})

// ═════════════════════════ 签到与补签 ═════════════════════════

describe('computeSignIns · 签到与补签', () => {
  it('写够 5000 字签到成功', () => {
    expect(computeSignIns([D('2026-08-25', SIGN_IN_WORDS)])[0]?.state).toBe('signed')
  })

  it('差一个字也不算', () => {
    expect(computeSignIns([D('2026-08-25', SIGN_IN_WORDS - 1)])[0]?.state).toBe('missed')
  })

  it('写够 10000 字额外产生 1 次补签额度', () => {
    expect(computeSignIns([D('2026-08-25', MAKEUP_WORDS)])[0]?.creditsEarned).toBe(1)
  })

  it('写 20000 字产生 2 次补签额度', () => {
    expect(computeSignIns([D('2026-08-25', 2 * MAKEUP_WORDS)])[0]?.creditsEarned).toBe(2)
  })

  it('【核心】今天写一万，补上昨天漏掉的一天', () => {
    const s = computeSignIns([
      D('2026-08-23', 6000), // 签到
      D('2026-08-24', 0), // 漏了
      D('2026-08-25', 10000), // 签到 + 1 次补签额度
    ])
    expect(s.map((x) => x.state)).toEqual(['signed', 'makeup', 'signed'])
  })

  it('补签额度只补更早的日子，不补更晚的', () => {
    const s = computeSignIns([
      D('2026-08-23', 10000), // 签到 + 额度
      D('2026-08-24', 0), // 漏了，但额度在它之前，补不了
    ])
    expect(s.map((x) => x.state)).toEqual(['signed', 'missed'])
  })

  it('额度不够时只补最近的，更早的仍算断', () => {
    const s = computeSignIns([
      D('2026-08-22', 0),
      D('2026-08-23', 0),
      D('2026-08-24', 0),
      D('2026-08-25', 10000), // 只有 1 次额度
    ])
    expect(s.map((x) => x.state)).toEqual(['missed', 'missed', 'makeup', 'signed'])
  })

  it('写两万可以补两天', () => {
    const s = computeSignIns([
      D('2026-08-23', 0),
      D('2026-08-24', 0),
      D('2026-08-25', 20000),
    ])
    expect(s.map((x) => x.state)).toEqual(['makeup', 'makeup', 'signed'])
  })

  it('断点之前攒的额度作废，不允许跨大坑修历史', () => {
    const s = computeSignIns([
      D('2026-08-20', 0), // 想补这天
      D('2026-08-21', 0), // 和这天
      D('2026-08-22', 0), // 还有这天 —— 额度用光了，真断
      D('2026-08-23', 0), // 被补
      D('2026-08-24', 20000), // 2 次额度
    ])
    expect(s.map((x) => x.state)).toEqual(['missed', 'missed', 'makeup', 'makeup', 'signed'])
  })

  it('可以关闭补签', () => {
    const s = computeSignIns([D('2026-08-24', 0), D('2026-08-25', 50000)], { makeupWords: 0 })
    expect(s.map((x) => x.state)).toEqual(['missed', 'signed'])
  })

  it('签到线可自定义', () => {
    expect(computeSignIns([D('2026-08-25', 2000)], { signInWords: 1000 })[0]?.state).toBe('signed')
  })

  it('净增为负的那天算断（不粉饰）', () => {
    expect(computeSignIns([D('2026-08-25', -500)])[0]?.state).toBe('missed')
  })

  it('空输入', () => {
    expect(computeSignIns([])).toEqual([])
  })
})

describe('computeStreak · 连续天数', () => {
  it('连续三天签到', () => {
    const s = computeStreak(
      [D('2026-08-23', 6000), D('2026-08-24', 6000), D('2026-08-25', 6000)],
      '2026-08-25',
    )
    expect(s.current).toBe(3)
    expect(s.longest).toBe(3)
    expect(s.currentMakeups).toBe(0)
  })

  it('【核心】补签让连续天数接得上', () => {
    const s = computeStreak(
      [D('2026-08-23', 6000), D('2026-08-24', 0), D('2026-08-25', 10000)],
      '2026-08-25',
    )
    expect(s.current).toBe(3)
    expect(s.currentMakeups).toBe(1)
  })

  it('如实报告有几天是补签来的', () => {
    const s = computeStreak(
      [D('2026-08-22', 6000), D('2026-08-23', 0), D('2026-08-24', 0), D('2026-08-25', 20000)],
      '2026-08-25',
    )
    expect(s.current).toBe(4)
    expect(s.currentMakeups).toBe(2)
  })

  it('额度不够就是真断了', () => {
    const s = computeStreak(
      [D('2026-08-22', 6000), D('2026-08-23', 0), D('2026-08-24', 0), D('2026-08-25', 6000)],
      '2026-08-25',
    )
    expect(s.current).toBe(1)
  })

  it('【体贴】今天还没写时从昨天起算，不判断更', () => {
    const s = computeStreak([D('2026-08-23', 6000), D('2026-08-24', 6000)], '2026-08-25')
    expect(s.current).toBe(2)
    expect(s.todaySigned).toBe(false)
  })

  it('昨天也没写就是真断了', () => {
    expect(computeStreak([D('2026-08-23', 6000)], '2026-08-25').current).toBe(0)
  })

  it('报告今天还差多少字签到', () => {
    const s = computeStreak([D('2026-08-25', 3000)], '2026-08-25')
    expect(s.wordsToSignIn).toBe(SIGN_IN_WORDS - 3000)
    expect(s.todaySigned).toBe(false)
  })

  it('今天已签到时差额为 0', () => {
    const s = computeStreak([D('2026-08-25', 8000)], '2026-08-25')
    expect(s.wordsToSignIn).toBe(0)
    expect(s.todaySigned).toBe(true)
  })

  it('记录最后一次签到成功的日子', () => {
    const s = computeStreak([D('2026-08-20', 6000), D('2026-08-24', 6000)], '2026-08-25')
    expect(s.lastSignedDay).toBe('2026-08-24')
  })

  it('最长连续与当前连续可以不同', () => {
    const days = [
      D('2026-08-10', 6000),
      D('2026-08-11', 6000),
      D('2026-08-12', 6000),
      D('2026-08-13', 6000),
      D('2026-08-14', 0),
      D('2026-08-15', 0),
      D('2026-08-16', 0),
      D('2026-08-24', 6000),
      D('2026-08-25', 6000),
    ]
    const s = computeStreak(days, '2026-08-25')
    expect(s.current).toBe(2)
    expect(s.longest).toBe(4)
  })

  it('跨月连续正确', () => {
    const s = computeStreak(
      [D('2026-08-30', 6000), D('2026-08-31', 6000), D('2026-09-01', 6000)],
      '2026-09-01',
    )
    expect(s.current).toBe(3)
  })

  it('从没写过', () => {
    expect(computeStreak([], '2026-08-25')).toMatchObject({ current: 0, longest: 0, lastSignedDay: null })
  })
})

// ═════════════════════════ 今日与热力图 ═════════════════════════

describe('todayStat', () => {
  const days = [D('2026-08-25', 3200)]

  it('计算完成百分比', () => {
    expect(todayStat(days, '2026-08-25', 4000)).toMatchObject({ words: 3200, percent: 80, reached: false })
  })

  it('达标时 reached 为 true', () => {
    expect(todayStat(days, '2026-08-25', 3000).reached).toBe(true)
  })

  it('没设目标时不算百分比', () => {
    expect(todayStat(days, '2026-08-25', 0)).toMatchObject({ percent: 0, reached: false })
  })

  it('单独报告签到状态与补签额度', () => {
    expect(todayStat([D('2026-08-25', 12000)], '2026-08-25', 4000)).toMatchObject({
      signedIn: true,
      makeupCredits: 1,
    })
  })

  it('今天还没写', () => {
    expect(todayStat(days, '2026-08-26', 4000).words).toBe(0)
  })
})

describe('heatmap', () => {
  it('没写的日子等级为 0', () => {
    expect(heatmap([D('2026-08-25', 0)])[0]?.level).toBe(0)
  })

  it('【关键】等级按分位数切分，适应不同产量的作者', () => {
    const small = heatmap([100, 200, 300, 400].map((w, i) => D(`2026-08-0${i + 1}`, w)))
    const large = heatmap([10000, 20000, 30000, 40000].map((w, i) => D(`2026-08-0${i + 1}`, w)))
    expect(small.map((c) => c.level)).toEqual(large.map((c) => c.level))
  })

  it('等级覆盖 1~4', () => {
    const cells = heatmap(
      Array.from({ length: 20 }, (_, i) => D(`2026-08-${String(i + 1).padStart(2, '0')}`, (i + 1) * 100)),
    )
    expect(new Set(cells.map((c) => c.level))).toEqual(new Set([1, 2, 3, 4]))
  })

  it('带出签到状态，界面可以给补签的日子画特殊标记', () => {
    const cells = heatmap([D('2026-08-23', 6000), D('2026-08-24', 0), D('2026-08-25', 10000)])
    expect(cells.map((c) => c.state)).toEqual(['signed', 'makeup', 'signed'])
  })

  it('空输入', () => {
    expect(heatmap([])).toEqual([])
  })
})

// ═════════════════════════ 其他 ═════════════════════════

describe('jsonl 与总字数', () => {
  it('往返一致', () => {
    const recs = [createStatRecord({ ts: 1, dev: 'pc', doc: 'ch-a', delta: 100, total: 100, session: 's1' })]
    expect(parseStatsJsonl(toStatsJsonl(recs))).toEqual(recs)
  })

  it('坏行跳过', () => {
    expect(parseStatsJsonl('{"ts":1,"delta":5,"doc":"ch-a"}\n坏行{{{\n{"ts":2,"delta":6,"doc":"ch-a"}')).toHaveLength(2)
  })

  it('pomo 为 false 时不写入该字段', () => {
    expect(createStatRecord({ ts: 1, dev: 'pc', doc: 'ch-a', delta: 1, total: 1, session: 's' })).not.toHaveProperty('pomo')
  })

  it('mergeStats 合并多设备分片并排序', () => {
    const pc = [R({ ts: 300, delta: 3 }), R({ ts: 100, delta: 1 })]
    const laptop = [R({ ts: 200, delta: 2, dev: 'pc-02' })]
    expect(mergeStats([pc, laptop]).map((r) => r.ts)).toEqual([100, 200, 300])
  })

  it('totalWords 取每篇最后一条记录的 total 相加', () => {
    expect(
      totalWords([
        R({ ts: 100, delta: 500, total: 500, doc: 'ch-a' }),
        R({ ts: 200, delta: 300, total: 800, doc: 'ch-a' }),
        R({ ts: 150, delta: 1000, total: 1000, doc: 'ch-b' }),
      ]),
    ).toBe(1800)
  })

  it('totalWords 空输入为 0', () => {
    expect(totalWords([])).toBe(0)
  })
})

// ═════════════════════════ 真实场景 ═════════════════════════

describe('真实场景', () => {
  it('一个通宵写手的一周', () => {
    const recs: StatRecord[] = []
    // 周一到周五，每晚 22:00 开写，写到次日 2:00（每 30 分钟保存 1000 字）
    for (let d = 24; d <= 28; d++) {
      for (let i = 0; i <= 8; i++) {
        recs.push(R({ ts: at(2026, 8, d, 22, 0) + i * 30 * 60_000, delta: 1000 }))
      }
    }

    const days = byDay(recs)
    // 五个通宵 → 五天，每天 9000 字，全部归到开写那天
    expect(days.map((d) => d.day)).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
    ])
    expect(days.every((d) => d.words === 9000)).toBe(true)

    const streak = computeStreak(days, '2026-08-28')
    expect(streak.current).toBe(5)
    expect(streak.currentMakeups).toBe(0)
  })

  it('时断时续、靠补签续命的一个月', () => {
    const days: DayStat[] = []
    for (let d = 1; d <= 25; d++) {
      // 每周咕一天，但周末爆更两万把它补回来
      const day = `2026-08-${String(d).padStart(2, '0')}`
      if (d % 7 === 0) days.push(D(day, 0))
      else if (d % 7 === 1) days.push(D(day, 20000))
      else days.push(D(day, 6000))
    }

    const streak = computeStreak(days, '2026-08-25')
    // 每次咕的那天都被后一天的爆更补上了 → 全月不断
    expect(streak.current).toBe(25)
    expect(streak.currentMakeups).toBe(3)
  })

  it('聚合结果与热力图一致', () => {
    const recs: StatRecord[] = []
    for (let d = 1; d <= 10; d++) {
      recs.push(R({ ts: at(2026, 8, d, 20), delta: d * 1000, total: d * 1000 }))
    }
    const days = fillDays(byDay(recs), '2026-08-01', '2026-08-10')
    const cells = heatmap(days)
    expect(cells).toHaveLength(10)
    expect(cells.map((c) => c.words)).toEqual(days.map((d) => d.words))
  })
})
