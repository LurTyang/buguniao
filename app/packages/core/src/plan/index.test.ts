/**
 * 计划测试。
 *
 * 盯得最紧的三条：
 *   1. **改了目标之后，以前的日子仍按当天的目标算** —— 不然调一次目标，
 *      整张热力图和连续天数当场全变，那是在骗自己
 *   2. 补签线跟着目标走（倍数），不是写死的绝对字数
 *   3. 请假不断链，但**不算达标** —— 留痕迹，不自欺欺人
 */

import { describe, it, expect } from 'vitest'
import type { DayStat } from '../stats/index.js'
import {
  DEFAULT_TARGET,
  EMPTY_PLAN,
  TARGET_PRESETS,
  hitRate,
  isHit,
  judgeDays,
  keepsStreak,
  presetToTarget,
  recordTargetChange,
  spreadWeek,
  streakOf,
  targetFor,
  weekdayIndex,
  type Plan,
} from './index.js'

const day = (d: string, words: number): DayStat =>
  ({ day: d, words, sessions: 1, pomodoros: 0 }) as unknown as DayStat

/** 2026-08-24 是周一 */
const MON = '2026-08-24'

const planWith = (over: Partial<Plan>): Plan => ({ ...EMPTY_PLAN, ...over })

describe('weekdayIndex · 周一为 0', () => {
  it('周一到周日', () => {
    const days = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30']
    expect(days.map(weekdayIndex)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('【关键】不受本机时区影响', () => {
    // 用 new Date('2026-08-24').getDay() 会按时区解析，UTC-5 的机器上会差一天
    expect(weekdayIndex('2026-08-24')).toBe(0)
    expect(weekdayIndex('2026-01-01')).toBe(3) // 2026-01-01 是周四
  })
})

describe('spreadWeek · 工作日与休息日', () => {
  it('前五天是工作日，后两天是休息日', () => {
    const t = spreadWeek(8000, 12000, 3000, 5000)
    expect(t.floor).toEqual([8000, 8000, 8000, 8000, 8000, 3000, 3000])
    expect(t.ideal).toEqual([12000, 12000, 12000, 12000, 12000, 5000, 5000])
  })

  it('四个档位都在，且随缘档是 0', () => {
    expect(TARGET_PRESETS.map((p) => p.key)).toEqual(['pro', 'semi', 'hobby', 'free'])
    expect(presetToTarget(TARGET_PRESETS[3]!).floor.every((n) => n === 0)).toBe(true)
  })

  it('默认档不吓人 —— 开箱不给一个职业写手的数字', () => {
    expect(DEFAULT_TARGET.floor[0]).toBeLessThan(3000)
  })
})

describe('targetFor · 某天生效的是哪一条', () => {
  const changes = [
    { from: '2026-08-01', target: spreadWeek(3000, 4000, 1000, 2000) },
    { from: '2026-08-20', target: spreadWeek(8000, 12000, 3000, 5000) },
  ]

  it('取 from <= 那天里最晚的一条', () => {
    expect(targetFor('2026-08-24', changes).floor).toBe(8000) // 周一，新目标
    expect(targetFor('2026-08-10', changes).floor).toBe(3000) // 周一，旧目标
  })

  it('生效当天就算新的', () => {
    expect(targetFor('2026-08-20', changes).floor).toBe(8000)
  })

  it('比第一条还早的日子退回默认', () => {
    expect(targetFor('2026-07-01', changes).floor).toBe(DEFAULT_TARGET.floor[2])
  })

  it('工作日与休息日取的是不同的数', () => {
    expect(targetFor('2026-08-29', changes).floor).toBe(3000) // 周六
    expect(targetFor('2026-08-28', changes).floor).toBe(8000) // 周五
  })

  it('一条历史都没有时用默认', () => {
    expect(targetFor(MON, []).floor).toBe(DEFAULT_TARGET.floor[0])
  })
})

describe('recordTargetChange', () => {
  it('按生效日排好序', () => {
    let cs = recordTargetChange([], '2026-08-20', spreadWeek(1, 1, 1, 1))
    cs = recordTargetChange(cs, '2026-08-01', spreadWeek(2, 2, 2, 2))
    expect(cs.map((c) => c.from)).toEqual(['2026-08-01', '2026-08-20'])
  })

  it('同一天改两次只留最后一次', () => {
    let cs = recordTargetChange([], MON, spreadWeek(1000, 1, 1, 1))
    cs = recordTargetChange(cs, MON, spreadWeek(9000, 1, 1, 1))
    expect(cs).toHaveLength(1)
    expect(cs[0]!.target.floor[0]).toBe(9000)
  })
})

describe('judgeDays · 逐日判定', () => {
  const plan = planWith({ targets: [{ from: '2026-08-01', target: spreadWeek(3000, 5000, 1000, 2000) }] })

  it('写够底线算签到', () => {
    expect(judgeDays([day(MON, 3000)], plan)[0]!.verdict).toBe('signed')
  })

  it('写够理想线算今天很棒', () => {
    expect(judgeDays([day(MON, 5000)], plan)[0]!.verdict).toBe('ideal')
  })

  it('写了但没到底线算差一点', () => {
    expect(judgeDays([day(MON, 2999)], plan)[0]!.verdict).toBe('short')
  })

  it('一个字没写算断', () => {
    expect(judgeDays([day(MON, 0)], plan)[0]!.verdict).toBe('missed')
  })

  it('周末用的是休息日的线', () => {
    // 2026-08-29 是周六：底线 1000、理想 2000
    expect(judgeDays([day('2026-08-29', 1200)], plan)[0]!.verdict).toBe('signed')
    expect(judgeDays([day('2026-08-29', 2500)], plan)[0]!.verdict).toBe('ideal')
    // 同样 1200 字，放到周一（底线 3000）就不够
    expect(judgeDays([day(MON, 1200)], plan)[0]!.verdict).toBe('short')
  })

  it('【关键】改了目标之后，以前的日子仍按当天的目标算', () => {
    // 这一条是整个模块存在的理由。不这么做，调一次目标热力图全变
    const p = planWith({
      targets: [
        { from: '2026-08-01', target: spreadWeek(3000, 5000, 1000, 2000) },
        { from: '2026-08-25', target: spreadWeek(8000, 12000, 3000, 5000) },
      ],
    })
    const r = judgeDays([day('2026-08-24', 4000), day('2026-08-25', 4000)], p)
    expect(r[0]!.verdict).toBe('signed') // 那天目标 3000，4000 达标
    expect(r[1]!.verdict).toBe('short') // 这天目标 8000，同样 4000 就不够了
  })

  it('随缘档只记录，不判达标也不算断更', () => {
    const p = planWith({ targets: [{ from: '2026-08-01', target: spreadWeek(0, 0, 0, 0) }] })
    const r = judgeDays([day(MON, 0), day('2026-08-25', 9999)], p)
    expect(r.map((x) => x.verdict)).toEqual(['untracked', 'untracked'])
    expect(r.every((x) => keepsStreak(x.verdict))).toBe(true)
  })
})

describe('补签线跟着目标走', () => {
  it('【关键】补签线是底线的倍数，不是写死的绝对字数', () => {
    // 目标 1000 的人和目标 8000 的人，「今天多写了一倍」含义一样，
    // 绝对值却差八倍
    const small = planWith({ targets: [{ from: '2026-08-01', target: spreadWeek(1000, 2000, 1000, 2000) }] })
    const big = planWith({ targets: [{ from: '2026-08-01', target: spreadWeek(8000, 12000, 8000, 12000) }] })

    expect(judgeDays([day(MON, 2000)], small)[0]!.creditsEarned).toBe(1)
    expect(judgeDays([day(MON, 2000)], big)[0]!.creditsEarned).toBe(0)
    expect(judgeDays([day(MON, 16000)], big)[0]!.creditsEarned).toBe(1)
  })

  it('倍数可以调', () => {
    const p = planWith({ targets: [{ from: '2026-08-01', target: spreadWeek(1000, 2000, 1000, 2000) }] })
    expect(judgeDays([day(MON, 3000)], p, { makeupMultiple: 3 })[0]!.creditsEarned).toBe(1)
  })

  it('额度回补到之前漏掉的日子上', () => {
    const p = planWith({ targets: [{ from: '2026-08-01', target: spreadWeek(1000, 9999, 1000, 9999) }] })
    const r = judgeDays([day('2026-08-24', 4000), day('2026-08-25', 0), day('2026-08-26', 0)], p)
    // 第一天挣了 2 次额度，后两天各补一次
    expect(r[0]!.creditsEarned).toBe(2)
    expect(r[1]!.verdict).toBe('makeup')
    expect(r[2]!.verdict).toBe('makeup')
  })

  it('额度不够就是真断了，不粉饰', () => {
    const p = planWith({ targets: [{ from: '2026-08-01', target: spreadWeek(1000, 9999, 1000, 9999) }] })
    const r = judgeDays([day('2026-08-24', 2000), day('2026-08-25', 0), day('2026-08-26', 0)], p)
    expect(r[1]!.verdict).toBe('makeup')
    expect(r[2]!.verdict).toBe('missed')
  })

  it('【关键】额度只能往前补，不能预支', () => {
    const p = planWith({ targets: [{ from: '2026-08-01', target: spreadWeek(1000, 9999, 1000, 9999) }] })
    const r = judgeDays([day('2026-08-24', 0), day('2026-08-25', 4000)], p)
    // 第二天挣的额度补不了第一天 —— 那是在给昨天的自己发好人卡
    expect(r[0]!.verdict).toBe('missed')
  })
})

describe('请假', () => {
  const p = planWith({
    targets: [{ from: '2026-08-01', target: spreadWeek(3000, 5000, 1000, 2000) }],
    leaves: [{ day: '2026-08-25', reason: '出差' }],
  })

  it('请假日不算断更', () => {
    const r = judgeDays([day('2026-08-25', 0)], p)
    expect(r[0]!.verdict).toBe('leave')
    expect(keepsStreak('leave')).toBe(true)
  })

  it('【关键】请假不算达标 —— 留痕迹，不自欺欺人', () => {
    expect(isHit('leave')).toBe(false)
  })

  it('请假理由带出来，界面上要显示', () => {
    expect(judgeDays([day('2026-08-25', 0)], p)[0]!.leaveReason).toBe('出差')
  })

  it('请假日写了字也照记，热力图上仍看得出他其实写了', () => {
    const r = judgeDays([day('2026-08-25', 4000)], p)
    expect(r[0]!.verdict).toBe('leave')
    expect(r[0]!.words).toBe(4000)
  })

  it('请假日不挣补签额度', () => {
    expect(judgeDays([day('2026-08-25', 20000)], p)[0]!.creditsEarned).toBe(0)
  })
})

describe('streakOf · 连续天数', () => {
  const p = planWith({ targets: [{ from: '2026-08-01', target: spreadWeek(1000, 9999, 1000, 9999) }] })

  /**
   * ⚠️ 这一组里「正常的一天」要写 1500 而不是 2000。
   * 底线 1000、补签线是它的 2 倍 —— 每天写 2000 的话天天挣一次补签额度，
   * 断更全被自动补上，测的就不是连续天数而是补签了。
   */
  const run = (words: number[], today?: string) => {
    const days = words.map((w, i) => day(`2026-08-${String(24 + i).padStart(2, '0')}`, w))
    return streakOf(judgeDays(days, p), today)
  }

  it('连着写就连着数', () => {
    expect(run([1500, 1500, 1500]).current).toBe(3)
  })

  it('中间断了就从断点之后重新数', () => {
    expect(run([1500, 0, 1500]).current).toBe(1)
  })

  it('【关键】今天还没写不算断 —— 今天才刚开始', () => {
    expect(run([1500, 1500, 0], '2026-08-26').current).toBe(2)
  })

  it('但昨天没写就是真断了，不粉饰', () => {
    expect(run([1500, 0, 0], '2026-08-26').current).toBe(0)
  })

  it('历史最长记得住', () => {
    expect(run([1500, 1500, 1500, 0, 1500]).best).toBe(3)
  })

  it('数出连续里有几天是请假撑着的', () => {
    const p2 = planWith({
      targets: [{ from: '2026-08-01', target: spreadWeek(1000, 9999, 1000, 9999) }],
      leaves: [{ day: '2026-08-25', reason: '出差' }],
    })
    const days = [day('2026-08-24', 1500), day('2026-08-25', 0), day('2026-08-26', 1500)]
    const s = streakOf(judgeDays(days, p2))
    expect(s.current).toBe(3)
    expect(s.leaves).toBe(1)
  })

  it('数出连续里有几天是补签来的', () => {
    const days = [day('2026-08-24', 4000), day('2026-08-25', 0)]
    expect(streakOf(judgeDays(days, p)).makeups).toBe(1)
  })

  it('空数据是 0，不是 NaN', () => {
    expect(streakOf([])).toMatchObject({ current: 0, best: 0 })
  })
})

describe('hitRate · 本周几比几', () => {
  const p = planWith({
    targets: [{ from: '2026-08-01', target: spreadWeek(1000, 9999, 1000, 9999) }],
    leaves: [{ day: '2026-08-26', reason: '出差' }],
  })
  const days = [
    day('2026-08-24', 1500),
    day('2026-08-25', 0),
    day('2026-08-26', 0),
    day('2026-08-27', 1500),
  ]

  it('【关键】请假日不算进分母 —— 出差三天不该显示成偷懒', () => {
    const r = hitRate(judgeDays(days, p))
    expect(r).toEqual({ hit: 2, of: 3 })
  })

  it('随缘档整段都不计', () => {
    const free = planWith({ targets: [{ from: '2026-08-01', target: spreadWeek(0, 0, 0, 0) }] })
    expect(hitRate(judgeDays(days, free))).toEqual({ hit: 0, of: 0 })
  })

  it('空数据是 0/0，不是 NaN', () => {
    expect(hitRate([])).toEqual({ hit: 0, of: 0 })
  })
})
