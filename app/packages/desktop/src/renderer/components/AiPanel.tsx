/**
 * AI 助手面板。
 *
 * 规范：更新文档/05-功能模块详述.md §9
 *
 * 三条界面上必须体现的约束：
 *   - 总开关默认关闭，没填 Key 时把「要填什么、为什么」说清楚
 *   - **AI 的输出永远只待在这个面板里**，采纳与否由作者点，绝不自动改稿
 *   - 每次调用前显示预估花销，跑完显示实际花销与本月累计
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  compareInline,
  countChanges,
  parseContinuations,
  parsePolish,
  parseProofread,
} from '@bugu/core'
import { api } from '../api.js'
import type { AiConfig, AiEstimate, AiRunResult, AiTask, Currency } from '../../shared/api.js'

const SYMBOL: Record<Currency, string> = { USD: '$', CNY: '¥' }

/** 金额显示。带上币种符号，别让人民币和美元长得一样 */
const money = (n: number, c: Currency, digits = 3) => `${SYMBOL[c]}${n.toFixed(digits)}`

const TASKS: Array<{ key: AiTask; label: string; hint: string; needsSelection: boolean }> = [
  { key: 'ask', label: '问它', hint: '基于你的设定、大纲、正文回答。比如「这里我会死吗」', needsSelection: false },
  { key: 'continue', label: '续写', hint: '卡文时给三个不同方向，各 200 字左右', needsSelection: false },
  { key: 'polish', label: '润色', hint: '保持你的语感改一段，并说明改了什么', needsSelection: true },
  { key: 'proofread', label: '抓虫', hint: '找前后矛盾、人设崩坏、时间线错误、伏笔遗漏', needsSelection: false },
]

export interface AiPanelProps {
  bookPath: string
  docPath: string | null
  /** 编辑器里选中的文字，润色和续写要用 */
  selectedText: string
  /** 作者点「采纳」时把文字塞回编辑器 */
  onAdopt(text: string): void
  /** 抓虫结果点「跳过去」时，在正文里找到这段并选中 */
  onLocate(quote: string): void
}

export function AiPanel({ bookPath, docPath, selectedText, onAdopt, onLocate }: AiPanelProps) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.aiStatus>> | null>(null)
  const [task, setTask] = useState<AiTask>('ask')
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [thinking, setThinking] = useState('')
  const [running, setRunning] = useState(false)
  /** 跑了多少秒。AI 想得久的时候，没有这个数就分不清是在想还是卡死了 */
  const [elapsed, setElapsed] = useState(0)
  /** 设置区展开没有。填过 Key 之后默认收起 —— 那些字段是一次性的 */
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [result, setResult] = useState<AiRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [estimate, setEstimate] = useState<AiEstimate | null>(null)
  const reqRef = useRef<string>('')
  const abortRef = useRef<AbortController | null>(null)

  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
  const reload = useCallback(() => {
    void api.aiStatus().then(setStatus).catch((e) => setError(msg(e)))
  }, [])

  useEffect(reload, [reload])

  // 跑起来就开始数秒，停了就停
  useEffect(() => {
    if (!running) return
    setElapsed(0)
    const started = Date.now()
    const id = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 100)
    return () => window.clearInterval(id)
  }, [running])

  // 流式片段
  useEffect(() => {
    return api.onAiDelta((e) => {
      if (e.requestId !== reqRef.current) return
      if (e.kind === 'text') setOutput((t) => t + e.text)
      else setThinking((t) => t + e.text)
    })
  }, [])

  const patch = async (p: Partial<AiConfig>) => {
    try {
      setStatus((s) => (s ? { ...s, config: { ...s.config, ...p } } : s))
      await api.aiSetConfig(p)
    } catch (e) {
      setError(msg(e))
      reload()
    }
  }

  const run = async () => {
    setRunning(true)
    setOutput('')
    setThinking('')
    setResult(null)
    setError(null)
    const id = `r-${Date.now().toString(36)}`
    reqRef.current = id
    abortRef.current = new AbortController()
    try {
      const payload = task === 'polish' || task === 'continue' ? selectedText || input : input
      setResult(await api.aiRun(id, bookPath, docPath, task, payload))
    } catch (e) {
      // 自己点「停」不算错误，别弹一行红字吓人
      if (!abortRef.current?.signal.aborted) setError(msg(e))
    } finally {
      abortRef.current = null
      setRunning(false)
    }
  }

  const doEstimate = async () => {
    try {
      const payload = task === 'polish' || task === 'continue' ? selectedText || input : input
      setEstimate(await api.aiEstimate(bookPath, docPath, task, payload))
      setError(null)
    } catch (e) {
      setError(msg(e))
    }
  }

  if (!status) return <div className="empty-hint">正在读设置……</div>

  // ── 没填 Key ──
  if (!status.hasKey) {
    return (
      <div className="ai-setup">
        <div className="fs-hint" style={{ padding: '14px 12px 8px' }}>
          AI 功能需要你自己的 API Key。软件不代收费用，也不经过任何中间服务器 ——
          请求直接从你的电脑发到你填的那个地址。
          <br />
          <br />
          Key 用系统加密存在本机（<code>%APPDATA%/bugu/secrets.enc</code>），
          <b>不会进同步文件夹</b>，也不会出现在界面进程里。
          <br />
          <br />
          <b>用 AI 时会把相关正文发送给服务商。</b>介意的话就别开这个功能，
          软件其余部分完全不依赖它。
        </div>

        <div style={{ padding: '0 12px 12px' }}>
          <ProviderSetup
            status={status}
            onPatch={(p) => void patch(p)}
            onSaved={reload}
            onError={setError}
          />
          {error && (
            <div className="search-error" style={{ marginTop: 10 }}>
              {error}
            </div>
          )}
        </div>
      </div>
    )
  }

  const cfg = status.config
  const needsSel = TASKS.find((t) => t.key === task)?.needsSelection
  const blocked = needsSel && !selectedText

  return (
    <div className="ai-panel">
      <div className="ai-tasks">
        {TASKS.map((t) => (
          <button key={t.key} className={`tab${task === t.key ? ' active' : ''}`} onClick={() => setTask(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="fs-hint">{TASKS.find((t) => t.key === task)?.hint}</div>

      {task === 'ask' && (
        <div style={{ padding: '0 12px' }}>
          <textarea
            className="ai-input"
            rows={3}
            placeholder="比如：主角现在什么状态？这里我会死吗？"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
      )}

      {needsSel && (
        <div className="ai-selected">
          {selectedText ? (
            <>
              <span className="faint">选中了 {selectedText.length} 字：</span>
              {selectedText.slice(0, 60)}
              {selectedText.length > 60 && '…'}
            </>
          ) : (
            <span className="faint">先在正文里选中一段。</span>
          )}
        </div>
      )}

      <div className="ai-actions">
        <button
          className="btn btn-primary"
          style={{ flex: 1 }}
          disabled={running || blocked || (task === 'ask' && !input.trim())}
          onClick={() => void run()}
        >
          {running ? '正在想……' : '开始'}
        </button>
        {running ? (
          // 抓虫、长章节续写动辄一两分钟，得让作者能中途叫停 ——
          // 停下来时已经流出来的文字**留在面板里**，那也是花过钱的
          <button
            className="btn"
            onClick={() => {
              abortRef.current?.abort()
              void api.aiCancel(reqRef.current)
            }}
            title="停下来，已经出来的文字留着"
          >
            停
          </button>
        ) : (
          <button className="btn" onClick={() => void doEstimate()} title="估算这次要花多少">
            估价
          </button>
        )}
      </div>

      {/*
        AI 想得久的时候（抓虫、长章节续写动辄一两分钟），
        没有这个数就分不清是在想还是卡死了。
      */}
      {running && (
        <div className="ai-timer">
          <span className="ai-dot" />
          正在想…… {elapsed.toFixed(1)} 秒
          {thinking && <span className="faint">　（下面能看到它在想什么）</span>}
        </div>
      )}

      {estimate && (
        <div className="fs-hint">
          {/* exact 为假时是本地粗估的，必须说出来，别让作者以为这个数很准 */}
          这次{estimate.exact ? '' : '大约'} {estimate.inputTokens.toLocaleString()} 个输入 token
          {estimate.priceUnknown
            ? '（单价没填，算不出钱）'
            : `，约 ${money(estimate.estimatedAmount, estimate.currency)}（命中缓存后更低）`}
          {estimate.offPeak && '　现在是空闲时段，半价'}
          {!estimate.exact && (
            <>
              <br />
              这家没有数 token 的接口，上面是本地按字数粗估的，实际以账单为准。
            </>
          )}
        </div>
      )}

      {error && <div className="search-error">{error}</div>}

      {thinking && (
        <details className="ai-thinking">
          <summary>思考过程</summary>
          <pre>{thinking}</pre>
        </details>
      )}

      {output && (
        <div className="ai-output">
          {task === 'continue' ? (
            <ContinueOutput text={output} onAdopt={onAdopt} />
          ) : task === 'polish' ? (
            <PolishOutput raw={output} original={selectedText} onAdopt={onAdopt} />
          ) : task === 'proofread' ? (
            <ProofreadOutput text={output} onLocate={onLocate} />
          ) : (
            <pre>{output}</pre>
          )}

          <div className="ai-output-actions">
            <button onClick={() => void navigator.clipboard.writeText(output)}>复制全部</button>
            <span className="faint ai-adopt-note">AI 不会自己改稿，插不插由你</span>
          </div>
        </div>
      )}

      {result && (
        <div className="fs-hint">
          {/* 单价没填时不能编一个金额出来，老老实实只报 token 数 */}
          {result.usage.amount > 0
            ? `这次花了 ${money(result.usage.amount, result.usage.currency, 4)}，用时 ${elapsed.toFixed(1)} 秒`
            : `这次用了 ${(result.usage.inputTokens + result.usage.cacheReadTokens + result.usage.outputTokens).toLocaleString()} token（单价没填，算不出钱），用时 ${elapsed.toFixed(1)} 秒`}
          {result.usage.cacheReadTokens > 0 &&
            `（缓存命中 ${result.usage.cacheReadTokens.toLocaleString()} token）`}
          {result.webSearches > 0 && `　联网搜索 ${result.webSearches} 次`}
          {result.refusal && <div className="search-error">{result.refusal}</div>}
        </div>
      )}

      <div className="settings-section">
        {/*
          填过 Key 之后默认收起。端点、模型、单价这些是一次性设好的东西，
          天天摊在面板底下只会挤掉正经内容。
        */}
        <button className="settings-fold" onClick={() => setSettingsOpen((o) => !o)}>
          <span className={`fold-arrow${settingsOpen ? ' open' : ''}`}>›</span>
          设置
          <span className="faint fold-sum">
            {status.presets.find((p) => p.baseUrl === status.active.baseUrl)?.label ?? '自定义'}
            {' · '}
            {status.active.model || '没填模型'}
          </span>
        </button>

        {settingsOpen && (
          <>
        <ProviderSetup status={status} onPatch={(p) => void patch(p)} onSaved={reload} onError={setError} />

        <div className="settings-row">
          <span>联网搜索</span>
          <button
            className={`toggle${cfg.webSearch && status.webSearch.available ? ' on' : ''}`}
            disabled={!status.webSearch.available}
            onClick={() => void patch({ webSearch: !cfg.webSearch })}
            role="switch"
            aria-checked={cfg.webSearch && status.webSearch.available}
            title={status.webSearch.available ? '' : status.webSearch.reason}
          />
        </div>
        <div className="settings-hint">
          {/* 灰掉的开关必须说明为什么，不然作者只会以为它坏了 */}
          {status.webSearch.available
            ? '开了它才能查「明代四品官俸禄」这类资料。默认关。'
            : status.webSearch.reason}
        </div>

        <div className="settings-row">
          <span>本月上限</span>
          <div className="pomo-num">
            <button
              disabled={cfg.monthlyCap <= 0}
              onClick={() => void patch({ monthlyCap: Math.max(0, cfg.monthlyCap - 10) })}
            >
              −
            </button>
            <b>
              {SYMBOL[status.active.currency]}
              {cfg.monthlyCap}
            </b>
            <button onClick={() => void patch({ monthlyCap: cfg.monthlyCap + 10 })}>＋</button>
          </div>
        </div>
        <div className="settings-hint">
          本月已用 <b>{money(cfg.usage.amounts[status.active.currency] ?? 0, status.active.currency)}</b>
          （{cfg.usage.inputTokens.toLocaleString()} 进 / {cfg.usage.outputTokens.toLocaleString()} 出）
          {cfg.monthlyCap === 0 && '　上限 0 表示不限'}
          <br />
          到上限会停用 AI 并提示，不会偷偷继续花钱。
          <br />
          金额按你在上面填的单价算 —— 各家随时调价，以服务商后台的账单为准。
          {/* 换了币种的服务商时，另一种货币的累计也得让作者看得见 */}
          {(['USD', 'CNY'] as Currency[])
            .filter((c) => c !== status.active.currency && (cfg.usage.amounts[c] ?? 0) > 0)
            .map((c) => (
              <span key={c}>
                <br />
                本月在另一种币种上还用了 {money(cfg.usage.amounts[c] ?? 0, c)}（别家服务商）。
              </span>
            ))}
        </div>

        <button
          className="btn"
          style={{ width: '100%', marginTop: 8 }}
          onClick={() => void api.aiClearKey(cfg.provider).then(reload)}
        >
          删掉「{status.provider.label}」的 API Key
        </button>
          </>
        )}
      </div>
    </div>
  )
}

// ───────────────────────── 服务商设置 ─────────────────────────

type AiStatus = Awaited<ReturnType<typeof api.aiStatus>>

/** 下拉框里「自己填」那一项的值。不会跟真模型名撞上 */
const CUSTOM_MODEL = '__custom__'

/**
 * 选服务商、填端点、填 Key、填模型和单价。
 *
 * 没填 Key 时它是引导页的主体，填了之后它待在设置区里 ——
 * 同一套字段，不做两份，省得改一处忘一处。
 *
 * 三件事在界面上必须说清楚：
 *   1. **端点地址要自己填**。「OpenAI 兼容」不等于「OpenAI 官方」，
 *      deepseek、gemini、自己跑的模型，地址都不一样。
 *   2. **单价也要自己填**。各家随时调价，软件写死的数字迟早骗人。
 *   3. **Key 换服务商不丢**，每家各存一份。
 */
export function ProviderSetup({
  status,
  onPatch,
  onSaved,
  onError,
}: {
  status: AiStatus
  onPatch(patch: Partial<AiConfig>): void
  onSaved(): void
  onError(msg: string | null): void
}) {
  const cfg = status.config
  const active = cfg.providers[cfg.provider]
  const [keyInput, setKeyInput] = useState('')
  const [probe, setProbe] = useState<{ ok: boolean; message: string } | null>(null)
  const [probing, setProbing] = useState(false)

  const patchActive = (p: Partial<AiConfig['providers']['openai']>) =>
    onPatch({ providers: { ...cfg.providers, [cfg.provider]: { ...active, ...p } } })

  /**
   * 选预设 = 一次性把地址、模型、单价都填上，之后每一项都还能改。
   * 模型取列表里的第一款 —— **各家都是便宜的排在前面**。
   */
  const applyPreset = (key: string) => {
    const p = status.presets.find((x) => x.key === key)
    if (!p) return
    const m = p.models[0]
    onPatch({
      provider: p.provider,
      providers: {
        ...cfg.providers,
        [p.provider]: {
          ...cfg.providers[p.provider],
          // 「其它」那一项是空的，用来让作者从零填，不该把已填的清掉
          ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
          currency: p.currency,
          offPeakDiscount: p.offPeakDiscount,
          ...(m
            ? { model: m.id, priceIn: m.priceIn, priceCacheIn: m.priceCacheIn, priceOut: m.priceOut }
            : {}),
        },
      },
    })
  }

  /** 换模型时三档单价跟着换 —— 同一家不同款的价钱差好几倍 */
  const applyModel = (id: string) => {
    if (id === CUSTOM_MODEL) {
      patchActive({ model: '' })
      return
    }
    const m = models.find((x) => x.id === id)
    patchActive(
      m
        ? { model: m.id, priceIn: m.priceIn, priceCacheIn: m.priceCacheIn, priceOut: m.priceOut }
        : { model: id },
    )
  }

  /** 当前设置对上了哪个预设。只看端点 —— 同一家换个模型不该跳成「其它」 */
  const currentPreset =
    status.presets.find((p) => p.provider === cfg.provider && p.baseUrl === active.baseUrl)?.key ??
    'custom'

  const models = status.presets.find((p) => p.key === currentPreset)?.models ?? []
  /** 模型不在这一家的列表里（作者手填的），下拉框就停在「自己填」这一项 */
  const modelIsCustom = models.length === 0 || !models.some((m) => m.id === active.model)

  return (
    <>
      {/* 侧边栏只有两百多像素宽，标签和控件必须上下摞，并排会把标签挤成竖排 */}
      <div className="ai-field">
        <label>服务商</label>
        <select
          className="settings-select"
          style={{ width: '100%' }}
          value={currentPreset}
          onChange={(e) => applyPreset(e.target.value)}
        >
          {status.presets.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="ai-field">
        <label>端点地址</label>
        <input
          className="search-input"
          placeholder={status.provider.baseUrlHint}
          value={active.baseUrl}
          onChange={(e) => patchActive({ baseUrl: e.target.value })}
          onBlur={(e) => {
            // 作者多半是整条请求地址复制过来的（.../v1/chat/completions），
            // 直接用会拼成两遍 /chat/completions 然后报 404。失焦时替他收拾干净
            const tidy = e.target.value
              .trim()
              .replace(/[?#].*$/, '')
              .replace(/\/+$/, '')
              .replace(/\/(chat\/)?completions$/i, '')
              .replace(/\/+$/, '')
            if (tidy !== active.baseUrl) patchActive({ baseUrl: tidy })
          }}
        />
        <div className="settings-hint">{status.provider.baseUrlHint}</div>
      </div>

      <div className="ai-field">
        <label>代理</label>
        <input
          className="search-input"
          placeholder="auto = 用系统环境变量；off = 不用；也可以直接填地址"
          value={cfg.proxy}
          onChange={(e) => onPatch({ proxy: e.target.value })}
        />
        <div className="settings-hint">
          {/*
            这一项不是可有可无：Node 自带的 fetch 不认 HTTPS_PROXY 环境变量，
            机器上开着代理也未必走得通，得在这里说清楚现在到底走没走代理。
          */}
          {status.proxyInUse
            ? `现在走代理：${status.proxyInUse}`
            : '现在不走代理。连不上 Google、OpenAI 时，把你本机代理的地址填这里，比如 http://127.0.0.1:10808'}
        </div>
        <button
          className="btn"
          style={{ width: '100%', marginTop: 6 }}
          disabled={probing}
          onClick={() => {
            setProbing(true)
            setProbe(null)
            void api
              .aiTestConnection()
              .then(setProbe)
              .catch((e) => setProbe({ ok: false, message: e instanceof Error ? e.message : String(e) }))
              .finally(() => setProbing(false))
          }}
        >
          {probing ? '正在试……' : '测试连接'}
        </button>
        {probe && (
          <div className={probe.ok ? 'settings-hint probe-ok' : 'search-error'} style={{ marginTop: 6 }}>
            {probe.message}
          </div>
        )}
      </div>

      <div className="ai-field">
        <label>模型</label>
        {models.length > 0 && (
          <select
            className="settings-select"
            style={{ width: '100%' }}
            value={modelIsCustom ? CUSTOM_MODEL : active.model}
            onChange={(e) => applyModel(e.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            <option value={CUSTOM_MODEL}>自己填…</option>
          </select>
        )}
        {/* 列表里没有的模型（新出的、自建的）总得有地方填 */}
        {modelIsCustom && (
          <input
            className="search-input"
            style={{ marginTop: models.length > 0 ? 6 : 0 }}
            placeholder="照着服务商文档填，比如 deepseek-chat"
            value={active.model}
            onChange={(e) => patchActive({ model: e.target.value })}
          />
        )}
      </div>

      <div className="ai-field">
        <label>
          API Key
          {status.keys[cfg.provider] && <span className="ai-key-ok">已填</span>}
        </label>
        <div className="ai-key-row">
          <input
            className="search-input"
            type="password"
            placeholder={status.keys[cfg.provider] ? '要换就填新的' : '从服务商后台复制'}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
          />
          <button
            className="btn btn-primary"
            disabled={!keyInput.trim()}
            onClick={() =>
              void api
                .aiSetKey(cfg.provider, keyInput.trim())
                .then(() => {
                  setKeyInput('')
                  onError(null)
                  onSaved()
                })
                .catch((e) => onError(e instanceof Error ? e.message : String(e)))
            }
          >
            保存
          </button>
        </div>
      </div>

      <div className="ai-field">
        <label>
          单价（每百万 token）
          <select
            className="settings-select ai-cur"
            value={active.currency}
            onChange={(e) => patchActive({ currency: e.target.value as 'USD' | 'CNY' })}
          >
            <option value="CNY">人民币 ¥</option>
            <option value="USD">美元 $</option>
          </select>
        </label>
        <div className="ai-price-row">
          <input
            className="search-input"
            type="number"
            min={0}
            step="0.01"
            value={active.priceIn}
            onChange={(e) => patchActive({ priceIn: Number(e.target.value) || 0 })}
          />
          <span className="faint">输入</span>
        </div>
        <div className="ai-price-row">
          <input
            className="search-input"
            type="number"
            min={0}
            step="0.01"
            value={active.priceCacheIn}
            onChange={(e) => patchActive({ priceCacheIn: Number(e.target.value) || 0 })}
          />
          <span className="faint">输入·命中缓存</span>
        </div>
        <div className="ai-price-row">
          <input
            className="search-input"
            type="number"
            min={0}
            step="0.01"
            value={active.priceOut}
            onChange={(e) => patchActive({ priceOut: Number(e.target.value) || 0 })}
          />
          <span className="faint">输出</span>
        </div>
        <label className="ai-check">
          <input
            type="checkbox"
            checked={active.offPeakDiscount > 0}
            onChange={(e) => patchActive({ offPeakDiscount: e.target.checked ? 0.5 : 0 })}
          />
          空闲时段半价（DeepSeek 这样）
        </label>
        <div className="settings-hint">
          {/*
            命中缓存与未命中的输入价能差三十倍（DeepSeek v4-flash 是 0.10 对 3.00），
            拿一个固定比例去糊会算得离谱，所以分三档填。
          */}
          填的是<b>高峰时段</b>的价。命中缓存和未命中差得很远，所以分开填。
          {active.offPeakDiscount > 0 && (
            <>
              <br />
              高峰为北京时间周一至周五 9:00–12:00、14:00–18:00，其余时段按{' '}
              {Math.round((1 - active.offPeakDiscount) * 100)}% 算，也就是{' '}
              {(active.priceIn * (1 - active.offPeakDiscount)).toFixed(2)} /{' '}
              {(active.priceCacheIn * (1 - active.offPeakDiscount)).toFixed(2)} /{' '}
              {(active.priceOut * (1 - active.offPeakDiscount)).toFixed(2)}。
            </>
          )}
          <br />
          各家随时调价，所以让你自己填 —— 全填 0 就不算钱，只报 token 数。
        </div>
      </div>
    </>
  )
}

// ───────────────────────── 三种结构化输出 ─────────────────────────

/**
 * 续写：三个方向各自一块，各自能单独插入。
 *
 * 之前是一整坨文字只能整段插进去 —— 作者想要第二个方向，
 * 得自己在稿子里把另外两个删掉。
 */
function ContinueOutput({ text, onAdopt }: { text: string; onAdopt(t: string): void }) {
  const items = useMemo(() => parseContinuations(text), [text])

  return (
    <div className="ai-conts">
      {items.map((c, i) => (
        <div key={i} className="ai-cont">
          <div className="ai-cont-head">
            <b>方向{['一', '二', '三', '四', '五'][i] ?? i + 1}</b>
            {c.gist && <span className="faint">{c.gist}</span>}
          </div>
          <pre>{c.text}</pre>
          <div className="ai-cont-actions">
            <button onClick={() => onAdopt(c.text)}>就用这个</button>
            <button onClick={() => void navigator.clipboard.writeText(c.text)}>复制</button>
          </div>
        </div>
      ))}
      {items.length === 1 && !items[0]!.gist && (
        <div className="fs-hint">这次模型没按三个方向的格式回，只能整段用。</div>
      )}
    </div>
  )
}

/**
 * 润色：逐字对比。
 *
 * 作者要看的是「它到底动了我哪几个字」。按行比会把整段标成一删一增，
 * 等于什么都没说 —— 所以这里用 `compareInline` 逐字比。
 */
function PolishOutput({
  raw,
  original,
  onAdopt,
}: {
  raw: string
  original: string
  onAdopt(t: string): void
}) {
  const [view, setView] = useState<'diff' | 'text'>('diff')
  const r = useMemo(() => parsePolish(raw), [raw])
  const segs = useMemo(
    () => (original ? compareInline(original, r.text) : []),
    [original, r.text],
  )
  const n = useMemo(() => countChanges(segs), [segs])

  return (
    <div className="ai-polish">
      <div className="ai-tabs-mini">
        <button className={`tab${view === 'diff' ? ' active' : ''}`} onClick={() => setView('diff')}>
          改了哪儿
        </button>
        <button className={`tab${view === 'text' ? ' active' : ''}`} onClick={() => setView('text')}>
          改后全文
        </button>
        {segs.length > 0 && (
          <span className="faint ai-diff-count">
            改动 +{n.added} / −{n.removed} 字
          </span>
        )}
      </div>

      {view === 'diff' ? (
        segs.length === 0 ? (
          <div className="fs-hint">没有选中原文，没法对比。下面是改后的全文。</div>
        ) : (
          <pre className="ai-diff">
            {segs.map((sg, i) => (
              <span key={i} className={`seg-${sg.kind}`}>
                {sg.text}
              </span>
            ))}
          </pre>
        )
      ) : (
        <pre>{r.text}</pre>
      )}

      <div className="ai-cont-actions">
        <button onClick={() => onAdopt(r.text)}>用改后的</button>
        <button onClick={() => void navigator.clipboard.writeText(r.text)}>复制改后的</button>
      </div>

      {r.notes && (
        <details className="ai-notes" open>
          <summary>改了什么</summary>
          <pre>{r.notes}</pre>
        </details>
      )}
      {!r.structured && (
        <div className="fs-hint">这次模型没按格式回，上面整坨都是它说的，插入前自己看一眼。</div>
      )}
    </div>
  )
}

/**
 * 抓虫：一条条列出来，点「跳过去」在正文里定位。
 *
 * 定位靠模型抄回来的那一小段原文。抄错一个字就跳不过去，
 * 所以提示词里特意要求「一字不差」，界面这边找不到时也要说清楚。
 */
function ProofreadOutput({ text, onLocate }: { text: string; onLocate(quote: string): void }) {
  const bugs = useMemo(() => parseProofread(text), [text])

  if (bugs.length === 0) {
    return (
      <>
        <pre>{text}</pre>
        <div className="fs-hint">没拆成清单 —— 要么它说没问题，要么这次没按格式回。</div>
      </>
    )
  }

  return (
    <div className="ai-bugs">
      <div className="fs-hint">找到 {bugs.length} 处。点「跳过去」在正文里定位。</div>
      {bugs.map((b, i) => (
        <div key={i} className="ai-bug">
          <div className="ai-bug-head">
            <b>{b.title}</b>
            {b.kind && <span className="ai-bug-kind">{b.kind}</span>}
          </div>
          {b.quote && <div className="ai-bug-quote">{b.quote}</div>}
          {b.why && <div className="ai-bug-why">{b.why}</div>}
          {b.quote && (
            <div className="ai-cont-actions">
              <button onClick={() => onLocate(b.quote)}>跳过去</button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
