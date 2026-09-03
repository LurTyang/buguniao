/**
 * 把老配置搬成新形状。
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么必须有这一层】
 *
 * 作者报的「打开任何书都是一片纯白」，最可能的成因就是这个：
 * 0.4 中途把 `smartRules` 从「一个开关对象」改成了「一张规则数组」，
 * 而他机器上那份配置里存的还是老形状。
 *
 * 于是 `settings.smartRules ?? SEED_RULES` 拿到的是 `{}`（不是 null，
 * 所以 `??` 不接管），接着 `rules.filter(...)` —— **对象没有 filter**，
 * 当场抛异常，React 把整棵树卸掉，屏幕纯白。
 *
 * 而我这边是干净配置，`smartRules` 是 null，一切正常 —— 所以本地
 * 怎么试都试不出来。**只在升级的人那儿炸**，是这类 bug 的通病。
 *
 * 【规矩】
 *
 * 1. **认不出来的就丢掉，退回默认值。** 别试图抢救一个形状不对的值 ——
 *    猜错了就是把作者的设置改成他没选过的样子。
 * 2. **只做形状，不做语义。** 这儿不判断「这个值合不合理」，
 *    那是各个功能自己的事。
 * 3. 每加一个会改形状的字段，就得往这儿加一条。没有例外。
 * ─────────────────────────────────────────────────────────────
 */

/** 一条标点替换规则的新形状 */
type SmartRule =
  | { id: string; kind: 'plain'; from: string; to: string }
  | { id: string; kind: 'pair'; from: string; open: string; close: string }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * 标点替换规则。
 *
 * 老形状有两种，都要认：
 *   0.4 中途：`smartRules: {}`（开关表）+ `customRules: []`（自定义那几条）
 *   更早：两个字段都没有
 *
 * 老的开关表**整个丢掉** —— 它记的是「内置那几条各自开着没有」，
 * 而内置那个概念已经不存在了，翻译不过来。自定义那几条能搬就搬。
 */
export function migrateSmartRules(raw: Record<string, unknown>): SmartRule[] | null {
  const cur = raw['smartRules']

  // 已经是新形状：数组
  if (Array.isArray(cur)) {
    const out: SmartRule[] = []
    for (const item of cur) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const id = str(o['id'])
      const from = str(o['from'])
      if (!id || !from) continue
      if (o['kind'] === 'pair') {
        out.push({ id, kind: 'pair', from, open: str(o['open']), close: str(o['close']) })
      } else {
        out.push({ id, kind: 'plain', from, to: str(o['to']) })
      }
    }
    return out
  }

  const old = raw['customRules']
  if (Array.isArray(old)) {
    // 0.4 中途那一版：自定义规则单独一个数组，带 enabled。
    // 停用的直接不搬 —— 新模型里「存在即生效」，停用就等于不要
    const kept: SmartRule[] = []
    for (const item of old) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      if (o['enabled'] === false) continue
      const from = str(o['from'])
      if (!from) continue
      kept.push({ id: str(o['id']) || `r${kept.length}`, kind: 'plain', from, to: str(o['to']) })
    }
    // 搬出来是空的就当没配过（null = 用出厂那几条）
    return kept.length > 0 ? kept : null
  }

  // 认不出来（老的开关对象、别的什么东西）→ 当没配过
  return null
}

/**
 * 自定义主题栏位。这一项前后改过三次形状，每一次都得能接上：
 *
 *   0.3      `themeCss` 一个字符串
 *   0.4 早期  三个字符串
 *   0.4 中期  三个 `{path,name,color}`
 *   现在      **长度会变的一排** `{path,draft,name,color}`，
 *            末尾永远留一个空位，最多九个
 *
 * 接不上的后果不是报错，是「我的主题怎么没了」—— 那是最不能接受的一种。
 */
// draft 在这一层是 unknown：迁移只负责**原样搬过去**，不解释它的内容。
// 认它的形状是 shared/theme-draft.ts 的事，在这儿多认一遍只会多一处要同步
type Slot = { path: string; draft: unknown; name: string; color: string }
const EMPTY: Slot = { path: '', draft: null, name: '', color: '' }

/** `phycat-mint.css` → `phycat mint`。跟 theme-name.ts 那份一个规矩 */
function nameOf(p: string): string {
  const base = (p.split('/').pop() ?? p).split(String.fromCharCode(92)).pop() ?? p
  return base.replace(/\.css$/i, '').replace(/[-_]+/g, ' ').trim() || '自选样式'
}

/** 一格不管原来是什么形状，都收拾成现在这个样子 */
function oneSlot(x: unknown): Slot {
  if (typeof x === 'string') return x ? { path: x, draft: null, name: nameOf(x), color: '' } : EMPTY
  const o = (x ?? {}) as Record<string, unknown>
  const path = str(o['path'])
  const draft = o['draft']
  // 自制主题：草稿在就留着，名字沿用原来的
  if (draft && typeof draft === 'object') {
    return {
      path: '',
      draft,
      name: str(o['name']) || '我的主题',
      color: str(o['color']),
    }
  }
  if (!path) return EMPTY
  /*
   * 颜色留空 —— 它要读一遍 CSS 才抠得出来，而迁移不该去读文件。
   * 空串时界面用当前主题的色兜底，看着不会错。
   *
   * 顺带把 0.4 早先那批**抠错的颜色**一起洗掉：那一版会把
   * `#write code{…}` 的底色当成纸色，于是色块是薄荷绿、稿纸却是白的。
   * 下次读主题时会重新抠一次，抠对了再存回去。
   */
  return { path, draft: null, name: str(o['name']) || nameOf(path), color: '' }
}

export function migrateThemeSlots(raw: Record<string, unknown>): {
  themeCssSlots: Slot[]
  themeCssActive: number
} | null {
  const slots = raw['themeCssSlots']
  const active = typeof raw['themeCssActive'] === 'number' ? (raw['themeCssActive'] as number) : 0

  if (Array.isArray(slots)) {
    const cleaned = slots.map(oneSlot)
    /*
     * 已经是新形状就别动。
     *
     * 判据是「每一格都有 draft 这个键，而且没有多余的空位」——
     * 少了这一条的话每次启动都会 patch 一遍配置，白写盘。
     */
    const already =
      slots.every((x) => x && typeof x === 'object' && 'draft' in (x as object)) &&
      sameShape(cleaned, slots as unknown[])
    if (already) return null
    return { themeCssSlots: tidy(cleaned), themeCssActive: active }
  }

  const legacy = str(raw['themeCss'])
  if (!legacy) return null
  return {
    themeCssSlots: tidy([{ path: legacy, draft: null, name: nameOf(legacy), color: '' }]),
    themeCssActive: 0,
  }
}

/** 挤掉空位、末尾留一个、最多九个。跟 shared/theme-slots.ts 同一套规矩 */
function tidy(list: Slot[]): Slot[] {
  const filled = list.filter((s) => s.path || s.draft).slice(0, 9)
  return filled.length >= 9 ? filled : [...filled, { ...EMPTY }]
}

/** 收拾前后长得一不一样。一样就说明本来就规矩，不用写盘 */
function sameShape(a: Slot[], b: unknown[]): boolean {
  const t = tidy(a)
  if (t.length !== b.length) return false
  return t.every((s, i) => {
    const o = (b[i] ?? {}) as Record<string, unknown>
    return s.path === str(o['path']) && s.name === str(o['name'])
  })
}

/**
 * 走一遍所有迁移。
 *
 * 返回要盖在配置上的那几项；没什么要改的就是空对象。
 */
export function migrateConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}

  // smartRules：只要不是数组也不是 null，就必须重写 —— 老的开关对象
  // 留在那儿会让渲染进程调 .filter 时当场炸
  const cur = raw['smartRules']
  if (cur !== null && cur !== undefined && !Array.isArray(cur)) {
    patch['smartRules'] = migrateSmartRules(raw)
  } else if (Array.isArray(raw['customRules']) && (cur === null || cur === undefined)) {
    const moved = migrateSmartRules(raw)
    if (moved !== null) patch['smartRules'] = moved
  }

  const themes = migrateThemeSlots(raw)
  if (themes) Object.assign(patch, themes)

  return patch
}
