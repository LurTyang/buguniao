/**
 * 跟对外统计服务说话 —— 纯计算的那一半。
 *
 * 规范：更新文档/08-账号与对外接口.md §3
 * 服务端在 `server/`，线上是 https://bugu.char46.top
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么客户端这边还要再挑一遍那七个数】
 *
 * 服务端已经挑过一遍了（它不能信客户端）。但客户端这边也得挑，
 * 理由完全不同：**这是「作者的什么东西会离开这台电脑」的最后一道闸**。
 *
 * 服务端那道拦的是「别人乱塞」，这一道拦的是「我们自己不小心多带」。
 * 某天有人往 planReport 里加个 `currentBook`，如果这儿是 spread，
 * 书名当场就飞出去了 —— 而且两边都不会报错。
 *
 * 所以两边都显式列字段，谁也不偷懒。
 * ─────────────────────────────────────────────────────────────
 *
 * 这个文件**不发请求**：拼好 URL 和 body 交给主进程去发。
 * 这样它能在 node 里直接测，而拼错地址、漏带令牌、把不该带的带上，
 * 恰恰是这一层最容易出的错。
 */

/** 对外公开的那七个数。跟服务端 `server/src/stats.ts` 一一对应 */
export interface PublicStats {
  /** 本地日期 `YYYY-MM-DD`。服务器不猜时区，客户端算好了传 */
  date: string
  todayWords: number
  weekWords: number
  streak: number
  bestStreak: number
  /** 今天的底线目标，0 表示没设 */
  dailyFloor: number
  /** 一起写了多少天 */
  daysTogether: number
}

/** 别人从公开接口读到的东西：那七个数 + 短名 + 什么时候推的 */
export interface PublicProfile extends PublicStats {
  handle: string
  updatedAt: string
}

export interface StatsRequest {
  url: string
  method: 'GET' | 'PUT' | 'DELETE'
  /** 要带令牌吗。公开接口**不带** —— 带了反而多暴露一次 */
  auth: boolean
  body?: string
}

/** 线上那台。改地址是改代码的事，界面上不给填 —— 理由同登录服务 */
export const STATS_BASE = 'https://bugu.char46.top'

const api = (base: string, path: string): string => `${base.replace(/\/+$/, '')}/api/v1${path}`

/**
 * 把七个数拼成要推的 body。
 *
 * **显式构造，不是 spread。** 加字段必须有人专门来改这个函数。
 */
export function pushStatsRequest(base: string, s: PublicStats): StatsRequest {
  const body: PublicStats = {
    date: s.date,
    todayWords: s.todayWords,
    weekWords: s.weekWords,
    streak: s.streak,
    bestStreak: s.bestStreak,
    dailyFloor: s.dailyFloor,
    daysTogether: s.daysTogether,
  }
  return { url: api(base, '/me/stats'), method: 'PUT', auth: true, body: JSON.stringify(body) }
}

export function claimHandleRequest(base: string, handle: string): StatsRequest {
  return {
    url: api(base, '/me/handle'),
    method: 'PUT',
    auth: true,
    body: JSON.stringify({ handle }),
  }
}

export function myProfileRequest(base: string): StatsRequest {
  return { url: api(base, '/me'), method: 'GET', auth: true }
}

export function forgetMeRequest(base: string): StatsRequest {
  return { url: api(base, '/me'), method: 'DELETE', auth: true }
}

/** 别人读到的是什么。**不带令牌** —— 这是公开接口，带了纯属多暴露 */
export function publicStatsRequest(base: string, handle: string): StatsRequest {
  return {
    url: api(base, `/u/${encodeURIComponent(handle.toLowerCase())}/stats`),
    method: 'GET',
    auth: false,
  }
}

/** 别人能打开的那个地址，给作者复制出去用 */
export function publicStatsUrl(base: string, handle: string): string {
  return publicStatsRequest(base, handle).url
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export function parsePublicProfile(body: unknown): PublicProfile {
  const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  return {
    handle: str(o['handle']),
    updatedAt: str(o['updatedAt']),
    date: str(o['date']),
    todayWords: num(o['todayWords']),
    weekWords: num(o['weekWords']),
    streak: num(o['streak']),
    bestStreak: num(o['bestStreak']),
    dailyFloor: num(o['dailyFloor']),
    daysTogether: num(o['daysTogether']),
  }
}

/** 服务端报错时它放在 `error` 里。读不出来就别编，说不知道 */
export function parseStatsError(status: number, body: unknown): string {
  const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const why = str(o['error'])
  if (why) return why
  if (status === 401) return '登录过期了，重新登录一下'
  if (status === 404) return '服务器上没有这个人'
  if (status === 409) return '这个短名被人用了'
  if (status >= 500) return `服务器出错了（HTTP ${status}）`
  return `请求没成功（HTTP ${status}）`
}

// ───────────────────────── 短名 ─────────────────────────

/**
 * 短名的规矩。**跟服务端 `server/src/handle.ts` 必须一致** ——
 * 两边不一致的后果是：界面说这个名字可以，服务器说不行，
 * 作者一脸茫然地反复试。
 *
 * 客户端这一份的作用是**在按下按钮之前就把话说清楚**，
 * 而不是等一趟网络往返回来才说。
 */
export const HANDLE_MIN = 3
export const HANDLE_MAX = 24

const RESERVED = new Set([
  'api', 'admin', 'administrator', 'root', 'me', 'u', 'user', 'users',
  'login', 'logout', 'signin', 'signup', 'oauth', 'oidc', 'auth', 'callback',
  'health', 'healthz', 'status', 'stats', 'about', 'help', 'docs', 'support',
  'settings', 'config', 'static', 'assets', 'public', 'www', 'mail', 'ftp',
  'bugu', 'buguniao', '不咕鸟', 'null', 'undefined', 'true', 'false',
])

export function checkHandle(raw: string): { ok: true; handle: string } | { ok: false; why: string } {
  const h = raw.trim().toLowerCase()
  if (h.length < HANDLE_MIN) return { ok: false, why: `至少 ${HANDLE_MIN} 个字符` }
  if (h.length > HANDLE_MAX) return { ok: false, why: `最多 ${HANDLE_MAX} 个字符` }
  if (!/^[a-z0-9-]+$/.test(h)) return { ok: false, why: '只能用小写字母、数字和连字符' }
  if (h.startsWith('-') || h.endsWith('-')) return { ok: false, why: '不能以连字符开头或结尾' }
  if (h.includes('--')) return { ok: false, why: '不能有连着的两个连字符' }
  if (/^\d+$/.test(h)) return { ok: false, why: '不能全是数字' }
  if (RESERVED.has(h)) return { ok: false, why: `「${h}」是保留名，换一个` }
  return { ok: true, handle: h }
}

/**
 * 一张奖状。
 *
 * **不是成就，不是里程碑。** 由作者手动发给人，纪念一件具体的事
 * （某次征文、某个比赛）。客户端**只读**：拿到什么显示什么，
 * 不判定、不发、不改。
 *
 * 它只出现在 `GET /me` 里，**不进公开接口** —— 「对外统计只发七个整数」
 * 那句话要继续成立。
 */
export interface Award {
  id: string
  /** 显示出来的那 2–6 个字 */
  name: string
  /** 说明，鼠标停上去看。可能是空的 */
  note: string
  /** 什么时候发的（ISO） */
  at: string
}

/**
 * 我自己那一份（`GET /api/v1/me`）。
 *
 * 跟公开接口**不是一个形状**：这儿的 `stats` 可能是 null ——
 * 登录了但一次都没推过的人就是这样。公开接口遇到这种人直接 404，
 * 所以那边不会出现 null。
 */
export interface MyProfile {
  handle: string
  updatedAt: string
  stats: PublicStats | null
  /** 我拿到的奖状，先发的在前。没有就是空数组 */
  awards: Award[]
}

function parseStats(body: unknown): PublicStats {
  const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  return {
    date: str(o['date']),
    todayWords: num(o['todayWords']),
    weekWords: num(o['weekWords']),
    streak: num(o['streak']),
    bestStreak: num(o['bestStreak']),
    dailyFloor: num(o['dailyFloor']),
    daysTogether: num(o['daysTogether']),
  }
}

export function parseMyProfile(body: unknown): MyProfile {
  const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const s = o['stats']
  return {
    handle: str(o['handle']),
    updatedAt: str(o['updatedAt']),
    // 没推过时服务端给的是 null，别硬凑一个全 0 出来 ——
    // 「没推过」和「推过但今天 0 字」在界面上要说成两句不同的话
    stats: s && typeof s === 'object' ? parseStats(s) : null,
    awards: parseAwards(o['awards']),
  }
}

/**
 * 读奖状清单。
 *
 * **名字是空的就整条丢掉** —— 界面上那个位置要么有个看得清的词，
 * 要么什么都别有。挂一个空白徽章比不挂更让人困惑。
 */
export function parseAwards(body: unknown): Award[] {
  if (!Array.isArray(body)) return []
  const out: Award[] = []
  for (const raw of body) {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const name = str(o['name']).trim()
    if (!name) continue
    out.push({ id: str(o['id']), name, note: str(o['note']), at: str(o['at']) })
  }
  return out
}

/** 认领短名之后服务端回的那一句。它有可能把名字规范化过（大写转小写） */
export function parseClaimedHandle(body: unknown, fallback: string): string {
  const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  return str(o['handle']) || fallback
}

/**
 * 这一次请求该带哪些头。
 *
 * 单拎出来是因为**「该带令牌没带」和「不该带却带了」是这一层最容易犯的两个错**，
 * 而两个都不会当场报错：前者要等服务器回 401，后者根本不会有人发现 ——
 * 它只是悄悄把令牌多送了一个地方。写成函数就能拿测试钉住。
 */
export function statsHeaders(req: StatsRequest, token: string | null): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' }
  if (req.body !== undefined) h['Content-Type'] = 'application/json'
  if (req.auth) {
    if (!token) throw new Error('这个请求要登录才能发，但手上没有令牌')
    h['Authorization'] = `Bearer ${token}`
  }
  return h
}
