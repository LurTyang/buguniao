/**
 * 全文检索面板。
 *
 * 规范：更新文档/05-功能模块详述.md §6
 *
 * 两条不肯将就的地方：
 *   - 结果被条数上限截断时**如实说出总数**，不让作者以为只有这些
 *   - 索引没建好时明确显示「正在建立索引」，而不是给一个空结果让人以为搜不到
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DocType } from '@bugu/core'
import { api } from '../api.js'
import type { IndexStats, SearchHit, SearchResult } from '../../shared/api.js'

/** 与主进程约定的高亮标记（见 index-db.ts） */
const HL_START = String.fromCharCode(1)
const HL_END = String.fromCharCode(2)

const SCOPES: Array<{ key: DocType; label: string }> = [
  { key: 'chapter', label: '正文' },
  { key: 'outline', label: '大纲' },
  { key: 'setting', label: '设定集' },
  { key: 'idea', label: '灵感' },
]

const TYPE_LABEL: Partial<Record<DocType, string>> = {
  chapter: '正文',
  outline: '大纲',
  setting: '设定',
  idea: '灵感',
  script: '剧本',
}

export interface SearchPanelProps {
  bookPath: string
  onOpen(path: string): void
}

export function SearchPanel({ bookPath, onOpen }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [scopes, setScopes] = useState<DocType[]>([])
  const [result, setResult] = useState<SearchResult | null>(null)
  const [indexing, setIndexing] = useState(true)
  const [stats, setStats] = useState<IndexStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<number | undefined>(undefined)

  const refreshStats = useCallback(() => {
    void api
      .indexStats(bookPath)
      .then(setStats)
      .catch(() => {})
  }, [bookPath])

  // 打开面板时确保索引是最新的
  useEffect(() => {
    let alive = true
    setIndexing(true)
    void api
      .ensureIndexed(bookPath)
      .then(() => {
        if (!alive) return
        setIndexing(false)
        refreshStats()
      })
      .catch((e) => {
        if (!alive) return
        setIndexing(false)
        setError(e instanceof Error ? e.message : String(e))
      })
    inputRef.current?.focus()
    return () => {
      alive = false
    }
  }, [bookPath, refreshStats])

  const run = useCallback(
    (q: string, sc: DocType[]) => {
      if (!q.trim()) {
        setResult(null)
        return
      }
      void api
        .search(q, { book: bookPath, ...(sc.length > 0 ? { scopes: sc } : {}) })
        .then((r) => {
          setResult(r)
          setError(null)
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    },
    [bookPath],
  )

  // 输入停顿 180ms 再搜，别每敲一个字就打一次数据库
  useEffect(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => run(query, scopes), 180)
    return () => window.clearTimeout(timer.current)
  }, [query, scopes, run])

  const toggleScope = (k: DocType) =>
    setScopes((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))

  const rebuild = () => {
    setIndexing(true)
    void api
      .rebuildIndex(bookPath)
      .then(() => {
        setIndexing(false)
        refreshStats()
        run(query, scopes)
      })
      .catch((e) => {
        setIndexing(false)
        setError(e instanceof Error ? e.message : String(e))
      })
  }

  return (
    <div className="search-panel">
      <input
        ref={inputRef}
        className="search-input"
        value={query}
        placeholder="搜正文、大纲、设定……"
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="search-scopes">
        {SCOPES.map((s) => (
          <button
            key={s.key}
            className={`scope-chip${scopes.includes(s.key) ? ' on' : ''}`}
            onClick={() => toggleScope(s.key)}
            title={scopes.length === 0 ? '当前搜全部；点一下只搜这类' : undefined}
          >
            {s.label}
          </button>
        ))}
      </div>

      {error && <div className="search-error">{error}</div>}

      {indexing ? (
        <div className="empty-hint">正在建立索引……</div>
      ) : !query.trim() ? (
        <IndexInfo stats={stats} onRebuild={rebuild} />
      ) : result === null ? (
        <div className="empty-hint">搜索中……</div>
      ) : result.hits.length === 0 ? (
        <div className="empty-hint">
          没有找到「{query.trim()}」。
          <br />
          {scopes.length > 0 && '试试取消范围筛选？'}
        </div>
      ) : (
        <>
          <div className="search-count">
            {result.truncated ? (
              <>
                共 <b>{result.total}</b> 条，显示前 {result.hits.length} 条
              </>
            ) : (
              <>
                共 <b>{result.total}</b> 条
              </>
            )}
          </div>
          <div className="search-results">
            {result.hits.map((h) => (
              <Hit key={h.docId + h.path} hit={h} onOpen={onOpen} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Hit({ hit, onOpen }: { hit: SearchHit; onOpen(p: string): void }) {
  const parts = useMemo(() => splitHighlight(hit.snippet), [hit.snippet])
  return (
    <button className="search-hit" onClick={() => onOpen(hit.path)} title={hit.path}>
      <div className="search-hit-head">
        <span className="search-hit-title">{hit.title}</span>
        <span className="search-hit-type">{TYPE_LABEL[hit.type] ?? hit.type}</span>
      </div>
      <div className="search-hit-snippet">
        {parts.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
      </div>
    </button>
  )
}

/** 按主进程塞进来的控制字符把片段切成「命中/非命中」两种段 */
export function splitHighlight(snippet: string): Array<{ text: string; hit: boolean }> {
  const out: Array<{ text: string; hit: boolean }> = []
  let rest = snippet

  while (rest.length > 0) {
    const s = rest.indexOf(HL_START)
    if (s === -1) {
      out.push({ text: rest, hit: false })
      break
    }
    if (s > 0) out.push({ text: rest.slice(0, s), hit: false })

    const e = rest.indexOf(HL_END, s + 1)
    if (e === -1) {
      // 标记没配对，整段当普通文本，绝不吞掉内容
      out.push({ text: rest.slice(s + 1), hit: false })
      break
    }
    out.push({ text: rest.slice(s + 1, e), hit: true })
    rest = rest.slice(e + 1)
  }

  return out.filter((p) => p.text.length > 0)
}

function IndexInfo({ stats, onRebuild }: { stats: IndexStats | null; onRebuild(): void }) {
  return (
    <div className="index-info">
      <div className="empty-hint" style={{ padding: '18px 12px 8px' }}>
        输入两个字以上开始搜。
        <br />
        搜的是全文，不是标题。
      </div>
      {stats && (
        <div className="stat-block" style={{ paddingTop: 0 }}>
          <div className="stat-row">
            <span>已索引</span>
            <b>{stats.docs} 篇</b>
          </div>
          <div className="stat-row">
            <span>索引体积</span>
            <b>{(stats.bytes / 1024 / 1024).toFixed(1)} MB</b>
          </div>
          <button className="btn" style={{ marginTop: 12, width: '100%' }} onClick={onRebuild}>
            重建索引
          </button>
          <div className="faint" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.7 }}>
            索引只是派生数据，删了重扫就能复原，不影响你的稿子。
          </div>
        </div>
      )}
    </div>
  )
}
