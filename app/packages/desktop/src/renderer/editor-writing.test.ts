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
import { focusKeep, shouldRecenter, wrapSpec } from './editor-writing.js'
import { SEED_RULES, liveRules } from './smart-replace.js'

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

describe('打字机模式：什么时候才把光标滚回中间', () => {
  const f = (o: Partial<Parameters<typeof shouldRecenter>[0]>) =>
    shouldRecenter({
      docChanged: false,
      selectionSet: false,
      ranged: false,
      byPointer: false,
      focused: true,
      ...o,
    })

  it('打字时回中 —— 这是打字机模式存在的理由', () => {
    expect(f({ docChanged: true, selectionSet: true })).toBe(true)
  })

  it('【关键】鼠标拖着选一段时不动 —— 不然人在追一个会跑的目标', () => {
    expect(f({ selectionSet: true, ranged: true, byPointer: true })).toBe(false)
  })

  it('【关键】在当前行点一下也不动', () => {
    // 作者报的：「即使鼠标停在选中的当前行，也会往上下滑动」
    // 因为「居中」本身就意味着把那一行挪到屏幕中间去
    expect(f({ selectionSet: true, byPointer: true })).toBe(false)
  })

  it('选中了一片就一律不动，键盘选的也一样 —— 这时候人在读不在写', () => {
    expect(f({ selectionSet: true, ranged: true })).toBe(false)
    expect(f({ docChanged: true, ranged: true })).toBe(false)
  })

  it('键盘移光标要回中 —— 那是「往下写」的一部分', () => {
    expect(f({ selectionSet: true })).toBe(true)
  })

  it('什么都没发生就不动', () => {
    expect(f({})).toBe(false)
  })

  it('滚动、重绘之类的更新不触发', () => {
    expect(f({ docChanged: false, selectionSet: false, byPointer: true })).toBe(false)
  })
})

describe('打字机模式：双屏里另一半一动不动', () => {
  const f = (o: Partial<Parameters<typeof shouldRecenter>[0]>) =>
    shouldRecenter({
      docChanged: false,
      selectionSet: false,
      ranged: false,
      byPointer: false,
      focused: true,
      ...o,
    })

  it('【关键】没焦点的那一半，文档变了也不动', () => {
    // 双屏共享正文：左边打字，右边收到转发的改动。
    // 不加这条的话右边会自己把光标滚回正中 —— 换条路，同样是跳
    expect(f({ focused: false, docChanged: true, selectionSet: true })).toBe(false)
  })

  it('没焦点时，光标被改动映射着挪了位置也不动', () => {
    expect(f({ focused: false, selectionSet: true })).toBe(false)
  })

  it('有焦点的那一半照常回中', () => {
    expect(f({ focused: true, docChanged: true })).toBe(true)
  })
})

/**
 * 裹选区：选中一段字再打成对的符号，那段字要被裹进去，不是被顶掉。
 *
 * 默认行为（不接管）是**选中的那段字被这一个符号替换掉** ——
 * 划出一句话想加引号，手指落下去那句话就没了。
 * 所以这儿测的不是「裹得好不好看」，是「那段字还在不在」。
 */
describe('裹选区', () => {
  const DEF = liveRules(SEED_RULES, true)

  /** 选中 [from,to) 打一个字符，返回裹完的正文和还选着的那一段 */
  function wrap(doc: string, from: number, to: number, typed: string, rules = DEF) {
    const state = EditorState.create({ doc, selection: { anchor: from, head: to } })
    const spec = wrapSpec(state, typed, rules)
    if (!spec) return null
    const next = state.update(spec).state
    return { doc: next.doc.toString(), sel: next.sliceDoc(next.selection.main.from, next.selection.main.to) }
  }

  it('【关键】选中的那段字一个都不少', () => {
    expect(wrap('他说你好啊', 2, 4, "'")?.doc).toBe('他说“你好”啊')
  })

  it('【关键】书名号是一对，不是两个开的也不是两个关的', () => {
    expect(wrap('看了红楼梦', 2, 5, '<')?.doc).toBe('看了《红楼梦》')
  })

  it('【关键】连着裹两次，第二次还是一对开一对关', () => {
    // 光标是点的时候成对符号要交替（pairSide 数这一行已有几个）。
    // 裹选区时复用那套就会给出 ”你好”，两个都是关引号
    const once = wrap('他说你好啊', 2, 4, "'")!
    const state = EditorState.create({ doc: once.doc, selection: { anchor: 3, head: 5 } })
    const twice = state.update(wrapSpec(state, "'", DEF)!).state
    expect(twice.doc.toString()).toBe('他说““你好””啊')
  })

  it('裹完原文还选着 —— 于是 * 打两下就是加粗', () => {
    const once = wrap('这里是重点', 3, 5, '*')!
    expect(once.doc).toBe('这里是*重点*')
    expect(once.sel).toBe('重点')

    const state = EditorState.create({ doc: once.doc, selection: { anchor: 4, head: 6 } })
    const twice = state.update(wrapSpec(state, '*', DEF)!).state
    expect(twice.doc.toString()).toBe('这里是**重点**')
    expect(twice.sliceDoc(twice.selection.main.from, twice.selection.main.to)).toBe('重点')
  })

  it('从后往前选的，裹完还是从后往前选着', () => {
    const state = EditorState.create({ doc: '他说你好啊', selection: { anchor: 4, head: 2 } })
    const next = state.update(wrapSpec(state, "'", DEF)!).state
    expect(next.selection.main.anchor).toBe(5)
    expect(next.selection.main.head).toBe(3)
  })

  it('跨行选也照裹 —— 裹永远不会弄丢字，拦下来才会', () => {
    expect(wrap('第一行\n第二行', 0, 7, '~')?.doc).toBe('~第一行\n第二行~')
  })

  it('光标只是一个点时这条不管 —— 那是插标点，走另一条路', () => {
    const state = EditorState.create({ doc: '他说', selection: { anchor: 2 } })
    expect(wrapSpec(state, "'", DEF)).toBeNull()
  })

  it('裹不了的符号不插手，让编辑器照常替换', () => {
    expect(wrap('他说你好啊', 2, 4, '好')).toBeNull()
    expect(wrap('他说你好啊', 2, 4, ';')).toBeNull()
  })

  it('【关键】总开关关着时，裹出来的是半角的那一对，不是把字吃掉', () => {
    expect(wrap('他说你好啊', 2, 4, '"', liveRules(SEED_RULES, false))?.doc).toBe('他说"你好"啊')
  })
})
