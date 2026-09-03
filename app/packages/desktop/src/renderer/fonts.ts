/**
 * 正文字体表。
 *
 * 规范：更新文档/04-界面与交互设计.md §7（一期内置楷体/宋体/黑体三种）
 *
 * 设置里**存的是 key**（`kai`/`song`/`hei`），不是 CSS 字体栈。
 * 早先存的是整串字体栈，结果是：配置里的默认值和下拉框里的选项对不上，
 * 下拉框永远显示「自定义」。key 只有一处定义，对不上的情况就不存在了。
 */

export interface FontChoice {
  key: string
  label: string
  /** 真正写进 `--font-body` 的 CSS 字体栈 */
  stack: string
  /** 这一款有没有另配标点，说明给设置页看 */
  note?: string
}

/**
 * 楷体自带的标点比它的字重得多 —— 问号、感叹号、书名号摆在
 * 一行细笔画的楷字里，看着像是从别的字体里掉进来的。
 *
 * 用 `unicode-range` 把 CJK 标点单独指到仿宋，笔画粗细就对上了。
 * 范围只圈标点，一个汉字都不碰。
 */
export const PUNCT_UNICODE_RANGE =
  'U+2014, U+2018-201F, U+2026, U+3001-3011, U+3014-301F, U+FF01-FF65'

/** 给楷体配的标点字体名。@font-face 定义在 styles.css 里 */
const KAI_PUNCT = "'不咕鸟楷体标点'"

export const FONTS: FontChoice[] = [
  {
    key: 'kai',
    label: '楷体',
    stack: `${KAI_PUNCT}, '楷体', 'KaiTi', 'STKaiti', serif`,
    note: '标点另配了仿宋，不然问号比字重',
  },
  { key: 'song', label: '宋体', stack: "'宋体', 'SimSun', 'Songti SC', serif" },
  { key: 'hei', label: '黑体', stack: "'黑体', 'SimHei', 'Heiti SC', sans-serif" },
]

/**
 * 把设置里存的值变成能写进 CSS 的字体栈。
 *
 * 三种情况都要认：
 *   - key（现在的存法）
 *   - 早先版本存下的整串字体栈 —— 认得出是哪一款就归位，认不出就原样用
 *   - 光秃秃一个字体名（更早的默认值就是 `楷体`）
 */
export function resolveFontStack(value: string): string {
  // 自选字体：`custom:某某`。它不在 FONTS 表里，得先认出来
  const custom = value.startsWith('custom:') ? value.slice('custom:'.length) : ''
  if (custom) return `'${custom}', '楷体', 'KaiTi', serif`

  const hit = FONTS.find((f) => f.key === value)
  if (hit) return hit.stack

  const byLabel = FONTS.find((f) => value === f.label || value === f.stack)
  if (byLabel) return byLabel.stack

  // 旧版本存的字体栈，开头那个名字能对上就算
  const head = value.split(',')[0]?.replace(/['"]/g, '').trim() ?? ''
  const byHead = FONTS.find((f) => f.label === head || f.stack.includes(`'${head}'`))
  if (byHead) return byHead.stack

  return value || FONTS[0]!.stack
}

/** 反过来：存的值对应下拉框里的哪一项。认不出来就是「自定义」 */
export function fontKeyOf(value: string): string | null {
  const stack = resolveFontStack(value)
  return FONTS.find((f) => f.stack === stack)?.key ?? null
}

// ───────────────────────── 自己导进来的字体 ─────────────────────────

/**
 * 自选字体在设置里存成 `custom:字体名`。
 *
 * 带前缀是为了跟内置的三个 key 分开：不带的话，一个叫 `kai` 的
 * 自选字体会把内置楷体顶掉，而两边都以为是对方的问题。
 */
export const CUSTOM_PREFIX = 'custom:'

export const customFamilyOf = (value: string): string =>
  value.startsWith(CUSTOM_PREFIX) ? value.slice(CUSTOM_PREFIX.length) : ''

export const customValueOf = (family: string): string => CUSTOM_PREFIX + family

/**
 * 自选字体的 CSS 字体栈。
 *
 * 后面照样跟着楷体和 serif —— **字体里没有的字要有地方兜底**。
 * 很多字体只做了常用字，遇到生僻字会显示成方框；跟一个兜底字体
 * 就变成「这个字用楷体显示」，而不是一个豆腐块。
 */
export function customFontStack(family: string): string {
  return `'${family}', '楷体', 'KaiTi', serif`
}

/**
 * 把一款自选字体装进页面。
 *
 * 只留一个 style 标签：换字体就整个换掉，不会越积越多。
 */
export function applyCustomFont(family: string, dataUrl: string): void {
  const id = 'bugu-custom-font'
  const old = document.getElementById(id)
  if (!family || !dataUrl) {
    old?.remove()
    return
  }
  const el = old ?? document.createElement('style')
  el.id = id
  el.textContent = `@font-face{font-family:'${family}';src:url('${dataUrl}');font-display:swap}`
  if (!old) document.head.appendChild(el)
}
