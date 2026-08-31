/**
 * 剧本解析测试。
 *
 * 这个模块最怕的是**误伤**：把普通小说里带冒号的句子当成台词。
 * 「他抬起头，看着窗外：雨停了。」被排成台词，比不认识剧本还糟。
 * 所以下面一半的用例是在测「什么不该被认成台词」。
 */

import { describe, it, expect } from 'vitest'
import {
  castStats,
  formatScriptPlain,
  looksLikeScript,
  parseScript,
  parseScriptLine,
  scriptSummary,
} from './index.js'

const SAMPLE = [
  '# 第一场　内景·咖啡馆·日',
  '',
  '（李四推门进来，雨水顺着伞尖滴在地板上。）',
  '',
  '李四：你等很久了？',
  '王五（头也不抬）：还好。',
  '',
  '（长久的沉默。王五把杯子推过去。）',
  '',
  '王五：喝吧，凉了。',
  '',
  '# 第二场　外景·街口·夜',
  '',
  '李四：我不该来的。',
].join('\n')

const line = (raw: string) => parseScriptLine(raw, 0, 0)

describe('认行', () => {
  it('# 开头是场景标题', () => {
    expect(line('# 第一场　内景·咖啡馆·日')).toMatchObject({
      kind: 'scene',
      title: '第一场　内景·咖啡馆·日',
    })
  })

  it('多级井号也算场景', () => {
    expect(line('### 第三场').kind).toBe('scene')
  })

  it('整行括号是动作', () => {
    expect(line('（李四推门进来。）')).toMatchObject({ kind: 'action', text: '李四推门进来。' })
  })

  it('半角括号也认', () => {
    expect(line('(他坐下)').kind).toBe('action')
  })

  it('角色名加冒号是台词', () => {
    expect(line('李四：你等很久了？')).toMatchObject({
      kind: 'dialogue',
      who: '李四',
      text: '你等很久了？',
    })
  })

  it('角色名后可以带表演提示', () => {
    expect(line('王五（头也不抬）：还好。')).toMatchObject({
      kind: 'dialogue',
      who: '王五',
      cue: '头也不抬',
      text: '还好。',
    })
  })

  it('半角冒号也认', () => {
    expect(line('李四:走吧').who).toBe('李四')
  })

  it('台词里的冒号不再切分', () => {
    expect(line('李四：他说：走吧').text).toBe('他说：走吧')
  })

  it('空行标成 blank', () => {
    expect(line('   ').kind).toBe('blank')
  })

  it('别的都算叙述', () => {
    expect(line('雨下了一整夜。').kind).toBe('narration')
  })
})

describe('【关键】不该被误认成台词的', () => {
  it('句子里带逗号的长句', () => {
    expect(line('他抬起头，看着窗外：雨停了。').kind).toBe('narration')
  })

  it('角色名超过十个字就不算', () => {
    expect(line('一个穿着灰色长袍的老头子：你来了').kind).toBe('narration')
  })

  it('角色名里有句号不算', () => {
    expect(line('完了。他想：这下真完了').kind).toBe('narration')
  })

  it('角色名里有空格不算', () => {
    expect(line('他 说：走吧').kind).toBe('narration')
  })

  it('伏笔锚点那种整行注释不算台词', () => {
    expect(line('<!--埋#f7k2p9x-->').kind).toBe('narration')
  })

  it('便利贴的 @ 行不算台词', () => {
    expect(line('@身份：庄主').kind).toBe('narration')
  })

  it('问号感叹号开头的不算', () => {
    expect(line('？：这是什么').kind).toBe('narration')
  })
})

describe('parseScript · 整篇', () => {
  const doc = parseScript(SAMPLE)

  it('切出两场', () => {
    expect(doc.scenes.filter((s) => s.no >= 0)).toHaveLength(2)
    expect(doc.scenes[0]!.title).toContain('第一场')
  })

  it('每一行都归到某一场', () => {
    const d = doc.lines.filter((l) => l.kind === 'dialogue')
    expect(d.find((l) => l.text === '我不该来的。')!.scene).toBe(1)
    expect(d.find((l) => l.text === '还好。')!.scene).toBe(0)
  })

  it('场景标题本身属于它开启的那一场', () => {
    const heads = doc.lines.filter((l) => l.kind === 'scene')
    expect(heads.map((h) => h.scene)).toEqual([0, 1])
  })

  it('每场记下台词条数与出场角色', () => {
    expect(doc.scenes[0]).toMatchObject({ dialogueCount: 3, cast: ['李四', '王五'] })
    expect(doc.scenes[1]).toMatchObject({ dialogueCount: 1, cast: ['李四'] })
  })

  it('出场顺序按第一次说话', () => {
    expect(doc.scenes[0]!.cast).toEqual(['李四', '王五'])
  })

  it('还没写场景标题就开始写台词时，补一个「开场」，不丢内容', () => {
    const d = parseScript('李四：先说话\n王五：再说话')
    expect(d.scenes).toHaveLength(1)
    expect(d.scenes[0]!.no).toBe(-1)
    expect(d.scenes[0]!.dialogueCount).toBe(2)
  })

  it('空文档不炸', () => {
    expect(parseScript('')).toMatchObject({ scenes: [] })
  })
})

describe('castStats · 谁的戏多', () => {
  const stats = castStats(parseScript(SAMPLE))

  it('每个角色一条', () => {
    expect(stats.map((s) => s.who).sort()).toEqual(['李四', '王五'])
  })

  it('数台词条数', () => {
    expect(stats.find((s) => s.who === '李四')!.lines).toBe(2)
  })

  it('台词字数不含角色名与表演提示', () => {
    // 「还好。」三个字 + 「喝吧，凉了。」六个字 = 9
    expect(stats.find((s) => s.who === '王五')!.chars).toBe(9)
  })

  it('记下出现在哪几场', () => {
    expect(stats.find((s) => s.who === '李四')!.scenes).toEqual([0, 1])
  })

  it('【关键】按台词字数排序，戏多的在前', () => {
    // 剧本作者最想知道的就是谁被写多了、谁被写没了
    const s = castStats(parseScript('甲：一二三四五六七八九十\n乙：短'))
    expect(s.map((x) => x.who)).toEqual(['甲', '乙'])
  })

  it('字数一样时按先出场的排前面', () => {
    const s = castStats(parseScript('甲：一二\n乙：三四'))
    expect(s.map((x) => x.who)).toEqual(['甲', '乙'])
  })

  it('没有台词时是空的', () => {
    expect(castStats(parseScript('# 第一场\n（空场。）'))).toEqual([])
  })
})

describe('scriptSummary', () => {
  const sum = scriptSummary(parseScript(SAMPLE))

  it('场数、台词条数、角色数', () => {
    expect(sum).toMatchObject({ scenes: 2, dialogueLines: 4, cast: 2 })
  })

  it('台词字数与动作字数分开算', () => {
    expect(sum.dialogueChars).toBeGreaterThan(0)
    expect(sum.actionChars).toBeGreaterThan(0)
  })
})

describe('looksLikeScript · 只提示，不自动切', () => {
  it('剧本认得出来', () => {
    expect(looksLikeScript(SAMPLE)).toBe(true)
  })

  it('小说不会被认成剧本', () => {
    const novel = [
      '他从四十八楼掉下去的时候，脑子里想的不是死。',
      '',
      '而是昨天没写完的那一章。',
      '',
      '风把外套灌成一只鼓胀的口袋。',
      '',
      '他忽然想起十七岁那年。',
    ].join('\n')
    expect(looksLikeScript(novel)).toBe(false)
  })

  it('太短的不下结论', () => {
    expect(looksLikeScript('李四：走吧')).toBe(false)
  })

  it('空文档不是剧本', () => {
    expect(looksLikeScript('')).toBe(false)
  })
})

describe('formatScriptPlain · 导出排版', () => {
  const out = formatScriptPlain(parseScript(SAMPLE))

  it('场景顶格', () => {
    expect(out).toContain('\n第二场　外景·街口·夜\n')
  })

  it('角色名与台词分两行，台词缩得更深', () => {
    expect(out).toContain('    李四\n      你等很久了？')
  })

  it('表演提示跟在角色名后面', () => {
    expect(out).toContain('    王五（头也不抬）')
  })

  it('动作缩两格并保留括号', () => {
    expect(out).toContain('  （李四推门进来，雨水顺着伞尖滴在地板上。）')
  })

  it('不留三个以上连续空行', () => {
    expect(out).not.toMatch(/\n{3}/)
  })

  it('空剧本不炸', () => {
    expect(formatScriptPlain(parseScript(''))).toBe('\n')
  })
})
