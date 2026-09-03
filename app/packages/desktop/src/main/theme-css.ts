/**
 * 把一份自选主题 CSS 变成「能直接注进页面」的样子。
 *
 * 规范：更新文档/04-界面与交互设计.md §外观
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么不能把文件内容原样注进去】
 *
 * 作者报了「主题无法正常导入，明明在别的软件中可用」。原因查清了：
 * 他那份 `phycat-mint.css` 第一行是
 *
 *     @import url(./phycat/phycat.light.css);
 *
 * 整个主题的内容都在被 import 的那个文件里。而我们是把 CSS 当成
 * **内联 `<style>`** 注进页面的 —— 内联样式里的相对路径是相对**页面**解析的，
 * 不是相对那个 CSS 文件。于是它去应用自己的目录里找 `./phycat/…`，
 * 找不到，**静默失败**，页面上一点变化都没有。
 *
 * Typora 能用，是因为它把主题文件放在自己的主题目录里，用 `<link>` 加载 ——
 * 那样相对路径是对的。
 *
 * 所以这一层干两件事：
 *   1. 把 `@import` 的内容**递归读进来**，按那个 CSS 文件自己的位置解析
 *   2. 把剩下的 `url(...)` 相对路径改写成绝对的 `file://`
 *
 * 【读不到要说出来】
 *
 * 缺了被 import 的文件时**必须报出来**。原来是静默当没配 ——
 * 而「明明选了主题却毫无变化」正是最难自己查出来的一种坏法。
 * ─────────────────────────────────────────────────────────────
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** 最多跟着 @import 走几层。循环引用另有一张 seen 表挡着，这个是防深度 */
const MAX_DEPTH = 8

export interface ResolvedCss {
  css: string
  /** 一路上出了什么问题。空 = 没问题。**这些话要显示给作者看** */
  problems: string[]
  /** 桥接翻译出来的规则条数。0 = 这份主题没写 Markdown 排版，只调了颜色 */
  bridged: number
}

/** 读文件。抽成参数是为了能测 —— 这一层的坑全在路径解析上 */
export type ReadFile = (file: string) => Promise<string>

const realRead: ReadFile = (f) => fsp.readFile(f, 'utf8')

/**
 * `@import` 的几种写法都要认：
 *   @import url(./a.css);
 *   @import url("./a.css");
 *   @import './a.css';
 *   @import url(a.css) screen;      ← 带媒体查询的，本地主题里基本不会有
 */
const IMPORT_RE = /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)\s*;?/g

/** `url(...)` 里那些要改写成绝对路径的相对引用 */
const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g

/** 已经是绝对的、或者根本不是文件的，别去动它 */
function isAbsoluteRef(ref: string): boolean {
  return (
    ref.startsWith('data:') ||
    ref.startsWith('http://') ||
    ref.startsWith('https://') ||
    ref.startsWith('file://') ||
    ref.startsWith('//') ||
    ref.startsWith('#')
  )
}

/**
 * 把相对的 `url(...)` 改写成绝对的 `file://`。
 *
 * 不动 data: 和 http(s): —— 前者本来就自带内容，后者是网络资源
 * （主题里那些 SVG 图标基本都是 data:，所以多数情况这一步没什么可改的）。
 */
export function absolutizeUrls(css: string, baseDir: string): string {
  return css.replace(URL_RE, (whole, quote: string, ref: string) => {
    if (isAbsoluteRef(ref)) return whole
    const abs = pathToFileURL(path.resolve(baseDir, ref)).href
    return `url(${quote}${abs}${quote})`
  })
}

/**
 * 读一份 CSS，把它的 `@import` 递归展开、相对路径绝对化。
 *
 * @param file    CSS 文件的绝对路径
 * @param read    读文件的函数（测试时换成假的）
 */
export async function resolveThemeCss(
  file: string,
  read: ReadFile = realRead,
): Promise<ResolvedCss> {
  const problems: string[] = []
  const seen = new Set<string>()

  async function one(f: string, depth: number): Promise<string> {
    const key = path.resolve(f)
    if (seen.has(key)) {
      // 循环引用。不报错、不重复展开 —— 一份主题里 a 引 b、b 又引 a
      // 是写歪了，但没必要因此整份用不了
      return ''
    }
    seen.add(key)
    if (depth > MAX_DEPTH) {
      problems.push(`@import 套得太深（超过 ${MAX_DEPTH} 层），后面的没再跟下去。`)
      return ''
    }

    let text: string
    try {
      text = await read(key)
    } catch {
      // 这就是作者碰上的那种情况：主题的正文全在被 import 的文件里，
      // 而那个文件没跟着一起拷过来
      problems.push(`找不到 ${path.basename(key)} —— 这份主题引用了它，缺了就没效果。`)
      return ''
    }

    const dir = path.dirname(key)
    const imports: Array<{ whole: string; ref: string }> = []
    for (const m of text.matchAll(IMPORT_RE)) {
      const ref = (m[2] ?? m[4] ?? '').trim()
      if (ref) imports.push({ whole: m[0], ref })
    }

    let out = text
    for (const im of imports) {
      // 网络上的 @import 不跟：那要联网，而主题不该偷偷发请求
      if (isAbsoluteRef(im.ref)) {
        problems.push(`跳过了一条联网的 @import（${im.ref}）—— 主题不该联网取东西。`)
        out = out.replace(im.whole, '')
        continue
      }
      const inner = await one(path.resolve(dir, im.ref), depth + 1)
      out = out.replace(im.whole, inner)
    }

    return absolutizeUrls(out, dir)
  }

  const raw = await one(file, 0)
  /*
   * 翻译放在最后追加：CSS 同权重比源码顺序，后来者赢。
   * 翻出来的那份要压过主题自己写的（那些本来也匹配不上），
   * 更要压过我们 styles.css 里的默认排版。
   */
  const bridge = bridgeMarkdownRules(raw)
  return { css: raw + bridge.css, problems, bridged: bridge.count }
}

/* ═══════════════════════════════════════════════════════════════
 * 选择器桥接 —— 让 Typora 主题里那些「打向 Markdown 元素」的规则也能落地。
 *
 * 【问题】
 *
 * 一份 Typora 主题（拿作者给的 phycat 数过）有 313 条规则：
 *   188 条打向 Typora 自己的界面（侧栏、标签页、菜单）→ 我们没有，永远不匹配
 *    71 条打向 #write 里的 Markdown 元素（h1、blockquote、pre）→ **也不匹配**
 *    38 条打向 #write 本身
 *    16 条打向 html / body / :root
 *
 * 前 188 条没救也不该救 —— 那是别人的界面。
 * 但中间那 71 条是**真正的排版**：标题多大、引用什么样、段落多疏。
 * 它们不匹配只有一个原因：稿纸里没有真的 <h1>，只有 .cm-line 的 div。
 *
 * 【做法】
 *
 * 给行标上类（renderer/md-line-class.ts），然后在这儿把
 *
 *     #write h1        →  #write .cm-h1
 *     #write blockquote →  #write .cm-quote
 *     #write p          →  #write .cm-p
 *
 * 翻一份**追加**在原文后面。原来的规则一条不动 —— 它们本来就不匹配，
 * 留着无害；而万一哪天稿纸真渲染出了 <h1>，它们还能用。
 *
 * 【三条自我约束】
 *
 * 1. **只翻 `#write` 底下的。** 一份主题里裸写的 `h1` 十有八九是它自己的
 *    界面（大纲、文件树），翻过来只会把稿纸弄花。
 * 2. **不动原文。** 追加，不改写、不删除。看不顺眼时整段扔掉就回到从前。
 * 3. **翻不动就不翻。** 一条选择器里没认出任何元素，就不产出这一条 ——
 *    宁可少一条，不要多一条乱命中的。
 *
 * 【已知做不到的】
 *
 * 行内元素（`strong`、`em`、`a`、行内 `code`）翻不了：它们在一行**内部**，
 * 而我们只能给整行贴类。要支持得给编辑器加行内装饰，那是另一件事。
 * ═══════════════════════════════════════════════════════════════
 */

/**
 * Markdown 元素 → 稿纸里的行类。
 *
 * ⚠️ 顺序有意义：正则的选择分支是从左往右试的，`pre` 必须排在 `p` 前面，
 *    不然 `#write pre` 会被当成 `#write p` + 多出来的 `re`。
 */
const ELEMENT_MAP: ReadonlyArray<readonly [string, string]> = [
  ['blockquote', '.cm-quote'],
  ['table', '.cm-table'],
  ['code', '.cm-code'],
  ['pre', '.cm-code'],
  ['h1', '.cm-h1'],
  ['h2', '.cm-h2'],
  ['h3', '.cm-h3'],
  ['h4', '.cm-h4'],
  ['h5', '.cm-h5'],
  ['h6', '.cm-h6'],
  ['hr', '.cm-hr'],
  ['li', '.cm-li'],
  ['p', '.cm-p'],
]

const ELEMENT_RE = new RegExp(
  '(^|[\\s>+~(])(' + ELEMENT_MAP.map(([k]) => k).join('|') + ')(?=$|[\\s.:#\\[>+~),])',
  'g',
)

const TO_CLASS = new Map(ELEMENT_MAP)

/**
 * Typora 自己往 DOM 上贴的标记类。
 *
 * 它们不是主题作者写的样式钩子，是 Typora 的内部结构标记：
 * 每个标题都带 `.md-heading`，每个块的末尾都带 `.md-end-block`。
 * 我们的行上当然没有 —— 留着它们，翻出来的选择器一条也匹配不上，
 * 等于白翻。所以**删掉**，让 `.cm-h3.md-heading:after` 变成 `.cm-h3:after`。
 *
 * ⚠️ 只删这种「人人都有」的结构标记。像 `.md-focus`（光标在这一块里）
 *    那种**表示状态**的一律不删 —— 删了会让本该只在特定时刻出现的样式
 *    一直挂着，那比不生效更糟。
 */
const DROP_CLASS = /\.(?:md-heading|md-end-block|md-p)(?![\w-])/g

/** 少数几个 Typora 类，我们这边有对得上的东西 */
const CLASS_MAP: ReadonlyArray<readonly [RegExp, string]> = [
  [/\.md-fences(?![\w-])/g, '.cm-code'],
]

/** 按逗号切选择器，但括号和引号里的逗号不算 —— `:is(h1, h2)` 得整个留着 */
function splitSelectors(sel: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote = ''
  let start = 0
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i]!
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) {
      out.push(sel.slice(start, i))
      start = i + 1
    }
  }
  out.push(sel.slice(start))
  return out.map((s) => s.trim()).filter(Boolean)
}

/**
 * 翻一整条选择器（可能有好几个逗号分支）。
 *
 * 翻不出任何东西时返回空串 —— 调用方据此决定不产出这条规则。
 */
export function bridgeSelector(sel: string): string {
  const kept: string[] = []
  for (const one of splitSelectors(sel)) {
    // 规矩 1：只碰 #write 里头的
    if (!one.includes('#write')) continue
    let hit = false
    let next = one.replace(ELEMENT_RE, (_whole, lead: string, tag: string) => {
      hit = true
      return lead + TO_CLASS.get(tag)!
    })
    for (const [re, cls] of CLASS_MAP) {
      next = next.replace(re, () => {
        hit = true
        return cls
      })
    }
    if (!hit) continue
    next = next.replace(DROP_CLASS, '')
    /*
     * 子代组合器要放宽成后代。
     *
     * `#write > h1` 在 Typora 里成立，因为 h1 就挂在 #write 底下。
     * 在我们这儿中间还隔着 .cm-editor / .cm-scroller / .cm-content 三层，
     * 留着 `>` 就永远匹配不上 —— 翻了等于没翻。
     */
    next = next.replace(/\s*>\s*/g, ' ')
    kept.push(next.trim())
  }
  return kept.join(', ')
}

/**
 * 把会把整行拽出文档流的声明摘掉。
 *
 * CodeMirror 靠**行的实际位置**算光标在哪儿、点到了第几个字。
 * 一条 `position: absolute` 或者 `float: left` 落到 .cm-line 上，
 * 行就不在它该在的地方了 —— 光标乱飘、点击选错字，
 * 而作者只会觉得「这软件坏了」，根本联想不到是主题干的。
 *
 * 这是**唯一**一处我们动主题内容的地方，所以划得很窄：
 *
 * · 只摘 `position: absolute|fixed` 和 `float`。
 *   `relative` / `sticky` 留着 —— 它们不脱离文档流，
 *   而且主题的 ::before/::after 装饰全靠父级 relative 定位。
 * · **伪元素上的一律不摘**。`#write .cm-h1::after{position:absolute}`
 *   是正常写法，摘了那些装饰就散架。
 */
export function guardBody(body: string, onPseudo: boolean): string {
  if (onPseudo) return body
  return body
    .replace(/(^|;)\s*position\s*:\s*(?:absolute|fixed)\s*(!important)?\s*(?=;|$)/gi, '$1')
    .replace(/(^|;)\s*float\s*:[^;}]*(?=;|$)/gi, '$1')
    // 摘完会留下 `;;` 和开头那个孤零零的 `;`。它们其实合法，
    // 但留着会让人以为哪儿漏了东西 —— 顺手扫干净
    .replace(/;{2,}/g, ';')
    .replace(/^\s*;/, '')
}

/** 选择器最后落在伪元素上吗 */
function endsOnPseudo(sel: string): boolean {
  return /::?(?:before|after|first-line|first-letter|marker|placeholder|selection)/i.test(sel)
}

/** 找到跟 `css[open]` 这个 `{` 配对的 `}`。返回它的下标；找不到就返回末尾 */
function matchBrace(css: string, open: number): number {
  let depth = 0
  let quote = ''
  for (let i = open; i < css.length; i++) {
    const c = css[i]!
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '/' && css[i + 1] === '*') {
      const e = css.indexOf('*/', i + 2)
      i = e < 0 ? css.length : e + 1
    } else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return css.length
}

/** 带块的 at-rule：要钻进去翻，因为里头还是普通规则 */
const NESTED_AT = /^@(media|supports|layer|container|scope)\b/i

function bridgeBlock(css: string, from: number, to: number, tally: { n: number }): string {
  let out = ''
  let head = from
  let i = from
  while (i < to) {
    const c = css[i]!
    if (c === '/' && css[i + 1] === '*') {
      const e = css.indexOf('*/', i + 2)
      i = e < 0 ? to : e + 2
      continue
    }
    if (c === '"' || c === "'") {
      const q = c
      i++
      while (i < to && css[i] !== q) i += css[i] === '\\' ? 2 : 1
      i++
      continue
    }
    if (c === '{') {
      const prelude = css.slice(head, i).trim()
      const end = matchBrace(css, i)
      if (prelude.startsWith('@')) {
        if (NESTED_AT.test(prelude)) {
          const inner = bridgeBlock(css, i + 1, end, tally)
          // 里头一条都没翻出来就别产出空的 @media 壳子
          if (inner.trim()) out += `${prelude}{\n${inner}}\n`
        }
        // @font-face / @keyframes 之类没有选择器，跳过
      } else {
        const sel = bridgeSelector(prelude)
        if (sel) {
          out += `${sel}{${guardBody(css.slice(i + 1, end), endsOnPseudo(sel))}}\n`
          tally.n++
        }
      }
      i = end + 1
      head = i
      continue
    }
    if (c === '}') {
      i++
      head = i
      continue
    }
    i++
  }
  return out
}

/**
 * 把一份主题里所有「打向 Markdown 元素」的规则翻一份出来。
 *
 * @returns 翻出来的 CSS 和条数。一条都没有时返回空串。
 */
export function bridgeMarkdownRules(css: string): { css: string; count: number } {
  const tally = { n: 0 }
  const out = bridgeBlock(css, 0, css.length, tally)
  if (!tally.n) return { css: '', count: 0 }
  const count = tally.n
  return {
    css: `\n/* ↓ 不咕鸟自动翻译：把 #write 里的 Markdown 规则改写到稿纸的行上 */\n${out}`,
    count,
  }
}
