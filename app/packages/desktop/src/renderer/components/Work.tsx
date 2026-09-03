/**
 * 写作页 —— 顶栏 + 两侧边栏 + 稿纸。
 *
 * 规范：更新文档/04-界面与交互设计.md §2
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  emptyCast,
  countWords,
  flattenChapters,
  formatCount,
  formatCountShort,
  type BookSummary,
  type BookKind,
  type BookTree,
  type Cast,
  type DocMeta,
} from '@bugu/core'
import { api } from '../api.js'
import { Editor } from './Editor.js'
import { EDGE_TRIGGER_PX, Sidebar, useSidebar } from './Sidebar.js'
import { ChoiceModal, ConfirmModal, PromptModal } from './Modal.js'
import { SettingsPanel } from './SettingsPanel.js'
import type { UserSettings } from '../../shared/api.js'
import { selectionRect, useContextMenu } from './ContextMenu.js'
import { OutlineTree, SettingsTree, TextTree, type TreeActions } from './DirectoryTree.js'
import { SearchPanel } from './SearchPanel.js'
import { StickyLayer, placeNewSticky } from './StickyLayer.js'
import { isStickyDrag, stickyCardOf } from '../sticky-drag.js'
import { ForeshadowPanel } from './ForeshadowPanel.js'
import { HistoryPanel } from './HistoryPanel.js'
import { PomodoroPanel, usePomodoro } from './PomodoroPanel.js'
import { StatsOverlay } from './StatsOverlay.js'
import { TransferOverlay } from './TransferOverlay.js'
import { ConflictOverlay } from './ConflictOverlay.js'
import { VersionClash } from './VersionClash.js'
import { QuickJump } from './QuickJump.js'
import { LinksPanel } from './LinksPanel.js'
import { TrashPanel } from './TrashPanel.js'
import { ScriptPanel } from './ScriptPanel.js'
import { GamePanel } from './GamePanel.js'
import { MilestonePanel } from './PlanPanel.js'
import { AiPanel } from './AiPanel.js'
import { IdeaPanel } from './IdeaPanel.js'
import { WordsLineChart } from './charts.js'
import type { ForeshadowListItem } from '@bugu/core'
import type { LoadedSticky, PinnedSticky } from '@bugu/core'
import { SEED_RULES, liveRules } from '../smart-replace.js'
import { EMPTY_SESSION, addEdit, describe as describeSession } from '../session-count.js'

/** 停止输入多久后自动保存（05 §2） */
const AUTOSAVE_IDLE_MS = 3000

type DirTab = 'outline' | 'text' | 'settings'
type ToolTab =
  | 'stats'
  | 'search'
  | 'settings'
  | 'ai'
  | 'pomodoro'
  | 'foreshadow'
  | 'history'
  | 'ideas'
  | 'links'
  | 'trash'
  | 'script'
  | 'game'
  | 'milestone'
  /**
   * 导入 / 导出。
   *
   * 它不是一个面板，是**开一个弹窗** —— 点了之后 toolTab 不会真的切过去。
   * 放进这张单子只是为了让它在侧边栏里看得见：
   * 原来它只挂在应用菜单的「文件」下，而菜单栏是自动隐藏的
   * （`autoHideMenuBar: true`），不按 Alt 根本看不见。
   * 作者找了半天没找到导出在哪儿 —— 那不是他的问题。
   */
  | 'transfer'

interface TodayProgress {
  day: string
  words: number
  signedIn: boolean
  wordsToSignIn: number
  streak: number
  streakMakeups: number
  /** 今天的签到线。**跟着作者设的每日底线走**，没设目标才用默认的 5000 */
  signInWords: number
}

/** 当前打开的弹窗 */
type Dialog =
  | { kind: 'newChapter'; dir: string }
  | { kind: 'newVolume' }
  | { kind: 'rename'; path: string; target: 'doc' | 'volume'; current: string }
  | { kind: 'trash'; path: string; title: string }
  | { kind: 'moveToVolume'; path: string; title: string }
  | { kind: 'newSettingCategory' }
  | { kind: 'newSettingCard'; categoryPath: string; categoryName: string }
  | { kind: 'renameSettingCategory'; categoryPath: string; current: string }
  | { kind: 'trashSettingCategory'; categoryPath: string; name: string }
  | { kind: 'linkMissing'; target: string }
  | { kind: 'newGameScript'; dir: string }
  | { kind: 'newScript'; dir: string }
  | null

export interface WorkProps {
  book: BookSummary
  onBack(): void
  settings: UserSettings
  onSettingsChange(patch: Partial<UserSettings>): void
  onChangeRoot(): void
}

export function Work({ book, onBack, settings, onSettingsChange, onChangeRoot }: WorkProps) {
  const [tree, setTree] = useState<BookTree | null>(null)
  const [docPath, setDocPath] = useState<string | null>(null)
  const [meta, setMeta] = useState<DocMeta | null>(null)
  const [loadedBody, setLoadedBody] = useState('')
  const [body, setBody] = useState('')
  const [saveState, setSaveState] = useState<'clean' | 'dirty' | 'saving' | 'saved'>('clean')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dirTab, setDirTab] = useState<DirTab>('text')
  const [toolTab, setToolTab] = useState<ToolTab>('stats')
  const [today, setToday] = useState<TodayProgress | null>(null)
  // 互换状态存在设置里（作者反馈：不该每次打开都要重设）
  const swapped = settings.sidebarSwapped

  /**
   * 这本书能看到哪几个面板。
   *
   * 剧本模式、游戏剧本按**作品类型**给 —— 类型在书架上定，
   * 不在这儿切。小说书里根本不该出现「游戏剧本」这一条。
   */
  const kind = book.meta.kind ?? 'novel'
  const tools = useMemo(() => TOOLS.filter((t) => !t.kinds || t.kinds.includes(kind)), [kind])

  // 换了本书、或者在书架上改了类型之后，原来选中的面板可能已经没了
  useEffect(() => {
    if (!tools.some((t) => t.key === toolTab)) setToolTab('stats')
  }, [tools, toolTab])
  const [dialog, setDialog] = useState<Dialog>(null)

  // ── 便利贴 ──
  const [stickies, setStickies] = useState<Map<string, LoadedSticky>>(new Map())
  const [pinned, setPinned] = useState<PinnedSticky[]>([])
  const [caret, setCaret] = useState<{ x: number; y: number } | null>(null)

  // ── 伏笔 ──
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null)
  const [due, setDue] = useState<ForeshadowListItem[]>([])
  const [chapterById, setChapterById] = useState<Map<string, { path: string; title: string }>>(new Map())
  const [fsRefresh, setFsRefresh] = useState(0)
  /** 每次保存后递增，版本历史面板据此重新拉列表 */
  const [savedTick, setSavedTick] = useState(0)
  const [showStats, setShowStats] = useState(false)
  const [transfer, setTransfer] = useState<'import' | 'export' | null>(null)
  const [showConflicts, setShowConflicts] = useState(false)
  const [quickJump, setQuickJump] = useState(false)
  /** 让编辑器跳到并选中某一段（抓虫清单用） */
  const [reveal, setReveal] = useState<{ start: number; end: number; nonce: number } | null>(null)
  /** 往编辑器里插东西（右键菜单的「插入」用） */
  const [insertReq, setInsertReq] = useState<{ before: string; after: string; nonce: number } | null>(
    null,
  )
  /** 顶栏那个「连胜 N 日」。跟着保存刷新 */
  const [streakDays, setStreakDays] = useState(0)

  useEffect(() => {
    void api
      .planReport()
      .then((r) => setStreakDays(r.streak.current))
      .catch(() => setStreakDays(0))
  }, [savedTick])

  /** 插入一段，或把选中的一段包起来 */
  const insertSyntax = useCallback((before: string, after = '') => {
    setInsertReq({ before, after, nonce: Date.now() })
  }, [])

  /**
   * 剧本排版开关。按文档记 —— 一本书里可能既有小说章节也有剧本。
   * 没单独设过的，跟着**作品类型**走：剧本书默认开着。
   */
  const [scriptDocs, setScriptDocs] = useState<Record<string, boolean>>({})
  const kindDefaultScript = book.meta.kind === 'script'
  const scriptView = docPath ? (scriptDocs[docPath] ?? kindDefaultScript) : false

  /**
   * 这本书的角色名单，从设定集里读。
   *
   * 要读每张人物卡的正文（为了别名行），所以只在开书和目录树变了的时候读一次，
   * 不放进每次按键都会走的路径。
   */
  const [cast, setCast] = useState<{
    cast: Cast
    available: string[]
    picked: string[]
    chosen: boolean
  }>({ cast: emptyCast(), available: [], picked: [], chosen: false })

  const refreshCast = useCallback(async () => {
    try {
      const r = await api.bookCast(book.rootPath)
      setCast({
        cast: { names: r.names, canonical: r.canonical },
        available: r.available,
        picked: r.categories,
        chosen: r.chosen,
      })
    } catch {
      // 读不到名单不该挡住写作 —— 退回「谁都不确凿」，也就是这个功能没开的样子
    }
  }, [book.rootPath])
  // 直接订阅番茄钟自己的状态，不靠面板回调 ——
  // 面板关着时回调就断了，顶栏那个小胶囊会停在最后一帧
  const pomo = usePomodoro()
  /** 主进程改了正文（打伏笔标记）后递增，编辑器据此把内容换掉 */
  const [externalRevision, setExternalRevision] = useState(0)

  // 钉住状态存在设置里 —— 每次开软件都要重钉一遍，等于这个功能没做
  const dirBar = useSidebar(settings.dirBarPinned, (p) => onSettingsChange({ dirBarPinned: p }))
  const toolBar = useSidebar(settings.toolBarPinned, (p) => onSettingsChange({ toolBarPinned: p }))
  const ctx = useContextMenu()

  const bodyRef = useRef(body)
  bodyRef.current = body
  const docPathRef = useRef(docPath)
  docPathRef.current = docPath
  const loadedBodyRef = useRef(loadedBody)
  loadedBodyRef.current = loadedBody
  const selectionRef = useRef<{ start: number; end: number } | null>(null)
  selectionRef.current = selection
  const metaRef = useRef<DocMeta | null>(null)
  metaRef.current = meta
  const saveStateRef = useRef(saveState)
  saveStateRef.current = saveState
  /** 存了多少次。焦点检查靠它判断「读盘期间自己是不是刚存过」 */
  const savedTickRef = useRef(0)
  /**
   * 磁盘上那一版跟屏幕上这一版对不上时，停在这儿等作者挑。
   * null = 没这回事。
   */
  const [diskVersion, setDiskVersion] = useState<{
    path: string
    body: string
    device: string
    updated: string
  } | null>(null)
  const saveTimer = useRef<number | undefined>(undefined)
  /**
   * 右上角那个「刚存了，这一段写了多少」的小弹窗。
   *
   * **只在手动保存时弹。** 自动保存每三秒一次，弹一次就是每三秒糊一次脸；
   * 而作者按 Ctrl+S 的那一下，本来就是想知道「我刚才这一阵写了多少」。
   */
  const [saveToast, setSaveToast] = useState<{ delta: number; total: number; at: number } | null>(
    null,
  )
  const toastTimer = useRef<number | undefined>(undefined)
  /**
   * 上一次**手动**保存时，每一篇各有多少字。
   *
   * 按文档记，不记一个全局数：作者在两篇之间来回切的时候，
   * 一个全局基线算出来的「新增」是两篇字数之差，那是个没有意义的数。
   * 打开一篇时先把它当时的字数记进来，所以第一次按 Ctrl+S 报的是
   * 「打开这篇之后写了多少」—— 那正好也是他想问的。
   */
  const manualBase = useRef(new Map<string, number>())

  /**
   * 上次离开时停在哪儿 —— **进这本书那一刻的那一份**。
   *
   * 用 ref 抓住初值，因为我们自己马上就会去改 `settings.lastPlace`；
   * 直接读 settings 的话，「上次在哪儿」会在打开的瞬间被「现在在哪儿」盖掉。
   */
  const resumeRef = useRef(settings.lastPlace)
  /** 现在停在哪儿。光标一动就更新，但**不写盘** —— 写盘在下面几个时机 */
  const placeRef = useRef<{ bookPath: string; docPath: string; line: number } | null>(null)
  /** 把「现在在哪儿」落到配置里。切文档、手动保存、关窗口时各存一次就够 */
  const savePlace = useCallback(() => {
    if (placeRef.current) onSettingsChange({ lastPlace: placeRef.current })
  }, [onSettingsChange])

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

  const flash = useCallback((text: string) => {
    setNotice(text)
    window.setTimeout(() => setNotice((n) => (n === text ? null : n)), 4000)
  }, [])

  /**
   * 稿纸上的右键菜单。
   *
   * Electron 默认什么菜单都没有 —— 作者右键就是一片死寂。
   * 剪切/复制/粘贴走主进程的原生编辑命令（见 editCmd），
   * 在 CodeMirror 这种自己管选区的编辑器里，那是唯一稳的做法。
   */
  const openEditorMenu = useCallback(
    (e: MouseEvent, sel: { hasSelection: boolean; selectedText: string }) => {
      const cmd = (k: 'cut' | 'copy' | 'paste' | 'selectAll') => () => void api.editCmd(k)
      // 游戏剧本的符号只在看着像游戏剧本的文档里给 ——
      // 写长篇小说的人不需要在菜单里天天看见「跳转」
      // 作品类型说了算；没标类型的老书退回看正文里有没有 `->`
      const kind = book.meta.kind
      const looksLikeGame =
        kind === 'game' ||
        (kind === undefined &&
          (bodyRef.current.includes('->') || bodyRef.current.includes('→')))
      const looksLikeScript = kind === 'script' || kind === 'game'

      // 带上选区的位置：菜单十几条，从光标处往下开正好盖住刚选中的字，
      // 想核对一眼「选对了没有」都看不见
      ctx.open(e, [
        { label: '剪切', onClick: cmd('cut'), disabled: !sel.hasSelection },
        { label: '复制', onClick: cmd('copy'), disabled: !sel.hasSelection },
        { label: '粘贴', onClick: cmd('paste') },
        { label: '全选', onClick: cmd('selectAll') },

        {
          label: sel.hasSelection ? '把这一段做成便利贴浮出' : '插入便利贴浮出标记',
          separatorBefore: true,
          onClick: () => insertSyntax('@', '@'),
        },
        {
          label: '整行浮到稿纸上（行首 @）',
          onClick: () => insertSyntax('@'),
        },
        {
          label: sel.hasSelection ? '把选中的做成双链' : '插入双链 [[ ]]',
          onClick: () => insertSyntax('[[', ']]'),
        },
        {
          label: sel.hasSelection ? '标为伏笔' : '标为伏笔（先选中一段）',
          disabled: !sel.hasSelection,
          onClick: () => {
            setToolTab('foreshadow')
            if (!toolBar.pinned) toolBar.togglePin()
            flash('在右边的伏笔清单里点「标为埋点」或「标为回收」。')
          },
        },

        { label: '二级标题 ##', separatorBefore: true, onClick: () => insertSyntax('## ') },
        {
          label: '分隔线 ——',
          onClick: () => insertSyntax(String.fromCharCode(10) + '——' + String.fromCharCode(10)),
        },

        ...(looksLikeScript
          ? [
              {
                label: '场景标题  # 内景·咖啡馆·日',
                separatorBefore: true,
                onClick: () => insertSyntax('# '),
              },
              {
                label: '动作  （……）',
                onClick: () => insertSyntax('（', '）'),
              },
              {
                label: '表演提示  角色（冷笑）：',
                onClick: () => insertSyntax('（', '）'),
              },
            ]
          : []),

        ...(looksLikeGame
          ? [
              {
                label: '选项  - 文字 -> 目标',
                separatorBefore: true,
                onClick: () => insertSyntax('- ', ' -> '),
              },
              { label: '跳转  -> 节点', onClick: () => insertSyntax('-> ') },
              {
                // 「这个时间段去哪儿」原来得一条条抄，目标和选项文字还是同一个词
                label: '一行多个去处  -> 甲、乙、丙',
                onClick: () => insertSyntax('-> '),
              },
              {
                // 分歧之后合流：在合流的这个节点上写一次，胜过回到每条分支补一行
                label: '合并进来  <- 甲、乙',
                onClick: () => insertSyntax('<- '),
              },
              { label: '结局  -> 【结束】', onClick: () => insertSyntax('-> 【', '】') },
              {
                // 不标的话体检会提一句「绕回去了」——那条提示防的是「两处重名」
                label: '有意绕回去  -> ↩节点',
                onClick: () => insertSyntax('-> ↩'),
              },
              { label: '条件  {好感度>=1}', onClick: () => insertSyntax('{', '}') },
              { label: '变量  $ 好感度 += 1', onClick: () => insertSyntax('$ ') },
              {
                // 一段里好几条选项共用一个条件时，抄五遍 {拿到钥匙} 太容易抄漏一条
                label: '条件块  $若 … $结束',
                onClick: () =>
                  insertSyntax(
                    '$若 ',
                    String.fromCharCode(10) + '$结束' + String.fromCharCode(10),
                  ),
              },
            ]
          : []),
      ], selectionRect())
    },
    [ctx, insertSyntax, toolBar, flash, book.meta.kind],
  )

  // ── 便利贴 ──

  /** 重读整本书的便利贴（新建、改名、编辑设定后都要刷） */
  const refreshStickies = useCallback(async () => {
    try {
      const list = await api.listStickies(book.rootPath)
      setStickies(new Map(list.map((c) => [c.docId, c])))
    } catch {
      /* 便利贴读不出来不该拦着写作 */
    }
  }, [book.rootPath])

  const persistPinned = useCallback(
    (next: PinnedSticky[]) => {
      setPinned(next)
      void api
        .saveStickyLayout(book.rootPath, { schemaVersion: 1, pinned: next })
        .catch(() => {})
    },
    [book.rootPath],
  )

  /** 到期提醒 + 章节 id→路径 映射 */
  const refreshForeshadows = useCallback(async () => {
    try {
      const r = await api.listForeshadows(book.rootPath, metaRef.current?.id)
      setDue(r.due)
      setChapterById(new Map(r.chapters.map((c) => [c.id, { path: c.path, title: c.title }])))
    } catch {
      /* 伏笔读不出来不该拦着写作 */
    }
  }, [book.rootPath])

  // ── 保存 ──

  /**
   * 存盘。
   *
   * `manual` 只影响一件事：**要不要弹那个小弹窗**。
   * 自动保存三秒一次，弹一次就是每三秒糊一次脸。
   */
  const doSave = useCallback(async (manual = false) => {
    const path = docPathRef.current
    if (!path) return
    window.clearTimeout(saveTimer.current)
    setSaveState('saving')
    // 记下**这一次到底写了什么**。
    //
    // 少了这一句，`loadedBody` 会一直停在「打开这篇时的样子」，
    // 于是每次切回窗口都判定成「这一篇在别处改过」——
    // 明明是自己刚存的。作者报的莫名其妙的设备检测就是这么来的。
    const written = bodyRef.current
    try {
      const out = await api.saveDoc(path, written)
      setMeta(out.meta)
      setLoadedBody(written)
      loadedBodyRef.current = written
      savedTickRef.current += 1
      // 存的过程中又打了字：状态得留在 dirty，不然界面会说「已保存」而其实没有
      setSaveState(bodyRef.current === written ? 'saved' : 'dirty')
      setSavedTick((n) => n + 1)

      if (manual) {
        // 报的是「距上次**手动**保存新增了多少」——
        // 拿自动保存当基线的话，这个数永远是「刚才那三秒写的」，没人要看
        const total = countWords(written).withPunctuation
        const base = manualBase.current.get(path) ?? total
        manualBase.current.set(path, total)
        window.clearTimeout(toastTimer.current)
        setSaveToast({ delta: total - base, total, at: Date.now() })
        toastTimer.current = window.setTimeout(() => setSaveToast(null), 2600)
        savePlace()
      }
      // 改的是设定集文档，卡片正面可能变了，重新抽一次
      if (out.meta.type === 'setting') void refreshStickies()
      void api.todayProgress(book.rootPath).then(setToday).catch(() => {})
      window.setTimeout(() => setSaveState((s) => (s === 'saved' ? 'clean' : s)), 1500)
    } catch (e) {
      setError(msg(e))
      setSaveState('dirty')
    }
  }, [book.rootPath, refreshStickies, savePlace])

  /** 切文档、关窗口前的强制保存 */
  const flushSave = useCallback(async () => {
    window.clearTimeout(saveTimer.current)
    savePlace()
    if (saveStateRef.current === 'dirty' && docPathRef.current) await doSave()
  }, [doSave, savePlace])

  // ── 打开文档 ──

  const openDoc = useCallback(
    async (path: string) => {
      try {
        await flushSave()
        const d = await api.readDoc(path)
        setDocPath(path)
        setMeta(d.meta)
        setLoadedBody(d.body)
        setBody(d.body)
        setSaveState('clean')
        setSelection(null)
        setError(null)
        // 「距上次手动保存新增多少」的起点。打开这一篇时先记一笔，
        // 于是第一次按 Ctrl+S 报的是「打开之后写了多少」—— 那正好也是他想问的
        if (!manualBase.current.has(path)) {
          manualBase.current.set(path, countWords(d.body).withPunctuation)
        }
        // 还没动光标之前也得有个位置，不然「上次在哪儿」会停在上一篇
        placeRef.current = { bookPath: book.rootPath, docPath: path, line: 0 }
        void refreshForeshadows()
      } catch (e) {
        setError(msg(e))
      }
    },
    [flushSave, refreshForeshadows],
  )

  const refreshTree = useCallback(
    async (openPath?: string) => {
      try {
        const t = await api.loadTree(book.rootPath)
        setTree(t)
        void refreshCast()
        if (openPath) await openDoc(openPath)
        return t
      } catch (e) {
        setError(msg(e))
        return null
      }
    },
    [book.rootPath, openDoc, refreshCast],
  )

  // ── 初次加载 ──

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const t = await api.loadTree(book.rootPath)
        if (!alive) return
        setTree(t)
        // 上次就停在这本书里的话，直接开那一篇 ——
        // 每次都从第一章开始，写到第八十章的人每天都要点一遍目录
        const chapters = flattenChapters(t.text)
        const last = resumeRef.current
        const resuming =
          last !== null &&
          last.bookPath === book.rootPath &&
          chapters.some((c) => c.path === last.docPath)
        const wanted = resuming ? last.docPath : chapters[0]?.path
        if (!wanted) return
        void openDoc(wanted).then(() => {
          if (!resuming || !alive) return
          // 用完就丢：换本书再回来时，那本书有它自己的「上次在哪儿」
          resumeRef.current = null
          // 等编辑器把文档挂上去再跳，否则跳的是空文档
          setTimeout(() => {
            const lines = bodyRef.current.split(String.fromCharCode(10))
            let at = 0
            for (let i = 0; i < last.line && i < lines.length; i++) at += (lines[i]?.length ?? 0) + 1
            setReveal({ start: at, end: at, nonce: Date.now() })
          }, 80)
        })
      } catch (e) {
        if (alive) setError(msg(e))
      }
    })()
    void refreshCast()
    void api.todayProgress(book.rootPath).then(setToday).catch(() => {})
    void refreshStickies()
    void refreshForeshadows()
    void api
      .loadStickyLayout(book.rootPath)
      .then((l) => alive && setPinned(l.pinned))
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.rootPath])

  const onChange = useCallback(
    (next: string) => {
      setBody(next)
      setSaveState('dirty')
      // 开始连续输入 → 收起未钉住的面板（04 §2.3）
      dirBar.hideNow()
      toolBar.hideNow()
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => void doSave(), AUTOSAVE_IDLE_MS)
    },
    [doSave, dirBar, toolBar],
  )

  // 组件走的时候把小弹窗的计时器收掉，免得它在已经卸载的组件上 setState
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  // 关窗口前保底存一次
  useEffect(() => {
    const onBeforeUnload = () => {
      if (saveStateRef.current === 'dirty' && docPathRef.current) {
        void api.saveDoc(docPathRef.current, bodyRef.current)
      }
      // 「下次回到这儿」要的就是这一笔。关窗口是最该记的时机
      if (placeRef.current) void api.updateSettings({ lastPlace: placeRef.current })
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  /**
   * 窗口重新获得焦点时，把磁盘上的变化捡回来。
   *
   * 作品文件夹就在坚果云的同步目录里 —— 另一台电脑写的东西随时会同步进来。
   * 不用文件监听（chokidar 那类）是因为同步过程中它会疯狂触发：
   * 坚果云一个文件一个文件地落盘，一次同步能打出几十上百个事件。
   * 而作者真正会察觉到的时机只有一个：他回到这台电脑前面。
   *
   * 正文脏着的时候**绝不覆盖**，只提醒 —— 那是他没保存的字。
   */
  useEffect(() => {
    const onFocus = () => {
      void (async () => {
        try {
          const t = await refreshTree()
          if (t && t.conflicts.length > 0) return // 有冲突的话横幅会自己报，不再叠一层提示

          const path = docPathRef.current
          if (!path) return

          // 读盘期间自己刚好存了一次的话，手上这份是旧的，重读一遍。
          // 不重读就会拿「保存前的磁盘内容」去跟「保存后的编辑器内容」比，
          // 比出来永远不一样 —— 这正是那个假冲突的另一半原因。
          const tick = savedTickRef.current
          let d = await api.readDoc(path)
          if (savedTickRef.current !== tick) d = await api.readDoc(path)

          // 磁盘上就是我屏幕上这份：什么都不用做（自己刚存过的常态）
          if (d.body === bodyRef.current) {
            setLoadedBody(d.body)
            loadedBodyRef.current = d.body
            setMeta(d.meta)
            return
          }
          // 磁盘没动过，只是我这儿还有没保存的字：更不用做什么
          if (d.body === loadedBodyRef.current) return

          // 到这儿才是真的两边都变了。**绝不自动覆盖** ——
          // 屏幕上那些字可能是作者刚敲的，吞掉一次他就再也不敢用这软件了。
          setDiskVersion({
            path,
            body: d.body,
            device: d.meta.device ?? '',
            updated: d.meta.updated,
          })
        } catch {
          // 文件可能刚好被同步删掉或改名了，交给目录树那边处理，这里不打扰
        }
      })()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshTree])

  // 快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key === '\\') {
        e.preventDefault()
        ;(e.shiftKey ? dirBar : toolBar).togglePin()
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void doSave(true)
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setQuickJump(true)
      } else if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        // 需要先在伏笔面板里选一个伏笔，这里只做提示
        setToolTab('foreshadow')
        if (!toolBar.pinned) toolBar.togglePin()
        flash(
          selectionRef.current
            ? '在右边的伏笔清单里点「标为埋点」或「标为回收」。'
            : '先在正文里选中一段，再按 Ctrl+E。',
        )
      } else if (e.key === 'Escape') {
        dirBar.hideNow()
        toolBar.hideNow()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirBar, toolBar, doSave, flash])

  /**
   * 靠近窗口左右边缘就唤出对应的侧边栏。
   *
   * 不用透明触发区 div —— 那玩意儿会挡住底下的点击，而且 10px 太窄，
   * 作者反馈「以为该触发但就是触发不了」。用鼠标位置判定既宽松又不挡点击。
   */
  const onWorkMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const left = swapped ? dirBar : toolBar
      const right = swapped ? toolBar : dirBar
      const w = window.innerWidth

      if (e.clientX <= EDGE_TRIGGER_PX) left.reveal()
      else if (!left.pinned && !left.visible) left.scheduleHide()

      if (e.clientX >= w - EDGE_TRIGGER_PX) right.reveal()
      else if (!right.pinned && !right.visible) right.scheduleHide()
    },
    [swapped, dirBar, toolBar],
  )

  // 菜单事件
  useEffect(() => {
    const offs = [
      api.onMenu('menu:save', () => void doSave(true)),
      api.onMenu('menu:back-to-shelf', () => void flushSave().then(onBack)),
      api.onMenu('menu:settings', () => {
        setToolTab('settings')
        toolBar.togglePin()
      }),
      api.onMenu('menu:search', () => {
        setToolTab('search')
        if (!toolBar.pinned) toolBar.togglePin()
      }),
      api.onMenu('menu:toggle-tools', () => toolBar.togglePin()),
      api.onMenu('menu:toggle-directory', () => dirBar.togglePin()),
      api.onMenu('menu:import', () => setTransfer('import')),
      api.onMenu('menu:export', () => setTransfer('export')),
      api.onMenu('menu:stats', () => setShowStats(true)),
      api.onMenu('menu:quick-jump', () => setQuickJump(true)),
      api.onMenu('menu:about', () =>
        flash('不咕鸟 —— 不鸽，不断更。稿子都是普通的 .md 文件，记事本能打开。'),
      ),
    ]
    return () => offs.forEach((off) => off())
  }, [doSave, flushSave, onBack, toolBar, dirBar, flash])

  /**
   * 写作手感那几个开关，拼成编辑器要的那一份。
   *
   * 用 useMemo 是必须的：这个对象每渲染一次都新建的话，
   * 编辑器那边的 effect 会以为「开关变了」，每敲一个字重配一次扩展。
   */
  const writing = useMemo(
    () => ({
      typewriterV: settings.typewriterV,
      typewriterH: settings.typewriterH,
      focus: settings.focusMode,
      rules: liveRules(settings.smartRules ?? SEED_RULES, settings.smartReplace),
    }),
    [
      settings.typewriterV,
      settings.typewriterH,
      settings.focusMode,
      settings.smartReplace,
      settings.smartRules,
    ],
  )

  /** 这一坐写了多少、删了多少。从软件打开算起，点顶栏那个数清零 */
  const [session, setSession] = useState(EMPTY_SESSION)
  const sessionText = useMemo(() => describeSession(session), [session])

  const counts = useMemo(() => countWords(body), [body])
  const chapters = useMemo(() => (tree ? flattenChapters(tree.text) : []), [tree])
  const volumes = useMemo(
    () => (tree ? tree.text.filter((n) => n.kind === 'volume') : []),
    [tree],
  )

  /**
   * 点了正文里的 `[[某某]]`。
   *
   * 能对上便利贴就把它贴到稿纸中间；对不上就问作者要不要建一张 ——
   * 「写着写着发现这个人物还没建卡」是很常见的情形，
   * 让他在这里一键建出来，比跳去设定集手动新建顺手得多。
   */
  const openWikiLink = useCallback(
    async (target: string) => {
      const card = [...stickies.values()].find((c) => c.title === target)
      if (card) {
        const rest = pinned.filter((p) => p.cardId !== card.docId)
        persistPinned([
          ...rest,
          placeNewSticky(card.docId, window.innerWidth / 2, window.innerHeight / 3),
        ])
        return
      }
      const t = tree
      if (!t || t.settings.length === 0) {
        flash(`还没有叫「${target}」的设定，也还没有任何设定分类。先建一个分类吧。`)
        return
      }
      setDialog({ kind: 'linkMissing', target })
    },
    [stickies, pinned, persistPinned, tree, flash],
  )

  /** 把选中的正文标为埋点或回收点 */
  const markForeshadow = useCallback(
    async (id: string, kind: 'plant' | 'recover') => {
      const path = docPathRef.current
      if (!path || !selection) return
      try {
        await flushSave()
        const r = await api.markForeshadow(book.rootPath, path, selection, id, kind)
        setLoadedBody(r.body)
        setBody(r.body)
        setExternalRevision((n) => n + 1)
        setSaveState('clean')
        setFsRefresh((n) => n + 1)
        void refreshForeshadows()
        flash(kind === 'plant' ? '埋点标好了。' : '回收点标好了。')
      } catch (e) {
        setError(msg(e))
      }
    },
    [book.rootPath, selection, flushSave, refreshForeshadows, flash],
  )

  // ── 目录操作 ──

  const actions: TreeActions = useMemo(
    () => ({
      open: (p) => void openDoc(p),
      rename: (path, target, current) => setDialog({ kind: 'rename', path, target, current }),
      trash: (path, title) => setDialog({ kind: 'trash', path, title }),
      newChapter: (dir) => setDialog({ kind: 'newChapter', dir }),
      newVolume: () => setDialog({ kind: 'newVolume' }),
      moveToVolume: (path, title) => setDialog({ kind: 'moveToVolume', path, title }),
      reveal: (p) => void api.revealInExplorer(p).catch((e) => setError(msg(e))),
      newSettingCategory: () => setDialog({ kind: 'newSettingCategory' }),
      newSettingCard: (categoryPath, categoryName) =>
        setDialog({ kind: 'newSettingCard', categoryPath, categoryName }),
      renameSettingCategory: (categoryPath, current) =>
        setDialog({ kind: 'renameSettingCategory', categoryPath, current }),
      trashSettingCategory: (categoryPath, name) =>
        setDialog({ kind: 'trashSettingCategory', categoryPath, name }),
      editTemplate: (categoryPath) => {
        void (async () => {
          try {
            const t = await api.readTemplate(categoryPath)
            await refreshTree()
            await openDoc(t.path)
            flash('正在编辑这个分类的模板。新建便利贴时会套用它。')
          } catch (e) {
            setError(msg(e))
          }
        })()
      },
      reorder: (dir, from, to) => {
        void (async () => {
          try {
            await flushSave()
            const r = await api.reorder(dir, from, to)
            const t = await refreshTree()
            if (r.renumbered) flash(`序号挤不下了，已整理这一层的编号（重命名 ${r.renamed} 个文件）`)
            // 当前打开的文件可能被改名了，按 id 重新定位
            if (t && meta) {
              const same = flattenChapters(t.text).find((c) => c.title === meta.title)
              if (same && same.path !== docPathRef.current) await openDoc(same.path)
            }
          } catch (e) {
            setError(msg(e))
          }
        })()
      },
    }),
    [openDoc, refreshTree, flushSave, flash, meta],
  )

  const runDialog = async (value?: string) => {
    const d = dialog
    setDialog(null)
    if (!d) return
    try {
      switch (d.kind) {
        case 'newChapter': {
          const { path } = await api.createChapter(d.dir, value!)
          await refreshTree(path)
          break
        }
        case 'newScript': {
          const { path } = await api.createScript(d.dir, value!)
          await refreshTree(path)
          flash('骨架建好了。「角色名：台词」这样写就会被认出来。')
          break
        }
        case 'newGameScript': {
          // 骨架本身是跑得通的：有分支、有变量、有条件、有合并、有结局，
          // 而且体检不报任何问题 —— 给作者一份自带断头路的模板等于教他写错。
          //
          // **但整份骨架只给第一篇**：主进程看这个目录里有没有稿子，
          // 有就只给一行 `# 标题`。每新建一篇都塞一遍李四，
          // 作者得先删二十行才能开始写（作者报过这个）。
          const { path } = await api.createGameScript(d.dir, value!)
          await refreshTree(path)
          flash('建好了。改成你自己的节点名和台词就行。')
          break
        }
        case 'newVolume': {
          await api.createVolume(book.rootPath, value!)
          await refreshTree()
          flash('卷建好了。往里面新建章节它才会出现在目录上（空文件夹不显示）。')
          break
        }
        case 'rename': {
          await flushSave()
          const r =
            d.target === 'volume'
              ? await api.renameVolume(d.path, value!)
              : await api.renameDoc(d.path, value!)
          await refreshTree()
          if (d.target === 'doc' && d.path === docPathRef.current) await openDoc(r.path)
          break
        }
        case 'trash': {
          await api.trashDoc(book.rootPath, d.path)
          const t = await refreshTree()
          if (d.path === docPathRef.current) {
            setDocPath(null)
            setMeta(null)
            setBody('')
            const first = t ? flattenChapters(t.text)[0] : undefined
            if (first) await openDoc(first.path)
          }
          flash(`「${d.title}」已移入回收站，没有真删。`)
          break
        }
        case 'moveToVolume': {
          await flushSave()
          const r = await api.moveToDir(d.path, value!)
          await refreshTree()
          if (d.path === docPathRef.current) await openDoc(r.path)
          break
        }
        case 'newSettingCategory': {
          await api.createSettingCategory(book.rootPath, value!)
          await refreshTree()
          flash('分类建好了，同时放了一份默认模板。')
          break
        }
        case 'newSettingCard': {
          const { path } = await api.createSettingCard(d.categoryPath, value!)
          await refreshTree(path)
          break
        }
        case 'renameSettingCategory': {
          await flushSave()
          await api.renameVolume(d.categoryPath, value!)
          await refreshTree()
          flash('分类改名了。里面的便利贴都跟着走，一张不丢。')
          break
        }
        case 'linkMissing': {
          // value 是选中的分类路径
          const { path } = await api.createSettingCard(value!, d.target)
          await refreshTree()
          await refreshStickies()
          await openDoc(path)
          flash(`已经在设定集里建好「${d.target}」，填完内容再拖到稿纸上。`)
          break
        }
        case 'trashSettingCategory': {
          await api.trashSettingCategory(book.rootPath, d.categoryPath)
          const t = await refreshTree()
          // 当前打开的正好在这个分类里，就换一篇
          if (docPathRef.current?.startsWith(d.categoryPath)) {
            setDocPath(null)
            setMeta(null)
            setBody('')
            const first = t ? flattenChapters(t.text)[0] : undefined
            if (first) await openDoc(first.path)
          }
          flash(`「${d.name}」整个分类已移入回收站，里面的便利贴都在。`)
          break
        }
      }
    } catch (e) {
      setError(msg(e))
    }
  }

  // ── 两个侧边栏（可互换） ──

  const directoryPanel = (
    <Sidebar
      side={swapped ? 'left' : 'right'}
      state={dirBar}
      width={settings.dirBarWidth}
      onResize={(px) => onSettingsChange({ dirBarWidth: px })}
      head={
        <>
          {(
            [
              ['outline', '大纲'],
              ['text', '正文'],
              ['settings', '设定集'],
            ] as Array<[DirTab, string]>
          ).map(([k, label]) => (
            <button
              key={k}
              className={`tab${dirTab === k ? ' active' : ''}`}
              onClick={() => setDirTab(k)}
            >
              {label}
            </button>
          ))}
        </>
      }
    >
      {tree && dirTab === 'text' && (
        <TextTree tree={tree} activePath={docPath} actions={actions} onMenu={ctx.open} />
      )}
      {tree && dirTab === 'outline' && (
        <OutlineTree tree={tree} activePath={docPath} actions={actions} onMenu={ctx.open} />
      )}
      {tree && dirTab === 'settings' && (
        <SettingsTree tree={tree} activePath={docPath} actions={actions} onMenu={ctx.open} />
      )}
    </Sidebar>
  )

  const toolPanel = (
    <Sidebar
      side={swapped ? 'right' : 'left'}
      state={toolBar}
      width={settings.toolBarWidth}
      onResize={(px) => onSettingsChange({ toolBarWidth: px })}
    >
      <div className="panel-list">
        {tools.map((t) => (
          <button
            key={t.key}
            className={`panel-item${toolTab === t.key ? ' active' : ''}`}
            onClick={() => {
              // 「导入 / 导出」是个弹窗，不是面板：切过去会显示一片空白
              if (t.key === 'transfer') setTransfer('export')
              else setToolTab(t.key)
            }}
          >
            <span>{t.label}</span>
            {!t.done && <span className="todo">未做</span>}
          </button>
        ))}
      </div>
      <div style={{ borderTop: '1px solid var(--window-border)', marginTop: 6 }}>
        {toolTab === 'stats' ? (
          <StatsPanel
            bookPath={book.rootPath}
            today={today}
            counts={counts}
            bookTitle={book.meta.title}
            refreshKey={savedTick}
            onOpenFull={() => setShowStats(true)}
          />
        ) : toolTab === 'search' ? (
          <SearchPanel bookPath={book.rootPath} onOpen={(p) => void openDoc(p)} />
        ) : toolTab === 'foreshadow' ? (
          <ForeshadowPanel
            bookPath={book.rootPath}
            currentDocId={meta?.id ?? null}
            hasSelection={selection !== null}
            onPlant={(id) => void markForeshadow(id, 'plant')}
            onRecover={(id) => void markForeshadow(id, 'recover')}
            onOpen={(p) => void openDoc(p)}
            onChanged={() => void refreshForeshadows()}
            docPathById={chapterById}
            refreshKey={fsRefresh}
          />
        ) : toolTab === 'links' ? (
          <LinksPanel
            bookPath={book.rootPath}
            docPath={docPath}
            docTitle={meta?.title ?? ''}
            refreshKey={savedTick}
            onOpen={(p) => void openDoc(p)}
            onCreateCard={(name) => setDialog({ kind: 'linkMissing', target: name })}
          />
        ) : toolTab === 'script' ? (
          <ScriptPanel
            body={body}
            scriptView={scriptView}
            onToggleView={(next) => {
              if (!docPath) return
              setScriptDocs((m) => ({ ...m, [docPath]: next }))
            }}
            onJump={(lineNo) => {
              // 行号换成字符位置：前面每一行的长度加上换行符
              const lines = bodyRef.current.split(String.fromCharCode(10))
              let at = 0
              for (let i = 0; i < lineNo && i < lines.length; i++) at += (lines[i]?.length ?? 0) + 1
              setReveal({ start: at, end: at + (lines[lineNo]?.length ?? 0), nonce: Date.now() })
            }}
            onMoveScene={(from, to) => {
              if (!docPath) return
              void (async () => {
                try {
                  // 先把手上没保存的字落盘，不然挪的是磁盘上的旧版本
                  await flushSave()
                  const r = await api.moveSceneIn(docPath, from, to)
                  setLoadedBody(r.body)
                  setBody(r.body)
                  setExternalRevision((n) => n + 1)
                  setSaveState('clean')
                  setSavedTick((n) => n + 1)
                  flash('挪好了。这一步在版本历史里留了痕迹，挪错能回滚。')
                } catch (e) {
                  setError(msg(e))
                }
              })()
            }}
            onNewScript={() => setDialog({ kind: 'newScript', dir: `${book.rootPath}/正文` })}
            bookCast={cast.cast}
            castCategories={cast.available}
            castChosen={{ picked: cast.picked, chosen: cast.chosen }}
            onCastCategories={(next) => {
              void api
                .setCastCategories(book.rootPath, next)
                .then(refreshCast)
                .catch((e) => setError(msg(e)))
            }}
          />
        ) : toolTab === 'milestone' ? (
          <MilestonePanel bookPath={book.rootPath} refreshKey={savedTick} />
        ) : toolTab === 'game' ? (
          <GamePanel
            bookPath={book.rootPath}
            refreshKey={savedTick}
            // 把编辑器里还没存的这一篇给它，图就不用等自动保存那三秒
            live={docPath ? { path: docPath, body } : null}
            onInsert={(before, after) => insertSyntax(before, after ?? '')}
            onOpenAt={(p, lineNo) => {
              void (async () => {
                if (p !== docPathRef.current) await openDoc(p)
                // 等编辑器把新文档挂上去再跳，否则跳的是上一篇的位置
                setTimeout(() => {
                  const lines = bodyRef.current.split(String.fromCharCode(10))
                  let at = 0
                  for (let i = 0; i < lineNo && i < lines.length; i++) at += (lines[i]?.length ?? 0) + 1
                  setReveal({ start: at, end: at + (lines[lineNo]?.length ?? 0), nonce: Date.now() })
                }, 60)
              })()
            }}
            onNewTemplate={() => setDialog({ kind: 'newGameScript', dir: `${book.rootPath}/正文` })}
          />
        ) : toolTab === 'trash' ? (
          <TrashPanel
            bookPath={book.rootPath}
            refreshKey={savedTick}
            onRestored={() => {
              void refreshTree()
              flash('放回原处了。')
            }}
          />
        ) : toolTab === 'ideas' ? (
          <IdeaPanel
            bookPath={book.rootPath}
            tree={tree}
            refreshKey={savedTick}
            onOpen={(p) => void openDoc(p)}
            onMergedInto={(path, newBody) => {
              void refreshTree()
              if (path === docPathRef.current) {
                setLoadedBody(newBody)
                setBody(newBody)
                setExternalRevision((n) => n + 1)
                setSaveState('clean')
              }
              flash('已归入。原碎片进了回收站，归错了还能捞回来。')
            }}
          />
        ) : toolTab === 'ai' ? (
          <AiPanel
            bookPath={book.rootPath}
            docPath={docPath}
            selectedText={selection ? body.slice(selection.start, selection.end) : ''}
            onAdopt={(text) => {
              // AI 的输出永远由作者点了才进正文
              const at = selection?.end ?? body.length
              const next = body.slice(0, at) + '\n\n' + text.trim() + body.slice(at)
              setLoadedBody(next)
              setBody(next)
              setExternalRevision((n) => n + 1)
              setSaveState('dirty')
              flash('已插入。没保存之前随时可以撤销（Ctrl+Z）。')
            }}
            onLocate={(quote) => {
              // 模型抄回来的原文可能带了引号或多余空白，去掉再找
              const needle = quote.trim().replace(/^[「『"'']|[」』"'']$/g, '')
              const at = bodyRef.current.indexOf(needle)
              if (at < 0) {
                flash('在正文里没找到这一段 —— 模型抄的时候可能改了字。可以自己搜一下。')
                return
              }
              setReveal({ start: at, end: at + needle.length, nonce: Date.now() })
            }}
          />
        ) : toolTab === 'pomodoro' ? (
          <PomodoroPanel />
        ) : toolTab === 'history' ? (
          <HistoryPanel
            bookPath={book.rootPath}
            docId={meta?.id ?? null}
            docPath={docPath}
            docTitle={meta?.title ?? ''}
            refreshKey={savedTick}
            onRolledBack={(newBody) => {
              setLoadedBody(newBody)
              setBody(newBody)
              setExternalRevision((n) => n + 1)
              setSaveState('clean')
              flash('已经回滚。这次回滚也存成了一个版本，随时能再回来。')
            }}
          />
        ) : toolTab === 'settings' ? (
          <SettingsPanel settings={settings} onChange={onSettingsChange} onChangeRoot={onChangeRoot} />
        ) : (
          <div className="empty-hint">
            这个功能还没做。
            <br />
            当前进度见 开发记录.md
          </div>
        )}
      </div>
    </Sidebar>
  )

  return (
    <div className="work">
      <div className="topbar">
        <button className="icon-btn" onClick={() => void flushSave().then(onBack)} title="回到书架">
          ← 书架
        </button>
        <div className="crumb">
          <span>{book.meta.title}</span>
          {meta && (
            <>
              <span className="crumb-sep">›</span>
              <span className="crumb-cur">{meta.title}</span>
            </>
          )}
        </div>
        <div className="topbar-right">
          {/*
            这一坐的产出。**三个数都摆出来**：改稿那天净值常常是负的，
            只显示净值看着像一下午白干 —— 而删掉三百字不是没干活。
            点一下清零重新计（换个时段重新算一坐）。
          */}
          {sessionText && (
            <span
              className="topbar-session"
              title="这一坐的产出。点一下清零重新计"
              onClick={() => setSession(EMPTY_SESSION)}
            >
              {sessionText}
            </span>
          )}
          {today && (
            <span title={`今日 ${formatCount(today.words)} 字`}>
              今日 {formatCountShort(today.words)}
              {today.signedIn ? ' ✓' : ` · 还差 ${formatCount(today.wordsToSignIn)}`}
            </span>
          )}
          {/*
            写作页只补这一个数。作者原话：
            「写作页本来就有当前码字和今日目标了，在旁边补上一个连胜XXX日即可。」
            —— 稿纸旁边不该再摆更多东西分心。
          */}
          {streakDays > 0 && (
            <span className="topbar-streak" title="连续达标天数">
              连胜 {streakDays} 日
            </span>
          )}
          {pomo.phase !== 'idle' && (
            <span className={`pomo-chip ${pomo.phase}`} title="番茄钟">
              {pomo.phase === 'focus' ? '专注' : '休息'} {fmtClock(pomo.remaining)}
            </span>
          )}
          <span title="本章字数（含标点）">{formatCount(counts.withPunctuation)} 字</span>
          <span
            className={`save-dot ${saveState === 'dirty' ? 'dirty' : saveState === 'saved' ? 'saved' : ''}`}
            title={SAVE_HINT[saveState]}
          />
        </div>
      </div>

      {error && (
        <div className="banner danger">
          {error}
          <button
            className="icon-btn"
            style={{ marginLeft: 'auto', color: '#fff' }}
            onClick={() => setError(null)}
          >
            知道了
          </button>
        </div>
      )}
      {notice && <div className="banner">{notice}</div>}

      {/*
        手动保存的小回执。**只在按 Ctrl+S / 点保存时出现** ——
        自动保存三秒一次，弹一次就是每三秒糊一次脸。
        它回答的是「我刚才这一阵写了多少」，所以主角是那个增量，
        总字数只用小字带一句。
      */}
      {saveToast && (
        <div className="save-toast" key={saveToast.at}>
          <b>已保存</b>
          <span className="save-toast-delta">
            {saveToast.delta > 0
              ? `+${formatCount(saveToast.delta)} 字`
              : saveToast.delta < 0
                ? `${formatCount(saveToast.delta)} 字`
                : '没有新增'}
          </span>
          <span className="faint">距上次手动保存 · 本篇共 {formatCount(saveToast.total)} 字</span>
        </div>
      )}
      {due.length > 0 && (
        <div className="banner banner-soft">
          有 {due.length} 个伏笔计划在此之前回收：
          {due.slice(0, 3).map((f) => f.title).join('、')}
          {due.length > 3 && ' 等'}
          <button
            className="icon-btn"
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              setToolTab('foreshadow')
              if (!toolBar.pinned) toolBar.togglePin()
            }}
          >
            去看看
          </button>
        </div>
      )}
      {tree && tree.conflicts.length > 0 && (
        <div className="banner">
          检测到 {tree.conflicts.length} 个坚果云冲突副本 —— 两台电脑各写了一版，需要你挑一边。
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={() => setShowConflicts(true)}>
            并排看看
          </button>
        </div>
      )}

      <div className="work-body" onMouseMove={onWorkMouseMove}>
        {swapped ? directoryPanel : toolPanel}

        <div
          className="paper"
          onDragOver={(e) => {
            if (!isStickyDrag(e)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={(e) => {
            const cardPath = stickyCardOf(e)
            if (!cardPath) return
            e.preventDefault()
            const card = [...stickies.values()].find((c) => c.path === cardPath)
            if (!card) return
            // 已经贴过的就挪到落点，不重复贴一张
            const rest = pinned.filter((p) => p.cardId !== card.docId)
            persistPinned([...rest, placeNewSticky(card.docId, e.clientX, e.clientY)])
          }}
        >
          {docPath ? (
            <Editor
              docPath={docPath}
              initialBody={loadedBody}
              onChange={onChange}
              onSaveRequest={() => void doSave(true)}
              onCaretMove={setCaret}
              onEdit={(a, r) => setSession((c) => addEdit(c, a, r))}
              onSelectionChange={(r) => {
                setSelection(r)
                const path = docPathRef.current
                if (!path) return
                // 只记在内存里。每挪一下光标写一次配置文件太吵了
                const before = bodyRef.current.slice(0, r?.start ?? 0)
                placeRef.current = {
                  bookPath: book.rootPath,
                  docPath: path,
                  line: before.split(String.fromCharCode(10)).length - 1,
                }
              }}
              onWikiLink={(target) => void openWikiLink(target)}
              externalRevision={externalRevision}
              revealRange={reveal}
              script={scriptView}
              writing={writing}
              cast={cast.cast}
              insertRequest={insertReq}
              onContextMenu={openEditorMenu}
            />
          ) : (
            <div className="empty-hint" style={{ alignSelf: 'center' }}>
              {chapters.length === 0
                ? '这本书还没有章节。\n把鼠标移到边缘，在目录里新建一章。'
                : '从目录里选一章开始写。'}
            </div>
          )}
        </div>

        {swapped ? toolPanel : directoryPanel}
      </div>

      <StickyLayer
        pinned={pinned}
        cards={stickies}
        currentDocId={meta?.id ?? null}
        caret={caret}
        onChange={persistPinned}
        onOpen={(p) => void openDoc(p)}
      />

      {showStats && <StatsOverlay bookPath={book.rootPath} onClose={() => setShowStats(false)} />}
      {transfer && (
        <TransferOverlay
          bookPath={book.rootPath}
          bookTitle={book.meta.title}
          tab={transfer}
          onClose={() => setTransfer(null)}
          onImported={() => {
            void refreshTree()
            flash('导入完成。新章节接在原有章节后面，原稿一个字没动。')
          }}
        />
      )}

      {quickJump && tree && (
        <QuickJump tree={tree} onPick={(p) => void openDoc(p)} onClose={() => setQuickJump(false)} />
      )}

      {showConflicts && (
        <ConflictOverlay
          bookPath={book.rootPath}
          onClose={() => setShowConflicts(false)}
          onResolved={() => {
            void refreshTree()
            flash('处理好了。换下来的那份在回收站里。')
          }}
        />
      )}

      {diskVersion && (
        <VersionClash
          mine={{ device: settings.deviceName, updated: new Date().toISOString(), body }}
          theirs={{
            device: diskVersion.device,
            updated: diskVersion.updated,
            body: diskVersion.body,
          }}
          onKeepMine={() => {
            // 什么都不动。磁盘那版原样留着，等他下次保存才会覆盖 ——
            // 那时候是他自己按的 Ctrl+S，不是软件替他做的决定
            setDiskVersion(null)
            flash('留着你这版。下次保存会覆盖磁盘上那份。')
          }}
          onTakeTheirs={() => {
            const d = diskVersion
            setDiskVersion(null)
            void (async () => {
              try {
                // **先把手上这版存下来再换。** 顺序反过来就等于吞字
                const stamp = new Date()
                const p2 = (n: number) => String(n).padStart(2, '0')
                const suffix = `（本机未保存 ${p2(stamp.getMonth() + 1)}-${p2(stamp.getDate())} ${p2(stamp.getHours())}${p2(stamp.getMinutes())}）`
                const aside = await api.saveAside(d.path, bodyRef.current, suffix)
                window.clearTimeout(saveTimer.current)
                setLoadedBody(d.body)
                loadedBodyRef.current = d.body
                setBody(d.body)
                setSaveState('clean')
                setExternalRevision((n) => n + 1)
                const fresh = await api.readDoc(d.path)
                setMeta(fresh.meta)
                await refreshTree()
                flash(`换成磁盘那版了。你原来那版存成了「${aside.path.split('/').pop()}」。`)
              } catch (e) {
                setError(msg(e))
              }
            })()
          }}
        />
      )}

      {ctx.node}
      {renderDialog(dialog, volumes, tree?.settings ?? [], runDialog, () => setDialog(null))}
    </div>
  )
}

// ───────────────────────── 弹窗分派 ─────────────────────────

function renderDialog(
  dialog: Dialog,
  volumes: Array<{ path: string; title: string }>,
  categories: Array<{ path: string; name: string }>,
  run: (value?: string) => void,
  cancel: () => void,
) {
  if (!dialog) return null

  switch (dialog.kind) {
    case 'newScript':
      return (
        <PromptModal
          title="新建剧本"
          hint="会给一份带场景、动作、台词的骨架。"
          placeholder="第一场"
          confirmText="创建"
          onConfirm={run}
          onCancel={cancel}
        />
      )
    case 'newGameScript':
      return (
        <PromptModal
          title="新建游戏剧本"
          hint="会给一份带分支、变量、条件、结局的骨架，照着改就行。"
          placeholder="第一幕"
          confirmText="创建"
          onConfirm={run}
          onCancel={cancel}
        />
      )
    case 'newChapter':
      return (
        <PromptModal
          title="新建章节"
          placeholder="章节标题，如「第三章 转折」"
          confirmText="创建"
          onConfirm={run}
          onCancel={cancel}
        />
      )
    case 'newVolume':
      return (
        <PromptModal
          title="新建卷"
          placeholder="卷名，如「第二卷 江湖远」"
          confirmText="创建"
          onConfirm={run}
          onCancel={cancel}
        />
      )
    case 'rename':
      return (
        <PromptModal
          title={dialog.target === 'volume' ? '重命名卷' : '重命名'}
          hint="只改名字，不改顺序。文件名和文档标题会一起改。"
          initial={dialog.current}
          confirmText="改名"
          onConfirm={run}
          onCancel={cancel}
        />
      )
    case 'trash':
      return (
        <ConfirmModal
          title={`删除「${dialog.title}」？`}
          body="会移进作品目录下的 _回收站，不是真删。想彻底删除得去回收站里清空。"
          confirmText="移入回收站"
          danger
          onConfirm={() => run()}
          onCancel={cancel}
        />
      )
    case 'moveToVolume':
      return (
        <ChoiceModal
          title={`把「${dialog.title}」移到哪一卷？`}
          options={volumes.map((v) => ({ value: v.path, label: v.title }))}
          emptyText="这本书还没有分卷。先在目录里新建一个卷。"
          onConfirm={run}
          onCancel={cancel}
        />
      )
    case 'newSettingCategory':
      return (
        <PromptModal
          title="新建设定分类"
          hint="分类就是一个文件夹，比如「人物」「势力」「功法」。建好后会自动放一份模板。"
          placeholder="分类名"
          confirmText="创建"
          onConfirm={run}
          onCancel={cancel}
        />
      )
    case 'linkMissing':
      return (
        <ChoiceModal
          title={`还没有叫「${dialog.target}」的设定`}
          hint="选一个分类，现在就建一张便利贴。"
          options={categories.map((c) => ({ value: c.path, label: c.name }))}
          emptyText="还没有设定分类。先在「设定集」标签里建一个。"
          onConfirm={run}
          onCancel={cancel}
        />
      )
    case 'renameSettingCategory':
      return (
        <PromptModal
          title="重命名分类"
          hint="就是给文件夹改个名。里面的便利贴都跟着走。"
          initial={dialog.current}
          confirmText="改名"
          onConfirm={run}
          onCancel={cancel}
        />
      )
    case 'trashSettingCategory':
      return (
        <ConfirmModal
          title={`删除「${dialog.name}」整个分类？`}
          body="这个分类连同里面所有便利贴都会移进回收站，不是真删。"
          confirmText="移入回收站"
          danger
          onConfirm={() => run()}
          onCancel={cancel}
        />
      )
    case 'newSettingCard':
      return (
        <PromptModal
          title={`在「${dialog.categoryName}」里新建便利贴`}
          hint="会套用这个分类的模板，你只需要填空。"
          placeholder="名字"
          confirmText="创建"
          onConfirm={run}
          onCancel={cancel}
        />
      )
  }
}

// ───────────────────────── 子组件 ─────────────────────────

const SAVE_HINT: Record<string, string> = {
  clean: '已保存',
  dirty: '有未保存的改动，3 秒后自动保存',
  saving: '正在保存……',
  saved: '刚刚保存',
}

/**
 * 功能列表。刻意不放图标 —— 作者要求整体以简约为主。
 *
 * ─────────────────────────────────────────────────────────────
 * 【这里为什么只剩这些】
 *
 * - **剧本模式 / 游戏剧本按作品类型给**，不是人人都有的一条。
 *   写哪种东西是这本书的属性，在书架上定；边写边在侧边栏里换模式，
 *   等于让作者以为「格式是可以随手切的」，而它不是。
 * - **码字计划不在这儿**。目标是「人」的属性、不分在写哪本书，
 *   所以整块搬去书架的总设置。留在这儿的只有**里程碑** ——
 *   那是按书的（这一卷什么时候写完），跟正在写的这本关系极大。
 * - **回收站留着**：它是按书的（`listTrash(bookPath)`），
 *   删掉的章节就该在这本书里捞。
 * ─────────────────────────────────────────────────────────────
 */
const TOOLS: Array<{ key: ToolTab; label: string; done: boolean; kinds?: BookKind[] }> = [
  { key: 'stats', label: '字数统计', done: true },
  { key: 'search', label: '全文检索', done: true },
  { key: 'settings', label: '设置', done: true },
  { key: 'foreshadow', label: '伏笔', done: true },
  { key: 'links', label: '关联', done: true },
  { key: 'history', label: '版本历史', done: true },
  { key: 'milestone', label: '里程碑', done: true },
  { key: 'pomodoro', label: '番茄钟', done: true },
  { key: 'ideas', label: '灵感箱', done: true },
  // 游戏剧本也是剧本，「谁的戏多」「谁好久没出声」照样用得上
  { key: 'script', label: '剧本模式', done: true, kinds: ['script', 'game'] },
  { key: 'game', label: '游戏剧本', done: true, kinds: ['game'] },
  { key: 'trash', label: '回收站', done: true },
  { key: 'ai', label: 'AI 助手', done: true },
  // 点它是开弹窗，不是切面板。见 ToolTab 上那段注释
  { key: 'transfer', label: '导入 / 导出', done: true },
]

function StatsPanel({
  bookPath,
  today,
  counts,
  bookTitle,
  refreshKey,
  onOpenFull,
}: {
  bookPath: string
  today: TodayProgress | null
  counts: { withPunctuation: number; withoutPunctuation: number }
  bookTitle: string
  refreshKey: number
  onOpenFull(): void
}) {
  const [recent, setRecent] = useState<Array<{ day: string; words: number }>>([])

  // 侧边栏只放 30 天的迷你曲线 —— 年度热力图要 53 列，250px 宽塞不下，
  // 塞进去每格不到 4px，那不叫图叫噪点。完整统计走宽面板。
  useEffect(() => {
    void api
      .statsReport(bookPath, { days: 30 })
      .then((r) => setRecent(r.daily.map((d) => ({ day: d.day, words: d.words }))))
      .catch(() => {})
  }, [bookPath, refreshKey])

  if (!today) return <div className="empty-hint">正在读统计……</div>

  const total = today.words + today.wordsToSignIn
  const pct = today.signedIn ? 100 : Math.min(100, Math.round((today.words / (total || 1)) * 100))

  return (
    <div className="stat-block">
      <div className="faint" style={{ fontSize: 11 }}>
        {bookTitle} · {today.day}
      </div>
      <div className="stat-big">{formatCount(today.words)}</div>
      <div className="muted" style={{ fontSize: 12 }}>
        今日字数
        {today.signedIn ? ' · 已签到' : ` · 还差 ${formatCount(today.wordsToSignIn)} 字签到`}
      </div>

      <div className="progress">
        <i style={{ width: `${pct}%` }} />
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="faint" style={{ fontSize: 11, marginBottom: 2 }}>
          最近 30 天
        </div>
        <WordsLineChart data={recent} width={210} height={54} compact />
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="stat-row">
          <span>连续</span>
          <b>
            {today.streak} 天
            {today.streakMakeups > 0 && (
              <span className="faint" style={{ fontWeight: 400 }}>
                （{today.streakMakeups} 天补签）
              </span>
            )}
          </b>
        </div>
        <div className="stat-row">
          <span>本章 · 含标点</span>
          <b>{formatCount(counts.withPunctuation)}</b>
        </div>
        <div className="stat-row">
          <span>本章 · 不含标点</span>
          <b>{formatCount(counts.withoutPunctuation)}</b>
        </div>
      </div>

      <button className="btn" style={{ width: '100%', marginTop: 14 }} onClick={onOpenFull}>
        完整统计
      </button>

    </div>
  )
}

function fmtClock(ms: number): string {
  const total = Math.ceil(ms / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

