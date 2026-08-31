/**
 * AI 层测试。
 *
 * 重点有两块：
 *   1. **老配置迁移** —— 升级之前只支持 Anthropic，配置长得完全不一样。
 *      认错的后果是作者一打开发现服务商被换了、Key 白填了。
 *   2. **OpenAI 兼容端点真的连得上** —— 这里起一个假服务器，
 *      按 SSE 吐字回去。不需要真 Key 就能验流式解析、用量统计、错误翻译。
 *      各家兼容端点的细节差异（推理字段、用量放哪、缓存字段名）也在这测。
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'

// ai.ts 会 import electron 拿加密和路径。测试里只测纯逻辑，给个壳就够
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/bugu-test' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  },
}))

const {
  DEFAULT_AI_CONFIG,
  accumulateUsage,
  fromPreset,
  migrateConfig,
  priceOf,
  providerOf,
  webSearchAvailability,
} = await import('./ai.js')
const { PRESETS, isOffPeakBeijing, normalizeBaseUrl, roughTokenCount } = await import('./ai-provider.js')
const { openAiProvider, explainOpenAiError } = await import('./ai-openai.js')
const { resolveProxy, explainNetworkFailure } = await import('./net.js')

describe('默认配置', () => {
  it('【关键】默认服务商是 OpenAI 兼容端点，不是 Claude', () => {
    expect(DEFAULT_AI_CONFIG.provider).toBe('openai')
  })

  it('默认关着，绝不偷偷跑', () => {
    expect(DEFAULT_AI_CONFIG.enabled).toBe(false)
  })

  it('联网搜索默认关', () => {
    expect(DEFAULT_AI_CONFIG.webSearch).toBe(false)
  })

  it('有费用上限，不是无限', () => {
    expect(DEFAULT_AI_CONFIG.monthlyCap).toBeGreaterThan(0)
  })

  it('默认让代理跟随系统环境变量', () => {
    expect(DEFAULT_AI_CONFIG.proxy).toBe('auto')
  })

  it('两家的端点和模型都预填了，作者不用从零打字', () => {
    for (const p of ['openai', 'anthropic'] as const) {
      expect(DEFAULT_AI_CONFIG.providers[p].baseUrl).toMatch(/^https:\/\//)
      expect(DEFAULT_AI_CONFIG.providers[p].model).toBeTruthy()
    }
  })

  it('【关键】默认模型是便宜的那一款，不是旗舰', () => {
    const ds = PRESETS.find((p) => p.key === 'deepseek')!
    const anth = PRESETS.find((p) => p.key === 'anthropic')!
    expect(DEFAULT_AI_CONFIG.providers.openai.model).toBe(ds.models[0]!.id)
    expect(DEFAULT_AI_CONFIG.providers.anthropic.model).toBe(anth.models[0]!.id)
    // 具体点：默认不该是 opus / pro 这类旗舰
    expect(DEFAULT_AI_CONFIG.providers.anthropic.model).not.toContain('opus')
  })

  it('默认单价跟着默认模型走', () => {
    const ds = PRESETS.find((p) => p.key === 'deepseek')!
    expect(DEFAULT_AI_CONFIG.providers.openai.priceIn).toBe(ds.models[0]!.priceIn)
  })
})

describe('预设', () => {
  it('deepseek 与 gemini 都在，走的是 OpenAI 兼容', () => {
    const byKey = Object.fromEntries(PRESETS.map((p) => [p.key, p]))
    expect(byKey['deepseek']?.provider).toBe('openai')
    expect(byKey['gemini']?.provider).toBe('openai')
  })

  it('留了「自己填地址」这一项', () => {
    expect(PRESETS.some((p) => p.key === 'custom' && p.baseUrl === '')).toBe(true)
  })

  it('【关键】每家的模型都是便宜的排在前面 —— 第一款就是默认值', () => {
    // 默认给个贵的，等于替作者做了一个他没同意的花钱决定
    for (const p of PRESETS) {
      if (p.models.length < 2) continue
      const prices = p.models.map((m) => m.priceIn + m.priceOut)
      expect(prices[0]).toBe(Math.min(...prices))
    }
  })

  it('单价要么全填要么全 0 —— 不能半真半假', () => {
    for (const p of PRESETS) {
      for (const m of p.models) {
        const all = [m.priceIn, m.priceCacheIn, m.priceOut]
        const filled = all.filter((x) => x > 0).length
        expect(filled === 0 || filled === all.length).toBe(true)
      }
    }
  })

  it('【关键】命中缓存的输入价一定低于未命中', () => {
    for (const p of PRESETS) {
      for (const m of p.models) {
        if (m.priceIn > 0) expect(m.priceCacheIn).toBeLessThan(m.priceIn)
      }
    }
  })

  it('【关键】DeepSeek 的三款模型与单价，跟官方价目表逐个对上', () => {
    // 作者 2026-08-25 提供的价目表（高峰价，每百万 token，人民币）：
    //   v4-flash / v4-flash-vision-exp：命中 0.10、未命中 3.00、输出 9.00
    //   v4-pro：                        命中 0.30、未命中 9.00、输出 27.00
    const ds = PRESETS.find((p) => p.key === 'deepseek')!
    expect(ds.models.map((m) => m.id)).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-flash-vision-exp',
      'deepseek-v4-pro',
    ])
    expect(ds.models[0]).toMatchObject({ priceCacheIn: 0.1, priceIn: 3, priceOut: 9 })
    expect(ds.models[1]).toMatchObject({ priceCacheIn: 0.1, priceIn: 3, priceOut: 9 })
    expect(ds.models[2]).toMatchObject({ priceCacheIn: 0.3, priceIn: 9, priceOut: 27 })
  })

  it('【关键】空闲时段算出来正好是价目表上的空闲价', () => {
    // 表上：v4-flash 空闲 0.05 / 1.5 / 4.5
    const ds = PRESETS.find((p) => p.key === 'deepseek')!
    const m = ds.models[0]!
    const half = (x: number) => x * (1 - ds.offPeakDiscount)
    expect(half(m.priceCacheIn)).toBeCloseTo(0.05, 6)
    expect(half(m.priceIn)).toBeCloseTo(1.5, 6)
    expect(half(m.priceOut)).toBeCloseTo(4.5, 6)
  })

  it('智谱那一项在，端点和模型跟作者给的一致', () => {
    const z = PRESETS.find((p) => p.key === 'zhipu')!
    expect(z.baseUrl).toBe('https://api.scnet.cn/api/llm/v1')
    expect(z.models[0]!.id).toBe('GMP-5-Base')
    expect(z.provider).toBe('openai')
  })

  it('DeepSeek 与智谱按人民币算，Gemini 与 OpenAI 按美元', () => {
    const by = Object.fromEntries(PRESETS.map((p) => [p.key, p.currency]))
    expect(by['deepseek']).toBe('CNY')
    expect(by['zhipu']).toBe('CNY')
    expect(by['gemini']).toBe('USD')
    expect(by['openai']).toBe('USD')
  })

  it('只有 DeepSeek 分高峰/空闲', () => {
    expect(PRESETS.filter((p) => p.offPeakDiscount > 0).map((p) => p.key)).toEqual(['deepseek'])
  })

  it('模型 id 在同一家里不重复', () => {
    for (const p of PRESETS) {
      expect(new Set(p.models.map((m) => m.id)).size).toBe(p.models.length)
    }
  })

  it('key 不重复', () => {
    expect(new Set(PRESETS.map((p) => p.key)).size).toBe(PRESETS.length)
  })
})

describe('migrateConfig · 老配置迁移', () => {
  it('【关键】旧配置里的 model 是 Claude 的，服务商要跟着切回 anthropic', () => {
    // 不这么做的话，作者升级后会发现自己在用一个没填 Key 的服务商
    const c = migrateConfig({ model: 'claude-opus-5', enabled: true })
    expect(c.provider).toBe('anthropic')
    expect(c.providers.anthropic.model).toBe('claude-opus-5')
  })

  it('旧配置里的其它字段照留', () => {
    const c = migrateConfig({ model: 'claude-sonnet-5', monthlyCapUsd: 42, webSearch: true })
    expect(c.monthlyCap).toBe(42)
    expect(c.webSearch).toBe(true)
  })

  it('【关键】旧的美元累计搬进新结构，不清零', () => {
    const c = migrateConfig({
      model: 'claude-opus-5',
      usage: { month: '2026-08', inputTokens: 100, outputTokens: 20, usd: 1.5 },
    })
    expect(c.usage.amounts.USD).toBe(1.5)
    expect(c.usage.amounts.CNY).toBe(0)
    expect(c.usage.inputTokens).toBe(100)
  })

  it('新配置原样通过', () => {
    const c = migrateConfig({ provider: 'openai', providers: DEFAULT_AI_CONFIG.providers })
    expect(c.provider).toBe('openai')
  })

  it('旧配置没有 proxy 字段时补上默认值', () => {
    expect(migrateConfig({ model: 'claude-opus-5' }).proxy).toBe('auto')
  })

  it('空配置退回默认', () => {
    expect(migrateConfig({}).provider).toBe('openai')
  })

  it('provider 被手改坏时退回 openai，不让整个功能挂掉', () => {
    expect(migrateConfig({ provider: '乱写的' as never }).provider).toBe('openai')
  })

  it('只填了一半的 providers 也能补齐', () => {
    const c = migrateConfig({ provider: 'openai', providers: { openai: { baseUrl: 'x' } } as never })
    expect(c.providers.openai.baseUrl).toBe('x')
    expect(c.providers.openai.model).toBeTruthy()
    expect(c.providers.anthropic.baseUrl).toBeTruthy()
  })
})

describe('联网搜索能不能用', () => {
  it('OpenAI 兼容端点没有，并且要说明原因', () => {
    const r = webSearchAvailability({ ...DEFAULT_AI_CONFIG, provider: 'openai' })
    expect(r.available).toBe(false)
    expect(r.reason).toContain('Anthropic')
  })

  it('Anthropic 有', () => {
    expect(webSearchAvailability({ ...DEFAULT_AI_CONFIG, provider: 'anthropic' }).available).toBe(true)
  })

  it('provider 对象自己也标了这件事', () => {
    expect(providerOf('openai').supportsWebSearch).toBe(false)
    expect(providerOf('anthropic').supportsWebSearch).toBe(true)
  })
})

describe('priceOf · 花销', () => {
  const p = {
    baseUrl: '',
    model: '',
    currency: 'USD' as const,
    priceIn: 3,
    priceCacheIn: 0.1,
    priceOut: 9,
    offPeakDiscount: 0,
  }
  // 高峰：周一 10:00 北京时间 = 周一 02:00 UTC
  const peak = new Date('2026-08-24T02:00:00Z')
  // 空闲：周一 22:00 北京时间 = 周一 14:00 UTC
  const off = new Date('2026-08-24T14:00:00Z')

  it('三档分开算', () => {
    const usd = priceOf({ inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 1e6 }, p, peak)
    expect(usd).toBeCloseTo(3 + 0.1 + 9, 6)
  })

  it('【关键】命中缓存的部分按命中价算，不是按未命中价打折', () => {
    // 曾经写死「命中价 = 未命中价的十分之一」。DeepSeek 实际是三十分之一，
    // 按十分之一算会把花销高估三倍
    const usd = priceOf({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 1e6 }, p, peak)
    expect(usd).toBeCloseTo(0.1, 6)
  })

  it('不分时段的服务商，什么时候算都一样', () => {
    const a = priceOf({ inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0 }, p, peak)
    const b = priceOf({ inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0 }, p, off)
    expect(a).toBe(b)
  })

  it('【关键】DeepSeek 空闲时段半价', () => {
    const ds = { ...p, offPeakDiscount: 0.5 }
    const dayTime = priceOf({ inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0 }, ds, peak)
    const nightTime = priceOf({ inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0 }, ds, off)
    expect(nightTime).toBeCloseTo(dayTime / 2, 6)
  })

  it('单价没填时返回 0，不编一个数字出来', () => {
    const zero = { ...p, priceIn: 0, priceCacheIn: 0, priceOut: 0 }
    expect(priceOf({ inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 0 }, zero, peak)).toBe(0)
  })
})

describe('isOffPeakBeijing · 按北京时间分时段', () => {
  const at = (iso: string) => isOffPeakBeijing(new Date(iso))

  it('周一上午十点是高峰', () => {
    expect(at('2026-08-24T02:00:00Z')).toBe(false) // 北京 10:00
  })

  it('周一下午三点是高峰', () => {
    expect(at('2026-08-24T07:00:00Z')).toBe(false) // 北京 15:00
  })

  it('中午十二点半是空闲（午休那一段）', () => {
    expect(at('2026-08-24T04:30:00Z')).toBe(true) // 北京 12:30
  })

  it('【关键】深夜是空闲 —— 写手常写到凌晨，这一段便宜一半', () => {
    expect(at('2026-08-24T18:00:00Z')).toBe(true) // 北京次日 02:00
  })

  it('周六全天空闲', () => {
    expect(at('2026-08-22T02:00:00Z')).toBe(true)
  })

  it('周日全天空闲', () => {
    expect(at('2026-08-23T07:00:00Z')).toBe(true)
  })

  it('高峰的边界：9:00 算高峰，12:00 已经不算', () => {
    expect(at('2026-08-24T01:00:00Z')).toBe(false) // 北京 09:00
    expect(at('2026-08-24T04:00:00Z')).toBe(true) // 北京 12:00
  })

  it('本机时区变了也不影响 —— 判的是北京时间', () => {
    // 同一个瞬间，无论用什么本地时区表示，结论必须一致
    expect(at('2026-08-24T02:00:00Z')).toBe(at('2026-08-23T22:00:00-04:00'))
  })
})

describe('normalizeBaseUrl · 作者会直接粘整条地址', () => {
  it('【关键】粘了完整的 chat/completions 也能用', () => {
    // 智谱的文档给的就是这一条。不收拾的话会拼成两遍，报 404，
    // 然后作者盯着一个看起来完全正确的地址查半天
    expect(normalizeBaseUrl('https://api.scnet.cn/api/llm/v1/chat/completions')).toBe(
      'https://api.scnet.cn/api/llm/v1',
    )
  })

  it('只有 completions 结尾也认', () => {
    expect(normalizeBaseUrl('https://x.test/v1/completions')).toBe('https://x.test/v1')
  })

  it('去掉尾部斜杠', () => {
    expect(normalizeBaseUrl('https://api.deepseek.com/v1/')).toBe('https://api.deepseek.com/v1')
  })

  it('去掉复制时带上的查询串', () => {
    expect(normalizeBaseUrl('https://x.test/v1?key=abc')).toBe('https://x.test/v1')
  })

  it('正常地址原样不动', () => {
    expect(normalizeBaseUrl('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/v1')
  })

  it('空串还是空串', () => {
    expect(normalizeBaseUrl('   ')).toBe('')
  })
})

describe('resolveProxy · 代理从哪来', () => {
  it('auto 时读 HTTPS_PROXY', () => {
    expect(resolveProxy('auto', { HTTPS_PROXY: 'http://127.0.0.1:10808' })).toBe('http://127.0.0.1:10808')
  })

  it('auto 时 HTTP_PROXY 也认，小写也认', () => {
    expect(resolveProxy('auto', { http_proxy: 'http://p:1' })).toBe('http://p:1')
  })

  it('HTTPS_PROXY 优先于 HTTP_PROXY', () => {
    expect(resolveProxy('auto', { HTTPS_PROXY: 'https://a', HTTP_PROXY: 'http://b' })).toBe('https://a')
  })

  it('off 就是不走代理，哪怕环境变量里有', () => {
    expect(resolveProxy('off', { HTTPS_PROXY: 'http://p:1' })).toBeNull()
  })

  it('填了地址就用填的', () => {
    expect(resolveProxy('http://127.0.0.1:7890', { HTTPS_PROXY: 'http://p:1' })).toBe('http://127.0.0.1:7890')
  })

  it('环境变量里什么都没有时返回 null', () => {
    expect(resolveProxy('auto', {})).toBeNull()
  })
})

describe('explainNetworkFailure · 报错要说下一步干什么', () => {
  it('【关键】没走代理又超时时，点出「可能要挂代理」', () => {
    const m = explainNetworkFailure('AbortError', null, 'https://generativelanguage.googleapis.com')
    expect(m).toContain('代理')
  })

  it('代理连不上时点出代理软件没开', () => {
    const m = explainNetworkFailure('ECONNREFUSED', 'http://127.0.0.1:10808', 'https://x.test')
    expect(m).toContain('代理软件')
  })

  it('走了代理还超时时，说清楚是代理本身的问题', () => {
    const m = explainNetworkFailure('AbortError', 'http://127.0.0.1:1', 'https://x.test')
    expect(m).toContain('代理本身')
  })

  it('认不出的错误码也带上主机名和代理状态', () => {
    const m = explainNetworkFailure('EHOSTUNREACH', null, 'https://x.test')
    expect(m).toContain('x.test')
    expect(m).toContain('没有走代理')
  })
})

describe('fromPreset · 预设变成配置', () => {
  it('智谱没有公开单价，三档都留 0（界面会说算不出钱）', () => {
    const z = fromPreset('zhipu')
    expect(z.priceIn).toBe(0)
    expect(z.priceCacheIn).toBe(0)
    expect(z.priceOut).toBe(0)
    expect(z.currency).toBe('CNY')
  })

  it('DeepSeek 带上了空闲折扣', () => {
    expect(fromPreset('deepseek').offPeakDiscount).toBe(0.5)
  })
})

describe('accumulateUsage', () => {
  const withUsage = (month: string, amounts: { USD: number; CNY: number }) => ({
    ...DEFAULT_AI_CONFIG,
    usage: { month, inputTokens: 10, outputTokens: 5, amounts },
  })

  it('同月累加', () => {
    const next = accumulateUsage(
      withUsage('2026-08', { USD: 1, CNY: 0 }),
      { inputTokens: 3, outputTokens: 2, cacheReadTokens: 0, amount: 0.5, currency: 'USD' },
      new Date('2026-08-25T10:00:00'),
    )
    expect(next.usage).toMatchObject({ inputTokens: 13, outputTokens: 7 })
    expect(next.usage.amounts.USD).toBeCloseTo(1.5, 6)
  })

  it('【关键】人民币和美元分开记 —— 加在一起是个没意义的数', () => {
    const next = accumulateUsage(
      withUsage('2026-08', { USD: 1, CNY: 0 }),
      { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, amount: 7, currency: 'CNY' },
      new Date('2026-08-25T10:00:00'),
    )
    expect(next.usage.amounts).toEqual({ USD: 1, CNY: 7 })
  })

  it('缓存命中的 token 也算进本月用量', () => {
    const next = accumulateUsage(
      withUsage('2026-08', { USD: 0, CNY: 0 }),
      { inputTokens: 1, outputTokens: 0, cacheReadTokens: 100, amount: 0, currency: 'CNY' },
      new Date('2026-08-25T10:00:00'),
    )
    expect(next.usage.inputTokens).toBe(10 + 1 + 100)
  })

  it('跨月清零', () => {
    const next = accumulateUsage(
      withUsage('2026-07', { USD: 99, CNY: 88 }),
      { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, amount: 0.1, currency: 'USD' },
      new Date('2026-08-01T05:00:00'),
    )
    expect(next.usage.month).toBe('2026-08')
    expect(next.usage.amounts).toEqual({ USD: 0.1, CNY: 0 })
  })
})

describe('roughTokenCount · 本地粗估', () => {
  it('汉字大约一字一 token', () => {
    expect(roughTokenCount('他从四十八楼掉下去')).toBe(9)
  })

  it('拉丁字母约四个字符一 token', () => {
    expect(roughTokenCount('abcdefgh')).toBe(2)
  })

  it('中英混排各算各的', () => {
    expect(roughTokenCount('他说abcd')).toBe(2 + 1)
  })

  it('全角标点算一个', () => {
    expect(roughTokenCount('？！')).toBe(2)
  })

  it('空串是 0', () => {
    expect(roughTokenCount('')).toBe(0)
  })
})

// ───────────────────────── 假服务器：真跑一遍 OpenAI 兼容端点 ─────────────────────────

/** 下一次请求要回什么。每个用例自己设 */
let respond: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void
let lastBody: unknown = null
let server: http.Server
let baseUrl = ''

const sse = (res: http.ServerResponse, chunks: unknown[]) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
}

const chunk = (delta: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: 'x',
  object: 'chat.completion.chunk',
  model: 'fake',
  choices: [{ index: 0, delta, finish_reason: null }],
  ...extra,
})

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (d) => (raw += d))
    req.on('end', () => {
      try {
        lastBody = JSON.parse(raw || '{}')
      } catch {
        lastBody = null
      }
      respond(req, res, raw)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
})

const run = (
  over: Partial<Parameters<typeof openAiProvider.run>[0]> = {},
  onDelta: (t: string) => void = () => {},
) =>
  openAiProvider.run({
    apiKey: 'test-key',
    baseUrl,
    model: 'fake',
    systemStable: '你是资料员',
    userText: '主角现在什么状态？',
    webSearch: false,
    onDelta,
    ...over,
  })

describe('OpenAI 兼容端点 · 对着假服务器真跑一遍', () => {
  it('流式片段拼成完整回答', async () => {
    respond = (_q, res) =>
      sse(res, [chunk({ content: '他正' }), chunk({ content: '从四十八楼' }), chunk({ content: '掉下去。' })])

    const got: string[] = []
    const r = await run({}, (t) => { got.push(t) })
    expect(r.text).toBe('他正从四十八楼掉下去。')
    expect(got).toEqual(['他正', '从四十八楼', '掉下去。'])
  })

  it('系统提示和正文分开发过去', async () => {
    respond = (_q, res) => sse(res, [chunk({ content: '好' })])
    await run()
    const body = lastBody as { messages: Array<{ role: string; content: string }>; model: string }
    expect(body.model).toBe('fake')
    expect(body.messages[0]).toMatchObject({ role: 'system' })
    expect(body.messages[1]).toMatchObject({ role: 'user' })
  })

  it('显式要了用量，否则很多兼容端点最后一个块是空的', async () => {
    respond = (_q, res) => sse(res, [chunk({ content: '好' })])
    await run()
    expect((lastBody as { stream_options?: unknown }).stream_options).toEqual({ include_usage: true })
  })

  it('用量从最后一个块里取', async () => {
    respond = (_q, res) =>
      sse(res, [
        chunk({ content: '好' }),
        { ...chunk({}), usage: { prompt_tokens: 1234, completion_tokens: 56 } },
      ])
    const r = await run()
    expect(r.usage.inputTokens).toBe(1234)
    expect(r.usage.outputTokens).toBe(56)
  })

  it('DeepSeek 的缓存命中字段认得出', async () => {
    respond = (_q, res) =>
      sse(res, [
        chunk({ content: '好' }),
        {
          ...chunk({}),
          usage: { prompt_tokens: 100, completion_tokens: 10, prompt_cache_hit_tokens: 80 },
        },
      ])
    expect((await run()).usage.cacheReadTokens).toBe(80)
  })

  it('OpenAI 的缓存命中字段也认得出', async () => {
    respond = (_q, res) =>
      sse(res, [
        chunk({ content: '好' }),
        {
          ...chunk({}),
          usage: {
            prompt_tokens: 100,
            completion_tokens: 10,
            prompt_tokens_details: { cached_tokens: 64 },
          },
        },
      ])
    expect((await run()).usage.cacheReadTokens).toBe(64)
  })

  it('DeepSeek reasoner 的推理内容走「思考过程」，不混进正文', async () => {
    respond = (_q, res) =>
      sse(res, [chunk({ reasoning_content: '先看主角在哪…' }), chunk({ content: '大概率会死。' })])

    const thinking: string[] = []
    const r = await openAiProvider.run({
      apiKey: 'k',
      baseUrl,
      model: 'fake',
      systemStable: 's',
      userText: 'u',
      webSearch: false,
      onDelta: () => {},
      onThinking: (t) => thinking.push(t),
    })
    expect(r.text).toBe('大概率会死。')
    expect(thinking).toEqual(['先看主角在哪…'])
  })

  it('【关键】端点不给用量时本地粗估，不报 0', async () => {
    // 报 0 会让作者以为这次没花钱
    respond = (_q, res) => sse(res, [chunk({ content: '他正从四十八楼掉下去。' })])
    const r = await run()
    expect(r.usage.inputTokens).toBeGreaterThan(0)
    expect(r.usage.outputTokens).toBeGreaterThan(0)
  })

  it('被内容策略拦下时给出中文说明', async () => {
    respond = (_q, res) =>
      sse(res, [
        { ...chunk({ content: '' }), choices: [{ index: 0, delta: {}, finish_reason: 'content_filter' }] },
      ])
    expect((await run()).refusal).toContain('内容策略')
  })

  it('被长度截断时也说清楚', async () => {
    respond = (_q, res) =>
      sse(res, [
        chunk({ content: '半句话' }),
        { ...chunk({}), choices: [{ index: 0, delta: {}, finish_reason: 'length' }] },
      ])
    expect((await run()).refusal).toContain('截断')
  })

  it('联网搜索这家没有，恒为 0', async () => {
    respond = (_q, res) => sse(res, [chunk({ content: '好' })])
    expect((await run({ webSearch: true })).webSearches).toBe(0)
  })

  it('【关键】没填端点地址时给的是人话，不是 SDK 的报错', async () => {
    await expect(run({ baseUrl: '   ' })).rejects.toThrow('还没填端点地址')
  })

  it('countTokens 返回 null —— 这类端点没有这个接口', async () => {
    expect(
      await openAiProvider.countTokens({
        apiKey: 'k',
        baseUrl,
        model: 'fake',
        systemStable: 's',
        userText: 'u',
      }),
    ).toBeNull()
  })
})

describe('错误翻译', () => {
  it('404 要点出「多半是地址填错了」', async () => {
    respond = (_q, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'not found' } }))
    }
    const e = await run().catch((x: unknown) => x)
    const msg = explainOpenAiError(e)
    expect(msg).toContain('地址')
  })

  it('401 提示去换 Key', async () => {
    respond = (_q, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'bad key' } }))
    }
    const e = await run().catch((x: unknown) => x)
    expect(explainOpenAiError(e)).toContain('API Key')
  })

  it('不是 OpenAI 的异常就交给别人翻译', () => {
    expect(explainOpenAiError(new Error('随便什么'))).toBeNull()
  })
})

describe('代理真的接进去了', () => {
  it('【关键】传了 fetchImpl 时，请求走的是它', async () => {
    // 这条守的是「作者填了代理却没生效」——
    // 上一版就是因为 Node 自带的 fetch 不认 HTTPS_PROXY，gemini 一直连不上
    respond = (_q, res) => sse(res, [chunk({ content: '好' })])

    let used = 0
    const spy: typeof globalThis.fetch = (input, init) => {
      used++
      return fetch(input as never, init as never)
    }

    const r = await openAiProvider.run({
      apiKey: 'k',
      baseUrl,
      model: 'fake',
      systemStable: 's',
      userText: 'u',
      webSearch: false,
      onDelta: () => {},
      fetchImpl: spy,
    })
    expect(r.text).toBe('好')
    expect(used).toBeGreaterThan(0)
  })

  it('没传 fetchImpl 时也照跑，用 SDK 自己的实现', async () => {
    respond = (_q, res) => sse(res, [chunk({ content: '好' })])
    expect((await run()).text).toBe('好')
  })

  it('端点地址粘了完整路径也能跑通', async () => {
    respond = (_q, res) => sse(res, [chunk({ content: '好' })])
    const r = await run({ baseUrl: `${baseUrl}/chat/completions` })
    expect(r.text).toBe('好')
  })
})

describe('中途叫停', () => {
  it('【关键】停下来时，已经流出来的文字不丢', async () => {
    // 那些字是花过钱的。停一下就清空，等于白花
    respond = (_q, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify(chunk({ content: '他正从' }))}\n\n`)
      // 故意不结束，等着被掐
    }

    const ctrl = new AbortController()
    const got: string[] = []
    const p = openAiProvider.run({
      apiKey: 'k',
      baseUrl,
      model: 'fake',
      systemStable: 's',
      userText: 'u',
      webSearch: false,
      onDelta: (t) => {
        got.push(t)
        ctrl.abort()
      },
      signal: ctrl.signal,
    })

    await p.catch(() => {})
    expect(got.join('')).toBe('他正从')
  })
})

describe('DeepSeek 的价目', () => {
  const ds = PRESETS.find((p) => p.key === 'deepseek')!
  const model = (id: string) => ds.models.find((m) => m.id === id)!
  /** 表里存的是**高峰价**，闲时由 offPeakDiscount 折算 */
  const offPeak = (v: number) => v * (1 - ds.offPeakDiscount)

  it('闲时半价，高峰翻倍', () => {
    expect(ds.offPeakDiscount).toBe(0.5)
    expect(ds.currency).toBe('CNY')
  })

  it('flash 的六个数（作者 2026-08-27 核过）', () => {
    const m = model('deepseek-v4-flash')
    // 闲时：命中 0.05 / 未命中 1.5 / 输出 4.5
    expect(offPeak(m.priceCacheIn)).toBeCloseTo(0.05, 6)
    expect(offPeak(m.priceIn)).toBeCloseTo(1.5, 6)
    expect(offPeak(m.priceOut)).toBeCloseTo(4.5, 6)
    // 忙时翻倍
    expect(m.priceCacheIn).toBeCloseTo(0.1, 6)
    expect(m.priceIn).toBeCloseTo(3, 6)
    expect(m.priceOut).toBeCloseTo(9, 6)
  })

  it('pro 的六个数（作者 2026-08-27 核过）', () => {
    const m = model('deepseek-v4-pro')
    expect(offPeak(m.priceCacheIn)).toBeCloseTo(0.15, 6)
    expect(offPeak(m.priceIn)).toBeCloseTo(4.5, 6)
    expect(offPeak(m.priceOut)).toBeCloseTo(13.5, 6)
    expect(m.priceCacheIn).toBeCloseTo(0.3, 6)
    expect(m.priceIn).toBeCloseTo(9, 6)
    expect(m.priceOut).toBeCloseTo(27, 6)
  })

  it('【关键】命中和未命中差三十倍，不能记成一个数', () => {
    // 记成一个数的话，长文续写的预估会差出一个数量级 ——
    // 稳定前缀几乎全命中，正是这个软件最常见的用法
    for (const id of ['deepseek-v4-flash', 'deepseek-v4-pro']) {
      const m = model(id)
      expect(m.priceIn / m.priceCacheIn).toBeCloseTo(30, 3)
    }
  })

  it('默认给便宜那个 —— 贵的要作者自己挑', () => {
    expect(ds.models[0]!.id).toBe('deepseek-v4-flash')
  })
})
