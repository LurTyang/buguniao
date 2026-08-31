/**
 * 字数统计 —— 双口径。
 *
 * 规范：更新文档/07-待决事项.md A4（作者选择：两种都做，默认显示「含标点」）
 *
 *   withPunctuation    含标点。去掉空白后的字符数，与起点等平台的结算口径接近。**默认显示这个**
 *   withoutPunctuation 不含标点。再去掉中英文标点，是「真正写了多少字」
 *
 * 统计前会先做一次清洗，把不属于「作品内容」的东西剔除：
 * front-matter、伏笔标记注释、Markdown 语法符号、双链的方括号。
 * 否则作者会发现自己「标了几个伏笔，字数凭空涨了」，那是很糟的体验。
 */

export interface WordCount {
  /** 含标点（平台口径）—— 默认显示 */
  withPunctuation: number
  /** 不含标点（纯字符）*/
  withoutPunctuation: number
}

/** 匹配文件开头的 front-matter */
const FM_RE = /^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/

/** HTML 注释（伏笔标记 `<!--埋#id-->` 也在其中） */
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g

/**
 * 标点符号集合：
 *    -⁯  常用标点（— “ ” ‘ ’ … 等）
 *   　-〿  CJK 符号与标点（。、「」《》等）
 *   ︐-︙  竖排形式标点
 *   ︰-﹏  CJK 兼容形式
 *   ！-＠ ［-｀ ｛-･  全角标点（不含全角字母数字）
 *   ASCII 标点     !-/ :-@ [-` {-~
 */
const PUNCT_RE =
  /[ -⁯　-〿︐-︙︰-﹏！-＠［-｀｛-･!-/:-@[-`{-~]/

/**
 * 把一段 Markdown 清洗成「纯作品内容」，供统计使用。
 * 导出它是为了让统计逻辑可被单测直接检查。
 */
export function stripForCounting(text: string): string {
  let s = text.replace(FM_RE, '')
  s = s.replace(HTML_COMMENT_RE, '')

  // 代码围栏标记本身不算字，围栏内的内容保留（剧本/文案可能用到）
  s = s.replace(/^[ \t]*(?:`{3,}|~{3,}).*$/gm, '')

  // 图片与链接：保留显示文字，丢掉 URL
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')

  // 双向链接：[[李四]] → 李四；[[李四|那个断眉少年]] → 那个断眉少年
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
  s = s.replace(/\[\[([^\]]+)\]\]/g, '$1')

  // 行首的标题井号、引用尖括号、列表符号
  s = s.replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
  s = s.replace(/^[ \t]*>[ \t]?/gm, '')
  s = s.replace(/^[ \t]*(?:[-*+][ \t]+|\d+\.[ \t]+)/gm, '')

  // 强调标记（成对的 * _ ~ `）
  s = s.replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
  s = s.replace(/(?<![\w\\])([*_])(?!\s)(.+?)(?<!\s)\1(?![\w])/g, '$2')
  s = s.replace(/`([^`\n]+)`/g, '$1')

  // 分隔线
  s = s.replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')

  return s
}

/** 统计一段正文的字数（双口径）。传入的应是**已剥离 front-matter 的 body**，但多传也无妨。 */
export function countWords(text: string): WordCount {
  const cleaned = stripForCounting(text)

  let withPunctuation = 0
  let withoutPunctuation = 0

  // 用扩展迭代按码点走，保证生僻字与 emoji 算 1 个
  for (const ch of cleaned) {
    if (/\s/.test(ch)) continue
    withPunctuation++
    if (PUNCT_RE.test(ch)) continue
    withoutPunctuation++
  }

  return { withPunctuation, withoutPunctuation }
}

export type CountMode = 'withPunctuation' | 'withoutPunctuation'

/** 默认口径：含标点（作者选定，见 07-待决事项 A4） */
export const DEFAULT_COUNT_MODE: CountMode = 'withPunctuation'

/** 按设置里选的口径取一个数 */
export function pickCount(c: WordCount, mode: CountMode = DEFAULT_COUNT_MODE): number {
  return c[mode]
}

/** 界面显示用：1503 → "1,503" */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

/** 书架卡片用：82345 → "8.2万字"；不足一万时显示具体数字 */
export function formatCountShort(n: number): string {
  if (n < 10000) return `${formatCount(n)}字`
  return `${(n / 10000).toFixed(1)}万字`
}
