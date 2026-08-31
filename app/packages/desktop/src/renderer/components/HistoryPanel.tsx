/**
 * 版本历史面板。
 *
 * 规范：更新文档/05-功能模块详述.md §7
 *
 * 两条不肯将就的：
 *   - **回滚本身也产生一条新版本**，所以回滚可以再撤销
 *   - 容量到上限时**暂停写新历史并提示**，绝不静默删除任何历史
 */

import { useCallback, useEffect, useState } from 'react'
import { formatCount, type CapacityStatus, type HistoryEntry } from '@bugu/core'
import { api } from '../api.js'
import { ConfirmModal, PromptModal } from './Modal.js'

type Capacity = CapacityStatus & { limitMB: number }

export interface HistoryPanelProps {
  bookPath: string
  docId: string | null
  docPath: string | null
  docTitle: string
  /** 回滚后把新正文推回编辑器 */
  onRolledBack(body: string): void
  /** 每次保存后递增，用来重新拉列表 */
  refreshKey: number
}

export function HistoryPanel({
  bookPath,
  docId,
  docPath,
  docTitle,
  onRolledBack,
  refreshKey,
}: HistoryPanelProps) {
  const [versions, setVersions] = useState<HistoryEntry[] | null>(null)
  const [capacity, setCapacity] = useState<Capacity | null>(null)
  const [onlyLabeled, setOnlyLabeled] = useState(false)
  const [preview, setPreview] = useState<{ v: number; text: string } | null>(null)
  const [dialog, setDialog] = useState<{ kind: 'rollback' | 'label' | 'prune'; v?: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

  const load = useCallback(async () => {
    if (!docId) {
      setVersions([])
      return
    }
    try {
      const [list, cap] = await Promise.all([
        api.listVersions(bookPath, docId),
        api.historyCapacity(bookPath),
      ])
      setVersions([...list].reverse()) // 最近的在上面
      setCapacity(cap)
      setError(null)
    } catch (e) {
      setError(msg(e))
      setVersions([])
    }
  }, [bookPath, docId])

  useEffect(() => {
    void load()
    setPreview(null)
  }, [load, refreshKey])

  const shown = (versions ?? []).filter((v) => !onlyLabeled || v.label)

  const showPreview = async (v: number) => {
    if (!docId) return
    if (preview?.v === v) {
      setPreview(null)
      return
    }
    try {
      setPreview({ v, text: await api.readVersion(bookPath, docId, v) })
    } catch (e) {
      setError(msg(e))
    }
  }

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await load()
    } catch (e) {
      setError(msg(e))
    }
  }

  if (!docId) return <div className="empty-hint">先打开一篇文档。</div>

  return (
    <div className="hist-panel">
      {capacity && <CapacityBar cap={capacity} onPrune={() => setDialog({ kind: 'prune' })} />}

      {error && <div className="search-error">{error}</div>}

      <div className="hist-head">
        <span className="faint">{docTitle}</span>
        <label className="hist-filter">
          <input
            type="checkbox"
            checked={onlyLabeled}
            onChange={(e) => setOnlyLabeled(e.target.checked)}
          />
          只看带标记的
        </label>
      </div>

      {versions === null ? (
        <div className="empty-hint">正在读……</div>
      ) : shown.length === 0 ? (
        <div className="empty-hint">
          {onlyLabeled ? '还没有打过标记的版本。' : '这篇还没有历史记录。写点什么再保存试试。'}
        </div>
      ) : (
        <div className="hist-list">
          {shown.map((v) => (
            <div key={v.v} className={`hist-item${preview?.v === v.v ? ' open' : ''}`}>
              <button className="hist-row" onClick={() => void showPreview(v.v)}>
                <span className="hist-time">{formatTime(v.ts)}</span>
                <span className={`hist-delta ${v.delta >= 0 ? 'up' : 'down'}`}>
                  {v.delta >= 0 ? '+' : ''}
                  {formatCount(v.delta)}
                </span>
                <span className="hist-chars">{formatCount(v.chars)} 字</span>
                {v.label && <span className="hist-label">{v.label}</span>}
              </button>

              {preview?.v === v.v && (
                <div className="hist-preview">
                  <pre>{preview.text.slice(0, 3000) || '（这一版是空的）'}</pre>
                  {preview.text.length > 3000 && (
                    <div className="faint">……只显示前 3000 字</div>
                  )}
                  <div className="hist-actions">
                    <button onClick={() => setDialog({ kind: 'label', v: v.v })}>
                      {v.label ? '改标记' : '打标记'}
                    </button>
                    <button onClick={() => setDialog({ kind: 'rollback', v: v.v })}>
                      回滚到这一版
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="faint hist-tip">
        每次保存都会存一版（同一个 30 秒时间格里的多次保存合并成一条）。
        回滚也会产生新版本，所以回滚之后还能再回来。
      </div>

      {dialog?.kind === 'label' && (
        <PromptModal
          title={`给第 ${dialog.v} 版打个名字`}
          hint="比如「完成第一卷」。打过名字的版本在清理时会被保留。"
          initial={versions?.find((x) => x.v === dialog.v)?.label ?? ''}
          confirmText="保存"
          onConfirm={(label) => {
            const v = dialog.v as number
            setDialog(null)
            void run(() => api.labelVersion(bookPath, docId, v, label))
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'rollback' && (
        <ConfirmModal
          title={`回滚到第 ${dialog.v} 版？`}
          body="当前内容会被这一版覆盖。回滚本身也会存成一个新版本，所以还能再回来。"
          confirmText="回滚"
          onConfirm={() => {
            const v = dialog.v as number
            setDialog(null)
            if (!docPath) return
            void run(async () => {
              const r = await api.rollbackTo(bookPath, docPath, v)
              onRolledBack(r.body)
            })
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'prune' && (
        <ConfirmModal
          title="只保留带标记的版本？"
          body={
            <>
              没打过名字的历史版本会被清掉，<b>带标记的和每篇最新的一版保留</b>。
              清理后历史链仍然完整，任何保留下来的版本都还能正常还原。
              <br />
              <br />
              这个操作不可撤销。
            </>
          }
          confirmText="开始清理"
          danger
          onConfirm={() => {
            setDialog(null)
            void run(async () => {
              const r = await api.pruneHistory(bookPath, { kind: 'keepLabeled' })
              setError(
                `清理完成：${r.docs} 篇，${mb(r.before)} → ${mb(r.after)}`,
              )
            })
          }}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  )
}

function CapacityBar({ cap, onPrune }: { cap: Capacity; onPrune(): void }) {
  const pct = Math.min(100, Math.round(cap.ratio * 100))
  return (
    <div className={`hist-cap level-${cap.level}`}>
      <div className="hist-cap-row">
        <span>历史占用</span>
        <b>
          {mb(cap.usedBytes)} / {cap.limitMB} MB
        </b>
      </div>
      <div className="progress">
        <i style={{ width: `${pct}%` }} />
      </div>
      {cap.level !== 'ok' && (
        <div className="hist-cap-warn">
          {cap.level === 'full'
            ? '已经到上限，暂停写入新的历史记录（正文保存不受影响）。'
            : '快到上限了。'}
          <button className="icon-btn" onClick={onPrune}>
            清理
          </button>
        </div>
      )}
    </div>
  )
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  const today = new Date()
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`
  return sameDay ? `今天 ${time}` : `${d.getMonth() + 1}-${p(d.getDate())} ${time}`
}
