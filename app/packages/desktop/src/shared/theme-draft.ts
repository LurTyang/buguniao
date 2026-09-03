/**
 * 自己调一套主题。
 *
 * 规范：更新文档/04-界面与交互设计.md §7 主题与外观
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么有这个】
 *
 * 0.4 花了很大力气去适配 Typora 主题，做完之后有个很清楚的结论：
 * **别人的主题只能还原一部分**，而且还不了的那部分不是我们不够努力 ——
 * 是那些规则本来就是写给另一个软件的界面的。
 *
 * 更要命的是有一整类主题（phycat 那种）根本不定义纸色：装上之后
 * 纸还是白的，而作者只会看到「怎么没变」，然后开始怀疑是不是漏了文件。
 *
 * 所以换个方向：**把变量契约变成一个能点的东西**。
 * 那些变量每一个都摆在那儿，色盘一点就改，改完能导出成一份标准的
 * .css —— 那份文件别人也能用，而且一定完整。
 *
 * 【这个文件只管算，不碰界面】
 *
 * 主进程也要用它（把草稿变成 CSS），所以它在 shared 里，
 * 不许 import 任何 React、DOM、Electron 的东西。
 * ─────────────────────────────────────────────────────────────
 */

/** 一个可调项 */
export interface DraftField {
  /** CSS 变量名，就是契约里那个 */
  name: string
  /** 界面上显示的名字 */
  label: string
  /** 一句话说明它管什么。**要短** —— 这是设置页，不是文档 */
  hint: string
  /**
   * 怎么调。
   * `color` 给色盘，`shadow` 给文本框（阴影不是颜色，是一整串 CSS 值）
   */
  kind: 'color' | 'shadow'
  /** 这个名字 Typora 也有。别人的主题写了它，就能改到我们这一项 */
  typora?: boolean
}

export interface DraftGroup {
  title: string
  fields: DraftField[]
}

/**
 * 全部可调项。
 *
 * 顺序是**按真去调的时候的顺序**排的，不是按字母：先定底色，再定字色，
 * 再挑强调色。一个人从头调一套主题时就是这个顺序。
 */
export const DRAFT_GROUPS: DraftGroup[] = [
  {
    title: '底',
    fields: [
      {
        name: '--bg-color',
        label: '页面底色',
        hint: '稿纸的纸色也是它',
        kind: 'color',
        typora: true,
      },
      {
        name: '--side-bar-bg-color',
        label: '侧边栏',
        hint: '侧栏和各种面板的底',
        kind: 'color',
        typora: true,
      },
      { name: '--bg-raised', label: '浮起来的一层', hint: '卡片、弹窗、便利贴', kind: 'color' },
      { name: '--window-border', label: '线', hint: '分隔线、描边', kind: 'color', typora: true },
    ],
  },
  {
    title: '字',
    fields: [
      {
        name: '--text-color',
        label: '正文',
        hint: '深色主题别用纯白，暖一点更好读',
        kind: 'color',
        typora: true,
      },
      {
        name: '--control-text-color',
        label: '次要文字',
        hint: '按钮、说明、时间',
        kind: 'color',
        typora: true,
      },
      {
        name: '--md-char-color',
        label: '最淡的一层',
        hint: '标记符号、占位提示',
        kind: 'color',
        typora: true,
      },
    ],
  },
  {
    title: '强调',
    fields: [
      {
        name: '--primary-color',
        label: '强调色',
        hint: '一套主题的性格基本由它定',
        kind: 'color',
        typora: true,
      },
      {
        name: '--item-hover-bg-color',
        label: '悬停底色',
        hint: '要很淡 —— 它会大面积出现',
        kind: 'color',
        typora: true,
      },
      {
        name: '--select-text-bg-color',
        label: '选中文字',
        hint: '选中那一段的底',
        kind: 'color',
        typora: true,
      },
      {
        name: '--active-file-bg-color',
        label: '当前这篇 · 底',
        hint: '目录树里高亮的那条',
        kind: 'color',
        typora: true,
      },
      {
        name: '--active-file-text-color',
        label: '当前这篇 · 字',
        hint: '同上，字的颜色',
        kind: 'color',
        typora: true,
      },
      {
        name: '--code-block-bg-color',
        label: '代码块',
        hint: '代码那一段的底',
        kind: 'color',
        typora: true,
      },
    ],
  },
  {
    title: '状态',
    fields: [
      { name: '--danger', label: '危险', hint: '删除、警告', kind: 'color' },
      { name: '--ok', label: '达标', hint: '完成、写够了', kind: 'color' },
    ],
  },
  {
    title: '热力图',
    fields: [
      {
        name: '--heat-0',
        label: '没写',
        hint: '五档要同一个色相由浅到深，跳色就读不出多少了',
        kind: 'color',
      },
      { name: '--heat-1', label: '写了一点', hint: '', kind: 'color' },
      { name: '--heat-2', label: '一般', hint: '', kind: 'color' },
      { name: '--heat-3', label: '不少', hint: '', kind: 'color' },
      { name: '--heat-4', label: '写爆了', hint: '', kind: 'color' },
    ],
  },
  {
    title: '图表',
    fields: [
      { name: '--chart-grid', label: '网格线', hint: '淡到不跟数据抢', kind: 'color' },
      { name: '--chart-ink', label: '线条', hint: '', kind: 'color' },
    ],
  },
  {
    title: '阴影',
    fields: [
      { name: '--shadow', label: '贴地', hint: '卡片。整串 CSS 值', kind: 'shadow' },
      { name: '--shadow-float', label: '浮起', hint: '弹窗、拖动中的便利贴', kind: 'shadow' },
    ],
  },
]

/** 摊平的一张表，查起来方便 */
export const DRAFT_FIELDS: DraftField[] = DRAFT_GROUPS.flatMap((g) => g.fields)

export interface ThemeDraft {
  /** 主题名。导出的文件名和 Theme Name 都用它 */
  name: string
  /** 正文字体的 CSS 值（跟设置里那个字体下拉是同一套值） */
  font: string
  /** 变量名 → 值 */
  vars: Record<string, string>
}

/**
 * 拿一套现成的当起点。
 *
 * @param decls `themes.ts` 的 declsOf() 给的那种 `--x:值` 数组
 *
 * **从零调一套主题没人受得了** —— 二十几个颜色，第一个就得凭空想。
 * 所以永远是「拿一套改」，起点默认是当前用的那个预设。
 */
export function seedDraft(decls: readonly string[], name: string, font: string): ThemeDraft {
  const vars: Record<string, string> = {}
  for (const d of decls) {
    const i = d.indexOf(':')
    if (i > 0) vars[d.slice(0, i).trim()] = d.slice(i + 1).trim()
  }
  return { name, font, vars }
}

/**
 * 少了的项拿起点补上。
 *
 * 契约以后加了新变量，老草稿里没有那一项 —— 补上默认值，
 * 而不是让界面上空一格、导出的 CSS 缺一块。
 */
export function fillDraft(d: ThemeDraft, decls: readonly string[]): ThemeDraft {
  const base = seedDraft(decls, d.name, d.font)
  return { ...d, vars: { ...base.vars, ...d.vars } }
}

/* ── 颜色的几种写法之间来回换 ────────────────────────────── */

/**
 * 收拾成 `#rrggbb`。
 *
 * 认 `#abc`、`abc`、`#AABBCC`、前后带空格的。
 * 认不出来返回空串 —— **不猜**：猜错的颜色比没颜色更难发现。
 */
export function normHex(raw: string): string {
  const s = raw.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(s)) {
    return (
      '#' +
      [...s]
        .map((c) => c + c)
        .join('')
        .toLowerCase()
    )
  }
  if (/^[0-9a-f]{6}$/i.test(s)) return '#' + s.toLowerCase()
  return ''
}

export interface Rgb {
  r: number
  g: number
  b: number
}

/** 认不出来给 null，调用方自己决定怎么办 */
export function hexToRgb(raw: string): Rgb | null {
  const h = normHex(raw)
  if (!h) return null
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  }
}

/** 超出 0–255 的夹回去，小数四舍五入 —— 数字框里什么都可能被打进来 */
export function rgbToHex({ r, g, b }: Rgb): string {
  const one = (n: number): string => {
    const v = Math.max(0, Math.min(255, Math.round(Number.isFinite(n) ? n : 0)))
    return v.toString(16).padStart(2, '0')
  }
  return '#' + one(r) + one(g) + one(b)
}

/**
 * 给色盘一个它认得的值。
 *
 * `input[type=color]` 只吃 `#rrggbb`。而契约里的值可能是 `rgba(...)`、
 * `hsl(...)` 或者别的写法 —— 直接塞进去会被浏览器悄悄改成黑色。
 *
 * 所以换算一个近似值给它显示，**但不动真正存着的那个值**：
 * 只有作者真去拖了色盘，才把值换成新的。
 */
export function forWheel(value: string, fallback = '#888888'): string {
  const h = normHex(value)
  if (h) return h
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value)
  if (m) return rgbToHex({ r: +m[1]!, g: +m[2]!, b: +m[3]! })
  return fallback
}

/* ── 出片 ──────────────────────────────────────────────── */

/** 文件名里不能有的字符换成短横，别让保存对话框报错 */
export function safeFileName(name: string): string {
  const s = name.replace(/[\\/:*?"<>|]/g, '-').trim()
  return s || '我的主题'
}

/**
 * 把草稿变成一份能直接用、也能给别人的 CSS。
 *
 * 几个刻意的选择：
 *
 * · **写 `:root`，不写 `html`。** 不咕鸟内置那份写在 `html` 上，
 *   特指度低一档，所以这份永远赢 —— 跟谁先谁后无关。
 * · **带分组注释。** 导出的文件是给人看、给人改的，
 *   一堆裸变量谁也认不出哪个管什么。
 * · **字体单独再写一条 `#write`。** 别人导入这份主题时，
 *   稿纸的字体也跟着过去。
 */
export function draftCss(d: ThemeDraft): string {
  const out: string[] = []
  out.push(`/* Theme Name: ${d.name} */`)
  out.push('/* 由不咕鸟的调色器生成。可以直接改，改完还能再导回去。 */')
  out.push('')
  out.push(':root {')
  for (const g of DRAFT_GROUPS) {
    out.push(`  /* ${g.title} */`)
    for (const f of g.fields) {
      const v = d.vars[f.name]
      if (!v) continue
      out.push(`  ${f.name}: ${v};${f.hint ? `  /* ${f.hint} */` : ''}`)
    }
    out.push('')
  }
  if (d.font) {
    out.push('  /* 正文字体 */')
    out.push(`  --font-body: ${d.font};`)
    out.push('')
  }
  out.push('}')
  if (d.font) {
    out.push('')
    out.push('#write {')
    out.push('  font-family: var(--font-body);')
    out.push('}')
  }
  out.push('')
  return out.join('\n')
}
