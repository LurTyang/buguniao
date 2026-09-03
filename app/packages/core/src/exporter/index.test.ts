import { describe, it, expect } from 'vitest'
import {
  INDENT,
  renderBody,
  splitParagraphs,
  renderFullText,
  renderPerChapter,
  toDocxBlocks,
  previewExport,
  stripFloatMarks,
  spaceCjkLatin,
  tidySpaces,
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

describe('0.4 · 导出的几档新选项', () => {
  describe('@ 标记 —— 0.3 之前它是原样带出去的', () => {
    it('【关键】行首那个 @ 去掉，那句话留着', () => {
      expect(stripFloatMarks('@表面身份：城南药铺学徒')).toBe('表面身份：城南药铺学徒')
    })

    it('单独一行的 @ 整行去掉', () => {
      expect(stripFloatMarks(['前', '@', '后'].join('\n'))).toBe(['前', '后'].join('\n'))
    })

    it('行内成对的两个 @ 都去掉，中间的字留着', () => {
      expect(stripFloatMarks('年龄：@十七岁@，实为三百余岁')).toBe('年龄：十七岁，实为三百余岁')
    })

    it('【关键】邮箱里那个 @ 不许动 —— 它不在行首，也不成对', () => {
      expect(stripFloatMarks('联系 lisi@qq.com')).toBe('联系 lisi@qq.com')
    })

    it('转义的 \@ 还原成真的 @，不是删掉', () => {
      expect(stripFloatMarks('lisi\@qq.com')).toBe('lisi@qq.com')
    })

    it('三个 @ 不成对，一个都不动', () => {
      expect(stripFloatMarks('@甲@乙@')).toBe('@甲@乙@')
    })

    it('默认就是去掉的 —— 发给编辑的稿子里不该有这个符号', () => {
      expect(renderBody('@浮出的一句话')).toContain('浮出的一句话')
      expect(renderBody('@浮出的一句话')).not.toContain('@')
    })
  })

  describe('md 保留语法，txt 不保留', () => {
    const src = '## 第一章\n\n他**站**在窗前。\n\n> 引一句'

    it('txt 把 Markdown 剥成纯文字', () => {
      const out = renderBody(src)
      expect(out).not.toContain('##')
      expect(out).not.toContain('**')
      expect(out).not.toContain('>')
      expect(out).toContain('第一章')
    })

    it('【关键】md 原样保留 —— 剥掉了就搬不回来了', () => {
      const out = renderBody(src, { keepMarkdown: true })
      expect(out).toContain('## 第一章')
      expect(out).toContain('**站**')
      expect(out).toContain('> 引一句')
    })

    it('md 不重排段落，也不加首行缩进', () => {
      const out = renderBody('一段\n\n二段', { keepMarkdown: true, indentFirstLine: true })
      expect(out).toBe('一段\n\n二段')
    })

    it('md 那一档照样能去标记 —— 保留语法跟保留标记是两回事', () => {
      const out = renderBody('## 标题\n\n@浮出', { keepMarkdown: true, stripFloatMarks: true })
      expect(out).toContain('## 标题')
      expect(out).not.toContain('@')
    })
  })

  describe('中英之间补空格', () => {
    it('汉字和数字之间', () => {
      expect(spaceCjkLatin('写了3000字')).toBe('写了 3000 字')
    })

    it('汉字和英文之间', () => {
      expect(spaceCjkLatin('用Word打开')).toBe('用 Word 打开')
    })

    it('【关键】不碰标点 —— 句号后面不该冒出空格', () => {
      expect(spaceCjkLatin('写了3000字。')).toBe('写了 3000 字。')
      expect(spaceCjkLatin('他说：“好”')).toBe('他说：“好”')
    })

    it('本来就有空格的不再加', () => {
      expect(spaceCjkLatin('写了 3000 字')).toBe('写了 3000 字')
    })

    it('纯中文、纯英文都不动', () => {
      expect(spaceCjkLatin('他站在窗前')).toBe('他站在窗前')
      expect(spaceCjkLatin('hello world')).toBe('hello world')
    })

    it('默认关着 —— 它会改变作者原本的排版', () => {
      expect(renderBody('写了3000字')).toContain('写了3000字')
    })
  })

  describe('收拾多余空格', () => {
    it('连着的空格压成一个', () => {
      expect(tidySpaces('他   站在窗前')).toBe('他 站在窗前')
    })

    it('中文标点前面不留空格', () => {
      expect(tidySpaces('他站在窗前 。')).toBe('他站在窗前。')
    })

    it('行尾的空格去掉', () => {
      expect(tidySpaces('他站在窗前   ')).toBe('他站在窗前')
    })

    it('【关键】行首的缩进不动 —— 那可能是他故意排的', () => {
      expect(tidySpaces('    代码一行')).toBe('    代码一行')
      expect(tidySpaces('\t缩进的')).toBe('\t缩进的')
    })

    it('全角空格不碰 —— 那是他主动敲的缩进', () => {
      expect(tidySpaces('　　他站在窗前')).toBe('　　他站在窗前')
    })
  })
})
