/**
 * 图表。
 *
 * 只有两种：**日字数折线**（随时间变化）与**年度热力图**（日历上的量级）。
 * 两者都是单序列，所以都属于「sequential —— 一个色相，浅到深」，
 * 不需要图例（标题已经说明了画的是什么）。
 *
 * 深色模式的色阶是**另选的一组**，不是把浅色那组反过来 ——
 * 直接反转会让最深的一档在深色背景上糊成一团。
 *
 * 线宽 2px、坐标轴与网格保持克制、只在少数点上直接标数字（不是每个点都标），
 * 悬停时给十字线和读数。
 */

import { useMemo, useState } from 'react'
import { formatCount } from '@bugu/core'

// ───────────────────────── 日字数折线 ─────────────────────────

export interface LineChartProps {
  data: Array<{ day: string; words: number }>
  width: number
  height: number
  /** 日目标，画一条参考线；0 表示不画 */
  target?: number
  /** 紧凑模式：不画坐标轴文字，用于侧边栏的迷你曲线 */
  compact?: boolean
}

export function WordsLineChart({ data, width, height, target = 0, compact = false }: LineChartProps) {
  const [hover, setHover] = useState<number | null>(null)

  const pad = compact ? { t: 6, r: 4, b: 6, l: 4 } : { t: 12, r: 10, b: 22, l: 44 }
  const iw = Math.max(1, width - pad.l - pad.r)
  const ih = Math.max(1, height - pad.t - pad.b)

  const { max, points, area } = useMemo(() => {
    const maxWords = Math.max(1, target, ...data.map((d) => d.words))
    const x = (i: number) => pad.l + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw)
    const y = (w: number) => pad.t + ih - (Math.max(0, w) / maxWords) * ih

    const pts = data.map((d, i) => ({ ...d, cx: x(i), cy: y(d.words) }))
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' ')
    const fill =
      pts.length > 0
        ? `${line} L${pts[pts.length - 1]!.cx.toFixed(1)},${(pad.t + ih).toFixed(1)} L${pts[0]!.cx.toFixed(1)},${(pad.t + ih).toFixed(1)} Z`
        : ''
    return { max: maxWords, points: pts, line, area: fill }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, width, height, target, compact])

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' ')
  const active = hover !== null ? points[hover] : null

  if (data.length === 0) return <div className="chart-empty">还没有数据</div>

  return (
    <div className="chart-wrap" style={{ height }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="每日字数曲线"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const rel = e.clientX - rect.left - pad.l
          const i = Math.round((rel / iw) * (data.length - 1))
          setHover(Math.max(0, Math.min(data.length - 1, i)))
        }}
      >
        {!compact && (
          <>
            {/* 网格与刻度保持克制：两条线足够读出量级 */}
            {[0, 0.5, 1].map((f) => {
              const y = pad.t + ih - f * ih
              return (
                <g key={f}>
                  <line x1={pad.l} x2={pad.l + iw} y1={y} y2={y} className="chart-grid" />
                  <text x={pad.l - 6} y={y + 3} textAnchor="end" className="chart-tick">
                    {formatCount(Math.round(max * f))}
                  </text>
                </g>
              )
            })}
          </>
        )}

        {target > 0 && target <= max && (
          <line
            x1={pad.l}
            x2={pad.l + iw}
            y1={pad.t + ih - (target / max) * ih}
            y2={pad.t + ih - (target / max) * ih}
            className="chart-target"
          />
        )}

        <path d={area} className="chart-area" />
        <path d={linePath} className="chart-line" />

        {active && (
          <>
            <line
              x1={active.cx}
              x2={active.cx}
              y1={pad.t}
              y2={pad.t + ih}
              className="chart-crosshair"
            />
            <circle cx={active.cx} cy={active.cy} r={4} className="chart-dot" />
          </>
        )}
      </svg>

      {active && (
        <div
          className="chart-tip"
          style={{
            left: Math.min(Math.max(0, active.cx - 50), Math.max(0, width - 100)),
          }}
        >
          <b>{formatCount(active.words)}</b> 字 · {active.day.slice(5)}
        </div>
      )}
    </div>
  )
}

// ───────────────────────── 年度热力图 ─────────────────────────

export interface HeatmapProps {
  /** 按日期升序，且已经补齐了空白日 */
  cells: Array<{ day: string; words: number; level: number; state: string }>
  cell?: number
  gap?: number
}

const WEEKDAY_LABELS = ['一', '', '三', '', '五', '', '日']

export function YearHeatmap({ cells, cell = 11, gap = 3 }: HeatmapProps) {
  const [hover, setHover] = useState<number | null>(null)
  if (cells.length === 0) return <div className="chart-empty">还没有数据</div>

  // 按周分列：第一列可能不满，用空格占位对齐星期
  const firstDow = (new Date(`${cells[0]!.day}T00:00:00`).getDay() + 6) % 7 // 周一=0
  const slots: Array<{ i: number } | null> = [
    ...Array.from({ length: firstDow }, () => null),
    ...cells.map((_, i) => ({ i })),
  ]
  const weeks = Math.ceil(slots.length / 7)

  const labelW = 16
  const width = labelW + weeks * (cell + gap)
  const height = 7 * (cell + gap) + 16

  const monthMarks: Array<{ x: number; label: string }> = []
  let lastMonth = ''
  slots.forEach((slot, idx) => {
    if (!slot) return
    const m = cells[slot.i]!.day.slice(0, 7)
    if (m !== lastMonth && idx % 7 <= 2) {
      lastMonth = m
      monthMarks.push({
        x: labelW + Math.floor(idx / 7) * (cell + gap),
        label: `${Number(m.slice(5))}月`,
      })
    }
  })

  const active = hover !== null ? cells[hover] : null

  return (
    <div className="chart-wrap heat-wrap">
      <svg width={width} height={height} role="img" aria-label="年度写作热力图">
        {monthMarks.map((m) => (
          <text key={m.x} x={m.x} y={9} className="chart-tick">
            {m.label}
          </text>
        ))}
        {WEEKDAY_LABELS.map((label, r) =>
          label ? (
            <text key={r} x={0} y={16 + r * (cell + gap) + cell - 1} className="chart-tick">
              {label}
            </text>
          ) : null,
        )}

        {slots.map((slot, idx) => {
          if (!slot) return null
          const c = cells[slot.i]!
          const col = Math.floor(idx / 7)
          const row = idx % 7
          return (
            <rect
              key={idx}
              x={labelW + col * (cell + gap)}
              y={16 + row * (cell + gap)}
              width={cell}
              height={cell}
              rx={2}
              className={`heat-cell lv-${c.level}${c.state === 'makeup' ? ' makeup' : ''}`}
              onMouseEnter={() => setHover(slot.i)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${c.day}　${formatCount(c.words)} 字${c.state === 'makeup' ? '（补签）' : ''}`}</title>
            </rect>
          )
        })}
      </svg>

      <div className="heat-legend">
        <span className="faint">少</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <i key={l} className={`heat-cell lv-${l}`} />
        ))}
        <span className="faint">多</span>
        <span className="heat-legend-note faint">虚线框 = 补签</span>
      </div>

      {active && (
        <div className="chart-tip static">
          {active.day}　<b>{formatCount(active.words)}</b> 字
          {active.state === 'makeup' && '　（补签）'}
        </div>
      )}
    </div>
  )
}

// ───────────────────────── 柱状（周/月） ─────────────────────────

export function BarChart({
  data,
  width,
  height,
}: {
  data: Array<{ label: string; words: number }>
  width: number
  height: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  if (data.length === 0) return <div className="chart-empty">还没有数据</div>

  const pad = { t: 10, r: 8, b: 20, l: 44 }
  const iw = Math.max(1, width - pad.l - pad.r)
  const ih = Math.max(1, height - pad.t - pad.b)
  const max = Math.max(1, ...data.map((d) => d.words))
  const step = iw / data.length
  // 2px 的间隙让相邻柱子分开，不糊在一起
  const bw = Math.max(2, step - 2)

  return (
    <div className="chart-wrap" style={{ height }}>
      <svg width={width} height={height} role="img" aria-label="字数柱状图">
        {[0, 0.5, 1].map((f) => {
          const y = pad.t + ih - f * ih
          return (
            <g key={f}>
              <line x1={pad.l} x2={pad.l + iw} y1={y} y2={y} className="chart-grid" />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" className="chart-tick">
                {formatCount(Math.round(max * f))}
              </text>
            </g>
          )
        })}

        {data.map((d, i) => {
          const h = (Math.max(0, d.words) / max) * ih
          return (
            <rect
              key={d.label}
              x={pad.l + i * step + (step - bw) / 2}
              y={pad.t + ih - h}
              width={bw}
              height={Math.max(0, h)}
              rx={2}
              className={`chart-bar${hover === i ? ' on' : ''}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${d.label}　${formatCount(d.words)} 字`}</title>
            </rect>
          )
        })}
      </svg>

      {hover !== null && data[hover] && (
        <div className="chart-tip static">
          {data[hover]!.label}　<b>{formatCount(data[hover]!.words)}</b> 字
        </div>
      )}
    </div>
  )
}
