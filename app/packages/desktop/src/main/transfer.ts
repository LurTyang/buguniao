/**
 * 导入与导出。
 *
 * 规范：更新文档/05-功能模块详述.md §10
 *
 * 导入的核心算法（中文数字、最长递增子序列剔噪音）在 core/importer，
 * 这里只负责**编码检测**和落盘 —— 那两件事是平台相关的。
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type ISectionOptions,
} from 'docx'
import {
  planImport,
  renderFullText,
  renderPerChapter,
  toDocxBlocks,
  previewExport,
  type ExportChapter,
  type ExportOptions,
  type ImportPlan,
} from '@bugu/core'

// ───────────────────────── 编码 ─────────────────────────

export type DetectedEncoding = 'utf-8' | 'utf-8-bom' | 'gbk' | 'utf-16le'

/**
 * 检测中文 txt 的编码。
 *
 * 顺序有讲究：先看 BOM（确凿），再试严格 UTF-8（合法的 UTF-8 字节序列
 * 极不可能是别的编码碰巧撞上的），最后才落到 GBK。
 * 反过来先试 GBK 的话，UTF-8 中文会被解成一堆乱码而不报错。
 */
export function detectEncoding(buf: Buffer): DetectedEncoding {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf-8-bom'
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16le'
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf)
    return 'utf-8'
  } catch {
    return 'gbk'
  }
}

export function decodeText(buf: Buffer, enc: DetectedEncoding): string {
  switch (enc) {
    case 'utf-8-bom':
      return new TextDecoder('utf-8').decode(buf.subarray(3))
    case 'utf-16le':
      return new TextDecoder('utf-16le').decode(buf.subarray(2))
    case 'gbk':
      // GBK 里也可能有坏字节，非严格模式会替换成 U+FFFD 而不是整个失败 ——
      // 一份大稿子不该因为几个坏字节就完全导不进来
      return new TextDecoder('gbk').decode(buf)
    default:
      return new TextDecoder('utf-8').decode(buf)
  }
}

export interface ImportPreview extends ImportPlan {
  encoding: DetectedEncoding
  fileName: string
  /** 原文总行数，预览界面用来显示比例 */
  lineCount: number
}

/** 读一个 txt 并给出分章方案（还没落盘，等作者确认） */
export async function previewImport(
  filePath: string,
  forceLines?: number[],
): Promise<ImportPreview> {
  const buf = await fs.readFile(filePath)
  const encoding = detectEncoding(buf)
  const text = decodeText(buf, encoding)
  const plan = planImport(text, forceLines ? { forceLines } : {})
  return {
    ...plan,
    encoding,
    fileName: path.basename(filePath),
    lineCount: text.split(/\r?\n/).length,
  }
}

// ───────────────────────── 导出 ─────────────────────────

export interface ExportRequest {
  chapters: ExportChapter[]
  options: ExportOptions
  /** 目标文件（分章导出时是目标目录） */
  target: string
}

export async function exportTxt(req: ExportRequest): Promise<{ bytes: number }> {
  const text = renderFullText(req.chapters, req.options)
  await fs.mkdir(path.dirname(req.target), { recursive: true })
  /*
   * txt 加 BOM，md 不加。
   *
   * txt 加是因为不加的话 Windows 记事本会把中文 UTF-8 认成乱码（0.1 踩过）。
   * md **不能加** —— 各种 Markdown 编辑器和静态站生成器碰到 BOM
   * 会把第一行的 `#` 当成普通字符，标题就没了。
   */
  const bom = req.target.toLowerCase().endsWith('.md') ? '' : '﻿'
  await fs.writeFile(req.target, bom + text, 'utf8')
  return { bytes: Buffer.byteLength(text, 'utf8') }
}

export async function exportPerChapter(
  req: ExportRequest & { fileNamePattern?: string },
): Promise<{ files: number }> {
  await fs.mkdir(req.target, { recursive: true })
  const files = renderPerChapter(req.chapters, {
    ...req.options,
    ...(req.fileNamePattern ? { fileNamePattern: req.fileNamePattern } : {}),
  })
  for (const f of files) {
    await fs.writeFile(path.join(req.target, f.fileName), '﻿' + f.content, 'utf8')
  }
  return { files: files.length }
}

/**
 * 导出 Word。
 *
 * 卷用「标题 1」、章用「标题 2」、正文用正文样式 —— 这样编辑在 Word 里
 * 能直接用导航窗格跳转，比一整坨纯文本好用得多。
 * 首行缩进交给段落样式，**不往正文里塞全角空格**。
 */
export async function exportDocx(req: ExportRequest & { title: string }): Promise<{ bytes: number }> {
  const blocks = toDocxBlocks(req.chapters, req.options)

  const children: Paragraph[] = [
    new Paragraph({ text: req.title, heading: HeadingLevel.TITLE }),
  ]
  for (const b of blocks) {
    if (b.kind === 'volume') {
      children.push(new Paragraph({ text: b.text, heading: HeadingLevel.HEADING_1, pageBreakBefore: true }))
    } else if (b.kind === 'chapter') {
      children.push(new Paragraph({ text: b.text, heading: HeadingLevel.HEADING_2 }))
    } else {
      children.push(
        new Paragraph({
          children: [new TextRun(b.text)],
          // 240 twip = 12pt 段间距；firstLine 480 twip = 两个中文字符宽
          spacing: { after: 120, line: 380 },
          indent: { firstLine: 480 },
        }),
      )
    }
  }

  const section: ISectionOptions = { properties: {}, children }
  const doc = new Document({
    creator: '不咕鸟',
    title: req.title,
    sections: [section],
  })

  const buf = await Packer.toBuffer(doc)
  await fs.writeFile(req.target, buf)
  return { bytes: buf.length }
}

/** 导出前给作者看的预估 */
export function exportPreview(chapters: ExportChapter[], options: ExportOptions) {
  return previewExport(chapters, options)
}
