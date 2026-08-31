/**
 * 番茄钟的计时状态。
 *
 * 这个文件盯的是作者报的那个 bug：**侧边栏一关一开，番茄钟就归零**。
 * 根因是状态住在面板组件里，而侧边栏收起来时面板整个卸载。
 *
 * 所以这里最要紧的两条断言是：
 *   1. 所有订阅者都退订（＝面板卸载）之后，状态还在、计时还在走
 *   2. 面板关着的时候「到点了」照样发生 —— 会进休息、会计数
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  pomoState,
  pomoTick,
  resetPomoForTest,
  setPomoHooks,
  setPomoOption,
  startPhase,
  stopPomo,
  subscribePomo,
} from './pomodoro-store.js'

const T0 = 1_700_000_000_000

beforeEach(() => resetPomoForTest())

describe('开始与停止', () => {
  it('一开始是没在跑的', () => {
    expect(pomoState()).toMatchObject({ phase: 'idle', endsAt: null, remaining: 0 })
  })

  it('开始专注后按设定的分钟数倒计时', () => {
    setPomoOption({ focusMin: 25 })
    startPhase('focus', T0)
    expect(pomoState()).toMatchObject({ phase: 'focus', endsAt: T0 + 25 * 60_000 })
    expect(pomoState().remaining).toBe(25 * 60_000)
  })

  it('停止就回到未开始', () => {
    startPhase('focus', T0)
    stopPomo()
    expect(pomoState()).toMatchObject({ phase: 'idle', endsAt: null, remaining: 0 })
  })

  it('按时刻算剩余，不按累加 —— 定时器掉帧也准', () => {
    setPomoOption({ focusMin: 10 })
    startPhase('focus', T0)
    // 中间整整丢了 3 分钟的 tick，下一次仍然算得对
    pomoTick(T0 + 3 * 60_000)
    expect(pomoState().remaining).toBe(7 * 60_000)
  })

  it('没在跑的时候 tick 什么都不做', () => {
    pomoTick(T0)
    expect(pomoState().phase).toBe('idle')
  })
})

describe('【关键】面板卸载了也不能停', () => {
  it('所有订阅者退订之后，状态还在', () => {
    setPomoOption({ focusMin: 25 })
    startPhase('focus', T0)

    // 侧边栏收起来 = 面板卸载 = 所有订阅都断掉
    const off = subscribePomo(() => {})
    off()

    expect(pomoState()).toMatchObject({ phase: 'focus' })
    expect(pomoState().endsAt).toBe(T0 + 25 * 60_000)
  })

  it('退订期间走过的时间照样算数', () => {
    setPomoOption({ focusMin: 25 })
    startPhase('focus', T0)
    const off = subscribePomo(() => {})
    off()

    pomoTick(T0 + 5 * 60_000)
    expect(pomoState().remaining).toBe(20 * 60_000)
  })

  it('重新订阅（＝侧边栏又划出来）拿到的是接着走的那份，不是新的', () => {
    setPomoOption({ focusMin: 25 })
    startPhase('focus', T0)
    subscribePomo(() => {})()
    pomoTick(T0 + 60_000)

    let seen: unknown = null
    subscribePomo(() => {
      seen = pomoState()
    })
    pomoTick(T0 + 2 * 60_000)
    expect(seen).toMatchObject({ phase: 'focus', remaining: 23 * 60_000 })
  })
})

describe('【关键】到点了，不管面板开没开着', () => {
  it('专注结束自动进休息，并且计一个数', () => {
    setPomoOption({ focusMin: 25, breakMin: 5 })
    startPhase('focus', T0)
    subscribePomo(() => {})() // 面板已经卸载了

    pomoTick(T0 + 25 * 60_000)
    expect(pomoState().phase).toBe('break')
    expect(pomoState().doneCount).toBe(1)
    expect(pomoState().remaining).toBe(5 * 60_000)
  })

  it('休息结束就回到未开始，不再自动接一个专注', () => {
    // 自动接下一个专注等于逼着人一直干，那是番茄钟最招人烦的做法
    startPhase('break', T0)
    pomoTick(T0 + 5 * 60_000)
    expect(pomoState().phase).toBe('idle')
  })

  it('到点会响一声；关掉提示音就不响', () => {
    const chime = vi.fn()
    setPomoHooks({ chime })
    setPomoOption({ focusMin: 1 })
    startPhase('focus', T0)
    pomoTick(T0 + 60_000)
    expect(chime).toHaveBeenCalledTimes(1)

    setPomoOption({ sound: false })
    startPhase('focus', T0)
    pomoTick(T0 + 60_000)
    expect(chime).toHaveBeenCalledTimes(1)
  })
})

describe('告诉主进程在不在专注', () => {
  it('进专注说一次，停下说一次', () => {
    const onFocusChange = vi.fn()
    setPomoHooks({ onFocusChange })

    startPhase('focus', T0)
    expect(onFocusChange).toHaveBeenLastCalledWith(true)

    stopPomo()
    expect(onFocusChange).toHaveBeenLastCalledWith(false)
    expect(onFocusChange).toHaveBeenCalledTimes(2)
  })

  it('【关键】专注→休息只说一次「不专注了」，不来回抖', () => {
    // 每 tick 都喊一遍的话，主进程那边会被刷屏，
    // 而「这条记录算不算专注时写的」也会跟着抖
    const onFocusChange = vi.fn()
    setPomoHooks({ onFocusChange })
    setPomoOption({ focusMin: 1, breakMin: 5 })

    startPhase('focus', T0)
    pomoTick(T0 + 30_000)
    pomoTick(T0 + 60_000) // 到点，转休息
    pomoTick(T0 + 90_000)

    expect(onFocusChange.mock.calls.map((c) => c[0])).toEqual([true, false])
  })

  it('休息里停下不用再说一遍', () => {
    const onFocusChange = vi.fn()
    setPomoHooks({ onFocusChange })
    startPhase('break', T0)
    stopPomo()
    expect(onFocusChange).not.toHaveBeenCalled()
  })
})

describe('设置', () => {
  it('改分钟数只影响下一次开始', () => {
    setPomoOption({ focusMin: 25 })
    startPhase('focus', T0)
    setPomoOption({ focusMin: 50 })
    expect(pomoState().endsAt).toBe(T0 + 25 * 60_000)

    stopPomo()
    startPhase('focus', T0)
    expect(pomoState().endsAt).toBe(T0 + 50 * 60_000)
  })

  it('状态变了才换引用 —— useSyncExternalStore 靠这个判断要不要重画', () => {
    const before = pomoState()
    pomoTick(T0) // 没在跑，什么都没发生
    expect(pomoState()).toBe(before)

    startPhase('focus', T0)
    expect(pomoState()).not.toBe(before)
  })
})
