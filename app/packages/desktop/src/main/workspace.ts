/**
 * 主进程的工作区 —— 把 core 的纯逻辑接到真实磁盘上。
 *
 * 保存一次稿子实际要做四件事，全在 `saveDoc` 里：
 *   1. 写正文文件（原子写）
 *   2. 追加一条版本历史
 *   3. 追加一条码字统计
 *   4. 返回新的字数给界面
 *
 * 三份数据各写各的文件，任何一份写失败都不该影响正文 ——
 * 正文永远第一优先，历史和统计是附属品。
 */

import {
  appendSave,
  serializeDoc,
  countWords,
  createStatRecord,
  emptyHistory,
  loadHistory,
  parseHistoryJsonl,
  parseStatsJsonl,
  readDoc,
  writeDoc,
  writeNewDoc,
  scanLibrary,
  createBook as coreCreateBook,
  loadTree as coreLoadTree,
  metaPaths,
  DIRS,
  createSettingCard as coreCreateSettingCard,
  createSettingCategory as coreCreateSettingCategory,
  createVolume as coreCreateVolume,
  defaultTemplate,
  emptyTrash as coreEmptyTrash,
  ensureTemplate,
  listTrash as coreListTrash,
  loadTree as coreLoadTreeForCategory,
  moveChapterToDir,
  renameDoc as coreRenameDoc,
  renameVolume as coreRenameVolume,
  reorderInDir,
  restoreFromTrash as coreRestoreFromTrash,
  trashDoc as coreTrashDoc,
  updateBookMeta as coreUpdateBookMeta,
  renameBook as coreRenameBook,
  trashBook as coreTrashBook,
  setBookCover as coreSetBookCover,
  clearBookCover as coreClearBookCover,
  trashSettingCategory as coreTrashSettingCategory,
  readAllStickies as coreReadAllStickies,
  parseJsonl as parseForeshadowJsonl,
  toJsonlLine,
  mergeRecords,
  buildList as buildForeshadowList,
  dueForeshadows,
  generateForeshadowId,
  createRecord as createForeshadowRecord,
  createPatchRecord,
  parseAnchors,
  hitRate,
  judgeDays,
  streakOf,
  targetFor,
  SIGN_IN_WORDS,
  recordTargetChange,
  viewMilestone,
  sortMilestones,
  daysBetween,
  weekdayIndex,
  type DayJudgement,
  type Milestone,
  type MilestoneView,
  type Plan,
  type TargetProgress,
  type WeekTarget,
  buildGraph,
  parseGameNodes,
  simulate,
  buildCast,
  emptyCast,
  guessCastCategories,
  unknownSpeakers,
  type BookKind,
  type BookMeta,
  type CastCard,
  exportGame,
  moveScene,
  scriptTemplate,
  scriptSceneStub,
  gameScriptTemplate,
  gameNodeStub,
  sceneCast,
  longestAbsence,
  parseScript,
  type Engine,
  type GameState,
  gameProgress,
  type GameNode,
  type GameProgress,
  type PathStep,
  type Problem,
  type SourceDoc,
  type VarValue,
  compareTexts,
  describeConflict,
  pairConflicts,
  originalFileName,
  type ConflictPair,
  type DiffSummary,
  listVersions as coreListVersions,
  reconstruct,
  normalizeHistory,
  historySizeBytes,
  capacityStatus,
  pruneKeepLabeled,
  pruneOlderThan,
  toHistoryJsonl,
  DEFAULT_HISTORY_LIMIT_MB,
  parseBookMeta,
  type HistoryEntry,
  type HistoryRecord,
  type CapacityStatus,
  wrapAnchor,
  flattenChapters,
  type Foreshadow,
  type ForeshadowListItem,
  type ForeshadowRecord,
  readSticky as coreReadSticky,
  loadStickyLayout as coreLoadStickyLayout,
  saveStickyLayout as coreSaveStickyLayout,
  type StickyLayout,
  byDay,
  computeStreak,
  currentWritingDay,
  mergeStats,
  fillDays,
  addDays,
  heatmap as buildHeatmap,
  byWeek,
  byMonth,
  buildSessions,
  todayStat,
  type DayStat,
  type HeatCell,
  type StreakInfo,
  type TodayStat,
  type WritingSession,
  type BookSummary,
  type BookTree,
  type TrashEntry,
  type HistoryState,
  type ParsedDoc,
} from '@bugu/core'
import { readFile } from 'node:fs/promises'

/** 换行。写成常量是因为多层转义里直接写字面量太容易出错 */
const NL = '\n'
import { LocalFsBackend } from '../storage/local-fs.js'
import { IndexDb, indexablePaths, type SearchResult, type SearchScope } from './index-db.js'
import type { ReorderOutcome, SaveOutcome, SavedDoc, TodayProgress } from '../shared/api.js'
import {
  appendMilestone,
  loadMilestones,
  loadPlan,
  newMilestoneId,
  savePlan,
} from './plan-store.js'


export class Workspace {
  private readonly backend: LocalFsBackend
  private readonly index: IndexDb
  /** 已经同步过索引的作品，避免每次切章都全量扫一遍 */
  private readonly syncedBooks = new Set<string>()
  /** 每篇文档的历史状态缓存，避免每次保存都重放整条历史链 */
  private readonly histories = new Map<string, { docId: string; state: HistoryState }>()
  private sessionId: string
  private lastSaveTs = 0

  constructor(
    readonly root: string,
    readonly deviceId: string,
    indexFile: string,
    /** 人看得懂的设备名。「这一篇在别处改过」的对话框要拿它说话 */
    readonly deviceName: string = deviceId,
  ) {
    this.backend = new LocalFsBackend(root)
    this.index = new IndexDb(indexFile)
    this.sessionId = `s-${Date.now().toString(36)}`
  }

  close(): void {
    try {
      this.index.close()
    } catch {
      /* 关索引失败不影响退出 */
    }
  }

  // ── 索引 ──

  /**
   * 增量同步某本书的索引。
   *
   * 只读取「磁盘上比索引里新」的文件，并清掉已经不存在的条目。
   * 所以第二次打开同一本书几乎是瞬时的；而作者用记事本在外面改过的文件
   * 也能被发现（靠 mtime）。
   */
  async syncIndex(
    bookPath: string,
    opts: { force?: boolean } = {},
  ): Promise<{ indexed: number; removed: number }> {
    if (opts.force) {
      this.index.clearBook(bookPath)
      this.syncedBooks.delete(bookPath)
    }

    const tree = await coreLoadTree(this.backend, bookPath)
    const wanted = indexablePaths(tree)
    const known = this.index.docPaths(bookPath)

    let indexed = 0
    const seen = new Set<string>()

    for (const item of wanted) {
      seen.add(item.path)
      const stat = await this.backend.stat(item.path)
      if (!stat) continue
      const prev = known.get(item.path)
      if (prev !== undefined && prev >= stat.mtime) continue // 没变过，跳过

      try {
        this.index.upsertDoc({
          book: bookPath,
          path: item.path,
          raw: await this.backend.read(item.path),
          mtime: stat.mtime,
          fileName: item.fileName,
          category: item.category,
        })
        indexed++
      } catch (e) {
        // 单篇文档索引失败不该让整次同步失败
        console.error('[bugu] 索引失败，跳过：', item.path, e)
      }
    }

    let removed = 0
    for (const p of known.keys()) {
      if (!seen.has(p)) {
        this.index.removeByPath(p)
        removed++
      }
    }

    this.index.setMeta('builtAt', String(Date.now()))
    this.syncedBooks.add(bookPath)
    return { indexed, removed }
  }

  /** 打开作品时调用一次；已经同步过就直接返回 */
  async ensureIndexed(bookPath: string): Promise<void> {
    if (this.syncedBooks.has(bookPath)) return
    await this.syncIndex(bookPath)
  }

  search(
    query: string,
    opts: { book?: string; scopes?: SearchScope[]; limit?: number } = {},
  ): SearchResult {
    return this.index.search(query, opts)
  }

  quickJump(fragment: string, book?: string) {
    return this.index.findByTitle(fragment, book === undefined ? {} : { book })
  }

  outgoingLinks(docPath: string, book?: string) {
    return this.index.outgoingLinks(docPath, book)
  }

  backlinks(target: string, book?: string) {
    return this.index.backlinks(target, book)
  }

  indexStats(book?: string) {
    return this.index.stats(book)
  }

  // ── 书架 ──

  listBooks(): Promise<BookSummary[]> {
    return scanLibrary(this.backend, '')
  }

  createBook(title: string, kind: BookKind = 'novel'): Promise<BookSummary> {
    return coreCreateBook(this.backend, '', title, { kind })
  }

  loadTree(bookPath: string): Promise<BookTree> {
    return coreLoadTree(this.backend, bookPath)
  }

  async createChapter(dir: string, title: string): Promise<{ path: string }> {
    const { path } = await writeNewDoc(this.backend, dir, title, 'chapter', '')
    return { path }
  }

  // ── 作品级操作 ──

  updateBookMeta(bookPath: string, patch: Record<string, unknown>) {
    return coreUpdateBookMeta(this.backend, bookPath, patch)
  }

  async renameBook(bookPath: string, newTitle: string) {
    const r = await coreRenameBook(this.backend, '', bookPath, newTitle)
    // 整本书换了路径，索引里那本书的记录全部作废
    this.index.clearBook(bookPath)
    this.syncedBooks.delete(bookPath)
    this.histories.clear()
    return r
  }

  async trashBook(bookPath: string) {
    const r = await coreTrashBook(this.backend, '', bookPath)
    this.index.clearBook(bookPath)
    this.syncedBooks.delete(bookPath)
    this.histories.clear()
    return r
  }

  async setBookCover(bookPath: string, sourceFile: string) {
    const data = await readFile(sourceFile)
    const ext = sourceFile.slice(sourceFile.lastIndexOf('.') + 1)
    return coreSetBookCover(this.backend, bookPath, new Uint8Array(data), ext)
  }

  /**
   * 直接用字节写封面（不弹文件框）。
   *
   * 界面走的是 `pickCover`（弹框选文件）；这个入口是给端到端冒烟用的 ——
   * 弹框在自动化里点不了，而「封面写进去又读得回来」恰恰是最该守住的一条。
   */
  async writeBookCoverBytes(bookPath: string, base64: string, ext: string) {
    return coreSetBookCover(this.backend, bookPath, new Uint8Array(Buffer.from(base64, 'base64')), ext)
  }

  clearBookCover(bookPath: string) {
    return coreClearBookCover(this.backend, bookPath)
  }

  /** 封面读成 data URL 交给界面显示 —— 渲染进程碰不到文件系统 */
  async readCoverDataUrl(bookPath: string, coverFile: string): Promise<string | null> {
    try {
      const bytes = await this.backend.readBinary(`${bookPath}/${coverFile}`)
      const ext = coverFile.slice(coverFile.lastIndexOf('.') + 1).toLowerCase()
      const mime =
        ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
      return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
    } catch {
      return null
    }
  }

  async trashSettingCategory(bookPath: string, categoryPath: string) {
    const r = await coreTrashSettingCategory(this.backend, bookPath, categoryPath)
    this.syncedBooks.delete(bookPath)
    await this.syncIndex(bookPath, { force: true }).catch(() => ({ indexed: 0, removed: 0 }))
    return r
  }

  // ── 便利贴 ──

  async listStickies(bookPath: string) {
    return coreReadAllStickies(this.backend, await coreLoadTree(this.backend, bookPath))
  }

  readSticky(path: string, category: string | null = null) {
    return coreReadSticky(this.backend, path, category)
  }

  loadStickyLayout(bookPath: string): Promise<StickyLayout> {
    return coreLoadStickyLayout(this.backend, bookPath, this.deviceId)
  }

  saveStickyLayout(bookPath: string, layout: StickyLayout): Promise<void> {
    return coreSaveStickyLayout(this.backend, bookPath, this.deviceId, layout)
  }

  // ── 伏笔 ──

  /** 合并所有设备的分片，得到最终的伏笔清单 */
  private async readForeshadowRecords(bookPath: string): Promise<ForeshadowRecord[]> {
    const dir = `${bookPath}/${metaPaths.foreshadowDir()}`
    try {
      const files = await this.backend.list(dir)
      const shards = await Promise.all(
        files
          .filter((f) => !f.isDirectory && f.name.endsWith('.jsonl'))
          .map(async (f) => parseForeshadowJsonl(await this.backend.read(f.path))),
      )
      return shards.flat()
    } catch {
      return []
    }
  }

  /** 伏笔清单 + 章节顺序 + 当前该提醒的那些 */
  async listForeshadows(
    bookPath: string,
    currentDocId?: string,
  ): Promise<{
    items: ForeshadowListItem[]
    due: ForeshadowListItem[]
    chapters: Array<{ id: string; path: string; title: string }>
  }> {
    const merged = mergeRecords(await this.readForeshadowRecords(bookPath))
    const tree = await coreLoadTree(this.backend, bookPath)

    // ⚠️ 章节 id 是从索引里拿的，所以得先保证索引是新的。
    // 不同步的话，**刚建还没保存过的章节根本不在索引里** ——
    // 它会从伏笔的章节轴上凭空消失，挂在它上面的伏笔也就失去了位置。
    // 增量同步按 mtime 比对，第二次之后基本不花时间。
    await this.syncIndex(bookPath).catch(() => {
      // 索引挂了不该让伏笔清单整个打不开，下面拿到多少算多少
    })
    const byPath = this.index.idsByPath(bookPath)

    const chapters: Array<{ id: string; path: string; title: string }> = []
    for (const c of flattenChapters(tree.text)) {
      const id = byPath.get(c.path)
      if (id) chapters.push({ id, path: c.path, title: c.title })
    }
    const order = chapters.map((c) => c.id)

    const items = buildForeshadowList(merged, order, currentDocId)
    const due = currentDocId ? dueForeshadows(items, order, currentDocId) : []
    return { items, due, chapters }
  }

  /**
   * 章节的 id 顺序。
   *
   * 目录树只有路径没有 id（那是刻意的，见 repository 的性能约定），
   * 所以这里从索引库里拿 id —— 比逐个读文件快得多。
   */
  private async chapterIdOrder(tree: BookTree): Promise<string[]> {
    const byPath = this.index.idsByPath(tree.rootPath)
    const out: string[] = []
    for (const c of flattenChapters(tree.text)) {
      const id = byPath.get(c.path)
      if (id) out.push(id)
    }
    return out
  }

  async addForeshadow(
    bookPath: string,
    input: { title: string; desc?: string; expectBy?: string | null; priority?: 'high' | 'normal' | 'low' },
  ): Promise<{ id: string }> {
    const id = generateForeshadowId()
    const rec = createForeshadowRecord({
      id,
      dev: this.deviceId,
      ts: Date.now(),
      title: input.title,
      desc: input.desc ?? '',
      expectBy: input.expectBy ?? null,
      priority: input.priority ?? 'normal',
    })
    await this.backend.append(`${bookPath}/${metaPaths.foreshadow(this.deviceId)}`, toJsonlLine(rec))
    return { id }
  }

  async patchForeshadow(
    bookPath: string,
    id: string,
    changes: Partial<Omit<ForeshadowRecord, 'schemaVersion' | 'id' | 'ts' | 'dev'>>,
  ): Promise<void> {
    const rec = createPatchRecord(id, this.deviceId, Date.now(), changes)
    await this.backend.append(`${bookPath}/${metaPaths.foreshadow(this.deviceId)}`, toJsonlLine(rec))
  }

  /**
   * 在正文里给选中的一段打上伏笔标记，并更新元数据。
   *
   * 正文与元数据分两处写：正文里是成对注释（改文本也跟着走），
   * 元数据在 jsonl 里（描述、优先级、状态）。
   */
  async markForeshadow(
    bookPath: string,
    docPath: string,
    range: { start: number; end: number },
    id: string,
    kind: 'plant' | 'recover',
  ): Promise<{ body: string }> {
    const doc = await readDoc(this.backend, docPath)
    const next = wrapAnchor(doc.body, range, kind, id)
    await this.saveDoc(docPath, next)

    if (kind === 'plant') {
      await this.patchForeshadow(bookPath, id, { plantedIn: doc.meta.id, status: 'planted' })
    } else {
      const merged = mergeRecords(await this.readForeshadowRecords(bookPath))
      const cur = merged.find((f: Foreshadow) => f.id === id)
      const recovered = [...new Set([...(cur?.recoveredIn ?? []), doc.meta.id])]
      await this.patchForeshadow(bookPath, id, { status: 'recovered', recoveredIn: recovered })
    }
    return { body: next }
  }

  /** 当前文档里的伏笔锚点，供界面高亮与跳转 */
  async docAnchors(docPath: string) {
    const doc = await readDoc(this.backend, docPath)
    return parseAnchors(doc.body)
  }

  // ── 版本历史 ──

  /** 某篇文档的历史记录，合并所有设备的分片 */
  private async readHistoryRecords(bookPath: string, docId: string): Promise<HistoryRecord[]> {
    const dir = `${bookPath}/${metaPaths.historyDir(docId)}`
    try {
      const files = await this.backend.list(dir)
      const shards = await Promise.all(
        files
          .filter((f) => !f.isDirectory && f.name.endsWith('.jsonl'))
          .map(async (f) => parseHistoryJsonl(await this.backend.read(f.path))),
      )
      return normalizeHistory(shards.flat())
    } catch {
      return []
    }
  }

  async listVersions(bookPath: string, docId: string): Promise<HistoryEntry[]> {
    return coreListVersions(await this.readHistoryRecords(bookPath, docId))
  }

  /** 还原出某一版的完整内容（对比、预览用） */
  async readVersion(bookPath: string, docId: string, v: number): Promise<string> {
    return reconstruct(await this.readHistoryRecords(bookPath, docId), v)
  }

  /**
   * 回滚到某一版。
   *
   * **回滚本身也产生一条新版本记录**，所以回滚可以再撤销 ——
   * 不这样的话作者点错一次就再也回不去了。
   */
  async rollbackTo(bookPath: string, docPath: string, v: number): Promise<{ body: string }> {
    const doc = await readDoc(this.backend, docPath)
    const content = reconstruct(await this.readHistoryRecords(bookPath, doc.meta.id), v)
    await this.saveDoc(docPath, content)
    return { body: content }
  }

  /**
   * 给某一版打命名标记。
   *
   * 历史文件是仅追加的，所以「改」一条记录的方式是再追加一条同版本号的，
   * 读取时同 v 取最后一条（见 core 的 normalizeHistory）。
   */
  async labelVersion(bookPath: string, docId: string, v: number, label: string): Promise<void> {
    const records = await this.readHistoryRecords(bookPath, docId)
    const target = records.find((r) => r.v === v)
    if (!target) throw new Error(`没有第 ${v} 版`)
    await this.backend.append(
      `${bookPath}/${metaPaths.history(docId, this.deviceId)}`,
      JSON.stringify({ ...target, label }),
    )
  }

  /** 整本书的历史占用与上限 */
  async historyCapacity(bookPath: string): Promise<CapacityStatus & { limitMB: number }> {
    let used = 0
    const walk = async (dir: string): Promise<void> => {
      for (const e of await this.backend.list(dir).catch(() => [])) {
        if (e.isDirectory) await walk(e.path)
        else used += e.size
      }
    }
    await walk(`${bookPath}/${metaPaths.historyDir()}`)

    let limitMB = DEFAULT_HISTORY_LIMIT_MB
    try {
      limitMB =
        parseBookMeta(await this.backend.read(`${bookPath}/book.yaml`)).historyLimitMB ??
        DEFAULT_HISTORY_LIMIT_MB
    } catch {
      /* 读不到就用默认上限 */
    }
    return { ...capacityStatus(used, limitMB), limitMB }
  }

  /**
   * 清理历史。
   *
   * `keepLabeled` 只保留打过名字的版本；`olderThan` 删掉某天之前的。
   * 两种都**保留带标记的和最新一版**，并且清理后会把最早保留的那版
   * 转成快照，保证历史链不断（core 的 prune 已经处理）。
   */
  async pruneHistory(
    bookPath: string,
    strategy: { kind: 'keepLabeled' } | { kind: 'olderThan'; cutoffTs: number },
  ): Promise<{ docs: number; before: number; after: number }> {
    const dir = `${bookPath}/${metaPaths.historyDir()}`
    let before = 0
    let after = 0
    let docs = 0

    for (const docDir of await this.backend.list(dir).catch(() => [])) {
      if (!docDir.isDirectory) continue
      const records = await this.readHistoryRecords(bookPath, docDir.name)
      if (records.length === 0) continue

      before += historySizeBytes(records)
      const kept =
        strategy.kind === 'keepLabeled'
          ? pruneKeepLabeled(records)
          : pruneOlderThan(records, strategy.cutoffTs)
      after += historySizeBytes(kept)
      docs++

      // 清理后重写成单一分片：多设备的历史已经合并过，再分片没有意义
      for (const f of await this.backend.list(docDir.path).catch(() => [])) {
        if (!f.isDirectory) await this.backend.delete(f.path)
      }
      await this.backend.write(
        `${bookPath}/${metaPaths.history(docDir.name, this.deviceId)}`,
        toHistoryJsonl(kept),
      )
      this.histories.clear()
    }

    return { docs, before, after }
  }

  // ── 灵感箱 ──

  /**
   * 列出灵感碎片。
   *
   * 两个来源：本作品的 `灵感/`，以及库根目录的 `_灵感箱/`
   *（手机端记灵感时没选作品就落在那儿）。
   */
  async listIdeas(bookPath: string): Promise<
    Array<{ path: string; title: string; body: string; created: string; scope: 'book' | 'inbox' }>
  > {
    const out: Array<{ path: string; title: string; body: string; created: string; scope: 'book' | 'inbox' }> = []

    const scan = async (dir: string, scope: 'book' | 'inbox') => {
      for (const e of await this.backend.list(dir).catch(() => [])) {
        if (e.isDirectory || !/[.]md$/i.test(e.name)) continue
        try {
          const doc = await readDoc(this.backend, e.path, { defaultType: 'idea' })
          out.push({
            path: e.path,
            title: doc.meta.title,
            body: doc.body.trim(),
            created: doc.meta.created,
            scope,
          })
        } catch {
          // 单条读坏了跳过，不影响其他碎片
        }
      }
    }

    await scan(`${bookPath}/${DIRS.ideas}`, 'book')
    await scan(DIRS.ideaBox, 'inbox')

    return out.sort((a, b) => b.created.localeCompare(a.created))
  }

  /**
   * 在电脑上也记一条灵感。
   *
   * 灵感没有标题这回事 —— 拿第一行凑一个，只是为了文件名好认。
   */
  async createIdea(bookPath: string, body: string): Promise<{ path: string }> {
    const firstLine = body.split(NL).map((l) => l.trim()).find((l) => l.length > 0) ?? ''
    const title = firstLine ? firstLine.slice(0, 20) : new Date().toISOString().slice(0, 16).replace('T', ' ')
    const { path } = await writeNewDoc(this.backend, `${bookPath}/${DIRS.ideas}`, title, 'idea', body)
    return { path }
  }

  /**
   * 在书架上记一条灵感 —— 落进全库共用的 `_灵感箱`。
   *
   * 跟「某本书的灵感」是**两回事**：想到一个点子的时候，往往还不知道
   * 它属于哪本书，甚至不知道要不要为它开一本书。逼着人先选一本，
   * 那个点子多半就飞了。
   */
  async createLibraryIdea(body: string): Promise<{ path: string }> {
    const firstLine = body.split(NL).map((l) => l.trim()).find((l) => l.length > 0) ?? ''
    const title = firstLine
      ? firstLine.slice(0, 20)
      : new Date().toISOString().slice(0, 16).replace('T', ' ')
    const { path } = await writeNewDoc(this.backend, DIRS.ideaBox, title, 'idea', body)
    return { path }
  }

  /** 书架灵感箱里现在有多少条、都是什么 */
  async listLibraryIdeas(): Promise<Array<{ path: string; title: string; body: string; created: string }>> {
    const out: Array<{ path: string; title: string; body: string; created: string }> = []
    let entries: Array<{ name: string; path: string; isDirectory: boolean }> = []
    try {
      entries = await this.backend.list(DIRS.ideaBox)
    } catch {
      // 还没建过这个文件夹，那就是一条都没有
      return out
    }
    for (const e of entries) {
      if (e.isDirectory || !e.name.endsWith('.md') || e.name.startsWith('_')) continue
      try {
        const doc = await readDoc(this.backend, e.path, { defaultType: 'idea' })
        out.push({
          path: e.path,
          title: doc.meta.title,
          body: doc.body.trim(),
          created: doc.meta.created,
        })
      } catch {
        // 单条读坏了跳过，不影响其他碎片
      }
    }
    return out.sort((a, b) => b.created.localeCompare(a.created))
  }

  /**
   * 把一条灵感归入某篇文档：追加到末尾，然后把碎片移进回收站。
   *
   * 不直接删 —— 万一归错地方了还能捞回来。
   */
  async mergeIdea(
    bookPath: string,
    ideaPath: string,
    targetPath: string,
  ): Promise<{ body: string }> {
    const idea = await readDoc(this.backend, ideaPath, { defaultType: 'idea' })
    const target = await readDoc(this.backend, targetPath)

    // 目标是空文档时不能无脑加两个换行 —— 那会在正文顶上留一个空行，
    // 作者打开一看还以为自己按错了键
    const head = target.body.replace(/[\s]+$/, '')
    const merged = (head ? head + NL + NL : '') + idea.body.trim() + NL
    await this.saveDoc(targetPath, merged)
    await coreTrashDoc(this.backend, bookPath, ideaPath)
    return { body: merged }
  }

  async trashIdea(bookPath: string, ideaPath: string): Promise<void> {
    await coreTrashDoc(this.backend, bookPath, ideaPath)
  }

  // ── 码字计划 ──

  /**
   * 读全库合计的每日字数。
   *
   * **目标是「人」的属性，不是「书」的属性** —— 作者说「每天写 8000 字」，
   * 指的是这一天总共写了多少，不分在写哪本。所以要把所有作品的统计合起来。
   * 统计 jsonl 一天就几条，全扫一遍不慢。
   */
  private async readAllBooksStats(): Promise<ReturnType<typeof parseStatsJsonl>> {
    const books = await scanLibrary(this.backend)
    const all: ReturnType<typeof parseStatsJsonl> = []
    for (const b of books) {
      try {
        all.push(...(await this.readStats(b.rootPath)))
      } catch {
        // 某一本读不出来不该让整张计划表打不开
      }
    }
    return all
  }

  async loadPlan(): Promise<Plan> {
    return loadPlan(this.backend)
  }

  /**
   * 改目标。
   *
   * **从今天起生效**，以前的日子照旧按当时的目标判 ——
   * 不然调一次目标，整张热力图和连续天数当场全变。
   */
  async setPlanTarget(target: WeekTarget): Promise<Plan> {
    const plan = await loadPlan(this.backend)
    const next: Plan = {
      ...plan,
      targets: recordTargetChange(plan.targets, currentWritingDay(Date.now()), target),
    }
    await savePlan(this.backend, next)
    return next
  }

  /** 标一天请假 / 取消请假。留痕迹：热力图上是中性色，不是空白 */
  async setLeave(day: string, reason: string | null): Promise<Plan> {
    const plan = await loadPlan(this.backend)
    const leaves = plan.leaves.filter((l) => l.day !== day)
    if (reason !== null) leaves.push({ day, reason })
    const next: Plan = { ...plan, leaves: leaves.sort((a, b) => a.day.localeCompare(b.day)) }
    await savePlan(this.backend, next)
    return next
  }

  /**
   * 计划总览：逐日判定 + 连续天数 + 今天还差多少。
   *
   * 判定用的是**全库合计**的字数，见 readAllBooksStats。
   */
  async planReport(opts: { days?: number } = {}): Promise<{
    plan: Plan
    today: string
    todayWords: number
    todayTarget: { floor: number; ideal: number }
    judged: DayJudgement[]
    streak: ReturnType<typeof streakOf>
    /** 最近 14 天的日均字数，里程碑拿它估「还要几天」 */
    recentSpeed: number
    nickname: string
    /**
     * 从第一次留下码字记录那天算起，一共多少天。
     *
     * 不叫「注册天数」—— 这软件没有账号。按第一条记录算比按第一次启动算实在：
     * 装上却一个字没写的那几天，不该算进「一起写了多久」。
     */
    daysSinceStart: number
    /** 这些天里真正写了字的有几天 */
    daysWritten: number
    /** 本周达标几比几。请假日不算进分母 */
    week: { hit: number; of: number }
  }> {
    const plan = await loadPlan(this.backend)
    const today = currentWritingDay(Date.now())
    const span = opts.days ?? 371

    const daily = fillDays(byDay(await this.readAllBooksStats()), addDays(today, -(span - 1)), today)
    const judged = judgeDays(daily, plan)

    // 最近 14 天的日均。用「写过字的天数」做分母会把速度算得虚高 ——
    // 那正是作者用来判断「来不来得及」的数字，不能骗他
    const recent = daily.slice(-14)
    const recentSpeed =
      recent.length === 0 ? 0 : Math.round(recent.reduce((a, d) => a + d.words, 0) / recent.length)

    // 「一起写了多久」从第一条有字数的记录算起
    const firstWritten = daily.find((d) => d.words > 0)
    const daysSinceStart = firstWritten ? daysBetween(firstWritten.day, today) + 1 : 0
    const daysWritten = daily.filter((d) => d.words > 0).length

    // 本周：从周一算起
    const dow = weekdayIndex(today)
    const weekJudged = judged.slice(Math.max(0, judged.length - 1 - dow))

    return {
      plan,
      today,
      todayWords: daily[daily.length - 1]?.words ?? 0,
      todayTarget: targetFor(today, plan.targets),
      judged,
      streak: streakOf(judged, today),
      recentSpeed,
      nickname: plan.profile.nickname,
      daysSinceStart,
      daysWritten,
      week: hitRate(weekJudged),
    }
  }

  /** 改昵称。跟目标一样存在 `_计划.yaml` 里，换电脑也还在 */
  async setNickname(nickname: string): Promise<Plan> {
    const plan = await loadPlan(this.backend)
    const next: Plan = { ...plan, profile: { ...plan.profile, nickname: nickname.slice(0, 20) } }
    await savePlan(this.backend, next)
    return next
  }

  // ── 里程碑 ──

  async listMilestones(bookPath: string): Promise<MilestoneView[]> {
    const list = await loadMilestones(this.backend, bookPath)
    if (list.length === 0) return []

    const tree = await coreLoadTree(this.backend, bookPath)
    const chars = this.index.charsByPath(bookPath)
    const today = currentWritingDay(Date.now())
    const { recentSpeed, plan } = await this.planReport({ days: 30 })

    /** 某个目录下的文档：写了内容的算完成 */
    const underDir = (dir: string): TargetProgress => {
      let done = 0
      let total = 0
      for (const [path, n] of chars) {
        if (!path.startsWith(`${dir}/`)) continue
        total += 1
        if (n > 0) done += 1
      }
      return { done, total: total === 0 ? null : total, unit: '篇' }
    }

    const totalChars = [...chars.values()].reduce((a, b) => a + b, 0)
    const chapterCount = flattenChapters(tree.text).length

    // 截止日之前已经排掉的请假天数
    const leavesBefore = (due: string | null) =>
      due === null
        ? 0
        : plan.leaves.filter((l) => l.day >= today && l.day <= due).length

    const views = list.map((m: Milestone) => {
      let progress: TargetProgress
      switch (m.target.kind) {
        case 'volume':
        case 'category':
          progress = underDir(m.target.path)
          break
        case 'doc':
          progress = { done: (chars.get(m.target.path) ?? 0) > 0 ? 1 : 0, total: 1, unit: '篇' }
          break
        case 'words':
          progress = { done: totalChars, total: m.target.total, unit: '字' }
          break
        case 'chapters':
          progress = { done: chapterCount, total: m.target.total, unit: '章' }
          break
        default:
          progress = { done: 0, total: null, unit: '' }
      }
      return viewMilestone(m, progress, {
        today,
        dailySpeed: recentSpeed,
        plannedLeaves: leavesBefore(m.due),
      })
    })

    return sortMilestones(views)
  }

  async addMilestone(
    bookPath: string,
    input: { title: string; target: Milestone['target']; due?: string | null },
  ): Promise<{ id: string }> {
    const now = Date.now()
    const m: Milestone = {
      id: newMilestoneId(now),
      title: input.title,
      target: input.target,
      due: input.due ?? null,
      doneManually: false,
      createdAt: now,
      updatedAt: now,
    }
    await appendMilestone(this.backend, bookPath, m)
    return { id: m.id }
  }

  async patchMilestone(
    bookPath: string,
    id: string,
    changes: Partial<Milestone>,
  ): Promise<void> {
    const list = await loadMilestones(this.backend, bookPath)
    const cur = list.find((m) => m.id === id)
    if (!cur) throw new Error('找不到这个里程碑，可能已经删掉了。')
    await appendMilestone(this.backend, bookPath, { ...cur, ...changes, id, updatedAt: Date.now() })
  }

  async removeMilestone(bookPath: string, id: string): Promise<void> {
    const list = await loadMilestones(this.backend, bookPath)
    const cur = list.find((m) => m.id === id)
    if (!cur) return
    await appendMilestone(this.backend, bookPath, { ...cur, deleted: true, updatedAt: Date.now() })
  }

  /** 建里程碑时给作者挑的对象：卷、设定分类 */
  async milestoneTargets(bookPath: string): Promise<Array<{ label: string; kind: 'volume' | 'category'; path: string }>> {
    const tree = await coreLoadTree(this.backend, bookPath)
    const out: Array<{ label: string; kind: 'volume' | 'category'; path: string }> = []
    for (const n of tree.text) {
      if (n.kind === 'volume') out.push({ label: n.title, kind: 'volume', path: n.path })
    }
    for (const c of tree.settings) out.push({ label: c.name, kind: 'category', path: c.path })
    return out
  }

  // ── 游戏剧本 ──

  /**
   * 整本书建一张分支图。
   *
   * 跳转是**跨文件**的，所以必须把所有正文都读一遍 ——
   * 目录树那一层刻意不读内容（WebDAV 上要快），这里只好自己读。
   * 游戏剧本一般比长篇小说小得多，一次全读没问题；
   * 真到了几百万字，再考虑挂到索引上。
   */
  /**
   * 建整本书的分支图。
   *
   * `live` 是**编辑器里还没存盘的那一篇**。给了它就用它，不读磁盘那一份 ——
   * 不然作者改一行节点名，得等自动保存那三秒过去图才跟着动，
   * 看着就像「路线图有延迟」（作者报过这个）。
   */
  async gameGraph(bookPath: string, live?: { path: string; body: string }): Promise<{
    nodes: GameNode[]
    problems: Problem[]
    start: string | null
    reachable: string[]
    unreachable: string[]
    endings: Array<{ name: string; path: PathStep[]; state: Record<string, VarValue> }>
    truncated: boolean
    variables: Array<{ name: string; values: string[] }>
    progress: GameProgress
  }> {
    const tree = await coreLoadTree(this.backend, bookPath)
    const docs: SourceDoc[] = []

    const add = async (path: string, title: string) => {
      if (live && live.path === path) {
        docs.push({ path, title, body: live.body })
        return
      }
      try {
        docs.push({ path, title, body: (await readDoc(this.backend, path)).body })
      } catch {
        // 某一篇读不出来不该让整张图建不起来
      }
    }

    for (const node of tree.text) {
      if (node.kind === 'volume') {
        for (const c of node.chapters) await add(c.path, c.title)
      } else {
        await add(node.path, node.title)
      }
    }

    const graph = buildGraph(parseGameNodes(docs))
    const sim = simulate(graph)

    return {
      nodes: graph.nodes,
      problems: graph.problems,
      start: graph.start,
      reachable: [...sim.reachable],
      unreachable: sim.unreachable,
      endings: sim.endings,
      truncated: sim.truncated,
      variables: [...sim.variableValues].map(([name, values]) => ({ name, values: [...values] })),
      progress: gameProgress(graph, sim),
    }
  }

  /**
   * 从任意节点开始试玩。
   *
   * 写到第八章时想试「从这儿往后还能到哪些结局」，
   * 每次都从头走一遍是没法用的。也能假设「已经拿到钥匙了」。
   */
  async playFrom(
    bookPath: string,
    from: string,
    initialState: GameState = {},
  ): Promise<{
    reachable: string[]
    unreachable: string[]
    endings: Array<{ name: string; path: PathStep[]; state: Record<string, VarValue> }>
    truncated: boolean
  }> {
    const g = await this.gameGraph(bookPath)
    const graph = buildGraph(g.nodes)
    const sim = simulate(graph, { from, initialState })
    return {
      reachable: [...sim.reachable],
      unreachable: sim.unreachable,
      endings: sim.endings,
      truncated: sim.truncated,
    }
  }

  /** 导成引擎骨架。只回内容，存到哪由界面决定 */
  async exportGameScript(bookPath: string, engine: Engine) {
    const g = await this.gameGraph(bookPath)
    const meta = await coreLoadTree(this.backend, bookPath)
    return exportGame(g.nodes, engine, meta.meta.title)
  }

  // ── 剧本 ──

  /**
   * 这本书的角色名单 —— 从设定集里指定的那几个分类读。
   *
   * **要读每张卡的正文**（为了别名行），所以比目录树贵。
   * 一本书几十张人物卡，一次几十个小文件，可以接受；
   * 但别放进每次按键都会走的路径上。
   */
  async bookCast(bookPath: string): Promise<{
    /** 设定集里全部分类，供界面勾选 */
    available: string[]
    /** 当前算「人物」的分类。作者没选过时是猜的 */
    categories: string[]
    /** 作者自己选过没有。没选过时界面要说清楚这是猜的 */
    chosen: boolean
    names: string[]
    canonical: Record<string, string>
  }> {
    const tree = await coreLoadTree(this.backend, bookPath)
    const available = tree.settings.map((c) => c.name)
    const picked = tree.meta.castFrom
    const chosen = Array.isArray(picked)
    const categories = (chosen ? picked : guessCastCategories(available)).filter((n) =>
      available.includes(n),
    )

    const cards: CastCard[] = []
    for (const cat of tree.settings) {
      if (!categories.includes(cat.name)) continue
      for (const card of cat.cards) {
        let body = ''
        try {
          body = (await readDoc(this.backend, card.path)).body
        } catch {
          // 读不到就只认标题 —— 一张卡打不开不该让整份名单作废
        }
        cards.push({ title: card.title, body })
      }
    }

    const cast = buildCast(cards)
    return { available, categories, chosen, names: cast.names, canonical: cast.canonical }
  }

  /** 改「哪几个分类算人物」。存进 book.yaml，跟着书走 */
  async setCastCategories(bookPath: string, categories: string[]): Promise<BookMeta> {
    return coreUpdateBookMeta(this.backend, bookPath, { castFrom: categories })
  }

  /** 剧本的按场分布、缺席检查、以及不在人物卡里的名字 */
  async scriptReport(docPath: string, bookPath?: string) {
    const cast = bookPath
      ? await this.bookCast(bookPath).then((c) => ({ names: c.names, canonical: c.canonical }))
      : emptyCast()
    const doc = parseScript((await readDoc(this.backend, docPath)).body, { cast })
    return {
      scenes: sceneCast(doc),
      absence: longestAbsence(doc),
      unknown: unknownSpeakers(doc, cast),
    }
  }

  /**
   * 把某一场整体挪个位置。
   *
   * **直接改正文** —— 场次顺序就是正文里的顺序，没有另一份顺序数据。
   * 走完整保存管线，所以版本历史里留得下这一步，挪错了能回滚。
   */
  async moveSceneIn(docPath: string, from: number, to: number): Promise<{ body: string }> {
    const doc = await readDoc(this.backend, docPath)
    const next = moveScene(doc.body, from, to)
    if (next !== doc.body) await this.saveDoc(docPath, next)
    return { body: next }
  }

  /**
   * 这个目录里已经有稿子了吗。
   *
   * 「教学模板只给第一篇」全靠这一句。读不出来就当**已经有** ——
   * 猜错的两个方向不对称：多给一次模板是让作者删十几行，
   * 少给一次只是他自己写标题，后者轻得多。
   */
  private async hasDocsIn(dir: string): Promise<boolean> {
    try {
      const entries = await this.backend.list(dir)
      return entries.some((e) => e.name.endsWith('.md'))
    } catch {
      return true
    }
  }

  /**
   * 新建一篇剧本。
   *
   * **整份骨架只给这个目录里的第一篇。** 每新建一场都塞一遍
   * 「李四/王五在咖啡馆」，作者得先删十几行才能开始写自己的东西
   * （作者报过这个）。第二篇起只给一行场景标题。
   */
  async createScript(dir: string, title: string): Promise<{ path: string }> {
    const body = (await this.hasDocsIn(dir)) ? scriptSceneStub(title) : scriptTemplate(title)
    const { path } = await writeNewDoc(this.backend, dir, title, 'script', body, {
      keepBodyAsIs: true,
    })
    return { path }
  }

  /**
   * 新建一篇游戏剧本。
   *
   * 跟 `createScript` 同一条规矩：整份能跑通的骨架只给第一篇，
   * 后面每一篇只给一行 `# 标题`。空文件不行 —— 那样它连节点都算不上，
   * 图上根本不出现，作者会以为新建没成功。
   */
  async createGameScript(dir: string, title: string): Promise<{ path: string }> {
    const body = (await this.hasDocsIn(dir)) ? gameNodeStub(title) : gameScriptTemplate(title)
    const { path } = await writeNewDoc(this.backend, dir, title, 'chapter', body, {
      keepBodyAsIs: true,
    })
    return { path }
  }

  // ── 坚果云冲突副本 ──

  /**
   * 列出冲突副本，并把两边正文的差异一并算好。
   *
   * 差异在主进程算：这样界面拿到的就是可以直接画的行，
   * 而且几百 KB 的正文不必来回过 IPC 两遍。
   */
  async listConflicts(bookPath: string): Promise<
    Array<ConflictPair & { summary: DiffSummary; note: string; originalMissing: boolean; error?: string }>
  > {
    const tree = await coreLoadTree(this.backend, bookPath)
    const out: Array<
      ConflictPair & { summary: DiffSummary; note: string; originalMissing: boolean; error?: string }
    > = []

    for (const pair of pairConflicts(tree.conflicts)) {
      try {
        const right = await readDoc(this.backend, pair.conflictPath)
        // 正本可能已经被作者删了，那就当左边是空的
        let left = ''
        let originalMissing = false
        try {
          left = (await readDoc(this.backend, pair.originalPath)).body
        } catch {
          originalMissing = true
        }
        const summary = compareTexts(left, right.body)
        out.push({
          ...pair,
          summary,
          note: originalMissing ? '正本不在了，这份副本可以直接扶正。' : describeConflict(summary),
          originalMissing,
        })
      } catch (e) {
        // 读不出来也要让作者看见这个文件的存在，不能悄悄跳过
        out.push({
          ...pair,
          summary: { rows: [], added: 0, removed: 0, identical: false },
          note: '这份副本读不出来，请到文件夹里手动看看。',
          originalMissing: false,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }

    return out
  }

  /**
   * 处理一个冲突副本。
   *
   * - `keepOriginal`：正本不动，副本进回收站
   * - `keepConflict`：副本的正文覆盖正本，然后副本进回收站
   * - `keepBoth`：把副本改名成一篇正常文档留着，作者自己慢慢合
   *
   * 三条路都**不硬删任何东西**。同步冲突里被丢掉的那一版，
   * 往往是作者熬夜写的那一版。
   */
  async resolveConflict(
    bookPath: string,
    conflictPath: string,
    action: 'keepOriginal' | 'keepConflict' | 'keepBoth',
  ): Promise<{ resolvedPath: string | null }> {
    const [pair] = pairConflicts([conflictPath])
    if (!pair) throw new Error('这不是一个冲突副本。')

    if (action === 'keepOriginal') {
      await coreTrashDoc(this.backend, bookPath, conflictPath)
      return { resolvedPath: pair.originalPath }
    }

    if (action === 'keepConflict') {
      const doc = await readDoc(this.backend, conflictPath)

      // 先把正本整个移进回收站再覆盖。
      // 不能指望版本历史兜底 —— 历史按 30 秒时间桶合并，
      // 刚保存完就处理冲突的话，被换掉的那一版会并进同一条记录里，
      // 于是**根本没有留下痕迹**。回收站里躺着一个完整文件才是踏实的。
      let previous: Awaited<ReturnType<typeof readDoc>> | null = null
      try {
        previous = await readDoc(this.backend, pair.originalPath)
        await coreTrashDoc(this.backend, bookPath, pair.originalPath)
      } catch {
        // 正本已经不在了，那就是直接扶正
      }

      // 保留正本的 id 与创建时间：这篇文档的版本历史、伏笔、双链都挂在那个 id 上
      const meta = previous ? previous.meta : doc.meta
      await writeDoc(this.backend, pair.originalPath, { ...(previous ?? doc), meta, body: doc.body })
      // 再走一次完整管线，让索引和版本历史跟上
      await this.saveDoc(pair.originalPath, doc.body)

      await coreTrashDoc(this.backend, bookPath, conflictPath)
      return { resolvedPath: pair.originalPath }
    }

    // keepBoth：改名成 `xxx（副本）`，让它变成一篇普通文档
    const cut = pair.originalPath.lastIndexOf('/')
    const dir = pair.originalPath.slice(0, cut)
    const doc = await readDoc(this.backend, conflictPath)
    // 标题得先把冲突标记摘掉 —— 不然新文件名里还带着「(冲突文件 …)」，
    // 下次扫描又会把它当成冲突副本，作者永远处理不完
    const title = `${originalFileName(doc.meta.title)}（另一版）`
    const kept = await writeNewDoc(this.backend, dir, title, doc.meta.type, doc.body, {
      keepBodyAsIs: true,
    })
    await coreTrashDoc(this.backend, bookPath, conflictPath)
    return { resolvedPath: kept.path }
  }

  // ── AI 上下文 ──

  /**
   * 拼装给 AI 的上下文。
   *
   * 分层见 05-功能模块详述 §9.4：前四层稳定（可缓存），后三层每次都变。
   * 这里只负责**取材**，怎么拼、怎么打缓存标记在 ai.ts 里。
   */
  async buildAiContext(
    bookPath: string,
    docPath: string | null,
    query: string,
  ): Promise<{
    settings: string
    outline: string
    foreshadows: string
    currentChapter: { title: string; body: string }
    previousChapters: Array<{ title: string; body: string }>
    searchHits: Array<{ title: string; snippet: string }>
    bookTitle: string
  }> {
    const tree = await coreLoadTree(this.backend, bookPath)

    // 设定：只给卡片正面，不给全文 —— 正面是作者自己标出来的「最该记住的部分」，
    // 全塞进去会把上下文撑爆，也会稀释重点
    const stickies = await coreReadAllStickies(this.backend, tree)
    const settings = stickies
      .filter((c) => c.face)
      .map((c) => `- ${c.title}${c.category ? `（${c.category}）` : ''}：${c.face.replace(/\n/g, '；')}`)
      .join('\n')

    const outlineParts: string[] = []
    for (const o of tree.outline) {
      outlineParts.push(`### ${o.title}\n${(await readDoc(this.backend, o.path)).body.trim()}`)
    }

    const fs = await this.listForeshadows(bookPath, undefined)
    const foreshadows = fs.items
      .filter((f) => f.status === 'planned' || f.status === 'planted')
      .map((f) => `- ${f.title}：${f.desc || '（没写描述）'}${f.expectBy ? `　计划收于 ${f.expectBy}` : ''}`)
      .join('\n')

    const chapters = flattenChapters(tree.text)
    const idx = docPath ? chapters.findIndex((c) => c.path === docPath) : -1

    let currentChapter = { title: '（没有打开章节）', body: '' }
    const previousChapters: Array<{ title: string; body: string }> = []
    if (idx >= 0) {
      const cur = chapters[idx]!
      currentChapter = { title: cur.title, body: (await readDoc(this.backend, cur.path)).body }
      // 前两章足够给出上下文；再多会显著推高成本
      for (const c of chapters.slice(Math.max(0, idx - 2), idx)) {
        previousChapters.push({ title: c.title, body: (await readDoc(this.backend, c.path)).body })
      }
    }

    // 由问题触发的检索：让 AI 看到全书里相关的段落，而不是只有眼前这一章
    const searchHits: Array<{ title: string; snippet: string }> = []
    if (query.trim().length >= 2) {
      for (const h of this.index.search(query, { book: bookPath, limit: 8 }).hits) {
        if (h.path === docPath) continue
        // 片段里带着给界面用的高亮控制字符，喂给 AI 之前要剥掉
        searchHits.push({ title: h.title, snippet: stripHighlight(h.snippet) })
      }
    }

    return {
      settings,
      outline: outlineParts.join('\n\n'),
      foreshadows,
      currentChapter,
      previousChapters,
      searchHits,
      bookTitle: tree.meta.title,
    }
  }

  // ── 导入导出 ──

  /** 把导入方案落盘：每章一个文件，序号从现有末尾接着排 */
  async applyImport(
    bookPath: string,
    dir: string,
    chapters: Array<{ title: string; body: string }>,
    preamble: string | null,
  ): Promise<{ created: number }> {
    let created = 0
    if (preamble) {
      await writeNewDoc(this.backend, dir, '前言', 'chapter', preamble)
      created++
    }
    for (const c of chapters) {
      await writeNewDoc(this.backend, dir, c.title, 'chapter', c.body)
      created++
    }
    this.syncedBooks.delete(bookPath)
    await this.syncIndex(bookPath, { force: true }).catch(() => ({ indexed: 0, removed: 0 }))
    return { created }
  }

  /** 把整本书读成导出用的章节数组（含卷名） */
  /**
   * 收大纲和设定集，供导出用。
   *
   * 跟 `collectForExport()` 分开是因为它们的形状不一样：正文是「卷 → 章」，
   * 大纲是一堆平铺的文档，设定集是「分类 → 卡片」。
   * 硬塞进同一个函数只会让三种都别扭。
   *
   * 设定集**收成一份**、分类当二级标题 —— 作者定的：
   * 「同一个文件就好」。它是拿来通读的，拆成七八个文件反而难找。
   */
  async collectExtras(
    bookPath: string,
    what: { outline?: boolean; settings?: boolean },
  ): Promise<{
    outline: Array<{ title: string; body: string; volume: string | null }>
    settings: Array<{ title: string; body: string; volume: string | null }>
  }> {
    const tree = await coreLoadTree(this.backend, bookPath)
    const outline: Array<{ title: string; body: string; volume: string | null }> = []
    const settings: Array<{ title: string; body: string; volume: string | null }> = []

    if (what.outline) {
      for (const n of tree.outline) {
        outline.push({ title: n.title, body: (await readDoc(this.backend, n.path)).body, volume: null })
      }
    }

    if (what.settings) {
      // 分类当「卷」传下去 —— 导出那一层本来就会把 volume 排成二级标题，
      // 正好是作者要的「一个文件、分类当二级标题」
      for (const c of tree.settings) {
        for (const card of c.cards) {
          settings.push({
            title: card.title,
            body: (await readDoc(this.backend, card.path)).body,
            volume: c.name,
          })
        }
      }
      // 没归类的那些放最后，不硬塞进某个分类里
      for (const card of tree.looseSettings) {
        settings.push({
          title: card.title,
          body: (await readDoc(this.backend, card.path)).body,
          volume: null,
        })
      }
    }

    return { outline, settings }
  }

  async collectForExport(
    bookPath: string,
    range?: { fromPath?: string; toPath?: string },
  ): Promise<Array<{ title: string; body: string; volume: string | null }>> {
    const tree = await coreLoadTree(this.backend, bookPath)
    const out: Array<{ title: string; body: string; volume: string | null }> = []

    for (const node of tree.text) {
      if (node.kind === 'volume') {
        for (const c of node.chapters) {
          out.push({ title: c.title, body: (await readDoc(this.backend, c.path)).body, volume: node.title })
        }
      } else {
        out.push({ title: node.title, body: (await readDoc(this.backend, node.path)).body, volume: null })
      }
    }

    if (range?.fromPath || range?.toPath) {
      const paths = flattenChapters(tree.text).map((c) => c.path)
      const from = range.fromPath ? paths.indexOf(range.fromPath) : 0
      const to = range.toPath ? paths.indexOf(range.toPath) : paths.length - 1
      if (from >= 0 && to >= from) return out.slice(from, to + 1)
    }
    return out
  }

  // ── 目录管理 ──

  createVolume(bookPath: string, title: string): Promise<{ path: string }> {
    return coreCreateVolume(this.backend, bookPath, title)
  }

  async renameDoc(path: string, newTitle: string): Promise<{ path: string }> {
    const r = await coreRenameDoc(this.backend, path, newTitle)
    this.moveHistoryCache(path, r.path)
    this.reindexAfterMove(path, r.path)
    return r
  }

  renameVolume(path: string, newTitle: string): Promise<{ path: string }> {
    return coreRenameVolume(this.backend, path, newTitle)
  }

  async reorder(dir: string, fromIndex: number, toIndex: number): Promise<ReorderOutcome> {
    // 重排会重命名一批文件，缓存里的路径全部作废
    this.histories.clear()
    const r = await reorderInDir(this.backend, dir, fromIndex, toIndex)
    // 一批文件改了名，索引里的路径全都要重新对齐
    await this.syncIndex(bookRootOf(dir), { force: true }).catch((e) => {
      console.error('[bugu] 重排后重建索引失败:', e)
      return { indexed: 0, removed: 0 }
    })
    return r
  }

  async moveToDir(path: string, targetDir: string): Promise<{ path: string }> {
    const r = await moveChapterToDir(this.backend, path, targetDir)
    this.moveHistoryCache(path, r.path)
    this.reindexAfterMove(path, r.path)
    return r
  }

  // ── 回收站 ──

  async trashDoc(bookPath: string, path: string): Promise<{ trashPath: string }> {
    this.histories.delete(path)
    const r = await coreTrashDoc(this.backend, bookPath, path)
    try {
      this.index.removeByPath(path)
    } catch (e) {
      console.error('[bugu] 从索引移除失败:', e)
    }
    return r
  }

  listTrash(bookPath: string): Promise<TrashEntry[]> {
    return coreListTrash(this.backend, bookPath)
  }

  restoreFromTrash(entry: TrashEntry): Promise<void> {
    return coreRestoreFromTrash(this.backend, entry)
  }

  emptyTrash(bookPath: string): Promise<number> {
    return coreEmptyTrash(this.backend, bookPath)
  }

  // ── 设定集 ──

  async createSettingCategory(bookPath: string, name: string): Promise<{ path: string }> {
    const { path } = await coreCreateSettingCategory(this.backend, bookPath, name)
    return { path }
  }

  async createSettingCard(categoryPath: string, title: string): Promise<{ path: string }> {
    // 需要拿到该分类的模板信息，从目录树里取（比自己拼路径可靠）
    const bookPath = bookRootOf(categoryPath)
    const tree = await coreLoadTreeForCategory(this.backend, bookPath)
    const category = tree.settings.find((c) => c.path === categoryPath)
    if (!category) throw new Error(`找不到设定分类：${categoryPath}`)

    const { path } = await coreCreateSettingCard(this.backend, category, title)
    return { path }
  }

  async readTemplate(categoryPath: string): Promise<{ path: string; content: string }> {
    const path = await ensureTemplate(this.backend, categoryPath)
    try {
      return { path, content: await this.backend.read(path) }
    } catch {
      return { path, content: defaultTemplate() }
    }
  }

  // ── 文档 ──

  async readDoc(path: string): Promise<SavedDoc> {
    const doc = await readDoc(this.backend, path)
    return { meta: doc.meta, body: doc.body }
  }

  /**
   * 保存正文，并连带写历史与统计。
   *
   * 正文写失败会抛出去让界面报错；历史或统计写失败只记日志不打断 ——
   * 丢一条统计远比丢一次保存轻。
   */
  /**
   * 把一份正文另存成同目录下的一篇副本。
   *
   * 「这一篇在别处改过」时用它 —— 作者选「用别处那版」之前，
   * 先把他手上没保存的字原样存成一篇，**一个字都不丢**。
   * 不问、不覆盖、不让他自己去复制粘贴。
   */
  async saveAside(path: string, body: string, suffix: string): Promise<{ path: string }> {
    const existing = await readDoc(this.backend, path)
    const dir = path.slice(0, path.lastIndexOf('/'))
    const { path: made } = await writeNewDoc(
      this.backend,
      dir,
      `${existing.meta.title}${suffix}`,
      existing.meta.type,
      body,
      { keepBodyAsIs: true },
    )
    return { path: made }
  }

  async saveDoc(path: string, body: string): Promise<SaveOutcome> {
    const now = Date.now()
    const existing = await readDoc(this.backend, path)
    // 记下是哪台机器写的 —— 「这一篇在别处改过」的对话框要拿它说话
    const doc: ParsedDoc = { ...existing, body, meta: { ...existing.meta, device: this.deviceName } }

    // 净增必须拿**磁盘上的旧正文**来算，不能靠内存里缓存的「上次字数」。
    // 缓存在两种常见情况下是空的：新建的章节、软件重启后第一次保存。
    // 那时会把净增算成 0 —— 新写三千字保存后统计显示 0，作者会以为软件坏了。
    const prevChars = countWords(existing.body).withPunctuation

    // 1. 正文（第一优先，失败就抛）
    const saved = await writeDoc(this.backend, path, doc)
    const chars = countWords(body).withPunctuation

    let version: number | null = null
    let historyAction: SaveOutcome['historyAction'] = 'skipped'

    // 2. 版本历史
    try {
      const entry = await this.historyFor(saved.meta.id, path)
      const result = appendSave(entry.state, { content: body, ts: now, dev: this.deviceId })
      entry.state = result.state
      historyAction = result.action
      if (result.record) {
        version = result.record.v
        // merged 时同一条记录会被重写，这里仍然追加 ——
        // 读取端按 v 去重取最新，见 loadHistory 的排序逻辑
        // 路径必须带上作品根目录 —— metaPaths 给的是**相对作品**的路径，
        // 直接用会写到库根目录下，跟读取时的位置对不上（历史存了却永远读不回来）
        await this.backend.append(
          `${bookRootOf(path)}/${metaPaths.history(saved.meta.id, this.deviceId)}`,
          JSON.stringify(result.record),
        )
      }
    } catch (e) {
      console.error('[bugu] 写版本历史失败（正文已保存，不影响稿子）:', e)
    }

    // 3. 码字统计
    try {
      const delta = chars - prevChars

      if (delta !== 0) {
        // 间隔超过 30 分钟视为新的一场
        if (now - this.lastSaveTs > 30 * 60_000) this.sessionId = `s-${now.toString(36)}`
        this.lastSaveTs = now

        const bookRoot = bookRootOf(path)
        await this.backend.append(
          `${bookRoot}/${metaPaths.stats(this.deviceId)}`,
          JSON.stringify(
            createStatRecord({
              ts: now,
              dev: this.deviceId,
              doc: saved.meta.id,
              delta,
              total: chars,
              session: this.sessionId,
              pomo: this.pomodoroActive,
            }),
          ),
        )
      }
    } catch (e) {
      console.error('[bugu] 写统计失败（正文已保存，不影响稿子）:', e)
    }

    // 4. 索引（失败只记日志，绝不影响已经保存好的正文）
    try {
      const stat = await this.backend.stat(path)
      this.index.upsertDoc({
        book: bookRootOf(path),
        path,
        raw: serializeDoc(saved.meta, body),
        mtime: stat?.mtime ?? now,
        fileName: path.slice(path.lastIndexOf('/') + 1),
      })
    } catch (e) {
      console.error('[bugu] 更新索引失败（正文已保存，不影响稿子）:', e)
    }

    return { meta: saved.meta, chars, version, historyAction }
  }

  // ── 统计 ──

  /** 番茄钟是否在跑。跑着的时候保存的记录会带 pomo 标记 */
  private pomodoroActive = false

  setPomodoro(active: boolean): void {
    this.pomodoroActive = active
  }

  private async readStats(bookPath: string) {
    const dir = `${bookPath}/${metaPaths.statsDir()}`
    try {
      const files = await this.backend.list(dir)
      const shards = await Promise.all(
        files
          .filter((f) => !f.isDirectory && f.name.endsWith('.jsonl'))
          .map(async (f) => parseStatsJsonl(await this.backend.read(f.path))),
      )
      return mergeStats(shards)
    } catch {
      return []
    }
  }

  /**
   * 完整统计：日/周/月曲线、年度热力图、连续天数、写作会话。
   *
   * 日期区间按**写作日**算（凌晨 4 点前算前一天，见 core/stats），
   * 所以「今天」跟日历上的今天可能差一天，这是有意的。
   */
  async statsReport(
    bookPath: string,
    opts: { days?: number } = {},
  ): Promise<{
    today: TodayStat
    streak: StreakInfo
    daily: DayStat[]
    weekly: Array<{ weekStart: string; words: number }>
    monthly: Array<{ month: string; words: number }>
    heat: HeatCell[]
    sessions: WritingSession[]
    dailyTarget: number
  }> {
    const records = await this.readStats(bookPath)
    const today = currentWritingDay(Date.now())
    const span = opts.days ?? 371 // 53 周，热力图刚好铺满

    const raw = byDay(records)
    const daily = fillDays(raw, addDays(today, -(span - 1)), today)

    let dailyTarget = 0
    try {
      dailyTarget = parseBookMeta(await this.backend.read(`${bookPath}/book.yaml`)).targets?.dailyWords ?? 0
    } catch {
      /* 没设目标就是 0 */
    }

    return {
      today: todayStat(daily, today, dailyTarget),
      streak: computeStreak(daily, today),
      daily,
      weekly: byWeek(daily),
      monthly: byMonth(daily),
      heat: buildHeatmap(daily),
      sessions: buildSessions(records).slice(-40).reverse(),
      dailyTarget,
    }
  }

  async todayProgress(bookPath: string): Promise<TodayProgress> {
    const day = currentWritingDay(Date.now())
    const dir = `${bookPath}/${metaPaths.statsDir()}`

    let shards: ReturnType<typeof parseStatsJsonl>[] = []
    try {
      const files = await this.backend.list(dir)
      shards = await Promise.all(
        files
          .filter((f) => !f.isDirectory && f.name.endsWith('.jsonl'))
          .map(async (f) => parseStatsJsonl(await this.backend.read(f.path))),
      )
    } catch {
      shards = []
    }

    const days = byDay(mergeStats(shards))

    /*
     * 签到线用**作者自己设的今日底线**，不是那个写死的 5000。
     *
     * 这一处原来是 `computeStreak(days, day)` —— 没传 opts，于是
     * signInWords 一路落到常量 5000。作者在码字计划里把目标改成 2000，
     * 稿纸右上角却始终写着「还差 5,000」，怎么改都不动。
     *
     * 没设目标（floor 为 0）时才退回那个常量 —— 那时候总得有条线，
     * 不然「签到」这个概念就不成立了。
     */
    const plan = await loadPlan(this.backend)
    const floor = targetFor(day, plan.targets).floor
    const opts = floor > 0 ? { signInWords: floor } : {}
    const streak = computeStreak(days, day, opts)
    return {
      day,
      words: days.find((d) => d.day === day)?.words ?? 0,
      signedIn: streak.todaySigned,
      wordsToSignIn: streak.wordsToSignIn,
      streak: streak.current,
      streakMakeups: streak.currentMakeups,
      signInWords: floor > 0 ? floor : SIGN_IN_WORDS,
    }
  }

  // ── 内部 ──

  /** 文件改名或移动后，清掉索引里的旧路径，并让这本书下次打开时重新同步 */
  private reindexAfterMove(from: string, to: string): void {
    if (from === to) return
    try {
      this.index.removeByPath(from)
      this.syncedBooks.delete(bookRootOf(to))
    } catch (e) {
      console.error('[bugu] 改名后更新索引失败:', e)
    }
  }

  /** 文件改名后，把历史缓存挪到新路径下，免得下一次保存重头加载 */
  private moveHistoryCache(from: string, to: string): void {
    if (from === to) return
    const entry = this.histories.get(from)
    this.histories.delete(from)
    if (entry) this.histories.set(to, entry)
  }

  private async historyFor(docId: string, docPath: string) {
    const cached = this.histories.get(docPath)
    if (cached && cached.docId === docId) return cached

    const file = `${bookRootOf(docPath)}/${metaPaths.history(docId, this.deviceId)}`
    let state: HistoryState
    try {
      state = loadHistory(parseHistoryJsonl(await this.backend.read(file)))
    } catch {
      state = emptyHistory()
    }
    const entry = { docId, state }
    this.histories.set(docPath, entry)
    return entry
  }
}

/** 从文档路径推出它属于哪本书（根目录下的第一段） */
function bookRootOf(docPath: string): string {
  const i = docPath.indexOf('/')
  return i === -1 ? docPath : docPath.slice(0, i)
}

/** 剥掉检索片段里的高亮控制字符（U+0001 / U+0002），它们只给界面用 */
function stripHighlight(s: string): string {
  return s.replace(new RegExp(String.fromCharCode(1) + '|' + String.fromCharCode(2), 'g'), '')
}
