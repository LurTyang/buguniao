/**
 * 启动时的那一个弹窗。
 *
 * 规范：更新文档/05-功能模块详述.md §8.7、04-界面与交互设计.md §7
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么是一个弹窗，不是两个】
 *
 * 0.3 刚做完「接着上次写」的时候是两个：先弹连胜，关掉，再弹一个问要不要
 * 回去。作者的反应是「应该将二者合为一个」—— 他说得对。
 *
 * 这两件事在他脑子里本来就是同一件：**打开软件的那一秒，他要知道
 * 「我现在什么状态、我该回哪儿去」**。拆成两步之后，第一个弹窗变成了
 * 一道必须先点掉的门，而门后面才是他真正要做的选择。
 *
 * 所以现在一屏说完：连胜多少、今天写了多少、上次停在哪儿，
 * 底下两个按钮 —— 进书架，或者回到上次那一行。
 *
 * 【两条不改的规矩】
 *
 *   1. **一次启动只弹一次。** 不是每次回书架、不是每次换书。
 *      弹第二次它就从鼓励变成打扰了。
 *   2. **断了平静地说。** 多邻国断了会弹一堆挽留，那是在卖付费补签。
 *      这儿只说「上次连了 N 天」，然后把今天的目标摆出来。
 *      作者本来就是因为咕了才心虚，界面不该再补一刀。
 * ─────────────────────────────────────────────────────────────
 */

import { useEffect, useState } from 'react'
import type { BookSummary } from '@bugu/core'
import { api } from '../api.js'
import { badgeFor } from './UserRail.js'
import type { UserSettings } from '../../shared/api.js'

type Report = Awaited<ReturnType<typeof api.planReport>>

/** 一次启动只弹一次。模块级变量就够 —— 重启进程它自然会重置 */
let greeted = false

export function markGreeted(): void {
  greeted = true
}

export function alreadyGreeted(): boolean {
  return greeted
}

/** 上次停在哪儿：哪本书（对象，点了要直接交给 Work）+ 哪一篇哪一行 */
export interface ResumeTarget {
  book: BookSummary
  place: NonNullable<UserSettings['lastPlace']>
}

/**
 * 从文件路径倒推出一个能看的标题。
 *
 * 文件名长这样：`0010-第三章 雨夜.md`。序号是排序用的，标题里不该出现。
 * 读不出来就用整个文件名 —— **不编**，宁可难看也别显示一个不存在的章节名。
 */
export function titleFromPath(docPath: string): string {
  const file = (docPath.split('/').pop() ?? docPath).split(String.fromCharCode(92)).pop() ?? docPath
  return file.replace(/\.md$/i, '').replace(/^\d+[-_\s]+/, '')
}

export function StreakGreeting({
  resume,
  onShelf,
  onResume,
}: {
  /** 上次停在哪儿。null = 上次是在书架上关的，或者那本书没了 */
  resume: ResumeTarget | null
  /** 进书架（也就是关掉这个弹窗） */
  onShelf(): void
  /** 回到上次那一篇那一行 */
  onResume(target: ResumeTarget): void
}) {
  const [r, setR] = useState<Report | null>(null)

  useEffect(() => {
    void api
      .planReport()
      .then(setR)
      // 读不出计划就别拦着他 —— 这个弹窗是锦上添花，不是必经之路
      .catch(() => onShelf())
  }, [onShelf])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 回车走「多数时候他想做的那件事」：有地方可回就回去，没有就进书架
      if (e.key === 'Enter') resume ? onResume(resume) : onShelf()
      else if (e.key === 'Escape') onShelf()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [resume, onShelf, onResume])

  if (!r) return null

  const s = r.streak
  const t = r.todayTarget
  const badge = badgeFor(s.current)
  const broken = s.current === 0 && s.best > 0

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onShelf()}>
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
            r.todayWords > 0 ? (
              <>
                今天写了 <b>{r.todayWords.toLocaleString()}</b> 字。没设目标，随便写。
              </>
            ) : (
              <span className="faint">没设目标，今天随便写。</span>
            )
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

        {/*
          上次停在哪儿。**篇名和行号都要说** ——
          只说书名的话，回去还得自己找光标在哪儿，
          而「上次写到哪一行」正是他想回去的那个点。
        */}
        {resume && (
          <div className="greet-last">
            <span className="faint">上次写到</span>
            <div className="greet-last-where">
              <b>{resume.book.meta.title}</b>
              <span className="greet-sep">·</span>
              <b>{titleFromPath(resume.place.docPath)}</b>
              {resume.place.line > 0 && (
                <span className="faint">　第 {resume.place.line + 1} 行</span>
              )}
            </div>
          </div>
        )}

        <div className="greet-actions">
          {resume ? (
            <>
              <button className="btn" onClick={onShelf}>
                进入书架
              </button>
              {/* 回车就是这个。多数时候他就是想接着写 */}
              <button className="btn btn-primary" autoFocus onClick={() => onResume(resume)}>
                回到上次
              </button>
            </>
          ) : (
            <button className="btn btn-primary" autoFocus onClick={onShelf}>
              开始写
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
