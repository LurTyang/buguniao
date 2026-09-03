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
import { migrateConfig } from './config-migrate.js'
import type { ThemeDraft } from '../shared/theme-draft.js'
import { EMPTY_SLOT as _EMPTY, type ThemeSlot } from '../shared/theme-slots.js'
import type { Award } from '@bugu/core'

/**
 * 一个自选样式的槽位。
 *
 * **存名字和颜色，不只是路径** —— 作者要求给自定义主题取名，
 * 而色块要跟那份主题的稿纸颜色一致。每次都去读一遍 CSS 再抠一次
 * 太慢（书架每次打开都要画那排色块），所以导入时算好存下来。
 *
 * 类型和「末尾永远留一个空位」那套规矩都在 shared/theme-slots.ts ——
 * 界面那边也要用同一套，不能各写一份。
 */
export type { ThemeSlot } from '../shared/theme-slots.js'

export { EMPTY_SLOT } from '../shared/theme-slots.js'

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
   * 自选样式的三个槽位（存的是 CSS 文件路径，空串 = 这一格空着）。
   *
   * **三个而不是一个**，是因为作者报的：换回预设主题之后想换回自选样式，
   * 得重新走一遍选文件 —— 而他手上就那两三份主题，来回换是常事。
   * 槽位一填就留着，切换只是点一下。
   */
  themeCssSlots: ThemeSlot[]
  /** 现在用第几个槽位。-1 = 不用自选样式（用上面那三档预设） */
  themeCssActive: number
  /** 0.4 之前只有一个位置。留着只为了把老配置搬进槽位 0 */
  themeCss: string
  /**
   * 调色器手上那份**还在改的**草稿。null = 还没调过。
   *
   * ⚠️ 它**不是**「正在用的主题」—— 用的那套在栏位里（`themeCssSlots`）。
   * 这一份的唯一作用是：调色器关掉再打开时能接着改，
   * 不至于每次都从预设重来。
   *
   * 存值不存文件，是因为它要能随时接着改：存成文件再读回来
   * 就得反过来解析 CSS，那一步只要有一处解错，作者的配色就丢了。
   * 导出成 .css 是**另一件事**，不影响这份草稿。
   */
  themeDraft: ThemeDraft | null
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
   * 服务器上那些奖状的**本地副本**。
   *
   * 留一份是为了**离线时它别消失** —— 奖状是拿到手的东西，
   * 不该因为今天没网就从界面上没了。每次读 /me 成功都刷新这一份。
   */
  statsAwards: Award[]
  /** 挂哪一张（奖状 id）。空 = 挂最新的那张 */
  statsAwardPinned: string
  /**
   * 每个主题各自的字号。
   *
   * 夜间想大一号是常见需求 —— 深色底上同样的字号会显得小。
   * 换主题时自动换回那一档上次用的字号，换完不用再手动调一遍。
   */
  fontSizeByTheme: Record<string, number>
  /**
   * 自己导进来的字体。key 是字体名（CSS 里用它），值是文件名。
   *
   * 字体文件**复制进 `userData/fonts/`**，不是记原路径 ——
   * 记路径的话，他哪天清理下载文件夹，字体就没了。
   */
  customFonts: Record<string, string>
  /**
   * 打字机模式 —— 竖向：当前行停在屏幕中部。
   *
   * 长篇作者一坐两三个小时，眼睛一路走到屏幕底再跳回顶部，一天几百次。
   */
  typewriterV: boolean
  /**
   * 打字机模式 —— 横向：当前列停在水平中央，稿纸横着动。
   *
   * ⚠️ **打开它会关掉自动折行**，两者互斥：折行时一行永远填不满，
   * 光标也就永远走不到右边，横向根本没得动。
   */
  typewriterH: boolean
  /** 专注模式：当前段落之外的字变淡 */
  focusMode: boolean
  /** 稿纸上下留白（像素）。0 = 老样子，顶着边 */
  pagePadY: number
  /**
   * 首行缩进几个字。0 = 不缩进。
   *
   * 是 CSS 的 text-indent，**文件里一个全角空格都不存**（03 §2）。
   * 要真的写进文件的那种，走导出（见 §4.7）。
   */
  paraIndent: number
  /** 智能替换的总开关 */
  smartReplace: boolean
  /**
   * 标点替换的规则表。
   *
   * **一张表，没有「内置」和「自定义」之分** —— 出厂那几条只是
   * 第一次用时的初始值，之后作者改哪条、删哪条都归他管。
   * 存在即生效，不存在即删除；所以这里也没有 enabled。
   *
   * 空数组 = 一条都不替换。`null` = 还没初始化过，该写入出厂那几条。
   */
  smartRules: Array<
    | { id: string; kind: 'plain'; from: string; to: string }
    | { id: string; kind: 'pair'; from: string; open: string; close: string }
  > | null
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
  // 默认就一个空位 —— 它同时是「加一份主题」那个按钮
  themeCssSlots: [{ ..._EMPTY }],
  themeCssActive: -1,
  themeDraft: null,
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
  statsAwards: [],
  statsAwardPinned: '',
  fontSizeByTheme: {},
  customFonts: {},
  typewriterV: false,
  typewriterH: false,
  focusMode: false,
  pagePadY: 0,
  paraIndent: 2,
  // 智能替换默认开着：中文标点是每天几百次的摩擦，
  // 而它每一条都能单独关，也能一键全关
  smartReplace: true,
  smartRules: null,
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
    /*
     * 先把老形状搬成新形状，再往默认值上盖。
     *
     * **顺序很要紧**：搬完再盖，才轮得到迁移的结果覆盖掉老字段。
     * 反过来的话老值会把迁移结果又盖回去。
     *
     * 这一层存在的理由：0.4 中途把 smartRules 从「开关对象」改成了
     * 「规则数组」，而升级上来的配置里还是对象 —— 渲染进程一调
     * `.filter` 就炸，整个界面白屏。本地永远试不出来，因为本地是新配置。
     */
    const moved = migrateConfig(parsed as Record<string, unknown>)
    const id = parsed.deviceId ?? newDeviceId()
    cache = { ...DEFAULTS, deviceId: id, ...parsed, ...moved } as UserConfig
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
