/**
 * 对外统计 —— 「别人能读到我什么」。
 *
 * 规范：更新文档/08-账号与对外接口.md　服务端在 `server/`
 *
 * ─────────────────────────────────────────────────────────────
 * 【这一页要回答的三个问题】
 *
 * 1. **会发出去什么？** 所以那七个数就摆在按钮上面，一直摆着 ——
 *    哪怕还没登录。「先看清楚再决定」不该需要先登录。
 * 2. **发出去之后别人看到什么？** 所以有个「看看别人读到什么」，
 *    走的是**公开接口、不带令牌**，跟别的网站同一条路。
 *    自己看自己的特权视图会骗人。
 * 3. **怎么反悔？** 所以「删掉服务器上的我」跟别的按钮一样显眼，
 *    不藏在二级菜单里。做不到彻底删除的公开功能不该上线。
 *
 * 【为什么要作者自己认领短名】
 *
 * 服务器认得的是登录服务给的那串随机 sub。不认领短名就没有公开地址，
 * 也就**没有任何人能读到他** —— 这是一道天然的闸：
 * 认领这个动作本身就是「我确实想公开」。
 * ─────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import type { PublicStats } from '@bugu/core'
import type { StatsState } from '../../shared/api.js'

/** 那七个数各自叫什么。顺序按「今天 → 本周 → 长期」排，跟人关心的顺序一样 */
const LABELS: Array<[keyof PublicStats & string, string]> = [
  ['date', '日期'],
  ['todayWords', '今天写了'],
  ['dailyFloor', '今天的底线'],
  ['weekWords', '本周合计'],
  ['streak', '当前连胜'],
  ['bestStreak', '最长连胜'],
  ['daysTogether', '一起写了'],
]

/** 把 ISO 时间说成人话。说不出来就原样吐 —— 别在这儿编 */
function when(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function StatsGrid({ s }: { s: PublicStats }) {
  return (
    <div className="account-preview">
      {LABELS.map(([k, label]) => (
        <div className="account-row" key={k}>
          <span className="faint">{label}</span>
          <b>{k === 'date' ? s.date || '—' : s[k]}</b>
        </div>
      ))}
    </div>
  )
}

/**
 * 短名的规矩 —— 跟主进程、跟服务端 `server/src/handle.ts` 是同一套。
 *
 * 界面这一份的作用只有一个：**在按下按钮之前就把话说清楚**。
 * 真正说了算的还是服务端，这儿说好不算数。
 */
function checkLocally(raw: string): { ok: true } | { ok: false; why: string } {
  const h = raw.trim().toLowerCase()
  if (h.length < 3) return { ok: false, why: '至少 3 个字符' }
  if (h.length > 24) return { ok: false, why: '最多 24 个字符' }
  if (!/^[a-z0-9-]+$/.test(h)) return { ok: false, why: '只能用小写字母、数字和连字符' }
  if (h.startsWith('-') || h.endsWith('-')) return { ok: false, why: '不能以连字符开头或结尾' }
  if (h.includes('--')) return { ok: false, why: '不能有连着的两个连字符' }
  if (/^\d+$/.test(h)) return { ok: false, why: '不能全是数字' }
  return { ok: true }
}

export function StatsShare({ signedIn, onError }: { signedIn: boolean; onError(m: string): void }) {
  const [state, setState] = useState<StatsState | null>(null)
  const [mine, setMine] = useState<PublicStats | null>(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState('')
  const [seen, setSeen] = useState<string | null>(null)

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

  /** 本机算的那七个数。**不发请求** —— 没登录也该看得见 */
  useEffect(() => {
    void api
      .statsPreview()
      .then(setMine)
      .catch(() => setMine(null))
  }, [])

  const load = useCallback(() => {
    if (!signedIn) {
      setState(null)
      return
    }
    void api
      .statsMe()
      .then(setState)
      .catch((e: unknown) => {
        // 读不到就说读不到，别把界面停在「正在看……」上骗人
        setState(null)
        onError(msg(e))
      })
  }, [signedIn, onError])

  useEffect(load, [load])

  const run = async (tag: string, fn: () => Promise<StatsState>) => {
    setBusy(tag)
    try {
      setState(await fn())
      setEditing(false)
    } catch (e) {
      onError(msg(e))
    } finally {
      setBusy('')
    }
  }

  const claimed = !!state?.handle
  const check = draft.trim() ? checkLocally(draft) : null

  return (
    <div className="settings-section" style={{ marginTop: 18 }}>
      <div className="script-group-name">对外统计</div>

      <div className="settings-hint" style={{ marginBottom: 10 }}>
        别的网站可以读到你的连胜和字数 —— <b>就下面这七个数，没有别的</b>。
        书名、章节名、正文一个字都不会离开这台电脑。
      </div>

      {/* 会发出去什么：一直摆着，不用先登录 */}
      {mine && <StatsGrid s={mine} />}

      {!signedIn ? (
        <div className="settings-hint">
          还没登录，所以<b>什么都没发出去</b>。上面那几个数只在你自己机器上。
        </div>
      ) : state === null ? (
        <div className="empty-hint">正在看……</div>
      ) : (
        <>
          {/* ── 短名：没有它就没有公开地址，也就没人读得到 ── */}
          <div className="ai-field" style={{ marginTop: 12 }}>
            <label>对外短名</label>
            {claimed && !editing ? (
              <div className="ai-key-row">
                <input className="search-input" readOnly value={state.handle} />
                <button
                  className="btn"
                  onClick={() => {
                    setDraft(state.handle)
                    setEditing(true)
                  }}
                >
                  改
                </button>
              </div>
            ) : (
              <>
                <div className="ai-key-row">
                  <input
                    className="search-input"
                    placeholder="小写字母、数字、连字符，3–24 个"
                    value={draft}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <button
                    className="btn btn-primary"
                    disabled={!!busy || check?.ok !== true}
                    onClick={() => void run('claim', () => api.statsClaimHandle(draft))}
                  >
                    {busy === 'claim' ? '认领中……' : claimed ? '换成这个' : '认领'}
                  </button>
                  {claimed && (
                    <button className="btn" onClick={() => setEditing(false)}>
                      算了
                    </button>
                  )}
                </div>
                {/*
                  规矩不合当场就说，别等一趟网络往返回来才说 ——
                  那一趟回来说的也是同一句话
                */}
                {check && !check.ok && <div className="settings-hint account-warn">{check.why}</div>}
              </>
            )}
            <div className="settings-hint">
              它会出现在别人网站的地址栏里。<b>没认领短名之前，没有任何人读得到你。</b>
            </div>
          </div>

          {/* ── 公开地址：给作者复制出去贴到别处 ── */}
          {state.publicUrl && (
            <div className="ai-field">
              <label>公开地址</label>
              <div className="ai-key-row">
                <input className="search-input" readOnly value={state.publicUrl} />
                <button
                  className="btn"
                  onClick={() => void navigator.clipboard.writeText(state.publicUrl)}
                >
                  复制
                </button>
                {/* 外链交给系统浏览器 —— 主进程的 setWindowOpenHandler 拦下来转出去 */}
                <a className="btn" href={state.publicUrl} target="_blank" rel="noreferrer">
                  打开
                </a>
              </div>
              <div className="settings-hint">
                任何人都能读，不用登录。别的网站直接 <code>fetch</code> 它就行。
              </div>
            </div>
          )}

          {/* ── 上传 ── */}
          <div className="plan-actions" style={{ marginTop: 12 }}>
            <button
              className="btn btn-primary"
              disabled={!!busy}
              onClick={() => void run('push', () => api.statsPush())}
            >
              {busy === 'push' ? '上传中……' : '现在上传一次'}
            </button>
            {state.lastPushAt && <span className="faint">上次上传 {when(state.lastPushAt)}</span>}
          </div>

          <label className="settings-hint" style={{ display: 'block', marginTop: 8 }}>
            <input
              type="checkbox"
              checked={state.autoPush}
              disabled={!!busy}
              onChange={(e) => void run('auto', () => api.statsSetAutoPush(e.target.checked))}
            />{' '}
            开着软件时每半小时自动上传一次。
            {/*
              不做成秒级实时：对外要回答的是「他最近在写吗」，不是
              「他这一分钟写了几个字」—— 后者意味着他一边写一边有东西
              在往外发，那是另一种感觉
            */}
            <b>默认关着</b>，这个开关得你自己打开。
          </label>

          {state.autoError && (
            <div className="settings-hint account-warn">
              上次自动上传没成功：{state.autoError}
            </div>
          )}

          {/* ── 服务器上现在是什么 ── */}
          <div className="settings-hint" style={{ marginTop: 12 }}>
            {state.updatedAt ? (
              <>
                服务器上那份是 <b>{when(state.updatedAt)}</b> 的。
              </>
            ) : (
              <>
                服务器上<b>还没有你的数据</b> —— 一次都没上传过。
              </>
            )}
          </div>

          {claimed && (
            <div className="plan-actions">
              <button
                className="btn"
                disabled={!!busy}
                onClick={() => {
                  setBusy('read')
                  void api
                    .statsPublic(state.handle)
                    .then((p) => setSeen(JSON.stringify(p, null, 2)))
                    .catch((e: unknown) => setSeen(`读不到：${msg(e)}`))
                    .finally(() => setBusy(''))
                }}
              >
                {busy === 'read' ? '正在读……' : '看看别人读到什么'}
              </button>
            </div>
          )}
          {seen !== null && (
            <>
              {/*
                原样吐 JSON，不做成好看的表格 —— 这里要给的正是
                「别的网站拿到的那一串东西」，美化过就不是它了
              */}
              <pre className="settings-hint" style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
                {seen}
              </pre>
              <div className="settings-hint">
                这就是<b>不带任何令牌</b>访问那个地址的结果，跟别的网站看到的一模一样。
              </div>
            </>
          )}

          {/* ── 反悔的出口 ── */}
          {(claimed || !!state.updatedAt) && (
            <div className="plan-actions" style={{ marginTop: 14 }}>
              <button
                className="btn btn-danger"
                disabled={!!busy}
                onClick={() => {
                  const sure = confirm(
                    '把你在统计服务器上的数据整个删掉？公开地址会立刻失效，短名也会放回去给别人用。',
                  )
                  if (sure) void run('forget', () => api.statsForget())
                }}
              >
                {busy === 'forget' ? '删除中……' : '删掉服务器上的我'}
              </button>
              <span className="faint">删干净，连短名一起</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
