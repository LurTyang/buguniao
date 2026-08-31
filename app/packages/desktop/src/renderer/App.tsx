/**
 * 应用根组件。
 *
 * 三个界面：首次设置 → 书架 → 写作页。
 * 用户设置在这里统一加载并下发，改动立刻写回配置文件。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookSummary } from '@bugu/core'
import { api } from './api.js'
import { Shelf } from './components/Shelf.js'
import { Work } from './components/Work.js'
import { HelpOverlay } from './components/HelpOverlay.js'
import type { TourKey } from './components/Tour.js'
import {
  StreakGreeting,
  alreadyGreeted,
  markGreeted,
  type ResumeTarget,
} from './components/StreakGreeting.js'
import { applySettings, loadSettings } from './components/SettingsPanel.js'
import { applyThemeCss } from './themes.js'
import type { UserSettings } from '../shared/api.js'

export function App() {
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [book, setBook] = useState<BookSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 菜单点「新建作品」时递增，书架看到变化就弹出新建框 */
  const [createSignal, setCreateSignal] = useState(0)
  /** 帮助页。`firstRun` 时话说得亲切一点，并且看完就记下不再自动弹 */
  const [help, setHelp] = useState<'no' | 'manual' | 'first'>('no')
  /**
   * 第一次进某个页面时自动弹的图文说明。
   *
   * 按页面记而不是一个总开关 —— 只写小说的人不该被弹游戏剧本那一页，
   * 而他哪天真开了本剧本，那一页还得弹。
   */
  const [tour, setTour] = useState<TourKey | null>(null)
  /**
   * 启动时的那一个弹窗。
   *
   * null = 不弹（还没算完，或者这次启动已经弹过了）。
   * 里头的 `resume` 是「上次停在哪儿」，没有就是 null。
   *
   * **连胜和「回到上次」合在一个弹窗里**：这两件事在作者脑子里本来就是
   * 同一件 —— 打开软件的那一秒，他要知道「我现在什么状态、该回哪儿去」。
   * 拆成两步的话，第一个弹窗就成了一道必须先点掉的门（作者报过这个）。
   */
  const [greeting, setGreeting] = useState<{ resume: ResumeTarget | null } | null>(null)
  /**
   * 「回到上次那儿吗」。
   *
   * 存的是那本书本身，不只是路径 —— 点「回去接着写」时要把它交给 Work，
   * 到那时候再去列一遍书架就慢了。
   */
  /**
   * **启动那一刻**的「上次在哪儿」。
   *
   * 必须是快照，不能读 `settings.lastPlace` ——
   * 那一项在作者写字的过程中一直在被更新（切文档、手动保存、关窗口都写一次）。
   * 读活的那一份，就会变成「写完一本退回书架，忽然被问要不要回上一本」——
   * 而他明明是打算开另一本（作者报过这个）。
   */
  const bootPlace = useRef<UserSettings['lastPlace']>(null)
  /**
   * 这次启动进过书没有。
   *
   * 进过就再也不问了。「接着上次写」只在**刚打开软件、还没进过任何一本书**
   * 的时候才有意义；退回书架时他心里想的是下一本，不是上一本。
   */
  const everOpened = useRef(false)

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s)
      applySettings(s)
      // 只抓这一次。后面 settings 再怎么变，「上次在哪儿」都以启动那一刻为准
      bootPlace.current = s.lastPlace
      // 自选的那份 CSS 每次启动都要重新装 —— 它是个文件路径，
      // 作者可能在软件关着的时候改过、也可能把文件删了。读不到就当没配
      void api.readThemeCss().then(applyThemeCss).catch(() => {})
    })
  }, [])

  // 进过一本书就把这一页翻过去了
  useEffect(() => {
    if (book) everOpened.current = true
  }, [book])

  const patchSettings = useCallback((patch: Partial<UserSettings>) => {
    // 先本地生效再落盘，改字号这类操作才跟手
    setSettings((prev) => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      applySettings(next)
      return next
    })
    void api.updateSettings(patch).catch((e) => setError(msg(e)))
  }, [])

  /**
   * 启动弹窗：连胜 + 今天写了多少 + 上次停在哪儿。
   *
   * 首次引导还没看完时先让路 —— 一上来两个弹窗叠着很吓人。
   *
   * **先把「上次在哪儿」算完再弹**，不是先弹出来再补上去 ——
   * 后者会让第二个按钮凭空冒出来一个，正好在他要点的位置上。
   * 用的是启动那一刻的快照 `bootPlace`：`settings.lastPlace` 在他写字的
   * 过程中一直在被更新，读活的那一份就会变成「退回书架时忽然被问」。
   */
  useEffect(() => {
    if (!settings?.root || !settings.seenGuide || alreadyGreeted()) return
    markGreeted()

    const place = bootPlace.current
    if (!place) {
      setGreeting({ resume: null })
      return
    }
    void api
      .listBooks()
      .then((books) => {
        // 书被删了、改了名，就当没这回事，**不给一个点了会报错的按钮**
        const hit = books.find((b) => b.rootPath === place.bookPath)
        setGreeting({ resume: hit ? { book: hit, place } : null })
      })
      .catch(() => {
        // 列不出书架不该让问候也弹不出来
        setGreeting({ resume: null })
      })
  }, [settings])

  // 选完文件夹、第一次进书架时把指引弹出来。只弹这一次
  useEffect(() => {
    if (settings && settings.root && !settings.seenGuide) setHelp((h) => (h === 'no' ? 'first' : h))
  }, [settings])

  /**
   * 第一次进某个页面时弹一次那一页的图文说明。
   *
   * 排在上手指引和连胜问候后面 —— 一上来三个弹窗叠着谁都受不了。
   */
  useEffect(() => {
    if (!settings?.root || !settings.seenGuide || help !== 'no' || greeting) return
    const which: TourKey = book ? ((book.meta.kind ?? 'novel') as TourKey) : 'shelf'
    if (settings.seenTours.includes(which)) return
    setTour(which)
  }, [settings, book, help, greeting])

  const chooseRoot = useCallback(async () => {
    try {
      const picked = await api.chooseRoot()
      if (picked) {
        setBook(null)
        setError(null)
        patchSettings({ root: picked })
      }
    } catch (e) {
      setError(msg(e))
    }
  }, [patchSettings])

  // 菜单事件（在书架和写作页都要响应的那几个）
  useEffect(() => {
    const offs = [
      api.onMenu('menu:choose-root', () => void chooseRoot()),
      api.onMenu('menu:new-book', () => {
        setBook(null)
        setCreateSignal((n) => n + 1)
      }),
      api.onMenu('menu:help', () => setHelp('manual')),
    ]
    return () => offs.forEach((off) => off())
  }, [chooseRoot])

  if (!settings) {
    return (
      <div className="empty-hint" style={{ paddingTop: '20vh' }}>
        正在启动……
      </div>
    )
  }

  if (!settings.root) {
    return <Setup onChoose={() => void chooseRoot()} error={error} />
  }

  const greetNode = greeting ? (
    <StreakGreeting
      resume={greeting.resume}
      onShelf={() => setGreeting(null)}
      onResume={(target) => {
        setBook(target.book)
        setGreeting(null)
      }}
    />
  ) : null

  const helpNode =
    help !== 'no' ? (
      <HelpOverlay
        firstRun={help === 'first'}
        onClose={() => {
          if (help === 'first') patchSettings({ seenGuide: true })
          setHelp('no')
        }}
      />
    ) : tour && !greeting ? (
      // 连胜问候还开着就先等着 —— 两个弹窗叠在一起很吓人。
      // 只是不渲染，`tour` 还留在状态里，问候关掉它自己就上来了

      <HelpOverlay
        tour={tour}
        onClose={() => {
          patchSettings({ seenTours: [...settings.seenTours, tour] })
          setTour(null)
        }}
      />
    ) : null

  if (book) {
    return (
      <>
        {helpNode}
        {greetNode}
        <Work
          book={book}
          onBack={() => setBook(null)}
          settings={settings}
          onSettingsChange={patchSettings}
          onChangeRoot={() => void chooseRoot()}
        />
      </>
    )
  }

  return (
    <>
      {helpNode}
      {greetNode}
      <Shelf
        root={settings.root}
        onOpen={setBook}
        onChangeRoot={() => void chooseRoot()}
        createSignal={createSignal}
        settings={settings}
        onSettings={patchSettings}
      />
    </>
  )
}

function Setup({ onChoose, error }: { onChoose(): void; error: string | null }) {
  return (
    <div className="setup">
      <div className="setup-card">
        <h1>不咕鸟</h1>
        <div className="tagline">不鸽，不断更</div>

        <p>
          先选一个文件夹放你的作品。
          <br />
          <b>建议选在坚果云的同步文件夹里</b> —— 这样手机端才能看到你的稿子。
        </p>
        <p style={{ fontSize: 13 }}>
          你的正文会以普通的 <code>.md</code> 纯文本存在这个文件夹里，
          用记事本就能打开。哪天这个软件没了，你的稿子一个字都不会少。
        </p>

        {error && (
          <div className="banner danger" style={{ borderRadius: 6, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <button className="btn btn-primary" onClick={onChoose}>
          选择文件夹
        </button>
      </div>
    </div>
  )
}
