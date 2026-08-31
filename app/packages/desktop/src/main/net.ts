/**
 * 出站网络：代理与连通性检查。
 *
 * 为什么需要这个：**Node 自带的 fetch 不认 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量**。
 * 作者机器上明明开着代理（`http://127.0.0.1:10808`）、浏览器能开 Google，
 * 但软件里连 gemini 就是超时 —— 因为请求根本没走代理。
 *
 * 实测（2026-08-25，作者机器）：
 *   - `api.deepseek.com` 直连 HTTP 401（通的，只是没带 Key）
 *   - `generativelanguage.googleapis.com` 直连超时
 *   - `api.openai.com` 直连超时，而且 DNS 解析出来的是个不相干的地址（污染）
 *   - 挂上代理之后三个全通
 *
 * ⚠️ 必须用 undici **自带的 fetch**，不能把 undici 的 ProxyAgent 塞给全局 fetch。
 * Node 24 内置的是 undici 7.x，装进来的是 8.x，两边的 dispatcher 接口对不上，
 * 会报 `invalid onRequestStart method`。用同一个包里的 fetch 就没这问题。
 */

import { ProxyAgent, fetch as undiciFetch } from 'undici'

/** `auto` = 读环境变量；`off` = 不用代理；其它值当成代理地址 */
export const PROXY_AUTO = 'auto'
export const PROXY_OFF = 'off'

/**
 * 算出这次实际要用的代理地址。
 *
 * `auto` 时按 `HTTPS_PROXY` → `HTTP_PROXY` → `ALL_PROXY` 的顺序找，
 * 大小写都认 —— Windows 上两种写法都有人用。
 */
export function resolveProxy(
  setting: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const v = setting.trim()
  if (v === PROXY_OFF) return null
  if (v !== PROXY_AUTO && v !== '') return v

  for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
    const got = env[k]?.trim()
    if (got) return got
  }
  return null
}

/**
 * 代理连接池。
 *
 * 每次请求新建一个 ProxyAgent 会一直攒着 socket 不放，
 * 长时间开着软件会把句柄用光。按地址缓存。
 */
const agents = new Map<string, ProxyAgent>()

function agentFor(url: string): ProxyAgent {
  let a = agents.get(url)
  if (!a) {
    a = new ProxyAgent(url)
    agents.set(url, a)
  }
  return a
}

/**
 * 给 SDK 用的 fetch。
 *
 * 不需要代理时返回 undefined —— 让 SDK 用它自己的默认实现，少一层包装。
 */
export function makeFetch(proxyUrl: string | null): typeof globalThis.fetch | undefined {
  if (!proxyUrl) return undefined
  const dispatcher = agentFor(proxyUrl)
  const f = (input: unknown, init?: unknown) =>
    undiciFetch(input as never, Object.assign({}, init as object, { dispatcher }) as never)
  return f as unknown as typeof globalThis.fetch
}

export interface ProbeResult {
  ok: boolean
  /** HTTP 状态码。能收到状态码就说明**连上了**，401/404 都算通 */
  status?: number
  /** 实际用的代理，没用代理时为 null */
  proxy: string | null
  /** 给作者看的一句话 */
  message: string
}

/**
 * 试着连一下这个端点，只为回答「到底是墙、是地址错、还是 Key 错」。
 *
 * 故意**不带 API Key**：这一步只验网络通不通。
 * 收到任何 HTTP 状态码都算通 —— 401 说明服务器在听，只是没认证。
 */
export async function probeEndpoint(
  baseUrl: string,
  proxySetting: string,
  timeoutMs = 12_000,
): Promise<ProbeResult> {
  const proxy = resolveProxy(proxySetting)
  const url = baseUrl.trim().replace(/\/+$/, '')
  if (!url) return { ok: false, proxy, message: '端点地址是空的，先填一个。' }

  let origin: string
  try {
    origin = new URL(url).origin
  } catch {
    return { ok: false, proxy, message: `「${url}」不像一个网址。应该以 http:// 或 https:// 开头。` }
  }

  const f = makeFetch(proxy) ?? fetch
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await f(origin, { method: 'HEAD', signal: ctrl.signal })
    return {
      ok: true,
      status: r.status,
      proxy,
      message: proxy ? `连上了（经代理 ${proxy}）。` : '连上了。',
    }
  } catch (e) {
    const code = (e as { cause?: { code?: string } }).cause?.code ?? (e as Error).name
    return { ok: false, proxy, message: explainNetworkFailure(code, proxy, origin) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 把网络错误翻译成「下一步该干什么」。
 *
 * 只说「连不上」等于没说 —— 作者要的是知道该改地址、开代理，还是等一会儿。
 */
export function explainNetworkFailure(code: string, proxy: string | null, host: string): string {
  const who = new URL(host).hostname
  if (!proxy) {
    if (code === 'AbortError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') {
      return (
        `连 ${who} 超时，而且没有走代理。` +
        `国内直连 Google、OpenAI 一般是连不上的 —— ` +
        `如果你本机开着代理，在下面的「代理」里填上它的地址（比如 http://127.0.0.1:10808）。`
      )
    }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return `解析不出 ${who} 的地址。检查网络，或者在下面填一个代理地址。`
    }
  } else {
    if (code === 'ECONNREFUSED') {
      return `代理 ${proxy} 拒绝连接 —— 多半是代理软件没开，或者端口填错了。`
    }
    if (code === 'AbortError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') {
      return `经代理 ${proxy} 连 ${who} 还是超时。确认代理本身能上外网。`
    }
  }
  return `连不上 ${who}（${code}）${proxy ? `，用的代理是 ${proxy}` : '，没有走代理'}。`
}
