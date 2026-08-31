/**
 * 跟对外统计服务说话 —— 真发请求的那一半。
 *
 * 规范：更新文档/08-账号与对外接口.md　服务端在 `server/`
 *
 * 拼地址、挑字段、带不带令牌都在 `@bugu/core` 的 statsapi 里（有测试钉着）；
 * 这儿只剩下「把它发出去，再把结果翻译成人话」。
 *
 * 单独一个文件、**不 import electron**，是为了能拿假的 fetch 直接测 ——
 * 而这一层最容易出的错恰恰是「服务器回了个非 JSON 的网关错误页，
 * 客户端当场抛了个看不懂的异常」这种只在真出事时才走到的路径。
 */

import { parseStatsError, statsHeaders, type StatsRequest } from '@bugu/core'

/** 服务器没反应时不能让界面一直转圈 */
export const TIMEOUT_MS = 20_000

/**
 * 发一次，成了就把 body 交出来，没成就抛一句人话。
 *
 * `token` 只有 `req.auth` 为真时才会被用上 —— 公开接口就算手上有令牌
 * 也不带，这一条由 `statsHeaders` 保证。
 */
export async function sendStats(
  req: StatsRequest,
  token: string | null,
  f: typeof globalThis.fetch,
  timeoutMs = TIMEOUT_MS,
): Promise<unknown> {
  const headers = statsHeaders(req, token)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)

  let res: Response
  try {
    res = await f(req.url, {
      method: req.method,
      headers,
      ...(req.body === undefined ? {} : { body: req.body }),
      signal: ctrl.signal,
    })
  } catch (e) {
    // 连不上和超时要分开说：一个是「网络/代理的事」，一个是「服务器卡住了」，
    // 作者下一步该做的事不一样
    const timedOut = e instanceof Error && e.name === 'AbortError'
    throw new Error(
      timedOut
        ? '统计服务没反应，超时了。等一会儿再试。'
        : `连不上统计服务（${e instanceof Error ? e.message : String(e)}）。检查网络，或者在 AI 设置里配一下代理。`,
    )
  } finally {
    clearTimeout(timer)
  }

  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    // 不是 JSON —— 多半是反代吐的 HTML 错误页。原样交给 parseStatsError 兜底，
    // 它读不出 error 字段就会按状态码说话，而不是把一整页 HTML 甩给作者
    body = text
  }

  if (!res.ok) throw new Error(parseStatsError(res.status, body))
  return body
}
