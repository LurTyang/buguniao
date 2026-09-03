/**
 * 番茄钟面板。
 *
 * 规范：更新文档/05-功能模块详述.md §8.2
 *
 * **桌面端结束时不弹窗。** 写作时任何打断都是干扰，所以只在面板和顶栏
 * 做一次柔和的颜色变化 + 可选提示音。真正的推送提醒是手机端的事。
 *
 * 计时状态不在这个组件里 —— 侧边栏一收起来这个面板就整个卸载，
 * 状态放这儿等于「鼠标挪开一下，计时归零」。见 `../pomodoro-store.ts`。
 * 这里只是那份状态的一个视图。
 */

import { useSyncExternalStore } from 'react'
import { api } from '../api.js'
import {
  pomoState,
  setPomoOption,
  setPomoHooks,
  startPhase,
  stopPomo,
  subscribePomo,
  type PomoState,
} from '../pomodoro-store.js'

// 两件副作用注进去：store 自己不碰 DOM，也不碰 api ——
// 那样它才能在 node 环境里直接测
setPomoHooks({
  chime,
  // 主进程要知道番茄钟在不在跑：跑着时保存的记录会带 pomo 标记
  onFocusChange: (focusing) => void api.setPomodoro(focusing).catch(() => {}),
})

/** 订阅番茄钟。面板和顶栏那个小胶囊都用它 */
export function usePomodoro(): PomoState {
  return useSyncExternalStore(subscribePomo, pomoState)
}

export function PomodoroPanel() {

  const { phase, endsAt, remaining, focusMin, breakMin, doneCount, sound } = usePomodoro()

  const total = (phase === 'break' ? breakMin : focusMin) * 60_000
  const pct = endsAt === null ? 0 : Math.min(100, ((total - remaining) / total) * 100)

  return (
    <div className={`pomo phase-${phase}`}>
      <div className="pomo-clock">{fmtClock(phase === 'idle' ? focusMin * 60_000 : remaining)}</div>
      <div className="pomo-state">
        {phase === 'idle' ? '未开始' : phase === 'focus' ? '专注中' : '休息中'}
        {doneCount > 0 && <span className="faint">　今天完成 {doneCount} 个</span>}
      </div>

      <div className="progress">
        <i style={{ width: `${pct}%` }} />
      </div>

      <div className="pomo-actions">
        {phase === 'idle' ? (
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => startPhase('focus')}>
            开始专注
          </button>
        ) : (
          <>
            <button className="btn" style={{ flex: 1 }} onClick={stopPomo}>
              停止
            </button>
            <button className="btn" onClick={() => startPhase(phase === 'focus' ? 'break' : 'focus')}>
              跳过
            </button>
          </>
        )}
      </div>

      <div className="settings-section" style={{ borderBottom: 'none' }}>
        <Num
          label="专注"
          value={focusMin}
          onChange={(v) => setPomoOption({ focusMin: v })}
          disabled={phase !== 'idle'}
        />
        <Num
          label="休息"
          value={breakMin}
          onChange={(v) => setPomoOption({ breakMin: v })}
          disabled={phase !== 'idle'}
        />
        <div className="settings-row">
          <span>结束时提示音</span>
          <button
            className={`toggle${sound ? ' on' : ''}`}
            onClick={() => setPomoOption({ sound: !sound })}
            role="switch"
            aria-checked={sound}
          >
            <i />
          </button>
        </div>
      </div>

      {/*
        这句话只在**还没用过一次**的时候说。
        它解释的是「时间到了为什么没弹窗」—— 一旦亲眼见过一轮结束，
        这个疑问就自己没了，再挂着就成了常驻的噪音。
      */}
      {doneCount === 0 && phase === 'idle' && (
        <div className="fs-hint">时间到了不弹窗，只做一次柔和的颜色提示。</div>
      )}
    </div>
  )
}

function Num({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: number
  onChange(v: number): void
  disabled: boolean
}) {
  return (
    <div className="settings-row">
      <span>{label}</span>
      <div className="pomo-num">
        <button disabled={disabled || value <= 1} onClick={() => onChange(value - 1)}>
          −
        </button>
        <b>{value}</b>
        <button disabled={disabled || value >= 120} onClick={() => onChange(value + 1)}>
          ＋
        </button>
        <span className="faint">分</span>
      </div>
    </div>
  )
}

function fmtClock(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * 提示音。
 *
 * 用 Web Audio 现合成一个短促的双音，不打包任何音频文件 ——
 * 一个提示音不值得让安装包变大，也不该联网取资源。
 */
function chime(): void {
  try {
    const Ctx = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const now = ctx.currentTime
    for (const [i, freq] of [660, 880].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, now + i * 0.18)
      gain.gain.linearRampToValueAtTime(0.16, now + i * 0.18 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.3)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + i * 0.18)
      osc.stop(now + i * 0.18 + 0.32)
    }
    window.setTimeout(() => void ctx.close(), 1200)
  } catch {
    /* 放不出声不算错 */
  }
}
