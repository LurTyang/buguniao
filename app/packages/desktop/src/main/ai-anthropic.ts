/**
 * Anthropic Claude。
 *
 * 留着它的唯一理由：**只有这一家带服务端联网搜索**，
 * 「查一下明代四品官的俸禄」这种事不用自己接搜索 API。
 *
 * 缓存是**前缀匹配**：打了 cache_control 的那一段里绝不能出现时间戳、
 * 随机 id 之类每次都变的东西，前缀差一个字节，后面全部作废。
 */

import Anthropic from '@anthropic-ai/sdk'
import { normalizeBaseUrl, type AiProvider, type ProviderRequest } from './ai-provider.js'

function client(req: Pick<ProviderRequest, 'apiKey' | 'baseUrl' | 'fetchImpl'>): Anthropic {
  const baseURL = normalizeBaseUrl(req.baseUrl)
  return new Anthropic({
    apiKey: req.apiKey,
    ...(baseURL ? { baseURL } : {}),
    // 走代理时换掉 fetch，见 net.ts
    ...(req.fetchImpl ? { fetch: req.fetchImpl } : {}),
  })
}

function systemBlocks(text: string): Anthropic.TextBlockParam[] {
  return [{ type: 'text', text, cache_control: { type: 'ephemeral', ttl: '1h' } }]
}

export const anthropicProvider: AiProvider = {
  id: 'anthropic',
  label: 'Anthropic Claude',
  supportsWebSearch: true,
  defaultBaseUrl: 'https://api.anthropic.com',
  baseUrlHint: '官方就是 https://api.anthropic.com，走代理时才需要改',

  async run(req) {
    const anthropic = client(req)

    // 联网搜索是服务端工具，用最新的变体；它内部已经含代码执行，
    // 不要再单独声明 code_execution，否则模型会被两套执行环境搞混
    const tools = req.webSearch
      ? [{ type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: 5 }]
      : undefined

    let text = ''
    let webSearches = 0

    // 长上下文必须用 stream()，否则容易撞 HTTP 超时
    const stream = anthropic.messages.stream(
      {
        model: req.model,
        max_tokens: 64000,
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: 'high' },
        system: systemBlocks(req.systemStable),
        messages: [{ role: 'user', content: req.userText }],
        ...(tools ? { tools } : {}),
      },
      req.signal ? { signal: req.signal } : {},
    )

    stream.on('text', (delta) => {
      text += delta
      req.onDelta(delta)
    })
    if (req.onThinking) stream.on('thinking', (delta) => req.onThinking?.(delta))

    const message = await stream.finalMessage()

    for (const block of message.content) {
      if (block.type === 'web_search_tool_result') {
        // ⚠️ 搜索出错不会抛异常，而是 HTTP 200 且 content 变成一个错误对象
        //（成功时 content 是数组）。取值前必须先判断类型。
        const c = (block as { content?: unknown }).content
        if (Array.isArray(c)) webSearches += c.length
      }
    }

    const u = message.usage
    const result = {
      text,
      usage: {
        // Anthropic 的 input_tokens 本来就不含缓存命中的部分，口径已经对了
        inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        outputTokens: u.output_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
      },
      webSearches,
    } as Awaited<ReturnType<AiProvider['run']>>

    if (message.stop_reason === 'refusal') {
      result.refusal = message.stop_details?.explanation ?? '模型出于安全策略拒绝了这次请求。'
    }
    return result
  },

  async countTokens(req) {
    const r = await client(req).messages.countTokens({
      model: req.model,
      system: systemBlocks(req.systemStable),
      messages: [{ role: 'user', content: req.userText }],
    })
    return r.input_tokens
  },
}

/** 把 SDK 的异常翻译成作者看得懂的话 */
export function explainAnthropicError(e: unknown): string | null {
  if (!(e instanceof Anthropic.APIError)) return null
  if (e instanceof Anthropic.AuthenticationError) return 'API Key 不对或已失效，去设置里重新填一个。'
  if (e instanceof Anthropic.RateLimitError) return '请求太频繁，被限流了。等一会儿再试。'
  if (e instanceof Anthropic.BadRequestError) return `请求有问题：${e.message}`
  if (e instanceof Anthropic.APIConnectionError) return '连不上服务器。检查一下网络或代理。'
  return `接口报错（${e.status}）：${e.message}`
}
