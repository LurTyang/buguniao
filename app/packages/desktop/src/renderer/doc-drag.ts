/**
 * 从目录树里拖一篇文档出来时，通道里放什么。
 *
 * 规范：更新文档/11-0.5规划.md §1.6
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么不复用 sticky-drag.ts】
 *
 * 两种拖长得像，落点却完全不同：
 *
 *   · **便利贴**拖到稿纸上 → 变成一张浮在窗口上的卡片
 *   · **文档**拖进双屏那个虚线框 → 摆到右半边去对照
 *
 * 一张设定集的卡片**两件事都能做**，所以它拖出来时两个类型都放；
 * 而一章正文只能做后一件。靠类型分，不靠落点猜 ——
 * 猜错的表现是「拖过去没反应」，那是最难查的一种坏法。
 *
 * 【这个文件顺手堵掉的那一枪】
 *
 * 从前目录树拖一章时放的是 `text/plain`（内容是那一章的路径），
 * 注释写着「Firefox 要求必须 setData 才会真的开始拖」。
 * 但稿纸里坐着一个 CodeMirror，**它认 text/plain** ——
 * 于是把一章从目录里拖到稿纸上，`正文/第三章.md` 这一串
 * 就被当成正文插进了作者的稿子里，不报错、不提示。
 *
 * 这跟 0.3 那个便利贴的 bug 是同一个（见 sticky-drag.ts 文件头），
 * 只是入口换了一个。**往全局通道里塞东西之前，先问一句「谁还会听见」。**
 * ─────────────────────────────────────────────────────────────
 */

import { isStickyDrag, stickyCardOf } from './sticky-drag.js'
import type { DragLike } from './sticky-drag.js'

export type { DragLike }

/** 拖的是本书里的一篇文档（正文、大纲、设定集卡片都算），值是它的路径 */
export const DOC_DRAG_TYPE = 'application/x-bugu-doc'

/**
 * 拖的是目录树里**只用来排序**的一行（卷）。
 *
 * 它不是一篇能打开的文档，所以绝不能顶 `DOC_DRAG_TYPE` ——
 * 拖一个卷进双屏的虚线框，右半边会拿这个目录路径去读盘，
 * 换来一句「这一篇打不开」，而作者拖的根本不是一篇。
 *
 * 那为什么还要放个类型？因为某些环境下 dragstart 里一次 setData 都没有
 * 就不会真的开始拖。放一个**没人听得懂的**类型，正好满足这条又不惹事。
 */
export const ROW_DRAG_TYPE = 'application/x-bugu-row'

/**
 * 开始拖一篇文档。
 *
 * ⚠️ `effectAllowed` 必须是 `copyMove`，两个都要。
 *
 * 同一次拖有两种落法：拖回目录树里是**排序**（move），
 * 拖进双屏虚线框是**摆一份过去**（copy）。而浏览器会拿 `effectAllowed`
 * 去卡 `dropEffect` —— 只写 `move` 的话，虚线框那边设 `dropEffect='copy'`
 * 会被判为不兼容，**drop 事件根本不触发**。
 * 表现就是「拖过去了，松手没反应」，一行错误都没有。
 */
export function startDocDrag(e: DragLike, path: string): void {
  const dt = e.dataTransfer
  if (!dt) return
  dt.effectAllowed = 'copyMove'
  dt.setData(DOC_DRAG_TYPE, path)
}

/** 开始拖一行「只能排序」的东西（卷）。见 `ROW_DRAG_TYPE` */
export function startRowDrag(e: DragLike): void {
  const dt = e.dataTransfer
  if (!dt) return
  dt.effectAllowed = 'move'
  dt.setData(ROW_DRAG_TYPE, '')
}

/** 这一次拖的是一篇书里的文档吗 */
export function isDocDrag(e: DragLike): boolean {
  return e.dataTransfer?.types.includes(DOC_DRAG_TYPE) ?? false
}

/** 拖的是哪一篇。不是文档拖放时返回空串 */
export function docPathOf(e: DragLike): string {
  return isDocDrag(e) ? (e.dataTransfer?.getData(DOC_DRAG_TYPE) ?? '') : ''
}

/** 往双屏虚线框里拖的，能接的只有这两种 */
export type SplitDropKind =
  /** 书里的一篇，摆到右半边 */
  | 'doc'
  /** 硬盘上的一个文件，当参考摆到右半边（只读） */
  | 'file'
  /** 别的一概不接 */
  | 'none'

/**
 * 虚线框接不接这一次拖，接的话按哪一种处理。
 *
 * ⚠️ **文档要排在文件前面判**，跟 `dropKind()` 里那条同一个道理：
 * 某些平台上一次拖放里会混进 `Files`，顺序反了就会拿一篇书里的稿子
 * 去走「读硬盘文件」那条路。
 *
 * 设定集的卡片同时带着便利贴类型和文档类型，这儿只看文档那个 ——
 * 它在虚线框里的身份就是「书里的一篇」。
 */
export function splitDropKind(e: DragLike): SplitDropKind {
  if (isDocDrag(e)) return 'doc'
  // 便利贴是设定集里的卡片，它也是书里的一篇；从别处拖来的便利贴
  // 没带文档类型时，靠这一条兜住，别让它在框上变成「不接」
  if (isStickyDrag(e)) return 'doc'
  return e.dataTransfer?.types.includes('Files') ? 'file' : 'none'
}

/**
 * 拖进虚线框的这一篇，路径是什么。
 *
 * 两个通道都要问：正文/大纲是 `DOC_DRAG_TYPE`，
 * 而设定集的卡片可能只带着便利贴那个类型（它从 0.3 起就是那么拖的）。
 * 少问一路的表现是「设定集拖过去没反应」。
 */
export function splitDropPath(e: DragLike): string {
  const p = docPathOf(e)
  if (p) return p
  return stickyCardOf(e)
}
