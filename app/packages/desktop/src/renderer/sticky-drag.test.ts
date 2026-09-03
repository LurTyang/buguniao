/**
 * 拖便利贴时，剪贴板通道里到底放了什么。
 *
 * 这一组测试钉的是 0.3 的一个 bug：目录树拖便利贴时顺手放了
 * `text/plain`（卡片标题），而稿纸里的 CodeMirror 认这个类型，
 * 于是**卡片标题被当成正文插进了作者的稿子**——不报错、不提示。
 *
 * 它值得被钉住，是因为「多放一个类型」这件事**在界面上完全看不出来**：
 * 拖放照样能用，只是正文里悄悄多了几个字。
 */

import { describe, expect, it } from 'vitest'
import {
  STICKY_DRAG_TYPE,
  isStickyDrag,
  startStickyDrag,
  stickyCardOf,
  type DragLike,
} from './sticky-drag.js'

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

describe('拖出去的时候放了什么', () => {
  it('放的是卡片路径，类型是那个自定义 MIME', () => {
    const e = fakeDrag()
    startStickyDrag(e, '设定集/人物/李四.md')
    expect(e.data[STICKY_DRAG_TYPE]).toBe('设定集/人物/李四.md')
  })

  it('【关键】不放 text/plain —— 放了的话编辑器会把它当正文插进稿子', () => {
    const e = fakeDrag()
    startStickyDrag(e, '设定集/人物/李四.md')
    expect(e.data['text/plain']).toBeUndefined()
  })

  it('【关键】通道里只有那一个类型，没有第二个', () => {
    const e = fakeDrag()
    startStickyDrag(e, '设定集/人物/李四.md')
    expect(Object.keys(e.data)).toEqual([STICKY_DRAG_TYPE])
  })

  it('标成 copy —— 拖出来是贴一张，不是把卡片搬走', () => {
    const e = fakeDrag()
    startStickyDrag(e, 'a.md')
    expect(e.dataTransfer?.effectAllowed).toBe('copy')
  })

  it('没有 dataTransfer 时安静地什么都不做，不炸', () => {
    expect(() => startStickyDrag({ dataTransfer: null }, 'a.md')).not.toThrow()
  })
})

describe('接住的时候认不认得出来', () => {
  it('认得出便利贴拖放', () => {
    const e = fakeDrag()
    startStickyDrag(e, 'a.md')
    expect(isStickyDrag(e)).toBe(true)
    expect(stickyCardOf(e)).toBe('a.md')
  })

  it('别的拖放不认 —— 从别处拖一段文字进来，不该被当成便利贴', () => {
    const e = fakeDrag({ 'text/plain': '李四' })
    expect(isStickyDrag(e)).toBe(false)
    expect(stickyCardOf(e)).toBe('')
  })

  it('拖文件进来也不认', () => {
    const e = fakeDrag({ Files: '' })
    expect(isStickyDrag(e)).toBe(false)
  })

  it('没有 dataTransfer 时当成「不是」', () => {
    expect(isStickyDrag({ dataTransfer: null })).toBe(false)
    expect(stickyCardOf({ dataTransfer: null })).toBe('')
  })
})
