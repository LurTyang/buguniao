/**
 * 那七个数 —— 服务端这一侧的守门人。
 *
 * 规范：更新文档/08-账号与对外接口.md
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么服务端还要再挑一遍】
 *
 * 客户端那边有一个 `publicStatsFrom()`，是「哪几个数可以离开这台电脑」
 * 的唯一出口。但那是**客户端**的自律 —— 服务端不能指望它。
 *
 * 一个改过的客户端、一个手写的 curl、一次版本不匹配，都可能往上塞
 * 书名、章节名、正文片段。真塞进来了，它就会从公开接口漏出去。
 *
 * 所以这里**显式挑七个字段，别的一律丢掉**，而不是把收到的对象存下来。
 * 多写这几行的理由只有一个：漏一次就再也收不回来了。
 * ─────────────────────────────────────────────────────────────
 */

export interface PublicStats {
  /** 本地日期 `YYYY-MM-DD`。服务器不猜时区，客户端算好了传 */
  date: string
  todayWords: number
  weekWords: number
  streak: number
  bestStreak: number
  /** 今天的底线目标，0 表示没设 */
  dailyFloor: number
  /** 一起写了多少天（从第一条码字记录算起） */
  daysTogether: number
}

/** 对外只认这七个键。加字段必须有人专门来改这一行 */
export const PUBLIC_FIELDS = [
  'date',
  'todayWords',
  'weekWords',
  'streak',
  'bestStreak',
  'dailyFloor',
  'daysTogether',
] as const

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 一个人一天能写多少字总有个上限。超过就是客户端算错了或者有人在灌数 */
const MAX_WORDS = 10_000_000
/** 连胜天数的上限。写作这件事还没人连续干过一百年 */
const MAX_DAYS = 40_000

function num(v: unknown, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  // 允许小数进来但存整数 —— 字数本来就是整数，客户端偶尔会传浮点
  const n = Math.round(v)
  if (n < 0 || n > max) return null
  return n
}

export type Parsed = { ok: true; stats: PublicStats } | { ok: false; why: string }

/**
 * 把收到的东西挑成七个数。
 *
 * **显式构造，不是 spread。** 别处多了个字段不会自动跟着存进来。
 */
export function parsePublicStats(body: unknown): Parsed {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, why: '请求体不是一个对象' }
  }
  const o = body as Record<string, unknown>

  const date = o['date']
  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    return { ok: false, why: 'date 要是 YYYY-MM-DD' }
  }
  // 日期本身也得是真的：2026-02-31 能过正则，过不了这一关
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) {
    return { ok: false, why: `没有 ${date} 这一天` }
  }

  const fields: Array<[keyof PublicStats, number]> = [
    ['todayWords', MAX_WORDS],
    ['weekWords', MAX_WORDS],
    ['streak', MAX_DAYS],
    ['bestStreak', MAX_DAYS],
    ['dailyFloor', MAX_WORDS],
    ['daysTogether', MAX_DAYS],
  ]
  const out: Record<string, number> = {}
  for (const [k, max] of fields) {
    const n = num(o[k], max)
    if (n === null) return { ok: false, why: `${k} 要是 0 到 ${max} 之间的数` }
    out[k] = n
  }

  return {
    ok: true,
    stats: {
      date,
      todayWords: out['todayWords']!,
      weekWords: out['weekWords']!,
      streak: out['streak']!,
      bestStreak: out['bestStreak']!,
      dailyFloor: out['dailyFloor']!,
      daysTogether: out['daysTogether']!,
    },
  }
}

/**
 * 往外发之前再挑一遍。
 *
 * 存进去的时候已经挑过了，这里是第二道 —— 万一哪天数据库里混进了
 * 别的列（人工改过、迁移脚本写歪了），它也出不去。
 */
export function toPublicJson(s: PublicStats): PublicStats {
  return {
    date: s.date,
    todayWords: s.todayWords,
    weekWords: s.weekWords,
    streak: s.streak,
    bestStreak: s.bestStreak,
    dailyFloor: s.dailyFloor,
    daysTogether: s.daysTogether,
  }
}
