/**
 * 导出。
 *
 * 规范：更新文档/05-功能模块详述.md §10.2
 *
 * core 只负责**内容的组装与文本变换**，具体写成 .txt / .docx / .zip
 * 是平台层的事（要用到文件系统和 docx 库）。
 *
 * 一条设计原则：导出**永远不修改原稿**。所有变换都作用在副本上，
 * 原始 Markdown 文件一个字节都不会被动。
 */

import { stripAllAnchors } from '../foreshadow/index.js'
import { sanitizeFileName } from '../repository/index.js'
import { formatScriptPlain, looksLikeScript, parseScript } from '../script/index.js'

/** 首行缩进用的全角空格。平时不写进文件，只在导出时按需加 */
export const INDENT = '　　'

export interface ExportOptions {
  /**
   * 按剧本排版导出：场景顶格、动作缩两格、角色名缩四格、台词缩六格。
   *
   * **只对看着像剧本的章节生效** —— 一本小说里夹着两章剧本很常见，
   * 无条件套上去会把正常章节排得莫名其妙。
   */
  scriptLayout?: boolean
  /** 移除伏笔标记注释。**默认开** —— 发给编辑的稿子里不该有这些 */
  stripForeshadow?: boolean
  /** 把 `[[李四]]` 转成纯文本「李四」。默认开 */
  stripWikiLinks?: boolean
  /** 移除其他 HTML 注释（作者写的备注）。默认开 */
  stripComments?: boolean
  /** 每段开头加两个全角空格。默认开 —— 多数平台需要 */
  indentFirstLine?: boolean
  /** 是否在正文前输出章节标题。默认开 */
  includeChapterTitle?: boolean
  /** 章节之间的分隔。默认两个空行 */
  chapterSeparator?: string
  /** 段落之间的分隔。默认一个空行 */
  paragraphSeparator?: string
}

const DEFAULTS: Required<ExportOptions> = {
  scriptLayout: false,
  stripForeshadow: true,
  stripWikiLinks: true,
  stripComments: true,
  indentFirstLine: true,
  includeChapterTitle: true,
  chapterSeparator: '\n\n\n',
  paragraphSeparator: '\n\n',
}

export interface ExportChapter {
  title: string
  /** 已剥离 front-matter 的正文 */
  body: string
  /** 所属卷名，无卷时为 null */
  volume?: string | null
}

// ───────────────────────── 文本变换 ─────────────────────────

/** 匹配 front-matter，防御性处理（正常情况调用方已经剥掉了） */
const FM_RE = /^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/

/**
 * 把一章 Markdown 正文变换成适合导出的纯文本。
 *
 * 变换顺序是有讲究的：先去标记，再去 Markdown 语法，最后才分段加缩进 ——
 * 反过来会把标记里的字符当成正文缩进进去。
 */
export function renderBody(body: string, options: ExportOptions = {}): string {
  const o = { ...DEFAULTS, ...options }
  let s = body.replace(FM_RE, '')

  if (o.stripForeshadow) s = stripAllAnchors(s)
  if (o.stripComments) s = s.replace(/<!--[\s\S]*?-->/g, '')

  /**
   * 剧本排版走另一条路。
   *
   * 剧本的排版**本身就是内容的一部分**（谁在说话靠缩进层次分辨），
   * 所以不能再走下面那套「分段 + 首行缩进」—— 那会把角色名和台词
   * 揉成一段，剧本就不成其为剧本了。
   */
  if (o.scriptLayout && looksLikeScript(s)) {
    if (o.stripWikiLinks) {
      s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1')
    }
    return formatScriptPlain(parseScript(s)).trimEnd()
  }

  if (o.stripWikiLinks) {
    s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    s = s.replace(/\[\[([^\]]+)\]\]/g, '$1')
  }

  // Markdown 语法转纯文本
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  s = s.replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
  s = s.replace(/^[ \t]*>[ \t]?/gm, '')
  s = s.replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
  s = s.replace(/(?<![\w\\])([*_])(?!\s)(.+?)(?<!\s)\1(?![\w])/g, '$2')
  s = s.replace(/`([^`\n]+)`/g, '$1')
  s = s.replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')

  // 分段：连续非空行算一段
  const paragraphs = splitParagraphs(s)
  const rendered = o.indentFirstLine ? paragraphs.map((p) => INDENT + p) : paragraphs

  return rendered.join(o.paragraphSeparator)
}

/**
 * 切分段落。
 *
 * 中文写作里常见两种排版：段落之间空一行，或者不空行直接换行。
 * 两种都要支持 —— **每个非空行就是一段**，空行只作为分隔符被吃掉。
 */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
}

// ───────────────────────── 整书导出 ─────────────────────────

/** 导出成一个完整的文本 */
export function renderFullText(
  chapters: readonly ExportChapter[],
  options: ExportOptions = {},
): string {
  const o = { ...DEFAULTS, ...options }
  const parts: string[] = []
  let lastVolume: string | null | undefined

  for (const ch of chapters) {
    // 换卷时插入卷标题
    if (ch.volume !== undefined && ch.volume !== null && ch.volume !== lastVolume) {
      parts.push(ch.volume)
      lastVolume = ch.volume
    }

    const body = renderBody(ch.body, o)
    parts.push(o.includeChapterTitle ? (body === '' ? ch.title : `${ch.title}\n\n${body}`) : body)
  }

  return parts.join(o.chapterSeparator)
}

export interface ExportedFile {
  fileName: string
  content: string
}

/**
 * 按章导出成多个文件，方便往起点/飞卢批量上传。
 *
 * 文件名带四位序号，保证上传时顺序不乱。
 */
export function renderPerChapter(
  chapters: readonly ExportChapter[],
  options: ExportOptions & { fileNamePattern?: string } = {},
): ExportedFile[] {
  const o = { ...DEFAULTS, ...options }
  const pattern = options.fileNamePattern ?? '{序号}-{标题}.txt'

  return chapters.map((ch, i) => {
    const body = renderBody(ch.body, o)
    const fileName = sanitizeFileName(
      pattern
        .replace(/\{序号\}/g, String(i + 1).padStart(4, '0'))
        .replace(/\{标题\}/g, ch.title)
        .replace(/\{卷\}/g, ch.volume ?? ''),
    )
    return {
      fileName,
      content: o.includeChapterTitle && body !== '' ? `${ch.title}\n\n${body}` : body || ch.title,
    }
  })
}

// ───────────────────────── docx 用的结构化输出 ─────────────────────────

export interface DocxBlock {
  kind: 'volume' | 'chapter' | 'paragraph'
  text: string
}

/**
 * 输出结构化块，供平台层生成 .docx。
 *
 * 卷用 Heading 1、章用 Heading 2、正文用正文样式 —— 这样编辑在 Word 里
 * 能直接用导航窗格跳转，比一整坨纯文本好用得多。
 */
export function toDocxBlocks(
  chapters: readonly ExportChapter[],
  options: ExportOptions = {},
): DocxBlock[] {
  const o = { ...DEFAULTS, ...options, indentFirstLine: false } // docx 用样式缩进，不塞空格
  const out: DocxBlock[] = []
  let lastVolume: string | null | undefined

  for (const ch of chapters) {
    if (ch.volume !== undefined && ch.volume !== null && ch.volume !== lastVolume) {
      out.push({ kind: 'volume', text: ch.volume })
      lastVolume = ch.volume
    }
    if (o.includeChapterTitle) out.push({ kind: 'chapter', text: ch.title })
    for (const p of splitParagraphs(renderBody(ch.body, o))) {
      out.push({ kind: 'paragraph', text: p })
    }
  }

  return out
}

// ───────────────────────── 统计与预览 ─────────────────────────

export interface ExportPreview {
  chapterCount: number
  volumeCount: number
  /** 导出后的总字符数（不含空白） */
  chars: number
  /** 预估文件大小（UTF-8 字节） */
  bytes: number
}

/** 导出前给作者看的预览信息 */
export function previewExport(
  chapters: readonly ExportChapter[],
  options: ExportOptions = {},
): ExportPreview {
  const text = renderFullText(chapters, options)
  const volumes = new Set(chapters.map((c) => c.volume).filter((v): v is string => !!v))
  return {
    chapterCount: chapters.length,
    volumeCount: volumes.size,
    chars: [...text].filter((c) => !/\s/.test(c)).length,
    bytes: new TextEncoder().encode(text).length,
  }
}
