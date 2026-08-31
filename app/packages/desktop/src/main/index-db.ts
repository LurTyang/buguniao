/**
 * 索引库 —— 全文检索与关联关系。
 *
 * 规范：更新文档/02-技术架构.md §2 §4
 *
 * ─────────────────────────────────────────────────────────────
 * 【三条铁律，别破坏】
 *
 * 1. 索引是**派生物**。它里面没有任何独有的数据，删掉重扫就能完全复原。
 * 2. 索引库**不放在同步文件夹里**。它在 %APPDATA%/bugu/index.db。
 *    二进制大文件一旦进网盘同步，两端同时写就会产生无法合并的冲突副本，
 *    而且冲突后普通用户修不了。
 * 3. 索引坏了不许影响写作。任何索引操作失败都只记日志，不打断保存。
 * ─────────────────────────────────────────────────────────────
 *
 * 用 Node 内置的 node:sqlite，不引入 better-sqlite3 之类的原生模块 ——
 * 那些在 Electron 上要按 ABI 重编译，是常见的翻车点。
 * Electron 43 内置 Node 24 自带 node:sqlite，且 FTS5 的 trigram 分词器可用
 * （已实测中文子串检索）。
 */

import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  countWords,
  flattenChapters,
  parseDoc,
  parseStickyCard,
  renderCardFace,
  type BookTree,
  type DocType,
} from '@bugu/core'

/** 索引结构版本。改了 schema 就加一，启动时不匹配会自动重建 */
const SCHEMA_VERSION = 1

/**
 * FTS5 的 trigram 分词器把文本切成连续三字片段，
 * 因此查询串少于 3 个字符时用不了，得降级成 LIKE 扫描。
 */
export const MIN_FTS_QUERY = 3

export type SearchScope = DocType

export interface SearchHit {
  docId: string
  book: string
  path: string
  type: DocType
  title: string
  /** 带高亮标记的上下文片段 */
  snippet: string
  /** 相关度，越小越相关（FTS5 的 rank） */
  rank: number
}

export interface SearchResult {
  hits: SearchHit[]
  /** 命中总数（不受 limit 影响）。界面要如实显示，不能让作者以为只有 limit 条 */
  total: number
  /** 结果被 limit 截断了 */
  truncated: boolean
}

export interface IndexStats {
  docs: number
  books: number
  /** 索引文件字节数 */
  bytes: number
  builtAt: number
}

export class IndexDb {
  private db: DatabaseSync

  constructor(private readonly file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.init()
  }

  private init(): void {
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = NORMAL')

    const version = this.userVersion()
    if (version !== 0 && version !== SCHEMA_VERSION) {
      // 结构变了。索引是派生物，直接推倒重来比写迁移脚本可靠得多。
      this.dropAll()
    }
    this.createTables()
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  }

  private userVersion(): number {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
    return row?.user_version ?? 0
  }

  private dropAll(): void {
    for (const t of ['doc_fts', 'links', 'docs', 'meta']) {
      this.db.exec(`DROP TABLE IF EXISTS ${t}`)
    }
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS docs (
        id     TEXT PRIMARY KEY,
        book   TEXT NOT NULL,
        path   TEXT NOT NULL UNIQUE,
        type   TEXT NOT NULL,
        title  TEXT NOT NULL,
        chars  INTEGER NOT NULL DEFAULT 0,
        mtime  INTEGER NOT NULL DEFAULT 0
      )`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_docs_book ON docs(book)`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_docs_type ON docs(type)`)

    // trigram 分词器对中文有效，且是 SQLite 内置的，不用编译第三方扩展。
    // 代价是索引体积约为原文的 3~4 倍 —— 百万字小说约十几 MB，可以接受。
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS doc_fts USING fts5(
        title,
        body,
        doc_id UNINDEXED,
        tokenize = 'trigram'
      )`)

    // [[双向链接]] 的关系表，供反向链接与「未匹配的链接」使用
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS links (
        from_doc TEXT NOT NULL,
        target   TEXT NOT NULL,
        alias    TEXT
      )`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_links_target ON links(target)`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_links_from ON links(from_doc)`)

    this.db.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`)
  }

  // ───────────────────────── 写入 ─────────────────────────

  /** 索引单篇文档。同一路径重复调用是幂等的 */
  upsertDoc(input: {
    book: string
    path: string
    raw: string
    mtime: number
    fileName: string
    category?: string | null
  }): string {
    const doc = parseDoc(input.raw, { fileName: input.fileName })
    const id = doc.meta.id

    // 设定集文档索引「便利贴正面」而不是原始正文 —— 搜「断眉」时
    // 作者想找的是那张卡，而卡片正面就是最能代表它的内容。
    const searchBody =
      doc.meta.type === 'setting'
        ? [
            doc.body,
            renderCardFace(
              parseStickyCard(doc.body, {
                docId: id,
                fileName: input.fileName,
                category: input.category ?? null,
              }).floats,
            ),
          ].join('\n')
        : doc.body

    this.removeByPath(input.path)
    this.db
      .prepare(`INSERT OR REPLACE INTO docs (id, book, path, type, title, chars, mtime)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(
        id,
        input.book,
        input.path,
        doc.meta.type,
        doc.meta.title,
        countWords(doc.body).withPunctuation,
        input.mtime,
      )
    this.db
      .prepare(`INSERT INTO doc_fts (title, body, doc_id) VALUES (?, ?, ?)`)
      .run(doc.meta.title, searchBody, id)

    this.db.prepare(`DELETE FROM links WHERE from_doc = ?`).run(id)
    for (const link of extractLinks(doc.body)) {
      this.db
        .prepare(`INSERT INTO links (from_doc, target, alias) VALUES (?, ?, ?)`)
        .run(id, link.target, link.alias)
    }

    return id
  }

  removeByPath(docPath: string): void {
    const row = this.db.prepare(`SELECT id FROM docs WHERE path = ?`).get(docPath) as
      | { id: string }
      | undefined
    if (!row) return
    this.db.prepare(`DELETE FROM doc_fts WHERE doc_id = ?`).run(row.id)
    this.db.prepare(`DELETE FROM links WHERE from_doc = ?`).run(row.id)
    this.db.prepare(`DELETE FROM docs WHERE id = ?`).run(row.id)
  }

  /** 清掉某本书的全部索引（重建前用） */
  clearBook(book: string): void {
    const rows = this.db.prepare(`SELECT id FROM docs WHERE book = ?`).all(book) as Array<{ id: string }>
    for (const r of rows) {
      this.db.prepare(`DELETE FROM doc_fts WHERE doc_id = ?`).run(r.id)
      this.db.prepare(`DELETE FROM links WHERE from_doc = ?`).run(r.id)
    }
    this.db.prepare(`DELETE FROM docs WHERE book = ?`).run(book)
  }

  // ───────────────────────── 检索 ─────────────────────────

  /**
   * 全文检索。
   *
   * 查询串不足 3 字符时 FTS5 的 trigram 用不了，降级为 LIKE 扫描 ——
   * 单本书的数据量下仍是毫秒级，不值得为此加第二套索引。
   */
  search(
    query: string,
    opts: { book?: string; scopes?: SearchScope[]; limit?: number } = {},
  ): SearchResult {
    const q = query.trim()
    if (!q) return { hits: [], total: 0, truncated: false }
    const limit = opts.limit ?? 100

    const where: string[] = []
    // node:sqlite 的绑定参数类型不接受 unknown，显式收窄
    const params: Array<string | number> = []
    if (opts.book) {
      where.push('d.book = ?')
      params.push(opts.book)
    }
    if (opts.scopes && opts.scopes.length > 0) {
      where.push(`d.type IN (${opts.scopes.map(() => '?').join(',')})`)
      params.push(...opts.scopes)
    }
    const filter = where.length > 0 ? ` AND ${where.join(' AND ')}` : ''

    if ([...q].length >= MIN_FTS_QUERY) {
      // 整串当短语查，双引号内的引号翻倍转义。
      // 不这么做的话，作者搜「他说："走"」会撞上 FTS5 的查询语法直接报错。
      const phrase = `"${q.replace(/"/g, '""')}"`
      const rows = this.db
        .prepare(
          `SELECT d.id, d.book, d.path, d.type, d.title,
                  snippet(doc_fts, 1, char(1), char(2), '…', 24) AS snip,
                  bm25(doc_fts) AS rank
             FROM doc_fts f JOIN docs d ON d.id = f.doc_id
            WHERE doc_fts MATCH ?${filter}
            ORDER BY rank
            LIMIT ?`,
        )
        .all(phrase, ...params, limit) as Array<Record<string, unknown>>

      const total = (
        this.db
          .prepare(
            `SELECT COUNT(*) AS n
               FROM doc_fts f JOIN docs d ON d.id = f.doc_id
              WHERE doc_fts MATCH ?${filter}`,
          )
          .get(phrase, ...params) as { n: number }
      ).n

      return { hits: rows.map(toHit), total, truncated: total > rows.length }
    }

    // 一到两个字：LIKE 扫描
    const like = toLikePattern(q)
    const rows = this.db
      .prepare(
        `SELECT d.id, d.book, d.path, d.type, d.title, f.body AS snip, 0 AS rank
           FROM doc_fts f JOIN docs d ON d.id = f.doc_id
          WHERE (f.body LIKE ? ESCAPE '#' OR d.title LIKE ? ESCAPE '#')${filter}
          LIMIT ?`,
      )
      .all(like, like, ...params, limit) as Array<Record<string, unknown>>

    const total = (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n
             FROM doc_fts f JOIN docs d ON d.id = f.doc_id
            WHERE (f.body LIKE ? ESCAPE '#' OR d.title LIKE ? ESCAPE '#')${filter}`,
        )
        .get(like, like, ...params) as { n: number }
    ).n

    return {
      hits: rows.map((r) => toHit({ ...r, snip: makeSnippet(String(r['snip'] ?? ''), q) })),
      total,
      truncated: total > rows.length,
    }
  }

  /** 某个名字被哪些文档引用（反向链接） */
  backlinks(target: string, book?: string): Array<{ docId: string; path: string; title: string }> {
    const rows = this.db
      .prepare(
        `SELECT d.id, d.path, d.title
           FROM links l JOIN docs d ON d.id = l.from_doc
          WHERE l.target = ?${book ? ' AND d.book = ?' : ''}`,
      )
      .all(...(book ? [target, book] : [target])) as Array<Record<string, unknown>>
    return rows.map((r) => ({
      docId: String(r['id']),
      path: String(r['path']),
      title: String(r['title']),
    }))
  }

  /**
   * 这篇文档里写了哪些 `[[双链]]`，各自指到哪儿。
   *
   * 指不到任何文档的链接也要返回（`path` 为 null）——
   * 那通常是名字写错了，或者那张便利贴还没建，作者应该看得见。
   */
  outgoingLinks(docPath: string, book?: string): Array<{ target: string; path: string | null; title: string | null }> {
    const rows = this.db
      .prepare(
        `SELECT l.target AS target, t.path AS path, t.title AS title
           FROM links l
           JOIN docs d ON d.id = l.from_doc
           LEFT JOIN docs t ON t.title = l.target${book ? ' AND t.book = d.book' : ''}
          WHERE d.path = ?
          GROUP BY l.target`,
      )
      .all(docPath) as Array<Record<string, unknown>>
    return rows.map((r) => ({
      target: String(r['target']),
      path: r['path'] == null ? null : String(r['path']),
      title: r['title'] == null ? null : String(r['title']),
    }))
  }

  /** 快速跳转用：按标题模糊匹配 */
  findByTitle(fragment: string, opts: { book?: string; limit?: number } = {}): SearchHit[] {
    // 快速跳转只用于挑一个目标，不需要总数
    const like = toLikePattern(fragment)
    const rows = this.db
      .prepare(
        `SELECT id, book, path, type, title, '' AS snip, 0 AS rank
           FROM docs
          WHERE title LIKE ? ESCAPE '#'${opts.book ? ' AND book = ?' : ''}
          ORDER BY length(title)
          LIMIT ?`,
      )
      .all(...(opts.book ? [like, opts.book, opts.limit ?? 30] : [like, opts.limit ?? 30])) as Array<
      Record<string, unknown>
    >
    return rows.map(toHit)
  }

  /** 某本书里的 路径 → 文档 id。伏笔清单要用 id 排章节顺序 */
  /**
   * 每篇文档的正文字数。里程碑算「这一卷写完没有」要用。
   *
   * 从索引里取而不是把文件全读一遍 —— 一卷几十上百章，
   * 每开一次面板就全读一遍太重了。索引本来就存着正文。
   */
  charsByPath(book: string): Map<string, number> {
    const rows = this.db
      .prepare(
        `SELECT d.path AS path, LENGTH(f.body) AS n
           FROM docs d JOIN doc_fts f ON f.doc_id = d.id
          WHERE d.book = ?`,
      )
      .all(book) as Array<Record<string, unknown>>
    return new Map(rows.map((r) => [String(r['path']), Number(r['n'] ?? 0)]))
  }

  idsByPath(book: string): Map<string, string> {
    const rows = this.db.prepare(`SELECT path, id FROM docs WHERE book = ?`).all(book) as Array<{
      path: string
      id: string
    }>
    return new Map(rows.map((r) => [r.path, r.id]))
  }

  /** 某本书里已索引的路径 → mtime。增量同步靠它判断哪些文件变过 */
  docPaths(book: string): Map<string, number> {
    const rows = this.db.prepare(`SELECT path, mtime FROM docs WHERE book = ?`).all(book) as Array<{
      path: string
      mtime: number
    }>
    return new Map(rows.map((r) => [r.path, r.mtime]))
  }

  stats(book?: string): IndexStats {
    const docs = this.db
      .prepare(`SELECT COUNT(*) AS n FROM docs${book ? ' WHERE book = ?' : ''}`)
      .get(...(book ? [book] : [])) as { n: number }
    const books = this.db.prepare(`SELECT COUNT(DISTINCT book) AS n FROM docs`).get() as { n: number }
    let bytes = 0
    try {
      bytes = fs.statSync(this.file).size
    } catch {
      bytes = 0
    }
    return { docs: docs.n, books: books.n, bytes, builtAt: Number(this.getMeta('builtAt') ?? 0) }
  }

  getMeta(k: string): string | null {
    const row = this.db.prepare(`SELECT v FROM meta WHERE k = ?`).get(k) as { v: string } | undefined
    return row?.v ?? null
  }

  setMeta(k: string, v: string): void {
    this.db.prepare(`INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)`).run(k, v)
  }

  transaction(fn: () => void): void {
    this.db.exec('BEGIN')
    try {
      fn()
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  close(): void {
    this.db.close()
  }
}

// ───────────────────────── 工具 ─────────────────────────

/**
 * 把查询串变成 LIKE 模式，转义 SQL 的通配符。
 *
 * 转义符刻意用 `#` 而不是常见的反斜杠 —— 反斜杠在 JS 模板字符串里要写成两个，
 * 在 `ESCAPE '..'` 这种位置极容易少写一个；少写一个的后果是它变成转义引号，
 * 传给 SQLite 的是空串，直接报「ESCAPE expression must be a single character」。
 * 换个字符就没有这个坑了 —— 这个坑已经踩过一次。
 */
export const LIKE_ESCAPE_CHAR = '#'

export function toLikePattern(raw: string): string {
  return `%${raw.trim().replace(/[%_#]/g, (m) => LIKE_ESCAPE_CHAR + m)}%`
}

/**
 * 高亮标记。
 *
 * 用两个控制字符而不是 `<mark>` 之类的标签 —— 片段里可能有作者写的任何字符，
 * 用标签的话正文里真出现 `<mark>` 就会串味。控制字符在正文里不可能出现。
 * 界面拿到片段后按这两个字符切开渲染。
 */
export const HIGHLIGHT_START = String.fromCharCode(1)
export const HIGHLIGHT_END = String.fromCharCode(2)

function toHit(r: Record<string, unknown>): SearchHit {
  return {
    docId: String(r['id']),
    book: String(r['book']),
    path: String(r['path']),
    type: String(r['type']) as DocType,
    title: String(r['title']),
    snippet: String(r['snip'] ?? ''),
    rank: Number(r['rank'] ?? 0),
  }
}

/** LIKE 降级路径下自己造上下文片段，格式与 FTS5 的 snippet() 保持一致 */
function makeSnippet(body: string, q: string, radius = 24): string {
  const i = body.indexOf(q)
  if (i === -1) return body.slice(0, radius * 2)
  const from = Math.max(0, i - radius)
  const to = Math.min(body.length, i + q.length + radius)
  return (
    (from > 0 ? '…' : '') +
    body.slice(from, i) +
    HIGHLIGHT_START +
    body.slice(i, i + q.length) +
    HIGHLIGHT_END +
    body.slice(i + q.length, to) +
    (to < body.length ? '…' : '')
  )
}

export interface DocLink {
  target: string
  alias: string | null
}

/** 抽出正文里的 `[[链接]]` 与 `[[链接|别名]]` */
export function extractLinks(body: string): DocLink[] {
  const out: DocLink[] = []
  for (const m of body.matchAll(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g)) {
    const target = (m[1] as string).trim()
    if (target) out.push({ target, alias: m[2] ? (m[2] as string).trim() : null })
  }
  return out
}

/** 目录树里所有需要索引的文档路径 */
export function indexablePaths(
  tree: BookTree,
): Array<{ path: string; fileName: string; category: string | null }> {
  const out: Array<{ path: string; fileName: string; category: string | null }> = []
  const push = (p: string, category: string | null = null) =>
    out.push({ path: p, fileName: p.slice(p.lastIndexOf('/') + 1), category })

  for (const c of flattenChapters(tree.text)) push(c.path)
  for (const o of tree.outline) push(o.path)
  for (const cat of tree.settings) for (const card of cat.cards) push(card.path, cat.name)
  for (const card of tree.looseSettings) push(card.path)
  for (const i of tree.ideas) push(i.path)

  return out
}
