/**
 * 拖便利贴用的那一小撮约定。
 *
 * 规范：更新文档/04-界面与交互设计.md §3
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么这三行要单独一个文件】
 *
 * 因为它们必须**三处一模一样**：目录树（发起拖）、编辑器（挡住拖）、
 * 稿纸（接住拖）。散在三个文件里各写一遍字符串，对不上的那天
 * 不会报错 —— 只会让 0.3 那个 bug 悄悄回来。
 *
 * 那个 bug 是这样的：目录树拖便利贴时顺手 `setData('text/plain', 卡片标题)`，
 * 而稿纸里坐着一个 CodeMirror，它认 `text/plain`。于是作者从设定集
 * 拖一张人物卡到稿纸上，**卡片标题被当成正文插进了他的稿子**，
 * 不报错、不提示。他还以为那是功能。
 *
 * 当初加 `text/plain` 的理由是「Firefox 要求 setData 才会开始拖」——
 * 但自定义类型同样算 setData，那一行从头到尾就是多余的。
 *
 * **往全局通道里塞东西之前，先问一句「谁还会听见」。**
 * ─────────────────────────────────────────────────────────────
 */

/** 拖便利贴时用的自定义 MIME 类型。三处共用这一个常量 */
export const STICKY_DRAG_TYPE = 'application/x-bugu-sticky'

/** 拖放事件里那点东西。浏览器的 DataTransfer 和测试里的假货都满足它 */
export interface DragLike {
  dataTransfer: {
    types: readonly string[]
    setData(type: string, value: string): void
    getData(type: string): string
    effectAllowed?: string
    dropEffect?: string
  } | null
}

/**
 * 开始拖一张便利贴。
 *
 * **只放自定义类型，绝不放 `text/plain`** —— 理由见文件头。
 */
export function startStickyDrag(e: DragLike, cardPath: string): void {
  const dt = e.dataTransfer
  if (!dt) return
  dt.effectAllowed = 'copy'
  dt.setData(STICKY_DRAG_TYPE, cardPath)
}

/** 这一次拖的是便利贴吗 */
export function isStickyDrag(e: DragLike): boolean {
  return e.dataTransfer?.types.includes(STICKY_DRAG_TYPE) ?? false
}

/** 拖的是哪张卡。不是便利贴拖放时返回空串 */
export function stickyCardOf(e: DragLike): string {
  return isStickyDrag(e) ? (e.dataTransfer?.getData(STICKY_DRAG_TYPE) ?? '') : ''
}
