/**
 * 分支节点图布局测试。
 *
 * 用眼睛看图是发现不了下面这些的：环状跳转把层数算成无穷、
 * 孤儿节点被摆到画布外面、往回跳的边没被标出来。所以靠测试盯着。
 */

import { describe, it, expect } from 'vitest'
import { buildGraph, parseGameNodes, simulate, type SourceDoc } from '../gamescript/index.js'
import { layoutGameGraph } from './index.js'

const doc = (body: string): SourceDoc => ({ path: 'x.md', title: 'x', body })

const lay = (body: string) => {
  const nodes = parseGameNodes([doc(body)])
  const g = buildGraph(nodes)
  const sim = simulate(g)
  return layoutGameGraph(nodes, { reachable: sim.reachable, start: g.start })
}

const LINEAR = ['# 甲', '-> 乙', '', '# 乙', '-> 丙', '', '# 丙', '-> 结束'].join('\n')

const BRANCH = [
  '# 起点',
  '- 左 -> 左路',
  '- 右 -> 右路',
  '',
  '# 左路',
  '-> 汇合',
  '',
  '# 右路',
  '-> 汇合',
  '',
  '# 汇合',
  '-> 结束',
].join('\n')

describe('分层', () => {
  it('一条直线就是一层一个', () => {
    const l = lay(LINEAR)
    const layers = Object.fromEntries(l.nodes.map((n) => [n.name, n.layer]))
    expect(layers['甲']).toBe(0)
    expect(layers['乙']).toBe(1)
    expect(layers['丙']).toBe(2)
    expect(layers['结束']).toBe(3)
  })

  it('并排的分支在同一层', () => {
    const l = lay(BRANCH)
    const layers = Object.fromEntries(l.nodes.map((n) => [n.name, n.layer]))
    expect(layers['左路']).toBe(layers['右路'])
    expect(layers['左路']).toBe(1)
  })

  it('汇合点按最短路算层号', () => {
    const l = lay(BRANCH)
    expect(l.nodes.find((n) => n.name === '汇合')!.layer).toBe(2)
  })

  it('【关键】环状跳转不会转不出来', () => {
    const l = lay('# 甲\n-> 乙\n\n# 乙\n-> 甲')
    expect(l.nodes).toHaveLength(2)
    expect(l.nodes.every((n) => Number.isFinite(n.layer))).toBe(true)
  })

  it('往回跳的边被标出来了', () => {
    const l = lay('# 甲\n-> 乙\n\n# 乙\n-> 甲')
    const back = l.edges.find((e) => e.from === '乙' && e.to === '甲')
    expect(back?.backward).toBe(true)
  })

  it('往下走的边不算往回跳', () => {
    expect(lay(LINEAR).edges.every((e) => !e.backward)).toBe(true)
  })

  it('自己跳自己也算往回跳，不会崩', () => {
    const l = lay('# 甲\n- 再来一次 -> 甲\n- 走 -> 结束')
    expect(l.edges.find((e) => e.from === '甲' && e.to === '甲')?.backward).toBe(true)
  })
})

describe('孤儿与结局', () => {
  it('【关键】走不到的节点也在图上，而且被标出来', () => {
    // 摆到画布外面等于告诉作者「没这个节点」，那正是他要修的东西
    const l = lay('# 甲\n-> 结束\n\n# 没人来\n-> 结束')
    const orphan = l.nodes.find((n) => n.name === '没人来')
    expect(orphan).toBeTruthy()
    expect(orphan!.unreachable).toBe(true)
    expect(orphan!.y).toBeGreaterThan(0)
  })

  it('孤儿排在可达节点下面', () => {
    const l = lay('# 甲\n-> 乙\n\n# 乙\n-> 结束\n\n# 没人来\n-> 结束')
    const orphan = l.nodes.find((n) => n.name === '没人来')!
    const reach = l.nodes.filter((n) => !n.unreachable && !n.ending)
    expect(orphan.layer).toBeGreaterThan(Math.max(...reach.map((n) => n.layer)))
  })

  it('结局是虚拟节点，没有文件位置', () => {
    const e = lay(LINEAR).nodes.find((n) => n.name === '结束')!
    expect(e.ending).toBe(true)
    expect(e.docPath).toBeNull()
  })

  it('结局不会被当成走不到', () => {
    expect(lay(LINEAR).nodes.find((n) => n.name === '结束')!.unreachable).toBe(false)
  })

  it('真实节点带着文件与行号，点了才跳得过去', () => {
    const n = lay(LINEAR).nodes.find((x) => x.name === '乙')!
    expect(n.docPath).toBe('x.md')
    expect(n.line).toBeGreaterThan(0)
  })

  it('空壳节点被标出来', () => {
    const l = lay('# 甲\n李四：喂\n-> 乙\n\n# 乙\n-> 结束')
    expect(l.nodes.find((n) => n.name === '乙')!.stub).toBe(true)
    expect(l.nodes.find((n) => n.name === '甲')!.stub).toBe(false)
  })
})

describe('坐标', () => {
  it('同一层的节点 y 相同、x 不同', () => {
    const l = lay(BRANCH)
    const a = l.nodes.find((n) => n.name === '左路')!
    const b = l.nodes.find((n) => n.name === '右路')!
    expect(a.y).toBe(b.y)
    expect(a.x).not.toBe(b.x)
  })

  it('层越深 y 越大（从上往下推进）', () => {
    const l = lay(LINEAR)
    const ys = ['甲', '乙', '丙'].map((n) => l.nodes.find((x) => x.name === n)!.y)
    expect(ys[0]).toBeLessThan(ys[1]!)
    expect(ys[1]).toBeLessThan(ys[2]!)
  })

  it('每个节点都在画布里', () => {
    const l = lay(BRANCH)
    for (const n of l.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0)
      expect(n.x).toBeLessThanOrEqual(l.width)
      expect(n.y).toBeGreaterThanOrEqual(0)
      expect(n.y).toBeLessThanOrEqual(l.height)
    }
  })

  it('画布宽度按最宽的一层算', () => {
    const l = lay(BRANCH)
    expect(l.width).toBeGreaterThan(0)
    expect(l.layers).toBeGreaterThanOrEqual(4)
  })

  it('每层是居中摆的', () => {
    const l = lay(LINEAR)
    // 每层只有一个节点，所以都该在正中间
    const xs = new Set(l.nodes.map((n) => Math.round(n.x)))
    expect(xs.size).toBe(1)
  })

  it('节点尺寸可以自己定', () => {
    const nodes = parseGameNodes([doc(LINEAR)])
    const a = layoutGameGraph(nodes, { nodeWidth: 100, gapY: 10 })
    const b = layoutGameGraph(nodes, { nodeWidth: 200, gapY: 10 })
    expect(b.width).toBeGreaterThan(a.width)
  })
})

describe('连线', () => {
  it('每条出口一条线', () => {
    expect(lay(BRANCH).edges).toHaveLength(5)
  })

  it('线带着选项文字', () => {
    const e = lay(BRANCH).edges.find((x) => x.from === '起点' && x.to === '左路')!
    expect(e.label).toBe('左')
  })

  it('线带着条件', () => {
    const l = lay('# 甲\n- {好感度>=1} 走 -> 结束\n- 别走 -> 结束')
    expect(l.edges.find((e) => e.label === '走')!.condition).toBe('好感度>=1')
  })

  it('【关键】断头路不画线 —— 画一条通向虚空的线只会让人更糊涂', () => {
    const l = lay('# 甲\n-> 没这个节点')
    expect(l.edges).toEqual([])
  })

  it('线从上一个节点的底边连到下一个的顶边', () => {
    const l = lay(LINEAR)
    const e = l.edges.find((x) => x.from === '甲')!
    const a = l.nodes.find((n) => n.name === '甲')!
    const b = l.nodes.find((n) => n.name === '乙')!
    expect(e.y1).toBeGreaterThan(a.y)
    expect(e.y2).toBeLessThan(b.y)
  })
})

describe('减少交叉', () => {
  it('两条分支不会交叉着画', () => {
    // 起点的两个出口分别去 甲/乙，甲的后继在左、乙的后继在右
    const body = [
      '# 起点',
      '- 一 -> 甲',
      '- 二 -> 乙',
      '',
      '# 甲',
      '-> 甲后',
      '',
      '# 乙',
      '-> 乙后',
      '',
      '# 甲后',
      '-> 结束',
      '',
      '# 乙后',
      '-> 结束',
    ].join('\n')
    const l = lay(body)
    const x = (n: string) => l.nodes.find((v) => v.name === n)!.x
    // 甲 在 乙 左边，那么 甲后 也该在 乙后 左边
    expect(x('甲') < x('乙')).toBe(x('甲后') < x('乙后'))
  })
})

describe('边界情况', () => {
  it('空图不炸', () => {
    const l = layoutGameGraph([])
    expect(l.nodes).toEqual([])
    expect(l.edges).toEqual([])
    expect(l.width).toBeGreaterThan(0)
  })

  it('只有一个节点', () => {
    const l = lay('# 独一个\n李四：喂')
    expect(l.nodes).toHaveLength(1)
    expect(l.nodes[0]!.layer).toBe(0)
  })

  it('没有起点时全部当孤儿排，不会丢节点', () => {
    const nodes = parseGameNodes([doc('# 甲\n-> 结束')])
    const l = layoutGameGraph(nodes, { start: '不存在的起点' })
    expect(l.nodes.map((n) => n.name)).toContain('甲')
  })

  it('同名节点只画一个，不重叠成一坨', () => {
    const nodes = parseGameNodes([
      { path: '一.md', title: '一', body: '# 甲\n-> 结束' },
      { path: '二.md', title: '二', body: '# 甲\n-> 结束' },
    ])
    const l = layoutGameGraph(nodes, { start: '甲' })
    expect(l.nodes.filter((n) => n.name === '甲')).toHaveLength(1)
  })
})
