/**
 * 把 AI 的回答拆成界面能用的结构。
 *
 * 规范：更新文档/05-功能模块详述.md §9.5
 *
 * 续写要给出**三个能分别采纳**的方向、润色要能看出改了哪几个字、
 * 抓虫要是一条条能点开跳转的清单 —— 这些都得先把模型吐出来的一坨文字拆开。
 *
 * ─────────────────────────────────────────────────────────────
 * 【一条铁律：解析失败绝不能吞掉内容】
 *
 * 模型不是每次都听话。格式没对上的时候，**原文必须原样交给界面**，
 * 顶多退化成「一整块，只能整段插入」。
 * 少给一个按钮是小事；作者等了三十秒结果看见空白，那是把他的时间和钱都烧了。
 * ─────────────────────────────────────────────────────────────
 */

import { diffChars } from 'diff'

// ───────────────────────── 续写 ─────────────────────────

export interface Continuation {
  /** 一句话说明这个方向是什么 */
  gist: string
  /** 正文，可以直接插进稿子里 */
  text: string
}

/** 续写的分隔标记。提示词里要求模型照这个格式写 */
const CONT_HEAD = /^#{2,4}\s*方向\s*([一二三四五1-5])\s*[：:、.．]?\s*(.*)$/

/**
 * 拆出几个续写方向。
 *
 * 拆不出来时返回单个方向、gist 为空 —— 界面照样能显示和插入，
 * 只是少了「分别采纳」这一层。
 */
export function parseContinuations(raw: string): Continuation[] {
  const lines = raw.split('\n')
  const out: Continuation[] = []
  let cur: Continuation | null = null

  for (const line of lines) {
    const m = CONT_HEAD.exec(line.trim())
    if (m) {
      if (cur) out.push(cur)
      cur = { gist: (m[2] ?? '').trim(), text: '' }
    } else if (cur) {
      cur.text += (cur.text ? '\n' : '') + line
    }
  }
  if (cur) out.push(cur)

  const cleaned = out
    .map((c) => ({ gist: c.gist, text: c.text.trim() }))
    .filter((c) => c.text !== '' || c.gist !== '')

  // 一个都没拆出来：整坨当一个方向交回去，绝不丢内容
  if (cleaned.length === 0) {
    const t = raw.trim()
    return t ? [{ gist: '', text: t }] : []
  }
  return cleaned
}

// ───────────────────────── 润色 ─────────────────────────

export interface PolishResult {
  /** 润色后的完整文字。这是能插回稿子的那部分 */
  text: string
  /** 模型说明它改了什么 */
  notes: string
  /** 有没有认出规定的格式。没认出时 text 是整坨原样返回 */
  structured: boolean
}

const POLISH_TEXT = /^#{2,4}\s*(?:润色结果|改后|结果)\s*$/
const POLISH_NOTES = /^#{2,4}\s*(?:改动说明|说明|改了什么)\s*$/

/**
 * 把「润色后的正文」和「改动说明」分开。
 *
 * 分不开就整坨当正文 —— 那样插进稿子会带上说明文字，
 * 但那是作者点了「插入」才会发生的事，他看得见。
 */
export function parsePolish(raw: string): PolishResult {
  const lines = raw.split('\n')
  let mode: 'none' | 'text' | 'notes' = 'none'
  const text: string[] = []
  const notes: string[] = []

  for (const line of lines) {
    const t = line.trim()
    if (POLISH_TEXT.test(t)) {
      mode = 'text'
      continue
    }
    if (POLISH_NOTES.test(t)) {
      mode = 'notes'
      continue
    }
    if (mode === 'text') text.push(line)
    else if (mode === 'notes') notes.push(line)
  }

  if (text.length === 0) return { text: raw.trim(), notes: '', structured: false }
  return { text: text.join('\n').trim(), notes: notes.join('\n').trim(), structured: true }
}

// ───────────────────────── 抓虫 ─────────────────────────

export interface Bug {
  title: string
  /** 前后矛盾 / 人设崩坏 / 时间线错误 / 设定冲突 / 伏笔遗漏 …… */
  kind: string
  /** 引用的原文，用来在正文里定位 */
  quote: string
  /** 为什么是问题 */
  why: string
}

const BUG_HEAD = /^#{2,4}\s*\d*\s*[．.、]?\s*(.+)$/
const BUG_FIELD = /^[-*]\s*(类型|位置|为什么|原因)\s*[：:]\s*(.*)$/

/**
 * 把抓虫结果拆成一条条。
 *
 * 拆不出来时返回空数组，界面退回显示原文 ——
 * 「没找到问题」和「格式没对上」是两回事，不能混。
 */
export function parseProofread(raw: string): Bug[] {
  const lines = raw.split('\n')
  const out: Bug[] = []
  let cur: Bug | null = null
  let lastField: keyof Bug | null = null

  const push = () => {
    if (cur && (cur.quote || cur.why)) out.push(cur)
    cur = null
    lastField = null
  }

  for (const line of lines) {
    const t = line.trim()
    if (t === '') continue

    const f = BUG_FIELD.exec(t)
    if (f && cur) {
      const key = f[1]
      const val = (f[2] ?? '').trim()
      if (key === '类型') {
        cur.kind = val
        lastField = 'kind'
      } else if (key === '位置') {
        cur.quote = val
        lastField = 'quote'
      } else {
        cur.why = val
        lastField = 'why'
      }
      continue
    }

    const h = t.startsWith('#') ? BUG_HEAD.exec(t) : null
    if (h) {
      push()
      cur = { title: (h[1] ?? '').trim(), kind: '', quote: '', why: '' }
      continue
    }

    // 续行：接到刚才那个字段上（模型经常把原文引用换行写）
    if (cur && lastField && lastField !== 'kind') {
      cur[lastField] += (cur[lastField] ? '\n' : '') + t
    }
  }
  push()
  return out
}

// ───────────────────────── 逐字对比 ─────────────────────────

export interface InlineSeg {
  kind: 'same' | 'add' | 'del'
  text: string
}

/**
 * 逐字对比，给润色用。
 *
 * 冲突副本那边用的是**按行**对比，因为那要看的是「整段哪边更好」。
 * 润色不一样 —— 作者要看的是「它到底动了我哪几个字」，
 * 按行比会把整段标成一删一增，等于什么都没说。
 */
export function compareInline(before: string, after: string): InlineSeg[] {
  const parts = diffChars(before, after)
  const out: InlineSeg[] = []
  for (const p of parts) {
    if (p.value === '') continue
    const kind: InlineSeg['kind'] = p.added ? 'add' : p.removed ? 'del' : 'same'
    // 相邻同类合并，免得界面画出一堆一个字的小块
    const last = out[out.length - 1]
    if (last && last.kind === kind) last.text += p.value
    else out.push({ kind, text: p.value })
  }
  return out
}

/** 改了多少字。界面上一句话概括用 */
export function countChanges(segs: readonly InlineSeg[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const s of segs) {
    if (s.kind === 'add') added += [...s.text].length
    if (s.kind === 'del') removed += [...s.text].length
  }
  return { added, removed }
}
