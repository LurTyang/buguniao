/**
 * 侧边栏最上面那个虚线框 —— 双屏的入口。
 *
 * 规范：更新文档/11-0.5规划.md §1.6
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么要有它】
 *
 * 0.5 preview 里开双屏只有一条路：顶栏那个「双屏」按钮 → 弹出快速跳转框
 * → 搜一下 → 挑一篇。作者的原话是**「过于难用」**，而他是对的：
 * 想对照的那一篇多半**正在目录里摆着**，眼睛已经落在它上面了，
 * 却还要去顶栏点一下、再在另一个框里把它的名字重新打一遍。
 *
 * 所以入口改成一块**看得见的落点**：想对照哪一篇，把它拖过来就行。
 * 这跟 §1.5 里「书外的文件用拖的，不做挑文件按钮」是同一条道理，
 * 只是这回轮到书**里**的文档。
 *
 * 【为什么是虚线】
 *
 * 虚线框在所有软件里都是同一句话：**「这里可以放东西」**。
 * 一个实心按钮不会让人想到往上拖，而这个框八成的用法是拖。
 *
 * 【点一下也得管用】
 *
 * 拖是给「已经看见那一篇」的时候用的。还有两种情形手边什么都没有：
 * 想开一篇新的空白稿、想找一张纸随手记点什么。所以点一下给三条路，
 * 一条都不藏进二级菜单。
 * ─────────────────────────────────────────────────────────────
 */

import { useState } from 'react'
import { useContextMenu } from './ContextMenu.js'
import { splitDropKind, splitDropPath } from '../doc-drag.js'
import type { PaneMode } from '../split.js'

const api = window.bugu

export interface SplitDropProps {
  /** 双屏这会儿的状态。框里那行字跟着它变 */
  mode: PaneMode
  /** 右边摆着的那一篇叫什么。没开双屏时是空串 */
  rightTitle: string
  /** 临时文档里已经有字了没有 —— 菜单那一条的说法得跟着变，见下面 */
  hasScratch: boolean
  /** 拖进来一篇书里的文档，或者从菜单里挑了一篇 */
  onPickDoc(path: string): void
  /** 拖进来一个书外的文件 */
  onDropFile(path: string): void
  /** 拖进来的东西没有硬盘路径（目录、网页选区）。要说一声，不能静默 */
  onDropUnsupported(): void
  onNewBlank(): void
  onScratch(): void
  onChooseChapter(): void
  onClose(): void
}

export function SplitDrop(props: SplitDropProps): React.ReactElement {
  const { mode, rightTitle, hasScratch } = props
  /** 有东西正拖在框上面。整个框亮起来 —— 不亮的话没人敢松手 */
  const [hot, setHot] = useState(false)
  const menu = useContextMenu()
  const on = mode !== 'off'

  /**
   * 菜单**从框底下拉开**，不是从鼠标点的那一点。
   *
   * 右键菜单跟着鼠标走是对的（那是「对这儿的东西动手」），
   * 但这是一个按钮，它的菜单该像所有下拉菜单一样挂在按钮下沿 ——
   * 跟着鼠标走的话，同一个按钮点两次菜单出现在两个地方，
   * 第二次还得重新找一遍那三条在哪儿。
   */
  const openMenu = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    menu.open({ clientX: r.left, clientY: r.bottom + 4, preventDefault: () => {} }, [
      {
        /*
         * 新建一篇真的稿子，摆到右边。
         *
         * 它跟下面那条「临时文档」的区别得在菜单上就说清楚：
         * 这一条**在书里多出一篇**（进目录、进字数、能导出），
         * 那一条不进书。说不清楚的话，作者会拿临时文档写正文，
         * 然后在导出的稿子里找不到它。
         */
        label: '新建空白文档…',
        onClick: props.onNewBlank,
      },
      {
        /*
         * 临时文档就是便笺（`kind: 'scratch'`），存在配置里、不进书。
         *
         * ⚠️ **它只有一张，而且里面的字不能被「新建」悄悄冲掉。**
         * 所以里面已经有字时，这一条改口说「上次那张」——
         * 挂着「新建」的名字却打开一张旧的，作者会以为自己点错了；
         * 而真的清空重来，丢的是他昨天摆在旁边的一段设定。
         */
        label: hasScratch ? '临时文档（上次那张还在）' : '新建临时文档',
        onClick: props.onScratch,
      },
      { label: '选择章节…', onClick: props.onChooseChapter },
      ...(on
        ? [{ label: '关掉双屏', onClick: props.onClose, separatorBefore: true }]
        : []),
    ])
  }

  return (
    <>
      <div
        className={`split-drop${hot ? ' hot' : ''}${on ? ' on' : ''}`}
        role="button"
        tabIndex={0}
        title="把章节、大纲、设定卡拖到这儿，或者点一下选"
        onClick={(e) => openMenu(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          openMenu(e.currentTarget)
        }}
        onDragEnter={() => setHot(true)}
        onDragOver={(e) => {
          if (splitDropKind(e) === 'none') return
          e.preventDefault()
          // copy —— 拖过来是**摆一份到右边**，不是把这一章从目录里搬走。
          // 目录树那边 effectAllowed 写的是 copyMove，两头对得上才会有 drop
          e.dataTransfer.dropEffect = 'copy'
          setHot(true)
        }}
        onDragLeave={(e) => {
          // 框里还有两行字，鼠标从框挪到那两行上时也会触发一次 dragleave。
          // 不判一下的话高亮会一路闪
          if (e.currentTarget.contains(e.relatedTarget as Node)) return
          setHot(false)
        }}
        onDrop={(e) => {
          /*
           * ⚠️ **第一行就得拦。**
           *
           * `onDragOver` 已经放行了投放，这儿再不拦，拖一个硬盘文件进来时
           * Chromium 会执行默认行为 —— 把窗口导航到那个 file:// 去，
           * 整个不咕鸟被这个文件顶掉，只能重启。
           * （SidePane 那边踩过一模一样的一枪，见它的 onDrop。）
           */
          e.preventDefault()
          setHot(false)
          const kind = splitDropKind(e)
          if (kind === 'doc') {
            const p = splitDropPath(e)
            if (p) props.onPickDoc(p)
            return
          }
          if (kind !== 'file') return
          const f = e.dataTransfer.files[0]
          if (!f) return
          // 路径要问 preload 要：渲染进程里那个 File.path 在 Electron 32 就删了
          const p = api.pathForFile(f)
          if (!p) {
            props.onDropUnsupported()
            return
          }
          props.onDropFile(p)
        }}
      >
        <div className="split-drop-title">双屏对照</div>
        <div className="split-drop-hint">
          {on && rightTitle ? (
            <>
              右边：<span className="split-drop-cur">{rightTitle}</span>
            </>
          ) : (
            '把一篇拖进来，或者点一下'
          )}
        </div>
      </div>
      {menu.node}
    </>
  )
}
