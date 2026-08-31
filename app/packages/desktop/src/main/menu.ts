/**
 * 应用菜单 —— 全中文。
 *
 * Electron 默认菜单是英文的（File / Edit / View…），对一个中文写作软件来说
 * 很出戏。这里整套换成中文，并且**默认隐藏菜单栏**（按 Alt 才显形），
 * 因为本软件的基调是「打开只有一张干净的稿纸」。
 *
 * 「编辑」那几项用的是 Electron 的 role，这样系统级的撤销/复制/粘贴
 * 与输入法交互才是正常的 —— 自己实现反而会和输入法打架。
 */

import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron'

export interface MenuHandlers {
  onChooseRoot(): void
  onNewBook(): void
  onBackToShelf(): void
  onOpenSettings(): void
  onRevealRoot(): void
}

export function buildAppMenu(handlers: MenuHandlers): Menu {
  const send = (win: BrowserWindow | null, channel: string) => win?.webContents.send(channel)

  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '新建作品…',
          accelerator: 'CmdOrCtrl+N',
          click: () => handlers.onNewBook(),
        },
        {
          label: '回到书架',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => handlers.onBackToShelf(),
        },
        { type: 'separator' },
        {
          label: '保存',
          accelerator: 'CmdOrCtrl+S',
          click: () => send(BrowserWindow.getFocusedWindow(), 'menu:save'),
        },
        { type: 'separator' },
        {
          label: '导入 txt…',
          click: () => send(BrowserWindow.getFocusedWindow(), 'menu:import'),
        },
        {
          label: '导出…',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => send(BrowserWindow.getFocusedWindow(), 'menu:export'),
        },
        { type: 'separator' },
        {
          label: '更换作品目录…',
          click: () => handlers.onChooseRoot(),
        },
        {
          label: '在资源管理器中打开作品目录',
          click: () => handlers.onRevealRoot(),
        },
        { type: 'separator' },
        { label: '退出', role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '粘贴为纯文本', role: 'pasteAndMatchStyle' },
        { label: '全选', role: 'selectAll' },
        { type: 'separator' },
        {
          label: '查找…',
          accelerator: 'CmdOrCtrl+F',
          click: () => send(BrowserWindow.getFocusedWindow(), 'menu:find'),
        },
        {
          label: '全文检索…',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => send(BrowserWindow.getFocusedWindow(), 'menu:search'),
        },
        {
          label: '跳到某一章…',
          accelerator: 'CmdOrCtrl+P',
          click: () => send(BrowserWindow.getFocusedWindow(), 'menu:quick-jump'),
        },
      ],
    },
    {
      label: '视图',
      submenu: [
        {
          label: '目录侧边栏',
          accelerator: 'CmdOrCtrl+Shift+\\',
          click: () => send(BrowserWindow.getFocusedWindow(), 'menu:toggle-directory'),
        },
        {
          label: '功能侧边栏',
          accelerator: 'CmdOrCtrl+\\',
          click: () => send(BrowserWindow.getFocusedWindow(), 'menu:toggle-tools'),
        },
        {
          label: '写作统计…',
          click: () => send(BrowserWindow.getFocusedWindow(), 'menu:stats'),
        },
        { type: 'separator' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { label: '实际大小', role: 'resetZoom' },
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen' },
        { type: 'separator' },
        { label: '重新加载', role: 'reload' },
        { label: '开发者工具', role: 'toggleDevTools' },
      ],
    },
    {
      label: '设置',
      submenu: [
        {
          label: '打开设置…',
          accelerator: 'CmdOrCtrl+,',
          click: () => handlers.onOpenSettings(),
        },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '快捷键与上手指引',
          accelerator: 'F1',
          click: () => send(BrowserWindow.getFocusedWindow(), 'menu:help'),
        },
        { type: 'separator' },
        {
          label: `关于不咕鸟（${app.getVersion()}）`,
          click: () => send(BrowserWindow.getFocusedWindow(), 'menu:about'),
        },
        {
          label: '打开开发文档所在目录',
          click: () => void shell.openPath(app.getAppPath()),
        },
      ],
    },
  ]

  return Menu.buildFromTemplate(template)
}
