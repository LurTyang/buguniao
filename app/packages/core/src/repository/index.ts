/**
 * 作品仓库 —— 扫描书架、构建目录树、读写文档。
 *
 * 规范：更新文档/03-数据格式规范.md §1，05-功能模块详述.md §1 §4
 *
 * 本模块只依赖 `StorageBackend` 接口，因此桌面端（本地文件系统）与
 * 移动端（WebDAV）共用同一套逻辑，测试则用 MemoryBackend。
 *
 * ─────────────────────────────────────────────────────────────
 * 【一条重要的性能约定：构建目录树不读任何文件内容】
 *
 * 目录树的标题来自**文件名**（去掉序号前缀和 .md），不是 front-matter 里的 title。
 * 因为软件在保存时会让两者保持一致，而「读 300 个文件才能画出目录」
 * 在 WebDAV 上是灾难 —— 手机端点开一本书要等半分钟。
 *
 * front-matter 里的 id、精确 title、字数，由索引层在后台补齐（桌面端），
 * 或在打开单篇文档时按需读取（移动端）。
 * ─────────────────────────────────────────────────────────────
 */

import type {
  BookKind,
  BookMeta,
  DocType,
  ParsedDoc,
  PinnedSticky,
  StickyCard,
  StickyLayout,
} from '../types/index.js'
import { scriptTemplate } from '../script/index.js'
import { gameScriptTemplate } from '../gamescript/index.js'
import {
  createBookMeta,
  parseBookMeta,
  parseDoc,
  serializeBookMeta,
  serializeDoc,
  withLeadingBlankLine,
} from '../frontmatter/index.js'
import {
  parseName,
  buildName,
  nextOrder,
  moveItem,
  toOrderedItems,
  ORDER_STEP,
  type Rename,
} from '../ordering/index.js'
import { lintFloats, parseStickyCard, renderCardFace, type FloatLint } from '../sticky/index.js'
import {
  BOOK_META_FILE,
  DIRS,
  metaPaths,
  isConflictCopy,
  isInternalDir,
  joinPath,
  type FileEntry,
  type StorageBackend,
} from '../storage/index.js'

// ───────────────────────── 树结构 ─────────────────────────

export interface ChapterNode {
  kind: 'chapter'
  /** 相对作品根目录的路径 */
  path: string
  fileName: string
  order: number
  /** 显示标题（文件名去掉序号前缀与扩展名） */
  title: string
}

export interface VolumeNode {
  kind: 'volume'
  path: string
  fileName: string
  order: number
  title: string
  chapters: ChapterNode[]
}

export type TextNode = VolumeNode | ChapterNode

export interface SettingCard {
  path: string
  fileName: string
  /** 文件名去掉扩展名。真正的卡片标题要解析文件内容才知道，由索引层补 */
  title: string
}

export interface SettingCategory {
  /** 分类名 = 文件夹名 */
  name: string
  path: string
  /** 该分类的模板文件路径；没有则为 null */
  templatePath: string | null
  cards: SettingCard[]
}

export interface DocNode {
  path: string
  fileName: string
  order: number | null
  title: string
}

export interface BookTree {
  meta: BookMeta
  /** 作品根目录 */
  rootPath: string
  text: TextNode[]
  outline: DocNode[]
  settings: SettingCategory[]
  /** 根目录下直接放着的、不属于任何分类的设定 */
  looseSettings: SettingCard[]
  ideas: DocNode[]
  /** 检测到的坚果云冲突副本，界面要显示黄色横幅提示 */
  conflicts: string[]
}

// ───────────────────────── 书架 ─────────────────────────

export interface BookSummary {
  rootPath: string
  folderName: string
  meta: BookMeta
}

/**
 * 扫描根目录，找出所有含 `book.yaml` 的文件夹。
 *
 * 以 `_` 开头的文件夹（`_灵感箱`、`_归档`）跳过。
 */
export async function scanLibrary(backend: StorageBackend, rootPath = ''): Promise<BookSummary[]> {
  const entries = await backend.list(rootPath)
  const out: BookSummary[] = []

  for (const e of entries) {
    if (!e.isDirectory || isInternalDir(e.name)) continue
    const metaPath = joinPath(e.path, BOOK_META_FILE)
    if ((await backend.stat(metaPath)) === null) continue
    out.push({
      rootPath: e.path,
      folderName: e.name,
      meta: parseBookMeta(await backend.read(metaPath), { folderName: e.name }),
    })
  }

  // 置顶的排最前面，其余按书名。同为置顶时仍按书名 ——
  // 置顶是「常写的那几本别翻」，不是又一套要手工维护的顺序
  return out.sort(
    (a, b) =>
      Number(b.meta.pinned ?? false) - Number(a.meta.pinned ?? false) ||
      a.meta.title.localeCompare(b.meta.title, 'zh'),
  )
}

/**
 * 每种作品类型的开局。
 *
 * 新建时问一句「小说还是剧本、游戏」，比让作者写完三章才发现
 * 「原来还有剧本模式」强得多 —— 那时候格式已经写歪了。
 */
const KIND_SETUP: Record<
  BookKind,
  { firstDoc: string; docType: DocType; body(title: string): string; castCategory: string | null }
> = {
  novel: { firstDoc: '第一章', docType: 'chapter', body: () => '', castCategory: null },
  script: {
    firstDoc: '第一场',
    docType: 'script',
    body: (t) => scriptTemplate(t),
    // 剧本要认角色名才能把名字单独排一行，所以先把「人物」这个分类建好，
    // 并在 book.yaml 里指过去 —— 不然作者得先去找那个开关
    castCategory: '人物',
  },
  game: {
    firstDoc: '第一幕',
    docType: 'chapter',
    body: (t) => gameScriptTemplate(t),
    castCategory: '人物',
  },
}

/** 新建作品：创建标准目录骨架 + book.yaml + 按类型给一份开局 */
export async function createBook(
  backend: StorageBackend,
  rootPath: string,
  title: string,
  opts: { now?: string; firstChapterTitle?: string; kind?: BookKind } = {},
): Promise<BookSummary> {
  const folder = joinPath(rootPath, sanitizeFileName(title))
  const kind = opts.kind ?? 'novel'
  const setup = KIND_SETUP[kind]

  const meta = createBookMeta(title, opts.now === undefined ? {} : { now: opts.now })
  if (kind !== 'novel') meta.kind = kind
  if (setup.castCategory) meta.castFrom = [setup.castCategory]

  for (const d of [DIRS.text, DIRS.outline, DIRS.settings, DIRS.ideas]) {
    await backend.mkdir(joinPath(folder, d))
  }
  if (setup.castCategory) {
    await backend.mkdir(joinPath(folder, DIRS.settings, setup.castCategory))
  }
  await backend.write(joinPath(folder, BOOK_META_FILE), serializeBookMeta(meta))

  const chapterTitle = opts.firstChapterTitle ?? setup.firstDoc
  const body = setup.body(chapterTitle)
  await writeNewDoc(backend, joinPath(folder, DIRS.text), chapterTitle, setup.docType, body, {
    ...opts,
    // 模板里的空行和缩进是有意义的，不许被「整理正文」那套规则动过
    ...(body ? { keepBodyAsIs: true } : {}),
  })

  return { rootPath: folder, folderName: sanitizeFileName(title), meta }
}

// ───────────────────────── 目录树 ─────────────────────────

/**
 * 构建整本书的目录树。**不读任何文档内容**，因此在 WebDAV 上也很快。
 */
export async function loadTree(backend: StorageBackend, rootPath: string): Promise<BookTree> {
  const metaRaw = await backend.read(joinPath(rootPath, BOOK_META_FILE))
  const meta = parseBookMeta(metaRaw, { folderName: rootPath.split('/').pop() ?? '' })

  const conflicts: string[] = []
  const collectConflicts = (entries: FileEntry[]) => {
    for (const e of entries) if (isConflictCopy(e.name)) conflicts.push(e.path)
  }

  const [text, outline, settings, looseSettings, ideas] = await Promise.all([
    loadTextTree(backend, joinPath(rootPath, DIRS.text), collectConflicts),
    loadDocList(backend, joinPath(rootPath, DIRS.outline), collectConflicts),
    loadSettings(backend, joinPath(rootPath, DIRS.settings), collectConflicts),
    loadLooseSettings(backend, joinPath(rootPath, DIRS.settings)),
    loadDocList(backend, joinPath(rootPath, DIRS.ideas), collectConflicts),
  ])

  return { meta, rootPath, text, outline, settings, looseSettings, ideas, conflicts }
}

async function loadTextTree(
  backend: StorageBackend,
  dir: string,
  onEntries: (e: FileEntry[]) => void,
): Promise<TextNode[]> {
  const entries = await safeList(backend, dir)
  onEntries(entries)
  const out: TextNode[] = []

  for (const e of entries) {
    if (isInternalDir(e.name) || isConflictCopy(e.name)) continue
    const { order, rest } = parseName(e.name)

    if (e.isDirectory) {
      const sub = await safeList(backend, e.path)
      onEntries(sub)
      out.push({
        kind: 'volume',
        path: e.path,
        fileName: e.name,
        order: order ?? Number.MAX_SAFE_INTEGER,
        title: stripMd(rest),
        chapters: sub
          .filter((c) => !c.isDirectory && isMd(c.name) && !isConflictCopy(c.name))
          .map((c) => toChapter(c))
          .sort(byOrder),
      })
    } else if (isMd(e.name)) {
      out.push(toChapter(e))
    }
  }

  return out.sort(byOrder)
}

function toChapter(e: FileEntry): ChapterNode {
  const { order, rest } = parseName(e.name)
  return {
    kind: 'chapter',
    path: e.path,
    fileName: e.name,
    order: order ?? Number.MAX_SAFE_INTEGER,
    title: stripMd(rest),
  }
}

async function loadDocList(
  backend: StorageBackend,
  dir: string,
  onEntries: (e: FileEntry[]) => void,
): Promise<DocNode[]> {
  const entries = await safeList(backend, dir)
  onEntries(entries)
  return entries
    .filter((e) => !e.isDirectory && isMd(e.name) && !isInternalDir(e.name) && !isConflictCopy(e.name))
    .map((e) => {
      const { order, rest } = parseName(e.name)
      return { path: e.path, fileName: e.name, order, title: stripMd(rest) }
    })
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title, 'zh'))
}

/** 模板文件名。以 `_` 开头，因此不会被当成一张便利贴 */
export const TEMPLATE_FILE = '_模板.md'

async function loadSettings(
  backend: StorageBackend,
  dir: string,
  onEntries: (e: FileEntry[]) => void,
): Promise<SettingCategory[]> {
  const entries = await safeList(backend, dir)
  onEntries(entries)
  const out: SettingCategory[] = []

  for (const e of entries) {
    if (!e.isDirectory || isInternalDir(e.name)) continue
    const sub = await safeList(backend, e.path)
    onEntries(sub)
    const hasTemplate = sub.some((c) => c.name === TEMPLATE_FILE)
    out.push({
      name: e.name,
      path: e.path,
      templatePath: hasTemplate ? joinPath(e.path, TEMPLATE_FILE) : null,
      cards: sub
        .filter((c) => !c.isDirectory && isMd(c.name) && !c.name.startsWith('_') && !isConflictCopy(c.name))
        .map((c) => ({ path: c.path, fileName: c.name, title: stripMd(c.name) }))
        .sort((a, b) => a.title.localeCompare(b.title, 'zh')),
    })
  }

  return out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

async function loadLooseSettings(backend: StorageBackend, dir: string): Promise<SettingCard[]> {
  const entries = await safeList(backend, dir)
  return entries
    .filter((e) => !e.isDirectory && isMd(e.name) && !e.name.startsWith('_') && !isConflictCopy(e.name))
    .map((e) => ({ path: e.path, fileName: e.name, title: stripMd(e.name) }))
    .sort((a, b) => a.title.localeCompare(b.title, 'zh'))
}

/** 目录树里所有章节，按顺序拍平。伏笔的「已过去多少章」要用它 */
export function flattenChapters(text: readonly TextNode[]): ChapterNode[] {
  const out: ChapterNode[] = []
  for (const n of text) {
    if (n.kind === 'chapter') out.push(n)
    else out.push(...n.chapters)
  }
  return out
}

// ───────────────────────── 文档读写 ─────────────────────────

/**
 * 读一篇文档。
 *
 * 若文件没有 front-matter（作者用记事本新建的）或缺 id，
 * 会自动补全并**回写文件** —— 这保证「用记事本随手加一章」也能被正常纳管。
 */
export async function readDoc(
  backend: StorageBackend,
  path: string,
  opts: { defaultType?: DocType; now?: string } = {},
): Promise<ParsedDoc> {
  const raw = await backend.read(path)
  const fileName = path.split('/').pop() ?? ''
  const parsed = parseDoc(raw, {
    fileName,
    ...(opts.defaultType === undefined ? {} : { defaultType: opts.defaultType }),
    ...(opts.now === undefined ? {} : { now: opts.now }),
  })

  if (!parsed.hadFrontMatter) {
    await backend.write(path, serializeDoc(parsed.meta, parsed.body))
  }
  return parsed
}

/** 写一篇文档，自动更新 `updated` 时间 */
export async function writeDoc(
  backend: StorageBackend,
  path: string,
  doc: ParsedDoc,
  now = new Date().toISOString(),
): Promise<ParsedDoc> {
  const updated: ParsedDoc = { ...doc, meta: { ...doc.meta, updated: now } }
  await backend.write(path, serializeDoc(updated.meta, updated.body))
  return updated
}

// ───────────────────────── 模板 ─────────────────────────

/**
 * 模板占位符替换。
 *
 * 支持 `{{标题}}` `{{日期}}` `{{分类}}`，未知占位符原样保留
 * （作者可能就是想在文档里写两个大括号）。
 */
export function applyTemplate(
  template: string,
  vars: { 标题?: string; 日期?: string; 分类?: string },
): string {
  return template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (whole, key: string) => {
    const v = (vars as Record<string, string | undefined>)[key]
    return v === undefined ? whole : v
  })
}

/** 某分类没有模板文件时用的默认骨架 */
export function defaultTemplate(): string {
  return ['# {{标题}}', '', '@身份：@', '@首次出场：@', '', '## 外貌', '', '## 备注', ''].join('\n')
}

/**
 * 在某分类下新建一张便利贴，套用该分类的模板。
 *
 * 分类没有模板时用 `defaultTemplate()`，不阻塞作者。
 */
export async function createSettingCard(
  backend: StorageBackend,
  category: SettingCategory,
  title: string,
  opts: { now?: string } = {},
): Promise<{ path: string; doc: ParsedDoc }> {
  const now = opts.now ?? new Date().toISOString()
  const template = category.templatePath ? await backend.read(category.templatePath) : defaultTemplate()

  const body = applyTemplate(template, {
    标题: title,
    日期: now.slice(0, 10),
    分类: category.name,
  })

  const path = joinPath(category.path, `${sanitizeFileName(title)}.md`)
  const doc = parseDoc(body, { fileName: `${title}.md`, defaultType: 'setting', now })
  // 模板正文里的 `# {{标题}}` 已经替换过，parseDoc 会把它认成标题
  doc.meta.title = title
  await backend.write(path, serializeDoc(doc.meta, withLeadingBlankLine(doc.body)))

  return { path, doc }
}

/** 为某分类创建模板文件（不存在时） */
export async function ensureTemplate(
  backend: StorageBackend,
  categoryPath: string,
): Promise<string> {
  const path = joinPath(categoryPath, TEMPLATE_FILE)
  if ((await backend.stat(path)) === null) {
    await backend.write(path, defaultTemplate())
  }
  return path
}

// ───────────────────────── 新建文档 ─────────────────────────

/** 在目录末尾新建一篇文档，返回其路径 */
export async function writeNewDoc(
  backend: StorageBackend,
  dir: string,
  title: string,
  type: DocType,
  body: string,
  opts: { now?: string; keepBodyAsIs?: boolean } = {},
): Promise<{ path: string; doc: ParsedDoc }> {
  const now = opts.now ?? new Date().toISOString()
  const entries = await safeList(backend, dir)
  const orders = entries
    .map((e) => parseName(e.name).order)
    .filter((o): o is number => o !== null)

  const order = nextOrder(orders) ?? (orders.length + 1) * ORDER_STEP
  const fileName = buildName(order, `${sanitizeFileName(title)}.md`)
  const path = joinPath(dir, fileName)

  const doc = parseDoc(body, { fileName, defaultType: type, now })
  doc.meta.title = title
  doc.meta.type = type
  // 新建空文档时补一个空行只是排版好看。但如果 body 是真有内容的
  // （从冲突副本、灵感碎片搬过来的），那一行就会变成作者正文顶上的空行 —— 见 D-07
  await backend.write(
    path,
    serializeDoc(doc.meta, opts.keepBodyAsIs ? doc.body : withLeadingBlankLine(doc.body)),
  )

  return { path, doc }
}

// ───────────────────────── 小工具 ─────────────────────────

/** Windows 文件名非法字符。中文标点不受影响，所以书名号引号都能用 */
const ILLEGAL = /[\\/:*?"<>|]/g

export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(ILLEGAL, '_').replace(/[.\s]+$/, '').trim()
  return cleaned === '' ? '未命名' : cleaned.slice(0, 100)
}

function isMd(name: string): boolean {
  return /\.md$/i.test(name)
}

function stripMd(name: string): string {
  return name.replace(/\.md$/i, '')
}

function byOrder(a: { order: number; title: string }, b: { order: number; title: string }): number {
  return a.order - b.order || a.title.localeCompare(b.title, 'zh')
}

/** 目录不存在时返回空数组，而不是让整棵树加载失败 */
async function safeList(backend: StorageBackend, dir: string): Promise<FileEntry[]> {
  try {
    return await backend.list(dir)
  } catch {
    return []
  }
}

// ───────────────────────── 重命名 / 删除 / 移动 ─────────────────────────

/**
 * 重命名文档：改文件名，**同时改 front-matter 里的 title**。
 *
 * 序号前缀保持不变 —— 改名不该顺带改顺序，那是两件事。
 */
export async function renameDoc(
  backend: StorageBackend,
  path: string,
  newTitle: string,
  now = new Date().toISOString(),
): Promise<{ path: string }> {
  const dir = path.slice(0, path.lastIndexOf('/'))
  const fileName = path.slice(path.lastIndexOf('/') + 1)
  const { order } = parseName(fileName)

  const nextFile = `${sanitizeFileName(newTitle)}.md`
  const nextPath = joinPath(dir, order === null ? nextFile : buildName(order, nextFile))

  // 先改内容再改名。反过来的话，改名成功而写内容失败，
  // 文件名和 front-matter 里的标题就对不上了。
  const doc = await readDoc(backend, path)
  doc.meta.title = newTitle
  doc.meta.updated = now
  await backend.write(path, serializeDoc(doc.meta, doc.body))

  if (nextPath !== path) await backend.rename(path, nextPath)
  return { path: nextPath }
}

/** 重命名卷（文件夹）。卷没有 front-matter，只改文件夹名 */
export async function renameVolume(
  backend: StorageBackend,
  path: string,
  newTitle: string,
): Promise<{ path: string }> {
  const dir = path.slice(0, path.lastIndexOf('/'))
  const { order } = parseName(path.slice(path.lastIndexOf('/') + 1))
  const nextPath = joinPath(
    dir,
    order === null ? sanitizeFileName(newTitle) : buildName(order, sanitizeFileName(newTitle)),
  )
  if (nextPath !== path) await backend.rename(path, nextPath)
  return { path: nextPath }
}

/**
 * 删除 = 移进回收站，**绝不硬删**。
 *
 * 回收站里保留原来的相对路径，这样恢复时知道该放回哪儿。
 * 同名冲突时加时间戳后缀，不覆盖已有的东西。
 */
export async function trashDoc(
  backend: StorageBackend,
  bookRoot: string,
  path: string,
  now = Date.now(),
): Promise<{ trashPath: string }> {
  const rel = path.startsWith(`${bookRoot}/`) ? path.slice(bookRoot.length + 1) : baseNameOf(path)
  let trashPath = joinPath(bookRoot, DIRS.trash, rel)

  if ((await backend.stat(trashPath)) !== null) {
    const dot = trashPath.lastIndexOf('.')
    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19)
    trashPath = dot > trashPath.lastIndexOf('/')
      ? `${trashPath.slice(0, dot)} (${stamp})${trashPath.slice(dot)}`
      : `${trashPath} (${stamp})`
  }

  await backend.rename(path, trashPath)
  return { trashPath }
}

export interface TrashEntry {
  /** 回收站里的完整路径 */
  path: string
  /** 相对作品根目录的原始路径，用于恢复 */
  originalPath: string
  name: string
  mtime: number
}

/** 列出回收站内容（递归） */
export async function listTrash(backend: StorageBackend, bookRoot: string): Promise<TrashEntry[]> {
  const trashRoot = joinPath(bookRoot, DIRS.trash)
  const out: TrashEntry[] = []

  const walk = async (dir: string): Promise<void> => {
    for (const e of await safeList(backend, dir)) {
      if (e.isDirectory) await walk(e.path)
      else if (isMd(e.name)) {
        out.push({
          path: e.path,
          originalPath: joinPath(bookRoot, e.path.slice(trashRoot.length + 1)),
          name: stripMd(stripOrderPrefixLocal(e.name)),
          mtime: e.mtime,
        })
      }
    }
  }
  await walk(trashRoot)

  return out.sort((a, b) => b.mtime - a.mtime)
}

/** 从回收站恢复到原位置。原位置已被占用时抛错，由界面提示作者 */
export async function restoreFromTrash(backend: StorageBackend, entry: TrashEntry): Promise<void> {
  if ((await backend.stat(entry.originalPath)) !== null) {
    throw new Error(`原位置已经有同名文件了：${entry.originalPath}`)
  }
  await backend.rename(entry.path, entry.originalPath)
}

/** 清空回收站。**这是唯一真正删除文件的地方**，必须由作者显式触发 */
export async function emptyTrash(backend: StorageBackend, bookRoot: string): Promise<number> {
  const entries = await listTrash(backend, bookRoot)
  for (const e of entries) await backend.delete(e.path)
  return entries.length
}

// ───────────────────────── 卷 ─────────────────────────

/** 新建卷（正文下的一个文件夹），追加到末尾 */
export async function createVolume(
  backend: StorageBackend,
  bookRoot: string,
  title: string,
): Promise<{ path: string }> {
  const dir = joinPath(bookRoot, DIRS.text)
  const entries = await safeList(backend, dir)
  const orders = entries.map((e) => parseName(e.name).order).filter((o): o is number => o !== null)
  const order = nextOrder(orders) ?? (orders.length + 1) * ORDER_STEP

  const path = joinPath(dir, buildName(order, sanitizeFileName(title)))
  await backend.mkdir(path)
  return { path }
}

// ───────────────────────── 排序与移动 ─────────────────────────

/**
 * 在同一目录内调整顺序（拖拽排序）。
 *
 * 正常只重命名 1 个文件；间隔用尽时才整段重排，此时 `renumbered` 为 true，
 * 界面应当提示作者「正在整理序号」，因为那一瞬间会动很多文件。
 */
export async function reorderInDir(
  backend: StorageBackend,
  dir: string,
  fromIndex: number,
  toIndex: number,
): Promise<{ renamed: number; renumbered: boolean }> {
  const entries = await safeList(backend, dir)
  const names = entries.filter((e) => isMd(e.name) || e.isDirectory).map((e) => e.name)
  const result = moveItem(toOrderedItems(names), fromIndex, toIndex)

  await applyRenames(backend, dir, result.renames)
  return { renamed: result.renames.length, renumbered: result.renumbered }
}

/** 把章节移到另一个卷里，放在末尾 */
export async function moveChapterToDir(
  backend: StorageBackend,
  path: string,
  targetDir: string,
): Promise<{ path: string }> {
  const fileName = path.slice(path.lastIndexOf('/') + 1)
  const { rest } = parseName(fileName)

  const entries = await safeList(backend, targetDir)
  const orders = entries.map((e) => parseName(e.name).order).filter((o): o is number => o !== null)
  const order = nextOrder(orders) ?? (orders.length + 1) * ORDER_STEP

  const nextPath = joinPath(targetDir, buildName(order, rest))
  if (nextPath === path) return { path }
  await backend.rename(path, nextPath)
  return { path: nextPath }
}

/**
 * 执行一批重命名。
 *
 * ⚠️ 顺序有讲究：整段重排时，新名字可能撞上还没改名的旧文件
 * （比如把 0011 改成 0020，而 0020 此刻还在）。所以先全部改成临时名，再改成目标名。
 */
async function applyRenames(
  backend: StorageBackend,
  dir: string,
  renames: readonly Rename[],
): Promise<void> {
  if (renames.length === 0) return
  if (renames.length === 1) {
    const r = renames[0] as Rename
    await backend.rename(joinPath(dir, r.from), joinPath(dir, r.to))
    return
  }

  const tmpSuffix = '.~bugu-reorder'
  for (const r of renames) {
    await backend.rename(joinPath(dir, r.from), joinPath(dir, r.from + tmpSuffix))
  }
  for (const r of renames) {
    await backend.rename(joinPath(dir, r.from + tmpSuffix), joinPath(dir, r.to))
  }
}

// ───────────────────────── 设定集分类 ─────────────────────────

/** 新建设定分类（文件夹），并顺手放一份默认模板 */
export async function createSettingCategory(
  backend: StorageBackend,
  bookRoot: string,
  name: string,
): Promise<{ path: string; templatePath: string }> {
  const path = joinPath(bookRoot, DIRS.settings, sanitizeFileName(name))
  await backend.mkdir(path)
  const templatePath = await ensureTemplate(backend, path)
  return { path, templatePath }
}

// 局部小工具（与文件上方的同名函数保持一致）
function baseNameOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i === -1 ? p : p.slice(i + 1)
}
function stripOrderPrefixLocal(name: string): string {
  return name.replace(/^\d{4}-/, '')
}

// ───────────────────────── 作品级操作 ─────────────────────────

/** 改 book.yaml 里的字段（改分类、改书名显示、设封面都走它） */
export async function updateBookMeta(
  backend: StorageBackend,
  bookRoot: string,
  patch: Partial<BookMeta>,
): Promise<BookMeta> {
  const metaPath = joinPath(bookRoot, BOOK_META_FILE)
  const current = parseBookMeta(await backend.read(metaPath), {
    folderName: bookRoot.split('/').pop() ?? '',
  })
  const next: BookMeta = { ...current, ...patch }
  await backend.write(metaPath, serializeBookMeta(next))
  return next
}

/**
 * 重命名作品：改文件夹名，同时改 book.yaml 里的标题。
 *
 * 与文档改名一样，**先写内容再改名** —— 反过来的话改名成功而写失败，
 * 文件夹名和书名就对不上了。
 */
export async function renameBook(
  backend: StorageBackend,
  libraryRoot: string,
  bookRoot: string,
  newTitle: string,
): Promise<{ rootPath: string; meta: BookMeta }> {
  const meta = await updateBookMeta(backend, bookRoot, { title: newTitle })
  const nextRoot = joinPath(libraryRoot, sanitizeFileName(newTitle))
  if (nextRoot !== bookRoot) {
    if ((await backend.stat(nextRoot)) !== null) {
      throw new Error(`已经有一个叫「${sanitizeFileName(newTitle)}」的文件夹了`)
    }
    await backend.rename(bookRoot, nextRoot)
  }
  return { rootPath: nextRoot, meta }
}

/**
 * 删除作品 = 整个文件夹移进库根目录的回收站，**绝不硬删**。
 *
 * 一本书是几十上百万字的心血，这里必须比删单章更保守。
 */
export async function trashBook(
  backend: StorageBackend,
  libraryRoot: string,
  bookRoot: string,
  now = Date.now(),
): Promise<{ trashPath: string }> {
  const name = bookRoot.split('/').pop() ?? bookRoot
  let trashPath = joinPath(libraryRoot, DIRS.trash, name)

  if ((await backend.stat(trashPath)) !== null) {
    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19)
    trashPath = `${trashPath} (${stamp})`
  }

  await backend.rename(bookRoot, trashPath)
  return { trashPath }
}

/** 封面文件名固定，换封面就是覆盖它 */
export const COVER_FILE = 'cover'

/**
 * 设置封面：把图片写进作品目录，并把文件名记进 book.yaml。
 *
 * 保留原扩展名（jpg/png/webp 都行），因为不同格式的解码交给系统。
 */
export async function setBookCover(
  backend: StorageBackend,
  bookRoot: string,
  data: Uint8Array,
  ext: string,
): Promise<{ cover: string }> {
  const clean = ext.replace(/^\./, '').toLowerCase() || 'jpg'
  const fileName = `${COVER_FILE}.${clean}`

  // 换格式时要把旧的删掉，否则目录里会堆着 cover.jpg 和 cover.png
  for (const old of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
    if (old === clean) continue
    const p = joinPath(bookRoot, `${COVER_FILE}.${old}`)
    if ((await backend.stat(p)) !== null) await backend.delete(p)
  }

  await backend.writeBinary(joinPath(bookRoot, fileName), data)
  await updateBookMeta(backend, bookRoot, { cover: fileName })
  return { cover: fileName }
}

/** 移除封面 */
export async function clearBookCover(backend: StorageBackend, bookRoot: string): Promise<void> {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
    const p = joinPath(bookRoot, `${COVER_FILE}.${ext}`)
    if ((await backend.stat(p)) !== null) await backend.delete(p)
  }
  const metaPath = joinPath(bookRoot, BOOK_META_FILE)
  const current = parseBookMeta(await backend.read(metaPath))
  delete current.cover
  await backend.write(metaPath, serializeBookMeta(current))
}

/**
 * 删除设定分类（整个文件夹）。
 *
 * 分类下的便利贴会跟着进回收站 —— 这是作者的预期：
 * 「删掉『配角』这一类」意味着连里面的卡片一起。
 */
export async function trashSettingCategory(
  backend: StorageBackend,
  bookRoot: string,
  categoryPath: string,
  now = Date.now(),
): Promise<{ trashPath: string }> {
  const rel = categoryPath.startsWith(`${bookRoot}/`)
    ? categoryPath.slice(bookRoot.length + 1)
    : categoryPath
  let trashPath = joinPath(bookRoot, DIRS.trash, rel)

  if ((await backend.stat(trashPath)) !== null) {
    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19)
    trashPath = `${trashPath} (${stamp})`
  }

  await backend.rename(categoryPath, trashPath)
  return { trashPath }
}

// ───────────────────────── 便利贴布局 ─────────────────────────

export const STICKY_LAYOUT_VERSION = 1

/**
 * 读某台设备在某本书里的便利贴摆放。
 *
 * 文件不存在或内容坏了都返回空布局 —— 布局是纯粹的界面状态，
 * 坏了大不了重新拖一次，绝不该拦住作者打开作品。
 */
export async function loadStickyLayout(
  backend: StorageBackend,
  bookRoot: string,
  deviceId: string,
): Promise<StickyLayout> {
  const path = joinPath(bookRoot, metaPaths.workspace(deviceId))
  try {
    const parsed = JSON.parse(await backend.read(path)) as StickyLayout
    if (!Array.isArray(parsed?.pinned)) return { schemaVersion: STICKY_LAYOUT_VERSION, pinned: [] }
    return {
      schemaVersion: STICKY_LAYOUT_VERSION,
      pinned: parsed.pinned.filter(
        (p): p is PinnedSticky =>
          typeof p?.cardId === 'string' && typeof p?.x === 'number' && typeof p?.y === 'number',
      ),
    }
  } catch {
    return { schemaVersion: STICKY_LAYOUT_VERSION, pinned: [] }
  }
}

export async function saveStickyLayout(
  backend: StorageBackend,
  bookRoot: string,
  deviceId: string,
  layout: StickyLayout,
): Promise<void> {
  const path = joinPath(bookRoot, metaPaths.workspace(deviceId))
  await backend.write(path, JSON.stringify({ ...layout, schemaVersion: STICKY_LAYOUT_VERSION }, null, 2))
}

/** 某张便利贴在当前文档下该不该显示（`book` 全书常驻 / `doc:{id}` 仅该文档） */
export function isStickyVisible(scope: string, currentDocId: string | null): boolean {
  if (scope === 'book') return true
  if (!currentDocId) return false
  return scope === `doc:${currentDocId}`
}

// ───────────────────────── 便利贴内容 ─────────────────────────

export interface LoadedSticky extends StickyCard {
  /** 便利贴文档的路径 */
  path: string
  /** 卡片正面（浮出内容拼接后的纯文本） */
  face: string
  /** 语法提示：写了 @ 却不会生效的行 */
  lints: FloatLint[]
}

/** 读一张便利贴（解析 @ 语法，产出卡片正面） */
export async function readSticky(
  backend: StorageBackend,
  path: string,
  category: string | null = null,
): Promise<LoadedSticky> {
  const doc = await readDoc(backend, path, { defaultType: 'setting' })
  const fileName = path.slice(path.lastIndexOf('/') + 1)
  const card = parseStickyCard(doc.body, { docId: doc.meta.id, fileName, category })
  return {
    ...card,
    path,
    face: renderCardFace(card.floats),
    lints: lintFloats(doc.body),
  }
}

/** 读整本书的全部便利贴。拖拽面板与双链解析都要用 */
export async function readAllStickies(
  backend: StorageBackend,
  tree: BookTree,
): Promise<LoadedSticky[]> {
  const jobs: Array<Promise<LoadedSticky | null>> = []
  const push = (p: string, category: string | null) =>
    jobs.push(readSticky(backend, p, category).catch(() => null))

  for (const cat of tree.settings) for (const card of cat.cards) push(card.path, cat.name)
  for (const card of tree.looseSettings) push(card.path, null)

  return (await Promise.all(jobs)).filter((x): x is LoadedSticky => x !== null)
}
