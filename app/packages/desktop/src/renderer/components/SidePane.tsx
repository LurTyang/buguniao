/**
 * 双屏的右半边。
 *
 * 规范：更新文档/11-0.5规划.md §1
 *
 * ─────────────────────────────────────────────────────────────
 * 【它有两副面孔，靠 `mode` 分】
 *
 *   · `own`    —— 右边是另一份文档。自己读盘、自己存盘，跟左边毫无关系。
 *   · `shared` —— 右边跟左边是**同一份**。共享正文（那根线在 pane-link.ts），
 *                 而且**绝不自己存盘**。
 *
 * 第二条是这个组件存在的最大理由。两个编辑器往同一个文件各存各的，
 * 谁后写谁赢 —— 而两边内容其实一样（有线连着），所以看不出错，
 * 直到某一次时序不巧，丢掉的是刚敲进去的那几句。
 *
 * 所以「谁负责存」不写在这儿的 if 里，写在 split.ts 的 `rightSaves()` ——
 * 那儿有测试钉着「接线」和「自己存」永远不会同时为真。
 *
 * 【为什么不复用 Work 那一整套读写】
 *
 * Work 那套还管着元信息、手动保存回执、设备冲突检测、上次写到哪儿……
 * 右半边一样都不需要：它是拿来**对照**的，不是第二个主编辑器。
 * 把那套搬过来只会让两边都更难改。
 * ─────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Editor, type EditorProps } from './Editor.js'
import { Boom } from './Boom.js'
import type { DocLink } from '../pane-link.js'
import { dropKind, stickyCardOf } from '../sticky-drag.js'
import type { PaneMode, RightSide } from '../split.js'
import { rightPersistsScratch, rightSaves, safeToSave } from '../split.js'

const api = window.bugu

/** 自动保存的节流。跟左边那套一个数，免得两边手感不一样 */
const AUTOSAVE_MS = 3000

export interface SidePaneProps {
  mode: PaneMode
  right: RightSide | null
  /** 共享模式下，左边此刻的正文 —— 右边要从**这个**起步，不是从盘上 */
  sharedBody: string
  /** 共享模式下的那根线 */
  link: DocLink | null
  /** 手感开关，跟左边同一份 */
  writing: EditorProps['writing']
  script: boolean
  cast: EditorProps['cast']
  /** 右边点了双链 */
  onWikiLink?(target: string): void
  /**
   * 右边这半的正文变了。**顶栏那个字数是两边合计的**，所以左边得知道右边有多少字。
   *
   * 换文档的途中先报一个空串 —— 那会儿手里还是上一篇的正文，
   * 拿它去凑合计等于报一个假数。
   */
  onBodyChange(text: string): void
  /**
   * 右边敲了多少、删了多少，算进「这一坐的产出」里。
   *
   * ⚠️ 共享模式下**不会重复计数**：转发过去的那笔事务不带 userEvent，
   * 而 Editor 数字数时只数带 userEvent 的（见 Editor.tsx）。
   * 谁敲的算谁头上，转发过去的那份不算第二遍。
   */
  onEdit(added: number, removed: number): void
  /** 右边的光标在屏幕哪儿 —— 便利贴靠它让路 */
  onCaretMove(pos: { x: number; y: number } | null): void
  /**
   * 光标挪到右半边来了。
   *
   * 顶栏那个字数数的是**有光标的那一篇**（作者定的，见 split.ts 的
   * `countsSide`），所以这一半拿到焦点是件要往外说的事。
   */
  onFocus(): void
  /**
   * 往右半边拖了一张便利贴。
   *
   * 便利贴贴在**鼠标放开的地方**，左右两边一视同仁 ——
   * 它浮在整个窗口上（`position: fixed`），本来就不属于哪一半。
   */
  onStickyDrop(cardPath: string, clientX: number, clientY: number): void
  /** 换一份 / 关掉 */
  onPickDoc(): void
  onClose(): void
  /** 拖进来一个书外的文件，或者粘进来一段字 */
  onDropFile(path: string): void
  /** 拖进来的东西没有硬盘路径（目录、网页选区）。要说一声，不能静默 */
  onDropUnsupported(): void
  onPasteScratch(text: string): void
  /** 便笺的内容（`kind==='scratch'` 时用），以及改了之后往哪儿写 */
  scratch: string
  onScratchChange(text: string): void
  /** 右边标题栏上显示的名字 */
  title: string
}

export function SidePane(props: SidePaneProps): React.ReactElement {
  const { mode, right, sharedBody, link, title } = props
  const [body, setBody] = useState('')
  /*
   * 内容到位了没有。
   *
   * ⚠️ **没到位之前不许把 Editor 建出来。**
   * Editor 只在换文档时重建，`initialBody` 后来变了它是不管的
   * （那是有意的：正文靠 onChange 往外走，不靠 prop 往回灌）。
   * 所以先建一个空的、再等内容读回来，结果就是**右半边永远空着** ——
   * 而且不报错，看着像「这篇是空的」。
   */
  const [ready, setReady] = useState(false)
  const [err, setErr] = useState('')
  const [dirty, setDirty] = useState(false)
  const bodyRef = useRef('')
  /*
   * `bodyRef` 里这份正文，是**哪个路径**读回来的。
   *
   * ⚠️ 这不是冗余信息。换文档是异步的：`path` 先变，内容后到。
   * 中间那一小段时间里 `bodyRef` 装的还是上一篇 —— 这会儿要是存盘，
   * 存的就是「上一篇的正文，写进新那篇的文件」。
   * 读失败的话这段时间是**永久的**。
   *
   * 判断本身在 split.ts 的 `safeToSave()`，那儿有测试钉着。
   */
  const loadedFor = useRef<string | null>(null)
  const timer = useRef(0)

  const path = right?.path ?? ''
  const saves = rightSaves(mode)
  const isScratch = rightPersistsScratch(mode)

  /*
   * 读内容。
   *
   * 共享模式**不读盘** —— 左边可能有还没存的改动，从盘上读会拿到旧的，
   * 于是两边一开始就不一致，那根线只会把这个不一致一直传下去。
   */
  useEffect(() => {
    let dead = false
    setReady(false)
    /*
     * 手里这份**先作废**。
     *
     * 从这一刻起到新内容读回来之前，`bodyRef` 装的是上一篇的正文，
     * 而 `path` 已经是新那篇了 —— 这段时间里一个字都不许往盘上写。
     * 读回来才重新认领；读失败就一直是 null，那正是我们要的。
     */
    loadedFor.current = null
    if (mode === 'scratch') {
      setBody(props.scratch)
      bodyRef.current = props.scratch
      loadedFor.current = path
      setErr('')
      setReady(true)
      return
    }
    if (mode === 'shared') {
      setBody(sharedBody)
      bodyRef.current = sharedBody
      loadedFor.current = path
      setErr('')
      setReady(true)
      return
    }
    if ((mode !== 'own' && mode !== 'ref') || !path) {
      setBody('')
      bodyRef.current = ''
      return
    }
    void (async () => {
      try {
        // 书里的走 readDoc（认元信息、认版本），书外的走 readAnyText（只读一段字）
        const text = mode === 'ref' ? (await api.readAnyText(path)).text : (await api.readDoc(path)).body
        if (dead) return
        setBody(text)
        bodyRef.current = text
        // 认领：从这儿起，手里这份就是 path 那一篇了，可以往它身上存
        loadedFor.current = path
        setErr('')
        setReady(true)
      } catch (e) {
        if (dead) return
        /*
         * 读不到就**一直不认领**。
         *
         * 手里还是上一篇的正文，此后任何一次存盘都会把它写进这一篇 ——
         * 一篇稿子被另一篇整个覆盖，不报错、不提示。
         *
         * `ready` 也一直是假：手里那份是上一篇的，摆出来只会更让人糊涂
         * （标题写着这一篇，正文却是上一篇的）。界面那边看 `err` 决定
         * 显示「读着…」还是这条错。
         */
        setErr(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      dead = true
    }
    // sharedBody 故意不进依赖：它每敲一个字都在变，进了会把右边整份重置，
    // 光标当场跳回开头。共享之后内容靠那根线走，不靠这个 effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, path])

  /*
   * 把这一半有多少字**报出去**。顶栏那个数数的是有光标的那一篇
   * （见 split.ts 的 countsSide），右边这一份是它的另一半来源。
   *
   * `ready` 之前一律报空串 —— 那会儿 `body` 装的还是上一篇的正文，
   * 拿它去凑合计就是个假数，而且它会在读完的那一瞬跳一下。
   * 宁可少算，不可乱算。
   */
  useEffect(() => {
    props.onBodyChange(ready ? body : '')
    // props 每次渲染都是新的，进依赖会每帧重报一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, ready])

  const flush = useCallback(async () => {
    if (!safeToSave(mode, loadedFor.current, path)) return
    window.clearTimeout(timer.current)
    try {
      await api.saveDoc(path, bodyRef.current)
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [mode, path])

  /*
   * 关掉/换文档之前把没存的存了。不然拖一下分隔线换个文档，刚写的就没了。
   *
   * cleanup 拿的是**上一次渲染**的 mode/path，而 `loadedFor` 是 ref，
   * 拿的是此刻的值 —— 这正好是我们要问的那个问题：
   * 「手里这份，是不是就是我要往上存的那一篇？」
   */
  useEffect(() => {
    return () => {
      if (safeToSave(mode, loadedFor.current, path)) void api.saveDoc(path, bodyRef.current)
    }
  }, [mode, path])

  const onChange = useCallback(
    (next: string) => {
      bodyRef.current = next
      // 敲字不走 `body` 那个 state（那是只在换文档时才动的），所以这儿单独报一次
      props.onBodyChange(next)
      if (isScratch) {
        // 便笺存进配置，节流一下 —— 每敲一个字写一次盘太蠢
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => props.onScratchChange(next), 600)
        return
      }
      if (!saves) return
      setDirty(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saves, isScratch, flush],
  )

  /*
   * 拖一个文件进来。
   *
   * 比「点按钮弹文件框」顺手得多 —— 作者手边那份参考多半正开在
   * 资源管理器里，拖过来是一个动作，而弹框要点四五下。
   *
   * 路径要问 preload 要（`webUtils.getPathForFile`）—— 渲染进程里
   * 那个 `File.path` 在 Electron 32 就删了，读到的永远是 undefined。
   */
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      /*
       * ⚠️ **第一行就得拦，不能等判断完再拦。**
       *
       * `onDragOver` 已经 preventDefault 放行了投放，这里再不拦，
       * Chromium 就执行默认行为：**把窗口导航到那个 file:// 去**，
       * 整个不咕鸟界面被这个文件顶掉，只能重启。
       * 从前那个写法把 preventDefault 摆在早退之后，
       * 于是「拿不到路径」这条最常见的路正好是最惨的那条。
       */
      e.preventDefault()
      /*
       * 拖进来的可能是一张便利贴 —— 它不是文件，别拿去当参考文档读。
       *
       * 贴哪儿由**鼠标放开的位置**说了算，右半边跟左半边一视同仁：
       * 便利贴浮在整个窗口上，本来就不属于哪一半。
       */
      if (dropKind(e) === 'sticky') {
        props.onStickyDrop(stickyCardOf(e), e.clientX, e.clientY)
        return
      }
      const f = e.dataTransfer.files[0]
      if (!f) return
      const p = api.pathForFile(f)
      // 拖的是目录、是网页里的一段选区 —— 都没有硬盘路径。
      // 说一声，别让作者以为软件没反应
      if (!p) {
        props.onDropUnsupported()
        return
      }
      props.onDropFile(p)
    },
    [props],
  )

  return (
    <div
      className="side-pane"
      onDragOver={(e) => {
        // 文件（当参考摆进来）和便利贴（贴在落点上）都接。
        // 别的一概不接 —— 尤其别接 text/plain，那会让 CodeMirror
        // 把拖过来的字当正文插进去（0.3 踩过这一枪，见 sticky-drag.ts）
        if (dropKind(e) !== 'none') {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={onDrop}
    >
      <div className="side-head">
        <span className="side-title" title={path}>
          {title || '（空的）'}
        </span>
        {mode === 'shared' && (
          // 说清楚这不是第二份 —— 不然「我改了两遍」这种误会很容易发生
          <span className="side-tag">同一篇</span>
        )}
        {mode === 'ref' && (
          // 说清楚为什么敲不进字。不说的话作者会以为是坏了
          <span className="side-tag" title="书外面的文件只给看，不改也不存">
            只读
          </span>
        )}
        {mode === 'scratch' && <span className="side-tag">便笺</span>}
        {saves && dirty && <span className="side-tag">未保存</span>}
        <button className="side-btn" onClick={props.onPickDoc} title="换一份">
          换
        </button>
        <button className="side-btn" onClick={props.onClose} title="关掉右边">
          ✕
        </button>
      </div>

      {err && <div className="side-err">{err}</div>}

      <div className="side-body">
        {!ready && path && mode !== 'empty' && mode !== 'scratch' ? (
          /*
           * 读不到 ≠ 还在读。
           *
           * 从前这两种都显示「读着…」，于是一个读失败的右半边会**永远**
           * 转着圈 —— 错误条在上面挂着，正文这一格却还在说「快好了」，
           * 两句话互相矛盾，作者只能猜哪句是真的。
           */
          <div className="side-empty">{err ? '这一篇打不开。' : '读着…'}</div>
        ) : mode === 'empty' || (!path && mode !== 'scratch') ? (
          /*
           * 空着的时候，三条路都摆在明面上。
           *
           * 这一格本身就是投放区和粘贴区 —— 说出来，
           * 不然没人会想到「原来能往这儿拖」。
           */
          <div
            className="side-empty"
            tabIndex={0}
            onPaste={(e) => {
              const t = e.clipboardData.getData('text/plain')
              if (!t.trim()) return
              e.preventDefault()
              props.onPasteScratch(t)
            }}
          >
            <p>右边还空着。</p>
            <p className="side-empty-how">
              把文件拖进来，或者点一下这儿直接粘一段字。
            </p>
            <button className="btn" onClick={props.onPickDoc}>
              挑本书里的一篇
            </button>
          </div>
        ) : (
          <Boom where="右边这半">
            <Editor
              // 换文档要整个重建：撤销历史、那根线都得跟着换
              key={`${mode}:${path}`}
              docPath={path || 'scratch'}
              initialBody={body}
              link={mode === 'shared' ? link : null}
              // 右半边比左边晚建好，抢焦点会把正在写字的人的光标偷走
              autoFocus={false}
              // 副稿纸不顶 id="write" —— 一个页面里 id 不能有两个
              primary={false}
              readOnly={mode === 'ref'}
              onChange={onChange}
              onEdit={props.onEdit}
              onCaretMove={props.onCaretMove}
              onFocus={props.onFocus}
              onSaveRequest={() => void flush()}
              writing={props.writing}
              script={props.script}
              cast={props.cast}
              onWikiLink={props.onWikiLink}
            />
          </Boom>
        )}
      </div>
    </div>
  )
}
