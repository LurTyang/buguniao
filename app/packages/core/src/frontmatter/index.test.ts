import { describe, it, expect } from 'vitest'
import {
  parseDoc,
  serializeDoc,
  touchDoc,
  generateId,
  parseBookMeta,
  serializeBookMeta,
  createBookMeta,
  stripOrderPrefix,
  DEFAULT_HISTORY_LIMIT_MB,
  withLeadingBlankLine,
} from './index.js'

/** 固定随机源，让 id 可预测 */
const fixedRandom = () => 0.5 // Math.floor(0.5*36)=18 → 'i'
const NOW = '2026-08-25T02:00:00.000+08:00'
const NL = String.fromCharCode(10)

describe('generateId', () => {
  it('格式为 前缀-6位base36', () => {
    expect(generateId('chapter', fixedRandom)).toBe('ch-iiiiii')
    expect(generateId('setting', fixedRandom)).toBe('set-iiiiii')
    expect(generateId('book', fixedRandom)).toBe('bk-iiiiii')
  })

  it('真实随机源下每次不同，且格式正确', () => {
    const a = generateId('chapter')
    const b = generateId('chapter')
    expect(a).toMatch(/^ch-[0-9a-z]{6}$/)
    expect(b).toMatch(/^ch-[0-9a-z]{6}$/)
    expect(a).not.toBe(b)
  })
})

describe('stripOrderPrefix', () => {
  it('去掉四位序号前缀', () => {
    expect(stripOrderPrefix('0010-第一章 坠楼')).toBe('第一章 坠楼')
  })
  it('没有前缀时原样返回', () => {
    expect(stripOrderPrefix('第一章 坠楼')).toBe('第一章 坠楼')
  })
  it('三位或五位数字不算前缀', () => {
    expect(stripOrderPrefix('001-甲')).toBe('001-甲')
    expect(stripOrderPrefix('00100-甲')).toBe('00100-甲')
  })
})

describe('parseDoc · 有 front-matter', () => {
  const raw = [
    '---',
    'id: ch-a1b2c3',
    'type: chapter',
    'title: 第一章 坠楼',
    'created: "2026-08-25T10:00:00+08:00"',
    'updated: "2026-08-25T14:30:00+08:00"',
    'status: draft',
    '---',
    '',
    '他从四十八楼掉下去的时候。',
  ].join('\n')

  it('正确解析各字段', () => {
    const d = parseDoc(raw)
    expect(d.hadFrontMatter).toBe(true)
    expect(d.meta.id).toBe('ch-a1b2c3')
    expect(d.meta.type).toBe('chapter')
    expect(d.meta.title).toBe('第一章 坠楼')
    expect(d.meta.status).toBe('draft')
  })

  it('body 不含 front-matter', () => {
    expect(parseDoc(raw).body).toBe('\n他从四十八楼掉下去的时候。')
  })

  it('CRLF 也能解析', () => {
    const d = parseDoc(raw.replace(/\n/g, '\r\n'))
    expect(d.meta.id).toBe('ch-a1b2c3')
    expect(d.body).toBe('\r\n他从四十八楼掉下去的时候。')
  })

  it('带 BOM 也能解析', () => {
    const d = parseDoc('﻿' + raw)
    expect(d.meta.id).toBe('ch-a1b2c3')
  })
})

describe('parseDoc · 未识别字段必须保留', () => {
  it('把陌生字段收进 extra', () => {
    const raw = ['---', 'id: ch-x', 'type: chapter', 'title: 甲', 'aliases: [别名]', 'obsidianTag: 玄幻', '---', '正文'].join(
      '\n',
    )
    const d = parseDoc(raw)
    expect(d.meta.extra).toEqual({ aliases: ['别名'], obsidianTag: '玄幻' })
  })

  it('往返一次不丢字段', () => {
    const raw = ['---', 'id: ch-x', 'type: chapter', 'title: 甲', 'created: "2026-01-01T00:00:00+08:00"', 'updated: "2026-01-01T00:00:00+08:00"', 'myField: 保留我', '---', '', '正文'].join(
      '\n',
    )
    const round = serializeDoc(parseDoc(raw).meta, parseDoc(raw).body)
    expect(round).toContain('myField: 保留我')
    expect(parseDoc(round).meta.extra).toEqual({ myField: '保留我' })
  })
})

describe('parseDoc · 裸 .md（作者用记事本新建的）', () => {
  it('自动补 id 并标记 hadFrontMatter=false', () => {
    const d = parseDoc('# 第一章 坠楼\n\n正文', { fileName: '0010-第一章 坠楼.md', now: NOW, random: fixedRandom })
    expect(d.hadFrontMatter).toBe(false)
    expect(d.meta.id).toBe('ch-iiiiii')
    expect(d.meta.created).toBe(NOW)
  })

  it('标题优先取正文里的第一个标题', () => {
    const d = parseDoc('# 坠楼\n正文', { fileName: '0010-别的名字.md', now: NOW })
    expect(d.meta.title).toBe('坠楼')
  })

  it('无标题时用文件名，且去掉序号前缀和 .md', () => {
    const d = parseDoc('正文没有标题', { fileName: '0010-第一章 坠楼.md', now: NOW })
    expect(d.meta.title).toBe('第一章 坠楼')
  })

  it('body 保持原样', () => {
    expect(parseDoc('# 甲\n正文', { now: NOW }).body).toBe('# 甲\n正文')
  })

  it('defaultType 生效', () => {
    const d = parseDoc('# 李四', { fileName: '李四.md', defaultType: 'setting', now: NOW, random: fixedRandom })
    expect(d.meta.type).toBe('setting')
    expect(d.meta.id).toBe('set-iiiiii')
  })
})

describe('parseDoc · 容错', () => {
  it('front-matter 里 YAML 语法坏了也不抛异常，正文照给', () => {
    const raw = ['---', 'id: [未闭合', 'type: : :', '---', '正文还在这里'].join('\n')
    const d = parseDoc(raw, { now: NOW, random: fixedRandom })
    expect(d.body).toBe('正文还在这里')
    expect(d.meta.id).toBe('ch-iiiiii')
  })

  it('type 非法时回落到默认值', () => {
    const raw = ['---', 'id: ch-x', 'type: 火星文', 'title: 甲', '---', '正文'].join('\n')
    expect(parseDoc(raw, { now: NOW }).meta.type).toBe('chapter')
  })

  it('缺 id 时补一个', () => {
    const raw = ['---', 'type: chapter', 'title: 甲', '---', '正文'].join('\n')
    expect(parseDoc(raw, { now: NOW, random: fixedRandom }).meta.id).toBe('ch-iiiiii')
  })

  it('未加引号的日期被 YAML 解析成 Date 时能转回字符串', () => {
    const raw = ['---', 'id: ch-x', 'type: chapter', 'title: 甲', 'created: 2026-08-25T10:00:00.000Z', '---', '正文'].join(
      '\n',
    )
    expect(typeof parseDoc(raw, { now: NOW }).meta.created).toBe('string')
  })

  it('空文件不炸', () => {
    const d = parseDoc('', { fileName: '空.md', now: NOW })
    expect(d.body).toBe('')
    expect(d.meta.title).toBe('空')
  })

  it('只有 --- 没有内容不炸', () => {
    expect(() => parseDoc('---\n---\n正文', { now: NOW })).not.toThrow()
  })
})

describe('serializeDoc', () => {
  it('产出可被自己解析回来的完整文件', () => {
    const original = parseDoc('# 甲\n正文', { fileName: '甲.md', now: NOW, random: fixedRandom })
    const text = serializeDoc(original.meta, original.body)
    const again = parseDoc(text)
    expect(again.hadFrontMatter).toBe(true)
    expect(again.meta.id).toBe(original.meta.id)
    expect(again.meta.title).toBe(original.meta.title)
    expect(again.body.trim()).toBe('# 甲\n正文')
  })

  it('【关键】往返必须恒等 —— 正文一个字节都不能变', () => {
    // 初版会在正文前偷偷补一个换行，结果作者第一次保存后
    // 编辑器顶上凭空多出一个空行。这条测试就是为了钉死这个行为。
    const meta = parseDoc('x', { now: NOW }).meta
    for (const body of ['正文', '\n正文', '\n\n正文', '', '第一行\n第二行', '结尾有换行\n']) {
      expect(parseDoc(serializeDoc(meta, body)).body).toBe(body)
    }
  })

  it('正文紧跟在 front-matter 之后，不额外加空行', () => {
    const d = parseDoc('正文', { now: NOW })
    expect(serializeDoc(d.meta, d.body)).toMatch(/---\n正文$/)
  })

  it('withLeadingBlankLine 只在需要时补一个换行', () => {
    expect(withLeadingBlankLine('正文')).toBe('\n正文')
    expect(withLeadingBlankLine('\n正文')).toBe('\n正文')
    expect(withLeadingBlankLine('')).toBe('\n')
  })

  it('body 已以换行开头时不重复加', () => {
    const d = parseDoc('---\nid: ch-x\ntype: chapter\ntitle: 甲\n---\n\n正文', {})
    const out = serializeDoc(d.meta, d.body)
    expect(out).not.toMatch(/---\n\n\n/)
  })

  it('status 为空时不写入该字段', () => {
    const d = parseDoc('正文', { now: NOW })
    expect(serializeDoc(d.meta, d.body)).not.toContain('status:')
  })
})

describe('touchDoc', () => {
  it('只改 updated', () => {
    const d = parseDoc('正文', { now: NOW })
    const t = touchDoc(d, '2026-09-01T00:00:00+08:00')
    expect(t.meta.updated).toBe('2026-09-01T00:00:00+08:00')
    expect(t.meta.created).toBe(NOW)
    expect(t.body).toBe(d.body)
  })
})

describe('book.yaml', () => {
  const raw = [
    'schemaVersion: 1',
    'id: bk-9shen',
    'title: 第九神座',
    'author: 明听',
    'cover: cover.jpg',
    'status: serializing',
    'tags: [玄幻, 长篇]',
    'createdAt: "2026-08-25T10:00:00+08:00"',
    'targets:',
    '  dailyWords: 4000',
    'historyLimitMB: 500',
  ].join('\n')

  it('正确解析', () => {
    const b = parseBookMeta(raw)
    expect(b.id).toBe('bk-9shen')
    expect(b.title).toBe('第九神座')
    expect(b.status).toBe('serializing')
    expect(b.tags).toEqual(['玄幻', '长篇'])
    expect(b.targets?.dailyWords).toBe(4000)
    expect(b.historyLimitMB).toBe(500)
  })

  it('三种状态都能解析', () => {
    for (const s of ['serializing', 'finished', 'pit'] as const) {
      expect(parseBookMeta(`status: ${s}`, { now: NOW }).status).toBe(s)
    }
  })

  it('非法 status 回落到 serializing', () => {
    expect(parseBookMeta('status: 咕咕咕', { now: NOW }).status).toBe('serializing')
  })

  it('缺 title 时用文件夹名', () => {
    expect(parseBookMeta('status: pit', { folderName: '旧稿', now: NOW }).title).toBe('旧稿')
  })

  it('缺 historyLimitMB 时用默认值', () => {
    expect(parseBookMeta('title: 甲', { now: NOW }).historyLimitMB).toBe(DEFAULT_HISTORY_LIMIT_MB)
  })

  it('未识别字段保留在 extra 并往返不丢', () => {
    const b = parseBookMeta(raw + '\nmyCustom: 保留我')
    expect(b.extra).toEqual({ myCustom: '保留我' })
    expect(serializeBookMeta(b)).toContain('myCustom: 保留我')
  })

  it('往返一致', () => {
    const b = parseBookMeta(raw)
    const again = parseBookMeta(serializeBookMeta(b))
    expect(again).toEqual(b)
  })

  it('YAML 坏了不抛异常', () => {
    expect(() => parseBookMeta('[[[坏掉了', { now: NOW })).not.toThrow()
  })

  it('createBookMeta 产出合法默认值', () => {
    const b = createBookMeta('新书', { now: NOW, random: fixedRandom })
    expect(b.id).toBe('bk-iiiiii')
    expect(b.status).toBe('serializing')
    expect(b.schemaVersion).toBe(1)
    expect(parseBookMeta(serializeBookMeta(b))).toEqual(b)
  })
})

describe('作品类型与人物分类', () => {
  it('类型和人物分类写得进去也读得回来', () => {
    const meta = parseBookMeta(
      serializeBookMeta({
        ...createBookMeta('某书', { now: '2026-01-01T00:00:00.000Z' }),
        kind: 'script',
        castFrom: ['人物', '配角'],
      }),
    )
    expect(meta.kind).toBe('script')
    expect(meta.castFrom).toEqual(['人物', '配角'])
  })

  it('【关键】「一个分类都不算人物」要写下来', () => {
    // 不写的话下次打开又会被猜成认人 ——「还没选过」和「选了没有」是两件事
    const yaml = serializeBookMeta({
      ...createBookMeta('某书', { now: '2026-01-01T00:00:00.000Z' }),
      castFrom: [],
    })
    expect(yaml).toContain('castFrom')
    expect(parseBookMeta(yaml).castFrom).toEqual([])
  })

  it('老书没有这两项，读出来也没有', () => {
    const meta = parseBookMeta('title: 老书\nstatus: serializing\n')
    expect(meta.kind).toBeUndefined()
    expect(meta.castFrom).toBeUndefined()
  })

  it('类型写成不认识的字就当没写', () => {
    expect(parseBookMeta('title: 甲\nkind: 漫画\n').kind).toBeUndefined()
  })
})

describe('哪台机器改的', () => {
  const NL = String.fromCharCode(10)
  const bare = ['---', 'id: ch-1', 'type: chapter', 'title: 甲', '---', ''].join(NL)
  const metaOf = (device?: string) => {
    const m = parseDoc(bare).meta
    return device === undefined ? m : { ...m, device }
  }

  it('写得进去也读得回来', () => {
    expect(parseDoc(serializeDoc(metaOf('书房台式机'), '正文')).meta.device).toBe('书房台式机')
  })

  it('老文档没这一项，读出来也没有 —— 界面显示「不知道是哪台」', () => {
    expect(parseDoc(serializeDoc(metaOf(), '正文')).meta.device).toBeUndefined()
  })

  it('【关键】恒等往返，不给正文添一个字节', () => {
    const body = ['正文', '第二行'].join(NL)
    const text = serializeDoc(metaOf('A'), body)
    const back = parseDoc(text)
    expect(back.body).toBe(body)
    expect(serializeDoc(back.meta, back.body)).toBe(text)
  })

  it('设备名里有中文和空格也不会把 YAML 弄坏', () => {
    const name = '明听 的 笔记本: 一号'
    expect(parseDoc(serializeDoc(metaOf(name), '正文')).meta.device).toBe(name)
  })
})
