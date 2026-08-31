/**
 * 认令牌：这个请求到底是谁发的。
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么要认两种令牌】
 *
 * Logto 发什么样的访问令牌，取决于客户端要没要 API 资源：
 *
 * - **要了 `resource=`** → 发 JWT，`aud` 是那个资源。本地拿 JWKS 验签
 *   就行，不用联网问 Logto，快而且不受它抖动影响。
 * - **没要** → 发**不透明令牌**（一串随机字符）。这种没法本地验，
 *   只能拿去问 Logto 的 userinfo：认就是认，不认就是不认。
 *
 * 不咕鸟现在还没建 API 资源（建了但服务没跑起来，会把登录整个搞挂 ——
 * 已经踩过一次），所以**现在拿到的是不透明令牌**。
 *
 * 两种都支持，服务就能今天先跑起来；等 API 资源建好、客户端开始要
 * `resource`，同一份代码自动走更快的那条路，不用改。
 * ─────────────────────────────────────────────────────────────
 *
 * 【不许走的捷径】
 *
 * 绝不能「解开 JWT 看看 sub 就算了」。不验签的 JWT 是**任何人都能伪造**
 * 的——把 payload 改成别人的 sub，就能以别人的身份改他的数据。
 * 这一条看不出区别（功能完全正常），所以格外容易被当成优化写掉。
 */

import { createHash } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'

export interface AuthConfig {
  /** 形如 `https://auth.ferret.icu/oidc` */
  issuer: string
  /** 建了 API 资源之后填，JWT 的 `aud` 要是它。没建就留空 */
  audience: string
  /** 换掉网络实现，测试用 */
  fetchImpl?: typeof globalThis.fetch
}

export type AuthResult = { ok: true; sub: string } | { ok: false; status: number; why: string }

/** 长得像 JWT 吗（三段、点分隔）。不透明令牌里没有点 */
function looksLikeJwt(token: string): boolean {
  return token.split('.').length === 3
}

/** 从 `Authorization: Bearer xxx` 里取出令牌 */
export function bearerOf(header: string | undefined): string | null {
  if (!header) return null
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  return m ? (m[1] ?? '').trim() || null : null
}

/**
 * 不透明令牌的认证结果缓存。
 *
 * 键是令牌的 SHA-256，**不是令牌本身** —— 内存里不留原始凭据，
 * 万一进程内存被 dump 出去，捡到的也只是哈希。
 */
const introspectCache = new Map<string, { sub: string; until: number }>()
const INTROSPECT_TTL_MS = 60_000

export function clearAuthCache(): void {
  introspectCache.clear()
}

export class Auth {
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null

  constructor(private readonly cfg: AuthConfig) {}

  private get fetch(): typeof globalThis.fetch {
    return this.cfg.fetchImpl ?? globalThis.fetch
  }

  private getJwks(): ReturnType<typeof createRemoteJWKSet> {
    // jose 自己会缓存并按 kid 轮换，不用我们操心
    this.jwks ??= createRemoteJWKSet(new URL(`${this.cfg.issuer}/jwks`))
    return this.jwks
  }

  async verify(token: string): Promise<AuthResult> {
    if (!token) return { ok: false, status: 401, why: '没带令牌' }
    return looksLikeJwt(token) ? this.verifyJwt(token) : this.introspect(token)
  }

  /** 本地验签。要 API 资源建好、客户端带了 `resource=` 才会走到这条路 */
  private async verifyJwt(token: string): Promise<AuthResult> {
    try {
      const { payload } = await jwtVerify(token, this.getJwks(), {
        issuer: this.cfg.issuer,
        // 配了 audience 才校验 —— 没配就说明还没建 API 资源，
        // 那种情况下拿到 JWT 本身就不正常，但也不该在这儿硬拦
        ...(this.cfg.audience ? { audience: this.cfg.audience } : {}),
      })
      const sub = payload.sub
      if (typeof sub !== 'string' || !sub) return { ok: false, status: 401, why: '令牌里没有 sub' }
      return { ok: true, sub }
    } catch (e) {
      return { ok: false, status: 401, why: `令牌验不过：${e instanceof Error ? e.message : e}` }
    }
  }

  /** 不透明令牌：拿去问 Logto。它说是谁就是谁 */
  private async introspect(token: string): Promise<AuthResult> {
    const key = createHash('sha256').update(token).digest('hex')
    const hit = introspectCache.get(key)
    if (hit && hit.until > Date.now()) return { ok: true, sub: hit.sub }

    let res: Response
    try {
      res = await this.fetch(`${this.cfg.issuer}/me`, {
        headers: { authorization: `Bearer ${token}` },
      })
    } catch (e) {
      // Logto 连不上是**我们的**问题，不是调用方的 —— 别回 401
      // 让客户端以为自己登录失效了，然后把人踢出去重登
      return { ok: false, status: 503, why: `连不上登录服务：${e instanceof Error ? e.message : e}` }
    }

    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: 401, why: '令牌无效或已过期' }
    }
    if (!res.ok) return { ok: false, status: 503, why: `登录服务返回 ${res.status}` }

    const body = (await res.json()) as Record<string, unknown>
    const sub = body['sub']
    if (typeof sub !== 'string' || !sub) return { ok: false, status: 401, why: '登录服务没给 sub' }

    introspectCache.set(key, { sub, until: Date.now() + INTROSPECT_TTL_MS })
    // 缓存不清会一直涨。到量了就整个倒掉 —— 重新问一次而已，不值得做 LRU
    if (introspectCache.size > 5000) introspectCache.clear()
    return { ok: true, sub }
  }
}
