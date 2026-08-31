/**
 * 分支节点图的布局。
 *
 * 规范：更新文档/05-功能模块详述.md §14.1
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么布局算法要放在 core 里】
 *
 * 「哪个节点摆在哪」是纯计算，而且**很容易悄悄算错**：
 * 环状跳转把层数算成无穷、孤儿节点被摆到画布外面、
 * 两条线叠在一起看不出是两条 —— 这些用眼睛看图是发现不了的，
 * 得靠测试盯着。渲染层只负责把算好的坐标画成 SVG。
 * ─────────────────────────────────────────────────────────────
 *
 * 布局方式：**从上往下分层**。
 * 层号 = 从起点走过来的最短步数，同一层的节点横着排开。
 * 剧情是往下推进的，这个方向读起来最顺。
 */

import { ENDING_NAMES, type GameNode } from '../gamescript/index.js'

export interface LayoutNode {
  name: string
  /** 第几层，从 0 起 */
  layer: number
  /** 层内第几个 */
  index: number
  x: number
  y: number
  /** 起点 */
  start: boolean
  /** 只有标题、还没写内容 */
  stub: boolean
  /** 从起点走不到 */
  unreachable: boolean
  /** 结局节点（`-> 结束` 落到的那个，图上是虚拟的） */
  ending: boolean
  /** 真实文档里的位置。虚拟结局节点没有 */
  docPath: string | null
  line: number
}

export interface LayoutEdge {
  from: string
  to: string
  /** 选项文字，直接跳转时为空 */
  label: string
  /** 条件原文，没有条件时为空 */
  condition: string
  /** 往回跳（目标层号 <= 起点层号）。画成虚线，不然图上会绕一大圈 */
  backward: boolean
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface GraphLayout {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  width: number
  height: number
  /** 有几层 */
  layers: number
}

export interface LayoutOptions {
  /** 一个节点占多宽 */
  nodeWidth?: number
  nodeHeight?: number
  /** 横向、纵向间距 */
  gapX?: number
  gapY?: number
  /** 从起点走得到的节点。传了才知道哪些是走不到的 */
  reachable?: ReadonlySet<string>
  start?: string | null
}

const DEFAULTS = { nodeWidth: 116, nodeHeight: 34, gapX: 26, gapY: 62 }

/**
 * 算出每个节点该摆在哪。
 *
 * 层号用广度优先算最短距离。**环状跳转不会让它转不出来** ——
 * 已经排过层的节点不再重排，往回跳的边单独标出来画成虚线。
 *
 * 走不到的节点排在所有可达节点的下面，单独成层 ——
 * 它们本来就该显眼，那是作者要修的东西。
 */
export function layoutGameGraph(
  nodes: readonly GameNode[],
  opts: LayoutOptions = {},
): GraphLayout {
  const o = { ...DEFAULTS, ...opts }
  const start = opts.start ?? nodes[0]?.name ?? null

  const byName = new Map<string, GameNode>()
  for (const n of nodes) if (!byName.has(n.name)) byName.set(n.name, n)

  // 结局是虚拟节点：`-> 结束` 得有个地方落
  const endingTargets = new Set<string>()
  for (const n of nodes) {
    for (const e of n.exits) if (e.ending) endingTargets.add(e.target)
  }

  // ── 1. 分层 ──
  const layer = new Map<string, number>()
  if (start !== null && byName.has(start)) {
    layer.set(start, 0)
    const queue = [start]
    while (queue.length > 0) {
      const cur = queue.shift()!
      const node = byName.get(cur)
      if (!node) continue
      const next = (layer.get(cur) ?? 0) + 1
      for (const e of node.exits) {
        const t = e.target
        if (!byName.has(t) && !endingTargets.has(t)) continue // 断头路，图上不画
        if (layer.has(t)) continue // 已经排过：往回跳或者更短的路已经算过
        layer.set(t, next)
        if (byName.has(t)) queue.push(t)
      }
    }
  }

  const reachable = opts.reachable
  const maxReachableLayer = Math.max(-1, ...[...layer.values()])

  // 走不到的节点：排在最底下，一个一层太散，全塞进同一层
  const orphanLayer = maxReachableLayer + 2
  for (const n of nodes) {
    if (!layer.has(n.name)) layer.set(n.name, orphanLayer)
  }
  for (const t of endingTargets) {
    if (!layer.has(t)) layer.set(t, orphanLayer)
  }

  // ── 2. 层内排序：按父节点的平均位置排，减少连线交叉 ──
  const layers: string[][] = []
  for (const [name, l] of layer) {
    ;(layers[l] ??= []).push(name)
  }
  for (let i = 0; i < layers.length; i++) layers[i] ??= []

  const parents = new Map<string, string[]>()
  for (const n of nodes) {
    for (const e of n.exits) {
      if (!layer.has(e.target)) continue
      const list = parents.get(e.target)
      if (list) list.push(n.name)
      else parents.set(e.target, [n.name])
    }
  }

  const pos = new Map<string, number>()
  for (const [l, names] of layers.entries()) {
    if (l === 0) {
      names.forEach((n, i) => pos.set(n, i))
      continue
    }
    // 重心法：按父节点的平均横位置排。跑两遍够用了，
    // 追求最优是 NP 难的，而作者要的只是「线别绕成一团」
    const score = (n: string) => {
      const ps = (parents.get(n) ?? []).map((p) => pos.get(p)).filter((v): v is number => v !== undefined)
      return ps.length === 0 ? Number.MAX_SAFE_INTEGER : ps.reduce((a, b) => a + b, 0) / ps.length
    }
    names.sort((a, b) => score(a) - score(b) || a.localeCompare(b))
    names.forEach((n, i) => pos.set(n, i))
  }

  // ── 3. 坐标 ──
  const widest = Math.max(1, ...layers.map((l) => l.length))
  const stepX = o.nodeWidth + o.gapX
  const stepY = o.nodeHeight + o.gapY
  const width = widest * stepX

  const out: LayoutNode[] = []
  for (const [l, names] of layers.entries()) {
    // 每层居中摆
    const offset = (width - names.length * stepX) / 2
    names.forEach((name, i) => {
      const node = byName.get(name)
      out.push({
        name,
        layer: l,
        index: i,
        x: offset + i * stepX + o.nodeWidth / 2,
        y: l * stepY + o.nodeHeight / 2,
        start: name === start,
        stub: node ? !node.written : false,
        unreachable: reachable ? !reachable.has(name) && !ENDING_NAMES.has(name) : false,
        ending: !node && (endingTargets.has(name) || ENDING_NAMES.has(name)),
        docPath: node?.docPath ?? null,
        line: node?.line ?? 0,
      })
    })
  }

  const xy = new Map(out.map((n) => [n.name, n]))

  const edges: LayoutEdge[] = []
  for (const n of nodes) {
    const a = xy.get(n.name)
    if (!a) continue
    for (const e of n.exits) {
      const b = xy.get(e.target)
      if (!b) continue // 断头路：图上不画，体检那边会报
      edges.push({
        from: n.name,
        to: e.target,
        label: e.label,
        condition: e.condition?.raw ?? '',
        backward: b.layer <= a.layer,
        x1: a.x,
        y1: a.y + o.nodeHeight / 2,
        x2: b.x,
        y2: b.y - o.nodeHeight / 2,
      })
    }
  }

  return {
    nodes: out,
    edges,
    width,
    height: Math.max(1, layers.length) * stepY,
    layers: layers.length,
  }
}
