/** 启动参数。全部从环境变量来，没有配置文件 —— systemd 里一目了然 */

export interface Config {
  port: number
  host: string
  dbFile: string
  issuer: string
  /** 建了 API 资源之后填。没建就留空，那时候拿到的是不透明令牌 */
  audience: string
  /**
   * 谁能发奖状。写的是已有账号的 Logto `sub`，逗号或空白分隔。
   *
   * **这不是一种账号，是一张名单。** 没有管理员这个身份概念，
   * 也没有第二种凭据 —— 发奖的人拿自己的号登录，服务器认 sub。
   * 留空 = 谁都不能发（默认就该是这样）。
   */
  adminSubs: string
}

function need(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback
  if (v === undefined || v === '') throw new Error(`缺环境变量 ${name}`)
  return v
}

export function loadConfig(): Config {
  return {
    port: Number(process.env['PORT'] ?? 8787),
    // 只听回环：外面由 nginx 反代进来。
    // 直接听 0.0.0.0 等于把没有 TLS 的接口暴露在公网上
    host: process.env['HOST'] ?? '127.0.0.1',
    dbFile: need('BUGU_DB', '/var/lib/bugu-stats/stats.db'),
    issuer: need('BUGU_ISSUER', 'https://auth.ferret.icu/oidc').replace(/\/+$/, ''),
    audience: process.env['BUGU_AUDIENCE'] ?? '',
    adminSubs: process.env['BUGU_ADMIN_SUBS'] ?? '',
  }
}
