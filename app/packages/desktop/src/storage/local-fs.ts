/**
 * 本地文件系统存储后端（桌面端）。
 *
 * 规范：更新文档/02-技术架构.md §3.1
 *
 * 桌面端**不实现任何同步逻辑** —— 作品文件夹放在坚果云本地同步文件夹里，
 * 由坚果云客户端负责上传下载。这里就是普通的本地文件读写。
 *
 * 两个必须做对的地方：
 *   1. **路径分隔符**：core 内部一律用 `/`，Windows 的 `\` 只在本层边界转换
 *   2. **原子写入**：先写临时文件再 rename，避免写到一半断电/崩溃导致稿子只剩半截
 */

import { constants, type Dirent } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { FileEntry, StorageBackend } from '@bugu/core'
import { normalizeSlashes } from '@bugu/core'

/** 临时文件名用的进程内单调计数器，保证同一毫秒内的多次写入不撞名 */
let tmpSeq = 0

export class LocalFsBackend implements StorageBackend {
  /**
   * @param root 绝对路径，通常是坚果云同步文件夹里的「不咕鸟」目录
   */
  constructor(private readonly root: string) {}

  // ── 读 ──

  async list(relPath: string): Promise<FileEntry[]> {
    const abs = this.abs(relPath)
    let dirents: Dirent[]
    try {
      dirents = await fs.readdir(abs, { withFileTypes: true })
    } catch (e) {
      if (isNotFound(e)) return []
      throw e
    }

    const out: FileEntry[] = []
    for (const d of dirents) {
      // 跳过操作系统自己塞的东西，它们不是作者的内容
      if (d.name === '.DS_Store' || d.name === 'Thumbs.db' || d.name === 'desktop.ini') continue

      const childRel = joinRel(relPath, d.name)
      const childAbs = path.join(abs, d.name)
      const isDirectory = d.isDirectory()
      let size = 0
      let mtime = 0
      try {
        const st = await fs.stat(childAbs)
        size = st.size
        mtime = st.mtimeMs
      } catch {
        // 列目录到取 stat 之间文件被删了，跳过它而不是让整次列举失败
        continue
      }
      out.push({ path: childRel, name: d.name, isDirectory, size, mtime })
    }

    return out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  }

  async read(relPath: string): Promise<string> {
    return stripBom(await fs.readFile(this.abs(relPath), 'utf8'))
  }

  async readBinary(relPath: string): Promise<Uint8Array> {
    const buf = await fs.readFile(this.abs(relPath))
    return new Uint8Array(buf)
  }

  async stat(relPath: string): Promise<FileEntry | null> {
    const abs = this.abs(relPath)
    try {
      const st = await fs.stat(abs)
      return {
        path: normalizeSlashes(relPath),
        name: path.basename(abs),
        isDirectory: st.isDirectory(),
        size: st.size,
        mtime: st.mtimeMs,
      }
    } catch (e) {
      if (isNotFound(e)) return null
      throw e
    }
  }

  // ── 写 ──

  async write(relPath: string, content: string): Promise<void> {
    await this.atomicWrite(relPath, Buffer.from(content, 'utf8'))
  }

  async writeBinary(relPath: string, data: Uint8Array): Promise<void> {
    await this.atomicWrite(relPath, Buffer.from(data))
  }

  /**
   * 追加一行。
   *
   * 这里**刻意不用原子写** —— 追加是 O(1) 的，而原子写要先把整个文件读出来重写，
   * 历史文件长到几十 MB 时每次保存都重写一遍是不可接受的。
   * 追加操作本身在崩溃时最多丢最后一行，可以接受（下次保存会补上）。
   */
  async append(relPath: string, line: string): Promise<void> {
    const abs = this.abs(relPath)
    await fs.mkdir(path.dirname(abs), { recursive: true })

    // 确保上一行末尾有换行，否则两条记录会粘在一起变成坏行
    let needsNewline = false
    try {
      const st = await fs.stat(abs)
      if (st.size > 0) {
        const fh = await fs.open(abs, 'r')
        try {
          const buf = Buffer.alloc(1)
          await fh.read(buf, 0, 1, st.size - 1)
          needsNewline = buf[0] !== 0x0a
        } finally {
          await fh.close()
        }
      }
    } catch (e) {
      if (!isNotFound(e)) throw e
    }

    await fs.appendFile(abs, `${needsNewline ? '\n' : ''}${line}\n`, 'utf8')
  }

  async delete(relPath: string): Promise<void> {
    const abs = this.abs(relPath)
    const st = await fs.stat(abs)
    if (st.isDirectory()) await fs.rmdir(abs)
    else await fs.unlink(abs)
  }

  async rename(from: string, to: string): Promise<void> {
    const absTo = this.abs(to)
    await fs.mkdir(path.dirname(absTo), { recursive: true })
    await fs.rename(this.abs(from), absTo)
  }

  async mkdir(relPath: string): Promise<void> {
    await fs.mkdir(this.abs(relPath), { recursive: true })
  }

  // ── 内部 ──

  /**
   * 原子写入：先写同目录下的临时文件，再 rename 覆盖。
   *
   * rename 在同一文件系统内是原子的，所以任何时刻磁盘上的目标文件
   * 要么是完整的旧内容，要么是完整的新内容，不会出现半截稿子。
   */
  private async atomicWrite(relPath: string, data: Buffer): Promise<void> {
    const abs = this.abs(relPath)
    await fs.mkdir(path.dirname(abs), { recursive: true })

    // 临时文件名必须**进程内唯一**：pid + 毫秒是不够的，
    // 自动保存、历史写入、统计写入完全可能落在同一毫秒里，撞名会让第二次写入直接失败。
    const tmp = `${abs}.${process.pid}.${(tmpSeq++).toString(36)}.${Math.random().toString(36).slice(2, 8)}.tmp`
    try {
      await fs.writeFile(tmp, data, { flag: 'wx' })
      await renameWithRetry(tmp, abs)
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => {})
      throw e
    }
  }

  /**
   * 相对路径转绝对路径，并**拦截越界访问**。
   *
   * `..` 之类的路径必须挡在这里 —— 文件名来自磁盘上的目录内容，
   * 而磁盘内容可能被同步下来的东西污染，不能无条件信任。
   */
  private abs(relPath: string): string {
    const clean = normalizeSlashes(relPath).replace(/^\/+/, '')
    const resolved = path.resolve(this.root, clean)
    const rootResolved = path.resolve(this.root)
    if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
      throw new Error(`路径越界，拒绝访问：${relPath}`)
    }
    return resolved
  }
}

function isNotFound(e: unknown): boolean {
  return errCode(e) === 'ENOENT'
}

function errCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null ? (e as NodeJS.ErrnoException).code : undefined
}

/**
 * Windows 上 rename 覆盖已存在的文件会**偶发失败**：
 * 杀毒软件、Windows 搜索索引器、坚果云客户端，甚至我们自己的另一个读取操作，
 * 都可能在那一瞬间持有目标文件的句柄，于是抛 EPERM / EACCES / EBUSY。
 *
 * 对写作软件来说，一次自动保存因为这个静默失败是不可接受的 —— 作者会丢字。
 * 所以退避重试几次。总等待约 350ms，远低于人能察觉的程度，
 * 而占用通常在几十毫秒内就结束了。
 */
const RENAME_RETRY_DELAYS = [10, 20, 40, 80, 200]

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to)
      return
    } catch (e) {
      const code = errCode(e)
      const retryable = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
      const delay = RENAME_RETRY_DELAYS[attempt]
      if (!retryable || delay === undefined) throw e
      await new Promise((r) => setTimeout(r, delay))
    }
  }
}

/** 记事本保存的 UTF-8 文件常带 BOM，读进来要去掉，否则 front-matter 解析会错位 */
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

/** 判断目录是否可读写（配置向导用） */
export async function isWritableDir(dir: string): Promise<boolean> {
  try {
    const st = await fs.stat(dir)
    if (!st.isDirectory()) return false
    await fs.access(dir, constants.R_OK | constants.W_OK)
    return true
  } catch {
    return false
  }
}

function joinRel(base: string, name: string): string {
  const b = normalizeSlashes(base).replace(/\/+$/, '')
  return b === '' ? name : `${b}/${name}`
}
