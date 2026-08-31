/**
 * LocalFsBackend 测试 —— 跑在真实文件系统上。
 *
 * 这一层是 core 的纯逻辑与磁盘之间唯一的桥，必须用真文件测，
 * 用 mock 测等于什么都没测。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { LocalFsBackend, isWritableDir } from './local-fs.js'
import {
  createBook,
  loadTree,
  scanLibrary,
  readDoc,
  writeDoc,
  writeNewDoc,
  createSettingCard,
  ensureTemplate,
  flattenChapters,
  parseHistoryJsonl,
  emptyHistory,
  appendSave,
  reconstruct,
  toHistoryJsonl,
} from '@bugu/core'

const NOW = '2026-08-25T02:00:00.000+08:00'

let root: string
let backend: LocalFsBackend

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'bugu-test-'))
  backend = new LocalFsBackend(root)
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('基本读写', () => {
  it('写了能读回来', async () => {
    await backend.write('甲.md', '内容')
    expect(await backend.read('甲.md')).toBe('内容')
  })

  it('写文件时自动创建父目录', async () => {
    await backend.write('a/b/c/甲.md', '内容')
    expect(await backend.read('a/b/c/甲.md')).toBe('内容')
  })

  it('中文路径与中文内容正常', async () => {
    await backend.write('第九神座/正文/第一章 坠楼.md', '他从四十八楼掉下去。')
    expect(await backend.read('第九神座/正文/第一章 坠楼.md')).toBe('他从四十八楼掉下去。')
  })

  it('读不存在的文件抛错', async () => {
    await expect(backend.read('不存在.md')).rejects.toThrow()
  })

  it('列不存在的目录返回空数组（不让整棵树加载失败）', async () => {
    expect(await backend.list('不存在的目录')).toEqual([])
  })

  it('去掉记事本保存的 UTF-8 BOM', async () => {
    await fs.writeFile(path.join(root, 'bom.md'), '﻿---\nid: ch-x\n---\n正文', 'utf8')
    const content = await backend.read('bom.md')
    expect(content.startsWith('---')).toBe(true)
  })

  it('二进制读写（封面图片）', async () => {
    const data = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])
    await backend.writeBinary('cover.jpg', data)
    expect(await backend.readBinary('cover.jpg')).toEqual(data)
  })
})

describe('list', () => {
  beforeEach(async () => {
    await backend.write('书/正文/0010-第一章.md', 'a')
    await backend.write('书/正文/0020-第二章.md', 'b')
    await backend.mkdir('书/设定集')
  })

  it('区分文件与目录', async () => {
    const entries = await backend.list('书')
    expect(entries.map((e) => [e.name, e.isDirectory])).toEqual([
      ['设定集', true],
      ['正文', false || true],
    ])
  })

  it('路径用正斜杠，与 core 的约定一致', async () => {
    const entries = await backend.list('书/正文')
    expect(entries.map((e) => e.path)).toEqual(['书/正文/0010-第一章.md', '书/正文/0020-第二章.md'])
  })

  it('带出文件大小与修改时间', async () => {
    const [first] = await backend.list('书/正文')
    expect(first?.size).toBeGreaterThan(0)
    expect(first?.mtime).toBeGreaterThan(0)
  })

  it('跳过操作系统自己塞的文件', async () => {
    await fs.writeFile(path.join(root, '书', 'Thumbs.db'), 'x')
    await fs.writeFile(path.join(root, '书', 'desktop.ini'), 'x')
    expect((await backend.list('书')).map((e) => e.name)).not.toContain('Thumbs.db')
  })
})

describe('stat', () => {
  it('文件存在时返回信息', async () => {
    await backend.write('甲.md', '内容')
    const st = await backend.stat('甲.md')
    expect(st?.isDirectory).toBe(false)
    expect(st?.size).toBeGreaterThan(0)
  })

  it('目录存在时 isDirectory 为 true', async () => {
    await backend.mkdir('目录')
    expect((await backend.stat('目录'))?.isDirectory).toBe(true)
  })

  it('不存在时返回 null 而不是抛错', async () => {
    expect(await backend.stat('不存在')).toBeNull()
  })
})

describe('append · jsonl 追加', () => {
  it('逐行追加', async () => {
    await backend.append('log.jsonl', '{"a":1}')
    await backend.append('log.jsonl', '{"a":2}')
    expect(await backend.read('log.jsonl')).toBe('{"a":1}\n{"a":2}\n')
  })

  it('自动创建父目录', async () => {
    await backend.append('.bugu/foreshadow/pc-01.jsonl', '{"id":"f1","ts":1}')
    expect(await backend.read('.bugu/foreshadow/pc-01.jsonl')).toBe('{"id":"f1","ts":1}\n')
  })

  it('【关键】上一行缺换行时自动补上，不让两条记录粘成坏行', async () => {
    // 模拟上次写入被中断，末尾没有换行
    await fs.writeFile(path.join(root, 'log.jsonl'), '{"a":1}', 'utf8')
    await backend.append('log.jsonl', '{"a":2}')
    const lines = (await backend.read('log.jsonl')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(() => lines.map((l) => JSON.parse(l))).not.toThrow()
  })

  // 500 次真·磁盘追加，一次一次来。默认 5 秒在 Windows 上、
  // 而且是几十个测试文件并行跑的时候会偶尔超时 —— 那是机器忙，不是代码坏了。
  // 一个随机失败的测试比没有测试更糟：它会教人「红了先重跑一遍」
  it('大量追加后仍能被 core 正确解析', { timeout: 30_000 }, async () => {
    for (let i = 0; i < 500; i++) {
      await backend.append('h.jsonl', JSON.stringify({ schemaVersion: 1, v: i + 1, ts: i, dev: 'pc', kind: 'snapshot', chars: 0, data: `第${i}版` }))
    }
    expect(parseHistoryJsonl(await backend.read('h.jsonl'))).toHaveLength(500)
  })
})

describe('rename · 拖拽排序靠它', () => {
  it('重命名文件', async () => {
    await backend.write('书/0010-甲.md', '内容')
    await backend.rename('书/0010-甲.md', '书/0025-甲.md')
    expect(await backend.read('书/0025-甲.md')).toBe('内容')
    expect(await backend.stat('书/0010-甲.md')).toBeNull()
  })

  it('移动到另一个目录（章节换卷）', async () => {
    await backend.write('书/正文/卷一/0010-甲.md', '内容')
    await backend.rename('书/正文/卷一/0010-甲.md', '书/正文/卷二/0010-甲.md')
    expect(await backend.read('书/正文/卷二/0010-甲.md')).toBe('内容')
  })

  it('目标目录不存在时自动创建', async () => {
    await backend.write('甲.md', '内容')
    await backend.rename('甲.md', '新目录/子目录/甲.md')
    expect(await backend.read('新目录/子目录/甲.md')).toBe('内容')
  })
})

describe('delete', () => {
  it('删文件', async () => {
    await backend.write('甲.md', '内容')
    await backend.delete('甲.md')
    expect(await backend.stat('甲.md')).toBeNull()
  })

  it('删空目录', async () => {
    await backend.mkdir('空目录')
    await backend.delete('空目录')
    expect(await backend.stat('空目录')).toBeNull()
  })

  it('删非空目录抛错（防止误删整卷）', async () => {
    await backend.write('目录/甲.md', '内容')
    await expect(backend.delete('目录')).rejects.toThrow()
  })
})

describe('安全：路径越界', () => {
  it('拒绝 .. 逃出根目录', async () => {
    await expect(backend.read('../../../etc/passwd')).rejects.toThrow('路径越界')
    await expect(backend.write('../逃出去.md', 'x')).rejects.toThrow('路径越界')
  })

  it('拒绝中间夹 .. 的路径', async () => {
    await expect(backend.read('书/../../外面.md')).rejects.toThrow('路径越界')
  })

  it('根目录内的 .. 只要没越界就允许', async () => {
    await backend.write('a/b/甲.md', '内容')
    expect(await backend.read('a/b/../b/甲.md')).toBe('内容')
  })

  it('Windows 反斜杠路径也被规范化', async () => {
    await backend.write('a/b/甲.md', '内容')
    expect(await backend.read('a\\b\\甲.md')).toBe('内容')
  })
})

describe('原子写入', () => {
  it('写完后不留临时文件', async () => {
    await backend.write('甲.md', '内容')
    const names = await fs.readdir(root)
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([])
  })

  it('覆盖写不会留下半截内容', async () => {
    await backend.write('甲.md', '很长很长的原始内容'.repeat(100))
    await backend.write('甲.md', '短')
    expect(await backend.read('甲.md')).toBe('短')
  })

  it('并发写同一文件不会互相污染出损坏内容', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => backend.write('甲.md', `内容${i}`.repeat(50))),
    )
    const final = await backend.read('甲.md')
    // 结果必须是某一次完整的写入，不能是两次内容拼接的产物
    expect(final).toMatch(/^(内容\d+)+$/)
    const names = await fs.readdir(root)
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([])
  })
})

describe('isWritableDir', () => {
  it('可写目录返回 true', async () => {
    expect(await isWritableDir(root)).toBe(true)
  })

  it('不存在的目录返回 false', async () => {
    expect(await isWritableDir(path.join(root, '不存在'))).toBe(false)
  })

  it('文件（非目录）返回 false', async () => {
    const f = path.join(root, '甲.md')
    await fs.writeFile(f, 'x')
    expect(await isWritableDir(f)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────
// 端到端：core 的纯逻辑跑在真实磁盘上
// ─────────────────────────────────────────────────────────────

describe('端到端 · core 逻辑落到真实磁盘', () => {
  it('新建作品 → 写章节 → 建便利贴 → 重新加载，全流程一致', async () => {
    const book = await createBook(backend, '', '试验田', { now: NOW })

    await writeNewDoc(backend, `${book.rootPath}/正文`, '第二章 转折', 'chapter', '第二章的内容。', { now: NOW })
    await backend.mkdir(`${book.rootPath}/设定集/人物`)
    await ensureTemplate(backend, `${book.rootPath}/设定集/人物`)

    let tree = await loadTree(backend, book.rootPath)
    const 人物 = tree.settings.find((c) => c.name === '人物')!
    await createSettingCard(backend, 人物, '李四', { now: NOW })

    tree = await loadTree(backend, book.rootPath)
    expect(tree.meta.title).toBe('试验田')
    expect(flattenChapters(tree.text).map((c) => c.title)).toEqual(['第一章', '第二章 转折'])
    expect(tree.settings.find((c) => c.name === '人物')?.cards.map((c) => c.title)).toEqual(['李四'])

    expect((await scanLibrary(backend)).map((x) => x.meta.title)).toEqual(['试验田'])
  })

  it('磁盘上的文件用记事本能直接看懂', async () => {
    const book = await createBook(backend, '', '试验田', { now: NOW })
    const raw = await fs.readFile(path.join(root, book.rootPath, '正文', '0010-第一章.md'), 'utf8')

    expect(raw.startsWith('---\n')).toBe(true)
    expect(raw).toContain('type: chapter')
    expect(raw).toContain('title: 第一章')
  })

  it('记事本随手新建的裸 md 被自动纳管', async () => {
    const book = await createBook(backend, '', '试验田', { now: NOW })
    // 模拟作者用记事本直接在正文目录里加了一章
    await fs.writeFile(
      path.join(root, book.rootPath, '正文', '0020-我用记事本加的.md'),
      '就写了这么一句。',
      'utf8',
    )

    const doc = await readDoc(backend, `${book.rootPath}/正文/0020-我用记事本加的.md`, { now: NOW })
    expect(doc.meta.id).toMatch(/^ch-/)
    expect(doc.meta.title).toBe('我用记事本加的')

    // 已经回写到磁盘
    const raw = await fs.readFile(
      path.join(root, book.rootPath, '正文', '0020-我用记事本加的.md'),
      'utf8',
    )
    expect(raw.startsWith('---')).toBe(true)
    expect(raw).toContain('就写了这么一句。')
  })

  it('版本历史写到磁盘再读回来，能还原任意版本', async () => {
    const book = await createBook(backend, '', '试验田', { now: NOW })
    const histPath = `${book.rootPath}/.bugu/history/ch-test/pc-01.jsonl`

    let state = emptyHistory()
    const texts: string[] = []
    const T0 = 1_787_000_040_000

    for (let i = 0; i < 30; i++) {
      const text = Array.from({ length: i + 1 }, (_, k) => `第${k}段。他从四十八楼掉下去的时候，脑子里想的不是死。`).join('\n\n')
      texts.push(text)
      const r = appendSave(state, { content: text, ts: T0 + i * 30_000, dev: 'pc-01' })
      state = r.state
      if (r.record) await backend.append(histPath, JSON.stringify(r.record))
    }

    const fromDisk = parseHistoryJsonl(await backend.read(histPath))
    expect(fromDisk).toHaveLength(30)
    for (const v of [1, 7, 15, 30]) {
      expect(reconstruct(fromDisk, v)).toBe(texts[v - 1])
    }
  })

  it('保存章节后正文与 front-matter 都正确落盘', async () => {
    const book = await createBook(backend, '', '试验田', { now: NOW })
    const p = `${book.rootPath}/正文/0010-第一章.md`

    const doc = await readDoc(backend, p)
    await writeDoc(backend, p, { ...doc, body: '\n他从四十八楼掉下去的时候。' }, NOW)

    const again = await readDoc(backend, p)
    expect(again.body.trim()).toBe('他从四十八楼掉下去的时候。')
    expect(again.meta.id).toBe(doc.meta.id)
    expect(again.meta.updated).toBe(NOW)
  })

  it('历史文件序列化格式与 core 的 toHistoryJsonl 一致', async () => {
    let state = emptyHistory()
    const T0 = 1_787_000_040_000
    for (let i = 0; i < 5; i++) {
      state = appendSave(state, { content: `内容${i}`, ts: T0 + i * 30_000, dev: 'pc-01' }).state
    }
    await backend.write('h.jsonl', toHistoryJsonl(state.records))
    expect(parseHistoryJsonl(await backend.read('h.jsonl'))).toEqual(state.records)
  })
})
