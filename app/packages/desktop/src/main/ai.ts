/**
 * AI 助手。
 *
 * 规范：更新文档/05-功能模块详述.md §9
 *
 * ─────────────────────────────────────────────────────────────
 * 【四条硬约束，别放松】
 *
 * 1. **API Key 只在主进程里存在。** 渲染进程永远拿不到它 ——
 *    在渲染进程里建客户端等于把密钥暴露在前端。
 * 2. **Key 用 safeStorage 加密存在应用数据目录**，绝不进同步文件夹。
 * 3. **一切由作者手动触发**，没有任何后台任务。
 * 4. **AI 的输出绝不直接写入正文文件**，只回给界面，由作者决定采纳。
 * ─────────────────────────────────────────────────────────────
 *
 * 这个文件负责跟服务商无关的部分：上下文怎么拼、提示词怎么写、
 * 费用怎么记。真正发请求的代码在 `ai-openai.ts` / `ai-anthropic.ts`。
 *
 * **默认走 OpenAI 兼容端点** —— 作者用 gemini 和 deepseek，
 * 而现在几乎每家都提供 `/v1/chat/completions`。Anthropic 是可选项，
 * 留着是因为只有它带服务端联网搜索。
 */

import { app, safeStorage } from 'electron'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { anthropicProvider, explainAnthropicError } from './ai-anthropic.js'
import { explainOpenAiError, openAiProvider } from './ai-openai.js'
import {
  CURRENCY_SYMBOL,
  PRESETS,
  isOffPeakBeijing,
  normalizeBaseUrl,
  roughTokenCount,
  type AiProvider,
  type Currency,
  type ProviderId,
  type TokenUsage,
} from './ai-provider.js'
import { PROXY_AUTO, makeFetch, probeEndpoint, resolveProxy } from './net.js'

export { CURRENCY_SYMBOL, PRESETS, isOffPeakBeijing, normalizeBaseUrl, roughTokenCount } from './ai-provider.js'
export type { Currency, ProviderId, ProviderPreset } from './ai-provider.js'
export { PROXY_AUTO, PROXY_OFF, resolveProxy } from './net.js'

const PROVIDERS: Record<ProviderId, AiProvider> = {
  openai: openAiProvider,
  anthropic: anthropicProvider,
}

export function providerOf(id: ProviderId): AiProvider {
  return PROVIDERS[id] ?? openAiProvider
}

export type AiTask = 'ask' | 'continue' | 'polish' | 'proofread'

/**
 * 一家服务商的设置。地址、模型、单价都由作者填 —— 各家随时会改。
 *
 * 单价一律是**每百万 token**、**高峰时段**的价。
 * 三档分开是因为缓存命中与未命中的输入价能差三十倍（DeepSeek）。
 * 全填 0 表示「不知道」，那就只统计 token 数，不编金额。
 */
export interface ProviderConfig {
  baseUrl: string
  model: string
  currency: Currency
  /** 输入·缓存未命中 */
  priceIn: number
  /** 输入·缓存命中 */
  priceCacheIn: number
  priceOut: number
  /** 空闲时段折扣（0–1）。DeepSeek 是 0.5，别家一般是 0 */
  offPeakDiscount: number
}

export interface AiConfig {
  enabled: boolean
  /** 用哪一家。默认 openai */
  provider: ProviderId
  providers: Record<ProviderId, ProviderConfig>
  webSearch: boolean
  /**
   * 代理。`auto` = 读 HTTPS_PROXY 等环境变量，`off` = 不用，其它值当地址。
   *
   * 必须有这一项：Node 自带的 fetch **不认环境变量里的代理**，
   * 作者机器上开着代理也连不上 gemini。见 net.ts
   */
  proxy: string
  /** 本月费用上限，币种跟当前服务商走。0 表示不限 */
  monthlyCap: number
  /**
   * 累计用量，按月清零。
   *
   * 金额**按币种分开记** —— 人民币和美元加在一起是个没有意义的数字。
   */
  usage: {
    month: string
    inputTokens: number
    outputTokens: number
    amounts: Record<Currency, number>
  }
}

/**
 * 拿某个预设的**第一款模型**当默认。
 *
 * 每家的模型都是便宜的排在前面 —— 默认给个贵的，
 * 等于替作者做了一个他没同意的花钱决定。
 */
export function fromPreset(key: string): ProviderConfig {
  const p = PRESETS.find((x) => x.key === key)!
  const m = p.models[0]
  return {
    baseUrl: p.baseUrl,
    model: m?.id ?? '',
    currency: p.currency,
    priceIn: m?.priceIn ?? 0,
    priceCacheIn: m?.priceCacheIn ?? 0,
    priceOut: m?.priceOut ?? 0,
    offPeakDiscount: p.offPeakDiscount,
  }
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: false,
  provider: 'openai',
  providers: {
    // 默认预填 DeepSeek 的便宜款 —— 便宜、中文好。换别家也只是改地址和模型名
    openai: fromPreset('deepseek'),
    anthropic: fromPreset('anthropic'),
  },
  webSearch: false,
  proxy: PROXY_AUTO,
  monthlyCap: 50,
  usage: { month: '', inputTokens: 0, outputTokens: 0, amounts: { USD: 0, CNY: 0 } },
}

// ───────────────────────── 密钥 ─────────────────────────

/**
 * 每家服务商各存一个 Key，整体加密成一个文件。
 *
 * 换服务商时不该逼作者重新填 Key —— 换回来还要再填一遍，很烦。
 */
type KeyMap = Partial<Record<ProviderId, string>>

const keyFile = () => path.join(app.getPath('userData'), 'secrets.enc')
const cfgFile = () => path.join(app.getPath('userData'), 'ai.json')

async function readKeys(): Promise<KeyMap> {
  let raw: string
  try {
    raw = safeStorage.decryptString(await fs.readFile(keyFile()))
  } catch {
    return {} // 没存过，或者机器换了解不开 —— 都当作没有
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as KeyMap
  } catch {
    // 旧版本存的是**光秃秃一个 Key 字符串**，那必然是 Anthropic 的。
    // 认下来，别让作者重填。
  }
  return raw.trim() ? { anthropic: raw.trim() } : {}
}

async function writeKeys(keys: KeyMap): Promise<void> {
  await fs.mkdir(path.dirname(keyFile()), { recursive: true })
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('这台机器上拿不到系统加密，为安全起见拒绝明文保存 API Key')
  }
  await fs.writeFile(keyFile(), safeStorage.encryptString(JSON.stringify(keys)))
}

export async function saveApiKey(provider: ProviderId, key: string): Promise<void> {
  await writeKeys({ ...(await readKeys()), [provider]: key })
}

export async function loadApiKey(provider: ProviderId): Promise<string | null> {
  return (await readKeys())[provider] ?? null
}

export async function clearApiKey(provider: ProviderId): Promise<void> {
  const keys = await readKeys()
  delete keys[provider]
  if (Object.keys(keys).length === 0) await fs.rm(keyFile(), { force: true })
  else await writeKeys(keys)
}

/** 哪几家已经填过 Key 了。**只回布尔值，绝不把 Key 本身送出主进程** */
export async function keyStatus(): Promise<Record<ProviderId, boolean>> {
  const keys = await readKeys()
  return { openai: !!keys.openai, anthropic: !!keys.anthropic }
}

// ───────────────────────── 配置 ─────────────────────────

export async function loadAiConfig(): Promise<AiConfig> {
  try {
    return migrateConfig(JSON.parse(await fs.readFile(cfgFile(), 'utf8')) as StoredAiConfig)
  } catch {
    return { ...DEFAULT_AI_CONFIG }
  }
}

/**
 * 老配置迁移。
 *
 * 旧版本只支持 Anthropic，配置里是个顶层 `model`，没有 provider、没有端点。
 * 认出来就归到 anthropic 那一档，并且**把服务商切成 anthropic** ——
 * 作者原来在用的那家，不该因为升级就被悄悄换掉。
 */
/** 配置文件里可能出现的东西：新字段 + 各版本的旧字段 */
export type StoredAiConfig = Omit<Partial<AiConfig>, 'usage'> & {
  /** 旧版：顶层只有一个 Claude 的模型名 */
  model?: string
  /** 旧版：只有美元上限 */
  monthlyCapUsd?: number
  usage?: Partial<AiConfig['usage']> & { usd?: number }
}

export function migrateConfig(parsed: StoredAiConfig): AiConfig {
  const legacyModel = typeof parsed.model === 'string' ? parsed.model : null
  const base: AiConfig = {
    ...DEFAULT_AI_CONFIG,
    ...parsed,
    providers: {
      openai: { ...DEFAULT_AI_CONFIG.providers.openai, ...parsed.providers?.openai },
      anthropic: { ...DEFAULT_AI_CONFIG.providers.anthropic, ...parsed.providers?.anthropic },
    },
    usage: {
      ...DEFAULT_AI_CONFIG.usage,
      ...parsed.usage,
      amounts: { ...DEFAULT_AI_CONFIG.usage.amounts, ...parsed.usage?.amounts },
    },
  }

  // 旧版只有一个美元上限与一个美元累计，搬到新结构里，别让作者的记录归零
  if (typeof parsed.monthlyCapUsd === 'number') base.monthlyCap = parsed.monthlyCapUsd
  if (typeof parsed.usage?.usd === 'number') base.usage.amounts.USD += parsed.usage.usd

  if (legacyModel && !parsed.provider) {
    base.provider = 'anthropic'
    base.providers.anthropic = { ...base.providers.anthropic, model: legacyModel }
  }
  // provider 被人手改坏时退回默认，不让整个功能挂掉
  if (base.provider !== 'openai' && base.provider !== 'anthropic') base.provider = 'openai'
  return base
}

export async function saveAiConfig(cfg: AiConfig): Promise<void> {
  await fs.mkdir(path.dirname(cfgFile()), { recursive: true })
  await fs.writeFile(cfgFile(), JSON.stringify(cfg, null, 2), 'utf8')
}

/** 当前这一家的设置 */
export function activeProviderConfig(cfg: AiConfig): ProviderConfig {
  return cfg.providers[cfg.provider] ?? DEFAULT_AI_CONFIG.providers.openai
}

/**
 * 联网搜索到底开不开得了。
 *
 * 只有 Anthropic 有服务端搜索。换到别家时开关要灰掉**并说明原因** ——
 * 不说原因的话，作者只会觉得这个开关坏了。
 */
export function webSearchAvailability(cfg: AiConfig): { available: boolean; reason: string } {
  if (providerOf(cfg.provider).supportsWebSearch) return { available: true, reason: '' }
  return {
    available: false,
    reason:
      '联网搜索是 Anthropic 的服务端功能，换成 OpenAI 兼容端点就没有了。要用的话把服务商切回 Anthropic。',
  }
}

// ───────────────────────── 上下文组装 ─────────────────────────

export interface AiContext {
  /** 全部设定集的卡片正面（压缩过的） */
  settings: string
  /** 大纲全文 */
  outline: string
  /** 未回收的伏笔清单 */
  foreshadows: string
  /** 当前章节全文 */
  currentChapter: { title: string; body: string }
  /** 前几章（提供上下文） */
  previousChapters: Array<{ title: string; body: string }>
  /** 由问题触发的检索结果 */
  searchHits: Array<{ title: string; snippet: string }>
  bookTitle: string
}

const SYSTEM_PROMPT = `你是这本小说的资料员，帮作者查东西、想事情。

规则：
- 回答基于作者给你的这些资料，别自己编设定。资料里没有的就说没有。
- 中文回答，简洁。作者在写作中途问你，不要长篇大论。
- 被问「这里会怎样」这类问题时，先看正文里主角当下的处境，再给判断。
- 你不是在替作者写小说，是在帮他想清楚。除非他明确要你写。`

/**
 * 稳定前缀：系统提示 + 设定 + 大纲 + 伏笔。
 *
 * 这一段在一次写作会话里基本不变，支持缓存的服务商能按约十分之一计价。
 *
 * ⚠️ 缓存是**前缀匹配**：这里绝不能出现时间戳、随机 id 之类每次都变的东西，
 * 差一个字节，后面全部作废。
 */
export function buildSystemPrompt(ctx: AiContext): string {
  return [
    SYSTEM_PROMPT,
    '',
    `# 作品：${ctx.bookTitle}`,
    '',
    '## 设定集',
    ctx.settings || '（还没有设定）',
    '',
    '## 大纲',
    ctx.outline || '（还没有大纲）',
    '',
    '## 未回收的伏笔',
    ctx.foreshadows || '（没有未回收的伏笔）',
  ].join('\n')
}

/** 每次都会变的那部分：当前章节、前文、检索结果 */
export function buildUserContext(ctx: AiContext): string {
  const parts: string[] = []

  if (ctx.previousChapters.length > 0) {
    parts.push('## 前文')
    for (const c of ctx.previousChapters) parts.push(`### ${c.title}\n${c.body}`)
  }
  parts.push('## 当前章节', `### ${ctx.currentChapter.title}`, ctx.currentChapter.body || '（还没写）')

  if (ctx.searchHits.length > 0) {
    parts.push('## 全文检索到的相关片段')
    for (const h of ctx.searchHits) parts.push(`- 《${h.title}》：${h.snippet}`)
  }
  return parts.join('\n\n')
}

/**
 * 每项任务的提示词。
 *
 * 续写、润色、抓虫都**要求固定格式** —— 界面要把回答拆成能分别采纳的块、
 * 逐字对比、可点击的清单。格式对不上时解析器会退化成整坨显示
 *（见 core/aiparse），所以格式要求写得死一点，但不能死到模型答不了。
 *
 * 下面几段刻意用多行模板字符串直接写，不拼 
 —— 提示词是要读的东西，
 * 拼出来的那种一行长串没人看得懂改不动。
 */
const TASK_PROMPT: Record<AiTask, (input: string) => string> = {
  ask: (q) => `作者的问题：${q}`,

  continue: (sel) =>
    `作者卡在这里了。请基于上面的正文与设定，给出**三个不同方向**的续写。

严格按下面的格式输出，不要有开场白：

### 方向一：（一句话说明这个方向是什么）
（正文，200 字左右，直接就是能接在稿子后面的文字）

### 方向二：（一句话说明）
（正文）

### 方向三：（一句话说明）
（正文）

三个方向要**真的不一样**，不是同一件事换个说法。
正文里不要写「方向一」这类字样，也不要加引号或代码块。` +
    (sel ? `

他选中的这一段是接续的起点：
${sel}` : ''),

  polish: (sel) =>
    `请润色下面这段，保持作者的语感和叙事节奏，不要改写成另一种风格。

严格按下面的格式输出，不要有开场白：

## 润色结果
（润色后的完整文字，**只有正文**，不要任何说明、引号或代码块）

## 改动说明
- （改了什么、为什么）
- （三五条即可）

「润色结果」那一段会被逐字拿去和原文对比，所以**不要重排段落**，
也**不要用省略号代替没改动的部分**，请把完整的文字写全。

原文：
${sel}`,

  proofread: () =>
    `请通读上面的正文，找出：前后矛盾、人设崩坏、时间线错误、设定冲突、伏笔遗漏。

每条严格按下面的格式，不要有开场白：

### （一句话概括这个问题）
- 类型：（前后矛盾 / 人设崩坏 / 时间线错误 / 设定冲突 / 伏笔遗漏）
- 位置：（从正文里原样抄一小段，十几个字即可，用来定位）
- 为什么：（为什么这是个问题）

「位置」必须是正文里**一字不差**的原文，否则作者点了跳不过去。
没发现问题就只回一句「没有发现问题」，不要为了凑数硬找。`,
}

/** 拼出发给模型的用户消息 */
export function buildUserMessage(ctx: AiContext, task: AiTask, input: string): string {
  return [buildUserContext(ctx), '', '---', '', TASK_PROMPT[task](input)].join('\n')
}

// ───────────────────────── 调用 ─────────────────────────

export interface AiRunOptions {
  task: AiTask
  input: string
  ctx: AiContext
  config: AiConfig
  /** 流式片段回调 */
  onDelta(text: string): void
  onThinking?(text: string): void
  signal?: AbortSignal
}

export interface AiRunResult {
  text: string
  usage: TokenUsage & { amount: number; currency: Currency }
  /** 用了几次联网搜索 */
  webSearches: number
  /** 服务端拒绝时的说明 */
  refusal?: string
}

export class AiNotConfiguredError extends Error {
  constructor(providerLabel: string) {
    super(`还没有填 ${providerLabel} 的 API Key。在设置里填好之后才能用 AI 功能。`)
    this.name = 'AiNotConfiguredError'
  }
}

export class AiCapExceededError extends Error {
  constructor(spent: number, cap: number, currency: Currency) {
    const sym = CURRENCY_SYMBOL[currency]
    super(
      `本月 AI 花销已经到 ${sym}${spent.toFixed(2)}，超过你设的上限 ${sym}${cap}。可以在设置里调高或清零。`,
    )
    this.name = 'AiCapExceededError'
  }
}

/** 单价一个都没填时为真 —— 那就别编金额，只报 token 数 */
export function priceUnknown(p: ProviderConfig): boolean {
  return p.priceIn <= 0 && p.priceCacheIn <= 0 && p.priceOut <= 0
}

/**
 * 算这次花了多少钱。
 *
 * 单价是作者自己填的 —— 各家随时调价，写死在代码里迟早骗人。
 * 三档分开算：未命中的输入、命中缓存的输入、输出。
 * DeepSeek 这两档输入价差三十倍，用一个固定比例糊过去会算得离谱。
 *
 * 有空闲折扣的家（DeepSeek 空闲时段半价）按**北京时间**判断时段 ——
 * 作者可能人在别的时区，但服务商的时段是按北京时间定的。
 */
export function priceOf(usage: TokenUsage, p: ProviderConfig, now = new Date()): number {
  if (priceUnknown(p)) return 0
  const mult = p.offPeakDiscount > 0 && isOffPeakBeijing(now) ? 1 - p.offPeakDiscount : 1
  return (
    ((usage.inputTokens / 1e6) * p.priceIn +
      (usage.cacheReadTokens / 1e6) * p.priceCacheIn +
      (usage.outputTokens / 1e6) * p.priceOut) *
    mult
  )
}

export async function runAi(opts: AiRunOptions): Promise<AiRunResult> {
  const cfg = opts.config
  const provider = providerOf(cfg.provider)
  const pc = activeProviderConfig(cfg)

  const key = await loadApiKey(cfg.provider)
  if (!key) throw new AiNotConfiguredError(provider.label)
  if (!pc.model.trim()) {
    throw new Error('还没填模型名。不同服务商的模型名不一样，照着它家文档填一个。')
  }
  const spent = cfg.usage.amounts[pc.currency] ?? 0
  if (cfg.monthlyCap > 0 && spent >= cfg.monthlyCap) {
    throw new AiCapExceededError(spent, cfg.monthlyCap, pc.currency)
  }

  const proxyFetch = makeFetch(resolveProxy(cfg.proxy))
  const r = await provider.run({
    apiKey: key,
    baseUrl: pc.baseUrl,
    ...(proxyFetch ? { fetchImpl: proxyFetch } : {}),
    model: pc.model,
    systemStable: buildSystemPrompt(opts.ctx),
    userText: buildUserMessage(opts.ctx, opts.task, opts.input),
    // 服务商不支持时无条件关掉，不能指望界面一定灰对了
    webSearch: cfg.webSearch && provider.supportsWebSearch,
    onDelta: opts.onDelta,
    ...(opts.onThinking ? { onThinking: opts.onThinking } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  })

  const result: AiRunResult = {
    text: r.text,
    usage: { ...r.usage, amount: priceOf(r.usage, pc), currency: pc.currency },
    webSearches: r.webSearches,
  }
  if (r.refusal) result.refusal = r.refusal
  return result
}

export interface AiEstimate {
  inputTokens: number
  /** 精确还是粗估。界面必须如实说明，别让作者以为这个数很准 */
  exact: boolean
  estimatedAmount: number
  currency: Currency
  /** 单价没填时为 true，界面就别显示金额了 */
  priceUnknown: boolean
  /** 现在是不是空闲时段。只对分时段计价的服务商有意义 */
  offPeak: boolean
}

/** 调用前估算 token 数与花销，界面上显示给作者看 */
export async function estimateTokens(
  ctx: AiContext,
  task: AiTask,
  input: string,
  cfg: AiConfig,
): Promise<AiEstimate> {
  const provider = providerOf(cfg.provider)
  const pc = activeProviderConfig(cfg)
  const systemStable = buildSystemPrompt(ctx)
  const userText = buildUserMessage(ctx, task, input)

  const key = await loadApiKey(cfg.provider)
  if (!key) throw new AiNotConfiguredError(provider.label)

  let inputTokens: number | null = null
  try {
    const f = makeFetch(resolveProxy(cfg.proxy))
    inputTokens = await provider.countTokens({
      apiKey: key,
      baseUrl: pc.baseUrl,
      model: pc.model,
      systemStable,
      userText,
      ...(f ? { fetchImpl: f } : {}),
    })
  } catch {
    // 数 token 失败不该挡住作者提问，退回粗估就行
    inputTokens = null
  }

  const exact = inputTokens !== null
  const tokens = inputTokens ?? roughTokenCount(systemStable + userText)

  return {
    inputTokens: tokens,
    exact,
    // 只估输入那部分 —— 缓存会命中多少、输出会有多长，问之前都不知道
    estimatedAmount: priceOf({ inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0 }, pc),
    currency: pc.currency,
    priceUnknown: priceUnknown(pc),
    offPeak: pc.offPeakDiscount > 0 && isOffPeakBeijing(new Date()),
  }
}

/** 把这次的用量累进配置里；跨月自动清零 */
export function accumulateUsage(cfg: AiConfig, used: AiRunResult['usage'], now = new Date()): AiConfig {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const base =
    cfg.usage.month === month
      ? cfg.usage
      : { month, inputTokens: 0, outputTokens: 0, amounts: { USD: 0, CNY: 0 } }
  return {
    ...cfg,
    usage: {
      month,
      inputTokens: base.inputTokens + used.inputTokens + used.cacheReadTokens,
      outputTokens: base.outputTokens + used.outputTokens,
      // 币种分开记 —— 人民币和美元加在一起是个没有意义的数字
      amounts: {
        ...base.amounts,
        [used.currency]: (base.amounts[used.currency] ?? 0) + used.amount,
      },
    },
  }
}

/** 试连当前服务商的端点。只验网络通不通，不带 Key */
export async function testConnection(cfg: AiConfig) {
  return probeEndpoint(activeProviderConfig(cfg).baseUrl, cfg.proxy)
}

/** 把各家 SDK 的异常翻译成作者看得懂的话 */
export function explainAiError(e: unknown): string {
  if (e instanceof AiNotConfiguredError || e instanceof AiCapExceededError) return e.message
  return (
    explainOpenAiError(e) ?? explainAnthropicError(e) ?? (e instanceof Error ? e.message : String(e))
  )
}
