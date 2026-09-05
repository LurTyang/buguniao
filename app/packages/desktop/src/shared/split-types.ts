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

export interface RightSide {
  kind: RightKind
  /** doc：书里的相对路径；file：硬盘上的绝对路径 */
  path: string
}
