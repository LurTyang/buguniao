/**
 * 伏笔面板。
 *
 * 规范：更新文档/05-功能模块详述.md §5
 *
 * 默认只看未回收的 —— 那才是需要惦记的。清单上最有用的一列是
 * 「已经过去多少章」：埋了八十章还没收的东西一眼就能看见。
 */

import { useCallback, useEffect, useState } from 'react'
import type { ForeshadowListItem, ForeshadowPriority } from '@bugu/core'
import { api } from '../api.js'
import { ForeshadowLines } from './ForeshadowLines.js'

type Tab = 'pending' | 'all' | 'recovered' | 'lines'

const PRIORITY_LABEL: Record<ForeshadowPriority, string> = {
  high: '重要',
  normal: '普通',
  low: '次要',
}

const STATUS_LABEL: Record<string, string> = {
  planned: '只记了，还没写进正文',
  planted: '已埋',
  recovered: '已收',
  abandoned: '放弃',
}

export interface ForeshadowPanelProps {
  bookPath: string
  currentDocId: string | null
  /** 编辑器里有没有选中文本，决定「把选中文本标为伏笔」能不能点 */
  hasSelection: boolean
  onPlant(id: string): void
  onRecover(id: string): void
  onOpen(path: string): void
  /** 清单变了通知外面（顶栏的到期提示条要跟着更新） */
  onChanged(): void
  /** 拿来把 plantedIn 的文档 id 换成能点的章节 */
  docPathById: Map<string, { path: string; title: string }>
  refreshKey: number
}

export function ForeshadowPanel({
  bookPath,
  currentDocId,
  hasSelection,
  onPlant,
  onRecover,
  onOpen,
  onChanged,
  docPathById,
  refreshKey,
}: ForeshadowPanelProps) {
  const [items, setItems] = useState<ForeshadowListItem[] | null>(null)
  /** 连线图要按全书章节顺序画横轴 */
  const [chapters, setChapters] = useState<Array<{ id: string; path: string; title: string }>>([])
  const [tab, setTab] = useState<Tab>('pending')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await api.listForeshadows(bookPath, currentDocId ?? undefined)
      setItems(r.items)
      setChapters(r.chapters)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setItems([])
    }
  }, [bookPath, currentDocId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const shown = (items ?? []).filter((f) =>
    tab === 'pending'
      ? f.status === 'planned' || f.status === 'planted'
      : tab === 'recovered'
        ? f.status === 'recovered'
        : true,
  )

  const patch = async (id: string, changes: Record<string, unknown>) => {
    try {
      await api.patchForeshadow(bookPath, id, changes)
      await load()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="fs-panel">
      <div className="fs-tabs">
        {(
          [
            ['pending', '未回收'],
            ['recovered', '已回收'],
            ['all', '全部'],
            ['lines', '连线'],
          ] as Array<[Tab, string]>
        ).map(([k, label]) => (
          <button key={k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {error && <div className="search-error">{error}</div>}

      {/*
        作者当初的原话：「希望在大纲列表可以看到伏笔连线……或许做个开关最好？」
        做成一个页签就是那个开关 —— 平时看清单，想看全局时切过来。
      */}
      {tab === 'lines' && (
        <ForeshadowLines
          foreshadows={items ?? []}
          chapters={chapters}
          onJump={(id) => {
            const c = chapters.find((x) => x.id === id)
            if (c) onOpen(c.path)
          }}
        />
      )}

      <div className="fs-actions">
        <button className="btn" onClick={() => setCreating(true)} style={{ flex: 1 }}>
          先记一个
        </button>
      </div>
      <div className="fs-hint">
        「先记一个」是还没写进正文的构思；写到了再选中正文按 <kbd>Ctrl+E</kbd> 关联上。
      </div>

      {creating && (
        <NewForeshadow
          onCancel={() => setCreating(false)}
          onSubmit={async (input) => {
            setCreating(false)
            try {
              await api.addForeshadow(bookPath, input)
              await load()
              onChanged()
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            }
          }}
        />
      )}

      {tab === 'lines' ? null : items === null ? (
        <div className="empty-hint">正在读……</div>
      ) : shown.length === 0 ? (
        <div className="empty-hint">
          {tab === 'pending' ? (
            <>
              没有未回收的伏笔。
            </>
          ) : (
            '这里是空的。'
          )}
        </div>
      ) : (
        <div className="fs-list">
          {shown.map((f) => {
            const planted = f.plantedIn ? docPathById.get(f.plantedIn) : undefined
            return (
              <div key={f.id} className={`fs-item p-${f.priority}`}>
                <div className="fs-item-head">
                  <span className="fs-title">{f.title || '（没写标题）'}</span>
                  {f.chaptersElapsed !== null && f.status !== 'recovered' && (
                    <span
                      className={`fs-elapsed${f.chaptersElapsed >= 30 ? ' warn' : ''}`}
                      title="从埋下到现在过了多少章"
                    >
                      已过 {f.chaptersElapsed} 章
                    </span>
                  )}
                </div>

                {f.desc && <div className="fs-desc">{f.desc}</div>}

                <div className="fs-meta">
                  <span>{STATUS_LABEL[f.status] ?? f.status}</span>
                  <span>· {PRIORITY_LABEL[f.priority]}</span>
                  {f.expectBy && <span>· 计划收于 {f.expectBy}</span>}
                </div>

                <div className="fs-item-actions">
                  {planted && (
                    <button onClick={() => onOpen(planted.path)} title={planted.title}>
                      去埋点
                    </button>
                  )}
                  {f.status !== 'recovered' && (
                    <>
                      <button
                        disabled={!hasSelection}
                        title={hasSelection ? '把选中的正文标为埋点' : '先在正文里选中一段'}
                        onClick={() => onPlant(f.id)}
                      >
                        标为埋点
                      </button>
                      <button
                        disabled={!hasSelection}
                        title={hasSelection ? '把选中的正文标为回收' : '先在正文里选中一段'}
                        onClick={() => onRecover(f.id)}
                      >
                        标为回收
                      </button>
                    </>
                  )}
                  {f.status === 'recovered' && (
                    <button onClick={() => void patch(f.id, { status: 'planted' })}>撤销回收</button>
                  )}
                  <button
                    className="danger"
                    onClick={() => void patch(f.id, { status: 'abandoned' })}
                    title="不打算写了"
                  >
                    放弃
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function NewForeshadow({
  onSubmit,
  onCancel,
}: {
  onSubmit(input: { title: string; desc: string; expectBy: string | null; priority: ForeshadowPriority }): void
  onCancel(): void
}) {
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [expectBy, setExpectBy] = useState('')
  const [priority, setPriority] = useState<ForeshadowPriority>('normal')

  return (
    <div className="fs-new">
      <input
        autoFocus
        placeholder="伏笔标题，比如「沈家玉佩」"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        placeholder="给自己的备忘：这个伏笔是什么、打算怎么收"
        value={desc}
        rows={3}
        onChange={(e) => setDesc(e.target.value)}
      />
      <input
        placeholder="大致什么时候收（比如「第三卷」，随便写）"
        value={expectBy}
        onChange={(e) => setExpectBy(e.target.value)}
      />
      <div className="segmented" style={{ marginBottom: 8 }}>
        {(['high', 'normal', 'low'] as ForeshadowPriority[]).map((p) => (
          <button key={p} className={priority === p ? 'on' : ''} onClick={() => setPriority(p)}>
            {PRIORITY_LABEL[p]}
          </button>
        ))}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onCancel}>
          取消
        </button>
        <button
          className="btn btn-primary"
          disabled={!title.trim()}
          onClick={() =>
            onSubmit({
              title: title.trim(),
              desc: desc.trim(),
              expectBy: expectBy.trim() || null,
              priority,
            })
          }
        >
          记下
        </button>
      </div>
    </div>
  )
}
