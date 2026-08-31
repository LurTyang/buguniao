/**
 * 帮助：上手指引 + 快捷键表。
 *
 * 规范：更新文档/06-开发路线图.md M8（快捷键表、首次启动引导）
 *
 * 第一次进书架时自动弹一次，之后只能从「帮助」菜单或 F1 叫出来。
 * 刻意做得短 —— 没人会读五屏的引导，读完也记不住。
 */

import { useEffect, useState } from 'react'
import { TOUR_TITLE, TourPageView, type TourKey } from './Tour.js'

/** 一条快捷键。`keys` 里的每个元素单独画一个键帽 */
interface Shortcut {
  keys: string[]
  what: string
}

const GROUPS: Array<{ name: string; items: Shortcut[] }> = [
  {
    name: '写字',
    items: [
      { keys: ['Ctrl', 'S'], what: '立刻保存（平时每 3 秒自己存，不用管）' },
      { keys: ['Ctrl', 'E'], what: '给选中的一段标伏笔' },
      { keys: ['Esc'], what: '收起两边的侧边栏' },
    ],
  },
  {
    name: '看东西',
    items: [
      { keys: ['Ctrl', '\\'], what: '钉住／收起右边的功能栏' },
      { keys: ['Ctrl', 'Shift', '\\'], what: '钉住／收起左边的目录栏' },
      { keys: ['Ctrl', 'Shift', 'F'], what: '全文检索' },
      { keys: ['Ctrl', 'Shift', 'B'], what: '回到书架' },
      { keys: ['F1'], what: '就是这一页' },
    ],
  },
  {
    name: '进出',
    items: [
      { keys: ['Ctrl', 'Shift', 'E'], what: '导出' },
      { keys: ['Ctrl', ','], what: '设置' },
    ],
  },
]

const GUIDE: Array<{ title: string; body: string }> = [
  {
    title: '你的稿子不在这个软件里',
    body:
      '正文是普通的 .md 纯文本，就躺在你选的那个文件夹里，记事本能打开。' +
      '哪天不咕鸟没了、你不想用了，稿子一个字都不会少。',
  },
  {
    title: '不用记着保存',
    body: '停笔三秒就自动存一次，每次都留一份历史。想手动存就 Ctrl+S。',
  },
  {
    title: '侧边栏是划出来的',
    body:
      '鼠标往窗口左右边缘一靠，侧边栏自己出来；点图钉就钉住不动。' +
      '左边看目录，右边是检索、伏笔、便利贴、统计、番茄钟这些。',
  },
  {
    title: '便利贴用 @ 拉出来',
    body:
      '设定卡片里，行首写一个 @ 那一行就会浮到稿纸上；' +
      '正文中间用两个 @ 把一段夹起来也行。三个五个不算数，只认一个或成对。',
  },
  {
    title: 'AI 不会自己动',
    body:
      '要用得先填自己的 API Key。它只在你点的时候跑，输出永远待在面板里，' +
      '插不插进正文由你说了算。',
  },
  {
    title: '同步冲突不会替你挑',
    body:
      '两台电脑各写了一版时，顶上会出黄条。点开是并排对比，你自己挑一边 ——' +
      '换下来的那份进回收站，挑错了还能捞回来。',
  },
]

const TOUR_TABS: TourKey[] = ['shelf', 'novel', 'script', 'game']

export function HelpOverlay({
  onClose,
  firstRun,
  tour,
}: {
  onClose(): void
  firstRun?: boolean
  /**
   * 第一次进某个页面时自动弹的那一页。
   * 给了就直接翻到那一页 —— 他要看的是**眼前这个界面**怎么用。
   */
  tour?: TourKey
}) {
  const [tab, setTab] = useState<'guide' | 'keys' | TourKey>(
    tour ?? (firstRun ? 'guide' : 'keys'),
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="stats-overlay help-overlay">
        <div className="stats-overlay-head">
          <button className={`tab${tab === 'guide' ? ' active' : ''}`} onClick={() => setTab('guide')}>
            先看这些
          </button>
          {TOUR_TABS.map((k) => (
            <button
              key={k}
              className={`tab${tab === k ? ' active' : ''}`}
              onClick={() => setTab(k)}
            >
              {TOUR_TITLE[k]}
            </button>
          ))}
          <button className={`tab${tab === 'keys' ? ' active' : ''}`} onClick={() => setTab('keys')}>
            快捷键
          </button>
          <button className="overlay-close" onClick={onClose} title="关闭">
            ×
          </button>
        </div>

        <div className="help-body">
          {tab !== 'guide' && tab !== 'keys' ? (
            <>
              {tour === tab && (
                <div className="fs-hint">第一次进这一页，所以弹出来一次。以后按 F1 还能翻到。</div>
              )}
              <TourPageView which={tab} />
            </>
          ) : tab === 'guide' ? (
            <>
              {firstRun && <div className="fs-hint">六句话，读完就能开始写。以后按 F1 还能翻到。</div>}
              {GUIDE.map((g) => (
                <div key={g.title} className="help-item">
                  <div className="help-item-title">{g.title}</div>
                  <div className="help-item-body">{g.body}</div>
                </div>
              ))}
            </>
          ) : (
            GROUPS.map((group) => (
              <div key={group.name} className="help-group">
                <div className="help-group-name">{group.name}</div>
                {group.items.map((s) => (
                  <div key={s.what} className="help-key-row">
                    <span className="help-keys">
                      {s.keys.map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                    </span>
                    <span className="help-key-what">{s.what}</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="help-foot">
          <button className="btn btn-primary" onClick={onClose}>
            {firstRun || tour ? '知道了，开始写' : '关掉'}
          </button>
        </div>
      </div>
    </div>
  )
}
