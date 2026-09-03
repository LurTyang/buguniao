/**
 * 自己导进来的字体。
 *
 * 规范：更新文档/10-0.4规划.md §3.4
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么是「导入」而不是「内置」】
 *
 * 一款中文字库动辄十几 MB，内置三款包就从 90 MB 涨到 150 MB，
 * 而绝大多数人只用其中一款。更麻烦的是版权：能自由分发的中文字体很少，
 * 内置就意味着我们要为每一款的授权负责。
 *
 * 导入把这两件事同时解决了：**用的是他自己机器上的字体文件**，
 * 我们不分发、不掺和版权，包也不涨。
 *
 * 【为什么复制进来，不记路径】
 *
 * 记路径的话，他哪天清理下载文件夹，字体就没了 —— 而界面上只会
 * 莫名其妙地变回默认字体，他根本不会联想到是那次清理。
 * 复制一份进 `userData/fonts/`，从此跟那个原文件没关系。
 * ─────────────────────────────────────────────────────────────
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'

/** 认这几种。ttc 是集合字体，浏览器能认，但里头有好几款、只会用第一款 */
export const FONT_EXTS = ['ttf', 'otf', 'woff', 'woff2', 'ttc']

/**
 * 字体文件多大算太大。
 *
 * 中文字库十几 MB 很正常，思源黑体那种全字重的能到 20 MB。
 * 给 40 MB 是为了拦住「手滑选了个压缩包」，不是为了拦正经字体。
 */
const MAX_FONT_BYTES = 40 * 1024 * 1024

const fontDir = (): string => path.join(app.getPath('userData'), 'fonts')

/** CSS 里能不能安全地用这个名字。引号、反斜杠、大括号会把样式表整段搞坏 */
function safeName(raw: string): string {
  return raw.replace(/["'\{}();]/g, '').trim()
}

/**
 * 从文件名猜一个字体名。
 *
 * **不去解析字体文件里的名称表** —— 那要一个字体解析库，
 * 而它换来的只是一个更好看的默认名。作者看得见这个名字、也能改，
 * 猜错的成本是零；引一个库进来的成本不是零。
 */
export function familyFromFile(file: string): string {
  const base = path.basename(file).replace(/\.[^.]+$/, '')
  return safeName(base) || '自选字体'
}

/** 重名了就加个后缀，别悄悄覆盖掉他上次导的那一款 */
export function uniqueFamily(want: string, taken: Readonly<Record<string, string>>): string {
  if (!(want in taken)) return want
  for (let i = 2; i < 100; i++) {
    const t = `${want} ${i}`
    if (!(t in taken)) return t
  }
  return `${want} ${Date.now()}`
}

export interface ImportedFont {
  /** 字体名，CSS 里用它。作者看得见 */
  family: string
  /** 存在 userData/fonts/ 下的文件名 */
  file: string
}

/**
 * 把一个字体文件收进来。
 *
 * 返回新的字体表。**失败要说清是哪一种失败** ——
 * 只说「导入失败」的话，他不知道是文件太大、格式不对，还是路径有问题。
 */
export async function importFont(
  src: string,
  current: Readonly<Record<string, string>>,
): Promise<{ family: string; fonts: Record<string, string> }> {
  const ext = path.extname(src).replace('.', '').toLowerCase()
  if (!FONT_EXTS.includes(ext)) {
    throw new Error(`「.${ext}」不是字体文件。认得的是：${FONT_EXTS.join('、')}`)
  }
  const stat = await fsp.stat(src)
  if (stat.size > MAX_FONT_BYTES) {
    throw new Error(
      `这个文件有 ${Math.round(stat.size / 1024 / 1024)} MB，太大了 —— 确认选的是字体而不是压缩包？`,
    )
  }
  if (stat.size === 0) throw new Error('这个文件是空的。')

  const family = uniqueFamily(familyFromFile(src), current)
  // 存盘用的文件名带一个序号，避免不同目录下的同名文件互相覆盖
  const file = `${Object.keys(current).length + 1}-${path.basename(src)}`

  const dir = fontDir()
  await fsp.mkdir(dir, { recursive: true })
  await fsp.copyFile(src, path.join(dir, file))

  return { family, fonts: { ...current, [family]: file } }
}

/** 读一款字体的字节，拼成能直接写进 `@font-face` 的 data URL */
export async function fontDataUrl(family: string, fonts: Readonly<Record<string, string>>): Promise<string> {
  const file = fonts[family]
  if (!file) return ''
  const ext = path.extname(file).replace('.', '').toLowerCase()
  const mime =
    ext === 'woff2' ? 'font/woff2' : ext === 'woff' ? 'font/woff' : ext === 'otf' ? 'font/otf' : 'font/ttf'
  try {
    const buf = await fsp.readFile(path.join(fontDir(), file))
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    // 文件被人从 userData 里删了。当没这款字体，别让界面崩
    return ''
  }
}

/** 不要了。**文件也删掉** —— 留着只是白占地方，他已经说了不要 */
export async function removeFont(
  family: string,
  fonts: Readonly<Record<string, string>>,
): Promise<Record<string, string>> {
  const file = fonts[family]
  const next = { ...fonts }
  delete next[family]
  if (file) await fsp.rm(path.join(fontDir(), file), { force: true })
  return next
}
