import { describe, it, expect } from 'vitest'
import {
  daysBetween,
  describeMilestone,
  sortMilestones,
  viewMilestone,
  type Milestone,
  type TargetProgress,
} from './index.js'

const ms = (over: Partial<Milestone> = {}): Milestone => ({
  id: 'm1',
  title: '写完第一卷',
  target: { kind: 'volume', path: '书/正文/第一卷' },
  due: null,
  doneManually: false,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

const pg = (done: number, total: number | null, unit = '篇'): TargetProgress => ({ done, total, unit })

const TODAY = '2026-08-26'

describe('daysBetween', () => {
  it('往后数', () => {
    expect(daysBetween('2026-08-26', '2026-08-30')).toBe(4)
  })

  it('同一天是 0', () => {
    expect(daysBetween(TODAY, TODAY)).toBe(0)
  })

  it('过去是负数', () => {
    expect(daysBetween('2026-08-26', '2026-08-20')).toBe(-6)
  })

  it('跨月跨年都对', () => {
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3)
  })
})

describe('viewMilestone · 进度', () => {
  it('按已完成除以总量算百分比', () => {
    const v = viewMilestone(ms(), pg(3, 10), { today: TODAY })
    expect(v.percent).toBe(30)
    expect(v.done).toBe(false)
  })

  it('做满就算完成', () => {
    expect(viewMilestone(ms(), pg(10, 10), { today: TODAY }).done).toBe(true)
  })

  it('【关键】算不出总量时百分比是 null，不是 0', () => {
    // 0% 会让人以为一点没做，而真相是「这个目标没法自动算进度」
    const v = viewMilestone(ms({ target: { kind: 'free' } }), pg(0, null), { today: TODAY })
    expect(v.percent).toBeNull()
  })

  it('手动标完成优先于自动算的进度 —— 作者说完了就是完了', () => {
    expect(viewMilestone(ms({ doneManually: true }), pg(1, 10), { today: TODAY }).done).toBe(true)
  })

  it('百分比不会超过 100', () => {
    expect(viewMilestone(ms(), pg(15, 10), { today: TODAY }).percent).toBe(100)
  })
})

describe('viewMilestone · 截止日', () => {
  it('算得出还剩几天', () => {
    expect(viewMilestone(ms({ due: '2026-08-30' }), pg(1, 10), { today: TODAY }).daysLeft).toBe(4)
  })

  it('今天到期是 0', () => {
    expect(viewMilestone(ms({ due: TODAY }), pg(1, 10), { today: TODAY }).daysLeft).toBe(0)
  })

  it('【关键】过期又没做完才算逾期', () => {
    const late = viewMilestone(ms({ due: '2026-08-20' }), pg(1, 10), { today: TODAY })
    expect(late.overdue).toBe(true)
    const doneLate = viewMilestone(ms({ due: '2026-08-20' }), pg(10, 10), { today: TODAY })
    expect(doneLate.overdue).toBe(false)
  })

  it('没填截止日就不催', () => {
    const v = viewMilestone(ms(), pg(1, 10), { today: TODAY })
    expect(v.daysLeft).toBeNull()
    expect(v.overdue).toBe(false)
  })
})

describe('viewMilestone · 每天还得写多少', () => {
  it('剩余量除以剩余天数', () => {
    const v = viewMilestone(
      ms({ target: { kind: 'words', total: 80000 }, due: '2026-08-30' }),
      pg(40000, 80000, '字'),
      { today: TODAY },
    )
    expect(v.neededPerDay).toBe(10000) // 剩 40000 字、4 天
  })

  it('【关键】已经排掉的请假天数要除外', () => {
    const v = viewMilestone(
      ms({ target: { kind: 'words', total: 80000 }, due: '2026-08-30' }),
      pg(40000, 80000, '字'),
      { today: TODAY, plannedLeaves: 2 },
    )
    expect(v.neededPerDay).toBe(20000) // 只剩 2 天能写
  })

  it('今天就到期时是「今天全干完」', () => {
    const v = viewMilestone(
      ms({ target: { kind: 'words', total: 80000 }, due: TODAY }),
      pg(70000, 80000, '字'),
      { today: TODAY },
    )
    expect(v.neededPerDay).toBe(10000)
  })

  it('按「篇」算的目标不给这个数 —— 写完一篇不是匀速的事', () => {
    const v = viewMilestone(ms({ due: '2026-08-30' }), pg(3, 10, '篇'), { today: TODAY })
    expect(v.neededPerDay).toBeNull()
  })
})

describe('viewMilestone · 按最近速度预计', () => {
  const wordsMs = ms({ target: { kind: 'words', total: 80000 }, due: '2026-08-30' })

  it('剩余量除以日均速度', () => {
    const v = viewMilestone(wordsMs, pg(40000, 80000, '字'), { today: TODAY, dailySpeed: 5000 })
    expect(v.etaDays).toBe(8)
  })

  it('【关键】会晚几天算得出来', () => {
    const v = viewMilestone(wordsMs, pg(40000, 80000, '字'), { today: TODAY, dailySpeed: 5000 })
    expect(v.lateBy).toBe(4) // 要 8 天，只剩 4 天
  })

  it('速度够快时是负数（会提前）', () => {
    const v = viewMilestone(wordsMs, pg(40000, 80000, '字'), { today: TODAY, dailySpeed: 20000 })
    expect(v.lateBy).toBeLessThan(0)
  })

  it('没有速度数据就不给预计，不瞎猜', () => {
    const v = viewMilestone(wordsMs, pg(40000, 80000, '字'), { today: TODAY })
    expect(v.etaDays).toBeNull()
    expect(v.lateBy).toBeNull()
  })

  it('已经完成的不再算预计', () => {
    const v = viewMilestone(wordsMs, pg(80000, 80000, '字'), { today: TODAY, dailySpeed: 5000 })
    expect(v.etaDays).toBeNull()
  })
})

describe('sortMilestones · 要紧的排前面', () => {
  const v = (over: Partial<Milestone>, done = false) =>
    viewMilestone(ms({ ...over, doneManually: done }), pg(1, 10), { today: TODAY })

  it('逾期的排最前', () => {
    const list = sortMilestones([
      v({ id: 'a', due: '2026-09-30' }),
      v({ id: 'b', due: '2026-08-01' }),
    ])
    expect(list[0]!.id).toBe('b')
  })

  it('快到期的排前面', () => {
    const list = sortMilestones([
      v({ id: 'a', due: '2026-09-30' }),
      v({ id: 'b', due: '2026-08-28' }),
    ])
    expect(list[0]!.id).toBe('b')
  })

  it('有截止日的排在没截止日的前面', () => {
    const list = sortMilestones([v({ id: 'a' }), v({ id: 'b', due: '2026-09-30' })])
    expect(list[0]!.id).toBe('b')
  })

  it('【关键】完成的沉到底 —— 它们不需要作者再看一眼', () => {
    const list = sortMilestones([v({ id: 'a' }, true), v({ id: 'b' })])
    expect(list[list.length - 1]!.id).toBe('a')
  })
})

describe('describeMilestone · 一句话', () => {
  it('完成了就一句话', () => {
    expect(describeMilestone(viewMilestone(ms(), pg(10, 10), { today: TODAY }))).toBe('完成了')
  })

  it('带上进度与剩余天数', () => {
    const s = describeMilestone(
      viewMilestone(ms({ due: '2026-08-30' }), pg(3, 10), { today: TODAY }),
    )
    expect(s).toContain('30%')
    expect(s).toContain('还剩 4 天')
  })

  it('逾期说得明白', () => {
    const s = describeMilestone(
      viewMilestone(ms({ due: '2026-08-20' }), pg(3, 10), { today: TODAY }),
    )
    expect(s).toContain('逾期 6 天')
  })

  it('【关键】只在会晚的时候提，早到不邀功', () => {
    const late = describeMilestone(
      viewMilestone(
        ms({ target: { kind: 'words', total: 80000 }, due: '2026-08-30' }),
        pg(40000, 80000, '字'),
        { today: TODAY, dailySpeed: 5000 },
      ),
    )
    expect(late).toContain('会晚 4 天')

    const early = describeMilestone(
      viewMilestone(
        ms({ target: { kind: 'words', total: 80000 }, due: '2026-08-30' }),
        pg(40000, 80000, '字'),
        { today: TODAY, dailySpeed: 40000 },
      ),
    )
    expect(early).not.toContain('晚')
  })

  it('自由事项没进度也有话说', () => {
    const s = describeMilestone(
      viewMilestone(ms({ target: { kind: 'free' } }), pg(0, null), { today: TODAY }),
    )
    expect(s).toBe('还没开始')
  })
})
