/**
 * 快速跳转（Ctrl+P）。
 *
 * 规范：更新文档/06-开发路线图.md M2
 *
 * 书写到一百来章之后，在目录树里翻页找章节是很烦的。
 * 这里只做一件事：打几个字，回车，跳过去。
 *
 * 它**只搜标题**，不搜正文 —— 搜正文有全文检索（Ctrl+Shift+F），
 * 两个功能混在一起的结果是两个都不好用。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzyFilter, type BookTree } from '@bugu/core'

interface Target {
  path: string
  title: string
  /** 归属，显示在标题右边，比如「第一卷 少年游」「人物」 */
  where: string
}

export function QuickJump({
  tree,
  onPick,
  onClose,
}: {
  tree: BookTree
  onPick(path: string): void
  onClose(): void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const targets = useMemo<Target[]>(() => {
    const out: Target[] = []
    for (const n of tree.text) {
      if (n.kind === 'volume') {
        for (const c of n.chapters) out.push({ path: c.path, title: c.title, where: n.title })
      } else {
        out.push({ path: n.path, title: n.title, where: '正文' })
      }
    }
    for (const o of tree.outline) out.push({ path: o.path, title: o.title, where: '大纲' })
    for (const cat of tree.settings) {
      for (const c of cat.cards) out.push({ path: c.path, title: c.title, where: cat.name })
    }
    for (const c of tree.looseSettings) out.push({ path: c.path, title: c.title, where: '设定' })
    for (const i of tree.ideas) out.push({ path: i.path, title: i.title, where: '灵感' })
    return out
  }, [tree])

  const hits = useMemo(() => fuzzyFilter(query, targets, (t) => t.title, 60), [query, targets])

  // 查询一变，选中回到第一条
  useEffect(() => setActive(0), [query])

  // 让选中项始终可见
  useEffect(() => {
    listRef.current?.querySelector('.qj-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, hits.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = hits[active]
      if (hit) {
        onPick(hit.item.path)
        onClose()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="modal-mask qj-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="qj-box">
        <input
          className="qj-input"
          autoFocus
          placeholder="打几个字找章节、便利贴、大纲……"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="qj-list" ref={listRef}>
          {hits.length === 0 ? (
            <div className="empty-hint">没有标题对得上。想搜正文的话按 Ctrl+Shift+F。</div>
          ) : (
            hits.map((hit, i) => (
              <div
                key={hit.item.path}
                className={`qj-item${i === active ? ' active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onPick(hit.item.path)
                  onClose()
                }}
              >
                <span className="qj-title">{highlight(hit.item.title, hit.matched)}</span>
                <span className="qj-where">{hit.item.where}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

/** 把命中的字加粗。下标来自 fuzzyFilter，一定是升序且不越界 */
function highlight(text: string, matched: readonly number[]) {
  if (matched.length === 0) return text
  const set = new Set(matched)
  return Array.from(text).map((ch, i) =>
    set.has(i) ? (
      <b key={i} className="qj-hit">
        {ch}
      </b>
    ) : (
      <span key={i}>{ch}</span>
    ),
  )
}
