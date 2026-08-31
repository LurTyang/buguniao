/**
 * 便利贴加载与布局测试。
 *
 * 便利贴是本项目最有特色的部分，卡片正面抽错了作者一眼就能看出来，
 * 所以从磁盘到卡片这一整条路都要有测试。
 */

import { describe, it, expect } from 'vitest'
import { MemoryBackend } from '../storage/memory.js'
import {
  isStickyVisible,
  loadStickyLayout,
  loadTree,
  readAllStickies,
  readSticky,
  saveStickyLayout,
} from './index.js'
import type { PinnedSticky } from '../types/index.js'

const BOOK = '第九神座'

const LISI = [
  '---',
  'id: set-lisi',
  'type: setting',
  'title: 李四',
  '---',
  '',
  '# 李四',
  '',
  '年龄：@十七岁@，实为三百余岁。',
  '',
  '@表面身份：城南药铺学徒',
  '',
  '@',
  '外貌：断眉，左手常年缠布',
  '惯用兵器：一把无锋的短刀',
  '@',
  '',
  '（不浮出的详细背景）',
  '联系方式 lisi@qq.com',
].join('\n')

function lib(): MemoryBackend {
  return new MemoryBackend({
    files: {
      [`${BOOK}/book.yaml`]: 'schemaVersion: 1\nid: bk-9\ntitle: 第九神座\nstatus: serializing',
      [`${BOOK}/设定集/人物/李四.md`]: LISI,
      [`${BOOK}/设定集/人物/_模板.md`]: '# {{标题}}\n\n@身份：@\n',
      [`${BOOK}/设定集/功法/寒山诀.md`]: '# 寒山诀\n\n@入门：三年@',
      [`${BOOK}/设定集/散装设定.md`]: '# 散装设定\n\n@没有分类@',
    },
  })
}

describe('readSticky · 单张便利贴', () => {
  it('解析出标题与卡片正面', async () => {
    const card = await readSticky(lib(), `${BOOK}/设定集/人物/李四.md`, '人物')

    expect(card.title).toBe('李四')
    expect(card.titleSource).toBe('h1')
    expect(card.category).toBe('人物')
    expect(card.face).toBe(
      ['十七岁', '表面身份：城南药铺学徒', '外貌：断眉，左手常年缠布', '惯用兵器：一把无锋的短刀'].join(
        '\n',
      ),
    )
  })

  it('三条规则各命中一次', async () => {
    const card = await readSticky(lib(), `${BOOK}/设定集/人物/李四.md`)
    expect(card.floats.map((f) => f.rule)).toEqual(['inline', 'line', 'block'])
  })

  it('邮箱里的 @ 不触发', async () => {
    const card = await readSticky(lib(), `${BOOK}/设定集/人物/李四.md`)
    expect(card.face).not.toContain('qq.com')
  })

  it('带上文档 id 与路径，便于界面定位', async () => {
    const p = `${BOOK}/设定集/人物/李四.md`
    const card = await readSticky(lib(), p)
    expect(card.docId).toBe('set-lisi')
    expect(card.path).toBe(p)
  })

  it('语法提示：三个 @ 的行会被指出来', async () => {
    const b = lib()
    await b.write(`${BOOK}/设定集/人物/王五.md`, '# 王五\n\n@甲@乙@\n')
    const card = await readSticky(b, `${BOOK}/设定集/人物/王五.md`)
    expect(card.lints).toHaveLength(1)
    expect(card.lints[0]?.code).toBe('odd-ats')
  })

  it('干净的卡片没有语法提示', async () => {
    expect((await readSticky(lib(), `${BOOK}/设定集/人物/李四.md`)).lints).toEqual([])
  })
})

describe('readAllStickies · 整本书的便利贴', () => {
  it('分类里的和散装的都读到', async () => {
    const b = lib()
    const cards = await readAllStickies(b, await loadTree(b, BOOK))
    expect(cards.map((c) => c.title).sort()).toEqual(['寒山诀', '散装设定', '李四'])
  })

  it('模板不算便利贴', async () => {
    const b = lib()
    const cards = await readAllStickies(b, await loadTree(b, BOOK))
    expect(cards.map((c) => c.title)).not.toContain('{{标题}}')
  })

  it('带上所属分类', async () => {
    const b = lib()
    const cards = await readAllStickies(b, await loadTree(b, BOOK))
    expect(cards.find((c) => c.title === '李四')?.category).toBe('人物')
    expect(cards.find((c) => c.title === '散装设定')?.category).toBeNull()
  })

  it('【关键】某一张读坏了不影响其他张', async () => {
    const b = lib()
    // 塞一个能通过目录扫描但读起来会出问题的空文件
    await b.write(`${BOOK}/设定集/人物/坏的.md`, '')
    const cards = await readAllStickies(b, await loadTree(b, BOOK))
    expect(cards.length).toBeGreaterThanOrEqual(3)
    expect(cards.map((c) => c.title)).toContain('李四')
  })

  it('没有设定时返回空数组', async () => {
    const b = new MemoryBackend({
      files: { '空书/book.yaml': 'id: bk-x\ntitle: 空书\nstatus: pit' },
    })
    expect(await readAllStickies(b, await loadTree(b, '空书'))).toEqual([])
  })
})

describe('便利贴布局', () => {
  const pin = (o: Partial<PinnedSticky> = {}): PinnedSticky => ({
    cardId: 'set-lisi',
    x: 420,
    y: 180,
    w: 260,
    h: 320,
    collapsed: false,
    scope: 'book',
    ...o,
  })

  it('写了能读回来', async () => {
    const b = lib()
    await saveStickyLayout(b, BOOK, 'pc-01', { schemaVersion: 1, pinned: [pin()] })
    const back = await loadStickyLayout(b, BOOK, 'pc-01')
    expect(back.pinned).toEqual([pin()])
  })

  it('没有布局文件时返回空布局，不抛错', async () => {
    expect((await loadStickyLayout(lib(), BOOK, 'pc-01')).pinned).toEqual([])
  })

  it('【关键】文件坏了也只是空布局，不拦着打开作品', async () => {
    const b = lib()
    await b.write(`${BOOK}/.bugu/workspace/pc-01.json`, '这不是 JSON{{{')
    expect((await loadStickyLayout(b, BOOK, 'pc-01')).pinned).toEqual([])
  })

  it('结构不对的条目被过滤掉，好的留下', async () => {
    const b = lib()
    await b.write(
      `${BOOK}/.bugu/workspace/pc-01.json`,
      JSON.stringify({ schemaVersion: 1, pinned: [{ nonsense: true }, pin()] }),
    )
    expect((await loadStickyLayout(b, BOOK, 'pc-01')).pinned).toHaveLength(1)
  })

  it('两台设备各存各的，互不干扰', async () => {
    const b = lib()
    await saveStickyLayout(b, BOOK, 'pc-01', { schemaVersion: 1, pinned: [pin({ x: 100 })] })
    await saveStickyLayout(b, BOOK, 'pc-02', { schemaVersion: 1, pinned: [pin({ x: 900 })] })

    expect((await loadStickyLayout(b, BOOK, 'pc-01')).pinned[0]?.x).toBe(100)
    expect((await loadStickyLayout(b, BOOK, 'pc-02')).pinned[0]?.x).toBe(900)
  })

  it('布局文件是可读的 JSON，出问题能手工看', async () => {
    const b = lib()
    await saveStickyLayout(b, BOOK, 'pc-01', { schemaVersion: 1, pinned: [pin()] })
    const raw = b.peek(`${BOOK}/.bugu/workspace/pc-01.json`) as string
    expect(raw).toContain('\n')
    expect(() => JSON.parse(raw)).not.toThrow()
  })
})

describe('isStickyVisible · 显示范围', () => {
  it('book 范围在任何章节都显示', () => {
    expect(isStickyVisible('book', 'ch-a')).toBe(true)
    expect(isStickyVisible('book', null)).toBe(true)
  })

  it('doc 范围只在指定文档显示', () => {
    expect(isStickyVisible('doc:ch-a', 'ch-a')).toBe(true)
    expect(isStickyVisible('doc:ch-a', 'ch-b')).toBe(false)
  })

  it('没打开文档时 doc 范围不显示', () => {
    expect(isStickyVisible('doc:ch-a', null)).toBe(false)
  })
})
