/**
 * 检查有没有新版本 —— 纯计算那一半。
 *
 * ─────────────────────────────────────────────────────────────
 * 【这件事的形状】
 *
 * 服务器上摆一个几 KB 的 `latest.json`（清单），里头写着最新版是什么、
 * 包在哪儿下、SHA-256 是多少。软件启动时读它一次，比一下版本号。
 *
 * **下载地址写在清单里，不写在软件里。** 这一条是有意的：
 * 哪天换个host（自己的服务器、GitHub、对象存储、某个网盘），
 * 只要改那份清单，已经装在别人机器上的软件就跟着换过去了 ——
 * 不用为了换个下载地址再发一版。
 *
 * 【两条安全底线，都在这个文件里守】
 *
 * 1. **下载地址必须是 https。** 这软件没有代码签名证书，
 *    一个从明文 http 下来的安装包被人半路换掉，作者的读者就中招了。
 * 2. **必须带 SHA-256，而且格式得对。** 那串哈希是唯一能证明
 *    「这个包是作者发的」的东西（发布清单里一直记着它，见
 *    `release/历史版本/README.md`）。装之前核对，对不上就不装。
 *
 * 清单读坏了（host 配错、返回了一页 HTML、字段缺）一律当作**没有更新**，
 * 绝不抛 —— 一个装饰性的检查不该有能力打扰正在写字的人。
 * ─────────────────────────────────────────────────────────────
 */

/** 一个包。`kind` 由调用方按自己是哪种装法挑 */
export interface UpdateAsset {
  url: string
  /** 字节数。只用来显示「要下 99.9 MB」，不参与校验 */
  size: number
  sha256: string
}

export interface UpdateManifest {
  /** 语义版本，比如 1.1.0 */
  version: string
  /** 版本名，比如「被遗忘的旋律」。界面上要说人话 */
  name: string
  /** YYYY-MM-DD */
  date: string
  /** 一句话说这一版改了什么 */
  notes: string
  /** 「看看改了什么」点过去的网页。可以是 Release 页 */
  page: string
  /** 安装版。免安装版用户看不到它 */
  setup: UpdateAsset | null
  /** 免安装版 */
  portable: UpdateAsset | null
}

const SHA256_RE = /^[0-9a-f]{64}$/i

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * 一个包读不读得过。**这儿是那两条安全底线落地的地方。**
 */
function asset(v: unknown): UpdateAsset | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const url = str(o['url'])
  const sha256 = str(o['sha256']).toLowerCase()
  // 明文 http 一概不认 —— 半路被换掉的安装包会直接在读者机器上跑起来
  if (!/^https:\/\//i.test(url)) return null
  if (!SHA256_RE.test(sha256)) return null
  const size = Number(o['size'])
  return { url, sha256, size: Number.isFinite(size) && size > 0 ? Math.round(size) : 0 }
}

/** 版本号切成「数字段」+「预发布段」。`1.0.0-preview.3` → [[1,0,0], ['preview',3]] */
function parts(v: string): { core: number[]; pre: Array<string | number> } {
  const [head = '', ...rest] = v.trim().replace(/^v/i, '').split('-')
  const core = head.split('.').map((x) => {
    const n = Number(x)
    return Number.isFinite(n) ? n : 0
  })
  const pre = rest
    .join('-')
    .split('.')
    .filter((x) => x !== '')
    .map((x) => {
      const n = Number(x)
      return Number.isFinite(n) ? n : x
    })
  return { core, pre }
}

/**
 * 比版本号。`a` 比 `b` 新返回 1，旧返回 -1，一样返回 0。
 *
 * ⚠️ **有预发布段的比没有的旧**：`1.0.0` 比 `1.0.0-preview.3` 新。
 * 少了这一条，装着 preview 的人永远收不到正式版的提示 ——
 * 而那正是最该提示的一次。
 */
export function compareVersions(a: string, b: string): number {
  const A = parts(a)
  const B = parts(b)
  const len = Math.max(A.core.length, B.core.length)
  for (let i = 0; i < len; i++) {
    const x = A.core[i] ?? 0
    const y = B.core[i] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  // 数字段一样：谁没有预发布段谁新
  if (A.pre.length === 0 && B.pre.length === 0) return 0
  if (A.pre.length === 0) return 1
  if (B.pre.length === 0) return -1

  const plen = Math.max(A.pre.length, B.pre.length)
  for (let i = 0; i < plen; i++) {
    const x = A.pre[i]
    const y = B.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    // 数字比字符串小（semver 的规矩），两个数字比大小，两个字符串按字典序
    if (typeof x === 'number' && typeof y === 'number') return x > y ? 1 : -1
    if (typeof x === 'number') return -1
    if (typeof y === 'number') return 1
    return x > y ? 1 : -1
  }
  return 0
}

/** 服务器上那一版比手上这一版新吗 */
export function isNewer(remote: string, current: string): boolean {
  return compareVersions(remote, current) > 0
}

/**
 * 把清单读成形状对的东西。读不出来返回 null（**当作没有更新**）。
 *
 * 要求：有版本号、至少有一个包过了那两条安全底线。
 * 少了任何一样都返回 null —— 一份读不懂的清单和没有清单，处理方式应该一样。
 */
export function parseManifest(raw: unknown): UpdateManifest | null {
  let data: unknown = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const o = data as Record<string, unknown>

  const version = str(o['version'])
  if (version === '' || !/^\d/.test(version.replace(/^v/i, ''))) return null

  const setup = asset(o['setup'])
  const portable = asset(o['portable'])
  if (!setup && !portable) return null

  const page = str(o['page'])
  return {
    version: version.replace(/^v/i, ''),
    name: str(o['name']),
    date: str(o['date']),
    notes: str(o['notes']),
    // 网页地址同样只认 https。清单能改，那这儿就是个能被改坏的地方
    page: /^https:\/\//i.test(page) ? page : '',
    setup,
    portable,
  }
}

/**
 * 这台机器该下哪个包。
 *
 * @param installed 安装版还是免安装版。免安装版**装不了自己** ——
 *   正在跑的那个 exe 没法被替换掉，所以只能把新包下下来、告诉作者它在哪儿。
 */
export function pickAsset(m: UpdateManifest, installed: boolean): UpdateAsset | null {
  return installed ? (m.setup ?? m.portable) : (m.portable ?? m.setup)
}

/**
 * 查完之后交给界面的东西。
 *
 * 放在 shared 是因为界面要认这个形状；查的动作在主进程
 * （要联网、要读代理设置、要知道自己是哪种装法）。
 */
export interface UpdateCheck {
  /** 有新版本时才有东西；已经是最新、或者查不通，都是 null */
  found: {
    manifest: UpdateManifest
    asset: UpdateAsset
    /** 这台机器能不能一键装上（免安装版不能） */
    canInstall: boolean
  } | null
  /** 当前版本，界面上要显示「1.0.0 → 1.1.0」 */
  current: string
  /** 查不通时的一句话。**界面默认不显示它** —— 只在作者手动点「检查更新」时才说 */
  error: string | null
}
