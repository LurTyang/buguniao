/**
 * 启动时的连胜问候。
 *
 * 规范：更新文档/05-功能模块详述.md §8.7
 *
 * ─────────────────────────────────────────────────────────────
 * 【只在启动弹一次，而且断了也不挑脸】
 *
 * 作者要的是「每次启动都要弹目前连胜多少天，断了自然也要弹」。
 *
 * 所以规矩定死两条：
 *   1. **一次启动只弹一次。** 不是每次回书架、不是每次换书。
 *      弹第二次它就从鼓励变成打扰了。
 *   2. **断了平静地说。** 多邻国断了会弹一堆挽留，那是在卖付费补签。
 *      这儿只说「上次连了 N 天」，然后把今天的目标摆出来。
 *      作者本来就是因为咕了才心虚，界面不该再补一刀。
 * ─────────────────────────────────────────────────────────────
 */

import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { badgeFor } from './UserRail.js'

type Report = Awaited<ReturnType<typeof api.planReport>>

/** 一次启动只弹一次。模块级变量就够 —— 重启进程它自然会重置 */
let greeted = false

export function markGreeted(): void {
  greeted = true
}

export function alreadyGreeted(): boolean {
  return greeted
}

export function StreakGreeting({ onClose }: { onClose(): void }) {
  const [r, setR] = useState<Report | null>(null)

  useEffect(() => {
    void api
      .planReport()
      .then(setR)
      .catch(() => onClose())
  }, [onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' || e.key === 'Enter') && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!r) return null

  const s = r.streak
  const t = r.todayTarget
  const badge = badgeFor(s.current)
  const broken = s.current === 0 && s.best > 0

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="greet">
        {broken ? (
          <>
            <div className="greet-num small">0</div>
            <div className="greet-line">连胜断了。上次连了 {s.best} 天。</div>
            {/*
              到此为止。不挽留、不劝、不卖补签 ——
              他本来就是因为咕了才心虚，界面不该再补一刀。
            */}
          </>
        ) : (
          <>
            <div className="greet-num">{s.current}</div>
            <div className="greet-line">
              连胜 {s.current} 天
              {badge !== null && <span className="user-badge">{badge}</span>}
            </div>
            {s.best > s.current && <div className="faint">最长纪录 {s.best} 天</div>}
            {(s.makeups > 0 || s.leaves > 0) && (
              <div className="faint">
                {/* 撑出来的天数要说出来，不然这个数字就是在骗自己 */}
                其中 {s.makeups} 天是补签的{s.leaves > 0 && `、${s.leaves} 天是请假`}
              </div>
            )}
          </>
        )}

        <div className="greet-today">
          {t.floor <= 0 ? (
            <span className="faint">没设目标，今天随便写。</span>
          ) : r.todayWords >= t.floor ? (
            <>
              今天已经写了 <b>{r.todayWords.toLocaleString()}</b> 字，达标了。
            </>
          ) : (
            <>
              今天的底线是 <b>{t.floor.toLocaleString()}</b> 字
              {r.todayWords > 0 && <>，已经写了 {r.todayWords.toLocaleString()}</>}。
            </>
          )}
        </div>

        <button className="btn btn-primary" onClick={onClose}>
          开始写
        </button>
      </div>
    </div>
  )
}
