/**
 * 番茄钟的状态，活在 React 组件外面。
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么必须在组件外面 —— 作者报的那个 bug】
 *
 * 侧边栏是**划出来的**：鼠标一离开边缘它就收起来，而收起来时
 * `Sidebar` 直接 `return null` —— 整个面板连同它的 state 一起卸载。
 *
 * 状态放在组件里，表现出来就是「番茄钟开着，鼠标挪开一下，
 * 回来发现归零了」。
 *
 * 而且不止归零：面板关着的时候「到点了」那段逻辑也不跑 ——
 * 专注结束不会自动进休息、不会响、不会计数。等于番茄钟只在
 * 你盯着它看的时候才走，那还要它干什么。
 *
 * 所以状态和那个 interval 一起挪到模块级，面板只是它的一个视图。
 * ─────────────────────────────────────────────────────────────
 *
 * 这个文件**刻意不 import 任何东西**（不碰 `api`、不碰 React），
 * 这样它能在 node 环境里直接测 —— 计时逻辑正是最该测的部分。
 * 要跟主进程说话、要响一声，由外面注入。
 */

export type PomoPhase = 'idle' | 'focus' | 'break'

export const DEFAULT_FOCUS_MIN = 25
export const DEFAULT_BREAK_MIN = 5

export interface PomoState {
  phase: PomoPhase
  /** 结束时刻（毫秒）。null = 没在跑 */
  endsAt: number | null
  remaining: number
  focusMin: number
  breakMin: number
  doneCount: number
  sound: boolean
}

const INITIAL: PomoState = {
  phase: 'idle',
  endsAt: null,
  remaining: 0,
  focusMin: DEFAULT_FOCUS_MIN,
  breakMin: DEFAULT_BREAK_MIN,
  doneCount: 0,
  sound: true,
}

let state: PomoState = INITIAL
const subs = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

/** 外面注入的两件副作用：响一声、告诉主进程在不在专注 */
export interface PomoHooks {
  chime(): void
  onFocusChange(focusing: boolean): void
}

let hooks: PomoHooks = { chime: () => {}, onFocusChange: () => {} }

export function setPomoHooks(h: Partial<PomoHooks>): void {
  hooks = { ...hooks, ...h }
}

/** 快照。引用只在真的变了的时候才换 —— useSyncExternalStore 靠这个判断 */
export function pomoState(): PomoState {
  return state
}

export function subscribePomo(f: () => void): () => void {
  subs.add(f)
  return () => {
    subs.delete(f)
  }
}

function emit(): void {
  // 拷一份再遍历：回调里可能会取消订阅
  for (const f of [...subs]) f()
}

function patch(p: Partial<PomoState>): void {
  state = { ...state, ...p }
  emit()
}

/**
 * 走一格。
 *
 * 用「结束时刻」而不是「剩余秒数」倒计时：定时器被系统挂起或掉帧时，
 * 按时刻算仍然准确。
 */
export function pomoTick(now = Date.now()): void {
  if (state.endsAt === null) return
  const remaining = Math.max(0, state.endsAt - now)
  if (remaining > 0) {
    patch({ remaining })
    return
  }

  // 到点了。这一段现在**不管面板开没开着**都会跑
  if (state.sound) hooks.chime()
  if (state.phase === 'focus') {
    state = { ...state, doneCount: state.doneCount + 1 }
    startPhase('break', now)
  } else {
    stopPomo()
  }
}

function ensureTimer(): void {
  if (timer !== undefined || state.endsAt === null) return
  timer = setInterval(() => pomoTick(), 250)
}

function killTimer(): void {
  if (timer === undefined) return
  clearInterval(timer)
  timer = undefined
}

export function startPhase(next: Exclude<PomoPhase, 'idle'>, now = Date.now()): void {
  const ms = (next === 'focus' ? state.focusMin : state.breakMin) * 60_000
  const wasFocusing = state.phase === 'focus'
  state = { ...state, phase: next, endsAt: now + ms, remaining: ms }
  emit()
  ensureTimer()
  if (wasFocusing !== (next === 'focus')) hooks.onFocusChange(next === 'focus')
}

export function stopPomo(): void {
  const wasFocusing = state.phase === 'focus'
  killTimer()
  state = { ...state, phase: 'idle', endsAt: null, remaining: 0 }
  emit()
  if (wasFocusing) hooks.onFocusChange(false)
}

export function setPomoOption(p: { focusMin?: number; breakMin?: number; sound?: boolean }): void {
  patch(p)
}

/** 只给测试用：把状态和定时器都清回出厂 */
export function resetPomoForTest(): void {
  killTimer()
  state = INITIAL
  subs.clear()
  hooks = { chime: () => {}, onFocusChange: () => {} }
}
