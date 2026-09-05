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
import type { PaneMode, RightSide } from '../split.js'
import { rightPersistsScratch, rightSaves } from '../split.js'

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
  /** 换一份 / 关掉 */
  onPickDoc(): void
  onClose(): void
  /** 拖进来一个书外的文件，或者粘进来一段字 */
  onDropFile(path: string): void
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
    if (mode === 'scratch') {
      setBody(props.scratch)
      bodyRef.current = props.scratch
      setErr('')
      setReady(true)
      return
    }
    if (mode === 'shared') {
      setBody(sharedBody)
      bodyRef.current = sharedBody
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
        setErr('')
        setReady(true)
      } catch (e) {
        if (dead) return
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

  const flush = useCallback(async () => {
    if (!saves || !path) return
    window.clearTimeout(timer.current)
    try {
      await api.saveDoc(path, bodyRef.current)
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [saves, path])

  // 关掉/换文档之前把没存的存了。不然拖一下分隔线换个文档，刚写的就没了
  useEffect(() => {
    return () => {
      if (saves && path && bodyRef.current) void api.saveDoc(path, bodyRef.current)
    }
  }, [saves, path])

  const onChange = useCallback(
    (next: string) => {
      bodyRef.current = next
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
   * Electron 里 File 对象带 `path`，所以拿得到真实路径。
   */
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      const f = e.dataTransfer.files[0] as (File & { path?: string }) | undefined
      if (!f?.path) return
      e.preventDefault()
      props.onDropFile(f.path)
    },
    [props],
  )

  return (
    <div
      className="side-pane"
      onDragOver={(e) => {
        // 只在拖的是文件时接管。拖便利贴那种有它自己的一套
        if (e.dataTransfer.types.includes('Files')) {
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
          <div className="side-empty">读着…</div>
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
