/**
 * 主题名单。
 *
 * 规范：更新文档/04-界面与交互设计.md §外观
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么不是「浅色 / 深色」两个开关就够】
 *
 * 写字的人一天里换的不是「白天黑夜」，是**眼睛累到什么程度**。
 * 下午刺眼要护眼绿，晚上关灯要真正的黑。两档不够用，作者报过这个。
 *
 * **内置只留三档**（0.4 从五档砍下来的，作者定：「默认主题保留三个就好，
 * 大多让用户自定吧」）：
 *
 *   纸白  默认。像一张暖白的纸
 *   护眼  低饱和的豆沙绿。长时间看不刺激
 *   夜间  近黑底。关了灯、只有屏幕亮着的时候用
 *
 * 砍掉的纸黄和墨灰**是直接删的，没有挪进「更多」里** ——
 * 留一个半藏起来的选项，等于既没减少选择困难，又多一份要维护的配色。
 * 想要那两种的人用下面的自选 CSS 能做得更合自己的意。
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

/**
 * 0.4 砍掉的那两档，各自退到哪儿去。
 *
 * **不能一律退回默认的纸白。** 一个用惯了墨灰的人升级之后打开软件，
 * 屏幕忽然一片惨白 —— 那是这次砍档最容易得罪人的地方，
 * 而它只需要这两行就能避免。
 *
 *   墨灰（深灰底）→ 夜间：同样是深色，最接近
 *   纸黄（旧纸色）→ 纸白：同样是浅色
 */
const RETIRED: Record<string, string> = {
  dark: 'night',
  sepia: 'light',
}

/**
 * 按 key 找主题。
 *
 * 认不出来的退回纸白 —— 配置文件手改坏了不该让界面变成一片白纸黑字。
 * 已经砍掉的那两档先按上面那张表换成最接近的。
 */
export function themeOf(key: string): Theme {
  const hit = BY_KEY.get(key)
  if (hit) return hit
  const moved = RETIRED[key]
  return (moved ? BY_KEY.get(moved) : undefined) ?? THEMES[0]!
}

/** 预设主题写进去的那个 style 标签。**必须排在自选样式前面** */
const THEME_STYLE_ID = 'bugu-theme-vars'

/** 自定义 CSS 注进去的那个 style 标签的 id。只留一个，换文件就整个换掉 */
const CUSTOM_STYLE_ID = 'bugu-custom-theme'

/**
 * 保证三段样式的先后顺序。
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么需要专门维持它】
 *
 * 顺序必须是：
 *
 *   styles.css（兜底）→ 预设主题的变量 → 自选样式
 *
 * 三段都是 `:root`、同样的权重，**谁在后面谁生效**。顺序错一处，
 * 自选主题就等于没装。
 *
 * 麻烦在于 `appendChild` 对一个**已经在文档里**的元素是「移到末尾」，
 * 不是「什么都不做」。而 `applySettings()` 每改一个设置就会调一次
 * `applyTheme()` —— 于是改一下字号，预设那段就跳到自选样式后面，
 * 把主题盖了回去。
 *
 * 作者报的「选了自选样式但没变」正是这个：**刚选完是对的，
 * 界面一动就变回去了**，所以看起来像压根没生效；而重启之后
 * 顺序恰好是对的，又好了。
 *
 * 所以每次动过之后都把自选样式重新挪到最后。**自愈**，
 * 不依赖调用方按什么顺序调。
 * ─────────────────────────────────────────────────────────────
 */
/** 字体变量那份样式的 id */
const FONT_STYLE_ID = 'bugu-font-var'

function keepOrder(): void {
  const custom = document.getElementById(CUSTOM_STYLE_ID)
  if (custom) document.head.appendChild(custom)
}

/** 一个主题要写进 CSS 的那些变量 */
export function declsOf(t: Theme): string[] {
  const v = t.vars
  return [
    `--bg-color:${v.bg}`,
    `--side-bar-bg-color:${v.bgPanel}`,
    `--bg-raised:${v.bgRaised}`,
    `--window-border:${v.border}`,
    `--text-color:${v.text}`,
    `--control-text-color:${v.textDim}`,
    `--md-char-color:${v.textFaint}`,
    `--primary-color:${v.accent}`,
    `--item-hover-bg-color:${v.accentSoft}`,
    /*
     * 下面四个没有自己的调色，是从上面派生的。
     *
     * 留着它们不是多余：Typora 主题**经常单独写这几个**，
     * 写了就压过我们这份派生值，稿纸和目录树跟着一起变 ——
     * 这正是「对齐 Typora 命名」要换来的东西。
     */
    `--select-text-bg-color:${v.accentSoft}`,
    `--active-file-bg-color:${v.accentSoft}`,
    `--active-file-text-color:${v.text}`,
    `--code-block-bg-color:${v.bgRaised}`,
    `--danger:${v.danger}`,
    `--ok:${v.ok}`,
    `--shadow:${v.shadow}`,
    `--shadow-float:${v.shadowFloat}`,
    ...v.heat.map((c, i) => `--heat-${i}:${c}`),
    `--chart-grid:${v.chartGrid}`,
    `--chart-ink:${v.chartInk}`,
  ]
}

/**
 * 把一个主题写进页面。
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么是 `<style>`，不是行内样式】
 *
 * 原来是 `documentElement.style.setProperty('--bg', …)` —— 写成**行内样式**。
 * 而行内样式压过任何样式表：于是自选主题里的 `:root { --bg-color: … }`
 * **永远赢不了**，无论它写得多具体。
 *
 * 作者报的「更换主题后，仅仅更换了一些细节（如滑动条），并没有更换稿纸颜色」
 * 就是这么来的 —— 那份 Typora 主题里凡是想改我们变量的规则全被挡住了，
 * 只有不碰变量的（滚动条之类）漏了过去。
 *
 * 改成往 `<head>` **末尾**插一段 `:root{…}`（在 styles.css 之后），
 * 自选样式再排在它后面。同样是 `:root`、同样的权重 —— 后来者胜，
 * 于是自选主题真的能改稿纸颜色了。
 * ─────────────────────────────────────────────────────────────
 */
export function applyTheme(key: string): void {
  const t = themeOf(key)
  const root = document.documentElement

  // data-theme 留着：少数几处样式（滚动条、代码块）按深浅分，不按具体主题分
  root.setAttribute('data-theme', t.dark ? 'dark' : 'light')
  root.setAttribute('data-theme-key', t.key)

  const decls = declsOf(t)

  /*
   * 从行内样式搬过来时，**旧的那些必须清掉**。
   * 不清的话它们还是行内的、还是压着新的这份，等于什么都没改 ——
   * 升级上来的人会看到「换了主题没反应」。
   */
  for (const d of decls) root.style.removeProperty(d.slice(0, d.indexOf(':')))

  let el = document.getElementById(THEME_STYLE_ID)
  if (!el) {
    el = document.createElement('style')
    el.id = THEME_STYLE_ID
  }
  /*
   * ⚠️ 选择器是 `html`，**不是 `:root`**。这一个字决定了整个功能成不成立。
   *
   * `html` 和 `:root` 选中的是同一个元素，但权重不同：
   *   `html`  是类型选择器      → (0,0,1)
   *   `:root` 是伪类           → (0,1,0)  ← 更高
   *
   * 所以只要我们这份用 `html`，**任何 Typora 主题里的 `:root{--bg-color:…}`
   * 都会赢**，而且跟先后顺序无关。
   *
   * 上一版用的是 `:root` + 靠 appendChild 维持顺序 —— 那是在赌
   * 「顺序一定对」。而顺序对不对取决于那份主题用什么选择器、
   * 我们又在什么时机重排样式，赌错了的表现是「主题只有滚动条生效」。
   * 作者连着报了三次都是这个。
   *
   * 权重是结构性的，顺序是时序性的。**能靠权重解决的，别靠顺序。**
   */
  el.textContent = `html{${decls.join(';')}}`
  document.head.appendChild(el)
  // ⚠️ 见 keepOrder 的注释 —— 这一句不能省
  keepOrder()
}



/**
 * 装上（或卸掉）作者自己挑的那份 CSS。
 *
 * **整份原样注进去，不做任何改写。** 想改写就得猜它在干什么，
 * 而每份 Typora 主题的写法都不一样 —— 猜错一次，作者看到的是一团乱，
 * 还找不出是谁弄的。
 *
 * 页面里三段样式的顺序是有讲究的，**换了顺序就等于这个功能没做**：
 *
 *   1. 预设主题的变量（`bugu-theme-vars`，插在 head 最前）
 *   2. 自选样式本身（原样）
 *   3. Typora 变量名的桥接（读 2 定义的东西，退回 1 的值）
 *
 * 作用范围靠 `#write`：稿纸容器顶着这个 id，Typora 主题的正文规则
 * 正好落在上面。
 */
/**
 * 正文字体也走 `html{}` 这条路，**不再是行内样式**。
 *
 * 为什么要挪：行内样式压过一切，主题里写 `--font-body` 永远没用 ——
 * 而字体是一套主题的半条命，导出的主题带着它、别人导入却不生效，
 * 那份文件就是残的。
 *
 * 字号、行距、页宽那几项**留在行内**，这是有意的分界：
 * 字体是「这套主题长什么样」，字号行距是「这台机器上这双眼睛要多大」。
 * 后者不该被一份主题改掉。
 */
export function applyFontVar(stack: string): void {
  document.documentElement.style.removeProperty('--font-body')
  let el = document.getElementById(FONT_STYLE_ID)
  if (!el) {
    el = document.createElement('style')
    el.id = FONT_STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = `html{--font-body:${stack}}`
  keepOrder()
}

export function applyThemeCss(css: string): void {
  const old = document.getElementById(CUSTOM_STYLE_ID)
  if (!css.trim()) {
    old?.remove()
    return
  }
  const el = old ?? document.createElement('style')
  el.id = CUSTOM_STYLE_ID
  el.textContent = css
  // 每次都挪到最后：它跟预设主题那份都是 `:root`，同权重、后来者胜
  document.head.appendChild(el)
}

/**
 * 装上自选样式之后，它到底改动了哪几个颜色。
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么要有这个】
 *
 * 「装上了但没变化」是这功能唯一一种坏法，而且**从界面上完全看不出
 * 是哪一环出的问题**：可能是文件没读到、可能是变量名对不上、
 * 可能是被权重压住了、也可能这份主题本来就只改了别的地方。
 *
 * 作者连着报了三次「还是没变」，我每次都只能靠猜 —— 那是因为
 * 这功能没有任何自述能力。
 *
 * 所以直接拿**浏览器算完之后的值**跟预设比：不一样的就是它改动了的。
 * 这不是推断，是事实。
 * ─────────────────────────────────────────────────────────────
 */
export function whatTookEffect(preset: Theme): { changed: string[]; total: number } {
  const pairs: Array<[string, string]> = [
    ['--bg-color', preset.vars.bg],
    ['--text-color', preset.vars.text],
    ['--side-bar-bg-color', preset.vars.bgPanel],
    ['--primary-color', preset.vars.accent],
    ['--window-border', preset.vars.border],
    ['--control-text-color', preset.vars.textDim],
  ]
  const now = getComputedStyle(document.documentElement)
  const norm = (v: string): string => v.trim().toLowerCase().replace(/\s+/g, '')
  const changed: string[] = []
  for (const [name, presetValue] of pairs) {
    const got = now.getPropertyValue(name)
    if (got && norm(got) !== norm(presetValue)) changed.push(name)
  }
  return { changed, total: pairs.length }
}
