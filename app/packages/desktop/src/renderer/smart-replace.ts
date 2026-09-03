/**
 * 智能替换 —— 打的时候顺手把符号变成中文该有的样子。
 *
 * 规范：更新文档/10-0.4规划.md §4.2
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么这件事值得做】
 *
 * 中文写作里最高频的摩擦不是打字，是**打标点**：引号要切输入法、
 * 破折号要打两个字宽的、省略号是六个点不是三个。一天几百次。
 *
 * 【三条不许破的规矩】
 *
 * 1. **只在输入的那一刻替换，绝不动文件里已有的字。**
 *    不做全文扫描式的「修正」—— 那会改到引用的原文、代码、外文。
 * 2. **撤销一次就退回你原本打的那个字符。** 自动替换而 Ctrl+Z 退不回去，
 *    会让人不敢打字。这一条比功能本身还重要。
 * 3. **能一键全关。**
 *
 * 【规则是一张表，不是几个写死的开关】
 *
 * 每个人的标点习惯不一样：有人要直角引号，有人要弯引号，有人要全角括号。
 * 所以内置那几条只是**默认值**，作者能改、能删、能加。
 * ─────────────────────────────────────────────────────────────
 *
 * 这个文件**纯计算**：给「光标前的文字」和「刚打的字」，算出该怎么替换。
 * 不碰编辑器、不碰 DOM，所以每一条规则都能拿测试钉住 ——
 * 而这一层出的错是「作者打出来的字被悄悄换成了别的」，最不该靠肉眼发现。
 */

/**
 * 成对的符号：开的那个和关的那个要交替出现。
 *
 * **没有 `enabled`。** 存在即生效，不想要就删掉 ——
 * 「关掉」和「删掉」在使用上没有区别，同一件事不该有两个操作。
 */
export interface PairRule {
  id: string
  kind: 'pair'
  /** 打哪个键触发 */
  from: string
  open: string
  close: string
}

/** 直来直去的替换：打出这几个字符就换成那个 */
export interface PlainRule {
  id: string
  kind: 'plain'
  from: string
  to: string
}

export type Rule = PairRule | PlainRule

/**
 * 出厂自带的几条。
 *
 * ⚠️ **它们只是「第一次用时表里长什么样」，不是一份不可改的内置清单。**
 *
 * 作者的话：「默认项目也应该可以编辑，可以删除，而不应该有开关。
 * 所有规则存在即生效，不存在即删除。」
 *
 * 他是对的：一条规则既能关又能删，等于同一件事有两个操作 ——
 * 而「关掉」和「删掉」在使用上没有任何区别。留一个就够，留「删」。
 *
 * 所以这张表在第一次打开设置时被写进配置，之后就完全归作者管：
 * 改哪条、删哪条、加哪条，都是他的事，代码不再插手。
 */
export const SEED_RULES: Rule[] = [
  { id: 'squote-to-dquote', kind: 'pair', from: "'", open: '“', close: '”' },
  { id: 'dquote-to-corner', kind: 'pair', from: '"', open: '「', close: '」' },
  { id: 'angle-to-booktitle', kind: 'pair', from: '<', open: '《', close: '》' },
  { id: 'semi-to-colon', kind: 'plain', from: ';', to: '：' },
  { id: 'dash', kind: 'plain', from: '--', to: '——' },
  { id: 'ellipsis', kind: 'plain', from: '...', to: '……' },
]

/** 这一次要怎么改：往回删几个字符，插进去什么 */
export interface Replacement {
  /** 光标前要删掉几个字符（不含刚打的那个，那个还没进文档） */
  back: number
  insert: string
  /** 是哪条规则干的，界面上要能说清楚 */
  ruleId: string
}

/**
 * 成对符号该给开的还是关的。
 *
 * 数**这一行里**已有的开与关：一样多就是要开一个新的，
 * 开的多说明里头还没关上，该给关的。
 *
 * 按行数而不是按全文数：全文数一遍太慢，而且中文写作里引号极少跨行。
 * 数错了的后果也很轻 —— 打出来的是 ” 而不是 “，手动改一下就行。
 */
export function pairSide(lineBefore: string, r: PairRule): 'open' | 'close' {
  let depth = 0
  for (const ch of lineBefore) {
    if (ch === r.open) depth++
    else if (ch === r.close) depth--
  }
  return depth > 0 ? 'close' : 'open'
}

/**
 * 刚打了一个字符，要不要替换。
 *
 * @param lineBefore 光标所在行、光标**之前**的文字（不含刚打的那个）
 * @param typed      刚打的那一个字符
 * @returns 不用替换就返回 null
 */
export function replaceOn(
  lineBefore: string,
  typed: string,
  rules: readonly Rule[],
): Replacement | null {
  // 一次只处理一个字符。输入法一次上屏一整个词时不插手 ——
  // 那时候「刚打的字」是一整串，按单字符规则去猜只会猜错
  if ([...typed].length !== 1) return null

  for (const r of rules) {
    if (r.kind === 'plain') {
      const whole = lineBefore + typed
      if (!whole.endsWith(r.from)) continue
      // 往回删掉 from 里除了刚打这个字符之外的部分
      const back = r.from.length - typed.length
      if (back < 0) continue
      return { back, insert: r.to, ruleId: r.id }
    }

    if (typed !== r.from) continue
    const side = pairSide(lineBefore, r)
    return { back: 0, insert: side === 'open' ? r.open : r.close, ruleId: r.id }
  }
  return null
}

/**
 * 这一刻真正生效的那些规则。
 *
 * 总开关关着就一条都不给。**「打什么」是空的那些直接丢掉** ——
 * 空的 from 会匹配上每一次输入，那是灾难。
 *
 * ⚠️ **参数收成 `unknown`，不是 `Rule[]`。**
 *
 * 因为它吃的是配置文件里读来的东西，而配置文件是会变老的：
 * 0.4 中途 `smartRules` 从「开关对象」改成了「规则数组」，升级上来的
 * 那份还是对象，这儿一句 `.filter` 就把整个界面炸成白屏 —— 而本地
 * 永远试不出来，因为本地是新配置。
 *
 * 主进程那边有迁移（`config-migrate.ts`）负责搬形状，这儿是第二道：
 * **形状不对就当没有，绝不抛。** 一个装饰性功能不该有能力白掉整块稿纸。
 */
export function liveRules(rules: unknown, masterOn: boolean): Rule[] {
  if (!masterOn) return []
  if (!Array.isArray(rules)) return []
  return (rules as Rule[]).filter((r) => r && typeof r.from === 'string' && r.from.length > 0)
}

/** 加一条。id 用时间戳，只要在他自己的表里唯一就够 */
export function makeRule(from: string, to: string, id: string): PlainRule {
  return { id, kind: 'plain', from, to }
}

/** 一条规则「变成什么」那一格显示什么 */
export function shownAs(r: Rule): string {
  return r.kind === 'pair' ? `${r.open}${r.close}` : r.to
}
