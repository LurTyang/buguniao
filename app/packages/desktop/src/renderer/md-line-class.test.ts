/**
 * 行别识别的测试。
 *
 * 这一层错了的后果是「主题写了 .cm-h1 却不生效」或者更糟 ——
 * 一整段正文被当成代码。所以每一种行别都钉死，边界情况尤其钉死。
 */
import { describe, it, expect } from 'vitest'
import { lineKindOf, fenceFlags, classOf, FENCE_RE } from './md-line-class.js'

describe('lineKindOf', () => {
  it('认出六级标题', () => {
    expect(lineKindOf('# 第一章')).toBe('h1')
    expect(lineKindOf('### 三级')).toBe('h3')
    expect(lineKindOf('###### 六级')).toBe('h6')
  })

  it('七个井号不是标题 —— Markdown 只到六级', () => {
    expect(lineKindOf('####### 七级')).toBe('p')
  })

  it('井号后面没空格不是标题', () => {
    // 中文里 `#标签` 是标签语法，绝不能当成标题
    expect(lineKindOf('#标签')).toBe('p')
  })

  it('认出引用、列表、有序列表', () => {
    expect(lineKindOf('> 引一句')).toBe('quote')
    expect(lineKindOf('- 一条')).toBe('li')
    expect(lineKindOf('* 一条')).toBe('li')
    expect(lineKindOf('1. 第一')).toBe('ol')
    expect(lineKindOf('2) 第二')).toBe('ol')
  })

  it('分隔线要赢过列表 —— `---` 不是「减号加空格」', () => {
    expect(lineKindOf('---')).toBe('hr')
    expect(lineKindOf('***')).toBe('hr')
    expect(lineKindOf('___')).toBe('hr')
    // 两个减号不够
    expect(lineKindOf('--')).toBe('p')
  })

  it('缩进四格是老式代码块', () => {
    expect(lineKindOf('    const a = 1')).toBe('code')
    expect(lineKindOf('\tconst a = 1')).toBe('code')
  })

  it('全是空白的缩进行不算代码', () => {
    expect(lineKindOf('      ')).toBe(null)
  })

  it('认出表格', () => {
    expect(lineKindOf('| 甲 | 乙 |')).toBe('table')
    // 只有一根竖线的不算 —— 那可能就是正文里写了个竖线
    expect(lineKindOf('| 就一根')).toBe('p')
  })

  it('空行不给类', () => {
    expect(lineKindOf('')).toBe(null)
    expect(lineKindOf('   ')).toBe(null)
  })

  it('普通正文是 p', () => {
    expect(lineKindOf('他推开门，外头下着雨。')).toBe('p')
  })

  it('围栏里的一律算代码，长得像标题也一样', () => {
    expect(lineKindOf('# 这是注释', true)).toBe('code')
    expect(lineKindOf('随便什么', true)).toBe('code')
  })
})

describe('fenceFlags', () => {
  it('围栏那两行本身也算在里面', () => {
    expect(fenceFlags(['正文', '```js', 'code', '```', '正文'])).toEqual([
      false,
      true,
      true,
      true,
      false,
    ])
  })

  it('波浪号围栏也认', () => {
    expect(fenceFlags(['~~~', 'x', '~~~'])).toEqual([true, true, true])
  })

  it('围栏没关上时，后面全算代码 —— 跟编辑器里看到的一致', () => {
    expect(fenceFlags(['```', 'a', 'b'])).toEqual([true, true, true])
  })

  it('FENCE_RE 容忍行首空白', () => {
    expect(FENCE_RE.test('  ```')).toBe(true)
    expect(FENCE_RE.test('a```')).toBe(false)
  })
})

describe('classOf', () => {
  it('拼出类名', () => {
    expect(classOf('h1')).toBe('cm-h1')
    expect(classOf('quote')).toBe('cm-quote')
  })
  it('没类别就没类名', () => {
    expect(classOf(null)).toBe('')
  })
})
