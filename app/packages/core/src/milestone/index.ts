/**
 * 里程碑：多少天写完大纲、写完这一卷。
 *
 * 规范：更新文档/05-功能模块详述.md §8.6
 *
 * ─────────────────────────────────────────────────────────────
 * 【作者要的主要是「写完某个东西」，不是「写够多少字」】
 *
 * 原话：「更多是写作完毕〈大纲-人物〉、写作完毕〈第一卷〉等等。」
 *
 * 所以里程碑首先是**盯住一个具体对象**：某一卷、某个设定分类、某一篇。
 * 进度 = 那个对象里写了内容的文档占比。字数目标和章节数目标也留着，
 * 但它们是次要的。
 * ─────────────────────────────────────────────────────────────
 *
 * 「还要多少天」这类判断**纯算术就够**，不需要 AI：
 * 剩余量 ÷ 最近的日均速度。AI 只在「这一卷大概还要多少字」
 * 这种要读正文才知道的事情上才有价值，而且必须可关。
 */

/** 里程碑盯住什么 */
export type MilestoneTarget =
  /** 某一卷：卷目录路径 */
  | { kind: 'volume'; path: string }
  /** 某个设定分类，比如「大纲-人物」 */
  | { kind: 'category'; path: string }
  /** 某一篇文档 */
  | { kind: 'doc'; path: string }
  /** 纯字数目标 */
  | { kind: 'words'; total: number }
  /** 章节数目标 */
  | { kind: 'chapters'; total: number }
  /** 自由事项，完没完作者自己勾 */
  | { kind: 'free' }

export interface Milestone {
  id: string
  title: string
  target: MilestoneTarget
  /** 截止日 `YYYY-MM-DD`。不填就只算进度不催 */
  due: string | null
  /** 作者手动标的完成。自由事项只靠它；别的类型可以用它提前收工 */
  doneManually: boolean
  createdAt: number
  updatedAt: number
}

/** 一个对象当前的完成情况，由外面（读得到文件的那一层）算好传进来 */
export interface TargetProgress {
  /** 已完成的量 */
  done: number
  /** 总量。算不出来时为 null（比如自由事项） */
  total: number | null
  /** 单位，显示用：篇 / 字 / 章 */
  unit: string
}

export interface MilestoneView extends Milestone {
  progress: TargetProgress
  /** 0–100。算不出总量时为 null */
  percent: number | null
  done: boolean
  /** 距截止日还有几天。今天到期是 0，过期是负数 */
  daysLeft: number | null
  /** 逾期且没完成 */
  overdue: boolean
  /**
   * 要按时完成，每天还得写多少 —— 只对字数类目标算得出来。
   * 剩余天数为 0 时是「今天全干完」。
   */
  neededPerDay: number | null
  /** 按最近的速度，预计还要几天 */
  etaDays: number | null
  /** 按最近的速度，会比截止日晚几天。提前完成是负数 */
  lateBy: number | null
}

/** 两个 `YYYY-MM-DD` 之间差几天 */
export function daysBetween(from: string, to: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number]
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((p(to) - p(from)) / 86_400_000)
}

export interface ViewOptions {
  /** 今天，`YYYY-MM-DD` */
  today: string
  /**
   * 最近的日均字数。用来估「还要几天」。
   *
   * 取最近若干天的**净增**平均值，由调用方算好 —— 用哪几天是策略问题，
   * 不该埋在这里。为 0 或没有时不给预计。
   */
  dailySpeed?: number
  /** 截止日之前已经排掉的请假天数，算「每天还得写多少」时要除外 */
  plannedLeaves?: number
}

/**
 * 把一个里程碑算成界面能直接显示的样子。
 *
 * 几个刻意的决定：
 *   - **算不出总量时 percent 是 null，不是 0**。0% 会让人以为一点没做，
 *     而真相是「这个目标没法自动算进度」。
 *   - 手动标完成优先于自动算出来的进度。作者说完了就是完了。
 */
export function viewMilestone(
  m: Milestone,
  progress: TargetProgress,
  opts: ViewOptions,
): MilestoneView {
  const total = progress.total
  const percent =
    total === null || total <= 0 ? null : Math.min(100, Math.round((progress.done / total) * 100))

  const done = m.doneManually || (total !== null && total > 0 && progress.done >= total)

  const daysLeft = m.due === null ? null : daysBetween(opts.today, m.due)
  const overdue = !done && daysLeft !== null && daysLeft < 0

  const remaining = total === null ? null : Math.max(0, total - progress.done)

  let neededPerDay: number | null = null
  if (!done && remaining !== null && daysLeft !== null && progress.unit !== '篇') {
    const usable = Math.max(0, daysLeft) - (opts.plannedLeaves ?? 0)
    neededPerDay = usable <= 0 ? remaining : Math.ceil(remaining / usable)
  }

  let etaDays: number | null = null
  const speed = opts.dailySpeed ?? 0
  if (!done && remaining !== null && speed > 0 && progress.unit === '字') {
    etaDays = Math.ceil(remaining / speed)
  }

  const lateBy = etaDays !== null && daysLeft !== null ? etaDays - daysLeft : null

  return {
    ...m,
    progress,
    percent,
    done,
    daysLeft,
    overdue,
    neededPerDay,
    etaDays,
    lateBy,
  }
}

/**
 * 排序：**要紧的排前面**。
 *
 * 逾期 → 快到期 → 有截止日 → 没截止日 → 已完成。
 * 已完成的沉到底 —— 它们不需要作者再看一眼。
 */
export function sortMilestones(views: readonly MilestoneView[]): MilestoneView[] {
  const rank = (v: MilestoneView): number => {
    if (v.done) return 4
    if (v.overdue) return 0
    if (v.daysLeft !== null) return 1
    return 2
  }
  return [...views].sort((a, b) => {
    const r = rank(a) - rank(b)
    if (r !== 0) return r
    if (a.daysLeft !== null && b.daysLeft !== null && a.daysLeft !== b.daysLeft) {
      return a.daysLeft - b.daysLeft
    }
    return a.createdAt - b.createdAt
  })
}

/** 一句话说清一个里程碑现在什么状况。界面上直接用 */
export function describeMilestone(v: MilestoneView): string {
  if (v.done) return '完成了'

  const bits: string[] = []
  if (v.percent !== null) bits.push(`${v.percent}%`)
  if (v.progress.total !== null) {
    bits.push(`${v.progress.done}/${v.progress.total} ${v.progress.unit}`)
  }

  if (v.daysLeft === null) {
    return bits.length > 0 ? bits.join('　') : '还没开始'
  }

  if (v.overdue) {
    bits.push(`已经逾期 ${-v.daysLeft} 天`)
    return bits.join('　')
  }

  bits.push(v.daysLeft === 0 ? '今天到期' : `还剩 ${v.daysLeft} 天`)
  if (v.neededPerDay !== null && v.neededPerDay > 0) {
    bits.push(`每天要 ${v.neededPerDay.toLocaleString()} ${v.progress.unit}`)
  }
  // 只在**会晚**的时候说，早到就不必邀功了 —— 提醒的价值在于坏消息
  if (v.lateBy !== null && v.lateBy > 0) {
    bits.push(`按最近的速度会晚 ${v.lateBy} 天`)
  }
  return bits.join('　')
}
