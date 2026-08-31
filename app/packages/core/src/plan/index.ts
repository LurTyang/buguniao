/**
 * 码字计划：目标线、工作日/休息日、请假、里程碑。
 *
 * 规范：更新文档/05-功能模块详述.md §8.5
 *
 * ─────────────────────────────────────────────────────────────
 * 【这个模块最要紧的一条：目标改了，以前的日子按当天的目标算】
 *
 * 作者今天把目标从 3000 调到 8000，昨天写的 4000 还算不算达标？
 * 必须**算**。所以目标要留一份变更历史，每天用那天生效的那条判定。
 *
 * 不这么做的话，调一次目标，整张热力图和连续天数当场全变 ——
 * 那是在骗自己，而这个软件的名字就叫「不咕」。
 * ─────────────────────────────────────────────────────────────
 *
 * 另外两条：
 *   - **补签线跟着目标走**，按倍数不按绝对字数。目标 8000 时还用写死的
 *     10000 当补签线，那补签就太容易了。
 *   - **请假留痕迹**。热力图上画成中性色，不是绿也不是空白 ——
 *     连续天数不断，但一眼看得出那天没写。
 */

import type { DayStat } from '../stats/index.js'

// ───────────────────────── 目标 ─────────────────────────

/**
 * 一周七天的目标，**从周一起**。
 *
 * 用七天数组而不是「工作日/休息日」两个数：有人周末才是主力写作时间，
 * 有人周三固定上班带不了电脑。界面上给「工作日 / 休息日」的快捷填法，
 * 底下存的是这七个数。
 */
export interface WeekTarget {
  /** 底线。写够就算达标、签到、接上连续天数 */
  floor: [number, number, number, number, number, number, number]
  /** 理想线。写够了这天在热力图上更深一档 */
  ideal: [number, number, number, number, number, number, number]
}

/** 一次目标变更。从 `from` 这天（含）起生效 */
export interface TargetChange {
  /** `YYYY-MM-DD` */
  from: string
  target: WeekTarget
}

export interface DayTarget {
  floor: number
  ideal: number
}

/** 常见档位。**只是帮作者少打几个字**，选完每个数都还能改 */
export interface TargetPreset {
  key: string
  label: string
  note: string
  weekdayFloor: number
  weekdayIdeal: number
  restFloor: number
  restIdeal: number
}

export const TARGET_PRESETS: TargetPreset[] = [
  {
    key: 'pro',
    label: '职业',
    note: '靠这个吃饭。工作日 8000 保底，12000 算今天很棒',
    weekdayFloor: 8000,
    weekdayIdeal: 12000,
    restFloor: 4000,
    restIdeal: 8000,
  },
  {
    key: 'semi',
    label: '半职业',
    note: '有正职，但当第二份工作在写',
    weekdayFloor: 3000,
    weekdayIdeal: 5000,
    restFloor: 5000,
    restIdeal: 8000,
  },
  {
    key: 'hobby',
    label: '业余',
    note: '写着玩，但不想断',
    weekdayFloor: 1000,
    weekdayIdeal: 2000,
    restFloor: 2000,
    restIdeal: 4000,
  },
  {
    key: 'free',
    label: '随缘',
    note: '不设目标，只记录。热力图照画，不判达标也不算断更',
    weekdayFloor: 0,
    weekdayIdeal: 0,
    restFloor: 0,
    restIdeal: 0,
  },
]

/** 把「工作日 / 休息日」两个数摊成七天 */
export function spreadWeek(
  weekdayFloor: number,
  weekdayIdeal: number,
  restFloor: number,
  restIdeal: number,
): WeekTarget {
  return {
    floor: [weekdayFloor, weekdayFloor, weekdayFloor, weekdayFloor, weekdayFloor, restFloor, restFloor],
    ideal: [weekdayIdeal, weekdayIdeal, weekdayIdeal, weekdayIdeal, weekdayIdeal, restIdeal, restIdeal],
  }
}

export function presetToTarget(p: TargetPreset): WeekTarget {
  return spreadWeek(p.weekdayFloor, p.weekdayIdeal, p.restFloor, p.restIdeal)
}

/** 默认档位：业余。开箱不该给一个吓人的数字 */
export const DEFAULT_TARGET = presetToTarget(TARGET_PRESETS[2]!)

/**
 * `YYYY-MM-DD` 是星期几，**周一为 0**。
 *
 * 不用 `new Date(day).getDay()` —— 那会按本机时区解析，
 * 跨时区或夏令时的机器上会差一天。写作日本来就是自己算的，别再引进时区问题。
 */
export function weekdayIndex(day: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  // Zeller 之类不必要，直接用 UTC 构造，纯日期没有时区含义
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=周日
  return (dow + 6) % 7 // 转成周一=0
}

/**
 * 某一天生效的目标。
 *
 * 取 `from <= day` 里最晚的那一条。一条都没有时退回默认。
 */
export function targetFor(day: string, changes: readonly TargetChange[]): DayTarget {
  let picked: WeekTarget = DEFAULT_TARGET
  let bestFrom = ''
  for (const c of changes) {
    if (c.from <= day && c.from >= bestFrom) {
      bestFrom = c.from
      picked = c.target
    }
  }
  const i = weekdayIndex(day)
  return { floor: picked.floor[i] ?? 0, ideal: picked.ideal[i] ?? 0 }
}

/**
 * 记一次目标变更。
 *
 * 同一天改两次只留最后一次 —— 作者在设置里来回调数字是常事，
 * 每调一下留一条会把历史撑成一堆噪音。
 */
export function recordTargetChange(
  changes: readonly TargetChange[],
  from: string,
  target: WeekTarget,
): TargetChange[] {
  return [...changes.filter((c) => c.from !== from), { from, target }].sort((a, b) =>
    a.from.localeCompare(b.from),
  )
}

// ───────────────────────── 请假 ─────────────────────────

export interface LeaveDay {
  /** `YYYY-MM-DD` */
  day: string
  reason: string
}

/**
 * 作者自己的一点信息。
 *
 * 跟目标一样是「人」的属性，所以和计划存在一起、跟着同步走 ——
 * 换台电脑昵称也还在。这里**不存任何账号、密码、邮箱**：
 * 这软件没有账号体系，也不该有。
 */
export interface Profile {
  nickname: string
}

/** 整份计划。存成库根目录下的 `_计划.yaml`，跟着同步走 */
export interface Plan {
  schemaVersion: number
  profile: Profile
  targets: TargetChange[]
  leaves: LeaveDay[]
}

export const EMPTY_PLAN: Plan = {
  schemaVersion: 1,
  profile: { nickname: '' },
  targets: [],
  leaves: [],
}

// ───────────────────────── 每天怎么判 ─────────────────────────

export type DayVerdict =
  /** 写够理想线 */
  | 'ideal'
  /** 写够底线 */
  | 'signed'
  /** 没写够，但被补签额度补上了 */
  | 'makeup'
  /** 请假。不断链，但也不算达标 —— 热力图上画中性色 */
  | 'leave'
  /** 写了一些但没到底线 */
  | 'short'
  /** 一个字没写 */
  | 'missed'
  /** 没设目标（随缘档）。只记录，不判 */
  | 'untracked'

export interface DayJudgement {
  day: string
  words: number
  target: DayTarget
  verdict: DayVerdict
  /** 该日挣到的补签额度 */
  creditsEarned: number
  leaveReason: string
}

export interface JudgeOptions {
  /**
   * 补签线 = 底线 × 这个倍数。默认 2 倍。
   *
   * 写死一个绝对字数是不行的：目标 1000 的人和目标 8000 的人，
   * 「今天多写了一倍」的含义完全一样，绝对值却差八倍。
   */
  makeupMultiple?: number
}

const DEFAULT_MAKEUP_MULTIPLE = 2

/**
 * 逐日判定，并把补签额度回补到之前漏掉的日子上。
 *
 * `days` 要按日期升序，且**把没写的日子也填进来**（words: 0）——
 * 缺了那些日子就看不出断更。
 */
export function judgeDays(
  days: readonly DayStat[],
  plan: Plan,
  opts: JudgeOptions = {},
): DayJudgement[] {
  const multiple = opts.makeupMultiple ?? DEFAULT_MAKEUP_MULTIPLE
  const leaveBy = new Map(plan.leaves.map((l) => [l.day, l.reason]))

  const out: DayJudgement[] = days.map((d) => {
    const target = targetFor(d.day, plan.targets)
    const leaveReason = leaveBy.get(d.day)

    let verdict: DayVerdict
    let creditsEarned = 0

    if (target.floor <= 0) {
      // 随缘档：只记录，不判达标也不算断更
      verdict = 'untracked'
    } else if (leaveReason !== undefined) {
      // 请假日就算写了字也算请假 —— 作者标了假就是给自己免责，
      // 但字数照记，热力图上仍能看出他其实写了
      verdict = 'leave'
    } else if (d.words >= target.ideal && target.ideal > 0) {
      verdict = 'ideal'
    } else if (d.words >= target.floor) {
      verdict = 'signed'
    } else if (d.words > 0) {
      verdict = 'short'
    } else {
      verdict = 'missed'
    }

    if (target.floor > 0 && multiple > 0 && verdict !== 'leave') {
      creditsEarned = Math.floor(d.words / (target.floor * multiple))
    }

    return {
      day: d.day,
      words: d.words,
      target,
      verdict,
      creditsEarned,
      leaveReason: leaveReason ?? '',
    }
  })

  // 补签：从前往后攒额度，遇到没达标的日子就花一次补上
  let credits = 0
  for (const j of out) {
    if (j.verdict === 'signed' || j.verdict === 'ideal') {
      credits += j.creditsEarned
    } else if ((j.verdict === 'short' || j.verdict === 'missed') && credits > 0) {
      credits -= 1
      j.verdict = 'makeup'
    }
  }

  return out
}

/** 这一天算不算「链子没断」 */
export function keepsStreak(v: DayVerdict): boolean {
  return v === 'ideal' || v === 'signed' || v === 'makeup' || v === 'leave' || v === 'untracked'
}

/**
 * 一段时间里达标了几天。
 *
 * 「本周 5/7」这种。**请假不算达标**，所以分母是那几天里
 * 真正要求写字的天数（把请假日刨掉）—— 出差三天还显示 4/7
 * 会让作者觉得自己在偷懒，而他并没有。
 */
export function hitRate(judged: readonly DayJudgement[]): { hit: number; of: number } {
  let hit = 0
  let of = 0
  for (const j of judged) {
    if (j.verdict === 'leave' || j.verdict === 'untracked') continue
    of += 1
    if (isHit(j.verdict)) hit += 1
  }
  return { hit, of }
}

/** 这一天算不算「真的达标了」。请假不算 */
export function isHit(v: DayVerdict): boolean {
  return v === 'ideal' || v === 'signed' || v === 'makeup'
}

export interface StreakInfo2 {
  /** 当前连续天数 */
  current: number
  /** 历史最长 */
  best: number
  /** 当前连续里有几天是请假撑着的 */
  leaves: number
  /** 当前连续里有几天是补签来的 */
  makeups: number
}

/**
 * 连续天数。
 *
 * 从最后一天往前数。**今天还没写不算断** —— 今天才刚开始，
 * 不该因为还没动笔就把昨天为止的努力清零；但昨天没写就是真断了，不粉饰。
 */
export function streakOf(judged: readonly DayJudgement[], today?: string): StreakInfo2 {
  let current = 0
  let leaves = 0
  let makeups = 0

  for (let i = judged.length - 1; i >= 0; i--) {
    const j = judged[i]!
    // 今天还没写：跳过，从昨天开始数
    if (today !== undefined && j.day === today && !isHit(j.verdict) && j.verdict !== 'leave') continue
    if (!keepsStreak(j.verdict)) break
    current += 1
    if (j.verdict === 'leave') leaves += 1
    if (j.verdict === 'makeup') makeups += 1
  }

  let best = 0
  let run = 0
  for (const j of judged) {
    if (keepsStreak(j.verdict)) {
      run += 1
      if (run > best) best = run
    } else {
      run = 0
    }
  }

  return { current, best, leaves, makeups }
}
