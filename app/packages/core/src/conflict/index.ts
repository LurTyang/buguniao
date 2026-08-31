/**
 * 坚果云冲突副本的识别与对比。
 *
 * 规范：更新文档/03-数据格式规范.md §同步冲突
 *
 * 两台电脑离线各写一版，坚果云不会替你合并 —— 它把后到的那份改名存下来，
 * 变成 `0010-第一章 (冲突文件 2026-08-25 明听).md`，然后就不管了。
 *
 * 作者要的只有一件事：**看清两边差在哪，然后自己挑**。
 * 所以这里只做两件事：把冲突副本配回它的正本；把两份正文对齐成左右两栏。
 *
 * 一条底线贯穿全模块：**永远不自动挑一边**。
 * 同步冲突里被丢掉的那一版，往往是作者熬夜写的那一版。
 */

import { diffLines as jsDiffLines } from 'diff'
import { isConflictCopy, joinPath } from '../storage/index.js'

/** 冲突副本文件名里的标记：`(冲突文件 2026-08-25 明听)` / `(conflicted copy ...)` */
// 标记不一定顶在括号最前面 —— Dropbox 那种是 `(明听's conflicted copy 2026-08-25)`
const CONFLICT_MARK = /\s*[(（][^)）]*(?:冲突(?:文件|副本)?|conflicted\s+copy)[^)）]*[)）]/gi

/**
 * 从冲突副本的文件名还原出正本的文件名。
 *
 * 只去掉冲突标记，编号前缀与扩展名都原样留着 ——
 * 正本必须落在同一个位置、同一个序号上，否则章节顺序会乱。
 */
export function originalFileName(conflictFileName: string): string {
  // 扩展名单独摘出来：坚果云的标记一般插在扩展名之前，但也见过插在后面的
  const m = /^(.*?)(\.[^.]*)?$/.exec(conflictFileName)
  const stem = (m?.[1] ?? conflictFileName).replace(CONFLICT_MARK, '').trim()
  const ext = m?.[2]?.replace(CONFLICT_MARK, '') ?? ''
  return stem + ext
}

/** 同上，但作用在完整路径上 */
export function originalPathOf(conflictPath: string): string {
  const cut = conflictPath.lastIndexOf('/')
  const dir = cut < 0 ? '' : conflictPath.slice(0, cut)
  const name = conflictPath.slice(cut + 1)
  const original = originalFileName(name)
  return dir ? joinPath(dir, original) : original
}

/** 左右两栏里的一行 */
export interface DiffRow {
  /**
   * - `same`：两边一样
   * - `add`：只有右边有（副本新增）
   * - `del`：只有左边有（副本删掉了）
   */
  kind: 'same' | 'add' | 'del'
  /** 正本的这一行；`add` 行为 null */
  left: string | null
  /** 冲突副本的这一行；`del` 行为 null */
  right: string | null
  /** 正本里的行号（从 1 起）；`add` 行为 null */
  leftNo: number | null
  rightNo: number | null
}

export interface DiffSummary {
  rows: DiffRow[]
  /** 只有右边有的行数 */
  added: number
  /** 只有左边有的行数 */
  removed: number
  /** 完全一样时为 true —— 这种冲突副本可以放心删 */
  identical: boolean
}

/**
 * 把两份正文对齐成左右两栏。
 *
 * 中文一个自然段就是一行，所以「改了一个字」会显示成一删一增的一对。
 * 这是对的 —— 作者要看的是**整段哪边更好**，不是哪个字不一样。
 */
export function compareTexts(left: string, right: string): DiffSummary {
  const parts = jsDiffLines(normalize(left), normalize(right))
  const rows: DiffRow[] = []
  let ln = 0
  let rn = 0
  let added = 0
  let removed = 0

  for (const part of parts) {
    const lines = splitKeepingCount(part.value)
    for (const line of lines) {
      if (part.added) {
        rows.push({ kind: 'add', left: null, right: line, leftNo: null, rightNo: ++rn })
        added++
      } else if (part.removed) {
        rows.push({ kind: 'del', left: line, right: null, leftNo: ++ln, rightNo: null })
        removed++
      } else {
        rows.push({ kind: 'same', left: line, right: line, leftNo: ++ln, rightNo: ++rn })
      }
    }
  }

  return { rows, added, removed, identical: added === 0 && removed === 0 }
}

/**
 * 一句话说清这个冲突。界面上黄色横幅直接用它。
 */
export function describeConflict(summary: DiffSummary): string {
  if (summary.identical) return '两份内容完全一样，删掉副本就行。'
  const bits: string[] = []
  if (summary.added > 0) bits.push(`副本多 ${summary.added} 行`)
  if (summary.removed > 0) bits.push(`副本少 ${summary.removed} 行`)
  return bits.join('，') + '。挑一边留下，或者自己合。'
}

/** 冲突副本清单里的一条 */
export interface ConflictPair {
  /** 冲突副本的路径 */
  conflictPath: string
  /** 推断出的正本路径 */
  originalPath: string
  /** 文件名（去掉目录），显示用 */
  fileName: string
}

/**
 * 把 `loadTree` 收上来的冲突路径整理成成对的清单。
 *
 * 正本可能已经被作者删了 —— 那种情况下 `originalPath` 指向一个不存在的文件，
 * 界面会把左栏显示成空，作者点「用副本」就等于把它扶正。
 */
export function pairConflicts(conflictPaths: readonly string[]): ConflictPair[] {
  return conflictPaths.filter((p) => isConflictCopy(p.split('/').pop() ?? '')).map((conflictPath) => ({
    conflictPath,
    originalPath: originalPathOf(conflictPath),
    fileName: conflictPath.split('/').pop() ?? conflictPath,
  }))
}

// ───────────────────────── 内部 ─────────────────────────

/**
 * CRLF 统一成 LF，并补上结尾换行。
 *
 * 记事本存过的文件全是 CRLF，不统一的话整篇都会显示成「每行都不同」。
 * 补结尾换行是因为 jsdiff 对「最后一行没有换行」的处理和别的行不一样：
 * `甲` 与 `甲\n乙` 会被算成整块替换，而不是「多了一行乙」。
 */
function normalize(text: string): string {
  const lf = text.replace(/\r\n?/g, '\n')
  return lf === '' || lf.endsWith('\n') ? lf : lf + '\n'
}

/**
 * 把 diff 分块拆成行。
 *
 * jsdiff 的每块以 `\n` 结尾，直接 split 会在末尾多出一个空串；
 * 但正文中间真实存在的空行必须留着 —— 那是自然段的分隔。
 */
function splitKeepingCount(chunk: string): string[] {
  const lines = chunk.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}
