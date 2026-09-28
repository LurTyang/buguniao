/**
 * 「有新版本」那一条横幅。
 *
 * 规范：更新文档/10-自动升级.md
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么摆在书架上，不摆在稿纸上】
 *
 * 启动之后第一眼看见的是书架，而写字的时候最不该被打扰。
 * 一条「有新版本」的提示挂在稿纸顶上，等于每次抬头都提醒你
 * 「你手上这个是旧的」—— 而那件事一点也不急。
 *
 * 【不自动下载】
 *
 * 下载 100MB 要作者点一下。理由跟铁律四同源：软件不该在你写字的时候
 * 偷偷占带宽，更不该自己重启。「自动」只体现在**检查**这一步 ——
 * 那是几 KB 的事。
 *
 * 【装之前一定核对 SHA-256】
 *
 * 校验在主进程做（`main/update.ts`），对不上就不装，并且把两串哈希
 * 都摆给作者看。这软件没有代码签名证书，那串哈希是唯一能证明
 * 「这个包是作者发的」的东西。
 * ─────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import type { UpdateCheck } from '../../shared/api.js'

type Phase = 'idle' | 'downloading' | 'ready' | 'failed'

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`

export function UpdateBanner() {
  const [check, setCheck] = useState<UpdateCheck | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState({ got: 0, total: 0 })
  const [file, setFile] = useState('')
  const [err, setErr] = useState('')
  /** 这一次不想理它。**只记这一次** —— 下次启动再说一遍，不落盘 */
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    // 查不通一律沉默：没网、服务器挂了、代理没开，都不该在书架上留一行红字
    void api
      .checkUpdate()
      .then(setCheck)
      .catch(() => setCheck(null))
  }, [])

  useEffect(() => api.onUpdateProgress(setProgress), [])

  const download = useCallback(async () => {
    setPhase('downloading')
    setErr('')
    try {
      const r = await api.downloadUpdate()
      setFile(r.file)
      setPhase('ready')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setPhase('failed')
    }
  }, [])

  const found = check?.found
  if (!found || hidden) return null

  const m = found.manifest
  const pct = progress.total > 0 ? Math.round((progress.got / progress.total) * 100) : 0

  return (
    <div className="banner update">
      <div className="update-main">
        <b>
          {m.version}
          {m.name && `「${m.name}」`} 出来了
        </b>
        <span className="faint">
          你手上是 {check?.current}
          {m.date && ` · ${m.date}`}
        </span>
        {m.notes && <div className="update-notes">{m.notes}</div>}
        {phase === 'downloading' && (
          <div className="update-notes">
            下着… {pct}%
            {progress.total > 0 && ` （${mb(progress.got)} / ${mb(progress.total)}）`}
          </div>
        )}
        {phase === 'ready' && (
          <div className="update-notes">
            {found.canInstall
              ? '下好了，也核对过校验值。点「装上」会关掉软件、装完自己起来 —— 先把手上的稿子存了。'
              : '下好了，也核对过校验值。免安装版换不了自己，点一下给你指到文件那儿，你自己替换。'}
          </div>
        )}
        {err && <div className="update-notes danger">{err}</div>}
      </div>

      <div className="update-acts">
        {/* 外部链接走 window.open —— 主进程那个 setWindowOpenHandler 会把它交给系统浏览器 */}
        {m.page && (
          <button className="btn-ghost" onClick={() => window.open(m.page)}>
            看看改了什么
          </button>
        )}
        {phase === 'ready' ? (
          <button className="btn btn-primary" onClick={() => void api.installUpdate(file)}>
            {found.canInstall ? '装上' : '打开它所在的文件夹'}
          </button>
        ) : (
          <button
            className="btn btn-primary"
            disabled={phase === 'downloading'}
            onClick={() => void download()}
          >
            {phase === 'downloading' ? `${pct}%` : found.asset.size > 0 ? `下载（${mb(found.asset.size)}）` : '下载'}
          </button>
        )}
        <button className="icon-btn" onClick={() => setHidden(true)} title="这次先不管">
          以后再说
        </button>
      </div>
    </div>
  )
}
