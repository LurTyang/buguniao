/**
 * 书架页 —— 软件启动后的第一屏。
 *
 * 规范：更新文档/04-界面与交互设计.md §4
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BookKind, BookStatus, BookSummary } from '@bugu/core'
import type { UserSettings } from '../../shared/api.js'
import { api } from '../api.js'
import { UserRail } from './UserRail.js'
import { SettingsHome } from './SettingsHome.js'
import { ConfirmModal, FormModal, PromptModal } from './Modal.js'
import { useContextMenu, type MenuItem } from './ContextMenu.js'
import { PinIcon } from './Sidebar.js'

/** 三种状态的显示名。「坑啦！哈哈」是作者定的，别改成「已搁置」那种正经词 */
const STATUS_LABEL: Record<BookStatus, string> = {
  serializing: '连载中',
  finished: '完结',
  pit: '坑啦！哈哈',
}

const FILTERS: Array<{ key: 'all' | BookStatus; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'serializing', label: '连载中' },
  { key: 'finished', label: '完结' },
  { key: 'pit', label: '坑啦！哈哈' },
]

/** 无封面时按书名首字生成一个稳定的占位色 */
function placeholderColor(seed: string): string {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.codePointAt(0)!) % 360
  return `hsl(${h} 30% 44%)`
}

/** 三种作品类型。新建时问一次，之后只在书架右键改 */
const KIND_CHOICES: Array<{ value: BookKind; label: string; hint: string }> = [
  { value: 'novel', label: '小说', hint: '一章一篇，首行缩进' },
  { value: 'script', label: '剧本', hint: '场景、角色名、台词' },
  { value: 'game', label: '游戏剧本', hint: '带选项、跳转、分支' },
]

/** 右键菜单上要显示「现在是哪种」，收成一张表省得每次找 */
const KIND_LABEL: Record<BookKind, string> = {
  novel: '小说',
  script: '剧本',
  game: '游戏剧本',
}

type Dialog =
  | { kind: 'create' }
  | { kind: 'idea' }
  | { kind: 'rename'; book: BookSummary }
  | { kind: 'trash'; book: BookSummary }
  | null

export interface ShelfProps {
  root: string
  onOpen(book: BookSummary): void
  onChangeRoot(): void
  /** 由菜单「新建作品」触发 */
  createSignal?: number
  settings: UserSettings
  onSettings(patch: Partial<UserSettings>): void
}

export function Shelf({ root, onOpen, onChangeRoot, createSignal, settings, onSettings }: ShelfProps) {
  const [books, setBooks] = useState<BookSummary[] | null>(null)
  const [covers, setCovers] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<'all' | BookStatus>('all')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 灵感箱里攒了多少条还没归到书里去 */
  const [ideaCount, setIdeaCount] = useState(0)
  const ctx = useContextMenu()

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

  const refresh = useCallback(async () => {
    try {
      const list = await api.listBooks()
      setBooks(list)
      setError(null)

      // 封面逐张读成 data URL；读不到就退回占位色块，不影响书架显示
      const next: Record<string, string> = {}
      await Promise.all(
        list
          .filter((b) => b.meta.cover)
          .map(async (b) => {
            const url = await api.readCover(b.rootPath, b.meta.cover as string).catch(() => null)
            if (url) next[b.rootPath] = url
          }),
      )
      setCovers(next)
      void api
        .listLibraryIdeas()
        .then((xs) => setIdeaCount(xs.length))
        .catch(() => setIdeaCount(0))
    } catch (e) {
      setError(msg(e))
      setBooks([])
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [root, refresh])

  // 菜单里的「新建作品」
  useEffect(() => {
    if (createSignal !== undefined && createSignal > 0) setDialog({ kind: 'create' })
  }, [createSignal])

  const shown = useMemo(
    () => (books ?? []).filter((b) => filter === 'all' || b.meta.status === filter),
    [books, filter],
  )

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(msg(e))
    }
  }

  const bookMenu = (b: BookSummary): MenuItem[] => [
    { label: '打开', onClick: () => onOpen(b) },
    {
      label: b.meta.pinned ? '取消置顶' : '置顶',
      onClick: () => void run(() => api.updateBookMeta(b.rootPath, { pinned: !b.meta.pinned })),
      separatorBefore: true,
    },
    {
      label: '重命名…',
      onClick: () => setDialog({ kind: 'rename', book: b }),
    },
    {
      // 六条互斥选项平铺在这儿，会把「打开」「重命名」这些真正常用的
      // 挤到看不见的地方 —— 收成两个下级菜单，一级菜单才看得过来
      label: `更改书籍格式（${KIND_LABEL[b.meta.kind ?? 'novel']}）`,
      separatorBefore: true,
      submenu: KIND_CHOICES.map((k): MenuItem => {
        const cur = (b.meta.kind ?? 'novel') === k.value
        return {
          label: `${k.label}${cur ? ' ✓' : ''}`,
          disabled: cur,
          // 换格式会换掉整本书的排版规矩，那不该是写到一半顺手点到的东西，
          // 所以只在书架上改，稿纸页里没有这个入口
          onClick: () => void run(() => api.updateBookMeta(b.rootPath, { kind: k.value })),
        }
      }),
    },
    {
      label: `更改书籍状态（${STATUS_LABEL[b.meta.status]}）`,
      submenu: (['serializing', 'finished', 'pit'] as BookStatus[]).map((st): MenuItem => ({
        label: `${STATUS_LABEL[st]}${b.meta.status === st ? ' ✓' : ''}`,
        disabled: b.meta.status === st,
        onClick: () => void run(() => api.updateBookMeta(b.rootPath, { status: st })),
      })),
    },
    {
      label: '更换封面…',
      onClick: () => void run(() => api.pickCover(b.rootPath)),
      separatorBefore: true,
    },
    ...(b.meta.cover
      ? [{ label: '移除封面', onClick: () => void run(() => api.clearBookCover(b.rootPath)) }]
      : []),
    {
      label: '在资源管理器中显示',
      onClick: () => void api.revealInExplorer(b.rootPath).catch((e) => setError(msg(e))),
      separatorBefore: true,
    },
    {
      label: '删除作品…',
      danger: true,
      onClick: () => setDialog({ kind: 'trash', book: b }),
      separatorBefore: true,
    },
  ]

  return (
    <div className="shelf-wrap">
      {/* 左边这一栏刻意做窄。作者原话：「应该不需要占据太多空间。」 */}
      <UserRail onOpenSettings={() => setSettingsOpen(true)} />

      <div className="shelf">
      <div className="shelf-bar">
        <span className="shelf-title">不咕鸟</span>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`shelf-tab${filter === f.key ? ' active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn-ghost icon-btn" title={root} onClick={onChangeRoot}>
            更换目录
          </button>
          <button className="btn btn-primary" onClick={() => setDialog({ kind: 'create' })}>
            新建作品
          </button>
        </div>
      </div>

      {error && (
        <div className="banner danger">
          {error}
          <button
            className="icon-btn"
            style={{ marginLeft: 'auto', color: '#fff' }}
            onClick={() => setError(null)}
          >
            知道了
          </button>
        </div>
      )}

      {books === null ? (
        <div className="empty-hint">正在读取书架……</div>
      ) : (
        <div className="shelf-grid">
          {/*
            灵感箱永远排第一，而且**每个分类里都在**。
            想到一个点子的时候往往还不知道它属于哪本书 ——
            逼着人先挑一本，那个点子多半就飞了。
          */}
          <div
            className="book-card idea-card"
            onClick={() => setDialog({ kind: 'idea' })}
            title="随手记一条，回头再决定它属于哪本书"
          >
            <div className="book-cover idea-cover">
              <span className="idea-mark">灵</span>
              {ideaCount > 0 && <span className="idea-count">{ideaCount}</span>}
            </div>
            <div className="book-name">灵感箱</div>
            <div className="book-meta">
              <span className="book-status">{ideaCount > 0 ? `${ideaCount} 条待归` : '随手记'}</span>
            </div>
          </div>

          {shown.map((b) => (
            <div
              key={b.rootPath}
              className={`book-card${b.meta.pinned ? ' pinned' : ''}`}
              onClick={() => onOpen(b)}
              onContextMenu={(e) => ctx.open(e, bookMenu(b))}
              title="右键有更多操作"
            >
              {covers[b.rootPath] ? (
                <img className="book-cover" src={covers[b.rootPath]} alt="" draggable={false} />
              ) : (
                <div className="book-cover" style={{ background: placeholderColor(b.meta.title) }}>
                  {[...b.meta.title][0]}
                </div>
              )}
              {b.meta.pinned && (
                <span className="book-pin" title="已置顶">
                  <PinIcon filled />
                </span>
              )}
              <div className="book-name">{b.meta.title}</div>
              <div className="book-meta">
                <span className="book-status">{STATUS_LABEL[b.meta.status]}</span>
                {b.meta.author && <span style={{ marginLeft: 6 }}>{b.meta.author}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {ctx.node}

      {dialog?.kind === 'create' && (
        <FormModal
          title="新建作品"
          hint="写哪种东西，格式差得挺远。现在选一下，开局就是对的。"
          fields={[
            { key: 'title', label: '书名', placeholder: '比如「第九神座」' },
            {
              key: 'kind',
              label: '写的是',
              initial: 'novel',
              choices: KIND_CHOICES,
              // 写完三章才发现「原来还有剧本模式」，那时候格式已经写歪了
              hint: '以后想换，回书架右键这本书就能改。',
            },
            {
              key: 'firstChapter',
              label: '第一篇的标题',
              placeholder: '留空就用默认的',
              optional: true,
              hint: '小说默认「第一章」、剧本「第一场」、游戏「第一幕」，随时能改名。',
            },
          ]}
          confirmText="创建"
          onConfirm={(v) => {
            setDialog(null)
            void (async () => {
              try {
                const kind = (v['kind'] || 'novel') as BookKind
                const book = await api.createBook(v['title'] as string, kind)
                const first = (v['firstChapter'] ?? '').trim()
                if (first) {
                  const tree = await api.loadTree(book.rootPath)
                  const ch = tree.text.find((n) => n.kind === 'chapter')
                  if (ch && ch.title !== first) await api.renameDoc(ch.path, first)
                }
                await refresh()
                onOpen(book)
              } catch (e) {
                setError(msg(e))
              }
            })()
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'idea' && (
        <IdeaModal
          onCancel={() => setDialog(null)}
          onSave={(text) => {
            setDialog(null)
            void run(() => api.createLibraryIdea(text))
          }}
        />
      )}

      {dialog?.kind === 'rename' && (
        <PromptModal
          title="重命名作品"
          hint="文件夹名和书名会一起改。"
          initial={dialog.book.meta.title}
          confirmText="改名"
          onConfirm={(v) => {
            const b = dialog.book
            setDialog(null)
            void run(() => api.renameBook(b.rootPath, v))
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'trash' && (
        <ConfirmModal
          title={`删除《${dialog.book.meta.title}》？`}
          body={
            <>
              整个文件夹会移进作品根目录下的 <code>_回收站</code>，
              <b>不是真删</b>。想彻底删除，去那个文件夹里手动删。
            </>
          }
          confirmText="移入回收站"
          danger
          onConfirm={() => {
            const b = dialog.book
            setDialog(null)
            void run(() => api.trashBook(b.rootPath))
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      </div>

      {settingsOpen && (
        <SettingsHome
          root={root}
          onChangeRoot={onChangeRoot}
          onClose={() => setSettingsOpen(false)}
          settings={settings}
          onSettings={onSettings}
        />
      )}
    </div>
  )
}

/**
 * 随手记一条灵感。
 *
 * 刻意只有一个多行框、没有标题、没有分类、没有「属于哪本书」——
 * 灵感是**几秒钟的东西**，多问一个问题它就飞了。
 * 标题回头由第一行凑出来，归到哪本书回头在灵感箱里再说。
 */
function IdeaModal({ onSave, onCancel }: { onSave(text: string): void; onCancel(): void }) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const save = () => {
    const t = text.trim()
    if (t) onSave(t)
    else onCancel()
  }

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal idea-modal">
        <h3>记一条灵感</h3>
        <textarea
          ref={ref}
          className="idea-input"
          placeholder="随意记录你的灵感吧。"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Ctrl+Enter 存下：手不用离开键盘
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save()
          }}
        />
        <div className="modal-hint">
          落在全库共用的 <code>_灵感箱</code> 里，不属于任何一本书。
          <br />
          写作页的「灵感箱」面板能把它归进某一章。
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            算了
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!text.trim()}>
            记下（Ctrl+Enter）
          </button>
        </div>
      </div>
    </div>
  )
}
