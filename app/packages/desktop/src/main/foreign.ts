/**
 * 从别的写作软件搬家 —— 碰文件系统的那一半。
 *
 * 规范：更新文档/05-功能模块详述.md §15
 *
 * 解析都在 `core/foreign` 里（纯逻辑、有测试），这里只负责
 * 「哪些文件要读」「读出来交给谁」。
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  parseScrivx,
  planFolderImport,
  planScrivenerImport,
  type FolderFile,
  type ForeignPlan,
} from '@bugu/core'
import { decodeText, detectEncoding } from './transfer.js'

/** 一次最多读这么多文件。挑错了目录（比如整个 D 盘）不能让软件卡死 */
const MAX_FILES = 3000

/** 这些目录一律不进去 —— 里面不会有作者的稿子，只会拖慢扫描 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '回收站',
  '.bugu',
  'Files', // Scrivener 的内部目录，用文件夹方式导时不要
  'Settings',
  'Snapshots',
])

/**
 * 读一个文件的文字内容。
 *
 * **必须走编码检测** —— 国内的 txt 很多是 GBK，
 * 当成 UTF-8 读进来就是一整本乱码，而且看着像导入成功了。
 */
async function readTextFile(file: string): Promise<string> {
  const buf = await fs.readFile(file)
  return decodeText(buf, detectEncoding(buf))
}

async function walk(dir: string, base: string, out: FolderFile[]): Promise<void> {
  if (out.length >= MAX_FILES) return
  let entries: Array<{ name: string; isDirectory(): boolean }>
  try {
    entries = await fs.readdir(dir, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return // 权限不够之类，跳过这个目录就是了
  }

  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name, 'zh'))) {
    if (out.length >= MAX_FILES) return
    if (e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      await walk(full, base, out)
    } else if (/\.(txt|md|markdown)$/i.test(e.name)) {
      try {
        out.push({
          relPath: path.relative(base, full).split(path.sep).join('/'),
          content: await readTextFile(full),
        })
      } catch {
        // 单个文件读不了不该让整次导入失败
      }
    }
  }
}

/** 扫一个文件夹，当成一本书 */
export async function planFolder(dir: string): Promise<ForeignPlan> {
  const files: FolderFile[] = []
  await walk(dir, dir, files)
  return planFolderImport(files, dir)
}

/**
 * Scrivener 项目。
 *
 * `.scriv` 是个文件夹：`*.scrivx` 是目录树，正文在
 * `Files/Data/<UUID>/content.rtf`（新版）或 `Files/Docs/<id>.rtf`（旧版）。
 * 两种都试，哪个有读哪个。
 */
export async function planScrivener(projectDir: string): Promise<ForeignPlan> {
  const entries = await fs.readdir(projectDir)
  const scrivx = entries.find((e) => e.toLowerCase().endsWith('.scrivx'))
  if (!scrivx) {
    throw new Error('这个文件夹里没有 .scrivx 文件，不像是一个 Scrivener 项目。')
  }

  const xml = await readTextFile(path.join(projectDir, scrivx))
  const items = parseScrivx(xml)

  // 先把所有正文一次读进来 —— core 那边的 readText 是同步的
  const texts = new Map<string, string>()
  for (const it of items) {
    for (const rel of [
      path.join('Files', 'Data', it.id, 'content.rtf'),
      path.join('Files', 'Docs', `${it.id}.rtf`),
      path.join('Files', 'Data', it.id, 'content.txt'),
      path.join('Files', 'Docs', `${it.id}.txt`),
    ]) {
      try {
        texts.set(it.id, await readTextFile(path.join(projectDir, rel)))
        break
      } catch {
        // 换下一种路径接着试
      }
    }
  }

  return planScrivenerImport(items, (id) => texts.get(id) ?? null, projectDir)
}
