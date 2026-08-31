/**
 * 剧本模式补做的那几块：按场分布、缺席检查、场次重排、模板。
 *
 * 重排那块盯得最紧 —— 它**直接改正文文本**，
 * 场次顺序就是正文里的顺序，没有另一份「顺序数据」可以改。
 * 挪错一行，作者的稿子就少了一段。
 */

import { describe, it, expect } from 'vitest'
import {
  castStats,
  longestAbsence,
  moveScene,
  parseScript,
  sceneCast,
  scriptTemplate,
  unknownSpeakers,
} from './index.js'
import { buildCast, emptyCast } from '../cast/index.js'

const BODY = [
  '# 第一场　内景·咖啡馆·日',
  '',
  '（李四推门进来。）',
  '',
  '李四：你等很久了？',
  '王五：还好。',
  '',
  '# 第二场　外景·街道·夜',
  '',
  '李四：那件事我想过了，真的想过了。',
  '',
  '# 第三场　内景·家·晨',
  '',
  '王五：随你。',
].join('\n')

describe('sceneCast · 哪一场是谁的主场', () => {
  const cast = sceneCast(parseScript(BODY))

  it('每一场都有一条', () => {
    expect(cast.map((c) => c.title)).toEqual([
      '第一场　内景·咖啡馆·日',
      '第二场　外景·街道·夜',
      '第三场　内景·家·晨',
    ])
  })

  it('数出这一场里每个人说了多少', () => {
    const s1 = cast[0]!
    expect(s1.who.map((w) => w.who).sort()).toEqual(['李四', '王五'])
    expect(s1.chars).toBeGreaterThan(0)
  })

  it('【关键】第二场只有李四 —— 摊到场上才看得出谁不在', () => {
    expect(cast[1]!.who.map((w) => w.who)).toEqual(['李四'])
  })

  it('说得多的排前面', () => {
    const s = sceneCast(parseScript('# 甲\n李四：短。\n王五：很长很长很长很长很长的一句话。'))
    expect(s[0]!.who[0]!.who).toBe('王五')
  })

  it('没有台词的场也在列表里，不会跳号', () => {
    const s = sceneCast(parseScript('# 甲\n（只有动作。）\n\n# 乙\n李四：喂'))
    expect(s).toHaveLength(2)
    expect(s[0]!.who).toEqual([])
  })
})

describe('longestAbsence · 谁连着几场没出声', () => {
  it('【关键】数得出最长的一段缺席', () => {
    // 王五在第一场、第三场说话，第二场没有 → 缺席 1 场
    const a = longestAbsence(parseScript(BODY))
    expect(a.find((x) => x.who === '王五')?.gap).toBe(1)
  })

  it('从头到尾都在的人不进这个清单', () => {
    const a = longestAbsence(parseScript('# 甲\n李四：喂\n\n# 乙\n李四：喂'))
    expect(a).toEqual([])
  })

  it('【关键】还没登场不算缺席 —— 第三场才出现的人不该被说成缺席两场', () => {
    const body = '# 甲\n李四：喂\n\n# 乙\n李四：喂\n\n# 丙\n新人：我来了'
    const a = longestAbsence(parseScript(body))
    expect(a.find((x) => x.who === '新人')).toBeUndefined()
  })

  it('结尾那一段缺席也算', () => {
    const body = '# 甲\n王五：喂\n\n# 乙\n李四：喂\n\n# 丙\n李四：喂'
    expect(longestAbsence(parseScript(body)).find((x) => x.who === '王五')?.gap).toBe(2)
  })

  it('缺得最久的排最前', () => {
    const body = '# 甲\n王五：喂\n甲乙：喂\n\n# 乙\n李四：喂\n\n# 丙\n李四：喂\n甲乙：喂'
    const a = longestAbsence(parseScript(body))
    expect(a[0]!.gap).toBeGreaterThanOrEqual(a[a.length - 1]!.gap)
  })
})

describe('moveScene · 场次重排', () => {
  const scenesOf = (b: string) =>
    parseScript(b)
      .scenes.filter((s) => s.no >= 0)
      .map((s) => s.title)

  it('往后挪', () => {
    const r = moveScene(BODY, 0, 2)
    expect(scenesOf(r)).toEqual([
      '第二场　外景·街道·夜',
      '第三场　内景·家·晨',
      '第一场　内景·咖啡馆·日',
    ])
  })

  it('往前挪', () => {
    const r = moveScene(BODY, 2, 0)
    expect(scenesOf(r)[0]).toBe('第三场　内景·家·晨')
  })

  it('【关键】一个字都不能丢', () => {
    // 场次顺序就是正文里的顺序，挪错一行作者的稿子就少一段
    const r = moveScene(BODY, 0, 2)
    for (const must of ['李四推门进来', '你等很久了', '那件事我想过了', '随你']) {
      expect(r).toContain(must)
    }
  })

  it('【关键】挪完还能被重新解析成同样多的场与台词', () => {
    const before = parseScript(BODY)
    const after = parseScript(moveScene(BODY, 0, 2))
    const count = (d: typeof before, k: string) => d.lines.filter((l) => l.kind === k).length
    expect(count(after, 'dialogue')).toBe(count(before, 'dialogue'))
    expect(count(after, 'action')).toBe(count(before, 'action'))
    expect(after.scenes.filter((s) => s.no >= 0)).toHaveLength(3)
  })

  it('第一个场景标题之前的内容留在最前面', () => {
    const withHead = '片头：某某出品\n\n' + BODY
    const r = moveScene(withHead, 0, 1)
    expect(r.startsWith('片头：某某出品')).toBe(true)
  })

  it('挪到原位不改动', () => {
    expect(moveScene(BODY, 1, 1)).toBe(BODY)
  })

  it('越界的下标原样返回，不炸', () => {
    expect(moveScene(BODY, 0, 9)).toBe(BODY)
    expect(moveScene(BODY, -1, 0)).toBe(BODY)
  })

  it('没有场景的正文原样返回', () => {
    const plain = '就是一段普通的话。'
    expect(moveScene(plain, 0, 1)).toBe(plain)
  })

  it('两场之间不会粘在一起', () => {
    const r = moveScene(BODY, 0, 2)
    expect(r).not.toMatch(/[^\n]\n#/)
  })
})

describe('scriptTemplate · 骨架自己得像个剧本', () => {
  const doc = parseScript(scriptTemplate())

  it('有两场', () => {
    expect(doc.scenes.filter((s) => s.no >= 0)).toHaveLength(2)
  })

  it('场景、动作、台词三种行都有', () => {
    const kinds = new Set(doc.lines.map((l) => l.kind))
    expect(kinds.has('scene')).toBe(true)
    expect(kinds.has('action')).toBe(true)
    expect(kinds.has('dialogue')).toBe(true)
  })

  it('带表演提示的写法也示范了', () => {
    expect(doc.lines.some((l) => l.kind === 'dialogue' && l.cue)).toBe(true)
  })

  it('两个角色都认得出来', () => {
    expect(castStats(doc).map((c) => c.who).sort()).toEqual(['李四', '王五'])
  })

  it('标题能自己定', () => {
    expect(scriptTemplate('序场').startsWith('# 序场')).toBe(true)
  })
})

// ───────────────────────── 认人之后 ─────────────────────────

describe('确凿的角色名', () => {
  const cast = buildCast([{ title: '李四' }, { title: '王五', body: '别名：老王' }])
  const body = [
    '# 第一场',
    '李四：你等很久了？',
    '老王：还好。',
    '时间：三年后',
    '赵六：我也在。',
  ].join('\n')

  const doc = parseScript(body, { cast })
  const line = (i: number) => doc.lines.find((l) => l.index === i)!

  it('卡里有的名字标成确凿', () => {
    expect(line(1).knownWho).toBe(true)
  })

  it('别名也算确凿', () => {
    expect(line(2).knownWho).toBe(true)
  })

  it('【关键】卡里没有的不算确凿 —— 排版不敢拆行，正好', () => {
    // 「时间：三年后」被正则误伤成台词，但它进不了确凿名单
    expect(line(3).knownWho).toBeUndefined()
    expect(line(4).knownWho).toBeUndefined()
  })

  it('不给名单时谁都不确凿，退回原来的样子', () => {
    for (const l of parseScript(body).lines) expect(l.knownWho).toBeUndefined()
  })

  it('统计仍然按写在纸上的名字算，不偷偷归并', () => {
    // 显示什么就统计什么。把「老王」并进「王五」，作者会对不上数
    expect(castStats(doc).map((c) => c.who)).toContain('老王')
  })
})

describe('不在人物卡里的名字', () => {
  const cast = buildCast([{ title: '李四' }])

  it('把写错的人名挑出来', () => {
    const doc = parseScript('李四：甲\n李西：乙\n李西：丙', { cast })
    const bad = unknownSpeakers(doc, cast)
    expect(bad).toHaveLength(1)
    expect(bad[0]).toMatchObject({ who: '李西', lines: 2, firstLine: 1 })
  })

  it('【关键】没配人物分类时一条都不报', () => {
    // 那种情况下每个名字都「不在卡里」，报出来全是噪音
    const doc = parseScript('李四：甲\n李西：乙')
    expect(unknownSpeakers(doc, emptyCast())).toEqual([])
  })

  it('说得多的排前面', () => {
    const doc = parseScript('甲：1\n乙：2\n乙：3', { cast })
    expect(unknownSpeakers(doc, cast).map((x) => x.who)).toEqual(['乙', '甲'])
  })
})
