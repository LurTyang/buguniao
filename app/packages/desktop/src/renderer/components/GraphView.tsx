/**
 * 分支节点图。
 *
 * 规范：更新文档/05-功能模块详述.md §14.1
 *
 * 坐标全是 `core/graphlayout` 算好的，这里只负责画成 SVG ——
 * 「哪个节点摆在哪」很容易悄悄算错，那部分有测试盯着。
 *
 * 画法上的几个决定：
 *   - **往回跳画虚线**。实线画回去会绕一大圈，图立刻变成一团毛线
 *   - 选项文字只在**线不多**或**鼠标悬停**时显示，否则字会糊成一片
 *   - 走不到的节点用红框，空壳用虚线框 —— 那都是作者要修的东西
 */

import { useMemo, useState } from 'react'
import { layoutGameGraph, type GameNode } from '@bugu/core'

/** 线多到这个数以上就不常驻显示选项文字了 */
const LABEL_LIMIT = 18

const NODE_W = 116
const NODE_H = 34

export function GraphView({
  nodes,
  reachable,
  start,
  onPick,
}: {
  nodes: GameNode[]
  reachable: string[]
  start: string | null
  onPick(docPath: string, line: number): void
}) {
  const [hover, setHover] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)

  const layout = useMemo(
    () =>
      layoutGameGraph(nodes, {
        reachable: new Set(reachable),
        start,
        nodeWidth: NODE_W,
        nodeHeight: NODE_H,
      }),
    [nodes, reachable, start],
  )

  if (layout.nodes.length === 0) return <div className="empty-hint">还没有节点。</div>

  const pad = 24
  const showLabels = layout.edges.length <= LABEL_LIMIT

  /** 和某个节点相连的线要高亮 —— 图一大，看清「这个节点通向哪」全靠它 */
  const lit = (from: string, to: string) => hover !== null && (from === hover || to === hover)

  return (
    <div className="graph-wrap">
      <div className="graph-toolbar">
        <button onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))} title="缩小">
          −
        </button>
        <span className="faint">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(2, z + 0.15))} title="放大">
          ＋
        </button>
        <span className="faint graph-hint">
          {layout.nodes.length} 个节点 · {layout.edges.length} 条线 · 点节点跳到正文
        </span>
      </div>

      <div className="graph-scroll">
        <svg
          width={(layout.width + pad * 2) * zoom}
          height={(layout.height + pad * 2) * zoom}
          viewBox={`${-pad} ${-pad} ${layout.width + pad * 2} ${layout.height + pad * 2}`}
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
            </marker>
          </defs>

          <g className="graph-edges">
            {layout.edges.map((e, i) => {
              // 贝塞尔的控制点拉在两端的中间高度，线就顺着往下走，
              // 不会在节点之间拐直角
              const midY = (e.y1 + e.y2) / 2
              const d = e.backward
                ? // 往回跳：从旁边绕出去一点，免得和正向的线重叠成一条
                  `M ${e.x1} ${e.y1} C ${e.x1 + 70} ${e.y1 + 24}, ${e.x2 + 70} ${e.y2 - 24}, ${e.x2} ${e.y2}`
                : `M ${e.x1} ${e.y1} C ${e.x1} ${midY}, ${e.x2} ${midY}, ${e.x2} ${e.y2}`
              return (
                <g
                  key={i}
                  className={`graph-edge${e.backward ? ' back' : ''}${lit(e.from, e.to) ? ' lit' : ''}`}
                >
                  <path d={d} markerEnd="url(#arrow)" />
                  {(showLabels || lit(e.from, e.to)) && (e.label || e.condition) && (
                    <text x={(e.x1 + e.x2) / 2} y={midY} textAnchor="middle">
                      {e.condition && <tspan className="graph-cond">{`{${e.condition}} `}</tspan>}
                      {e.label}
                    </text>
                  )}
                </g>
              )
            })}
          </g>

          <g className="graph-nodes">
            {layout.nodes.map((n) => (
              <g
                key={n.name}
                className={
                  'graph-node' +
                  (n.start ? ' start' : '') +
                  (n.ending ? ' ending' : '') +
                  (n.stub ? ' stub' : '') +
                  (n.unreachable ? ' bad' : '') +
                  (hover === n.name ? ' hover' : '')
                }
                transform={`translate(${n.x - NODE_W / 2}, ${n.y - NODE_H / 2})`}
                onMouseEnter={() => setHover(n.name)}
                onMouseLeave={() => setHover(null)}
                onClick={() => n.docPath && onPick(n.docPath, n.line)}
              >
                <rect width={NODE_W} height={NODE_H} rx={n.ending ? NODE_H / 2 : 6} />
                <text x={NODE_W / 2} y={NODE_H / 2 + 4} textAnchor="middle">
                  {n.name.length > 8 ? `${n.name.slice(0, 7)}…` : n.name}
                </text>
                <title>
                  {n.name}
                  {n.start ? '（起点）' : ''}
                  {n.ending ? '（结局）' : ''}
                  {n.stub ? '　还没写内容' : ''}
                  {n.unreachable ? '　从起点走不到' : ''}
                </title>
              </g>
            ))}
          </g>
        </svg>
      </div>

      <div className="graph-legend">
        <span className="lg lg-start">起点</span>
        <span className="lg lg-normal">写了</span>
        <span className="lg lg-stub">空壳</span>
        <span className="lg lg-bad">走不到</span>
        <span className="lg lg-ending">结局</span>
        <span className="faint">虚线 = 往回跳</span>
      </div>
    </div>
  )
}
