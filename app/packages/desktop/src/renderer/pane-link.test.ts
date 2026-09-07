/**
 * 双屏共享正文那根线的测试。
 *
 * ─────────────────────────────────────────────────────────────
 * 这一层坏了有两种样子，**两种都不会报错**：
 *
 *   · 转发漏了 → 两边内容不一致，然后谁后保存谁把对方盖掉。**丢稿。**
 *   · 转发多了 → 两边来回弹，或者右边跟着左边跳，参照物没了。
 *
 * 丢稿那种尤其要命，所以「转发了没有」和「转给了谁」都得钉死。
 *
 * 用真的 `ChangeSet`（它不需要 DOM），视图那头拿假的顶上 ——
 * 要验的是**决定**，不是 CodeMirror 会不会渲染。
 * ─────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from 'vitest'
import { ChangeSet, Text, Transaction } from '@codemirror/state'
import {
  DocLink,
  FORWARDED,
  relaySpec,
  shouldForward,
  type Peer,
  type RelaySpec,
  type TrLike,
} from './pane-link.js'

/** 假事务。真的 Transaction 也是这两个东西，只是造起来要一整个 state */
const tr = (docChanged: boolean, forwarded = false): TrLike => ({
  docChanged,
  annotation: () => (forwarded ? true : undefined),
})

/** 假视图：把收到的东西记下来 */
function fakePeer(): Peer & { got: RelaySpec[] } {
  const got: RelaySpec[] = []
  return { got, dispatch: (s) => void got.push(s) }
}

const someChanges = (): ChangeSet =>
  ChangeSet.of({ from: 0, insert: '新写的' }, Text.of(['原来的']).length)

describe('shouldForward', () => {
  it('文档变了就转', () => {
    expect(shouldForward(tr(true))).toBe(true)
  })

  it('【关键】光标动、选区变一概不转 —— 那是「我在看哪儿」，跟对面无关', () => {
    expect(shouldForward(tr(false))).toBe(false)
  })

  it('【关键】对面转过来的不再转回去 —— 否则两边无限来回弹', () => {
    expect(shouldForward(tr(true, true))).toBe(false)
  })
})

describe('relaySpec', () => {
  it('【关键】写死 scrollIntoView: false —— 这一行就是「右边不许跳」', () => {
    expect(relaySpec(someChanges()).scrollIntoView).toBe(false)
  })

  it('【关键】不带 selection —— 带了对面的光标就会跳到改动那儿去', () => {
    expect('selection' in relaySpec(someChanges())).toBe(false)
  })

  it('带着「转发来的」标记，好让对面不再转回来', () => {
    const s = relaySpec(someChanges())
    const a = s.annotations.find((x) => x.type === FORWARDED)
    expect(a).toBeDefined()
    expect(a?.value).toBe(true)
  })

  it('【关键】转来的改动不进对面的撤销栈 —— 谁敲的谁撤', () => {
    /*
     * 漏了这一条的后果不是「少个功能」，是乱：两个视图各有一份 history()，
     * 转发的改动也记进去，于是在右半边按 Ctrl+Z 撤掉的是左边刚敲的那句，
     * 而这次撤销又会原路转回左边。交替撤几次没人说得清会发生什么。
     */
    const a = relaySpec(someChanges()).annotations.find((x) => x.type === Transaction.addToHistory)
    expect(a).toBeDefined()
    expect(a?.value).toBe(false)
  })

  it('【关键】撤销那一条必须是注解，不能是事务字段 —— 写成字段会被静默忽略', () => {
    // CodeMirror 的 TransactionSpec 里没有 addToHistory 这个字段。
    // 从前那个写法看起来设过了，实际一点用没有
    expect('addToHistory' in relaySpec(someChanges())).toBe(false)
  })

  it('改动本身原样带过去', () => {
    const c = someChanges()
    expect(relaySpec(c).changes).toBe(c)
  })
})

describe('DocLink', () => {
  it('转给对面，不转给自己', () => {
    const link = new DocLink()
    const a = fakePeer()
    const b = fakePeer()
    link.attach(a)
    link.attach(b)

    expect(link.relay(a, tr(true), someChanges())).toBe(1)
    expect(a.got.length).toBe(0)
    expect(b.got.length).toBe(1)
  })

  it('只挂了一个时什么都不做 —— 没开双屏是常态，不该有额外开销', () => {
    const link = new DocLink()
    const a = fakePeer()
    link.attach(a)
    expect(link.relay(a, tr(true), someChanges())).toBe(0)
  })

  it('光标动不转发', () => {
    const link = new DocLink()
    const a = fakePeer()
    const b = fakePeer()
    link.attach(a)
    link.attach(b)
    expect(link.relay(a, tr(false), someChanges())).toBe(0)
    expect(b.got.length).toBe(0)
  })

  it('转发来的不再转出去，两边不会来回弹', () => {
    const link = new DocLink()
    const a = fakePeer()
    const b = fakePeer()
    link.attach(a)
    link.attach(b)
    expect(link.relay(b, tr(true, true), someChanges())).toBe(0)
  })

  it('【关键】摘下来之后不再往它派发 —— 往销毁了的视图派发会当场抛', () => {
    const link = new DocLink()
    const a = fakePeer()
    const b = fakePeer()
    link.attach(a)
    const off = link.attach(b)
    off()
    expect(link.size).toBe(1)
    expect(link.relay(a, tr(true), someChanges())).toBe(0)
    expect(b.got.length).toBe(0)
  })

  it('两边都摘光了也不炸', () => {
    const link = new DocLink()
    const a = fakePeer()
    const off = link.attach(a)
    off()
    expect(link.size).toBe(0)
    expect(link.relay(a, tr(true), someChanges())).toBe(0)
  })

  it('同一个视图挂两次只算一个 —— React 严格模式下会重复挂载', () => {
    const link = new DocLink()
    const a = fakePeer()
    link.attach(a)
    link.attach(a)
    expect(link.size).toBe(1)
  })

  it('三块也能用 —— 没写死两个', () => {
    const link = new DocLink()
    const a = fakePeer()
    const b = fakePeer()
    const c = fakePeer()
    link.attach(a)
    link.attach(b)
    link.attach(c)
    expect(link.relay(a, tr(true), someChanges())).toBe(2)
    expect(b.got.length).toBe(1)
    expect(c.got.length).toBe(1)
  })
})
