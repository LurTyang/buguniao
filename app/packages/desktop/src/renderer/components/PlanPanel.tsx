/**
 * 码字计划：目标线、工作日/休息日、请假、里程碑。
 *
 * 规范：更新文档/05-功能模块详述.md §8.5 §8.6
 *
 * ─────────────────────────────────────────────────────────────
 * 【界面上必须说清楚的三件事】
 *
 * 1. 改目标是**从今天起生效**，以前的日子不会跟着变。
 *    不写这一句，作者调完目标看见热力图没变会以为坏了。
 * 2. 请假**不算达标**，只是不断链。热力图上是中性色，不是绿。
 * 3. 「按最近速度会晚几天」只在**会晚**的时候说。早到不邀功 ——
 *    提醒的价值在于坏消息。
 * ─────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useState } from 'react'
import {
  TARGET_PRESETS,
  presetToTarget,
  spreadWeek,
  describeMilestone,
  type MilestoneView,
  type WeekTarget,
} from '@bugu/core'
import { api } from '../api.js'
import { PromptModal } from './Modal.js'

type Report = Awaited<ReturnType<typeof api.planReport>>

const VERDICT_LABEL: Record<string, string> = {
  ideal: '很棒',
  signed: '达标',
  makeup: '补签',
  leave: '请假',
  short: '差一点',
  missed: '没写',
  untracked: '未设目标',
}

/**
 * 码字计划总览：今天写了多少、目标是多少、最近十四天。
 *
 * **不认书** —— 目标是「人」的属性，「每天写 8000 字」不分在写哪本。
 * 所以它整块住在书架的总设置里，不在写作页的侧边栏上。
 *
 * 里程碑是另一回事（那是按书的），见 MilestonePanel。
 */
export function PlanOverview({ refreshKey = 0 }: { refreshKey?: number }) {
  const [r, setR] = useState<Report | null>(null)
  const [tab, setTab] = useState<'today' | 'target'>('today')
  const [error, setError] = useState<string | null>(null)

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

  const load = useCallback(async () => {
    try {
      setR(await api.planReport())
      setError(null)
    } catch (e) {
      setError(msg(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  if (error) return <div className="search-error">{error}</div>
  if (!r) return <div className="empty-hint">正在算……</div>

  const t = r.todayTarget
  const left = Math.max(0, t.floor - r.todayWords)
  const pct = t.floor <= 0 ? 0 : Math.min(100, Math.round((r.todayWords / t.floor) * 100))
  const idealPct = t.ideal <= 0 ? 0 : Math.min(100, Math.round((r.todayWords / t.ideal) * 100))
  const todayVerdict = r.judged[r.judged.length - 1]?.verdict ?? 'missed'
  const onLeave = todayVerdict === 'leave'

  return (
    <div className="plan-panel">
      <div className="ai-tabs-mini" style={{ padding: '6px 12px 0' }}>
        <button className={`tab${tab === 'today' ? ' active' : ''}`} onClick={() => setTab('today')}>
          今天
        </button>
        <button className={`tab${tab === 'target' ? ' active' : ''}`} onClick={() => setTab('target')}>
          目标
        </button>
      </div>

      {tab === 'today' && (
        <div className="plan-today">
          <div className="plan-big">{r.todayWords.toLocaleString()}</div>
          <div className="fs-hint">
            {t.floor <= 0 ? (
              '随缘档：只记录，不判达标。'
            ) : onLeave ? (
              <>今天请假中 —— 不算断更，也不算达标。</>
            ) : left > 0 ? (
              <>
                离底线还差 <b>{left.toLocaleString()}</b> 字
                {t.ideal > t.floor && <>　理想线 {t.ideal.toLocaleString()}</>}
              </>
            ) : (
              <>
                今天已达标（底线 {t.floor.toLocaleString()}）
                {t.ideal > t.floor && r.todayWords < t.ideal && (
                  <>　离「很棒」还差 {(t.ideal - r.todayWords).toLocaleString()} 字</>
                )}
              </>
            )}
          </div>

          {t.floor > 0 && (
            <div className="plan-bars">
              <div className="plan-bar">
                <span className="plan-bar-fill floor" style={{ width: `${pct}%` }} />
              </div>
              {t.ideal > t.floor && (
                <div className="plan-bar">
                  <span className="plan-bar-fill ideal" style={{ width: `${idealPct}%` }} />
                </div>
              )}
            </div>
          )}

          <div className="plan-streak">
            <div>
              <b>{r.streak.current}</b>
              <span className="faint">连续天数</span>
            </div>
            <div>
              <b>{r.streak.best}</b>
              <span className="faint">最长</span>
            </div>
            <div>
              <b>{r.recentSpeed.toLocaleString()}</b>
              <span className="faint">近 14 天日均</span>
            </div>
          </div>
          {(r.streak.leaves > 0 || r.streak.makeups > 0) && (
            <div className="settings-hint">
              {/* 这一句是刻意的：连续天数里有多少是「撑」出来的，得让作者知道 */}
              这段连续里有 {r.streak.makeups} 天是补签的
              {r.streak.leaves > 0 && `、${r.streak.leaves} 天是请假`}。
            </div>
          )}

          <div className="plan-actions">
            <button
              className="btn"
              onClick={() => {
                void api
                  .setLeave(r.today, onLeave ? null : '')
                  .then(load)
                  .catch((e) => setError(msg(e)))
              }}
            >
              {onLeave ? '取消今天的请假' : '今天请假'}
            </button>
            <span className="faint">请假不算断更，但也不算达标。</span>
          </div>

          <div className="plan-recent">
            <div className="script-group-name">最近十四天</div>
            {r.judged.slice(-14).reverse().map((j) => (
              <div key={j.day} className={`plan-day v-${j.verdict}`}>
                <span className="plan-day-date">{j.day.slice(5)}</span>
                <span className="plan-day-words">{j.words.toLocaleString()}</span>
                <span className="plan-day-target faint">/ {j.target.floor.toLocaleString()}</span>
                <span className="plan-day-verdict">{VERDICT_LABEL[j.verdict]}</span>
                {j.leaveReason && <span className="faint">{j.leaveReason}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'target' && <TargetEditor plan={r.plan} onSaved={load} onError={setError} />}
    </div>
  )
}

// ───────────────────────── 目标 ─────────────────────────

/**
 * 改目标。
 *
 * 界面上按「工作日 / 休息日」填四个数，底下存成七天数组 ——
 * 绝大多数人是这个模式，但格式留着七天的自由度。
 */
export function TargetEditor({
  plan,
  onSaved,
  onError,
}: {
  plan: Report['plan']
  onSaved(): void
  onError(m: string): void
}) {
  const latest = plan.targets[plan.targets.length - 1]?.target
  const cur: WeekTarget = latest ?? spreadWeek(1000, 2000, 2000, 4000)

  const [wf, setWf] = useState(cur.floor[0])
  const [wi, setWi] = useState(cur.ideal[0])
  const [rf, setRf] = useState(cur.floor[5])
  const [ri, setRi] = useState(cur.ideal[5])
  const [busy, setBusy] = useState(false)

  const save = (t: WeekTarget) => {
    setBusy(true)
    void api
      .setPlanTarget(t)
      .then(onSaved)
      .catch((e) => onError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="plan-target">
      <div className="ai-field">
        <label>档位</label>
        <div className="plan-presets">
          {TARGET_PRESETS.map((p) => (
            <button
              key={p.key}
              className="foreign-card"
              disabled={busy}
              onClick={() => {
                setWf(p.weekdayFloor)
                setWi(p.weekdayIdeal)
                setRf(p.restFloor)
                setRi(p.restIdeal)
                save(presetToTarget(p))
              }}
            >
              <b>{p.label}</b>
              <span className="faint">{p.note}</span>
            </button>
          ))}
        </div>
        <div className="settings-hint">档位只是帮你少打几个字，下面每个数都能改。</div>
      </div>

      <div className="ai-field">
        <label>工作日（周一至周五）</label>
        <div className="ai-price-row">
          <input type="number" className="search-input" min={0} value={wf} onChange={(e) => setWf(Number(e.target.value) || 0)} />
          <span className="faint">底线</span>
        </div>
        <div className="ai-price-row">
          <input type="number" className="search-input" min={0} value={wi} onChange={(e) => setWi(Number(e.target.value) || 0)} />
          <span className="faint">理想</span>
        </div>
      </div>

      <div className="ai-field">
        <label>休息日（周六日）</label>
        <div className="ai-price-row">
          <input type="number" className="search-input" min={0} value={rf} onChange={(e) => setRf(Number(e.target.value) || 0)} />
          <span className="faint">底线</span>
        </div>
        <div className="ai-price-row">
          <input type="number" className="search-input" min={0} value={ri} onChange={(e) => setRi(Number(e.target.value) || 0)} />
          <span className="faint">理想</span>
        </div>
      </div>

      <div className="ai-field">
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy} onClick={() => save(spreadWeek(wf, wi, rf, ri))}>
          {busy ? '正在存……' : '保存目标'}
        </button>
        <div className="settings-hint">
          {/*
            不写这一句，作者调完目标看见热力图没变会以为坏了。
            而「以前的日子按当时的目标算」正是这个模块存在的理由。
          */}
          <b>从今天起生效。</b>以前的日子仍按当时的目标判 ——
          不然调一次目标，整张热力图和连续天数当场全变，那是在骗自己。
          <br />
          底线填 0 就是随缘档：只记录，不判达标也不算断更。
        </div>
      </div>

      {plan.targets.length > 0 && (
        <details className="ai-notes">
          <summary>改过 {plan.targets.length} 次</summary>
          <pre>
            {plan.targets
              .map((c) => `${c.from} 起　工作日 ${c.target.floor[0]}/${c.target.ideal[0]}　休息日 ${c.target.floor[5]}/${c.target.ideal[5]}`)
              .join('\n')}
          </pre>
        </details>
      )}
    </div>
  )
}

// ───────────────────────── 加里程碑 ─────────────────────────

function AddMilestone({
  bookPath,
  onClose,
  onDone,
  onError,
}: {
  bookPath: string
  onClose(): void
  onDone(): void
  onError(m: string): void
}) {
  const [targets, setTargets] = useState<
    Array<{ label: string; kind: 'volume' | 'category'; path: string }>
  >([])
  const [pick, setPick] = useState<string>('__free')
  const [due, setDue] = useState('')

  useEffect(() => {
    void api.milestoneTargets(bookPath).then(setTargets).catch(() => setTargets([]))
  }, [bookPath])

  return (
    <PromptModal
      title="加一个里程碑"
      hint="比如「写完第一卷」「写完大纲-人物」。选一个对象，进度自己会算。"
      placeholder="里程碑叫什么"
      confirmText="创建"
      onCancel={onClose}
      onConfirm={(title) => {
        const t = targets.find((x) => x.path === pick)
        void api
          .addMilestone(bookPath, {
            title,
            target: t ? { kind: t.kind, path: t.path } : { kind: 'free' },
            due: due || null,
          })
          .then(onDone)
          .catch((e) => onError(e instanceof Error ? e.message : String(e)))
      }}
      extra={
        <>
          <div className="ai-field">
            <label>盯住什么</label>
            <select className="settings-select" style={{ width: '100%' }} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="__free">自由事项（完没完我自己勾）</option>
              {targets.map((t) => (
                <option key={t.path} value={t.path}>
                  {t.kind === 'volume' ? '卷' : '设定'}　{t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="ai-field">
            <label>截止日（可不填）</label>
            <input
              className="search-input"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </div>
        </>
      }
    />
  )
}

// ───────────────────────── 里程碑 ─────────────────────────

/**
 * 里程碑：这一卷什么时候写完、大纲什么时候写完。
 *
 * **按书**，所以留在写作页的侧边栏上 —— 它跟正在写的这本关系极大，
 * 跟「我每天写多少字」那个全局目标不是一回事。
 */
export function MilestonePanel({ bookPath, refreshKey }: { bookPath: string; refreshKey: number }) {
  const [ms, setMs] = useState<MilestoneView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

  const load = useCallback(async () => {
    try {
      setMs(await api.listMilestones(bookPath))
      setError(null)
    } catch (e) {
      setError(msg(e))
    }
  }, [bookPath])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  if (error) return <div className="search-error">{error}</div>

  return (
    <div className="plan-panel">
        <div className="plan-ms">
          <button className="btn btn-primary" style={{ margin: '8px 12px' }} onClick={() => setAdding(true)}>
            加一个里程碑
          </button>

          {ms === null || ms.length === 0 ? (
            <div className="empty-hint">
              还没有里程碑。
              <br />
              「写完第一卷」「写完大纲-人物」这类，加上之后能看到还剩几天。
            </div>
          ) : (
            ms.map((m) => (
              <div key={m.id} className={`plan-ms-item${m.done ? ' done' : ''}${m.overdue ? ' overdue' : ''}`}>
                <div className="plan-ms-head">
                  <b>{m.title}</b>
                  {m.overdue && <span className="game-tag bad">逾期</span>}
                  {m.done && <span className="game-tag">完成</span>}
                </div>
                {m.percent !== null && (
                  <div className="plan-bar">
                    <span className="plan-bar-fill floor" style={{ width: `${m.percent}%` }} />
                  </div>
                )}
                <div className="faint">{describeMilestone(m)}</div>
                <div className="plan-ms-actions">
                  <button
                    onClick={() =>
                      void api
                        .patchMilestone(bookPath, m.id, { doneManually: !m.doneManually })
                        .then(load)
                        .catch((e) => setError(msg(e)))
                    }
                  >
                    {m.doneManually ? '取消完成' : '标为完成'}
                  </button>
                  <button
                    className="danger"
                    onClick={() =>
                      void api.removeMilestone(bookPath, m.id).then(load).catch((e) => setError(msg(e)))
                    }
                  >
                    删除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

      {adding && (
        <AddMilestone
          bookPath={bookPath}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false)
            void load()
          }}
          onError={setError}
        />
      )}
    </div>
  )
}
