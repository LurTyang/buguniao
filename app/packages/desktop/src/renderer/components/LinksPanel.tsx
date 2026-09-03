/**
 * 关联：这一篇和别的篇之间的双链关系。
 *
 * 规范：更新文档/05-功能模块详述.md §双向链接
 *
 * 两个方向都要：
 *   - **这篇提到了谁** —— 正文里写的 `[[李四]]`
 *   - **谁提到了这篇** —— 反向链接，写人物设定时最有用：
 *     「李四这张卡片，到底在哪几章出过场」
 *
 * 指不到东西的链接单独标出来。那多半是名字写错了，或者卡片还没建 ——
 * 藏起来的话，作者会以为链接是好的。
 */

import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'

interface Out {
  target: string
  path: string | null
  title: string | null
}

interface Back {
  docId: string
  path: string
  title: string
}

export function LinksPanel({
  bookPath,
  docPath,
  docTitle,
  refreshKey,
  onOpen,
  onCreateCard,
}: {
  bookPath: string
  docPath: string | null
  docTitle: string
  /** 保存后递增，用来重新取一遍 */
  refreshKey: number
  onOpen(path: string): void
  /** 点「建一张」时把名字带过去 */
  onCreateCard(name: string): void
}) {
  const [out, setOut] = useState<Out[] | null>(null)
  const [back, setBack] = useState<Back[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

  const load = useCallback(async () => {
    if (!docPath) {
      setOut([])
      setBack([])
      return
    }
    try {
      const [o, b] = await Promise.all([
        api.outgoingLinks(docPath, bookPath),
        api.backlinks(docTitle, bookPath),
      ])
      setOut(o)
      // 自己引用自己没意义，剔掉
      setBack(b.filter((x) => x.path !== docPath))
      setError(null)
    } catch (e) {
      setError(msg(e))
    }
  }, [bookPath, docPath, docTitle])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  if (!docPath) return <div className="empty-hint">先打开一篇文档。</div>

  const broken = (out ?? []).filter((o) => !o.path)
  const linked = (out ?? []).filter((o) => o.path)

  return (
    <div className="links-panel">
      {error && <div className="search-error">{error}</div>}

      <div className="links-group">
        <div className="links-group-name">这篇提到了</div>
        {linked.length === 0 && broken.length === 0 ? (
          <div className="fs-hint">还没写过 [[双链]]。在正文里打两个方括号试试。</div>
        ) : (
          <>
            {linked.map((o) => (
              <button key={o.target} className="links-item" onClick={() => o.path && onOpen(o.path)}>
                {o.title ?? o.target}
              </button>
            ))}
            {broken.map((o) => (
              <div key={o.target} className="links-item broken">
                <span>{o.target}</span>
                <button className="links-fix" onClick={() => onCreateCard(o.target)} title="按这个名字建一张便利贴">
                  还没有这一张，建一张
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="links-group">
        <div className="links-group-name">谁提到了这篇</div>
        {back === null ? (
          <div className="empty-hint">正在读……</div>
        ) : back.length === 0 ? (
          <div className="fs-hint">还没有别的文档提到「{docTitle}」。</div>
        ) : (
          back.map((b) => (
            <button key={b.path} className="links-item" onClick={() => onOpen(b.path)}>
              {b.title}
            </button>
          ))
        )}
      </div>

      <div className="fs-hint">关联需保存后刷新才会出现。</div>
    </div>
  )
}
