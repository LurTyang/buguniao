/**
 * 便利贴 `@` 语法解析器。
 *
 * 规范：更新文档/03-数据格式规范.md §4
 *
 * ⚠️ 这是全项目最容易出微妙 bug 的模块。改动前先看 index.test.ts，
 *    任何行为变更都必须先有失败的测试用例。
 *
 * ─────────────────────────────────────────────────────────────
 * 【四条规则】（2026-08-25 由作者定稿）
 *
 *   A 块标记   该行去空白后恰为 "@"
 *   B 整行     以 @ 开头，且未转义 @ **恰好一个**
 *   C 行内     未转义 @ 的个数为不小于 2 的偶数 → 两两配对
 *   D 不触发   其余
 *
 * 四条互斥且完备，判定结果与书写顺序无关。几个关键判定：
 *
 *   @表面身份：城南药铺学徒      1 个 @ 且在行首 → B，整行浮出
 *   年龄：@十七岁@，实为三百余岁  2 个 @         → C，浮出「十七岁」
 *   @十七岁@，实为三百余岁        2 个 @         → C（不是 B）
 *   lisi@qq.com                1 个 @ 不在行首 → D，普通字符
 *   @甲@乙@                    3 个 @          → D，不触发
 *
 * 最后一条是作者明确定的：「仅一个的时候，考虑整行浮出。三个或五个，
 * 也不会整行浮出」。奇数但多于一个通常是手误，不触发比猜错强 ——
 * 编辑器会用本文件末尾的 lintFloats() 在那一行给出提示。
 * ─────────────────────────────────────────────────────────────
 */

import type { FloatSegment, StickyCard } from '../types/index.js'

// ───────────────────────── 底层扫描 ─────────────────────────

/**
 * 返回该行中所有**未转义** `@` 的下标。
 * `\@` 视为字面量，不计入。
 */
export function scanAts(line: string): number[] {
  const out: number[] = []
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\') {
      // 反斜杠转义下一个字符，跳过它
      i++
      continue
    }
    if (ch === '@') out.push(i)
  }
  return out
}

/** 把 `\@` 还原成 `@`，`\\` 还原成 `\`。用于产出浮出文本。 */
export function unescapeAt(s: string): string {
  return s.replace(/\\([@\\])/g, '$1')
}

/**
 * 标出哪些行处于 ``` 围栏代码块内部（含围栏行本身）。
 * 代码块内的 `@` 与 `#` 一律不解析。
 */
export function markCodeFences(lines: string[]): boolean[] {
  const inFence = new Array<boolean>(lines.length).fill(false)
  let open = false
  let fenceChar = ''
  let fenceLen = 0

  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? '').trim()
    const m = /^(`{3,}|~{3,})/.exec(trimmed)
    if (m) {
      const marker = m[1] as string
      const ch = marker[0] as string
      if (!open) {
        open = true
        fenceChar = ch
        fenceLen = marker.length
        inFence[i] = true
        continue
      }
      // 闭合围栏必须是同种字符、且不短于开启围栏，且其后无其他内容
      if (ch === fenceChar && marker.length >= fenceLen && trimmed === marker) {
        inFence[i] = true
        open = false
        continue
      }
    }
    inFence[i] = open
  }
  return inFence
}

// ───────────────────────── 标题提取 ─────────────────────────

interface Heading {
  level: number
  text: string
  line: number
}

/** 提取所有 ATX 标题（`# xxx`），跳过代码块内的。 */
export function scanHeadings(lines: string[], inFence: boolean[]): Heading[] {
  const out: Heading[] = []
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i]) continue
    const m = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(lines[i] ?? '')
    if (!m) continue
    // 去掉可能存在的尾部闭合井号：`## 标题 ##`
    const text = (m[2] as string).replace(/\s+#+\s*$/, '').trim()
    if (text) out.push({ level: (m[1] as string).length, text, line: i })
  }
  return out
}

/**
 * 卡片标题规则（03 §4.2）：
 *   1. 第一个 `#`（一级标题）
 *   2. 若无 `#`，取文档中出现的**最高级别**标题的第一个
 *   3. 若无任何标题，用文件名
 */
export function pickTitle(
  headings: Heading[],
  fallbackFileName: string,
): { title: string; source: StickyCard['titleSource'] } {
  const h1 = headings.find((h) => h.level === 1)
  if (h1) return { title: h1.text, source: 'h1' }

  if (headings.length > 0) {
    let top = headings[0] as Heading
    for (const h of headings) {
      if (h.level < top.level) top = h
    }
    // 同级取第一个（headings 已按行号升序，找到最小 level 后取首个该 level）
    const first = headings.find((h) => h.level === top.level) as Heading
    return { title: first.text, source: 'top-heading' }
  }

  return { title: fallbackFileName.replace(/\.md$/i, ''), source: 'filename' }
}

// ───────────────────────── 浮出解析 ─────────────────────────

/**
 * 解析出所有浮出片段。输入应为**已剥离 front-matter 的正文**。
 */
export function parseFloats(body: string): FloatSegment[] {
  const lines = body.split(/\r?\n/)
  const inFence = markCodeFences(lines)
  const out: FloatSegment[] = []

  for (let i = 0; i < lines.length; i++) {
    if (inFence[i]) continue
    const raw = lines[i] ?? ''
    const trimmed = raw.trim()

    // ── 规则 A：块标记 ──
    if (trimmed === '@') {
      const startLine = i + 1
      let j = i + 1
      while (j < lines.length) {
        if (!inFence[j] && (lines[j] ?? '').trim() === '@') break
        j++
      }
      // j 指向闭合的独占行 @，或越界（未配对 → 浮出到文末）
      const chunk = lines.slice(startLine, j)
      const text = unescapeAt(trimStructural(chunk).join('\n'))
      if (text.length > 0) {
        out.push({ rule: 'block', text, line: startLine })
      }
      // 块内不再二次解析：直接跳到闭合行之后
      i = j
      continue
    }

    const ats = scanAts(raw)
    if (ats.length === 0) continue

    // ── 规则 B：以 @ 开头且**恰好一个** @ → 整行浮出 ──
    // 三个五个不算（作者定：「仅一个的时候，考虑整行浮出」），落到规则 D。
    if (trimmed.startsWith('@') && ats.length === 1) {
      const firstAt = ats[0] as number
      const text = unescapeAt(raw.slice(firstAt + 1)).trim()
      if (text.length > 0) out.push({ rule: 'line', text, line: i })
      continue
    }

    // ── 规则 C：偶数个（>=2）@ → 依次成对浮出 ──
    if (ats.length >= 2 && ats.length % 2 === 0) {
      for (let k = 0; k + 1 < ats.length; k += 2) {
        const a = ats[k] as number
        const b = ats[k + 1] as number
        const text = unescapeAt(raw.slice(a + 1, b)).trim()
        if (text.length > 0) out.push({ rule: 'inline', text, line: i })
      }
      continue
    }

    // ── 规则 D：不触发 ──
  }

  return out
}

/** 去掉块首尾的空行，但保留块内部的空行结构。 */
function trimStructural(chunk: string[]): string[] {
  let s = 0
  let e = chunk.length
  while (s < e && (chunk[s] ?? '').trim() === '') s++
  while (e > s && (chunk[e - 1] ?? '').trim() === '') e--
  return chunk.slice(s, e)
}

// ───────────────────────── 对外主入口 ─────────────────────────

export interface ParseStickyOptions {
  docId: string
  /** 文件名（含或不含 .md 均可），用于无标题时兜底 */
  fileName: string
  /** 所在分类文件夹名；根目录下传 null */
  category?: string | null
}

/**
 * 把一篇设定集文档解析成一张便利贴。
 *
 * ⚠️ 只应对 `type: setting` 的文档调用。正文、大纲、灵感里的 `@`
 *    是普通字符，调用方负责不要把它们送进来。
 */
export function parseStickyCard(body: string, opts: ParseStickyOptions): StickyCard {
  const lines = body.split(/\r?\n/)
  const inFence = markCodeFences(lines)
  const headings = scanHeadings(lines, inFence)
  const { title, source } = pickTitle(headings, opts.fileName)

  return {
    docId: opts.docId,
    title,
    titleSource: source,
    floats: parseFloats(body),
    category: opts.category ?? null,
  }
}

/** 把浮出片段拼成卡片正面显示的纯文本（块保留换行，其余各占一行）。 */
export function renderCardFace(floats: FloatSegment[]): string {
  return floats.map((f) => f.text).join('\n')
}

// ───────────────────────── 语法提示 ─────────────────────────

export interface FloatLint {
  line: number
  /** 原始行内容，供界面显示 */
  text: string
  code: 'odd-ats' | 'unclosed-block'
  message: string
}

/**
 * 检查设定集文档里「看起来想浮出、但实际不会生效」的行。
 *
 * 这是给编辑器用的 —— 作者写了三个 `@` 却什么都没浮出来时，
 * 与其让他对着卡片发呆，不如直接在那一行旁边点个小黄点说明原因。
 * 只提示，不自动改。
 */
export function lintFloats(body: string): FloatLint[] {
  const lines = body.split(/\r?\n/)
  const inFence = markCodeFences(lines)
  const out: FloatLint[] = []
  let openBlockLine: number | null = null

  for (let i = 0; i < lines.length; i++) {
    if (inFence[i]) continue
    const raw = lines[i] ?? ''
    const trimmed = raw.trim()

    if (trimmed === '@') {
      openBlockLine = openBlockLine === null ? i : null
      continue
    }
    if (openBlockLine !== null) continue // 块内不检查

    const n = scanAts(raw).length
    if (n > 1 && n % 2 === 1) {
      out.push({
        line: i,
        text: raw,
        code: 'odd-ats',
        message: `这一行有 ${n} 个 @，无法两两配对，不会浮出。删掉一个或补上一个。`,
      })
    }
  }

  if (openBlockLine !== null) {
    out.push({
      line: openBlockLine,
      text: lines[openBlockLine] ?? '@',
      code: 'unclosed-block',
      message: '这个 @ 没有配对的结束行，从这里到文末的内容都会浮出。',
    })
  }

  return out
}
