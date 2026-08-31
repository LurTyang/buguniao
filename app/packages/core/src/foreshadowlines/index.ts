/**
 * 伏笔连线的布局。
 *
 * 规范：更新文档/05-功能模块详述.md §5.4
 *
 * 作者当初的原话：「希望在大纲列表可以看到伏笔连线……或许做个开关最好？」
 *
 * 一条伏笔就是一段区间：从**埋**的那一章拉到**收**的那一章。
 * 几十条伏笔叠在一起，光按顺序画会糊成一片，
 * 所以要分泳道 —— 互不重叠的伏笔可以共用一条道。
 *
 * ─────────────────────────────────────────────────────────────
 * 【没收的伏笔怎么画】
 *
 * 这才是作者最想看见的东西：**埋了八十章还没收的那几条**。
 * 所以它们不能不画，而是画成一条虚线一直拖到最后一章 ——
 * 拖得越长越扎眼，这正是目的。
 * ─────────────────────────────────────────────────────────────
 */

import type { Foreshadow, ForeshadowPriority, ForeshadowStatus } from '../types/index.js'

export interface ChapterRef {
  id: string
  title: string
}

export interface ForeshadowArc {
  id: string
  title: string
  status: ForeshadowStatus
  priority: ForeshadowPriority
  /** 埋点章节序号（0 基）。找不到埋点时为 null */
  from: number | null
  /**
   * 回收章节序号。多处回收取**最后一次** ——
   * 作者关心的是「这条线到哪儿才算真的收干净」。
   */
  to: number | null
  /** 还没收。线画成虚线拖到末尾 */
  open: boolean
  /** 计划回收章节序号，作者填了 expectBy 才有 */
  expect: number | null
  /** 【关键】已经超过计划回收章节了 */
  overdue: boolean
  /** 跨了多少章 */
  span: number
  /** 第几条泳道，从 0 起 */
  lane: number
  fromTitle: string
  toTitle: string
}

export interface ForeshadowLines {
  arcs: ForeshadowArc[]
  chapters: ChapterRef[]
  /** 一共用了几条泳道。界面按它算宽度 */
  lanes: number
}

/**
 * 把伏笔排成互不重叠的泳道。
 *
 * 贪心：按起点排序，每条线塞进**第一条放得下的道**。
 * 这不是最优解（最优是区间图着色，没必要），但保证了
 * 「同一条道上的线绝不重叠」，看图时不会把两条线当成一条。
 */
export function layoutForeshadowLines(
  foreshadows: readonly Foreshadow[],
  chapters: readonly ChapterRef[],
): ForeshadowLines {
  const indexOf = new Map(chapters.map((c, i) => [c.id, i]))
  const last = Math.max(0, chapters.length - 1)

  const raw = foreshadows.map((f) => {
    const from = f.plantedIn !== null ? (indexOf.get(f.plantedIn) ?? null) : null

    // 多处回收取最后一次
    const recovered = f.recoveredIn
      .map((id) => indexOf.get(id))
      .filter((v): v is number => v !== undefined)
    const to = recovered.length > 0 ? Math.max(...recovered) : null

    const expect = f.expectBy !== null ? (indexOf.get(f.expectBy) ?? null) : null
    const open = f.status !== 'recovered' || to === null

    // 线实际占据的区间。没收的拖到最后一章
    const start = from ?? to ?? 0
    const end = open ? last : (to ?? start)

    return {
      f,
      from,
      to,
      expect,
      open,
      start: Math.min(start, end),
      end: Math.max(start, end),
    }
  })

  // 起点相同时，长的排在前面 —— 长线在外侧，短线在内侧，读起来更像树
  raw.sort((a, b) => a.start - b.start || b.end - a.end || a.f.id.localeCompare(b.f.id))

  /** 每条泳道目前占到哪一章 */
  const laneEnd: number[] = []
  const arcs: ForeshadowArc[] = []

  for (const r of raw) {
    let lane = laneEnd.findIndex((e) => e < r.start)
    if (lane === -1) {
      lane = laneEnd.length
      laneEnd.push(r.end)
    } else {
      laneEnd[lane] = r.end
    }

    arcs.push({
      id: r.f.id,
      title: r.f.title,
      status: r.f.status,
      priority: r.f.priority,
      from: r.from,
      to: r.to,
      open: r.open,
      expect: r.expect,
      // 超期：计划在第 N 章收，现在已经过了第 N 章还没收
      overdue: r.open && r.expect !== null && last > r.expect,
      span: r.end - r.start,
      lane,
      fromTitle: r.from !== null ? (chapters[r.from]?.title ?? '') : '',
      toTitle: r.to !== null ? (chapters[r.to]?.title ?? '') : '',
    })
  }

  return { arcs, chapters: [...chapters], lanes: laneEnd.length }
}

/** 某一章上有哪些伏笔经过。点章节时用来高亮 */
export function arcsAtChapter(lines: ForeshadowLines, index: number): ForeshadowArc[] {
  const last = Math.max(0, lines.chapters.length - 1)
  return lines.arcs.filter((a) => {
    const start = a.from ?? a.to ?? 0
    const end = a.open ? last : (a.to ?? start)
    return index >= Math.min(start, end) && index <= Math.max(start, end)
  })
}
