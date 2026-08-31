/**
 * 写作统计聚合。
 *
 * 规范：更新文档/03-数据格式规范.md §7，05-功能模块详述.md §8
 *
 * 数据来自 `.bugu/stats/{deviceId}.jsonl`，仅追加，多设备分片。
 * 本模块负责把这些流水记录聚合成界面要的曲线、热力图、连续天数。
 *
 * ─────────────────────────────────────────────────────────────
 * 【写作日的归属规则 —— 2026-08-25 由作者定稿】
 *
 * 「今天」不是按日历切的，是**按写作会话**切的：
 *
 *   凌晨 4 点之后的**首次落笔**（或中断半小时以上后的再次落笔），
 *   才开启新的一天。这一场写下去的所有字，都算这一天的 ——
 *   哪怕一时兴起写到第二天中午十二点。
 *
 * 所以判定顺序是：**先切会话，再给会话定日期，记录跟着会话走。**
 * 不是给每条记录单独定日期。
 *
 * 例：
 *   周一 22:00 开写，连续写到周二 12:00   → 整场都算**周一**
 *   周一 23:00 写到周二 01:00，停两小时，03:00 又写
 *                                       → 两场都算周一（03:00 还没到 4 点）
 *   周二 03:50 停笔，05:00 再写           → 05:00 那场算**周二**
 * ─────────────────────────────────────────────────────────────
 */

import type { StatRecord } from '../types/index.js'

export const STATS_SCHEMA_VERSION = 1

/** 写作会话切分阈值：中断超过 30 分钟算新的一场 */
export const SESSION_GAP_MS = 30 * 60 * 1000

/**
 * 「新的一天」的最早开启时刻（本地时间的小时）。
 *
 * 设成 4 点而不是 0 点，是因为写手常写到凌晨两三点 ——
 * 那显然还是「今天」的产出，不该在日历上跳到第二天去。
 */
export const DAY_CUTOFF_HOUR = 4

/** 签到线：一天写够这么多字算签到成功，计入连续天数 */
export const SIGN_IN_WORDS = 5000

/** 补签线：一天每写够这么多字，可以补签之前漏掉的一天 */
export const MAKEUP_WORDS = 10000

export interface StatsOptions {
  gapMs?: number
  cutoffHour?: number
}

export interface StreakOptions {
  /** 签到线，默认 5000 */
  signInWords?: number
  /** 补签线，默认 10000。设为 0 表示关闭补签 */
  makeupWords?: number
}

// ───────────────────────── 日期工具 ─────────────────────────

function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 某个**会话起始时刻**属于哪个写作日。
 *
 * 只对会话的起点调用 —— 会话中间和结尾的时刻不参与判定，
 * 那正是「写到第二天中午也算今天」得以成立的原因。
 */
export function writingDayOfSessionStart(ts: number, cutoffHour = DAY_CUTOFF_HOUR): string {
  const d = new Date(ts)
  if (d.getHours() < cutoffHour) d.setDate(d.getDate() - 1)
  return fmtDate(d)
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`)
  d.setDate(d.getDate() + n)
  return fmtDate(d)
}

/** 当前时刻属于哪个写作日。用于「今天写了多少」这类实时显示 */
export function currentWritingDay(now: number, cutoffHour = DAY_CUTOFF_HOUR): string {
  return writingDayOfSessionStart(now, cutoffHour)
}

// ───────────────────────── jsonl ─────────────────────────

export function parseStatsJsonl(text: string): StatRecord[] {
  const out: StatRecord[] = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    try {
      const o = JSON.parse(t) as StatRecord
      if (typeof o?.ts === 'number' && typeof o?.delta === 'number' && typeof o?.doc === 'string') {
        out.push(o)
      }
    } catch {
      // 坏行跳过
    }
  }
  return out
}

export function toStatsJsonl(records: readonly StatRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + (records.length > 0 ? '\n' : '')
}

/** 合并多设备分片，按时间排序 */
export function mergeStats(shards: readonly StatRecord[][]): StatRecord[] {
  return shards.flat().sort((a, b) => a.ts - b.ts)
}

// ───────────────────────── 会话 ─────────────────────────

export interface WritingSession {
  id: string
  /** 这一场属于哪个写作日（由起始时刻决定，见文件头） */
  day: string
  startTs: number
  endTs: number
  /** 净增字数（可为负） */
  words: number
  /** 保存次数 */
  saves: number
  /** 涉及的文档 id */
  docs: string[]
  durationMs: number
  /** 字/小时；持续时间为 0 时为 0 */
  wordsPerHour: number
  /** 该场是否用了番茄钟 */
  pomo: boolean
  /** 这一场是否跨过了凌晨（起止不在同一日历日） */
  crossedMidnight: boolean
}

/**
 * 按中断时长切分写作会话，并给每一场定出所属写作日。
 *
 * 只用记录的时间戳切分，不依赖记录里的 `session` 字段 ——
 * 那个字段是写入端打的，多设备场景下不可信。
 */
export function buildSessions(
  records: readonly StatRecord[],
  opts: StatsOptions = {},
): WritingSession[] {
  const gapMs = opts.gapMs ?? SESSION_GAP_MS
  const cutoffHour = opts.cutoffHour ?? DAY_CUTOFF_HOUR

  const sorted = [...records].sort((a, b) => a.ts - b.ts)
  const out: WritingSession[] = []

  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.ts - last.endTs <= gapMs) {
      last.endTs = r.ts
      last.words += r.delta
      last.saves += 1
      if (!last.docs.includes(r.doc)) last.docs.push(r.doc)
      if (r.pomo) last.pomo = true
    } else {
      out.push({
        id: `s-${r.ts.toString(36)}`,
        day: writingDayOfSessionStart(r.ts, cutoffHour),
        startTs: r.ts,
        endTs: r.ts,
        words: r.delta,
        saves: 1,
        docs: [r.doc],
        durationMs: 0,
        wordsPerHour: 0,
        pomo: r.pomo === true,
        crossedMidnight: false,
      })
    }
  }

  for (const s of out) {
    s.durationMs = s.endTs - s.startTs
    s.wordsPerHour = s.durationMs > 0 ? Math.round((s.words / s.durationMs) * 3_600_000) : 0
    s.crossedMidnight = fmtDate(new Date(s.startTs)) !== fmtDate(new Date(s.endTs))
  }

  return out
}

// ───────────────────────── 按日聚合 ─────────────────────────

export interface DayStat {
  /** YYYY-MM-DD */
  day: string
  words: number
  /** 该日保存次数 */
  saves: number
  /** 该日番茄钟内产出的字数 */
  pomoWords: number
  /** 该日的写作场次 */
  sessions: number
  /** 实际在稿纸前的总时长（各场之和） */
  activeMs: number
}

const EMPTY_DAY = (day: string): DayStat => ({
  day,
  words: 0,
  saves: 0,
  pomoWords: 0,
  sessions: 0,
  activeMs: 0,
})

/**
 * 按写作日聚合。**先切会话，记录跟着会话走**（见文件头的归属规则）。
 * 返回按日期升序，只含有记录的日子。
 */
export function byDay(records: readonly StatRecord[], opts: StatsOptions = {}): DayStat[] {
  const sessions = buildSessions(records, opts)
  const gapMs = opts.gapMs ?? SESSION_GAP_MS
  const map = new Map<string, DayStat>()

  for (const s of sessions) {
    const cur = map.get(s.day) ?? EMPTY_DAY(s.day)
    cur.words += s.words
    cur.saves += s.saves
    cur.sessions += 1
    cur.activeMs += s.durationMs
    map.set(s.day, cur)
  }

  // 番茄钟字数要回到记录粒度算，且归到所属会话的日期上
  for (const r of records) {
    if (!r.pomo) continue
    const owner = sessions.find((s) => r.ts >= s.startTs - gapMs && r.ts <= s.endTs)
    if (!owner) continue
    const cur = map.get(owner.day)
    if (cur) cur.pomoWords += r.delta
  }

  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day))
}

/**
 * 补齐日期区间内没有记录的日子（值为 0）。
 * 曲线图和热力图都需要连续的日期轴，否则「断更的那几天」会被画得不存在。
 */
export function fillDays(stats: readonly DayStat[], fromDay: string, toDay: string): DayStat[] {
  const map = new Map(stats.map((s) => [s.day, s]))
  const out: DayStat[] = []
  let day = fromDay
  // 防御：区间反了或过大时不要死循环
  for (let guard = 0; day <= toDay && guard < 40000; guard++) {
    out.push(map.get(day) ?? EMPTY_DAY(day))
    day = addDays(day, 1)
  }
  return out
}

/** 按周聚合（周一为一周之始），键为该周周一的日期 */
export function byWeek(days: readonly DayStat[]): Array<{ weekStart: string; words: number }> {
  const map = new Map<string, number>()
  for (const d of days) {
    const dt = new Date(`${d.day}T00:00:00`)
    const dow = (dt.getDay() + 6) % 7 // 周一=0
    dt.setDate(dt.getDate() - dow)
    const key = fmtDate(dt)
    map.set(key, (map.get(key) ?? 0) + d.words)
  }
  return [...map.entries()]
    .map(([weekStart, words]) => ({ weekStart, words }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

/** 按月聚合，键为 `YYYY-MM` */
export function byMonth(days: readonly DayStat[]): Array<{ month: string; words: number }> {
  const map = new Map<string, number>()
  for (const d of days) {
    const key = d.day.slice(0, 7)
    map.set(key, (map.get(key) ?? 0) + d.words)
  }
  return [...map.entries()]
    .map(([month, words]) => ({ month, words }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

// ───────────────────────── 签到 / 补签 / 连续天数 ─────────────────────────

export type SignInState =
  /** 写够了签到线 */
  | 'signed'
  /** 没写够，但被后来的补签额度补上了 */
  | 'makeup'
  /** 断了 */
  | 'missed'

export interface DaySignIn {
  day: string
  words: number
  state: SignInState
  /** 该日产生的补签额度 */
  creditsEarned: number
}

/**
 * 逐日判定签到状态。
 *
 * 规则（作者定）：
 *   - 写够 `signInWords`（默认 5000）→ 签到成功
 *   - 每写够 `makeupWords`（默认 10000）→ 额外获得 1 次补签额度
 *   - 补签额度用来**回补之前漏掉的日子**，让连续天数接得上
 *
 * 实现上从最近的日子倒着走：攒到的额度只能补比它更早的空缺，
 * 这正是「补签」的语义。额度补不上的地方就是真的断了，
 * 断点之前攒的额度作废（不允许跨过一个大坑去修更早的历史）。
 */
export function computeSignIns(
  days: readonly DayStat[],
  opts: StreakOptions = {},
): DaySignIn[] {
  const signInWords = opts.signInWords ?? SIGN_IN_WORDS
  const makeupWords = opts.makeupWords ?? MAKEUP_WORDS

  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day))
  const out: DaySignIn[] = new Array(sorted.length)
  let pool = 0

  for (let i = sorted.length - 1; i >= 0; i--) {
    const d = sorted[i] as DayStat
    const earned = makeupWords > 0 && d.words > 0 ? Math.floor(d.words / makeupWords) : 0

    if (d.words >= signInWords) {
      pool += earned
      out[i] = { day: d.day, words: d.words, state: 'signed', creditsEarned: earned }
    } else if (pool > 0) {
      pool -= 1
      out[i] = { day: d.day, words: d.words, state: 'makeup', creditsEarned: earned }
    } else {
      // 真断了，之前攒的额度作废 —— 不允许跨过一个大坑去修更早的历史
      pool = 0
      out[i] = { day: d.day, words: d.words, state: 'missed', creditsEarned: earned }
    }
  }

  return out
}

export interface StreakInfo {
  /** 当前连续天数（含补签补上的） */
  current: number
  /** 历史最长连续天数 */
  longest: number
  /** 当前连续里有几天是补签来的 */
  currentMakeups: number
  /** 最后一次签到成功是哪天 */
  lastSignedDay: string | null
  /** 今天是否已经签到（未达线为 false） */
  todaySigned: boolean
  /** 今天还差多少字达到签到线；已达线为 0 */
  wordsToSignIn: number
}

/**
 * 计算连续写作天数。
 *
 * 两条体贴之处：
 *   - **今天还没写不算断更** —— 今天才刚开始，从昨天起算
 *   - 但**昨天也没写就是真断了**，不粉饰
 */
export function computeStreak(
  days: readonly DayStat[],
  todayDay: string,
  opts: StreakOptions = {},
): StreakInfo {
  const signInWords = opts.signInWords ?? SIGN_IN_WORDS
  const signIns = computeSignIns(days, opts)
  const byDayMap = new Map(signIns.map((s) => [s.day, s]))

  const ok = (day: string) => {
    const s = byDayMap.get(day)
    return s !== undefined && (s.state === 'signed' || s.state === 'makeup')
  }

  const todayWords = byDayMap.get(todayDay)?.words ?? 0
  const todaySigned = todayWords >= signInWords

  // 当前连续：今天没达线就从昨天起算（今天还没结束，不该判断更）
  let cursor = ok(todayDay) ? todayDay : addDays(todayDay, -1)
  let current = 0
  let currentMakeups = 0
  while (ok(cursor)) {
    current++
    if (byDayMap.get(cursor)?.state === 'makeup') currentMakeups++
    cursor = addDays(cursor, -1)
  }

  // 最长连续：在判定结果上找最长的连续段
  let longest = 0
  let run = 0
  let prev: string | null = null
  for (const s of signIns) {
    if (s.state === 'missed') {
      run = 0
      prev = s.day
      continue
    }
    run = prev !== null && addDays(prev, 1) === s.day ? run + 1 : 1
    if (run > longest) longest = run
    prev = s.day
  }

  const signedDays = signIns.filter((s) => s.state === 'signed')
  const lastSignedDay = signedDays.length > 0 ? (signedDays[signedDays.length - 1] as DaySignIn).day : null

  return {
    current,
    longest,
    currentMakeups,
    lastSignedDay,
    todaySigned,
    wordsToSignIn: Math.max(0, signInWords - todayWords),
  }
}

// ───────────────────────── 今日 / 目标 ─────────────────────────

export interface TodayStat {
  day: string
  words: number
  target: number
  /** 完成百分比，0~100+，无目标时为 0 */
  percent: number
  reached: boolean
  /** 是否达到签到线 */
  signedIn: boolean
  /** 今日已攒下的补签额度 */
  makeupCredits: number
}

export function todayStat(
  days: readonly DayStat[],
  todayDay: string,
  target: number,
  opts: StreakOptions = {},
): TodayStat {
  const signInWords = opts.signInWords ?? SIGN_IN_WORDS
  const makeupWords = opts.makeupWords ?? MAKEUP_WORDS
  const words = days.find((d) => d.day === todayDay)?.words ?? 0

  return {
    day: todayDay,
    words,
    target,
    percent: target > 0 ? Math.round((words / target) * 100) : 0,
    reached: target > 0 && words >= target,
    signedIn: words >= signInWords,
    makeupCredits: makeupWords > 0 && words > 0 ? Math.floor(words / makeupWords) : 0,
  }
}

// ───────────────────────── 热力图 ─────────────────────────

export interface HeatCell {
  day: string
  words: number
  /** 0~4 的等级，供界面选颜色深浅 */
  level: 0 | 1 | 2 | 3 | 4
  /** 签到状态，供界面画补签标记 */
  state: SignInState
}

/**
 * 生成年度热力图数据。
 *
 * 等级用**分位数**而不是固定阈值切分 —— 日更三千的作者和日更三万的作者，
 * 用同一套固定阈值会让其中一个的图整片死绿或整片死红。
 */
export function heatmap(days: readonly DayStat[], opts: StreakOptions = {}): HeatCell[] {
  const signIns = new Map(computeSignIns(days, opts).map((s) => [s.day, s.state]))
  const positives = days.filter((d) => d.words > 0).map((d) => d.words).sort((a, b) => a - b)

  if (positives.length === 0) {
    return days.map((d) => ({ day: d.day, words: d.words, level: 0, state: signIns.get(d.day) ?? 'missed' }))
  }

  const q = (p: number) => positives[Math.min(positives.length - 1, Math.floor(positives.length * p))] as number
  const t1 = q(0.25)
  const t2 = q(0.5)
  const t3 = q(0.75)

  return days.map((d) => {
    let level: HeatCell['level'] = 0
    if (d.words > 0) level = d.words <= t1 ? 1 : d.words <= t2 ? 2 : d.words <= t3 ? 3 : 4
    return { day: d.day, words: d.words, level, state: signIns.get(d.day) ?? 'missed' }
  })
}

// ───────────────────────── 记录构造 ─────────────────────────

export function createStatRecord(o: {
  ts: number
  dev: string
  doc: string
  delta: number
  total: number
  session: string
  pomo?: boolean
}): StatRecord {
  const rec: StatRecord = {
    schemaVersion: STATS_SCHEMA_VERSION,
    ts: o.ts,
    dev: o.dev,
    doc: o.doc,
    delta: o.delta,
    total: o.total,
    session: o.session,
  }
  if (o.pomo) rec.pomo = true
  return rec
}

/** 全书总字数：取每篇文档最后一条记录的 `total` 相加 */
export function totalWords(records: readonly StatRecord[]): number {
  const latest = new Map<string, StatRecord>()
  for (const r of records) {
    const cur = latest.get(r.doc)
    if (!cur || r.ts >= cur.ts) latest.set(r.doc, r)
  }
  let sum = 0
  for (const r of latest.values()) sum += r.total
  return sum
}
