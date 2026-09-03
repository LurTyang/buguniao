/**
 * 设置里那个数字输入框的解析。
 *
 * 单独一个文件是为了能测：组件那边要 `window.bugu`，而这一条
 * 抠错了的后果是**作者的字号被悄悄改成别的** —— 最该钉住的正是它。
 */

/**
 * 从一串文字里抠出一个数。
 *
 * 作者要求「输入纯数字或带单位的都可以」，所以 `18`、`18px`、`1.9 倍`
 * 都要认。**抠不出来返回 null，不猜** —— 猜错了不如退回原值。
 */
export function parseNumberLoose(raw: string): number | null {
  const m = /-?\d+(?:\.\d+)?/.exec(raw.trim())
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}

/**
 * 收进合法范围，并把浮点尾巴抹掉。
 *
 * `1.9` 这种值乘除之后会变成 `1.9000000000000001`，直接显示出来很吓人。
 */
export function clampToStep(n: number, min: number, max: number, step: number): number {
  const snapped = Math.round(n / step) * step
  const clamped = Math.min(max, Math.max(min, snapped))
  return Number(clamped.toFixed(step < 1 ? 1 : 0))
}
