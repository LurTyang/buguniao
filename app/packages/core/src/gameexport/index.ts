/**
 * 把游戏剧本导成引擎能读的骨架。
 *
 * 规范：更新文档/05-功能模块详述.md §14.2
 *
 * ─────────────────────────────────────────────────────────────
 * 【说清楚这东西是什么，不是什么】
 *
 * 它导出的是**骨架**：节点、选项、跳转、变量、条件的结构。
 * 不是「能直接跑的游戏」—— 立绘、音乐、转场、界面，那些本来也不在剧本里。
 *
 * 界面上必须写明这一点。让作者以为导出来就能跑，
 * 他会拿去开工程，然后发现少一半东西。
 * ─────────────────────────────────────────────────────────────
 */

import {
  ENDING_NAMES,
  type Condition,
  type GameNode,
  type Exit,
} from '../gamescript/index.js'

export type Engine = 'renpy' | 'ink'

export interface EngineExport {
  engine: Engine
  /** 文件内容 */
  text: string
  /** 建议的文件名 */
  fileName: string
  /** 导不过去的东西，如实列出来 */
  notes: string[]
  /** 节点名被改写过的对照表（ink 用） */
  renamed: Array<{ from: string; to: string }>
}

// ───────────────────────── 公共 ─────────────────────────

const OP_TEXT: Record<Condition['op'], string> = {
  '>': '>',
  '<': '<',
  '>=': '>=',
  '<=': '<=',
  '==': '==',
  '!=': '!=',
}

/** 值写成目标语言的字面量 */
function literal(v: Condition['value'], engine: Engine): string {
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return engine === 'renpy' ? (v ? 'True' : 'False') : v ? 'true' : 'false'
  return JSON.stringify(v)
}

function condText(c: Condition, engine: Engine, name: (v: string) => string): string {
  const v = name(c.variable)
  const body = c.truthy ? v : `${v} ${OP_TEXT[c.op]} ${literal(c.value, engine)}`
  return c.negated ? (engine === 'renpy' ? `not (${body})` : `not (${body})`) : body
}

/** 一条出口的全部条件（自己的 + 外层块的） */
function allConds(e: Exit): Condition[] {
  return [...e.guards, ...(e.condition ? [e.condition] : [])]
}

function joinConds(cs: readonly Condition[], engine: Engine, name: (v: string) => string): string {
  return cs.map((c) => condText(c, engine, name)).join(engine === 'renpy' ? ' and ' : ' && ')
}

// ───────────────────────── Ren'Py ─────────────────────────

/**
 * Ren'Py 标识符。
 *
 * Python 3 的标识符允许中文，所以节点名一般能原样当 label 用。
 * 但空格、标点不行，那些换成下划线。
 */
function renpyIdent(name: string): string {
  const t = name.replace(/[^\p{L}\p{N}_]/gu, '_').replace(/^(\d)/, '_$1')
  return t || '_node'
}

/**
 * 导成 Ren'Py。
 *
 * 用的是最基础的那几个语句：`label` / `menu` / `jump` / `$` / `if`。
 * 刻意不用任何新版本才有的写法 —— 这份东西是给作者当起点的，
 * 越朴素越不容易在他那个版本上报错。
 */
export function toRenpy(nodes: readonly GameNode[], title = '剧本'): EngineExport {
  const out: string[] = []
  const notes: string[] = []
  const ident = renpyIdent

  out.push(`# ${title}`)
  out.push('# 由不咕鸟导出。这是**骨架**：节点、选项、跳转、变量、条件。')
  out.push('# 立绘、音乐、转场、界面不在里面 —— 那些本来也不在剧本里。')
  out.push('')

  const endingLabels = new Set<string>()

  for (const n of nodes) {
    out.push(`label ${ident(n.name)}:`)

    // 正文（台词与动作）——我们只有原始行，原样当独白输出，作者自己改成角色对白
    const body = n.rawLines ?? []
    for (const line of body) {
      const t = line.trim()
      if (t === '') continue
      out.push(`    "${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    }

    for (const a of n.assigns) {
      const stmt = `    $ ${ident(a.variable)} ${a.op} ${literal(a.value, 'renpy')}`
      if (a.guards.length > 0) {
        out.push(`    if ${joinConds(a.guards, 'renpy', ident)}:`)
        out.push(`    ${stmt}`)
      } else {
        out.push(stmt)
      }
    }

    const options = n.exits.filter((e) => e.label !== '')
    const jumps = n.exits.filter((e) => e.label === '')

    if (options.length > 0) {
      out.push('    menu:')
      for (const e of options) {
        const cs = allConds(e)
        const target = e.ending ? `_ending_${ident(e.target)}` : ident(e.target)
        if (e.ending) endingLabels.add(target)
        const cond = cs.length > 0 ? ` if ${joinConds(cs, 'renpy', ident)}` : ''
        out.push(`        "${e.label.replace(/"/g, '\\"')}"${cond}:`)
        out.push(`            jump ${target}`)
      }
    }

    for (const e of jumps) {
      const cs = allConds(e)
      const target = e.ending ? `_ending_${ident(e.target)}` : ident(e.target)
      if (e.ending) endingLabels.add(target)
      if (cs.length > 0) {
        out.push(`    if ${joinConds(cs, 'renpy', ident)}:`)
        out.push(`        jump ${target}`)
      } else {
        out.push(`    jump ${target}`)
      }
    }

    if (n.exits.length === 0) {
      out.push('    return')
      notes.push(`「${n.name}」没有出口，导成了 return。`)
    }
    out.push('')
  }

  // 结局用的落点
  for (const l of [...endingLabels].sort()) {
    out.push(`label ${l}:`)
    out.push('    return')
    out.push('')
  }

  if (nodes.some((n) => (n.rawLines ?? []).length > 0)) {
    notes.push('正文原样导成了独白（一行一句），角色对白要你自己改成 `角色 "台词"`。')
  }

  return {
    engine: 'renpy',
    text: out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n',
    fileName: 'script.rpy',
    notes,
    renamed: nodes
      .filter((n) => ident(n.name) !== n.name)
      .map((n) => ({ from: n.name, to: ident(n.name) })),
  }
}

// ───────────────────────── ink ─────────────────────────

/**
 * ink 的 knot 名只认字母数字下划线，**中文不行**。
 *
 * 所以要把中文节点名换成 `n1`、`n2`，并在文件开头留一张对照表 ——
 * 不留的话作者打开一看全是 n1 n2，根本认不出哪个是哪个。
 */
function inkNames(nodes: readonly GameNode[]): Map<string, string> {
  const map = new Map<string, string>()
  let i = 0
  for (const n of nodes) {
    if (map.has(n.name)) continue
    const ascii = n.name.replace(/[^A-Za-z0-9_]/g, '')
    // 纯英文名就留着，好认
    const name = /^[A-Za-z][A-Za-z0-9_]*$/.test(ascii) ? ascii : `n${++i}`
    map.set(n.name, map.has(name) ? `n${++i}` : name)
  }
  return map
}

export function toInk(nodes: readonly GameNode[], title = '剧本'): EngineExport {
  const map = inkNames(nodes)
  const out: string[] = []
  const notes: string[] = []

  /**
   * ⚠️ 变量名跟 knot 名一样，ink 只认 ASCII。
   *
   * 直接把中文剥掉会变成**空字符串** —— 那样导出来的是 `VAR  = 0`，
   * 一个既不报错也不能用的东西。所以变量也要一张对照表。
   */
  const varMap = new Map<string, string>()
  let vi = 0
  const collectVar = (v: string): string => {
    const got = varMap.get(v)
    if (got !== undefined) return got
    const ascii = v.replace(/[^A-Za-z0-9_]/g, '')
    const name = /^[A-Za-z][A-Za-z0-9_]*$/.test(ascii) ? ascii : `v${++vi}`
    varMap.set(v, name)
    return name
  }
  const knot = (n: string) => (ENDING_NAMES.has(n) ? 'END' : (map.get(n) ?? `n_${map.size}`))

  out.push(`// ${title}`)
  out.push('// 由不咕鸟导出。这是骨架：节点、选项、跳转、变量、条件。')
  out.push('//')
  out.push('// ⚠️ ink 的 knot 名只认字母数字下划线，中文节点名换成了 n1/n2……')
  out.push('//    下面是对照表：')
  for (const [from, to] of map) out.push(`//    ${to}  =  ${from}`)
  out.push('')

  // 变量先声明，ink 要求用之前先 VAR。
  // 条件里用到但从没赋过值的也要声明，否则 ink 会直接报错
  for (const n of nodes) {
    for (const a of n.assigns) collectVar(a.variable)
    for (const e of n.exits) {
      for (const c of allConds(e)) collectVar(c.variable)
    }
  }
  if (varMap.size > 0) {
    out.push('// 变量对照表：')
    for (const [from, to] of varMap) {
      if (from !== to) out.push(`//    ${to}  =  ${from}`)
    }
    for (const [from, to] of varMap) out.push(`VAR ${to} = 0  // ${from}`)
    out.push('')
    notes.push('变量都声明成了 0。布尔量要自己改成 true/false。')
  }

  for (const n of nodes) {
    out.push(`=== ${knot(n.name)} ===`)
    out.push(`// ${n.name}`)

    for (const line of n.rawLines ?? []) {
      const t = line.trim()
      if (t !== '') out.push(t)
    }

    for (const a of n.assigns) {
      const stmt = `~ ${collectVar(a.variable)} ${a.op === '=' ? '=' : a.op} ${literal(a.value, 'ink')}`
      if (a.guards.length > 0) {
        out.push(`{ ${joinConds(a.guards, 'ink', collectVar)}:`)
        out.push(`    ${stmt}`)
        out.push('}')
      } else {
        out.push(stmt)
      }
    }

    for (const e of n.exits) {
      const cs = allConds(e)
      const cond = cs.length > 0 ? `{ ${joinConds(cs, 'ink', collectVar)} } ` : ''
      if (e.label === '') out.push(`${cond}-> ${knot(e.target)}`)
      else out.push(`+ ${cond}${e.label} -> ${knot(e.target)}`)
    }

    if (n.exits.length === 0) {
      out.push('-> END')
      notes.push(`「${n.name}」没有出口，导成了 -> END。`)
    }
    out.push('')
  }

  if (nodes.some((n) => (n.rawLines ?? []).length > 0)) {
    notes.push('正文原样导了过去。`角色：台词` 这种写法 ink 会当成普通文本，要自己调。')
  }

  return {
    engine: 'ink',
    text: out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n',
    fileName: 'script.ink',
    notes,
    renamed: [...map].filter(([from, to]) => from !== to).map(([from, to]) => ({ from, to })),
  }
}

export function exportGame(nodes: readonly GameNode[], engine: Engine, title?: string): EngineExport {
  return engine === 'renpy' ? toRenpy(nodes, title) : toInk(nodes, title)
}
