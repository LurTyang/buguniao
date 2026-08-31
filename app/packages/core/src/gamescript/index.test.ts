/**
 * 游戏剧本测试。
 *
 * 这个模块存在的理由就是「体检」：断头路、孤儿节点、走不到的分支、
 * 永远不成立的条件 —— 这些是分支剧情最会咬人的地方，
 * 而且**光靠人眼在几十个文件里翻是翻不出来的**。
 * 所以下面很大一部分用例在验「问题有没有被抓出来、有没有误报」。
 */

import { describe, it, expect } from 'vitest'
import {
  applyAssign,
  buildGraph,
  evalCondition,
  gameProgress,
  gameScriptTemplate,
  parseAssign,
  parseCondition,
  parseExit,
  parseGameNodes,
  simulate,
  type SourceDoc,
} from './index.js'

const doc = (path: string, body: string): SourceDoc => ({ path, title: path, body })

const SIMPLE = doc(
  '第一章.md',
  [
    '# 初见',
    '',
    '李四：你是新来的？',
    '',
    '- 点头 -> 承认',
    '- 不理他 -> 冷场',
    '',
    '# 承认',
    '',
    '$ 好感度 += 1',
    '李四：我叫李四。',
    '-> 放学',
    '',
    '# 冷场',
    '（他没再说话。）',
    '-> 放学',
    '',
    '# 放学',
    '（铃响了。）',
    '- {好感度>=1} 一起走 -> 结束',
    '- 自己走 -> 结束',
  ].join('\n'),
)

describe('parseCondition', () => {
  it('比大小', () => {
    expect(parseCondition('好感度>=3')).toMatchObject({ variable: '好感度', op: '>=', value: 3 })
  })

  it('两边有空格也认', () => {
    expect(parseCondition(' 好感度 >= 3 ')?.variable).toBe('好感度')
  })

  it('单个等号当相等', () => {
    expect(parseCondition('拿到钥匙=真')).toMatchObject({ op: '==', value: true })
  })

  it('真假用中文写', () => {
    expect(parseCondition('拿到钥匙=假')?.value).toBe(false)
  })

  it('光写一个变量名表示「它是真的」', () => {
    expect(parseCondition('拿到钥匙')).toMatchObject({ truthy: true, variable: '拿到钥匙' })
  })

  it('「非」表示取反', () => {
    expect(parseCondition('非 拿到钥匙')).toMatchObject({ negated: true, truthy: true })
  })

  it('!= 认得出，不会被当成 =', () => {
    expect(parseCondition('好感度!=0')?.op).toBe('!=')
  })

  it('【关键】认不出来时返回 null，绝不猜成真或假', () => {
    // 猜错一条条件，作者就会以为某条分支永远走不到
    expect(parseCondition('好感度 很高')).toBeNull()
    expect(parseCondition('')).toBeNull()
  })
})

describe('evalCondition', () => {
  const c = (s: string) => parseCondition(s)!

  it('数字比较', () => {
    expect(evalCondition(c('好感度>=3'), { 好感度: 3 })).toBe(true)
    expect(evalCondition(c('好感度>=3'), { 好感度: 2 })).toBe(false)
  })

  it('没赋过值的数字变量当 0', () => {
    expect(evalCondition(c('好感度>=1'), {})).toBe(false)
    expect(evalCondition(c('好感度<1'), {})).toBe(true)
  })

  it('布尔', () => {
    expect(evalCondition(c('拿到钥匙'), { 拿到钥匙: true })).toBe(true)
    expect(evalCondition(c('拿到钥匙'), {})).toBe(false)
  })

  it('取反', () => {
    expect(evalCondition(c('非 拿到钥匙'), {})).toBe(true)
  })

  it('字符串相等', () => {
    expect(evalCondition(c('结局线=真结局'), { 结局线: '真结局' })).toBe(true)
  })
})

describe('parseAssign / applyAssign', () => {
  it('赋值', () => {
    expect(parseAssign('$ 拿到钥匙 = 真')).toMatchObject({ variable: '拿到钥匙', op: '=', value: true })
  })

  it('加减', () => {
    expect(parseAssign('$好感度 += 1')).toMatchObject({ op: '+=', value: 1 })
    expect(parseAssign('$好感度 -= 2')).toMatchObject({ op: '-=', value: 2 })
  })

  it('不是 $ 开头的不算', () => {
    expect(parseAssign('好感度 += 1')).toBeNull()
  })

  it('累加从 0 起', () => {
    expect(applyAssign({}, parseAssign('$好感度 += 1')!)).toEqual({ 好感度: 1 })
  })

  it('累加不改原来的状态对象', () => {
    const s = { 好感度: 1 }
    applyAssign(s, parseAssign('$好感度 += 1')!)
    expect(s).toEqual({ 好感度: 1 })
  })

  it('对非数字做加法时当 0 起算，不炸', () => {
    expect(applyAssign({ 好感度: '高' }, parseAssign('$好感度 += 1')!)).toEqual({ 好感度: 1 })
  })
})

describe('parseExit', () => {
  it('选项', () => {
    expect(parseExit('- 点头 -> 承认', 3)).toMatchObject({ label: '点头', target: '承认', ending: false })
  })

  it('带条件的选项', () => {
    const e = parseExit('- {好感度>=3} 搭话 -> 熟络', 0)!
    expect(e.label).toBe('搭话')
    expect(e.condition?.variable).toBe('好感度')
  })

  it('直接跳转没有选项文字', () => {
    expect(parseExit('-> 放学', 0)).toMatchObject({ label: '', target: '放学' })
  })

  it('中文箭头也认', () => {
    expect(parseExit('- 点头 → 承认', 0)?.target).toBe('承认')
  })

  it('跳到保留名算结局', () => {
    expect(parseExit('-> 结束', 0)?.ending).toBe(true)
    expect(parseExit('-> END', 0)?.ending).toBe(true)
  })

  it('【关键】条件写坏了要记下来，不能当成没条件就放过去', () => {
    const e = parseExit('- {好感度 很高} 搭话 -> 熟络', 0)!
    expect(e.condition).toBeNull()
    expect(e.badCondition).toBe('好感度 很高')
  })

  it('普通台词不会被当成出口', () => {
    expect(parseExit('李四：你是新来的？', 0)).toBeNull()
  })

  it('普通列表项不会被当成出口', () => {
    expect(parseExit('- 这只是个列表项', 0)).toBeNull()
  })
})

describe('parseGameNodes', () => {
  const nodes = parseGameNodes([SIMPLE])

  it('扒出四个节点', () => {
    expect(nodes.map((n) => n.name)).toEqual(['初见', '承认', '冷场', '放学'])
  })

  it('记下在哪个文件哪一行', () => {
    expect(nodes[0]).toMatchObject({ docPath: '第一章.md', line: 0 })
  })

  it('出口挂到所属节点上', () => {
    expect(nodes[0]!.exits.map((e) => e.target)).toEqual(['承认', '冷场'])
  })

  it('变量操作挂到所属节点上', () => {
    expect(nodes[1]!.assigns).toHaveLength(1)
  })

  it('正文字数不含选项行与变量行', () => {
    // 台词部分「我叫李四。」五个字，选项行与 $ 行都不算
    expect(nodes[1]!.chars).toBe(5)
  })

  it('只有标题的节点算空壳', () => {
    const n = parseGameNodes([doc('x.md', '# 空节点\n\n# 有内容\n李四：喂')])
    expect(n[0]!.written).toBe(false)
    expect(n[1]!.written).toBe(true)
  })

  it('【关键】跨文件：两个文件的节点都在同一份清单里', () => {
    const n = parseGameNodes([doc('一.md', '# 甲\n-> 乙'), doc('七.md', '# 乙\n-> 结束')])
    expect(n.map((x) => x.name)).toEqual(['甲', '乙'])
    expect(n.map((x) => x.docPath)).toEqual(['一.md', '七.md'])
  })
})

describe('buildGraph · 体检', () => {
  const kinds = (docs: SourceDoc[]) =>
    buildGraph(parseGameNodes(docs)).problems.map((p) => p.kind)

  it('正常的剧本没有问题', () => {
    expect(buildGraph(parseGameNodes([SIMPLE])).problems).toEqual([])
  })

  it('【关键】跳到不存在的节点会被抓出来', () => {
    expect(kinds([doc('x.md', '# 甲\n-> 没这个节点')])).toContain('missingTarget')
  })

  it('【关键】没人跳到的孤儿节点会被抓出来', () => {
    expect(kinds([doc('x.md', '# 甲\n-> 结束\n\n# 没人来\n-> 结束')])).toContain('orphan')
  })

  it('起点不算孤儿', () => {
    expect(kinds([doc('x.md', '# 甲\n-> 结束')])).not.toContain('orphan')
  })

  it('【关键】没有出口的死路会被抓出来', () => {
    expect(kinds([doc('x.md', '# 甲\n李四：话说完了')])).toContain('deadEnd')
  })

  it('写了 -> 结束 就不算死路', () => {
    expect(kinds([doc('x.md', '# 甲\n李四：再见\n-> 结束')])).not.toContain('deadEnd')
  })

  it('同名节点会被抓出来，而且两处都报', () => {
    const ps = buildGraph(parseGameNodes([doc('一.md', '# 甲\n-> 结束'), doc('二.md', '# 甲\n-> 结束')]))
      .problems.filter((p) => p.kind === 'duplicate')
    expect(ps).toHaveLength(2)
    expect(ps.map((p) => p.docPath).sort()).toEqual(['一.md', '二.md'])
  })

  it('条件写坏了会被抓出来', () => {
    expect(kinds([doc('x.md', '# 甲\n- {好感度 很高} 走 -> 结束')])).toContain('badCondition')
  })

  it('【关键】条件用到一个从没赋过值的变量 —— 那条分支永远走不到', () => {
    expect(kinds([doc('x.md', '# 甲\n- {好感度>=1} 走 -> 结束\n- 别走 -> 结束')])).toContain(
      'unsetVariable',
    )
  })

  it('变量赋过值就不报', () => {
    const body = '# 甲\n$ 好感度 = 1\n- {好感度>=1} 走 -> 结束'
    expect(kinds([doc('x.md', body)])).not.toContain('unsetVariable')
  })

  it('问题里带着文件与行号，界面才跳得过去', () => {
    const p = buildGraph(parseGameNodes([doc('x.md', '# 甲\n-> 没这个')])).problems[0]!
    expect(p.docPath).toBe('x.md')
    expect(p.line).toBe(1)
  })

  it('空书不炸', () => {
    expect(buildGraph([]).problems).toEqual([])
  })
})

describe('simulate · 走一遍', () => {
  const sim = simulate(buildGraph(parseGameNodes([SIMPLE])))

  it('四个节点都走得到', () => {
    expect(new Set(sim.reachable)).toEqual(new Set(['初见', '承认', '冷场', '放学']))
  })

  it('没有走不到的节点', () => {
    expect(sim.unreachable).toEqual([])
  })

  it('结局收集到了', () => {
    expect(sim.endings.length).toBeGreaterThan(0)
    expect(sim.endings.every((e) => e.name === '结束')).toBe(true)
  })

  it('结局带着一条能走到那儿的示例路径', () => {
    const p = sim.endings[0]!.path.map((s) => s.node)
    expect(p[0]).toBe('初见')
    expect(p[p.length - 1]).toBe('结束')
  })

  it('路径里记着每一步选的哪个选项', () => {
    const withVia = sim.endings.flatMap((e) => e.path).filter((s) => s.via !== '')
    expect(withVia.length).toBeGreaterThan(0)
  })

  it('变量的取值被记下来了', () => {
    expect([...(sim.variableValues.get('好感度') ?? [])].sort()).toEqual(['1'])
  })

  it('【关键】条件挡住的分支，没满足时走不到', () => {
    const onlyLocked = doc(
      'x.md',
      ['# 起点', '- 走 -> 门口', '', '# 门口', '- {拿到钥匙} 开门 -> 里屋', '', '# 里屋', '-> 结束'].join('\n'),
    )
    const s = simulate(buildGraph(parseGameNodes([onlyLocked])))
    expect(s.reachable.has('里屋')).toBe(false)
    expect(s.unreachable).toContain('里屋')
  })

  it('满足条件之后就走得到了', () => {
    const unlocked = doc(
      'x.md',
      [
        '# 起点',
        '$ 拿到钥匙 = 真',
        '- 走 -> 门口',
        '',
        '# 门口',
        '- {拿到钥匙} 开门 -> 里屋',
        '',
        '# 里屋',
        '-> 结束',
      ].join('\n'),
    )
    expect(simulate(buildGraph(parseGameNodes([unlocked]))).reachable.has('里屋')).toBe(true)
  })

  it('【关键】环状跳转不会死循环', () => {
    const loop = doc('x.md', '# 甲\n-> 乙\n\n# 乙\n-> 甲')
    const s = simulate(buildGraph(parseGameNodes([loop])))
    expect(s.reachable.size).toBe(2)
    expect(s.truncated).toBe(false)
  })

  it('没有出口的节点也算一个结局，不会被吞掉', () => {
    const s = simulate(buildGraph(parseGameNodes([doc('x.md', '# 甲\n李四：完了')])))
    expect(s.endings.map((e) => e.name)).toEqual(['甲'])
  })

  it('【关键】状态太多时如实说被截断了，不假装数字是全的', () => {
    // 作者拿这个数字判断「这个结局拿不到」，糊弄他会出事
    const many = [
      '# 起点',
      ...Array.from({ length: 12 }, (_, i) => `- 选${i} -> 岔${i}`),
      ...Array.from({ length: 12 }, (_, i) => `\n# 岔${i}\n$ 计${i} += 1\n-> 起点`),
    ].join('\n')
    const s = simulate(buildGraph(parseGameNodes([doc('x.md', many)])), { cap: 50 })
    expect(s.truncated).toBe(true)
  })

  it('没有起点时全部算走不到', () => {
    const s = simulate(buildGraph([]))
    expect(s.reachable.size).toBe(0)
  })
})

describe('gameProgress · 写作进度', () => {
  const g = buildGraph(parseGameNodes([SIMPLE]))
  const p = gameProgress(g, simulate(g))

  it('数节点与完成度', () => {
    expect(p.nodes).toBe(4)
    expect(p.written).toBe(4)
    expect(p.percent).toBe(100)
  })

  it('空壳节点列出来', () => {
    const g2 = buildGraph(parseGameNodes([doc('x.md', '# 写了\n李四：喂\n-> 结束\n\n# 还没写\n-> 结束')]))
    const p2 = gameProgress(g2, simulate(g2))
    expect(p2.stubs).toEqual(['还没写'])
    expect(p2.percent).toBe(50)
  })

  it('数选项总数（分支宽度）', () => {
    expect(p.options).toBe(4)
  })

  it('空书是 0，不是 NaN', () => {
    const g0 = buildGraph([])
    expect(gameProgress(g0, simulate(g0)).percent).toBe(0)
  })
})

describe('gameScriptTemplate · 模板本身得跑得通', () => {
  const g = buildGraph(parseGameNodes([doc('模板.md', gameScriptTemplate())]))

  it('【关键】模板自己不能有任何问题', () => {
    // 给作者的骨架要是自带断头路，那是教他写错
    expect(g.problems).toEqual([])
  })

  it('模板里有分支、有变量、有条件、有结局', () => {
    const sim = simulate(g)
    expect(g.nodes.length).toBeGreaterThanOrEqual(4)
    expect(g.nodes.some((n) => n.assigns.length > 0)).toBe(true)
    expect(g.nodes.some((n) => n.exits.some((e) => e.condition))).toBe(true)
    expect(sim.endings.length).toBeGreaterThan(0)
  })

  it('模板里每个节点都走得到', () => {
    expect(simulate(g).unreachable).toEqual([])
  })

  it('标题能自己定', () => {
    expect(gameScriptTemplate('序章').startsWith('# 序章')).toBe(true)
  })
})
