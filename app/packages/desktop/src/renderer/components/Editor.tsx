/**
 * CodeMirror 6 编辑器。
 *
 * 规范：更新文档/05-功能模块详述.md §2
 *
 * 存的是 Markdown 源码，显示时做实时装饰（Obsidian 的「实时预览」模式）：
 * 光标所在行显示原始标记，其他行把标记淡化，兼顾所见即所得与纯文本可控。
 *
 * 首行缩进用 CSS 的 text-indent 实现，**绝不往文件里插全角空格** ——
 * 那会让正文里混进大量不可见字符，污染检索和 diff。
 */

import { useEffect, useRef } from 'react'
import { Compartment, EditorState, Facet, Transaction, type Extension } from '@codemirror/state'
import { emptyCast, knownName, parseScriptLine, type Cast } from '@bugu/core'
import {
  EditorView,
  keymap,
  drawSelection,
  highlightActiveLine,
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { searchKeymap } from '@codemirror/search'
import { isStickyDrag } from '../sticky-drag.js'
import { type DocLink } from '../pane-link.js'
import { WRITE_CLASS } from '../write-class.js'
import { FENCE_RE, lineKindOf } from '../md-line-class.js'
import { focusMode, smartReplace, typewriterHorizontal, typewriterVertical } from '../editor-writing.js'
import type { Rule as SmartRule } from '../smart-replace.js'

const highlight = HighlightStyle.define([
  { tag: tags.heading1, class: 'cm-heading', fontSize: '1.5em' },
  { tag: tags.heading2, class: 'cm-heading', fontSize: '1.3em' },
  { tag: tags.heading3, class: 'cm-heading', fontSize: '1.15em' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], class: 'cm-heading' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.processingInstruction, class: 'cm-mark' },
  { tag: tags.quote, opacity: 0.85 },
])

/**
 * CodeMirror 自带界面的中文。
 *
 * Ctrl+F 那个查找条是 `@codemirror/search` 画的，按钮上写的是
 * next / previous / match case / regexp 这些英文。作者报的就是它。
 *
 * 库里每一处文案都走 `phrases` 这个 facet，所以不用改库、也不用自己
 * 重画一个查找条 —— 把对照表塞进去就全中文了。
 * 键名必须跟库里的原文**一字不差**，错一个字母那一项就悄悄退回英文。
 */
const CM_PHRASES: Record<string, string> = {
  // 查找 / 替换条
  Find: '查找',
  Replace: '替换',
  next: '下一个',
  previous: '上一个',
  all: '全部',
  'match case': '区分大小写',
  regexp: '正则',
  'by word': '全词匹配',
  replace: '替换',
  'replace all': '全部替换',
  close: '关闭',
  'current match': '当前这个',
  // 跳到某一行（Alt+G）
  'Go to line': '跳到第几行',
  go: '去',
  'on line': '在第',
}

/** `[[双向链接]]` 与伏笔标记的装饰 */
const WIKILINK_RE = /\[\[[^\]\n]+\]\]/g
const FORESHADOW_RE = /<!--\/?(?:埋|收)#[A-Za-z0-9_-]+-->/g
/**
 * 不该首行缩进的行。
 *
 * 正文默认缩两格（用 CSS 的 text-indent 做，**文件里不存全角空格**，见 05 §2）。
 * 但有一类行不是「一段话」，是**标记**：标题、引用、列表、分隔线、
 * 代码围栏，以及不咕鸟自己那两个 —— 行首 `@`（整行浮到稿纸上）和
 * `<!--埋#…-->`（伏笔锚点）。
 *
 * 标记要顶格，理由是**一眼扫得出来**：缩两格的标记混在缩两格的正文里，
 * 得逐行读才认得出哪行是标记。作者报的就是这个 ——
 * `#` 和 `<` 顶着格，`@` 却跟正文一样缩进，看着像漏了一样。
 */
export const NO_INDENT_RE =
  /^\s*(?:#{1,6}\s|>|[-*+]\s|\d+\.\s|-{3,}\s*$|```|~~~|@|<!--)/

/**
 * 剧本模式是否打开。
 *
 * 做成 Facet 而不是重建编辑器：切换模式时光标位置、撤销历史都得留着 ——
 * 作者写到一半点一下「剧本排版」，不该把他刚才那几步撤销记录清掉。
 */
export const scriptMode = Facet.define<boolean, boolean>({
  combine: (v) => v.length > 0 && v[v.length - 1] === true,
})

/**
 * 这本书的角色名单（设定集里读来的）。
 *
 * 只有名单里的名字才会被**单独排一行** —— 靠正则猜出来的「时间：三年后」
 * 要是也拆成两行，那就是把一句叙述从中间劈开。
 */
export const scriptCast = Facet.define<Cast, Cast>({
  combine: (v) => v[v.length - 1] ?? emptyCast(),
})

const scriptComp = new Compartment()
const castComp = new Compartment()
/** 写作手感那几样：打字机、专注模式、自动折行。都用 Compartment 装着，
 *  切换时只重配这一格 —— 重建编辑器会把光标和撤销历史一起丢掉 */
const writingComp = new Compartment()

const decorate = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = build(view)
    }
    update(u: ViewUpdate) {
      // 光标换行也要重画：角色名那一行的冒号只在光标不在这行时才藏起来
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        u.startState.facet(scriptMode) !== u.state.facet(scriptMode) ||
        u.startState.facet(scriptCast) !== u.state.facet(scriptCast)
      ) {
        this.decorations = build(u.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

function build(view: EditorView): DecorationSet {
  const marks: Array<{ from: number; to: number; deco: Decoration }> = []

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to)

    for (const m of text.matchAll(WIKILINK_RE)) {
      const s = from + (m.index ?? 0)
      marks.push({ from: s, to: s + m[0].length, deco: Decoration.mark({ class: 'cm-wikilink' }) })
    }
    for (const m of text.matchAll(FORESHADOW_RE)) {
      const s = from + (m.index ?? 0)
      marks.push({
        from: s,
        to: s + m[0].length,
        deco: Decoration.mark({ class: 'cm-comment-mark' }),
      })
    }
  }

  const script = view.state.facet(scriptMode)
  const cast = view.state.facet(scriptCast)
  // 光标所在的行：那一行不藏任何字符，不然改起来手感很怪
  const caretLine = view.state.doc.lineAt(view.state.selection.main.head).number

  // 按行加「不缩进」类；剧本模式下再按行别加排版类
  /*
   * 代码围栏是唯一需要跨行才能判断的东西，所以从第一行一路数下来。
   * 这也是为什么这个循环不能只走视野内的行。
   */
  let fenceOpen = false
  for (let i = 1; i <= view.state.doc.lines; i++) {
    const line = view.state.doc.line(i)
    const isFence = FENCE_RE.test(line.text)
    const inFence = isFence || fenceOpen
    if (isFence) fenceOpen = !fenceOpen
    if (line.from > view.viewport.to || line.to < view.viewport.from) continue

    /*
     * Typora 式的行别：`.cm-h1`、`.cm-quote`、`.cm-code`……
     *
     * 稿纸里没有真的 <h1>，主题却总在写 `#write h1`。给行标上类之后，
     * 主题能直接写 `#write .cm-h1`，导入的 Typora 主题也能被翻过来
     * （见 main/theme-css.ts 的 bridgeSelectors）。
     */
    const kind = lineKindOf(line.text, inFence)
    if (kind) {
      marks.push({ from: line.from, to: line.from, deco: Decoration.line({ class: `cm-${kind}` }) })
    }
    if (NO_INDENT_RE.test(line.text)) {
      marks.push({ from: line.from, to: line.from, deco: Decoration.line({ class: 'cm-no-indent' }) })
    }
    /*
     * 行首的 `@`（整行浮到稿纸上）单独上个色。
     *
     * 它跟 `#`、`<!--` 一样是**标记**，但那两个各自有样子（标题是粗大字、
     * 伏笔锚点是灰小字），`@` 却跟正文一模一样 —— 顶格了也看不出它是标记。
     * 给它一点颜色，一眼就分得出「这行不是正文」。
     */
    const at = /^\s*@/.exec(line.text)
    if (at) {
      const s0 = line.from + at[0].length - 1
      marks.push({ from: s0, to: s0 + 1, deco: Decoration.mark({ class: 'cm-sticky-mark' }) })
    }

    if (script) {
      const parsed = parseScriptLine(line.text, i - 1, 0, cast)
      if (parsed.kind !== 'blank') {
        marks.push({
          from: line.from,
          to: line.from,
          deco: Decoration.line({ class: `cm-sc cm-sc-${parsed.kind}` }),
        })
      }
      // 角色名单独染色：一眼能扫出谁在说话
      if (parsed.kind === 'dialogue' && parsed.who) {
        const nameStart = line.from + line.text.indexOf(parsed.who)
        const nameEnd = nameStart + parsed.who.length
        const said = parsed.knownWho === true && knownName(cast, parsed.who)

        if (!said) {
          marks.push({ from: nameStart, to: nameEnd, deco: Decoration.mark({ class: 'cm-sc-who' }) })
        } else {
          // 确凿的角色：名字（连表演提示）单独占一行，台词落到下一行。
          // 靠 CSS 的 display:block 做，**一个字节都没动文件** ——
          // 关掉剧本排版就是原来那行 `李四：你等很久了？`。
          const cueEnd = parsed.cue
            ? line.text.indexOf('）', nameEnd - line.from) + 1 + line.from
            : nameEnd
          marks.push({
            from: nameStart,
            to: cueEnd,
            deco: Decoration.mark({ class: 'cm-sc-who cm-sc-who-block' }),
          })
          marks.push({
            from: line.from,
            to: line.from,
            deco: Decoration.line({ class: 'cm-sc-said' }),
          })

          // 冒号在两行式排版里是多余的，藏起来。
          // 但**光标在这一行时不藏** —— 正在改的那一行如果字符会凭空消失，
          // 退格删到哪儿就全靠猜了。
          const colon = /[：:]\s?/.exec(line.text.slice(cueEnd - line.from))
          if (colon && i !== caretLine) {
            marks.push({
              from: cueEnd,
              to: cueEnd + colon[0].length,
              deco: Decoration.replace({}),
            })
          }
        }
      }
    }
  }

  marks.sort((a, b) => a.from - b.from || a.to - b.to)
  return Decoration.set(
    marks.map((m) => m.deco.range(m.from, m.to)),
    true,
  )
}

/**
 * 按开关拼出那几个扩展。
 *
 * **横向打字机会关掉自动折行** —— 折行时一行永远填不满、光标也就
 * 永远走不到右边，横向根本没得动。这是硬冲突，只能二选一；
 * 设置里那句提示就是为了别让它显得像个 bug。
 */
function writingExtensions(w: EditorProps['writing']): Extension[] {
  const out: Extension[] = []
  if (!w?.typewriterH) out.push(EditorView.lineWrapping)
  if (w?.typewriterV) out.push(typewriterVertical())
  if (w?.typewriterH) out.push(typewriterHorizontal())
  if (w?.focus) out.push(focusMode())
  return out
}

export interface EditorProps {
  /** 文档路径，变化时重建编辑器 */
  docPath: string
  /**
   * 这块稿纸认的「同一篇」是谁。默认就是 `docPath`。
   *
   * ⚠️ 换了它**整个编辑器会重建** —— 撤销历史清空、光标回开头。
   * 换文档时这是对的，但有一种情况路径变了而文档没变：
   * 没起名的那一篇第一次存盘时按正文第一行改了名（见 workspace 的 saveDoc）。
   * 那一刻人正在这儿打字，重建一次等于把他刚写的撤销记录全扔了、
   * 光标扔回开头。所以那种场合要传一个不跟着路径走的身份（文档 id）。
   */
  docKey?: string
  initialBody: string
  onChange(body: string): void
  /** Ctrl+S */
  onSaveRequest(): void
  /** 点了正文里的 `[[链接]]` */
  onWikiLink?(target: string): void
  /** 光标屏幕坐标变化。便利贴靠它避让 */
  onCaretMove?(pos: { x: number; y: number } | null): void
  /**
   * 这块稿纸拿到焦点了。
   *
   * 双屏之后「光标在哪一半」是个要显示出来的事实 ——
   * 顶栏那个字数数的就是有光标的那一篇（split.ts 的 `countsSide`）。
   * 只在**拿到**焦点时叫一声，丢焦点不叫：点到侧边栏、点到顶栏时
   * 两半都没有焦点，那时候把字数清成 0 或者跳回左边都是错的 ——
   * 作者的注意力还在他刚才写的那一篇上。
   */
  onFocus?(): void
  /** 选区变化。伏笔面板靠它决定「标为埋点」能不能点 */
  onSelectionChange?(range: { start: number; end: number } | null): void
  /**
   * 每次编辑敲进去多少字、删掉多少字。
   *
   * 从 changeset 里数，不是「前后字数一减」—— 一减只剩净值，
   * 而改稿那天净值常常是负的，看着像一下午白干。
   */
  onEdit?(added: number, removed: number): void
  /**
   * 外部改了正文时递增这个数，编辑器会把内容换成 initialBody。
   * 打伏笔标记是由主进程改的正文，得这样推回编辑器。
   */
  externalRevision?: number
  /**
   * 让编辑器选中并滚到某一段。
   *
   * `nonce` 变了才动 —— 同一段可能要跳好几次（抓虫清单里点两遍同一条），
   * 光看 start/end 变没变会漏掉第二次。
   */
  revealRange?: { start: number; end: number; nonce: number } | null
  /** 剧本排版。只影响显示，一个字节都不写进文件 */
  script?: boolean
  /**
   * 写起来什么感觉的那几个开关。
   *
   * 全都**只影响显示与输入的那一刻**，不改文件里已有的字。
   */
  writing?: {
    /** 当前行停在屏幕中部 */
    typewriterV: boolean
    /** 当前列停在水平中央。**它会关掉自动折行**，两者互斥 */
    typewriterH: boolean
    /** 当前段落之外变淡 */
    focus: boolean
    /** 智能替换的规则。空数组 = 不替换 */
    rules: readonly SmartRule[]
  }
  /**
   * 这本书的角色名单（设定集里读来的）。
   * 名单里的名字才会被单独排一行 —— 靠正则猜的不敢拆。
   */
  cast?: Cast
  /** 右键。带上当前有没有选中，菜单要据此决定哪几项能点 */
  onContextMenu?(e: MouseEvent, ctx: { hasSelection: boolean; selectedText: string }): void
  /**
   * 往光标处插入 / 把选中的一段包起来。
   *
   * `nonce` 变了才动 —— 连着插两次同样的东西是常事，
   * 光看 before/after 变没变会漏掉第二次。
   */
  insertRequest?: { before: string; after: string; nonce: number } | null
  /**
   * 双屏里共享同一份正文的那根线。
   *
   * 只有「两边打开同一篇」时才给 —— 别的摆法两边是两份不同的文档，
   * 各写各的，不需要这根线。
   *
   * 给了之后：这一半的改动会转发给另一半，**但只转内容，不转视线**
   * （见 pane-link.ts）。
   */
  link?: DocLink | null
  /**
   * 建好之后要不要立刻抢焦点。默认要 —— 点开一章就该能直接打字。
   *
   * ⚠️ **双屏的右半边必须给 false。** 它比左边晚建好，
   * 建好时一 `focus()` 就把焦点从左边抢走了 —— 作者正在左边写字，
   * 光标忽然没了。而且专注模式会因此把左边整片点亮（它认「没焦点就不淡」），
   * 看起来像专注模式坏了，其实是焦点被偷了。
   */
  autoFocus?: boolean
  /**
   * 是不是**主**稿纸。
   *
   * 只有主稿纸顶着 `id="write"` —— Typora 主题全靠这个 id 找正文，
   * 但一个页面里 id 不能有两个。副稿纸（双屏右半边）只带类名，
   * 主题里那些 `#write` 规则由 theme-css.ts 镜像一份到类上，
   * 所以两块看起来还是一样的。
   */
  primary?: boolean
  /**
   * 只读。用在双屏右边摆一份**书外**的文件时。
   *
   * 往作者工作目录之外的文件自动存盘，是最容易毁掉别人东西的做法 ——
   * 那份文件可能是别人给的稿子、可能正被另一个程序开着。
   * 所以摆过来只给看。
   */
  readOnly?: boolean
}

export function Editor({
  docPath,
  docKey,
  initialBody,
  link,
  autoFocus = true,
  primary = true,
  readOnly = false,
  onChange,
  onSaveRequest,
  onWikiLink,
  onCaretMove,
  onFocus,
  onSelectionChange,
  onEdit,
  externalRevision = 0,
  revealRange = null,
  script = false,
  writing,
  cast,
  onContextMenu,
  insertRequest = null,
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // 建编辑器时要读当前值，但不能让它进依赖数组（那会重建编辑器）
  /*
   * 双屏那根线。放 ref 里是为了换线时不用重建整个编辑器 ——
   * 重建会清空撤销历史，而「把右边换成同一篇」这个动作不该有这种代价。
   */
  const linkRef = useRef(link)
  linkRef.current = link

  // 建视图那个 effect 只认 docPath，所以这个值得走 ref
  const autoFocusRef = useRef(autoFocus)
  autoFocusRef.current = autoFocus

  /** 重建编辑器的判据。默认跟路径走，传了 docKey 就跟它走 —— 见 docKey 那条注释 */
  const viewKey = docKey ?? docPath

  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly

  const scriptRef = useRef(script)
  scriptRef.current = script
  const castRef = useRef(cast)
  castRef.current = cast
  // 规则用 ref 拿：作者在设置里一改就该立刻生效，
  // 而重建编辑器会丢光标和撤销历史
  const rulesRef = useRef<readonly SmartRule[]>(writing?.rules ?? [])
  rulesRef.current = writing?.rules ?? []
  const writingRef = useRef(writing)
  writingRef.current = writing
  // 用 ref 持有回调，避免回调变化导致编辑器重建（那会丢光标位置）
  const cbRef = useRef({
    onChange,
    onSaveRequest,
    onWikiLink,
    onCaretMove,
    onFocus,
    onSelectionChange,
    onEdit,
    onContextMenu,
  })
  cbRef.current = {
    onChange,
    onSaveRequest,
    onWikiLink,
    onCaretMove,
    onFocus,
    onSelectionChange,
    onEdit,
    onContextMenu,
  }

  useEffect(() => {
    if (!hostRef.current) return

    const extensions: Extension[] = [
      // 剧本排版用 Compartment 装着，切换时只重配这一项，
      // 不重建编辑器 —— 光标位置和撤销历史都得留着
      EditorState.phrases.of(CM_PHRASES),
      // 两个都要：readOnly 挡住改动，editable=false 连光标都不给，
      // 免得作者对着一个能点却敲不进字的地方发愣
      ...(readOnlyRef.current
        ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
        : []),
      scriptComp.of(scriptMode.of(scriptRef.current)),
      castComp.of(scriptCast.of(castRef.current ?? emptyCast())),
      history(),
      drawSelection(),
      highlightActiveLine(),
      writingComp.of(writingExtensions(writingRef.current)),
      smartReplace(() => rulesRef.current),
      markdown(),
      syntaxHighlighting(highlight),
      decorate,
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            cbRef.current.onSaveRequest()
            return true
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      /*
       * 双屏：把这一半的改动转给另一半。
       *
       * 摆在别的监听器**前面**，让两边的正文先对齐，再去做数字数、
       * 报光标那些事 —— 顺序反了的话，中间那一瞬两边内容是不一致的。
       */
      EditorView.updateListener.of((u) => {
        const l = linkRef.current
        if (!l) return
        for (const tr of u.transactions) l.relay(u.view, tr, tr.changes)
      }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) cbRef.current.onChange(u.state.doc.toString())
        if (u.docChanged && cbRef.current.onEdit) {
          /*
           * 数这一次改动增删了多少字。
           *
           * **只数作者真敲的那些**：换文档、主进程回填正文走的是
           * 另一条路（那些 transaction 没有 userEvent），
           * 把它们算进「这一坐写了多少」会一下子多出几万字。
           */
          let added = 0
          let removed = 0
          for (const tr of u.transactions) {
            if (!tr.docChanged) continue
            const ev = tr.annotation(Transaction.userEvent)
            if (!ev) continue
            tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
              removed += toA - fromA
              added += inserted.length
            })
          }
          if (added > 0 || removed > 0) cbRef.current.onEdit(added, removed)
        }
        // 焦点挪到这块稿纸上了。丢焦点不报 —— 理由见 onFocus 那条注释
        if (u.focusChanged && u.view.hasFocus) cbRef.current.onFocus?.()
        if (u.docChanged || u.selectionSet || u.geometryChanged) reportCaret(u.view)
        if (u.docChanged || u.selectionSet) {
          const sel = u.state.selection.main
          cbRef.current.onSelectionChange?.(
            sel.empty ? null : { start: sel.from, end: sel.to },
          )
        }
      }),
      // 点 [[链接]] 时把目标名字交给外面处理
      EditorView.domEventHandlers({
        mousedown(event, view) {
          const el = event.target as HTMLElement | null
          if (!el?.classList.contains('cm-wikilink')) return false
          const pos = view.posAtDOM(el)
          const target = wikiLinkAt(view.state.doc.toString(), pos)
          if (!target) return false
          event.preventDefault()
          cbRef.current.onWikiLink?.(target)
          return true
        },
        scroll(_e, view) {
          reportCaret(view)
          return false
        },

        /*
         * 拖便利贴过来时，**编辑器一个字都不许收**。
         *
         * 这是 0.3 里那个 bug 的第二道闸：目录树曾经在拖便利贴时
         * 顺手 setData('text/plain', 卡片标题)，CodeMirror 看见 text/plain
         * 就把标题当正文插进了稿子里 —— 作者拖一张人物卡出来，
         * 正文里凭空多一个人名，而且**不报任何错**。
         *
         * 第一道闸是不再放 text/plain（见 DirectoryTree）。这一道是防
         * 「哪天有人为了别的兼容性又把它加回来」—— 那时候正文会重新开始
         * 冒人名，而没人会想到是这里。
         */
        dragover(event) {
          if (!isStickyDrag(event)) return false
          event.preventDefault()
          return true
        },
        drop(event) {
          if (!isStickyDrag(event)) return false
          // preventDefault 之后 CodeMirror 不会再往文档里插任何东西；
          // 事件继续往上冒，由稿纸那层去摆便利贴
          event.preventDefault()
          return true
        },
      }),
    ]

    /**
     * 把光标的屏幕坐标报出去，便利贴用它决定要不要让路。
     *
     * ⚠️ **没焦点的那一半一个字都不报。**
     *
     * 双屏之后两块稿纸都在报同一个「光标在哪儿」。不加这道闸的话，
     * 右半边一次滚动、一次重排就把左边正在写的那个位置**覆盖掉** ——
     * 结果是作者在左边写字，让路的却是右边那张便利贴，
     * 而压在他手底下的那张纹丝不动。
     *
     * 「不报」不是「报 null」：报 null 等于说「现在没有光标」，
     * 那会把有焦点那一半刚报上来的位置抹掉，同样是一次覆盖。
     * 让路要跟着**正在写的那一半**走，所以没焦点就干脆别出声。
     */
    function reportCaret(view: EditorView) {
      const cb = cbRef.current.onCaretMove
      if (!cb) return
      if (!view.hasFocus) return
      try {
        const c = view.coordsAtPos(view.state.selection.main.head)
        cb(c ? { x: (c.left + c.right) / 2, y: (c.top + c.bottom) / 2 } : null)
      } catch {
        cb(null)
      }
    }

    const view = new EditorView({
      state: EditorState.create({ doc: initialBody, extensions }),
      parent: hostRef.current,
    })
    viewRef.current = view
    if (autoFocusRef.current) view.focus()
    reportCaret(view)

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 只在切换文档时重建。initialBody 变化不重建 —— 那是我们自己写回去的内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey])

  /*
   * 把这个视图挂到那根线上。
   *
   * 单独一个 effect，而且**必须排在建视图那个后面** —— React 按声明顺序
   * 跑 effect，排前面的话 viewRef 还是空的，挂了个寂寞。
   *
   * 返回的是「摘下来」。视图销毁或者换线时一定要摘，
   * 否则会往一个已经 destroy 的视图上派发事务，当场抛。
   */
  useEffect(() => {
    const view = viewRef.current
    if (!view || !link) return
    return link.attach(view)
  }, [link, viewKey])

  /**
   * 外部（主进程）改了正文时把内容换掉。
   *
   * 只在 externalRevision 变化时做，绝不跟着 initialBody 变 ——
   * 否则每次保存回填都会重置编辑器，光标直接跳没。
   */
  const lastRevision = useRef(externalRevision)
  useEffect(() => {
    if (externalRevision === lastRevision.current) return
    lastRevision.current = externalRevision
    const view = viewRef.current
    if (!view || view.state.doc.toString() === initialBody) return

    const head = view.state.selection.main.head
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: initialBody },
      selection: { anchor: Math.min(head, initialBody.length) },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalRevision])

  /** 切换剧本排版。只重配这一项，不动文档也不动撤销历史 */
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: scriptComp.reconfigure(scriptMode.of(script)),
    })
  }, [script])

  /** 写作手感那几个开关变了：只重配那一格，不重建编辑器 */
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: writingComp.reconfigure(writingExtensions(writing)),
    })
  }, [writing?.typewriterV, writing?.typewriterH, writing?.focus])

  /** 人物卡改了、或换了人物分类，名单要跟着换 */
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: castComp.reconfigure(scriptCast.of(cast ?? emptyCast())),
    })
  }, [cast])

  /**
   * 右键菜单。
   *
   * Electron 里**默认没有任何右键菜单** —— 不自己接这个事件，
   * 作者在稿纸上右键就是一片死寂。这正是作者反馈的问题。
   */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onMenu = (e: MouseEvent) => {
      const view = viewRef.current
      if (!view) return
      e.preventDefault()
      const sel = view.state.selection.main
      cbRef.current.onContextMenu?.(e, {
        hasSelection: !sel.empty,
        selectedText: sel.empty ? '' : view.state.sliceDoc(sel.from, sel.to),
      })
    }
    host.addEventListener('contextmenu', onMenu)
    return () => host.removeEventListener('contextmenu', onMenu)
  }, [])

  /** 插入 / 把选中的一段包起来 */
  const lastInsert = useRef(0)
  useEffect(() => {
    if (!insertRequest || insertRequest.nonce === lastInsert.current) return
    lastInsert.current = insertRequest.nonce
    const view = viewRef.current
    if (!view) return

    const { before, after } = insertRequest
    const sel = view.state.selection.main
    const picked = view.state.sliceDoc(sel.from, sel.to)

    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: before + picked + after },
      // 有选中就把它整个留在选中状态；没选中就把光标停在中间，接着打字
      selection: picked
        ? { anchor: sel.from + before.length, head: sel.from + before.length + picked.length }
        : { anchor: sel.from + before.length },
    })
    view.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertRequest?.nonce])

  /** 跳到某一段并选中它。抓虫清单点「跳过去」走这里 */
  const lastReveal = useRef(0)
  useEffect(() => {
    if (!revealRange || revealRange.nonce === lastReveal.current) return
    lastReveal.current = revealRange.nonce
    const view = viewRef.current
    if (!view) return

    const len = view.state.doc.length
    const from = Math.max(0, Math.min(revealRange.start, len))
    const to = Math.max(from, Math.min(revealRange.end, len))
    view.dispatch({
      selection: { anchor: from, head: to },
      // center 而不是 nearest：跳过去之后那一段要在视野中间，
      // 贴在屏幕最底下等于还得再滚一次
      effects: EditorView.scrollIntoView(from, { y: 'center' }),
    })
    view.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealRange?.nonce])

  /*
   * id="write" 是给自选主题 CSS 用的。
   *
   * Typora 的主题**全都**把正文规则写在 `#write` 底下（字体、行距、标题、
   * 引用、代码块）。稿纸容器顶着这个 id，那些规则就直接落在稿纸上，
   * 不用我们去翻译任何一条 —— 翻译就得猜它在干什么，而每份主题写法都不一样。
   */
  /*
   * `id` 只给主稿纸，类名两块都有。
   *
   * 实测过：id 重复时 CSS 照样两块都命中，所以从前那样也「能用」——
   * 但那是不合法的 HTML，而且任何 `querySelector('#write')`
   * 都会悄悄只拿到左边那块。
   */
  return (
    <div
      {...(primary ? { id: 'write' } : {})}
      className={`paper-inner ${WRITE_CLASS}`}
      ref={hostRef}
    />
  )
}

/**
 * 取出光标位置所在的 `[[链接]]` 的目标名。
 *
 * 从点击位置往两边找方括号，比对整篇正文跑正则快得多 ——
 * 百万字的章节每点一次都全文扫描是不可接受的。
 */
export function wikiLinkAt(text: string, pos: number): string | null {
  const start = text.lastIndexOf('[[', pos)
  if (start === -1) return null
  const end = text.indexOf(']]', start)
  if (end === -1 || end < pos - 2) return null

  const inner = text.slice(start + 2, end)
  if (inner.includes('\n')) return null

  const bar = inner.indexOf('|')
  const target = (bar === -1 ? inner : inner.slice(0, bar)).trim()
  return target || null
}
