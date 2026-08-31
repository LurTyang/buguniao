/**
 * txt 导入 —— 自动分章。
 *
 * 规范：更新文档/05-功能模块详述.md §10.1
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么「单调递增」是决定性判据】
 *
 * 作者担心的问题是：正文里也会出现「第三章」字样，比如
 *
 *     他想起第三章里师父说过的话。
 *
 * 光靠正则匹配没法区分它和真正的章节标题。
 *
 * 但真正的章节标题会构成一条**从 1 一路递增到几百的完整序列**，
 * 而正文里偶然提到的「第三章」是孤立的、无法融入这条序列的。
 * 所以取所有候选行中**最长的严格递增子序列**，就能把噪音自动剔掉。
 *
 * 这是本模块的核心，比任何正则调优都可靠。
 * ─────────────────────────────────────────────────────────────
 *
 * 注：编码检测（UTF-8 / GBK）是平台相关的，不在本模块。
 *     core 只接收已解码的字符串。
 */

// ───────────────────────── 中文数字 ─────────────────────────

const CN_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9,
  壹: 1, 贰: 2, 叁: 3, 肆: 4, 伍: 5, 陆: 6, 柒: 7, 捌: 8, 玖: 9,
}

const CN_UNITS: Record<string, number> = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000, 万: 10000 }

/**
 * 解析中文或阿拉伯数字。无法解析时返回 null。
 *
 * 支持：`12` `十二` `二十三` `一百零五` `一千零一十二` `一万零一`
 */
export function parseCnNumber(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null

  // 纯阿拉伯数字（含全角）
  const halfWidth = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  if (/^\d+$/.test(halfWidth)) {
    const n = Number(halfWidth)
    return Number.isSafeInteger(n) ? n : null
  }

  let total = 0
  let section = 0
  let num = 0
  let sawAny = false

  for (const ch of s) {
    const d = CN_DIGITS[ch]
    if (d !== undefined) {
      num = d
      sawAny = true
      continue
    }
    const u = CN_UNITS[ch]
    if (u === undefined) return null
    sawAny = true
    if (u === 10000) {
      section = (section + num) * 10000
      total += section
      section = 0
      num = 0
    } else {
      // 「十三」这种省略了前面的一
      if (num === 0 && u === 10) num = 1
      section += num * u
      num = 0
    }
  }

  return sawAny ? total + section + num : null
}

// ───────────────────────── 候选行识别 ─────────────────────────

/** 章节标题最大长度。超过这个长度的行几乎不可能是标题 */
export const MAX_TITLE_LEN = 40

const CN_NUM_CHARS = '0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟'

/** 第X章 / 第X节 / 第X回 / 第X话 */
const CH_RE = new RegExp(`^第\\s*([${CN_NUM_CHARS}]+)\\s*[章节回話话]`)
/** Chapter N */
const EN_RE = /^chapter\s+(\d+)/i
/** 第X卷 / 卷X —— 单独识别，不参与章节序列 */
const VOL_RE = new RegExp(`^(?:第\\s*([${CN_NUM_CHARS}]+)\\s*卷|卷\\s*([${CN_NUM_CHARS}]+))`)

export interface Candidate {
  /** 行号（0 基） */
  line: number
  /** 解析出的序号 */
  num: number
  /** 整行（已 trim），作为章节标题 */
  title: string
  /**
   * 置信度加分项，供界面显示，不参与自动判定：
   * 前后是否有空行、是否很短
   */
  hints: { blankBefore: boolean; blankAfter: boolean; short: boolean }
}

function isBlank(s: string | undefined): boolean {
  return s === undefined || s.trim() === ''
}

/** 扫描出所有**看起来像**章节标题的行（尚未剔除噪音） */
export function findChapterCandidates(lines: readonly string[]): Candidate[] {
  const out: Candidate[] = []
  for (let i = 0; i < lines.length; i++) {
    const t = (lines[i] ?? '').trim()
    if (!t || t.length > MAX_TITLE_LEN) continue

    let num: number | null = null
    const m1 = CH_RE.exec(t)
    if (m1) num = parseCnNumber(m1[1] as string)
    if (num === null) {
      const m2 = EN_RE.exec(t)
      if (m2) num = parseCnNumber(m2[1] as string)
    }
    if (num === null) continue

    out.push({
      line: i,
      num,
      title: t,
      hints: {
        blankBefore: isBlank(lines[i - 1]),
        blankAfter: isBlank(lines[i + 1]),
        short: t.length <= 20,
      },
    })
  }
  return out
}

/** 扫描卷标记行（不参与章节序列，供界面提示作者「检测到 3 卷」） */
export function findVolumeCandidates(lines: readonly string[]): Candidate[] {
  const out: Candidate[] = []
  for (let i = 0; i < lines.length; i++) {
    const t = (lines[i] ?? '').trim()
    if (!t || t.length > MAX_TITLE_LEN) continue
    const m = VOL_RE.exec(t)
    if (!m) continue
    const num = parseCnNumber((m[1] ?? m[2]) as string)
    if (num === null) continue
    out.push({
      line: i,
      num,
      title: t,
      hints: { blankBefore: isBlank(lines[i - 1]), blankAfter: isBlank(lines[i + 1]), short: t.length <= 20 },
    })
  }
  return out
}

// ───────────────────────── 最长严格递增子序列 ─────────────────────────

/**
 * 取最长严格递增子序列（按 `num`）。
 *
 * 这是剔除「正文里偶然提到的第三章」的关键：噪音无法融入完整的递增序列。
 * 长度相同时保留**靠后**出现的那条 —— 因为正文里的伪标题通常出现在真标题之后，
 * 保留靠后的等价于优先保留真序列的尾部，实践中更稳。
 */
export function longestIncreasing(candidates: readonly Candidate[]): Candidate[] {
  const n = candidates.length
  if (n === 0) return []

  // tails[k] = 长度为 k+1 的递增子序列中，结尾值最小的那个的下标
  const tails: number[] = []
  const prev = new Array<number>(n).fill(-1)

  for (let i = 0; i < n; i++) {
    const v = (candidates[i] as Candidate).num
    // 二分找第一个 num >= v 的位置（严格递增，所以用 >=）
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((candidates[tails[mid] as number] as Candidate).num < v) lo = mid + 1
      else hi = mid
    }
    prev[i] = lo > 0 ? (tails[lo - 1] as number) : -1
    tails[lo] = i
  }

  const out: Candidate[] = []
  let cur = tails[tails.length - 1] as number
  while (cur !== -1) {
    out.push(candidates[cur] as Candidate)
    cur = prev[cur] as number
  }
  return out.reverse()
}

// ───────────────────────── 分章 ─────────────────────────

export interface ImportedChapter {
  /** 章节标题（标题行原文） */
  title: string
  /** 识别出的序号 */
  num: number
  /** 正文（不含标题行，已去掉首尾空行） */
  body: string
  /** 标题所在行号，供预览界面定位 */
  titleLine: number
}

export interface ImportPlan {
  /** 第一个章节标题之前的内容（楔子、简介之类）。没有则为 null */
  preamble: string | null
  chapters: ImportedChapter[]
  /** 所有候选行，含被剔除的。预览界面用它让作者手动增删分章点 */
  allCandidates: Candidate[]
  /** 被判定为噪音而剔除的候选（如正文里提到的「第三章」） */
  rejected: Candidate[]
  /** 检测到的卷标记，仅作提示 */
  volumes: Candidate[]
}

export interface ImportOptions {
  /**
   * 手动指定分章行号。给了这个就完全按它来，不做自动判定 ——
   * 预览界面里作者手动增删分章点后走这条路。
   */
  forceLines?: readonly number[]
}

/**
 * 把一大块 txt 切分成章节。
 *
 * 自动判定失败或结果不理想时，作者可以在预览界面里手动增删分章点，
 * 再用 `forceLines` 重新调用。
 */
export function planImport(text: string, opts: ImportOptions = {}): ImportPlan {
  const lines = text.split(/\r?\n/)
  const allCandidates = findChapterCandidates(lines)
  const volumes = findVolumeCandidates(lines)

  let chosen: Candidate[]
  if (opts.forceLines) {
    const wanted = new Set(opts.forceLines)
    chosen = allCandidates.filter((c) => wanted.has(c.line))
    // 手动指定但不在候选里的行，也当成分章点（作者说了算）
    for (const ln of opts.forceLines) {
      if (!allCandidates.some((c) => c.line === ln) && ln >= 0 && ln < lines.length) {
        chosen.push({
          line: ln,
          num: 0,
          title: (lines[ln] ?? '').trim() || `第 ${ln + 1} 行`,
          hints: { blankBefore: isBlank(lines[ln - 1]), blankAfter: isBlank(lines[ln + 1]), short: true },
        })
      }
    }
    chosen.sort((a, b) => a.line - b.line)
  } else {
    chosen = longestIncreasing(allCandidates)
  }

  const chosenLines = new Set(chosen.map((c) => c.line))
  const rejected = allCandidates.filter((c) => !chosenLines.has(c.line))

  const chapters: ImportedChapter[] = chosen.map((c, i) => {
    const endLine = i + 1 < chosen.length ? (chosen[i + 1] as Candidate).line : lines.length
    return {
      title: c.title,
      num: c.num,
      titleLine: c.line,
      body: trimBlankEdges(lines.slice(c.line + 1, endLine)).join('\n'),
    }
  })

  const firstLine = chosen[0]?.line ?? lines.length
  const preambleLines = trimBlankEdges(lines.slice(0, firstLine))
  const preamble = preambleLines.length > 0 ? preambleLines.join('\n') : null

  return { preamble, chapters, allCandidates, rejected, volumes }
}

function trimBlankEdges(lines: string[]): string[] {
  let s = 0
  let e = lines.length
  while (s < e && (lines[s] ?? '').trim() === '') s++
  while (e > s && (lines[e - 1] ?? '').trim() === '') e--
  return lines.slice(s, e)
}

/**
 * 从章节标题里拆出「序号部分」和「名字部分」。
 * `第三章 坠楼` → { prefix: '第三章', name: '坠楼' }
 */
export function splitTitle(title: string): { prefix: string; name: string } {
  const m = new RegExp(`^(第\\s*[${CN_NUM_CHARS}]+\\s*[章节回話话]|chapter\\s+\\d+)`, 'i').exec(title.trim())
  if (!m) return { prefix: '', name: title.trim() }
  const prefix = (m[1] as string).trim()
  const name = title.trim().slice((m[1] as string).length).replace(/^[\s:：、.．·\-—]+/, '')
  return { prefix, name }
}
