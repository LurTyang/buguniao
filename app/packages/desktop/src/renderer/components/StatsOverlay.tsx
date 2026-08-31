/**
 * 完整统计面板。
 *
 * 规范：更新文档/05-功能模块详述.md §8
 *
 * 为什么单开一个宽面板而不是塞进侧边栏：年度热力图要 53 列，
 * 侧边栏只有 250px，每格连 4px 都不到，那不叫图，叫噪点。
 */

import { useEffect, useState } from 'react'
import { formatCount, formatCountShort } from '@bugu/core'
import { api } from '../api.js'
import { BarChart, WordsLineChart, YearHeatmap } from './charts.js'
import type { DayStat, HeatCell, StreakInfo, TodayStat, WritingSession } from '@bugu/core'

interface Report {
  today: TodayStat
  streak: StreakInfo
  daily: DayStat[]
  weekly: Array<{ weekStart: string; words: number }>
  monthly: Array<{ month: string; words: number }>
  heat: HeatCell[]
  sessions: WritingSession[]
  dailyTarget: number
}

type Range = 30 | 90 | 365

export function StatsOverlay({ bookPath, onClose }: { bookPath: string; onClose(): void }) {
  const [report, setReport] = useState<Report | null>(null)
  const [range, setRange] = useState<Range>(30)
  const [error, setError] = useState<string | null>(null)
  const [width, setWidth] = useState(() => Math.min(980, window.innerWidth - 80))

  useEffect(() => {
    const onResize = () => setWidth(Math.min(980, window.innerWidth - 80))
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  useEffect(() => {
    void api
      .statsReport(bookPath)
      .then(setReport)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [bookPath])

  const chartW = width - 56

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="stats-overlay" style={{ width }}>
        <div className="stats-overlay-head">
          <span>写作统计</span>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose}>
            关闭
          </button>
        </div>

        {error && <div className="banner danger">{error}</div>}

        {!report ? (
          <div className="empty-hint">正在算……</div>
        ) : (
          <div className="stats-overlay-body">
            <div className="stats-hero">
              <Hero
                label="今日"
                value={formatCount(report.today.words)}
                sub={
                  report.today.signedIn
                    ? '已签到'
                    : `还差 ${formatCount(5000 - report.today.words)} 字签到`
                }
              />
              <Hero
                label="连续"
                value={`${report.streak.current}`}
                unit="天"
                sub={
                  report.streak.currentMakeups > 0
                    ? `其中 ${report.streak.currentMakeups} 天是补签的`
                    : `最长 ${report.streak.longest} 天`
                }
              />
              <Hero
                label="近 30 天"
                value={formatCountShort(sum(report.daily.slice(-30)))}
                sub={`日均 ${formatCount(Math.round(sum(report.daily.slice(-30)) / 30))}`}
              />
              <Hero
                label="本月"
                value={formatCountShort(report.monthly[report.monthly.length - 1]?.words ?? 0)}
                sub={report.monthly[report.monthly.length - 1]?.month ?? ''}
              />
            </div>

            <section>
              <div className="stats-title">
                每日字数
                <div className="segmented" style={{ marginLeft: 'auto' }}>
                  {([30, 90, 365] as Range[]).map((r) => (
                    <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
                      {r === 365 ? '一年' : `${r} 天`}
                    </button>
                  ))}
                </div>
              </div>
              <WordsLineChart
                data={report.daily.slice(-range)}
                width={chartW}
                height={190}
                target={report.dailyTarget}
              />
              {report.dailyTarget > 0 && (
                <div className="faint stats-note">虚线是日目标（{formatCount(report.dailyTarget)} 字）</div>
              )}
            </section>

            <section>
              <div className="stats-title">年度热力图</div>
              <YearHeatmap cells={report.heat} />
            </section>

            <section className="stats-two">
              <div>
                <div className="stats-title">按周</div>
                <BarChart
                  data={report.weekly.slice(-16).map((w) => ({ label: w.weekStart.slice(5), words: w.words }))}
                  width={Math.floor(chartW / 2) - 10}
                  height={150}
                />
              </div>
              <div>
                <div className="stats-title">按月</div>
                <BarChart
                  data={report.monthly.slice(-12).map((m) => ({ label: m.month.slice(2), words: m.words }))}
                  width={Math.floor(chartW / 2) - 10}
                  height={150}
                />
              </div>
            </section>

            <section>
              <div className="stats-title">最近的写作场次</div>
              {report.sessions.length === 0 ? (
                <div className="chart-empty">还没有记录</div>
              ) : (
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th>开始</th>
                      <th>时长</th>
                      <th>字数</th>
                      <th>字/小时</th>
                      <th>篇数</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {report.sessions.slice(0, 12).map((s) => (
                      <tr key={s.id}>
                        <td>{fmtTime(s.startTs)}</td>
                        <td>{fmtDuration(s.durationMs)}</td>
                        <td className={s.words >= 0 ? 'up' : 'down'}>
                          {s.words >= 0 ? '+' : ''}
                          {formatCount(s.words)}
                        </td>
                        <td>{s.wordsPerHour > 0 ? formatCount(s.wordsPerHour) : '—'}</td>
                        <td>{s.docs.length}</td>
                        <td className="faint">
                          {s.crossedMidnight && '通宵'}
                          {s.pomo && ' 番茄钟'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <div className="faint stats-note">
              「一天」按写作会话算：凌晨 4 点后的首次落笔才算新的一天，
              所以通宵写到第二天中午，整场都记在开写那天。
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Hero({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub: string }) {
  return (
    <div className="stats-hero-item">
      <div className="faint">{label}</div>
      <div className="stats-hero-value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      <div className="faint stats-hero-sub">{sub}</div>
    </div>
  )
}

const sum = (days: DayStat[]) => days.reduce((n, d) => n + Math.max(0, d.words), 0)

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min} 分`
  return `${Math.floor(min / 60)} 小时 ${min % 60} 分`
}
