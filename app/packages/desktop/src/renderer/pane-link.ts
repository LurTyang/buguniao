/**
 * 双屏里「一份文档，两个视图」的那根线。
 *
 * 规范：更新文档/11-0.5规划.md §1.2
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么必须有这么一层】
 *
 * 双屏最有用的一种摆法是**同一章开头结尾对着改**。但两个编辑器打开
 * 同一个文件，如果各存各的，**会互相覆盖，而且是静默的** ——
 * 左边存一次盖掉右边刚写的，谁都不报错。
 *
 * 所以两边共享同一份正文：一边改了，把改动**转发**给另一边。
 *
 * 【难的不是转发，是「别把对面的视线也拽过去」】
 *
 * 作者定死的一条：
 *
 *   > 滚动绝对不能同步，不要出现左边修改后、右边也跳到修改位置的情况。
 *
 * 这条不是偏好。右边那半屏正是你摆在那儿**要对照看**的东西 ——
 * 它一跳，你对照的东西就没了。等于每打一个字，
 * 就把自己的参照物弄丢一次。
 *
 * 而「跳」有两条完全不同的路径，堵一条不够：
 *
 *   1. **事务本身带着滚动指令。** CodeMirror 里由输入产生的事务
 *      默认就是 `scrollIntoView`，照原样转发过去，对面立刻跳。
 *      → 这一层只转发 `changes`，别的一概不带（见 `relaySpec`）。
 *   2. **对面自己跳。** 打字机模式盯着「文档变了」，一变就把光标
 *      滚回屏幕正中 —— 对面收到转发的改动，它自己那套就触发了。
 *      → 那一层要加 `view.hasFocus`（在 editor-writing.ts 里）。
 *
 * 两条都堵上，右边才是真的一动不动。
 *
 * 【为什么不复用「外部改了正文」那条路】
 *
 * Editor 已经有 `externalRevision` —— 主进程改了正文时整份换掉。
 * 拿它来做双屏是错的：整份替换会**重置光标、清空撤销历史**，
 * 而且每敲一个字来一次。转发 changeset 光标只是按改动挪一挪。
 *
 * 【撤销归谁】
 *
 * 转发过去的改动**不进对面的撤销栈**（`addToHistory: false`）。
 *
 * 这一条一开始写漏了，而漏掉的后果不是「少了个功能」，是**乱**：
 * 两个 EditorView 各有一份 `history()`，谁都不知道对方存在。
 * 转发的改动要是也记进去，两边就各攒了一份「我自己的 + 镜像来的」，
 * 于是在右半边按 Ctrl+Z，撤掉的是**左边刚敲的那句**；
 * 而这次撤销不带转发标记，又会原路转回左边去。
 * 两边交替撤几次，没人说得清下一次 Ctrl+Z 会发生什么。
 *
 * 定成「谁敲的谁撤」：改动在哪一半发生，就只在那一半的撤销史里。
 * 这跟右半边的定位也是一致的 —— 它是拿来**对照**的，
 * 不是第二个主编辑器。
 * ─────────────────────────────────────────────────────────────
 */

import { Annotation, Transaction, type ChangeSet } from '@codemirror/state'

/**
 * 「这条事务是从对面转发过来的」。
 *
 * 没有它两边会来回弹：A 转给 B，B 又当成自己的改动转回给 A，无限循环。
 */
export const FORWARDED = Annotation.define<boolean>()

/** 转发时要看的那点东西。抽成接口是为了不用真造一个 Transaction 就能测 */
export interface TrLike {
  docChanged: boolean
  /** 读注解。真的 Transaction 天然有这个方法 */
  annotation(type: typeof FORWARDED): boolean | undefined
}

/**
 * 这条事务要不要转给对面。
 *
 * 只有两种情况要转：文档真的变了，而且这变化不是对面刚转过来的。
 * **光标动、选区变、滚动，一概不转** —— 那些是「我在看哪儿」，
 * 而对面看哪儿是对面的事。
 */
export function shouldForward(tr: TrLike): boolean {
  if (!tr.docChanged) return false
  return tr.annotation(FORWARDED) !== true
}

/** 一个能接收事务的东西。真身是 EditorView，测试里是个假的 */
export interface Peer {
  dispatch(spec: RelaySpec): void
}

export interface RelaySpec {
  changes: ChangeSet
  /**
   * 两条注解，缺一不可：
   *
   *   · `FORWARDED`                  —— 对面别再转回来，否则无限弹
   *   · `Transaction.addToHistory(false)` —— 别进对面的撤销栈，谁敲的谁撤
   *
   * ⚠️ 撤销这一条**必须走注解**。CodeMirror 的事务规格里没有
   * `addToHistory` 这个字段，写成字段会被**静默忽略** ——
   * 看起来像设过了，实际一点用没有。
   */
  annotations: Array<ReturnType<typeof FORWARDED.of> | ReturnType<typeof Transaction.addToHistory.of>>
  /** 显式写死 false —— 这一行就是「右边不许跳」的全部实现 */
  scrollIntoView: false
}

/**
 * 转给对面的那份事务长什么样。
 *
 * **只有 `changes`，没有 `selection`。**
 * 不带 selection 时 CodeMirror 会把对面原有的光标按改动映射一下
 * （前面插了两个字，它就往后挪两个字），这正是我们要的：
 * 位置跟着内容走，但视线不跟过去。
 */
export function relaySpec(changes: ChangeSet): RelaySpec {
  return {
    changes,
    annotations: [FORWARDED.of(true), Transaction.addToHistory.of(false)],
    scrollIntoView: false,
  }
}

/**
 * 一份文档上挂着的那几个视图。
 *
 * 现在最多两个（左右），但没有写死 2 ——
 * 写死一个数字换来的只是几行 if，而以后想开第三块时又得回来改。
 */
export class DocLink {
  private peers = new Set<Peer>()

  /** 挂上去。返回摘下来的函数 —— 视图销毁时必须调，否则往死掉的视图上派发 */
  attach(p: Peer): () => void {
    this.peers.add(p)
    return () => {
      this.peers.delete(p)
    }
  }

  /** 现在挂着几个 */
  get size(): number {
    return this.peers.size
  }

  /**
   * 把一次改动转给**除了发起者之外**的所有视图。
   *
   * @returns 转给了几个。0 = 只有一个视图挂着，或者这条不用转
   */
  relay(from: Peer, tr: TrLike, changes: ChangeSet): number {
    if (!shouldForward(tr)) return 0
    let n = 0
    for (const p of this.peers) {
      if (p === from) continue
      p.dispatch(relaySpec(changes))
      n++
    }
    return n
  }
}
