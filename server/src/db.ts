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
import { toAwardJson, type Award } from './awards.js'

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

    /*
     * 奖状**单独一张表**，不塞进 users 里。
     *
     * 一是一个人可以有好几张；二是这两样东西的性质完全不同：
     * 那七个数是客户端自己推上来的，奖状是人手动发的。
     * 混在一张表里迟早会有人写一句 UPDATE 把两边一起动了。
     */
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS awards (
        sub  TEXT NOT NULL,
        id   TEXT NOT NULL,
        name TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        at   TEXT NOT NULL,
        PRIMARY KEY (sub, id)
      )
    `)
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

  /** 短名对应的是谁。发奖状时要按短名找人，而奖状表是按 sub 存的 */
  subOfHandle(handle: string): string | null {
    const r = this.db.prepare('SELECT sub FROM users WHERE handle = ?').get(handle.toLowerCase()) as
      | { sub: string }
      | undefined
    return r?.sub ?? null
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

  /**
   * 退出/注销：把这个人的数据整个删掉。删得干净是本分。
   *
   * **奖状也一起删。** 「删干净」就该是删干净 —— 留着奖状等于
   * 服务器上还认得这个人，那句承诺就打折了。
   */
  forget(sub: string): void {
    this.db.prepare('DELETE FROM users WHERE sub = ?').run(sub)
    this.db.prepare('DELETE FROM awards WHERE sub = ?').run(sub)
  }

  // ───────────────────────── 奖状 ─────────────────────────

  /** 某个人的奖状，先发的在前 */
  awardsOf(sub: string): Award[] {
    const rows = this.db
      .prepare('SELECT id, name, note, at FROM awards WHERE sub = ? ORDER BY at ASC, id ASC')
      .all(sub) as Array<Record<string, unknown>>
    return rows.map((r) =>
      toAwardJson({
        id: String(r['id'] ?? ''),
        name: String(r['name'] ?? ''),
        note: String(r['note'] ?? ''),
        at: String(r['at'] ?? ''),
      }),
    )
  }

  /**
   * 发一张奖状。同一个人同一个 id 就覆盖 —— 打错字了要能改回来。
   *
   * **不 ensure(sub)**：奖状可以先于那七个数存在（比赛发奖时对方
   * 可能还没推过数），但也不该因此在 users 里凭空建一行。
   */
  grant(sub: string, a: Omit<Award, 'at'>, now: string): void {
    this.db
      .prepare(
        `INSERT INTO awards (sub, id, name, note, at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(sub, id) DO UPDATE SET name = excluded.name, note = excluded.note`,
      )
      .run(sub, a.id, a.name, a.note, now)
  }

  /** 撤回一张。返回真的删掉了没有 —— 发错人时要能确认撤对了 */
  revoke(sub: string, id: string): boolean {
    const r = this.db.prepare('DELETE FROM awards WHERE sub = ? AND id = ?').run(sub, id)
    return Number(r.changes ?? 0) > 0
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
