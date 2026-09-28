/**
 * 自动升级 —— 主进程这一半。
 *
 * 规范：更新文档/10-自动升级.md
 *
 * ─────────────────────────────────────────────────────────────
 * 【三条定死的规矩】
 *
 * 1. **启动时只查一次，查的是一份几 KB 的清单。** 查不通一律沉默 ——
 *    没网、服务器挂了、代理没开，都不该打扰正在写字的人。
 * 2. **不自动下载、不自动重启。** 发现新版只在界面上挂一条不挡路的横幅；
 *    下载要作者点，装要作者点。一个写作软件在你写字的时候偷偷占带宽、
 *    甚至自己重启，是最不能接受的事 —— 那会毁掉正在进行的一坐。
 * 3. **装之前一定核对 SHA-256。** 这软件没有代码签名证书，那串哈希是
 *    唯一能证明「这个包是作者发的」的东西。对不上就不装，并且明说为什么。
 *
 * 【免安装版装不了自己】
 *
 * 正在跑的那个 exe 没法被替换掉。所以免安装版只把新包下下来、
 * 在资源管理器里指给作者看，让他自己换 —— 假装能自动升级，
 * 然后失败在一个说不清的地方，比老老实实说「你自己换一下」更糟。
 * ─────────────────────────────────────────────────────────────
 */

import { app, shell } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { makeFetch, resolveProxy } from './net.js'
import type { UpdateCheck } from '../shared/update.js'
import {
  isNewer,
  parseManifest,
  pickAsset,
  type UpdateAsset,
  type UpdateManifest,
} from '../shared/update.js'

/** 装的是安装版还是免安装版。免安装版跑起来时 electron-builder 会给这个环境变量 */
export function isPortableBuild(env: Record<string, string | undefined> = process.env): boolean {
  return typeof env['PORTABLE_EXECUTABLE_DIR'] === 'string' && env['PORTABLE_EXECUTABLE_DIR'] !== ''
}


/**
 * 查一次清单。
 *
 * ⚠️ **绝不抛。** 这条路上什么都可能出错（没网、DNS 被污染、服务器返回一页
 * 404 的 HTML、清单字段写坏），而它们的处理方式完全一样：当作没有更新。
 */
export async function checkUpdate(
  urls: readonly string[],
  currentVersion: string,
  proxySetting: string,
  timeoutMs = 8000,
): Promise<UpdateCheck> {
  /*
   * **一个地址不通就试下一个。**
   *
   * 作者那台服务器和 GitHub 各有各的死法：自己那台可能欠费、域名可能到期；
   * GitHub 的 raw 在国内时常连不上。两个都挂的概率比任何一个单独挂小得多，
   * 而多试一次的代价只是几 KB。
   *
   * 顺序有意义，排在前面的先试。**读到一份能读懂的清单就到此为止** ——
   * 哪怕它说「没有新版本」：那是答案，不是失败。
   */
  let lastError: string | null = null
  for (const target of urls) {
    const one = await checkOne(target, currentVersion, proxySetting, timeoutMs)
    if (one.found || one.error === null) return one
    lastError = one.error
  }
  return { found: null, current: currentVersion, error: lastError ?? '没有可用的更新地址。' }
}

async function checkOne(
  target0: string,
  currentVersion: string,
  proxySetting: string,
  timeoutMs: number,
): Promise<UpdateCheck> {
  const base: UpdateCheck = { found: null, current: currentVersion, error: null }
  const target = target0.trim()
  if (!/^https:\/\//i.test(target)) {
    return { ...base, error: '更新地址得是 https 的。' }
  }

  const f = makeFetch(resolveProxy(proxySetting)) ?? fetch
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await f(target, {
      signal: ctrl.signal,
      // 清单会变，别让缓存把新版本藏起来
      headers: { 'cache-control': 'no-cache' },
    })
    if (!res.ok) return { ...base, error: `检查更新失败：HTTP ${res.status}` }
    const manifest = parseManifest(await res.text())
    if (!manifest) return { ...base, error: '那份更新清单读不懂，先当作没有新版本。' }
    if (!isNewer(manifest.version, currentVersion)) return base

    const installed = !isPortableBuild()
    const asset = pickAsset(manifest, installed)
    if (!asset) return base
    return { found: { manifest, asset, canInstall: installed }, current: currentVersion, error: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ...base, error: ctrl.signal.aborted ? '检查更新超时了。' : `检查更新失败：${msg}` }
  } finally {
    clearTimeout(timer)
  }
}

/** 下到哪儿去。放临时目录，装完就可以不管了 */
function tempFileFor(url: string): string {
  const name = path.basename(new URL(url).pathname) || 'buguniao-update.exe'
  return path.join(app.getPath('temp'), 'buguniao-update', name)
}

/**
 * 把包下下来，**边下边算哈希**，对不上就删掉并报错。
 *
 * 边下边算而不是下完再读一遍：一个 100MB 的文件读两遍没必要，
 * 而且「下完了但还要等一会儿」在界面上解释不清。
 */
export async function downloadUpdate(
  asset: UpdateAsset,
  proxySetting: string,
  onProgress: (received: number, total: number) => void,
): Promise<string> {
  const file = tempFileFor(asset.url)
  await fsp.mkdir(path.dirname(file), { recursive: true })

  const f = makeFetch(resolveProxy(proxySetting)) ?? fetch
  const res = await f(asset.url)
  if (!res.ok || !res.body) throw new Error(`下载失败：HTTP ${res.status}`)

  const total = Number(res.headers.get('content-length')) || asset.size || 0
  const hash = createHash('sha256')
  const out = fs.createWriteStream(file)
  let received = 0

  try {
    // @ts-expect-error —— undici 的 body 是 Web 流，for await 能直接读
    for await (const chunk of res.body) {
      const buf = chunk as Uint8Array
      hash.update(buf)
      received += buf.byteLength
      if (!out.write(buf)) await new Promise<void>((r) => out.once('drain', () => r()))
      onProgress(received, total)
    }
    await new Promise<void>((r, j) => out.end(() => r()) && out.once('error', j))
  } catch (e) {
    out.destroy()
    await fsp.rm(file, { force: true })
    throw e
  }

  const got = hash.digest('hex')
  if (got !== asset.sha256.toLowerCase()) {
    await fsp.rm(file, { force: true })
    /*
     * 这句话要说得具体。
     *
     * 校验值对不上有两种可能：下载被截断了（重试一次就好），
     * 或者这个包**不是作者发的那个**。后一种是安全事故，
     * 而作者的读者有权知道到底发生了什么 —— 所以两串哈希都摆出来。
     */
    throw new Error(`校验值对不上，这个包没装。\n期待 ${asset.sha256}\n实得 ${got}`)
  }
  return file
}

/**
 * 装上。
 *
 * 安装版：静默跑一遍安装程序，装完自己起来（`--force-run` 是
 * electron-builder 那个 NSIS 包认的参数）。这一步会让当前这个进程退出 ——
 * 所以调用方必须先确认作者已经保存、或者存盘是自动的。
 *
 * 免安装版：装不了自己，只在资源管理器里指给作者看。
 */
export function installUpdate(file: string, canInstall: boolean): void {
  if (!canInstall) {
    shell.showItemInFolder(file)
    return
  }
  const child = spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' })
  child.unref()
  // 给安装程序一点时间起来，再退出自己 —— 退太快有些机器上会被杀掉
  setTimeout(() => app.quit(), 800)
}
