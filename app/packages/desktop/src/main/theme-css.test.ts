/**
 * 自选主题 CSS 的解析。
 *
 * 作者报的那个 bug 就在这一层：`phycat-mint.css` 整份内容都在
 * `@import url(./phycat/phycat.light.css)` 里，而内联 `<style>` 的相对路径
 * 是相对**页面**解析的 —— 于是它去应用自己的目录里找，找不到，
 * **静默失败**，页面上一点变化都没有。
 *
 * 这一层的错全是「路径解析」，而路径解析错了不报错，只是没效果。
 */

import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  absolutizeUrls,
  guardBody,
  bridgeMarkdownRules,
  bridgeSelector,
  resolveThemeCss,
} from './theme-css.js'

const D = path.resolve('/主题')
const at = (...p: string[]) => path.resolve(D, ...p)

/** 一份假的磁盘 */
function disk(files: Record<string, string>) {
  return async (f: string) => {
    const hit = files[path.resolve(f)]
    if (hit === undefined) throw new Error('ENOENT')
    return hit
  }
}

describe('@import 要真的展开', () => {
  it('【关键】把被 import 的内容读进来 —— 这正是 phycat 那份的形状', async () => {
    const r = await resolveThemeCss(
      at('mint.css'),
      disk({
        [at('mint.css')]: '@import url(./phycat/light.css);\n:root{--x:1}',
        [at('phycat/light.css')]: '#write{font-size:18px}',
      }),
    )
    expect(r.css).toContain('#write{font-size:18px}')
    expect(r.css).toContain('--x:1')
    expect(r.css).not.toContain('@import')
    expect(r.problems).toEqual([])
  })

  it('引号、无 url() 的写法都认', async () => {
    const files = {
      [at('a.css')]: `@import "./b.css";`,
      [at('b.css')]: 'p{color:red}',
    }
    expect((await resolveThemeCss(at('a.css'), disk(files))).css).toContain('color:red')

    const files2 = {
      [at('a.css')]: `@import url('./b.css');`,
      [at('b.css')]: 'p{color:red}',
    }
    expect((await resolveThemeCss(at('a.css'), disk(files2))).css).toContain('color:red')
  })

  it('套几层都跟得下去', async () => {
    const r = await resolveThemeCss(
      at('a.css'),
      disk({
        [at('a.css')]: '@import url(./b.css);',
        [at('b.css')]: '@import url(./c/d.css);',
        [at('c/d.css')]: '.deep{color:blue}',
      }),
    )
    expect(r.css).toContain('.deep{color:blue}')
  })

  it('【关键】被 import 的文件不在时要明说 —— 静默失败是最难查的坏法', async () => {
    const r = await resolveThemeCss(
      at('mint.css'),
      disk({ [at('mint.css')]: '@import url(./phycat/light.css);' }),
    )
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]).toContain('light.css')
    expect(r.problems[0]).toContain('缺了就没效果')
  })

  it('循环引用不会转死', async () => {
    const r = await resolveThemeCss(
      at('a.css'),
      disk({
        [at('a.css')]: '@import url(./b.css);.a{}',
        [at('b.css')]: '@import url(./a.css);.b{}',
      }),
    )
    expect(r.css).toContain('.a{}')
    expect(r.css).toContain('.b{}')
  })

  it('联网的 @import 跳过，并说一声 —— 主题不该偷偷发请求', async () => {
    const r = await resolveThemeCss(
      at('a.css'),
      disk({ [at('a.css')]: '@import url(https://fonts.example/x.css);.a{}' }),
    )
    expect(r.css).not.toContain('https://fonts.example')
    expect(r.problems[0]).toContain('联网')
  })

  it('入口文件本身就不存在', async () => {
    const r = await resolveThemeCss(at('nope.css'), disk({}))
    expect(r.problems[0]).toContain('nope.css')
  })
})

describe('相对路径的 url() 要绝对化', () => {
  it('图片路径改写成 file://', () => {
    const out = absolutizeUrls('.a{background:url(./img/bg.png)}', D)
    expect(out).toContain('file:///')
    expect(out).toContain('bg.png')
    expect(out).not.toContain('url(./img')
  })

  it('【关键】data: 不许动 —— 主题里的图标基本都是 data:，动了就全废了', () => {
    const css = ".a{background:url('data:image/svg+xml;utf8,<svg/>')}"
    expect(absolutizeUrls(css, D)).toBe(css)
  })

  it('http(s) 不动', () => {
    const css = '.a{background:url(https://x.test/a.png)}'
    expect(absolutizeUrls(css, D)).toBe(css)
  })

  it('引号原样保留', () => {
    expect(absolutizeUrls('.a{src:url("./f.woff2")}', D)).toContain('"file:///')
  })

  it('被 import 进来的那份，路径按它自己的位置算', async () => {
    const r = await resolveThemeCss(
      at('a.css'),
      disk({
        [at('a.css')]: '@import url(./sub/b.css);',
        [at('sub/b.css')]: '.b{background:url(./bg.png)}',
      }),
    )
    // 是 sub/bg.png，不是 主题/bg.png
    expect(r.css.split(String.fromCharCode(92)).join('/')).toContain('sub/bg.png')
  })
})

describe('一份真 Typora 主题装进来之后', () => {
  /*
   * 0.4 把不咕鸟的变量名整套对齐到了 Typora（作者要求）。
   * 对齐之后**不需要任何转接**：主题写 --bg-color，我们读的就是 --bg-color。
   *
   * 这一组钉的是「装进来的东西确实带着那些名字」——
   * 名字对不上时界面一点变化都没有，而那是最难自查的一种坏法。
   */
  const THEME = [
    ':root{--bg-color:#eaf7ee;--text-color:#2b3a2f;--side-bar-bg-color:#dff0e4;--primary-color:#4c7a3f}',
    '#write{background:var(--bg-color);color:var(--text-color)}',
  ].join('\n')

  it('两文件结构：入口只有一行 @import，正文全在被引的那份里', async () => {
    const r = await resolveThemeCss(
      at('mint.css'),
      disk({
        [at('mint.css')]: '@import url(./phycat/light.css);',
        [at('phycat/light.css')]: THEME,
      }),
    )
    expect(r.problems).toEqual([])
    expect(r.css).toContain('--bg-color:#eaf7ee')
    expect(r.css).toContain('#write{background:var(--bg-color)')
  })

  it('【关键】装进来的是 Typora 那套名字 —— 我们读的就是这几个', async () => {
    const r = await resolveThemeCss(
      at('a.css'),
      disk({ [at('a.css')]: THEME }),
    )
    for (const name of ['--bg-color', '--text-color', '--side-bar-bg-color', '--primary-color']) {
      expect(r.css, name).toContain(name)
    }
  })
})

/* ─── 选择器桥接 ─────────────────────────────────────────── */

describe('bridgeSelector', () => {
  it('把 #write 底下的元素翻成行类', () => {
    expect(bridgeSelector('#write h1')).toBe('#write .cm-h1')
    expect(bridgeSelector('#write blockquote')).toBe('#write .cm-quote')
    expect(bridgeSelector('#write p')).toBe('#write .cm-p')
    expect(bridgeSelector('#write pre')).toBe('#write .cm-code')
  })

  it('pre 不会被当成 p —— 顺序是有意排的', () => {
    expect(bridgeSelector('#write pre')).not.toContain('.cm-pre')
  })

  it('子代组合器放宽成后代，不然中间隔着三层永远不匹配', () => {
    expect(bridgeSelector('#write > h1')).toBe('#write .cm-h1')
  })

  it('伪元素和伪类跟着一起过来', () => {
    expect(bridgeSelector('#write h2::before')).toBe('#write .cm-h2::before')
    expect(bridgeSelector('#write li:hover')).toBe('#write .cm-li:hover')
  })

  it('逗号分支分别翻，翻不动的那支丢掉', () => {
    expect(bridgeSelector('#write h1, .sidebar h1, #write h2')).toBe('#write .cm-h1, #write .cm-h2')
  })

  it('不在 #write 底下的一概不碰 —— 那多半是它自己的界面', () => {
    expect(bridgeSelector('h1')).toBe('')
    expect(bridgeSelector('.file-list li')).toBe('')
  })

  it('#write 里没有元素可翻时不产出', () => {
    expect(bridgeSelector('#write')).toBe('')
    expect(bridgeSelector('#write .md-image')).toBe('')
  })

  it('不会把类名、id 里的字母当成元素', () => {
    expect(bridgeSelector('#write .prose')).toBe('')
    expect(bridgeSelector('#write #preview')).toBe('')
    expect(bridgeSelector('#write .table-wrap')).toBe('')
  })
})

describe('Typora 的内部标记类', () => {
  it('删掉 .md-heading —— 我们的行上没有它，留着这条就白翻了', () => {
    expect(bridgeSelector('#write h3.md-heading:after')).toBe('#write .cm-h3:after')
  })

  it('.md-end-block、.md-p 一并删', () => {
    expect(bridgeSelector('#write p.md-end-block')).toBe('#write .cm-p')
  })

  it('.md-fences 翻成 .cm-code —— 它就是代码块', () => {
    expect(bridgeSelector('#write .md-fences')).toBe('#write .cm-code')
  })

  it('表示状态的类不删 —— 删了样式会一直挂着，比不生效更糟', () => {
    expect(bridgeSelector('#write h1.md-focus')).toBe('#write .cm-h1.md-focus')
  })

  it('不会误删名字更长的类', () => {
    expect(bridgeSelector('#write h1.md-heading-x')).toBe('#write .cm-h1.md-heading-x')
  })
})

describe('不让主题把整行拽出文档流', () => {
  it('摘掉 position:absolute —— 行一飘，光标就跟着乱', () => {
    expect(guardBody('color:red;position:absolute;font-size:2em', false)).toBe(
      'color:red;font-size:2em',
    )
  })

  it('fixed 也摘，!important 也摘', () => {
    expect(guardBody('position: fixed !important; color:red', false)).toBe(' color:red')
  })

  it('relative 留着 —— 它不脱流，而且装饰全靠它定位', () => {
    expect(guardBody('position:relative;color:red', false)).toBe('position:relative;color:red')
  })

  it('float 摘掉', () => {
    expect(guardBody('float:left;color:red', false)).toBe('color:red')
  })

  it('伪元素上的一概不动 —— 摘了装饰就散架', () => {
    const b = 'content:" ";position:absolute;left:0'
    expect(guardBody(b, true)).toBe(b)
  })

  it('不会误伤名字里带 position 的属性', () => {
    const b = 'background-position:center;mask-position:center'
    expect(guardBody(b, false)).toBe(b)
  })

  it('整条链走下来：::after 上的 absolute 活着，行上的没了', () => {
    const r = bridgeMarkdownRules(
      '#write h1{position:absolute;color:red}#write h1::after{position:absolute}',
    )
    expect(r.css).toContain('#write .cm-h1{color:red}')
    expect(r.css).toContain('#write .cm-h1::after{position:absolute}')
  })
})

describe('bridgeMarkdownRules', () => {
  it('原样保留声明，只换选择器', () => {
    const r = bridgeMarkdownRules('#write h1 { font-size: 2em; color: red }')
    expect(r.css).toContain('#write .cm-h1{ font-size: 2em; color: red }')
    expect(r.count).toBe(1)
  })

  it('钻进 @media 里翻，但不产出空壳子', () => {
    const r = bridgeMarkdownRules('@media print{#write h1{color:red}}@media screen{.x{color:blue}}')
    expect(r.css).toContain('@media print{')
    expect(r.css).toContain('#write .cm-h1{color:red}')
    expect(r.css).not.toContain('@media screen')
  })

  it('@font-face、@keyframes 不动', () => {
    const r = bridgeMarkdownRules('@font-face{font-family:x;src:url(a.ttf)}')
    expect(r.count).toBe(0)
    expect(r.css).toBe('')
  })

  it('一条都翻不出来时给空串，不留那行注释', () => {
    expect(bridgeMarkdownRules('body{color:red}').css).toBe('')
  })

  it('注释和字符串里的花括号不会把扫描带偏', () => {
    const r = bridgeMarkdownRules('/* } 假的 */ #write h1{content:"}"} #write h2{color:red}')
    expect(r.count).toBe(2)
    expect(r.css).toContain('#write .cm-h2{color:red}')
  })
})

describe('resolveThemeCss 会把翻译追加在后面', () => {
  it('翻出来的排在原文之后 —— 同权重比顺序，后来者赢', async () => {
    const r = await resolveThemeCss(
      at('a.css'),
      disk({ [at('a.css')]: '#write h1{font-size:3em}' }),
    )
    expect(r.bridged).toBe(1)
    expect(r.css.indexOf('.cm-h1')).toBeGreaterThan(r.css.indexOf('#write h1'))
  })

  it('纯调色的主题翻不出东西，bridged 是 0', async () => {
    const r = await resolveThemeCss(at('a.css'), disk({ [at('a.css')]: ':root{--bg-color:#fff}' }))
    expect(r.bridged).toBe(0)
  })
})
