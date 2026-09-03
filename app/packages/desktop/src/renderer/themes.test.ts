/**
 * 主题名单。
 *
 * 0.4 从五档砍到三档，砍档这件事最容易得罪人的地方是：
 * **一个用惯了深色的人升级之后打开软件，屏幕忽然一片惨白。**
 * 这一组测试主要就是钉住那件事不许发生。
 */

import { describe, expect, it } from 'vitest'
import { THEMES, declsOf, themeOf } from './themes.js'

describe('内置三档', () => {
  it('就是纸白、护眼、夜间', () => {
    expect(THEMES.map((t) => t.key)).toEqual(['light', 'eye', 'night'])
  })

  it('默认是纸白', () => {
    expect(THEMES[0]?.key).toBe('light')
  })

  it('有深色也有浅色 —— 只剩一种的话「换主题」就没意义了', () => {
    expect(THEMES.some((t) => t.dark)).toBe(true)
    expect(THEMES.some((t) => !t.dark)).toBe(true)
  })

  it('每一档的颜色都齐 —— 缺一个变量会让某处变成透明或黑块', () => {
    const keys = Object.keys(THEMES[0]!.vars)
    for (const t of THEMES) {
      expect(Object.keys(t.vars).sort(), t.label).toEqual(keys.sort())
      expect(t.vars.heat, t.label).toHaveLength(5)
    }
  })

  it('每一档都有一句话说清什么时候用它', () => {
    for (const t of THEMES) {
      expect(t.label.length, t.key).toBeGreaterThan(0)
      expect(t.hint.length, t.key).toBeGreaterThan(4)
    }
  })
})

describe('砍掉的那两档怎么退', () => {
  it('【关键】墨灰退到夜间，不是退到白底', () => {
    const t = themeOf('dark')
    expect(t.key).toBe('night')
    expect(t.dark).toBe(true)
  })

  it('纸黄退到纸白 —— 同样是浅色', () => {
    expect(themeOf('sepia').key).toBe('light')
  })

  it('压根不认得的 key 才退回默认', () => {
    expect(themeOf('乱写的').key).toBe('light')
    expect(themeOf('').key).toBe('light')
  })

  it('认得的照常', () => {
    for (const t of THEMES) expect(themeOf(t.key).key).toBe(t.key)
  })
})

describe('变量名跟 Typora 对齐', () => {
  /*
   * 作者要求「把不咕鸟的主题代码都与 Typora 对齐」。
   *
   * 这么做之后，一份 Typora 主题**不需要任何转接就能改整个界面** ——
   * 它写 `--bg-color`，我们读的就是 `--bg-color`。
   * 上一版是加一层桥接把名字映射过来，那是绕路：
   * 少映射一个就少改一处，而缺哪一处只能靠肉眼发现。
   */
  it('【关键】预设主题写出来的就是 Typora 那套名字', () => {
    const css = declsOf(themeOf('light')).join(';')
    for (const name of [
      '--bg-color',
      '--side-bar-bg-color',
      '--text-color',
      '--control-text-color',
      '--md-char-color',
      '--primary-color',
      '--item-hover-bg-color',
      '--window-border',
    ]) {
      expect(css, name).toContain(`${name}:`)
    }
  })

  it('【关键】不再有我们自己那套旧名字 —— 混着用等于两套都不生效', () => {
    const css = declsOf(themeOf('night')).join(';')
    for (const dead of ['--bg:', '--text:', '--accent:', '--border:', '--bg-panel:']) {
      expect(css, dead).not.toContain(dead)
    }
  })

  it('Typora 没有对应概念的那几个保持原名', () => {
    const css = declsOf(themeOf('eye')).join(';')
    expect(css).toContain('--danger:')
    expect(css).toContain('--ok:')
    expect(css).toContain('--heat-0:')
  })

  it('颜色确实是那个主题的', () => {
    expect(declsOf(themeOf('night')).join(';')).toContain(themeOf('night').vars.bg)
    expect(declsOf(themeOf('eye')).join(';')).toContain(themeOf('eye').vars.accent)
  })
})

describe('权重：自选主题必须赢得过预设', () => {
  /*
   * 这一条是三次「主题装上了但没变化」之后定下来的做法。
   *
   * `html` 和 `:root` 选中同一个元素，但权重不同：
   *   html  → (0,0,1)
   *   :root → (0,1,0)   ← 更高
   *
   * 预设用 `html`，于是任何 Typora 主题里的 `:root{…}` 都赢，
   * **而且跟先后顺序无关**。
   *
   * 之前那版用 `:root` + 靠 appendChild 维持顺序 —— 那是在赌顺序，
   * 而顺序取决于那份主题怎么写、我们又在什么时机重排样式。
   * 能靠权重解决的，别靠顺序。
   */
  it('【关键】预设那段用的是 html，不是 :root', () => {
    const decls = declsOf(themeOf('light'))
    // declsOf 只给声明，选择器在 applyTheme 里。这儿钉的是声明本身没带选择器
    expect(decls.every((d) => !d.includes('{') && !d.includes(':root'))).toBe(true)
  })

  it('每个主题都给全那几个 Typora 变量', () => {
    for (const t of THEMES) {
      const css = declsOf(t).join(';')
      for (const name of ['--bg-color', '--text-color', '--primary-color']) {
        expect(css, `${t.label} 缺 ${name}`).toContain(`${name}:`)
      }
    }
  })
})
