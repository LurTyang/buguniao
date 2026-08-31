/**
 * 章节排序 —— 四位间隔编号。
 *
 * 规范：更新文档/03-数据格式规范.md §1.1
 *
 * 同一目录内按文件名字典序排序，序号写在文件名前缀里（`0010-第一章 坠楼.md`）。
 * 这样在资源管理器里看到的顺序也是正确的顺序 —— 这是「文件即真相」的一部分。
 *
 * 用间隔 10 而不是 1，是为了让「在两章之间插一章」只需重命名 1 个文件，
 * 而不是把后面 300 章全部重编号（那会造成大量同步流量）。
 */

/** 序号位数 */
export const ORDER_WIDTH = 4
/** 默认间隔 */
export const ORDER_STEP = 10
/** 序号上限（四位数） */
export const ORDER_MAX = 9999
/** 序号下限（0 留给「必须排最前」的特殊情况，正常从 10 起） */
export const ORDER_MIN = 1

/** 10 → "0010" */
export function formatOrder(order: number): string {
  const n = Math.max(0, Math.min(ORDER_MAX, Math.round(order)))
  return String(n).padStart(ORDER_WIDTH, '0')
}

export interface ParsedName {
  /** 序号；无前缀时为 null */
  order: number | null
  /** 去掉序号前缀后的部分（含扩展名） */
  rest: string
}

/** `0010-第一章 坠楼.md` → { order: 10, rest: '第一章 坠楼.md' } */
export function parseName(fileName: string): ParsedName {
  const m = /^(\d{4})-(.*)$/s.exec(fileName)
  if (!m) return { order: null, rest: fileName }
  return { order: Number(m[1]), rest: m[2] as string }
}

/** 拼回带序号的文件名 */
export function buildName(order: number, rest: string): string {
  return `${formatOrder(order)}-${rest}`
}

// ───────────────────────── 求空位 ─────────────────────────

/**
 * 求两个序号之间的插入位。
 *
 * `prev` 为 null 表示插到最前面，`next` 为 null 表示追加到最后。
 * 返回 null 表示**这里已经没有空位了**，调用方需要触发整段重排。
 */
export function orderBetween(prev: number | null, next: number | null): number | null {
  if (prev === null && next === null) return ORDER_STEP

  if (prev === null) {
    const n = next as number
    if (n <= ORDER_MIN) return null // 前面挤不下了
    return Math.max(ORDER_MIN, Math.floor(n / 2))
  }

  if (next === null) {
    const p = prev + ORDER_STEP
    return p > ORDER_MAX ? null : p
  }

  if (next - prev < 2) return null // 中间没有整数空位
  return Math.floor((prev + next) / 2)
}

/** 追加到末尾用的下一个序号 */
export function nextOrder(existing: readonly number[]): number | null {
  if (existing.length === 0) return ORDER_STEP
  return orderBetween(Math.max(...existing), null)
}

// ───────────────────────── 移动 ─────────────────────────

export interface OrderedItem {
  /** 当前完整文件名（含序号前缀） */
  fileName: string
  order: number
  rest: string
}

/** 把文件名列表解析成有序项。无序号前缀的排在最后，按名字排序。 */
export function toOrderedItems(fileNames: readonly string[]): OrderedItem[] {
  const withOrder: OrderedItem[] = []
  const without: string[] = []

  for (const fileName of fileNames) {
    const { order, rest } = parseName(fileName)
    if (order === null) without.push(fileName)
    else withOrder.push({ fileName, order, rest })
  }

  withOrder.sort((a, b) => a.order - b.order || a.rest.localeCompare(b.rest, 'zh'))
  without.sort((a, b) => a.localeCompare(b, 'zh'))

  // 没有序号的补到末尾（作者用记事本手动新建的文件会走这条路）
  let cursor = withOrder.length > 0 ? (withOrder[withOrder.length - 1] as OrderedItem).order : 0
  for (const fileName of without) {
    cursor = Math.min(ORDER_MAX, cursor + ORDER_STEP)
    withOrder.push({ fileName, order: cursor, rest: fileName })
  }

  return withOrder
}

export interface Rename {
  from: string
  to: string
}

export interface MoveResult {
  /** 需要执行的重命名（已排除没变化的） */
  renames: Rename[]
  /** 是否触发了整段重排（间隔用尽时） */
  renumbered: boolean
  /** 移动后的完整顺序 */
  items: OrderedItem[]
}

/**
 * 把第 `from` 项移动到第 `to` 位（拖拽排序）。
 *
 * 正常情况只重命名 1 个文件。只有当目标位置挤不下新序号时，
 * 才触发整段重排（此时 `renumbered` 为 true，界面应提示作者「正在整理序号」）。
 */
export function moveItem(items: readonly OrderedItem[], from: number, to: number): MoveResult {
  if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) {
    return { renames: [], renumbered: false, items: [...items] }
  }

  const reordered = [...items]
  const [moved] = reordered.splice(from, 1)
  reordered.splice(to, 0, moved as OrderedItem)

  const prev = to > 0 ? (reordered[to - 1] as OrderedItem).order : null
  const next = to < reordered.length - 1 ? (reordered[to + 1] as OrderedItem).order : null
  const slot = orderBetween(prev, next)

  if (slot !== null) {
    const target: OrderedItem = { ...(moved as OrderedItem), order: slot, fileName: buildName(slot, (moved as OrderedItem).rest) }
    reordered[to] = target
    const renames: Rename[] =
      target.fileName === (moved as OrderedItem).fileName
        ? []
        : [{ from: (moved as OrderedItem).fileName, to: target.fileName }]
    return { renames, renumbered: false, items: reordered }
  }

  // 挤不下 → 整段重排
  const renumbered = renumberAll(reordered)
  return { renames: renumbered.renames, renumbered: true, items: renumbered.items }
}

/** 整段重排为 0010 / 0020 / 0030 …，返回需要执行的重命名 */
export function renumberAll(items: readonly OrderedItem[]): { renames: Rename[]; items: OrderedItem[] } {
  const renames: Rename[] = []
  const out: OrderedItem[] = []

  items.forEach((item, i) => {
    const order = (i + 1) * ORDER_STEP
    const fileName = buildName(order, item.rest)
    out.push({ ...item, order, fileName })
    if (fileName !== item.fileName) renames.push({ from: item.fileName, to: fileName })
  })

  return { renames, items: out }
}

/**
 * 在第 `index` 位之前插入一个新项，返回它应该用的文件名。
 *
 * `index` 等于列表长度表示追加到末尾。
 * 若返回 `renumbered` 为 true，说明需要先执行 `renames` 再创建新文件。
 */
export function insertAt(
  items: readonly OrderedItem[],
  index: number,
  rest: string,
): { fileName: string; renames: Rename[]; renumbered: boolean; items: OrderedItem[] } {
  const i = Math.max(0, Math.min(items.length, index))
  const prev = i > 0 ? (items[i - 1] as OrderedItem).order : null
  const next = i < items.length ? (items[i] as OrderedItem).order : null
  const slot = orderBetween(prev, next)

  if (slot !== null) {
    const fileName = buildName(slot, rest)
    const inserted = [...items]
    inserted.splice(i, 0, { fileName, order: slot, rest })
    return { fileName, renames: [], renumbered: false, items: inserted }
  }

  // 挤不下 → 先整段重排，再在重排后的序列里插入
  const spaced = renumberAll(items)
  const prev2 = i > 0 ? (spaced.items[i - 1] as OrderedItem).order : null
  const next2 = i < spaced.items.length ? (spaced.items[i] as OrderedItem).order : null
  const slot2 = orderBetween(prev2, next2) as number
  const fileName = buildName(slot2, rest)
  const inserted = [...spaced.items]
  inserted.splice(i, 0, { fileName, order: slot2, rest })

  return { fileName, renames: spaced.renames, renumbered: true, items: inserted }
}
