/**
 * 把数字说成人话 —— 「还差多少」和「多久以前」。
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么单拎出来】
 *
 * 这两句话都要出现在最显眼的位置（左栏那一格、书架每张卡），
 * 而它们错了的样子很难被看见：文案在某个边界上说反（差 0 字还写着
 * 「还差」）、时间在跨天那一下说错（十分钟前写的显示成「昨天」）。
 * 纯函数 + 测试钉住，比在界面上肉眼扫可靠得多。
 *
 * 【一条底线：不催、不责备】
 *
 * 连胜断了那儿是「上次连了 N 天」，不是「你搞砸了」——
 * 这两句话也照这个来。没写就说还差多少（那是事实），
 * 不说「你今天还没开始」。
 * ─────────────────────────────────────────────────────────────
 */

/** 千分位。跟界面上别处一个写法 */
function n(x: number): string {
  return Math.round(x).toLocaleString()
}

/**
 * 「今天」那一格底下那句话。没设目标时返回空串 —— 不说话。
 *
 * 四档：离得远、快到了、够了、理想线也够了。
 * 「快到了」那一档是有意的：还差两百字的时候，人很可能会把它写完，
 * 而这一句正是那一下的推力。
 */
export function todaySay(o: { words: number; floor: number; ideal: number }): string {
  const { words, floor, ideal } = o
  if (floor <= 0) return ''

  if (words >= floor) {
    if (ideal > floor && words < ideal) return `达标了 · 离理想线还差 ${n(ideal - words)} 字`
    return words >= ideal && ideal > floor ? '理想线也到了' : '今天达标了'
  }

  const rest = floor - words
  // 「快到了」的门槛：底线的一成五，但至少两百字 ——
  // 目标一千的人剩一百五算快到了，目标三千的人剩一百五更算
  return rest <= Math.max(200, floor * 0.15) ? `就差 ${n(rest)} 字` : `还差 ${n(rest)} 字`
}

/**
 * 「多久以前」。
 *
 * ⚠️ **跨天按日历算，不按 24 小时算。** 昨晚十一点写的，今早八点看
 * 只过了九小时 —— 但人要的是「昨天」，不是「9 小时前」。
 * 按小时数算的话，这两种说法会在半夜互相打架。
 */
export function agoText(ms: number, now: number): string {
  if (!ms || ms <= 0) return ''
  const diff = now - ms
  if (diff < 0) return '刚刚'
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`

  const day = (t: number) => {
    const d = new Date(t)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  const days = Math.round((day(now) - day(ms)) / 86_400_000)
  if (days <= 0) return `${Math.floor(diff / 3600_000)} 小时前`
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`

  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  const md = `${d.getMonth() + 1} 月 ${d.getDate()} 日`
  return sameYear ? md : `${d.getFullYear()} 年 ${md}`
}

/** 书架卡片上的字数。还没索引到（0）时不说话 —— 显示「0 字」看着像这本书空了 */
export function charsText(chars: number): string {
  if (chars <= 0) return ''
  if (chars < 10_000) return `${n(chars)} 字`
  return `${(chars / 10_000).toFixed(1).replace(/\.0$/, '')} 万字`
}
