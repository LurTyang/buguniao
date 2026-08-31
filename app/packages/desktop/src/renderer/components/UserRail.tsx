/**
 * 书架左侧的用户栏。
 *
 * 规范：更新文档/04-界面与交互设计.md §1.1
 *
 * ─────────────────────────────────────────────────────────────
 * 【关于「鼓励」这件事，几条自己给自己定的规矩】
 *
 * 作者提到多邻国的连胜机制。那套东西有效，但也很容易做成
 * **让人焦虑而不是让人写**。所以：
 *
 *   - 连胜要显眼，**断了要平静**。多邻国断了会弹一堆挽留，
 *     那是在卖付费补签。这儿断了就是断了，安静地重新计数。
 *   - 不发明第二套「护级卡」。补签额度已经有了，就用它。
 *   - 里程碑按 7 / 30 / 100 天给，**不天天弹恭喜** —— 天天弹会麻木。
 * ─────────────────────────────────────────────────────────────
 *
 * 这一栏要窄。作者原话：「应该不需要占据太多空间。」
 */

import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { PromptModal } from './Modal.js'

type Report = Awaited<ReturnType<typeof api.planReport>>

/** 连胜到这些天数时给个小标记。天天恭喜会麻木，所以只在这几档 */
const BADGES = [7, 30, 100, 365]

export function badgeFor(streak: number): number | null {
  let hit: number | null = null
  for (const b of BADGES) if (streak >= b) hit = b
  return hit
}

export function UserRail({ onOpenSettings }: { onOpenSettings(): void }) {
  const [r, setR] = useState<Report | null>(null)
  const [renaming, setRenaming] = useState(false)

  const load = useCallback(() => {
    void api
      .planReport()
      .then(setR)
      .catch(() => setR(null))
  }, [])

  useEffect(load, [load])

  if (!r) return <div className="user-rail" />

  const t = r.todayTarget
  const pct = t.floor <= 0 ? 0 : Math.min(100, Math.round((r.todayWords / t.floor) * 100))
  const badge = badgeFor(r.streak.current)

  return (
    <div className="user-rail">
      <button className="user-name" onClick={() => setRenaming(true)} title="点一下改名字">
        {r.nickname || '还没起名字'}
      </button>

      <div className="user-since">
        {r.daysSinceStart > 0 ? (
          <>
            一起写了 <b>{r.daysSinceStart}</b> 天，其中 {r.daysWritten} 天动了笔
          </>
        ) : (
          '还没写过字。从第一个字开始算。'
        )}
      </div>

      <div className="user-block">
        <div className="user-k">今天</div>
        <div className="user-v">
          {r.todayWords.toLocaleString()}
          {t.floor > 0 && <span className="faint"> / {t.floor.toLocaleString()}</span>}
        </div>
        {t.floor > 0 && (
          <div className="plan-bar">
            <span className="plan-bar-fill floor" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      <div className="user-block">
        <div className="user-k">连胜</div>
        <div className="user-streak">
          <b>{r.streak.current}</b>
          <span className="faint">天</span>
          {badge !== null && (
            <span className="user-badge" title={`连续 ${badge} 天`}>
              {badge}
            </span>
          )}
        </div>
        {/*
          断了不挑脸，只留一行小字当参照 —— 那是「上次到过哪儿」，
          不是「你搞砸了」。
        */}
        {r.streak.current === 0 && r.streak.best > 0 && (
          <div className="faint">上次连了 {r.streak.best} 天</div>
        )}
        {r.streak.current > 0 && r.streak.best > r.streak.current && (
          <div className="faint">最长 {r.streak.best} 天</div>
        )}
      </div>

      <div className="user-block">
        <div className="user-k">本周</div>
        <div className="user-v">
          {r.week.of > 0 ? (
            <>
              {r.week.hit} <span className="faint">/ {r.week.of} 天达标</span>
            </>
          ) : (
            <span className="faint">没设目标</span>
          )}
        </div>
      </div>

      <button className="user-settings" onClick={onOpenSettings}>
        设置
      </button>

      {renaming && (
        <PromptModal
          title="怎么称呼你"
          hint="只存在你自己的库里，跟着同步走。这软件没有账号。"
          placeholder="笔名、昵称都行"
          initial={r.nickname}
          confirmText="就这个"
          onCancel={() => setRenaming(false)}
          onConfirm={(v) => {
            setRenaming(false)
            void api.setNickname(v).then(load)
          }}
        />
      )}
    </div>
  )
}
