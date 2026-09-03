/**
 * 看着 smoke.ts 自己别写坏。
 *
 * ─────────────────────────────────────────────────────────────
 * 冒烟脚本里有几段**发到页面里去执行的 JS 源码**，它们住在 TS 模板
 * 字符串里。这个位置有两个坑，我各踩了不止一次：
 *
 *   1. 注释里写一个反引号 → 模板当场闭合，整个构建挂掉，
 *      而报错指向的行跟真正的原因看着毫无关系。
 *   2. 字符串里写一个反斜杠的 `\n` → TS 先把它变成真换行，
 *      发过去的 JS 字符串断在半路（SyntaxError）。
 *
 * 两个都是**构建期或运行期才炸**，而且炸得离原因很远。
 * 与其下次再花二十分钟顺藤摸瓜，不如在这儿一秒钟扫一遍。
 * ─────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(path.join(HERE, 'smoke.ts'), 'utf8')

const BQ = String.fromCharCode(96)
const BS = String.fromCharCode(92)

/** 那几个「发到页面里跑」的模板字符串 */
const SCRIPTS = ['E2E_SCRIPT', 'LOGIN_SCRIPT', 'OPEN_BOOK_SCRIPT', 'SETUP_FOCUS']

/** 取出 `const NAME = ` 后面那一整个模板字符串的内容 */
function bodyOf(name: string): string {
  const head = SRC.indexOf(`const ${name} = ${BQ}`)
  if (head < 0) return ''
  const from = head + `const ${name} = ${BQ}`.length
  const to = SRC.indexOf(BQ, from)
  return to < 0 ? SRC.slice(from) : SRC.slice(from, to)
}

describe('冒烟脚本里的模板字符串', () => {
  it('每一段都还在 —— 名字改了这个测试要跟着改，不能默默失效', () => {
    for (const name of SCRIPTS) {
      expect(bodyOf(name).length, `${name} 没找到`).toBeGreaterThan(0)
    }
  })

  it('【关键】里面一个反引号都不许有 —— 有一个就把模板闭掉了', () => {
    for (const name of SCRIPTS) {
      expect(bodyOf(name).includes(BQ), `${name} 里有反引号`).toBe(false)
    }
  })

  it('【关键】字符串里的换行要写两个反斜杠，不然发过去就断了', () => {
    for (const name of SCRIPTS) {
      const body = bodyOf(name)
      // 单个反斜杠后面跟 n：写成了 \n，TS 会先把它变成真换行
      const lone = new RegExp(`(^|[^${BS}${BS}])${BS}${BS}n`, 'g')
      const hit = body.match(lone)
      expect(hit, `${name} 里有写成一个反斜杠的换行：${hit?.join(' ')}`).toBe(null)
    }
  })

  it('没有真的换行符混在这些字符串字面量里', () => {
    for (const name of SCRIPTS) {
      // 单引号字符串跨行 = 一定是上一条那个坑造成的
      for (const line of bodyOf(name).split('\n')) {
        const quotes = (line.match(/'/g) ?? []).length
        expect(quotes % 2, `${name} 有一行的单引号数是奇数：${line.trim()}`).toBe(0)
      }
    }
  })
})
