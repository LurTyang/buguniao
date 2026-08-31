/**
 * 对外统计服务。
 *
 * 这里最要紧的不是「接口通不通」，是两条**错了也看不出来**的规矩：
 *
 * 1. **只有那七个数能出去。** 混进书名、章节名、正文，功能完全正常，
 *    但作者的隐私就漏了，而且漏出去收不回来。
 * 2. **令牌必须真验。** 不验签的 JWT 谁都能伪造成别人的 sub，
 *    然后以别人的身份改他的数据 —— 而接口看起来一切正常。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type http from 'node:http'
import { Auth, clearAuthCache } from './auth.js'
import { Store } from './db.js'
import { createServer } from './server.js'
import { checkHandle } from './handle.js'
import { parsePublicStats } from './stats.js'

const ISSUER = 'https://auth.example.test/oidc'

const GOOD = {
  date: '2026-08-27',
  todayWords: 1234,
  weekWords: 5678,
  streak: 9,
  bestStreak: 40,
  dailyFloor: 2000,
  daysTogether: 100,
}

/** 假的 Logto userinfo：令牌 `tok-<sub>` 认，别的不认 */
function fakeLogtoFetch(): typeof globalThis.fetch {
  return (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    const url = String(input)
    if (!url.endsWith('/me')) return new Response('not found', { status: 404 })
    const auth = init?.headers?.['authorization'] ?? ''
    const m = /^Bearer tok-(.+)$/.exec(auth)
    if (!m) return new Response(JSON.stringify({ error: 'bad' }), { status: 401 })
    return new Response(JSON.stringify({ sub: m[1] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof globalThis.fetch
}

let dir: string
let store: Store
let server: http.Server
let base: string

beforeEach(async () => {
  clearAuthCache()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bugu-stats-'))
  store = new Store(path.join(dir, 'test.db'))
  const auth = new Auth({ issuer: ISSUER, audience: '', fetchImpl: fakeLogtoFetch() })
  server = createServer({ store, auth, now: () => '2026-08-27T10:00:00.000Z' })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  store.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

const call = (p: string, init: RequestInit = {}) => fetch(base + p, init)

const asUser = (sub: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer tok-${sub}`,
    ...(init.headers as Record<string, string> | undefined),
  },
})

/** 走一遍：认领短名 + 推一次数 */
async function setUp(sub: string, handle: string, stats: unknown = GOOD): Promise<void> {
  const a = await call('/api/v1/me/handle', asUser(sub, { method: 'PUT', body: JSON.stringify({ handle }) }))
  expect(a.status).toBe(200)
  const b = await call('/api/v1/me/stats', asUser(sub, { method: 'PUT', body: JSON.stringify(stats) }))
  expect(b.status).toBe(200)
}

describe('活着没有', () => {
  it('healthz', async () => {
    expect((await call('/healthz')).status).toBe(200)
  })
})

describe('推与读', () => {
  it('推上去，公开接口就读得到', async () => {
    await setUp('u1', 'mingting')
    const r = await call('/api/v1/u/mingting/stats')
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ handle: 'mingting', ...GOOD })
  })

  it('/me 能看到自己的短名和数', async () => {
    await setUp('u1', 'mingting')
    const r = await call('/api/v1/me', asUser('u1'))
    expect(await r.json()).toMatchObject({ handle: 'mingting', stats: GOOD })
  })

  it('没这个人就是 404', async () => {
    expect((await call('/api/v1/u/nobody/stats')).status).toBe(404)
  })

  it('【关键】认领了短名但还没推过数，也算没有', async () => {
    // 不然会吐一行全 0 出去，别人以为这人一个字没写
    await call('/api/v1/me/handle', asUser('u1', { method: 'PUT', body: JSON.stringify({ handle: 'kong' }) }))
    expect((await call('/api/v1/u/kong/stats')).status).toBe(404)
  })

  it('再推一次是覆盖，不是追加', async () => {
    await setUp('u1', 'mingting')
    await call('/api/v1/me/stats', asUser('u1', { method: 'PUT', body: JSON.stringify({ ...GOOD, todayWords: 9 }) }))
    const r = await call('/api/v1/u/mingting/stats')
    expect((await r.json()).todayWords).toBe(9)
  })

  it('短名大小写不敏感', async () => {
    await setUp('u1', 'MingTing')
    expect((await call('/api/v1/u/MINGTING/stats')).status).toBe(200)
  })
})

describe('【关键】只有那七个数能出去', () => {
  it('多塞的字段存不进去，也吐不出来', async () => {
    await setUp('u1', 'mingting', {
      ...GOOD,
      bookTitle: '某某传',
      chapter: '第一章',
      body: '正文正文正文',
      email: 'a@example.com',
    })
    const text = await (await call('/api/v1/u/mingting/stats')).text()
    for (const leak of ['某某传', '第一章', '正文', 'a@example.com', 'bookTitle', 'chapter', 'body']) {
      expect(text).not.toContain(leak)
    }
  })

  it('公开接口吐的键就是那几个，一个不多', async () => {
    await setUp('u1', 'mingting')
    const keys = Object.keys(await (await call('/api/v1/u/mingting/stats')).json()).sort()
    expect(keys).toEqual(
      [
        'bestStreak',
        'dailyFloor',
        'date',
        'daysTogether',
        'handle',
        'streak',
        'todayWords',
        'updatedAt',
        'weekWords',
      ].sort(),
    )
  })

  it('【关键】公开接口不吐 sub', async () => {
    // sub 是登录服务那边的用户号，跟公开身份是两回事，
    // 漏出去等于把不同网站上的这个人对上号
    await setUp('u1', 'mingting')
    expect(await (await call('/api/v1/u/mingting/stats')).text()).not.toContain('u1')
  })
})

describe('【关键】令牌', () => {
  it('不带令牌不许推', async () => {
    const r = await call('/api/v1/me/stats', { method: 'PUT', body: JSON.stringify(GOOD) })
    expect(r.status).toBe(401)
  })

  it('令牌不对不许推', async () => {
    const r = await call('/api/v1/me/stats', {
      method: 'PUT',
      // HTTP 头装不下非 ASCII，拿它当乱码令牌会在客户端就炸掉，测不到服务端
      headers: { authorization: 'Bearer not-a-real-token' },
      body: JSON.stringify(GOOD),
    })
    expect(r.status).toBe(401)
  })

  it('【关键】伪造一个没签名的 JWT 也进不来', async () => {
    // 只解不验的话，把 payload 改成别人的 sub 就能改别人的数据 ——
    // 而接口看起来一切正常，这是最危险的一类漏洞
    const b64 = (o: unknown) =>
      Buffer.from(JSON.stringify(o)).toString('base64url')
    const forged = `${b64({ alg: 'none' })}.${b64({ sub: 'u1', iss: ISSUER })}.`
    const r = await call('/api/v1/me/stats', {
      method: 'PUT',
      headers: { authorization: `Bearer ${forged}` },
      body: JSON.stringify(GOOD),
    })
    expect(r.status).toBe(401)
  })

  it('公开接口反过来**不要**令牌也能读', async () => {
    await setUp('u1', 'mingting')
    expect((await call('/api/v1/u/mingting/stats')).status).toBe(200)
  })

  it('别人的令牌改不了我的数', async () => {
    await setUp('u1', 'mingting')
    await call('/api/v1/me/stats', asUser('u2', { method: 'PUT', body: JSON.stringify({ ...GOOD, todayWords: 1 }) }))
    expect((await (await call('/api/v1/u/mingting/stats')).json()).todayWords).toBe(GOOD.todayWords)
  })
})

describe('短名', () => {
  it('被占了要明说，不能含糊地失败', async () => {
    await setUp('u1', 'mingting')
    const r = await call('/api/v1/me/handle', asUser('u2', { method: 'PUT', body: JSON.stringify({ handle: 'mingting' }) }))
    expect(r.status).toBe(409)
    expect((await r.json()).error).toContain('已经被人用了')
  })

  it('改成自己现在这个也算成功 —— 客户端重试不该报错', async () => {
    await setUp('u1', 'mingting')
    const r = await call('/api/v1/me/handle', asUser('u1', { method: 'PUT', body: JSON.stringify({ handle: 'mingting' }) }))
    expect(r.status).toBe(200)
  })

  it('保留名占不走', () => {
    for (const bad of ['api', 'admin', 'me', 'healthz']) {
      expect(checkHandle(bad).ok).toBe(false)
    }
  })

  it('形状不对的都拦下来', () => {
    for (const bad of ['ab', 'a'.repeat(25), 'Ming Ting', '明听', '-ming', 'ming-', 'a--b', '12345', 'a_b']) {
      expect(checkHandle(bad).ok).toBe(false)
    }
  })

  it('正常的过得去，并且统一成小写', () => {
    const r = checkHandle('  MingTing-01  ')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.handle).toBe('mingting-01')
  })
})

describe('推上来的数要合规矩', () => {
  it('日期形状不对不收', () => {
    expect(parsePublicStats({ ...GOOD, date: '2026/08/27' }).ok).toBe(false)
  })

  it('【关键】2026-02-31 这种不存在的日子不收', () => {
    // 正则过得去，但它不是一天。收下之后按日期排序会排出鬼来
    expect(parsePublicStats({ ...GOOD, date: '2026-02-31' }).ok).toBe(false)
  })

  it('负数不收', () => {
    expect(parsePublicStats({ ...GOOD, todayWords: -1 }).ok).toBe(false)
  })

  it('大到离谱的不收', () => {
    expect(parsePublicStats({ ...GOOD, todayWords: 1e12 }).ok).toBe(false)
  })

  it('缺字段不收', () => {
    const { streak: _drop, ...rest } = GOOD
    expect(parsePublicStats(rest).ok).toBe(false)
  })

  it('字符串数字不收 —— 别猜作者的意思', () => {
    expect(parsePublicStats({ ...GOOD, todayWords: '1234' }).ok).toBe(false)
  })

  it('小数四舍五入成整数', () => {
    const r = parsePublicStats({ ...GOOD, todayWords: 1234.6 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.stats.todayWords).toBe(1235)
  })

  it('坏 JSON 回 400 不是 500', async () => {
    const r = await call('/api/v1/me/stats', asUser('u1', { method: 'PUT', body: '{坏的' }))
    expect(r.status).toBe(400)
  })
})

describe('CORS', () => {
  it('公开接口允许任何网站读', async () => {
    await setUp('u1', 'mingting')
    const r = await call('/api/v1/u/mingting/stats')
    expect(r.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('【关键】要令牌的接口不开 CORS', async () => {
    // 开了的话，别人网站上的脚本就能借着浏览器里的登录状态替你改数据
    await setUp('u1', 'mingting')
    const r = await call('/api/v1/me', asUser('u1'))
    expect(r.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('预检过得去', async () => {
    expect((await call('/api/v1/u/mingting/stats', { method: 'OPTIONS' })).status).toBe(204)
  })
})

describe('删干净', () => {
  it('删了之后公开接口也读不到了', async () => {
    await setUp('u1', 'mingting')
    expect((await call('/api/v1/me', asUser('u1', { method: 'DELETE' }))).status).toBe(200)
    expect((await call('/api/v1/u/mingting/stats')).status).toBe(404)
  })

  it('删完短名能被别人认领 —— 不然等于永久占位', async () => {
    await setUp('u1', 'mingting')
    await call('/api/v1/me', asUser('u1', { method: 'DELETE' }))
    const r = await call('/api/v1/me/handle', asUser('u2', { method: 'PUT', body: JSON.stringify({ handle: 'mingting' }) }))
    expect(r.status).toBe(200)
  })
})

describe('杂项', () => {
  it('没有的接口回 404', async () => {
    expect((await call('/api/v1/瞎写的')).status).toBe(404)
  })

  it('公开接口不许用 PUT', async () => {
    expect((await call('/api/v1/u/mingting/stats', { method: 'PUT' })).status).toBe(405)
  })

  it('请求体太大要拦下来', async () => {
    const r = await call('/api/v1/me/stats', asUser('u1', { method: 'PUT', body: 'x'.repeat(20000) }))
    expect(r.status).toBe(400)
  })
})
