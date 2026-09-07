/**
 * 双屏的那点算术与规矩。
 *
 * 规范：更新文档/11-0.5规划.md §1
 *
 * ─────────────────────────────────────────────────────────────
 * 纯计算，不碰 DOM 也不碰编辑器 —— 双屏里真正容易错的是**判断**
 * （这一半该不该自己存盘、分隔线拖到哪儿算数），
 * 而判断错了的表现往往是「丢稿」或者「界面挤没了」，
 * 两种都不该靠肉眼发现。
 * ─────────────────────────────────────────────────────────────
 */

// 类型放在 shared 里 —— 主进程存配置时也要认它。
// 两处各写一份的话，迟早有一边多个字段
export type { RightKind, RightSide } from '../shared/split-types.js'
import type { RightSide } from '../shared/split-types.js'

/**
 * 分隔线的位置，左边占的比例。
 *
 * 夹在 0.2–0.8 之间：再窄的一边连一行中文都摆不下，
 * 那时候「双屏」只剩一条缝，还不如没开。
 */
export const MIN_RATIO = 0.2
export const MAX_RATIO = 0.8
export const DEFAULT_RATIO = 0.5

export function clampRatio(r: number): number {
  if (!Number.isFinite(r)) return DEFAULT_RATIO
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, r))
}

/**
 * 拖分隔线时算新的比例。
 *
 * @param x      鼠标在整块区域里的横坐标（像素，从左边缘起算）
 * @param width  整块区域有多宽
 */
export function ratioFromDrag(x: number, width: number): number {
  if (width <= 0) return DEFAULT_RATIO
  return clampRatio(x / width)
}

/**
 * 这一对左右，是不是同一份文档。
 *
 * **这一条决定了两件生死攸关的事**：
 *   · 要不要把两边接到同一根线上（不接 → 各改各的，互相看不见）
 *   · 右边该不该自己存盘（该 → 两条保存链路抢同一个文件，静默丢稿）
 *
 * 所以宁可判得严一点：只有路径一模一样才算。
 */
export function isSameDoc(leftPath: string | null, right: RightSide | null): boolean {
  if (!leftPath || !right) return false
  return right.kind === 'doc' && right.path === leftPath
}

/** 右半边这会儿处于哪种状态 */
export type PaneMode =
  /** 没开双屏 */
  | 'off'
  /** 开了，但右边还没选东西 */
  | 'empty'
  /** 右边是另一份文档，自己读自己存 */
  | 'own'
  /** 右边跟左边是同一份，共享正文，**不自己存** */
  | 'shared'
  /** 右边是随手粘进来的一段字。存进配置，不写文件 */
  | 'scratch'
  /**
   * 右边是一份**书外**的文件。**只读。**
   *
   * 这是一个有意的保守选择：往作者工作目录之外的文件自动存盘，
   * 是最容易毁掉别人东西的一种做法 —— 那份文件可能是别人给的稿子、
   * 可能正被另一个程序打开、可能根本不该被改。
   * 摆在这儿是为了**对照**，要改就在它自己的编辑器里改。
   */
  | 'ref'

export function paneMode(on: boolean, leftPath: string | null, right: RightSide | null): PaneMode {
  if (!on) return 'off'
  if (!right) return 'empty'
  // 便笺没有路径，空的也算「有东西」—— 粘进来之前那一格就该是它
  if (right.kind === 'scratch') return 'scratch'
  if (!right.path) return 'empty'
  if (right.kind === 'file') return 'ref'
  return isSameDoc(leftPath, right) ? 'shared' : 'own'
}

/**
 * 右半边该不该自己存盘。
 *
 * **同一份文档只能有一条保存链路。** 两条的话，两边各自按自己的节奏
 * 往同一个文件写，谁后写谁赢 —— 而两边内容其实是一样的（有那根线在），
 * 所以看不出错，直到某一次时序不巧，丢掉的是刚敲进去的那几句。
 *
 * 由左边那条链路负责存，右边只管显示和改。
 */
export function rightSaves(mode: PaneMode): boolean {
  return mode === 'own'
}

/**
 * 这份内存里的正文，**准不准写到这个路径上**。
 *
 * ─────────────────────────────────────────────────────────────
 * `rightSaves` 只回答「这一半该不该存」，它不知道**手里这份内容是哪一篇的**。
 * 而右半边换文档是异步的：路径先变，内容后到。中间那一小段时间里，
 * 「该存」是真的，「手里的内容」却还是上一篇的。
 *
 * 撞上的两条路：
 *   · 新那篇读失败（被外部删了、没权限）→ 内容永远停在上一篇，
 *     此后任何一次关闭或再换，都会把**上一篇的正文写进新那篇的文件**
 *   · 连着换两次（甲→乙→丙），读乙还在飞的时候就换丙了
 *
 * 两条的后果一样：一篇稿子被另一篇整个覆盖，不报错、不提示。
 * 所以存之前必须核对一次「手里这份是不是就是它」——
 * 这是个一行的判断，但它是丢不丢稿的分界，所以它有名字、有测试。
 * ─────────────────────────────────────────────────────────────
 *
 * @param loadedFor 手里这份正文是**哪个路径**读回来的。还没读到就是 null
 * @param path      这会儿要往哪儿存
 */
export function safeToSave(mode: PaneMode, loadedFor: string | null, path: string): boolean {
  if (!rightSaves(mode)) return false
  if (!path) return false
  return loadedFor === path
}

/**
 * 右半边该不该把内容存进**配置**（而不是文件）。
 *
 * 只有便笺走这条。它不对应任何文件，但也不该关掉软件就没 ——
 * 摆在那儿对照着改的东西，第二天多半还想接着看。
 */
export function rightPersistsScratch(mode: PaneMode): boolean {
  return mode === 'scratch'
}

/** 两边要不要接到同一根线上 */
export function needsLink(mode: PaneMode): boolean {
  return mode === 'shared'
}

/**
 * 一个路径的最后一段（文件名）。
 *
 * ⚠️ **两种分隔符都要切。** 书里的路径是 `/` 拼的，但书**外**那份参考
 * 是拖进来的，在 Windows 上长这样：`D:\参考\旧稿.txt`。
 * 只切 `/` 的话它一刀都切不下去，标题栏上就摆着一整条路径 ——
 * 而标题栏存在的全部意义就是「扫一眼认出这是哪一篇」。
 *
 * 不咕鸟是 Windows 桌面端，所以这不是个边角情况，这是**默认情况**。
 */
export function baseName(p: string): string {
  const segs = p.split(/[\\/]/).filter((s) => s !== '')
  return segs.length > 0 ? (segs[segs.length - 1] as string) : p
}

/**
 * 左边切到别的文档时，右边怎么办。
 *
 * 举例：左右都开着第三章（shared），然后左边点开第五章。
 * 这时候右边**留在第三章**是对的 —— 作者摆在那儿就是要看它。
 * 但两边不再是同一份了，所以要从「共享」退回「各自」，
 * 右边得接手自己的保存。
 *
 * @returns 右边要不要换内容（true = 换成新的左边那篇）
 */
export function rightFollowsLeft(): boolean {
  // 永远不跟。这是一句话就能说清的规矩，写成函数是为了让它有个名字、
  // 有个测试、有个能讲道理的地方 —— 而不是散在组件里的一个 if
  return false
}

/**
 * 右半边的字数**算不算进**顶栏那个数。
 *
 * ─────────────────────────────────────────────────────────────
 * 作者定的：**两边合计。**
 *
 * 原来的备选是「以有焦点的那一半为准」，那条有个当场就能看见的毛病：
 * 数字会跟着点哪儿变。左边点一下 3,200，右边点一下 1,400 ——
 * 同一份活，两个数交替闪，作者没法拿它判断任何事情。
 * 合计是个**稳定**的数：它只在真敲了字的时候变。
 *
 * ⚠️ **只有 `shared` 是例外，而且必须是例外。**
 * 那时候左右是**同一份文档的两个视图** —— 一章三千字，
 * 两边一加就成了六千。那不是「合计」，那是把同一份稿子数了两遍，
 * 而且它偏偏在最有用的那种摆法（对着开头改结尾）上出错。
 *
 * 便笺和书外的参考**算**。它们确实是「摆在右边的另一堆字」，
 * 而作者要的就是两边合计；数字旁边写清楚哪一半贡献了多少，
 * 他一眼能看出这 800 字是参考资料还是他自己写的。
 * ─────────────────────────────────────────────────────────────
 */
export function rightCounts(mode: PaneMode): boolean {
  return mode === 'own' || mode === 'scratch' || mode === 'ref'
}

/** 一份正文的两个字数。跟 core/wordcount 出来的形状一致 */
export interface Counts {
  withPunctuation: number
  withoutPunctuation: number
}

export const ZERO_COUNTS: Counts = { withPunctuation: 0, withoutPunctuation: 0 }

/**
 * 两边合计。
 *
 * @param left  左边这一半的字数
 * @param right 右边那一半的字数。还没读到就传 null
 */
export function totalCounts(left: Counts, right: Counts | null, mode: PaneMode): Counts {
  if (!right || !rightCounts(mode)) return left
  return {
    withPunctuation: left.withPunctuation + right.withPunctuation,
    withoutPunctuation: left.withoutPunctuation + right.withoutPunctuation,
  }
}
