/**
 * 对外统计：认领短名、推那七个数、看看别人读到什么。
 *
 * 规范：更新文档/08-账号与对外接口.md　服务端在 `server/`，线上 https://bugu.char46.top
 *
 * ─────────────────────────────────────────────────────────────
 * 【这一层的三条规矩】
 *
 * 1. **令牌不出主进程。** 渲染进程拿到的永远是「短名是什么、上次推是什么时候」，
 *    拿不到令牌本身。跟 API Key、跟登录状态一个待遇。
 * 2. **要推什么由 `account-stats.ts` 一处说了算。** 这个文件只负责把它发出去，
 *    绝不自己从 planReport 里多挑一个字段。
 * 3. **没登录就别发。** 拿不到令牌时当场说「重新登录一下」，
 *    而不是发一个注定 401 的请求再把 401 翻译一遍。
 * ─────────────────────────────────────────────────────────────
 *
 * 走 net.ts 的 fetch —— 作者机器上挂着代理，Node 自带的 fetch 不认
 * HTTPS_PROXY，不走这一层就会「明明能上网却连不上」。
 */

import {
  STATS_BASE,
  checkHandle,
  claimHandleRequest,
  forgetMeRequest,
  myProfileRequest,
  parseClaimedHandle,
  parseMyProfile,
  parsePublicProfile,
  publicStatsRequest,
  publicStatsUrl,
  pushStatsRequest,
  type MyProfile,
  type PublicProfile,
  type PublicStats,
} from '@bugu/core'
import { LOGTO, freshAccessToken } from './account-logto.js'
import { makeFetch, resolveProxy } from './net.js'
import { sendStats } from './stats-net.js'

const httpFetch = (proxySetting: string): typeof globalThis.fetch =>
  makeFetch(resolveProxy(proxySetting)) ?? globalThis.fetch

/**
 * 拿一个还能用的访问令牌，拿不到就把话说清楚。
 *
 * 说的是「重新登录一下」而不是「未授权」—— 后者是给程序员看的。
 */
async function tokenOrThrow(proxySetting: string): Promise<string> {
  const t = await freshAccessToken(LOGTO, proxySetting)
  if (!t) throw new Error('还没登录，或者登录已经失效了。到设置 → 账号里重新登录一下。')
  return t
}

/** 我在服务器上是谁、上次推的是什么。没登录时不发请求 */
export async function myProfile(proxySetting: string): Promise<MyProfile> {
  const token = await tokenOrThrow(proxySetting)
  return parseMyProfile(
    await sendStats(myProfileRequest(STATS_BASE), token, httpFetch(proxySetting)),
  )
}

/**
 * 认领短名。
 *
 * **先在本机查一遍规矩再发。** 名字不合规矩的话，一趟网络往返回来说的
 * 也是同一句话 —— 那就别让作者等这一趟。
 */
export async function claimHandle(raw: string, proxySetting: string): Promise<string> {
  const check = checkHandle(raw)
  if (!check.ok) throw new Error(check.why)
  const token = await tokenOrThrow(proxySetting)
  const body = await sendStats(
    claimHandleRequest(STATS_BASE, check.handle),
    token,
    httpFetch(proxySetting),
  )
  return parseClaimedHandle(body, check.handle)
}

/** 把那七个数推上去。返回服务器认下来的短名（可能是空的：还没认领） */
export async function pushNow(stats: PublicStats, proxySetting: string): Promise<string> {
  const token = await tokenOrThrow(proxySetting)
  const body = await sendStats(
    pushStatsRequest(STATS_BASE, stats),
    token,
    httpFetch(proxySetting),
  )
  return parseClaimedHandle(body, '')
}

/**
 * 把我在服务器上的数据整个删掉。
 *
 * 这是「反悔」的出口。做不到彻底删除的公开功能不该上线 ——
 * 作者得知道自己随时能把东西收回来。
 */
export async function forgetMe(proxySetting: string): Promise<void> {
  const token = await tokenOrThrow(proxySetting)
  await sendStats(forgetMeRequest(STATS_BASE), token, httpFetch(proxySetting))
}

/**
 * 别人现在读到的是什么。
 *
 * 走的是**公开接口、不带令牌** —— 跟别的网站走同一条路，
 * 这样作者看到的就是别人真会看到的东西，而不是一个「自己看自己」的特权视图。
 */
export async function readPublic(handle: string, proxySetting: string): Promise<PublicProfile> {
  return parsePublicProfile(
    await sendStats(publicStatsRequest(STATS_BASE, handle), null, httpFetch(proxySetting)),
  )
}

/** 给作者复制出去贴到别处的那个地址 */
export function publicUrlOf(handle: string): string {
  return publicStatsUrl(STATS_BASE, handle)
}

// ───────────────────────── 自动上传 ─────────────────────────

/**
 * 隔多久推一次。
 *
 * 半小时。**不做成秒级实时**：对外接口要回答的是「他最近在写吗」，
 * 不是「他这一分钟写了几个字」—— 后者既没人需要，又意味着作者一边写
 * 一边有东西在往外发，那是另一种感觉。
 */
const EVERY_MS = 30 * 60_000

/** 开机后先等一会儿再推第一次。启动那几秒机器最忙，别去挤它 */
const FIRST_DELAY_MS = 20_000

export interface AutoPushHooks {
  /** 现在开着自动上传吗 */
  enabled(): Promise<boolean>
  /** 这一次要推的七个数 */
  collect(): Promise<PublicStats>
  proxy(): Promise<string>
  /** 推成功了，记一笔（写进 config，界面上要显示「上次上传」） */
  onPushed(at: string): Promise<void>
}

let timer: ReturnType<typeof setInterval> | null = null
let first: ReturnType<typeof setTimeout> | null = null

/** 上一次自动上传出了什么事。界面上顺带说一句，但**不弹窗** */
let lastAutoError = ''

export function autoPushError(): string {
  return lastAutoError
}

async function tick(h: AutoPushHooks): Promise<void> {
  try {
    if (!(await h.enabled())) return
    // 没登录就安静地跳过 —— 自动上传不该把人往登录页上赶
    const proxy = await h.proxy()
    if (!(await freshAccessToken(LOGTO, proxy))) return

    await pushNow(await h.collect(), proxy)
    lastAutoError = ''
    await h.onPushed(new Date().toISOString())
  } catch (e) {
    // 自动上传失败**绝不打断写作**：记下来，作者哪天翻到账号页会看见
    lastAutoError = e instanceof Error ? e.message : String(e)
  }
}

/** 开始按时推。重复调用会先把上一个停掉 */
export function startAutoPush(h: AutoPushHooks): void {
  stopAutoPush()
  first = setTimeout(() => void tick(h), FIRST_DELAY_MS)
  timer = setInterval(() => void tick(h), EVERY_MS)
  // 别因为这两个定时器让进程退不出去
  first.unref?.()
  timer.unref?.()
}

export function stopAutoPush(): void {
  if (first) clearTimeout(first)
  if (timer) clearInterval(timer)
  first = null
  timer = null
}
