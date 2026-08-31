/**
 * 右键菜单。
 *
 * 刻意做得很轻：一个绝对定位的浮层 + 点外面就关。
 * 目录树上的重命名、删除、换卷全靠它。
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  label: ReactNode
  /** 有 submenu 的项不用给 onClick —— 它自己不是个动作 */
  onClick?: () => void
  /** 危险操作（删除之类），显示为红色 */
  danger?: boolean
  disabled?: boolean
  /** 在这一项之前画一条分隔线 */
  separatorBefore?: boolean
  /**
   * 下级菜单。只支持一层。
   *
   * 一组同类的互斥选项（改格式、改状态）平铺在一级菜单上，
   * 会把「打开」「重命名」这些真正常用的动作挤到看不见的地方 ——
   * 一本书的右键菜单一屏塞了十几条，找哪条都得扫一遍。
   */
  submenu?: MenuItem[]
}

/** 一块「别压在这儿」的区域，屏幕坐标 */
export interface AvoidRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  /**
   * 别压住这一块。
   *
   * 稿纸上右键复制时传的是**选中那一段的位置** —— 菜单从光标处往下开，
   * 十几条项目正好盖在刚选中的字上，作者想核对一眼「我选对了没有」
   * 都看不见（作者报过这个）。有了它，菜单会自己挪到选区外面去。
   */
  avoid?: AvoidRect | null
  onClose(): void
}

/** 离窗口边、离选区留多少 */
const EDGE_PAD = 4
const AVOID_GAP = 8

/**
 * 菜单该摆在哪儿。**纯算术，拿得出来测**。
 *
 * 两件事：别跑出窗口，别压住 `avoid` 那一块（稿纸上就是选中的那一段）。
 * 这段逻辑一坏就是「菜单缺了半截」或者「菜单盖着我刚选的字」，
 * 而两种都得靠人眼盯 —— 所以它不该藏在 layout effect 里。
 */
export function placeMenu(input: {
  x: number
  y: number
  menu: { width: number; height: number }
  view: { width: number; height: number }
  avoid?: AvoidRect | null
}): { x: number; y: number } {
  const { x, y, menu, view, avoid } = input

  const fit = (nx: number, ny: number) => ({
    x: Math.min(Math.max(EDGE_PAD, nx), Math.max(EDGE_PAD, view.width - menu.width - EDGE_PAD)),
    y: Math.min(Math.max(EDGE_PAD, ny), Math.max(EDGE_PAD, view.height - menu.height - EDGE_PAD)),
  })

  let want = fit(
    x + menu.width > view.width ? x - menu.width : x,
    y + menu.height > view.height ? y - menu.height : y,
  )
  if (!avoid) return want

  const overlaps = (p: { x: number; y: number }) =>
    p.x < avoid.right &&
    p.x + menu.width > avoid.left &&
    p.y < avoid.bottom &&
    p.y + menu.height > avoid.top

  if (!overlaps(want)) return want

  /*
   * 四个方向各试一次，挑第一个既放得下、又不压住选区的。
   *
   * 顺序是有讲究的：**先往右、再往下**。往右挪最不打断视线 ——
   * 选中的那一段还在原地，菜单摆在它旁边。往上翻是最后一招，
   * 因为菜单会盖住上面几行，那多半也是刚写的东西。
   */
  const tries = [
    { x: avoid.right + AVOID_GAP, y: want.y },
    { x: avoid.left - menu.width - AVOID_GAP, y: want.y },
    { x: want.x, y: avoid.bottom + AVOID_GAP },
    { x: want.x, y: avoid.top - menu.height - AVOID_GAP },
  ]
  const ok = tries.map((t) => fit(t.x, t.y)).find((p) => !overlaps(p))
  // 一个都放不下（选区大到占满屏幕）就维持原样 ——
  // 挪到一个更糟的地方还不如不挪
  return ok ?? want
}

export function ContextMenu({ x, y, items, avoid = null, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos(
      placeMenu({
        x,
        y,
        menu: { width: r.width, height: r.height },
        view: { width: window.innerWidth, height: window.innerHeight },
        avoid,
      }),
    )
  }, [x, y, avoid])

  useEffect(() => {
    /**
     * 点菜单外面才关。
     *
     * ⚠️ 这里必须判断「点的是不是菜单里面」。
     * 初版是无条件 close，而且用的是**捕获阶段** —— 捕获是从 window 往下走的，
     * 于是点菜单项时 window 先收到 mousedown 把菜单关掉、组件卸载，
     * click 根本没机会触发。结果是右键菜单里**每一项都点不动**
     * （重命名、删除、换卷、编辑模板全都没反应）。
     * 在容器上 stopPropagation 也救不了，因为捕获阶段比它更早。
     */
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()

    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div ref={ref} className="ctx-menu" style={{ left: pos.x, top: pos.y }}>
      <Items items={items} onClose={onClose} />
    </div>
  )
}

function Items({ items, onClose }: { items: MenuItem[]; onClose(): void }) {
  /** 展开着的下级菜单是第几项。-1 = 没有 */
  const [open, setOpen] = useState(-1)
  /** 下级菜单往左翻还是往右翻 */
  const [flip, setFlip] = useState(false)
  const closeTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  return (
    <>
      {items.map((it, i) => (
        <div
          key={i}
          className="ctx-row"
          onMouseEnter={(e) => {
            window.clearTimeout(closeTimer.current)
            if (!it.submenu) {
              setOpen(-1)
              return
            }
            // 贴着窗口右边时，下级菜单往左边开，别开到屏幕外面去
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setFlip(r.right + 190 > window.innerWidth)
            setOpen(i)
          }}
          onMouseLeave={() => {
            if (!it.submenu) return
            // 稍等一下再收：鼠标从父项斜着挪到子菜单时会短暂离开两者
            closeTimer.current = window.setTimeout(() => setOpen((k) => (k === i ? -1 : k)), 220)
          }}
        >
          {it.separatorBefore && <div className="ctx-sep" />}
          <button
            className={`ctx-item${it.danger ? ' danger' : ''}${it.submenu ? ' has-sub' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              if (it.submenu) {
                // 父项本身不是动作，点它只当展开 —— 触屏和键盘上也进得去
                setOpen((k) => (k === i ? -1 : i))
                return
              }
              onClose()
              it.onClick?.()
            }}
          >
            {it.label}
            {it.submenu && <span className="ctx-arrow">›</span>}
          </button>

          {it.submenu && open === i && (
            <div className={`ctx-menu ctx-sub${flip ? ' flip' : ''}`}>
              <Items items={it.submenu} onClose={onClose} />
            </div>
          )}
        </div>
      ))}
    </>
  )
}

/** 管理右键菜单开关状态的小 hook */
export function useContextMenu() {
  const [menu, setMenu] = useState<{
    x: number
    y: number
    items: MenuItem[]
    avoid: AvoidRect | null
  } | null>(null)

  const open = (
    e: { clientX: number; clientY: number; preventDefault(): void },
    items: MenuItem[],
    avoid?: AvoidRect | null,
  ) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, items, avoid: avoid ?? null })
  }

  const node = menu ? (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      items={menu.items}
      avoid={menu.avoid}
      onClose={() => setMenu(null)}
    />
  ) : null

  return { open, node }
}

/**
 * 现在选中的那一段在屏幕上占哪一块。没选中就返回 null。
 *
 * 用 `getSelection()` 而不是问 CodeMirror 要坐标：这一段代码因此
 * 跟编辑器没有关系，输入框、只读文本里同样管用。
 */
export function selectionRect(): AvoidRect | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const r = sel.getRangeAt(0).getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  // 四周留一点余量，菜单紧贴着选区边线看着还是像压着它
  const pad = 4
  return { left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad }
}
