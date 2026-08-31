/**
 * front-matter 与作品元数据的解析 / 序列化。
 *
 * 规范：更新文档/03-数据格式规范.md §2 §3
 *
 * 设计要点：
 *   1. **未识别的字段必须原样保留**。作者可能用 Obsidian 之类的工具加了自己的字段，
 *      我们不能在保存时把它吞掉 —— 那等于偷偷破坏作者的数据。
 *   2. **没有 front-matter 的裸 .md 也要能吃**。作者用记事本随手新建一章是完全合法的，
 *      我们负责补上 id 和必要字段，而不是报错。
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { BOOK_KINDS } from '../types/index.js'
import type { BookMeta, BookStatus, DocMeta, DocStatus, DocType, ParsedDoc } from '../types/index.js'

/** front-matter 里我们认识的字段，其余进 extra */
const KNOWN_DOC_KEYS = new Set(['id', 'type', 'title', 'created', 'updated', 'device', 'status'])

const DOC_TYPES: readonly DocType[] = ['chapter', 'outline', 'setting', 'idea', 'script']
const DOC_STATUSES: readonly DocStatus[] = ['draft', 'done', 'revising']
const BOOK_STATUSES: readonly BookStatus[] = ['serializing', 'finished', 'pit']

/** id 前缀，见 03 §3 */
export const ID_PREFIX: Record<DocType | 'book', string> = {
  chapter: 'ch',
  outline: 'out',
  setting: 'set',
  idea: 'idea',
  script: 'scr',
  book: 'bk',
}

// ───────────────────────── id 生成 ─────────────────────────

/** 可注入的随机源，便于测试中固定输出 */
export type RandomSource = () => number

const defaultRandom: RandomSource = () => {
  if (typeof crypto !== 'undefined' && crypto?.getRandomValues) {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    return (buf[0] as number) / 0x1_0000_0000
  }
  return Math.random()
}

/** 生成 `{前缀}-{6位base36}`，如 `ch-a1b2c3` */
export function generateId(kind: DocType | 'book', random: RandomSource = defaultRandom): string {
  let s = ''
  for (let i = 0; i < 6; i++) {
    s += Math.floor(random() * 36).toString(36)
  }
  return `${ID_PREFIX[kind]}-${s}`
}

// ───────────────────────── 文档 front-matter ─────────────────────────

/** 匹配文件开头的 `---\n...\n---`。允许 CRLF，允许结尾无换行。 */
const FM_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

export interface ParseDocOptions {
  /** 无 front-matter 或缺字段时的兜底文件名（用于推断 title） */
  fileName?: string
  /** 缺 type 时的默认值 */
  defaultType?: DocType
  /** 缺 created/updated 时使用的时间（ISO 字符串）。注入以便测试 */
  now?: string
  random?: RandomSource
}

/**
 * 解析一个 .md 文件的完整内容。
 *
 * 永远返回一个合法的 ParsedDoc —— 缺什么补什么，不抛异常。
 * `hadFrontMatter` 为 false 或 meta 被补全过时，调用方应把文件回写一次。
 */
export function parseDoc(raw: string, opts: ParseDocOptions = {}): ParsedDoc {
  const now = opts.now ?? new Date().toISOString()
  const fallbackTitle = stripOrderPrefix((opts.fileName ?? '未命名').replace(/\.md$/i, ''))

  const m = FM_RE.exec(raw)
  if (!m) {
    const type = opts.defaultType ?? 'chapter'
    return {
      hadFrontMatter: false,
      body: stripBom(raw),
      meta: {
        id: generateId(type, opts.random),
        type,
        title: firstHeadingOf(raw) ?? fallbackTitle,
        created: now,
        updated: now,
      },
    }
  }

  const body = raw.slice(m[0].length)
  let data: Record<string, unknown> = {}
  try {
    const parsed = parseYaml(m[1] as string)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>
    }
  } catch {
    // YAML 坏了不能让整个文档打不开 —— 当作没有 front-matter 处理，正文照常给出。
    // 调用方会重新写一份合法的 front-matter，坏掉的那几行随之被替换。
    data = {}
  }

  const type = pickEnum(data['type'], DOC_TYPES) ?? opts.defaultType ?? 'chapter'
  const extra: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (!KNOWN_DOC_KEYS.has(k)) extra[k] = v
  }

  const meta: DocMeta = {
    id: asString(data['id']) ?? generateId(type, opts.random),
    type,
    title: asString(data['title']) ?? firstHeadingOf(body) ?? fallbackTitle,
    created: asString(data['created']) ?? now,
    updated: asString(data['updated']) ?? now,
  }
  const status = pickEnum(data['status'], DOC_STATUSES)
  const device = asString(data['device'])
  if (device) meta.device = device
  if (status) meta.status = status
  if (Object.keys(extra).length > 0) meta.extra = extra

  return { meta, body, hadFrontMatter: true }
}

/** 把 meta + body 序列化回完整的 .md 文件内容 */
export function serializeDoc(meta: DocMeta, body: string): string {
  const obj: Record<string, unknown> = {
    id: meta.id,
    type: meta.type,
    title: meta.title,
    created: meta.created,
    updated: meta.updated,
  }
  if (meta.device) obj['device'] = meta.device
  if (meta.status) obj['status'] = meta.status
  // extra 放最后，保持我们自己的字段在上方好读
  for (const [k, v] of Object.entries(meta.extra ?? {})) obj[k] = v

  const yaml = stringifyYaml(obj, { lineWidth: 0 }).trimEnd()
  // 【必须是恒等往返】body 原样接在后面，一个字节都不加。
  //
  // 初版会在正文前补一个换行让文件好看些，代价是 parseDoc(serializeDoc(x)) !== x：
  // 作者第一次保存后，编辑器顶上会凭空多出一个空行。
  // 排版好看是新建文档时该操心的事（见 withLeadingBlankLine），不该由序列化偷偷做。
  return `---\n${yaml}\n---\n${body}`
}

/** 新建文档时用：让正文与 front-matter 之间空一行，纯粹为了好看 */
export function withLeadingBlankLine(body: string): string {
  return body.startsWith('\n') ? body : `\n${body}`
}

/** 只更新 front-matter 的 updated 字段，body 原样保留 */
export function touchDoc(doc: ParsedDoc, now = new Date().toISOString()): ParsedDoc {
  return { ...doc, meta: { ...doc.meta, updated: now } }
}

// ───────────────────────── book.yaml ─────────────────────────

const KNOWN_BOOK_KEYS = new Set([
  'schemaVersion',
  'id',
  'title',
  'author',
  'cover',
  'status',
  'kind',
  'castFrom',
  'pinned',
  'tags',
  'summary',
  'createdAt',
  'targets',
  'historyLimitMB',
])

export const DEFAULT_HISTORY_LIMIT_MB = 500

export function parseBookMeta(
  raw: string,
  opts: { folderName?: string; now?: string; random?: RandomSource } = {},
): BookMeta {
  const now = opts.now ?? new Date().toISOString()
  let data: Record<string, unknown> = {}
  try {
    const parsed = parseYaml(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>
    }
  } catch {
    data = {}
  }

  const extra: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (!KNOWN_BOOK_KEYS.has(k)) extra[k] = v
  }

  const targetsRaw = data['targets']
  const targets =
    targetsRaw && typeof targetsRaw === 'object' && !Array.isArray(targetsRaw)
      ? { dailyWords: asNumber((targetsRaw as Record<string, unknown>)['dailyWords']) ?? 0 }
      : undefined

  const meta: BookMeta = {
    schemaVersion: asNumber(data['schemaVersion']) ?? 1,
    id: asString(data['id']) ?? generateId('book', opts.random),
    title: asString(data['title']) ?? opts.folderName ?? '未命名作品',
    status: pickEnum(data['status'], BOOK_STATUSES) ?? 'serializing',
    createdAt: asString(data['createdAt']) ?? now,
    historyLimitMB: asNumber(data['historyLimitMB']) ?? DEFAULT_HISTORY_LIMIT_MB,
  }
  if (data['pinned'] === true) meta.pinned = true
  const kind = pickEnum(data['kind'], BOOK_KINDS)
  if (kind) meta.kind = kind
  if (Array.isArray(data['castFrom'])) {
    meta.castFrom = (data['castFrom'] as unknown[]).filter((t): t is string => typeof t === 'string')
  }
  const author = asString(data['author'])
  if (author) meta.author = author
  const cover = asString(data['cover'])
  if (cover) meta.cover = cover
  const summary = asString(data['summary'])
  if (summary) meta.summary = summary
  if (Array.isArray(data['tags'])) {
    meta.tags = (data['tags'] as unknown[]).filter((t): t is string => typeof t === 'string')
  }
  if (targets) meta.targets = targets
  if (Object.keys(extra).length > 0) meta.extra = extra

  return meta
}

export function serializeBookMeta(meta: BookMeta): string {
  const obj: Record<string, unknown> = {
    schemaVersion: meta.schemaVersion,
    id: meta.id,
    title: meta.title,
  }
  if (meta.author) obj['author'] = meta.author
  if (meta.cover) obj['cover'] = meta.cover
  obj['status'] = meta.status
  if (meta.kind) obj['kind'] = meta.kind
  if (meta.pinned) obj['pinned'] = true
  // 空数组也要写出来 —— 「一个分类都不算人物」和「还没选过」是两件事，
  // 前者是作者的决定，不写下来下次打开又会被猜成认人
  if (meta.castFrom) obj['castFrom'] = meta.castFrom
  if (meta.tags?.length) obj['tags'] = meta.tags
  if (meta.summary) obj['summary'] = meta.summary
  obj['createdAt'] = meta.createdAt
  if (meta.targets) obj['targets'] = meta.targets
  obj['historyLimitMB'] = meta.historyLimitMB ?? DEFAULT_HISTORY_LIMIT_MB
  for (const [k, v] of Object.entries(meta.extra ?? {})) obj[k] = v

  return stringifyYaml(obj, { lineWidth: 0 })
}

/** 新建作品时的默认元数据 */
export function createBookMeta(
  title: string,
  opts: { now?: string; random?: RandomSource } = {},
): BookMeta {
  return {
    schemaVersion: 1,
    id: generateId('book', opts.random),
    title,
    status: 'serializing',
    createdAt: opts.now ?? new Date().toISOString(),
    targets: { dailyWords: 0 },
    historyLimitMB: DEFAULT_HISTORY_LIMIT_MB,
  }
}

// ───────────────────────── 小工具 ─────────────────────────

function stripBom(s: string): string {
  return s.startsWith('﻿') ? s.slice(1) : s
}

/** 去掉文件名里的四位序号前缀，如 `0010-第一章 坠楼` → `第一章 坠楼` */
export function stripOrderPrefix(name: string): string {
  return name.replace(/^\d{4}-/, '')
}

function firstHeadingOf(text: string): string | null {
  const m = /^\s{0,3}#{1,6}\s+(.+)$/m.exec(text)
  if (!m) return null
  return (m[1] as string).replace(/\s+#+\s*$/, '').trim() || null
}

function asString(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim()
    return t.length > 0 ? t : null
  }
  // YAML 会把没引号的 ISO 日期解析成 Date，得转回字符串
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'number') return String(v)
  return null
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

function pickEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null
}
