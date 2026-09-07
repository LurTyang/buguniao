/**
 * 双屏右半边摆什么。
 *
 * 单独一个文件，是因为主进程（存配置）和界面（渲染）都要认它，
 * 而 renderer/split.ts 里全是只有界面用得上的算术。
 */

/** 右边摆的是什么 */
export type RightKind =
  /** 本书里的另一篇（正文、大纲、设定集都算） */
  | 'doc'
  /** 手边一份不属于这本书的文件。**不进目录树** */
  | 'file'
  /**
   * 随手粘进来的一段字。
   *
   * 它**不对应硬盘上任何文件** —— 从别处复制一段设定、一段旧稿摆在旁边
   * 对照着改，是改稿时最常做的事之一，而为它专门存一个文件是多余的负担
   * （存哪儿？什么时候删？）。所以它就活在配置里，随手来随手去。
   */
  | 'scratch'

export interface RightSide {
  kind: RightKind
  /** doc：书里的相对路径；file：硬盘上的绝对路径 */
  path: string
}

/**
 * 便笺最多留多少个字。
 *
 * 20 万字符 —— 摆在旁边对照的一段设定、一段旧稿，几千字就顶天了，
 * 给到二十万已经宽得离谱。它拦的是「整本书 Ctrl+A、Ctrl+V 进来」那一下。
 *
 * ⚠️ **为什么必须有这个数**：便笺是存进**配置文件**的，而配置每改一个
 * 字段都要把整份 JSON 重写一遍。里头躺着几 MB 正文，就意味着此后
 * 每一次「换个主题」「拖一下分隔线」都要顺带把那几 MB 重写一遍。
 */
export const MAX_SCRATCH = 200_000

/**
 * 便笺截到上限以内。
 *
 * **截掉，而不是拒绝。** 粘进来的是参考资料，作者要的是「看见前面这一段」，
 * 不是「全有或全无」—— 拒绝掉他只会得到一个空白的右半边，还不知道为什么。
 * 截了就在末尾写一行说清楚，别让他以为自己粘漏了。
 */
export function clampScratch(text: string): string {
  if (text.length <= MAX_SCRATCH) return text
  const dropped = text.length - MAX_SCRATCH
  return `${text.slice(0, MAX_SCRATCH)}\n\n…（还有 ${dropped} 个字没放进来 —— 便笺最多 ${MAX_SCRATCH} 字。要摆一整篇，把文件拖进来。）`
}
