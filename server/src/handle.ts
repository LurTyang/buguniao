/**
 * 公开短名。
 *
 * Logto 给的 `sub` 是一串随机 ID（`abc123def456`），放进公开地址里
 * 既难看又难念。所以这台服务自己管一张 `sub → handle` 的表，
 * 公开地址长这样：
 *
 *     GET /api/v1/u/mingting/stats
 *
 * ─────────────────────────────────────────────────────────────
 * 【短名的规矩为什么这么紧】
 *
 * 它会出现在**别人网站的地址栏里**，所以：
 *
 * - 只认小写字母、数字、连字符 —— 大小写混着来，别人抄错一个字母
 *   就打不开，而且 `Ming` 和 `ming` 算不算同一个人也说不清
 * - 不许纯数字 —— 将来万一想支持按数字 ID 查，会撞在一起
 * - 保留一批系统词 —— `api`、`admin` 这些放出去，以后想加新路径就晚了
 * ─────────────────────────────────────────────────────────────
 */

export const HANDLE_MIN = 3
export const HANDLE_MAX = 24

const HANDLE_RE = /^[a-z0-9-]+$/

/**
 * 不能被人占走的名字。
 *
 * 放出去之后想收回来，就得动别人已经贴出去的链接 —— 那是不可能的，
 * 所以只能一开始就拦住。宁可多拦几个。
 */
export const RESERVED = new Set([
  'api',
  'admin',
  'administrator',
  'root',
  'me',
  'u',
  'user',
  'users',
  'login',
  'logout',
  'signin',
  'signup',
  'oauth',
  'oidc',
  'auth',
  'callback',
  'health',
  'healthz',
  'status',
  'stats',
  'about',
  'help',
  'docs',
  'support',
  'settings',
  'config',
  'static',
  'assets',
  'public',
  'www',
  'mail',
  'ftp',
  'bugu',
  'buguniao',
  '不咕鸟',
  'null',
  'undefined',
  'true',
  'false',
])

export type HandleCheck = { ok: true; handle: string } | { ok: false; why: string }

export function checkHandle(raw: unknown): HandleCheck {
  if (typeof raw !== 'string') return { ok: false, why: '短名要是一串文字' }
  // 大小写不敏感：统一存小写，免得 Ming 和 ming 算成两个人
  const h = raw.trim().toLowerCase()

  if (h.length < HANDLE_MIN) return { ok: false, why: `短名至少 ${HANDLE_MIN} 个字符` }
  if (h.length > HANDLE_MAX) return { ok: false, why: `短名最多 ${HANDLE_MAX} 个字符` }
  if (!HANDLE_RE.test(h)) return { ok: false, why: '短名只能用小写字母、数字和连字符' }
  if (h.startsWith('-') || h.endsWith('-')) return { ok: false, why: '短名不能以连字符开头或结尾' }
  if (h.includes('--')) return { ok: false, why: '短名里不能有连着的两个连字符' }
  if (/^\d+$/.test(h)) return { ok: false, why: '短名不能全是数字' }
  if (RESERVED.has(h)) return { ok: false, why: `「${h}」是保留名，换一个` }

  return { ok: true, handle: h }
}
