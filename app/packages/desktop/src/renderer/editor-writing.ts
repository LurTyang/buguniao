/**
 * 三个只影响「写起来什么感觉」的编辑器扩展：
 * 打字机模式（横、竖）、专注模式、智能替换。
 *
 * 规范：更新文档/10-0.4规划.md §4.1–4.3
 *
 * 单独一个文件，是因为 Editor.tsx 已经五百多行，而这三样跟它原有的
 * 职责（装配、剧本排版、装饰）不是一回事 —— 它们管的是**手感**。
 */

import { EditorSelection, RangeSetBuilder, type Extension, type Text } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { replaceOn, type Rule } from './smart-replace.js'

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
export function typewriterVertical(): Extension {
  return [
    // 上下各留半屏：文档最后一行也要能被滚到屏幕中间
    EditorView.scrollMargins.of((view) => {
      const h = view.dom.clientHeight
      return { top: h / 2, bottom: h / 2 }
    }),
    EditorView.updateListener.of((u) => {
      if (!u.docChanged && !u.selectionSet) return
      // 只在光标真的动了时滚。u.view.requestMeasure 里做，避免布局还没算完
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
      if (!u.docChanged && !u.selectionSet) return
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
 * 打标点时顺手换成中文该有的样子。
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
 * ─────────────────────────────────────────────────────────────
 */
export function smartReplace(getRules: () => readonly Rule[]): Extension {
  return EditorView.inputHandler.of((view, from, to, text) => {
    const rules = getRules()
    if (rules.length === 0) return false
    // 有选区时不插手：那是「用输入替换一段」，不是在行末打标点
    if (from !== to) return false

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
