/**
 * 回收站。
 *
 * 规范：更新文档/05-功能模块详述.md §目录管理
 *
 * 这个面板补的是一句反复许下的承诺：删章节、删作品、处理同步冲突、
 * 归入灵感碎片，每一处都写着「进回收站，捞得回来」——
 * 在此之前**根本没有地方能捞**。后端一直有，界面一直没做。
 *
 * 两条规矩：
 *   - 恢复回原位置；原位置已经有同名文件了就明说，不覆盖
 *   - **清空是这个软件里唯一真正删文件的地方**，必须作者亲手点，且要确认
 */

import { useCallback, useEffect, useState } from 'react'
import type { TrashEntry } from '@bugu/core'
import { api } from '../api.js'
import { ConfirmModal } from './Modal.js'

export function TrashPanel({
  bookPath,
  refreshKey,
  onRestored,
}: {
  bookPath: string
  /** 目录一变就重新读一遍 */
  refreshKey: number
  onRestored(): void
}) {
  const [items, setItems] = useState<TrashEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmEmpty, setConfirmEmpty] = useState(false)

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

  const load = useCallback(async () => {
    try {
      setItems(await api.listTrash(bookPath))
      setError(null)
    } catch (e) {
      setError(msg(e))
      setItems([])
    }
  }, [bookPath])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const restore = (entry: TrashEntry) => {
    void api
      .restoreFromTrash(entry)
      .then(async () => {
        await load()
        onRestored()
        setError(null)
      })
      .catch((e) => setError(msg(e)))
  }

  return (
    <div className="trash-panel">
      {error && <div className="search-error">{error}</div>}

      {items === null ? (
        <div className="empty-hint">正在读……</div>
      ) : items.length === 0 ? (
        <div className="empty-hint">
          回收站是空的。
        </div>
      ) : (
        <>
          <div className="fs-hint">
            共 {items.length} 篇。删掉的东西都先到这里，随时能放回原位置。
          </div>
          <div className="trash-list">
            {items.map((t) => (
              <div key={t.path} className="trash-item">
                <div className="trash-name">{t.name}</div>
                <div className="trash-where" title={t.originalPath}>
                  {shortWhere(bookPath, t.originalPath)}　{fmtDate(t.mtime)}
                </div>
                <div className="trash-actions">
                  <button onClick={() => restore(t)}>放回原处</button>
                </div>
              </div>
            ))}
          </div>

          <div className="trash-foot">
            <button className="btn danger-btn" onClick={() => setConfirmEmpty(true)}>
              清空回收站
            </button>
            <div className="settings-hint">
              {/* 全项目唯一真正删文件的地方，说清楚 */}
              清空是<b>真的删掉</b>，删完谁也捞不回来。平时不用管它。
            </div>
          </div>
        </>
      )}

      {confirmEmpty && (
        <ConfirmModal
          title={`清空回收站里的 ${items?.length ?? 0} 篇？`}
          body="这是这个软件里唯一真正删文件的操作。删完就没了，版本历史也帮不了你。"
          confirmText="我确定，清空"
          danger
          onConfirm={() => {
            setConfirmEmpty(false)
            void api
              .emptyTrash(bookPath)
              .then(load)
              .catch((e) => setError(msg(e)))
          }}
          onCancel={() => setConfirmEmpty(false)}
        />
      )}
    </div>
  )
}

/** 「正文/第一卷」这样的一小截，够作者认出它原来在哪就行 */
function shortWhere(bookPath: string, originalPath: string): string {
  const rel = originalPath.startsWith(`${bookPath}/`)
    ? originalPath.slice(bookPath.length + 1)
    : originalPath
  const parts = rel.split('/')
  parts.pop()
  return parts.join(' › ') || '作品根目录'
}

function fmtDate(ms: number): string {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
