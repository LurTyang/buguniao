/**
 * 内存版存储后端。
 *
 * 用途有两个，都很重要：
 *   1. 让仓库层（repository）的逻辑能在 core 里**纯粹地**测试，不碰真实文件系统
 *   2. 开发移动端界面时先拿它顶着，不用先把 WebDAV 调通
 *
 * 行为刻意向真实文件系统看齐：读不存在的文件抛错、写文件自动建父目录、
 * 删非空目录抛错。测试里能过的逻辑，换成真后端也该能过。
 */

import type { FileEntry, StorageBackend } from './index.js'
import { baseName, dirName, joinPath, normalizeSlashes } from './index.js'

export class NotFoundError extends Error {
  constructor(path: string) {
    super(`路径不存在：${path}`)
    this.name = 'NotFoundError'
  }
}

interface MemFile {
  content: Uint8Array
  mtime: number
  etag: string
}

export interface MemoryBackendOptions {
  /** 初始文件内容，键为路径 */
  files?: Record<string, string>
  /** 可注入的时钟，便于测试 mtime */
  now?: () => number
}

export class MemoryBackend implements StorageBackend {
  private files = new Map<string, MemFile>()
  private dirs = new Set<string>()
  private clock: () => number
  private etagSeq = 0

  constructor(opts: MemoryBackendOptions = {}) {
    this.clock = opts.now ?? (() => 0)
    for (const [path, content] of Object.entries(opts.files ?? {})) {
      this.writeSync(path, encode(content))
    }
  }

  // ── 读 ──

  async list(path: string): Promise<FileEntry[]> {
    const dir = norm(path)
    const prefix = dir === '' ? '' : `${dir}/`
    const seen = new Map<string, FileEntry>()

    const consider = (fullPath: string, isDirectory: boolean) => {
      if (!fullPath.startsWith(prefix)) return
      const rest = fullPath.slice(prefix.length)
      if (rest === '') return
      const slash = rest.indexOf('/')
      if (slash === -1) {
        if (!isDirectory) {
          const f = this.files.get(fullPath) as MemFile
          seen.set(fullPath, {
            path: fullPath,
            name: rest,
            isDirectory: false,
            size: f.content.length,
            mtime: f.mtime,
            etag: f.etag,
          })
        } else if (!seen.has(fullPath)) {
          seen.set(fullPath, { path: fullPath, name: rest, isDirectory: true, size: 0, mtime: 0 })
        }
      } else {
        // 隐含的中间目录
        const childDir = prefix + rest.slice(0, slash)
        if (!seen.has(childDir)) {
          seen.set(childDir, {
            path: childDir,
            name: rest.slice(0, slash),
            isDirectory: true,
            size: 0,
            mtime: 0,
          })
        }
      }
    }

    for (const p of this.files.keys()) consider(p, false)
    for (const d of this.dirs) consider(d, true)

    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }

  async read(path: string): Promise<string> {
    const f = this.files.get(norm(path))
    if (!f) throw new NotFoundError(path)
    return decode(f.content)
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const f = this.files.get(norm(path))
    if (!f) throw new NotFoundError(path)
    return f.content.slice()
  }

  async stat(path: string): Promise<FileEntry | null> {
    const p = norm(path)
    const f = this.files.get(p)
    if (f) {
      return { path: p, name: baseName(p), isDirectory: false, size: f.content.length, mtime: f.mtime, etag: f.etag }
    }
    if (this.hasDir(p)) {
      return { path: p, name: baseName(p), isDirectory: true, size: 0, mtime: 0 }
    }
    return null
  }

  // ── 写 ──

  async write(path: string, content: string): Promise<void> {
    this.writeSync(path, encode(content))
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    this.writeSync(path, data.slice())
  }

  async append(path: string, line: string): Promise<void> {
    const p = norm(path)
    const existing = this.files.get(p)
    const prev = existing ? decode(existing.content) : ''
    const sep = prev === '' || prev.endsWith('\n') ? '' : '\n'
    this.writeSync(p, encode(`${prev}${sep}${line}\n`))
  }

  async delete(path: string): Promise<void> {
    const p = norm(path)
    if (this.files.delete(p)) return
    if (this.hasDir(p)) {
      const children = await this.list(p)
      if (children.length > 0) throw new Error(`目录非空，无法删除：${path}`)
      this.dirs.delete(p)
      return
    }
    throw new NotFoundError(path)
  }

  async rename(from: string, to: string): Promise<void> {
    const a = norm(from)
    const b = norm(to)
    if (a === b) return

    const f = this.files.get(a)
    if (f) {
      this.files.delete(a)
      this.files.set(b, { ...f, mtime: this.clock(), etag: this.nextEtag() })
      this.ensureParents(b)
      return
    }

    if (!this.hasDir(a)) throw new NotFoundError(from)

    // 目录改名：把所有子路径一起搬过去
    const prefix = `${a}/`
    for (const [p, file] of [...this.files]) {
      if (p.startsWith(prefix)) {
        this.files.delete(p)
        this.files.set(b + p.slice(a.length), file)
      }
    }
    for (const d of [...this.dirs]) {
      if (d === a || d.startsWith(prefix)) {
        this.dirs.delete(d)
        this.dirs.add(b + d.slice(a.length))
      }
    }
    this.ensureParents(joinPath(b, 'x'))
  }

  async mkdir(path: string): Promise<void> {
    const p = norm(path)
    if (p === '') return
    this.dirs.add(p)
    this.ensureParents(joinPath(p, 'x'))
  }

  // ── 测试辅助 ──

  /** 当前所有文件路径，已排序。断言用 */
  snapshotPaths(): string[] {
    return [...this.files.keys()].sort()
  }

  /** 直接取文件内容，不走 async。断言用 */
  peek(path: string): string | null {
    const f = this.files.get(norm(path))
    return f ? decode(f.content) : null
  }

  // ── 内部 ──

  private writeSync(path: string, content: Uint8Array): void {
    const p = norm(path)
    this.files.set(p, { content, mtime: this.clock(), etag: this.nextEtag() })
    this.ensureParents(p)
  }

  private ensureParents(path: string): void {
    let d = dirName(path)
    while (d !== '') {
      this.dirs.add(d)
      d = dirName(d)
    }
  }

  private hasDir(p: string): boolean {
    if (p === '') return true
    if (this.dirs.has(p)) return true
    const prefix = `${p}/`
    for (const f of this.files.keys()) if (f.startsWith(prefix)) return true
    return false
  }

  private nextEtag(): string {
    return `e${++this.etagSeq}`
  }
}

function norm(path: string): string {
  return normalizeSlashes(path).replace(/^\/+/, '').replace(/\/+$/, '')
}

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function decode(b: Uint8Array): string {
  return new TextDecoder().decode(b)
}
