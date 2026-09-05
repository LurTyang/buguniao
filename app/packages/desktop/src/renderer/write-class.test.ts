/**
 * 两边的类名必须一模一样。
 *
 * 界面把 `.bugu-write` 挂到稿纸上，主进程把主题里的 `#write` 规则
 * 镜像到同一个类上。**对不上的话右半边的主题静默失效** ——
 * 不报错、不白屏，只是「怎么右边没跟着变色」，
 * 而那种问题上一版已经查了三轮。
 */
import { describe, it, expect } from 'vitest'
import { WRITE_CLASS as RENDERER } from './write-class.js'
import { WRITE_CLASS as MAIN } from '../main/theme-css.js'

describe('稿纸类名', () => {
  it('界面那份和主进程那份是同一个字符串', () => {
    expect(RENDERER).toBe(MAIN)
  })

  it('是个能直接写进 CSS 的类名', () => {
    expect(RENDERER).toMatch(/^[a-z][a-z0-9-]*$/)
  })
})
