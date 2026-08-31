import { describe, it, expect } from 'vitest'
import {
  INDENT,
  renderBody,
  splitParagraphs,
  renderFullText,
  renderPerChapter,
  toDocxBlocks,
  previewExport,
} from './index.js'
import type { ExportChapter } from './index.js'

const chapters: ExportChapter[] = [
  {
    volume: '第一卷 少年游',
    title: '第一章 坠楼',
    body: '他从四十八楼掉下去的时候。\n\n脑子里想的不是死。',
  },
  {
    volume: '第一卷 少年游',
    title: '第二章 醒来',
    body: '他醒了。',
  },
  {
    volume: '第二卷 江湖远',
    title: '第三章 出门',
    body: '他出门了。',
  },
]

describe('renderBody · 文本变换', () => {
  it('默认加全角首行缩进', () => {
    expect(renderBody('第一段。\n\n第二段。')).toBe(`${INDENT}第一段。\n\n${INDENT}第二段。`)
  })

  it('可关闭缩进', () => {
    expect(renderBody('第一段。', { indentFirstLine: false })).toBe('第一段。')
  })

  it('【默认】移除伏笔标记，稿子发给编辑时不该带这些', () => {
    const body = '他摸了摸胸口，<!--埋#f7k2p9x-->那块玉佩还在<!--/埋#f7k2p9x-->。'
    expect(renderBody(body, { indentFirstLine: false })).toBe('他摸了摸胸口，那块玉佩还在。')
  })

  it('可保留伏笔标记（自己留档时用）', () => {
    const body = '<!--埋#f7k2p9x-->甲<!--/埋#f7k2p9x-->'
    expect(renderBody(body, { indentFirstLine: false, stripForeshadow: false, stripComments: false })).toContain(
      '<!--埋#f7k2p9x-->',
    )
  })

  it('移除作者写的备注注释', () => {
    expect(renderBody('正文<!-- 这里要改 -->内容', { indentFirstLine: false })).toBe('正文内容')
  })

  it('双向链接转纯文本', () => {
    expect(renderBody('[[李四]]走了', { indentFirstLine: false })).toBe('李四走了')
  })

  it('带别名的双向链接取别名', () => {
    expect(renderBody('[[李四|那个断眉少年]]走了', { indentFirstLine: false })).toBe('那个断眉少年走了')
  })

  it('可保留双向链接原样', () => {
    expect(renderBody('[[李四]]', { indentFirstLine: false, stripWikiLinks: false })).toBe('[[李四]]')
  })

  it('Markdown 标记转纯文本', () => {
    expect(renderBody('# 标题\n\n**加粗**和*斜体*', { indentFirstLine: false })).toBe('标题\n\n加粗和斜体')
  })

  it('链接只留显示文字', () => {
    expect(renderBody('[参考](https://a.com)', { indentFirstLine: false })).toBe('参考')
  })

  it('防御性剥离 front-matter', () => {
    const raw = '---\nid: ch-x\ntitle: 甲\n---\n\n正文'
    expect(renderBody(raw, { indentFirstLine: false })).toBe('正文')
  })

  it('空正文返回空串', () => {
    expect(renderBody('')).toBe('')
    expect(renderBody('\n\n\n')).toBe('')
  })

  it('自定义段落分隔符', () => {
    expect(renderBody('甲\n\n乙', { indentFirstLine: false, paragraphSeparator: '\n' })).toBe('甲\n乙')
  })
})

describe('splitParagraphs · 两种排版都要支持', () => {
  it('段落之间空一行', () => {
    expect(splitParagraphs('甲\n\n乙')).toEqual(['甲', '乙'])
  })

  it('段落之间不空行，直接换行', () => {
    expect(splitParagraphs('甲\n乙')).toEqual(['甲', '乙'])
  })

  it('多个连续空行只当一个分隔', () => {
    expect(splitParagraphs('甲\n\n\n\n乙')).toEqual(['甲', '乙'])
  })

  it('去掉每段首尾空白', () => {
    expect(splitParagraphs('  甲  \n  乙  ')).toEqual(['甲', '乙'])
  })

  it('CRLF', () => {
    expect(splitParagraphs('甲\r\n\r\n乙')).toEqual(['甲', '乙'])
  })

  it('空输入', () => {
    expect(splitParagraphs('')).toEqual([])
    expect(splitParagraphs('   \n  \n ')).toEqual([])
  })
})

describe('renderFullText · 整书导出', () => {
  it('包含所有章节与标题', () => {
    const text = renderFullText(chapters)
    expect(text).toContain('第一章 坠楼')
    expect(text).toContain('第二章 醒来')
    expect(text).toContain('第三章 出门')
  })

  it('换卷时插入卷标题，同卷内不重复插', () => {
    const text = renderFullText(chapters)
    expect(text.match(/第一卷 少年游/g)).toHaveLength(1)
    expect(text.match(/第二卷 江湖远/g)).toHaveLength(1)
  })

  it('卷标题出现在该卷第一章之前', () => {
    const text = renderFullText(chapters)
    expect(text.indexOf('第一卷 少年游')).toBeLessThan(text.indexOf('第一章 坠楼'))
    expect(text.indexOf('第二卷 江湖远')).toBeLessThan(text.indexOf('第三章 出门'))
  })

  it('可关闭章节标题', () => {
    const text = renderFullText(chapters, { includeChapterTitle: false })
    expect(text).not.toContain('第一章 坠楼')
    expect(text).toContain('他从四十八楼掉下去的时候。')
  })

  it('无卷结构时不插卷标题', () => {
    const text = renderFullText([{ title: '第一章', body: '正文' }])
    expect(text).toBe(`第一章\n\n${INDENT}正文`)
  })

  it('自定义章节分隔符', () => {
    const text = renderFullText([{ title: '甲', body: 'a' }, { title: '乙', body: 'b' }], {
      chapterSeparator: '\n=====\n',
      indentFirstLine: false,
    })
    expect(text).toBe('甲\n\na\n=====\n乙\n\nb')
  })

  it('空章节只输出标题', () => {
    expect(renderFullText([{ title: '第一章', body: '' }])).toBe('第一章')
  })

  it('空输入返回空串', () => {
    expect(renderFullText([])).toBe('')
  })
})

describe('renderPerChapter · 按章分文件', () => {
  it('每章一个文件，文件名带四位序号', () => {
    const files = renderPerChapter(chapters)
    expect(files.map((f) => f.fileName)).toEqual([
      '0001-第一章 坠楼.txt',
      '0002-第二章 醒来.txt',
      '0003-第三章 出门.txt',
    ])
  })

  it('文件内容含标题与正文', () => {
    const files = renderPerChapter(chapters, { indentFirstLine: false })
    expect(files[1]?.content).toBe('第二章 醒来\n\n他醒了。')
  })

  it('自定义文件名模板', () => {
    const files = renderPerChapter(chapters, { fileNamePattern: '{卷}_{序号}_{标题}.txt' })
    expect(files[0]?.fileName).toBe('第一卷 少年游_0001_第一章 坠楼.txt')
  })

  it('标题里的非法字符被替换', () => {
    const files = renderPerChapter([{ title: '第一章：坠/楼', body: 'a' }])
    expect(files[0]?.fileName).toBe('0001-第一章：坠_楼.txt')
  })

  it('伏笔标记同样被移除', () => {
    const files = renderPerChapter([
      { title: '甲', body: '<!--埋#f7k2p9x-->内容<!--/埋#f7k2p9x-->' },
    ], { indentFirstLine: false })
    expect(files[0]?.content).toBe('甲\n\n内容')
  })

  it('空章节至少输出标题，不产生空文件', () => {
    expect(renderPerChapter([{ title: '第一章', body: '' }])[0]?.content).toBe('第一章')
  })

  it('空输入', () => {
    expect(renderPerChapter([])).toEqual([])
  })
})

describe('toDocxBlocks · Word 结构化输出', () => {
  it('卷/章/正文分成不同类型的块', () => {
    const blocks = toDocxBlocks(chapters)
    expect(blocks[0]).toEqual({ kind: 'volume', text: '第一卷 少年游' })
    expect(blocks[1]).toEqual({ kind: 'chapter', text: '第一章 坠楼' })
    expect(blocks[2]).toEqual({ kind: 'paragraph', text: '他从四十八楼掉下去的时候。' })
  })

  it('【关键】不塞全角空格 —— Word 里用段落样式缩进', () => {
    for (const b of toDocxBlocks(chapters)) {
      expect(b.text.startsWith(INDENT)).toBe(false)
    }
  })

  it('即使显式要求缩进也不塞（docx 里由样式负责）', () => {
    const blocks = toDocxBlocks(chapters, { indentFirstLine: true })
    expect(blocks.every((b) => !b.text.startsWith(INDENT))).toBe(true)
  })

  it('每段一个块', () => {
    const blocks = toDocxBlocks([{ title: '甲', body: '第一段\n\n第二段\n\n第三段' }])
    expect(blocks.filter((b) => b.kind === 'paragraph')).toHaveLength(3)
  })

  it('换卷只输出一次卷块', () => {
    expect(toDocxBlocks(chapters).filter((b) => b.kind === 'volume')).toHaveLength(2)
  })

  it('伏笔标记被移除', () => {
    const blocks = toDocxBlocks([{ title: '甲', body: '<!--埋#f7k2p9x-->内容<!--/埋#f7k2p9x-->' }])
    expect(blocks.find((b) => b.kind === 'paragraph')?.text).toBe('内容')
  })
})

describe('previewExport · 导出前预览', () => {
  it('统计章节数与卷数', () => {
    expect(previewExport(chapters)).toMatchObject({ chapterCount: 3, volumeCount: 2 })
  })

  it('统计字符数与字节数', () => {
    const p = previewExport(chapters)
    expect(p.chars).toBeGreaterThan(0)
    expect(p.bytes).toBeGreaterThan(p.chars) // 中文 UTF-8 每字 3 字节
  })

  it('无卷时 volumeCount 为 0', () => {
    expect(previewExport([{ title: '甲', body: 'a' }]).volumeCount).toBe(0)
  })

  it('空输入', () => {
    expect(previewExport([])).toMatchObject({ chapterCount: 0, volumeCount: 0, chars: 0 })
  })
})

describe('导出永不修改原稿', () => {
  it('renderBody 是纯函数', () => {
    const body = '原始内容<!--埋#f7k2p9x-->甲<!--/埋#f7k2p9x-->'
    const before = body
    renderBody(body)
    expect(body).toBe(before)
  })

  it('renderFullText 不改动传入的章节对象', () => {
    const input: ExportChapter[] = [{ title: '甲', body: '正文', volume: '卷一' }]
    const snapshot = JSON.stringify(input)
    renderFullText(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})

describe('真实导出场景', () => {
  it('一本带伏笔、双链、Markdown 标记的书，导出后是干净的纯文本', () => {
    const book: ExportChapter[] = [
      {
        volume: '第一卷',
        title: '第一章 坠楼',
        body: [
          '# 第一章 坠楼',
          '',
          '他从四十八楼掉下去的时候，<!--埋#f7k2p9x-->胸口的玉佩还在<!--/埋#f7k2p9x-->。',
          '',
          '**[[李四]]** 在楼下抬头看着。<!-- 这段要改 -->',
          '',
          '> 他想起了那句话。',
        ].join('\n'),
      },
    ]

    const text = renderFullText(book)

    // 该没有的都没有
    expect(text).not.toContain('<!--')
    expect(text).not.toContain('[[')
    expect(text).not.toContain('**')
    expect(text).not.toContain('#')
    expect(text).not.toContain('>')

    // 该有的都有
    expect(text).toContain('第一卷')
    expect(text).toContain('第一章 坠楼')
    expect(text).toContain('胸口的玉佩还在')
    expect(text).toContain('李四')
    expect(text).toContain('他想起了那句话。')

    // 每段都有缩进
    for (const line of text.split('\n').filter((l) => l.trim() !== '')) {
      const isTitle = line === '第一卷' || line === '第一章 坠楼'
      if (!isTitle) expect(line.startsWith(INDENT)).toBe(true)
    }
  })
})

describe('剧本排版导出', () => {
  const SCRIPT = [
    '# 第一场　内景·咖啡馆·日',
    '',
    '（李四推门进来。）',
    '',
    '李四：你等很久了？',
    '王五（头也不抬）：还好。',
  ].join('\n')

  it('【关键】不开这个选项时，剧本走普通排版', () => {
    const r = renderBody(SCRIPT, {})
    // 普通排版会把每行当一段加首行缩进
    expect(r).toContain('　　李四：你等很久了？')
  })

  it('开了之后按缩进层次排', () => {
    const r = renderBody(SCRIPT, { scriptLayout: true })
    expect(r).toContain('第一场　内景·咖啡馆·日')
    expect(r).toMatch(/^ {2}（李四推门进来。）$/m)
    expect(r).toMatch(/^ {4}李四$/m)
    expect(r).toMatch(/^ {6}你等很久了？$/m)
  })

  it('表演提示跟着角色名走', () => {
    expect(renderBody(SCRIPT, { scriptLayout: true })).toMatch(/^ {4}王五（头也不抬）$/m)
  })

  it('【关键】开了选项但这一章不是剧本时，仍走普通排版', () => {
    // 一本小说里夹着两章剧本很常见，无条件套上去会把正常章节排得莫名其妙
    const prose = '他从四十八楼掉下去。\n\n玉佩还在胸口。'
    const r = renderBody(prose, { scriptLayout: true })
    expect(r).toContain('　　他从四十八楼掉下去。')
  })

  it('剧本排版下双链仍然会被清掉', () => {
    const r = renderBody('# 甲\n李四：我找过[[王五]]了。\n王五：嗯。', { scriptLayout: true })
    expect(r).not.toContain('[[')
    expect(r).toContain('王五')
  })

  it('一个字都不会丢', () => {
    const r = renderBody(SCRIPT, { scriptLayout: true })
    for (const must of ['李四推门进来', '你等很久了', '还好']) expect(r).toContain(must)
  })
})
