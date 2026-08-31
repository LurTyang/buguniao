/**
 * 哪些行顶格、哪些行缩两格。
 *
 * 正文缩两格是靠 CSS 的 `text-indent`（文件里不存全角空格，见 05 §2）；
 * 这条正则决定哪些行**不**吃那个缩进。
 *
 * 它值得被钉住的理由：错了不会报任何错，只是某一类标记看着「怎么跟正文一样缩着」，
 * 或者反过来「这段正文怎么不缩进了」—— 两种都只能靠人眼在一屏字里发现。
 * 作者报上来的正是前一种：`#` 和 `<` 顶着格，`@` 却缩着。
 */

import { describe, expect, it } from 'vitest'
import { NO_INDENT_RE } from './components/Editor.js'

const flush = (line: string) => NO_INDENT_RE.test(line)

describe('标记行顶格', () => {
  it('标题', () => {
    for (const l of ['# 第一章', '## 一', '###### 六级']) expect(flush(l), l).toBe(true)
  })

  it('引用、列表、有序列表', () => {
    for (const l of ['> 引一句', '- 一条', '* 一条', '+ 一条', '1. 一条']) {
      expect(flush(l), l).toBe(true)
    }
  })

  it('分隔线与代码围栏', () => {
    for (const l of ['---', '----', '```', '```js', '~~~']) expect(flush(l), l).toBe(true)
  })

  it('【关键】行首 @ —— 整行浮到稿纸上的那个标记', () => {
    for (const l of ['@这句话浮出来', '@ 带个空格也算', '@李四的卡']) {
      expect(flush(l), l).toBe(true)
    }
  })

  it('【关键】伏笔锚点', () => {
    for (const l of ['<!--埋#yupei-->', '<!--/收#yupei-->']) expect(flush(l), l).toBe(true)
  })

  it('前面有空格也认 —— 缩进过的标记还是标记', () => {
    expect(flush('  # 标题')).toBe(true)
    expect(flush('  @浮出')).toBe(true)
  })
})

describe('正文照旧缩两格', () => {
  it('普通叙述、台词、动作一概不顶格', () => {
    for (const l of [
      '他站在窗前。',
      '李四：你是新来的？',
      '（长久的沉默。）',
      '这句话里有个 @ 但不在行首',
      '第一章还没写完',
      '看 [[玉佩]] 那张卡',
    ]) {
      expect(flush(l), l).toBe(false)
    }
  })

  it('空行不算标记', () => {
    expect(flush('')).toBe(false)
  })

  it('# 后面不跟空格的不算标题 —— 那是 tag 之类的写法', () => {
    expect(flush('#不是标题')).toBe(false)
  })
})
