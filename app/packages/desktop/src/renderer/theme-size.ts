/**
 * 「每个主题各自记住字号」这件事的算法。
 *
 * 为什么要有它：深色底上同样的字号看着就是小一号，所以换到夜间之后
 * 多数人会想把字调大。但换回纸白时又得调回来 —— 一天来回两次，
 * 调四遍。记住就不用调了。
 *
 * 单独一个文件是为了能测。它错了不会报错，只会**悄悄改掉作者的字号**，
 * 而字号是他每天都在看的东西。
 */

/** 这一步之后设置要变成什么样。空对象 = 什么都不用改 */
export type SizePatch = { fontSize?: number; fontSizeByTheme?: Record<string, number> }

/**
 * 换主题了：把那一档上次用的字号取回来。
 *
 * 没记过就**不动字号** —— 第一次换到夜间时保持当前大小，
 * 而不是跳回某个默认值。跳一下会让人以为软件把设置搞乱了。
 */
export function onThemeSwitch(
  nextTheme: string,
  table: Readonly<Record<string, number>>,
  currentSize: number,
): SizePatch {
  const remembered = table[nextTheme]
  if (typeof remembered !== 'number' || remembered === currentSize) return {}
  return { fontSize: remembered }
}

/**
 * 调字号了：记在当前这一档名下。
 *
 * **换主题那一次不记。** 换主题时字号是被这段逻辑自己改的，
 * 再记一遍等于把新主题的字号写进旧主题里 —— 于是两档会互相污染，
 * 最后两边都变成同一个数。这是这段逻辑唯一的坑。
 */
export function onSizeChange(
  theme: string,
  size: number,
  table: Readonly<Record<string, number>>,
): SizePatch {
  if (table[theme] === size) return {}
  return { fontSizeByTheme: { ...table, [theme]: size } }
}
