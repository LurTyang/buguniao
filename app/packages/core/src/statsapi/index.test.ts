/**
 * 对外统计服务的协议层。
 *
 * 这一层不发请求，所以它能在 node 里直接跑完 —— 而它管的恰好是
 * 「地址拼错、令牌漏带、把不该带的带出去」这三件**发出去就收不回来**的事。
 */

import { describe, expect, it } from 'vitest'
import {
  STATS_BASE,
  parseAwards,
  checkHandle,
  claimHandleRequest,
  forgetMeRequest,
  myProfileRequest,
  parseClaimedHandle,
  parseMyProfile,
  parsePublicProfile,
  parseStatsError,
  publicStatsRequest,
  publicStatsUrl,
  pushStatsRequest,
  statsHeaders,
  type PublicStats,
} from './index.js'

const SEVEN: PublicStats = {
  date: '2026-08-28',
  todayWords: 1200,
  weekWords: 5400,
  streak: 9,
  bestStreak: 21,
  dailyFloor: 1000,
  daysTogether: 47,
}

describe('拼地址', () => {
  it('每条都落在 /api/v1 底下', () => {
    const base = 'https://bugu.char46.top'
    expect(pushStatsRequest(base, SEVEN).url).toBe(`${base}/api/v1/me/stats`)
    expect(claimHandleRequest(base, 'mingting').url).toBe(`${base}/api/v1/me/handle`)
    expect(myProfileRequest(base).url).toBe(`${base}/api/v1/me`)
    expect(forgetMeRequest(base).url).toBe(`${base}/api/v1/me`)
    expect(publicStatsUrl(base, 'mingting')).toBe(`${base}/api/v1/u/mingting/stats`)
  })

  it('地址末尾多几个斜杠也不会拼出 //api', () => {
    expect(myProfileRequest('https://bugu.char46.top///').url).toBe(
      'https://bugu.char46.top/api/v1/me',
    )
  })

  it('线上那台是 https', () => {
    expect(STATS_BASE.startsWith('https://')).toBe(true)
  })

  it('短名进地址前先转小写，再转义', () => {
    expect(publicStatsUrl('https://x.cn', 'MingTing')).toBe('https://x.cn/api/v1/u/mingting/stats')
    expect(publicStatsUrl('https://x.cn', 'a/b')).toBe('https://x.cn/api/v1/u/a%2Fb/stats')
  })

  it('方法对得上服务端那五条路由', () => {
    expect(pushStatsRequest('https://x.cn', SEVEN).method).toBe('PUT')
    expect(claimHandleRequest('https://x.cn', 'ming').method).toBe('PUT')
    expect(myProfileRequest('https://x.cn').method).toBe('GET')
    expect(forgetMeRequest('https://x.cn').method).toBe('DELETE')
    expect(publicStatsRequest('https://x.cn', 'ming').method).toBe('GET')
  })
})

describe('要推出去的 body', () => {
  it('**只有那七个数**', () => {
    const body = JSON.parse(pushStatsRequest('https://x.cn', SEVEN).body!) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual([
      'bestStreak',
      'dailyFloor',
      'date',
      'daysTogether',
      'streak',
      'todayWords',
      'weekWords',
    ])
  })

  it('【关键】别处往 stats 上多挂的字段带不出去', () => {
    const dirty = { ...SEVEN, currentBook: '不咕鸟传', chapter: '第一章', body: '正文……' }
    const text = pushStatsRequest('https://x.cn', dirty as PublicStats).body!
    expect(text).not.toContain('不咕鸟传')
    expect(text).not.toContain('第一章')
    expect(text).not.toContain('正文')
  })
})

describe('该带令牌的带、不该带的不带', () => {
  it('要身份的接口带 Bearer', () => {
    const h = statsHeaders(pushStatsRequest('https://x.cn', SEVEN), 'tok-123')
    expect(h['Authorization']).toBe('Bearer tok-123')
    expect(h['Content-Type']).toBe('application/json')
  })

  it('【关键】公开接口一个令牌都不带', () => {
    const h = statsHeaders(publicStatsRequest('https://x.cn', 'ming'), 'tok-123')
    expect(h['Authorization']).toBeUndefined()
  })

  it('没有 body 就不声明 Content-Type', () => {
    expect(statsHeaders(myProfileRequest('https://x.cn'), 'tok')['Content-Type']).toBeUndefined()
  })

  it('该带令牌却没有令牌时当场报错，而不是发一个注定 401 的请求', () => {
    expect(() => statsHeaders(myProfileRequest('https://x.cn'), null)).toThrow(/令牌/)
  })
})

describe('读回来的东西', () => {
  it('公开接口：短名、时间、七个数', () => {
    const p = parsePublicProfile({ handle: 'ming', updatedAt: '2026-08-28T01:00:00.000Z', ...SEVEN })
    expect(p.handle).toBe('ming')
    expect(p.todayWords).toBe(1200)
    expect(p.daysTogether).toBe(47)
  })

  it('缺胳膊少腿的响应不至于让界面崩，缺的当 0 / 空串', () => {
    const p = parsePublicProfile({ handle: 'ming' })
    expect(p.todayWords).toBe(0)
    expect(p.date).toBe('')
  })

  it('响应根本不是对象也不崩', () => {
    expect(parsePublicProfile(null).handle).toBe('')
    expect(parsePublicProfile('<html>502</html>').streak).toBe(0)
  })

  it('自己那一份：一次都没推过时 stats 是 null，不是一堆 0', () => {
    const me = parseMyProfile({ handle: 'ming', updatedAt: '', stats: null })
    expect(me.stats).toBeNull()
    expect(me.handle).toBe('ming')
  })

  it('自己那一份：推过之后 stats 是那七个数', () => {
    const me = parseMyProfile({ handle: 'ming', updatedAt: '2026-08-28T01:00:00.000Z', stats: SEVEN })
    expect(me.stats?.streak).toBe(9)
  })

  it('认领短名：服务端规范化过就听服务端的', () => {
    expect(parseClaimedHandle({ handle: 'ming' }, 'MING')).toBe('ming')
    expect(parseClaimedHandle(null, 'ming')).toBe('ming')
  })
})

describe('报错翻译', () => {
  it('服务端说了什么就转述什么', () => {
    expect(parseStatsError(409, { error: '「ming」已经被人用了' })).toBe('「ming」已经被人用了')
  })

  it('服务端什么都没说时按状态码给一句人话', () => {
    expect(parseStatsError(401, null)).toContain('重新登录')
    expect(parseStatsError(404, null)).toContain('没有这个人')
    expect(parseStatsError(503, null)).toContain('503')
  })
})

describe('短名的规矩（要跟服务端 handle.ts 一字不差）', () => {
  it('好名字', () => {
    for (const h of ['ming', 'ming-ting', 'a1b2', 'x-9']) {
      expect(checkHandle(h).ok, h).toBe(true)
    }
  })

  it('大写会被收成小写', () => {
    const r = checkHandle('  MingTing ')
    expect(r.ok && r.handle).toBe('mingting')
  })

  it('坏名字都有一句说得清的理由', () => {
    const bad = ['ab', 'a'.repeat(25), 'Ming Ting', '中文名', '-ming', 'ming-', 'mi--ng', '12345', 'admin']
    for (const h of bad) {
      const r = checkHandle(h)
      expect(r.ok, h).toBe(false)
      expect(r.ok === false && r.why.length > 0, h).toBe(true)
    }
  })
})

describe('奖状', () => {
  it('读出来是那四个字段', () => {
    const a = parseAwards([{ id: 'nano-2026', name: '不咕之星', note: '一等奖', at: '2026-08-27T10:00:00.000Z' }])
    expect(a).toEqual([
      { id: 'nano-2026', name: '不咕之星', note: '一等奖', at: '2026-08-27T10:00:00.000Z' },
    ])
  })

  it('缺字段的补空串，不崩', () => {
    expect(parseAwards([{ name: '冠军' }])).toEqual([{ id: '', name: '冠军', note: '', at: '' }])
  })

  it('【关键】名字是空的整条丢掉 —— 挂一个空白徽章比不挂更让人困惑', () => {
    expect(parseAwards([{ id: 'a', name: '' }, { id: 'b', name: '   ' }, { id: 'c', name: '冠军' }]))
      .toEqual([{ id: 'c', name: '冠军', note: '', at: '' }])
  })

  it('不是数组、是 null、是别的东西，一律当没有', () => {
    expect(parseAwards(null)).toEqual([])
    expect(parseAwards(undefined)).toEqual([])
    expect(parseAwards('冠军')).toEqual([])
    expect(parseAwards({ 0: { name: '冠军' } })).toEqual([])
  })

  it('/me 里没有 awards 字段时当空 —— 服务器还没升级也不该白屏', () => {
    expect(parseMyProfile({ handle: 'ming', updatedAt: '', stats: null }).awards).toEqual([])
  })

  it('/me 里有就读出来', () => {
    const me = parseMyProfile({ handle: 'ming', awards: [{ id: 'x', name: '冠军' }] })
    expect(me.awards).toHaveLength(1)
    expect(me.awards[0]?.name).toBe('冠军')
  })
})
