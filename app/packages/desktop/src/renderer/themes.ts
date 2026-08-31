/**
 * 主题名单。
 *
 * 规范：更新文档/04-界面与交互设计.md §外观
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么不是「浅色 / 深色」两个开关就够】
 *
 * 写字的人一天里换的不是「白天黑夜」，是**眼睛累到什么程度**。
 * 下午刺眼要护眼绿，晚上关灯要真正的黑，睡前不想看蓝光要纸黄。
 * 两档不够用，作者报过这个。
 *
 * 五档，各有各的场合：
 *
 *   纸白  默认。像一张暖白的纸
 *   护眼  低饱和的豆沙绿。长时间看不刺激
 *   纸黄  偏黄的旧纸色。晚上看着不亮
 *   墨灰  深灰底暖白字。**不是纯黑** —— 深灰上的白字反而更好读
 *   夜间  近黑底。关了灯、只有屏幕亮着的时候用
 *
 * 每个主题的颜色**只在这一个文件里定义一次**，styles.css 里全部用变量。
 * 加一档就是往这儿加一条，不用去几千行 CSS 里翻。
 * ─────────────────────────────────────────────────────────────
 *
 * 【Typora 主题】
 *
 * 上面五档管的是「界面 + 稿纸」。作者还可以另外挑一个 `.css` 文件，
 * Typora 的主题可以直接用 —— 它们排版正文用的是 `#write`，
 * 而稿纸容器正好顶着这个 id。见 `applyThemeCss()`。
 */

/** 一个主题要定的那些颜色。跟 styles.css 里的 CSS 变量一一对应 */
export interface ThemeVars {
  bg: string
  bgPanel: string
  bgRaised: string
  border: string
  text: string
  textDim: string
  textFaint: string
  accent: string
  accentSoft: string
  danger: string
  ok: string
  shadow: string
  shadowFloat: string
  /** 热力图的五档 + 图表的两色。深色主题要另选一组，不能把浅色那组反过来 */
  heat: [string, string, string, string, string]
  chartGrid: string
  chartInk: string
}

export interface Theme {
  key: string
  label: string
  /** 一句话说清楚什么时候用它 */
  hint: string
  /** 深色系。界面上有几处要据此换图标/滚动条配色 */
  dark: boolean
  vars: ThemeVars
}

export const THEMES: Theme[] = [
  {
    key: 'light',
    label: '纸白',
    hint: '暖白，像一张纸。不用纯白，长时间看不刺眼',
    dark: false,
    vars: {
      bg: '#faf9f7',
      bgPanel: '#f2f0ec',
      bgRaised: '#ffffff',
      border: '#e2ded6',
      text: '#2a2724',
      textDim: '#7d766c',
      textFaint: '#a9a196',
      accent: '#8a6d3b',
      accentSoft: '#e8dcc4',
      danger: '#a4453a',
      ok: '#4a7c59',
      shadow: '0 2px 12px rgba(60, 50, 35, 0.08)',
      shadowFloat: '0 6px 24px rgba(60, 50, 35, 0.16)',
      heat: ['#d5d2cd', '#c2a272', '#a27a37', '#7c5505', '#523600'],
      chartGrid: '#e2ded6',
      chartInk: '#a9a196',
    },
  },
  {
    key: 'eye',
    label: '护眼',
    hint: '豆沙绿。下午光线足、眼睛发酸的时候换这个',
    dark: false,
    vars: {
      // 传统的「豆沙绿」是 #c7edcc，那个饱和度当底色看久了会腻。
      // 往灰里压过，只留一点绿意 —— 要的是不刺眼，不是绿
      bg: '#dfe9db',
      bgPanel: '#d4e0cf',
      bgRaised: '#e9f1e6',
      border: '#bccbb6',
      text: '#22301f',
      textDim: '#5d6b58',
      textFaint: '#8b9786',
      accent: '#4c7a3f',
      accentSoft: '#c3d8bb',
      danger: '#9d4034',
      ok: '#3d7a4e',
      shadow: '0 2px 12px rgba(40, 60, 35, 0.10)',
      shadowFloat: '0 6px 24px rgba(40, 60, 35, 0.18)',
      heat: ['#c6d2c1', '#a8c39a', '#7fa96d', '#548a41', '#2f6420'],
      chartGrid: '#bccbb6',
      chartInk: '#8b9786',
    },
  },
  {
    key: 'sepia',
    label: '纸黄',
    hint: '偏黄的旧纸色。晚上开着灯看，比白底柔和',
    dark: false,
    vars: {
      bg: '#f4ecd8',
      bgPanel: '#ece2ca',
      bgRaised: '#fbf5e6',
      border: '#ddd0b2',
      text: '#3a3021',
      textDim: '#7a6b52',
      textFaint: '#a89b7d',
      accent: '#96682a',
      accentSoft: '#e5d3ab',
      danger: '#a04a2f',
      ok: '#5a7a3f',
      shadow: '0 2px 12px rgba(80, 60, 25, 0.10)',
      shadowFloat: '0 6px 24px rgba(80, 60, 25, 0.18)',
      heat: ['#ded2b6', '#cfae74', '#b3873c', '#8a6009', '#5c3d00'],
      chartGrid: '#ddd0b2',
      chartInk: '#a89b7d',
    },
  },
  {
    key: 'dark',
    label: '墨灰',
    hint: '深灰底、暖白字。**不是纯黑** —— 深灰上的字反而更好读',
    dark: true,
    vars: {
      bg: '#22201d',
      bgPanel: '#2b2825',
      bgRaised: '#322e2a',
      border: '#423d37',
      text: '#e8e3da',
      textDim: '#a49c90',
      textFaint: '#756d62',
      accent: '#c8a86b',
      accentSoft: '#4a4235',
      danger: '#c96b5e',
      ok: '#7aab86',
      shadow: '0 2px 12px rgba(0, 0, 0, 0.3)',
      shadowFloat: '0 6px 24px rgba(0, 0, 0, 0.45)',
      heat: ['#44403b', '#7c5d2b', '#a68043', '#d0a664', '#f7cf92'],
      chartGrid: '#3c372f',
      chartInk: '#756d62',
    },
  },
  {
    key: 'night',
    label: '夜间',
    hint: '近黑。关了灯只有屏幕亮着的时候用',
    dark: true,
    vars: {
      // 底色 #0d0d0e 而不是 #000：纯黑配纯白对比度太硬，盯久了字会发糊。
      // 字也压到 #cfcfd2，不用纯白 —— 同样的理由
      bg: '#0d0d0e',
      bgPanel: '#151517',
      bgRaised: '#1c1c1f',
      border: '#2b2b30',
      text: '#cfcfd2',
      textDim: '#8b8b93',
      textFaint: '#5e5e66',
      accent: '#9db4d8',
      accentSoft: '#25303f',
      danger: '#d1706a',
      ok: '#6fae87',
      shadow: '0 2px 12px rgba(0, 0, 0, 0.6)',
      shadowFloat: '0 6px 24px rgba(0, 0, 0, 0.75)',
      heat: ['#26262a', '#33506e', '#3f7196', '#5195bd', '#7fbde0'],
      chartGrid: '#2b2b30',
      chartInk: '#5e5e66',
    },
  },
]

const BY_KEY = new Map(THEMES.map((t) => [t.key, t]))

/** 认不出来的 key 退回纸白 —— 配置文件手改坏了不该让界面变成一片白纸黑字 */
export function themeOf(key: string): Theme {
  return BY_KEY.get(key) ?? THEMES[0]!
}

/** 把一个主题写进 CSS 变量 */
export function applyTheme(key: string): void {
  const t = themeOf(key)
  const root = document.documentElement
  const set = (name: string, value: string) => root.style.setProperty(name, value)

  // data-theme 留着：少数几处样式（滚动条、代码块）按深浅分，不按具体主题分
  root.setAttribute('data-theme', t.dark ? 'dark' : 'light')
  root.setAttribute('data-theme-key', t.key)

  const v = t.vars
  set('--bg', v.bg)
  set('--bg-panel', v.bgPanel)
  set('--bg-raised', v.bgRaised)
  set('--border', v.border)
  set('--text', v.text)
  set('--text-dim', v.textDim)
  set('--text-faint', v.textFaint)
  set('--accent', v.accent)
  set('--accent-soft', v.accentSoft)
  set('--danger', v.danger)
  set('--ok', v.ok)
  set('--shadow', v.shadow)
  set('--shadow-float', v.shadowFloat)
  v.heat.forEach((c, i) => set(`--heat-${i}`, c))
  set('--chart-grid', v.chartGrid)
  set('--chart-ink', v.chartInk)
}

/** 自定义 CSS 注进去的那个 style 标签的 id。只留一个，换文件就整个换掉 */
const CUSTOM_STYLE_ID = 'bugu-custom-theme'

/**
 * 装上（或卸掉）作者自己挑的那份 CSS。
 *
 * **整份原样注进去，不做任何改写。** 想改写就得猜它在干什么，
 * 而每份 Typora 主题的写法都不一样 —— 猜错一次，作者看到的是一团乱，
 * 还找不出是谁弄的。原样注进去，至少「哪儿变了」是能对着 CSS 看出来的。
 *
 * 作用范围靠 `#write`：稿纸容器顶着这个 id，Typora 主题的正文规则
 * 正好落在上面。它们里头那些 `body{}`、`#typora-source` 之类的规则
 * 也会生效，但界面本身的颜色是 CSS 变量控制的，被覆盖不了 —— 这是有意的。
 */
export function applyThemeCss(css: string): void {
  const old = document.getElementById(CUSTOM_STYLE_ID)
  if (!css.trim()) {
    old?.remove()
    return
  }
  const el = old ?? document.createElement('style')
  el.id = CUSTOM_STYLE_ID
  el.textContent = css
  if (!old) document.head.appendChild(el)
}
