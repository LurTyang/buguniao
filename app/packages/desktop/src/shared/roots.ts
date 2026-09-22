/**
 * 作品库目录这一排 —— 加一个、去一个、怎么显示、索引文件叫什么。
 *
 * 规范：更新文档/01-产品定义与范围.md §5
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么要能有好几个】
 *
 * 作者要的：「使不咕鸟可以导入多个目录，并在不同的目录间切换。」
 *
 * 一个作品库是**一个文件夹**，里面摆着若干本书。而真实的情况是
 * 稿子不止摆在一处：同步盘里一份（日常写的）、移动硬盘里一份（旧稿）、
 * 工作电脑拷过来一份（别人给的）。原来只能记住一个，想看另一处
 * 就得「更换目录」—— 换过去，原来那个路径就没人记得了，
 * 下次再换回来还得自己翻一遍文件夹。
 *
 * 所以改成**记住一排，随时切**。切换只是换个看的地方，
 * **不动任何文件**：加进来不复制、移出去不删除。
 *
 * 【纯函数，不碰 fs】
 *
 * 这个文件主进程和界面两边都要用（界面要把路径显示成一个名字），
 * 所以一行 Node 的东西都不能有 —— `node:crypto` 进了渲染进程就打不了包。
 * 哈希因此是自己写的 FNV-1a，它只用来给索引文件起个不撞的名字，
 * 不是安全用途。
 * ─────────────────────────────────────────────────────────────
 */

/**
 * 统一成一个样子再比。
 *
 * 同一个文件夹能写出好几种样子：`D:\书\` 和 `D:/书`、
 * 挑目录时末尾带不带斜杠。不统一的话，同一个目录会在列表里出现两次，
 * 而作者看到的是两行一模一样的名字。
 */
export function normalizeRoot(p: string): string {
  const s = p.replace(/\\/g, '/').trim()
  // 末尾的斜杠去掉，但别把「D:/」或者「/」本身削没了
  return s.length > 1 && s.endsWith('/') && !s.endsWith(':/') ? s.slice(0, -1) : s
}

/**
 * 是不是同一个目录。
 *
 * **不分大小写**：Windows 的文件系统本来就不分，
 * `D:\书` 和 `d:\书` 是同一个文件夹，列表里不该有两行。
 */
export function sameRoot(a: string, b: string): boolean {
  return normalizeRoot(a).toLowerCase() === normalizeRoot(b).toLowerCase()
}

/** 加一个进来。已经在里头就不动，**顺序不变** —— 列表跳来跳去会让人找不着 */
export function addRoot(list: readonly string[], p: string): string[] {
  const one = normalizeRoot(p)
  if (one === '') return [...list]
  return list.some((x) => sameRoot(x, one)) ? [...list] : [...list, one]
}

/** 去掉一个。**只是不再记着它，文件一个都不动** */
export function removeRoot(list: readonly string[], p: string): string[] {
  return list.filter((x) => !sameRoot(x, p))
}

/**
 * 这个目录在界面上叫什么 —— 取最后一段文件夹名。
 *
 * 整条路径太长，摆在书架顶栏那一行放不下；而作者认的本来就是
 * 「我那个叫『小说』的文件夹」。完整路径挂在 title 上，鼠标停一下就能看见。
 */
export function rootName(p: string): string {
  const s = normalizeRoot(p)
  const last = s.split('/').filter(Boolean).pop() ?? ''
  return last || s || '作品库'
}

/** FNV-1a 32 位。只用来给索引文件起个不撞的名字，不是安全用途 */
function hash32(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * 这个作品库的索引文件叫什么。
 *
 * ⚠️ **每个目录一份索引，不能共用。**
 *
 * 索引里的路径是**相对作品库**的（`第九神座/正文/0010-第一章.md`）。
 * 两个库共用一份索引的话，两边只要有同名的书，记录就会互相覆盖 ——
 * 表现是在 A 库里搜，搜出 B 库里的句子，点进去还打不开。
 * 而索引是派生物，拆开的代价只是各自重扫一遍。
 *
 * 名字里带上文件夹名只是为了在 `%APPDATA%` 里一眼能认出谁是谁，
 * 真正保证不撞的是后面那段哈希。
 */
export function indexFileName(root: string): string {
  const name = rootName(root).replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 24)
  return `index-${name ? `${name}-` : ''}${hash32(normalizeRoot(root).toLowerCase())}.db`
}
