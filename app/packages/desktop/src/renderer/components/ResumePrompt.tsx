/**
 * 「回到上次那儿吗」。
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么要问，而不是直接跳过去】
 *
 * 直接跳的话，打开软件看到的就不是书架而是某一篇正文 —— 那对
 * 「今天想开本新书」「想先看看书架」的人是劫持。而每次都从书架开始，
 * 对写到第八十章的人又是每天点一遍目录。
 *
 * 所以问一句。两个按钮，回车就是「回去接着写」——
 * **多数时候他就是想接着写**，那一下不该要他动鼠标。
 *
 * 【一次启动只问一次】
 *
 * 跟连胜问候一条规矩：回了书架、换了本书都不再问。
 * 问第二次它就从体贴变成打扰了。
 * ─────────────────────────────────────────────────────────────
 */

import { useEffect } from 'react'
import type { UserSettings } from '../../shared/api.js'

/** 一次启动只问一次。模块级变量就够 —— 重启进程它自然重置 */
let asked = false

export function markResumeAsked(): void {
  asked = true
}

export function alreadyAskedResume(): boolean {
  return asked
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

export function ResumePrompt({
  place,
  bookTitle,
  onResume,
  onDismiss,
}: {
  place: NonNullable<UserSettings['lastPlace']>
  /** 书名。找不到那本书时不该走到这儿 —— 调用方先筛过了 */
  bookTitle: string
  onResume(): void
  onDismiss(): void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') onResume()
      else if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onResume, onDismiss])

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onDismiss()}>
      <div className="modal resume-modal">
        <h3>接着上次写？</h3>
        <p className="modal-hint">
          上次你停在 <b>{bookTitle}</b> · <b>{titleFromPath(place.docPath)}</b>
          {/*
            行号要说出来。只说篇名的话，回去还得自己找光标在哪儿 ——
            而「上次写到哪一行」正是他想回去的那个点
          */}
          {place.line > 0 && <span className="faint">　第 {place.line + 1} 行</span>}
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={onDismiss}>
            留在书架
          </button>
          {/* 回车就是这个。多数时候他就是想接着写 */}
          <button className="btn btn-primary" autoFocus onClick={onResume}>
            回去接着写
          </button>
        </div>
      </div>
    </div>
  )
}
