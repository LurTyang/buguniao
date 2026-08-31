/**
 * 账号 —— 你是谁、写了多久、登录没登录。
 *
 * 规范：更新文档/08-账号与对外接口.md
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么没有邮箱框和密码框】
 *
 * 自己做登录框 = 密码要经过我们的进程。那我们就得对
 * 「密码有没有被记进日志、有没有被崩溃报告带走」负责，
 * 而且换了两步验证、加了微信登录，客户端全得跟着改。
 *
 * 走系统浏览器（RFC 8252 + PKCE）之后，**软件从头到尾看不见密码**。
 * 界面上因此只有一个按钮。
 *
 * 【为什么「关于你」并进来了】
 *
 * 原来「关于你」和「账号」是两页，但它们说的是同一件事 ——
 * 你是谁。昵称在这页、连胜在那页，找起来没有道理。
 * 并成一页之后：上半截是本机的你（不登录也有），下半截是对外的你。
 * ─────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { StatsShare } from './StatsShare.js'
import type { LoginState } from '../../shared/api.js'

/** 计划报告里这一页要用的那几个数 */
export interface MeStats {
  nickname: string
  daysSinceStart: number
  daysWritten: number
  streak: { current: number; best: number }
}

export function AccountPanel({
  onError,
  me,
  version,
  onRename,
}: {
  onError(m: string): void
  /** 本机这边的「你」。读不出来就只显示下半截 */
  me: MeStats | null
  version: string
  onRename(): void
}) {
  const [state, setState] = useState<LoginState | null>(null)
  const [busy, setBusy] = useState(false)

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

  const load = useCallback(() => {
    void api.loginState().then(setState).catch(() => setState(null))
  }, [])

  useEffect(load, [load])

  const run = async (fn: () => Promise<LoginState>) => {
    setBusy(true)
    try {
      setState(await fn())
    } catch (e) {
      onError(msg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="set-me">
      {/* ── 上半截：本机的你。不登录也有 ── */}
      <div className="ai-field">
        <label>昵称</label>
        <div className="ai-key-row">
          <input
            className="search-input"
            readOnly
            value={me?.nickname || '还没起名字'}
            onClick={onRename}
          />
          <button className="btn" onClick={onRename}>
            改
          </button>
        </div>
        <div className="settings-hint">
          只存在你自己的库里（<code>_计划.yaml</code>），跟着同步走。
          <b>本机不存邮箱和密码</b>。
        </div>
      </div>

      {me && (
        <div className="set-stat">
          <div>
            <b>{me.daysSinceStart}</b>
            <span className="faint">一起写了几天</span>
          </div>
          <div>
            <b>{me.daysWritten}</b>
            <span className="faint">动过笔的天数</span>
          </div>
          <div>
            <b>{me.streak.current}</b>
            <span className="faint">当前连胜</span>
          </div>
          <div>
            <b>{me.streak.best}</b>
            <span className="faint">最长连胜</span>
          </div>
        </div>
      )}

      {/* ── 下半截：对外的你 ── */}
      <div className="settings-section" style={{ marginTop: 18 }}>
        <div className="script-group-name">登录</div>

        <div className="settings-hint" style={{ marginBottom: 10 }}>
          <b>不登录也能用，一个功能都不少。</b>
          登录只是给你一个对外的身份，好让别的网站能读到你的连胜和字数。
          稿子永远在你自己硬盘上 —— 这软件不往服务器上传一个字的正文。
        </div>

        {state === null ? (
          <div className="empty-hint">正在看……</div>
        ) : !state.configured ? (
          // 地址是写死在代码里的，走到这儿说明这个包打坏了
          <div className="empty-hint">这个版本的登录服务没配上，请换一个安装包。</div>
        ) : state.signedIn ? (
          <>
            <div className="account-who">
              <b>{state.name || '（这个账号没设昵称）'}</b>
              <span className="faint">已登录</span>
            </div>
            {state.dropped.length > 0 && (
              // 登进来了但少了点东西，得说出来 —— 不然作者会奇怪
              // 「为什么昵称是空的」「为什么过一阵又要我登一次」
              <div className="settings-hint">
                这次少拿了 <b>{state.dropped.join('、')}</b>，是登录服务那边没给。
                {state.dropped.includes('profile') && <>　所以显示不出昵称。</>}
                {state.dropped.includes('offline_access') && <>　登录过一阵会失效，得再登一次。</>}
              </div>
            )}
            <div className="plan-actions">
              <button className="btn" disabled={busy} onClick={() => void run(() => api.loginOut())}>
                退出登录
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="plan-actions">
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void run(() => api.loginWithBrowser())}
              >
                {busy ? '等你在浏览器里操作……' : '用浏览器登录'}
              </button>
            </div>
            <div className="settings-hint">
              {/*
                这句话是这一页最要紧的一句：它解释了为什么这儿没有密码框，
                否则「怎么还要开浏览器」会被当成偷懒
              */}
              会打开你的浏览器。<b>密码只在浏览器里输，这软件看不见它</b>，
              也就没法弄丢它。注册也在那边，没有账号就顺手注册一个。
            </div>
          </>
        )}
      </div>

      {/*
        对外统计单独一块，跟在登录后面。
        顺序是有讲究的：先「你是谁」，再「你要不要让别人看见」——
        反过来的话，作者会先看到一堆开关，才明白它们跟登录有什么关系。
        没登录时它也在，只是只显示「会发出去哪七个数」——
        「先看清楚再决定」不该需要先登录。
      */}
      <StatsShare signedIn={state?.signedIn === true} onError={onError} />

      <div className="settings-hint" style={{ marginTop: 14 }}>
        {/*
          版本号要显眼到能被截图报错时带上 ——
          收到「这儿有个 bug」而不知道是哪个版本，等于没收到
        */}
        不咕鸟 {version} · 测试版
      </div>
    </div>
  )
}
