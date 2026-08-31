/**
 * OIDC 授权码 + PKCE —— 纯计算的那一半。
 *
 * 规范：更新文档/08-账号与对外接口.md §2
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么桌面端必须走浏览器，而不是自己做个登录框】
 *
 * 自己做登录框 = 密码要经过我们的进程。那意味着：
 *   - 我们得对「密码有没有被记进日志、有没有被崩溃报告带走」负责
 *   - 换了 IdP、加了两步验证、加了微信登录，全都得跟着改客户端
 *
 * 走系统浏览器（RFC 8252）之后，**软件从头到尾看不见密码**。
 * 它只在最后拿到一个授权码，换成令牌。
 *
 * 原生应用是**公开客户端**：没有 client secret，也不该有 ——
 * 桌面程序里的任何「密钥」都能被人扒出来。所以用 PKCE 顶替：
 * 先扔一个只有自己知道的随机串的哈希过去，换令牌时再把原串亮出来。
 * 中间谁截到授权码都没用，因为他没有那个原串。
 * ─────────────────────────────────────────────────────────────
 *
 * 这个文件**刻意不做加密、不发请求** —— 随机数和 SHA-256 由调用方
 * （主进程用 node:crypto）给进来。这样它能在 node 环境里直接测，
 * 而 URL 拼错、参数漏了、回调校验没做，恰恰是这套流程最容易出的错。
 */

/** 一个 Logto/OIDC 服务的地址与客户端号 */
export interface OidcConfig {
  /** 形如 `https://auth.example.com/oidc`。发现文档在它下面 */
  issuer: string
  /** 原生应用的 App ID。**这不是密钥**，明文打进客户端是正常的 */
  clientId: string
  /**
   * API 资源标识符。要了它，拿到的令牌 `aud` 才是你那台小服务，
   * 服务端验签才有意义；不要的话拿到的令牌只对 IdP 自己有用。
   */
  resource?: string
}

/** 发现文档里我们用得上的那几项 */
export interface OidcEndpoints {
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint?: string
  end_session_endpoint?: string
  issuer?: string
}

export function discoveryUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`
}

export function parseEndpoints(body: unknown): OidcEndpoints {
  if (!body || typeof body !== 'object') throw new Error('发现文档不是一个对象')
  const o = body as Record<string, unknown>
  const need = (k: string): string => {
    const v = o[k]
    if (typeof v !== 'string' || !v) throw new Error(`发现文档里缺 ${k}`)
    return v
  }
  const out: OidcEndpoints = {
    authorization_endpoint: need('authorization_endpoint'),
    token_endpoint: need('token_endpoint'),
  }
  for (const k of ['userinfo_endpoint', 'end_session_endpoint', 'issuer'] as const) {
    const v = o[k]
    if (typeof v === 'string' && v) out[k] = v
  }
  return out
}

/**
 * 默认要的权限。
 *
 * - `openid profile` —— 拿到 sub 和昵称，界面上要显示
 * - `offline_access` —— **拿到刷新令牌**。不要它的话，令牌一过期就得
 *   再走一遍浏览器登录，一天弹好几次，谁都受不了
 */
export const DEFAULT_SCOPES = ['openid', 'profile', 'offline_access'] as const

/**
 * 少了也能登录的权限。
 *
 * `openid` 是命根子（`sub` 从它来），少了就没有身份可言。
 * 另外两个都只是「有更好」：`profile` 少了就是显示不出昵称，
 * `offline_access` 少了就是令牌过期要重登一次。
 *
 * IdP 说某一条不许要的时候，**把它去掉重来一次，别让整个登录死在这儿** ——
 * 为了一个昵称登不进去，这买卖不划算。
 */
export const DROPPABLE_SCOPES: readonly string[] = ['profile', 'offline_access']

/** IdP 拒了某个权限时，算算还能拿哪些去重试。返回 null = 没得退了 */
export function retryScopes(
  requested: readonly string[],
  rejected: string | undefined,
): string[] | null {
  const drop = (rejected ?? '')
    .split(/[\s,]+/)
    .filter((x) => x && DROPPABLE_SCOPES.includes(x))
  // IdP 没指名是哪个，就把所有可退的都退掉 —— 总比直接失败强
  const toDrop = drop.length > 0 ? drop : requested.filter((x) => DROPPABLE_SCOPES.includes(x))
  if (toDrop.length === 0) return null
  const next = requested.filter((x) => !toDrop.includes(x))
  if (next.length === requested.length || !next.includes('openid')) return null
  return next
}

export interface AuthorizeInput {
  endpoints: OidcEndpoints
  config: OidcConfig
  redirectUri: string
  /** PKCE 的 challenge（verifier 的 SHA-256，base64url） */
  codeChallenge: string
  /** 防 CSRF：回调里必须原样带回来 */
  state: string
  /** 防重放：id_token 里必须是这个 */
  nonce: string
  scopes?: readonly string[]
  /** 额外权限，比如 `stats:write` */
  extraScopes?: readonly string[]
}

export function authorizeUrl(i: AuthorizeInput): string {
  const scopes = [...(i.scopes ?? DEFAULT_SCOPES), ...(i.extraScopes ?? [])]
  const u = new URL(i.endpoints.authorization_endpoint)
  u.searchParams.set('client_id', i.config.clientId)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('redirect_uri', i.redirectUri)
  u.searchParams.set('scope', [...new Set(scopes)].join(' '))
  u.searchParams.set('state', i.state)
  u.searchParams.set('nonce', i.nonce)
  // 只支持 S256。plain 等于没有 PKCE，不给退路
  u.searchParams.set('code_challenge', i.codeChallenge)
  u.searchParams.set('code_challenge_method', 'S256')
  if (i.config.resource) u.searchParams.set('resource', i.config.resource)
  return u.toString()
}

/**
 * 校验浏览器跳回来的那个地址。
 *
 * **state 必须对上** —— 对不上说明这个回调不是我们发起的那一次，
 * 可能是别人诱导浏览器打开的。这一条是整套流程里最容易漏掉、
 * 漏掉之后又完全看不出问题的一条。
 */
export interface CallbackFailure {
  ok: false
  why: string
  /** IdP 给的机器可读错误码，比如 `invalid_scope` */
  error?: string
  /**
   * `invalid_scope` 时 IdP 会指名道姓说是哪个权限不行
   * （oidc-provider 把它放在 `scope` 参数里）。
   * 有了它才能「把这一个去掉重试」，而不是整个登录死在这儿。
   */
  scope?: string
}

export function parseCallback(
  rawUrl: string,
  expectedState: string,
): { ok: true; code: string } | CallbackFailure {
  let q: URLSearchParams
  try {
    q = new URL(rawUrl, 'http://127.0.0.1').searchParams
  } catch {
    return { ok: false, why: '回调地址读不懂' }
  }
  const err = q.get('error')
  if (err) {
    const desc = q.get('error_description')
    const out: CallbackFailure = { ok: false, why: desc ? `${err}：${desc}` : err, error: err }
    const bad = q.get('scope')
    if (bad) out.scope = bad
    return out
  }
  const state = q.get('state')
  if (!state || state !== expectedState) {
    return { ok: false, why: '回调的 state 对不上，这一次登录不算数' }
  }
  const code = q.get('code')
  if (!code) return { ok: false, why: '回调里没有授权码' }
  return { ok: true, code }
}

/** 拿授权码换令牌时 POST 的表单 */
export function tokenRequestBody(i: {
  config: OidcConfig
  redirectUri: string
  code: string
  codeVerifier: string
}): string {
  const p = new URLSearchParams()
  p.set('grant_type', 'authorization_code')
  p.set('client_id', i.config.clientId)
  p.set('redirect_uri', i.redirectUri)
  p.set('code', i.code)
  p.set('code_verifier', i.codeVerifier)
  if (i.config.resource) p.set('resource', i.config.resource)
  return p.toString()
}

/** 用刷新令牌换一份新的 */
export function refreshRequestBody(i: { config: OidcConfig; refreshToken: string }): string {
  const p = new URLSearchParams()
  p.set('grant_type', 'refresh_token')
  p.set('client_id', i.config.clientId)
  p.set('refresh_token', i.refreshToken)
  if (i.config.resource) p.set('resource', i.config.resource)
  return p.toString()
}

export interface TokenSet {
  accessToken: string
  /** 没给就是这次没换新的，接着用旧的 */
  refreshToken: string | null
  idToken: string | null
  /** 绝对时刻（毫秒）。没给 expires_in 时为 null */
  expiresAt: number | null
}

export function parseTokenResponse(body: unknown, now = Date.now()): TokenSet {
  if (!body || typeof body !== 'object') throw new Error('令牌响应不是一个对象')
  const o = body as Record<string, unknown>
  const access = o['access_token']
  if (typeof access !== 'string' || !access) throw new Error('令牌响应里没有 access_token')
  const expiresIn = typeof o['expires_in'] === 'number' ? o['expires_in'] : null
  return {
    accessToken: access,
    refreshToken: typeof o['refresh_token'] === 'string' ? o['refresh_token'] : null,
    idToken: typeof o['id_token'] === 'string' ? o['id_token'] : null,
    // 提前 60 秒当过期，免得卡在边界上发一个必然 401 的请求
    expiresAt: expiresIn === null ? null : now + Math.max(0, expiresIn - 60) * 1000,
  }
}

/** base64url → 普通字符串。JWT 的三段都是这个编码 */
export function decodeBase64Url(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  // atob 解出来是拉丁一字节序列，还得按 UTF-8 还原，不然中文昵称是乱码
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export interface IdTokenClaims {
  sub: string
  name?: string
  username?: string
  picture?: string
  nonce?: string
  iss?: string
  aud?: string | string[]
  exp?: number
}

/**
 * 读 id_token 里的信息。
 *
 * **这里不验签**，而且这是有意的：令牌是我们自己**直接**从令牌端点
 * 通过 TLS 取回来的，不是从浏览器地址栏捡来的 —— OIDC 规范允许这种
 * 情况下跳过签名校验（Core §3.1.3.7）。真正要验签的是那台读统计的
 * 小服务，它收到的令牌来路不明，必须拿 IdP 的 JWKS 验。
 *
 * 所以这个函数只用来**显示昵称**，绝不拿它做授权判断。
 */
export function readIdToken(jwt: string): IdTokenClaims {
  const parts = jwt.split('.')
  if (parts.length !== 3) throw new Error('id_token 不是三段式的')
  const payload = JSON.parse(decodeBase64Url(parts[1] ?? '')) as Record<string, unknown>
  const sub = payload['sub']
  if (typeof sub !== 'string' || !sub) throw new Error('id_token 里没有 sub')
  const out: IdTokenClaims = { sub }
  for (const k of ['name', 'username', 'picture', 'nonce', 'iss'] as const) {
    const v = payload[k]
    if (typeof v === 'string') out[k] = v
  }
  if (typeof payload['exp'] === 'number') out.exp = payload['exp']
  const aud = payload['aud']
  if (typeof aud === 'string' || Array.isArray(aud)) out.aud = aud as string | string[]
  return out
}

/**
 * id_token 的基本核对。
 *
 * 不验签不等于什么都不查：发行方对不对、是不是发给我们的、
 * nonce 是不是这一次的、过没过期，这几条不查就等于白拿一个令牌。
 */
export function checkIdToken(
  claims: IdTokenClaims,
  expect: { issuer: string; clientId: string; nonce: string },
  now = Date.now(),
): { ok: true } | { ok: false; why: string } {
  if (claims.iss && claims.iss.replace(/\/+$/, '') !== expect.issuer.replace(/\/+$/, '')) {
    return { ok: false, why: `id_token 的发行方不对：${claims.iss}` }
  }
  const auds = claims.aud === undefined ? [] : Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (auds.length > 0 && !auds.includes(expect.clientId)) {
    return { ok: false, why: 'id_token 不是发给这个客户端的' }
  }
  if (claims.nonce !== undefined && claims.nonce !== expect.nonce) {
    return { ok: false, why: 'id_token 的 nonce 对不上，这一次登录不算数' }
  }
  if (claims.exp !== undefined && claims.exp * 1000 <= now) {
    return { ok: false, why: 'id_token 已经过期了' }
  }
  return { ok: true }
}

/** 退出登录要跳的地址。IdP 那边也得把会话清掉，不然下次点登录会直接进去 */
export function endSessionUrl(i: {
  endpoints: OidcEndpoints
  config: OidcConfig
  idToken: string | null
  redirectUri: string
}): string | null {
  if (!i.endpoints.end_session_endpoint) return null
  const u = new URL(i.endpoints.end_session_endpoint)
  u.searchParams.set('client_id', i.config.clientId)
  u.searchParams.set('post_logout_redirect_uri', i.redirectUri)
  if (i.idToken) u.searchParams.set('id_token_hint', i.idToken)
  return u.toString()
}

/**
 * 回环回调地址。
 *
 * 端口写死几个备选：不确定 IdP 对 `127.0.0.1` 的匹配是不是忽略端口，
 * 写死就不用赌 —— 全都登记进白名单，客户端挨个试，占用了就换下一个。
 * 三个够了，同时开三个实例已经很极端。
 */
export const LOOPBACK_PORTS = [53682, 53683, 53684] as const

export function loopbackRedirect(port: number, path = '/callback'): string {
  return `http://127.0.0.1:${port}${path}`
}

/** 令牌还能用吗。没写过期时间就当能用，由服务器用 401 说了算 */
export function tokenExpired(expiresAt: number | null, now = Date.now()): boolean {
  return expiresAt !== null && expiresAt <= now
}
