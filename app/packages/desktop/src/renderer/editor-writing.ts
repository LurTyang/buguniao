/**
 * 三个只影响「写起来什么感觉」的编辑器扩展：
 * 打字机模式（横、竖）、专注模式、智能替换。
 *
 * 规范：更新文档/10-0.4规划.md §4.1–4.3
 *
 * 单独一个文件，是因为 Editor.tsx 已经五百多行，而这三样跟它原有的
 * 职责（装配、剧本排版、装饰）不是一回事 —— 它们管的是**手感**。
 */

import {
  EditorSelection,
  RangeSetBuilder,
  type EditorState,
  type Extension,
  type Text,
  type TransactionSpec,
} from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { replaceOn, wrapWith, type Rule } from './smart-replace.js'

// ───────────────────────── 打字机模式 ─────────────────────────

/**
 * 竖向打字机：当前**行**永远停在屏幕的固定高度。
 *
 * 往下写时是纸在往上走、眼睛不动。长篇作者一坐两三个小时，
 * 眼睛一路走到屏幕底再跳回顶部，一天几百次。
 *
 * 做法是给编辑器上下各留半屏的 `scrollMargin`，再在每次光标移动时
 * 把它滚到中间 —— 光靠 scrollMargin 只能保证「不贴边」，
 * 保证不了「停在同一个高度」。
 */
/**
 * 这一次更新该不该把光标滚回中间。
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么需要它 —— 作者报的那个「过于敏感」】
 *
 * 初版是「文档变了**或者选区变了**就回中」。听起来对，实际很难用：
 *
 *   · 鼠标拖着选一段，每动一下选区都变一次 —— 于是稿纸在你拖的时候
 *     一直在往中间蹿，你在追一个会跑的目标。
 *   · 就算只在当前行点一下，也会滑 —— 因为「居中」本身就意味着
 *     把那一行挪到屏幕中间去。人只是想把光标放那儿，没想让纸动。
 *
 * 打字机模式要的是「**写**的时候纸在走」，不是「碰一下就走」。
 * 所以判断按下面四条：
 *
 *   0. 这一半没有焦点 → **一律不动**。
 *   1. 选中了一片东西 → **一律不动**。这时候人在读、在挑，不是在写。
 *   2. 文档真的变了（打字、删字）→ 回中。这是它存在的理由。
 *   3. 只是光标动了 → 鼠标点的不动，键盘移的才动。
 *
 * 第 3 条那个分界是关键：键盘移光标是「我在往下写」的一部分，
 * 鼠标点是「我要去看看那儿」—— 后者本来就已经看得见了，不该再滚。
 *
 * 【第 0 条是双屏加的，它堵的是另一条「跳」的路】
 *
 * 双屏时两半共享同一份正文（见 pane-link.ts）。左边一打字，
 * 右边收到转发过来的改动 —— 对它来说「文档变了」是真的，
 * 于是第 2 条触发，右边自己把光标滚回正中。
 *
 * 转发那头已经把滚动指令剥干净了，但**这里不加这一条照样会跳**，
 * 只是换了条路。作者要的是「右边一动不动」，那就得两条路都堵死。
 * ─────────────────────────────────────────────────────────────
 */
export function shouldRecenter(o: {
  docChanged: boolean
  selectionSet: boolean
  /** 选区是一片，不是一个光标 */
  ranged: boolean
  /** 这次更新里有「鼠标在选」这种操作 */
  byPointer: boolean
  /** 这一半有没有焦点。双屏时另一半必须一动不动 */
  focused: boolean
}): boolean {
  if (!o.focused) return false
  if (o.ranged) return false
  if (o.docChanged) return true
  if (!o.selectionSet) return false
  return !o.byPointer
}

/** 从一次更新里读出上面那四个判据 */
function recenterFacts(u: ViewUpdate): {
  docChanged: boolean
  selectionSet: boolean
  ranged: boolean
  byPointer: boolean
  focused: boolean
} {
  return {
    docChanged: u.docChanged,
    selectionSet: u.selectionSet,
    ranged: !u.state.selection.main.empty,
    byPointer: u.transactions.some((tr) => tr.isUserEvent('select.pointer')),
    focused: u.view.hasFocus,
  }
}

export function typewriterVertical(): Extension {
  return [
    // 上下各留半屏：文档最后一行也要能被滚到屏幕中间
    EditorView.scrollMargins.of((view) => {
      const h = view.dom.clientHeight
      return { top: h / 2, bottom: h / 2 }
    }),
    EditorView.updateListener.of((u) => {
      if (!shouldRecenter(recenterFacts(u))) return
      // 布局还没算完时滚会滚错位置，所以放进 requestMeasure
      u.view.requestMeasure({
        read: () => null,
        write: () => {
          u.view.dispatch({
            effects: EditorView.scrollIntoView(u.state.selection.main.head, { y: 'center' }),
          })
        },
      })
    }),
  ]
}

/**
 * 横向打字机：当前**列**永远停在水平中央，稿纸横着动。
 *
 * ⚠️ **它跟自动折行是互斥的。** 折行时一行永远填不满、光标也就永远
 * 走不到右边，横向根本没得动。所以打开它的时候要同时关掉折行 ——
 * 这件事得让作者知道，不能默默改掉他的排版（设置里那句提示就是干这个的）。
 */
export function typewriterHorizontal(): Extension {
  return [
    EditorView.scrollMargins.of((view) => {
      const w = view.scrollDOM.clientWidth
      return { left: w / 2, right: w / 2 }
    }),
    EditorView.updateListener.of((u) => {
      if (!shouldRecenter(recenterFacts(u))) return
      u.view.requestMeasure({
        read: () => null,
        write: () => {
          u.view.dispatch({
            effects: EditorView.scrollIntoView(u.state.selection.main.head, { x: 'center' }),
          })
        },
      })
    }),
  ]
}

// ───────────────────────── 专注模式 ─────────────────────────

const dimLine = Decoration.line({ class: 'cm-dimmed' })

/**
 * 哪几行**不**变淡。
 *
 * 抽成纯函数是为了能测 —— 它只认 `Text`，不碰 DOM，
 * 而「段到底算到哪儿」正是这个功能唯一容易错、又最难肉眼发现的地方。
 *
 * @returns 起止行号（从 1 数，两头都含）
 */
export function focusKeep(doc: Text, selFrom: number, selTo: number): { from: number; to: number } {
  return { from: doc.lineAt(selFrom).number, to: doc.lineAt(selTo).number }
}

/**
 * 光标所在的那一**段**之外全部变淡。段 = 一个逻辑行（见下）。
 *
 * ─────────────────────────────────────────────────────────────
 * 【什么时候淡，什么时候不淡】
 *
 * **编辑器没有焦点时，一个字都不淡。**
 *
 * 这是作者报的：「未选择时不应该全部虚化，而是全部正常。」
 * 他说得对 —— 光标不在稿纸上的时候（在翻侧边栏、在看设定集），
 * 「当前行」这个概念根本不成立，而那时候满屏灰字纯粹是在碍事，
 * 他多半正想通读一段。
 *
 * 焦点一回来就恢复。
 *
 * 【「段」到底指什么 —— 这里前后错过两次，说清楚】
 *
 * 有三个都能叫「行」的东西，必须分开：
 *
 *   1. **显示行**：折行之后屏幕上的一截。
 *   2. **逻辑行**：两个换行符之间的一整段，折成几截都算一个。
 *      CodeMirror 的一个 `.cm-line` 就是它。
 *   3. **空行分隔的块**：连着的若干逻辑行，Markdown 里的「段落」。
 *
 * 初版按 ① 算 —— 作者试完说要段落：一段被折成三行时只亮中间那一折，
 * 读起来是断的。他是对的。
 *
 * 于是改成了 ③，**又错了**，而且错得更隐蔽：作者报「必须额外空一行，
 * 才被识别为其他段落」。因为**中文小说不空行分段** —— 一段一行，
 * 连着往下写。按 ③ 算的话，一整章从头到尾就是一个「段」，
 * 于是打开专注模式看起来跟没打开一样。
 *
 * 正确答案是 ②。它同时满足两头：
 *   · 一段折成几行，整段都亮（因为折行不产生新的逻辑行）
 *   · 上一段下一段各是各的，不需要靠空行去分
 *
 * 顺带：**选中一片时，选中的每一行都亮着。** 想通读一段而不是写的时候，
 * 人会先把它划出来 —— 那时候把它一半压暗是在跟他作对。
 * ─────────────────────────────────────────────────────────────
 */
export function focusMode(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view)
      }
      update(u: ViewUpdate) {
        // focusChanged 必须跟：焦点进出稿纸就是「淡不淡」的开关
        if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged) {
          this.decorations = build(u.view)
        }
      }
    },
    { decorations: (v) => v.decorations },
  )

  function build(view: EditorView): DecorationSet {
    const b = new RangeSetBuilder<Decoration>()
    // 焦点不在稿纸上：全部正常，一个字都不淡
    if (!view.hasFocus) return b.finish()

    const doc = view.state.doc
    const sel = view.state.selection.main
    const { from, to } = focusKeep(doc, sel.from, sel.to)

    for (const { from: vf, to: vt } of view.visibleRanges) {
      let pos = vf
      while (pos <= vt) {
        const line = doc.lineAt(pos)
        if (line.number < from || line.number > to) b.add(line.from, line.from, dimLine)
        pos = line.to + 1
      }
    }
    return b.finish()
  }
}

// ───────────────────────── 智能替换 ─────────────────────────

/**
 * 选中一段字时打了个符号，这一笔该怎么下。裹不了就返回 null。
 *
 * 单拎出来是为了**能测**：它只认 `EditorState`，不碰视图、不碰 DOM，
 * 而这一层错了的后果是「作者选中的那一段字没了」—— 最不该靠肉眼发现的那类。
 *
 * 裹完之后原文**还选着**（选区整体右移一个开符号的长度）：
 * 于是 `*` 连打两下就是 `**重点**`，引号打完还能接着加书名号。
 */
export function wrapSpec(
  state: EditorState,
  typed: string,
  rules: readonly Rule[],
): TransactionSpec | null {
  const main = state.selection.main
  if (main.empty) return null
  const pair = wrapWith(typed, rules)
  if (!pair) return null

  const shift = pair.open.length
  return {
    changes: [
      { from: main.from, insert: pair.open },
      { from: main.to, insert: pair.close },
    ],
    // 自己算，不靠 changes 去映射：位置正好落在插入点上时，
    // 映射到符号的左边还是右边是看 assoc 的，而这儿要的是「都在里头」
    selection: EditorSelection.range(main.anchor + shift, main.head + shift),
    userEvent: 'input.wrap',
    scrollIntoView: true,
  }
}

/**
 * 接管「打了一个字符」这一下，两条路：
 *
 *   · **光标是一个点** → 打标点时顺手换成中文该有的样子（`replaceOn`）
 *   · **选中了一片字** → 成对的符号把它裹起来，不是顶掉（`wrapSpec`）
 *
 * `getRules` 是个函数而不是一份数组：作者在设置里改了开关要立刻生效，
 * 而重建编辑器会丢掉光标和撤销历史。
 *
 * ─────────────────────────────────────────────────────────────
 * 【撤销一次要退回原本打的那个字符】
 *
 * 做法是**分两笔**：先让 CodeMirror 正常插入他打的那个字符，
 * 再单独发一笔把它换掉。于是 Ctrl+Z 撤掉的是「换」这一笔，
 * 留下的正是他本来打的东西。
 *
 * 一笔搞定（直接插替换后的字符）会让 Ctrl+Z 把整个输入都撤掉 ——
 * 打了个引号想反悔，结果连引号都没了，人就不敢打字了。
 *
 * **裹选区那条相反，是一笔。** 那儿撤销要退回的是「没裹之前那段字」，
 * 而不是「一个把整段顶掉的引号」—— 后者压根不是他想要的东西。
 * ─────────────────────────────────────────────────────────────
 */
export function smartReplace(getRules: () => readonly Rule[]): Extension {
  return EditorView.inputHandler.of((view, from, to, text) => {
    const rules = getRules()

    // 选中了一片字：先看这个符号能不能把它裹起来。
    // 这条路**不受总开关管**，所以放在 rules 为空那句之前 —— 理由见 wrapWith
    if (from !== to) {
      // inputHandler 报的这一段跟主选区对不上时不插手（多光标、组合输入的中途）
      const main = view.state.selection.main
      if (main.from !== from || main.to !== to) return false
      const spec = wrapSpec(view.state, text, rules)
      if (!spec) return false
      // **一笔**。撤销一次就把两头的符号一起去掉，原文还选着 ——
      // 不像插标点那条要分两笔（那儿撤销要留下他打的那个字符，这儿不留）
      view.dispatch(spec)
      return true
    }

    if (rules.length === 0) return false

    const line = view.state.doc.lineAt(from)
    const lineBefore = view.state.doc.sliceString(line.from, from)
    const hit = replaceOn(lineBefore, text, rules)
    if (!hit) return false

    // 第一笔：他打的那个字符，照常插进去
    view.dispatch({
      changes: { from, to, insert: text },
      selection: EditorSelection.cursor(from + text.length),
      userEvent: 'input.type',
    })

    // 第二笔：把「往回 back 个字符 + 刚插的这个」整段换成替换结果。
    // 撤销一次撤掉的是这一笔，留下的正是他本来打的东西
    const cutFrom = from - hit.back
    const cutTo = from + text.length
    view.dispatch({
      changes: { from: cutFrom, to: cutTo, insert: hit.insert },
      selection: EditorSelection.cursor(cutFrom + hit.insert.length),
      userEvent: 'input.smartreplace',
    })
    return true
  })
}
