/**
 * Electron 主进程入口。
 *
 * 安全基线（不要改松）：
 *   - contextIsolation: true   渲染进程与 preload 隔离
 *   - nodeIntegration: false   渲染进程拿不到 Node API
 *   - 所有磁盘操作走 IPC，渲染进程只能调 preload 暴露的那几个方法
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import * as path from 'node:path'
import { writeFileSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { loadConfig, patchConfig } from './config.js'
import { Workspace } from './workspace.js'
import { isWritableDir } from '../storage/local-fs.js'
import { makeSmokeRoot, runSmoke } from './smoke.js'
import {
  forgetCachedLogin,
  LOGTO,
  loginState,
  signInWithBrowser,
  signOut as logtoSignOut,
} from './account-logto.js'
import { publicStatsFrom } from './account-stats.js'
import {
  autoPushError,
  claimHandle,
  forgetMe,
  myProfile,
  publicUrlOf,
  pushNow,
  readPublic,
  startAutoPush,
} from './stats-push.js'
import { resolveProxy } from './net.js'
import { planFolder, planScrivener } from './foreign.js'
import { buildAppMenu } from './menu.js'
import {
  PRESETS,
  accumulateUsage,
  activeProviderConfig,
  clearApiKey,
  estimateTokens,
  explainAiError,
  keyStatus,
  loadAiConfig,
  providerOf,
  runAi,
  saveAiConfig,
  saveApiKey,
  testConnection,
  webSearchAvailability,
  type ProviderId,
} from './ai.js'
import {
  exportDocx,
  exportPerChapter,
  exportPreview,
  exportTxt,
  previewImport,
} from './transfer.js'
import type { StatsState } from '../shared/api.js'

/** `--smoke` 模式：跑一遍端到端流程后自动退出。见 smoke.ts */
const SMOKE = process.argv.includes('--smoke')

/**
 * 一份主题 CSS 最大多少。
 *
 * Typora 主题一般十几 KB，带 base64 字体的能到几百 KB。给 2MB 已经很宽松，
 * 而它的作用是拦住「手滑选了个 200MB 的文件」—— 那会把界面直接卡死。
 */
const MAX_THEME_CSS = 2 * 1024 * 1024

async function readThemeCssFile(file: string): Promise<string> {
  const stat = await fsp.stat(file)
  if (stat.size > MAX_THEME_CSS) {
    throw new Error(`这份 CSS 有 ${Math.round(stat.size / 1024)} KB，太大了，装上去界面会卡。`)
  }
  return await fsp.readFile(file, 'utf8')
}

/** 产物目录（out/main）。主进程打包为 CommonJS，所以 __dirname 可用 */
const here = __dirname

let workspace: Workspace | null = null

async function getWorkspace(): Promise<Workspace> {
  if (workspace) return workspace
  const cfg = await loadConfig()
  if (!cfg.root) throw new Error('还没有选择作品根目录')
  workspace = new Workspace(
    cfg.root,
    cfg.deviceId,
    path.join(app.getPath('userData'), 'index.db'),
    cfg.deviceName || cfg.deviceId,
  )
  return workspace
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#faf9f7',
    title: '不咕鸟',
    // 菜单栏默认收起（按 Alt 才显形）—— 打开只该看到一张干净的稿纸
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // 外部链接用系统浏览器打开，不在应用里开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(path.join(here, '../renderer/index.html'))

  if (SMOKE) runSmoke(win, smokeRoot as string)

  return win
}

// ───────────────────────── IPC ─────────────────────────

function registerIpc(): void {
  const handle = <T>(channel: string, fn: (...args: any[]) => Promise<T>) => {
    ipcMain.handle(channel, async (_e, ...args) => {
      try {
        return { ok: true as const, value: await fn(...args) }
      } catch (e) {
        // 把错误变成普通对象传回渲染进程 —— Error 实例跨 IPC 会丢信息
        console.error(`[bugu] IPC ${channel} 失败:`, e)
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
      }
    })
  }

  handle('getRoot', async () => (await loadConfig()).root)

  handle('chooseRoot', async () => {
    const r = await dialog.showOpenDialog({
      title: '选择作品根目录（建议放在坚果云同步文件夹里）',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (r.canceled || r.filePaths.length === 0) return null
    const picked = r.filePaths[0] as string
    if (!(await isWritableDir(picked))) throw new Error('这个目录没有写权限，换一个吧')
    await patchConfig({ root: picked })
    workspace = null // 换了根目录，工作区要重建
    return picked
  })

  handle('listBooks', async () => (await getWorkspace()).listBooks())
  handle('createBook', async (title: string, kind: any) =>
    (await getWorkspace()).createBook(title, kind))
  handle('loadTree', async (p: string) => (await getWorkspace()).loadTree(p))
  handle('createChapter', async (dir: string, title: string) => (await getWorkspace()).createChapter(dir, title))

  // ── 作品级 ──
  handle('updateBookMeta', async (b: string, patch: any) => (await getWorkspace()).updateBookMeta(b, patch))
  handle('renameBook', async (b: string, t: string) => (await getWorkspace()).renameBook(b, t))
  handle('trashBook', async (b: string) => (await getWorkspace()).trashBook(b))
  handle('clearBookCover', async (b: string) => (await getWorkspace()).clearBookCover(b))
  handle('writeCoverBytes', async (b: string, data: string, ext: string) =>
    (await getWorkspace()).writeBookCoverBytes(b, data, ext))
  handle('readCover', async (b: string, f: string) => (await getWorkspace()).readCoverDataUrl(b, f))
  handle('trashSettingCategory', async (b: string, c: string) =>
    (await getWorkspace()).trashSettingCategory(b, c))

  handle('pickCover', async (bookPath: string) => {
    const r = await dialog.showOpenDialog({
      title: '选择封面图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
    })
    if (r.canceled || r.filePaths.length === 0) return null
    return (await getWorkspace()).setBookCover(bookPath, r.filePaths[0] as string)
  })

  // ── 设置 ──
  handle('getSettings', async () => await loadConfig())
  handle('updateSettings', async (patch: any) => await patchConfig(patch))

  /**
   * 挑一份主题 CSS。Typora 的主题文件可以直接选。
   *
   * 只挑，不读 —— 读是 `readThemeCss` 的事。分开是因为每次启动都要读一遍，
   * 但只有换的时候才需要弹文件框。
   */
  handle('pickThemeCss', async () => {
    const r = await dialog.showOpenDialog({
      title: '选择一份主题 CSS（Typora 的主题可以直接用）',
      properties: ['openFile'],
      filters: [{ name: '样式表', extensions: ['css'] }],
    })
    if (r.canceled || r.filePaths.length === 0) return null
    const picked = r.filePaths[0] as string
    // 先读一遍确认能读、不是个巨大的东西，再存进配置 ——
    // 存了一个读不出来的路径，界面上只会莫名其妙地没效果
    await readThemeCssFile(picked)
    await patchConfig({ themeCss: picked })
    return picked
  })

  /** 读那份 CSS 的内容。文件没了/删了就当没配，不拦着启动 */
  handle('readThemeCss', async () => {
    const p = (await loadConfig()).themeCss
    if (!p) return ''
    try {
      return await readThemeCssFile(p)
    } catch {
      return ''
    }
  })
  handle('createVolume', async (b: string, t: string) => (await getWorkspace()).createVolume(b, t))
  handle('renameDoc', async (p: string, t: string) => (await getWorkspace()).renameDoc(p, t))
  handle('renameVolume', async (p: string, t: string) => (await getWorkspace()).renameVolume(p, t))
  handle('reorder', async (d: string, f: number, t: number) => (await getWorkspace()).reorder(d, f, t))
  handle('moveToDir', async (p: string, d: string) => (await getWorkspace()).moveToDir(p, d))

  handle('trashDoc', async (b: string, p: string) => (await getWorkspace()).trashDoc(b, p))
  handle('listTrash', async (b: string) => (await getWorkspace()).listTrash(b))
  handle('restoreFromTrash', async (e: any) => (await getWorkspace()).restoreFromTrash(e))
  handle('emptyTrash', async (b: string) => (await getWorkspace()).emptyTrash(b))

  handle('createSettingCategory', async (b: string, n: string) => (await getWorkspace()).createSettingCategory(b, n))
  handle('createSettingCard', async (c: string, t: string) => (await getWorkspace()).createSettingCard(c, t))
  handle('readTemplate', async (c: string) => (await getWorkspace()).readTemplate(c))

  handle('listStickies', async (b: string) => (await getWorkspace()).listStickies(b))
  handle('readSticky', async (p: string, c?: string) => (await getWorkspace()).readSticky(p, c ?? null))
  handle('loadStickyLayout', async (b: string) => (await getWorkspace()).loadStickyLayout(b))
  handle('saveStickyLayout', async (b: string, l: any) => (await getWorkspace()).saveStickyLayout(b, l))
  handle('backlinks', async (t: string, b?: string) => (await getWorkspace()).backlinks(t, b))

  handle('listForeshadows', async (b: string, d?: string) => (await getWorkspace()).listForeshadows(b, d))
  handle('addForeshadow', async (b: string, i: any) => (await getWorkspace()).addForeshadow(b, i))
  handle('patchForeshadow', async (b: string, id: string, c: any) =>
    (await getWorkspace()).patchForeshadow(b, id, c))
  handle('markForeshadow', async (b: string, p: string, r: any, id: string, k: any) =>
    (await getWorkspace()).markForeshadow(b, p, r, id, k))
  handle('docAnchors', async (p: string) => (await getWorkspace()).docAnchors(p))

  handle('listVersions', async (b: string, d: string) => (await getWorkspace()).listVersions(b, d))
  handle('readVersion', async (b: string, d: string, v: number) => (await getWorkspace()).readVersion(b, d, v))
  handle('rollbackTo', async (b: string, p: string, v: number) => (await getWorkspace()).rollbackTo(b, p, v))
  handle('labelVersion', async (b: string, d: string, v: number, l: string) =>
    (await getWorkspace()).labelVersion(b, d, v, l))
  handle('historyCapacity', async (b: string) => (await getWorkspace()).historyCapacity(b))
  handle('pruneHistory', async (b: string, st: any) => (await getWorkspace()).pruneHistory(b, st))

  // ── 导入 ──
  handle('pickImportFile', async () => {
    const r = await dialog.showOpenDialog({
      title: '选择要导入的 txt',
      properties: ['openFile'],
      filters: [{ name: '文本文件', extensions: ['txt', 'md'] }],
    })
    if (r.canceled || r.filePaths.length === 0) return null
    return { filePath: r.filePaths[0] as string, ...(await previewImport(r.filePaths[0] as string)) }
  })
  /**
   * 从别的写作软件搬家。
   *
   * 只挑了两条**有把握**的路：Scrivener（格式公开）与整个文件夹的 txt/md
   *（几乎所有软件都能导出成这个）。青茉、码字精灵是私有格式，
   * 没有样本就不猜 —— 猜错等于把作者几百万字导成乱码。
   */
  handle('pickForeign', async (kind: 'scrivener' | 'folder') => {
    const r = await dialog.showOpenDialog({
      title: kind === 'scrivener' ? '选择 .scriv 项目文件夹' : '选择装着 txt/md 的文件夹',
      properties: ['openDirectory'],
    })
    if (r.canceled || r.filePaths.length === 0) return null
    const dir = r.filePaths[0] as string
    return kind === 'scrivener' ? planScrivener(dir) : planFolder(dir)
  })
  handle('applyForeign', async (b: string, dir: string, chapters: any) =>
    (await getWorkspace()).applyImport(b, dir, chapters, null))

  handle('rePreviewImport', async (f: string, lines?: number[]) => previewImport(f, lines))
  handle('applyImport', async (b: string, dir: string, chapters: any, preamble: string | null) =>
    (await getWorkspace()).applyImport(b, dir, chapters, preamble))

  // ── 导出 ──
  handle('collectForExport', async (b: string) => (await getWorkspace()).collectForExport(b))
  handle('exportPreview', async (chapters: any, options: any) => exportPreview(chapters, options))
  handle('exportBook', async (kind: string, chapters: any, options: any, title: string) => {
    if (kind === 'perChapter') {
      const r = await dialog.showOpenDialog({
        title: '选择导出到哪个文件夹',
        properties: ['openDirectory', 'createDirectory'],
      })
      if (r.canceled || r.filePaths.length === 0) return null
      return exportPerChapter({ chapters, options, target: r.filePaths[0] as string })
    }

    const isDocx = kind === 'docx'
    const r = await dialog.showSaveDialog({
      title: '导出到',
      defaultPath: `${title}.${isDocx ? 'docx' : 'txt'}`,
      filters: isDocx
        ? [{ name: 'Word 文档', extensions: ['docx'] }]
        : [{ name: '文本文件', extensions: ['txt'] }],
    })
    if (r.canceled || !r.filePath) return null
    return isDocx
      ? exportDocx({ chapters, options, target: r.filePath, title })
      : exportTxt({ chapters, options, target: r.filePath })
  })

  // ── AI ──
  handle('aiStatus', async () => {
    const config = await loadAiConfig()
    const keys = await keyStatus()
    const provider = providerOf(config.provider)
    return {
      // **只回布尔值**：API Key 本身永远不出主进程
      keys,
      hasKey: keys[config.provider],
      config,
      presets: PRESETS,
      provider: { id: provider.id, label: provider.label, baseUrlHint: provider.baseUrlHint },
      webSearch: webSearchAvailability(config),
      active: activeProviderConfig(config),
      /** 实际生效的代理。作者填了 auto 时得让他看见到底用了什么 */
      proxyInUse: resolveProxy(config.proxy),
    }
  })
  handle('aiTestConnection', async () => testConnection(await loadAiConfig()))
  handle('aiSetKey', async (provider: ProviderId, key: string) => {
    await saveApiKey(provider, key)
  })
  handle('aiClearKey', async (provider: ProviderId) => {
    await clearApiKey(provider)
  })
  handle('aiSetConfig', async (patch: any) => {
    const next = { ...(await loadAiConfig()), ...patch }
    await saveAiConfig(next)
    return next
  })
  handle('aiEstimate', async (bookPath: string, docPath: string | null, task: any, input: string) => {
    const cfg = await loadAiConfig()
    const ctx = await (await getWorkspace()).buildAiContext(bookPath, docPath, input)
    return estimateTokens(ctx, task, input, cfg)
  })

  /**
   * 正在跑的 AI 请求。作者点「停」时要能真的把它掐掉 ——
   * 只在界面上停掉动画没用，请求还在跑，钱还在花。
   */
  const aiRunning = new Map<string, AbortController>()

  handle('aiCancel', async (requestId: string) => {
    aiRunning.get(requestId)?.abort()
    return aiRunning.delete(requestId)
  })

  /**
   * 跑一次 AI。流式片段通过 `ai:delta` 事件推回渲染进程，
   * requestId 用来区分同时进行的多次调用。
   */
  handle('aiRun', async (requestId: string, bookPath: string, docPath: string | null, task: any, input: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
    const cfg = await loadAiConfig()
    const ctx = await (await getWorkspace()).buildAiContext(bookPath, docPath, input)

    const ctrl = new AbortController()
    aiRunning.set(requestId, ctrl)
    try {
      const r = await runAi({
        task,
        input,
        ctx,
        config: cfg,
        signal: ctrl.signal,
        onDelta: (t) => win?.webContents.send('ai:delta', { requestId, kind: 'text', text: t }),
        onThinking: (t) => win?.webContents.send('ai:delta', { requestId, kind: 'thinking', text: t }),
      })
      await saveAiConfig(accumulateUsage(cfg, r.usage))
      return r
    } catch (e) {
      // 作者自己点的「停」不是错误，不该弹一行红字
      if (ctrl.signal.aborted) throw new Error('已停止。')
      // 把 SDK 的异常翻译成作者看得懂的话再抛出去
      throw new Error(explainAiError(e))
    } finally {
      aiRunning.delete(requestId)
    }
  })

  handle('outgoingLinks', async (p: string, b?: string) => (await getWorkspace()).outgoingLinks(p, b))

  /**
   * 剪切/复制/粘贴/全选。
   *
   * 走主进程的 webContents 而不是渲染进程里的 execCommand ——
   * 后者在 CodeMirror 这类自己管选区的编辑器里时灵时不灵，
   * 而 webContents 走的是 Chromium 原生的编辑命令，作用在当前焦点上，必然对。
   */
  handle('editCmd', async (kind: string) => {
    const wc = (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.webContents
    if (!wc) return
    if (kind === 'cut') wc.cut()
    else if (kind === 'copy') wc.copy()
    else if (kind === 'paste') wc.paste()
    else if (kind === 'selectAll') wc.selectAll()
    else if (kind === 'undo') wc.undo()
    else if (kind === 'redo') wc.redo()
  })

  // ── 码字计划 ──
  handle('planReport', async () => (await getWorkspace()).planReport())

  // ── 云账号 ──
  //
  // 令牌只在主进程里，渲染进程拿到的永远是「登录了没有、是谁」。
  // 跟 API Key 一个待遇。
  const proxyNow = async () => (await loadAiConfig()).proxy

  handle('loginState', async () => loginState(LOGTO))
  handle('loginWithBrowser', async () => // 统计服务还不存在，现在别要 stats:write ——
  // 要了会因为 API 资源没建而 invalid_scope，把整个登录搞挂
  signInWithBrowser(LOGTO, await proxyNow()))
  handle('loginOut', async () => logtoSignOut(LOGTO, await proxyNow()))
  handle('loginForget', async () => {
    forgetCachedLogin()
    return loginState(LOGTO)
  })

  // ── 对外统计 ──
  //
  // 唯一一处「作者的东西会离开这台电脑」，所以整条链上每一步都是显式的：
  // 登录、认领短名、打开开关，三样齐了才真的会推。
  //
  // 要推哪七个数由 account-stats.ts 一处说了算 —— 这儿绝不自己从
  // planReport 里多挑一个字段出来。
  const collectStats = async () => publicStatsFrom(await (await getWorkspace()).planReport())

  /** 把「服务器上是什么样」和「本机开关是什么样」合成界面要的那一份 */
  const statsState = async (): Promise<StatsState> => {
    const cfg = await loadConfig()
    const local = {
      autoPush: cfg.statsAutoPush,
      lastPushAt: cfg.statsLastPushAt,
      autoError: autoPushError(),
    }
    const signedIn = (await loginState(LOGTO)).signedIn
    // 没登录就不发请求 —— 发出去也只会拿回一个 401，白等一趟
    if (!signedIn) {
      return { signedIn, handle: '', updatedAt: '', stats: null, publicUrl: '', ...local }
    }
    const me = await myProfile(await proxyNow())
    return {
      signedIn: true,
      handle: me.handle,
      updatedAt: me.updatedAt,
      stats: me.stats,
      publicUrl: me.handle ? publicUrlOf(me.handle) : '',
      ...local,
    }
  }

  handle('statsMe', async () => statsState())
  handle('statsClaimHandle', async (name: string) => {
    await claimHandle(name, await proxyNow())
    return statsState()
  })
  handle('statsPush', async () => {
    await pushNow(await collectStats(), await proxyNow())
    // 推成功了才记这一笔 —— 记早了界面会说「刚上传过」而其实没有
    await patchConfig({ statsLastPushAt: new Date().toISOString() })
    return statsState()
  })
  handle('statsSetAutoPush', async (on: boolean) => {
    await patchConfig({ statsAutoPush: on })
    // 照样去读一次服务器：只是拨了个开关，短名和公开地址不该跟着从界面上消失
    return statsState()
  })
  handle('statsForget', async () => {
    await forgetMe(await proxyNow())
    // 服务器上没有我了，本机这两项也该跟着清 —— 留着只会显示一个
    // 早已不存在的「上次上传」
    await patchConfig({ statsAutoPush: false, statsLastPushAt: '' })
    return statsState()
  })
  handle('statsPublic', async (handleName: string) => readPublic(handleName, await proxyNow()))
  handle('statsPreview', async () => collectStats())
  handle('setNickname', async (n: string) => (await getWorkspace()).setNickname(n))
  handle('setPlanTarget', async (t: any) => (await getWorkspace()).setPlanTarget(t))
  handle('setLeave', async (d: string, r: string | null) => (await getWorkspace()).setLeave(d, r))

  handle('listMilestones', async (b: string) => (await getWorkspace()).listMilestones(b))
  handle('milestoneTargets', async (b: string) => (await getWorkspace()).milestoneTargets(b))
  handle('addMilestone', async (b: string, i: any) => (await getWorkspace()).addMilestone(b, i))
  handle('patchMilestone', async (b: string, id: string, c: any) =>
    (await getWorkspace()).patchMilestone(b, id, c))
  handle('removeMilestone', async (b: string, id: string) => (await getWorkspace()).removeMilestone(b, id))

  handle('playFrom', async (b: string, from: string, st: any) =>
    (await getWorkspace()).playFrom(b, from, st))
  handle('exportGameScript', async (b: string, engine: any) =>
    (await getWorkspace()).exportGameScript(b, engine))
  handle('scriptReport', async (p: string, b?: string) =>
    (await getWorkspace()).scriptReport(p, b))
  handle('bookCast', async (b: string) => (await getWorkspace()).bookCast(b))
  handle('createLibraryIdea', async (body: string) => (await getWorkspace()).createLibraryIdea(body))
  handle('listLibraryIdeas', async () => (await getWorkspace()).listLibraryIdeas())
  handle('setCastCategories', async (b: string, c: string[]) =>
    (await getWorkspace()).setCastCategories(b, c))
  handle('moveSceneIn', async (p: string, f: number, t: number) =>
    (await getWorkspace()).moveSceneIn(p, f, t))
  handle('createScript', async (d: string, t: string) => (await getWorkspace()).createScript(d, t))
  handle('createGameScript', async (d: string, t: string) =>
    (await getWorkspace()).createGameScript(d, t))
  handle('saveAside', async (p: string, b: string, sfx: string) =>
    (await getWorkspace()).saveAside(p, b, sfx))

  handle('gameGraph', async (b: string, live?: { path: string; body: string }) =>
    (await getWorkspace()).gameGraph(b, live))

  handle('listConflicts', async (b: string) => (await getWorkspace()).listConflicts(b))
  handle('resolveConflict', async (b: string, c: string, a: 'keepOriginal' | 'keepConflict' | 'keepBoth') =>
    (await getWorkspace()).resolveConflict(b, c, a),
  )

  handle('createIdea', async (b: string, body: string) => (await getWorkspace()).createIdea(b, body))
  handle('listIdeas', async (b: string) => (await getWorkspace()).listIdeas(b))
  handle('mergeIdea', async (b: string, i: string, t: string) => (await getWorkspace()).mergeIdea(b, i, t))
  handle('trashIdea', async (b: string, i: string) => (await getWorkspace()).trashIdea(b, i))

  handle('readDoc', async (p: string) => (await getWorkspace()).readDoc(p))
  handle('saveDoc', async (p: string, body: string) => (await getWorkspace()).saveDoc(p, body))
  handle('ensureIndexed', async (b: string) => (await getWorkspace()).syncIndex(b))
  handle('rebuildIndex', async (b: string) => (await getWorkspace()).syncIndex(b, { force: true }))
  handle('search', async (q: string, o?: any) => (await getWorkspace()).search(q, o ?? {}))
  handle('indexStats', async (b?: string) => (await getWorkspace()).indexStats(b))

  handle('statsReport', async (b: string, o?: any) => (await getWorkspace()).statsReport(b, o ?? {}))
  handle('setPomodoro', async (active: boolean) => {
    ;(await getWorkspace()).setPomodoro(active)
  })

  handle('todayProgress', async (p: string) => (await getWorkspace()).todayProgress(p))

  handle('revealInExplorer', async (rel: string) => {
    const cfg = await loadConfig()
    if (!cfg.root) return
    shell.showItemInFolder(path.join(cfg.root, rel.replace(/\//g, path.sep)))
  })

  handle('appVersion', async () => app.getVersion())
}

// ───────────────────────── 生命周期 ─────────────────────────

/** 冒烟模式下用的临时作品根目录 */
let smokeRoot: string | null = null

// 冒烟模式必须整个跑在临时目录里 —— 包括**配置目录**。
// 否则跑一次冒烟就会把作者真实的设置（作品根目录、AI 配置）覆盖掉，
// 而且上一次冒烟留下的配置还会让这一次的断言时灵时不灵。
// setPath 必须在 app ready 之前调用。
if (SMOKE) app.setPath('userData', makeSmokeRoot())

void app.whenReady().then(async () => {
  if (SMOKE) {
    // 冒烟跑在临时目录里，绝不碰作者真实的作品文件夹
    smokeRoot = makeSmokeRoot()
    await patchConfig({ root: smokeRoot })
    workspace = null
  }
  registerIpc()

  const focused = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
  const tell = (channel: string) => focused()?.webContents.send(channel)
  Menu.setApplicationMenu(
    buildAppMenu({
      onChooseRoot: () => tell('menu:choose-root'),
      onNewBook: () => tell('menu:new-book'),
      onBackToShelf: () => tell('menu:back-to-shelf'),
      onOpenSettings: () => tell('menu:settings'),
      onRevealRoot: () => {
        void loadConfig().then((cfg) => {
          if (cfg.root) void shell.openPath(cfg.root)
        })
      },
    }),
  )

  createWindow()

  // 自动上传的钟。**开关默认关着**，这儿只是把钟挂上 ——
  // 它每次醒来都会重新问一遍「开着吗、登录了吗」，所以挂早了也不会乱发。
  // 冒烟模式下不挂：那是个临时目录，不该有东西往外发。
  if (!SMOKE) {
    startAutoPush({
      enabled: async () => (await loadConfig()).statsAutoPush,
      collect: async () => publicStatsFrom(await (await getWorkspace()).planReport()),
      proxy: async () => (await loadAiConfig()).proxy,
      onPushed: async (at) => {
        await patchConfig({ statsLastPushAt: at })
      },
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  workspace?.close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
