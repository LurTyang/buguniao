import { describe, it, expect } from 'vitest'
import {
  parseCnNumber,
  findChapterCandidates,
  findVolumeCandidates,
  longestIncreasing,
  planImport,
  splitTitle,
  MAX_TITLE_LEN,
} from './index.js'

describe('parseCnNumber', () => {
  it('阿拉伯数字', () => {
    expect(parseCnNumber('12')).toBe(12)
    expect(parseCnNumber('0')).toBe(0)
    expect(parseCnNumber('365')).toBe(365)
  })

  it('全角阿拉伯数字', () => {
    expect(parseCnNumber('１２')).toBe(12)
  })

  it('个位', () => {
    expect(parseCnNumber('一')).toBe(1)
    expect(parseCnNumber('九')).toBe(9)
    expect(parseCnNumber('零')).toBe(0)
  })

  it('十位（含省略「一」的写法）', () => {
    expect(parseCnNumber('十')).toBe(10)
    expect(parseCnNumber('十三')).toBe(13)
    expect(parseCnNumber('二十')).toBe(20)
    expect(parseCnNumber('二十三')).toBe(23)
    expect(parseCnNumber('九十九')).toBe(99)
  })

  it('百位', () => {
    expect(parseCnNumber('一百')).toBe(100)
    expect(parseCnNumber('一百零五')).toBe(105)
    expect(parseCnNumber('二百三十四')).toBe(234)
    expect(parseCnNumber('九百九十九')).toBe(999)
  })

  it('千位', () => {
    expect(parseCnNumber('一千')).toBe(1000)
    expect(parseCnNumber('一千零一十二')).toBe(1012)
    expect(parseCnNumber('三千五百')).toBe(3500)
  })

  it('万位', () => {
    expect(parseCnNumber('一万')).toBe(10000)
    expect(parseCnNumber('一万零一')).toBe(10001)
    expect(parseCnNumber('两万三千')).toBe(23000)
  })

  it('「两」等同于二', () => {
    expect(parseCnNumber('两百')).toBe(200)
  })

  it('大写数字', () => {
    expect(parseCnNumber('壹佰贰拾叁')).toBe(123)
  })

  it('〇', () => {
    expect(parseCnNumber('〇')).toBe(0)
  })

  it('无法解析时返回 null', () => {
    expect(parseCnNumber('')).toBeNull()
    expect(parseCnNumber('abc')).toBeNull()
    expect(parseCnNumber('第')).toBeNull()
    expect(parseCnNumber('一二三abc')).toBeNull()
  })
})

describe('findChapterCandidates', () => {
  it('识别第X章', () => {
    const c = findChapterCandidates(['第一章 坠楼'])
    expect(c).toHaveLength(1)
    expect(c[0]?.num).toBe(1)
    expect(c[0]?.title).toBe('第一章 坠楼')
  })

  it('识别节/回/话', () => {
    expect(findChapterCandidates(['第二节'])[0]?.num).toBe(2)
    expect(findChapterCandidates(['第三回'])[0]?.num).toBe(3)
    expect(findChapterCandidates(['第四话'])[0]?.num).toBe(4)
    expect(findChapterCandidates(['第五話'])[0]?.num).toBe(5)
  })

  it('识别 Chapter N', () => {
    expect(findChapterCandidates(['Chapter 7'])[0]?.num).toBe(7)
    expect(findChapterCandidates(['chapter 7'])[0]?.num).toBe(7)
  })

  it('允许「第 一 章」这样带空格', () => {
    expect(findChapterCandidates(['第 12 章 醒来'])[0]?.num).toBe(12)
  })

  it('超长的行不算标题', () => {
    const long = '第一章' + '啊'.repeat(MAX_TITLE_LEN)
    expect(findChapterCandidates([long])).toEqual([])
  })

  it('不在行首的「第三章」不算标题', () => {
    expect(findChapterCandidates(['他想起第三章里师父说过的话。'])).toEqual([])
  })

  it('记录前后是否有空行（供界面显示置信度）', () => {
    const c = findChapterCandidates(['', '第一章', '正文'])
    expect(c[0]?.hints.blankBefore).toBe(true)
    expect(c[0]?.hints.blankAfter).toBe(false)
  })

  it('空输入', () => {
    expect(findChapterCandidates([])).toEqual([])
  })
})

describe('findVolumeCandidates', () => {
  it('识别第X卷与卷X', () => {
    expect(findVolumeCandidates(['第一卷 少年游'])[0]?.num).toBe(1)
    expect(findVolumeCandidates(['卷二 江湖远'])[0]?.num).toBe(2)
  })

  it('卷不混入章节候选', () => {
    expect(findChapterCandidates(['第一卷 少年游'])).toEqual([])
  })
})

describe('longestIncreasing · 剔除噪音的核心', () => {
  const C = (line: number, num: number) => ({
    line,
    num,
    title: `第${num}章`,
    hints: { blankBefore: true, blankAfter: true, short: true },
  })

  it('完整递增序列全部保留', () => {
    const list = [C(0, 1), C(10, 2), C(20, 3)]
    expect(longestIncreasing(list)).toHaveLength(3)
  })

  it('剔除中间插入的孤立噪音', () => {
    // 正文里提到「第三章」，出现在第 5 章和第 6 章之间
    const list = [C(0, 1), C(10, 2), C(20, 3), C(30, 4), C(40, 5), C(45, 3), C(50, 6)]
    const kept = longestIncreasing(list)
    expect(kept.map((c) => c.num)).toEqual([1, 2, 3, 4, 5, 6])
    expect(kept.map((c) => c.line)).not.toContain(45)
  })

  it('剔除多处噪音', () => {
    const list = [C(0, 1), C(5, 99), C(10, 2), C(15, 1), C(20, 3), C(25, 50), C(30, 4)]
    expect(longestIncreasing(list).map((c) => c.num)).toEqual([1, 2, 3, 4])
  })

  it('严格递增，重复序号只留一个', () => {
    const list = [C(0, 1), C(10, 1), C(20, 2)]
    expect(longestIncreasing(list)).toHaveLength(2)
  })

  it('全部是噪音（无递增关系）时只留一个', () => {
    expect(longestIncreasing([C(0, 9), C(10, 5), C(20, 1)])).toHaveLength(1)
  })

  it('空输入', () => {
    expect(longestIncreasing([])).toEqual([])
  })

  it('一千章的长序列性能可接受', () => {
    const list = Array.from({ length: 1000 }, (_, i) => C(i * 10, i + 1))
    const t = Date.now()
    expect(longestIncreasing(list)).toHaveLength(1000)
    expect(Date.now() - t).toBeLessThan(200)
  })
})

describe('planImport · 完整分章', () => {
  const novel = [
    '第九神座',
    '作者：明听',
    '',
    '第一章 坠楼',
    '',
    '他从四十八楼掉下去的时候。',
    '脑子里想的不是死。',
    '',
    '第二章 醒来',
    '',
    '他醒来时，看到了天花板。',
    '',
    '第三章 玉佩',
    '',
    '他想起第一章里说过的那块玉佩。',
    '玉佩还在。',
  ].join('\n')

  it('正确切成三章', () => {
    const plan = planImport(novel)
    expect(plan.chapters.map((c) => c.title)).toEqual(['第一章 坠楼', '第二章 醒来', '第三章 玉佩'])
  })

  it('【关键】正文里提到的「第一章」不被误认为标题', () => {
    const plan = planImport(novel)
    expect(plan.chapters).toHaveLength(3)
    expect(plan.chapters[2]?.body).toContain('他想起第一章里说过的那块玉佩。')
  })

  it('章节正文正确，且去掉了首尾空行', () => {
    const plan = planImport(novel)
    expect(plan.chapters[0]?.body).toBe('他从四十八楼掉下去的时候。\n脑子里想的不是死。')
    expect(plan.chapters[1]?.body).toBe('他醒来时，看到了天花板。')
  })

  it('第一章之前的内容进 preamble', () => {
    expect(planImport(novel).preamble).toBe('第九神座\n作者：明听')
  })

  it('没有前置内容时 preamble 为 null', () => {
    expect(planImport('第一章\n正文').preamble).toBeNull()
  })

  it('完全没有章节标题时全部进 preamble', () => {
    const plan = planImport('就是一段没有分章的文字。\n第二行。')
    expect(plan.chapters).toEqual([])
    expect(plan.preamble).toBe('就是一段没有分章的文字。\n第二行。')
  })

  it('被剔除的候选出现在 rejected 里，供界面展示', () => {
    const text = ['第一章', '正文', '第一章', '又是正文', '第二章', '正文'].join('\n')
    const plan = planImport(text)
    expect(plan.chapters).toHaveLength(2)
    expect(plan.rejected).toHaveLength(1)
  })

  it('CRLF 也能正确处理', () => {
    const plan = planImport(novel.replace(/\n/g, '\r\n'))
    expect(plan.chapters).toHaveLength(3)
    expect(plan.chapters[0]?.body).toBe('他从四十八楼掉下去的时候。\n脑子里想的不是死。')
  })

  it('检测到卷标记但不参与分章', () => {
    const text = ['第一卷 少年游', '', '第一章', '正文', '', '第二卷 江湖远', '', '第二章', '正文'].join('\n')
    const plan = planImport(text)
    expect(plan.chapters).toHaveLength(2)
    expect(plan.volumes.map((v) => v.title)).toEqual(['第一卷 少年游', '第二卷 江湖远'])
  })
})

describe('planImport · 手动指定分章点', () => {
  const text = ['开头', '分界线', '中段', '另一条分界线', '尾巴'].join('\n')

  it('forceLines 完全按作者指定的来', () => {
    const plan = planImport(text, { forceLines: [1, 3] })
    expect(plan.chapters.map((c) => c.title)).toEqual(['分界线', '另一条分界线'])
    expect(plan.chapters[0]?.body).toBe('中段')
    expect(plan.chapters[1]?.body).toBe('尾巴')
    expect(plan.preamble).toBe('开头')
  })

  it('forceLines 可以剔除自动识别出的章节', () => {
    const novel = ['第一章', 'a', '第二章', 'b', '第三章', 'c'].join('\n')
    const plan = planImport(novel, { forceLines: [0, 4] })
    expect(plan.chapters.map((c) => c.title)).toEqual(['第一章', '第三章'])
    expect(plan.chapters[0]?.body).toBe('a\n第二章\nb')
  })

  it('越界的行号被忽略', () => {
    expect(planImport(text, { forceLines: [999] }).chapters).toEqual([])
  })

  it('空 forceLines 表示不分章', () => {
    const plan = planImport('第一章\n正文', { forceLines: [] })
    expect(plan.chapters).toEqual([])
    expect(plan.preamble).toBe('第一章\n正文')
  })
})

describe('splitTitle', () => {
  it('拆出序号部分和名字部分', () => {
    expect(splitTitle('第三章 坠楼')).toEqual({ prefix: '第三章', name: '坠楼' })
  })

  it('各种分隔符都能去掉', () => {
    expect(splitTitle('第三章：坠楼').name).toBe('坠楼')
    expect(splitTitle('第三章、坠楼').name).toBe('坠楼')
    expect(splitTitle('第三章 - 坠楼').name).toBe('坠楼')
  })

  it('只有序号没有名字', () => {
    expect(splitTitle('第三章')).toEqual({ prefix: '第三章', name: '' })
  })

  it('不匹配任何模式时整体作为名字', () => {
    expect(splitTitle('楔子')).toEqual({ prefix: '', name: '楔子' })
  })

  it('Chapter N', () => {
    expect(splitTitle('Chapter 7: Falling')).toEqual({ prefix: 'Chapter 7', name: 'Falling' })
  })
})

describe('真实规模压力测试', () => {
  it('300 章、约 90 万字的 txt 能正确切分', () => {
    const parts: string[] = ['某某传', '作者：某人', '']
    for (let i = 1; i <= 300; i++) {
      parts.push(`第${i}章 第${i}回合`, '')
      for (let p = 0; p < 10; p++) {
        parts.push(`这是第${i}章的第${p}段。他从四十八楼掉下去的时候，脑子里想的不是死，而是昨天没写完的那一章。风声在耳边呼啸。`.repeat(3))
      }
      parts.push('')
    }
    // 混入噪音：正文里提到前面的章节
    parts.splice(200, 0, '他想起第五章里的那句话。')

    const text = parts.join('\n')
    const t = Date.now()
    const plan = planImport(text)
    const elapsed = Date.now() - t

    expect(plan.chapters).toHaveLength(300)
    expect(plan.chapters[0]?.title).toBe('第1章 第1回合')
    expect(plan.chapters[299]?.title).toBe('第300章 第300回合')
    expect(plan.preamble).toBe('某某传\n作者：某人')
    expect(elapsed).toBeLessThan(2000)
  })
})
