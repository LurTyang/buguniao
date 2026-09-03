/**
 * 给稿纸的每一行标上「它是什么」。
 *
 * 规范：更新文档/04-界面与交互设计.md §外观 · 主题契约
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么需要它】
 *
 * Typora 主题里有七成的规则打向**真正的 Markdown 元素**：
 * `#write h1`、`#write blockquote`、`#write pre`……
 *
 * 而不咕鸟的稿纸是个编辑器：正文是一堆 `.cm-line` 的 div，
 * 里头没有 `<h1>`，也永远不会有 —— 所见即所得的编辑器就是这样。
 * 所以那七成规则在我们这儿**一条都匹配不上**。
 *
 * 这个文件干的事：认出每一行是什么，给它一个类名。
 * 有了类名，主题就能写 `#write .cm-h1 { … }`，
 * 而导入 Typora 主题时也能把 `#write h1` 翻成它（见 theme-css.ts）。
 *
 * 【为什么类名叫 cm-h1 而不是 h1】
 *
 * 因为它是**类**不是标签，写成 `.h1` 会让人以为能用 `h1` 选中它。
 * 带上 `cm-` 前缀就明说了：这是编辑器的行，不是 HTML 元素。
 *
 * 【只看这一行，不做语法树】
 *
 * 判断纯靠这一行的开头 —— 快、稳、可测。
 * 唯一需要跨行的是代码围栏（```），所以调用方要把「现在在不在围栏里」
 * 一起传进来。
 * ─────────────────────────────────────────────────────────────
 */

/** 一行是什么。`null` = 普通正文，不加类 */
export type LineKind =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'quote'
  | 'li'
  | 'ol'
  | 'code'
  | 'hr'
  | 'table'
  | 'p'

/**
 * 认出这一行是什么。
 *
 * @param text     这一行的原文
 * @param inFence  这一行是不是在 ``` 围栏里面（含围栏那两行本身）
 */
export function lineKindOf(text: string, inFence = false): LineKind | null {
  // 围栏里的一律算代码，哪怕它长得像标题 —— `# 注释` 在代码里就是注释
  if (inFence) return 'code'

  const s = text.trimStart()
  if (s === '') return null

  const h = /^(#{1,6})\s/.exec(s)
  if (h) return `h${h[1]!.length}` as LineKind

  if (s.startsWith('>')) return 'quote'
  // 分隔线要在列表之前判：`---` 也能被 `-\s` 那条误伤
  if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(s)) return 'hr'
  if (/^[-*+]\s/.test(s)) return 'li'
  if (/^\d+[.)]\s/.test(s)) return 'ol'
  // 缩进四格（或一个 Tab）也是代码块，Markdown 的老写法
  if (/^(?: {4}|\t)/.test(text) && text.trim() !== '') return 'code'
  // 表格：`| a | b |`。只认竖线开头的，宽松一点会把普通句子误判
  if (s.startsWith('|') && s.includes('|', 1)) return 'table'

  /*
   * 剩下的都是正文段落。
   *
   * 为什么要专门给它一个类，而不是「没类就是正文」：
   * 主题里 `#write p { … }` 是最常见、也最值钱的一条规则（行距、段距、
   * 首行缩进）。要把它翻成我们的选择器，就得有个**只命中正文**的类 ——
   * 用 `.cm-line` 会连标题、引用一起命中，段距就全乱了。
   *
   * 空行不给：空行在 Typora 里也是 <p>，但给了它段距就会翻倍。
   */
  return 'p'
}

/**
 * 从头扫一遍，标出每一行在不在代码围栏里。
 *
 * 围栏是唯一需要上下文的东西 —— 别的都只看当前行。
 * 围栏那两行本身也算「在里面」，不然 ``` 那一行会被当成正文。
 */
export const FENCE_RE = /^\s*(?:```|~~~)/

export function fenceFlags(lines: readonly string[]): boolean[] {
  const out: boolean[] = []
  let open = false
  for (const line of lines) {
    const isFence = FENCE_RE.test(line)
    if (isFence) {
      out.push(true)
      open = !open
    } else {
      out.push(open)
    }
  }
  return out
}

/** 类名。`null` 时不加类 */
export const classOf = (k: LineKind | null): string => (k ? `cm-${k}` : '')
