/**
 * preload —— 主进程与渲染进程之间唯一的通道。
 *
 * 只暴露 BuguApi 里明确列出的方法。渲染进程拿不到 ipcRenderer 本身，
 * 也就无法调用未列出的通道。
 */

import { contextBridge, ipcRenderer } from 'electron'

type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** 把主进程返回的 {ok,error} 包装还原成正常的 resolve/reject */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!r.ok) throw new Error(r.error)
  return r.value
}

const api = {
  getRoot: () => call<string | null>('getRoot'),
  chooseRoot: () => call<string | null>('chooseRoot'),
  listBooks: () => call<unknown[]>('listBooks'),
  createBook: (title: string, kind?: string) => call<unknown>('createBook', title, kind),
  loadTree: (p: string) => call<unknown>('loadTree', p),
  createChapter: (dir: string, title: string) => call<unknown>('createChapter', dir, title),

  updateBookMeta: (b: string, patch: unknown) => call<unknown>('updateBookMeta', b, patch),
  renameBook: (b: string, t: string) => call<unknown>('renameBook', b, t),
  trashBook: (b: string) => call<unknown>('trashBook', b),
  pickCover: (b: string) => call<unknown>('pickCover', b),
  clearBookCover: (b: string) => call<void>('clearBookCover', b),
  writeCoverBytes: (b: string, data: string, ext: string) => call<unknown>('writeCoverBytes', b, data, ext),
  readCover: (b: string, f: string) => call<string | null>('readCover', b, f),
  trashSettingCategory: (b: string, c: string) => call<unknown>('trashSettingCategory', b, c),

  getSettings: () => call<unknown>('getSettings'),
  updateSettings: (patch: unknown) => call<unknown>('updateSettings', patch),
  pickThemeCss: (slot?: number) => call<unknown>('pickThemeCss', slot),
  useThemeSlot: (slot: number) => call<number>('useThemeSlot', slot),
  clearThemeSlot: (slot: number) => call<unknown>('clearThemeSlot', slot),
  renameThemeSlot: (slot: number, name: string) => call<unknown>('renameThemeSlot', slot, name),
  exportBundle: (b: string, o: unknown, t: string) => call<unknown>('exportBundle', b, o, t),
  readThemeCss: () => call<unknown>('readThemeCss'),
  exportThemeCss: (d: unknown) => call<unknown>('exportThemeCss', d),
  saveThemeToSlot: (slot: number, d: unknown) => call<unknown>('saveThemeToSlot', slot, d),
  pickFont: () => call<unknown>('pickFont'),
  fontData: (f: string) => call<string>('fontData', f),
  removeFont: (f: string) => call<unknown>('removeFont', f),
  createVolume: (b: string, t: string) => call<unknown>('createVolume', b, t),
  renameDoc: (p: string, t: string) => call<unknown>('renameDoc', p, t),
  renameVolume: (p: string, t: string) => call<unknown>('renameVolume', p, t),
  reorder: (d: string, f: number, t: number) => call<unknown>('reorder', d, f, t),
  moveToDir: (p: string, d: string) => call<unknown>('moveToDir', p, d),

  trashDoc: (b: string, p: string) => call<unknown>('trashDoc', b, p),
  listTrash: (b: string) => call<unknown[]>('listTrash', b),
  restoreFromTrash: (e: unknown) => call<void>('restoreFromTrash', e),
  emptyTrash: (b: string) => call<number>('emptyTrash', b),

  createSettingCategory: (b: string, n: string) => call<unknown>('createSettingCategory', b, n),
  createSettingCard: (c: string, t: string) => call<unknown>('createSettingCard', c, t),
  readTemplate: (c: string) => call<unknown>('readTemplate', c),
  listStickies: (b: string) => call<unknown[]>('listStickies', b),
  readSticky: (p: string, c?: string) => call<unknown>('readSticky', p, c),
  loadStickyLayout: (b: string) => call<unknown>('loadStickyLayout', b),
  saveStickyLayout: (b: string, l: unknown) => call<void>('saveStickyLayout', b, l),
  backlinks: (t: string, b?: string) => call<unknown[]>('backlinks', t, b),

  listForeshadows: (b: string, d?: string) => call<unknown>('listForeshadows', b, d),
  addForeshadow: (b: string, i: unknown) => call<unknown>('addForeshadow', b, i),
  patchForeshadow: (b: string, id: string, c: unknown) => call<void>('patchForeshadow', b, id, c),
  markForeshadow: (b: string, p: string, r: unknown, id: string, k: string) =>
    call<unknown>('markForeshadow', b, p, r, id, k),
  docAnchors: (p: string) => call<unknown[]>('docAnchors', p),

  listVersions: (b: string, d: string) => call<unknown[]>('listVersions', b, d),
  readVersion: (b: string, d: string, v: number) => call<string>('readVersion', b, d, v),
  rollbackTo: (b: string, p: string, v: number) => call<unknown>('rollbackTo', b, p, v),
  labelVersion: (b: string, d: string, v: number, l: string) => call<void>('labelVersion', b, d, v, l),
  historyCapacity: (b: string) => call<unknown>('historyCapacity', b),
  pruneHistory: (b: string, st: unknown) => call<unknown>('pruneHistory', b, st),

  pickImportFile: () => call<unknown>('pickImportFile'),
  pickForeign: (kind: string) => call<unknown>('pickForeign', kind),
  applyForeign: (b: string, dir: string, chapters: unknown) => call<unknown>('applyForeign', b, dir, chapters),
  rePreviewImport: (f: string, lines?: number[]) => call<unknown>('rePreviewImport', f, lines),
  applyImport: (b: string, dir: string, chapters: unknown, preamble: string | null) =>
    call<unknown>('applyImport', b, dir, chapters, preamble),
  collectForExport: (b: string) => call<unknown[]>('collectForExport', b),
  exportPreview: (chapters: unknown, options: unknown) => call<unknown>('exportPreview', chapters, options),
  exportBook: (kind: string, chapters: unknown, options: unknown, title: string) =>
    call<unknown>('exportBook', kind, chapters, options, title),

  aiStatus: () => call<unknown>('aiStatus'),
  aiSetKey: (provider: string, key: string) => call<void>('aiSetKey', provider, key),
  aiClearKey: (provider: string) => call<void>('aiClearKey', provider),
  aiSetConfig: (patch: unknown) => call<unknown>('aiSetConfig', patch),
  aiTestConnection: () => call<unknown>('aiTestConnection'),
  aiCancel: (id: string) => call<boolean>('aiCancel', id),
  aiEstimate: (b: string, d: string | null, task: string, input: string) =>
    call<unknown>('aiEstimate', b, d, task, input),
  aiRun: (id: string, b: string, d: string | null, task: string, input: string) =>
    call<unknown>('aiRun', id, b, d, task, input),

  outgoingLinks: (p: string, b?: string) => call<unknown[]>('outgoingLinks', p, b),
  editCmd: (kind: string) => call<void>('editCmd', kind),
  planReport: () => call<unknown>('planReport'),
  setNickname: (n: string) => call<unknown>('setNickname', n),
  setPlanTarget: (t: unknown) => call<unknown>('setPlanTarget', t),
  setLeave: (d: string, r: string | null) => call<unknown>('setLeave', d, r),
  listMilestones: (b: string) => call<unknown[]>('listMilestones', b),
  milestoneTargets: (b: string) => call<unknown[]>('milestoneTargets', b),
  addMilestone: (b: string, i: unknown) => call<unknown>('addMilestone', b, i),
  patchMilestone: (b: string, id: string, c: unknown) => call<void>('patchMilestone', b, id, c),
  removeMilestone: (b: string, id: string) => call<void>('removeMilestone', b, id),
  playFrom: (b: string, from: string, st: unknown) => call<unknown>('playFrom', b, from, st),
  exportGameScript: (b: string, engine: string) => call<unknown>('exportGameScript', b, engine),
  scriptReport: (p: string, b?: string) => call<unknown>('scriptReport', p, b),
  loginState: () => call<unknown>('loginState'),
  loginWithBrowser: () => call<unknown>('loginWithBrowser'),
  loginOut: () => call<unknown>('loginOut'),
  loginForget: () => call<unknown>('loginForget'),
  statsMe: () => call<unknown>('statsMe'),
  statsClaimHandle: (h: string) => call<unknown>('statsClaimHandle', h),
  statsPush: () => call<unknown>('statsPush'),
  statsSetAutoPush: (on: boolean) => call<unknown>('statsSetAutoPush', on),
  statsForget: () => call<unknown>('statsForget'),
  statsPublic: (h: string) => call<unknown>('statsPublic', h),
  statsPreview: () => call<unknown>('statsPreview'),
  myAwards: () => call<unknown>('myAwards'),
  pinAward: (id: string) => call<unknown>('pinAward', id),
  bookCast: (b: string) => call<unknown>('bookCast', b),
  createLibraryIdea: (body: string) => call<unknown>('createLibraryIdea', body),
  listLibraryIdeas: () => call<unknown>('listLibraryIdeas'),
  setCastCategories: (b: string, c: string[]) => call<unknown>('setCastCategories', b, c),
  moveSceneIn: (p: string, f: number, t: number) => call<unknown>('moveSceneIn', p, f, t),
  createScript: (d: string, t: string) => call<unknown>('createScript', d, t),
  createGameScript: (d: string, t: string) => call<unknown>('createGameScript', d, t),
  saveAside: (p: string, b: string, sfx: string) => call<unknown>('saveAside', p, b, sfx),
  gameGraph: (b: string, live?: unknown) => call<unknown>('gameGraph', b, live),
  listConflicts: (b: string) => call<unknown[]>('listConflicts', b),
  resolveConflict: (b: string, c: string, a: string) => call<unknown>('resolveConflict', b, c, a),

  createIdea: (b: string, body: string) => call<unknown>('createIdea', b, body),
  listIdeas: (b: string) => call<unknown[]>('listIdeas', b),
  mergeIdea: (b: string, i: string, t: string) => call<unknown>('mergeIdea', b, i, t),
  trashIdea: (b: string, i: string) => call<void>('trashIdea', b, i),

  readDoc: (p: string) => call<unknown>('readDoc', p),
  saveDoc: (p: string, body: string) => call<unknown>('saveDoc', p, body),
  ensureIndexed: (b: string) => call<unknown>('ensureIndexed', b),
  rebuildIndex: (b: string) => call<unknown>('rebuildIndex', b),
  search: (q: string, o?: unknown) => call<unknown>('search', q, o),
  indexStats: (b?: string) => call<unknown>('indexStats', b),

  statsReport: (b: string, o?: unknown) => call<unknown>('statsReport', b, o),
  setPomodoro: (active: boolean) => call<void>('setPomodoro', active),

  todayProgress: (p: string) => call<unknown>('todayProgress', p),
  revealInExplorer: (p: string) => call<void>('revealInExplorer', p),
  appVersion: () => call<string>('appVersion'),
}

/**
 * 菜单事件订阅。
 *
 * 主进程的菜单点了之后往渲染进程发消息，界面自己决定怎么响应。
 * 只暴露一个白名单内的订阅方法，不把 ipcRenderer 本身交出去。
 */
const MENU_CHANNELS = [
  'menu:choose-root',
  'menu:new-book',
  'menu:back-to-shelf',
  'menu:settings',
  'menu:save',
  'menu:find',
  'menu:search',
  'menu:toggle-directory',
  'menu:toggle-tools',
  'menu:about',
  'menu:help',
  'menu:quick-jump',
  'menu:import',
  'menu:export',
  'menu:stats',
] as const

function onMenu(channel: string, fn: () => void): () => void {
  if (!(MENU_CHANNELS as readonly string[]).includes(channel)) {
    throw new Error(`未知的菜单通道：${channel}`)
  }
  const listener = () => fn()
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

/** AI 的流式片段。返回取消订阅的函数 */
function onAiDelta(fn: (e: { requestId: string; kind: 'text' | 'thinking'; text: string }) => void): () => void {
  const listener = (_e: unknown, payload: { requestId: string; kind: 'text' | 'thinking'; text: string }) =>
    fn(payload)
  ipcRenderer.on('ai:delta', listener)
  return () => ipcRenderer.off('ai:delta', listener)
}

contextBridge.exposeInMainWorld('bugu', { ...api, onMenu, onAiDelta })
