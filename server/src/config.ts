/** 启动参数。全部从环境变量来，没有配置文件 —— systemd 里一目了然 */

export interface Config {
  port: number
  host: string
  dbFile: string
  issuer: string
  /** 建了 API 资源之后填。没建就留空，那时候拿到的是不透明令牌 */
  audience: string
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
  }
}
