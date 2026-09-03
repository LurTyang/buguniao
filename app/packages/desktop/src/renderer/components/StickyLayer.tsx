/**
 * 悬浮便利贴 —— 本项目最有特色的部分。
 *
 * 规范：更新文档/04-界面与交互设计.md §3
 *
 * 从设定集里把一张卡拖到稿纸上，它就浮在那儿，像贴了张便利贴。
 * 位置、大小、折叠状态都记在 `.bugu/workspace/{设备}.json` 里，
 * 每台设备各存各的（分辨率和习惯都不一样）。
 *
 * 一条不肯让步的规则：**便利贴永不挡住正在写的地方**。
 * 光标跑到某张便利贴下面时，那张自动变淡，让作者看得见自己的字。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LoadedSticky, PinnedSticky } from '@bugu/core'

/** 新拖出来的便利贴的默认大小 */
export const DEFAULT_STICKY_W = 260
export const DEFAULT_STICKY_H = 300
const MIN_W = 160
const MIN_H = 90

export interface StickyLayerProps {
  pinned: PinnedSticky[]
  cards: Map<string, LoadedSticky>
  /** 当前文档 id，用于判断 `doc:` 范围的便利贴该不该显示 */
  currentDocId: string | null
  /** 光标在稿纸上的屏幕坐标，用于让便利贴避让 */
  caret: { x: number; y: number } | null
  onChange(next: PinnedSticky[]): void
  onOpen(cardPath: string): void
}

export function StickyLayer({
  pinned,
  cards,
  currentDocId,
  caret,
  onChange,
  onOpen,
}: StickyLayerProps) {
  const visible = pinned.filter((p) => {
    if (!cards.has(p.cardId)) return false
    if (p.scope === 'book') return true
    return currentDocId !== null && p.scope === `doc:${currentDocId}`
  })

  const update = (cardId: string, patch: Partial<PinnedSticky>) =>
    onChange(pinned.map((p) => (p.cardId === cardId ? { ...p, ...patch } : p)))

  const remove = (cardId: string) => onChange(pinned.filter((p) => p.cardId !== cardId))

  return (
    <>
      {visible.map((p) => (
        <StickyNote
          key={p.cardId}
          pin={p}
          card={cards.get(p.cardId) as LoadedSticky}
          caret={caret}
          onUpdate={(patch) => update(p.cardId, patch)}
          onRemove={() => remove(p.cardId)}
          onOpen={() => onOpen((cards.get(p.cardId) as LoadedSticky).path)}
        />
      ))}
    </>
  )
}

function StickyNote({
  pin,
  card,
  caret,
  onUpdate,
  onRemove,
  onOpen,
}: {
  pin: PinnedSticky
  card: LoadedSticky
  caret: { x: number; y: number } | null
  onUpdate(patch: Partial<PinnedSticky>): void
  onRemove(): void
  onOpen(): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // 拖动/缩放过程中只更新本地状态，松手才写配置 —— 否则每动一像素写一次文件
  const [live, setLive] = useState<Partial<PinnedSticky> | null>(null)
  const box = { ...pin, ...live }

  /**
   * 拖动 / 缩放。
   *
   * ⚠️ **用指针捕获，不要用 mousedown + window 上挂临时监听。**
   *
   * 作者报的「标签拖入后无法拖动，需要缩放一次再打开才可拖动」就是这么来的：
   * 便利贴是刚从目录树 HTML5 拖放过来的，那一趟拖放结束之后浏览器不一定
   * 立刻退出拖动状态 —— 而拖动状态下 window 上的 mousemove **根本不投递**，
   * 于是按下去能按住、就是不动。折叠展开一次（或者重开软件）之后，
   * 中间隔了别的交互，状态清了，又好了。
   *
   * setPointerCapture 把后续事件锁在这个元素上，不看文档处于什么状态；
   * 侧边栏那个宽度手柄早就因为同样的道理改成这样了，这儿是补上。
   */
  const startDrag = useCallback(
    (e: React.PointerEvent, mode: 'move' | 'resize') => {
      e.preventDefault()
      e.stopPropagation()
      const handle = e.currentTarget as HTMLElement
      try {
        handle.setPointerCapture(e.pointerId)
      } catch {
        /* 捕获不到就退化成普通事件，拖出元素可能松脱，但至少能拖 */
      }
      const originX = e.clientX
      const originY = e.clientY
      const start = { x: pin.x, y: pin.y, w: pin.w, h: pin.h }

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - originX
        const dy = ev.clientY - originY
        if (mode === 'move') {
          setLive({
            x: Math.max(0, Math.min(window.innerWidth - 60, start.x + dx)),
            y: Math.max(0, Math.min(window.innerHeight - 40, start.y + dy)),
          })
        } else {
          setLive({
            w: Math.max(MIN_W, start.w + dx),
            h: Math.max(MIN_H, start.h + dy),
          })
        }
      }

      const onUp = () => {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        handle.removeEventListener('pointercancel', onUp)
        setLive((cur) => {
          if (cur) onUpdate(cur)
          return null
        })
      }

      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('pointercancel', onUp)
    },
    [pin, onUpdate],
  )

  /**
   * 光标落在这张便利贴底下时变淡。
   *
   * 作者正在写的那一行被一张卡片挡住是最糟的体验 ——
   * 宁可让卡片看不清，也不能让作者看不见自己的字。
   */
  const [dimmed, setDimmed] = useState(false)
  useEffect(() => {
    if (!caret || !ref.current) {
      setDimmed(false)
      return
    }
    const r = ref.current.getBoundingClientRect()
    const inside =
      caret.x >= r.left - 8 && caret.x <= r.right + 8 && caret.y >= r.top - 8 && caret.y <= r.bottom + 8
    setDimmed(inside)
  }, [caret])

  return (
    <div
      ref={ref}
      className={`sticky${box.collapsed ? ' collapsed' : ''}${dimmed ? ' dimmed' : ''}`}
      style={{
        left: box.x,
        top: box.y,
        // 折起来时不占那么宽 —— 它这时候只是个名牌，
        // 不该还霸着一张卡片的地方（贴五六张就把稿纸糊住了）
        width: box.collapsed ? undefined : box.w,
        height: box.collapsed ? undefined : box.h,
      }}
    >
      <div className="sticky-head" onPointerDown={(e) => startDrag(e, 'move')}>
        <button
          className="sticky-title"
          onClick={() => onUpdate({ collapsed: !pin.collapsed })}
          onPointerDown={(e) => e.stopPropagation()}
          title={box.collapsed ? `展开「${card.title}」` : '折起来'}
        >
          {card.title}
        </button>
        <div className="sticky-tools" onPointerDown={(e) => e.stopPropagation()}>
          {/*
            这儿原来有个「全书 / 本章」按钮，删了。
            作者原话：「全文这个按钮意义不明，点击之后就会关掉标签页」——
            它切的是这张卡在哪些文档里显示，而切成「本章」之后
            换一篇文档它就消失了，看着就像自己被关掉了。
            一个按钮如果多数时候的效果是「东西不见了」，那它就是个陷阱。
            便利贴默认全书显示，够用。
          */}
          <button title="打开完整设定" onClick={onOpen}>
            编辑
          </button>
          <button title="收回（不删除文档）" onClick={onRemove}>
            ✕
          </button>
        </div>
      </div>

      {!box.collapsed && (
        <>
          <div className="sticky-body">
            {card.face ? (
              card.face.split('\n').map((line, i) => <div key={i}>{line}</div>)
            ) : (
              <div className="sticky-empty">
                这张卡还没有浮出内容。
                <br />
                在设定文档里用 <code>@</code> 标出想显示在正面的部分。
              </div>
            )}
          </div>
          <div
            className="sticky-resize"
            onPointerDown={(e) => startDrag(e, 'resize')}
            title="拖动调整大小"
          />
        </>
      )}
    </div>
  )
}

/** 新拖出来的便利贴放哪儿：在落点处，但保证整张卡不出屏 */
export function placeNewSticky(
  cardId: string,
  clientX: number,
  clientY: number,
): PinnedSticky {
  return {
    cardId,
    x: Math.max(8, Math.min(window.innerWidth - DEFAULT_STICKY_W - 8, clientX - 40)),
    y: Math.max(48, Math.min(window.innerHeight - DEFAULT_STICKY_H - 8, clientY - 16)),
    w: DEFAULT_STICKY_W,
    h: DEFAULT_STICKY_H,
    collapsed: false,
    scope: 'book',
  }
}
