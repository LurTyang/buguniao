/**
 * 块级条件与「从任意节点试玩」。
 *
 * 块条件最容易错的地方是**它挂在谁身上**：内容归内容，
 * 真正要判的是「这条出口走不走得到」「这次赋值算不算数」。
 * 挂错了的后果是作者以为某条分支能走，实际永远走不到 —— 反过来也一样。
 */

import { describe, it, expect } from 'vitest'
import {
  buildGraph,
  evalGuards,
  parseBlockMarker,
  parseGameNodes,
  simulate,
  type SourceDoc,
} from './index.js'

const doc = (body: string): SourceDoc => ({ path: 'x.md', title: 'x', body })
const nodesOf = (body: string) => parseGameNodes([doc(body)])
const graphOf = (body: string) => buildGraph(nodesOf(body))

describe('parseBlockMarker', () => {
  it('认得出三种标记', () => {
    expect(parseBlockMarker('$若 好感度>=3')?.kind).toBe('if')
    expect(parseBlockMarker('$否则')?.kind).toBe('else')
    expect(parseBlockMarker('$结束')?.kind).toBe('end')
  })

  it('英文写法也认', () => {
    expect(parseBlockMarker('$if 好感度>=3')?.kind).toBe('if')
    expect(parseBlockMarker('$else')?.kind).toBe('else')
    expect(parseBlockMarker('$end')?.kind).toBe('end')
  })

  it('「如果」也认', () => {
    expect(parseBlockMarker('$如果 拿到钥匙')?.kind).toBe('if')
  })

  it('普通的变量赋值不会被当成块标记', () => {
    expect(parseBlockMarker('$ 好感度 += 1')).toBeNull()
  })

  it('台词不会被当成块标记', () => {
    expect(parseBlockMarker('李四：$若无其事地走了')).toBeNull()
  })

  it('条件看不懂时 condition 为 null，但仍然认出这是个 $若', () => {
    const m = parseBlockMarker('$若 好感度 很高')
    expect(m?.kind).toBe('if')
    expect(m?.kind === 'if' && m.condition).toBeNull()
  })
})

describe('守卫挂在出口和赋值上', () => {
  const BODY = [
    '# 起点',
    '$ 好感度 = 3',
    '- 走 -> 门口',
    '',
    '# 门口',
    '$若 好感度>=3',
    '李四：其实我一直……',
    '- 回应 -> 表白',
    '$否则',
    '李四：……没什么。',
    '- 走开 -> 结束',
    '$结束',
    '- 都可以 -> 结束',
    '',
    '# 表白',
    '-> 结束',
  ].join('\n')

  const men = nodesOf(BODY).find((n) => n.name === '门口')!

  it('块里的出口带上了守卫', () => {
    const yes = men.exits.find((e) => e.label === '回应')!
    expect(yes.guards).toHaveLength(1)
    expect(yes.guards[0]!.variable).toBe('好感度')
  })

  it('【关键】$否则 那半边的守卫是取反的', () => {
    const no = men.exits.find((e) => e.label === '走开')!
    expect(no.guards).toHaveLength(1)
    expect(no.guards[0]!.negated).toBe(true)
  })

  it('块外面的出口没有守卫', () => {
    expect(men.exits.find((e) => e.label === '都可以')!.guards).toEqual([])
  })

  it('内容照算 —— 块不影响字数与「写没写」', () => {
    expect(men.written).toBe(true)
    expect(men.chars).toBeGreaterThan(0)
  })

  it('【关键】好感度够时走得到表白', () => {
    const sim = simulate(graphOf(BODY))
    expect(sim.reachable.has('表白')).toBe(true)
  })

  it('【关键】好感度不够时表白走不到', () => {
    const cold = BODY.replace('$ 好感度 = 3', '$ 好感度 = 0')
    const sim = simulate(graphOf(cold))
    expect(sim.reachable.has('表白')).toBe(false)
    expect(sim.unreachable).toContain('表白')
  })
})

describe('块里的赋值', () => {
  const BODY = [
    '# 起点',
    '$ 有钥匙 = 假',
    '$若 有钥匙',
    '$ 进屋 = 真',
    '$结束',
    '- 走 -> 终点',
    '',
    '# 终点',
    '- {进屋} 里面 -> 结束',
    '- 外面 -> 结束',
  ].join('\n')

  it('【关键】块条件不成立时，块里的赋值不生效', () => {
    const sim = simulate(graphOf(BODY))
    expect([...(sim.variableValues.get('进屋') ?? [])]).toEqual([])
  })

  it('块条件成立时才生效', () => {
    const sim = simulate(graphOf(BODY.replace('$ 有钥匙 = 假', '$ 有钥匙 = 真')))
    expect([...(sim.variableValues.get('进屋') ?? [])]).toContain('true')
  })
})

describe('嵌套与写坏了的块', () => {
  it('嵌套两层，守卫叠加', () => {
    const body = [
      '# 甲',
      '$ 甲变量 = 1',
      '$ 乙变量 = 1',
      '$若 甲变量>=1',
      '$若 乙变量>=1',
      '- 深处 -> 结束',
      '$结束',
      '$结束',
    ].join('\n')
    const n = nodesOf(body)[0]!
    expect(n.exits[0]!.guards).toHaveLength(2)
  })

  it('【关键】$否则 没有对应的 $若 时报出来，不悄悄吞掉', () => {
    const g = graphOf('# 甲\n$否则\n- 走 -> 结束')
    expect(g.problems.some((p) => p.kind === 'badCondition')).toBe(true)
  })

  it('$结束 多了也报', () => {
    const g = graphOf('# 甲\n$结束\n- 走 -> 结束')
    expect(g.problems.some((p) => p.kind === 'badCondition')).toBe(true)
  })

  it('$若 的条件看不懂时报出来', () => {
    const g = graphOf('# 甲\n$若 好感度 很高\n- 走 -> 结束\n$结束')
    expect(g.problems.some((p) => p.kind === 'badCondition')).toBe(true)
  })

  it('块不跨节点 —— 上一节点忘了 $结束 不该影响下一个', () => {
    const body = '# 甲\n$ 变量 = 1\n$若 变量>=1\n- 走 -> 乙\n\n# 乙\n- 出去 -> 结束'
    const yi = nodesOf(body).find((n) => n.name === '乙')!
    expect(yi.exits[0]!.guards).toEqual([])
  })

  it('【关键】守卫里的变量也参与「从没赋过值」检查', () => {
    const g = graphOf('# 甲\n$若 神秘变量\n- 走 -> 结束\n$结束\n- 别走 -> 结束')
    expect(g.problems.some((p) => p.kind === 'unsetVariable')).toBe(true)
  })
})

describe('evalGuards', () => {
  const guards = nodesOf('# 甲\n$ 好感度 = 0\n$若 好感度>=3\n- 走 -> 结束\n$结束')[0]!.exits[0]!.guards

  it('成立时为真', () => {
    expect(evalGuards(guards, { 好感度: 5 })).toBe(true)
  })

  it('不成立时为假', () => {
    expect(evalGuards(guards, { 好感度: 1 })).toBe(false)
  })

  it('没有守卫时恒真', () => {
    expect(evalGuards([], {})).toBe(true)
  })
})

describe('从任意节点开始试玩', () => {
  const BODY = [
    '# 第一章',
    '- 走 -> 第二章',
    '',
    '# 第二章',
    '- 继续 -> 门口',
    '',
    '# 门口',
    '- {拿到钥匙} 开门 -> 里屋',
    '- 走开 -> 结束',
    '',
    '# 里屋',
    '-> 结束',
  ].join('\n')

  it('【关键】能从中段开始，不必每次从头走', () => {
    const sim = simulate(graphOf(BODY), { from: '门口' })
    expect(sim.reachable.has('门口')).toBe(true)
    expect(sim.reachable.has('第一章')).toBe(false)
  })

  it('【关键】能假设「已经拿到钥匙了」', () => {
    const locked = simulate(graphOf(BODY), { from: '门口' })
    expect(locked.reachable.has('里屋')).toBe(false)

    const withKey = simulate(graphOf(BODY), { from: '门口', initialState: { 拿到钥匙: true } })
    expect(withKey.reachable.has('里屋')).toBe(true)
  })

  it('起点名字不存在时不炸，返回空结果', () => {
    const sim = simulate(graphOf(BODY), { from: '没这个节点' })
    expect(sim.reachable.size).toBe(0)
  })

  it('不传 from 时还是从图的起点走', () => {
    expect(simulate(graphOf(BODY)).reachable.has('第一章')).toBe(true)
  })
})
