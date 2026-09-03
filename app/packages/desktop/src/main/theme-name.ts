/**
 * 一份自选样式叫什么、稿纸是什么颜色。
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么要给它取名】
 *
 * 作者：「我们可能需要给这些自定义主题取名，这个功能也很重要。」
 *
 * 三个槽位如果只显示文件名（`phycat-mint`），那它就是个文件路径，
 * 不是一个主题。取了名之后它才跟「纸白」「护眼」平起平坐 ——
 * 而那正是作者要的：**自选样式不是预设的附加品，它就是一档主题。**
 *
 * 【颜色从哪儿来】
 *
 * 作者：「导入样式后，对应的预设应该与该主题的稿纸颜色一致。」
 *
 * 所以从 CSS 里**把稿纸底色抠出来**。抠不到就用当前主题的色 ——
 * 宁可跟原来一样，也不要瞎猜一个颜色摆在那儿。
 * ─────────────────────────────────────────────────────────────
 */

import path from 'node:path'

/** 从文件名猜个名字。`phycat-mint.css` → `phycat mint` */
export function nameFromFile(file: string): string {
  const base = path.basename(file).replace(/\.css$/i, '')
  return base.replace(/[-_]+/g, ' ').trim() || '自选样式'
}

/**
 * Typora 主题在 CSS 注释里常写着自己的名字：
 *
 *     /* Theme Name: Phycat Mint *\/
 *     /* theme: mint *\/
 *
 * 有就用它 —— 那是作者自己给主题起的名，比文件名准。
 */
const NAME_RE = /\/\*[^*]*?(?:theme[-\s]*name|主题名?)\s*[:：]\s*([^\r\n*]+)/i

export function nameFromCss(css: string, file: string): string {
  const m = NAME_RE.exec(css)
  const got = (m?.[1] ?? '').trim()
  // 太长的不要 —— 它要显示在一个小色块上
  if (got && [...got].length <= 16) return got
  return nameFromFile(file)
}

/**
 * 读一个 CSS 变量的值。`--bg-color: #eaf7ee` → `#eaf7ee`
 *
 * 只找**最后一次**定义 —— 后面的覆盖前面的，跟浏览器一个规矩。
 * 一份主题里同一个变量在浅色/深色两段里各定义一次是常事。
 */
function varValue(css: string, name: string): string {
  // ⚠️ 别写成模板字符串：模板里的 \\s 会被当成转义吃掉，
  //    正则就成了 `--bgs*:s*…`，永远匹配不上（踩过一次）
  const re = new RegExp(name + '\\s*:\\s*([^;!}]+)', 'gi')
  let last = ''
  for (const m of css.matchAll(re)) last = (m[1] ?? '').trim()
  return last
}

/**
 * 把 `var(--x)` 解开一层。解不开就原样返回。
 *
 * 变量名那一段用 `[^\s,()]+` 而不是 `[a-z0-9-]+` —— CSS 的变量名
 * 允许非 ASCII，而且真有人用中文命名。收窄了就解不开那些，
 * 表现是「这份主题抠不出颜色」，而原因完全看不出来。
 */
function deref(css: string, value: string, depth = 0): string {
  const m = /^var\(\s*(--[^\s,()]+)\s*(?:,\s*([^)]*))?\)$/i.exec(value.trim())
  if (!m || depth > 3) return value.trim()
  const got = varValue(css, m[1] ?? '')
  if (got) return deref(css, got, depth + 1)
  // 变量没定义，用 var() 里写的兜底值
  return m[2] ? deref(css, m[2], depth + 1) : ''
}

/**
 * 把稿纸底色抠出来。
 *
 * ⚠️ **必须认 Typora 那套变量名。** 初版只找 `--bg:` 这种，
 * 而 Typora 主题写的是 `--bg-color` —— 于是真主题一个都抠不出来，
 * 色块永远是预设的颜色（作者报的「导入样式后色块没跟着变」就是这个）。
 *
 * 而且 `#write { background: var(--bg-color) }` 这种间接引用要解开一层，
 * 否则拿到的是一串 `var(...)`，摆到色块上就是没颜色。
 *
 * 按可靠程度依次找：
 *   1. `#write { background: X }`   —— Typora 排版正文用的就是它
 *   2. Typora 的背景变量（`--bg-color` 等）
 *   3. 我们自己那套变量名（`--bg`）
 *   4. `body { background: X }`
 *
 * 全都抠不到就返回空串，**调用方用当前主题的颜色兜底** ——
 * 瞎猜一个颜色摆在色块上，比跟原来一样更糟。
 */
/**
 * 选择器有没有一支是**元素自己**，而不是它底下的东西。
 *
 * ⚠️ 这一条是踩出来的。原来用 `/#write[^{}]*\{/` 抓「#write 的背景」——
 *    `[^{}]*` 把空格也放过去了，于是
 *
 *        #write code:not(.md-fencescode) { background-color: ... }
 *
 *    也算数：抠出来的其实是**行内代码的底色**，被当成纸色摆到色块上。
 *    作者看到的就是这个 —— 色块是薄荷绿，稿纸却是白的，
 *    因为那绿色压根不是纸色。
 *
 * 所以改成按逗号拆开，要求某一支的**最后一节**正好是这个选择器。
 * 伪类（`:not(...)`、`:hover`）允许，伪元素（`::before`）不允许 ——
 * `#write::before` 是主题铺纹理的地方，那不是纸。
 */
function selfSelector(sel: string, tag: string): boolean {
  return sel.split(',').some((one) => {
    const last = one.trim().split(/[\s>+~]+/).pop() ?? ''
    if (last.includes('::')) return false
    // 砍掉伪类：`#write:not(.x)` → `#write`
    return last.replace(/:[a-z-]+(\([^)]*\))?/gi, '') === tag
  })
}

/** 把 CSS 粗粗拆成一条条规则。够用就行 —— 这儿只是在找颜色，不是在解析 */
function rulesOf(css: string): Array<[string, string]> {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1]!.trim(), m[2]!])
}

/** 这些不是颜色，是「没有颜色」。摆到色块上跟没抠到一样，还更容易骗人 */
const NOT_A_COLOR = /^(transparent|none|inherit|initial|unset|revert|0\s+0|currentcolor)$/i

export function paperColorOf(css: string): string {
  /** 一个候选值能不能用：解开 var()、去掉解不动的 */
  const use = (raw: string | undefined): string => {
    const v = deref(css, raw ?? '').trim()
    if (!v || /url\(|var\(/i.test(v)) return ''
    return NOT_A_COLOR.test(v) ? '' : v
  }

  /** 某个元素自己身上的 background */
  const ownBg = (tag: string): string => {
    for (const [sel, decls] of rulesOf(css)) {
      if (!selfSelector(sel, tag)) continue
      const m = /(?:^|;)\s*background(?:-color)?\s*:\s*([^;!}]+)/i.exec(decls)
      const v = use(m?.[1])
      if (v) return v
    }
    return ''
  }

  // 1. `#write { background: … }` —— Typora 排版正文用的就是它
  const a = ownBg('#write')
  if (a) return a

  // 2. 变量。**Typora 那套名字排在前面** —— 真主题写的是 --bg-color，
  //    初版只认 --bg，于是一个都抠不出来
  for (const name of ['--bg-color', '--bg', '--body-bg', '--background', '--main-bg']) {
    const b = use(varValue(css, name))
    if (b) return b
  }

  // 3. body / html 自己的底色
  return ownBg('body') || ownBg('html')
}


