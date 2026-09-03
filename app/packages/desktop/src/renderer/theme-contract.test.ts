/**
 * 主题变量契约的看门测试。
 *
 * ─────────────────────────────────────────────────────────────
 * 它盯的不是代码对不对，是**文档和代码有没有走散**。
 *
 * `themes.ts` 里加了一个变量、`主题模板/不咕鸟示例主题.css` 忘了写，
 * 后果不是报错 —— 是照着模板改主题的人，永远不知道还有那么一个变量。
 * 这种「少了一句话」的坏法没有任何运行时症状，只能靠这里钉住。
 *
 * 反过来也钉：模板里写了个代码根本不读的变量，那是在骗人。
 * ─────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { THEMES, declsOf } from './themes.js'
import { DRAFT_FIELDS } from '../shared/theme-draft.js'

// 从这个文件出发往上五层就是仓库根：renderer → src → desktop → packages → app → 根
const HERE = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE = path.resolve(HERE, '../../../..', '..', '主题模板/不咕鸟示例主题.css')

/** 代码实际会写进页面的那些变量名 */
function contractNames(): string[] {
  return declsOf(THEMES[0]!).map((d) => d.slice(0, d.indexOf(':')))
}

describe('主题变量契约', () => {
  it('模板文件在', () => {
    expect(fs.existsSync(TEMPLATE)).toBe(true)
  })

  it('代码写的每一个变量，模板里都写着 —— 少一个就等于没人知道它存在', () => {
    const css = fs.readFileSync(TEMPLATE, 'utf8')
    const missing = contractNames().filter((n) => !new RegExp(n + '\\s*:').test(css))
    expect(missing).toEqual([])
  })

  it('模板里不许有代码不读的变量 —— 那是在骗照着改的人', () => {
    const css = fs.readFileSync(TEMPLATE, 'utf8')
    const inRoot = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')))
    const declared = [...inRoot.matchAll(/(--[a-z0-9-]+)\\s*:/g)].map((m) => m[1]!)
    const known = new Set(contractNames())
    expect(declared.filter((n) => !known.has(n))).toEqual([])
  })

  it('模板带 Theme Name —— 导入后设置里显示的就是它', () => {
    expect(fs.readFileSync(TEMPLATE, 'utf8')).toContain('Theme Name:')
  })

  it('凡是 Typora 有的概念，用的就是 Typora 那个名字', () => {
    // 这几个是「对齐」这件事的全部意义所在。改掉任何一个，
    // 一份 Typora 主题拿过来就有一块颜色改不动
    const TYPORA = [
      '--bg-color',
      '--side-bar-bg-color',
      '--text-color',
      '--control-text-color',
      '--md-char-color',
      '--primary-color',
      '--item-hover-bg-color',
      '--window-border',
      '--select-text-bg-color',
      '--active-file-bg-color',
      '--active-file-text-color',
      '--code-block-bg-color',
    ]
    const names = new Set(contractNames())
    expect(TYPORA.filter((n) => !names.has(n))).toEqual([])
  })

  it('每套内置主题给出的变量都一样多 —— 缺一个就是那一档少块颜色', () => {
    const n = declsOf(THEMES[0]!).length
    for (const t of THEMES) expect(declsOf(t).length).toBe(n)
  })

  it('没有空值 —— 空的 var() 会静默退回继承值，找起来极难', () => {
    for (const t of THEMES) {
      for (const d of declsOf(t)) {
        expect(d.slice(d.indexOf(':') + 1).trim().length).toBeGreaterThan(0)
      }
    }
  })
})

describe('调色器覆盖整份契约', () => {
  it('代码写进页面的每一个变量，调色器里都调得到', () => {
    const known = new Set(DRAFT_FIELDS.map((f) => f.name))
    expect(contractNames().filter((n) => !known.has(n))).toEqual([])
  })

  it('调色器里没有代码不读的变量 —— 调了半天不生效最气人', () => {
    const known = new Set(contractNames())
    expect(DRAFT_FIELDS.map((f) => f.name).filter((n) => !known.has(n))).toEqual([])
  })
})
