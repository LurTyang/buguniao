/**
 * 游戏剧本：节点、跳转、分支、变量。
 *
 * 规范：更新文档/03-数据格式规范.md §游戏剧本、05-功能模块详述.md §14
 *
 * ─────────────────────────────────────────────────────────────
 * 【还是那条铁律：不发明一套只有本软件认识的东西】
 *
 * 游戏剧本比小说多出来的只有四样：**节点、选项、跳转、变量**。
 * 所以只加四种写法，每一种都是记事本里看得懂的：
 *
 *     # 初见                      ← 节点，标题文字就是它的名字
 *
 *     李四：你是新来的？
 *
 *     - 点头 -> 承认               ← 选项：显示文字 + 跳到哪
 *     - {好感度>=3} 搭话 -> 熟络    ← 带条件的选项
 *
 *     $ 好感度 += 1                ← 变量操作
 *
 *     -> 放学                      ← 直接跳转
 *     -> 【结束】                   ← 结局（方括号 = 显式结局）
 *     -> ↩ 放学                    ← 显式回绕（跳回前面出现过的节点）
 *     -> 图书馆、天台、社团         ← 一行列多个去处，每个自动成为一个选项
 *     <- 承认、冷场                 ← 合并：那几个节点都流到这个节点来
 *
 * 为什么用 `$` 和 `{}`：`@` 是便利贴、`<!--` 是伏笔、`[[]]` 是双链、
 * `#` 是节点、`（）` 是动作 —— 全占了。`$` 和 `{}` 是仅剩的干净符号，
 * 而且 `$` 在游戏脚本里本来就是「设变量」的惯例写法。
 * ─────────────────────────────────────────────────────────────
 *
 * 跳转**跨文件**：整本书的正文一起建图。游戏剧本一个节点一个文件、
 * 或者一章多个节点都很常见，跳不出文件就没法写大型分支。
 */

import { countWords } from '../wordcount/index.js'
import { parseScriptLine } from '../script/index.js'

/**
 * 结局的保留名。
 *
 * ⚠️ 这几个名字只是**兜底**：`-> 结束` 在书里没有叫「结束」的节点时才算结局。
 * 真有一个节点叫「结束」，那就是跳到那个节点 —— 作者给节点起名叫「结束」
 * 是他的自由，不该因此把整条线提前掐掉（作者报过这个）。
 *
 * 想明确说「这里是结局」，写方括号：`-> 【结束】`、`-> 【好结局】`。
 * 方括号里的名字**永远**是结局，不会跟任何节点名撞上。
 */
export const ENDING_NAMES = new Set(['结束', '完', 'END', 'end', '结局'])

/** `【好结局】` —— 方括号包起来的目标，明确表示「这是一个结局」 */
const EXPLICIT_ENDING = /^[【\[](.+)[】\]]$/

/** `↩ 放学` / `回到 放学` —— 明确表示「这是一次回绕」 */
const LOOP_MARK = /^(?:↩|回到|返回)\s*/

// ───────────────────────── 条件 ─────────────────────────

export type CompareOp = '>' | '<' | '>=' | '<=' | '==' | '!='

export interface Condition {
  /** 原样的条件文字，显示用 */
  raw: string
  variable: string
  op: CompareOp
  /** 数字、布尔或字符串 */
  value: number | boolean | string
  /** 没写运算符时为真，表示「这个变量是真的」 */
  truthy: boolean
  /** 前面带了「非」或 `!` */
  negated: boolean
}

const OPS: CompareOp[] = ['>=', '<=', '!=', '==', '>', '<']

/** `真/假` 这些词要认，作者不会去写 true/false */
function parseValue(raw: string): number | boolean | string {
  const t = raw.trim().replace(/^["'「『]|["'」』]$/g, '')
  if (t === '真' || t === 'true' || t === '是') return true
  if (t === '假' || t === 'false' || t === '否') return false
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  return t
}

/**
 * 解析一条条件。
 *
 * 认不出来时返回 null —— 界面会把它当成「这条条件写坏了」报出来，
 * 而不是悄悄当成真或假。**猜错一条条件，作者就会以为某条分支永远走不到。**
 */
export function parseCondition(raw: string): Condition | null {
  let t = raw.trim()
  if (t === '') return null

  let negated = false
  if (t.startsWith('非') || t.startsWith('!')) {
    negated = true
    t = t.replace(/^(非|!)\s*/, '')
  }

  for (const op of OPS) {
    const at = t.indexOf(op)
    if (at > 0) {
      const variable = t.slice(0, at).trim()
      const value = parseValue(t.slice(at + op.length))
      if (!variable) return null
      return { raw, variable, op, value, truthy: false, negated }
    }
  }

  // 单个 `=` 当成相等，作者常这么写
  const eq = t.indexOf('=')
  if (eq > 0) {
    const variable = t.slice(0, eq).trim()
    if (variable) {
      return { raw, variable, op: '==', value: parseValue(t.slice(eq + 1)), truthy: false, negated }
    }
  }

  if (/^[^\s{}()（）]+$/.test(t)) {
    return { raw, variable: t, op: '==', value: true, truthy: true, negated }
  }
  return null
}

export type VarValue = number | boolean | string
export type GameState = Record<string, VarValue>

/** 判定一条条件在当前状态下成不成立 */
export function evalCondition(c: Condition, state: GameState): boolean {
  const cur = state[c.variable]
  let ok: boolean

  if (c.truthy) {
    ok = cur !== undefined && cur !== false && cur !== 0 && cur !== ''
  } else if (typeof c.value === 'number') {
    // 拿数字比的一律按数字算，**没赋过值的变量当 0**。
    // 「好感度 < 1」在一次都没加过好感度时必须成立 ——
    // 不然「冷淡线」那条分支会被判成永远走不到，而它恰恰是默认路线。
    const left = typeof cur === 'number' ? cur : cur === undefined ? 0 : Number.NaN
    ok =
      c.op === '>' ? left > c.value
      : c.op === '<' ? left < c.value
      : c.op === '>=' ? left >= c.value
      : c.op === '<=' ? left <= c.value
      : c.op === '==' ? left === c.value
      : left !== c.value
  } else {
    ok = c.op === '!=' ? cur !== c.value : cur === c.value
  }

  return c.negated ? !ok : ok
}

// ───────────────────────── 变量操作 ─────────────────────────

export type AssignOp = '=' | '+=' | '-='

export interface Assign {
  raw: string
  variable: string
  op: AssignOp
  value: VarValue
  /** 外层 `$若` 块加的条件。不成立时这次赋值不生效 */
  guards: Condition[]
}

/** `$ 好感度 += 1` */
const ASSIGN_LINE = /^\$\s*(.+)$/

export function parseAssign(raw: string): Assign | null {
  const body = ASSIGN_LINE.exec(raw.trim())?.[1]
  if (body === undefined) return null

  for (const op of ['+=', '-='] as const) {
    const at = body.indexOf(op)
    if (at > 0) {
      const variable = body.slice(0, at).trim()
      const value = parseValue(body.slice(at + op.length))
      if (!variable) return null
      return { raw, variable, op, value, guards: [] }
    }
  }
  const eq = body.indexOf('=')
  if (eq > 0) {
    const variable = body.slice(0, eq).trim()
    if (variable) {
      return { raw, variable, op: '=', value: parseValue(body.slice(eq + 1)), guards: [] }
    }
  }
  return null
}

/** 把一条变量操作作用到状态上，返回新状态（不改原来的） */
export function applyAssign(state: GameState, a: Assign): GameState {
  const next = { ...state }
  if (a.op === '=') {
    next[a.variable] = a.value
    return next
  }
  const cur = typeof next[a.variable] === 'number' ? (next[a.variable] as number) : 0
  const delta = typeof a.value === 'number' ? a.value : 0
  next[a.variable] = a.op === '+=' ? cur + delta : cur - delta
  return next
}

// ───────────────────────── 块级条件 ─────────────────────────

/**
 * `$若 …` / `$否则` / `$结束`。
 *
 * 为什么要有块：条件只能挂在选项上的时候，
 * 「好感度够了才说这句话」写不出来 —— 那不是一个选项，是一段内容。
 *
 *     $若 好感度>=3
 *     李四：其实我一直……
 *     - 回应 -> 表白
 *     $否则
 *     李四：……没什么。
 *     $结束
 *
 * 实现上**不给内容行加条件**，只给块里的**出口和变量操作**加。
 * 内容归内容（字数照算、写没写照判），能不能走到那条分支才是要紧的。
 */
export type BlockMarker =
  | { kind: 'if'; condition: Condition | null; raw: string }
  | { kind: 'else' }
  | { kind: 'end' }

const BLOCK_IF = /^\$\s*(?:若|如果|if)\s+(.+)$/i
const BLOCK_ELSE = /^\$\s*(?:否则|else)\s*$/i
const BLOCK_END = /^\$\s*(?:结束块|结束|end)\s*$/i

export function parseBlockMarker(raw: string): BlockMarker | null {
  const t = raw.trim()
  if (BLOCK_ELSE.test(t)) return { kind: 'else' }
  if (BLOCK_END.test(t)) return { kind: 'end' }
  const m = BLOCK_IF.exec(t)
  if (m) return { kind: 'if', condition: parseCondition(m[1] ?? ''), raw: (m[1] ?? '').trim() }
  return null
}

/** 一层块。`negated` 为真表示当前在 `$否则` 那半边 */
interface BlockFrame {
  condition: Condition | null
  negated: boolean
  raw: string
}

/** 把一叠块条件变成挂在出口/变量上的守卫 */
function guardsOf(stack: readonly BlockFrame[]): Condition[] {
  const out: Condition[] = []
  for (const f of stack) {
    if (!f.condition) continue
    out.push(f.negated ? { ...f.condition, negated: !f.condition.negated } : f.condition)
  }
  return out
}

/** 守卫全都成立才算这一条能用 */
export function evalGuards(guards: readonly Condition[], state: GameState): boolean {
  return guards.every((g) => evalCondition(g, state))
}

// ───────────────────────── 出口（选项与跳转） ─────────────────────────

export interface Exit {
  /** 选项显示给玩家的文字；直接跳转时为空 */
  label: string
  /** 目标节点名 */
  target: string
  /**
   * 目标是不是结局。
   *
   * **这一项由 `buildGraph` 说了算**，parse 阶段给的只是初值 ——
   * 「`-> 结束` 到底是结局还是一个叫结束的节点」得看全书有没有那个节点，
   * 一行一行读的时候答不上来。
   */
  ending: boolean
  /** 写的是 `【…】`，作者明确说了「这是结局」。这一条 buildGraph 不会推翻 */
  explicitEnding: boolean
  /** 写的是 `↩ …`，作者明确说了「这是回绕」 */
  loop: boolean
  /** 不是作者写的，是 `<- 合并` 声明推出来的 */
  implicit: boolean
  condition: Condition | null
  /** 条件写坏了（写了 `{}` 但认不出来） */
  badCondition: string | null
  /** 外层 `$若` 块加的条件。全都成立才走得到这条出口 */
  guards: Condition[]
  line: number
}

/** `- {条件} 选项文字 -> 目标` */
const OPTION_LINE = /^[-*]\s+(?:\{([^}]*)\}\s*)?(.*?)\s*(?:->|→|=>)\s*(.+)$/
/** 独占一行的 `-> 目标`，也允许带条件 */
const JUMP_LINE = /^(?:\{([^}]*)\}\s*)?(?:->|→|=>)\s*(.+)$/

function makeExit(
  label: string,
  target: string,
  condRaw: string | undefined,
  line: number,
): Exit {
  let t = target.trim()

  // 【好结局】—— 作者明确说了这是结局，名字再怎么跟节点撞也不算跳转
  const explicit = EXPLICIT_ENDING.exec(t)
  const explicitEnding = explicit !== null
  if (explicit) t = (explicit[1] ?? '').trim()

  // ↩ 放学 —— 作者明确说了这是回绕
  const loop = !explicitEnding && LOOP_MARK.test(t)
  if (loop) t = t.replace(LOOP_MARK, '').trim()

  const condition = condRaw === undefined ? null : parseCondition(condRaw)
  return {
    label: label.trim(),
    target: t,
    // 初值。真正算数的那一遍在 buildGraph 里 —— 它才知道全书有没有同名节点
    ending: explicitEnding || ENDING_NAMES.has(t),
    explicitEnding,
    loop,
    implicit: false,
    condition,
    badCondition: condRaw !== undefined && condition === null ? condRaw : null,
    guards: [],
    line,
  }
}

/**
 * 一行里能写好几个去处：`-> 图书馆、天台、社团`。
 *
 * 「这个时间段去哪儿」这种自由度高的写法，原来得一条一条写
 *
 *     - 图书馆 -> 图书馆
 *     - 天台 -> 天台
 *
 * 目标和选项文字是同一个词，抄一遍纯属浪费 —— 而且抄错一个字
 * 就是一条断头路。展开出来的选项，**文字就是节点名**。
 *
 * 只有直接跳转（没写选项文字）那一行才拆。`- 点头 -> A、B` 拆了之后
 * 两个选项都叫「点头」，那不是作者想要的。
 */
const TARGET_SPLIT = /[、,，/]/

export function parseExits(raw: string, line: number): Exit[] {
  const t = raw.trim()

  const o = OPTION_LINE.exec(t)
  if (o) return [makeExit(o[2] ?? '', o[3] ?? '', o[1], line)]

  const j = JUMP_LINE.exec(t)
  if (!j) return []

  const targets = (j[2] ?? '').split(TARGET_SPLIT).map((x) => x.trim()).filter(Boolean)
  if (targets.length <= 1) return [makeExit('', j[2] ?? '', j[1], line)]

  // 拆出来的每一条，选项文字就是它的目标名（去掉 【】/↩ 之后的那个名字）
  return targets.map((one) => {
    const e = makeExit('', one, j[1], line)
    return { ...e, label: e.target }
  })
}

/** 单条出口。多目标那一行只给第一条 —— 建图走的是 `parseExits` */
export function parseExit(raw: string, line: number): Exit | null {
  return parseExits(raw, line)[0] ?? null
}

/**
 * `<- 承认、冷场` —— 合并声明。
 *
 * 【为什么要有它】
 *
 * 「分歧一下、之后故事线还是同一条」是分支剧情里最常见的形状，
 * 而原来写它要跑去**每一个**分支节点尾巴上补一行 `-> 放学`：
 * 五条分支就是五个地方，加一条分支又得记得回来补第六个。
 * 漏一个就是一条死路，而死路是要走到才发现的。
 *
 * 现在在合流的那个节点上写一行就够了，**它自己声明谁流进来**。
 * 五条分支写在一处，加分支时也只改这一处。
 */
const MERGE_LINE = /^(?:<-|<—|←)\s*(.+)$/

export function parseMerge(raw: string): string[] | null {
  const m = MERGE_LINE.exec(raw.trim())
  if (!m) return null
  const names = (m[1] ?? '').split(TARGET_SPLIT).map((x) => x.trim()).filter(Boolean)
  return names.length > 0 ? names : null
}

// ───────────────────────── 节点 ─────────────────────────

export interface GameNode {
  name: string
  /** 哪个文件里 */
  docPath: string
  docTitle: string
  /** 节点标题所在行，从 0 起 */
  line: number
  exits: Exit[]
  assigns: Assign[]
  /** 正文字数（台词 + 动作 + 叙述，不含选项与变量行） */
  chars: number
  /** 有没有实际内容。只有一个标题的节点是空壳 */
  written: boolean
  /** 写坏了的块标记：`$若` 的条件看不懂、`$否则`/`$结束` 没有对应的 `$若` */
  badBlocks: Array<{ raw: string; line: number }>
  /** `<- 承认、冷场`：声明哪几个节点合流到这儿来 */
  mergeFrom: Array<{ name: string; line: number }>
  /**
   * 这个节点里的正文行（台词、动作、叙述），原样保留。
   *
   * 导出到引擎时要把它们带过去 —— 只导结构不导正文，
   * 那份文件对作者没有任何用处。
   */
  rawLines: string[]
}

export interface SourceDoc {
  path: string
  title: string
  body: string
}

/**
 * 从整本书的正文里扒出所有节点。
 *
 * 同名节点是**致命错误**（跳转会跳到哪一个？），所以要报出来，
 * 但仍然把两个都留在列表里 —— 作者得看见它们分别在哪个文件。
 */
export function parseGameNodes(docs: readonly SourceDoc[]): GameNode[] {
  const out: GameNode[] = []

  for (const doc of docs) {
    const lines = doc.body.split('\n')
    let cur: GameNode | null = null
    /** 当前所在的 `$若` 块。换节点时清空 —— 块不跨节点 */
    let stack: BlockFrame[] = []

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i] ?? ''
      const t = raw.trim()

      if (t.startsWith('#')) {
        if (cur) out.push(cur)
        stack = []
        cur = {
          name: t.replace(/^#+\s*/, '').trim(),
          docPath: doc.path,
          docTitle: doc.title,
          line: i,
          exits: [],
          assigns: [],
          chars: 0,
          written: false,
          badBlocks: [],
          mergeFrom: [],
          rawLines: [],
        }
        continue
      }
      if (!cur || t === '') continue

      const bm = parseBlockMarker(t)
      if (bm) {
        if (bm.kind === 'if') {
          stack.push({ condition: bm.condition, negated: false, raw: bm.raw })
          if (bm.condition === null) cur.badBlocks.push({ raw: bm.raw, line: i })
        } else if (bm.kind === 'else') {
          const top = stack[stack.length - 1]
          // 没有对应的 $若 就当没写 —— 报出来比悄悄吞掉强
          if (top) top.negated = true
          else cur.badBlocks.push({ raw: '否则', line: i })
        } else {
          if (stack.length === 0) cur.badBlocks.push({ raw: '结束', line: i })
          else stack.pop()
        }
        continue
      }

      const a = parseAssign(t)
      if (a) {
        cur.assigns.push({ ...a, guards: guardsOf(stack) })
        continue
      }

      // 合并声明要在出口之前判 —— `<-` 和 `->` 长得像，别让哪一个先抢走
      const merge = parseMerge(t)
      if (merge) {
        for (const name of merge) cur.mergeFrom.push({ name, line: i })
        continue
      }

      const es = parseExits(t, i)
      if (es.length > 0) {
        for (const e of es) cur.exits.push({ ...e, guards: guardsOf(stack) })
        continue
      }

      // 剩下的按剧本行算内容
      const sl = parseScriptLine(raw, i, 0)
      if (sl.kind === 'dialogue' || sl.kind === 'action' || sl.kind === 'narration') {
        cur.chars += countWords(sl.text ?? '').withPunctuation
        cur.written = true
        cur.rawLines.push(raw.trim())
      }
    }
    if (cur) out.push(cur)
  }

  return out
}

// ───────────────────────── 图与体检 ─────────────────────────

export type ProblemKind =
  | 'duplicate'
  | 'missingTarget'
  | 'orphan'
  | 'deadEnd'
  | 'badCondition'
  | 'unsetVariable'
  /** 没标记就跳回了前面的节点。**提示，不是错** —— 有意的回绕写个 ↩ 就好 */
  | 'unmarkedLoop'
  /** `<- 合并` 声明里点了名，但那个节点自己已经写了出口，合并没生效 */
  | 'mergeIgnored'

export interface Problem {
  kind: ProblemKind
  /** 出问题的节点 */
  node: string
  docPath: string
  line: number
  /** 给作者看的一句话 */
  message: string
}

export interface GameGraph {
  nodes: GameNode[]
  byName: Map<string, GameNode[]>
  /** 起点：第一个节点。作者也可以自己指定 */
  start: string | null
  problems: Problem[]
}

export function buildGraph(nodes: readonly GameNode[], startName?: string): GameGraph {
  const problems: Problem[] = []

  /** 有哪些名字是真的节点。「`-> 结束` 算不算结局」全看这一张表 */
  const nodeNames = new Set(nodes.map((n) => n.name))

  /**
   * 出口里的 `ending` 在这儿才算定。
   *
   * parse 那一遍是一行一行读的，读到 `-> 结束` 时它还不知道全书有没有
   * 一个叫「结束」的节点 —— 而这正是作者踩过的坑：给节点起名叫「结束」，
   * 整条线在跳过来的那一刻就被当成结局掐掉了。
   *
   * 规矩：`【…】` 永远是结局；保留名只在**没有同名节点**时才当结局。
   */
  const resolveEnding = (e: Exit): boolean =>
    e.explicitEnding || (ENDING_NAMES.has(e.target) && !nodeNames.has(e.target))

  /** 每个名字**第一次**出现在第几个节点。判断「这一跳是不是往回跳」要用 */
  const orderOf = new Map<string, number>()
  nodes.forEach((n, i) => {
    if (!orderOf.has(n.name)) orderOf.set(n.name, i)
  })

  // 出口先定下 ending，再把 `<- 合并` 声明推出来的隐式出口补上。
  // 两步都在这儿做完，后面所有检查看到的就是同一份最终的出口表
  const resolved: GameNode[] = nodes.map((n) => ({
    ...n,
    exits: n.exits.map((e) => ({ ...e, ending: resolveEnding(e) })),
  }))
  const byIndex = new Map<string, number>()
  resolved.forEach((n, i) => {
    if (!byIndex.has(n.name)) byIndex.set(n.name, i)
  })

  for (const target of resolved) {
    for (const m of target.mergeFrom) {
      const at = byIndex.get(m.name)
      if (at === undefined) {
        problems.push({
          kind: 'missingTarget',
          node: target.name,
          docPath: target.docPath,
          line: m.line,
          message: `合并声明里写了「${m.name}」，但没有这个节点。`,
        })
        continue
      }
      const src = resolved[at]!
      // 人家自己写了出口就听人家的 —— 合并声明不该悄悄改掉已经写明白的走向
      if (src.exits.length > 0) {
        problems.push({
          kind: 'mergeIgnored',
          node: target.name,
          docPath: target.docPath,
          line: m.line,
          message: `「${m.name}」自己已经写了出口，这一条合并没生效。要合流就把它那边的出口去掉。`,
        })
        continue
      }
      src.exits.push({
        label: '',
        target: target.name,
        ending: false,
        explicitEnding: false,
        loop: false,
        implicit: true,
        condition: null,
        badCondition: null,
        guards: [],
        line: src.line,
      })
    }
  }

  nodes = resolved

  const byName = new Map<string, GameNode[]>()
  for (const n of nodes) {
    const list = byName.get(n.name)
    if (list) list.push(n)
    else byName.set(n.name, [n])
  }

  // 同名节点
  for (const [name, list] of byName) {
    if (list.length > 1) {
      for (const n of list) {
        problems.push({
          kind: 'duplicate',
          node: name,
          docPath: n.docPath,
          line: n.line,
          message: `有 ${list.length} 个节点都叫「${name}」，跳转不知道该去哪一个。`,
        })
      }
    }
  }

  // 被跳到过的名字
  const referenced = new Set<string>()
  const assignedVars = new Set<string>()
  for (const n of nodes) {
    for (const a of n.assigns) assignedVars.add(a.variable)
    for (const e of n.exits) {
      if (!e.ending) referenced.add(e.target)
      if (!e.ending && !byName.has(e.target)) {
        problems.push({
          kind: 'missingTarget',
          node: n.name,
          docPath: n.docPath,
          line: e.line,
          message: `跳到「${e.target}」，但没有这个节点。`,
        })
      }
      for (const g of e.guards) void g // 守卫本身的变量在下面统一查
      if (e.badCondition !== null) {
        problems.push({
          kind: 'badCondition',
          node: n.name,
          docPath: n.docPath,
          line: e.line,
          message: `条件「${e.badCondition}」看不懂，这个出口会被当成没有条件。`,
        })
      }
    }
  }

  for (const n of nodes) {
    for (const b of n.badBlocks) {
      problems.push({
        kind: 'badCondition',
        node: n.name,
        docPath: n.docPath,
        line: b.line,
        message: `块标记「${b.raw}」有问题：条件看不懂，或者没有配对的 $若。`,
      })
    }
  }

  const start = startName ?? nodes[0]?.name ?? null

  for (const n of nodes) {
    // 孤儿：没人跳到它，也不是起点
    if (n.name !== start && !referenced.has(n.name)) {
      problems.push({
        kind: 'orphan',
        node: n.name,
        docPath: n.docPath,
        line: n.line,
        message: `没有任何地方跳到「${n.name}」，玩家走不到这儿。`,
      })
    }
    // 死路：没有出口，又不是结局
    if (n.exits.length === 0) {
      problems.push({
        kind: 'deadEnd',
        node: n.name,
        docPath: n.docPath,
        line: n.line,
        message:
          `「${n.name}」没有出口，玩家走到这儿就卡住了。` +
          `是结局就写一行 -> 【结束】；要接回主线，就在主线那个节点上写 <- ${n.name}。`,
      })
    }
  }

  /**
   * 没标记就跳回了前面的节点。
   *
   * **这是提示，不是错。** 有意的循环（回到选择菜单、重复的日常）当然合法，
   * 标一个 `↩` 就好。要提的是另一种：两段不相干的剧情不小心起了同一个名字，
   * 于是后面那一段的跳转悄悄绕回了前面 —— 图上看起来还挺正常，
   * 而作者会以为自己写的新分支怎么怎么走不到。
   */
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!
    for (const e of n.exits) {
      if (e.ending || e.loop || e.implicit) continue
      const at = orderOf.get(e.target)
      if (at === undefined || at >= i) continue
      problems.push({
        kind: 'unmarkedLoop',
        node: n.name,
        docPath: n.docPath,
        line: e.line,
        message:
          `「${n.name}」跳回了前面的「${e.target}」。有意绕回去就写成 -> ↩${e.target}；` +
          `不是有意的，多半是两处用了同一个名字。`,
      })
    }
  }

  // 条件用到的变量从来没被赋过值 —— 那条分支永远走不到
  for (const n of nodes) {
    for (const e of n.exits) {
      const vars = new Set<string>()
      if (e.condition) vars.add(e.condition.variable)
      for (const g of e.guards) vars.add(g.variable)
      for (const v of vars) {
        if (assignedVars.has(v)) continue
        problems.push({
          kind: 'unsetVariable',
          node: n.name,
          docPath: n.docPath,
          line: e.line,
          message: `条件用到「${v}」，但全书没有一处给它赋过值（$ ${v} = …）。`,
        })
      }
    }
  }

  return { nodes: [...nodes], byName, start, problems }
}

// ───────────────────────── 走一遍 ─────────────────────────

export interface PathStep {
  node: string
  /** 从上一个节点过来时选的那个选项；起点为空 */
  via: string
}

export interface Ending {
  /** 结局名，或走到的最后一个节点 */
  name: string
  /** 一条能走到这里的示例路径 */
  path: PathStep[]
  /** 走到这里时的变量状态 */
  state: GameState
}

export interface Simulation {
  /** 从起点真的走得到的节点 */
  reachable: Set<string>
  /** 走不到的节点。和「孤儿」不同 —— 有可能有人跳它，但那个人自己就走不到 */
  unreachable: string[]
  endings: Ending[]
  /** 状态空间太大被截断了。数字就不再准，界面要如实说 */
  truncated: boolean
  /** 每个变量出现过的取值 */
  variableValues: Map<string, Set<string>>
}

const DEFAULT_CAP = 20000

/**
 * 从起点走一遍，看能到哪儿、能拿到哪些结局。
 *
 * 按 (节点, 变量状态) 去重做广度优先。带变量的剧本状态空间会爆炸，
 * 所以有个上限；超了就**如实说被截断了**，绝不假装数字是全的 ——
 * 作者据此判断「这个结局拿不到」是会出事的。
 */
export function simulate(
  graph: GameGraph,
  opts: {
    cap?: number
    /**
     * 从哪个节点开始走。不传就用图的起点。
     *
     * 写到第八章时想试「从这儿往后还能到哪些结局」，
     * 每次都从头走一遍是没法用的。
     */
    from?: string
    /** 起手的变量状态。试玩中段剧情时得能假设「已经拿到钥匙了」 */
    initialState?: GameState
  } = {},
): Simulation {
  const cap = opts.cap ?? DEFAULT_CAP
  const reachable = new Set<string>()
  const endings: Ending[] = []
  const seenEnding = new Set<string>()
  const variableValues = new Map<string, Set<string>>()
  let truncated = false

  const noteVar = (state: GameState) => {
    for (const [k, v] of Object.entries(state)) {
      let set = variableValues.get(k)
      if (!set) {
        set = new Set()
        variableValues.set(k, set)
      }
      set.add(String(v))
    }
  }

  const start = opts.from ?? graph.start
  if (!start || !graph.byName.has(start)) {
    return { reachable, unreachable: graph.nodes.map((n) => n.name), endings, truncated, variableValues }
  }

  const queue: Array<{ node: string; state: GameState; path: PathStep[] }> = [
    { node: start, state: { ...(opts.initialState ?? {}) }, path: [{ node: start, via: '' }] },
  ]
  const visited = new Set<string>()

  while (queue.length > 0) {
    if (visited.size >= cap) {
      truncated = true
      break
    }
    const cur = queue.shift()!
    const nodes = graph.byName.get(cur.node)
    if (!nodes || nodes.length === 0) continue
    const node = nodes[0]!

    // 用 \u0000 分隔：节点名是作者随手写的标题，可能带空格；NUL 不可能出现在里面。
    // **写成转义，别直接敲一个控制字符** —— 源码里一个看不见的字节，
    // 将来会有人对着它查半天（这一处原本就是被转义弄进来的）
    const key = `${cur.node}\u0000${JSON.stringify(cur.state)}`
    if (visited.has(key)) continue
    visited.add(key)
    reachable.add(cur.node)

    let state = cur.state
    // 块里的赋值只在块条件成立时生效
    for (const a of node.assigns) {
      if (evalGuards(a.guards, state)) state = applyAssign(state, a)
    }
    noteVar(state)

    const usable = node.exits.filter(
      (e) => evalGuards(e.guards, state) && (!e.condition || evalCondition(e.condition, state)),
    )

    // 没有能走的出口：这一支到此为止，算一个结局（哪怕作者没写 -> 结束）
    if (usable.length === 0) {
      if (!seenEnding.has(cur.node)) {
        seenEnding.add(cur.node)
        endings.push({ name: cur.node, path: cur.path, state })
      }
      continue
    }

    for (const e of usable) {
      if (e.ending) {
        const label = `${e.target}（${cur.node}）`
        if (!seenEnding.has(label)) {
          seenEnding.add(label)
          endings.push({
            name: e.target,
            path: [...cur.path, { node: e.target, via: e.label }],
            state,
          })
        }
        continue
      }
      // 跳到不存在的节点：buildGraph 已经报过问题了，这里跳过
      if (!graph.byName.has(e.target)) continue
      queue.push({
        node: e.target,
        state,
        path: [...cur.path, { node: e.target, via: e.label }],
      })
    }
  }

  const unreachable = graph.nodes.map((n) => n.name).filter((n) => !reachable.has(n))
  return { reachable, unreachable: [...new Set(unreachable)], endings, truncated, variableValues }
}

// ───────────────────────── 写作进度 ─────────────────────────

export interface GameProgress {
  nodes: number
  /** 已经写了内容的节点 */
  written: number
  /** 只有标题的空壳节点 */
  stubs: string[]
  chars: number
  /** 选项总数（分支宽度） */
  options: number
  endings: number
  percent: number
}

export function gameProgress(graph: GameGraph, sim: Simulation): GameProgress {
  const stubs = graph.nodes.filter((n) => !n.written).map((n) => n.name)
  const written = graph.nodes.length - stubs.length
  return {
    nodes: graph.nodes.length,
    written,
    stubs,
    chars: graph.nodes.reduce((s, n) => s + n.chars, 0),
    options: graph.nodes.reduce((s, n) => s + n.exits.filter((e) => e.label !== '').length, 0),
    endings: sim.endings.length,
    percent: graph.nodes.length === 0 ? 0 : Math.round((written / graph.nodes.length) * 100),
  }
}

/**
 * 新建**第一篇**游戏剧本时给的骨架。
 *
 * 写成能直接跑通的一小段（有分支、有变量、有条件、有合并、有结局，
 * 体检一条都不报），作者照着改就行 —— 给一份自带断头路的模板等于教他写错。
 *
 * ⚠️ **只给第一篇。** 后面每新建一篇都塞一遍「李四」，作者得先删掉二十行
 * 才能开始写自己的东西（作者报过这个）。后面的用 `gameNodeStub()`。
 */
export function gameScriptTemplate(title = '第一幕'): string {
  return [
    `# ${title}`,
    '',
    '（教室后排，窗外是操场。）',
    '',
    '李四：你是新来的？',
    '',
    '- 点头 -> 承认',
    '- 不理他 -> 冷场',
    '',
    '# 承认',
    '',
    '$ 好感度 += 1',
    '',
    '李四：我叫李四。',
    '',
    '# 冷场',
    '',
    '（他没再说话。）',
    '',
    '# 放学',
    '',
    // 分歧之后合流：不用回到「承认」「冷场」各补一行 -> 放学，
    // 在合流的这个节点上声明一次就够了
    '<- 承认、冷场',
    '',
    '（铃响了。）',
    '',
    '- {好感度>=1} 一起走 -> 【好结局】',
    '- 自己走 -> 【结束】',
    '',
  ].join('\n')
}

/**
 * 后面每一篇给的东西：**一个节点标题，没别的**。
 *
 * 新建一篇就该是一张白纸。空文件也不行 —— 那样它连节点都算不上，
 * 图上根本不出现，作者会以为新建没成功。给一行标题，正好。
 */
export function gameNodeStub(title = '新节点'): string {
  return `# ${title}\n\n`
}
