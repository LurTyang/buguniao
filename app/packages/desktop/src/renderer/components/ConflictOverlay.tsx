/**
 * 坚果云冲突副本的并排对比。
 *
 * 规范：更新文档/06-开发路线图.md M8
 *
 * 两台电脑离线各写一版，坚果云不合并，只是把后到的那份改名存下来。
 * 这个界面做的事只有一件：**把两边摊开给作者看，让他自己挑**。
 *
 * 界面上刻意没有「自动合并」按钮 —— 那个按钮猜错一次，
 * 丢掉的就是作者熬夜写的那一版。
 */

import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import type { ConflictPair, DiffSummary } from '@bugu/core'

type Conflict = ConflictPair & {
  summary: DiffSummary
  note: string
  originalMissing: boolean
  error?: string
}

type Action = 'keepOriginal' | 'keepConflict' | 'keepBoth'

export function ConflictOverlay({
  bookPath,
  onClose,
  onResolved,
}: {
  bookPath: string
  onClose(): void
  onResolved(): void
}) {
  const [list, setList] = useState<Conflict[] | null>(null)
  const [current, setCurrent] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [width, setWidth] = useState(() => Math.min(1100, window.innerWidth - 60))

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

  const load = useCallback(async () => {
    try {
      const r = await api.listConflicts(bookPath)
      setList(r)
      setCurrent((c) => Math.min(c, Math.max(0, r.length - 1)))
      setError(null)
    } catch (e) {
      setError(msg(e))
      setList([])
    }
  }, [bookPath])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onResize = () => setWidth(Math.min(1100, window.innerWidth - 60))
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const resolve = async (action: Action) => {
    const c = list?.[current]
    if (!c || busy) return
    setBusy(true)
    try {
      await api.resolveConflict(bookPath, c.conflictPath, action)
      await load()
      onResolved()
      setError(null)
    } catch (e) {
      setError(msg(e))
    } finally {
      setBusy(false)
    }
  }

  const c = list?.[current]

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="stats-overlay conflict-overlay" style={{ width }}>
        <div className="stats-overlay-head">
          <span className="overlay-title">同步冲突</span>
          {list && list.length > 1 && (
            <span className="conflict-nav">
              <button disabled={current === 0} onClick={() => setCurrent((i) => i - 1)}>
                上一个
              </button>
              <span className="faint">
                {current + 1} / {list.length}
              </span>
              <button disabled={current >= list.length - 1} onClick={() => setCurrent((i) => i + 1)}>
                下一个
              </button>
            </span>
          )}
          <button className="overlay-close" onClick={onClose} title="关闭">
            ×
          </button>
        </div>

        {error && <div className="search-error">{error}</div>}

        {list === null ? (
          <div className="empty-hint">正在比对……</div>
        ) : list.length === 0 ? (
          <div className="empty-hint">没有冲突副本了。</div>
        ) : c ? (
          <>
            <div className="conflict-head">
              <div className="conflict-file">{c.fileName}</div>
              <div className="fs-hint">{c.note}</div>
            </div>

            <div className="conflict-cols">
              <div className="conflict-col-head">
                <b>这台电脑上的</b>
                <span className="faint">{c.originalMissing ? '（正本已不在）' : c.originalPath}</span>
              </div>
              <div className="conflict-col-head">
                <b>同步下来的副本</b>
                <span className="faint">{c.fileName}</span>
              </div>
            </div>

            <div className="conflict-body">
              {c.summary.rows.length === 0 ? (
                <div className="empty-hint">{c.error ? c.error : '（空的）'}</div>
              ) : (
                c.summary.rows.map((row, i) => (
                  <div key={i} className={`conflict-row ${row.kind}`}>
                    <div className="conflict-cell left">
                      <span className="conflict-no">{row.leftNo ?? ''}</span>
                      <span className="conflict-text">{row.left}</span>
                    </div>
                    <div className="conflict-cell right">
                      <span className="conflict-no">{row.rightNo ?? ''}</span>
                      <span className="conflict-text">{row.right}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="conflict-actions">
              <button className="btn" disabled={busy || c.originalMissing} onClick={() => void resolve('keepOriginal')}>
                用左边
              </button>
              <button className="btn" disabled={busy} onClick={() => void resolve('keepConflict')}>
                用右边
              </button>
              <button className="btn" disabled={busy} onClick={() => void resolve('keepBoth')}>
                两份都留
              </button>
              <span className="faint conflict-note">
                换下来的那份进回收站，不是真删 —— 挑错了还能捞回来。
              </span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
