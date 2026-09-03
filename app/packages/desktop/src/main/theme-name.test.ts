/**
 * 自选样式叫什么、稿纸什么颜色。
 *
 * 作者要求：「给这些自定义主题取名」「导入样式后，对应的预设应该与
 * 该主题的稿纸颜色一致」。这两条都得从一份任意的 CSS 里**猜**出来 ——
 * 所以猜不到时要老实退回去，而不是瞎给一个。
 */

import { describe, expect, it } from 'vitest'
import { nameFromCss, nameFromFile, paperColorOf } from './theme-name.js'

describe('取名', () => {
  it('从文件名来，连字符变空格', () => {
    expect(nameFromFile('D:/x/phycat-mint.css')).toBe('phycat mint')
    expect(nameFromFile('night_owl.css')).toBe('night owl')
  })

  it('CSS 注释里写了名字就用它 —— 那是主题作者自己起的', () => {
    expect(nameFromCss('/* Theme Name: Phycat Mint */\nbody{}', 'x/a.css')).toBe('Phycat Mint')
    expect(nameFromCss('/* 主题名：薄荷猫 */', 'x/a.css')).toBe('薄荷猫')
  })

  it('注释里那个太长就不要 —— 它要显示在一个小色块上', () => {
    const long = '/* Theme Name: ' + 'x'.repeat(40) + ' */'
    expect(nameFromCss(long, 'x/mint.css')).toBe('mint')
  })

  it('没写就退回文件名', () => {
    expect(nameFromCss('body{}', 'x/phycat-mint.css')).toBe('phycat mint')
  })

  it('文件名也没有内容时给个兜底', () => {
    expect(nameFromFile('.css')).toBe('自选样式')
  })
})

describe('抠稿纸颜色', () => {
  it('#write 的背景最准 —— Typora 排版正文用的就是它', () => {
    expect(paperColorOf('#write { background: #eaf7ee; color: #222 }')).toBe('#eaf7ee')
  })

  it('background-color 也认', () => {
    expect(paperColorOf('#write{background-color:  rgb(240,250,244) ;}')).toBe('rgb(240,250,244)')
  })

  it('退而求其次找变量', () => {
    expect(paperColorOf(':root{--bg:#f0fff4}')).toBe('#f0fff4')
  })

  it('再退一步找 body', () => {
    expect(paperColorOf('body { background: #fafafa }')).toBe('#fafafa')
  })

  it('#write 优先于 body', () => {
    expect(paperColorOf('body{background:#fff}\n#write{background:#eaf7ee}')).toBe('#eaf7ee')
  })

  it('【关键】抠不到就返回空串 —— 瞎猜一个颜色比跟原来一样更糟', () => {
    expect(paperColorOf('.foo{color:red}')).toBe('')
    expect(paperColorOf('')).toBe('')
  })

  it('url() 和 var() 不算颜色', () => {
    expect(paperColorOf('#write{background:url(bg.png)}')).toBe('')
    expect(paperColorOf('#write{background:var(--x)}')).toBe('')
  })
})

describe('真主题的写法 —— Typora 那套变量名', () => {
  /** 一份真 Typora 主题大致长这样：变量在 :root，正文规则引用它 */
  const REAL = [
    ':root{--bg-color:#eaf7ee;--text-color:#2b3a2f;--side-bar-bg-color:#dff0e4;--primary-color:#4c7a3f}',
    'html{background:var(--bg-color)}',
    'body{background:var(--bg-color);color:var(--text-color)}',
    '#write{background:var(--bg-color);color:var(--text-color);padding:30px}',
  ].join('\n')

  it('【关键】认得 --bg-color —— Typora 主题写的是这个，不是 --bg', () => {
    expect(paperColorOf(':root{--bg-color:#eaf7ee}')).toBe('#eaf7ee')
  })

  it('【关键】#write 的背景是 var(--bg-color) 时要解开一层', () => {
    expect(paperColorOf(REAL)).toBe('#eaf7ee')
  })

  it('var() 里的兜底值也认', () => {
    expect(paperColorOf('#write{background:var(--没定义, #f0fff4)}')).toBe('#f0fff4')
  })

  it('套两层也解得开', () => {
    const css = ':root{--a:#123456;--bg-color:var(--a)}#write{background:var(--bg-color)}'
    expect(paperColorOf(css)).toBe('#123456')
  })

  it('同一个变量定义两次时以最后一次为准 —— 跟浏览器一个规矩', () => {
    expect(paperColorOf(':root{--bg-color:#111}\n:root{--bg-color:#222}')).toBe('#222')
  })

  it('解不开的（变量根本没定义、没兜底）就返回空串，不返回一串 var(...)', () => {
    expect(paperColorOf('#write{background:var(--没定义)}')).toBe('')
  })
})

describe('抠纸色时不许把后代当成自己', () => {
  it('【关键】#write 底下的规则不算纸色', () => {
    // 作者报的那个：色块是薄荷绿、稿纸却是白的。绿色来自行内代码的底色
    const css = '#write code:not(.md-fencescode){background-color:#7aeaf018}'
    expect(paperColorOf(css)).toBe('')
  })

  it('#write 自己的算', () => {
    expect(paperColorOf('#write{background:#eef}')).toBe('#eef')
  })

  it('带伪类的还算自己', () => {
    expect(paperColorOf('#write:not(.x){background:#eef}')).toBe('#eef')
  })

  it('伪元素不算 —— ::before 是铺纹理的地方，那不是纸', () => {
    expect(paperColorOf('#write::before{background-color:#3db8bf}')).toBe('')
  })

  it('逗号里有一支是 #write 自己就算', () => {
    expect(paperColorOf('.foo p, #write{background:#eef}')).toBe('#eef')
  })

  it('transparent 不是颜色 —— 摆到色块上跟没抠到一样，还更骗人', () => {
    expect(paperColorOf('body{background-color:transparent !important}')).toBe('')
  })

  it('none / inherit 同理', () => {
    expect(paperColorOf('#write{background:none}')).toBe('')
    expect(paperColorOf('body{background:inherit}')).toBe('')
  })

  it('整份 phycat 那种主题：抠不出纸色，返回空串让调用方兜底', () => {
    const css = [
      ':root{--element-color:#3db8bf;--primary-color:#3db8bf}',
      '#write{position:relative;z-index:0}',
      '#write::before{background-color:var(--element-color);opacity:.12}',
      '#write code:not(.md-fencescode){background-color:#7aeaf018}',
      'body{background-color:transparent !important}',
    ].join('')
    expect(paperColorOf(css)).toBe('')
  })
})
