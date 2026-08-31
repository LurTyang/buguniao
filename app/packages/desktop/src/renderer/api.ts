/**
 * 渲染进程访问主进程的入口。
 *
 * preload 里为了避免把 core 的类型打进 preload 包，返回值统一是 unknown，
 * 在这里补上类型。契约定义见 src/shared/api.ts。
 */

import type { BuguApi } from '../shared/api.js'

export const api = window.bugu as unknown as BuguApi
