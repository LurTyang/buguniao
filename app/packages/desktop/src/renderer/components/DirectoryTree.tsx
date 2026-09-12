/**
 * 右侧边栏的目录树 —— 正文 / 大纲 / 设定集。
 *
 * 支持右键菜单（重命名、删除、换卷）与同层拖拽排序。
 *
 * 一条交互约定：**拖拽只在同一层级内生效**。跨卷移动走右键菜单的
 * 「移到其他卷」，因为拖着一章跨过整个卷列表既难瞄准又容易误放，
 * 而误放的代价是作者以为章节丢了。
 */

import { useState, type DragEvent } from 'react'
import type { BookTree, ChapterNode, TextNode, VolumeNode } from '@bugu/core'
import type { MenuItem } from './ContextMenu.js'
import { startStickyDrag } from '../sticky-drag.js'
import { startDocDrag, startRowDrag } from '../doc-drag.js'

export interface TreeActions {
  open(path: string): void
  rename(path: string, kind: 'doc' | 'volume', currentTitle: string): void
  trash(path: string, title: string): void
  newChapter(dir: string): void
  newVolume(): void
  moveToVolume(path: string, title: string): void
  reveal(path: string): void
  reorder(dir: string, from: number, to: number): void
  newSettingCategory(): void
  newSettingCard(categoryPath: string, categoryName: string): void
  editTemplate(categoryPath: string): void
  renameSettingCategory(categoryPath: string, name: string): void
  trashSettingCategory(categoryPath: string, name: string): void
}

interface DragState {
  dir: string
  index: number
}

// ───────────────────────── 正文 ─────────────────────────

export function TextTree({
  tree,
  activePath,
  actions,
  onMenu,
}: {
  tree: BookTree
  activePath: string | null
  actions: TreeActions
  onMenu(e: DragEvent | React.MouseEvent, items: MenuItem[]): void
}) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const textDir = `${tree.rootPath}/正文`

  /**
   * @param doc 这一行是不是一篇能打开的文档。卷是 false ——
   *   它只能在目录里排序，不能被拖进双屏那个虚线框（见 doc-drag.ts）
   */
  const dragProps = (dir: string, index: number, key: string, doc: boolean) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      /*
       * ⚠️ **从前这儿放的是 `text/plain`（内容是这一章的路径）。**
       *
       * 稿纸里坐着一个 CodeMirror，它认 text/plain —— 于是把一章从目录里
       * 拖到稿纸上，`正文/第三章.md` 这一串就被当成正文插进了作者的稿子，
       * 不报错、不提示。跟 0.3 那个便利贴的 bug 是同一个，换了个入口。
       *
       * 现在放的是自定义类型：谁听得懂谁接，别人一概听不见。
       */
      if (doc) startDocDrag(e, key)
      else startRowDrag(e)
      setDrag({ dir, index })
    },
    onDragEnd: () => {
      setDrag(null)
      setOver(null)
    },
    onDragOver: (e: DragEvent) => {
      if (!drag || drag.dir !== dir) return // 只允许同层拖拽
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setOver(key)
    },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      setOver(null)
      if (!drag || drag.dir !== dir || drag.index === index) return
      actions.reorder(dir, drag.index, index)
      setDrag(null)
    },
    'data-over': over === key ? 'true' : undefined,
  })

  const chapterMenu = (c: ChapterNode): MenuItem[] => [
    { label: '打开', onClick: () => actions.open(c.path) },
    { label: '重命名…', onClick: () => actions.rename(c.path, 'doc', c.title), separatorBefore: true },
    { label: '移到其他卷…', onClick: () => actions.moveToVolume(c.path, c.title) },
    { label: '在资源管理器中显示', onClick: () => actions.reveal(c.path) },
    {
      label: '删除（移入回收站）',
      onClick: () => actions.trash(c.path, c.title),
      danger: true,
      separatorBefore: true,
    },
  ]

  const volumeMenu = (v: VolumeNode): MenuItem[] => [
    { label: '在这一卷里新建章节…', onClick: () => actions.newChapter(v.path) },
    { label: '重命名…', onClick: () => actions.rename(v.path, 'volume', v.title), separatorBefore: true },
    { label: '在资源管理器中显示', onClick: () => actions.reveal(v.path) },
  ]

  if (tree.text.length === 0) {
    return (
      <>
        <div className="empty-hint">还没有章节。</div>
        <button className="tree-item" onClick={() => actions.newChapter(textDir)}>
          <span className="tree-caret">+</span>
          <span className="name">新建第一章</span>
        </button>
      </>
    )
  }

  return (
    <>
      {tree.text.map((node: TextNode, i) =>
        node.kind === 'volume' ? (
          <div key={node.path}>
            <div
              className="tree-item tree-volume"
              {...dragProps(textDir, i, node.path, false)}
              onContextMenu={(e) => onMenu(e, volumeMenu(node))}
            >
              <span className="tree-caret">▾</span>
              <span className="name">{node.title}</span>
              <button
                className="icon-btn"
                style={{ marginLeft: 'auto' }}
                title="在这一卷里新建章节"
                onClick={() => actions.newChapter(node.path)}
              >
                +
              </button>
            </div>
            {node.chapters.map((c, ci) => (
              <button
                key={c.path}
                className={`tree-item tree-chapter${c.path === activePath ? ' active' : ''}`}
                title={c.title}
                onClick={() => actions.open(c.path)}
                onContextMenu={(e) => onMenu(e, chapterMenu(c))}
                {...dragProps(node.path, ci, c.path, true)}
              >
                <span className="name">{c.title}</span>
              </button>
            ))}
          </div>
        ) : (
          <button
            key={node.path}
            className={`tree-item${node.path === activePath ? ' active' : ''}`}
            title={node.title}
            onClick={() => actions.open(node.path)}
            onContextMenu={(e) => onMenu(e, chapterMenu(node))}
            {...dragProps(textDir, i, node.path, true)}
          >
            <span className="name">{node.title}</span>
          </button>
        ),
      )}

      <div className="tree-actions">
        <button className="icon-btn" onClick={() => actions.newChapter(textDir)}>
          + 章节
        </button>
        <button className="icon-btn" onClick={actions.newVolume}>
          + 卷
        </button>
      </div>
    </>
  )
}

// ───────────────────────── 设定集 ─────────────────────────

export function SettingsTree({
  tree,
  activePath,
  actions,
  onMenu,
}: {
  tree: BookTree
  activePath: string | null
  actions: TreeActions
  onMenu(e: React.MouseEvent, items: MenuItem[]): void
}) {
  const cardMenu = (path: string, title: string): MenuItem[] => [
    { label: '打开', onClick: () => actions.open(path) },
    { label: '重命名…', onClick: () => actions.rename(path, 'doc', title), separatorBefore: true },
    { label: '在资源管理器中显示', onClick: () => actions.reveal(path) },
    {
      label: '删除（移入回收站）',
      onClick: () => actions.trash(path, title),
      danger: true,
      separatorBefore: true,
    },
  ]

  const empty = tree.settings.length === 0 && tree.looseSettings.length === 0

  return (
    <>
      {empty && (
        <div className="empty-hint">
          还没有设定。
          <br />
          先建一个分类（比如「人物」），
          <br />
          每个分类可以有自己的模板。
        </div>
      )}

      {tree.settings.map((c) => (
        <div key={c.path}>
          <div
            className="tree-item tree-volume"
            onContextMenu={(e) =>
              onMenu(e, [
                { label: '新建便利贴…', onClick: () => actions.newSettingCard(c.path, c.name) },
                {
                  label: '编辑本类模板',
                  onClick: () => actions.editTemplate(c.path),
                  separatorBefore: true,
                },
                {
                  label: '重命名分类…',
                  onClick: () => actions.renameSettingCategory(c.path, c.name),
                },
                { label: '在资源管理器中显示', onClick: () => actions.reveal(c.path) },
                {
                  label: '删除整个分类…',
                  danger: true,
                  separatorBefore: true,
                  onClick: () => actions.trashSettingCategory(c.path, c.name),
                },
              ])
            }
          >
            <span className="tree-caret">▾</span>
            <span className="name">{c.name}</span>
            <span className="faint tree-count">{c.cards.length}</span>
            <button
              className="icon-btn"
              title={`在「${c.name}」里新建便利贴`}
              onClick={() => actions.newSettingCard(c.path, c.name)}
            >
              +
            </button>
          </div>
          {c.cards.map((card) => (
            <button
              key={card.path}
              className={`tree-item tree-chapter sticky-draggable${card.path === activePath ? ' active' : ''}`}
              onClick={() => actions.open(card.path)}
              onContextMenu={(e) => onMenu(e, cardMenu(card.path, card.title))}
              /*
               * 一张卡片有两个身份，拖出去的时候两个都带上：
               * 拖到稿纸上是**一张悬浮便利贴**，拖进侧边栏那个虚线框是
               * **摆到右半边对照的一篇**。靠类型分，不靠落点猜。
               */
              draggable
              onDragStart={(e) => {
                startStickyDrag(e, card.path)
                startDocDrag(e, card.path)
              }}
              title={`${card.title}（拖到稿纸上贴一张；拖进侧边栏的虚线框摆到右半边）`}
            >
              <span className="name">{card.title}</span>
            </button>
          ))}
        </div>
      ))}

      {tree.looseSettings.map((card) => (
        <button
          key={card.path}
          className={`tree-item sticky-draggable${card.path === activePath ? ' active' : ''}`}
          onClick={() => actions.open(card.path)}
          onContextMenu={(e) => onMenu(e, cardMenu(card.path, card.title))}
          draggable
          onDragStart={(e) => {
            startStickyDrag(e, card.path)
            startDocDrag(e, card.path)
          }}
          title={`${card.title}（拖到稿纸上贴一张；拖进侧边栏的虚线框摆到右半边）`}
        >
          <span className="name">{card.title}</span>
        </button>
      ))}

      <div className="tree-actions">
        <button className="icon-btn" onClick={actions.newSettingCategory}>
          + 分类
        </button>
      </div>
    </>
  )
}

// ───────────────────────── 大纲 ─────────────────────────

export function OutlineTree({
  tree,
  activePath,
  actions,
  onMenu,
}: {
  tree: BookTree
  activePath: string | null
  actions: TreeActions
  onMenu(e: React.MouseEvent, items: MenuItem[]): void
}) {
  const dir = `${tree.rootPath}/大纲`

  if (tree.outline.length === 0) {
    return (
      <>
        <div className="empty-hint">
          还没有大纲。
        </div>
        <div className="tree-actions">
          <button className="icon-btn" onClick={() => actions.newChapter(dir)}>
            + 新建大纲
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      {tree.outline.map((o) => (
        <button
          key={o.path}
          className={`tree-item${o.path === activePath ? ' active' : ''}`}
          onClick={() => actions.open(o.path)}
          /*
           * 大纲原来一点都拖不动。而「照着大纲改稿」正是双屏最常见的
           * 一种摆法 —— 让它能拖进虚线框，比让作者去顶栏点开一个
           * 搜索框再把大纲的名字打一遍顺手得多。
           * （这一层没有排序，所以只有拖出去，没有接住）
           */
          draggable
          onDragStart={(e) => startDocDrag(e, o.path)}
          title={`${o.title}（可以拖进侧边栏的虚线框，摆到右半边对照）`}
          onContextMenu={(e) =>
            onMenu(e, [
              { label: '打开', onClick: () => actions.open(o.path) },
              { label: '重命名…', onClick: () => actions.rename(o.path, 'doc', o.title), separatorBefore: true },
              { label: '在资源管理器中显示', onClick: () => actions.reveal(o.path) },
              {
                label: '删除（移入回收站）',
                onClick: () => actions.trash(o.path, o.title),
                danger: true,
                separatorBefore: true,
              },
            ])
          }
        >
          <span className="name">{o.title}</span>
        </button>
      ))}
      <div className="tree-actions">
        <button className="icon-btn" onClick={() => actions.newChapter(dir)}>
          + 新建大纲
        </button>
      </div>
    </>
  )
}
