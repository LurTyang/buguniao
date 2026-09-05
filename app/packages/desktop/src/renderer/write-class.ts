/**
 * 稿纸容器的类名。
 *
 * ⚠️ **必须和 main/theme-css.ts 里的 `WRITE_CLASS` 一模一样。**
 * 那边把主题里的 `#write` 规则镜像到这个类上，这边把类挂到 DOM 上 ——
 * 两边对不上的话，右半边的主题会静默地什么都不生效。
 * smoke 里有一步专门量这件事。
 *
 * 为什么不直接从 main/theme-css.ts import：那是主进程的模块，
 * 界面 import 它会把 node:fs 一起拖进渲染进程的包里。
 */
export const WRITE_CLASS = 'bugu-write'
