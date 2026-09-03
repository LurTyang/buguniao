/**
 * 保存管线测试 —— 跑在真实文件系统上。
 *
 * 一次保存要同时写三份数据（正文 / 版本历史 / 码字统计），
 * 而且正文永远第一优先。这里把这些约束逐条锁死。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Workspace } from './workspace.js'
import { parseHistoryJsonl, parseStatsJsonl, reconstruct, flattenChapters } from '@bugu/core'

let root: string
let ws: Workspace

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'bugu-ws-'))
  ws = new Workspace(root, 'pc-test', path.join(root, '_index.db'))
})

afterEach(async () => {
  ws.close()
  await fs.rm(root, { recursive: true, force: true })
})

/** 建一本书，返回第一章的路径 */
async function newBookWithChapter(title = '试验田'): Promise<{ book: string; chapter: string }> {
  const book = await ws.createBook(title)
  const tree = await ws.loadTree(book.rootPath)
  return { book: book.rootPath, chapter: flattenChapters(tree.text)[0]!.path }
}

const readJsonl = async (p: string) => fs.readFile(path.join(root, p), 'utf8')

describe('书架与目录', () => {
  it('新建作品后能扫到', async () => {
    await ws.createBook('第九神座')
    expect((await ws.listBooks()).map((b) => b.meta.title)).toEqual(['第九神座'])
  })

  it('新建作品自带第一章', async () => {
    const { chapter } = await newBookWithChapter()
    expect(chapter).toContain('0010-第一章.md')
  })

  it('新建章节追加到末尾', async () => {
    const { book } = await newBookWithChapter()
    const { path: p } = await ws.createChapter(`${book}/正文`, '第二章 转折')
    expect(p).toBe(`${book}/正文/0020-第二章 转折.md`)

    const tree = await ws.loadTree(book)
    expect(flattenChapters(tree.text).map((c) => c.title)).toEqual(['第一章', '第二章 转折'])
  })
})

describe('saveDoc · 保存管线', () => {
  it('正文写到磁盘，记事本能直接打开', async () => {
    const { chapter } = await newBookWithChapter()
    await ws.saveDoc(chapter, '他从四十八楼掉下去。')

    const raw = await fs.readFile(path.join(root, chapter), 'utf8')
    expect(raw).toContain('他从四十八楼掉下去。')
    expect(raw.startsWith('---')).toBe(true)
  })

  it('返回字数与版本号', async () => {
    const { chapter } = await newBookWithChapter()
    const out = await ws.saveDoc(chapter, '他掉下去了。')
    expect(out.chars).toBe(6)
    expect(out.version).toBe(1)
    expect(out.historyAction).toBe('created')
  })

  it('写版本历史，且能还原', async () => {
    const { book, chapter } = await newBookWithChapter()
    const meta = await ws.readDoc(chapter)

    await ws.saveDoc(chapter, '第一版内容')
    // 跨一个时间桶，避免被合并
    await new Promise((r) => setTimeout(r, 5))
    await ws.saveDoc(chapter, '第一版内容\n\n第二段')

    const hist = parseHistoryJsonl(await readJsonl(`${book}/.bugu/history/${meta.meta.id}/pc-test.jsonl`))
    expect(hist.length).toBeGreaterThanOrEqual(1)
    const last = hist[hist.length - 1]!
    expect(reconstruct(hist, last.v)).toBe('第一版内容\n\n第二段')
  })

  it('写码字统计，净增正确', async () => {
    const { book, chapter } = await newBookWithChapter()
    await ws.saveDoc(chapter, '一二三四五')
    await ws.saveDoc(chapter, '一二三四五六七八九十')

    const stats = parseStatsJsonl(await readJsonl(`${book}/.bugu/stats/pc-test.jsonl`))
    expect(stats).toHaveLength(2)
    expect(stats[0]?.delta).toBe(5)
    expect(stats[1]?.delta).toBe(5)
    expect(stats[1]?.total).toBe(10)
  })

  it('内容没变时不写统计（避免 Ctrl+S 连按刷出一堆空记录）', async () => {
    const { book, chapter } = await newBookWithChapter()
    await ws.saveDoc(chapter, '内容')
    await ws.saveDoc(chapter, '内容')
    await ws.saveDoc(chapter, '内容')

    const stats = parseStatsJsonl(await readJsonl(`${book}/.bugu/stats/pc-test.jsonl`))
    expect(stats).toHaveLength(1)
  })

  it('删字时净增为负', async () => {
    const { book, chapter } = await newBookWithChapter()
    await ws.saveDoc(chapter, '一二三四五六七八九十')
    await ws.saveDoc(chapter, '一二三')

    const stats = parseStatsJsonl(await readJsonl(`${book}/.bugu/stats/pc-test.jsonl`))
    expect(stats[1]?.delta).toBe(-7)
  })

  it('文档 id 在多次保存间保持不变', async () => {
    const { chapter } = await newBookWithChapter()
    const a = await ws.saveDoc(chapter, '甲')
    const b = await ws.saveDoc(chapter, '乙')
    expect(a.meta.id).toBe(b.meta.id)
  })

  it('updated 时间被刷新', async () => {
    const { chapter } = await newBookWithChapter()
    const before = (await ws.readDoc(chapter)).meta.updated
    await new Promise((r) => setTimeout(r, 5))
    const after = (await ws.saveDoc(chapter, '新内容')).meta.updated
    expect(after >= before).toBe(true)
  })

  it('.bugu 目录下的都是纯文本 jsonl', async () => {
    const { book, chapter } = await newBookWithChapter()
    await ws.saveDoc(chapter, '内容')

    const walk = async (dir: string): Promise<string[]> => {
      const out: string[] = []
      for (const e of await fs.readdir(path.join(root, dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`
        if (e.isDirectory()) out.push(...(await walk(p)))
        else out.push(p)
      }
      return out
    }
    const files = await walk(`${book}/.bugu`)
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      expect(f.endsWith('.jsonl')).toBe(true)
      // 每一行都必须是合法 JSON
      const text = await fs.readFile(path.join(root, f), 'utf8')
      for (const line of text.split('\n').filter((l) => l.trim())) {
        expect(() => JSON.parse(line)).not.toThrow()
      }
    }
  })
})

describe('todayProgress', () => {
  it('没写过时全是 0，不抛错', async () => {
    const { book } = await newBookWithChapter()
    const p = await ws.todayProgress(book)
    expect(p.words).toBe(0)
    expect(p.signedIn).toBe(false)
    expect(p.streak).toBe(0)
  })

  it('写了字之后能统计到', async () => {
    const { book, chapter } = await newBookWithChapter()
    await ws.saveDoc(chapter, '字'.repeat(1234))

    const p = await ws.todayProgress(book)
    expect(p.words).toBe(1234)
  })

  /**
   * 0.4 改的：签到线**跟着作者设的每日底线走**，不再是写死的 5000。
   *
   * 原来是两条线并存 —— 计划里判「今天达标没」用的是底线，
   * 而连胜/签到用的是常量 5000。作者在计划里把目标改成 2000，
   * 稿纸右上角却始终写着「还差 5,000」，怎么改都不动。
   */
  it('【关键】签到线跟着每日底线走，不是写死的 5000', async () => {
    const { book, chapter } = await newBookWithChapter()
    // 默认档是「业余」：工作日 1000、休息日 2000，两种都远小于 5000
    await ws.saveDoc(chapter, '字'.repeat(1))
    const before = await ws.todayProgress(book)
    expect(before.signInWords).toBeLessThan(5000)
    expect(before.signInWords).toBeGreaterThan(0)
    expect(before.wordsToSignIn).toBe(before.signInWords - 1)
    expect(before.signedIn).toBe(false)
  })

  it('写够那条线就算签到', async () => {
    const { book, chapter } = await newBookWithChapter()
    // 6000 比默认档任何一天的底线都高，星期几都成立
    await ws.saveDoc(chapter, '字'.repeat(6000))

    const p = await ws.todayProgress(book)
    expect(p.signedIn).toBe(true)
    expect(p.wordsToSignIn).toBe(0)
    expect(p.streak).toBe(1)
  })

  it('改了每日目标，签到线跟着改', async () => {
    const { book, chapter } = await newBookWithChapter()
    await ws.setPlanTarget({ floor: [300, 300, 300, 300, 300, 300, 300], ideal: [600, 600, 600, 600, 600, 600, 600] })
    await ws.saveDoc(chapter, '字'.repeat(350))

    const p = await ws.todayProgress(book)
    expect(p.signInWords).toBe(300)
    expect(p.signedIn).toBe(true)
  })
})

describe('容错', () => {
  it('读不存在的文档抛错，但不留下垃圾文件', async () => {
    await expect(ws.readDoc('不存在/的/文件.md')).rejects.toThrow()
  })

  it('历史文件损坏时不影响保存正文', async () => {
    const { book, chapter } = await newBookWithChapter()
    const meta = await ws.readDoc(chapter)
    const histFile = path.join(root, book, '.bugu', 'history', meta.meta.id, 'pc-test.jsonl')

    await fs.mkdir(path.dirname(histFile), { recursive: true })
    await fs.writeFile(histFile, '这不是 JSON{{{\n更不是\n', 'utf8')

    const out = await ws.saveDoc(chapter, '正文照样要能保存')
    expect(out.chars).toBe(8)
    expect(await fs.readFile(path.join(root, chapter), 'utf8')).toContain('正文照样要能保存')
  })
})

describe('灵感箱', () => {
  it('记一条灵感，能列出来', async () => {
    const { book } = await newBookWithChapter()
    await ws.createIdea(book, '他醒来时，床边坐着自己。')

    const list = await ws.listIdeas(book)
    expect(list).toHaveLength(1)
    expect(list[0]!.body).toBe('他醒来时，床边坐着自己。')
    expect(list[0]!.scope).toBe('book')
  })

  it('文件名取自第一行，长的截断', async () => {
    const { book } = await newBookWithChapter()
    const r = await ws.createIdea(book, '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十')
    expect(path.basename(r.path)).toBe('0010-一二三四五六七八九十一二三四五六七八九十.md')
  })

  it('空白开头的灵感也能取到标题', async () => {
    const { book } = await newBookWithChapter()
    const r = await ws.createIdea(book, '\n\n   玉佩是母亲的。')
    expect(path.basename(r.path)).toContain('玉佩是母亲的。')
  })

  it('库根目录的 _灵感箱 也会被扫到，标为 inbox', async () => {
    const { book } = await newBookWithChapter()
    await fs.mkdir(path.join(root, '_灵感箱'), { recursive: true })
    await fs.writeFile(path.join(root, '_灵感箱', '手机随手记.md'), '在地铁上想到的。', 'utf8')

    const list = await ws.listIdeas(book)
    expect(list.map((i) => i.scope)).toEqual(['inbox'])
    expect(list[0]!.body).toBe('在地铁上想到的。')
  })

  it('按时间倒序，新的在上面', async () => {
    const { book } = await newBookWithChapter()
    const a = await ws.createIdea(book, '先想到的')
    // created 取自 front-matter，同一毫秒会并列，所以手动错开
    await new Promise((r) => setTimeout(r, 5))
    await ws.createIdea(book, '后想到的')
    const list = await ws.listIdeas(book)
    expect(list[0]!.body).toBe('后想到的')
    expect(list[1]!.path).toBe(a.path)
  })

  it('坏掉的碎片不影响其他条目', async () => {
    const { book } = await newBookWithChapter()
    await ws.createIdea(book, '好的那条')
    // 目录里混进一个非 md 文件
    await fs.writeFile(path.join(root, book, '灵感', '截图.png'), 'not markdown', 'utf8')
    expect(await ws.listIdeas(book)).toHaveLength(1)
  })

  it('归入：追加到目标文档末尾', async () => {
    const { book, chapter } = await newBookWithChapter()
    await ws.saveDoc(chapter, '他从四十八楼掉下去。')
    const idea = await ws.createIdea(book, '玉佩还在胸口。')

    const r = await ws.mergeIdea(book, idea.path, chapter)
    expect(r.body).toBe('他从四十八楼掉下去。\n\n玉佩还在胸口。\n')
    expect((await ws.readDoc(chapter)).body).toContain('玉佩还在胸口。')
  })

  it('归入后碎片离开灵感箱', async () => {
    const { book, chapter } = await newBookWithChapter()
    const idea = await ws.createIdea(book, '玉佩还在胸口。')
    await ws.mergeIdea(book, idea.path, chapter)
    expect(await ws.listIdeas(book)).toHaveLength(0)
  })

  it('【关键】归错了能从回收站捞回来', async () => {
    const { book, chapter } = await newBookWithChapter()
    const idea = await ws.createIdea(book, '玉佩还在胸口。')
    await ws.mergeIdea(book, idea.path, chapter)

    const trash = await ws.listTrash(book)
    expect(trash.some((t) => t.name.includes('玉佩还在胸口'))).toBe(true)
  })

  it('归入会走完整保存管线：字数与版本历史都记上', async () => {
    const { book, chapter } = await newBookWithChapter()
    await ws.saveDoc(chapter, '他从四十八楼掉下去。')
    const idea = await ws.createIdea(book, '玉佩还在胸口。')
    await ws.mergeIdea(book, idea.path, chapter)

    const history = parseHistoryJsonl(await readJsonl(`${book}/.bugu/history/${(await ws.readDoc(chapter)).meta.id}/pc-test.jsonl`))
    expect(history.length).toBeGreaterThanOrEqual(2)
    expect((await ws.todayProgress(book)).words).toBeGreaterThan(0)
  })

  it('归入空文档不留下开头的空行', async () => {
    const { book, chapter } = await newBookWithChapter()
    const idea = await ws.createIdea(book, '玉佩还在胸口。')
    const r = await ws.mergeIdea(book, idea.path, chapter)
    expect(r.body.startsWith('\n')).toBe(false)
  })

  it('删灵感是移进回收站，不是硬删', async () => {
    const { book } = await newBookWithChapter()
    const idea = await ws.createIdea(book, '这条不要了。')
    await ws.trashIdea(book, idea.path)

    expect(await ws.listIdeas(book)).toHaveLength(0)
    expect((await ws.listTrash(book)).some((t) => t.name.includes('这条不要了'))).toBe(true)
  })
})

describe('坚果云冲突副本', () => {
  /** 在正本旁边造一份冲突副本 */
  async function makeConflict(chapter: string, body: string): Promise<string> {
    const abs = path.join(root, chapter)
    const dir = path.dirname(abs)
    const name = path.basename(chapter, '.md') + ' (冲突文件 2026-08-25 明听).md'
    await fs.writeFile(path.join(dir, name), body, 'utf8')
    return `${path.dirname(chapter)}/${name}`
  }

  it('列出冲突副本并配回正本', async () => {
    const { book, chapter } = await newBookWithChapter()
    await ws.saveDoc(chapter, '他掉下去了。')
    await makeConflict(chapter, '他还是掉下去了。')

    const list = await ws.listConflicts(book)
    expect(list).toHaveLength(1)
    expect(list[0]!.originalPath).toBe(chapter)
    expect(list[0]!.originalMissing).toBe(false)
  })

  it('差异算好了，一改一删', async () => {
    const { book, chapter } = await newBookWithChapter()
    await ws.saveDoc(chapter, '他掉下去了。')
    await makeConflict(chapter, '他还是掉下去了。')

    const [c] = await ws.listConflicts(book)
    expect(c!.summary.added).toBe(1)
    expect(c!.summary.removed).toBe(1)
    expect(c!.note).toContain('挑一边')
  })

  it('内容一样时直说可以删', async () => {
    const { book, chapter } = await newBookWithChapter()
    await ws.saveDoc(chapter, '他掉下去了。')
    const saved = await fs.readFile(path.join(root, chapter), 'utf8')
    await makeConflict(chapter, saved)

    const [c] = await ws.listConflicts(book)
    expect(c!.summary.identical).toBe(true)
    expect(c!.note).toContain('删掉副本')
  })

  it('正本已被删掉时，副本标为可直接扶正', async () => {
    const { book, chapter } = await newBookWithChapter()
    await ws.saveDoc(chapter, '他掉下去了。')
    const conflict = await makeConflict(chapter, '副本的内容。')
    await fs.rm(path.join(root, chapter))

    const [c] = await ws.listConflicts(book)
    expect(c!.conflictPath).toBe(conflict)
    expect(c!.originalMissing).toBe(true)
    expect(c!.note).toContain('扶正')
  })

  it('用左边：正本不动，副本进回收站', async () => {
    const { book, chapter } = await newBookWithChapter()
    await ws.saveDoc(chapter, '他掉下去了。')
    const conflict = await makeConflict(chapter, '副本的内容。')

    await ws.resolveConflict(book, conflict, 'keepOriginal')

    expect((await ws.readDoc(chapter)).body).toBe('他掉下去了。')
    expect(await ws.listConflicts(book)).toHaveLength(0)
    expect((await ws.listTrash(book)).some((t) => t.name.includes('冲突文件'))).toBe(true)
  })

  it('用右边：副本内容覆盖正本，副本进回收站', async () => {
    const { book, chapter } = await newBookWithChapter()
    await ws.saveDoc(chapter, '他掉下去了。')
    const conflict = await makeConflict(chapter, '副本的内容。')

    await ws.resolveConflict(book, conflict, 'keepConflict')

    expect((await ws.readDoc(chapter)).body).toBe('副本的内容。')
    expect(await ws.listConflicts(book)).toHaveLength(0)
  })

  it('【关键】用右边时，被换掉的正本整个进了回收站，捞得回来', async () => {
    const { book, chapter } = await newBookWithChapter()
    await ws.saveDoc(chapter, '他掉下去了。')
    const conflict = await makeConflict(chapter, '副本的内容。')
    await ws.resolveConflict(book, conflict, 'keepConflict')

    // 版本历史按 30 秒时间桶合并，刚存完就处理冲突时它兜不住 ——
    // 所以真正的保险是回收站里那个完整文件
    const trash = await ws.listTrash(book)
    const backup = trash.find((t) => !t.name.includes('冲突文件'))
    expect(backup).toBeTruthy()
    expect(await fs.readFile(path.join(root, backup!.path), 'utf8')).toContain('他掉下去了。')
  })

  it('用右边后文档 id 不变 —— 版本历史与伏笔还挂在同一篇上', async () => {
    const { book, chapter } = await newBookWithChapter()
    await ws.saveDoc(chapter, '他掉下去了。')
    const before = (await ws.readDoc(chapter)).meta.id
    const conflict = await makeConflict(chapter, '副本的内容。')
    await ws.resolveConflict(book, conflict, 'keepConflict')

    expect((await ws.readDoc(chapter)).meta.id).toBe(before)
  })

  it('两份都留：副本变成一篇正常文档', async () => {
    const { book, chapter } = await newBookWithChapter()
    await ws.saveDoc(chapter, '他掉下去了。')
    const conflict = await makeConflict(chapter, '副本的内容。')

    const r = await ws.resolveConflict(book, conflict, 'keepBoth')

    expect(r.resolvedPath).toContain('另一版')
    expect((await ws.readDoc(r.resolvedPath!)).body).toBe('副本的内容。')
    // 正本一个字没动
    expect((await ws.readDoc(chapter)).body).toBe('他掉下去了。')
    // 它不再被认成冲突副本
    expect(await ws.listConflicts(book)).toHaveLength(0)
  })

  it('正本不在时也能用右边扶正', async () => {
    const { book, chapter } = await newBookWithChapter()
    await ws.saveDoc(chapter, '他掉下去了。')
    const conflict = await makeConflict(chapter, '只剩副本了。')
    await fs.rm(path.join(root, chapter))

    await ws.resolveConflict(book, conflict, 'keepConflict')
    expect((await ws.readDoc(chapter)).body).toBe('只剩副本了。')
  })

  it('传一个不是冲突副本的路径会被拒绝', async () => {
    const { book, chapter } = await newBookWithChapter()
    await expect(ws.resolveConflict(book, chapter, 'keepOriginal')).rejects.toThrow('不是一个冲突副本')
  })

  it('没有冲突时列表为空', async () => {
    const { book, chapter } = await newBookWithChapter()
    await ws.saveDoc(chapter, '他掉下去了。')
    expect(await ws.listConflicts(book)).toEqual([])
  })
})
