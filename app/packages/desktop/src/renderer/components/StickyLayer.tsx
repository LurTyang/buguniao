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

  const startDrag = useCallback(
    (e: React.MouseEvent, mode: 'move' | 'resize') => {
      e.preventDefault()
      e.stopPropagation()
      const originX = e.clientX
      const originY = e.clientY
      const start = { x: pin.x, y: pin.y, w: pin.w, h: pin.h }

      const onMove = (ev: MouseEvent) => {
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
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        setLive((cur) => {
          if (cur) onUpdate(cur)
          return null
        })
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
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

  const scopeIsBook = pin.scope === 'book'

  return (
    <div
      ref={ref}
      className={`sticky${box.collapsed ? ' collapsed' : ''}${dimmed ? ' dimmed' : ''}`}
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.collapsed ? undefined : box.h,
      }}
    >
      <div className="sticky-head" onMouseDown={(e) => startDrag(e, 'move')}>
        <button
          className="sticky-title"
          onClick={() => onUpdate({ collapsed: !pin.collapsed })}
          onMouseDown={(e) => e.stopPropagation()}
          title={box.collapsed ? '展开' : '折叠'}
        >
          {card.title}
        </button>
        <div className="sticky-tools" onMouseDown={(e) => e.stopPropagation()}>
          <button
            className={scopeIsBook ? 'on' : ''}
            title={scopeIsBook ? '全书都显示（点一下改为仅本章）' : '仅本章显示（点一下改为全书）'}
            onClick={() =>
              onUpdate({ scope: scopeIsBook ? `doc:${card.docId}` : 'book' })
            }
          >
            {scopeIsBook ? '全书' : '本章'}
          </button>
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
            onMouseDown={(e) => startDrag(e, 'resize')}
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
