/**
 * 目录管理测试：重命名 / 删除 / 新建卷 / 拖拽排序 / 换卷 / 设定分类。
 *
 * 这些操作会**动作者磁盘上的真实文件**，出错的代价是丢稿或串稿，
 * 所以每一条都要有测试兜着。
 */

import { describe, it, expect } from 'vitest'
import { MemoryBackend } from '../storage/memory.js'
import { parseDoc } from '../frontmatter/index.js'
import {
  createBook,
  createSettingCard,
  createSettingCategory,
  createVolume,
  defaultTemplate,
  emptyTrash,
  flattenChapters,
  listTrash,
  loadTree,
  moveChapterToDir,
  readDoc,
  autoTitlePath,
  isUntitledFile,
  renameDoc,
  renameVolume,
  reorderInDir,
  titleFromBody,
  writeNewDoc,
  restoreFromTrash,
  trashDoc,
  type SettingCategory,
} from './index.js'

const NOW = '2026-08-25T02:00:00.000+08:00'

/** 按名字取分类。不要按下标取 —— 排序用的是拼音 */
const cat = (list: readonly SettingCategory[], name: string): SettingCategory => {
  const c = list.find((x) => x.name === name)
  if (!c) throw new Error(`没有找到分类：${name}`)
  return c
}

const CH1 = '第九神座/正文/0010-第一卷 少年游/0010-第一章 坠楼.md'
const CH2 = '第九神座/正文/0010-第一卷 少年游/0020-第二章 醒来.md'
const VOL1 = '第九神座/正文/0010-第一卷 少年游'
const VOL2 = '第九神座/正文/0020-第二卷 江湖远'

function sampleLibrary(): MemoryBackend {
  return new MemoryBackend({
    files: {
      '第九神座/book.yaml': 'schemaVersion: 1\nid: bk-9shen\ntitle: 第九神座\nstatus: serializing',
      [CH1]: '---\nid: ch-aaa111\ntype: chapter\ntitle: 第一章 坠楼\n---\n\n他从四十八楼掉下去。',
      [CH2]: '---\nid: ch-bbb222\ntype: chapter\ntitle: 第二章 醒来\n---\n\n他醒了。',
      [`${VOL2}/0010-第三章 出门.md`]:
        '---\nid: ch-ccc333\ntype: chapter\ntitle: 第三章 出门\n---\n\n他出门了。',
      '第九神座/设定集/人物/李四.md': '---\nid: set-lisi\ntype: setting\ntitle: 李四\n---\n\n# 李四',
    },
  })
}

// ═════════════════════════ 重命名 ═════════════════════════

describe('renameDoc', () => {
  it('改文件名的同时改 front-matter 里的标题', async () => {
    const b = sampleLibrary()
    const { path } = await renameDoc(b, CH1, '第一章 从天而降', NOW)

    expect(path).toBe('第九神座/正文/0010-第一卷 少年游/0010-第一章 从天而降.md')
    expect(parseDoc(b.peek(path) as string).meta.title).toBe('第一章 从天而降')
    expect(b.peek(CH1)).toBeNull()
  })

  it('序号前缀保持不变 —— 改名不该顺带改顺序', async () => {
    const b = sampleLibrary()
    const { path } = await renameDoc(b, CH2, '新名字', NOW)
    expect(path).toContain('/0020-新名字.md')
  })

  it('正文内容一个字不动', async () => {
    const b = sampleLibrary()
    const { path } = await renameDoc(b, CH1, '改了名', NOW)
    expect(parseDoc(b.peek(path) as string).body.trim()).toBe('他从四十八楼掉下去。')
  })

  it('【关键】文档 id 不变，历史与伏笔的关联不断', async () => {
    const b = sampleLibrary()
    const before = parseDoc(b.peek(CH1) as string).meta.id
    const { path } = await renameDoc(b, CH1, '改了名', NOW)
    expect(parseDoc(b.peek(path) as string).meta.id).toBe(before)
  })

  it('非法字符被替换', async () => {
    const b = sampleLibrary()
    const { path } = await renameDoc(b, CH1, 'A/B', NOW)
    expect(path).toContain('/0010-A_B.md')
  })

  it('改成同名时不炸', async () => {
    const b = sampleLibrary()
    const { path } = await renameDoc(b, CH1, '第一章 坠楼', NOW)
    expect(path).toBe(CH1)
    expect(b.peek(CH1)).toContain('他从四十八楼掉下去。')
  })
})

describe('renameVolume', () => {
  it('只改文件夹名，卷里的章节跟着搬走', async () => {
    const b = sampleLibrary()
    const { path } = await renameVolume(b, VOL1, '第一卷 少年行')

    expect(path).toBe('第九神座/正文/0010-第一卷 少年行')
    expect(b.snapshotPaths().filter((p) => p.startsWith(path))).toHaveLength(2)
  })

  it('改完目录树仍然正确', async () => {
    const b = sampleLibrary()
    await renameVolume(b, VOL1, '第一卷 少年行')

    const tree = await loadTree(b, '第九神座')
    expect(tree.text.map((n) => n.title)).toEqual(['第一卷 少年行', '第二卷 江湖远'])
    expect(flattenChapters(tree.text)).toHaveLength(3)
  })
})

// ═════════════════════════ 回收站 ═════════════════════════

describe('trashDoc · 删除进回收站', () => {
  it('移进回收站而不是硬删', async () => {
    const b = sampleLibrary()
    const { trashPath } = await trashDoc(b, '第九神座', CH2)

    expect(trashPath).toBe('第九神座/_回收站/正文/0010-第一卷 少年游/0020-第二章 醒来.md')
    expect(b.peek(CH2)).toBeNull()
    expect(b.peek(trashPath)).toContain('他醒了。')
  })

  it('保留原相对路径，恢复时知道放回哪儿', async () => {
    const b = sampleLibrary()
    await trashDoc(b, '第九神座', CH2)

    const [entry] = await listTrash(b, '第九神座')
    expect(entry?.originalPath).toBe(CH2)
    expect(entry?.name).toBe('第二章 醒来')
  })

  it('同名冲突时加时间戳，不覆盖已有的', async () => {
    const b = sampleLibrary()
    await trashDoc(b, '第九神座', CH2)

    await b.write(CH2, '---\nid: ch-new\ntype: chapter\ntitle: 第二章 醒来\n---\n\n重写的版本')
    const { trashPath } = await trashDoc(b, '第九神座', CH2, Date.parse('2026-08-25T02:00:00Z'))

    expect(trashPath).toContain('2026-08-25T02-00-00')
    expect(await listTrash(b, '第九神座')).toHaveLength(2)
  })

  it('恢复回原位置', async () => {
    const b = sampleLibrary()
    await trashDoc(b, '第九神座', CH2)

    const [entry] = await listTrash(b, '第九神座')
    await restoreFromTrash(b, entry!)
    expect(b.peek(CH2)).toContain('他醒了。')
    expect(await listTrash(b, '第九神座')).toHaveLength(0)
  })

  it('【关键】原位置已被占用时拒绝恢复，不悄悄覆盖', async () => {
    const b = sampleLibrary()
    await trashDoc(b, '第九神座', CH2)
    await b.write(CH2, '后来又写的新内容')

    const [entry] = await listTrash(b, '第九神座')
    await expect(restoreFromTrash(b, entry!)).rejects.toThrow('已经有同名文件')
    expect(b.peek(CH2)).toBe('后来又写的新内容')
  })

  it('回收站里的东西不出现在目录树里', async () => {
    const b = sampleLibrary()
    await trashDoc(b, '第九神座', CH2)

    const tree = await loadTree(b, '第九神座')
    expect(flattenChapters(tree.text).map((c) => c.title)).toEqual(['第一章 坠楼', '第三章 出门'])
  })

  it('清空回收站是唯一真正删文件的地方', async () => {
    const b = sampleLibrary()
    await trashDoc(b, '第九神座', CH2)
    expect(await emptyTrash(b, '第九神座')).toBe(1)
    expect(await listTrash(b, '第九神座')).toHaveLength(0)
  })

  it('空回收站清空返回 0，不抛错', async () => {
    expect(await emptyTrash(sampleLibrary(), '第九神座')).toBe(0)
  })
})

// ═════════════════════════ 卷 ═════════════════════════

describe('createVolume', () => {
  it('追加到正文末尾', async () => {
    const b = sampleLibrary()
    expect((await createVolume(b, '第九神座', '第三卷 天外天')).path).toBe('第九神座/正文/0030-第三卷 天外天')
  })

  it('新建的卷能被目录树扫到', async () => {
    const b = sampleLibrary()
    const { path } = await createVolume(b, '第九神座', '第三卷 天外天')
    await writeNewDoc(b, path, '第四章', 'chapter', '', { now: NOW })

    const tree = await loadTree(b, '第九神座')
    expect(tree.text.map((n) => n.title)).toEqual(['第一卷 少年游', '第二卷 江湖远', '第三卷 天外天'])
  })

  it('空作品里建第一卷', async () => {
    const b = new MemoryBackend()
    await createBook(b, '', '新书', { now: NOW })
    // 已有 0010-第一章.md，所以新卷排在 0020
    expect((await createVolume(b, '新书', '第一卷')).path).toBe('新书/正文/0020-第一卷')
  })
})

// ═════════════════════════ 排序 ═════════════════════════

describe('reorderInDir · 拖拽排序', () => {
  const threeChapters = async () => {
    const b = new MemoryBackend()
    await createBook(b, '', '书', { now: NOW })
    await writeNewDoc(b, '书/正文', '第二章', 'chapter', 'b', { now: NOW })
    await writeNewDoc(b, '书/正文', '第三章', 'chapter', 'c', { now: NOW })
    return b
  }
  const titles = async (b: MemoryBackend) =>
    flattenChapters((await loadTree(b, '书')).text).map((c) => c.title)

  it('把最后一章移到最前面，只重命名 1 个文件', async () => {
    const b = await threeChapters()
    const r = await reorderInDir(b, '书/正文', 2, 0)

    expect(r.renamed).toBe(1)
    expect(r.renumbered).toBe(false)
    expect(await titles(b)).toEqual(['第三章', '第一章', '第二章'])
  })

  it('把第一章移到中间', async () => {
    const b = await threeChapters()
    await reorderInDir(b, '书/正文', 0, 1)
    expect(await titles(b)).toEqual(['第二章', '第一章', '第三章'])
  })

  it('正文内容跟着走，不串稿', async () => {
    const b = await threeChapters()
    await reorderInDir(b, '书/正文', 2, 0)

    const first = flattenChapters((await loadTree(b, '书')).text)[0]!
    expect((await readDoc(b, first.path)).body.trim()).toBe('c')
  })

  it('移到原位不改任何文件', async () => {
    const b = await threeChapters()
    expect((await reorderInDir(b, '书/正文', 1, 1)).renamed).toBe(0)
  })

  /** 序号挤在一起的三章：0010 / 0011 / 0012 */
  const tightThree = () =>
    new MemoryBackend({
      files: {
        '书/book.yaml': 'id: bk-x\ntitle: 书\nstatus: serializing',
        '书/正文/0010-甲.md': '---\nid: ch-a\ntype: chapter\ntitle: 甲\n---\n\nA',
        '书/正文/0011-乙.md': '---\nid: ch-b\ntype: chapter\ntitle: 乙\n---\n\nB',
        '书/正文/0012-丙.md': '---\nid: ch-c\ntype: chapter\ntitle: 丙\n---\n\nC',
      },
    })

  it('序号挤在一起时，往最前面拖仍只改 1 个文件（前面还有空位）', async () => {
    const b = tightThree()
    const r = await reorderInDir(b, '书/正文', 2, 0)

    // 0010 之前还能塞 0005，不必惊动其他文件
    expect(r.renumbered).toBe(false)
    expect(r.renamed).toBe(1)
    expect(flattenChapters((await loadTree(b, '书')).text).map((c) => c.title)).toEqual([
      '丙',
      '甲',
      '乙',
    ])
  })

  it('【关键】往中间没空位的地方拖会整段重排，且不会互相覆盖', async () => {
    // 拖到 0011 与 0012 之间 —— 中间没有整数空位，必须整段重排。
    // 若直接按顺序改名，0011→0020 时 0020 可能还被占着，会覆盖或失败，
    // 所以实现里先全部改成临时名再改成目标名。
    const b = tightThree()
    const r = await reorderInDir(b, '书/正文', 0, 1)
    expect(r.renumbered).toBe(true)

    const chapters = flattenChapters((await loadTree(b, '书')).text)
    expect(chapters.map((c) => c.title)).toEqual(['乙', '甲', '丙'])
    expect(chapters).toHaveLength(3)
    expect(chapters.map((c) => c.fileName)).toEqual(['0010-乙.md', '0020-甲.md', '0030-丙.md'])

    // 内容没有串位
    for (const [title, expected] of [
      ['甲', 'A'],
      ['乙', 'B'],
      ['丙', 'C'],
    ] as const) {
      const node = chapters.find((c) => c.title === title)!
      expect((await readDoc(b, node.path)).body.trim()).toBe(expected)
    }
  })

  it('反复拖拽 30 次后一章不丢、顺序自洽', async () => {
    const b = await threeChapters()
    for (let i = 0; i < 30; i++) {
      await reorderInDir(b, '书/正文', i % 3, (i * 2 + 1) % 3)
    }
    const chapters = flattenChapters((await loadTree(b, '书')).text)
    expect(chapters).toHaveLength(3)
    expect(new Set(chapters.map((c) => c.title)).size).toBe(3)
  })
})

describe('moveChapterToDir · 换卷', () => {
  it('移到另一个卷，放在末尾', async () => {
    const b = sampleLibrary()
    const { path } = await moveChapterToDir(b, CH2, VOL2)
    expect(path).toBe('第九神座/正文/0020-第二卷 江湖远/0020-第二章 醒来.md')

    const tree = await loadTree(b, '第九神座')
    const vol2 = tree.text.find((n) => n.title === '第二卷 江湖远')
    expect(vol2?.kind === 'volume' && vol2.chapters.map((c) => c.title)).toEqual([
      '第三章 出门',
      '第二章 醒来',
    ])
  })

  it('内容与 id 都不变', async () => {
    const b = sampleLibrary()
    const before = parseDoc(b.peek(CH2) as string).meta.id
    const { path } = await moveChapterToDir(b, CH2, VOL2)
    expect(parseDoc(b.peek(path) as string).meta.id).toBe(before)
    expect(b.peek(path)).toContain('他醒了。')
  })

  it('原卷里少了一章', async () => {
    const b = sampleLibrary()
    await moveChapterToDir(b, CH2, VOL2)

    const tree = await loadTree(b, '第九神座')
    const vol1 = tree.text.find((n) => n.title === '第一卷 少年游')
    expect(vol1?.kind === 'volume' && vol1.chapters).toHaveLength(1)
  })
})

// ═════════════════════════ 设定分类 ═════════════════════════

describe('createSettingCategory', () => {
  it('建文件夹并放一份默认模板', async () => {
    const b = sampleLibrary()
    const { path, templatePath } = await createSettingCategory(b, '第九神座', '势力')
    expect(path).toBe('第九神座/设定集/势力')
    expect(b.peek(templatePath)).toBe(defaultTemplate())
  })

  it('新分类能被目录树扫到，且标出有模板', async () => {
    const b = sampleLibrary()
    await createSettingCategory(b, '第九神座', '势力')

    const tree = await loadTree(b, '第九神座')
    expect(cat(tree.settings, '势力').templatePath).not.toBeNull()
    expect(cat(tree.settings, '势力').cards).toEqual([])
  })

  it('建完就能按模板加卡片', async () => {
    const b = sampleLibrary()
    await createSettingCategory(b, '第九神座', '势力')
    let tree = await loadTree(b, '第九神座')
    await createSettingCard(b, cat(tree.settings, '势力'), '青云门', { now: NOW })

    tree = await loadTree(b, '第九神座')
    expect(cat(tree.settings, '势力').cards.map((c) => c.title)).toEqual(['青云门'])
    expect(b.peek('第九神座/设定集/势力/青云门.md')).toContain('# 青云门')
  })
})

/**
 * 没起名的那一篇。
 *
 * 作者要的：「创建新文本时，应可以创建空白标题的文本。
 * 在保存时，这样的章节标题被显示为首行。」
 *
 * 这两个纯函数是那条路上唯一会算错的地方 —— 认错了「还没起名」，
 * 后果是**一篇起好名的稿子被自己改了名**。
 */
describe('没起名的那一篇', () => {
  it('标题留空时，文件名是「未命名」', async () => {
    const b = sampleLibrary()
    const { path } = await writeNewDoc(b, '第九神座/正文', '', 'chapter', '')
    expect(path.endsWith('未命名.md')).toBe(true)
    expect(isUntitledFile(path.slice(path.lastIndexOf('/') + 1))).toBe(true)
  })

  it('起过名的认作起过名 —— 认错了会把人家的稿子改了名', () => {
    expect(isUntitledFile('0010-第三章 转折.md')).toBe(false)
    expect(isUntitledFile('0010-未命名的旅程.md')).toBe(false)
    expect(isUntitledFile('0010-未命名.md')).toBe(true)
    // 没有序号前缀的也认（设定卡就没有）
    expect(isUntitledFile('未命名.md')).toBe(true)
  })

  it('拿第一行当标题', () => {
    expect(titleFromBody('赵嘉乐睁开眼。\n天亮了。')).toBe('赵嘉乐睁开眼。')
  })

  it('【关键】跳过开头的空行 —— 新建的文档正文头上就有一个', () => {
    expect(titleFromBody('\n\n赵嘉乐睁开眼。')).toBe('赵嘉乐睁开眼。')
  })

  it('第一行是 Markdown 标题时去掉井号', () => {
    expect(titleFromBody('# 第三章 转折\n\n正文。')).toBe('第三章 转折')
    expect(titleFromBody('### 小节')).toBe('小节')
  })

  it('太长的截断，且不加省略号 —— 省略号会进文件名', () => {
    const long = '一'.repeat(80)
    expect(titleFromBody(long)).toBe('一'.repeat(30))
    expect(titleFromBody(long, 8)).toBe('一'.repeat(8))
  })

  it('一个字都没有时返回空串 —— 那就还不能起名', () => {
    expect(titleFromBody('')).toBe('')
    expect(titleFromBody('\n\n   \n')).toBe('')
  })

  it('井号后面没有空格的不当标题 —— 那是游戏剧本的节点名', () => {
    // `#节点名` 是游戏剧本的写法，不是 Markdown 标题
    expect(titleFromBody('#开场')).toBe('#开场')
    expect(titleFromBody('#')).toBe('#')
  })
})

describe('自动起名：该改叫什么', () => {
  it('第一次写进字，文件名跟着变成第一行', () => {
    expect(autoTitlePath('第九神座/正文/0010-未命名.md', '\n赵嘉乐睁开眼。')).toEqual({
      path: '第九神座/正文/0010-赵嘉乐睁开眼。.md',
      title: '赵嘉乐睁开眼。',
    })
  })

  it('【关键】起过名的一概不动 —— 这是这个函数唯一不能犯的错', () => {
    expect(autoTitlePath('第九神座/正文/0010-第三章 转折.md', '正文')).toBeNull()
  })

  it('还一个字都没有时不起名', () => {
    expect(autoTitlePath('第九神座/正文/0010-未命名.md', '\n\n  ')).toBeNull()
  })

  it('序号前缀原样留着 —— 起名不该顺带改顺序', () => {
    expect(autoTitlePath('第九神座/正文/0230-未命名.md', '开头')?.path).toBe(
      '第九神座/正文/0230-开头.md',
    )
  })

  it('第一行里有文件名不许出现的字符时换掉，不是报错', () => {
    expect(autoTitlePath('第九神座/正文/0010-未命名.md', '他问：真的?')?.path).toBe(
      '第九神座/正文/0010-他问：真的_.md',
    )
  })

  it('第一行正好写着「未命名」时不折腾', () => {
    expect(autoTitlePath('第九神座/正文/0010-未命名.md', '未命名')).toBeNull()
  })
})
