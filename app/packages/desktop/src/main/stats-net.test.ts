/**
 * 发请求那一层。用假的 fetch 跑，不碰网络。
 *
 * 这里验的都是**只在真出事时才走到**的路径：网关吐了 HTML、
 * 服务器超时、令牌过期。平时跑不到，出事时全靠它们把话说清楚。
 */

import { describe, expect, it, vi } from 'vitest'
import {
  myProfileRequest,
  publicStatsRequest,
  pushStatsRequest,
  type PublicStats,
} from '@bugu/core'
import { sendStats } from './stats-net.js'

const BASE = 'https://bugu.char46.top'
const SEVEN: PublicStats = {
  date: '2026-08-28',
  todayWords: 1200,
  weekWords: 5400,
  streak: 9,
  bestStreak: 21,
  dailyFloor: 1000,
  daysTogether: 47,
}

/** 一个只会回同一份响应的 fetch */
function fakeFetch(status: number, body: string, contentType = 'application/json') {
  return vi.fn(async (_url: unknown, _init: unknown) =>
    new Response(body, { status, headers: { 'content-type': contentType } }),
  ) as unknown as typeof globalThis.fetch
}

describe('发出去的请求长什么样', () => {
  it('推数：PUT、带令牌、body 是那七个数', async () => {
    const f = fakeFetch(200, '{"ok":true,"handle":"ming"}')
    await sendStats(pushStatsRequest(BASE, SEVEN), 'tok-1', f)

    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/api/v1/me/stats`)
    expect(init.method).toBe('PUT')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-1')
    expect(JSON.parse(init.body as string)).toEqual(SEVEN)
  })

  it('【关键】公开接口手上有令牌也不带', async () => {
    const f = fakeFetch(200, '{"handle":"ming"}')
    await sendStats(publicStatsRequest(BASE, 'ming'), 'tok-1', f)

    const [, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined()
  })
})

describe('服务器不高兴的时候', () => {
  it('401 说的是「重新登录」，不是一串状态码', async () => {
    const f = fakeFetch(401, '{"error":"令牌无效或已过期"}')
    await expect(sendStats(myProfileRequest(BASE), 'tok', f)).rejects.toThrow('令牌无效或已过期')
  })

  it('短名被占了要指名道姓', async () => {
    const f = fakeFetch(409, '{"error":"「ming」已经被人用了"}')
    await expect(sendStats(myProfileRequest(BASE), 'tok', f)).rejects.toThrow('已经被人用了')
  })

  it('反代吐 HTML 错误页时不把整页 HTML 甩给作者', async () => {
    const f = fakeFetch(502, '<html><body>502 Bad Gateway</body></html>', 'text/html')
    await expect(sendStats(myProfileRequest(BASE), 'tok', f)).rejects.toThrow(/服务器出错了（HTTP 502）/)
  })

  it('空 body 也能给出一句话', async () => {
    const f = fakeFetch(500, '')
    await expect(sendStats(myProfileRequest(BASE), 'tok', f)).rejects.toThrow(/HTTP 500/)
  })
})

describe('网络本身出事', () => {
  it('超时说成「没反应」，并且不会一直挂着', async () => {
    const f = (async (_u: unknown, init: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init.signal?.addEventListener('abort', () => {
          const e = new Error('aborted')
          e.name = 'AbortError'
          rej(e)
        })
      })) as unknown as typeof globalThis.fetch

    await expect(sendStats(myProfileRequest(BASE), 'tok', f, 20)).rejects.toThrow('超时')
  })

  it('连不上时提一句代理 —— 作者机器上挂着代理，这是最常见的原因', async () => {
    const f = (async () => {
      throw new Error('fetch failed')
    }) as unknown as typeof globalThis.fetch

    await expect(sendStats(myProfileRequest(BASE), 'tok', f)).rejects.toThrow('代理')
  })
})

describe('没令牌', () => {
  it('要登录的接口在发出去之前就拦下来，不发一个注定 401 的请求', async () => {
    const f = fakeFetch(200, '{}')
    await expect(sendStats(myProfileRequest(BASE), null, f)).rejects.toThrow(/令牌/)
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })
})
