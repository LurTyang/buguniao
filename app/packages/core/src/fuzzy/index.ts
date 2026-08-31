/**
 * 快速跳转用的模糊匹配。
 *
 * 规范：更新文档/06-开发路线图.md M2（Ctrl+P 快速跳转）
 *
 * 中文没有首字母缩写这回事，所以不搞 VSCode 那种驼峰打分。
 * 规则就两条，够用且可预期：
 *   - **连续子串**优先（打「玉佩」找《玉佩的来历》）
 *   - 退而求其次是**子序列**（打「第三玉」也能找到《第三章 玉佩》）
 *
 * 打分只用来排序，不做阈值过滤 —— 匹配上了就该出现在列表里，
 * 由作者自己一眼扫过去，比软件替他judge强。
 */

export interface FuzzyHit<T> {
  item: T
  score: number
  /** 命中的字符下标，界面用来加粗 */
  matched: number[]
}

/**
 * 单条打分。没匹配上返回 null。
 *
 * 分数越大越靠前。构成：
 *   - 连续整段命中：1000 起步，越靠前越高
 *   - 子序列命中：500 起步，减去跨度惩罚
 */
export function scoreOne(query: string, text: string): { score: number; matched: number[] } | null {
  const q = query.trim().toLowerCase()
  if (q === '') return { score: 0, matched: [] }
  const t = text.toLowerCase()

  // 1. 连续子串
  const at = t.indexOf(q)
  if (at >= 0) {
    const matched: number[] = []
    for (let i = 0; i < q.length; i++) matched.push(at + i)
    // 越靠前越好；命中比例越高越好
    return { score: 1000 - at * 2 + Math.round((q.length / Math.max(1, t.length)) * 100), matched }
  }

  // 2. 子序列
  const matched: number[] = []
  let ti = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return null
    matched.push(found)
    ti = found + 1
  }
  // 跨度越紧凑越像是作者想找的那个
  const span = (matched[matched.length - 1] ?? 0) - (matched[0] ?? 0) + 1
  return { score: 500 - span * 3 - (matched[0] ?? 0), matched }
}

/**
 * 在一堆候选里挑出匹配的，按分数排序。
 *
 * `limit` 只是别让列表长到没法看，不是「只有这些」——
 * 界面该说清楚被截断了没有。
 */
export function fuzzyFilter<T>(
  query: string,
  items: readonly T[],
  textOf: (item: T) => string,
  limit = 50,
): Array<FuzzyHit<T>> {
  const hits: Array<FuzzyHit<T>> = []
  for (const item of items) {
    const r = scoreOne(query, textOf(item))
    if (r) hits.push({ item, score: r.score, matched: r.matched })
  }
  // 同分时保持原顺序（章节顺序），稳定排序在 ES2019 之后有保证
  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, limit)
}
