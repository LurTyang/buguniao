import { describe, it, expect } from 'vitest'
import { MemoryBackend } from '../storage/memory.js'
import {
  scanLibrary,
  createBook,
  loadTree,
  flattenChapters,
  readDoc,
  writeDoc,
  applyTemplate,
  defaultTemplate,
  createSettingCard,
  ensureTemplate,
  writeNewDoc,
  sanitizeFileName,
  TEMPLATE_FILE,
} from './index.js'
import { parseBookMeta, parseDoc } from '../frontmatter/index.js'
import type { SettingCategory } from './index.js'

/** 按名字取分类。不要按下标取 —— 排序用的是拼音，凭感觉写下标必错 */
const cat = (list: readonly SettingCategory[], name: string): SettingCategory => {
  const c = list.find((x) => x.name === name)
  if (!c) throw new Error(`没有找到分类：${name}`)
  return c
}

const NOW = '2026-08-25T02:00:00.000+08:00'

/** 一本内容齐全的样板书 */
function sampleLibrary(): MemoryBackend {
  return new MemoryBackend({
    files: {
      '第九神座/book.yaml': [
        'schemaVersion: 1',
        'id: bk-9shen',
        'title: 第九神座',
        'author: 明听',
        'status: serializing',
        'createdAt: "2026-08-25T10:00:00+08:00"',
      ].join('\n'),

      '第九神座/正文/0010-第一卷 少年游/0010-第一章 坠楼.md': '---\nid: ch-aaa111\ntype: chapter\ntitle: 第一章 坠楼\n---\n\n他从四十八楼掉下去。',
      '第九神座/正文/0010-第一卷 少年游/0020-第二章 醒来.md': '---\nid: ch-bbb222\ntype: chapter\ntitle: 第二章 醒来\n---\n\n他醒了。',
      '第九神座/正文/0020-第二卷 江湖远/0010-第三章 出门.md': '---\nid: ch-ccc333\ntype: chapter\ntitle: 第三章 出门\n---\n\n他出门了。',

      '第九神座/大纲/0010-总纲.md': '---\nid: out-aaa\ntype: outline\ntitle: 总纲\n---\n\n大纲内容',

      '第九神座/设定集/人物/_模板.md': '# {{标题}}\n\n@身份：@\n\n## 外貌\n',
      '第九神座/设定集/人物/李四.md': '---\nid: set-lisi\ntype: setting\ntitle: 李四\n---\n\n# 李四\n\n@十七岁@',
      '第九神座/设定集/人物/王五.md': '---\nid: set-wangwu\ntype: setting\ntitle: 王五\n---\n\n# 王五',
      '第九神座/设定集/功法/寒山诀.md': '# 寒山诀',
      '第九神座/设定集/散装设定.md': '# 散装设定',

      '第九神座/灵感/20260825-143012-phone.md': '---\nid: idea-aaa\ntype: idea\ntitle: 反派动机\n---\n\n反派其实不想赢。',

      '何忆卫/book.yaml': 'schemaVersion: 1\nid: bk-heyi\ntitle: 何忆卫\nstatus: pit\ncreatedAt: "2026-01-01T00:00:00+08:00"',

      '_灵感箱/20260825-201533-phone.md': '未归属的灵感',
      '不是作品的文件夹/随便一个文件.txt': '这不是作品',
    },
  })
}

describe('scanLibrary · 书架扫描', () => {
  it('找出所有含 book.yaml 的文件夹', async () => {
    const books = await scanLibrary(sampleLibrary())
    // 排序用 localeCompare(zh)，即拼音序：第(di) < 何(he)
    expect(books.map((b) => b.meta.title)).toEqual(['第九神座', '何忆卫'])
  })

  it('跳过 _ 开头的内部文件夹', async () => {
    const books = await scanLibrary(sampleLibrary())
    expect(books.map((b) => b.folderName)).not.toContain('_灵感箱')
  })

  it('跳过没有 book.yaml 的文件夹', async () => {
    const books = await scanLibrary(sampleLibrary())
    expect(books.map((b) => b.folderName)).not.toContain('不是作品的文件夹')
  })

  it('正确读出作品状态（坑啦）', async () => {
    const books = await scanLibrary(sampleLibrary())
    expect(books.find((b) => b.meta.title === '何忆卫')?.meta.status).toBe('pit')
  })

  it('空目录返回空数组', async () => {
    expect(await scanLibrary(new MemoryBackend())).toEqual([])
  })
})

describe('createBook · 新建作品', () => {
  it('创建标准目录骨架与第一章', async () => {
    const b = new MemoryBackend()
    const book = await createBook(b, '', '新书', { now: NOW })

    expect(book.rootPath).toBe('新书')
    expect(b.peek('新书/book.yaml')).toContain('title: 新书')
    expect(b.snapshotPaths()).toContain('新书/正文/0010-第一章.md')
  })

  it('新建的作品能被书架扫到', async () => {
    const b = new MemoryBackend()
    await createBook(b, '', '新书', { now: NOW })
    expect((await scanLibrary(b)).map((x) => x.meta.title)).toEqual(['新书'])
  })

  it('书名里的非法字符被替换', async () => {
    const b = new MemoryBackend()
    const book = await createBook(b, '', 'A/B:C', { now: NOW })
    expect(book.rootPath).toBe('A_B_C')
    // 但 book.yaml 里保留原始标题（不关心 YAML 怎么加引号，解析回来对得上就行）
    expect(parseBookMeta(b.peek('A_B_C/book.yaml') as string).title).toBe('A/B:C')
  })

  it('可指定第一章标题', async () => {
    const b = new MemoryBackend()
    await createBook(b, '', '新书', { now: NOW, firstChapterTitle: '楔子' })
    expect(b.snapshotPaths()).toContain('新书/正文/0010-楔子.md')
  })
})

describe('loadTree · 目录树', () => {
  it('正文按卷-章两级组织', async () => {
    const tree = await loadTree(sampleLibrary(), '第九神座')
    expect(tree.text).toHaveLength(2)
    expect(tree.text[0]?.kind).toBe('volume')
    expect(tree.text[0]?.title).toBe('第一卷 少年游')
  })

  it('章节按序号排序，标题去掉序号前缀与扩展名', async () => {
    const tree = await loadTree(sampleLibrary(), '第九神座')
    const vol = tree.text[0]
    expect(vol?.kind === 'volume' && vol.chapters.map((c) => c.title)).toEqual([
      '第一章 坠楼',
      '第二章 醒来',
    ])
  })

  it('卷按序号排序', async () => {
    const tree = await loadTree(sampleLibrary(), '第九神座')
    expect(tree.text.map((n) => n.title)).toEqual(['第一卷 少年游', '第二卷 江湖远'])
  })

  it('设定集按分类文件夹分组，并标出模板', async () => {
    const tree = await loadTree(sampleLibrary(), '第九神座')
    // 拼音序：功法(gong) < 人物(ren)
    expect(tree.settings.map((c) => c.name)).toEqual(['功法', '人物'])
    expect(cat(tree.settings, '人物').templatePath).toBe('第九神座/设定集/人物/_模板.md')
    expect(cat(tree.settings, '功法').templatePath).toBeNull()
  })

  it('模板文件本身不算一张便利贴', async () => {
    const tree = await loadTree(sampleLibrary(), '第九神座')
    expect(cat(tree.settings, '人物').cards.map((c) => c.title)).toEqual(['李四', '王五'])
  })

  it('设定集根目录下的散装设定单独列出', async () => {
    const tree = await loadTree(sampleLibrary(), '第九神座')
    expect(tree.looseSettings.map((c) => c.title)).toEqual(['散装设定'])
  })

  it('大纲与灵感正常加载', async () => {
    const tree = await loadTree(sampleLibrary(), '第九神座')
    expect(tree.outline.map((d) => d.title)).toEqual(['总纲'])
    expect(tree.ideas).toHaveLength(1)
  })

  it('作品元数据正确', async () => {
    const tree = await loadTree(sampleLibrary(), '第九神座')
    expect(tree.meta.title).toBe('第九神座')
    expect(tree.meta.author).toBe('明听')
  })

  it('目录缺失时不炸，返回空列表', async () => {
    const b = new MemoryBackend({ files: { '空书/book.yaml': 'title: 空书\nstatus: pit\nid: bk-x' } })
    const tree = await loadTree(b, '空书')
    expect(tree.text).toEqual([])
    expect(tree.settings).toEqual([])
  })

  it('不读任何文档内容（WebDAV 上性能的关键）', async () => {
    const b = sampleLibrary()
    let reads = 0
    const orig = b.read.bind(b)
    b.read = async (p: string) => {
      reads++
      return orig(p)
    }
    await loadTree(b, '第九神座')
    // 只应该读 book.yaml 这一个文件
    expect(reads).toBe(1)
  })

  it('正文直接放在根目录（不分卷）也支持', async () => {
    const b = new MemoryBackend({
      files: {
        '简单书/book.yaml': 'id: bk-x\ntitle: 简单书\nstatus: serializing',
        '简单书/正文/0010-第一章.md': '正文',
        '简单书/正文/0020-第二章.md': '正文',
      },
    })
    const tree = await loadTree(b, '简单书')
    expect(tree.text.map((n) => n.kind)).toEqual(['chapter', 'chapter'])
  })
})

describe('冲突副本检测', () => {
  it('识别坚果云冲突文件并列入 conflicts', async () => {
    const b = new MemoryBackend({
      files: {
        '书/book.yaml': 'id: bk-x\ntitle: 书\nstatus: serializing',
        '书/正文/0010-第一章.md': '正文',
        '书/正文/0010-第一章 (冲突文件 2026-08-25 14-30 台式机).md': '冲突版本',
      },
    })
    const tree = await loadTree(b, '书')
    expect(tree.conflicts).toHaveLength(1)
    // 冲突副本不出现在正常目录树里
    expect(tree.text).toHaveLength(1)
  })

  it('没有冲突时 conflicts 为空', async () => {
    expect((await loadTree(sampleLibrary(), '第九神座')).conflicts).toEqual([])
  })
})

describe('flattenChapters', () => {
  it('把卷里的章节按顺序拍平', async () => {
    const tree = await loadTree(sampleLibrary(), '第九神座')
    expect(flattenChapters(tree.text).map((c) => c.title)).toEqual([
      '第一章 坠楼',
      '第二章 醒来',
      '第三章 出门',
    ])
  })

  it('混合结构也能拍平', async () => {
    const b = new MemoryBackend({
      files: {
        '书/book.yaml': 'id: bk-x\ntitle: 书\nstatus: serializing',
        '书/正文/0005-楔子.md': '正文',
        '书/正文/0010-第一卷/0010-第一章.md': '正文',
      },
    })
    const tree = await loadTree(b, '书')
    expect(flattenChapters(tree.text).map((c) => c.title)).toEqual(['楔子', '第一章'])
  })
})

describe('readDoc / writeDoc', () => {
  it('读出正文与 front-matter', async () => {
    const b = sampleLibrary()
    const doc = await readDoc(b, '第九神座/正文/0010-第一卷 少年游/0010-第一章 坠楼.md')
    expect(doc.meta.id).toBe('ch-aaa111')
    expect(doc.body.trim()).toBe('他从四十八楼掉下去。')
  })

  it('【关键】记事本随手新建的裸 md 会被自动补上 front-matter 并回写', async () => {
    const b = new MemoryBackend({
      files: { '书/正文/0030-我用记事本加的一章.md': '就写了这么一句。' },
    })
    const doc = await readDoc(b, '书/正文/0030-我用记事本加的一章.md', { now: NOW })

    expect(doc.meta.id).toMatch(/^ch-[0-9a-z]{6}$/)
    expect(doc.meta.title).toBe('我用记事本加的一章')

    // 文件已被回写
    const onDisk = b.peek('书/正文/0030-我用记事本加的一章.md') as string
    expect(onDisk.startsWith('---')).toBe(true)
    expect(parseDoc(onDisk).meta.id).toBe(doc.meta.id)
  })

  it('已有 front-matter 的文件不会被无谓回写', async () => {
    const b = sampleLibrary()
    const path = '第九神座/正文/0010-第一卷 少年游/0010-第一章 坠楼.md'
    const before = b.peek(path)
    await readDoc(b, path)
    expect(b.peek(path)).toBe(before)
  })

  it('writeDoc 更新 updated 时间', async () => {
    const b = sampleLibrary()
    const path = '第九神座/正文/0010-第一卷 少年游/0010-第一章 坠楼.md'
    const doc = await readDoc(b, path)
    const saved = await writeDoc(b, path, { ...doc, body: '\n改过的内容' }, NOW)

    expect(saved.meta.updated).toBe(NOW)
    expect((await readDoc(b, path)).body.trim()).toBe('改过的内容')
  })

  it('读写往返不丢未识别字段', async () => {
    const b = new MemoryBackend({
      files: { '书/甲.md': '---\nid: ch-x\ntype: chapter\ntitle: 甲\nmyField: 保留我\n---\n\n正文' },
    })
    const doc = await readDoc(b, '书/甲.md')
    await writeDoc(b, '书/甲.md', doc, NOW)
    expect(b.peek('书/甲.md')).toContain('myField: 保留我')
  })
})

describe('applyTemplate · 模板占位符', () => {
  it('替换标题', () => {
    expect(applyTemplate('# {{标题}}', { 标题: '药铺掌柜' })).toBe('# 药铺掌柜')
  })

  it('替换日期与分类', () => {
    expect(applyTemplate('{{日期}} / {{分类}}', { 日期: '2026-08-25', 分类: '配角' })).toBe(
      '2026-08-25 / 配角',
    )
  })

  it('允许占位符内有空格', () => {
    expect(applyTemplate('{{ 标题 }}', { 标题: '甲' })).toBe('甲')
  })

  it('未知占位符原样保留（作者可能就是想写两个大括号）', () => {
    expect(applyTemplate('{{未知}}', { 标题: '甲' })).toBe('{{未知}}')
  })

  it('同一占位符出现多次都替换', () => {
    expect(applyTemplate('{{标题}}-{{标题}}', { 标题: '甲' })).toBe('甲-甲')
  })

  it('没有占位符时原样返回', () => {
    expect(applyTemplate('普通文本', {})).toBe('普通文本')
  })
})

describe('createSettingCard · 按模板新建便利贴', () => {
  it('套用分类模板并替换占位符', async () => {
    const b = sampleLibrary()
    const tree = await loadTree(b, '第九神座')
    const { path } = await createSettingCard(b, cat(tree.settings, '人物'), '赵六', { now: NOW })

    expect(path).toBe('第九神座/设定集/人物/赵六.md')
    const content = b.peek(path) as string
    expect(content).toContain('# 赵六')
    expect(content).toContain('@身份：@')
    expect(content).not.toContain('{{标题}}')
  })

  it('新建的卡片带正确的 front-matter', async () => {
    const b = sampleLibrary()
    const tree = await loadTree(b, '第九神座')
    const { path } = await createSettingCard(b, cat(tree.settings, '人物'), '赵六', { now: NOW })

    const doc = parseDoc(b.peek(path) as string)
    expect(doc.meta.type).toBe('setting')
    expect(doc.meta.title).toBe('赵六')
    expect(doc.meta.id).toMatch(/^set-/)
  })

  it('分类没有模板时用默认骨架，不阻塞', async () => {
    const b = sampleLibrary()
    const tree = await loadTree(b, '第九神座')
    const 功法 = cat(tree.settings, '功法')
    expect(功法.templatePath).toBeNull()

    const { path } = await createSettingCard(b, 功法, '烈阳掌', { now: NOW })
    expect(b.peek(path)).toContain('# 烈阳掌')
  })

  it('新建后能被目录树扫到', async () => {
    const b = sampleLibrary()
    let tree = await loadTree(b, '第九神座')
    await createSettingCard(b, cat(tree.settings, '人物'), '赵六', { now: NOW })

    tree = await loadTree(b, '第九神座')
    expect(cat(tree.settings, '人物').cards.map((c) => c.title)).toEqual(['李四', '王五', '赵六'])
  })

  it('名字里的非法字符被替换', async () => {
    const b = sampleLibrary()
    const tree = await loadTree(b, '第九神座')
    const { path } = await createSettingCard(b, cat(tree.settings, '人物'), 'A/B', { now: NOW })
    expect(path).toBe('第九神座/设定集/人物/A_B.md')
  })

  it('模板里的 @ 语法原样保留，新卡片一建出来就能抽卡', async () => {
    const b = sampleLibrary()
    const tree = await loadTree(b, '第九神座')
    const { doc } = await createSettingCard(b, cat(tree.settings, '人物'), '赵六', { now: NOW })
    expect(doc.body).toContain('@身份：@')
  })
})

describe('ensureTemplate', () => {
  it('不存在时创建默认模板', async () => {
    const b = sampleLibrary()
    const path = await ensureTemplate(b, '第九神座/设定集/功法')
    expect(path).toBe(`第九神座/设定集/功法/${TEMPLATE_FILE}`)
    expect(b.peek(path)).toBe(defaultTemplate())
  })

  it('已存在时不覆盖作者改过的模板', async () => {
    const b = sampleLibrary()
    const before = b.peek('第九神座/设定集/人物/_模板.md')
    await ensureTemplate(b, '第九神座/设定集/人物')
    expect(b.peek('第九神座/设定集/人物/_模板.md')).toBe(before)
  })
})

describe('writeNewDoc · 新建文档', () => {
  it('追加到目录末尾并分配序号', async () => {
    const b = sampleLibrary()
    const { path } = await writeNewDoc(
      b,
      '第九神座/正文/0010-第一卷 少年游',
      '第三章 上路',
      'chapter',
      '',
      { now: NOW },
    )
    expect(path).toBe('第九神座/正文/0010-第一卷 少年游/0030-第三章 上路.md')
  })

  it('空目录里从 0010 起', async () => {
    const b = new MemoryBackend()
    const { path } = await writeNewDoc(b, '书/正文', '第一章', 'chapter', '', { now: NOW })
    expect(path).toBe('书/正文/0010-第一章.md')
  })

  it('新建的文档类型与标题正确', async () => {
    const b = new MemoryBackend()
    const { doc } = await writeNewDoc(b, '书/大纲', '总纲', 'outline', '大纲内容', { now: NOW })
    expect(doc.meta.type).toBe('outline')
    expect(doc.meta.title).toBe('总纲')
    expect(doc.meta.id).toMatch(/^out-/)
  })

  it('新建后立刻能读回来', async () => {
    const b = new MemoryBackend()
    const { path } = await writeNewDoc(b, '书/正文', '第一章', 'chapter', '正文内容', { now: NOW })
    expect((await readDoc(b, path)).body.trim()).toBe('正文内容')
  })
})

describe('sanitizeFileName', () => {
  it('替换 Windows 非法字符', () => {
    expect(sanitizeFileName('A/B\\C:D*E?F"G<H>I|J')).toBe('A_B_C_D_E_F_G_H_I_J')
  })

  it('中文标点不受影响', () => {
    expect(sanitizeFileName('《剑经》第一卷：少年游')).toBe('《剑经》第一卷：少年游')
  })

  it('去掉结尾的点和空格（Windows 不允许）', () => {
    expect(sanitizeFileName('文件名... ')).toBe('文件名')
  })

  it('空名字回落到「未命名」', () => {
    expect(sanitizeFileName('   ')).toBe('未命名')
    expect(sanitizeFileName('///')).toBe('___')
  })

  it('超长名字被截断', () => {
    expect(sanitizeFileName('啊'.repeat(200)).length).toBe(100)
  })
})

describe('端到端：新建作品 → 写章节 → 建便利贴 → 重新加载', () => {
  it('全流程数据一致', async () => {
    const b = new MemoryBackend()

    // 1. 新建作品
    const book = await createBook(b, '', '试验田', { now: NOW })

    // 2. 加一章
    await writeNewDoc(b, `${book.rootPath}/正文`, '第二章 转折', 'chapter', '第二章的内容。', { now: NOW })

    // 3. 建一个设定分类和模板
    await b.mkdir(`${book.rootPath}/设定集/人物`)
    await ensureTemplate(b, `${book.rootPath}/设定集/人物`)

    // 4. 用模板建一张便利贴
    let tree = await loadTree(b, book.rootPath)
    await createSettingCard(b, cat(tree.settings, '人物'), '李四', { now: NOW })

    // 5. 重新加载，检查一切都在
    tree = await loadTree(b, book.rootPath)
    expect(tree.meta.title).toBe('试验田')
    expect(flattenChapters(tree.text).map((c) => c.title)).toEqual(['第一章', '第二章 转折'])
    expect(cat(tree.settings, '人物').cards.map((c) => c.title)).toEqual(['李四'])
    expect(tree.conflicts).toEqual([])

    // 6. 书架也能看到
    expect((await scanLibrary(b)).map((x) => x.meta.title)).toEqual(['试验田'])
  })
})
