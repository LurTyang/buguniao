/**
 * 伏笔连线图。
 *
 * 规范：更新文档/05-功能模块详述.md §5.4
 *
 * 左边是章节名（从上往下就是全书顺序），右边每条伏笔一条线：
 * 从**埋**的那一章拉到**收**的那一章。
 *
 * 没收的画成虚线一直拖到底 —— 拖得越长越扎眼，这正是目的：
 * **埋了八十章还没收的那几条，一眼就能看见。**
 *
 * 坐标和泳道都是 `core/foreshadowlines` 算好的，这里只管画。
 */

import { useMemo, useState } from 'react'
import { layoutForeshadowLines, type Foreshadow } from '@bugu/core'

const ROW_H = 22
const LANE_W = 14
const LABEL_W = 132

export function ForeshadowLines({
  foreshadows,
  chapters,
  onJump,
}: {
  foreshadows: Foreshadow[]
  chapters: Array<{ id: string; title: string }>
  onJump(chapterId: string): void
}) {
  const [hover, setHover] = useState<string | null>(null)
  const lines = useMemo(() => layoutForeshadowLines(foreshadows, chapters), [foreshadows, chapters])

  if (chapters.length === 0) return <div className="empty-hint">这本书还没有章节。</div>
  if (lines.arcs.length === 0) {
    return (
      <div className="empty-hint">
        还没有伏笔。
        <br />
        在正文里选中一段，按 Ctrl+E 埋一个。
      </div>
    )
  }

  const height = chapters.length * ROW_H
  const laneArea = Math.max(1, lines.lanes) * LANE_W + 12
  const width = LABEL_W + laneArea

  const yOf = (i: number) => i * ROW_H + ROW_H / 2
  const last = chapters.length - 1

  return (
    <div className="fl-wrap">
      <div className="fs-hint">
        {lines.arcs.length} 条伏笔 · 虚线 = 还没收，拖到底表示一直悬着
      </div>

      <div className="fl-scroll">
        <svg width={width} height={height + 8}>
          {/* 章节名。点一下跳过去 */}
          <g className="fl-chapters">
            {chapters.map((c, i) => (
              <g key={c.id} onClick={() => onJump(c.id)} className="fl-chapter">
                <rect x={0} y={i * ROW_H} width={LABEL_W} height={ROW_H} />
                <text x={4} y={yOf(i) + 4}>
                  {c.title.length > 11 ? `${c.title.slice(0, 10)}…` : c.title}
                </text>
              </g>
            ))}
          </g>

          <g className="fl-arcs">
            {lines.arcs.map((a) => {
              const startIdx = a.from ?? a.to ?? 0
              const endIdx = a.open ? last : (a.to ?? startIdx)
              const x = LABEL_W + 8 + a.lane * LANE_W
              const y1 = yOf(Math.min(startIdx, endIdx))
              const y2 = yOf(Math.max(startIdx, endIdx))
              const on = hover === a.id
              return (
                <g
                  key={a.id}
                  className={
                    'fl-arc' +
                    (a.open ? ' open' : '') +
                    (a.overdue ? ' overdue' : '') +
                    (a.priority === 'high' ? ' high' : '') +
                    (on ? ' lit' : '')
                  }
                  onMouseEnter={() => setHover(a.id)}
                  onMouseLeave={() => setHover(null)}
                >
                  {/* 竖线本体 */}
                  <line x1={x} y1={y1} x2={x} y2={y2} />
                  {/* 埋点：实心方块 */}
                  {a.from !== null && <rect x={x - 3} y={yOf(a.from) - 3} width={6} height={6} />}
                  {/* 回收点：空心圆 */}
                  {a.to !== null && !a.open && <circle cx={x} cy={yOf(a.to)} r={3.5} />}
                  {/* 加宽的透明命中区，不然 1px 的线根本点不中 */}
                  <line className="fl-hit" x1={x} y1={y1} x2={x} y2={y2} />
                  <title>
                    {a.title}
                    {a.from !== null ? `　埋：${a.fromTitle}` : ''}
                    {a.to !== null && !a.open ? `　收：${a.toTitle}` : ''}
                    {a.open ? `　还没收（已经过去 ${a.span} 章）` : ''}
                    {a.overdue ? '　已超过计划回收的章节' : ''}
                  </title>
                </g>
              )
            })}
          </g>
        </svg>
      </div>

      {hover && (
        <div className="fl-tip">
          {lines.arcs.find((a) => a.id === hover)?.title}
          {(() => {
            const a = lines.arcs.find((x) => x.id === hover)
            if (!a) return null
            return (
              <span className="faint">
                {a.from !== null && `　埋于 ${a.fromTitle}`}
                {a.open ? `　还没收，已经过去 ${a.span} 章` : `　收于 ${a.toTitle}`}
                {a.overdue && '　⚠ 超过计划'}
              </span>
            )
          })()}
        </div>
      )}
    </div>
  )
}
