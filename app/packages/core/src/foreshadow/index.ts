/**
 * 伏笔追踪。
 *
 * 规范：更新文档/03-数据格式规范.md §5
 *
 * 两部分数据：
 *   1. **正文里的锚点** —— 成对 HTML 注释 `<!--埋#id-->文本<!--/埋#id-->`。
 *      用注释而不是独立坐标文件，是因为坐标会在正文被编辑后漂移，
 *      而注释是内嵌的，怎么改文本它都跟着走，且记事本打开也看得懂。
 *   2. **元数据** —— `.bugu/foreshadow/{deviceId}.jsonl`，仅追加，同 id 后写覆盖先写。
 *      仅追加是为了让多设备同步不可能冲突（各写各的分片文件）。
 */

import type {
  Foreshadow,
  ForeshadowAnchor,
  ForeshadowPriority,
  ForeshadowRecord,
  ForeshadowStatus,
} from '../types/index.js'

export const FORESHADOW_SCHEMA_VERSION = 1

/** 伏笔 id：`f` + 6 位 base36 */
export function generateForeshadowId(random: () => number = Math.random): string {
  let s = ''
  for (let i = 0; i < 6; i++) s += Math.floor(random() * 36).toString(36)
  return `f${s}`
}

export function isForeshadowId(s: string): boolean {
  return /^f[0-9a-z]{6}$/.test(s)
}

// ───────────────────────── 正文锚点解析 ─────────────────────────

const OPEN_RE = /<!--(埋|收)#([A-Za-z0-9_-]+)-->/g

/** 为某个 id + 类型构造闭合标记 */
function closeMarker(kind: '埋' | '收', id: string): string {
  return `<!--/${kind}#${id}-->`
}

/**
 * 从正文中解析出所有伏笔锚点。
 *
 * 允许嵌套与交叉（开闭标记都带 id，所以不依赖栈结构）。
 * 未闭合的开标记会被忽略 —— 宁可少认一个，也不要把半篇正文当成伏笔文本。
 */
export function parseAnchors(body: string): ForeshadowAnchor[] {
  const out: ForeshadowAnchor[] = []
  OPEN_RE.lastIndex = 0

  let m: RegExpExecArray | null
  while ((m = OPEN_RE.exec(body)) !== null) {
    const kindCn = m[1] as '埋' | '收'
    const id = m[2] as string
    const openStart = m.index
    const contentStart = openStart + m[0].length

    const close = closeMarker(kindCn, id)
    const closeIdx = body.indexOf(close, contentStart)
    if (closeIdx === -1) continue // 未闭合，忽略

    out.push({
      id,
      kind: kindCn === '埋' ? 'plant' : 'recover',
      text: body.slice(contentStart, closeIdx),
      start: contentStart,
      end: closeIdx,
      outerStart: openStart,
      outerEnd: closeIdx + close.length,
    })
  }

  return out.sort((a, b) => a.outerStart - b.outerStart)
}

/** 在选中区间外包上伏笔标记，返回新的正文 */
export function wrapAnchor(
  body: string,
  range: { start: number; end: number },
  kind: 'plant' | 'recover',
  id: string,
): string {
  const cn = kind === 'plant' ? '埋' : '收'
  return (
    body.slice(0, range.start) +
    `<!--${cn}#${id}-->` +
    body.slice(range.start, range.end) +
    closeMarker(cn, id) +
    body.slice(range.end)
  )
}

/**
 * 移除正文中某个伏笔的标记（保留被包裹的文本）。
 * `kind` 省略时同时移除埋点与收点。
 */
export function unwrapAnchor(body: string, id: string, kind?: 'plant' | 'recover'): string {
  const kinds: Array<'埋' | '收'> =
    kind === 'plant' ? ['埋'] : kind === 'recover' ? ['收'] : ['埋', '收']
  let out = body
  for (const cn of kinds) {
    out = out
      .split(`<!--${cn}#${id}-->`)
      .join('')
      .split(closeMarker(cn, id))
      .join('')
  }
  return out
}

/**
 * 移除正文中**所有**伏笔标记。导出稿件时用（默认移除，见 05 §10.2）。
 */
export function stripAllAnchors(body: string): string {
  return body.replace(/<!--\/?(?:埋|收)#[A-Za-z0-9_-]+-->/g, '')
}

// ───────────────────────── 元数据合并 ─────────────────────────

const DEFAULTS = {
  title: '',
  desc: '',
  plantedIn: null as string | null,
  expectBy: null as string | null,
  status: 'planned' as ForeshadowStatus,
  priority: 'normal' as ForeshadowPriority,
  recoveredIn: [] as string[],
}

/**
 * 把若干分片文件的记录合并成最终视图。
 *
 * 规则：按 `ts` 升序重放，同 id 的后写字段覆盖先写字段（部分更新，不是整条替换）。
 * `ts` 相同时按传入顺序，保证结果稳定可复现。
 */
export function mergeRecords(records: ForeshadowRecord[]): Foreshadow[] {
  const ordered = records
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.ts - b.r.ts || a.i - b.i)
    .map((x) => x.r)

  const map = new Map<string, Foreshadow>()

  for (const r of ordered) {
    const cur =
      map.get(r.id) ?? ({ id: r.id, ...DEFAULTS, recoveredIn: [], updatedAt: r.ts } as Foreshadow)

    if (r.title !== undefined) cur.title = r.title
    if (r.desc !== undefined) cur.desc = r.desc
    if (r.plantedIn !== undefined) cur.plantedIn = r.plantedIn
    if (r.expectBy !== undefined) cur.expectBy = r.expectBy
    if (r.status !== undefined) cur.status = r.status
    if (r.priority !== undefined) cur.priority = r.priority
    if (r.recoveredIn !== undefined) cur.recoveredIn = [...r.recoveredIn]
    cur.updatedAt = r.ts

    map.set(r.id, cur)
  }

  return [...map.values()]
}

/** 解析一个 jsonl 文件的内容。坏行跳过，不让一行脏数据毁掉整个清单。 */
export function parseJsonl(text: string): ForeshadowRecord[] {
  const out: ForeshadowRecord[] = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    try {
      const o = JSON.parse(t) as unknown
      if (o && typeof o === 'object' && typeof (o as ForeshadowRecord).id === 'string') {
        const rec = o as ForeshadowRecord
        if (typeof rec.ts !== 'number') continue
        out.push(rec)
      }
    } catch {
      // 坏行跳过
    }
  }
  return out
}

/** 序列化成一行 jsonl（不含换行） */
export function toJsonlLine(record: ForeshadowRecord): string {
  return JSON.stringify(record)
}

/** 构造一条新建记录 */
export function createRecord(
  input: {
    id: string
    dev: string
    ts: number
    title: string
    desc?: string
    plantedIn?: string | null
    expectBy?: string | null
    status?: ForeshadowStatus
    priority?: ForeshadowPriority
  },
): ForeshadowRecord {
  const rec: ForeshadowRecord = {
    schemaVersion: FORESHADOW_SCHEMA_VERSION,
    id: input.id,
    ts: input.ts,
    dev: input.dev,
    title: input.title,
    desc: input.desc ?? '',
    plantedIn: input.plantedIn ?? null,
    expectBy: input.expectBy ?? null,
    status: input.status ?? (input.plantedIn ? 'planted' : 'planned'),
    priority: input.priority ?? 'normal',
  }
  return rec
}

/** 构造一条「部分更新」记录，只写变化的字段 */
export function createPatchRecord(
  id: string,
  dev: string,
  ts: number,
  changes: Partial<Omit<ForeshadowRecord, 'schemaVersion' | 'id' | 'ts' | 'dev'>>,
): ForeshadowRecord {
  return { schemaVersion: FORESHADOW_SCHEMA_VERSION, id, ts, dev, ...changes }
}

// ───────────────────────── 清单视图 ─────────────────────────

export interface ForeshadowListItem extends Foreshadow {
  /** 埋点所在章节在全书中的序号（0 基）；未埋或找不到为 null */
  plantedIndex: number | null
  /** 从埋点到「当前章节」已经过去了多少章；无法计算时为 null */
  chaptersElapsed: number | null
}

/**
 * 生成「未回收清单」视图。
 *
 * `chapterOrder` 是全书章节 id 的有序数组，`currentDocId` 是作者正在看的章节。
 * 「已经过去多少章」是这张清单上最有用的一列 —— 埋了 80 章还没收的一眼就能看见。
 */
export function buildList(
  foreshadows: Foreshadow[],
  chapterOrder: string[],
  currentDocId?: string,
): ForeshadowListItem[] {
  const indexOf = new Map(chapterOrder.map((id, i) => [id, i]))
  const curIdx = currentDocId !== undefined ? (indexOf.get(currentDocId) ?? null) : null

  const PRIORITY_RANK: Record<ForeshadowPriority, number> = { high: 0, normal: 1, low: 2 }

  return foreshadows
    .map((f): ForeshadowListItem => {
      const plantedIndex = f.plantedIn != null ? (indexOf.get(f.plantedIn) ?? null) : null
      return {
        ...f,
        plantedIndex,
        chaptersElapsed:
          plantedIndex !== null && curIdx !== null ? Math.max(0, curIdx - plantedIndex) : null,
      }
    })
    .sort((a, b) => {
      const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
      if (p !== 0) return p
      // 埋得越早越靠前（拖得越久越该处理）
      const ai = a.plantedIndex ?? Number.MAX_SAFE_INTEGER
      const bi = b.plantedIndex ?? Number.MAX_SAFE_INTEGER
      if (ai !== bi) return ai - bi
      return a.updatedAt - b.updatedAt
    })
}

/** 只要未回收的（planned + planted），这是清单的默认视图 */
export function pendingOnly(items: ForeshadowListItem[]): ForeshadowListItem[] {
  return items.filter((f) => f.status === 'planned' || f.status === 'planted')
}

/**
 * 到期提醒：找出「计划在 currentDocId 之前回收、但至今未收」的伏笔。
 *
 * 只在 `expectBy` 填的是**具体章节 id** 时生效；填自由文本（「第三卷」）时仅作展示。
 * 返回结果由界面渲染成一条不打断的浅色提示条 —— 桌面端不做弹窗（见 01 §6）。
 */
export function dueForeshadows(
  items: ForeshadowListItem[],
  chapterOrder: string[],
  currentDocId: string,
): ForeshadowListItem[] {
  const indexOf = new Map(chapterOrder.map((id, i) => [id, i]))
  const curIdx = indexOf.get(currentDocId)
  if (curIdx === undefined) return []

  return pendingOnly(items).filter((f) => {
    if (f.expectBy == null) return false
    const expectIdx = indexOf.get(f.expectBy)
    if (expectIdx === undefined) return false // 自由文本，不提醒
    return curIdx >= expectIdx
  })
}
