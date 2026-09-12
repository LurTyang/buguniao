/**
 * 从目录树拖一篇文档出来时，通道里到底放了什么。
 *
 * 这一组钉的都是「界面上完全看不出来」的那种坏法：
 *
 *   · 多放一个 `text/plain` → 章节路径被当成正文插进作者的稿子
 *   · `effectAllowed` 少写一半 → 拖到虚线框上松手**毫无反应**
 *   · 卷（目录）冒充文档 → 右半边拿目录去读盘，报「这一篇打不开」
 *
 * 三条都不报错，所以三条都得有测试钉着。
 */

import { describe, expect, it } from 'vitest'
import {
  DOC_DRAG_TYPE,
  ROW_DRAG_TYPE,
  docPathOf,
  isDocDrag,
  splitDropKind,
  splitDropPath,
  startDocDrag,
  startRowDrag,
  type DragLike,
} from './doc-drag.js'
import { startStickyDrag } from './sticky-drag.js'

/** 一个够用的假 DataTransfer */
function fakeDrag(initial: Record<string, string> = {}): DragLike & {
  data: Record<string, string>
} {
  const data: Record<string, string> = { ...initial }
  return {
    data,
    dataTransfer: {
      get types() {
        return Object.keys(data)
      },
      setData(type: string, value: string) {
        data[type] = value
      },
      getData(type: string) {
        return data[type] ?? ''
      },
      effectAllowed: 'none',
      dropEffect: 'none',
    },
  }
}

describe('拖一篇文档出去', () => {
  it('放的是那一篇的路径', () => {
    const e = fakeDrag()
    startDocDrag(e, '正文/第三章.md')
    expect(e.data[DOC_DRAG_TYPE]).toBe('正文/第三章.md')
  })

  it('【关键】不放 text/plain —— 放了的话稿纸会把路径当正文插进去', () => {
    const e = fakeDrag()
    startDocDrag(e, '正文/第三章.md')
    expect(e.data['text/plain']).toBeUndefined()
  })

  it('【关键】effectAllowed 是 copyMove，两个都要', () => {
    // 只写 move 的话，虚线框那边设 dropEffect='copy' 会被浏览器判为
    // 不兼容，**drop 根本不触发** —— 表现是「松手没反应」，一行错都没有。
    // 只写 copy 的话，目录树里的同层排序（move）反过来失灵。
    const e = fakeDrag()
    startDocDrag(e, 'a.md')
    expect(e.dataTransfer?.effectAllowed).toBe('copyMove')
  })

  it('没有 dataTransfer 时安静地什么都不做，不炸', () => {
    expect(() => startDocDrag({ dataTransfer: null }, 'a.md')).not.toThrow()
    expect(() => startRowDrag({ dataTransfer: null })).not.toThrow()
  })
})

describe('拖一个卷（只能排序的那种行）', () => {
  it('【关键】不冒充文档 —— 拖进虚线框应当不被接受', () => {
    const e = fakeDrag()
    startRowDrag(e)
    expect(isDocDrag(e)).toBe(false)
    expect(splitDropKind(e)).toBe('none')
  })

  it('还是放了个类型，免得某些环境下压根拖不起来', () => {
    const e = fakeDrag()
    startRowDrag(e)
    expect(Object.keys(e.data)).toEqual([ROW_DRAG_TYPE])
  })
})

describe('虚线框接住的时候', () => {
  it('认得出正文/大纲拖过来的一篇', () => {
    const e = fakeDrag()
    startDocDrag(e, '正文/第三章.md')
    expect(splitDropKind(e)).toBe('doc')
    expect(splitDropPath(e)).toBe('正文/第三章.md')
  })

  it('设定集的卡片也接 —— 它只带便利贴那个类型时同样算一篇', () => {
    const e = fakeDrag()
    startStickyDrag(e, '设定集/人物/李四.md')
    expect(splitDropKind(e)).toBe('doc')
    expect(splitDropPath(e)).toBe('设定集/人物/李四.md')
  })

  it('硬盘上的文件按「文件」处理（摆过去是只读的参考）', () => {
    expect(splitDropKind(fakeDrag({ Files: '' }))).toBe('file')
  })

  it('⚠️ 文档和 Files 同时在时算文档 —— 不能拿书里的稿子去走读盘那条路', () => {
    const e = fakeDrag({ Files: '' })
    startDocDrag(e, '正文/第三章.md')
    expect(splitDropKind(e)).toBe('doc')
  })

  it('从网页拖一段文字过来，不接', () => {
    expect(splitDropKind(fakeDrag({ 'text/plain': '一段字' }))).toBe('none')
    expect(splitDropKind(fakeDrag())).toBe('none')
    expect(docPathOf(fakeDrag({ 'text/plain': 'a' }))).toBe('')
  })

  it('没有 dataTransfer 时当成「不接」', () => {
    expect(splitDropKind({ dataTransfer: null })).toBe('none')
    expect(splitDropPath({ dataTransfer: null })).toBe('')
  })
})
