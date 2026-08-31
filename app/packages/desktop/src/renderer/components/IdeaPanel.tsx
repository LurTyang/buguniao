/**
 * 灵感箱。
 *
 * 规范：更新文档/05-功能模块详述.md §1（手机端记的碎片在这里落地）
 *
 * 手机端只新建碎片、不改正文，所以碎片天然不会冲突。
 * 回到电脑上，这里负责把它们「归入」到某一章或某张便利贴。
 */

import { useCallback, useEffect, useState } from 'react'
import type { BookTree } from '@bugu/core'
import { api } from '../api.js'
import { ChoiceModal, ConfirmModal } from './Modal.js'

interface Idea {
  path: string
  title: string
  body: string
  created: string
  scope: 'book' | 'inbox'
}

export interface IdeaPanelProps {
  bookPath: string
  tree: BookTree | null
  /** 归入当前打开的文档后，把新正文推回编辑器 */
  onMergedInto(path: string, body: string): void
  onOpen(path: string): void
  refreshKey: number
}

export function IdeaPanel({ bookPath, tree, onMergedInto, onOpen, refreshKey }: IdeaPanelProps) {
  const [ideas, setIdeas] = useState<Idea[] | null>(null)
  const [dialog, setDialog] = useState<{ kind: 'merge' | 'trash'; idea: Idea } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

  const load = useCallback(async () => {
    try {
      setIdeas(await api.listIdeas(bookPath))
      setError(null)
    } catch (e) {
      setError(msg(e))
      setIdeas([])
    }
  }, [bookPath])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  /** 归入目标：所有章节 + 所有便利贴 */
  const targets = tree
    ? [
        ...tree.text.flatMap((n) =>
          n.kind === 'volume'
            ? n.chapters.map((c) => ({ value: c.path, label: `${n.title} › ${c.title}` }))
            : [{ value: n.path, label: n.title }],
        ),
        ...tree.outline.map((o) => ({ value: o.path, label: `大纲 › ${o.title}` })),
        ...tree.settings.flatMap((cat) =>
          cat.cards.map((c) => ({ value: c.path, label: `${cat.name} › ${c.title}` })),
        ),
      ]
    : []

  const jot = () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    void api
      .createIdea(bookPath, text)
      .then(load)
      .catch((e) => setError(msg(e)))
  }

  return (
    <div className="idea-panel">
      <div className="idea-jot">
        <textarea
          rows={2}
          placeholder="随手记一条……（Ctrl+Enter 存下）"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              jot()
            }
          }}
        />
        <button className="btn" disabled={!draft.trim()} onClick={jot}>
          存下
        </button>
      </div>

      {error && <div className="search-error">{error}</div>}

      {ideas === null ? (
        <div className="empty-hint">正在读……</div>
      ) : ideas.length === 0 ? (
        <div className="empty-hint">
          还没有灵感碎片。
          <br />
          手机端记下的东西会出现在这里。
        </div>
      ) : (
        <>
          <div className="fs-hint">
            共 {ideas.length} 条。「归入」会把内容追加到目标文档末尾，
            碎片进回收站（归错了还能捞回来）。
          </div>
          <div className="idea-list">
            {ideas.map((idea) => (
              <div key={idea.path} className="idea-item">
                <div className="idea-head">
                  <span className="idea-time">{fmtDate(idea.created)}</span>
                  {idea.scope === 'inbox' && (
                    <span className="idea-badge" title="记的时候没选作品，放在库根目录的 _灵感箱">
                      未归属
                    </span>
                  )}
                </div>
                <div className="idea-body">{idea.body || <span className="faint">（空的）</span>}</div>
                <div className="idea-actions">
                  <button onClick={() => setDialog({ kind: 'merge', idea })} disabled={targets.length === 0}>
                    归入…
                  </button>
                  <button onClick={() => onOpen(idea.path)}>打开</button>
                  <button className="danger" onClick={() => setDialog({ kind: 'trash', idea })}>
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {dialog?.kind === 'merge' && (
        <ChoiceModal
          title="归入哪一篇？"
          hint="内容会追加到那篇文档的末尾。"
          options={targets}
          emptyText="这本书还没有可以归入的文档。"
          onConfirm={(target) => {
            const idea = dialog.idea
            setDialog(null)
            void (async () => {
              try {
                const r = await api.mergeIdea(bookPath, idea.path, target)
                await load()
                onMergedInto(target, r.body)
              } catch (e) {
                setError(msg(e))
              }
            })()
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'trash' && (
        <ConfirmModal
          title="删掉这条灵感？"
          body="会移进回收站，不是真删。"
          confirmText="移入回收站"
          danger
          onConfirm={() => {
            const idea = dialog.idea
            setDialog(null)
            void api
              .trashIdea(bookPath, idea.path)
              .then(load)
              .catch((e) => setError(msg(e)))
          }}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  )
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
