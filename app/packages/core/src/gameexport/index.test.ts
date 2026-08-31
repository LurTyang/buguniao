/**
 * 导出到引擎。
 *
 * 这个模块最要紧的不是「语法多正确」—— 我没法在这儿真跑一遍 Ren'Py。
 * 要紧的是**结构不能丢、也不能编**：每个节点都得在、每条跳转都得对得上、
 * 中文名换掉了要留对照表、导不过去的东西要如实说出来。
 */

import { describe, it, expect } from 'vitest'
import { parseGameNodes, type SourceDoc } from '../gamescript/index.js'
import { exportGame, toInk, toRenpy } from './index.js'

const doc = (body: string): SourceDoc => ({ path: 'x.md', title: 'x', body })

const BODY = [
  '# 初见',
  '（教室后排。）',
  '李四：你是新来的？',
  '- 点头 -> 承认',
  '- 不理他 -> 冷场',
  '',
  '# 承认',
  '$ 好感度 += 1',
  '李四：我叫李四。',
  '-> 放学',
  '',
  '# 冷场',
  '（他没再说话。）',
  '-> 放学',
  '',
  '# 放学',
  '- {好感度>=1} 一起走 -> 结束',
  '- 自己走 -> 结束',
].join('\n')

const nodes = parseGameNodes([doc(BODY)])

describe('Ren\'Py', () => {
  const r = toRenpy(nodes, '某某游戏')

  it('每个节点一个 label', () => {
    for (const n of ['初见', '承认', '冷场', '放学']) {
      expect(r.text).toContain(`label ${n}:`)
    }
  })

  it('【关键】正文带过去了 —— 只导结构不导正文，那份文件没用', () => {
    expect(r.text).toContain('你是新来的？')
    expect(r.text).toContain('教室后排')
  })

  it('选项导成 menu', () => {
    expect(r.text).toContain('menu:')
    expect(r.text).toContain('"点头"')
    expect(r.text).toContain('jump 承认')
  })

  it('直接跳转导成 jump', () => {
    expect(r.text).toContain('jump 放学')
  })

  it('变量导成 $', () => {
    expect(r.text).toContain('$ 好感度 += 1')
  })

  it('条件挂在选项上', () => {
    expect(r.text).toMatch(/"一起走" if 好感度 >= 1:/)
  })

  it('结局有个落点，不会跳到不存在的 label', () => {
    expect(r.text).toContain('label _ending_结束:')
    expect(r.text).toContain('    return')
  })

  it('文件名对', () => {
    expect(r.fileName).toBe('script.rpy')
  })

  it('【关键】开头写明这是骨架，不是能直接跑的游戏', () => {
    // 让作者以为导出来就能跑，他会拿去开工程然后发现少一半东西
    expect(r.text).toContain('骨架')
  })

  it('正文导成独白这件事要说出来', () => {
    expect(r.notes.some((n) => n.includes('独白'))).toBe(true)
  })

  it('名字里有空格标点时改写并记进对照表', () => {
    const n2 = parseGameNodes([doc('# 第一场 内景·咖啡馆\n-> 结束')])
    const r2 = toRenpy(n2)
    expect(r2.renamed).toHaveLength(1)
    expect(r2.text).toContain(`label ${r2.renamed[0]!.to}:`)
  })

  it('没有出口的节点导成 return，并如实说明', () => {
    const r3 = toRenpy(parseGameNodes([doc('# 甲\n李四：完了')]))
    expect(r3.text).toContain('return')
    expect(r3.notes.some((n) => n.includes('没有出口'))).toBe(true)
  })

  it('块条件也带过去', () => {
    const body = '# 甲\n$ 好感度 = 1\n$若 好感度>=1\n- 走 -> 结束\n$结束'
    expect(toRenpy(parseGameNodes([doc(body)])).text).toMatch(/if 好感度 >= 1/)
  })
})

describe('ink', () => {
  const r = toInk(nodes, '某某游戏')

  it('每个节点一个 knot', () => {
    expect((r.text.match(/^=== /gm) ?? [])).toHaveLength(4)
  })

  it('【关键】中文 knot 名换成 ASCII，并留下对照表', () => {
    // 不留的话作者打开一看全是 n1 n2，根本认不出哪个是哪个
    expect(r.renamed.length).toBe(4)
    for (const { from, to } of r.renamed) {
      expect(r.text).toContain(`//    ${to}  =  ${from}`)
    }
  })

  it('原节点名写在 knot 下面当注释', () => {
    expect(r.text).toContain('// 初见')
  })

  it('选项导成 +', () => {
    expect(r.text).toMatch(/^\+ .*点头 -> /m)
  })

  it('变量先声明再用，名字换成 ASCII 并注明原名', () => {
    expect(r.text).toMatch(/^VAR v\d+ = 0  \/\/ 好感度$/m)
  })

  it('【关键】ink 里不能出现中文标识符', () => {
    // 中文剥掉会变成空字符串，导出 `VAR  = 0` —— 既不报错也不能用。
    // 所以只有注释行允许出现中文，代码行不许
    const codeLines = r.text
      .split(String.fromCharCode(10))
      .filter((l) => l.trim() !== '' && !l.trim().startsWith('//'))
    for (const l of codeLines) {
      // 台词那些是文本内容，允许中文；这里只查 VAR / ~ / === 这几种声明行
      if (/^(VAR |~ |=== )/.test(l.trim())) {
        expect(l.replace(/\/\/.*$/, '')).not.toMatch(/[一-鿿]/)
      }
    }
  })

  it('结局跳到 END', () => {
    expect(r.text).toContain('-> END')
  })

  it('条件用 {} 包着，变量用的是换过的名字', () => {
    expect(r.text).toMatch(/\{ v\d+ >= 1 \}/)
  })

  it('文件名对', () => {
    expect(r.fileName).toBe('script.ink')
  })

  it('纯英文的节点名留着不改', () => {
    const r2 = toInk(parseGameNodes([doc('# start\n-> END')]))
    expect(r2.text).toContain('=== start ===')
  })

  it('【关键】导不过去的东西要如实说，不装作没事', () => {
    expect(r.notes.length).toBeGreaterThan(0)
  })
})

describe('exportGame', () => {
  it('按引擎分发', () => {
    expect(exportGame(nodes, 'renpy').engine).toBe('renpy')
    expect(exportGame(nodes, 'ink').engine).toBe('ink')
  })

  it('空剧本不炸', () => {
    expect(exportGame([], 'renpy').text.length).toBeGreaterThan(0)
    expect(exportGame([], 'ink').text.length).toBeGreaterThan(0)
  })

  it('【关键】每个节点都在，一个不少', () => {
    for (const engine of ['renpy', 'ink'] as const) {
      const r = exportGame(nodes, engine)
      for (const n of nodes) {
        // Ren'Py 用原名，ink 用对照表里的名字，两种都该找得到出处
        const shows = r.text.includes(n.name) || r.renamed.some((x) => x.from === n.name)
        expect(shows).toBe(true)
      }
    }
  })
})
