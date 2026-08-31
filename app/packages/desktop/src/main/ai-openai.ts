/**
 * OpenAI 兼容端点。**默认就是这一家。**
 *
 * 「OpenAI 兼容」指的是提供 `/v1/chat/completions` 的服务 ——
 * DeepSeek、Gemini、月之暗面、本地跑的 Ollama / vLLM 都算。
 * 所以这里唯一不能写死的就是**端点地址**，它必须由作者填。
 *
 * 各家在细节上并不完全一致，下面这些差异都得兜住：
 *   - 推理内容有的放 `reasoning_content`（DeepSeek），有的压根没有
 *   - 用量统计有的在最后一个 chunk 里，有的要显式开 `stream_options`
 *   - 缓存命中的字段名各家不同，尽量认，认不出就当 0
 */

import OpenAI from 'openai'
import { normalizeBaseUrl, type AiProvider, type ProviderRequest } from './ai-provider.js'

/** 各家放「缓存命中的输入 token」的字段名。认得出就用，认不出算 0 */
function readCacheHit(usage: unknown): number {
  const u = usage as Record<string, unknown> | null | undefined
  if (!u) return 0
  const details = u['prompt_tokens_details'] as Record<string, unknown> | undefined
  const candidates = [
    details?.['cached_tokens'],
    u['prompt_cache_hit_tokens'], // DeepSeek
    u['cached_tokens'],
  ]
  for (const c of candidates) if (typeof c === 'number' && c > 0) return c
  return 0
}

function client(req: Pick<ProviderRequest, 'apiKey' | 'baseUrl' | 'fetchImpl'>): OpenAI {
  const baseURL = normalizeBaseUrl(req.baseUrl)
  if (!baseURL) {
    throw new Error('还没填端点地址。OpenAI 兼容的服务各家地址不同，必须自己填 —— 设置里有几个常见的预设可以直接选。')
  }
  return new OpenAI({
    apiKey: req.apiKey,
    baseURL,
    // 主进程里跑，不是浏览器；这个开关跟安全无关，只是 SDK 的环境判断
    dangerouslyAllowBrowser: false,
    maxRetries: 2,
    // 走代理时换掉 fetch。Node 自带的 fetch 不认 HTTP_PROXY，见 net.ts
    ...(req.fetchImpl ? { fetch: req.fetchImpl } : {}),
  })
}

export const openAiProvider: AiProvider = {
  id: 'openai',
  label: 'OpenAI 兼容端点',
  supportsWebSearch: false,
  defaultBaseUrl: 'https://api.deepseek.com/v1',
  baseUrlHint: '一般以 /v1 结尾，比如 https://api.deepseek.com/v1',

  async run(req) {
    const openai = client(req)

    const stream = await openai.chat.completions.create(
      {
        model: req.model,
        stream: true,
        // 不显式要用量的话，很多兼容端点最后一个 chunk 里是空的
        stream_options: { include_usage: true },
        messages: [
          { role: 'system', content: req.systemStable },
          { role: 'user', content: req.userText },
        ],
      },
      req.signal ? { signal: req.signal } : {},
    )

    let text = ''
    let usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
    let finish: string | null = null

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0]
      const delta = choice?.delta as
        | { content?: string | null; reasoning_content?: string | null }
        | undefined

      // DeepSeek 的 reasoner 把推理过程放在这里，当「思考过程」显示
      if (delta?.reasoning_content && req.onThinking) req.onThinking(delta.reasoning_content)
      if (delta?.content) {
        text += delta.content
        req.onDelta(delta.content)
      }
      if (choice?.finish_reason) finish = choice.finish_reason

      if (chunk.usage) {
        const cached = readCacheHit(chunk.usage)
        usage = {
          // ⚠️ prompt_tokens **含**缓存命中的部分，这里减掉，归一到
          // 「inputTokens 不含缓存」的口径。不减的话缓存命中的 token 会被
          // 按未命中的价再算一遍 —— DeepSeek 这两个价差三十倍
          inputTokens: Math.max(0, (chunk.usage.prompt_tokens ?? 0) - cached),
          outputTokens: chunk.usage.completion_tokens ?? 0,
          cacheReadTokens: cached,
        }
      }
    }

    // 端点没给用量就本地粗估，总比显示 0 强 —— 0 会让人以为这次没花钱
    if (usage.inputTokens === 0 && usage.outputTokens === 0) {
      const { roughTokenCount } = await import('./ai-provider.js')
      usage = {
        inputTokens: roughTokenCount(req.systemStable + req.userText),
        outputTokens: roughTokenCount(text),
        cacheReadTokens: 0,
      }
    }

    const result: ReturnType<AiProvider['run']> extends Promise<infer R> ? R : never = {
      text,
      usage,
      webSearches: 0,
    }
    if (finish === 'content_filter') {
      result.refusal = '服务商的内容策略拦下了这次请求。换个说法，或者换一家试试。'
    }
    if (finish === 'length') {
      result.refusal = '回答被长度上限截断了。可以让它分几次说，或者换个上下文更长的模型。'
    }
    return result
  },

  /** OpenAI 兼容端点没有「数 token」的接口，交给本地粗估 */
  async countTokens() {
    return null
  },
}

/** 把 SDK 的异常翻译成作者看得懂的话 */
export function explainOpenAiError(e: unknown): string | null {
  if (!(e instanceof OpenAI.APIError)) return null
  if (e instanceof OpenAI.AuthenticationError) return 'API Key 不对或已失效，去设置里重新填一个。'
  if (e instanceof OpenAI.PermissionDeniedError) {
    return '这个 Key 没有权限用这个模型。检查一下模型名，或者去服务商后台看看开通了没有。'
  }
  if (e instanceof OpenAI.NotFoundError) {
    return '端点或模型找不到（404）。多半是地址填错了 —— 大部分服务的地址要以 /v1 结尾，模型名也要跟服务商文档一致。'
  }
  if (e instanceof OpenAI.RateLimitError) return '请求太频繁或余额不足，被服务商挡下了。等一会儿再试。'
  if (e instanceof OpenAI.APIConnectionError) return '连不上这个端点。检查一下地址、网络或代理。'
  if (e instanceof OpenAI.BadRequestError) return `服务商说请求有问题：${e.message}`
  return `接口报错（${e.status}）：${e.message}`
}
