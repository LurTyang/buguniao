/**
 * 存储后端抽象。
 *
 * 规范：更新文档/02-技术架构.md §3.5
 *
 * 一期有两个实现：
 *   - `LocalFsBackend`（桌面端）—— 直接读写坚果云本地同步文件夹
 *   - `WebDavBackend`（安卓端）—— 直接连坚果云 WebDAV
 *
 * 抽象出这一层是为了将来换 Syncthing / OneDrive / 自建服务器时
 * 不用动上层任何代码。实现放在各自的平台包里，core 只定义契约。
 */

export interface FileEntry {
  /** 相对作品根目录的路径，一律用 `/` 分隔 */
  path: string
  name: string
  isDirectory: boolean
  size: number
  /** 毫秒时间戳 */
  mtime: number
  /** WebDAV 的 etag，用于增量同步判断；本地文件系统没有则为 undefined */
  etag?: string
}

export interface StorageBackend {
  /** 列出目录内容（不递归） */
  list(path: string): Promise<FileEntry[]>
  /** 读文本文件（UTF-8） */
  read(path: string): Promise<string>
  /** 写文本文件（UTF-8）。父目录不存在时应自动创建 */
  write(path: string, content: string): Promise<void>
  /** 追加一行到 jsonl 文件（伏笔、历史、统计都靠它） */
  append(path: string, line: string): Promise<void>
  /** 取单个文件信息；不存在返回 null */
  stat(path: string): Promise<FileEntry | null>
  /** 删除文件或空目录 */
  delete(path: string): Promise<void>
  /** 重命名 / 移动（拖拽排序靠它） */
  rename(from: string, to: string): Promise<void>
  /** 创建目录（含多级） */
  mkdir(path: string): Promise<void>
  /** 读二进制（封面图片） */
  readBinary(path: string): Promise<Uint8Array>
  /** 写二进制 */
  writeBinary(path: string, data: Uint8Array): Promise<void>
}

// ───────────────────────── 路径工具 ─────────────────────────
//
// core 里不能用 Node 的 path 模块（那是平台依赖），所以自带一套。
// 约定：内部一律用 `/` 分隔，由各平台后端在边界上转换。

/** 拼接路径片段，规范化多余的斜杠 */
export function joinPath(...parts: string[]): string {
  return parts
    .filter((p) => p !== '')
    .join('/')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '')
}

/** 取父目录；根目录返回空串 */
export function dirName(path: string): string {
  const i = path.lastIndexOf('/')
  return i <= 0 ? '' : path.slice(0, i)
}

/** 取文件名 */
export function baseName(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}

/** 取扩展名（含点）；无扩展名返回空串 */
export function extName(path: string): string {
  const base = baseName(path)
  const i = base.lastIndexOf('.')
  return i <= 0 ? '' : base.slice(i)
}

/** Windows 反斜杠转成内部约定的正斜杠 */
export function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/')
}

// ───────────────────────── 作品目录约定 ─────────────────────────

export const DIRS = {
  text: '正文',
  outline: '大纲',
  settings: '设定集',
  ideas: '灵感',
  meta: '.bugu',
  trash: '_回收站',
  templates: '_模板',
  archive: '_归档',
  ideaBox: '_灵感箱',
} as const

export const BOOK_META_FILE = 'book.yaml'

/** `.bugu/` 下的子路径 */
export const metaPaths = {
  foreshadow: (deviceId: string) => joinPath(DIRS.meta, 'foreshadow', `${deviceId}.jsonl`),
  foreshadowDir: () => joinPath(DIRS.meta, 'foreshadow'),
  history: (docId: string, deviceId: string) => joinPath(DIRS.meta, 'history', docId, `${deviceId}.jsonl`),
  historyDir: (docId?: string) =>
    docId === undefined ? joinPath(DIRS.meta, 'history') : joinPath(DIRS.meta, 'history', docId),
  stats: (deviceId: string) => joinPath(DIRS.meta, 'stats', `${deviceId}.jsonl`),
  statsDir: () => joinPath(DIRS.meta, 'stats'),
  workspace: (deviceId: string) => joinPath(DIRS.meta, 'workspace', `${deviceId}.json`),
}

/** 以 `_` 开头的目录是软件的内部目录，不参与便利贴扫描与目录树显示 */
export function isInternalDir(name: string): boolean {
  return name.startsWith('_') || name === DIRS.meta
}

/**
 * 坚果云冲突副本的文件名形如：
 *   `第一章 坠楼 (冲突文件 2026-08-25 14-30 台式机).md`
 *
 * 设计上不该产生冲突（手机只增不改），但仍需兜底识别并提示作者手动处理。
 * 见 02-技术架构 §3.4。
 */
export function isConflictCopy(fileName: string): boolean {
  return /[(（]\s*冲突(文件|副本)?\s*[^)）]*[)）]/.test(fileName) || /\bconflicted copy\b/i.test(fileName)
}

/** 灵感碎片文件名：`20260825-143012-phone.md` */
export function ideaFileName(date: Date, deviceTag: string): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  const d = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`
  const t = `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  return `${d}-${t}-${deviceTag}.md`
}
