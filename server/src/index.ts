/** 进程入口 */

import fs from 'node:fs'
import path from 'node:path'
import { Auth } from './auth.js'
import { loadConfig } from './config.js'
import { Store } from './db.js'
import { createServer } from './server.js'
import { parseAdminSubs } from './awards.js'

const cfg = loadConfig()
fs.mkdirSync(path.dirname(cfg.dbFile), { recursive: true })

const store = new Store(cfg.dbFile)
const auth = new Auth({ issuer: cfg.issuer, audience: cfg.audience })
const admins = parseAdminSubs(cfg.adminSubs)
const server = createServer({ store, auth, admins })

server.listen(cfg.port, cfg.host, () => {
  console.log(`[bugu-stats] 听在 ${cfg.host}:${cfg.port}`)
  console.log(`[bugu-stats] 登录服务 ${cfg.issuer}`)
  console.log(`[bugu-stats] 数据库 ${cfg.dbFile}`)
  console.log(`[bugu-stats] API 资源 ${cfg.audience || '(没配，走 userinfo 认令牌)'}`)
})

/** systemd 重启时给在途请求一点时间收尾，别把正在写的那一下切断 */
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    console.log(`[bugu-stats] 收到 ${sig}，收摊`)
    server.close(() => {
      store.close()
      process.exit(0)
    })
    setTimeout(() => process.exit(0), 5000).unref()
  })
}
