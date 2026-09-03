/**
 * 自定义主题的栏位。
 *
 * 规范：更新文档/04-界面与交互设计.md §7.5
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么从固定三格改成会长的一排】
 *
 * 0.4 早先是**三个固定槽位**，空的那几格画成虚线的「＋」。
 * 问题有两个：
 *
 *   · 三个是我拍的数，凭什么是三个？作者手上有十来份主题。
 *   · 调色器做出来之后，自己调的每一套也要有地方放 ——
 *     三格连别人的主题都不够摆。
 *
 * 现在的规矩只有一条：**末尾永远留一个空位，直到满九个。**
 *
 * 这一条同时解决了「怎么加」和「加到哪儿」——
 * 空位就是「加」这个按钮，用掉它，后面立刻又长一个。
 * 界面上不需要另外放一个「新建」，也不需要「最多几个」的说明：
 * 满了空位自己消失，那比一句话管用。
 *
 * 九是上限：再多一排就摆不下、也认不出来了。
 *
 * 【一个栏位可以是两种东西】
 *
 *   · 一份 CSS 文件（`path`）—— 导进来的，Typora 主题就是这种
 *   · 一套自己调的（`draft`）—— 调色器存的值
 *
 * 存的东西不一样，但**在界面上完全一样**：一个色块、双击换、右键改名、
 * 叉掉删除。作者不需要记得哪个是哪种。
 * ─────────────────────────────────────────────────────────────
 */

import type { ThemeDraft } from './theme-draft.js'

export interface ThemeSlot {
  /** CSS 文件路径。自制主题时是空串 */
  path: string
  /** 自制主题的草稿。导入的文件主题时是 null */
  draft: ThemeDraft | null
  name: string
  /** 稿纸底色。空串 = 没抠出来，界面用当前主题的色 */
  color: string
}

/** 最多几个。再多一排就摆不下、也认不出来了 */
export const MAX_SLOTS = 9

export const EMPTY_SLOT: ThemeSlot = { path: '', draft: null, name: '', color: '' }

export function isEmptySlot(s: ThemeSlot | undefined): boolean {
  return !s || (!s.path && !s.draft)
}

/**
 * 收拾成「该有的样子」：中间不留空位，末尾留且只留一个空位。
 *
 * 满九个之后不再补空位 —— 空位消失本身就是「满了」这句话。
 */
export function normalizeSlots(list: readonly ThemeSlot[]): ThemeSlot[] {
  const filled = list.filter((s) => !isEmptySlot(s)).slice(0, MAX_SLOTS)
  return filled.length >= MAX_SLOTS ? filled : [...filled, { ...EMPTY_SLOT }]
}

/**
 * 往第 `i` 格放一份主题。
 *
 * `i` 越界或指着空位时都往末尾那个空位放 —— 这两种情况在使用上是同一件事：
 * 「加一份新的」。
 *
 * @returns 收拾好的表，以及这份主题最后落在第几格
 */
export function putSlot(
  list: readonly ThemeSlot[],
  i: number,
  slot: ThemeSlot,
): { slots: ThemeSlot[]; at: number } {
  const base = normalizeSlots(list)
  const inRange = Number.isInteger(i) && i >= 0 && i < base.length
  // 指着已有的那一格就覆盖它，别的情况一律追加
  const at = inRange && !isEmptySlot(base[i]) ? i : base.findIndex(isEmptySlot)

  if (at < 0) {
    // 满九个了还要加：拒绝，让调用方去说这句话。
    // 悄悄挤掉最老的那一份，比不让加更糟 —— 那是别人调了半天的配色
    return { slots: base, at: -1 }
  }

  const next = [...base]
  next[at] = slot
  return { slots: normalizeSlots(next), at }
}

/**
 * 删掉第 `i` 格，并把「正在用第几格」跟着挪。
 *
 * 删的是**整格**，不是把它清空 —— 清空会在中间留个洞，
 * 而那个洞看起来跟末尾的空位一模一样，点下去却是另一回事。
 */
export function removeSlot(
  list: readonly ThemeSlot[],
  i: number,
  active: number,
): { slots: ThemeSlot[]; active: number } {
  const base = normalizeSlots(list)
  if (i < 0 || i >= base.length || isEmptySlot(base[i])) {
    return { slots: base, active }
  }
  const slots = normalizeSlots(base.filter((_, k) => k !== i))

  /*
   * 正在用的那一格被删了 → 回预设。
   * 删的是它前面的 → 序号往前挪一格，不然会「换主题」。
   */
  const nextActive = active === i ? -1 : active > i ? active - 1 : active
  return { slots, active: nextActive }
}

/** 还能不能再加。界面上「满了」那句话按它来说 */
export function canAdd(list: readonly ThemeSlot[]): boolean {
  return normalizeSlots(list).some(isEmptySlot)
}
