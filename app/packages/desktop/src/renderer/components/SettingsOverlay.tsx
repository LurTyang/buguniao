/**
 * 总设置。
 *
 * 规范：更新文档/04-界面与交互设计.md §7
 *
 * ─────────────────────────────────────────────────────────────
 * 【什么进这儿，什么留在侧边栏】
 *
 * 作者定的规矩：**不常改的进总设置，常改的或跟写作页关系大的留在侧边栏。**
 *
 *   进这儿：昵称、码字目标、AI 服务商与 Key、代理、作品库目录
 *   留侧边栏：字号、行距、字体、稿纸宽度、主题 —— 这些是一边写一边调的，
 *             塞进浮层等于每次调字号都要开关一次窗
 * ─────────────────────────────────────────────────────────────
 */

import { useEffect, useState } from 'react'

export type SettingsSection = 'me' | 'plan' | 'account' | 'ai' | 'library'

export function SettingsOverlay({
  onClose,
  sections,
  initial = 'me',
}: {
  onClose(): void
  /** 每一节的内容由外面塞进来 —— 目标编辑器、AI 面板都已经有了，不重写一遍 */
  sections: Array<{ key: SettingsSection; label: string; hint?: string; node: React.ReactNode }>
  initial?: SettingsSection
}) {
  const [cur, setCur] = useState<SettingsSection>(initial)
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

  const active = sections.find((s) => s.key === cur) ?? sections[0]

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="stats-overlay set-overlay" style={{ width }}>
        <div className="stats-overlay-head">
          <span className="overlay-title">设置</span>
          <button className="overlay-close" onClick={onClose} title="关闭">
            ×
          </button>
        </div>

        <div className="set-body">
          <div className="set-nav">
            {sections.map((s) => (
              <button
                key={s.key}
                className={`set-nav-item${s.key === cur ? ' active' : ''}`}
                onClick={() => setCur(s.key)}
              >
                {s.label}
              </button>
            ))}
            <div className="set-nav-foot faint">
              {/*
                写在这儿是为了让作者不用满界面找：字号这类要一边写一边调的，
                本来就该在稿纸旁边，不在这个浮层里。
              */}
              字号、行距、字体、主题这些一边写一边调的，
              在写作页右边的「设置」里。
            </div>
          </div>

          <div className="set-pane">
            {active?.hint && <div className="fs-hint">{active.hint}</div>}
            {active?.node}
          </div>
        </div>
      </div>
    </div>
  )
}
