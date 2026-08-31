/**
 * 从别的写作软件搬进来。
 *
 * 规范：更新文档/05-功能模块详述.md §15
 *
 * ─────────────────────────────────────────────────────────────
 * 【实话说在前面：哪些格式是有把握的，哪些是猜的】
 *
 * ✅ **Scrivener** —— `.scriv` 是一个文件夹，里面 `*.scrivx` 是 XML 目录树，
 *    正文在 `Files/Data/<UUID>/content.rtf`（新版）或 `Files/Docs/<id>.rtf`（旧版）。
 *    这个格式有公开文档，下面按它实现。
 *
 * ✅ **一整个文件夹的 txt/md** —— 几乎所有软件都能导出成这个。
 *    真正通用的那条路，也是最不会出错的一条。
 *
 * ⚠️ **青茉 / 码字精灵** —— 私有格式，我手上没有样本文件，
 *    **不去猜**。猜错的后果是把作者几百万字导成乱码。
 *    这两家先走「导出成 txt 再用文件夹导入」，
 *    等作者给一个真实文件，再按真实结构写。
 * ─────────────────────────────────────────────────────────────
 */

export type ForeignKind = 'scrivener' | 'folder'

export interface ForeignChapter {
  title: string
  body: string
  /** 在原软件里的层级：0 是顶层。文件夹导入时按目录深度算 */
  depth: number
  /** 原始文件路径，出问题时好查 */
  source: string
}

export interface ForeignPlan {
  kind: ForeignKind
  /** 从哪儿导的 */
  from: string
  chapters: ForeignChapter[]
  /** 没能读出正文的那些，如实列出来，不闷声跳过 */
  skipped: Array<{ source: string; why: string }>
}

// ───────────────────────── Scrivener ─────────────────────────

export interface ScrivenerItem {
  id: string
  title: string
  depth: number
  /** Scrivener 的文件夹节点没有正文，只是分组 */
  isFolder: boolean
}

/**
 * 解析 `.scrivx` 里的目录树。
 *
 * 结构是嵌套的 `<Binder><BinderItem ...><Children>…`，
 * 每个 item 有 `UUID`/`ID`、`Type`、`<Title>`。
 *
 * 只取 `DraftFolder` 下面的东西 —— Research、Trash 里的不是正文，
 * 一股脑导进来只会把作者的目录搅乱。
 */
export function parseScrivx(xml: string): ScrivenerItem[] {
  const out: ScrivenerItem[] = []

  // 先框出 Draft/Manuscript 那一段。
  // ⚠️ 不能用非贪婪正则去截 —— `<BinderItem …>([\s\S]*?)</BinderItem>`
  // 会停在**第一个**闭合标签上，于是只截到第一章就没了。
  // XML 是嵌套的，只能数着层级找到配对的那个闭合标签。
  const scope = sliceDraft(xml) ?? xml

  // 手写扫描而不是正则递归：XML 嵌套用正则是写不对的，
  // 而这里只需要知道每个 BinderItem 的层级
  let depth = -1
  const tag = /<(\/?)BinderItem\b([^>]*)>|<(\/?)Children\b[^>]*>|<Title>([\s\S]*?)<\/Title>/gi
  let pending: ScrivenerItem | null = null

  for (let m = tag.exec(scope); m !== null; m = tag.exec(scope)) {
    const [, closeItem, attrs, closeChildren, title] = m

    if (title !== undefined && pending) {
      pending.title = decodeXml(title).trim() || '未命名'
      out.push(pending)
      pending = null
      continue
    }
    if (attrs !== undefined && closeItem === '') {
      const id = /\b(?:UUID|ID)="([^"]+)"/i.exec(attrs)?.[1] ?? ''
      const type = /\bType="([^"]+)"/i.exec(attrs)?.[1] ?? ''
      pending = {
        id,
        title: '未命名',
        depth: Math.max(0, depth + 1),
        isFolder: /folder/i.test(type),
      }
      continue
    }
    if (closeChildren === '') depth += 1
    else if (closeChildren === '/') depth -= 1
  }

  return out.filter((i) => i.id !== '')
}

/**
 * 截出 DraftFolder（正文那一支）的内容。
 *
 * 从它的开标签往后数 BinderItem 的开闭，数到配平为止。
 * 找不到就返回 null，调用方退回整个 Binder。
 */
function sliceDraft(xml: string): string | null {
  const open = /<BinderItem[^>]*Type="DraftFolder"[^>]*>/i.exec(xml)
  if (!open) return null

  const from = open.index + open[0].length
  const tag = /<(\/?)BinderItem[^>]*?(\/?)>/gi
  tag.lastIndex = from
  let level = 0

  for (let m = tag.exec(xml); m !== null; m = tag.exec(xml)) {
    const closing = m[1] === '/'
    const selfClosing = m[2] === '/'
    if (selfClosing) continue
    if (closing) {
      if (level === 0) return xml.slice(from, m.index)
      level -= 1
    } else {
      level += 1
    }
  }
  return xml.slice(from)
}

/** XML 实体。Scrivener 的标题里 `&amp;` 很常见 */
function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

/**
 * 把 RTF 扒成纯文本。
 *
 * 不做完整的 RTF 解析 —— 那是个大工程，而我们只要文字。
 * 处理的是实际会遇到的几样：控制字、分组、`\par` 换行、
 * `\uN?` 的 Unicode 转义（中文全靠它）。
 *
 * ⚠️ 认不出来的控制字**整条丢掉**，不留下 `\f0\fs24` 这种垃圾在正文里。
 */
export function rtfToText(rtf: string): string {
  if (!rtf.trimStart().startsWith('{\\rtf')) return rtf // 本来就是纯文本

  let out = ''
  let i = 0
  /** 跳过整组的深度（`\*\generator` 这类里面的东西不要） */
  let skipDepth = 0
  let depth = 0

  while (i < rtf.length) {
    const ch = rtf[i]!

    if (ch === '{') {
      depth += 1
      i += 1
      // `{\*\xxx ...}` 整组丢掉
      if (rtf.startsWith('\\*', i) && skipDepth === 0) skipDepth = depth
      continue
    }
    if (ch === '}') {
      if (skipDepth === depth) skipDepth = 0
      depth -= 1
      i += 1
      continue
    }
    if (ch === '\\') {
      const m = /^\\([a-zA-Z]+)(-?\d+)?[ ]?/.exec(rtf.slice(i))
      if (m) {
        const [full, word, num] = m
        i += full.length
        if (skipDepth !== 0) continue
        if (word === 'par' || word === 'line') out += '\n'
        else if (word === 'tab') out += '\t'
        else if (word === 'u' && num !== undefined) {
          const code = Number(num)
          out += String.fromCodePoint(code < 0 ? code + 65536 : code)
          // `\uN` 后面跟着一个给老软件看的替代字符，要吃掉
          if (rtf[i] === '?') i += 1
        }
        continue
      }
      // `\\` `\{` `\}` 这类转义
      const esc = rtf[i + 1]
      i += 2
      if (skipDepth === 0 && esc !== undefined) out += esc
      continue
    }

    i += 1
    if (skipDepth === 0 && ch !== '\r' && ch !== '\n') out += ch
  }

  return out
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim()
}

// ───────────────────────── 文件夹 ─────────────────────────

export interface FolderFile {
  /** 相对根目录的路径，用 `/` 分隔 */
  relPath: string
  content: string
}

/** 文件名里的排序前缀：`01-`、`1.`、`第三章` 都很常见 */
function sortKey(name: string): [number, string] {
  const m = /^(\d+)\s*[-_.、）)]?\s*/.exec(name)
  return [m ? Number(m[1]) : Number.MAX_SAFE_INTEGER, name]
}

/**
 * 一整个文件夹的 txt/md 当成一本书。
 *
 * 这是真正通用的那条路：几乎所有写作软件都能导出成一堆 txt。
 * 排序按**文件名里的数字前缀**，没有数字的按名字排在后面 ——
 * 「10」排在「9」前面是这里最容易犯的错，所以按数字比而不是按字符串比。
 */
export function planFolderImport(files: readonly FolderFile[], from = ''): ForeignPlan {
  const chapters: ForeignChapter[] = []
  const skipped: Array<{ source: string; why: string }> = []

  const usable = files.filter((f) => {
    if (!/\.(txt|md|markdown)$/i.test(f.relPath)) {
      skipped.push({ source: f.relPath, why: '不是 txt 或 md' })
      return false
    }
    if (f.content.trim() === '') {
      skipped.push({ source: f.relPath, why: '文件是空的' })
      return false
    }
    return true
  })

  usable.sort((a, b) => {
    const pa = a.relPath.split('/')
    const pb = b.relPath.split('/')
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i]
      const y = pb[i]
      if (x === undefined) return -1
      if (y === undefined) return 1
      if (x === y) continue
      const [na, sa] = sortKey(x)
      const [nb, sb] = sortKey(y)
      if (na !== nb) return na - nb
      return sa.localeCompare(sb, 'zh')
    }
    return 0
  })

  for (const f of usable) {
    const parts = f.relPath.split('/')
    const name = parts[parts.length - 1] ?? f.relPath
    chapters.push({
      title: name.replace(/\.(txt|md|markdown)$/i, '').replace(/^\d+\s*[-_.、）)]?\s*/, '') || name,
      body: f.content.replace(/\r\n?/g, '\n').trim(),
      depth: parts.length - 1,
      source: f.relPath,
    })
  }

  return { kind: 'folder', from, chapters, skipped }
}

/**
 * Scrivener：把目录树和正文文件配起来。
 *
 * `readText(id)` 由调用方提供 —— core 不碰文件系统。
 */
export function planScrivenerImport(
  items: readonly ScrivenerItem[],
  readText: (id: string) => string | null,
  from = '',
): ForeignPlan {
  const chapters: ForeignChapter[] = []
  const skipped: Array<{ source: string; why: string }> = []

  for (const it of items) {
    const raw = readText(it.id)
    if (raw === null) {
      // 文件夹节点本来就没有正文，不算问题
      if (!it.isFolder) skipped.push({ source: `${it.title}（${it.id}）`, why: '找不到正文文件' })
      continue
    }
    const body = rtfToText(raw).trim()
    if (body === '') {
      if (!it.isFolder) skipped.push({ source: it.title, why: '正文是空的' })
      continue
    }
    chapters.push({ title: it.title, body, depth: it.depth, source: it.id })
  }

  return { kind: 'scrivener', from, chapters, skipped }
}

/** 导入前给作者看的一句话 */
export function describePlan(plan: ForeignPlan): string {
  const chars = plan.chapters.reduce((s, c) => s + c.body.length, 0)
  const bits = [`${plan.chapters.length} 章`, `约 ${chars.toLocaleString()} 字`]
  if (plan.skipped.length > 0) bits.push(`跳过 ${plan.skipped.length} 个文件`)
  return bits.join('，')
}
