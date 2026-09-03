/**
 * 主进程与渲染进程之间的契约。
 *
 * 渲染进程**不允许**直接碰文件系统 —— 所有磁盘操作都经由这里的方法
 * 走 IPC 到主进程。这既是 Electron 的安全要求，也让「换成移动端」时
 * 只需要换掉这一层的实现。
 */

export interface LoginState {
  signedIn: boolean
  /** IdP 那边的用户号。公开地址用的短名由那台小服务另外管 */
  sub: string
  name: string
  /** 服务地址和 App ID 齐了没有。缺了连登录按钮都不该给 */
  configured: boolean
  /**
   * 登录时被拒掉、只好放弃的权限。
   *
   * 登进去了但少了点东西，界面上得说出来 —— 不然作者会奇怪
   * 「为什么昵称是空的」「为什么过一阵又要我登一次」。
   */
  dropped: string[]
}

import type {
  BookMeta,
  BookSummary,
  BookTree,
  DocMeta,
  DocType,
  ExportChapter,
  ExportOptions,
  ExportPreview,
  ImportPlan,
  ForeshadowAnchor,
  ForeshadowListItem,
  ForeshadowPriority,
  HistoryEntry,
  DayStat,
  HeatCell,
  StreakInfo,
  DayJudgement,
  Plan,
  WeekTarget,
  MilestoneView,
  MilestoneTarget,
  BookKind,
  PublicStats,
  PublicProfile,
  Award,
  SceneCast,
  EngineExport,
  ForeignPlan,
  GameNode,
  GameProgress,
  Problem as GameProblem,
  ConflictPair,
  DiffSummary,
  TodayStat,
  WritingSession,
  CapacityStatus,
  LoadedSticky,
  StickyLayout,
  TrashEntry,
} from '@bugu/core'
import type { ThemeDraft } from './theme-draft.js'
import type { ThemeSlot } from './theme-slots.js'

/**
 * 「我在对外统计服务上是什么样」。**这里没有令牌** —— 令牌只在主进程里。
 *
 * 三样东西齐了才会真有东西往外发：登录了、认领了短名、打开了自动上传。
 * 界面得把这三样分开说，不然作者搞不清「为什么别人读不到我」。
 */
/** 一条标点替换规则 */
export type SmartRule =
  | { id: string; kind: 'plain'; from: string; to: string }
  | { id: string; kind: 'pair'; from: string; open: string; close: string }

/**
 * 一个自选样式的槽位。
 *
 * 带名字和颜色 —— 有了名字它才跟「纸白」「护眼」平起平坐，
 * 而不是一个躺在设置里的文件路径。
 */
// 栏位那套规矩（会长的一排、末尾永远留一个空位）在 theme-slots.ts
export type { ThemeSlot } from './theme-slots.js'

export interface StatsState {
  /** 登录了没有。没登录时下面几项都是空的，也不会去发请求 */
  signedIn: boolean
  /** 对外短名。空 = 还没认领，公开地址就还不存在 */
  handle: string
  /** 服务器上那份数据最后一次更新是什么时候（服务器时间，ISO）。空 = 没推过 */
  updatedAt: string
  /** 服务器上现在存着的那七个数。null = 一次都没推过 */
  stats: PublicStats | null
  /** 别人能打开的那个地址。没认领短名时是空串 */
  publicUrl: string
  /** 自动上传开着吗 */
  autoPush: boolean
  /** 上次推成功是什么时候（本机时间，ISO）。空 = 没推过 */
  lastPushAt: string
  /** 上一次自动上传出的错。空 = 没出错。**只在页面上说一句，不弹窗** */
  autoError: string
  /**
   * 我拿到的奖状。**只读** —— 客户端不判定、不发、不改。
   *
   * 它只从 `/me` 来，公开接口里没有这个字段。
   */
  awards: Award[]
}

/** 读自选 CSS 的结果 */
export interface ThemeCssResult {
  /** CSS 正文。读不到就是空串 */
  css: string
  /** 配的是哪个文件。没配就是空串 */
  path: string
  /** 有什么不对劲。空 = 没问题。**这句话要显示给作者看** */
  problem: string
  /**
   * 桥接翻译出来的排版规则条数。
   *
   * 0 通常不是坏事 —— 说明这份主题只调了颜色变量，那本来就能直接生效。
   */
  bridged: number
  /**
   * 这份主题定义的纸色。**空串 = 它压根没定义纸色**。
   *
   * 空串不是出错。有一整类 Typora 主题（phycat 那种）只给强调色和排版，
   * 纸色用的是 Typora 自己的默认白 —— 装上之后纸自然还是白的。
   * 这件事得说出来，不然作者只会看到「纸没变」，然后去找哪个文件漏了。
   */
  paper: string
}

/** 书架上那个位置要挂哪一张奖状 */
export interface AwardChoice {
  awards: Award[]
  /** 挂哪一张（id）。空 = 挂最新的那张 */
  pinned: string
}

export interface SearchHit {
  docId: string
  book: string
  path: string
  type: DocType
  title: string
  /** 带高亮标记的片段：命中处被 U+0001 与 U+0002 包住 */
  snippet: string
  rank: number
}

export interface SearchResult {
  hits: SearchHit[]
  /** 命中总数，不受条数上限影响 */
  total: number
  truncated: boolean
}

export interface IndexStats {
  docs: number
  books: number
  bytes: number
  builtAt: number
}

export interface UserSettings {
  root: string | null
  deviceId: string
  /** 这台机器叫什么。「在别处改过」的对话框要显示它 */
  deviceName: string
  countMode: 'withPunctuation' | 'withoutPunctuation'
  /** 主题 key。名单在 renderer/themes.ts —— 那儿是唯一一处定义 */
  theme: string
  /** 自选样式的三个槽位 */
  /**
   * 自定义主题栏位。**长度是活的** —— 末尾永远留一个空位，直到满九个。
   * 每一格要么是一份 CSS 文件，要么是一套自己调的。
   */
  themeCssSlots: ThemeSlot[]
  /** 现在用第几个槽位。-1 = 用预设主题 */
  themeCssActive: number
  /** 0.4 之前的单个位置，只用于搬旧配置 */
  themeCss: string
  /**
   * 调色器手上那份**还在改的**草稿。null = 还没调过。
   *
   * 它不是「正在用的主题」—— 用的那套在栏位里。这一份只是让调色器
   * 关掉再打开时能接着改，不至于每次都从预设重来。
   */
  themeDraft: ThemeDraft | null
  fontFamily: string
  fontSize: number
  lineHeight: number
  pageWidth: number
  /** 左右侧边栏互换。存在设置里，不是每次打开都要重设 */
  sidebarSwapped: boolean
  /**
   * 两个侧边栏钉住了没有。
   *
   * **钉住是个决定，不是个手势** —— 每次开软件都得重钉一遍，
   * 等于这个功能没做（作者报过这个）。
   */
  dirBarPinned: boolean
  toolBarPinned: boolean
  /** 上手指引看过了没有 */
  seenGuide: boolean
  /**
   * 已经看过图文说明的页面：`shelf` / `novel` / `script` / `game`。
   *
   * 按页面记而不是一个总开关 —— 一个只写小说的人不该被弹游戏剧本那一页；
   * 而他哪天真开了本剧本，那一页还得弹。
   */
  seenTours: string[]
  /**
   * 隔半小时自动把那七个数推到对外统计服务。
   *
   * **默认关着。** 「有东西在往外发」必须是作者自己按下的开关。
   */
  statsAutoPush: boolean
  /** 上次推成功是什么时候（本机时间，ISO）。空 = 一次都没推过 */
  statsLastPushAt: string
  /** 每个主题各自的字号。换主题时自动换回那一档上次用的 */
  fontSizeByTheme: Record<string, number>
  /** 自己导进来的字体：字体名 → 文件名 */
  customFonts: Record<string, string>
  /** 打字机 · 竖向：当前行停在屏幕中部 */
  typewriterV: boolean
  /** 打字机 · 横向：当前列停在水平中央。**它会关掉自动折行** */
  typewriterH: boolean
  /** 专注模式：当前段落之外变淡 */
  focusMode: boolean
  /** 稿纸上下留白（像素） */
  pagePadY: number
  /** 首行缩进几个字。0 = 不缩进。是 CSS 缩进，文件里不存空格 */
  paraIndent: number
  /** 智能替换总开关 */
  smartReplace: boolean
  /**
   * 标点替换的规则表。存在即生效，不存在即删除 —— 没有开关。
   * `null` = 还没初始化过，界面会写入出厂那几条。
   */
  smartRules: SmartRule[] | null
  /** 两个侧边栏各自的宽度（像素）。按面板记，互换之后宽度跟着面板走 */
  dirBarWidth: number
  toolBarWidth: number
  /**
   * 上次离开时人在哪儿。null = 没有记录。
   *
   * 存在本机配置里而不是作品目录里：这是「这台电脑上的我」停在哪儿，
   * 跟着同步跑到另一台电脑上只会打架。
   */
  lastPlace: { bookPath: string; docPath: string; line: number } | null
}

export type MenuChannel =
  | 'menu:choose-root'
  | 'menu:new-book'
  | 'menu:back-to-shelf'
  | 'menu:settings'
  | 'menu:save'
  | 'menu:find'
  | 'menu:search'
  | 'menu:toggle-directory'
  | 'menu:toggle-tools'
  | 'menu:about'
  | 'menu:help'
  | 'menu:quick-jump'
  | 'menu:import'
  | 'menu:export'
  | 'menu:stats'

export type { ImportPlan, ExportChapter, ExportOptions, ExportPreview, ForeignPlan } from '@bugu/core'

export type AiTask = 'ask' | 'continue' | 'polish' | 'proofread'

/** `openai` 指的是任何提供 `/v1/chat/completions` 的服务，不是只有 OpenAI 官方 */
export type ProviderId = 'openai' | 'anthropic'

/** 计价货币。DeepSeek、智谱按人民币报价，别家按美元 */
export type Currency = 'USD' | 'CNY'

/**
 * 一家服务商的设置。地址、模型、单价都由作者自己填。
 *
 * 单价一律是**每百万 token、高峰时段**的价；全填 0 表示「不知道」，
 * 那界面就只报 token 数，不编金额。
 */
export interface ProviderConfig {
  baseUrl: string
  model: string
  currency: Currency
  /** 输入·缓存未命中 */
  priceIn: number
  /** 输入·缓存命中。跟未命中价能差三十倍，必须分开记 */
  priceCacheIn: number
  priceOut: number
  /** 空闲时段折扣（0–1）。DeepSeek 是 0.5 */
  offPeakDiscount: number
}

export interface AiConfig {
  enabled: boolean
  /** 用哪一家。默认 openai */
  provider: ProviderId
  providers: Record<ProviderId, ProviderConfig>
  webSearch: boolean
  /** 代理：`auto` 读环境变量，`off` 不用，其它值当地址 */
  proxy: string
  /** 本月费用上限，币种跟当前服务商走。0 表示不限 */
  monthlyCap: number
  /** 累计用量，按月清零。金额按币种分开记 */
  usage: {
    month: string
    inputTokens: number
    outputTokens: number
    amounts: Record<Currency, number>
  }
}

/** 一款模型。单价是每百万 token、高峰时段的价 */
export interface PresetModel {
  id: string
  label: string
  priceIn: number
  priceCacheIn: number
  priceOut: number
}

export interface ProviderPreset {
  key: string
  label: string
  provider: ProviderId
  baseUrl: string
  currency: Currency
  offPeakDiscount: number
  /** **便宜的排在前面，第一款就是默认值** */
  models: PresetModel[]
}

export interface AiEstimate {
  inputTokens: number
  /** 精确数出来的还是本地粗估的。界面要如实说明 */
  exact: boolean
  estimatedAmount: number
  currency: Currency
  /** 单价没填时为 true，界面就别显示金额 */
  priceUnknown: boolean
  /** 现在是不是空闲时段（分时段计价的服务商才有意义） */
  offPeak: boolean
}

export interface AiRunResult {
  text: string
  /** ⚠️ `inputTokens` **不含**缓存命中的部分，两者互不重叠 */
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    amount: number
    currency: Currency
  }
  webSearches: number
  refusal?: string
}

export interface ImportMeta {
  filePath: string
  fileName: string
  encoding: 'utf-8' | 'utf-8-bom' | 'gbk' | 'utf-16le'
  lineCount: number
}

export interface SavedDoc {
  meta: DocMeta
  body: string
}

export interface SaveOutcome {
  meta: DocMeta
  /** 保存后的字数（含标点口径） */
  chars: number
  /** 本次保存对应的版本号；内容未变时为 null */
  version: number | null
  /** created 新建版本 / merged 并入同桶 / skipped 内容没变 */
  historyAction: 'created' | 'merged' | 'skipped'
}

export interface TodayProgress {
  day: string
  words: number
  signedIn: boolean
  wordsToSignIn: number
  streak: number
  streakMakeups: number
  /** 今天的签到线。**跟着作者设的每日底线走**，没设目标才用默认的 5000 */
  signInWords: number
}

export interface ReorderOutcome {
  renamed: number
  /** 间隔用尽触发了整段重排，界面应提示作者 */
  renumbered: boolean
}

export interface BuguApi {
  // ── 库 ──
  /** 当前的作品根目录；未设置时为 null */
  getRoot(): Promise<string | null>
  /** 弹出目录选择框，选中后记住。取消返回 null */
  chooseRoot(): Promise<string | null>

  // ── 书架 ──
  listBooks(): Promise<BookSummary[]>
  /** 新建作品。类型决定套哪份骨架，**只在书架页问一次、只在书架页改** */
  createBook(title: string, kind?: BookKind): Promise<BookSummary>

  // ── 作品级 ──
  updateBookMeta(bookPath: string, patch: Partial<BookMeta>): Promise<BookMeta>
  renameBook(bookPath: string, newTitle: string): Promise<{ rootPath: string; meta: BookMeta }>
  /** 删除作品 = 整个文件夹移进库根目录的回收站，不是硬删 */
  trashBook(bookPath: string): Promise<{ trashPath: string }>
  /** 弹文件选择框选封面。取消返回 null */
  pickCover(bookPath: string): Promise<{ cover: string } | null>
  clearBookCover(bookPath: string): Promise<void>
  /** 封面读成 data URL，渲染进程碰不到文件系统 */
  /** 直接用字节写封面（不弹文件框）。界面走 pickCover，这个给冒烟用 */
  writeCoverBytes(bookPath: string, base64: string, ext: string): Promise<{ cover: string }>
  readCover(bookPath: string, coverFile: string): Promise<string | null>
  trashSettingCategory(bookPath: string, categoryPath: string): Promise<{ trashPath: string }>

  // ── 设置 ──
  getSettings(): Promise<UserSettings>
  updateSettings(patch: Partial<UserSettings>): Promise<UserSettings>
  /**
   * 挑一份主题 CSS（Typora 的主题文件可以直接选），顺手存进设置。
   * 返回选中的路径；取消了返回 null。读不出来会抛错。
   */
  /** 挑一份 CSS 放进某个槽位（不给就填第一个空位）。取消返回 null */
  pickThemeCss(
    slot?: number,
  ): Promise<{ slot: number; slots: ThemeSlot[] } | null>
  /** 换一个槽位。-1 = 不用自选样式 */
  useThemeSlot(slot: number): Promise<number>
  /** 清掉某个槽位。正在用它就顺带切回预设 */
  clearThemeSlot(
    slot: number,
  ): Promise<{ slots: ThemeSlot[]; active: number }>
  /** 给某个槽位改个名字 */
  renameThemeSlot(
    slot: number,
    name: string,
  ): Promise<ThemeSlot[]>
  /** 读出设置里那份主题 CSS 的内容。没配、或者文件没了都回空串 */
  /**
   * 读那份自选 CSS。
   *
   * **读不到时要说清是哪一种读不到** —— 静默当没配的话，作者看到的是
   * 「我明明选了主题，怎么一点变化没有」，而真实原因可能是文件被删了、
   * 或者那份 CSS 里根本没有 `#write`。
   */
  /**
   * 一次把选中的几部分导出去。
   *
   * 选了不止一部分就导成一个文件夹、每部分一个文件 ——
   * 设定集拼在正文后面发给编辑是帮倒忙。
   * 取消返回 null。
   */
  exportBundle(
    bookPath: string,
    opts: {
      /** 导哪几部分 */
      parts: { text: boolean; outline: boolean; settings: boolean }
      /** md 保留语法，txt 不保留 */
      format: 'txt' | 'md'
      options: ExportOptions
    },
    title: string,
  ): Promise<{ files: number; dir: string } | null>
  readThemeCss(): Promise<ThemeCssResult>
  /**
   * 把自己调的那套导出成 .css。取消返回 null，成功返回文件路径。
   *
   * 导出的格式跟我们认得的一模一样 —— 这份文件用「自选样式」能再导回来。
   */
  exportThemeCss(draft: ThemeDraft): Promise<string | null>
  /**
   * 把自己调的那套存进自定义栏位。
   *
   * `slot` 给 -1 就是「加一份新的」（占用末尾那个空位）。
   * 满九个了返回 null —— **不挤掉最老的那一份**，那是别人调了半天的配色。
   */
  saveThemeToSlot(
    slot: number,
    draft: ThemeDraft,
  ): Promise<{ slot: number; slots: ThemeSlot[] } | null>
  /**
   * 导一个字体文件进来。**复制进 userData，不记原路径** ——
   * 记路径的话他哪天清理下载文件夹，字体就没了。
   * 取消选择返回 null。
   */
  pickFont(): Promise<{ family: string; fonts: Record<string, string> } | null>
  /** 读某一款自选字体的字节（data URL）。只读在用的那一款 */
  fontData(family: string): Promise<string>
  /** 不要某一款了。文件也删掉；正在用它的话退回楷体 */
  removeFont(family: string): Promise<Record<string, string>>

  // ── 菜单事件 ──
  /** 订阅主进程菜单事件，返回取消订阅的函数 */
  onMenu(channel: MenuChannel, fn: () => void): () => void

  // ── 目录 ──
  loadTree(bookPath: string): Promise<BookTree>
  createChapter(dir: string, title: string): Promise<{ path: string }>
  createVolume(bookPath: string, title: string): Promise<{ path: string }>
  renameDoc(path: string, newTitle: string): Promise<{ path: string }>
  renameVolume(path: string, newTitle: string): Promise<{ path: string }>
  /** 同一目录内调整顺序 */
  reorder(dir: string, fromIndex: number, toIndex: number): Promise<ReorderOutcome>
  /** 把章节移到另一个卷 */
  moveToDir(path: string, targetDir: string): Promise<{ path: string }>

  // ── 回收站（删除永远是移进回收站，不硬删） ──
  trashDoc(bookPath: string, path: string): Promise<{ trashPath: string }>
  listTrash(bookPath: string): Promise<TrashEntry[]>
  restoreFromTrash(entry: TrashEntry): Promise<void>
  emptyTrash(bookPath: string): Promise<number>

  // ── 设定集 ──
  createSettingCategory(bookPath: string, name: string): Promise<{ path: string }>
  createSettingCard(categoryPath: string, title: string): Promise<{ path: string }>
  /** 读某个分类的模板；没有则返回默认骨架 */
  readTemplate(categoryPath: string): Promise<{ path: string; content: string }>

  // ── 便利贴 ──
  listStickies(bookPath: string): Promise<LoadedSticky[]>
  readSticky(path: string, category?: string): Promise<LoadedSticky>
  loadStickyLayout(bookPath: string): Promise<StickyLayout>
  saveStickyLayout(bookPath: string, layout: StickyLayout): Promise<void>
  /** 某个名字被哪些文档引用 */
  backlinks(target: string, bookPath?: string): Promise<Array<{ docId: string; path: string; title: string }>>
  /** 这篇里写了哪些 [[双链]]。指不到东西的也返回（path 为 null），那通常是名字写错了 */
  outgoingLinks(
    docPath: string,
    bookPath?: string,
  ): Promise<Array<{ target: string; path: string | null; title: string | null }>>

  // ── 伏笔 ──
  listForeshadows(
    bookPath: string,
    currentDocId?: string,
  ): Promise<{
    items: ForeshadowListItem[]
    due: ForeshadowListItem[]
    chapters: Array<{ id: string; path: string; title: string }>
  }>
  addForeshadow(
    bookPath: string,
    input: { title: string; desc?: string; expectBy?: string | null; priority?: ForeshadowPriority },
  ): Promise<{ id: string }>
  patchForeshadow(bookPath: string, id: string, changes: Record<string, unknown>): Promise<void>
  /** 给选中的一段打上「埋」或「收」的标记 */
  markForeshadow(
    bookPath: string,
    docPath: string,
    range: { start: number; end: number },
    id: string,
    kind: 'plant' | 'recover',
  ): Promise<{ body: string }>
  docAnchors(docPath: string): Promise<ForeshadowAnchor[]>

  // ── 版本历史 ──
  listVersions(bookPath: string, docId: string): Promise<HistoryEntry[]>
  readVersion(bookPath: string, docId: string, v: number): Promise<string>
  /** 回滚本身也产生一条新版本，所以可以再撤销 */
  rollbackTo(bookPath: string, docPath: string, v: number): Promise<{ body: string }>
  labelVersion(bookPath: string, docId: string, v: number, label: string): Promise<void>
  historyCapacity(bookPath: string): Promise<CapacityStatus & { limitMB: number }>
  pruneHistory(
    bookPath: string,
    strategy: { kind: 'keepLabeled' } | { kind: 'olderThan'; cutoffTs: number },
  ): Promise<{ docs: number; before: number; after: number }>

  // ── 导入 ──
  /** 弹文件框选 txt，直接给出分章方案（还没落盘）。取消返回 null */
  pickImportFile(): Promise<(ImportPlan & ImportMeta) | null>
  /** 作者在预览里改了分章点后重算 */
  /**
   * 从别的写作软件搬家。选文件夹并给出方案，**不落盘**。
   *
   * 只支持有把握的两种：Scrivener 与整个文件夹的 txt/md。
   * 青茉、码字精灵是私有格式，没有样本就不猜。
   */
  pickForeign(kind: 'scrivener' | 'folder'): Promise<ForeignPlan | null>
  /** 作者点了确认才真的建文件 */
  applyForeign(
    bookPath: string,
    dir: string,
    chapters: Array<{ title: string; body: string }>,
  ): Promise<{ created: number }>

  rePreviewImport(filePath: string, forceLines?: number[]): Promise<ImportPlan & ImportMeta>
  applyImport(
    bookPath: string,
    dir: string,
    chapters: Array<{ title: string; body: string }>,
    preamble: string | null,
  ): Promise<{ created: number }>

  // ── 导出 ──
  collectForExport(bookPath: string): Promise<ExportChapter[]>
  exportPreview(chapters: ExportChapter[], options: ExportOptions): Promise<ExportPreview>
  /** 弹保存框并写文件。取消返回 null */
  exportBook(
    kind: 'txt' | 'docx' | 'perChapter',
    chapters: ExportChapter[],
    options: ExportOptions,
    title: string,
  ): Promise<{ bytes?: number; files?: number } | null>

  // ── AI ──
  aiStatus(): Promise<{
    /** 各家填没填过 Key。**只有布尔值** —— Key 本身永远不出主进程 */
    keys: Record<ProviderId, boolean>
    /** 当前这一家填没填 */
    hasKey: boolean
    config: AiConfig
    presets: ProviderPreset[]
    provider: { id: ProviderId; label: string; baseUrlHint: string }
    /** 联网搜索能不能用，不能用时带上原因 */
    webSearch: { available: boolean; reason: string }
    active: ProviderConfig
    /** 实际生效的代理地址；没走代理时为 null */
    proxyInUse: string | null
  }>
  /** 试连当前端点，只验网络，不带 Key。作者卡住时唯一能自查的手段 */
  aiTestConnection(): Promise<{
    ok: boolean
    status?: number
    proxy: string | null
    message: string
  }>
  /** Key 只在主进程里存在，用系统加密存盘，渲染进程永远拿不到它 */
  aiSetKey(provider: ProviderId, key: string): Promise<void>
  aiClearKey(provider: ProviderId): Promise<void>
  aiSetConfig(patch: Partial<AiConfig>): Promise<AiConfig>
  aiEstimate(
    bookPath: string,
    docPath: string | null,
    task: AiTask,
    input: string,
  ): Promise<AiEstimate>
  aiRun(
    requestId: string,
    bookPath: string,
    docPath: string | null,
    task: AiTask,
    input: string,
  ): Promise<AiRunResult>
  /** 掐掉正在跑的那一次。只停界面没用 —— 请求还在跑，钱还在花 */
  aiCancel(requestId: string): Promise<boolean>
  /** 订阅流式片段，返回取消订阅的函数 */
  onAiDelta(fn: (e: { requestId: string; kind: 'text' | 'thinking'; text: string }) => void): () => void

  /** 剪切/复制/粘贴/全选/撤销/重做。走 Chromium 原生编辑命令，作用在当前焦点上 */
  editCmd(kind: 'cut' | 'copy' | 'paste' | 'selectAll' | 'undo' | 'redo'): Promise<void>

  // ── 码字计划 ──
  /**
   * 计划总览。字数是**全库合计**的 —— 目标是「人」的属性，
   * 「每天写 8000 字」不分在写哪本。
   */
  planReport(): Promise<{
    plan: Plan
    today: string
    todayWords: number
    todayTarget: { floor: number; ideal: number }
    judged: DayJudgement[]
    streak: { current: number; best: number; leaves: number; makeups: number }
    /** 最近 14 天的日均字数 */
    recentSpeed: number
    nickname: string
    /** 从第一次留下码字记录那天算起一共多少天。**不是「注册天数」——这软件没有账号** */
    daysSinceStart: number
    daysWritten: number
    /** 本周达标几比几。请假日不算进分母 */
    week: { hit: number; of: number }
  }>
  /** 改昵称。存在 `_计划.yaml` 里，跟着同步走 */
  setNickname(nickname: string): Promise<Plan>
  /** 改目标。**从今天起生效**，以前的日子仍按当时的目标判 */
  setPlanTarget(target: WeekTarget): Promise<Plan>
  /** 标一天请假 / 取消（传 null）。请假不算断更，但也不算达标 */
  setLeave(day: string, reason: string | null): Promise<Plan>

  listMilestones(bookPath: string): Promise<MilestoneView[]>
  /** 建里程碑时能挑的对象：卷、设定分类 */
  milestoneTargets(
    bookPath: string,
  ): Promise<Array<{ label: string; kind: 'volume' | 'category'; path: string }>>
  addMilestone(
    bookPath: string,
    input: { title: string; target: MilestoneTarget; due?: string | null },
  ): Promise<{ id: string }>
  patchMilestone(bookPath: string, id: string, changes: Record<string, unknown>): Promise<void>
  removeMilestone(bookPath: string, id: string): Promise<void>

  // ── 云账号 ──
  //
  // **登录是可选的。** 不登录整个软件照常用 —— 第一条铁律是文件即真相，
  // 稿子在硬盘上，账号不该变成写作的前置条件。
  //
  // 令牌只在主进程里（safeStorage 加密，放 userData，不进同步文件夹），
  // 这一层拿到的永远只是「登录了没有、是谁」。跟 API Key 一个待遇。
  /** 现在登录了没有、是谁 */
  loginState(): Promise<LoginState>
  /**
   * 用系统浏览器登录（OIDC 授权码 + PKCE）。
   *
   * **软件从头到尾看不见密码** —— 密码只在浏览器里输，我们只经手一个
   * 授权码。这不是「顺便安全一点」，这是走浏览器的全部理由。
   * 会一直等到作者在浏览器里操作完（最多五分钟）。
   */
  loginWithBrowser(): Promise<LoginState>
  /** 退出。**本地先清掉**，IdP 那边能清就清 —— 连不上也得能退出去 */
  loginOut(): Promise<LoginState>
  /** 换了服务地址之后把缓存忘掉 */
  loginForget(): Promise<LoginState>

  // ── 对外统计 ──
  //
  // 唯一一处「作者的东西会离开这台电脑」。所以它整条链上都是显式的：
  // 要登录、要自己认领短名、要自己打开开关，缺一样都不会有东西发出去。
  /** 我在服务器上是什么样。没登录时只回一个 signedIn:false，不发请求 */
  statsMe(): Promise<StatsState>
  /** 认领/更改对外短名。规矩不合的名字在本机就拦下来，不白跑一趟 */
  statsClaimHandle(handle: string): Promise<StatsState>
  /** 现在推一次。返回推完之后的状态 */
  statsPush(): Promise<StatsState>
  /** 开关自动上传 */
  statsSetAutoPush(on: boolean): Promise<StatsState>
  /** 把我在服务器上的数据整个删掉。这是「反悔」的出口 */
  statsForget(): Promise<StatsState>
  /** 别人现在读到的是什么。走公开接口、不带令牌，跟别的网站同一条路 */
  statsPublic(handle: string): Promise<PublicProfile>
  /**
   * 我有哪些奖状、现在挂着哪一张。**读本机缓存，不发请求** ——
   * 书架每次打开都要用它，不该每次都等一趟网络。
   */
  myAwards(): Promise<AwardChoice>
  /** 换一张挂上。传空串 = 挂最新的那张 */
  pinAward(id: string): Promise<AwardChoice>
  /**
   * 要推出去的是哪七个数 —— **本机算的，不发请求**。
   *
   * 「按之前先看一眼」这件事不该需要联网，否则作者永远只能在推完之后
   * 才知道自己推了什么。
   */
  statsPreview(): Promise<PublicStats>

  // ── 剧本 ──
  /**
   * 按场分布 + 谁连着几场没出声 + 不在人物卡里的名字。
   *
   * 给了 bookPath 才认得出角色 —— 名单在设定集里，不在这一篇里。
   */
  scriptReport(
    docPath: string,
    bookPath?: string,
  ): Promise<{
    scenes: SceneCast[]
    absence: Array<{ who: string; gap: number; after: number }>
    unknown: Array<{ who: string; lines: number; firstLine: number }>
  }>
  /** 这本书的角色名单，以及设定集里有哪些分类可选 */
  bookCast(bookPath: string): Promise<{
    available: string[]
    categories: string[]
    /** 作者自己选过没有。没选过时那几个分类是猜的 */
    chosen: boolean
    names: string[]
    canonical: Record<string, string>
  }>
  /** 改「哪几个分类算人物」。存进 book.yaml，跟着书走 */
  setCastCategories(bookPath: string, categories: string[]): Promise<BookMeta>
  /** 把某一场整体挪个位置。**直接改正文**，走完整保存管线所以能回滚 */
  moveSceneIn(docPath: string, from: number, to: number): Promise<{ body: string }>
  /**
   * 新建一篇剧本。
   *
   * **整份骨架只给这个目录里的第一篇**，第二篇起只给一行场景标题 ——
   * 每新建一场都塞一遍「李四/王五」，作者得先删十几行才能开始写。
   */
  createScript(dir: string, title: string): Promise<{ path: string }>
  /** 新建一篇游戏剧本。同上：整份骨架只给第一篇，后面只给一行 `# 标题` */
  createGameScript(dir: string, title: string): Promise<{ path: string }>

  // ── 游戏剧本 ──
  /** 从任意节点开始试玩，可以假设一份起手的变量状态 */
  playFrom(
    bookPath: string,
    from: string,
    initialState: Record<string, string | number | boolean>,
  ): Promise<{
    reachable: string[]
    unreachable: string[]
    endings: Array<{ name: string; path: Array<{ node: string; via: string }>; state: Record<string, string | number | boolean> }>
    truncated: boolean
  }>
  /** 导成引擎骨架。**是骨架不是能跑的游戏** —— 界面上要写明 */
  exportGameScript(bookPath: string, engine: 'renpy' | 'ink'): Promise<EngineExport>
  /** 整本书建一张分支图。跳转跨文件，所以要把所有正文读一遍 */
  /**
   * 整本书的分支图。
   *
   * `live` 是编辑器里还没存盘的那一篇 —— 给了它，改一个字图就跟着动，
   * 不用等三秒后的自动保存。
   */
  gameGraph(bookPath: string, live?: { path: string; body: string }): Promise<{
    nodes: GameNode[]
    problems: GameProblem[]
    start: string | null
    reachable: string[]
    unreachable: string[]
    endings: Array<{ name: string; path: Array<{ node: string; via: string }>; state: Record<string, string | number | boolean> }>
    /** 状态空间太大被截断了。界面要如实说，别让作者拿这个数字下结论 */
    truncated: boolean
    variables: Array<{ name: string; values: string[] }>
    progress: GameProgress
  }>

  // ── 坚果云冲突副本 ──
  listConflicts(bookPath: string): Promise<
    Array<ConflictPair & { summary: DiffSummary; note: string; originalMissing: boolean; error?: string }>
  >
  /** 三种处理方式都不硬删任何东西，被换下来的那份进回收站 */
  resolveConflict(
    bookPath: string,
    conflictPath: string,
    action: 'keepOriginal' | 'keepConflict' | 'keepBoth',
  ): Promise<{ resolvedPath: string | null }>

  // ── 灵感箱 ──
  /** 在电脑上随手记一条（手机端记的会同步过来，这里补个入口） */
  createIdea(bookPath: string, body: string): Promise<{ path: string }>
  /**
   * 在书架上记一条灵感 —— 落进全库共用的 `_灵感箱`。
   *
   * 跟「某本书的灵感」是两回事：想到点子时往往还不知道它属于哪本书，
   * 逼着人先选一本，那个点子多半就飞了。
   */
  createLibraryIdea(body: string): Promise<{ path: string }>
  listLibraryIdeas(): Promise<Array<{ path: string; title: string; body: string; created: string }>>
  listIdeas(bookPath: string): Promise<
    Array<{ path: string; title: string; body: string; created: string; scope: 'book' | 'inbox' }>
  >
  /** 归入某篇文档：追加到末尾，碎片移进回收站（不硬删，归错了还能捞回来） */
  mergeIdea(bookPath: string, ideaPath: string, targetPath: string): Promise<{ body: string }>
  trashIdea(bookPath: string, ideaPath: string): Promise<void>

  // ── 文档 ──
  readDoc(path: string): Promise<SavedDoc>
  saveDoc(path: string, body: string): Promise<SaveOutcome>
  /**
   * 把一份正文另存成同目录下的一篇副本。
   *
   * 「这一篇在别处改过」时用：作者选「用别处那版」之前先把手上没保存的字
   * 原样存一篇，**一个字都不丢**。
   */
  saveAside(path: string, body: string, suffix: string): Promise<{ path: string }>

  // ── 检索 ──
  /** 打开作品时调用，增量同步索引。已同步过则立即返回 */
  ensureIndexed(bookPath: string): Promise<{ indexed: number; removed: number }>
  /** 强制重建这本书的索引 */
  rebuildIndex(bookPath: string): Promise<{ indexed: number; removed: number }>
  search(query: string, opts?: { book?: string; scopes?: DocType[]; limit?: number }): Promise<SearchResult>
  indexStats(bookPath?: string): Promise<IndexStats>

  // ── 统计 ──
  todayProgress(bookPath: string): Promise<TodayProgress>
  statsReport(
    bookPath: string,
    opts?: { days?: number },
  ): Promise<{
    today: TodayStat
    streak: StreakInfo
    daily: DayStat[]
    weekly: Array<{ weekStart: string; words: number }>
    monthly: Array<{ month: string; words: number }>
    heat: HeatCell[]
    sessions: WritingSession[]
    dailyTarget: number
  }>
  /** 番茄钟跑着时保存的记录会带 pomo 标记，用于统计「番茄钟内的产出」 */
  setPomodoro(active: boolean): Promise<void>

  // ── 杂项 ──
  revealInExplorer(path: string): Promise<void>
  appVersion(): Promise<string>
}

/** 渲染进程里通过 window.bugu 访问 */
declare global {
  interface Window {
    bugu: BuguApi
  }
}
