/**
 * 用户配置。
 *
 * 存在应用数据目录（`%APPDATA%/bugu/config.json`），**绝不放进同步文件夹** ——
 * 里面有设备标识和本机专属的路径，跟着同步走只会互相打架。
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { app } from 'electron'

export interface UserConfig {
  schemaVersion: number
  /** 作品根目录的绝对路径（通常在坚果云同步文件夹里）。未设置为 null */
  root: string | null
  /** 本机的设备标识，用于 .bugu/ 下的分片文件名 */
  deviceId: string
  /**
   * 这台机器叫什么（默认取主机名）。
   *
   * 「这一篇在别处改过」的对话框要显示它 —— 只说「另一台设备」等于没说，
   * 作者得看见是「书房台式机」还是「公司笔记本」才决定得了要哪一版。
   */
  deviceName: string
  /** 字数口径：含标点 / 不含标点 */
  countMode: 'withPunctuation' | 'withoutPunctuation'
  /**
   * 主题。见 renderer/themes.ts —— 那一份是唯一的名单，
   * 这里存的只是它的 key，主进程不该知道哪个主题长什么样。
   */
  theme: string
  /**
   * 自定义主题 CSS 文件的绝对路径。空 = 不用。
   *
   * **Typora 的主题文件可以直接选。** 它们排版正文用的是 `#write`，
   * 所以稿纸容器也顶着这个 id —— 字体、字号、行距、标题、引用、代码块
   * 这些正文样式基本能直接用上。界面（侧边栏、按钮）不受它影响：
   * 一份为「一整个窗口就是文档」写的 CSS，套到有侧边栏的界面上只会更难看。
   */
  themeCss: string
  /**
   * 正文字体。存的是 key（`kai`/`song`/`hei`），CSS 字体栈由界面那边翻译，
   * 见 `renderer/fonts.ts`。主进程不该知道 CSS 长什么样。
   */
  fontFamily: string
  fontSize: number
  lineHeight: number
  /** 稿纸最大宽度（px） */
  pageWidth: number
  /** 左右侧边栏是否互换 */
  sidebarSwapped: boolean
  /**
   * 两个侧边栏钉住了没有。
   *
   * **钉住是个决定，不是个手势。** 作者钉上它是因为他要一直看着目录，
   * 那这件事就该跨重启活着 —— 每次开软件都得重钉一遍，等于这个功能没做
   * （作者报过这个）。
   */
  dirBarPinned: boolean
  toolBarPinned: boolean
  /** 上手指引看过了没有。只在第一次进书架时自动弹一次 */
  seenGuide: boolean
  /** 已经看过图文说明的页面：shelf / novel / script / game */
  seenTours: string[]
  /**
   * 隔半小时自动把那七个数推到对外统计服务。
   *
   * **默认关着，得作者自己打开。** 「有东西在往外发」这件事必须是他按下的，
   * 不能是装完软件就默认在跑 —— 那种事只要发生一次，他就再也不信这个软件了。
   * 登录状态和短名是另外两道闸，三样齐了才真的会推。
   */
  statsAutoPush: boolean
  /** 上次推成功是什么时候（ISO，本机时间）。空 = 一次都没推过 */
  statsLastPushAt: string
  /**
   * 两个侧边栏各自的宽度（像素）。
   *
   * **按面板记，不按左右记** —— 作者把哪个面板拖宽，是因为那个面板的内容多，
   * 跟它当时摆在左边还是右边没关系。互换之后宽度要跟着面板走。
   */
  dirBarWidth: number
  toolBarWidth: number
  /**
   * 上次离开时人在哪儿。null = 没有记录（第一次用，或者上次是在书架上关的）。
   *
   * 存在本机配置里而不是作品目录里：**这是「这台电脑上的我」的位置**，
   * 跟着同步跑到另一台电脑上只会打架。
   */
  lastPlace: { bookPath: string; docPath: string; line: number } | null
}

const DEFAULTS: Omit<UserConfig, 'deviceId'> = {
  schemaVersion: 1,
  root: null,
  countMode: 'withPunctuation',
  theme: 'light',
  themeCss: '',
  fontFamily: 'kai',
  fontSize: 18,
  lineHeight: 1.9,
  pageWidth: 720,
  sidebarSwapped: false,
  dirBarPinned: false,
  toolBarPinned: false,
  seenGuide: false,
  seenTours: [],
  statsAutoPush: false,
  statsLastPushAt: '',
  deviceName: '',
  dirBarWidth: 250,
  // 功能栏比目录栏宽一点 —— AI 设置那一屏字段多，250 装不下
  toolBarWidth: 300,
  lastPlace: null,
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

/** 设备标识：`pc-` + 6 位随机。一旦生成就不再变 */
/** 默认设备名：主机名。取不到就退回设备号，总比空着强 */
function defaultDeviceName(id: string): string {
  try {
    const h = os.hostname().trim()
    if (h) return h
  } catch {
    /* 拿不到就算了 */
  }
  return id
}

function newDeviceId(): string {
  let s = ''
  for (let i = 0; i < 6; i++) s += Math.floor(Math.random() * 36).toString(36)
  return `pc-${s}`
}

let cache: UserConfig | null = null

export async function loadConfig(): Promise<UserConfig> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(configPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<UserConfig>
    const id = parsed.deviceId ?? newDeviceId()
    cache = { ...DEFAULTS, deviceId: id, ...parsed }
    if (!cache.deviceName) cache.deviceName = defaultDeviceName(id)
  } catch {
    // 配置坏了或不存在都不该拦住启动 —— 用默认值重建一份
    const id = newDeviceId()
    cache = { ...DEFAULTS, deviceId: id, deviceName: defaultDeviceName(id) }
    await saveConfig(cache)
  }
  return cache
}

export async function saveConfig(next: UserConfig): Promise<void> {
  cache = next
  const p = configPath()
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, JSON.stringify(next, null, 2), 'utf8')
}

export async function patchConfig(patch: Partial<UserConfig>): Promise<UserConfig> {
  const next = { ...(await loadConfig()), ...patch }
  await saveConfig(next)
  return next
}
