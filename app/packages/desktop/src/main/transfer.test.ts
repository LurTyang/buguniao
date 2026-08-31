/**
 * 导入导出测试 —— 跑在真实文件上。
 *
 * 编码检测是导入最容易翻车的地方：中文 txt 很多是 GBK，
 * 认错编码整本书就是一堆乱码。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  decodeText,
  detectEncoding,
  exportDocx,
  exportPerChapter,
  exportPreview,
  exportTxt,
  previewImport,
} from './transfer.js'
import type { ExportChapter } from '@bugu/core'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bugu-transfer-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** 用 Node 的 iconv 能力造 GBK 字节 —— 没有现成 encoder，用已知字节序列 */
const GBK_你好 = Buffer.from([0xc4, 0xe3, 0xba, 0xc3])

describe('编码检测', () => {
  it('UTF-8', () => {
    expect(detectEncoding(Buffer.from('他从四十八楼掉下去', 'utf8'))).toBe('utf-8')
  })

  it('带 BOM 的 UTF-8', () => {
    expect(detectEncoding(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('甲', 'utf8')]))).toBe(
      'utf-8-bom',
    )
  })

  it('UTF-16LE', () => {
    expect(detectEncoding(Buffer.from([0xff, 0xfe, 0x59, 0x59]))).toBe('utf-16le')
  })

  it('【关键】GBK 中文不被当成 UTF-8', () => {
    // GBK 的「你好」不是合法的 UTF-8 字节序列，严格解码会失败，从而落到 GBK
    expect(detectEncoding(GBK_你好)).toBe('gbk')
  })

  it('GBK 能正确解出中文', () => {
    expect(decodeText(GBK_你好, 'gbk')).toBe('你好')
  })

  it('BOM 被吃掉，不留在正文开头', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('第一章', 'utf8')])
    expect(decodeText(buf, 'utf-8-bom')).toBe('第一章')
  })

  it('空文件不炸', () => {
    expect(detectEncoding(Buffer.alloc(0))).toBe('utf-8')
    expect(decodeText(Buffer.alloc(0), 'utf-8')).toBe('')
  })
})

describe('previewImport · 分章预览', () => {
  const novel = [
    '某某传',
    '作者：明听',
    '',
    '第一章 坠楼',
    '',
    '他从四十八楼掉下去。',
    '',
    '第二章 醒来',
    '',
    '他醒了，想起第一章里说的话。',
    '',
    '第三章 玉佩',
    '',
    '玉佩还在。',
  ].join('\n')

  const writeNovel = async (name: string, content: string, enc: BufferEncoding = 'utf8') => {
    const p = path.join(dir, name)
    await fs.writeFile(p, content, enc)
    return p
  }

  it('切出三章', async () => {
    const p = await writeNovel('novel.txt', novel)
    const plan = await previewImport(p)
    expect(plan.chapters.map((c) => c.title)).toEqual(['第一章 坠楼', '第二章 醒来', '第三章 玉佩'])
  })

  it('【关键】正文里提到的「第一章」不被误认为标题', async () => {
    const p = await writeNovel('novel.txt', novel)
    const plan = await previewImport(p)
    expect(plan.chapters).toHaveLength(3)
    expect(plan.chapters[1]?.body).toContain('想起第一章里说的话')
  })

  it('第一章之前的内容进 preamble', async () => {
    const plan = await previewImport(await writeNovel('novel.txt', novel))
    expect(plan.preamble).toBe('某某传\n作者：明听')
  })

  it('带上编码与行数，供预览界面显示', async () => {
    const plan = await previewImport(await writeNovel('novel.txt', novel))
    expect(plan.encoding).toBe('utf-8')
    expect(plan.lineCount).toBe(14)
    expect(plan.fileName).toBe('novel.txt')
  })

  it('作者手动指定分章点时完全照办', async () => {
    const p = await writeNovel('novel.txt', novel)
    const plan = await previewImport(p, [3, 11])
    expect(plan.chapters.map((c) => c.title)).toEqual(['第一章 坠楼', '第三章 玉佩'])
    // 第二章的内容并进了第一章
    expect(plan.chapters[0]?.body).toContain('第二章 醒来')
  })

  it('CRLF 的文件也能切', async () => {
    const p = await writeNovel('crlf.txt', novel.replace(/\n/g, '\r\n'))
    expect((await previewImport(p)).chapters).toHaveLength(3)
  })

  it('没有章节标题时整篇进 preamble', async () => {
    const p = await writeNovel('flat.txt', '就是一段没有分章的文字。')
    const plan = await previewImport(p)
    expect(plan.chapters).toEqual([])
    expect(plan.preamble).toBe('就是一段没有分章的文字。')
  })
})

describe('导出', () => {
  const chapters: ExportChapter[] = [
    {
      volume: '第一卷 少年游',
      title: '第一章 坠楼',
      body: '他从四十八楼掉下去，<!--埋#f7k2p9x-->胸口的玉佩还在<!--/埋#f7k2p9x-->。\n\n**[[李四]]** 在楼下看着。',
    },
    { volume: '第一卷 少年游', title: '第二章 醒来', body: '他醒了。' },
  ]

  it('导出完整 txt', async () => {
    const target = path.join(dir, 'out.txt')
    await exportTxt({ chapters, options: {}, target })
    const text = await fs.readFile(target, 'utf8')

    expect(text).toContain('第一卷 少年游')
    expect(text).toContain('第一章 坠楼')
    expect(text).toContain('胸口的玉佩还在')
  })

  it('【关键】导出的 txt 带 BOM，记事本打开不乱码', async () => {
    const target = path.join(dir, 'out.txt')
    await exportTxt({ chapters, options: {}, target })
    const buf = await fs.readFile(target)
    expect([buf[0], buf[1], buf[2]]).toEqual([0xef, 0xbb, 0xbf])
  })

  it('伏笔标记、双链、Markdown 标记都被清掉', async () => {
    const target = path.join(dir, 'out.txt')
    await exportTxt({ chapters, options: {}, target })
    const text = await fs.readFile(target, 'utf8')

    expect(text).not.toContain('<!--')
    expect(text).not.toContain('[[')
    expect(text).not.toContain('**')
    expect(text).toContain('李四')
  })

  it('可以保留伏笔标记（自己留档时）', async () => {
    const target = path.join(dir, 'out.txt')
    await exportTxt({ chapters, options: { stripForeshadow: false, stripComments: false }, target })
    expect(await fs.readFile(target, 'utf8')).toContain('<!--埋#f7k2p9x-->')
  })

  it('按章分文件', async () => {
    const target = path.join(dir, '分章')
    const r = await exportPerChapter({ chapters, options: {}, target })

    expect(r.files).toBe(2)
    const names = (await fs.readdir(target)).sort()
    expect(names).toEqual(['0001-第一章 坠楼.txt', '0002-第二章 醒来.txt'])
    expect(await fs.readFile(path.join(target, names[1] as string), 'utf8')).toContain('他醒了。')
  })

  it('导出 Word 是一个真的 docx（zip 包）', async () => {
    const target = path.join(dir, 'out.docx')
    const r = await exportDocx({ chapters, options: {}, target, title: '某某传' })

    expect(r.bytes).toBeGreaterThan(1000)
    const buf = await fs.readFile(target)
    // docx 就是 zip，头四个字节是 PK\x03\x04
    expect([buf[0], buf[1], buf[2], buf[3]]).toEqual([0x50, 0x4b, 0x03, 0x04])
  })

  it('导出预览给出章节数与字数', () => {
    const p = exportPreview(chapters, {})
    expect(p.chapterCount).toBe(2)
    expect(p.volumeCount).toBe(1)
    expect(p.chars).toBeGreaterThan(0)
  })

  it('【关键】导出不改动传入的章节数据', async () => {
    const snapshot = JSON.stringify(chapters)
    await exportTxt({ chapters, options: {}, target: path.join(dir, 'a.txt') })
    await exportDocx({ chapters, options: {}, target: path.join(dir, 'a.docx'), title: 'x' })
    expect(JSON.stringify(chapters)).toBe(snapshot)
  })

  it('空书导出不炸', async () => {
    const target = path.join(dir, 'empty.txt')
    await exportTxt({ chapters: [], options: {}, target })
    expect(await fs.readFile(target, 'utf8')).toBe('﻿')
  })
})
