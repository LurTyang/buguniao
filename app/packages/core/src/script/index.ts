/**
 * 剧本模式。
 *
 * 规范：更新文档/03-数据格式规范.md §6、05-功能模块详述.md §12
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么不发明一套剧本格式】
 *
 * 铁律第一条是「文件即真相」—— 剧本也得是记事本打开就能读的纯文本。
 * 所以这里不引入任何新符号，只认**中文剧本本来就在用的写法**：
 *
 *     # 第一场　内景·咖啡馆·日
 *
 *     （李四推门进来，雨水顺着伞尖滴在地板上。）
 *
 *     李四：你等很久了？
 *     王五（头也不抬）：还好。
 *
 * 也就是说，**一个剧本文件用别的软件打开、打印出来，仍然是一个剧本**。
 * 软件做的只是把它认出来：对齐排版、数台词量、按场跳转。
 * ─────────────────────────────────────────────────────────────
 *
 * 认行的规矩（按顺序判，先中先算）：
 *   1. `#` 开头            → 场景标题
 *   2. 整行被 `（）` 裹住   → 动作/舞台指示
 *   3. `角色名：台词`       → 台词，角色名后面可以带 `（表演提示）`
 *   4. 其余                → 叙述
 *
 * 第 3 条最容易误伤，所以卡得很死：角色名不超过 10 个字、里面不能有标点。
 * 「他抬起头，看着窗外：雨停了。」这种句子不会被当成台词。
 */

import { countWords } from '../wordcount/index.js'
import { emptyCast, knownName, type Cast } from '../cast/index.js'

export type ScriptLineKind = 'scene' | 'action' | 'dialogue' | 'narration' | 'blank'

export interface ScriptLine {
  kind: ScriptLineKind
  /** 原始行号，从 0 起。编辑器靠它定位 */
  index: number
  /** 原始整行 */
  raw: string
  /** 场景标题（kind === 'scene'） */
  title?: string
  /** 角色名（kind === 'dialogue'） */
  who?: string
  /** 表演提示，`李四（冷笑）：…` 里的「冷笑」 */
  cue?: string
  /** 台词正文 / 动作内容 / 叙述内容 */
  text?: string
  /** 属于第几场，从 0 起；在第一个场景标题之前的行为 -1 */
  scene: number
  /**
   * 这个角色名在设定集的人物卡里找得到。
   *
   * 只有确凿的名字才敢**把它单独排一行** —— 排错了就是把一句叙述
   * 从中间劈成两半。没配人物分类时全篇都是 false，排版退回单行，
   * 也就是这个功能没开之前的样子。
   */
  knownWho?: boolean
}

export interface ParseOptions {
  /** 设定集里读来的人名单。不给就谁都不算确凿 */
  cast?: Cast
}

/**
 * 角色名 + 可选表演提示 + 冒号。
 *
 * 角色名里不许出现标点和空白 —— 这是把普通叙述挡在外面的唯一防线。
 * 长度卡在 10，中文人名再长也够了（「穿灰袍的老人」六个字）。
 *
 * ⚠️ 还得躲开**别的语法的地盘**：`@` 是便利贴浮出、`<` 是伏笔锚点、
 * `#*->|` 是 Markdown。「@身份：庄主」被排成一句台词，
 * 是这个解析器最容易犯的错 —— 设定卡片里那一行会突然变成谁的台词。
 */
const DIALOGUE =
  /^([^\s：:（(【\[。，、？！；…—"'"''@<>*|`~#-][^\s：:（(【\[。，、？！；…—"'"''@<>*|`~]{0,9})(?:（([^）]{0,40})）)?[：:]\s?([\s\S]*)$/

/** 整行被全角或半角括号裹住 */
const ACTION = /^[（(]([\s\S]*)[）)]$/

/** 伏笔锚点这类 HTML 注释整行时不算内容 */
const COMMENT_ONLY = /^<!--[\s\S]*-->$/

export function parseScriptLine(
  raw: string,
  index: number,
  scene: number,
  cast: Cast = emptyCast(),
): ScriptLine {
  const t = raw.trim()

  if (t === '') return { kind: 'blank', index, raw, scene }

  if (t.startsWith('#')) {
    return { kind: 'scene', index, raw, title: t.replace(/^#+\s*/, '').trim(), scene }
  }

  // 整行注释（伏笔锚点）当叙述处理，不参与任何统计
  if (COMMENT_ONLY.test(t)) return { kind: 'narration', index, raw, text: t, scene }

  const a = ACTION.exec(t)
  if (a) return { kind: 'action', index, raw, text: (a[1] ?? '').trim(), scene }

  const d = DIALOGUE.exec(t)
  if (d) {
    const line: ScriptLine = {
      kind: 'dialogue',
      index,
      raw,
      who: (d[1] ?? '').trim(),
      text: (d[3] ?? '').trim(),
      scene,
    }
    const cue = d[2]?.trim()
    if (cue) line.cue = cue
    if (line.who && knownName(cast, line.who)) line.knownWho = true
    return line
  }

  return { kind: 'narration', index, raw, text: t, scene }
}

export interface Scene {
  /** 从 0 起 */
  no: number
  title: string
  /** 场景标题所在行；没有标题的开场为 -1 */
  line: number
  /** 这一场里的台词条数 */
  dialogueCount: number
  /** 这一场里出场的角色，按首次说话的顺序 */
  cast: string[]
}

export interface ScriptDoc {
  lines: ScriptLine[]
  scenes: Scene[]
}

/** 把整篇剧本拆开 */
export function parseScript(body: string, opts: ParseOptions = {}): ScriptDoc {
  const cast = opts.cast ?? emptyCast()
  const rawLines = body.split('\n')
  const lines: ScriptLine[] = []
  const scenes: Scene[] = []
  let scene = -1

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i] ?? ''
    // 先按「当前场」解析，遇到场景标题再自增 —— 标题本身属于它开启的那一场
    const probe = parseScriptLine(raw, i, scene, cast)
    if (probe.kind === 'scene') {
      scene += 1
      const line: ScriptLine = { ...probe, scene }
      lines.push(line)
      scenes.push({
        no: scene,
        title: probe.title ?? '',
        line: i,
        dialogueCount: 0,
        cast: [],
      })
      continue
    }

    lines.push(probe)

    if (probe.kind === 'dialogue' && probe.who) {
      // 第一个场景标题之前就有台词：补一个「开场」，别把它们丢了
      if (scenes.length === 0) {
        scenes.push({ no: -1, title: '（开场，还没有场景标题）', line: -1, dialogueCount: 0, cast: [] })
      }
      const cur = scenes[scenes.length - 1]!
      cur.dialogueCount += 1
      if (!cur.cast.includes(probe.who)) cur.cast.push(probe.who)
    }
  }

  return { lines, scenes }
}

export interface CastStat {
  who: string
  /** 台词条数 */
  lines: number
  /** 台词字数（不含角色名与表演提示） */
  chars: number
  /** 出现在哪几场 */
  scenes: number[]
  /** 第一次说话在第几行 */
  firstLine: number
}

/**
 * 按角色统计台词量。
 *
 * 这是剧本作者最想知道的一个数：**谁的戏被写多了，谁被写没了**。
 * 按台词字数排序，多的在前。
 */
export function castStats(doc: ScriptDoc): CastStat[] {
  const map = new Map<string, CastStat>()

  for (const l of doc.lines) {
    if (l.kind !== 'dialogue' || !l.who) continue
    let s = map.get(l.who)
    if (!s) {
      s = { who: l.who, lines: 0, chars: 0, scenes: [], firstLine: l.index }
      map.set(l.who, s)
    }
    s.lines += 1
    s.chars += countWords(l.text ?? '').withPunctuation
    if (!s.scenes.includes(l.scene)) s.scenes.push(l.scene)
  }

  return [...map.values()].sort((a, b) => b.chars - a.chars || a.firstLine - b.firstLine)
}

export interface ScriptSummary {
  scenes: number
  dialogueLines: number
  /** 台词字数 */
  dialogueChars: number
  /** 动作与叙述的字数 */
  actionChars: number
  cast: number
}

/** 整篇的概况，面板顶上一行显示 */
export function scriptSummary(doc: ScriptDoc): ScriptSummary {
  let dialogueLines = 0
  let dialogueChars = 0
  let actionChars = 0

  for (const l of doc.lines) {
    if (l.kind === 'dialogue') {
      dialogueLines += 1
      dialogueChars += countWords(l.text ?? '').withPunctuation
    } else if (l.kind === 'action' || l.kind === 'narration') {
      actionChars += countWords(l.text ?? '').withPunctuation
    }
  }

  return {
    scenes: doc.scenes.filter((s) => s.no >= 0).length,
    dialogueLines,
    dialogueChars,
    actionChars,
    cast: castStats(doc).length,
  }
}

/**
 * 一篇文档看着像不像剧本。
 *
 * 用来在作者把普通章节切成剧本模式时给个提示，
 * **不用来自动切换** —— 猜错了把小说排成剧本，那是帮倒忙。
 */
export function looksLikeScript(body: string): boolean {
  const doc = parseScript(body)
  const meaningful = doc.lines.filter((l) => l.kind !== 'blank').length
  if (meaningful < 4) return false
  const dialogue = doc.lines.filter((l) => l.kind === 'dialogue').length
  return dialogue / meaningful >= 0.3
}

/**
 * 导出成通用剧本排版的纯文本。
 *
 * 角色名单独一行居中是话剧/影视剧本的常见排法，
 * 但**导出时不做居中**（纯文本里居中要靠空格，粘到别处就乱了），
 * 只做缩进层次：场景顶格、动作缩两格、角色名缩四格、台词缩六格。
 */
export function formatScriptPlain(doc: ScriptDoc): string {
  const out: string[] = []
  for (const l of doc.lines) {
    if (l.kind === 'scene') {
      if (out.length > 0) out.push('')
      out.push(l.title ?? '')
      out.push('')
    } else if (l.kind === 'action') {
      out.push(`  （${l.text ?? ''}）`)
    } else if (l.kind === 'dialogue') {
      out.push(`    ${l.who}${l.cue ? `（${l.cue}）` : ''}`)
      out.push(`      ${l.text ?? ''}`)
    } else if (l.kind === 'narration') {
      out.push(`  ${l.text ?? ''}`)
    } else {
      out.push('')
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/**
 * 说了话、但人物卡里没有的名字。
 *
 * 抓的是**写错的人名**：「李西」和「李四」在统计表里是两个人，
 * 而作者盯着那张表根本看不出来 —— 两行长得几乎一样。
 * 也顺带抓到「时间：三年后」这种被正则误伤的行。
 *
 * 没配人物分类时返回空 —— 那种情况下**每个**名字都不在卡里，
 * 报出来全是噪音。
 */
export function unknownSpeakers(
  doc: ScriptDoc,
  cast: Cast,
): Array<{ who: string; lines: number; firstLine: number }> {
  if (cast.names.length === 0) return []
  const map = new Map<string, { who: string; lines: number; firstLine: number }>()
  for (const l of doc.lines) {
    if (l.kind !== 'dialogue' || !l.who || l.knownWho) continue
    const got = map.get(l.who)
    if (got) got.lines += 1
    else map.set(l.who, { who: l.who, lines: 1, firstLine: l.index })
  }
  return [...map.values()].sort((a, b) => b.lines - a.lines || a.firstLine - b.firstLine)
}

// ───────────────────────── 按场分布 ─────────────────────────

export interface SceneCast {
  /** 第几场，从 0 起 */
  scene: number
  title: string
  /** 这一场里每个角色说了多少字，多的在前 */
  who: Array<{ who: string; lines: number; chars: number }>
  /** 这一场的台词总字数 */
  chars: number
}

/**
 * 台词量按场分布。
 *
 * 跟 `castStats` 的区别：那个回答「整篇里谁的戏多」，
 * 这个回答**「哪一场是谁的主场」**。
 *
 * 群像戏最怕的是「某个角色连着五场一句话都没有」——
 * 只看整篇的总数看不出来，得摊到场上才看得见。
 */
export function sceneCast(doc: ScriptDoc): SceneCast[] {
  const byScene = new Map<number, Map<string, { lines: number; chars: number }>>()

  for (const l of doc.lines) {
    if (l.kind !== 'dialogue' || !l.who) continue
    let m = byScene.get(l.scene)
    if (!m) {
      m = new Map()
      byScene.set(l.scene, m)
    }
    const cur = m.get(l.who) ?? { lines: 0, chars: 0 }
    cur.lines += 1
    cur.chars += countWords(l.text ?? '').withPunctuation
    m.set(l.who, cur)
  }

  return doc.scenes.map((s) => {
    const m = byScene.get(s.no) ?? new Map()
    const who = [...m.entries()]
      .map(([name, v]) => ({ who: name, lines: v.lines, chars: v.chars }))
      .sort((a, b) => b.chars - a.chars || a.who.localeCompare(b.who, 'zh'))
    return {
      scene: s.no,
      title: s.title,
      who,
      chars: who.reduce((a, b) => a + b.chars, 0),
    }
  })
}

/**
 * 某个角色连着几场没出声。
 *
 * 返回每个角色**最长的一段缺席**。群像戏里这个数一大就该警觉了 ——
 * 读者会忘了这个人。
 */
export function longestAbsence(doc: ScriptDoc): Array<{ who: string; gap: number; after: number }> {
  const scenes = doc.scenes.filter((s) => s.no >= 0).map((s) => s.no)
  const cast = castStats(doc)
  const out: Array<{ who: string; gap: number; after: number }> = []

  for (const c of cast) {
    const has = new Set(c.scenes)
    let gap = 0
    let best = 0
    let bestAfter = -1
    let lastSeen = -1
    for (const no of scenes) {
      if (has.has(no)) {
        if (gap > best) {
          best = gap
          bestAfter = lastSeen
        }
        gap = 0
        lastSeen = no
      } else if (lastSeen >= 0) {
        // 只数「出场之后的缺席」—— 还没登场不算缺席
        gap += 1
      }
    }
    // 结尾那一段缺席也要算
    if (gap > best) {
      best = gap
      bestAfter = lastSeen
    }
    if (best > 0) out.push({ who: c.who, gap: best, after: bestAfter })
  }

  return out.sort((a, b) => b.gap - a.gap)
}

// ───────────────────────── 场次重排 ─────────────────────────

/**
 * 把某一场整体挪到另一个位置。
 *
 * 直接改正文文本 —— **场次顺序就是正文里的顺序**，
 * 没有另一份「顺序数据」可以改。这也意味着这个操作必须精确：
 * 一场从它的 `#` 标题开始，到下一个 `#` 之前为止。
 *
 * 第一个场景标题之前的内容（片头说明之类）永远留在最前面。
 */
export function moveScene(body: string, from: number, to: number): string {
  const lines = body.split('\n')
  const doc = parseScript(body)
  const scenes = doc.scenes.filter((s) => s.no >= 0)
  if (from === to || from < 0 || from >= scenes.length || to < 0 || to >= scenes.length) return body

  /** 每一场占哪几行 [起, 止) */
  const ranges = scenes.map((s, i) => {
    const start = s.line
    const end = i + 1 < scenes.length ? scenes[i + 1]!.line : lines.length
    return [start, end] as const
  })

  const head = lines.slice(0, ranges[0]![0])
  const blocks = ranges.map(([a, b]) => lines.slice(a, b))

  const moved = blocks.splice(from, 1)[0]!
  blocks.splice(to, 0, moved)

  // 每一块结尾留一个空行，挪完不至于两场粘在一起
  const body2 = blocks
    .map((b) => {
      const t = [...b]
      while (t.length > 0 && t[t.length - 1]!.trim() === '') t.pop()
      return t
    })
    .flatMap((b) => [...b, ''])

  return [...head, ...body2].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/** 新建剧本时给的骨架 */
/**
 * 第二篇起给的东西：**一行场景标题，没别的**。
 *
 * 每新建一场都塞一遍「李四/王五在咖啡馆」，作者得先删掉十几行才能开始写
 * 自己的东西（作者报过这个）。教一次就够了，第二次是打扰。
 */
export function scriptSceneStub(title = '新的一场'): string {
  return `# ${title}　内景·地点·日\n\n`
}

export function scriptTemplate(title = '第一场'): string {
  return [
    `# ${title}　内景·咖啡馆·日`,
    '',
    '（李四推门进来，雨水顺着伞尖滴在地板上。）',
    '',
    '李四：你等很久了？',
    '',
    '王五（头也不抬）：还好。',
    '',
    '（长久的沉默。窗外有车开过。）',
    '',
    '李四：那件事……',
    '',
    '王五：别说了。',
    '',
    '# 第二场　外景·街道·夜',
    '',
    '（雨停了。两个人一前一后走着，谁也不看谁。）',
    '',
  ].join('\n')
}
