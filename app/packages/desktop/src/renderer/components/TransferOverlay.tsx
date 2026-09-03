/**
 * 导入 / 导出。
 *
 * 规范：更新文档/05-功能模块详述.md §10
 *
 * 导入这一步**必须让作者过目再落盘**。自动分章再准也会有错判，
 * 而把几百万字切错了是很难收拾的。所以先出方案、能手动增删分章点、
 * 确认无误才创建文件。
 */

import { useCallback, useEffect, useState } from 'react'
import { formatCount, type ExportChapter, type ExportOptions } from '@bugu/core'
import { api } from '../api.js'
import type { ForeignPlan, ImportMeta, ImportPlan } from '../../shared/api.js'

type Preview = ImportPlan & ImportMeta

const ENCODING_LABEL: Record<string, string> = {
  'utf-8': 'UTF-8',
  'utf-8-bom': 'UTF-8（带 BOM）',
  gbk: 'GBK / ANSI',
  'utf-16le': 'UTF-16',
}

export function TransferOverlay({
  bookPath,
  bookTitle,
  tab: initialTab,
  onClose,
  onImported,
}: {
  bookPath: string
  bookTitle: string
  tab: 'import' | 'export' | 'foreign'
  onClose(): void
  onImported(): void
}) {
  const [tab, setTab] = useState(initialTab)
  const [width, setWidth] = useState(() => Math.min(880, window.innerWidth - 80))

  useEffect(() => {
    const onResize = () => setWidth(Math.min(880, window.innerWidth - 80))
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="stats-overlay" style={{ width }}>
        <div className="stats-overlay-head">
          <button className={`tab${tab === 'import' ? ' active' : ''}`} onClick={() => setTab('import')}>
            导入
          </button>
          <button className={`tab${tab === 'export' ? ' active' : ''}`} onClick={() => setTab('export')}>
            导出
          </button>
          <button
            className={`tab${tab === 'foreign' ? ' active' : ''}`}
            onClick={() => setTab('foreign')}
          >
            从别的软件搬家
          </button>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="stats-overlay-body">
          {tab === 'import' ? (
            <ImportPane bookPath={bookPath} onDone={onImported} onClose={onClose} />
          ) : tab === 'foreign' ? (
            <ForeignPane bookPath={bookPath} onDone={onImported} onClose={onClose} />
          ) : (
            <ExportPane bookPath={bookPath} bookTitle={bookTitle} />
          )}
        </div>
      </div>
    </div>
  )
}

// ───────────────────────── 导入 ─────────────────────────

function ImportPane({
  bookPath,
  onDone,
  onClose,
}: {
  bookPath: string
  onDone(): void
  onClose(): void
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keepPreamble, setKeepPreamble] = useState(true)

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

  const pick = async () => {
    try {
      setBusy(true)
      const p = await api.pickImportFile()
      if (p) setPreview(p)
      setError(null)
    } catch (e) {
      setError(msg(e))
    } finally {
      setBusy(false)
    }
  }

  /** 作者手动增删分章点后重算 */
  const toggleLine = useCallback(
    async (line: number) => {
      if (!preview) return
      const current = new Set<number>(preview.chapters.map((c) => c.titleLine))
      if (current.has(line)) current.delete(line)
      else current.add(line)
      try {
        setBusy(true)
        setPreview(await api.rePreviewImport(preview.filePath, [...current].sort((a, b) => a - b)))
      } catch (e) {
        setError(msg(e))
      } finally {
        setBusy(false)
      }
    },
    [preview],
  )

  const apply = async () => {
    if (!preview) return
    try {
      setBusy(true)
      const r = await api.applyImport(
        bookPath,
        `${bookPath}/正文`,
        preview.chapters.map((c) => ({ title: c.title, body: c.body })),
        keepPreamble ? preview.preamble : null,
      )
      onDone()
      onClose()
      void r
    } catch (e) {
      setError(msg(e))
      setBusy(false)
    }
  }

  if (!preview) {
    return (
      <div>
        <p className="modal-hint">
          选一个 txt，我会按「第 X 章」自动切分。
          <br />
          判断依据是<b>章节序号在全文中单调递增</b> —— 正文里偶然提到的
          「他想起第三章说的话」构不成一条完整的递增序列，会被自动排除。
          <br />
          切完你可以逐条过目、手动增删分章点，确认之后才会真的创建文件。
        </p>
        <button className="btn btn-primary" disabled={busy} onClick={() => void pick()}>
          {busy ? '读取中……' : '选择 txt 文件'}
        </button>
        {error && <div className="banner danger" style={{ borderRadius: 6, marginTop: 14 }}>{error}</div>}
      </div>
    )
  }

  return (
    <div>
      <div className="imp-summary">
        <span>
          <b>{preview.fileName}</b>
        </span>
        <span className="faint">
          {ENCODING_LABEL[preview.encoding] ?? preview.encoding} · {formatCount(preview.lineCount)} 行
        </span>
        <span>
          识别出 <b>{preview.chapters.length}</b> 章
        </span>
        {preview.volumes.length > 0 && <span className="faint">检测到 {preview.volumes.length} 个卷标记</span>}
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setPreview(null)}>
          换个文件
        </button>
      </div>

      {error && <div className="banner danger" style={{ borderRadius: 6, marginBottom: 12 }}>{error}</div>}

      {preview.preamble && (
        <label className="imp-preamble">
          <input type="checkbox" checked={keepPreamble} onChange={(e) => setKeepPreamble(e.target.checked)} />
          第一章之前还有 {formatCount(preview.preamble.length)} 字（书名、作者之类），
          导入成一篇叫「前言」的文档
        </label>
      )}

      <div className="imp-cols">
        <div>
          <div className="stats-title">将要创建的章节</div>
          <div className="imp-list">
            {preview.chapters.map((c) => (
              <div key={c.titleLine} className="imp-row">
                <button className="imp-toggle on" title="不要这个分章点" onClick={() => void toggleLine(c.titleLine)}>
                  ✓
                </button>
                <span className="imp-title">{c.title}</span>
                <span className="faint">{formatCount(c.body.length)} 字</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="stats-title">
            被排除的候选
            <span className="faint" style={{ marginLeft: 8, fontWeight: 400 }}>
              （多半是正文里提到的章节名）
            </span>
          </div>
          {preview.rejected.length === 0 ? (
            <div className="chart-empty">没有被排除的候选</div>
          ) : (
            <div className="imp-list">
              {preview.rejected.map((c) => (
                <div key={c.line} className="imp-row muted">
                  <button
                    className="imp-toggle"
                    title="其实这是章节标题，加进来"
                    onClick={() => void toggleLine(c.line)}
                  >
                    +
                  </button>
                  <span className="imp-title">{c.title}</span>
                  <span className="faint">第 {c.line + 1} 行</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="modal-actions" style={{ marginTop: 18 }}>
        <button className="btn" onClick={onClose}>
          取消
        </button>
        <button
          className="btn btn-primary"
          disabled={busy || (preview.chapters.length === 0 && !preview.preamble)}
          onClick={() => void apply()}
        >
          {busy ? '导入中……' : `创建 ${preview.chapters.length + (keepPreamble && preview.preamble ? 1 : 0)} 篇`}
        </button>
      </div>
      <div className="faint stats-note">
        导入只会<b>新增</b>章节，不会动现有的任何内容。序号从现有末尾接着排。
      </div>
    </div>
  )
}

// ───────────────────────── 导出 ─────────────────────────

function ExportPane({ bookPath, bookTitle }: { bookPath: string; bookTitle: string }) {
  const [chapters, setChapters] = useState<ExportChapter[] | null>(null)
  const [opts, setOpts] = useState<ExportOptions>({
    stripForeshadow: true,
    stripWikiLinks: true,
    stripComments: true,
    stripFloatMarks: true,
    indentFirstLine: true,
    includeChapterTitle: true,
  })
  /** 导哪几部分。默认只导正文 —— 多数时候要的就是它 */
  const [parts, setParts] = useState({ text: true, outline: false, settings: false })
  /**
   * 哪一档格式。
   *
   * **md 和 txt 的用途是反的**：md 是「原样搬走、换个编辑器接着写」，
   * txt 是「排给人看」。所以切换格式时那几个开关也跟着换一套默认值。
   */
  const [format, setFormat] = useState<'txt' | 'md'>('txt')
  const [stat, setStat] = useState<{ chapterCount: number; chars: number; bytes: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

  useEffect(() => {
    void api
      .collectForExport(bookPath)
      .then(setChapters)
      .catch((e) => setError(msg(e)))
  }, [bookPath])

  useEffect(() => {
    if (!chapters) return
    void api.exportPreview(chapters, opts).then(setStat).catch(() => {})
  }, [chapters, opts])

  /** 一次把选中的几部分都导出去 */
  const runBundle = async () => {
    try {
      setBusy(true)
      setDone(null)
      setError(null)
      const r = await api.exportBundle(bookPath, { parts, format, options: opts }, bookTitle)
      if (r) setDone(`导出了 ${r.files} 个文件：${r.dir}`)
    } catch (e) {
      setError(msg(e))
    } finally {
      setBusy(false)
    }
  }

  const run = async (kind: 'txt' | 'docx' | 'perChapter') => {
    if (!chapters) return
    try {
      setBusy(true)
      setDone(null)
      const r = await api.exportBook(kind, chapters, opts, bookTitle)
      if (r) {
        setDone(
          r.files !== undefined
            ? `导出了 ${r.files} 个文件`
            : `导出完成（${((r.bytes ?? 0) / 1024).toFixed(0)} KB）`,
        )
      }
      setError(null)
    } catch (e) {
      setError(msg(e))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (k: keyof ExportOptions) => setOpts((o) => ({ ...o, [k]: !o[k] }))

  if (!chapters) return <div className="empty-hint">正在读取全书……</div>

  return (
    <div>
      <div className="imp-summary">
        <span>
          <b>{bookTitle}</b>
        </span>
        <span>{stat?.chapterCount ?? chapters.length} 章</span>
        {stat && (
          <>
            <span>{formatCount(stat.chars)} 字</span>
            <span className="faint">约 {(stat.bytes / 1024).toFixed(0)} KB</span>
          </>
        )}
      </div>

      <div className="stats-title" style={{ marginTop: 16 }}>
        导出哪几部分
      </div>
      <div className="exp-opts">
        <Opt on={parts.text} onClick={() => setParts((p) => ({ ...p, text: !p.text }))} label="正文" />
        <Opt
          on={parts.outline}
          onClick={() => setParts((p) => ({ ...p, outline: !p.outline }))}
          label="大纲"
        />
        <Opt
          on={parts.settings}
          onClick={() => setParts((p) => ({ ...p, settings: !p.settings }))}
          label="设定集"
          hint="一个文件，分类当二级标题"
        />
      </div>

      <div className="stats-title" style={{ marginTop: 16 }}>
        格式
      </div>
      <div className="exp-opts">
        <Opt
          on={format === 'txt'}
          onClick={() => {
            setFormat('txt')
            // 两档的用途是反的，默认值也该是反的。切过来就把 txt 那套摆上
            setOpts((o) => ({ ...o, indentFirstLine: true }))
          }}
          label="txt · 排给人看"
          hint="Markdown 语法全部转成纯文字，首行缩进两格"
        />
        <Opt
          on={format === 'md'}
          onClick={() => {
            setFormat('md')
            setOpts((o) => ({ ...o, indentFirstLine: false }))
          }}
          label="md · 原样搬走"
          hint="保留标题、粗体、引用这些语法，换个编辑器能接着写。不加首行缩进（源文件不该有）"
        />
      </div>

      <div className="stats-title" style={{ marginTop: 16 }}>
        导出选项
      </div>
      <div className="exp-opts">
        <Opt on={!!opts.includeChapterTitle} onClick={() => toggle('includeChapterTitle')} label="包含章节标题" />
        <Opt on={!!opts.indentFirstLine} onClick={() => toggle('indentFirstLine')} label="首行缩进两格" hint="多数平台需要" />
        <Opt
          on={!!opts.scriptLayout}
          onClick={() => toggle('scriptLayout')}
          label="剧本按剧本排版"
          hint="场景顶格、角色名缩四格、台词缩六格。只对看着像剧本的章节生效，普通章节不受影响"
        />
        <Opt on={!!opts.stripForeshadow} onClick={() => toggle('stripForeshadow')} label="移除伏笔标记" hint="发给编辑时该去掉" />
        <Opt on={!!opts.stripWikiLinks} onClick={() => toggle('stripWikiLinks')} label="双链转纯文本" hint="[[李四]] → 李四" />
        <Opt on={!!opts.stripComments} onClick={() => toggle('stripComments')} label="移除注释" hint="你写给自己的备注" />
        {/*
          0.4 补的：`@` 从前根本没被处理，导给编辑的 txt 里行首那个 @
          是原样带出去的。那不是「还没做的功能」，是已有功能漏了一种标记
        */}
        <Opt
          on={!!opts.stripFloatMarks}
          onClick={() => toggle('stripFloatMarks')}
          label="移除便利贴标记"
          hint="去掉那个 @，那句话留着"
        />
        <Opt
          on={!!opts.spaceBetweenCjkAndLatin}
          onClick={() => toggle('spaceBetweenCjkAndLatin')}
          label="中英之间加空格"
          hint="写了3000字 → 写了 3000 字"
        />
        <Opt
          on={!!opts.tidySpaces}
          onClick={() => toggle('tidySpaces')}
          label="收拾多余空格"
          hint="连着的空格压成一个、标点前不留空格。行首缩进不动"
        />
      </div>

      {error && <div className="banner danger" style={{ borderRadius: 6, marginTop: 12 }}>{error}</div>}
      {done && <div className="banner" style={{ borderRadius: 6, marginTop: 12 }}>{done}</div>}

      <div className="exp-actions">
        <button
          className="btn btn-primary"
          disabled={busy || (!parts.text && !parts.outline && !parts.settings)}
          onClick={() => void runBundle()}
        >
          {busy ? '导出中……' : `一键导出 ${format}`}
        </button>
        <button className="btn" disabled={busy} onClick={() => void run('txt')}>
          只导正文 txt
        </button>
        <button className="btn" disabled={busy} onClick={() => void run('docx')}>
          导出 Word
        </button>
        <button className="btn" disabled={busy} onClick={() => void run('perChapter')}>
          按章分文件
        </button>
      </div>

      <div className="faint stats-note">
        Word 用「标题 1 / 标题 2」标出卷和章，编辑能直接用导航窗格跳转；
        首行缩进走段落样式，不往正文里塞全角空格。
        <br />
        txt 带 BOM 导出，否则 Windows 记事本会把中文认成乱码。
        <br />
        导出<b>不会改动你的原稿</b>，所有处理都只作用在副本上。
      </div>
    </div>
  )
}

function Opt({
  on,
  onClick,
  label,
  hint,
}: {
  on: boolean
  onClick(): void
  label: string
  hint?: string
}) {
  return (
    <label className="exp-opt" onClick={onClick}>
      <span className={`toggle${on ? ' on' : ''}`}>
        <i />
      </span>
      <span>
        {label}
        {hint && <span className="faint"> · {hint}</span>}
      </span>
    </label>
  )
}

// ───────────────────────── 从别的软件搬家 ─────────────────────────

/**
 * 搬家。
 *
 * ⚠️ 只做**有把握**的两条路。青茉、码字精灵是私有格式，我没有样本文件，
 * 不去猜 —— 猜错的后果是把作者几百万字导成乱码，而且看着像导入成功了。
 * 界面上把这句话直说出来，并给出可行的替代路线。
 */
function ForeignPane({
  bookPath,
  onDone,
  onClose,
}: {
  bookPath: string
  onDone(): void
  onClose(): void
}) {
  const [plan, setPlan] = useState<ForeignPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

  const pick = (kind: 'scrivener' | 'folder') => {
    setBusy(true)
    setError(null)
    void api
      .pickForeign(kind)
      .then((p) => p && setPlan(p))
      .catch((e) => setError(msg(e)))
      .finally(() => setBusy(false))
  }

  if (plan) {
    const chars = plan.chapters.reduce((s, c) => s + c.body.length, 0)
    return (
      <div className="tf-pane">
        <div className="fs-hint">
          从 <code>{plan.from}</code> 读到 <b>{plan.chapters.length}</b> 章，
          约 {chars.toLocaleString()} 字。
        </div>

        <div className="tf-list">
          {plan.chapters.map((c, i) => (
            <div key={i} className="tf-row" style={{ paddingLeft: 8 + c.depth * 14 }}>
              <span className="tf-title">{c.title}</span>
              <span className="faint">{c.body.length.toLocaleString()} 字</span>
            </div>
          ))}
        </div>

        {plan.skipped.length > 0 && (
          <details className="ai-notes">
            <summary>有 {plan.skipped.length} 个文件没导进来</summary>
            <pre>{plan.skipped.map((s) => `${s.source}　—— ${s.why}`).join('\n')}</pre>
          </details>
        )}

        {error && <div className="search-error">{error}</div>}

        <div className="tf-actions">
          <button className="btn" onClick={() => setPlan(null)}>
            重选
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || plan.chapters.length === 0}
            onClick={() => {
              setBusy(true)
              void api
                .applyForeign(bookPath, `${bookPath}/正文`, plan.chapters)
                .then(() => {
                  onDone()
                  onClose()
                })
                .catch((e) => setError(msg(e)))
                .finally(() => setBusy(false))
            }}
          >
            {busy ? '正在导入……' : `导入这 ${plan.chapters.length} 章`}
          </button>
          <span className="faint">会接在现有章节后面，原稿一个字不动。</span>
        </div>
      </div>
    )
  }

  return (
    <div className="tf-pane">
      <div className="fs-hint">
        搬进来的稿子会变成普通的 <code>.md</code> 文件，跟你在这儿写的没有区别。
      </div>

      <div className="foreign-cards">
        <button className="foreign-card" disabled={busy} onClick={() => pick('scrivener')}>
          <b>Scrivener</b>
          <span className="faint">选那个 .scriv 文件夹。目录树和正文都会带过来。</span>
        </button>
        <button className="foreign-card" disabled={busy} onClick={() => pick('folder')}>
          <b>一整个文件夹的 txt / md</b>
          <span className="faint">
            按文件名里的数字排序，子文件夹算分卷。几乎所有软件都能导出成这个。
          </span>
        </button>
      </div>

      {error && <div className="search-error">{error}</div>}

      <div className="settings-hint" style={{ marginTop: 12 }}>
        {/*
          这段话必须说清楚。含糊其辞地「支持」一个我没验过的格式，
          比明说不支持糟糕得多 —— 作者会拿几百万字去试。
        */}
        <b>青茉、码字精灵暂时没有直接导入。</b>
        它们的文件格式是私有的，我手上没有样本，不敢猜着写 ——
        猜错了就是把你的稿子导成乱码，而且看着还像成功了。
        <br />
        现在的办法：在那边先<b>导出成 txt</b>（一章一个文件放进一个文件夹），
        再用上面那个「一整个文件夹」导进来。
        <br />
        如果你手上有它们的原始工程文件，发我一个，我照着真实结构写。
      </div>
    </div>
  )
}
