/**
 * 五个接口，一个 http 服务。
 *
 * 规范：更新文档/08-账号与对外接口.md §3
 *
 *   GET  /healthz                     活着没有
 *   GET  /api/v1/u/:handle/stats      **公开只读**，别的网站读这个
 *   GET  /api/v1/me                   我是谁、短名是什么
 *   PUT  /api/v1/me/handle            认领/改短名
 *   PUT  /api/v1/me/stats             推那七个数
 *   DELETE /api/v1/me                 把我的数据整个删掉
 *
 * 没用框架 —— 五条路由，`node:http` 够了，少一层依赖就少一层要跟着升级
 * 的东西。这台服务的价值在于**十年后还能跑**，不在于写得花哨。
 */

import http from 'node:http'
import { Auth, bearerOf } from './auth.js'
import { checkHandle } from './handle.js'
import type { Store } from './db.js'
import { parsePublicStats, toPublicJson } from './stats.js'
import { checkAward } from './awards.js'

export interface ServerDeps {
  store: Store
  auth: Auth
  now?: () => string
  /**
   * 谁能发奖状（Logto sub 的名单）。
   *
   * **默认空集 = 谁都不能发。** 这一条要默认关着：
   * 忘了配的后果应该是「发不出去」，不该是「谁都能发」。
   */
  admins?: ReadonlySet<string>
}

/** 请求体最大多少。七个数撑死几百字节，给 16KB 已经很宽松 */
const MAX_BODY = 16 * 1024

function send(res: http.ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    // 别让浏览器猜类型
    'x-content-type-options': 'nosniff',
    ...extra,
  })
  res.end(text)
}

function fail(res: http.ServerResponse, status: number, why: string): void {
  send(res, status, { error: why })
}

async function readBody(req: http.IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false; why: string }> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    const buf = c as Buffer
    size += buf.length
    // 超了就当场停 —— 不能先收完再判断，那正是被人灌爆内存的办法
    if (size > MAX_BODY) return { ok: false, why: '请求体太大' }
    chunks.push(buf)
  }
  if (size === 0) return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  } catch {
    return { ok: false, why: '请求体不是合法的 JSON' }
  }
}

export function createServer(deps: ServerDeps): http.Server {
  const now = deps.now ?? (() => new Date().toISOString())
  const admins = deps.admins ?? new Set<string>()

  const requireUser = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<string | null> => {
    const r = await deps.auth.verify(bearerOf(req.headers.authorization) ?? '')
    if (!r.ok) {
      fail(res, r.status, r.why)
      return null
    }
    return r.sub
  }

  return http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const p = url.pathname.replace(/\/+$/, '') || '/'
        const method = req.method ?? 'GET'

        if (p === '/healthz') {
          send(res, 200, { ok: true })
          return
        }

        // ── 公开只读 ──
        //
        // 别的网站要用 fetch 读它，所以必须开 CORS。
        // 开成 `*` 是安全的：这个接口**不认令牌、不带 cookie**，
        // 吐的东西本来就是公开的。
        const pub = /^\/api\/v1\/u\/([^/]+)\/stats$/.exec(p)
        if (pub) {
          const cors = {
            'access-control-allow-origin': '*',
            // 公开数据，缓存一分钟。别人网站刷得再勤也压不垮这台机器
            'cache-control': 'public, max-age=60',
          }
          if (method === 'OPTIONS') {
            res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, OPTIONS' })
            res.end()
            return
          }
          if (method !== 'GET') {
            fail(res, 405, '只支持 GET')
            return
          }
          const h = checkHandle(decodeURIComponent(pub[1] ?? ''))
          if (!h.ok) {
            // 名字本身就不合法，等于没这个人。不用把规则讲给陌生人听
            send(res, 404, { error: '没有这个人' }, cors)
            return
          }
          const row = deps.store.byHandle(h.handle)
          if (!row || !row.updatedAt) {
            send(res, 404, { error: '没有这个人' }, cors)
            return
          }
          send(res, 200, { handle: row.handle, updatedAt: row.updatedAt, ...toPublicJson(row) }, cors)
          return
        }

        // ── 下面都要令牌 ──
        if (p === '/api/v1/me' && method === 'GET') {
          const sub = await requireUser(req, res)
          if (sub === null) return
          const row = deps.store.bySub(sub)
          send(res, 200, {
            handle: row?.handle ?? '',
            updatedAt: row?.updatedAt ?? '',
            stats: row ? toPublicJson(row) : null,
            // 奖状只在这儿吐。公开接口一个字段都不加 ——
            // 「对外统计只发七个整数」那句话要继续成立
            awards: deps.store.awardsOf(sub),
          })
          return
        }

        if (p === '/api/v1/me' && method === 'DELETE') {
          const sub = await requireUser(req, res)
          if (sub === null) return
          deps.store.forget(sub)
          send(res, 200, { ok: true })
          return
        }

        if (p === '/api/v1/me/handle' && method === 'PUT') {
          const sub = await requireUser(req, res)
          if (sub === null) return
          const body = await readBody(req)
          if (!body.ok) {
            fail(res, 400, body.why)
            return
          }
          const h = checkHandle((body.value as Record<string, unknown>)['handle'])
          if (!h.ok) {
            fail(res, 400, h.why)
            return
          }
          const claimed = deps.store.claimHandle(sub, h.handle)
          if (!claimed.ok) {
            fail(res, 409, claimed.why)
            return
          }
          send(res, 200, { handle: h.handle })
          return
        }

        if (p === '/api/v1/me/stats' && method === 'PUT') {
          const sub = await requireUser(req, res)
          if (sub === null) return
          const body = await readBody(req)
          if (!body.ok) {
            fail(res, 400, body.why)
            return
          }
          const parsed = parsePublicStats(body.value)
          if (!parsed.ok) {
            fail(res, 400, parsed.why)
            return
          }
          deps.store.putStats(sub, parsed.stats, now())
          const row = deps.store.bySub(sub)
          send(res, 200, { ok: true, handle: row?.handle ?? '' })
          return
        }

        // ── 发奖状 ──
        //
        // 只有名单上的 sub 能用。**名单空着时谁都不能发** ——
        // 忘了配的后果应该是「发不出去」，不该是「谁都能发」。
        if (
          p === '/api/v1/admin/awards' &&
          (method === 'PUT' || method === 'DELETE' || method === 'GET')
        ) {
          const sub = await requireUser(req, res)
          if (sub === null) return
          if (!admins.has(sub)) {
            // 说「没有这个接口」而不是「你不是管理员」——
            // 后者等于告诉陌生人「这儿有个管理接口，再找找入口」
            fail(res, 404, '没有这个接口')
            return
          }
          // GET 从查询串取短名，PUT/DELETE 从请求体取
          let o: Record<string, unknown>
          if (method === 'GET') {
            o = { handle: url.searchParams.get('handle') ?? '' }
          } else {
            const body = await readBody(req)
            if (!body.ok) {
              fail(res, 400, body.why)
              return
            }
            o = body.value as Record<string, unknown>
          }

          // 发给谁：按短名找。**发错人比发不出去麻烦**，所以找不到就明说
          const h = checkHandle(o['handle'])
          if (!h.ok) {
            fail(res, 400, h.why)
            return
          }
          const target = deps.store.byHandle(h.handle)
          if (!target) {
            fail(res, 404, `没有「${h.handle}」这个人`)
            return
          }
          const targetSub = deps.store.subOfHandle(h.handle)
          if (!targetSub) {
            fail(res, 404, `没有「${h.handle}」这个人`)
            return
          }

          // 看看他现在有哪些。**发之前先看一眼**，免得重复发或者撤错
          if (method === 'GET') {
            send(res, 200, { handle: h.handle, awards: deps.store.awardsOf(targetSub) })
            return
          }

          if (method === 'DELETE') {
            const id = typeof o['id'] === 'string' ? o['id'].trim().toLowerCase() : ''
            if (!id) {
              fail(res, 400, '要说撤哪一张（id）')
              return
            }
            const gone = deps.store.revoke(targetSub, id)
            send(res, 200, { ok: true, removed: gone, awards: deps.store.awardsOf(targetSub) })
            return
          }

          const a = checkAward(o)
          if (!a.ok) {
            fail(res, 400, a.why)
            return
          }
          deps.store.grant(targetSub, a.value, now())
          send(res, 200, { ok: true, awards: deps.store.awardsOf(targetSub) })
          return
        }

        fail(res, 404, '没有这个接口')
      } catch (e) {
        // 具体的内部错误不往外说 —— 那是给攻击者的地图。日志里留全的
        console.error('[bugu-stats]', e)
        if (!res.headersSent) fail(res, 500, '服务器出错了')
      }
    })()
  })
}
