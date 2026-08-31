/**
 * 索引库测试 —— 跑在真实的 SQLite 文件上。
 *
 * 重点是中文检索：trigram 分词器能不能搜到任意子串，
 * 以及查询串带引号、括号这类 FTS5 语法字符时会不会炸。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { HIGHLIGHT_END, HIGHLIGHT_START, IndexDb, extractLinks, MIN_FTS_QUERY, toLikePattern } from './index-db.js'

let dir: string
let db: IndexDb

const doc = (o: {
  id: string
  type?: string
  title: string
  body: string
}) => `---\nid: ${o.id}\ntype: ${o.type ?? 'chapter'}\ntitle: ${o.title}\n---\n\n${o.body}`

/** 往索引里塞一篇文档 */
function put(o: { id: string; type?: string; title: string; body: string; book?: string; category?: string }) {
  const p = `${o.book ?? '第九神座'}/正文/${o.title}.md`
  db.upsertDoc({
    book: o.book ?? '第九神座',
    path: p,
    raw: doc(o),
    mtime: 1,
    fileName: `${o.title}.md`,
    ...(o.category === undefined ? {} : { category: o.category }),
  })
  return p
}

/** 大多数断言只关心命中了哪些，包一层省事 */
const search = (q: string, opts?: Parameters<IndexDb['search']>[1]) => db.search(q, opts).hits

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bugu-idx-'))
  db = new IndexDb(path.join(dir, 'index.db'))
})

afterEach(() => {
  db.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('中文全文检索', () => {
  beforeEach(() => {
    put({
      id: 'ch-1',
      title: '第一章 坠楼',
      body: '他从四十八楼掉下去的时候，脑子里想的不是死，而是昨天没写完的那一章。',
    })
    put({ id: 'ch-2', title: '第二章 醒来', body: '他醒来时，看到了天花板上的一道裂缝。' })
    put({ id: 'ch-3', title: '第三章 玉佩', body: '胸口那块温润的玉佩还在，映着微光。' })
  })

  it('【关键】能搜到任意中文子串', () => {
    // 这正是 trigram 分词器的价值：不需要中文分词器就能子串匹配
    expect(search('四十八').map((h) => h.title)).toEqual(['第一章 坠楼'])
    expect(search('天花板').map((h) => h.title)).toEqual(['第二章 醒来'])
    expect(search('温润的玉佩').map((h) => h.title)).toEqual(['第三章 玉佩'])
  })

  it('跨词搜索也能命中', () => {
    expect(search('没写完的那一章')).toHaveLength(1)
  })

  it('搜不到时返回空', () => {
    expect(search('这句话谁也没写过')).toEqual([])
  })

  it('标题也参与检索', () => {
    expect(search('第二章').map((h) => h.title)).toContain('第二章 醒来')
  })

  it('返回带高亮标记的上下文片段', () => {
    const [hit] = search('四十八')
    expect(hit?.snippet).toContain('四十八')
    expect(hit?.snippet).toContain('')
  })

  it('片段不是整篇正文', () => {
    const [hit] = search('四十八')
    expect((hit?.snippet.length ?? 999) < 200).toBe(true)
  })

  it('空查询返回空', () => {
    expect(search('')).toEqual([])
    expect(search('   ')).toEqual([])
  })
})

describe('短查询降级为 LIKE', () => {
  beforeEach(() => {
    put({ id: 'ch-1', title: '第一章', body: '他掉下去了。' })
  })

  it('一个字也能搜到', () => {
    expect(search('他')).toHaveLength(1)
  })

  it('两个字也能搜到', () => {
    expect(search('掉下')).toHaveLength(1)
  })

  it('降级路径同样给出高亮片段', () => {
    const [hit] = search('掉下')
    expect(hit?.snippet).toContain('掉下')
  })

  it('阈值就是 3', () => {
    expect(MIN_FTS_QUERY).toBe(3)
  })
})

describe('查询串里的特殊字符不会炸', () => {
  beforeEach(() => {
    put({ id: 'ch-1', title: '第一章', body: '他说："走。"然后（真的）走了。' })
  })

  it('带双引号的查询', () => {
    // 不转义的话会撞上 FTS5 的查询语法直接抛异常
    expect(() => search('他说："走')).not.toThrow()
    expect(search('他说：')).toHaveLength(1)
  })

  it('带括号的查询', () => {
    expect(() => search('（真的）')).not.toThrow()
    expect(search('（真的）')).toHaveLength(1)
  })

  it('带星号的查询', () => {
    expect(() => search('走*了')).not.toThrow()
  })

  it('LIKE 通配符被转义，不会误当模式', () => {
    put({ id: 'ch-2', title: '百分号', body: '进度 100% 完成' })
    // 「%」当字面量搜，不该匹配到所有文档
    expect(search('%').every((h) => h.title === '百分号')).toBe(true)
  })
})

describe('范围筛选', () => {
  beforeEach(() => {
    put({ id: 'ch-1', type: 'chapter', title: '正文里的玉佩', body: '玉佩在胸口' })
    put({ id: 'set-1', type: 'setting', title: '设定里的玉佩', body: '玉佩是沈家信物' })
    put({ id: 'out-1', type: 'outline', title: '大纲里的玉佩', body: '玉佩要在第三卷回收' })
  })

  it('不筛选时全都搜得到', () => {
    expect(search('玉佩')).toHaveLength(3)
  })

  it('只搜正文', () => {
    expect(search('玉佩', { scopes: ['chapter'] }).map((h) => h.type)).toEqual(['chapter'])
  })

  it('可以多选范围', () => {
    expect(search('玉佩', { scopes: ['chapter', 'outline'] })).toHaveLength(2)
  })

  it('按作品筛选', () => {
    put({ id: 'ch-x', title: '别的书里的玉佩', body: '玉佩', book: '何忆卫' })
    expect(search('玉佩', { book: '何忆卫' })).toHaveLength(1)
    expect(search('玉佩')).toHaveLength(4)
  })
})

describe('设定集索引卡片正面', () => {
  it('搜浮出内容也能命中那张卡', () => {
    db.upsertDoc({
      book: '第九神座',
      path: '第九神座/设定集/人物/李四.md',
      fileName: '李四.md',
      category: '人物',
      mtime: 1,
      raw: doc({
        id: 'set-lisi',
        type: 'setting',
        title: '李四',
        body: '# 李四\n\n@外貌：断眉，左手常年缠布',
      }),
    })
    expect(search('断眉').map((h) => h.title)).toEqual(['李四'])
  })
})

describe('增删改', () => {
  it('重复索引同一路径是幂等的', () => {
    put({ id: 'ch-1', title: '第一章', body: '他掉下去了。' })
    put({ id: 'ch-1', title: '第一章', body: '他掉下去了。' })
    expect(search('掉下去')).toHaveLength(1)
  })

  it('内容改了之后搜新的能中、搜旧的不中', () => {
    put({ id: 'ch-1', title: '第一章', body: '原来的内容里有玉佩' })
    expect(search('玉佩')).toHaveLength(1)

    put({ id: 'ch-1', title: '第一章', body: '改过之后只剩下短刀' })
    expect(search('玉佩')).toEqual([])
    expect(search('短刀')).toHaveLength(1)
  })

  it('删除后搜不到', () => {
    const p = put({ id: 'ch-1', title: '第一章', body: '他掉下去了。' })
    db.removeByPath(p)
    expect(search('掉下去')).toEqual([])
  })

  it('删不存在的路径不报错', () => {
    expect(() => db.removeByPath('不存在.md')).not.toThrow()
  })

  it('清空某本书只影响那本书', () => {
    put({ id: 'ch-1', title: '甲', body: '玉佩', book: 'A' })
    put({ id: 'ch-2', title: '乙', body: '玉佩', book: 'B' })
    db.clearBook('A')
    expect(search('玉佩').map((h) => h.book)).toEqual(['B'])
  })
})

describe('双向链接', () => {
  it('抽出链接与别名', () => {
    expect(extractLinks('他见到了[[李四]]，还有[[王五|那个胖子]]。')).toEqual([
      { target: '李四', alias: null },
      { target: '王五', alias: '那个胖子' },
    ])
  })

  it('忽略空链接与跨行的方括号', () => {
    expect(extractLinks('[[]] 和 [[\n换行了]]')).toEqual([])
  })

  it('反向链接：某个名字被哪些文档引用', () => {
    put({ id: 'ch-1', title: '第一章', body: '[[李四]]走了过来。' })
    put({ id: 'ch-2', title: '第二章', body: '他想起了[[李四|那个少年]]。' })
    put({ id: 'ch-3', title: '第三章', body: '没有提到任何人。' })

    expect(db.backlinks('李四').map((b) => b.title).sort()).toEqual(['第一章', '第二章'])
    expect(db.backlinks('王五')).toEqual([])
  })

  it('改了正文后反向链接跟着更新', () => {
    put({ id: 'ch-1', title: '第一章', body: '[[李四]]走了过来。' })
    expect(db.backlinks('李四')).toHaveLength(1)

    put({ id: 'ch-1', title: '第一章', body: '改成了[[王五]]。' })
    expect(db.backlinks('李四')).toEqual([])
    expect(db.backlinks('王五')).toHaveLength(1)
  })
})

describe('findByTitle · 快速跳转', () => {
  beforeEach(() => {
    put({ id: 'ch-1', title: '第一章 坠楼', body: 'a' })
    put({ id: 'ch-2', title: '第二章 醒来', body: 'b' })
    put({ id: 'set-1', type: 'setting', title: '李四', body: 'c' })
  })

  it('按标题片段匹配', () => {
    expect(db.findByTitle('坠楼').map((h) => h.title)).toEqual(['第一章 坠楼'])
  })

  it('匹配多个时按标题长度排序（短的更可能是想要的）', () => {
    expect(db.findByTitle('第').map((h) => h.title)).toEqual(['第一章 坠楼', '第二章 醒来'])
  })

  it('搜不到返回空', () => {
    expect(db.findByTitle('不存在的东西')).toEqual([])
  })
})

describe('统计与持久化', () => {
  it('统计文档数与作品数', () => {
    put({ id: 'ch-1', title: '甲', body: 'a', book: 'A' })
    put({ id: 'ch-2', title: '乙', body: 'b', book: 'B' })
    const s = db.stats()
    expect(s.docs).toBe(2)
    expect(s.books).toBe(2)
    expect(s.bytes).toBeGreaterThan(0)
  })

  it('按作品统计', () => {
    put({ id: 'ch-1', title: '甲', body: 'a', book: 'A' })
    put({ id: 'ch-2', title: '乙', body: 'b', book: 'B' })
    expect(db.stats('A').docs).toBe(1)
  })

  it('meta 键值可读写', () => {
    db.setMeta('builtAt', '12345')
    expect(db.getMeta('builtAt')).toBe('12345')
    expect(db.getMeta('不存在')).toBeNull()
  })

  it('关掉再打开，索引还在（这就是不用每次重扫的意义）', () => {
    put({ id: 'ch-1', title: '第一章', body: '他从四十八楼掉下去。' })
    db.close()

    db = new IndexDb(path.join(dir, 'index.db'))
    expect(search('四十八')).toHaveLength(1)
  })

  it('事务失败时回滚', () => {
    put({ id: 'ch-1', title: '第一章', body: '原内容' })
    expect(() =>
      db.transaction(() => {
        put({ id: 'ch-2', title: '第二章', body: '新内容' })
        throw new Error('故意失败')
      }),
    ).toThrow('故意失败')
    expect(search('新内容')).toEqual([])
    expect(search('原内容')).toHaveLength(1)
  })
})

describe('规模', () => {
  it('三百章、约九十万字的书，建索引与检索都够快', () => {
    const para =
      '他从四十八楼掉下去的时候，脑子里想的不是死，而是昨天没写完的那一章。风声在耳边呼啸，他忽然想起胸口那块温润的玉佩。'

    const t0 = Date.now()
    db.transaction(() => {
      for (let i = 1; i <= 300; i++) {
        put({
          id: `ch-${i}`,
          title: `第${i}章`,
          body: Array.from({ length: 26 }, (_, k) => `第${i}章第${k}段。${para}`).join('\n\n'),
        })
      }
    })
    const buildMs = Date.now() - t0

    const t1 = Date.now()
    const r = db.search('那块温润的玉佩', { limit: 500 })
    const searchMs = Date.now() - t1

    expect(r.hits.length).toBe(300)
    expect(r.total).toBe(300)
    expect(r.truncated).toBe(false)
    expect(buildMs).toBeLessThan(60_000)
    expect(searchMs).toBeLessThan(1000)

    // 索引体积应当在原文的几倍以内
    const rawBytes = 300 * 26 * para.length * 3
    expect(db.stats().bytes).toBeLessThan(rawBytes * 6)
  })

  it('唯一命中的检索是毫秒级', () => {
    db.transaction(() => {
      for (let i = 1; i <= 300; i++) {
        put({ id: `ch-${i}`, title: `第${i}章`, body: `这是第${i}章的内容，独一无二的暗号是 X${i}Y。` })
      }
    })
    const t = Date.now()
    expect(search('暗号是 X177Y')).toHaveLength(1)
    expect(Date.now() - t).toBeLessThan(200)
  })
})

describe('结果截断要如实报告', () => {
  beforeEach(() => {
    for (let i = 1; i <= 25; i++) put({ id: `ch-${i}`, title: `第${i}章`, body: '都有玉佩这两个字' })
  })

  it('默认上限内不算截断', () => {
    const r = db.search('玉佩')
    expect(r.hits).toHaveLength(25)
    expect(r.total).toBe(25)
    expect(r.truncated).toBe(false)
  })

  it('【关键】超过上限时如实给出总数，不让作者以为只有这些', () => {
    const r = db.search('玉佩', { limit: 10 })
    expect(r.hits).toHaveLength(10)
    expect(r.total).toBe(25)
    expect(r.truncated).toBe(true)
  })

  it('短查询降级路径同样如实报告', () => {
    const r = db.search('玉佩'.slice(0, 2), { limit: 10 })
    expect(r.hits).toHaveLength(10)
    expect(r.total).toBe(25)
    expect(r.truncated).toBe(true)
  })

  it('空查询的总数是 0', () => {
    expect(db.search('')).toEqual({ hits: [], total: 0, truncated: false })
  })
})

describe('LIKE 模式转义', () => {
  it('通配符被转义成字面量', () => {
    expect(toLikePattern('100%')).toBe('%100#%%')
    expect(toLikePattern('a_b')).toBe('%a#_b%')
  })

  it('转义符本身也被转义', () => {
    expect(toLikePattern('#1')).toBe('%##1%')
  })

  it('首尾空白被去掉', () => {
    expect(toLikePattern('  甲  ')).toBe('%甲%')
  })
})

describe('outgoingLinks · 这篇提到了谁', () => {
  it('列出正文里的双链，并配上目标路径', () => {
    const p = put({ id: 'ch-1', title: '第一章', body: '他看见了[[李四]]，又想起[[王五]]。' })
    put({ id: 'card-1', type: 'setting', title: '李四', body: '配角。' })

    const out = db.outgoingLinks(p)
    expect(out.map((o) => o.target).sort()).toEqual(['李四', '王五'])
    expect(out.find((o) => o.target === '李四')?.title).toBe('李四')
  })

  it('【关键】指不到东西的链接也返回，path 为 null', () => {
    const p = put({ id: 'ch-1', title: '第一章', body: '他看见了[[王五]]。' })
    expect(db.outgoingLinks(p)).toEqual([{ target: '王五', path: null, title: null }])
  })

  it('同一个名字写两遍只算一条', () => {
    const p = put({ id: 'ch-1', title: '第一章', body: '[[李四]]走了，[[李四]]又回来了。' })
    expect(db.outgoingLinks(p)).toHaveLength(1)
  })

  it('带别名的链接按真名算', () => {
    const p = put({ id: 'ch-1', title: '第一章', body: '他想起了[[李四|那个少年]]。' })
    expect(db.outgoingLinks(p).map((o) => o.target)).toEqual(['李四'])
  })

  it('没有链接时返回空数组', () => {
    const p = put({ id: 'ch-1', title: '第一章', body: '什么都没写。' })
    expect(db.outgoingLinks(p)).toEqual([])
  })

  it('不存在的文档返回空数组，不炸', () => {
    expect(db.outgoingLinks('第九神座/正文/没这篇.md')).toEqual([])
  })

  it('改了正文后跟着更新', () => {
    const p = put({ id: 'ch-1', title: '第一章', body: '[[李四]]走了。' })
    expect(db.outgoingLinks(p)).toHaveLength(1)
    put({ id: 'ch-1', title: '第一章', body: '谁也没来。' })
    expect(db.outgoingLinks(p)).toEqual([])
  })
})
