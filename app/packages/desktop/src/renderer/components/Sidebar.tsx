/**
 * 侧边栏容器 —— 靠近边缘就滑出、可钉住。
 *
 * 规范：更新文档/04-界面与交互设计.md §2.3
 *
 * ─────────────────────────────────────────────────────────────
 * 【触发方式：2026-08-25 按作者反馈改过】
 *
 * 初版是在边缘放一个 10px 宽的透明 div 当触发区，结果「以为该触发但就是
 * 触发不了」—— 10px 实在太窄，鼠标很难精准停在上面。
 *
 * 改成**监听整个写作区的鼠标位置**：横坐标进入左/右 60px 就唤出。
 * 好处不只是变宽 —— 透明 div 会挡住底下的点击（想点稿纸边缘反而点不到），
 * 而用鼠标位置判定完全不影响任何点击。
 * ─────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

/** 距边缘多少像素内算「靠近边缘」 */
export const EDGE_TRIGGER_PX = 60
/** 侧边栏宽度的上下限。太窄了字挤成一团，太宽了稿纸没地方 */
export const SIDEBAR_MIN_PX = 200
export const SIDEBAR_MAX_PX = 640
/** 默认宽度，双击手柄回到这个值 */
export const DEFAULT_SIDEBAR_PX = 250
/** 靠近边缘后多久滑出（防止路过就弹） */
export const REVEAL_DELAY_MS = 160
/** 离开后多久收起（防止手抖一下面板就没了） */
export const HIDE_DELAY_MS = 400

export interface SidebarState {
  visible: boolean
  pinned: boolean
  togglePin(): void
  /** 鼠标靠近本侧边缘时调用 */
  reveal(): void
  /** 鼠标离开时调用 */
  scheduleHide(): void
  /** 绑到侧边栏本体，鼠标在面板里时不收起 */
  panelProps: { onMouseEnter(): void; onMouseLeave(): void }
  /** 开始连续输入时调用，立刻收起未钉住的面板 */
  hideNow(): void
}

/**
 * @param initialPinned 上次关软件时钉着没有。**从设置里来**，不是写死的 false
 * @param onPinChange   钉/取消钉时叫一声，好把这个决定存下来
 *
 * 钉住是个决定，不是个手势 —— 作者钉上它是因为他要一直看着目录，
 * 那这件事就该跨重启活着。每次开软件都得重钉一遍，等于这个功能没做。
 */
export function useSidebar(
  initialPinned = false,
  onPinChange?: (pinned: boolean) => void,
): SidebarState {
  const [pinned, setPinned] = useState(initialPinned)

  // 设置是异步读回来的，读到之前这个 hook 已经拿默认值跑起来了。
  // 读回来之后要跟上 —— 少了这一步，存下来的钉住状态永远显示不出来
  useEffect(() => setPinned(initialPinned), [initialPinned])

  const changeRef = useRef(onPinChange)
  changeRef.current = onPinChange
  const [hovering, setHovering] = useState(false)
  const revealTimer = useRef<number | undefined>(undefined)
  const hideTimer = useRef<number | undefined>(undefined)

  const clearTimers = () => {
    window.clearTimeout(revealTimer.current)
    window.clearTimeout(hideTimer.current)
  }

  useEffect(() => clearTimers, [])

  const reveal = useCallback(() => {
    window.clearTimeout(hideTimer.current)
    if (revealTimer.current !== undefined) return // 已经在等着滑出了，别重复排队
    revealTimer.current = window.setTimeout(() => {
      revealTimer.current = undefined
      setHovering(true)
    }, REVEAL_DELAY_MS)
  }, [])

  const scheduleHide = useCallback(() => {
    window.clearTimeout(revealTimer.current)
    revealTimer.current = undefined
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setHovering(false), HIDE_DELAY_MS)
  }, [])

  const cancelHide = useCallback(() => {
    clearTimers()
    revealTimer.current = undefined
    setHovering(true)
  }, [])

  const hideNow = useCallback(() => {
    clearTimers()
    revealTimer.current = undefined
    setHovering(false)
  }, [])

  return {
    visible: pinned || hovering,
    pinned,
    togglePin: () =>
      setPinned((p) => {
        changeRef.current?.(!p)
        return !p
      }),
    reveal,
    scheduleHide,
    panelProps: { onMouseEnter: cancelHide, onMouseLeave: scheduleHide },
    hideNow,
  }
}

/**
 * 极简图钉。
 *
 * 作者要求「只保留图钉图案，越简约越好，像 Word 那样」，
 * 所以是单色描边小图标，没有文字、没有 emoji。
 */
export function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path
        d="M9.6 1.4 8.5 2.5l.4 3.3-2.7 2-2.4-.5-1 1 3 3-3.3 3.9.7.6 4-3.3 3 3 1-1-.5-2.4 2-2.7 3.3.4 1.1-1.1z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export interface SidebarProps {
  side: 'left' | 'right'
  state: SidebarState
  /** 顶部标签区 */
  head?: ReactNode
  /** 当前宽度（像素）。存在设置里，按面板记，跟左右无关 */
  width: number
  /** 拖完之后落盘 */
  onResize(px: number): void
  children: ReactNode
}

export function Sidebar({ side, state, head, width, onResize, children }: SidebarProps) {
  // 拖动过程中先只改本地，松手才写设置 —— 每动一像素写一次文件太吵
  const [dragging, setDragging] = useState<number | null>(null)
  const shown = dragging ?? width

  if (!state.visible) return null

  /**
   * 拖动改宽度。
   *
   * 用 setPointerCapture 而不是在 window 上加临时监听：拖到稿纸上、
   * 拖出窗口再拖回来，事件都还在这个手柄上，不会「拖着拖着松脱了」。
   */
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const handle = e.currentTarget
    // 捕获失败不该让拖动整个失效（某些环境下 pointerId 会被拒）
    try {
      handle.setPointerCapture(e.pointerId)
    } catch {
      /* 没捕获到就退化成普通事件，拖出面板可能会松脱，但还能用 */
    }
    const startX = e.clientX
    const startW = shown

    const move = (ev: PointerEvent) => {
      // 左边栏往右拖是变宽，右边栏反过来
      const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX
      setDragging(Math.min(SIDEBAR_MAX_PX, Math.max(SIDEBAR_MIN_PX, startW + delta)))
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      setDragging((d) => {
        if (d !== null) onResize(d)
        return null
      })
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  return (
    <div
      className={`sidebar sidebar-${side}${state.pinned ? '' : ' floating'}`}
      style={{ width: shown }}
      {...state.panelProps}
    >
      <div
        className={`sidebar-grip grip-${side}${dragging !== null ? ' active' : ''}`}
        onPointerDown={startDrag}
        onDoubleClick={() => onResize(DEFAULT_SIDEBAR_PX)}
        title="拖动改宽度，双击回到默认"
        role="separator"
        aria-orientation="vertical"
      />
      <div className="sidebar-head">
        {head}
        <button
          className={`pin-btn${state.pinned ? ' on' : ''}`}
          onClick={state.togglePin}
          title={state.pinned ? '取消固定' : '固定侧边栏'}
          aria-label={state.pinned ? '取消固定' : '固定侧边栏'}
        >
          <PinIcon filled={state.pinned} />
        </button>
      </div>
      <div className="sidebar-scroll">{children}</div>
    </div>
  )
}
