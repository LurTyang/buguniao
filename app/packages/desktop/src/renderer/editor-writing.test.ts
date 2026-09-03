/**
 * 专注模式「亮哪几行」的测试。
 *
 * ─────────────────────────────────────────────────────────────
 * 这一条前后错过两次，而且**两次都是肉眼很难发现的错**：
 *
 *   · 初版按显示行算 —— 一段折成三行只亮中间那一折
 *   · 二版按空行分块算 —— 中文小说不空行分段，于是整章算一段，
 *     打开专注模式跟没打开一样（作者报的就是这个）
 *
 * 两次都「看起来在工作」：屏幕上确实有灰有黑，只是分界线划错了地方。
 * 所以把规则钉在这儿。
 *
 * 用 `EditorState` 而不是 `EditorView`：前者不需要 DOM，
 * 而这条规则本来就只跟文本有关。
 * ─────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { focusKeep } from './editor-writing.js'

/** 把光标放在第 n 行第 col 个字符处，返回亮着的行号区间 */
function keepAt(lines: string[], n: number, col = 0): [number, number] {
  const state = EditorState.create({ doc: lines.join('\n') })
  const pos = state.doc.line(n).from + col
  const r = focusKeep(state.doc, pos, pos)
  return [r.from, r.to]
}

describe('专注模式：亮哪几行', () => {
  const 中文小说 = [
    '失忆之前，究竟发生了什么？赵嘉乐回想着。',
    '但据两位教官所说，他发狂的攻击确实击杀了一只魔兽。',
    '随着战斗进入白热化，冬的讲解也愈发简单。',
  ]

  it('【关键】不空行分段时，上下两段各是各的', () => {
    // 作者报的：「必须额外空一行，他才会识别为其他段落」
    expect(keepAt(中文小说, 2)).toEqual([2, 2])
    expect(keepAt(中文小说, 1)).toEqual([1, 1])
    expect(keepAt(中文小说, 3)).toEqual([3, 3])
  })

  it('空行分段的写法也一样对 —— 不靠空行做判断', () => {
    const 空行分段 = ['第一段。', '', '第二段。', '', '第三段。']
    expect(keepAt(空行分段, 3)).toEqual([3, 3])
  })

  it('光标停在空行上，就只有那个空行是亮的', () => {
    expect(keepAt(['甲', '', '乙'], 2)).toEqual([2, 2])
  })

  it('一段很长时，整段都算一行 —— 折行不产生新的逻辑行', () => {
    // 这正是当初否掉「按显示行算」的理由：折成三截不能只亮中间那截
    const 长段 = ['短的。', '很长很长'.repeat(60), '也短。']
    const state = EditorState.create({ doc: 长段.join('\n') })
    const line = state.doc.line(2)
    // 段中间、段尾各取一个位置，落在同一行上
    expect(focusKeep(state.doc, line.from + 5, line.from + 5)).toEqual({ from: 2, to: 2 })
    expect(focusKeep(state.doc, line.to, line.to)).toEqual({ from: 2, to: 2 })
  })

  it('选中一片时，选中的每一行都亮着', () => {
    // 想通读而不是写的时候，人会先把它划出来 —— 那时候压暗一半是在跟他作对
    const state = EditorState.create({ doc: 中文小说.join('\n') })
    const r = focusKeep(state.doc, state.doc.line(1).from + 2, state.doc.line(3).from + 3)
    expect(r).toEqual({ from: 1, to: 3 })
  })

  it('第一行和最后一行不越界', () => {
    expect(keepAt(中文小说, 1)).toEqual([1, 1])
    expect(keepAt(中文小说, 3)).toEqual([3, 3])
  })

  it('只有一行的稿子', () => {
    expect(keepAt(['就这一句。'], 1)).toEqual([1, 1])
  })

  it('空文档不炸', () => {
    expect(keepAt([''], 1)).toEqual([1, 1])
  })
})
