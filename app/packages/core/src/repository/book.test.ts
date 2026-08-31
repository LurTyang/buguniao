/**
 * 作品级操作测试：改分类 / 改书名 / 换封面 / 删作品 / 删设定分类。
 *
 * 这几个操作动的是整本书或整个分类，出错代价最大，所以逐条钉死。
 */

import { describe, it, expect } from 'vitest'
import { MemoryBackend } from '../storage/memory.js'
import { parseBookMeta } from '../frontmatter/index.js'
import {
  clearBookCover,
  createBook,
  createSettingCategory,
  loadTree,
  readDoc,
  renameBook,
  scanLibrary,
  setBookCover,
  trashBook,
  trashSettingCategory,
  updateBookMeta,
} from './index.js'

const BOOK = '第九神座'

function lib(): MemoryBackend {
  return new MemoryBackend({
    files: {
      [`${BOOK}/book.yaml`]:
        'schemaVersion: 1\nid: bk-9shen\ntitle: 第九神座\nstatus: serializing\ncreatedAt: "2026-08-25T10:00:00+08:00"',
      [`${BOOK}/正文/0010-第一章.md`]:
        '---\nid: ch-a\ntype: chapter\ntitle: 第一章\n---\n\n他从四十八楼掉下去。',
      [`${BOOK}/设定集/人物/李四.md`]: '---\nid: set-l\ntype: setting\ntitle: 李四\n---\n\n# 李四',
      [`${BOOK}/设定集/人物/_模板.md`]: '# {{标题}}\n\n@身份：@\n',
    },
  })
}

const meta = (b: MemoryBackend, root = BOOK) => parseBookMeta(b.peek(`${root}/book.yaml`) as string)

describe('updateBookMeta · 改分类等字段', () => {
  it('把作品标成「坑啦」', async () => {
    const b = lib()
    await updateBookMeta(b, BOOK, { status: 'pit' })
    expect(meta(b).status).toBe('pit')
  })

  it('改完书架上能看到新状态', async () => {
    const b = lib()
    await updateBookMeta(b, BOOK, { status: 'finished' })
    expect((await scanLibrary(b))[0]?.meta.status).toBe('finished')
  })

  it('不动其他字段', async () => {
    const b = lib()
    await updateBookMeta(b, BOOK, { status: 'pit' })
    expect(meta(b).id).toBe('bk-9shen')
    expect(meta(b).title).toBe('第九神座')
  })

  it('可以设作者与简介', async () => {
    const b = lib()
    await updateBookMeta(b, BOOK, { author: '明听', summary: '一句话简介' })
    expect(meta(b).author).toBe('明听')
    expect(meta(b).summary).toBe('一句话简介')
  })
})

describe('renameBook · 改书名', () => {
  it('文件夹和 book.yaml 一起改', async () => {
    const b = lib()
    const r = await renameBook(b, '', BOOK, '第九神座（修订版）')

    expect(r.rootPath).toBe('第九神座（修订版）')
    expect(meta(b, r.rootPath).title).toBe('第九神座（修订版）')
    expect(b.peek(`${BOOK}/book.yaml`)).toBeNull()
  })

  it('章节跟着搬走，一篇不丢', async () => {
    const b = lib()
    const r = await renameBook(b, '', BOOK, '新名字')
    const tree = await loadTree(b, r.rootPath)
    expect(tree.text).toHaveLength(1)
    expect(b.peek(`${r.rootPath}/正文/0010-第一章.md`)).toContain('他从四十八楼掉下去。')
  })

  it('非法字符被替换，但 book.yaml 里保留原始书名', async () => {
    const b = lib()
    const r = await renameBook(b, '', BOOK, 'A/B')
    expect(r.rootPath).toBe('A_B')
    expect(meta(b, 'A_B').title).toBe('A/B')
  })

  it('【关键】目标文件夹已存在时拒绝，不覆盖别人的书', async () => {
    const b = lib()
    await b.write('别的书/book.yaml', 'id: bk-x\ntitle: 别的书\nstatus: pit')
    await expect(renameBook(b, '', BOOK, '别的书')).rejects.toThrow('已经有一个叫')
    // 原书没被动
    expect(b.peek(`${BOOK}/book.yaml`)).not.toBeNull()
  })

  it('改成同名时不炸', async () => {
    const b = lib()
    const r = await renameBook(b, '', BOOK, BOOK)
    expect(r.rootPath).toBe(BOOK)
  })
})

describe('trashBook · 删作品', () => {
  it('整个文件夹移进回收站，不是硬删', async () => {
    const b = lib()
    const { trashPath } = await trashBook(b, '', BOOK)

    expect(trashPath).toBe(`_回收站/${BOOK}`)
    expect(b.peek(`${BOOK}/book.yaml`)).toBeNull()
    expect(b.peek(`${trashPath}/正文/0010-第一章.md`)).toContain('他从四十八楼掉下去。')
  })

  it('删掉后书架上看不到了', async () => {
    const b = lib()
    await trashBook(b, '', BOOK)
    expect(await scanLibrary(b)).toEqual([])
  })

  it('回收站里的书不会被当成作品扫出来', async () => {
    const b = lib()
    await trashBook(b, '', BOOK)
    // _回收站 以 _ 开头，扫描时会跳过
    expect((await scanLibrary(b)).map((x) => x.folderName)).not.toContain('_回收站')
  })

  it('同名冲突时加时间戳，不覆盖已删的那本', async () => {
    const b = lib()
    await trashBook(b, '', BOOK)
    await b.write(`${BOOK}/book.yaml`, 'id: bk-2\ntitle: 第九神座\nstatus: pit')
    const { trashPath } = await trashBook(b, '', BOOK, Date.parse('2026-08-25T02:00:00Z'))
    expect(trashPath).toContain('2026-08-25T02-00-00')
  })
})

describe('封面', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  it('写进作品目录并记进 book.yaml', async () => {
    const b = lib()
    const r = await setBookCover(b, BOOK, png, 'png')
    expect(r.cover).toBe('cover.png')
    expect(meta(b).cover).toBe('cover.png')
    expect(b.snapshotPaths()).toContain(`${BOOK}/cover.png`)
  })

  it('扩展名带点也能处理', async () => {
    const b = lib()
    expect((await setBookCover(b, BOOK, png, '.JPG')).cover).toBe('cover.jpg')
  })

  it('【关键】换格式时删掉旧封面，不在目录里堆一堆', async () => {
    const b = lib()
    await setBookCover(b, BOOK, png, 'jpg')
    await setBookCover(b, BOOK, png, 'png')

    const covers = b.snapshotPaths().filter((p) => p.includes('/cover.'))
    expect(covers).toEqual([`${BOOK}/cover.png`])
    expect(meta(b).cover).toBe('cover.png')
  })

  it('移除封面把文件和字段一起清掉', async () => {
    const b = lib()
    await setBookCover(b, BOOK, png, 'png')
    await clearBookCover(b, BOOK)

    expect(b.snapshotPaths().filter((p) => p.includes('/cover.'))).toEqual([])
    expect(meta(b).cover).toBeUndefined()
  })

  it('没有封面时移除也不报错', async () => {
    const b = lib()
    await expect(clearBookCover(b, BOOK)).resolves.toBeUndefined()
  })
})

describe('trashSettingCategory · 删设定分类', () => {
  it('整个分类连同里面的卡片一起进回收站', async () => {
    const b = lib()
    const { trashPath } = await trashSettingCategory(b, BOOK, `${BOOK}/设定集/人物`)

    expect(trashPath).toBe(`${BOOK}/_回收站/设定集/人物`)
    expect(b.peek(`${BOOK}/设定集/人物/李四.md`)).toBeNull()
    expect(b.peek(`${trashPath}/李四.md`)).toContain('# 李四')
    // 模板也跟着走
    expect(b.peek(`${trashPath}/_模板.md`)).toContain('{{标题}}')
  })

  it('删完目录树里没有这个分类了', async () => {
    const b = lib()
    await trashSettingCategory(b, BOOK, `${BOOK}/设定集/人物`)
    expect((await loadTree(b, BOOK)).settings).toEqual([])
  })

  it('不影响其他分类', async () => {
    const b = lib()
    await createSettingCategory(b, BOOK, '功法')
    await trashSettingCategory(b, BOOK, `${BOOK}/设定集/人物`)

    const tree = await loadTree(b, BOOK)
    expect(tree.settings.map((c) => c.name)).toEqual(['功法'])
  })

  it('同名冲突时加时间戳', async () => {
    const b = lib()
    await trashSettingCategory(b, BOOK, `${BOOK}/设定集/人物`)
    await createSettingCategory(b, BOOK, '人物')
    const { trashPath } = await trashSettingCategory(
      b,
      BOOK,
      `${BOOK}/设定集/人物`,
      Date.parse('2026-08-25T02:00:00Z'),
    )
    expect(trashPath).toContain('2026-08-25T02-00-00')
  })
})

// ───────────────────────── 作品类型 ─────────────────────────

describe('新建作品时按类型套骨架', () => {
  const mk = async (kind: 'novel' | 'script' | 'game') => {
    const backend = new MemoryBackend()
    const b = await createBook(backend, '/根', `${kind}书`, { kind })
    const tree = await loadTree(backend, b.rootPath)
    const first = tree.text[0]!
    const doc = await readDoc(backend, first.path)
    return { backend, b, tree, first, doc }
  }

  it('小说还是原来那样：空的第一章', async () => {
    const { b, first, doc } = await mk('novel')
    expect(first.title).toBe('第一章')
    expect(doc.body.trim()).toBe('')
    // 老书没有 kind 这一项，所以小说也不写
    expect(b.meta.kind).toBeUndefined()
  })

  it('剧本给一份带场景标题的骨架', async () => {
    const { b, first, doc } = await mk('script')
    expect(b.meta.kind).toBe('script')
    expect(first.title).toBe('第一场')
    expect(doc.body).toContain('内景')
    expect(doc.body).toMatch(/^.{1,10}：/m)
  })

  it('游戏给一份跑得通的分支骨架', async () => {
    const { b, first, doc } = await mk('game')
    expect(b.meta.kind).toBe('game')
    expect(first.title).toBe('第一幕')
    expect(doc.body).toContain('->')
  })

  it('【关键】剧本和游戏先把人物分类建好并指过去', async () => {
    // 不然作者得先自己去找那个开关，角色名单独排一行这件事就永远不会发生
    for (const kind of ['script', 'game'] as const) {
      const { b, tree } = await mk(kind)
      expect(b.meta.castFrom).toEqual(['人物'])
      expect(tree.settings.map((c) => c.name)).toContain('人物')
    }
  })

  it('类型写进 book.yaml，读回来还是它', async () => {
    const { backend, b } = await mk('script')
    const again = parseBookMeta(await backend.read(`${b.rootPath}/book.yaml`))
    expect(again.kind).toBe('script')
    expect(again.castFrom).toEqual(['人物'])
  })

  it('改类型走 updateBookMeta', async () => {
    const { backend, b } = await mk('novel')
    const m = await updateBookMeta(backend, b.rootPath, { kind: 'script' })
    expect(m.kind).toBe('script')
    expect(parseBookMeta(await backend.read(`${b.rootPath}/book.yaml`)).kind).toBe('script')
  })
})

describe('置顶', () => {
  it('置顶的排在最前面，其余按书名', async () => {
    const backend = new MemoryBackend()
    for (const t of ['丙书', '甲书', '乙书']) await createBook(backend, '/根', t)
    await updateBookMeta(backend, '/根/乙书', { pinned: true })

    const list = await scanLibrary(backend, '/根')
    expect(list.map((b) => b.meta.title)).toEqual(['乙书', '丙书', '甲书'])
  })

  it('都置顶时仍按书名 —— 置顶不是又一套要手工维护的顺序', async () => {
    const backend = new MemoryBackend()
    for (const t of ['丙书', '甲书']) {
      await createBook(backend, '/根', t)
      await updateBookMeta(backend, `/根/${t}`, { pinned: true })
    }
    expect((await scanLibrary(backend, '/根')).map((b) => b.meta.title)).toEqual(['丙书', '甲书'])
  })

  it('置顶写进 book.yaml，取消之后不留痕', async () => {
    const backend = new MemoryBackend()
    const b = await createBook(backend, '/根', '某书')
    await updateBookMeta(backend, b.rootPath, { pinned: true })
    expect(await backend.read(`${b.rootPath}/book.yaml`)).toContain('pinned')
    await updateBookMeta(backend, b.rootPath, { pinned: false })
    expect(await backend.read(`${b.rootPath}/book.yaml`)).not.toContain('pinned')
  })
})
