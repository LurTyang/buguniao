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

/**
 * 这一版**应该**产出哪几个文件 —— 直接问打包配置要。
 *
 * ⚠️ **不能用「文件名里含不含版本号」来判。**
 *
 * 发 0.5.0 正式版那天，`buguniao-0.5.0-preview.3-win-x64.exe` 这个名字里
 * 同样含着 `0.5.0`。于是那个预览版不但不会被收进历史版本，
 * 还会被当成这一版的产物算进 `SHA256SUMS.txt` ——
 * 发出去的校验清单里混着一个根本不是这一版的包，
 * 而这份清单的全部用处就是让人确认「我手上这个是不是你发的」。
 *
 * 版本号是个前缀关系（`1.0.0` 是 `1.0.0-rc.1` 的前缀），拿它做子串判断
 * 永远会在「正式版跟着预览版发」的那一天出错 —— 而那一天一定会来。
 */
function expectedNames(pkg, version) {
  const b = pkg.build ?? {}
  const fill = (t) =>
    t
      .replaceAll('${version}', version)
      .replaceAll('${name}', pkg.name ?? '')
      .replaceAll('${productName}', b.productName ?? '')
      .replaceAll('${arch}', 'x64')
      .replaceAll('${ext}', 'exe')
  const out = new Set()
  for (const t of [b.nsis?.artifactName, b.portable?.artifactName, b.win?.artifactName]) {
    if (typeof t !== 'string' || t.length === 0) continue
    const name = fill(t)
    out.add(name)
    // 安装版旁边那个 .blockmap 是它的附属物，跟着它算这一版的
    out.add(`${name}.blockmap`)
  }
  return out
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
const expected = expectedNames(pkg, version)

const entries = await readdir(releaseDir, { withFileTypes: true })
const packages = entries
  .filter((e) => e.isFile() && PACKAGE_EXT.has(path.extname(e.name).toLowerCase()))
  .map((e) => e.name)

const current = packages.filter((n) => expected.has(n) && n.toLowerCase().endsWith('.exe'))

/*
 * **先确认这一版的包在，再动别的。**
 *
 * 名字是从配置模板拼出来的，配置改了而这儿没跟上时，`expected` 会一个都对不上 ——
 * 那时候若先挪后查，这一脚会把**刚打出来的包**一起收进历史版本，
 * 根目录空空如也。所以这句必须在任何 rename 之前。
 */
if (current.length === 0) {
  console.error(`release/ 里没有 ${version} 的包（期待：${[...expected].join('、')}）。`)
  console.error('先 pnpm dist 再跑这个脚本；名字对不上的话，看 package.json 里的 artifactName。')
  process.exit(1)
}

// ── 1. 旧版本挪进阁楼 ───────────────────────────────────────
const old = packages.filter((n) => !expected.has(n))
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
const lines = []
const sizes = new Map()
for (const name of current.sort()) {
  const file = path.join(releaseDir, name)
  const hash = await sha256(file)
  const size = (await stat(file)).size
  sizes.set(name, size)
  lines.push(`${hash}  ${name}`)
  console.log(`  ${name}  ${mb(size)}`)
}
await writeFile(path.join(releaseDir, 'SHA256SUMS.txt'), lines.join('\n') + '\n', 'utf8')

// ── 4. 升级清单 latest.json ─────────────────────────────────
/*
 * 软件启动时读的就是这一份（`shared/update.ts` 里那套规矩）。
 *
 * **下载地址写在清单里，不写在软件里** —— 哪天换个 host（自己的服务器、
 * GitHub、对象存储、某个网盘），改这份清单就行，已经装在别人机器上的
 * 软件会跟着换过去，不用为了换个地址再发一版。
 *
 * 地址前缀用环境变量给：`BUGU_DL_BASE=https://某处/dl/ pnpm release`。
 * 不写就用作者自己那台（跟对外统计同一个域名，Caddy 加一段 file_server 就行）。
 *
 * 版本名和那句话从**更新日志**里读 —— 一处写、一处用。
 * 日志顶上那条跟 package.json 的版本号对不上时**只警告不阻断**：
 * 打包已经成了，这时候拦下来只会让人去改脚本，而不是去写日志。
 */
const DL_BASE = (process.env['BUGU_DL_BASE'] ?? 'https://bugu.char46.top/dl/').replace(/\/*$/, '/')
const REPO = 'https://github.com/LurTyang/buguniao'

/** 从更新日志顶上那条里读出版本号、名字、日期和第一段话 */
const NL = String.fromCharCode(10)
function readChangelogHead(text) {
  const m = /^##[ 	]+([0-9][^「\s·]*)[ 	]*(?:「([^」]+)」)?[ 	]*(?:·[ 	]*(\d{4}-\d{2}-\d{2}))?/m.exec(text)
  if (!m) return null
  const after = text.slice(m.index + m[0].length)
  // 第一段话：跳过空行，取到下一个空行为止，顺手把 Markdown 的星号去掉
  const para = (after.split(NL + NL).find((x) => x.trim() !== '') ?? '').trim()
  return {
    version: m[1],
    name: m[2] ?? '',
    date: m[3] ?? '',
    notes: para
      .replace(/\*\*/g, '')
      .split(NL)
      .map((x) => x.trim())
      .filter(Boolean)
      .join(' ')
      .slice(0, 300),
  }
}

const assetOf = (name) => {
  const line = lines.find((l) => l.endsWith(`  ${name}`))
  if (!line) return null
  const size = current.includes(name) ? sizes.get(name) ?? 0 : 0
  return { url: DL_BASE + name, size, sha256: line.slice(0, 64) }
}

let head = null
try {
  head = readChangelogHead(await readFile(path.join(pkgDir, '../../../更新日志.md'), 'utf8'))
} catch {
  head = null
}
/**
 * 松着比版本号：更新日志里写「1.0」，package.json 里写「1.0.0」——
 * 这两个是同一版。严格比的话每次发版都会冤枉一次作者，
 * 然后他就学会了忽略这个警告，那这个警告就白留了。
 */
function sameVersion(a, b) {
  const core = (v) => {
    const [h = ''] = String(v).replace(/^v/i, '').split('-')
    const p = h.split('.').map((x) => Number(x) || 0)
    while (p.length < 3) p.push(0)
    return p.slice(0, 3).join('.')
  }
  const pre = (v) => String(v).replace(/^v/i, '').split('-').slice(1).join('-')
  return core(a) === core(b) && pre(a) === pre(b)
}

const sameAsLog = head !== null && sameVersion(head.version, version)
if (head && !sameAsLog) {
  console.warn(`  ⚠ 更新日志顶上写的是 ${head.version}，而这次打的是 ${version} —— 日志忘了写？`)
}

const setupName = current.find((n) => n.includes('setup')) ?? ''
const portableName = current.find((n) => !n.includes('setup')) ?? ''
const manifest = {
  version,
  name: sameAsLog ? head.name : '',
  date: (sameAsLog ? head.date : '') || new Date().toISOString().slice(0, 10),
  notes: sameAsLog ? head.notes : '',
  page: `${REPO}/releases/tag/v${version}`,
  setup: setupName ? assetOf(setupName) : null,
  portable: portableName ? assetOf(portableName) : null,
}
await writeFile(path.join(releaseDir, 'latest.json'), JSON.stringify(manifest, null, 2) + NL, 'utf8')
console.log(`  latest.json（升级清单）：${manifest.version}${manifest.name ? `「${manifest.name}」` : ''}`)
console.log(`    下载地址前缀 ${DL_BASE} —— 换 host 只改这份清单，不用再发一版`)

// ── 5. 阁楼里有什么，写一份清单 ─────────────────────────────
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
