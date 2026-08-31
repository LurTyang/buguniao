/**
 * AI 回答解析测试。
 *
 * 这个模块最重要的性质不是「拆得多准」，而是**拆不出来时不吞内容**。
 * 模型偶尔不听话是常态；作者等了三十秒看见空白，那是把他的时间和钱一起烧了。
 */

import { describe, it, expect } from 'vitest'
import {
  compareInline,
  countChanges,
  parseContinuations,
  parsePolish,
  parseProofread,
} from './index.js'

describe('parseContinuations · 续写拆成几个方向', () => {
  const three = [
    '### 方向一：他认命',
    '他没有挣扎，任由风把外套掀起来。',
    '',
    '### 方向二：他抓住了什么',
    '指尖擦过窗沿，血肉翻开。',
    '',
    '### 方向三：有人接住了他',
    '半空里伸出一只手。',
  ].join('\n')

  it('拆出三个方向', () => {
    const r = parseContinuations(three)
    expect(r).toHaveLength(3)
    expect(r[0]!.gist).toBe('他认命')
    expect(r[2]!.text).toBe('半空里伸出一只手。')
  })

  it('方向标题下的正文不带标题行', () => {
    expect(parseContinuations(three)[1]!.text).toBe('指尖擦过窗沿，血肉翻开。')
  })

  it('用中文顿号或点号分隔也认', () => {
    expect(parseContinuations('## 方向一、他认命\n正文').map((c) => c.gist)).toEqual(['他认命'])
  })

  it('用阿拉伯数字也认', () => {
    expect(parseContinuations('### 方向 1：甲\n正文甲')).toHaveLength(1)
  })

  it('模型多给了一段开场白，不影响拆分', () => {
    const r = parseContinuations('好的，我给你三个方向：\n\n### 方向一：甲\n正文甲\n\n### 方向二：乙\n正文乙')
    expect(r).toHaveLength(2)
    expect(r[0]!.text).toBe('正文甲')
  })

  it('【关键】格式完全没对上时，整坨当一个方向交回去，不丢内容', () => {
    const r = parseContinuations('他就那么掉了下去，谁也没接住。')
    expect(r).toHaveLength(1)
    expect(r[0]!.text).toBe('他就那么掉了下去，谁也没接住。')
    expect(r[0]!.gist).toBe('')
  })

  it('空回答返回空数组', () => {
    expect(parseContinuations('   \n  ')).toEqual([])
  })

  it('正文里的多段落留着', () => {
    const r = parseContinuations('### 方向一：甲\n第一段。\n\n第二段。')
    expect(r[0]!.text).toBe('第一段。\n\n第二段。')
  })
})

describe('parsePolish · 分开正文与说明', () => {
  const good = [
    '## 润色结果',
    '他从四十八楼坠下，风灌满了衬衫。',
    '',
    '## 改动说明',
    '- 「掉下去」换成「坠下」，更书面',
    '- 补了一个身体感受',
  ].join('\n')

  it('正文只含正文', () => {
    expect(parsePolish(good).text).toBe('他从四十八楼坠下，风灌满了衬衫。')
  })

  it('说明只含说明', () => {
    expect(parsePolish(good).notes).toContain('更书面')
    expect(parsePolish(good).notes).not.toContain('坠下，风灌满')
  })

  it('认出了格式时 structured 为真', () => {
    expect(parsePolish(good).structured).toBe(true)
  })

  it('【关键】认不出格式时整坨当正文，并标明没认出来', () => {
    const r = parsePolish('他从四十八楼坠下。\n\n我把「掉」改成了「坠」。')
    expect(r.structured).toBe(false)
    expect(r.text).toContain('四十八楼坠下')
    expect(r.text).toContain('改成了')
  })

  it('只有正文没有说明也行', () => {
    const r = parsePolish('### 润色结果\n改好的文字。')
    expect(r.text).toBe('改好的文字。')
    expect(r.notes).toBe('')
  })

  it('空回答不炸', () => {
    expect(parsePolish('')).toMatchObject({ text: '', structured: false })
  })
})

describe('parseProofread · 抓虫清单', () => {
  const list = [
    '### 1. 玉佩的位置前后矛盾',
    '- 类型：前后矛盾',
    '- 位置：胸口的玉佩还在',
    '- 为什么：第三章里玉佩已经被王五拿走了',
    '',
    '### 2. 李四的年龄对不上',
    '- 类型：设定冲突',
    '- 位置：十七岁的李四',
    '- 为什么：设定集里写的是二十三岁',
  ].join('\n')

  it('拆出两条', () => {
    expect(parseProofread(list)).toHaveLength(2)
  })

  it('字段都对上了', () => {
    const [a] = parseProofread(list)
    expect(a).toMatchObject({
      title: '玉佩的位置前后矛盾',
      kind: '前后矛盾',
      quote: '胸口的玉佩还在',
      why: '第三章里玉佩已经被王五拿走了',
    })
  })

  it('标题里的序号被剥掉', () => {
    expect(parseProofread(list)[1]!.title).toBe('李四的年龄对不上')
  })

  it('引用原文换行写也能接上', () => {
    const r = parseProofread(
      '### 甲\n- 类型：前后矛盾\n- 位置：第一行\n第二行\n- 为什么：因为如此',
    )
    expect(r[0]!.quote).toBe('第一行\n第二行')
  })

  it('「原因」也当成「为什么」', () => {
    const r = parseProofread('### 甲\n- 类型：X\n- 位置：Y\n- 原因：Z')
    expect(r[0]!.why).toBe('Z')
  })

  it('【关键】说没问题时返回空数组，而不是硬拆出一条', () => {
    expect(parseProofread('通读下来没有发现问题。')).toEqual([])
  })

  it('只有标题没有内容的条目会被丢掉，不留空壳', () => {
    expect(parseProofread('### 只有一个标题')).toEqual([])
  })
})

describe('compareInline · 逐字对比', () => {
  it('相同部分标 same', () => {
    const segs = compareInline('他掉下去了', '他掉下去了')
    expect(segs).toEqual([{ kind: 'same', text: '他掉下去了' }])
  })

  it('改一个字时只标那一个字', () => {
    // 按行比会把整句标成一删一增，等于什么都没说
    const segs = compareInline('他掉下去了。', '他坠下去了。')
    expect(segs.filter((s) => s.kind === 'del').map((s) => s.text)).toEqual(['掉'])
    expect(segs.filter((s) => s.kind === 'add').map((s) => s.text)).toEqual(['坠'])
  })

  it('相邻的同类合并成一块', () => {
    const segs = compareInline('甲乙丙', '甲丁戊丙')
    expect(segs.filter((s) => s.kind === 'add')).toHaveLength(1)
  })

  it('纯新增', () => {
    const segs = compareInline('甲', '甲乙丙')
    expect(segs.find((s) => s.kind === 'add')?.text).toBe('乙丙')
  })

  it('纯删除', () => {
    const segs = compareInline('甲乙丙', '甲')
    expect(segs.find((s) => s.kind === 'del')?.text).toBe('乙丙')
  })

  it('两边都空不炸', () => {
    expect(compareInline('', '')).toEqual([])
  })

  it('拼回去等于两边原文', () => {
    const before = '他从四十八楼掉下去的时候，脑子里想的不是死。'
    const after = '他从四十八楼坠落时，脑子里想的并不是死。'
    const segs = compareInline(before, after)
    const rebuiltBefore = segs.filter((s) => s.kind !== 'add').map((s) => s.text).join('')
    const rebuiltAfter = segs.filter((s) => s.kind !== 'del').map((s) => s.text).join('')
    expect(rebuiltBefore).toBe(before)
    expect(rebuiltAfter).toBe(after)
  })
})

describe('countChanges', () => {
  it('数出增删各多少字', () => {
    const segs = compareInline('他掉下去了。', '他坠下去了。')
    expect(countChanges(segs)).toEqual({ added: 1, removed: 1 })
  })

  it('没改动时是 0', () => {
    expect(countChanges(compareInline('甲', '甲'))).toEqual({ added: 0, removed: 0 })
  })
})
