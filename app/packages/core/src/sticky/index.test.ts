/**
 * 便利贴 `@` 语法解析器测试。
 *
 * 规范：更新文档/03-数据格式规范.md §4
 * 规则表（2026-08-25 作者定稿，四条互斥且完备）：
 *   A 块标记   该行去空白后恰为 "@"
 *   B 整行     以 @ 开头，且未转义 @ 恰好一个
 *   C 行内     未转义 @ 的个数为不小于 2 的偶数
 *   D 不触发   其余（含三个、五个 @ 的情况）
 */

import { describe, it, expect } from 'vitest'
import {
  scanAts,
  unescapeAt,
  markCodeFences,
  scanHeadings,
  pickTitle,
  parseFloats,
  parseStickyCard,
  renderCardFace,
  lintFloats,
} from './index.js'

/** 测试辅助：只取浮出文本，方便断言 */
const texts = (body: string) => parseFloats(body).map((f) => f.text)
const rules = (body: string) => parseFloats(body).map((f) => f.rule)

// ───────────────────────── 底层扫描 ─────────────────────────

describe('scanAts', () => {
  it('找出所有未转义的 @', () => {
    expect(scanAts('a@b@c')).toEqual([1, 3])
  })

  it('反斜杠转义的 @ 不计入', () => {
    expect(scanAts('10\\@斤')).toEqual([])
    expect(scanAts('a\\@b@c')).toEqual([4])
  })

  it('转义的反斜杠本身不影响后续 @', () => {
    // "a\\@b" —— 第一个反斜杠转义第二个反斜杠，@ 未被转义
    expect(scanAts('a\\\\@b')).toEqual([3])
  })

  it('无 @ 时返回空数组', () => {
    expect(scanAts('普通的一行字')).toEqual([])
  })
})

describe('unescapeAt', () => {
  it('还原 \\@ 为 @', () => {
    expect(unescapeAt('10\\@斤')).toBe('10@斤')
  })
  it('还原 \\\\ 为 \\', () => {
    expect(unescapeAt('a\\\\b')).toBe('a\\b')
  })
  it('不动其他反斜杠序列', () => {
    expect(unescapeAt('a\\nb')).toBe('a\\nb')
  })
})

describe('markCodeFences', () => {
  it('标出围栏内的行', () => {
    const lines = ['前', '```', '内', '```', '后']
    expect(markCodeFences(lines)).toEqual([false, true, true, true, false])
  })

  it('未闭合的围栏一直延伸到文末', () => {
    const lines = ['前', '```', '内', '还是内']
    expect(markCodeFences(lines)).toEqual([false, true, true, true])
  })

  it('带语言标注的围栏能正确开启', () => {
    const lines = ['```ts', 'const a = 1', '```']
    expect(markCodeFences(lines)).toEqual([true, true, true])
  })

  it('波浪线围栏同样有效，且与反引号互不闭合', () => {
    const lines = ['~~~', '```', '~~~']
    expect(markCodeFences(lines)).toEqual([true, true, true])
  })
})

// ───────────────────────── 规则 A：块标记 ─────────────────────────

describe('规则 A · 块标记', () => {
  it('两个独占行 @ 之间的内容整块浮出', () => {
    const body = ['@', '外貌：断眉', '惯用兵器：短刀', '@', '不浮出的正文'].join('\n')
    expect(texts(body)).toEqual(['外貌：断眉\n惯用兵器：短刀'])
    expect(rules(body)).toEqual(['block'])
  })

  it('块内保留换行结构（含内部空行）', () => {
    const body = ['@', '第一段', '', '第二段', '@'].join('\n')
    expect(texts(body)).toEqual(['第一段\n\n第二段'])
  })

  it('块首尾的空行被去掉', () => {
    const body = ['@', '', '内容', '', '@'].join('\n')
    expect(texts(body)).toEqual(['内容'])
  })

  it('未配对的块浮出到文末', () => {
    const body = ['@', '一直到最后', '都算浮出'].join('\n')
    expect(texts(body)).toEqual(['一直到最后\n都算浮出'])
  })

  it('空块不产生片段', () => {
    expect(texts(['@', '@'].join('\n'))).toEqual([])
  })

  it('块内的 @ 不再二次解析（B/C 规则失效）', () => {
    const body = ['@', '@这行在块里', '年龄：@十七@', '@'].join('\n')
    expect(texts(body)).toEqual(['@这行在块里\n年龄：@十七@'])
    expect(rules(body)).toEqual(['block'])
  })

  it('块标记行允许有前后空白', () => {
    const body = ['   @  ', '内容', '\t@\t'].join('\n')
    expect(texts(body)).toEqual(['内容'])
  })

  it('连续两个块各自独立', () => {
    const body = ['@', 'A', '@', '中间', '@', 'B', '@'].join('\n')
    expect(texts(body)).toEqual(['A', 'B'])
  })
})

// ───────────────────────── 规则 B：整行标记 ─────────────────────────

describe('规则 B · 整行标记', () => {
  it('行首 @ 后跟内容 → 整行浮出，不含 @ 本身', () => {
    const body = '@表面身份：城南药铺学徒'
    expect(texts(body)).toEqual(['表面身份：城南药铺学徒'])
    expect(rules(body)).toEqual(['line'])
  })

  it('@ 后的空格被去掉', () => {
    expect(texts('@   表面身份：学徒')).toEqual(['表面身份：学徒'])
  })

  it('行首有缩进也算行首 @', () => {
    expect(texts('   @缩进的一行')).toEqual(['缩进的一行'])
  })

  it('【作者定稿】三个 @ 即使在行首也不整行浮出', () => {
    // 「仅一个的时候，考虑整行浮出。三个或五个，也不会整行浮出」
    expect(texts('@a@b@')).toEqual([])
  })

  it('五个 @ 同理不触发', () => {
    expect(texts('@a@b@c@d@')).toEqual([])
  })

  it('恰好一个 @ 且在行首才整行浮出', () => {
    expect(rules('@只有一个')).toEqual(['line'])
  })

  it('行首 @ 后无内容且非独占行（只有空白）→ 不产生空片段', () => {
    expect(texts('@   ')).toEqual([])
  })
})

// ───────────────────────── 规则 C：行内标记 ─────────────────────────

describe('规则 C · 行内标记', () => {
  it('一对 @ 之间的内容浮出', () => {
    const body = '年龄：@十七岁@，实为三百余岁。'
    expect(texts(body)).toEqual(['十七岁'])
    expect(rules(body)).toEqual(['inline'])
  })

  it('多对 @ 依次浮出', () => {
    const body = '@甲@和@乙@都要'
    // 行首 @ 但个数为偶数(4) → 走规则 C
    expect(texts(body)).toEqual(['甲', '乙'])
    expect(rules(body)).toEqual(['inline', 'inline'])
  })

  it('【修正点】行首 @ 且偶数个 → 走行内配对而非整行', () => {
    const body = '@十七岁@，实为三百余岁'
    expect(texts(body)).toEqual(['十七岁'])
    expect(rules(body)).toEqual(['inline'])
  })

  it('空的一对 @@ 不产生片段', () => {
    expect(texts('前@@后')).toEqual([])
  })

  it('对内内容首尾空白被去掉', () => {
    expect(texts('年龄：@  十七岁  @')).toEqual(['十七岁'])
  })
})

// ───────────────────────── 规则 D：不触发 ─────────────────────────

describe('规则 D · 不触发', () => {
  it('邮箱不触发', () => {
    expect(texts('联系方式 lisi@qq.com')).toEqual([])
  })

  it('奇数个 @ 且不在行首 → 不触发', () => {
    expect(texts('a@b@c@d')).toEqual([])
  })

  it('转义的 @ 不触发', () => {
    expect(texts('价格 10\\@斤')).toEqual([])
  })

  it('转义后剩余奇数个真 @ 且非行首 → 不触发', () => {
    expect(texts('a\\@b@c')).toEqual([])
  })

  it('代码块内的 @ 一律不触发', () => {
    const body = ['```', '@这在代码块里', '年龄：@十七@', '```'].join('\n')
    expect(texts(body)).toEqual([])
  })

  it('代码块结束后恢复解析', () => {
    const body = ['```', '@不算', '```', '@算'].join('\n')
    expect(texts(body)).toEqual(['算'])
  })

  it('空文档', () => {
    expect(texts('')).toEqual([])
  })
})

// ───────────────────────── 标题提取 ─────────────────────────

describe('pickTitle', () => {
  const T = (body: string, fileName = '某文件.md') => {
    const lines = body.split('\n')
    const fence = markCodeFences(lines)
    return pickTitle(scanHeadings(lines, fence), fileName)
  }

  it('取第一个一级标题', () => {
    expect(T('# 李四\n\n## 别的').title).toBe('李四')
    expect(T('# 李四').source).toBe('h1')
  })

  it('有多个一级标题时取第一个', () => {
    expect(T('# 第一个\n# 第二个').title).toBe('第一个')
  })

  it('无一级标题时取最高级别标题的第一个', () => {
    const r = T('## 甲\n### 丙\n## 乙')
    expect(r.title).toBe('甲')
    expect(r.source).toBe('top-heading')
  })

  it('最高级别标题不在最前面时也能正确取到', () => {
    const r = T('### 丙\n## 甲\n## 乙')
    expect(r.title).toBe('甲')
  })

  it('无任何标题时用文件名，且去掉 .md', () => {
    const r = T('就是一段普通文字', '王五.md')
    expect(r.title).toBe('王五')
    expect(r.source).toBe('filename')
  })

  it('代码块里的 # 不算标题', () => {
    const r = T('```\n# 这是注释不是标题\n```\n\n## 真标题', '兜底.md')
    expect(r.title).toBe('真标题')
  })

  it('闭合式标题 `## 标题 ##` 能去掉尾部井号', () => {
    expect(T('## 甲 ##').title).toBe('甲')
  })

  it('# 后没有空格的不算标题（符合 CommonMark）', () => {
    const r = T('#不是标题', '兜底.md')
    expect(r.source).toBe('filename')
  })
})

// ───────────────────────── 规范文档中的完整示例 ─────────────────────────

describe('03-数据格式规范 §4.5 的完整示例', () => {
  const body = [
    '# 李四',
    '',
    '年龄：@十七岁@，实为三百余岁。',
    '',
    '@表面身份：城南药铺学徒',
    '',
    '@',
    '外貌：断眉，左手常年缠布',
    '惯用兵器：一把无锋的短刀',
    '@',
    '',
    '（下面是不浮出的详细背景）',
    '李四本名不叫李四，他真正的姓氏……',
    '联系方式记在这里 lisi@qq.com',
    '价格 10\\@斤',
  ].join('\n')

  it('解析出正确的卡片', () => {
    const card = parseStickyCard(body, {
      docId: 'set-x9k2m1',
      fileName: '李四.md',
      category: '人物',
    })

    expect(card.title).toBe('李四')
    expect(card.titleSource).toBe('h1')
    expect(card.category).toBe('人物')
    expect(card.docId).toBe('set-x9k2m1')
    expect(card.floats.map((f) => f.text)).toEqual([
      '十七岁',
      '表面身份：城南药铺学徒',
      '外貌：断眉，左手常年缠布\n惯用兵器：一把无锋的短刀',
    ])
    expect(card.floats.map((f) => f.rule)).toEqual(['inline', 'line', 'block'])
  })

  it('卡片正面渲染符合规范里画的样子', () => {
    const card = parseStickyCard(body, { docId: 'd', fileName: '李四.md' })
    expect(renderCardFace(card.floats)).toBe(
      ['十七岁', '表面身份：城南药铺学徒', '外貌：断眉，左手常年缠布', '惯用兵器：一把无锋的短刀'].join(
        '\n',
      ),
    )
  })

  it('浮出片段带正确的行号，可用于点击定位', () => {
    const card = parseStickyCard(body, { docId: 'd', fileName: '李四.md' })
    expect(card.floats.map((f) => f.line)).toEqual([2, 4, 7])
  })
})

// ───────────────────────── 健壮性 ─────────────────────────

describe('健壮性', () => {
  it('CRLF 换行也能正确解析', () => {
    const body = '@\r\n外貌：断眉\r\n@\r\n'
    expect(texts(body)).toEqual(['外貌：断眉'])
  })

  it('超长文档不炸（10000 行）', () => {
    const lines: string[] = []
    for (let i = 0; i < 10000; i++) lines.push(i % 100 === 0 ? `@第 ${i} 行` : `普通第 ${i} 行`)
    const result = parseFloats(lines.join('\n'))
    expect(result).toHaveLength(100)
    expect(result[0]?.text).toBe('第 0 行')
  })

  it('全是 @ 的文档不死循环', () => {
    const body = new Array(50).fill('@').join('\n')
    expect(() => parseFloats(body)).not.toThrow()
    expect(texts(body)).toEqual([])
  })

  it('没有分类时 category 为 null', () => {
    const card = parseStickyCard('# 甲', { docId: 'd', fileName: '甲.md' })
    expect(card.category).toBeNull()
  })
})

describe('lintFloats · 语法提示', () => {
  it('三个 @ 的行给出提示', () => {
    const l = lintFloats('@甲@乙@')
    expect(l).toHaveLength(1)
    expect(l[0]?.code).toBe('odd-ats')
    expect(l[0]?.message).toContain('3 个')
  })

  it('五个 @ 也提示', () => {
    expect(lintFloats('@a@b@c@d@')[0]?.code).toBe('odd-ats')
  })

  it('恰好一个 @ 不提示（那是合法的整行浮出）', () => {
    expect(lintFloats('@表面身份：学徒')).toEqual([])
  })

  it('偶数个 @ 不提示', () => {
    expect(lintFloats('年龄：@十七岁@，实为三百余岁')).toEqual([])
  })

  it('邮箱不提示（单个 @，本来就是普通字符）', () => {
    expect(lintFloats('联系方式 lisi@qq.com')).toEqual([])
  })

  it('未闭合的块给出提示', () => {
    const l = lintFloats('@\n内容一直到文末')
    expect(l).toHaveLength(1)
    expect(l[0]?.code).toBe('unclosed-block')
  })

  it('正常闭合的块不提示', () => {
    expect(lintFloats('@\n内容\n@')).toEqual([])
  })

  it('块内的奇数 @ 不提示（块内本来就不解析）', () => {
    expect(lintFloats('@\n@甲@乙@\n@')).toEqual([])
  })

  it('代码块内不提示', () => {
    expect(lintFloats('```\n@甲@乙@\n```')).toEqual([])
  })

  it('带出行号与原始内容，供界面定位', () => {
    const l = lintFloats('第一行\n@甲@乙@')
    expect(l[0]?.line).toBe(1)
    expect(l[0]?.text).toBe('@甲@乙@')
  })

  it('干净的文档没有提示', () => {
    const body = ['# 李四', '', '年龄：@十七岁@', '@身份：学徒', '@', '外貌：断眉', '@'].join('\n')
    expect(lintFloats(body)).toEqual([])
  })
})
