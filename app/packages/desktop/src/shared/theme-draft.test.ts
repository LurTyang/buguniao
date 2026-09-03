/**
 * 调色器那一层纯计算的测试。
 *
 * 这里错了的后果是「调出来的颜色跟看到的不一样」或者「导出的文件缺一块」——
 * 前者会让人反复怀疑自己眼睛，后者要等别人导入时才发现。
 * 两种都不该靠肉眼发现。
 */
import { describe, it, expect } from 'vitest'
import {
  DRAFT_FIELDS,
  DRAFT_GROUPS,
  draftCss,
  fillDraft,
  forWheel,
  hexToRgb,
  normHex,
  rgbToHex,
  safeFileName,
  seedDraft,
} from './theme-draft.js'

const DECLS = ['--bg-color:#fff', '--text-color: #222 ', '--shadow:0 1px 2px rgba(0,0,0,.1)']

describe('normHex', () => {
  it('三位补成六位', () => {
    expect(normHex('#abc')).toBe('#aabbcc')
  })
  it('不带井号也认', () => {
    expect(normHex('AABBCC')).toBe('#aabbcc')
  })
  it('前后空格不算数', () => {
    expect(normHex('  #FFF  ')).toBe('#ffffff')
  })
  it('认不出来给空串 —— 猜错的颜色比没颜色更难发现', () => {
    expect(normHex('rgba(0,0,0,.1)')).toBe('')
    expect(normHex('#12345')).toBe('')
    expect(normHex('红')).toBe('')
    expect(normHex('')).toBe('')
  })
})

describe('hex 和 rgb 来回换', () => {
  it('换过去再换回来还是它', () => {
    expect(rgbToHex(hexToRgb('#3db8bf')!)).toBe('#3db8bf')
  })
  it('认不出的给 null', () => {
    expect(hexToRgb('var(--x)')).toBe(null)
  })
  it('超出 0–255 夹回去 —— 数字框里什么都可能被打进来', () => {
    expect(rgbToHex({ r: -20, g: 300, b: 128 })).toBe('#00ff80')
  })
  it('小数四舍五入', () => {
    expect(rgbToHex({ r: 0.6, g: 1.4, b: 2.5 })).toBe('#010103')
  })
  it('NaN 当 0 —— 输入框清空的那一刻就是 NaN', () => {
    expect(rgbToHex({ r: NaN, g: 0, b: 0 })).toBe('#000000')
  })
})

describe('forWheel', () => {
  it('本来就是 hex 的原样给', () => {
    expect(forWheel('#3db8bf')).toBe('#3db8bf')
  })
  it('rgb() 换算成 hex —— 直接塞给色盘会被悄悄改成黑色', () => {
    expect(forWheel('rgb(61, 184, 191)')).toBe('#3db8bf')
    expect(forWheel('rgba(61,184,191,.5)')).toBe('#3db8bf')
  })
  it('实在认不出来给兜底值，而不是黑色', () => {
    expect(forWheel('hsl(180 50% 50%)')).toBe('#888888')
    expect(forWheel('var(--x)', '#123456')).toBe('#123456')
  })
})

describe('seedDraft', () => {
  it('把 declsOf 那种数组拆成表', () => {
    const d = seedDraft(DECLS, '我的', '楷体')
    expect(d.vars['--bg-color']).toBe('#fff')
    expect(d.vars['--text-color']).toBe('#222')
    expect(d.name).toBe('我的')
    expect(d.font).toBe('楷体')
  })

  it('值里带冒号的不能被切断 —— 阴影值里有 rgba(...)', () => {
    expect(seedDraft(DECLS, 'x', '').vars['--shadow']).toBe('0 1px 2px rgba(0,0,0,.1)')
  })
})

describe('fillDraft', () => {
  it('契约加了新变量时，老草稿补上默认值', () => {
    const old = { name: 'x', font: '', vars: { '--bg-color': '#000' } }
    const r = fillDraft(old, DECLS)
    expect(r.vars['--bg-color']).toBe('#000') // 自己调过的不许被覆盖
    expect(r.vars['--text-color']).toBe('#222') // 缺的补上
  })
})

describe('draftCss', () => {
  const d = seedDraft(
    DRAFT_FIELDS.map((f) => `${f.name}:#101010`),
    '夜航船',
    '"楷体", serif',
  )

  it('带 Theme Name —— 导入之后设置里显示的就是它', () => {
    expect(draftCss(d)).toContain('/* Theme Name: 夜航船 */')
  })

  it('【关键】写 :root 不写 html —— 内置那份在 html 上，特指度低一档', () => {
    const css = draftCss(d)
    expect(css).toContain(':root {')
    expect(css).not.toMatch(/^html\s*\{/m)
  })

  it('契约里的每一项都出现在导出的文件里', () => {
    const css = draftCss(d)
    for (const f of DRAFT_FIELDS) expect(css).toContain(f.name + ':')
  })

  it('字体跟着走，别人导入时稿纸字体也过去', () => {
    const css = draftCss(d)
    expect(css).toContain('--font-body: "楷体", serif;')
    expect(css).toContain('font-family: var(--font-body);')
  })

  it('没设字体就不写那两段，别留个空壳', () => {
    const css = draftCss({ ...d, font: '' })
    expect(css).not.toContain('--font-body')
    expect(css).not.toContain('#write {')
  })

  it('值是空的那一项跳过 —— 空的 var() 会静默退回继承值，极难查', () => {
    const css = draftCss({ name: 'x', font: '', vars: { '--bg-color': '', '--ok': '#0f0' } })
    expect(css).not.toContain('--bg-color')
    expect(css).toContain('--ok: #0f0;')
  })
})

describe('safeFileName', () => {
  it('路径里不能有的字符换成短横', () => {
    expect(safeFileName('我的/主题:1')).toBe('我的-主题-1')
  })
  it('空的给个兜底名，不然保存对话框会报错', () => {
    expect(safeFileName('   ')).toBe('我的主题')
  })
})

describe('契约本身', () => {
  it('变量名不重复 —— 重了后面那个会悄悄盖掉前面那个', () => {
    const names = DRAFT_FIELDS.map((f) => f.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('每一项都有名字和说明的位置', () => {
    for (const f of DRAFT_FIELDS) {
      expect(f.name.startsWith('--')).toBe(true)
      expect(f.label.length).toBeGreaterThan(0)
    }
  })

  it('分组没有空的', () => {
    for (const g of DRAFT_GROUPS) expect(g.fields.length).toBeGreaterThan(0)
  })

  it('阴影不给色盘 —— 它是一整串 CSS 值，不是颜色', () => {
    const shadows = DRAFT_FIELDS.filter((f) => f.name.startsWith('--shadow'))
    expect(shadows.length).toBe(2)
    for (const f of shadows) expect(f.kind).toBe('shadow')
  })
})
