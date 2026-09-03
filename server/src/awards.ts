/**
 * 奖状。
 *
 * 规范：更新文档/10-0.4规划.md §2
 *
 * ─────────────────────────────────────────────────────────────
 * 【这不是成就系统】
 *
 * 作者的原话：「成就在服务器，开发者手动给予。用于纪念一些比赛等等，
 * **并不会自动获得，并不是传统的里程碑**。」
 *
 * 所以这儿**没有清单、没有条件、没有自动判定**。它是奖状：
 * 由人发给人，纪念一件具体的事。
 *
 * 因此奖名是**自由文本**，不是从一份枚举里挑 —— 为一次征文去改代码
 * 再部署一遍，这功能就没法用了。
 *
 * 【为什么不进公开接口】
 *
 * 作者定的：只有本人看得见。公开接口仍旧只吐那七个数，一个字段都不加。
 * 这样「对外统计只发七个整数」那句话继续成立，不用改口。
 * ─────────────────────────────────────────────────────────────
 */

/** 一张奖状 */
export interface Award {
  /** 稳定标识，比如 `nano-2026`。同一个人同一个 id 只有一张 */
  id: string
  /** 显示出来的那 2–6 个字 */
  name: string
  /** 说明，比如「2026 年不咕鸟征文 一等奖」。可以空 */
  note: string
  /** 什么时候发的（ISO） */
  at: string
}

export const AWARD_ID_MAX = 40
/** 名字的长度按**字符**算，不按字节 —— 「不咕之星」是 4 个字不是 12 个字节 */
export const NAME_MIN = 2
export const NAME_MAX = 6
export const NOTE_MAX = 200

const ID_RE = /^[a-z0-9][a-z0-9-]*$/

/** 按码点数长度。中文一个字算一个，别拿 UTF-16 的 length 去数 emoji */
function charLen(s: string): number {
  return [...s].length
}

export type Checked<T> = { ok: true; value: T } | { ok: false; why: string }

/**
 * 检查一张要发出去的奖状。
 *
 * 严在**发**这一头，不严在读这一头 —— 发错了要重新发，
 * 而已经发出去的旧数据不该因为规矩变严就读不出来。
 */
export function checkAward(raw: unknown): Checked<Omit<Award, 'at'>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, why: '请求体不是一个对象' }
  }
  const o = raw as Record<string, unknown>

  const id = typeof o['id'] === 'string' ? o['id'].trim().toLowerCase() : ''
  if (!id) return { ok: false, why: '要给这张奖状一个 id' }
  if (id.length > AWARD_ID_MAX) return { ok: false, why: `id 最多 ${AWARD_ID_MAX} 个字符` }
  if (!ID_RE.test(id)) return { ok: false, why: 'id 只能用小写字母、数字和连字符，且要以字母或数字开头' }

  const name = typeof o['name'] === 'string' ? o['name'].trim() : ''
  const n = charLen(name)
  if (n < NAME_MIN || n > NAME_MAX) {
    return { ok: false, why: `奖名要 ${NAME_MIN}–${NAME_MAX} 个字，现在是 ${n} 个` }
  }
  // 换行会把界面上那一行撑坏，而奖名本来就该是一行
  if (/[\r\n\t]/.test(name)) return { ok: false, why: '奖名里不能有换行或制表符' }

  const note = typeof o['note'] === 'string' ? o['note'].trim() : ''
  if (charLen(note) > NOTE_MAX) return { ok: false, why: `说明最多 ${NOTE_MAX} 个字` }

  return { ok: true, value: { id, name, note } }
}

/**
 * 往外发之前再挑一遍。
 *
 * 跟那七个数一个路数：**显式列字段**，数据库里哪天多了一列也漏不出去。
 */
export function toAwardJson(a: Award): Award {
  return { id: a.id, name: a.name, note: a.note, at: a.at }
}

/**
 * 谁能发奖。
 *
 * **不是一种账号，是一张名单。** 名单来自环境变量 `BUGU_ADMIN_SUBS`，
 * 写的是已有账号的 Logto `sub`，逗号或空白分隔。
 *
 * 这么定是为了不引入第二种凭据：另设一个 admin token 意味着多一个
 * 要保管、要轮换、会泄漏的秘密，而它保护的只是发奖状这件事。
 */
export function parseAdminSubs(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean),
  )
}
