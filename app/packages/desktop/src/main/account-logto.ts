/**
 * 用系统浏览器登录（OIDC 授权码 + PKCE）。
 *
 * 规范：更新文档/08-账号与对外接口.md §2
 *
 * ─────────────────────────────────────────────────────────────
 * 【三条不许破的规矩】
 *
 * 1. **软件从头到尾看不见密码。** 密码只在系统浏览器里输，我们拿到的
 *    只有一个授权码。这不是「顺便安全一点」，这是走浏览器的全部理由。
 * 2. **令牌跟 API Key 一个待遇**：safeStorage 加密，放应用数据目录，
 *    **绝不进同步文件夹** —— 同步文件夹是会被网盘上传的。
 * 3. **只在主进程里碰令牌。** 渲染进程拿到的永远是「登录了没有、是谁」，
 *    拿不到令牌本身。
 * ─────────────────────────────────────────────────────────────
 *
 * 回调走**本机回环**（`http://127.0.0.1:53682/callback`）而不是自定义
 * 协议：免安装版可能注册不上协议（要写注册表），而回环到哪儿都能用。
 * 端口写死三个备选，全都登记进 IdP 白名单，占用了就换下一个。
 *
 * 走 net.ts 的 fetch —— 作者机器上挂着代理，Node 自带的 fetch 不认
 * HTTPS_PROXY，不走这一层就会「明明能上网却连不上」。
 */

import crypto from 'node:crypto'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app, safeStorage, shell } from 'electron'
import {
  authorizeUrl,
  checkIdToken,
  discoveryUrl,
  endSessionUrl,
  loopbackRedirect,
  LOOPBACK_PORTS,
  parseCallback,
  parseEndpoints,
  parseTokenResponse,
  DEFAULT_SCOPES,
  retryScopes,
  readIdToken,
  refreshRequestBody,
  tokenExpired,
  tokenRequestBody,
  type OidcConfig,
  type OidcEndpoints,
} from '@bugu/core'
import { makeFetch, resolveProxy } from './net.js'

/** 没配代理时 makeFetch 返回 undefined，意思是「用全局那个」 */
const httpFetch = (proxySetting: string): typeof globalThis.fetch =>
  makeFetch(resolveProxy(proxySetting)) ?? globalThis.fetch

/**
 * 登录服务的地址。
 *
 * **写死在代码里，界面上不给改。**
 *
 * 给用户一个「登录服务器地址」输入框，等于给了别人一个可以骗他填的框 ——
 * 填成一台恶意的 IdP，他就把账号交出去了，而界面上完全看不出异常。
 * 这种「一旦被利用后果很重、正常用户永远不会用到」的开关不该存在。
 *
 * 换地址是改代码 + 重新打包的事 —— 反正也要重新打包。
 */
export const LOGTO: OidcConfig = {
  issuer: 'https://auth.ferret.icu/oidc',
  clientId: 'raiemcmc08eg4mu4le2hc',
  /**
   * API 资源标识符 —— **等那台读统计的小服务真的存在了再填**。
   *
   * 现在填上的后果是：登录时会带 `resource=`，而 Logto 那边还没建这个
   * API 资源，于是直接 `invalid_scope`，**整个登录都进不去**。
   * 为了一个还没有的功能把登录搞挂，不划算。
   */
  resource: '',
}

/** 令牌文件。跟 secrets.enc 一样在 userData 里，不在作品目录里 */
const sessionFile = (): string => path.join(app.getPath('userData'), 'oidc.enc')

/** 等作者在浏览器里操作多久算超时。他可能要注册、要收验证码 */
const LOGIN_TIMEOUT_MS = 5 * 60_000

export interface StoredLogin {
  issuer: string
  clientId: string
  sub: string
  name: string
  refreshToken: string | null
  /** 只在内存里有意义，落盘也无所谓 —— 它本来就短命 */
  accessToken: string
  expiresAt: number | null
  idToken: string | null
  /** 这次登录里被 IdP 拒掉的权限 */
  dropped?: string[]
}

let cached: StoredLogin | null | undefined

async function readStored(): Promise<StoredLogin | null> {
  if (cached !== undefined) return cached
  try {
    cached = JSON.parse(safeStorage.decryptString(await fs.readFile(sessionFile()))) as StoredLogin
  } catch {
    // 文件不在、解不开（换了台机器）、格式坏了 —— 都当成没登录。
    // 让作者重新登录一次，比在这儿猜要老实
    cached = null
  }
  return cached
}

async function writeStored(s: StoredLogin | null): Promise<void> {
  cached = s
  if (s === null) {
    await fs.rm(sessionFile(), { force: true })
    return
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('这台机器上拿不到加密能力，登录状态不敢明文存')
  }
  await fs.mkdir(path.dirname(sessionFile()), { recursive: true })
  await fs.writeFile(sessionFile(), safeStorage.encryptString(JSON.stringify(s)))
}

// ───────────────────────── PKCE ─────────────────────────

const b64url = (b: Buffer): string =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** verifier 是 43–128 个字符的随机串；challenge 是它的 SHA-256 */
function makePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(crypto.randomBytes(32))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

const randomId = (): string => b64url(crypto.randomBytes(16))

// ───────────────────────── 回环服务器 ─────────────────────────

/** 浏览器跳回来时给他看的那一页。**不要留在浏览器里让人发呆** */
function donePage(title: string, line: string): string {
  return [
    '<!doctype html><meta charset="utf-8">',
    `<title>${title}</title>`,
    '<style>',
    'body{font-family:system-ui,"Microsoft YaHei",sans-serif;background:#faf9f7;color:#2b2722;',
    'display:flex;align-items:center;justify-content:center;height:100vh;margin:0}',
    '.b{text-align:center;line-height:2}.t{font-size:20px;font-weight:700}',
    '.s{color:#8a8178;font-size:14px}',
    '</style>',
    `<div class="b"><div class="t">${title}</div><div class="s">${line}</div></div>`,
  ].join('')
}

interface Waited {
  rawUrl: string
  port: number
}

/** 回调地址里带没带 error。**决定给浏览器看哪一页，不能不看就说成功** */
function callbackFailed(rawUrl: string): string | null {
  try {
    const q = new URL(rawUrl, 'http://127.0.0.1').searchParams
    const err = q.get('error')
    if (!err) return null
    const desc = q.get('error_description')
    return desc ? `${err}：${desc}` : err
  } catch {
    return null
  }
}

/**
 * 起一个只服务一次的回环服务器，等浏览器跳回来。
 *
 * 端口挨个试：占用了就换下一个，三个都不行才报错 ——
 * 直接失败的话作者只会看到「登录不了」，根本不知道是端口被占了。
 */
function waitForCallback(
  paths: { callback: string; signout?: string },
  signal: { cancelled: boolean },
): { started: Promise<number>; done: Promise<Waited>; close(): void } {
  let server: http.Server | null = null
  let resolveStarted!: (p: number) => void
  let rejectStarted!: (e: Error) => void
  let resolveDone!: (w: Waited) => void
  let rejectDone!: (e: Error) => void

  const started = new Promise<number>((res, rej) => {
    resolveStarted = res
    rejectStarted = rej
  })
  const done = new Promise<Waited>((res, rej) => {
    resolveDone = res
    rejectDone = rej
  })

  const close = (): void => {
    server?.close()
    server = null
  }

  void (async () => {
    for (const port of LOOPBACK_PORTS) {
      const ok = await new Promise<boolean>((res) => {
        const s = http.createServer((req, reply) => {
          const url = req.url ?? '/'
          if (paths.signout && url.startsWith(paths.signout)) {
            reply.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            reply.end(donePage('已退出', '可以关掉这个页面了。'))
            return
          }
          if (!url.startsWith(paths.callback)) {
            reply.writeHead(404).end()
            return
          }
          // 先看清楚是成功还是失败再吐页面。
          // 初版是不看就吐「登录成功」—— 地址栏里明明写着 error=invalid_scope，
          // 页面上却说成功，作者只能一脸茫然地回到软件里看红条
          const failed = callbackFailed(url)
          reply.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          reply.end(
            failed === null
              ? donePage('登录成功', '回到不咕鸟继续写吧，这个页面可以关了。')
              : donePage('没登上', `${failed}　回不咕鸟看看提示。`),
          )
          resolveDone({ rawUrl: url, port })
        })
        s.once('error', () => res(false))
        s.listen(port, '127.0.0.1', () => {
          server = s
          res(true)
        })
      })
      if (ok) {
        resolveStarted(port)
        // 作者可能开着浏览器发呆，也可能直接关掉了标签页 —— 不能永远等下去
        setTimeout(() => {
          if (!signal.cancelled) rejectDone(new Error('等太久了，登录没完成'))
          close()
        }, LOGIN_TIMEOUT_MS).unref?.()
        return
      }
    }
    const e = new Error(
      `${LOOPBACK_PORTS.join('、')} 三个端口都被占着，登录用不了。关掉占用的程序再试。`,
    )
    rejectStarted(e)
    rejectDone(e)
  })()

  return { started, done, close }
}

// ───────────────────────── 端点缓存 ─────────────────────────

let endpointsCache: { issuer: string; at: number; value: OidcEndpoints } | null = null

async function getEndpoints(config: OidcConfig, proxySetting: string): Promise<OidcEndpoints> {
  const fresh = endpointsCache && endpointsCache.issuer === config.issuer
  // 发现文档基本不变，缓存一小时，省得每次登录都多一趟往返
  if (fresh && Date.now() - endpointsCache!.at < 3_600_000) return endpointsCache!.value

  const f = httpFetch(proxySetting)
  const res = await f(discoveryUrl(config.issuer), { method: 'GET' })
  if (!res.ok) {
    throw new Error(`读不到 ${config.issuer} 的发现文档（HTTP ${res.status}）。地址填对了吗？`)
  }
  const value = parseEndpoints(await res.json())
  endpointsCache = { issuer: config.issuer, at: Date.now(), value }
  return value
}

// ───────────────────────── 对外 ─────────────────────────

export interface LoginState {
  signedIn: boolean
  sub: string
  name: string
  /** 配置齐了没有。缺了就连登录按钮都不该给 */
  configured: boolean
  /**
   * 登录时被 IdP 拒掉、只好放弃的权限。
   *
   * 登进去了但少了点东西，得**说出来** —— 不然作者会奇怪
   * 「为什么昵称是空的」「为什么过一会儿又要我登一次」。
   */
  dropped: string[]
}

export function stateOf(s: StoredLogin | null, config: OidcConfig): LoginState {
  const configured = !!config.issuer && !!config.clientId
  if (!s) return { signedIn: false, sub: '', name: '', configured, dropped: [] }
  return { signedIn: true, sub: s.sub, name: s.name, configured, dropped: s.dropped ?? [] }
}

export async function loginState(config: OidcConfig): Promise<LoginState> {
  return stateOf(await readStored(), config)
}

/**
 * 把 IdP 的报错翻译成「该去改哪儿」。
 *
 * `invalid_scope: requested scope is not allowed` 这种话，作者看了
 * 只会觉得是软件坏了 —— 实际上是 Logto 那边少开了一个开关。
 * 报错要能直接指向操作。
 */
function explainAuthError(why: string, scopes: readonly string[]): string {
  if (!why.includes('invalid_scope')) return why
  return [
    why,
    '',
    `这次要的权限是：${scopes.join(' ')}`,
    'Logto 那边不给。最常见的一种：这个应用被建成了「第三方应用」——',
    '第三方应用默认只给 openid，别的要在应用的「权限」页签里逐个授权。',
    '',
    '两条路（挑一条）：',
    '· 在「权限」页签里把 profile、offline_access 加上',
    '· 或者建一个不是第三方的「原生应用」，把 App ID 换过来',
  ].join(String.fromCharCode(10))
}

/**
 * 走一遍浏览器登录。
 *
 * 全过程软件只经手一个授权码；密码在系统浏览器里，我们看不见。
 */
/** 一次尝试的结果：拿到令牌了，或者被 IdP 以某个权限为由拒了 */
type Attempt =
  | { ok: true; stored: StoredLogin }
  | { ok: false; why: string; error?: string; rejectedScope?: string }

/** 走一趟浏览器。scopes 是这一次要的权限 */
async function attemptLogin(
  config: OidcConfig,
  endpoints: OidcEndpoints,
  proxySetting: string,
  scopes: readonly string[],
): Promise<Attempt> {
  const { verifier, challenge } = makePkce()
  const state = randomId()
  const nonce = randomId()
  const signal = { cancelled: false }
  const srv = waitForCallback({ callback: '/callback', signout: '/signout' }, signal)

  const port = await srv.started
  const redirectUri = loopbackRedirect(port)

  try {
    await shell.openExternal(
      authorizeUrl({ endpoints, config, redirectUri, codeChallenge: challenge, state, nonce, scopes }),
    )
    const { rawUrl } = await srv.done

    const cb = parseCallback(rawUrl, state)
    if (!cb.ok) {
      const out: Attempt = { ok: false, why: cb.why }
      if (cb.error) out.error = cb.error
      if (cb.scope) out.rejectedScope = cb.scope
      return out
    }

    const f = httpFetch(proxySetting)
    const res = await f(endpoints.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: tokenRequestBody({ config, redirectUri, code: cb.code, codeVerifier: verifier }),
    })
    const body = (await res.json()) as Record<string, unknown>
    if (!res.ok) {
      const d = typeof body['error_description'] === 'string' ? body['error_description'] : ''
      return { ok: false, why: `换令牌失败（HTTP ${res.status}）${d ? '：' + d : ''}` }
    }

    const tokens = parseTokenResponse(body)
    let sub = ''
    let name = ''
    if (tokens.idToken) {
      const claims = readIdToken(tokens.idToken)
      const good = checkIdToken(claims, { issuer: config.issuer, clientId: config.clientId, nonce })
      if (!good.ok) return { ok: false, why: good.why }
      sub = claims.sub
      name = claims.name || claims.username || ''
    }

    return {
      ok: true,
      stored: {
        issuer: config.issuer,
        clientId: config.clientId,
        sub,
        name,
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        expiresAt: tokens.expiresAt,
        idToken: tokens.idToken,
      },
    }
  } finally {
    signal.cancelled = true
    srv.close()
  }
}

/**
 * 走一遍浏览器登录。
 *
 * 全过程软件只经手一个授权码；密码在系统浏览器里，我们看不见。
 *
 * **被拒了一个可有可无的权限时，去掉它再来一次。**
 * 第一次真连就栽在这儿：Logto 那边这个应用没被授予 `profile`，
 * 于是整个登录进不去 —— 为了一个只用来显示昵称的权限登不进去，
 * 这买卖不划算。退一步之后昵称是空的，但人进得来，
 * 而且界面会说清楚少了什么。
 */
export async function signInWithBrowser(
  config: OidcConfig,
  proxySetting: string,
  extraScopes: string[] = [],
): Promise<LoginState> {
  if (!config.issuer || !config.clientId) {
    throw new Error('还没填服务地址和 App ID')
  }
  const endpoints = await getEndpoints(config, proxySetting)

  let scopes: readonly string[] = [...DEFAULT_SCOPES, ...extraScopes]
  const wanted = scopes
  // 最多退两步（profile、offline_access），退到只剩 openid 就没得退了
  for (let round = 0; round < 3; round++) {
    const r = await attemptLogin(config, endpoints, proxySetting, scopes)
    if (r.ok) {
      const dropped = wanted.filter((x) => !scopes.includes(x))
      const stored: StoredLogin = { ...r.stored, dropped }
      await writeStored(stored)
      return stateOf(stored, config)
    }
    if (r.error !== 'invalid_scope') throw new Error(r.why)

    const next = retryScopes(scopes, r.rejectedScope)
    if (next === null) throw new Error(explainAuthError(r.why, scopes))
    scopes = next
  }
  throw new Error('权限一直谈不拢，登录没成功')
}

/**
 * 拿一个还能用的访问令牌。过期了就用刷新令牌换。
 *
 * **只在主进程里调用** —— 返回值是真令牌，绝不能过 IPC 给渲染进程。
 */
export async function freshAccessToken(
  config: OidcConfig,
  proxySetting: string,
): Promise<string | null> {
  const s = await readStored()
  if (!s) return null
  if (!tokenExpired(s.expiresAt)) return s.accessToken
  if (!s.refreshToken) {
    // 没有刷新令牌又过期了：只能重新登录。清掉，别让界面显示「已登录」骗人
    await writeStored(null)
    return null
  }

  const endpoints = await getEndpoints(config, proxySetting)
  const f = httpFetch(proxySetting)
  const res = await f(endpoints.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: refreshRequestBody({ config, refreshToken: s.refreshToken }),
  })
  if (!res.ok) {
    // 刷新令牌被吊销/过期了，重新登录
    await writeStored(null)
    return null
  }
  const t = parseTokenResponse(await res.json())
  await writeStored({
    ...s,
    accessToken: t.accessToken,
    expiresAt: t.expiresAt,
    // 服务端可能轮换刷新令牌，给了新的就换上；没给就接着用旧的
    refreshToken: t.refreshToken ?? s.refreshToken,
    idToken: t.idToken ?? s.idToken,
  })
  return t.accessToken
}

/**
 * 退出登录。
 *
 * 本地一定清掉；IdP 那边能清就清 —— 不清的话下次点登录会直接进去，
 * 作者会以为「退出没生效」。
 */
export async function signOut(config: OidcConfig, proxySetting: string): Promise<LoginState> {
  const s = await readStored()
  await writeStored(null)
  if (s && config.issuer) {
    try {
      const endpoints = await getEndpoints(config, proxySetting)
      const url = endSessionUrl({
        endpoints,
        config,
        idToken: s.idToken,
        redirectUri: loopbackRedirect(LOOPBACK_PORTS[0], '/signout'),
      })
      if (url) {
        const signal = { cancelled: false }
        const srv = waitForCallback({ callback: '/signout' }, signal)
        await srv.started
        await shell.openExternal(url)
        // 不等它回来：本地已经清干净了，浏览器那边慢慢跳
        setTimeout(() => {
          signal.cancelled = true
          srv.close()
        }, 20_000).unref?.()
      }
    } catch {
      // IdP 那边清不掉不该让「退出」失败 —— 本地已经清了
    }
  }
  return stateOf(null, config)
}

/** 只给测试和「换了服务地址」时用 */
export function forgetCachedLogin(): void {
  cached = undefined
  endpointsCache = null
}
