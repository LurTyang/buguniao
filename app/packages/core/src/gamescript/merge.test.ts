/**
 * 0.3 加的四样写法，都是作者用下来提的：
 *
 *   `-> 【结束】`      显式结局 —— 别让一个叫「结束」的节点把整条线掐掉
 *   `-> ↩ 放学`        显式回绕 —— 没标记就绕回去的，体检要提一句
 *   `-> 甲、乙、丙`     一行列多个去处 —— 「这个时间段去哪儿」不用一条条抄
 *   `<- 甲、乙`        合并 —— 分歧之后合流，在合流处写一次就够
 *
 * 前两条要防的都是**看起来一切正常的错**：图画得出来、体检不报，
 * 而作者写的分支就是走不到。这种错只能靠测试钉。
 */

import { describe, it, expect } from 'vitest'
import { buildGraph, parseExits, parseGameNodes, parseMerge, simulate, type SourceDoc } from './index.js'

const doc = (path: string, body: string[]): SourceDoc => ({
  path,
  title: path,
  body: body.join('\n'),
})

const graphOf = (...docs: SourceDoc[]) => buildGraph(parseGameNodes(docs))
const kinds = (g: ReturnType<typeof buildGraph>) => g.problems.map((p) => p.kind)
const exitsOf = (g: ReturnType<typeof buildGraph>, name: string) =>
  g.nodes.find((n) => n.name === name)?.exits ?? []

// ───────────────────────── 显式结局 ─────────────────────────

describe('【…】= 结局，跟节点名撞不上', () => {
  it('方括号里的名字算结局，不算跳转', () => {
    const e = parseExits('-> 【好结局】', 0)[0]!
    expect(e.explicitEnding).toBe(true)
    expect(e.ending).toBe(true)
    expect(e.target).toBe('好结局')
  })

  it('半角方括号也认 —— 作者不会为这个切输入法', () => {
    expect(parseExits('-> [END]', 0)[0]!.explicitEnding).toBe(true)
  })

  it('【关键】书里真有个节点叫「结束」时，-> 结束 是跳过去，不是收场', () => {
    const g = graphOf(
      doc('a.md', ['# 开场', '', '话。', '', '-> 结束', '', '# 结束', '', '收尾的话。', '', '-> 【完】']),
    )
    const e = exitsOf(g, '开场')[0]!
    expect(e.ending).toBe(false)
    expect(simulate(g).reachable.has('结束')).toBe(true)
  })

  it('没有同名节点时，保留名照旧当结局 —— 老稿子不能因此报错', () => {
    const g = graphOf(doc('a.md', ['# 开场', '', '话。', '', '-> 结束']))
    expect(exitsOf(g, '开场')[0]!.ending).toBe(true)
    expect(kinds(g)).not.toContain('missingTarget')
  })

  it('【结束】即使书里有同名节点也还是结局 —— 作者说了算', () => {
    const g = graphOf(
      doc('a.md', ['# 开场', '', '话。', '', '-> 【结束】', '', '# 结束', '', '别的话。', '', '-> 【完】']),
    )
    expect(exitsOf(g, '开场')[0]!.ending).toBe(true)
  })
})

// ───────────────────────── 显式回绕 ─────────────────────────

describe('↩ = 有意回绕', () => {
  it('认得 ↩、回到、返回三种写法', () => {
    for (const raw of ['-> ↩放学', '-> 回到 放学', '-> 返回放学']) {
      const e = parseExits(raw, 0)[0]!
      expect(e.loop, raw).toBe(true)
      expect(e.target, raw).toBe('放学')
    }
  })

  it('标了 ↩ 的回绕不报提示', () => {
    const g = graphOf(
      doc('a.md', ['# 菜单', '', '选吧。', '', '- 看书 -> 看书', '', '# 看书', '', '看完了。', '', '-> ↩菜单']),
    )
    expect(kinds(g)).not.toContain('unmarkedLoop')
  })

  it('【关键】没标记就绕回前面的节点，提一句', () => {
    const g = graphOf(
      doc('a.md', ['# 菜单', '', '选吧。', '', '- 看书 -> 看书', '', '# 看书', '', '看完了。', '', '-> 菜单']),
    )
    const hit = g.problems.find((p) => p.kind === 'unmarkedLoop')
    expect(hit?.node).toBe('看书')
    expect(hit?.message).toContain('菜单')
  })

  it('往后跳不算回绕', () => {
    const g = graphOf(
      doc('a.md', ['# 一', '', '话。', '', '-> 二', '', '# 二', '', '话。', '', '-> 【结束】']),
    )
    expect(kinds(g)).not.toContain('unmarkedLoop')
  })

  it('合并推出来的隐式出口不算回绕 —— 那不是作者写的行', () => {
    const g = graphOf(
      doc('a.md', ['# 汇合', '', '话。', '', '<- 支线', '', '-> 【结束】', '', '# 支线', '', '话。']),
    )
    expect(kinds(g)).not.toContain('unmarkedLoop')
  })
})

// ───────────────────────── 一行多个去处 ─────────────────────────

describe('-> 甲、乙、丙', () => {
  it('拆成三条，选项文字就是节点名', () => {
    const es = parseExits('-> 图书馆、天台、社团', 3)
    expect(es.map((e) => e.target)).toEqual(['图书馆', '天台', '社团'])
    expect(es.map((e) => e.label)).toEqual(['图书馆', '天台', '社团'])
    expect(es.every((e) => e.line === 3)).toBe(true)
  })

  it('逗号、斜杠也认', () => {
    expect(parseExits('-> 甲, 乙 / 丙', 0).map((e) => e.target)).toEqual(['甲', '乙', '丙'])
  })

  it('只有一个目标时，label 还是空 —— 那是直接跳转，不是选项', () => {
    const e = parseExits('-> 放学', 0)[0]!
    expect(e.label).toBe('')
  })

  it('条件挂在整行上，拆出来的每一条都带着它', () => {
    const es = parseExits('{有空} -> 甲、乙', 0)
    expect(es.every((e) => e.condition?.variable === '有空')).toBe(true)
  })

  it('写了选项文字的那种不拆 —— 拆完两个选项同名，那不是作者要的', () => {
    const es = parseExits('- 点头 -> 甲、乙', 0)
    expect(es).toHaveLength(1)
    expect(es[0]!.target).toBe('甲、乙')
  })

  it('真走一遍，三个去处都到得了', () => {
    const g = graphOf(
      doc('a.md', [
        '# 放学后',
        '',
        '去哪儿？',
        '',
        '-> 图书馆、天台',
        '',
        '# 图书馆',
        '',
        '很安静。',
        '',
        '-> 【结束】',
        '',
        '# 天台',
        '',
        '风很大。',
        '',
        '-> 【结束】',
      ]),
    )
    const sim = simulate(g)
    expect(sim.reachable.has('图书馆')).toBe(true)
    expect(sim.reachable.has('天台')).toBe(true)
    expect(kinds(g)).not.toContain('missingTarget')
  })
})

// ───────────────────────── 合并 ─────────────────────────

describe('<- 合并', () => {
  it('认得写法，顿号分隔', () => {
    expect(parseMerge('<- 承认、冷场')).toEqual(['承认', '冷场'])
    expect(parseMerge('← 承认')).toEqual(['承认'])
    expect(parseMerge('-> 承认')).toBeNull()
    expect(parseMerge('随便一句话')).toBeNull()
  })

  const MERGED = doc('a.md', [
    '# 初见',
    '',
    '话。',
    '',
    '- 点头 -> 承认',
    '- 不理 -> 冷场',
    '',
    '# 承认',
    '',
    '嗯。',
    '',
    '# 冷场',
    '',
    '沉默。',
    '',
    '# 放学',
    '',
    '<- 承认、冷场',
    '',
    '铃响了。',
    '',
    '-> 【结束】',
  ])

  it('【关键】两条分支都不用自己写 -> 放学，也不再是死路', () => {
    const g = graphOf(MERGED)
    expect(kinds(g)).not.toContain('deadEnd')
    expect(exitsOf(g, '承认')[0]).toMatchObject({ target: '放学', implicit: true })
    expect(exitsOf(g, '冷场')[0]).toMatchObject({ target: '放学', implicit: true })
  })

  it('合流之后真的走得到，而且不算孤儿', () => {
    const g = graphOf(MERGED)
    expect(simulate(g).reachable.has('放学')).toBe(true)
    expect(kinds(g)).not.toContain('orphan')
  })

  it('人家自己写了出口就不动它，并且说一声', () => {
    const g = graphOf(
      doc('a.md', [
        '# 开场',
        '',
        '话。',
        '',
        '-> 支线',
        '',
        '# 支线',
        '',
        '话。',
        '',
        '-> 【结束】',
        '',
        '# 汇合',
        '',
        '<- 支线',
        '',
        '话。',
        '',
        '-> 【结束】',
      ]),
    )
    expect(kinds(g)).toContain('mergeIgnored')
    expect(exitsOf(g, '支线')).toHaveLength(1)
    expect(exitsOf(g, '支线')[0]!.ending).toBe(true)
  })

  it('点名了一个不存在的节点，当断头路报出来', () => {
    const g = graphOf(doc('a.md', ['# 汇合', '', '话。', '', '<- 查无此人', '', '-> 【结束】']))
    const hit = g.problems.find((p) => p.kind === 'missingTarget')
    expect(hit?.message).toContain('查无此人')
  })
})

// ───────────────────────── 模板本身 ─────────────────────────

describe('新建时给的两份东西', () => {
  it('第二篇起只有一行标题，不再塞一遍李四', async () => {
    const { gameNodeStub } = await import('./index.js')
    expect(gameNodeStub('第二幕')).toBe('# 第二幕\n\n')
    expect(gameNodeStub('第二幕')).not.toContain('李四')
  })

  it('骨架用上了新写法，而且体检一条都不报', async () => {
    const { gameScriptTemplate } = await import('./index.js')
    const text = gameScriptTemplate()
    expect(text).toContain('<- 承认、冷场')
    expect(text).toContain('【结束】')
    expect(graphOf(doc('模板.md', text.split('\n'))).problems).toEqual([])
  })
})
