/**
 * 从设定集里认人。
 *
 * 规范：更新文档/05-功能模块详述.md §13.5
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么剧本要认人，而不是靠猜】
 *
 * `角色名：台词` 这条规矩靠正则是猜出来的 —— 卡得再死也只能挡掉大部分
 * 误伤，挡不掉「时间：三年后」「注意：这里要改」这种。
 *
 * 而作者的**设定集里本来就写着这本书有哪些人**。把那份名单读进来，
 * 「李四」就是确凿的角色名，「时间」就不是。有了确凿的名单才敢做两件事：
 *
 *   1. 把角色名单独排一行（排错了就是把叙述句拆成两半，很难看）
 *   2. 指出「这个名字不在人物卡里」—— 抓的是**写错的人名**，
 *      「李西」和「李四」在统计表里是两个人，而作者根本看不出来
 *
 * 哪几个分类算「人物」由作者自己选，可以多选：有人把角色拆成
 * 「主要人物」「配角」两个文件夹，也有人叫「角色卡」。
 * ─────────────────────────────────────────────────────────────
 */

/** 名字里出现这些就不是人名，是作者拿分类当笔记本用 */
const NOT_A_NAME = /[，。？！；：:、\n\t]/

/** 分类名长这样的，默认当成人物分类 */
const LOOKS_LIKE_CAST = /人物|角色|人設|人设|登场|出场|cast/i

/** 卡片名前面的编号：`01-李四`、`1. 李四`、`03_李四` */
const ORDER_PREFIX = /^\d{1,3}\s*[-_.、．,]\s*/

/** 卡片名后面的补充说明：`李四（男主）`、`李四【反派】` */
const TITLE_SUFFIX = /[（(【\[][^）)】\]]*[）)】\]]\s*$/

/** 卡片正文里的别名行 */
const ALIAS_LINE = /^\s*(?:别名|別名|又名|曾用名|小名|昵称|暱稱|称呼|稱呼|外号|綽號|绰号)\s*[：:](.+)$/

/** 别名之间的分隔 */
const ALIAS_SPLIT = /[、，,\/｜|]+|\s{1,}/

export interface CastCard {
  /** 卡片标题（文件名去掉扩展名） */
  title: string
  /** 卡片正文。给了才能读出别名；不给就只认标题 */
  body?: string
}

export interface Cast {
  /** 全部认得的名字（正名 + 别名），去过重 */
  names: string[]
  /** 别名 → 正名。正名映射到自己 */
  canonical: Record<string, string>
}

/**
 * 猜哪几个分类是人物分类。
 *
 * 只在作者**还没选过**的时候用 —— 选过就听他的，一个都不许多猜。
 * 猜不中也不要紧：面板上就摆着那几个复选框。
 */
export function guessCastCategories(categoryNames: readonly string[]): string[] {
  return categoryNames.filter((n) => LOOKS_LIKE_CAST.test(n))
}

/**
 * 卡片标题里把名字抠出来。
 *
 * 「01-李四（男主）」→「李四」。编号和括号补充都是作者给自己看的，
 * 不是他在剧本里会打的字。
 */
export function nameFromCardTitle(title: string): string {
  return title.replace(ORDER_PREFIX, '').replace(TITLE_SUFFIX, '').trim()
}

/** 卡片正文里的别名。没有就是空数组 */
export function aliasesFromBody(body: string): string[] {
  const out: string[] = []
  for (const raw of body.split('\n')) {
    // front-matter 的 `---` 之类不用特别处理：那几行匹配不上别名行
    const m = ALIAS_LINE.exec(raw.trim())
    if (!m) continue
    for (const bit of (m[1] ?? '').split(ALIAS_SPLIT)) {
      const n = bit.trim().replace(TITLE_SUFFIX, '').trim()
      if (n) out.push(n)
    }
  }
  return out
}

/**
 * 把卡片清单变成一份可用的名单。
 *
 * 太长的和带标点的都扔掉 —— 那不是名字，是作者在卡片名里写了一句话。
 * 混进去的后果是把一整句叙述当成角色名，排版当场垮掉。
 */
export function buildCast(cards: readonly CastCard[], maxNameLength = 10): Cast {
  const canonical: Record<string, string> = {}
  const names: string[] = []

  const add = (name: string, main: string): void => {
    if (!name || name.length > maxNameLength || NOT_A_NAME.test(name)) return
    if (canonical[name] !== undefined) return
    canonical[name] = main
    names.push(name)
  }

  for (const card of cards) {
    const main = nameFromCardTitle(card.title)
    if (!main || main.length > maxNameLength || NOT_A_NAME.test(main)) continue
    add(main, main)
    // 原样的卡片名也认一下：作者真在剧本里打了「李四（男主）」也不该漏
    add(card.title.trim(), main)
    if (card.body) for (const a of aliasesFromBody(card.body)) add(a, main)
  }

  return { names, canonical }
}

/** 空名单。没配人物分类时用它，语义是「谁都不确凿」 */
export function emptyCast(): Cast {
  return { names: [], canonical: {} }
}

/** 这个名字在名单里吗 */
export function knownName(cast: Cast, who: string): boolean {
  return Object.prototype.hasOwnProperty.call(cast.canonical, who)
}

/** 归到正名。不在名单里就原样返回 */
export function canonicalName(cast: Cast, who: string): string {
  return cast.canonical[who] ?? who
}
