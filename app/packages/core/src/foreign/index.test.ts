/**
 * 搬家测试。
 *
 * 导入最坏的失败方式不是「导不进来」，是**导进来一堆乱码**却看着像成功了。
 * 所以这里盯得最紧的是：RTF 里的中文有没有解对、排序有没有把第 10 章排到第 9 章前面、
 * 读不出来的文件有没有如实报出来。
 */

import { describe, it, expect } from 'vitest'
import {
  describePlan,
  parseScrivx,
  planFolderImport,
  planScrivenerImport,
  rtfToText,
  type FolderFile,
} from './index.js'

describe('rtfToText', () => {
  it('纯文本原样返回', () => {
    expect(rtfToText('他掉下去了。')).toBe('他掉下去了。')
  })

  it('拆掉控制字，只留文字', () => {
    expect(rtfToText('{\\rtf1\\ansi\\deff0 hello}')).toBe('hello')
  })

  it('\\par 变成换行', () => {
    expect(rtfToText('{\\rtf1 first\\par second}')).toBe('first\nsecond')
  })

  it('【关键】中文靠 \\uN 转义，必须解对', () => {
    // 解错的后果是几百万字变成乱码，而且看着像导入成功了
    const rtf = '{\\rtf1\\ansi \\u20182?\\u25481?\\u19979?\\u21435?\\u20102?}'
    expect(rtfToText(rtf)).toBe('他掉下去了')
  })

  it('\\uN 后面给老软件看的替代字符要吃掉', () => {
    expect(rtfToText('{\\rtf1 \\u20182?A}')).toBe('他A')
  })

  it('负数的 \\uN 也认（RTF 用有符号 16 位）', () => {
    // 0x4ED6 = 20182，超过 32767 的会写成负数
    expect(rtfToText('{\\rtf1 \\u-19662?}')).toBe(String.fromCodePoint(45874))
  })

  it('{\\*\\generator ...} 这类整组丢掉', () => {
    expect(rtfToText('{\\rtf1 {\\*\\generator Scrivener}正文}')).toBe('正文')
  })

  it('转义的花括号留下来', () => {
    expect(rtfToText('{\\rtf1 a\\{b\\}c}')).toBe('a{b}c')
  })

  it('不留三个以上连续空行', () => {
    expect(rtfToText('{\\rtf1 a\\par\\par\\par\\par b}')).toBe('a\n\nb')
  })

  it('空 RTF 不炸', () => {
    expect(rtfToText('{\\rtf1}')).toBe('')
  })
})

describe('parseScrivx', () => {
  const XML = `<?xml version="1.0"?>
<ScrivenerProject>
 <Binder>
  <BinderItem UUID="AAA" Type="DraftFolder">
   <Title>Manuscript</Title>
   <Children>
    <BinderItem UUID="C1" Type="Text"><Title>第一章 坠楼</Title></BinderItem>
    <BinderItem UUID="F1" Type="Folder">
     <Title>第一卷</Title>
     <Children>
      <BinderItem UUID="C2" Type="Text"><Title>第二章 醒来</Title></BinderItem>
     </Children>
    </BinderItem>
   </Children>
  </BinderItem>
  <BinderItem UUID="R1" Type="ResearchFolder"><Title>资料</Title></BinderItem>
 </Binder>
</ScrivenerProject>`

  it('扒出目录项', () => {
    const items = parseScrivx(XML)
    expect(items.map((i) => i.title)).toContain('第一章 坠楼')
    expect(items.map((i) => i.title)).toContain('第二章 醒来')
  })

  it('【关键】Research 里的东西不导进来', () => {
    // 一股脑导进来只会把作者的目录搅乱
    expect(parseScrivx(XML).map((i) => i.title)).not.toContain('资料')
  })

  it('层级算得出来', () => {
    const items = parseScrivx(XML)
    const c1 = items.find((i) => i.title === '第一章 坠楼')!
    const c2 = items.find((i) => i.title === '第二章 醒来')!
    expect(c2.depth).toBeGreaterThan(c1.depth)
  })

  it('文件夹节点标出来了', () => {
    expect(parseScrivx(XML).find((i) => i.title === '第一卷')!.isFolder).toBe(true)
  })

  it('XML 实体解出来', () => {
    const x = '<Binder><BinderItem UUID="A" Type="Text"><Title>甲&amp;乙</Title></BinderItem></Binder>'
    expect(parseScrivx(x)[0]!.title).toBe('甲&乙')
  })

  it('没有 DraftFolder 时退回整个 Binder，不至于什么都导不出来', () => {
    const x = '<Binder><BinderItem UUID="A" Type="Text"><Title>孤零零一章</Title></BinderItem></Binder>'
    expect(parseScrivx(x)).toHaveLength(1)
  })

  it('空 XML 不炸', () => {
    expect(parseScrivx('')).toEqual([])
  })
})

describe('planScrivenerImport', () => {
  const items = parseScrivx(
    '<Binder><BinderItem UUID="A" Type="Text"><Title>第一章</Title></BinderItem>' +
      '<BinderItem UUID="B" Type="Text"><Title>第二章</Title></BinderItem>' +
      '<BinderItem UUID="F" Type="Folder"><Title>第一卷</Title></BinderItem></Binder>',
  )

  it('把正文配上', () => {
    const p = planScrivenerImport(items, (id) =>
      id === 'A' ? '{\\rtf1 \\u20182?来了}' : id === 'B' ? '{\\rtf1 走了}' : null,
    )
    expect(p.chapters.map((c) => c.title)).toEqual(['第一章', '第二章'])
    expect(p.chapters[0]!.body).toBe('他来了')
  })

  it('文件夹节点没正文，不算跳过', () => {
    const p = planScrivenerImport(items, (id) => (id === 'F' ? null : '{\\rtf1 x}'))
    expect(p.skipped).toEqual([])
  })

  it('【关键】找不到正文的章节要如实报出来，不闷声跳过', () => {
    const p = planScrivenerImport(items, (id) => (id === 'A' ? '{\\rtf1 x}' : null))
    expect(p.skipped.some((s) => s.source.includes('第二章'))).toBe(true)
  })

  it('空正文也报', () => {
    const p = planScrivenerImport(items, () => '{\\rtf1 }')
    expect(p.skipped.length).toBeGreaterThan(0)
  })
})

describe('planFolderImport', () => {
  const f = (relPath: string, content = '正文'): FolderFile => ({ relPath, content })

  it('只收 txt 与 md', () => {
    const p = planFolderImport([f('a.txt'), f('b.md'), f('c.docx'), f('d.jpg')])
    expect(p.chapters).toHaveLength(2)
    expect(p.skipped.map((s) => s.source).sort()).toEqual(['c.docx', 'd.jpg'])
  })

  it('【关键】按数字排，第 10 章不会排到第 9 章前面', () => {
    // 按字符串排的话「10」排在「9」前面，整本书顺序就废了
    const p = planFolderImport([f('9-第九章.txt'), f('10-第十章.txt'), f('2-第二章.txt')])
    expect(p.chapters.map((c) => c.title)).toEqual(['第二章', '第九章', '第十章'])
  })

  it('标题去掉数字前缀与扩展名', () => {
    expect(planFolderImport([f('01. 坠楼.txt')]).chapters[0]!.title).toBe('坠楼')
  })

  it('去掉前缀之后是空的就用原文件名', () => {
    expect(planFolderImport([f('01.txt')]).chapters[0]!.title).toBe('01.txt')
  })

  it('子目录算层级，并且父目录排在前面', () => {
    const p = planFolderImport([f('2-第二卷/1-甲.txt'), f('1-第一卷/1-乙.txt')])
    expect(p.chapters.map((c) => c.title)).toEqual(['乙', '甲'])
    expect(p.chapters[0]!.depth).toBe(1)
  })

  it('空文件跳过并报出来', () => {
    const p = planFolderImport([f('a.txt', '   ')])
    expect(p.chapters).toEqual([])
    expect(p.skipped[0]!.why).toContain('空')
  })

  it('CRLF 统一成 LF', () => {
    expect(planFolderImport([f('a.txt', '甲\r\n乙')]).chapters[0]!.body).toBe('甲\n乙')
  })

  it('没有数字前缀的按名字排在后面', () => {
    const p = planFolderImport([f('附录.txt'), f('1-开头.txt')])
    expect(p.chapters[0]!.title).toBe('开头')
  })

  it('空文件夹不炸', () => {
    expect(planFolderImport([])).toMatchObject({ chapters: [], skipped: [] })
  })
})

describe('describePlan', () => {
  it('一句话说清楚要导多少', () => {
    const p = planFolderImport([{ relPath: 'a.txt', content: '一二三' }])
    expect(describePlan(p)).toContain('1 章')
  })

  it('跳过的也说出来', () => {
    const p = planFolderImport([{ relPath: 'a.jpg', content: 'x' }])
    expect(describePlan(p)).toContain('跳过 1')
  })
})
