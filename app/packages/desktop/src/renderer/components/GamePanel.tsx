/**
 * 游戏剧本面板：进度、跳转、分支、体检。
 *
 * 规范：更新文档/05-功能模块详述.md §14
 *
 * ─────────────────────────────────────────────────────────────
 * 【这个面板真正的价值在「体检」那一块】
 *
 * 断头路（跳到不存在的节点）、孤儿节点（没人跳到它）、
 * 走不到的分支（条件永远不满足）、死路（没出口又不是结局）——
 * 这些是分支剧情最会咬人的地方，而且**几十个文件里靠人眼是翻不出来的**。
 * 写完一整条线才发现某个结局根本拿不到，那是几万字白写。
 * ─────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { GraphView } from './GraphView.js'

type Graph = Awaited<ReturnType<typeof api.gameGraph>>

const PROBLEM_LABEL: Record<string, string> = {
  duplicate: '重名',
  missingTarget: '断头路',
  orphan: '孤儿',
  deadEnd: '死路',
  badCondition: '条件写坏了',
  unsetVariable: '变量没赋过值',
  unmarkedLoop: '绕回去了',
  mergeIgnored: '合并没生效',
}

/**
 * 重新建图的等待时间。
 *
 * 原来是**存盘之后**才重建，而存盘是停手三秒才发生的 —— 改一个节点名，
 * 得等三秒多图才动，看着就是「路线图有延迟」（作者报过这个）。
 * 现在直接拿编辑器里还没存的那一份建，350ms 足够避开连续打字，
 * 又快到「改完抬头图已经变了」。
 */
const REBUILD_DELAY_MS = 350

export function GamePanel({
  bookPath,
  refreshKey,
  live,
  onOpenAt,
  onNewTemplate,
  onInsert,
}: {
  bookPath: string
  /** 保存后递增，重新建图 */
  refreshKey: number
  /**
   * 编辑器里**还没存盘**的那一篇。
   *
   * 给了它，改一个字图就跟着动 —— 不用等三秒后的自动保存。
   * 「路线图有延迟」这条反馈就是从这儿来的。
   */
  live?: { path: string; body: string } | null
  /** 打开某个文件并跳到某一行 */
  onOpenAt(docPath: string, line: number): void
  /** 新建一篇带骨架的游戏剧本 */
  onNewTemplate(): void
  /** 往稿纸光标处插一段写法。变量那一块要用 */
  onInsert?(before: string, after?: string): void
}) {
  const [g, setG] = useState<Graph | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'graph' | 'nodes' | 'problems' | 'endings' | 'play'>('graph')
  /** 试玩：从哪个节点起、假设哪些变量已经成立 */
  const [playFrom, setPlayFrom] = useState('')
  const [playVars, setPlayVars] = useState('')
  const [play, setPlay] = useState<Awaited<ReturnType<typeof api.playFrom>> | null>(null)
  const [exported, setExported] = useState<Awaited<ReturnType<typeof api.exportGameScript>> | null>(
    null,
  )

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

  /** 建图要的那一份「还没存的正文」。放 ref 里，免得它一变就重建整个 load */
  const liveRef = useRef(live)
  liveRef.current = live

  const load = useCallback(async () => {
    try {
      setG(await api.gameGraph(bookPath, liveRef.current ?? undefined))
      setError(null)
    } catch (e) {
      setError(msg(e))
    }
  }, [bookPath])

  // 换书、存盘之后立刻重建一次
  useEffect(() => {
    void load()
  }, [load, refreshKey])

  /**
   * 正文一变就重建（等一下下，别每敲一个字建一次）。
   *
   * 依赖里只放 `live?.body` 和路径 —— 放整个对象的话每次渲染都是新引用，
   * 定时器会被无穷无尽地重排，图反而永远不刷新。
   */
  const liveBody = live?.body
  const livePath = live?.path
  useEffect(() => {
    if (liveBody === undefined) return
    const t = window.setTimeout(() => void load(), REBUILD_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [liveBody, livePath, load])

  if (error) return <div className="search-error">{error}</div>
  if (!g) return <div className="empty-hint">正在建图……</div>

  if (g.nodes.length === 0) {
    return (
      <div className="empty-hint">
        这本书里还没有节点。
        <br />
        游戏剧本用 <code># 节点名</code> 起一个节点，
        <br />
        用 <code>- 选项 -&gt; 目标节点</code> 分支。
        <br />
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={onNewTemplate}>
          新建一篇，带骨架
        </button>
      </div>
    )
  }

  const p = g.progress
  const unreachable = new Set(g.unreachable)

  return (
    <div className="game-panel">
      <div className="game-progress">
        <div className="game-bar">
          <span className="game-bar-fill" style={{ width: `${p.percent}%` }} />
        </div>
        <div className="fs-hint">
          {p.written} / {p.nodes} 个节点写了内容（{p.percent}%）· {p.chars.toLocaleString()} 字 ·{' '}
          {p.options} 个选项 · {p.endings} 个结局
        </div>
      </div>

      <div className="ai-tabs-mini" style={{ padding: '0 12px' }}>
        <button className={`tab${tab === 'graph' ? ' active' : ''}`} onClick={() => setTab('graph')}>
          图
        </button>
        <button className={`tab${tab === 'nodes' ? ' active' : ''}`} onClick={() => setTab('nodes')}>
          节点 {g.nodes.length}
        </button>
        <button
          className={`tab${tab === 'problems' ? ' active' : ''}`}
          onClick={() => setTab('problems')}
        >
          体检 {g.problems.length}
        </button>
        <button
          className={`tab${tab === 'endings' ? ' active' : ''}`}
          onClick={() => setTab('endings')}
        >
          结局 {g.endings.length}
        </button>
        <button className={`tab${tab === 'play' ? ' active' : ''}`} onClick={() => setTab('play')}>
          试玩
        </button>
      </div>

      {tab === 'graph' && (
        <GraphView nodes={g.nodes} reachable={g.reachable} start={g.start} onPick={onOpenAt} />
      )}

      {tab === 'nodes' && (
        <div className="game-list">
          {g.nodes.map((n) => (
            <button
              key={`${n.docPath}:${n.line}`}
              className="game-node"
              onClick={() => onOpenAt(n.docPath, n.line)}
            >
              <span className="game-node-head">
                <b>{n.name}</b>
                {n.name === g.start && <span className="game-tag start">起点</span>}
                {!n.written && <span className="game-tag stub">空壳</span>}
                {unreachable.has(n.name) && (
                  <span className="game-tag bad" title="从起点走不到这里">
                    走不到
                  </span>
                )}
              </span>
              <span className="faint">
                {n.docTitle} · {n.chars} 字 ·{' '}
                {n.exits.length === 0
                  ? '没有出口'
                  : n.exits
                      .map((e) => (e.condition ? `{${e.condition.raw}} ` : '') + (e.label || '→') + ' ' + e.target)
                      .join('　')}
              </span>
            </button>
          ))}
        </div>
      )}

      {tab === 'problems' && (
        <div className="game-list">
          {g.problems.length === 0 ? (
            <div className="empty-hint">
              没查出问题。
              <br />
              没有断头路、没有孤儿节点、每个节点都走得到。
            </div>
          ) : (
            g.problems.map((pr, i) => (
              <button
                key={i}
                className="game-problem"
                onClick={() => onOpenAt(pr.docPath, pr.line)}
              >
                <span className="game-node-head">
                  <span className={`game-tag bad`}>{PROBLEM_LABEL[pr.kind] ?? pr.kind}</span>
                  <b>{pr.node}</b>
                </span>
                <span className="faint">{pr.message}</span>
              </button>
            ))
          )}
        </div>
      )}

      {tab === 'endings' && (
        <div className="game-list">
          {g.truncated && (
            <div className="search-error">
              {/* 作者会拿这个判断「某个结局拿不到」，糊弄他会让他白写几万字 */}
              分支太多，只走了一部分就停了 —— 下面的结局清单<b>不是全的</b>。
            </div>
          )}
          {g.endings.length === 0 ? (
            <div className="empty-hint">还没有走得到的结局。</div>
          ) : (
            g.endings.map((e, i) => (
              <div key={i} className="game-ending">
                <div className="game-node-head">
                  <b>{e.name}</b>
                  <span className="faint">{e.path.length} 步</span>
                </div>
                <div className="game-path">
                  {e.path.map((s, j) => (
                    <span key={j}>
                      {j > 0 && <span className="game-arrow">{s.via ? `—${s.via}→` : '→'}</span>}
                      <span className="game-path-node">{s.node}</span>
                    </span>
                  ))}
                </div>
                {Object.keys(e.state).length > 0 && (
                  <div className="faint game-state">
                    {Object.entries(e.state)
                      .map(([k, v]) => `${k}=${v}`)
                      .join('　')}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'play' && (
        <div className="game-play">
          <div className="fs-hint">
            {/*
              写到第八章时想试「从这儿往后还能到哪些结局」，
              每次都从头走一遍是没法用的。
            */}
            从任意节点往后走一遍，看还能到哪些结局。
          </div>

          <div className="ai-field">
            <label>从哪儿开始</label>
            <select
              className="settings-select"
              style={{ width: '100%' }}
              value={playFrom || (g.start ?? '')}
              onChange={(e) => setPlayFrom(e.target.value)}
            >
              {g.nodes.map((n) => (
                <option key={`${n.docPath}:${n.line}`} value={n.name}>
                  {n.name}
                  {n.name === g.start ? '（起点）' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="ai-field">
            <label>假设这些已经成立</label>
            <input
              className="search-input"
              placeholder="好感度=3　拿到钥匙=真　（空格分隔，可留空）"
              value={playVars}
              onChange={(e) => setPlayVars(e.target.value)}
            />
            <div className="settings-hint">
              试玩中段剧情时得能假设「已经拿到钥匙了」，否则条件分支全走不进去。
            </div>
          </div>

          <div className="plan-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                const st: Record<string, string | number | boolean> = {}
                for (const bit of playVars.split(/[\s，,]+/).filter(Boolean)) {
                  const at = bit.indexOf('=')
                  if (at <= 0) {
                    st[bit] = true
                    continue
                  }
                  const k = bit.slice(0, at).trim()
                  const v = bit.slice(at + 1).trim()
                  st[k] = v === '真' || v === 'true' ? true
                    : v === '假' || v === 'false' ? false
                    : /^-?\d+(\.\d+)?$/.test(v) ? Number(v)
                    : v
                }
                void api
                  .playFrom(bookPath, playFrom || (g.start ?? ''), st)
                  .then(setPlay)
                  .catch((e) => setError(msg(e)))
              }}
            >
              走一遍
            </button>
          </div>

          {play && (
            <div className="game-list">
              {play.truncated && (
                <div className="search-error">分支太多，只走了一部分 —— 下面不是全的。</div>
              )}
              <div className="fs-hint">
                走得到 {play.reachable.length} 个节点 · {play.endings.length} 个结局
                {play.unreachable.length > 0 && `　走不到 ${play.unreachable.length} 个`}
              </div>
              {play.endings.map((e, i) => (
                <div key={i} className="game-ending">
                  <div className="game-node-head">
                    <b>{e.name}</b>
                    <span className="faint">{e.path.length} 步</span>
                  </div>
                  <div className="game-path">
                    {e.path.map((s, j) => (
                      <span key={j}>
                        {j > 0 && <span className="game-arrow">{s.via ? `—${s.via}→` : '→'}</span>}
                        <span className="game-path-node">{s.node}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="script-group">
            <div className="script-group-name">导出给引擎</div>
            <div className="plan-actions">
              <button
                className="btn"
                onClick={() =>
                  void api.exportGameScript(bookPath, 'renpy').then(setExported).catch((e) => setError(msg(e)))
                }
              >
                Ren'Py
              </button>
              <button
                className="btn"
                onClick={() =>
                  void api.exportGameScript(bookPath, 'ink').then(setExported).catch((e) => setError(msg(e)))
                }
              >
                ink
              </button>
            </div>
            <div className="settings-hint">
              {/*
                让作者以为导出来就能跑，他会拿去开工程然后发现少一半东西。
                这句话必须在按钮旁边，不能只写在文件头里。
              */}
              导出的是<b>骨架</b>：节点、选项、跳转、变量、条件。
              立绘、音乐、转场、界面不在里面 —— 那些本来也不在剧本里。
            </div>

            {exported && (
              <div className="game-export">
                {exported.notes.length > 0 && (
                  <div className="fs-hint">
                    {exported.notes.map((n, i) => (
                      <div key={i}>· {n}</div>
                    ))}
                  </div>
                )}
                <pre>{exported.text}</pre>
                <div className="plan-actions">
                  <button
                    className="btn"
                    onClick={() => void navigator.clipboard.writeText(exported.text)}
                  >
                    复制全部
                  </button>
                  <span className="faint">建议存成 {exported.fileName}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <VarsBlock
        vars={g.variables}
        nodes={g.nodes}
        onOpenAt={onOpenAt}
        {...(onInsert ? { onInsert } : {})}
      />
    </div>
  )
}

/**
 * 变量这一块。
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么它比原来啰嗦这么多】
 *
 * 原来这儿只有一行「好感度：0 / 1 / 2」。作者的反馈是
 * 「变量增加操作不清楚」—— 那一行确实没回答任何一个他会问的问题：
 *
 *   怎么加一个变量？        → 没说。现在上面就摆着 `$ 好感度 += 1`，还能一键插进去
 *   我这个变量在哪儿改过？   → 没说。现在列出来，点一下就跳过去
 *   为什么我的条件不成立？   → 没说。现在「一次都没赋过值」会单独标出来
 *
 * 变量是这套语法里唯一「写在 A 处、在 B 处才看得出效果」的东西，
 * 所以它最需要被摊开来看。
 * ─────────────────────────────────────────────────────────────
 */
function VarsBlock({
  vars,
  nodes,
  onOpenAt,
  onInsert,
}: {
  vars: Array<{ name: string; values: string[] }>
  nodes: Graph['nodes']
  onOpenAt(docPath: string, line: number): void
  onInsert?(before: string, after?: string): void
}) {
  /** 每个变量在哪几个节点里被改过。点一下能跳过去 */
  const wheres = new Map<string, Array<{ node: string; docPath: string; line: number; raw: string }>>()
  for (const n of nodes) {
    for (const a of n.assigns) {
      const list = wheres.get(a.variable) ?? []
      list.push({ node: n.name, docPath: n.docPath, line: n.line, raw: a.raw })
      wheres.set(a.variable, list)
    }
  }

  // 条件里用到、但一次都没赋过值的 —— 那些分支永远走不到。
  // 体检里也报，这儿再列一次是因为**作者是带着「我的变量呢」的疑问来这一块的**
  const used = new Set<string>()
  for (const n of nodes) {
    for (const e of n.exits) {
      if (e.condition) used.add(e.condition.variable)
      for (const g of e.guards) used.add(g.variable)
    }
  }
  const never = [...used].filter((v) => !wheres.has(v))
  const names = [...new Set([...vars.map((v) => v.name), ...wheres.keys()])].sort()

  return (
    <div className="game-vars">
      <div className="script-group-name">变量</div>

      {/* 怎么写，摆在最上面。这一块存在的头号理由就是回答这个 */}
      <div className="game-var-how">
        {(
          [
            ['$ 好感度 += 1', '加一点。减就写 -=', '$ 好感度 += 1'],
            ['$ 拿到钥匙 = 真', '直接设成某个值', '$ 拿到钥匙 = 真'],
            ['- {好感度>=3} 搭话 -> 熟络', '够了才给这个选项', '- {好感度>=3} 选项 -> 目标'],
            ['$若 好感度>=3 … $结束', '够了才走这一整段', '$若 好感度>=3'],
          ] as Array<[string, string, string]>
        ).map(([code, why, insert]) => (
          <div key={code} className="game-var-how-row">
            <code>{code}</code>
            <span className="faint">{why}</span>
            {onInsert && (
              <button className="btn btn-mini" onClick={() => onInsert(insert)} title="插到光标处">
                插入
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="settings-hint">
        变量不用先声明，<b>第一次写 <code>$ 名字 …</code> 它就存在了</b>。
        没赋过值的变量在比较时当 0 / 假。
      </div>

      {names.length === 0 ? (
        <div className="settings-hint">这本书里还没有变量。</div>
      ) : (
        names.map((name) => {
          const where = wheres.get(name) ?? []
          const values = vars.find((v) => v.name === name)?.values ?? []
          return (
            <div key={name} className="game-var">
              <div className="game-node-head">
                <b>{name}</b>
                {values.length > 0 && <span className="faint">走得到的取值：{values.join(' / ')}</span>}
                {where.length === 0 && (
                  <span className="game-tag bad" title="条件里用了它，但全书没有一处给它赋过值">
                    没赋过值
                  </span>
                )}
              </div>
              {where.map((w, i) => (
                <button
                  key={i}
                  className="game-var-at"
                  onClick={() => onOpenAt(w.docPath, w.line)}
                  title="跳到这个节点"
                >
                  <code>{w.raw}</code>
                  <span className="faint">在「{w.node}」</span>
                </button>
              ))}
            </div>
          )
        })
      )}

      {never.length > 0 && (
        <div className="settings-hint">
          {/* 这是「我的分支怎么走不到」最常见的原因，得说得比体检里那条更直白 */}
          <b>{never.join('、')}</b> 只在条件里出现过，从来没有一处 <code>$ …</code> 给它赋过值 ——
          用到它的那些分支<b>永远走不到</b>。
        </div>
      )}
    </div>
  )
}
