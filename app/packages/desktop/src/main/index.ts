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
import { loadConfig, patchConfig, type ThemeSlot } from './config.js'
import { canAdd, putSlot, removeSlot, normalizeSlots } from '../shared/theme-slots.js'
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
import { resolveThemeCss } from './theme-css.js'
import { nameFromCss, nameFromFile, paperColorOf } from './theme-name.js'
import { draftCss, safeFileName, type ThemeDraft } from '../shared/theme-draft.js'
import { FONT_EXTS, fontDataUrl, importFont, removeFont } from './fonts.js'
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
import type { AwardChoice, StatsState } from '../shared/api.js'

/** `--smoke` 模式：跑一遍端到端流程后自动退出。见 smoke.ts */
const SMOKE = process.argv.includes('--smoke')

/**
 * 一份主题 CSS 最大多少。
 *
 * Typora 主题一般十几 KB，带 base64 字体的能到几百 KB。给 2MB 已经很宽松，
 * 而它的作用是拦住「手滑选了个 200MB 的文件」—— 那会把界面直接卡死。
 */
const MAX_THEME_CSS = 2 * 1024 * 1024

async function readThemeCssFile(
  file: string,
): Promise<{ css: string; problems: string[]; bridged: number }> {
  const stat = await fsp.stat(file)
  if (stat.size > MAX_THEME_CSS) {
    throw new Error(`这份 CSS 有 ${Math.round(stat.size / 1024)} KB，太大了，装上去界面会卡。`)
  }
  // 不能原样读 —— `@import` 和相对 url() 都要按**这个文件自己的位置**解析。
  // 内联 <style> 里的相对路径是相对页面算的，不处理的话整份主题静默失效
  return await resolveThemeCss(file)
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
  handle('pickThemeCss', async (slot: number) => {
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

    const cfg = await loadConfig()

    /*
     * 名字和颜色在**导入时就算好存下来**，不是每次画色块再去读一遍 CSS ——
     * 书架每次打开都要画那排色块，为它读几个几百 KB 的文件不划算。
     */
    const got = await readThemeCssFile(picked)
    const one: ThemeSlot = {
      path: picked,
      draft: null,
      name: nameFromCss(got.css, picked),
      color: paperColorOf(got.css),
    }
    /*
     * `slot` 指着已有的那一格就覆盖（双击换一份 CSS 走这条），
     * 别的情况一律占用末尾那个空位 —— 而占用之后表会自己再长一个空位出来。
     * 「无限添加」就是这么来的：空位本身就是「加」这个按钮。
     */
    const r2 = putSlot(cfg.themeCssSlots, slot, one)
    if (r2.at < 0) throw new Error('自定义主题最多九个了。删掉一个再加。')
    await patchConfig({ themeCssSlots: r2.slots, themeCssActive: r2.at })
    return { slot: r2.at, slots: r2.slots }
  })

  /** 给某个槽位改名。名字是给人看的，作者当然要能改 */
  handle('renameThemeSlot', async (slot: number, name: string) => {
    const cfg = await loadConfig()
    const slots = normalizeSlots(cfg.themeCssSlots)
    const one = slots[slot]
    if (one && (one.path || one.draft)) {
      /*
       * 空名字要退回一个能认出来的名字，别留个没名字的色块。
       * 文件主题退回文件名；自制主题退回它草稿里那个名字。
       */
      const trimmed = name.trim()
      const fallback = one.path ? nameFromFile(one.path) : (one.draft?.name ?? '我的主题')
      slots[slot] = { ...one, name: trimmed || fallback }
      await patchConfig({ themeCssSlots: slots })
    }
    return slots
  })

  /** 换一个槽位（或 -1 = 不用自选样式）。不发文件框，就是切一下 */
  handle('useThemeSlot', async (slot: number) => {
    await patchConfig({ themeCssActive: slot })
    return slot
  })

  /**
   * 删掉某一格。正在用它就切回预设，删的是它前面的就把序号往前挪。
   *
   * **删的是整格，不是把它清空** —— 清空会在中间留个洞，
   * 而那个洞看起来跟末尾的空位一模一样，点下去却是另一回事。
   */
  handle('clearThemeSlot', async (slot: number) => {
    const cfg = await loadConfig()
    const r = removeSlot(cfg.themeCssSlots, slot, cfg.themeCssActive)
    await patchConfig({ themeCssSlots: r.slots, themeCssActive: r.active })
    return r
  })

  /**
   * 把自己调的那套存进栏位。
   *
   * `slot` 给 -1 = 加一份新的。满九个了返回 null ——
   * **不挤掉最老的那一份**，那是别人调了半天的配色。
   */
  handle('saveThemeToSlot', async (slot: number, draft: ThemeDraft) => {
    const cfg = await loadConfig()
    if (slot < 0 && !canAdd(cfg.themeCssSlots)) return null
    const one: ThemeSlot = {
      path: '',
      draft,
      name: draft.name.trim() || '我的主题',
      // 自制主题的纸色是现成的，不用去 CSS 里抠
      color: draft.vars['--bg-color'] ?? '',
    }
    const r = putSlot(cfg.themeCssSlots, slot, one)
    if (r.at < 0) return null
    await patchConfig({ themeCssSlots: r.slots, themeCssActive: r.at, themeDraft: draft })
    return { slot: r.at, slots: r.slots }
  })

  /**
   * 读那份 CSS 的内容。
   *
   * **读不到要说清楚是哪一种读不到**，别静默当没配 ——
   * 0.3 就是静默的，于是作者看到的是「我明明选了主题，怎么一点变化没有」，
   * 而真实原因可能是他把那个文件删了、或者那份 CSS 里根本没有 `#write`。
   *
   * 文件没了不拦着启动，但要把话带回界面上。
   */
  handle('readThemeCss', async () => {
    const cfg = await loadConfig()
    /*
     * 用哪一份：看当前槽位。
     *
     * 0.4 之前只有一个 `themeCss`，把它搬进槽位 0 —— 老用户升级之后
     * 那份主题该还在，而不是「怎么没了」。
     */
    /*
     * 自己调的那套排在最前面。
     *
     * 它跟三个文件槽位是**并列的一档**，不是第四个槽位 ——
     * 开着的时候文件槽位一律让位。这样「用哪一份主题」永远只有一个答案，
     * 不会出现两份 CSS 同时注进页面、互相压来压去的局面
     * （作者早先报过「自选样式疑似仍然可以和预设样式一同存在」）。
     */
    const slots = normalizeSlots(cfg.themeCssSlots)
    const one = cfg.themeCssActive >= 0 ? slots[cfg.themeCssActive] : undefined

    /*
     * 自制主题：直接出片，不碰硬盘。
     *
     * 它跟导入的文件占同样的格子，所以这里只是**同一条路上的一个岔口** ——
     * 界面那边完全不用管当前这格是哪一种。
     */
    if (one?.draft) {
      return {
        css: draftCss(one.draft),
        path: '',
        problem: '',
        bridged: 0,
        paper: one.draft.vars['--bg-color'] ?? '',
      }
    }

    const p = one?.path ?? ''
    if (!p) return { css: '', path: '', problem: '', bridged: 0, paper: '' }
    try {
      const r = await readThemeCssFile(p)
      /*
       * 报什么问题，按严重程度挑一条说。
       *
       * ⚠️ **「没有 #write」不再当成错**。作者那份 phycat-mint.css 里
       * 一个 #write 都没有 —— 它整份内容都在被 @import 的文件里。
       * 拿这个当判据会把好主题误判成坏的，比不判还糟。
       * 真正该报的是「有个文件没找着」。
       */
      /*
       * 「装上了但看不出变化」是这功能最难自查的一种坏法 ——
       * 作者那边只有「没变」两个字，什么线索都没有。
       *
       * 所以**把实际装进去了什么原样报出来**：多大、有没有改稿纸的规则、
       * 有没有定义颜色变量。这三件事一说，是「文件缺了」还是
       * 「这份主题本来就只改了别的地方」当场就分得开。
       */
      const kb = Math.round(r.css.length / 1024)
      /*
       * **逐个点名**：这份 CSS 到底定义了哪几个 Typora 标准变量。
       *
       * 只说「装进去 N KB」不够 —— 作者报了三次「还是没变」，
       * 每一次我都只能猜是哪一环断了。而「它定义了 --primary-color，
       * 没定义 --bg-color」这一句话，直接就把范围收死了。
       */
      const WANT = [
        '--bg-color',
        '--text-color',
        '--side-bar-bg-color',
        '--primary-color',
        '--window-border',
        '--control-text-color',
      ]
      /*
       * ⚠️ 这里必须是两个反斜杠。
       *
       * 普通字符串里的 `\s` 不是「空白」，是**一个字母 s** ——
       * 正则就成了 `--bg-colors*:`，一辈子匹配不上，于是这句提示
       * 永远在说「一个标准颜色变量都没定义」，把好主题也报成坏的。
       * 踩过第三次了，钉在这儿。
       */
      const has = WANT.filter((n) => new RegExp(n + '\\s*:', 'i').test(r.css))
      const missing = WANT.filter((n) => !has.includes(n))
      /*
       * 翻译了多少条也要说。
       *
       * Typora 主题里七成规则打向 h1/blockquote 这些真元素，我们把它们
       * 翻到了稿纸的行类上（见 main/theme-css.ts）。翻了几条，直接决定
       * 这份主题在不咕鸟里能还原多少 —— 作者该看得见这个数。
       */
      const bridged = r.bridged > 0 ? `翻译了 ${r.bridged} 条排版规则，` : ''
      const facts =
        `装进去 ${kb} KB，` +
        bridged +
        (r.css.includes('#write') ? '有 #write 规则，' : '没有 #write 规则，') +
        (has.length > 0 ? `定义了 ${has.join('、')}` : '一个标准颜色变量都没定义') +
        (missing.length > 0 && has.length > 0 ? `；缺 ${missing.join('、')}` : '') +
        '。'

      /*
       * ⚠️ **这一栏是红的。所以只有真出事了才填。**
       *
       * 作者截图报的就是这个：主题明明装好了（稿纸都变成薄荷色了），
       * 设置里却顶着一大段红字，而且「翻译了 62 条」说了两遍 ——
       * 一次来自这儿，一次来自界面那边算的回执。
       *
       * 于是分工定死：
       *   · 这儿（红字）只说**坏消息**：文件缺了，或者装了等于没装。
       *   · 正常情况下的「装进去多少、改了几个颜色、翻了几条」，
       *     由界面那边用普通颜色说一行 —— 那是回执，不是警告。
       *
       * 「只改到一两个颜色」不算坏消息：phycat 那种主题本来就只定义
       * --primary-color，纸色靠 #write::before 铺、排版靠翻译。
       * 拿变量个数去判它好坏，判出来的是错的。
       */
      const problem =
        r.problems.length > 0
          ? `${r.problems.join('　')}（${facts}）`
          : has.length === 0 && r.bridged === 0
            ? facts +
              '这份 CSS 既没定义颜色变量，也没有能翻译的排版规则 —— 它多半只改了 Typora 自己的界面。'
            : ''
      /*
       * 纸色单独报一份。
       *
       * 作者问的是「稿纸颜色仍未更改，是不是有个带纸色的文件没导进来」——
       * 不是。整份 70 KB 都在，只是这份主题**根本没有纸色**：
       * 它一个标准颜色变量都不定义，唯一碰到底色的是
       * `body{background:transparent}`，纸在 Typora 里也是白的。
       *
       * 这种事必须**说出来**，不然只能靠猜是哪一环断了。
       */
      return { css: r.css, path: p, problem, bridged: r.bridged, paper: paperColorOf(r.css) }
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e)
      // ENOENT 说人话：文件被删了/被移走了
      const gone = /ENOENT|no such file/i.test(why)
      return {
        css: '',
        path: p,
        problem: gone ? `找不到这个文件了：${p}` : `读不了这份 CSS：${why}`,
        bridged: 0,
        paper: '',
      }
    }
  })
  /**
   * 把自己调的那套导出成一份 .css。
   *
   * 为什么要有这个：调色器存的是**值**（存在配置里，随时能接着改），
   * 而导出的是**文件**（给别人、备份、或者拿去手改）。两件事分开。
   *
   * 生成的文件跟我们认得的格式完全一致 —— 也就是说导出的这份，
   * 用「自选样式」再导回来是能用的。
   */
  handle('exportThemeCss', async (draft: ThemeDraft) => {
    const r = await dialog.showSaveDialog({
      title: '把这套主题导出到',
      defaultPath: `${safeFileName(draft.name)}.css`,
      filters: [{ name: '样式表', extensions: ['css'] }],
    })
    if (r.canceled || !r.filePath) return null
    await fsp.writeFile(r.filePath, draftCss(draft), 'utf8')
    return r.filePath
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
  /**
   * 一次把选中的几部分都导出去。
   *
   * 选了不止一部分就导成一个文件夹，每部分一个文件 ——
   * 设定集拼在正文后面发给编辑，那是帮倒忙。
   */
  handle('exportBundle', async (bookPath: string, opts: any, title: string) => {
    const ws = await getWorkspace()
    const parts: Array<{ name: string; chapters: any[] }> = []

    if (opts.parts.text) parts.push({ name: '正文', chapters: await ws.collectForExport(bookPath) })
    const extras = await ws.collectExtras(bookPath, {
      outline: opts.parts.outline,
      settings: opts.parts.settings,
    })
    if (opts.parts.outline && extras.outline.length > 0)
      parts.push({ name: '大纲', chapters: extras.outline })
    if (opts.parts.settings && extras.settings.length > 0)
      parts.push({ name: '设定集', chapters: extras.settings })

    if (parts.length === 0) throw new Error('一部分都没选，没什么可导的。')

    const ext = opts.format === 'md' ? 'md' : 'txt'
    // md 保留语法、不加缩进；txt 排给人看。两档的默认值是反的
    const options = {
      ...opts.options,
      keepMarkdown: opts.format === 'md',
      ...(opts.format === 'md' ? { indentFirstLine: false } : {}),
    }

    // 只有一部分就直接存成一个文件，别为一份稿子造一个文件夹
    if (parts.length === 1) {
      const r = await dialog.showSaveDialog({
        title: '导出到',
        defaultPath: `${title}-${parts[0]!.name}.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      })
      if (r.canceled || !r.filePath) return null
      await exportTxt({ chapters: parts[0]!.chapters, options, target: r.filePath })
      return { files: 1, dir: r.filePath }
    }

    const r = await dialog.showOpenDialog({
      title: '选择导出到哪个文件夹',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (r.canceled || r.filePaths.length === 0) return null
    const dir = path.join(r.filePaths[0] as string, `${title}-导出`)
    for (const part of parts) {
      await exportTxt({
        chapters: part.chapters,
        options,
        target: path.join(dir, `${part.name}.${ext}`),
      })
    }
    return { files: parts.length, dir }
  })

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
    // 没登录就不发请求 —— 发出去也只会拿回一个 401，白等一趟。
    // 奖状给本地缓存那一份：拿到手的东西不该因为没登录就从界面上消失
    if (!signedIn) {
      return {
        signedIn,
        handle: '',
        updatedAt: '',
        stats: null,
        publicUrl: '',
        awards: cfg.statsAwards,
        ...local,
      }
    }
    const me = await myProfile(await proxyNow())
    // 读到了就刷新本地那一份，离线时还看得见
    await patchConfig({ statsAwards: me.awards })
    return {
      signedIn: true,
      handle: me.handle,
      updatedAt: me.updatedAt,
      stats: me.stats,
      publicUrl: me.handle ? publicUrlOf(me.handle) : '',
      awards: me.awards,
      ...local,
    }
  }

  /**
   * 书架上挂哪一张奖状。**只读本机缓存，不发请求** ——
   * 书架每次打开都要用它，不该每次都等一趟网络。
   */
  const awardChoice = async (): Promise<AwardChoice> => {
    const cfg = await loadConfig()
    return { awards: cfg.statsAwards, pinned: cfg.statsAwardPinned }
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
  handle('myAwards', async () => awardChoice())
  handle('pinAward', async (id: string) => {
    await patchConfig({ statsAwardPinned: id })
    return awardChoice()
  })
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
if (SMOKE) {
  /*
   * 冒烟不许碰作者真实的应用数据 —— 它会改配置、建索引、写令牌文件。
   * 所以整个 userData 指到一个临时目录去。
   *
   * `BUGU_SMOKE_USERDATA` 是给「拿一份特定配置跑一遍」用的：
   * 比如验证老配置的迁移 —— 那种事只在升级的人那儿发生，
   * 干净目录里永远试不出来。
   */
  app.setPath('userData', process.env['BUGU_SMOKE_USERDATA'] || makeSmokeRoot())
}

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
