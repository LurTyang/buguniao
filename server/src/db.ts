/**
 * 存这七个数。
 *
 * 用 node 自带的 SQLite（`node:sqlite`，Node 22 起内置）——
 * 一人一行、七个整数，为这点数据装一台 Postgres 是不划算的。
 * 而且「整个库就是一个文件」意味着备份 = 复制一个文件。
 *
 * 桌面端的索引也用的是 `node:sqlite`，两边一个路数。
 */

import { DatabaseSync } from 'node:sqlite'
import { toPublicJson, type PublicStats } from './stats.js'

export interface Row extends PublicStats {
  handle: string
  /** 最后一次推上来是什么时候（ISO） */
  updatedAt: string
}

export class Store {
  private readonly db: DatabaseSync

  constructor(file: string) {
    this.db = new DatabaseSync(file)
    // WAL：读写不互相挡。公开接口是只读的，不该被一次写入卡住
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.migrate()
  }

  private migrate(): void {
    // 表结构里**只有那七个数**加上 sub / handle / 时间。
    // 没有书名、章节名、正文的位置 —— 存不下的东西就漏不出去
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        sub          TEXT PRIMARY KEY,
        handle       TEXT UNIQUE,
        date         TEXT NOT NULL DEFAULT '',
        todayWords   INTEGER NOT NULL DEFAULT 0,
        weekWords    INTEGER NOT NULL DEFAULT 0,
        streak       INTEGER NOT NULL DEFAULT 0,
        bestStreak   INTEGER NOT NULL DEFAULT 0,
        dailyFloor   INTEGER NOT NULL DEFAULT 0,
        daysTogether INTEGER NOT NULL DEFAULT 0,
        updatedAt    TEXT NOT NULL DEFAULT ''
      )
    `)
    // 公开接口按 handle 查，而且 handle 是大小写统一存小写的
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_users_handle ON users(handle)')
  }

  close(): void {
    this.db.close()
  }

  /** 第一次见到这个人时建一行。已经有了就什么都不做 */
  ensure(sub: string): void {
    this.db
      .prepare('INSERT INTO users (sub) VALUES (?) ON CONFLICT(sub) DO NOTHING')
      .run(sub)
  }

  byHandle(handle: string): Row | null {
    const r = this.db
      .prepare('SELECT * FROM users WHERE handle = ?')
      .get(handle.toLowerCase()) as Record<string, unknown> | undefined
    return r ? toRow(r) : null
  }

  bySub(sub: string): Row | null {
    const r = this.db.prepare('SELECT * FROM users WHERE sub = ?').get(sub) as
      | Record<string, unknown>
      | undefined
    return r ? toRow(r) : null
  }

  /**
   * 认领短名。
   *
   * 被别人占了就明说 —— 含糊地失败会让人以为是自己名字写错了。
   * 自己改成自己现在这个也算成功（幂等，客户端重试不会莫名报错）。
   */
  claimHandle(sub: string, handle: string): { ok: true } | { ok: false; why: string } {
    const h = handle.toLowerCase()
    const owner = this.db.prepare('SELECT sub FROM users WHERE handle = ?').get(h) as
      | { sub: string }
      | undefined
    if (owner && owner.sub !== sub) return { ok: false, why: `「${h}」已经被人用了` }
    this.ensure(sub)
    this.db.prepare('UPDATE users SET handle = ? WHERE sub = ?').run(h, sub)
    return { ok: true }
  }

  /** 存那七个数。**显式列字段**，不接受调用方多塞的东西 */
  putStats(sub: string, s: PublicStats, now: string): void {
    const p = toPublicJson(s)
    this.ensure(sub)
    this.db
      .prepare(
        `UPDATE users SET
           date = ?, todayWords = ?, weekWords = ?, streak = ?,
           bestStreak = ?, dailyFloor = ?, daysTogether = ?, updatedAt = ?
         WHERE sub = ?`,
      )
      .run(
        p.date,
        p.todayWords,
        p.weekWords,
        p.streak,
        p.bestStreak,
        p.dailyFloor,
        p.daysTogether,
        now,
        sub,
      )
  }

  /** 退出/注销：把这个人的数据整个删掉。删得干净是本分 */
  forget(sub: string): void {
    this.db.prepare('DELETE FROM users WHERE sub = ?').run(sub)
  }
}

function toRow(r: Record<string, unknown>): Row {
  const n = (k: string): number => (typeof r[k] === 'number' ? (r[k] as number) : 0)
  const s = (k: string): string => (typeof r[k] === 'string' ? (r[k] as string) : '')
  return {
    handle: s('handle'),
    date: s('date'),
    todayWords: n('todayWords'),
    weekWords: n('weekWords'),
    streak: n('streak'),
    bestStreak: n('bestStreak'),
    dailyFloor: n('dailyFloor'),
    daysTogether: n('daysTogether'),
    updatedAt: s('updatedAt'),
  }
}
