/**
 * 打完包之后收拾 release/ 这个文件夹。
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么要这么一个脚本】
 *
 * electron-builder 每打一次就往 release/ 里扔一个新 exe，旧的原样躺着。
 * 打到第七版时那个文件夹长这样：
 *
 *     buguniao-0.2.0-win-x64.exe
 *     buguniao-0.3.0-win-x64.exe
 *     buguniao-0.4.0-win-x64.exe
 *     buguniao-0.5.0-preview.1-win-x64.exe
 *     不咕鸟_测试版v0.1.exe        ← 更早的，名字都不是一套的
 *     ...
 *
 * 七个 89MB 的 exe 摆在一起，每个图标都一样。**于是发错包是迟早的事** ——
 * 更新日志开头那句「代码早改了而你还在用上一个 exe，这种事发生过」
 * 说的就是它。
 *
 * 这个脚本干两件事，都是为了同一个结果：**release/ 根目录下永远只有最新版。**
 *
 *   1. 不属于当前版本的包，**全部挪进 `历史版本/`**（挪，不是删 ——
 *      发出去的东西要能回头对证：有人报 bug 说的是 0.4，你得还有 0.4）
 *   2. 给当前版本的包算 SHA-256，写进 `SHA256SUMS.txt`
 *
 * 【为什么不是「只留最新的，旧的删掉」】
 *
 * 因为这软件没有代码签名证书，用户下下来只能靠校验值确认没被人动过手脚。
 * 而校验值要有意义，**发出去的那个文件必须一直在你手上** ——
 * 否则有人拿着一个 0.4 的 exe 来问「这是不是你发的」，你没法回答。
 * ─────────────────────────────────────────────────────────────
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgDir = path.join(here, '..')
const releaseDir = path.join(pkgDir, 'release')
const atticDir = path.join(releaseDir, '历史版本')

/** 算得上「一个包」的那些文件。别的（说明文档、构建日志）一律不碰 */
const PACKAGE_EXT = new Set(['.exe', '.blockmap', '.dmg', '.appimage', '.zip'])

/**
 * electron-builder 打安装版时的中间产物，一个 50 MB 的壳。
 *
 * 它是给「增量更新」用的，而我们不走增量更新（没有更新服务器）——
 * 留着只会让人在 release/ 里多看见一个不知道该不该发的大文件。
 * 删掉，下次打包会重新生成。
 */
const SCRAP = /\.nsis\.7z$/i

/** 这一份是不是当前版本的产物。认版本号，不认文件名长什么样 */
function isCurrent(name, version) {
  return name.includes(version)
}

async function sha256(file) {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(file)) h.update(chunk)
  return h.digest('hex')
}

/** 给人看的大小 */
function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const pkg = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8'))
const version = pkg.version

const entries = await readdir(releaseDir, { withFileTypes: true })
const packages = entries
  .filter((e) => e.isFile() && PACKAGE_EXT.has(path.extname(e.name).toLowerCase()))
  .map((e) => e.name)

// ── 1. 旧版本挪进阁楼 ───────────────────────────────────────
const old = packages.filter((n) => !isCurrent(n, version))
if (old.length > 0) {
  await mkdir(atticDir, { recursive: true })
  for (const name of old) {
    const to = path.join(atticDir, name)
    // 阁楼里已经有同名的就不动了 —— 同名同版本，重打一次而已
    try {
      await stat(to)
      console.log(`  已在历史版本里：${name}`)
      continue
    } catch {
      /* 不在，正常往下走 */
    }
    await rename(path.join(releaseDir, name), to)
    console.log(`  收进历史版本：${name}`)
  }
}

// ── 2. 中间产物清掉 ─────────────────────────────────────────
for (const name of entries.filter((e) => e.isFile() && SCRAP.test(e.name)).map((e) => e.name)) {
  await rm(path.join(releaseDir, name))
  console.log(`  清掉中间产物：${name}`)
}

// ── 3. 当前版本的校验值 ─────────────────────────────────────
const current = packages.filter((n) => isCurrent(n, version) && n.toLowerCase().endsWith('.exe'))
if (current.length === 0) {
  console.error(`release/ 里没有 ${version} 的包。先 pnpm dist 再跑这个脚本。`)
  process.exit(1)
}

const lines = []
for (const name of current.sort()) {
  const file = path.join(releaseDir, name)
  const hash = await sha256(file)
  const size = (await stat(file)).size
  lines.push(`${hash}  ${name}`)
  console.log(`  ${name}  ${mb(size)}`)
}
await writeFile(path.join(releaseDir, 'SHA256SUMS.txt'), lines.join('\n') + '\n', 'utf8')

// ── 4. 阁楼里有什么，写一份清单 ─────────────────────────────
try {
  const kept = (await readdir(atticDir)).filter((n) => n.toLowerCase().endsWith('.exe')).sort()
  if (kept.length > 0) {
    // 连校验值一起记下来 —— 这份清单的用处全在这一列上：
    // 有人拿着一个旧版来问「这是不是你发的」，对一下就答得出来
    const rows = []
    for (const name of kept) {
      const file = path.join(atticDir, name)
      const s = await stat(file)
      const hash = await sha256(file)
      rows.push(`| \`${name}\` | ${mb(s.size)} | ${s.mtime.toISOString().slice(0, 10)} | \`${hash}\` |`)
    }
    const doc = [
      '# 历史版本',
      '',
      '发出去过的包都留在这儿，**一个都不删**。',
      '',
      '没有代码签名证书的软件，用户只能靠 SHA-256 确认手上那份没被动过手脚 ——',
      '而校验值要有意义，被校验的那个文件必须一直在作者手上。',
      '有人拿着一个旧版来问「这是不是你发的」，得答得出来。',
      '',
      '**要用的话下最新版**：上一层目录里那个就是。这儿的都是旧的。',
      '',
      '| 包 | 大小 | 打包日期 | SHA-256 |',
      '|---|---|---|---|',
      ...rows,
      '',
      '> 这个文件是 `scripts/release.mjs` 生成的，手改了下次打包会被盖掉。',
      '',
    ].join('\n')
    await writeFile(path.join(atticDir, 'README.md'), doc, 'utf8')
  }
} catch {
  /* 还没有阁楼，说明这是第一版 */
}

console.log(`\nrelease/ 现在只有 ${version}，旧的都在 release/历史版本/。`)
