/**
 * 「这一篇在别处也改过」——两版对不上时让作者自己挑。
 *
 * 规范：更新文档/05-功能模块详述.md §3.4
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么绝不能自动覆盖】
 *
 * 初版是这么做的：切回窗口时发现磁盘跟内存不一样，就默默把编辑器里的
 * 内容换成磁盘上的。作者报的原话是「他会吞掉我一块文案」。
 *
 * 会吞是必然的 —— 屏幕上那些字可能是他刚敲完还没到自动保存的。
 * 一个写作软件吞掉一次文字，作者就再也不敢用它了，
 * 这比任何功能缺失都严重。
 *
 * 所以现在：**停下来，把两版的设备名、字数、时间摆出来，他点了才动。**
 * 而且选「用别处那版」时，先把手上这版另存成一篇 ——
 * 不管他怎么选，一个字都不丢。
 * ─────────────────────────────────────────────────────────────
 */

import { useEffect } from 'react'
import { countWords } from '@bugu/core'

export interface VersionSide {
  /** 设备名。空 = 老文档里没记，只能说不知道 */
  device: string
  /** ISO 时间。空 = 不知道 */
  updated: string
  body: string
}

/** `2026-08-27T01:40:00.000Z` → `08-27 09:40`（本地时区） */
function when(iso: string): string {
  if (!iso) return '时间不详'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '时间不详'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function Side({
  label,
  side,
  tone,
}: {
  label: string
  side: VersionSide
  tone: 'mine' | 'theirs'
}) {
  const chars = countWords(side.body).withPunctuation
  return (
    <div className={`clash-side ${tone}`}>
      <div className="clash-label">{label}</div>
      <div className="clash-device">{side.device || '不知道是哪台机器'}</div>
      <div className="clash-nums">
        <b>{chars.toLocaleString()}</b>
        <span className="faint">字</span>
        <span className="faint">·</span>
        <span className="faint">{when(side.updated)}</span>
      </div>
      <div className="clash-peek">{side.body.trim().slice(0, 120) || '（空的）'}</div>
    </div>
  )
}

export function VersionClash({
  mine,
  theirs,
  onKeepMine,
  onTakeTheirs,
}: {
  mine: VersionSide
  theirs: VersionSide
  /** 保留屏幕上这版。磁盘那版原样留着，下次保存才会覆盖 */
  onKeepMine(): void
  /** 用磁盘那版。**调用方必须先把 mine 另存一份** */
  onTakeTheirs(): void
}) {
  useEffect(() => {
    // Esc = 保留我这版。默认动作永远是「不动屏幕上的字」
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onKeepMine()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKeepMine])

  const diff = countWords(mine.body).withPunctuation - countWords(theirs.body).withPunctuation

  return (
    // 点遮罩不关：这是个要做决定的框，手滑点到外面就消失反而更吓人
    <div className="modal-mask">
      <div className="modal clash-modal">
        <h3>这一篇在别处也改过</h3>
        <p className="modal-hint">
          磁盘上的内容跟你屏幕上的对不上了 —— 多半是另一台电脑写完同步过来的。
          <b>你不点，什么都不会变。</b>
        </p>

        <div className="clash-pair">
          <Side label="你屏幕上这版" side={mine} tone="mine" />
          <Side label="磁盘上那版" side={theirs} tone="theirs" />
        </div>

        <div className="settings-hint">
          {diff === 0
            ? '两版字数一样，但内容不同。'
            : diff > 0
              ? `你这版多 ${diff.toLocaleString()} 字。`
              : `磁盘那版多 ${(-diff).toLocaleString()} 字。`}
        </div>

        <div className="modal-actions clash-actions">
          <button className="btn" onClick={onTakeTheirs}>
            用磁盘那版
          </button>
          <button className="btn btn-primary" onClick={onKeepMine}>
            保留我这版
          </button>
        </div>
        <div className="settings-hint" style={{ textAlign: 'right' }}>
          {/* 这句话是这个框最要紧的一句 */}
          选「用磁盘那版」时，你屏幕上这版会先被<b>另存成一篇</b>，不会丢。
        </div>
      </div>
    </div>
  )
}
