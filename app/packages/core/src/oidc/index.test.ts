/**
 * OIDC 授权码 + PKCE。
 *
 * 这套流程的特点是：**错了也能跑通**。state 不校验、nonce 不校验、
 * code_challenge_method 写成 plain —— 每一条漏掉之后登录都照样成功，
 * 只是安全性没了。所以这里逐条钉死。
 */

import { describe, it, expect } from 'vitest'
import {
  authorizeUrl,
  checkIdToken,
  decodeBase64Url,
  discoveryUrl,
  endSessionUrl,
  loopbackRedirect,
  LOOPBACK_PORTS,
  parseCallback,
  parseEndpoints,
  parseTokenResponse,
  readIdToken,
  refreshRequestBody,
  retryScopes,
  tokenExpired,
  tokenRequestBody,
  type OidcConfig,
  type OidcEndpoints,
} from './index.js'

const ISSUER = 'https://auth.ferret.icu/oidc'

const config: OidcConfig = {
  issuer: ISSUER,
  clientId: 'raiemcmc08eg4mu4le2hc',
  resource: 'https://api.ferret.icu/bugu',
}

const endpoints: OidcEndpoints = {
  authorization_endpoint: `${ISSUER}/auth`,
  token_endpoint: `${ISSUER}/token`,
  end_session_endpoint: `${ISSUER}/session/end`,
  issuer: ISSUER,
}

const REDIRECT = loopbackRedirect(LOOPBACK_PORTS[0])

/** 造一个 id_token（只造结构，不签名 —— 客户端本来也不验签） */
function fakeIdToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  return `${b64({ alg: 'RS256' })}.${b64(payload)}.xxsignature`
}

describe('发现文档', () => {
  it('地址拼在 issuer 底下', () => {
    expect(discoveryUrl(ISSUER)).toBe(`${ISSUER}/.well-known/openid-configuration`)
  })

  it('issuer 末尾多个斜杠也不会拼出两条斜杠', () => {
    expect(discoveryUrl(`${ISSUER}/`)).toBe(`${ISSUER}/.well-known/openid-configuration`)
  })

  it('缺了必须的端点就明说缺哪个，不要含糊', () => {
    expect(() => parseEndpoints({ token_endpoint: 'x' })).toThrow(/authorization_endpoint/)
    expect(() => parseEndpoints({ authorization_endpoint: 'x' })).toThrow(/token_endpoint/)
  })

  it('可选端点有就带上，没有也不炸', () => {
    const e = parseEndpoints({ authorization_endpoint: 'a', token_endpoint: 't' })
    expect(e.end_session_endpoint).toBeUndefined()
  })
})

describe('授权地址', () => {
  const url = new URL(
    authorizeUrl({
      endpoints,
      config,
      redirectUri: REDIRECT,
      codeChallenge: 'CHALLENGE',
      state: 'STATE',
      nonce: 'NONCE',
      extraScopes: ['stats:write'],
    }),
  )
  const q = url.searchParams

  it('走授权码流程', () => {
    expect(q.get('response_type')).toBe('code')
    expect(q.get('client_id')).toBe(config.clientId)
    expect(q.get('redirect_uri')).toBe(REDIRECT)
  })

  it('【关键】PKCE 只用 S256', () => {
    // plain 等于没有 PKCE：授权码被截走的人可以直接拿它换令牌
    expect(q.get('code_challenge')).toBe('CHALLENGE')
    expect(q.get('code_challenge_method')).toBe('S256')
  })

  it('【关键】没有 client_secret', () => {
    // 桌面程序里的任何「密钥」都能被扒出来。原生应用就该是公开客户端
    expect(q.get('client_secret')).toBeNull()
    expect(url.toString()).not.toContain('secret')
  })

  it('state 和 nonce 都带上了', () => {
    expect(q.get('state')).toBe('STATE')
    expect(q.get('nonce')).toBe('NONCE')
  })

  it('要 offline_access，不然令牌一过期就得重新登录', () => {
    expect(q.get('scope')?.split(' ')).toContain('offline_access')
  })

  it('额外权限接在后面，且不重复', () => {
    const scopes = q.get('scope')!.split(' ')
    expect(scopes).toContain('stats:write')
    expect(new Set(scopes).size).toBe(scopes.length)
  })

  it('【关键】带上 resource，令牌才是发给我们那台小服务的', () => {
    // 不带的话拿到的令牌 aud 是 IdP 自己，服务端拿它验签没有意义
    expect(q.get('resource')).toBe(config.resource)
  })

  it('没配 resource 时就不带这个参数', () => {
    const u = new URL(
      authorizeUrl({
        endpoints,
        config: { issuer: ISSUER, clientId: 'c' },
        redirectUri: REDIRECT,
        codeChallenge: 'C',
        state: 'S',
        nonce: 'N',
      }),
    )
    expect(u.searchParams.get('resource')).toBeNull()
  })
})

describe('回调校验', () => {
  it('正常回来能取到授权码', () => {
    const r = parseCallback(`${REDIRECT}?code=ABC&state=STATE`, 'STATE')
    expect(r).toEqual({ ok: true, code: 'ABC' })
  })

  it('【关键】state 对不上就作废', () => {
    // 漏掉这一条登录照样成功，但别人诱导浏览器打开的回调也会被我们收下
    const r = parseCallback(`${REDIRECT}?code=ABC&state=别人的`, 'STATE')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.why).toContain('state')
  })

  it('【关键】回调里没有 state 也作废，不能当成「没带就算了」', () => {
    expect(parseCallback(`${REDIRECT}?code=ABC`, 'STATE').ok).toBe(false)
  })

  it('IdP 报错时把原话带出来，别只说「登录失败」', () => {
    const r = parseCallback(
      `${REDIRECT}?error=access_denied&error_description=用户取消了&state=STATE`,
      'STATE',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.why).toContain('access_denied')
      expect(r.why).toContain('用户取消了')
    }
  })

  it('报错时即使 state 对不上也要报出错误原因', () => {
    const r = parseCallback(`${REDIRECT}?error=server_error&state=乱的`, 'STATE')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.why).toContain('server_error')
  })

  it('state 对上但没有 code 也不算成功', () => {
    expect(parseCallback(`${REDIRECT}?state=STATE`, 'STATE').ok).toBe(false)
  })

  it('只给路径（http 服务器拿到的就是这个）也读得懂', () => {
    expect(parseCallback('/callback?code=ABC&state=STATE', 'STATE')).toEqual({
      ok: true,
      code: 'ABC',
    })
  })
})

describe('换令牌', () => {
  it('带上 code_verifier —— PKCE 的另一半', () => {
    const p = new URLSearchParams(
      tokenRequestBody({ config, redirectUri: REDIRECT, code: 'CODE', codeVerifier: 'VERIFIER' }),
    )
    expect(p.get('grant_type')).toBe('authorization_code')
    expect(p.get('code')).toBe('CODE')
    expect(p.get('code_verifier')).toBe('VERIFIER')
    expect(p.get('redirect_uri')).toBe(REDIRECT)
    expect(p.get('client_secret')).toBeNull()
  })

  it('刷新令牌也带 resource', () => {
    const p = new URLSearchParams(refreshRequestBody({ config, refreshToken: 'RT' }))
    expect(p.get('grant_type')).toBe('refresh_token')
    expect(p.get('refresh_token')).toBe('RT')
    expect(p.get('resource')).toBe(config.resource)
  })
})

describe('令牌响应', () => {
  const NOW = 1_700_000_000_000

  it('读出三个令牌', () => {
    const t = parseTokenResponse(
      { access_token: 'AT', refresh_token: 'RT', id_token: 'IT', expires_in: 3600 },
      NOW,
    )
    expect(t.accessToken).toBe('AT')
    expect(t.refreshToken).toBe('RT')
    expect(t.idToken).toBe('IT')
  })

  it('【关键】过期时刻提前 60 秒', () => {
    // 卡在边界上会发一个必然 401 的请求，然后当成「登录失效」把人踢出去
    const t = parseTokenResponse({ access_token: 'AT', expires_in: 3600 }, NOW)
    expect(t.expiresAt).toBe(NOW + 3540 * 1000)
  })

  it('expires_in 小于 60 也不会算出过去的时刻', () => {
    const t = parseTokenResponse({ access_token: 'AT', expires_in: 10 }, NOW)
    expect(t.expiresAt).toBe(NOW)
  })

  it('没给 refresh_token 就是这次没换新的', () => {
    expect(parseTokenResponse({ access_token: 'AT' }, NOW).refreshToken).toBeNull()
  })

  it('没有 access_token 就是坏响应，明说', () => {
    expect(() => parseTokenResponse({ id_token: 'IT' })).toThrow(/access_token/)
    expect(() => parseTokenResponse('不是对象')).toThrow()
  })

  it('没写过期时间时不当成过期', () => {
    expect(tokenExpired(null, NOW)).toBe(false)
    expect(tokenExpired(NOW + 1, NOW)).toBe(false)
    expect(tokenExpired(NOW, NOW)).toBe(true)
  })
})

describe('id_token', () => {
  const NOW = 1_700_000_000_000
  const exp = Math.floor(NOW / 1000) + 3600

  it('读得出 sub 和昵称', () => {
    const c = readIdToken(fakeIdToken({ sub: 'u1', name: '明听', iss: ISSUER, aud: config.clientId }))
    expect(c.sub).toBe('u1')
    expect(c.name).toBe('明听')
  })

  it('【关键】中文昵称不能乱码', () => {
    // base64url 解出来是拉丁一字节序列，不按 UTF-8 还原就是一串问号
    const c = readIdToken(fakeIdToken({ sub: 'u1', name: '鸽子一则' }))
    expect(c.name).toBe('鸽子一则')
  })

  it('不是三段式的直接报错', () => {
    expect(() => readIdToken('abc')).toThrow()
  })

  it('没有 sub 的不算数', () => {
    expect(() => readIdToken(fakeIdToken({ name: '甲' }))).toThrow(/sub/)
  })

  const expect_ = { issuer: ISSUER, clientId: config.clientId, nonce: 'NONCE' }

  it('该过的要过', () => {
    const c = readIdToken(
      fakeIdToken({ sub: 'u1', iss: ISSUER, aud: config.clientId, nonce: 'NONCE', exp }),
    )
    expect(checkIdToken(c, expect_, NOW)).toEqual({ ok: true })
  })

  it('【关键】发行方不对要拦下来', () => {
    const c = readIdToken(fakeIdToken({ sub: 'u1', iss: 'https://evil.example/oidc', nonce: 'NONCE' }))
    expect(checkIdToken(c, expect_, NOW).ok).toBe(false)
  })

  it('【关键】nonce 对不上要拦下来', () => {
    const c = readIdToken(fakeIdToken({ sub: 'u1', iss: ISSUER, nonce: '别的' }))
    expect(checkIdToken(c, expect_, NOW).ok).toBe(false)
  })

  it('【关键】不是发给我们的要拦下来', () => {
    const c = readIdToken(fakeIdToken({ sub: 'u1', iss: ISSUER, aud: '别的客户端', nonce: 'NONCE' }))
    expect(checkIdToken(c, expect_, NOW).ok).toBe(false)
  })

  it('过期的要拦下来', () => {
    const c = readIdToken(
      fakeIdToken({ sub: 'u1', iss: ISSUER, nonce: 'NONCE', exp: Math.floor(NOW / 1000) - 1 }),
    )
    expect(checkIdToken(c, expect_, NOW).ok).toBe(false)
  })

  it('aud 是数组时只要包含我们就行', () => {
    const c = readIdToken(
      fakeIdToken({ sub: 'u1', iss: ISSUER, aud: ['别的', config.clientId], nonce: 'NONCE', exp }),
    )
    expect(checkIdToken(c, expect_, NOW)).toEqual({ ok: true })
  })

  it('issuer 末尾斜杠不算差别', () => {
    const c = readIdToken(fakeIdToken({ sub: 'u1', iss: `${ISSUER}/`, nonce: 'NONCE', exp }))
    expect(checkIdToken(c, expect_, NOW)).toEqual({ ok: true })
  })
})

describe('退出登录', () => {
  it('带上 id_token_hint 和跳回地址', () => {
    const u = new URL(
      endSessionUrl({ endpoints, config, idToken: 'IT', redirectUri: 'http://127.0.0.1:53682/signout' })!,
    )
    expect(u.searchParams.get('id_token_hint')).toBe('IT')
    expect(u.searchParams.get('post_logout_redirect_uri')).toBe('http://127.0.0.1:53682/signout')
  })

  it('IdP 没给这个端点就返回 null，本地清掉就算了', () => {
    expect(
      endSessionUrl({
        endpoints: { authorization_endpoint: 'a', token_endpoint: 't' },
        config,
        idToken: null,
        redirectUri: 'x',
      }),
    ).toBeNull()
  })
})

describe('回环地址', () => {
  it('三个备选端口', () => {
    expect(LOOPBACK_PORTS).toHaveLength(3)
  })

  it('【关键】用 127.0.0.1 而不是 localhost', () => {
    // localhost 可能被解析到 ::1，也可能被 hosts 文件改掉；
    // 而登记进 IdP 白名单的是写死的那一串，对不上就登录不了
    for (const p of LOOPBACK_PORTS) {
      expect(loopbackRedirect(p)).toBe(`http://127.0.0.1:${p}/callback`)
    }
  })

  it('路径可以换，退出登录用的是另一条', () => {
    expect(loopbackRedirect(53682, '/signout')).toBe('http://127.0.0.1:53682/signout')
  })
})

describe('base64url', () => {
  it('补齐位数、换掉 -_ 两个字符', () => {
    expect(decodeBase64Url('YQ')).toBe('a')
    expect(decodeBase64Url('YWI')).toBe('ab')
    expect(decodeBase64Url('YWJj')).toBe('abc')
  })
})

describe('被拒之后还能退一步', () => {
  it('IdP 指名 profile 不行，就去掉它重试', () => {
    expect(retryScopes(['openid', 'profile', 'offline_access'], 'profile')).toEqual([
      'openid',
      'offline_access',
    ])
  })

  it('指名 offline_access 也退得掉', () => {
    expect(retryScopes(['openid', 'profile', 'offline_access'], 'offline_access')).toEqual([
      'openid',
      'profile',
    ])
  })

  it('没指名是哪个，就把所有可退的都退掉', () => {
    expect(retryScopes(['openid', 'profile', 'offline_access'], undefined)).toEqual(['openid'])
  })

  it('【关键】openid 永远不退 —— 退了就没有身份可言', () => {
    expect(retryScopes(['openid'], 'openid')).toBeNull()
    expect(retryScopes(['openid'], undefined)).toBeNull()
  })

  it('退无可退时返回 null，别死循环重试', () => {
    expect(retryScopes(['openid'], 'profile')).toBeNull()
  })

  it('IdP 一次报好几个也认', () => {
    expect(retryScopes(['openid', 'profile', 'offline_access'], 'profile offline_access')).toEqual([
      'openid',
    ])
  })

  it('回调里带 error 时，把它指名的那个权限也读出来', () => {
    const r = parseCallback(
      '/callback?error=invalid_scope&error_description=requested+scope+is+not+allowed&scope=profile&state=S',
      'S',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('invalid_scope')
      expect(r.scope).toBe('profile')
    }
  })
})
