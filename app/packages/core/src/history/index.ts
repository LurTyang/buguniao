/**
 * 版本历史 —— 增量 diff + 定期快照。
 *
 * 规范：更新文档/03-数据格式规范.md §6
 *
 * ─────────────────────────────────────────────────────────────
 * 【时间桶：作者在 2026-08-25 修正的设计】
 *
 * 初版设计是「连续 30 秒不保存才切下一条记录」（空闲超时）。作者指出这有问题：
 * 连着写两小时的话，中间根本不会出现 30 秒空闲，整场写作会挤成一条巨大的记录，
 * 完全没法回溯。
 *
 * 改成**固定时间桶**（tumbling window）：把时间轴按 30 秒切成等长的格子，
 * 落在同一格里的保存合并成一条记录。每分钟的 0–30 秒一条、31–60 秒一条。
 * 这样历史记录是均匀切开的，和作者写得急不急无关。
 * ─────────────────────────────────────────────────────────────
 *
 * 为什么不用 Git：`.git` 里是二进制文件，扔进网盘同步文件夹后两台设备一提交
 * 就产生无法合并的冲突副本，而且坏了普通用户修不了。见 02-技术架构 §1。
 */

import { createPatch, applyPatch } from 'diff'
import type { HistoryRecord } from '../types/index.js'
import { countWords } from '../wordcount/index.js'

export const HISTORY_SCHEMA_VERSION = 1

/** 时间桶长度：30 秒 */
export const BUCKET_MS = 30_000

/** 每多少个版本存一次全量快照。恢复任意版本最多应用 (SNAPSHOT_INTERVAL-1) 个 patch */
export const SNAPSHOT_INTERVAL = 50

/** 该时间戳所属时间桶的起始毫秒 */
export function bucketOf(ts: number): number {
  return Math.floor(ts / BUCKET_MS) * BUCKET_MS
}

/** 版本 v 是否应该存成全量快照 */
export function shouldSnapshot(v: number): boolean {
  return (v - 1) % SNAPSHOT_INTERVAL === 0
}

// ───────────────────────── 状态 ─────────────────────────

/**
 * 一个文档的历史状态。
 *
 * 缓存 `head` 与 `beforeLast` 是为了避免每次保存都重放整条历史链 ——
 * 百万字小说写到后期，重放几千个 patch 会明显卡顿。
 */
export interface HistoryState {
  records: HistoryRecord[]
  /** 应用完所有记录后的内容（= 最新版本） */
  head: string
  /** 最后一条记录**之前**的内容。同桶合并时用它重算 diff */
  beforeLast: string
}

export function emptyHistory(): HistoryState {
  return { records: [], head: '', beforeLast: '' }
}

/** 从磁盘读出的记录重建状态（启动或索引重建时用一次） */
export function loadHistory(records: HistoryRecord[]): HistoryState {
  const sorted = normalizeHistory(records)
  if (sorted.length === 0) return emptyHistory()
  const lastV = (sorted[sorted.length - 1] as HistoryRecord).v
  return {
    records: sorted,
    head: reconstruct(sorted, lastV),
    beforeLast: lastV > 1 ? reconstruct(sorted, lastV - 1) : '',
  }
}

// ───────────────────────── 写入 ─────────────────────────

export interface SaveInput {
  /** 保存后的完整正文 */
  content: string
  /** 保存发生的真实时间戳（毫秒） */
  ts: number
  /** 设备标识 */
  dev: string
  /** 手动打的命名标记 */
  label?: string
}

export interface SaveResult {
  state: HistoryState
  /** created 新建了一条记录 / merged 并入了同桶的上一条 / skipped 内容没变 */
  action: 'created' | 'merged' | 'skipped'
  /** 本次写入涉及的记录（skipped 时为 null） */
  record: HistoryRecord | null
}

/**
 * 记一次保存。
 *
 * 三种结果：
 *   - 内容与上次完全相同 → skipped，不产生任何记录（避免 Ctrl+S 连按刷出一堆空版本）
 *   - 落在与上一条记录相同的时间桶且同一设备 → merged，重算那条记录
 *   - 否则 → created，新建一条
 */
export function appendSave(state: HistoryState, input: SaveInput): SaveResult {
  const { content, ts, dev } = input

  if (state.records.length > 0 && content === state.head) {
    // 内容没变。但如果这次带了 label，仍应把 label 记上去。
    if (input.label !== undefined) {
      const last = state.records[state.records.length - 1] as HistoryRecord
      const updated: HistoryRecord = { ...last, label: input.label }
      return {
        state: { ...state, records: [...state.records.slice(0, -1), updated] },
        action: 'merged',
        record: updated,
      }
    }
    return { state, action: 'skipped', record: null }
  }

  const chars = countWords(content).withPunctuation
  const bucket = bucketOf(ts)
  const last = state.records[state.records.length - 1]

  // ── 同桶合并 ──
  if (last && bucketOf(last.ts) === bucket && last.dev === dev) {
    const rebuilt = makeRecord({
      v: last.v,
      ts: bucket,
      dev,
      chars,
      base: state.beforeLast,
      content,
      forceSnapshot: last.kind === 'snapshot',
      label: input.label ?? last.label,
    })
    return {
      state: { records: [...state.records.slice(0, -1), rebuilt], head: content, beforeLast: state.beforeLast },
      action: 'merged',
      record: rebuilt,
    }
  }

  // ── 新建 ──
  const v = last ? last.v + 1 : 1
  const rec = makeRecord({
    v,
    ts: bucket,
    dev,
    chars,
    base: state.head,
    content,
    forceSnapshot: shouldSnapshot(v),
    label: input.label,
  })
  return {
    state: { records: [...state.records, rec], head: content, beforeLast: state.head },
    action: 'created',
    record: rec,
  }
}

function makeRecord(o: {
  v: number
  ts: number
  dev: string
  chars: number
  base: string
  content: string
  forceSnapshot: boolean
  label?: string | undefined
}): HistoryRecord {
  let kind: HistoryRecord['kind'] = o.forceSnapshot ? 'snapshot' : 'patch'
  let data = o.forceSnapshot ? o.content : makePatch(o.base, o.content)

  // ── 保险阀：增量不比全文小时，直接存全文 ──
  //
  // unified diff 是**按行**比对的。中文小说一个自然段就是一行，
  // 段落越长，改一个字就要把整段重写两遍（-旧段落 +新段落）。
  // 极端情况下（作者写了一个几千字不换行的长段），增量会比全量还费。
  //
  // 有了这道阀，历史占用永远不会超过「每版都存全文」，
  // 而正常分段的稿子仍然享受增量带来的十倍以上节省。
  if (kind === 'patch' && data.length >= o.content.length) {
    kind = 'snapshot'
    data = o.content
  }

  const rec: HistoryRecord = {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    v: o.v,
    ts: o.ts,
    dev: o.dev,
    kind,
    chars: o.chars,
    data,
  }
  if (o.label !== undefined) rec.label = o.label
  return rec
}

/** 生成 unified diff。去掉 jsdiff 的文件头，历史文件里不需要那两行。 */
function makePatch(oldStr: string, newStr: string): string {
  const patch = createPatch('doc', oldStr, newStr, '', '', { context: 3 })
  // jsdiff 输出前四行是 Index/===/---/+++，对我们无用
  const lines = patch.split('\n')
  const start = lines.findIndex((l) => l.startsWith('@@'))
  return start === -1 ? '' : lines.slice(start).join('\n')
}

/** 把去头的 patch 补回 jsdiff 需要的形状 */
function restorePatchHeader(data: string): string {
  return `Index: doc\n===================================================================\n--- doc\n+++ doc\n${data}`
}

// ───────────────────────── 读取 ─────────────────────────

/**
 * 规范化一串历史记录：按版本号排序，**同一版本号只保留最后一条**。
 *
 * 为什么会有重复的版本号：历史文件是**仅追加**的，而同一时间桶内的多次保存
 * 会重写同一条记录（v 不变、内容更新）。追加写没法「改」已有的行，
 * 于是磁盘上就出现了两条 v 相同的记录 —— 后写的那条才是真的。
 *
 * 这个语义属于文件格式本身，必须由 core 承担，不能指望每个读取方各自去重
 * （只要有一个忘了，作者拿到的就是旧内容，而且完整性校验会误报「历史损坏」）。
 */
export function normalizeHistory(records: readonly HistoryRecord[]): HistoryRecord[] {
  // Array.sort 是稳定排序，所以同 v 的记录仍保持文件里的先后顺序
  const sorted = [...records].sort((a, b) => a.v - b.v)
  const out: HistoryRecord[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && last.v === r.v) out[out.length - 1] = r
    else out.push(r)
  }
  return out
}

export class HistoryCorruptError extends Error {
  constructor(
    message: string,
    readonly version: number,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'HistoryCorruptError'
  }
}

/**
 * 还原到指定版本的完整内容。
 *
 * 从不晚于目标版本的最近一个快照出发，依次应用 patch。
 * 任何一步应用失败都抛 HistoryCorruptError —— 宁可明确报错，
 * 也不要给作者一份悄悄错掉的旧稿。
 */
export function reconstruct(records: readonly HistoryRecord[], targetV: number): string {
  const sorted = normalizeHistory(records)

  let baseIdx = -1
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i] as HistoryRecord
    if (r.v > targetV) break
    if (r.kind === 'snapshot') baseIdx = i
  }
  if (baseIdx === -1) {
    if (sorted.length === 0) return ''
    throw new HistoryCorruptError('找不到可用的快照，历史链已断', targetV)
  }

  let content = (sorted[baseIdx] as HistoryRecord).data

  for (let i = baseIdx + 1; i < sorted.length; i++) {
    const r = sorted[i] as HistoryRecord
    if (r.v > targetV) break
    if (r.kind === 'snapshot') {
      content = r.data
      continue
    }
    // jsdiff 在补丁格式本身就坏掉时会抛它自己的异常（而不是返回 false），
    // 必须接住并转成我们的错误类型，否则作者会看到一句看不懂的英文报错。
    let applied: string | false
    try {
      applied = applyPatch(content, restorePatchHeader(r.data))
    } catch (cause) {
      throw new HistoryCorruptError(`第 ${r.v} 版的增量补丁格式已损坏`, r.v, { cause })
    }
    if (applied === false) {
      throw new HistoryCorruptError(`第 ${r.v} 版的增量补丁无法应用`, r.v)
    }
    content = applied
  }

  // ── 完整性校验 ──
  //
  // 必须有这一步。jsdiff 遇到「格式本身就是垃圾」的补丁时，既不抛异常也不返回 false，
  // 而是**悄悄返回原内容不变**。没有校验的话，作者以为回到了第 100 版，
  // 拿到的其实是第 99 版，而且毫无提示 —— 这是最坏的一种错误。
  //
  // 每条记录都带着它那一版的字数，拿来做校验和，代价接近零。
  const target = sorted.find((r) => r.v === targetV)
  if (target && countWords(content).withPunctuation !== target.chars) {
    throw new HistoryCorruptError(
      `第 ${targetV} 版还原结果与记录的字数不符（记录 ${target.chars}，实得 ${countWords(content).withPunctuation}），历史可能已损坏`,
      targetV,
    )
  }

  return content
}

/** 版本列表视图（不含 data，界面列表用，避免把全文都塞进内存） */
export interface HistoryEntry {
  v: number
  ts: number
  dev: string
  kind: HistoryRecord['kind']
  chars: number
  label?: string
  /** 相对上一版的字数变化 */
  delta: number
}

export function listVersions(records: readonly HistoryRecord[]): HistoryEntry[] {
  const sorted = normalizeHistory(records)
  return sorted.map((r, i) => {
    const prev = sorted[i - 1]
    const e: HistoryEntry = {
      v: r.v,
      ts: r.ts,
      dev: r.dev,
      kind: r.kind,
      chars: r.chars,
      delta: r.chars - (prev?.chars ?? 0),
    }
    if (r.label !== undefined) e.label = r.label
    return e
  })
}

/**
 * 回滚到某个版本。
 *
 * **回滚本身也产生一条新版本记录**，所以回滚可以再撤销 —— 这一条很重要，
 * 否则作者点错一次就再也回不去了。
 */
export function rollback(
  state: HistoryState,
  targetV: number,
  o: { ts: number; dev: string; label?: string },
): SaveResult {
  const content = reconstruct(state.records, targetV)
  return appendSave(state, {
    content,
    ts: o.ts,
    dev: o.dev,
    label: o.label ?? `回滚到第 ${targetV} 版`,
  })
}

// ───────────────────────── 容量管理 ─────────────────────────

export type CapacityLevel = 'ok' | 'warn' | 'full'

export interface CapacityStatus {
  level: CapacityLevel
  usedBytes: number
  limitBytes: number
  ratio: number
}

/** 记录序列化后的字节数（UTF-8） */
export function historySizeBytes(records: readonly HistoryRecord[]): number {
  let n = 0
  for (const r of records) n += utf8Len(JSON.stringify(r)) + 1 // +1 为换行
  return n
}

function utf8Len(s: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length
  let n = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) as number
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
  }
  return n
}

/**
 * 容量状态。达到 80% 黄色提示，达到 100% 红色横幅并**暂停写新历史**。
 * 绝不静默删除任何历史 —— 删什么由作者决定。
 */
export function capacityStatus(usedBytes: number, limitMB: number): CapacityStatus {
  const limitBytes = limitMB * 1024 * 1024
  const ratio = limitBytes > 0 ? usedBytes / limitBytes : 0
  return {
    usedBytes,
    limitBytes,
    ratio,
    level: ratio >= 1 ? 'full' : ratio >= 0.8 ? 'warn' : 'ok',
  }
}

/**
 * 清理历史，只保留 `keep` 判定为 true 的版本。
 *
 * ⚠️ 关键：删掉快照会让后面的 patch 无法应用。所以清理后必须把**最早保留的那一版**
 *    转成快照。这个函数已经处理了，调用方直接用返回值覆盖原文件即可。
 */
export function prune(
  records: readonly HistoryRecord[],
  keep: (r: HistoryRecord) => boolean,
): HistoryRecord[] {
  const sorted = normalizeHistory(records)
  const kept = sorted.filter(keep)
  if (kept.length === 0) return []

  const out: HistoryRecord[] = []
  let prevContent = ''

  for (let i = 0; i < kept.length; i++) {
    const r = kept[i] as HistoryRecord
    const content = reconstruct(sorted, r.v)
    if (i === 0) {
      // 最早保留的一版必须是快照，否则整条链断掉
      out.push({ ...r, kind: 'snapshot', data: content })
    } else if (r.kind === 'snapshot') {
      out.push({ ...r, data: content })
    } else {
      out.push({ ...r, kind: 'patch', data: makePatch(prevContent, content) })
    }
    prevContent = content
  }

  return out
}

/** 清理策略：只保留带命名标记的版本（外加最新一版，否则当前内容就丢了） */
export function pruneKeepLabeled(records: readonly HistoryRecord[]): HistoryRecord[] {
  const sorted = normalizeHistory(records)
  const lastV = sorted[sorted.length - 1]?.v
  return prune(sorted, (r) => r.label !== undefined || r.v === lastV)
}

/** 清理策略：删掉某时间点之前的版本（带命名标记的和最新一版仍保留） */
export function pruneOlderThan(records: readonly HistoryRecord[], cutoffTs: number): HistoryRecord[] {
  const sorted = normalizeHistory(records)
  const lastV = sorted[sorted.length - 1]?.v
  return prune(sorted, (r) => r.ts >= cutoffTs || r.label !== undefined || r.v === lastV)
}

// ───────────────────────── jsonl 读写 ─────────────────────────

export function parseHistoryJsonl(text: string): HistoryRecord[] {
  const out: HistoryRecord[] = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    try {
      const o = JSON.parse(t) as HistoryRecord
      if (typeof o?.v === 'number' && typeof o?.data === 'string') out.push(o)
    } catch {
      // 坏行跳过
    }
  }
  return out
}

export function toHistoryJsonl(records: readonly HistoryRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + (records.length > 0 ? '\n' : '')
}
