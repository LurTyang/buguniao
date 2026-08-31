/**
 * 剧本模式面板。
 *
 * 规范：更新文档/05-功能模块详述.md §12
 *
 * 三件事，都是写剧本时真会反复看的：
 *   1. **谁的戏多** —— 按台词字数排，一眼看出谁被写多了、谁被写没了
 *   2. **场次清单** —— 点一下跳过去，比在目录树里翻快
 *   3. 排版开关 —— 只影响显示，**一个字节都不写进文件**
 *
 * 排版开关这一点要在界面上说死。作者最怕的就是「打开某个模式，
 * 文件被软件改了」——那违反第一条铁律。
 */

import { useMemo } from 'react'
import {
  castStats,
  longestAbsence,
  parseScript,
  sceneCast,
  scriptSummary,
  unknownSpeakers,
  type Cast,
  type CastStat,
} from '@bugu/core'

export function ScriptPanel({
  body,
  scriptView,
  onToggleView,
  onJump,
  onMoveScene,
  onNewScript,
  bookCast,
  castCategories,
  castChosen,
  onCastCategories,
}: {
  /** 当前文档正文 */
  body: string
  /** 剧本排版开着没有 */
  scriptView: boolean
  onToggleView(next: boolean): void
  /** 跳到某一行（从 0 起） */
  onJump(line: number): void
  /** 把第 from 场挪到第 to 场的位置 */
  onMoveScene(from: number, to: number): void
  onNewScript(): void
  /** 设定集里读来的角色名单 */
  bookCast: Cast
  /** 设定集里全部分类，供勾选 */
  castCategories: string[]
  /** 当前算「人物」的是哪几个，以及作者自己选过没有 */
  castChosen: { picked: string[]; chosen: boolean }
  onCastCategories(next: string[]): void
}) {
  const doc = useMemo(() => parseScript(body, { cast: bookCast }), [body, bookCast])
  const cast = useMemo(() => castStats(doc), [doc])
  const sum = useMemo(() => scriptSummary(doc), [doc])
  const perScene = useMemo(() => sceneCast(doc), [doc])
  const absence = useMemo(() => longestAbsence(doc), [doc])
  const unknown = useMemo(() => unknownSpeakers(doc, bookCast), [doc, bookCast])

  const max = cast[0]?.chars ?? 0
  /** 有编号的场（第一个 # 之前的内容不算一场，挪不了） */
  const realScenes = doc.scenes.filter((sc) => sc.no >= 0)

  return (
    <div className="script-panel">
      <div className="settings-row">
        <span>剧本排版</span>
        <button
          className={`toggle${scriptView ? ' on' : ''}`}
          onClick={() => onToggleView(!scriptView)}
          role="switch"
          aria-checked={scriptView}
        />
      </div>
      <div className="settings-hint">
        {/* 这句话不能省：作者最怕「开了个模式，文件被改了」 */}
        只改显示，<b>不动文件一个字节</b>。关掉就是原来的纯文本。
      </div>

      {sum.dialogueLines === 0 ? (
        <div className="empty-hint">
          这一篇里还没有台词。
          <br />
          写成「角色名：台词」就会被认出来，比如
          <br />
          <code>李四：你等很久了？</code>
          <br />
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={onNewScript}>
            新建一篇，带骨架
          </button>
        </div>
      ) : (
        <>
          <div className="fs-hint">
            {sum.scenes} 场 · {sum.cast} 个角色 · 台词 {sum.dialogueLines} 条{' '}
            {sum.dialogueChars.toLocaleString()} 字 · 动作与叙述 {sum.actionChars.toLocaleString()} 字
          </div>

          <div className="script-group">
            <div className="script-group-name">角色名从哪儿来</div>
            {/*
              有了确凿的名单才敢把角色名单独排一行 ——
              排错了就是把一句叙述从中间劈成两半。
            */}
            {castCategories.length === 0 ? (
              <div className="settings-hint">
                设定集里还没有分类。建一个「人物」分类、把角色卡放进去，
                这里就能勾上，正文里的角色名会单独排一行。
              </div>
            ) : (
              <>
                <div className="cast-pick">
                  {castCategories.map((c) => {
                    const on = castChosen.picked.includes(c)
                    return (
                      <button
                        key={c}
                        className={on ? 'on' : ''}
                        onClick={() =>
                          onCastCategories(
                            on
                              ? castChosen.picked.filter((x) => x !== c)
                              : [...castChosen.picked, c],
                          )
                        }
                      >
                        {c}
                      </button>
                    )
                  })}
                </div>
                <div className="settings-hint">
                  {bookCast.names.length > 0
                    ? `认得 ${bookCast.names.length} 个名字。`
                    : '这几个分类里还没有卡片。'}
                  {!castChosen.chosen && castChosen.picked.length > 0 && '（这是猜的，可以改）'}
                  {' 卡片名就是角色名；卡里写一行「别名：小李、李哥」也认。'}
                </div>
              </>
            )}
          </div>

          {unknown.length > 0 && (
            <div className="script-group">
              <div className="script-group-name">这些名字不在人物卡里</div>
              {/*
                抓的是写错的人名 ——「李西」和「李四」在统计表里是两个人，
                而作者盯着那张表根本看不出来，两行长得几乎一样。
              */}
              {unknown.slice(0, 8).map((u) => (
                <button
                  key={u.who}
                  className="script-unknown"
                  onClick={() => onJump(u.firstLine)}
                >
                  <b>{u.who}</b>
                  <span className="faint">{u.lines} 条</span>
                </button>
              ))}
              <div className="settings-hint">
                要么是打错了字，要么是这个人还没建卡。它们不会被单独排一行。
              </div>
            </div>
          )}

          <div className="script-group">
            <div className="script-group-name">谁的戏多</div>
            {cast.map((c) => (
              <CastRow key={c.who} stat={c} max={max} onJump={() => onJump(c.firstLine)} />
            ))}
          </div>

          {absence.length > 0 && absence[0]!.gap >= 2 && (
            <div className="script-group">
              <div className="script-group-name">谁好久没出声了</div>
              {/*
                群像戏最怕「某个角色连着五场一句话都没有」——
                只看整篇的总台词数看不出来，得摊到场上才看得见。
              */}
              {absence
                .filter((a) => a.gap >= 2)
                .slice(0, 6)
                .map((a) => (
                  <div key={a.who} className="script-absence">
                    <b>{a.who}</b>
                    <span className="faint">连着 {a.gap} 场没说话</span>
                  </div>
                ))}
            </div>
          )}

          <div className="script-group">
            <div className="script-group-name">场次</div>
            {doc.scenes.length === 0 ? (
              <div className="fs-hint">还没分场。用 <code># 第一场　内景·咖啡馆·日</code> 起一场。</div>
            ) : (
              doc.scenes.map((sc) => {
                const i = realScenes.findIndex((x) => x.line === sc.line)
                const per = perScene.find((x) => x.scene === sc.no)
                return (
                  <div key={`${sc.no}-${sc.line}`} className="script-scene-row">
                    <button className="script-scene" onClick={() => onJump(Math.max(0, sc.line))}>
                      <span className="script-scene-title">{sc.title || '（无标题）'}</span>
                      <span className="faint">
                        {sc.dialogueCount} 条
                        {per && per.chars > 0 && `　${per.chars} 字`}
                        {per && per.who.length > 0 && `　主场：${per.who[0]!.who}`}
                      </span>
                    </button>
                    {i >= 0 && (
                      <span className="script-scene-move">
                        {/*
                          用上移/下移而不是拖拽：这个操作**直接改正文**，
                          场次顺序就是正文里的顺序。点错一下比拖错一下好收拾，
                          而且它走完整保存管线，版本历史里能回滚。
                        */}
                        <button
                          disabled={i === 0}
                          title="上移一场"
                          onClick={() => onMoveScene(i, i - 1)}
                        >
                          ↑
                        </button>
                        <button
                          disabled={i === realScenes.length - 1}
                          title="下移一场"
                          onClick={() => onMoveScene(i, i + 1)}
                        >
                          ↓
                        </button>
                      </span>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** 一个角色一行，条形长度按台词字数 */
function CastRow({ stat, max, onJump }: { stat: CastStat; max: number; onJump(): void }) {
  const pct = max > 0 ? Math.round((stat.chars / max) * 100) : 0
  return (
    <button className="script-cast" onClick={onJump} title="跳到他第一次说话的地方">
      <span className="script-cast-name">{stat.who}</span>
      <span className="script-cast-bar">
        <span className="script-cast-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="script-cast-num">
        {stat.chars.toLocaleString()} 字 · {stat.lines} 条
      </span>
    </button>
  )
}
