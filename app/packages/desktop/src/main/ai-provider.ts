/**
 * AI 服务商抽象。
 *
 * 规范：更新文档/05-功能模块详述.md §9、06-开发路线图.md「下一件要做的事」
 *
 * 作者常用 gemini 与 deepseek，所以**默认走 OpenAI 兼容端点** ——
 * 现在几乎每家都提供一个 `/v1/chat/completions`，填个地址和 Key 就能用。
 * Anthropic 留着，因为只有它带服务端联网搜索。
 *
 * 这一层只负责「把拼好的提示词发出去、把回来的字流回来」。
 * 上下文怎么拼、费用怎么记，都在 ai.ts 里，跟服务商无关。
 */

export type ProviderId = 'openai' | 'anthropic'

export interface ProviderRequest {
  apiKey: string
  /** 端点地址。OpenAI 兼容端点各家不同，必须由作者填 */
  baseUrl: string
  model: string
  /** 稳定前缀（系统提示 + 设定 + 大纲 + 伏笔），能缓存的就是这一段 */
  systemStable: string
  /** 每次都变的那部分 */
  userText: string
  webSearch: boolean
  onDelta(text: string): void
  onThinking?(text: string): void
  /** 中止信号，作者点「停」时用 */
  signal?: AbortSignal
  /** 走代理时传进来。不传就用 SDK 自己的默认实现 */
  fetchImpl?: typeof globalThis.fetch
}

/**
 * 用量。
 *
 * ⚠️ **`inputTokens` 不含缓存命中的那部分**，两者互不重叠。
 * 各家原始字段的口径不一样（OpenAI 兼容端点的 `prompt_tokens` 是含缓存的，
 * Anthropic 的 `input_tokens` 不含），在各自的 provider 里就归一到这个口径 ——
 * 不然缓存命中的 token 会被按未命中的价算，而这两个价能差三十倍。
 */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

export interface ProviderResult {
  text: string
  usage: TokenUsage
  /** 用了几次联网搜索。不支持的服务商恒为 0 */
  webSearches: number
  /** 服务端拒绝时的说明 */
  refusal?: string
}

export interface AiProvider {
  id: ProviderId
  label: string
  /** 只有 Anthropic 有服务端联网搜索。别家要联网得自己接搜索 API，一期不做 */
  supportsWebSearch: boolean
  /** 默认端点。作者可以改 —— 换服务商本质上就是换这个地址 */
  defaultBaseUrl: string
  /** 端点填错时最常见的样子，用来给提示 */
  baseUrlHint: string
  run(req: ProviderRequest): Promise<ProviderResult>
  /**
   * 精确数 token。只有 Anthropic 提供这个接口；
   * 返回 null 表示「这家没有」，界面改用本地粗估并如实标明。
   */
  countTokens(req: Omit<ProviderRequest, 'onDelta' | 'webSearch'>): Promise<number | null>
}

/** 计价用的货币。DeepSeek 按人民币报价，别家按美元 */
export type Currency = 'USD' | 'CNY'

export const CURRENCY_SYMBOL: Record<Currency, string> = { USD: '$', CNY: '¥' }

/**
 * 一款模型的价钱。
 *
 * 三档分开写，是因为**缓存命中和未命中的输入价能差三十倍**
 * （DeepSeek v4-flash：命中 0.10 元 / 未命中 3.00 元每百万 token）。
 * 用「命中价 = 未命中价的十分之一」这种拍脑袋的比例去算，会算得离谱。
 *
 * 记的是**高峰时段**的价；有空闲折扣的家在 `offPeakDiscount` 里写。
 */
export interface PresetModel {
  id: string
  label: string
  /** 输入·缓存未命中 */
  priceIn: number
  /** 输入·缓存命中 */
  priceCacheIn: number
  priceOut: number
}

export interface ProviderPreset {
  key: string
  label: string
  provider: ProviderId
  baseUrl: string
  currency: Currency
  /**
   * 空闲时段折扣（0–1）。0 表示这家不分时段。
   *
   * DeepSeek 是 0.5：空闲时段价格为高峰时段的一半。
   * 高峰 = 北京时间周一至周五 9:00–12:00、14:00–18:00，其余都是空闲。
   */
  offPeakDiscount: number
  /** **便宜的排在前面，第一款就是默认值** */
  models: PresetModel[]
}

export const PRESETS: ProviderPreset[] = [
  {
    key: 'deepseek',
    label: 'DeepSeek',
    provider: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    currency: 'CNY',
    offPeakDiscount: 0.5,
    // 价格来自作者 2026-08-25 提供的 DeepSeek 官方价目表，记的是**高峰**价；
    // 空闲时段是高峰的一半，由 offPeakDiscount 算，不再单独记一份
    models: [
      { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash', priceIn: 3, priceCacheIn: 0.1, priceOut: 9 },
      {
        id: 'deepseek-v4-flash-vision-exp',
        label: 'deepseek-v4-flash-vision-exp',
        priceIn: 3,
        priceCacheIn: 0.1,
        priceOut: 9,
      },
      { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro', priceIn: 9, priceCacheIn: 0.3, priceOut: 27 },
    ],
  },
  {
    key: 'gemini',
    label: 'Gemini',
    provider: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    currency: 'USD',
    offPeakDiscount: 0,
    models: [
      { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash', priceIn: 0.3, priceCacheIn: 0.075, priceOut: 2.5 },
      { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro', priceIn: 1.25, priceCacheIn: 0.31, priceOut: 10 },
    ],
  },
  {
    key: 'openai',
    label: 'OpenAI',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    currency: 'USD',
    offPeakDiscount: 0,
    models: [
      { id: 'gpt-5-mini', label: 'gpt-5-mini', priceIn: 0.25, priceCacheIn: 0.025, priceOut: 2 },
      { id: 'gpt-5', label: 'gpt-5', priceIn: 1.25, priceCacheIn: 0.125, priceOut: 10 },
    ],
  },
  {
    key: 'zhipu',
    label: '智谱 GLM（超算互联网）',
    provider: 'openai',
    baseUrl: 'https://api.scnet.cn/api/llm/v1',
    currency: 'CNY',
    offPeakDiscount: 0,
    // 这家的单价我没有可靠来源，留 0 —— 界面会说「算不出钱，只报 token 数」。
    // 编一个价出来比不报更糟，作者知道价钱后自己填上就行
    models: [{ id: 'GMP-5-Base', label: 'GMP-5-Base', priceIn: 0, priceCacheIn: 0, priceOut: 0 }],
  },
  {
    key: 'custom',
    label: '其它（自己填地址）',
    provider: 'openai',
    baseUrl: '',
    currency: 'USD',
    offPeakDiscount: 0,
    models: [],
  },
  {
    key: 'anthropic',
    label: 'Anthropic Claude',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    currency: 'USD',
    offPeakDiscount: 0,
    models: [
      { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5', priceIn: 1, priceCacheIn: 0.1, priceOut: 5 },
      { id: 'claude-sonnet-5', label: 'claude-sonnet-5', priceIn: 3, priceCacheIn: 0.3, priceOut: 15 },
      { id: 'claude-opus-5', label: 'claude-opus-5', priceIn: 5, priceCacheIn: 0.5, priceOut: 25 },
    ],
  },
]

/**
 * 现在是不是空闲时段（按北京时间）。
 *
 * DeepSeek 的规则：高峰 = 周一至周五 9:00–12:00 与 14:00–18:00，其余全是空闲。
 * 空闲时段价格是高峰的一半 —— 半夜码字比白天便宜一倍，这个差别值得算准。
 *
 * 不用本机时区：作者可能在别的时区，但 DeepSeek 的时段是按北京时间定的。
 */
export function isOffPeakBeijing(now: Date): boolean {
  // UTC+8。取 UTC 毫秒数加八小时，再读 UTC 字段，绕开本机时区
  const bj = new Date(now.getTime() + 8 * 3600_000)
  const day = bj.getUTCDay() // 0=周日
  if (day === 0 || day === 6) return true

  const minutes = bj.getUTCHours() * 60 + bj.getUTCMinutes()
  const inPeak =
    (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60)
  return !inPeak
}

/**
 * 把作者填的地址收拾成 SDK 要的 base URL。
 *
 * 作者多半是直接从服务商文档里复制整条请求地址过来的，
 * 比如 `https://api.scnet.cn/api/llm/v1/chat/completions` ——
 * 而 SDK 要的是**不带 `/chat/completions` 的那一截**，
 * 否则拼出来会变成 `.../chat/completions/chat/completions`，
 * 报一个 404，然后作者盯着一个看起来完全正确的地址查半天。
 */
export function normalizeBaseUrl(raw: string): string {
  let u = raw.trim().replace(/\s+/g, '')
  u = u.replace(/[?#].*$/, '') // 顺手去掉复制时带上的查询串
  u = u.replace(/\/+$/, '')
  // 各家文档里最常见的几种尾巴
  u = u.replace(/\/(chat\/)?completions$/i, '')
  u = u.replace(/\/+$/, '')
  return u
}

/**
 * 本地粗估 token 数。
 *
 * OpenAI 兼容端点没有「数 token」这个接口，各家分词器也不一样，
 * 所以这里只可能是**粗估**，界面上必须如实说明是估的。
 *
 * 经验值：中日韩文字约 1 字 1 token；拉丁字母约 4 个字符 1 token。
 * 宁可估多不估少 —— 让作者以为便宜，比让他以为贵更糟。
 */
export function roughTokenCount(text: string): number {
  let cjk = 0
  let other = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    // CJK 统一表意文字、扩展 A、假名、全角标点
    if ((c >= 0x3000 && c <= 0x30ff) || (c >= 0x3400 && c <= 0x4dbf) ||
        (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) ||
        (c >= 0xff00 && c <= 0xffef)) cjk++
    else other++
  }
  return cjk + Math.ceil(other / 4)
}
