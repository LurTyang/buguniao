import { describe, it, expect } from 'vitest'
import type { Foreshadow } from '../types/index.js'
import { arcsAtChapter, layoutForeshadowLines, type ChapterRef } from './index.js'

const chapters: ChapterRef[] = Array.from({ length: 10 }, (_, i) => ({
  id: `c${i}`,
  title: `第${i + 1}章`,
}))

const fs = (over: Partial<Foreshadow>): Foreshadow => ({
  id: 'f1',
  title: '玉佩',
  desc: '',
  plantedIn: 'c0',
  expectBy: null,
  status: 'planted',
  priority: 'normal',
  recoveredIn: [],
  updatedAt: 0,
  ...over,
})

describe('区间', () => {
  it('埋点与回收点换成章节序号', () => {
    const l = layoutForeshadowLines([fs({ plantedIn: 'c1', recoveredIn: ['c4'], status: 'recovered' })], chapters)
    expect(l.arcs[0]).toMatchObject({ from: 1, to: 4, open: false, span: 3 })
  })

  it('多处回收取最后一次', () => {
    const l = layoutForeshadowLines(
      [fs({ plantedIn: 'c0', recoveredIn: ['c2', 'c6', 'c4'], status: 'recovered' })],
      chapters,
    )
    expect(l.arcs[0]!.to).toBe(6)
  })

  it('【关键】没收的伏笔拖到最后一章，越长越扎眼', () => {
    // 埋了八十章还没收的那几条，正是作者最想看见的
    const l = layoutForeshadowLines([fs({ plantedIn: 'c0' })], chapters)
    expect(l.arcs[0]!.open).toBe(true)
    expect(l.arcs[0]!.span).toBe(9)
  })

  it('标着回收但没有回收章节的，仍然算没收', () => {
    const l = layoutForeshadowLines([fs({ status: 'recovered', recoveredIn: [] })], chapters)
    expect(l.arcs[0]!.open).toBe(true)
  })

  it('带上章节标题，界面不用再查一遍', () => {
    const l = layoutForeshadowLines([fs({ plantedIn: 'c2', recoveredIn: ['c5'], status: 'recovered' })], chapters)
    expect(l.arcs[0]).toMatchObject({ fromTitle: '第3章', toTitle: '第6章' })
  })

  it('埋点章节被删掉时 from 为 null，不炸', () => {
    const l = layoutForeshadowLines([fs({ plantedIn: '没这章' })], chapters)
    expect(l.arcs[0]!.from).toBeNull()
  })
})

describe('超期', () => {
  it('【关键】过了计划回收的章还没收 —— 标成超期', () => {
    const l = layoutForeshadowLines([fs({ plantedIn: 'c0', expectBy: 'c3' })], chapters)
    expect(l.arcs[0]!.overdue).toBe(true)
  })

  it('还没到计划章不算超期', () => {
    const short: ChapterRef[] = chapters.slice(0, 3)
    const l = layoutForeshadowLines([fs({ plantedIn: 'c0', expectBy: 'c2' })], short)
    expect(l.arcs[0]!.overdue).toBe(false)
  })

  it('已经收了的不算超期', () => {
    const l = layoutForeshadowLines(
      [fs({ plantedIn: 'c0', expectBy: 'c3', recoveredIn: ['c9'], status: 'recovered' })],
      chapters,
    )
    expect(l.arcs[0]!.overdue).toBe(false)
  })

  it('没填计划章就不判超期', () => {
    const l = layoutForeshadowLines([fs({ plantedIn: 'c0' })], chapters)
    expect(l.arcs[0]!.expect).toBeNull()
    expect(l.arcs[0]!.overdue).toBe(false)
  })
})

describe('泳道', () => {
  const rec = (id: string, from: string, to: string): Foreshadow =>
    fs({ id, plantedIn: from, recoveredIn: [to], status: 'recovered' })

  it('【关键】重叠的伏笔分到不同泳道，不会叠成一条', () => {
    const l = layoutForeshadowLines([rec('a', 'c0', 'c5'), rec('b', 'c2', 'c7')], chapters)
    expect(l.arcs[0]!.lane).not.toBe(l.arcs[1]!.lane)
    expect(l.lanes).toBe(2)
  })

  it('不重叠的伏笔共用一条泳道', () => {
    const l = layoutForeshadowLines([rec('a', 'c0', 'c2'), rec('b', 'c4', 'c6')], chapters)
    expect(l.arcs[0]!.lane).toBe(l.arcs[1]!.lane)
    expect(l.lanes).toBe(1)
  })

  it('刚好首尾相接的算不重叠', () => {
    const l = layoutForeshadowLines([rec('a', 'c0', 'c2'), rec('b', 'c3', 'c5')], chapters)
    expect(l.lanes).toBe(1)
  })

  it('三条互相重叠就用三条道', () => {
    const l = layoutForeshadowLines(
      [rec('a', 'c0', 'c8'), rec('b', 'c1', 'c9'), rec('c', 'c2', 'c7')],
      chapters,
    )
    expect(l.lanes).toBe(3)
  })

  it('起点相同时长的排前面', () => {
    const l = layoutForeshadowLines([rec('短', 'c0', 'c1'), rec('长', 'c0', 'c8')], chapters)
    expect(l.arcs[0]!.id).toBe('长')
  })

  it('没收的那些会占满右半边，把后面的挤到别的道', () => {
    const l = layoutForeshadowLines([fs({ id: 'open', plantedIn: 'c0' }), rec('b', 'c5', 'c7')], chapters)
    expect(l.arcs[0]!.lane).not.toBe(l.arcs[1]!.lane)
  })
})

describe('arcsAtChapter', () => {
  const l = layoutForeshadowLines(
    [
      fs({ id: 'a', plantedIn: 'c1', recoveredIn: ['c4'], status: 'recovered' }),
      fs({ id: 'b', plantedIn: 'c6' }),
    ],
    chapters,
  )

  it('区间内的算经过', () => {
    expect(arcsAtChapter(l, 2).map((a) => a.id)).toEqual(['a'])
  })

  it('端点也算', () => {
    expect(arcsAtChapter(l, 1).map((a) => a.id)).toEqual(['a'])
    expect(arcsAtChapter(l, 4).map((a) => a.id)).toEqual(['a'])
  })

  it('区间外的不算', () => {
    expect(arcsAtChapter(l, 5).map((a) => a.id)).toEqual([])
  })

  it('没收的一直算到最后', () => {
    expect(arcsAtChapter(l, 9).map((a) => a.id)).toEqual(['b'])
  })
})

describe('边界情况', () => {
  it('没有伏笔时是空的', () => {
    expect(layoutForeshadowLines([], chapters)).toMatchObject({ arcs: [], lanes: 0 })
  })

  it('没有章节时不炸', () => {
    const l = layoutForeshadowLines([fs({})], [])
    expect(l.arcs).toHaveLength(1)
    expect(l.arcs[0]!.from).toBeNull()
  })

  it('章节列表原样带回去，界面画坐标轴要用', () => {
    expect(layoutForeshadowLines([], chapters).chapters).toHaveLength(10)
  })
})
