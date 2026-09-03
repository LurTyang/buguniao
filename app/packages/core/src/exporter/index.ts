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
import { scanAts, unescapeAt } from '../sticky/index.js'
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
  /**
   * 保留 Markdown 语法（标题的 `#`、粗体、引用、代码块……）。
   *
   * **导 md 时开，导 txt 时关。** 两档的用途是反的：
   * md 是「原样搬走，换个编辑器接着写」，txt 是「排给人看」。
   * 默认关 —— 这个函数原本就是给 txt 用的，默认值不该因为多了一档而变。
   */
  keepMarkdown?: boolean
  /**
   * 去掉便利贴的 `@` 标记。
   *
   * ⚠️ 这一条是 0.4 补的漏子：`renderBody()` 原来认得伏笔、双链、注释、
   * Markdown 语法，**唯独没管 `@`** —— 于是导出给编辑的 txt 里，
   * 行首那个 `@` 是原样带出去的。那不是「还没做的功能」，
   * 是已有功能漏了一种标记。
   *
   * 去掉的是**标记本身，内容留着** —— `@表面身份：学徒` 里那句话
   * 是正文的一部分，只有那个 `@` 不是。
   */
  stripFloatMarks?: boolean
  /** 汉字与英文/数字之间补一个空格：`写了3000字` → `写了 3000 字` */
  spaceBetweenCjkAndLatin?: boolean
  /** 清理英文数字前后手滑打出来的多余空格 */
  tidySpaces?: boolean
}

const DEFAULTS: Required<ExportOptions> = {
  keepMarkdown: false,
  stripFloatMarks: true,
  spaceBetweenCjkAndLatin: false,
  tidySpaces: false,
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

  if (o.stripFloatMarks) s = stripFloatMarks(s)

  /*
   * Markdown 语法转纯文本。
   *
   * **导 md 时整块跳过。** md 那一档的用途是「原样搬走、换个编辑器接着写」，
   * 把标题的 `#` 剥掉就搬不回来了。
   */
  if (!o.keepMarkdown) {
    // Markdown 语法转纯文本
    s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    s = s.replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    s = s.replace(/^[ \t]*>[ \t]?/gm, '')
    s = s.replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    s = s.replace(/(?<![\w\\])([*_])(?!\s)(.+?)(?<!\s)\1(?![\w])/g, '$2')
    s = s.replace(/`([^`\n]+)`/g, '$1')
    s = s.replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
  }

  if (o.tidySpaces) s = tidySpaces(s)
  if (o.spaceBetweenCjkAndLatin) s = spaceCjkLatin(s)

  /*
   * 分段。
   *
   * **md 那一档不重排段落** —— 它要的是原样，而重排会把作者精心留的
   * 空行、列表、代码块全揉平。只有排给人看的 txt 才需要统一段距。
   */
  if (o.keepMarkdown) return s.trimEnd()

  // 分段：连续非空行算一段
  const paragraphs = splitParagraphs(s)
  const rendered = o.indentFirstLine ? paragraphs.map((p) => INDENT + p) : paragraphs

  return rendered.join(o.paragraphSeparator)
}

/**
 * 去掉便利贴的 `@` 标记，**内容留着**。
 *
 * 三种写法（见 core/sticky）：
 *   `@`                     单独一行的块标记 → 整行去掉
 *   `@整行浮出`              行首一个 @      → 去掉那个 @
 *   `年龄：@十七岁@，实为…`   行内成对        → 去掉那两个 @
 *
 * `\@` 是转义的字面量，要还原成 `@` 而不是删掉 ——
 * 作者写 `lisi\@qq.com` 是想要一个真的 @。
 *
 * ⚠️ 这个函数是 0.4 补的漏子：`renderBody()` 原来认得伏笔、双链、注释、
 * Markdown 语法，**唯独没管 `@`**，于是导给编辑的 txt 里行首那个 @
 * 是原样带出去的。那不是「还没做的功能」，是已有功能漏了一种标记。
 */
export function stripFloatMarks(text: string): string {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    // 单独一行的块标记：整行去掉
    if (line.trim() === '@') continue

    const ats = scanAts(line)
    let s = line
    if (ats.length >= 2 && ats.length % 2 === 0) {
      // 成对：两两配对，标记去掉、中间的字留着
      let cut = ''
      let last = 0
      for (const at of ats) {
        cut += s.slice(last, at)
        last = at + 1
      }
      s = cut + s.slice(last)
    } else if (ats.length === 1 && ats[0] === 0) {
      // 行首一个：整行浮出，去掉标记留内容
      s = s.slice(1)
    }
    // 剩下的（邮箱里那个、三个不成对的）一个都不动，
    // 只把转义的还原成真的 @
    out.push(unescapeAt(s))
  }
  return out.join('\n')
}

/** 中日韩汉字。用来判断「这儿要不要补个空格」 */
const CJK_CLASS = '\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uf900-\ufaff'

/**
 * 汉字与英文/数字之间补一个空格。
 *
 * **只补汉字和「拉丁字母/数字」之间，不碰标点** ——
 * `写了3000字。` 里那个句号后面不该冒出空格。
 */
export function spaceCjkLatin(text: string): string {
  return text
    .replace(new RegExp('([' + CJK_CLASS + '])([A-Za-z0-9])', 'g'), '$1 $2')
    .replace(new RegExp('([A-Za-z0-9])([' + CJK_CLASS + '])', 'g'), '$1 $2')
}

/**
 * 收掉手滑打出来的多余空格。
 *
 * **不碰行首**：行首空白可能是作者故意排的（诗、代码、剧本缩进）。
 * 也不碰全角空格 —— 那是他主动敲的缩进，不是手滑。
 */
export function tidySpaces(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const indent = /^[ \t]*/.exec(line)?.[0] ?? ''
      const rest = line
        .slice(indent.length)
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+([，。！？；：、）】」』》])/g, '$1')
        .replace(/([（【「『《])[ \t]+/g, '$1')
        .trimEnd()
      return indent + rest
    })
    .join('\n')
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
