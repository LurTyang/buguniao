/**
 * 设置面板。
 *
 * 放在功能侧边栏里，而不是弹窗 —— 改字体、改字号这类设置需要一边改一边
 * 看稿纸的效果，弹窗挡着就没法看了。
 *
 * 所有设置立即生效并写进配置文件（`%APPDATA%/bugu/config.json`），
 * 下次打开还在。「左右侧边栏互换」尤其是 —— 作者反馈说不该每次进来都要重设。
 */

import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { FONTS, fontKeyOf, resolveFontStack } from '../fonts.js'
import { THEMES, applyTheme, applyThemeCss, themeOf } from '../themes.js'
import type { UserSettings } from '../../shared/api.js'

export interface SettingsPanelProps {
  settings: UserSettings
  onChange(patch: Partial<UserSettings>): void
  onChangeRoot(): void
}

export function SettingsPanel({ settings, onChange, onChangeRoot }: SettingsPanelProps) {
  return (
    <div className="settings-panel">
      <Section title="外观">
        <Row label="主题">
          {/*
            五档不是「白天黑夜」两档 —— 写字的人一天里换的是「眼睛累到什么
            程度」：下午刺眼要护眼绿，晚上关灯要真正的黑。作者报过这个。
            用下拉不用分段：五个中文标签横着摆，侧边栏里放不下。
          */}
          <select
            className="settings-select"
            value={settings.theme}
            onChange={(e) => onChange({ theme: e.target.value })}
          >
            {THEMES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </Row>
        <Hint>{themeOf(settings.theme).hint}</Hint>

        <ThemeCssRow settings={settings} onChange={onChange} />

        <Row label="正文字体">
          <select
            className="settings-select"
            value={fontKeyOf(settings.fontFamily) ?? '__custom'}
            onChange={(e) => onChange({ fontFamily: e.target.value })}
          >
            {FONTS.map((f) => (
              // 每一项用它自己的字体显示，不用点开就知道长什么样
              <option key={f.key} value={f.key} style={{ fontFamily: f.stack }}>
                {f.label}
              </option>
            ))}
            {/* 配置里手改过、对不上任何一款时，仍然让它显示出来 */}
            {fontKeyOf(settings.fontFamily) === null && <option value="__custom">自定义</option>}
          </select>
        </Row>

        {/* 一行样张。改完不用回稿纸就能看出换没换 */}
        <div
          className="font-preview"
          style={{ fontFamily: resolveFontStack(settings.fontFamily), fontSize: settings.fontSize }}
        >
          他说：这里我会死吗？——「玉佩」还在。
        </div>
        {FONTS.find((f) => f.key === fontKeyOf(settings.fontFamily))?.note && (
          <Hint>{FONTS.find((f) => f.key === fontKeyOf(settings.fontFamily))!.note}</Hint>
        )}

        <Slider
          label="字号"
          value={settings.fontSize}
          min={13}
          max={28}
          step={1}
          suffix="px"
          onChange={(v) => onChange({ fontSize: v })}
        />
        <Slider
          label="行距"
          value={settings.lineHeight}
          min={1.3}
          max={2.6}
          step={0.1}
          suffix=""
          onChange={(v) => onChange({ lineHeight: Number(v.toFixed(1)) })}
        />
        <Slider
          label="稿纸宽度"
          value={settings.pageWidth}
          min={480}
          max={1200}
          step={20}
          suffix="px"
          onChange={(v) => onChange({ pageWidth: v })}
        />
      </Section>

      <Section title="界面">
        <Row label="左右侧边栏互换">
          <Toggle
            on={settings.sidebarSwapped}
            onChange={(v) => onChange({ sidebarSwapped: v })}
          />
        </Row>
        <Hint>开启后，目录在左、功能面板在右。这个设置会记住，不用每次重设。</Hint>
      </Section>

      <Section title="字数">
        <Row label="统计口径">
          <Segmented
            value={settings.countMode}
            options={[
              { value: 'withPunctuation', label: '含标点' },
              { value: 'withoutPunctuation', label: '不含' },
            ]}
            onChange={(v) => onChange({ countMode: v as UserSettings['countMode'] })}
          />
        </Row>
        <Hint>
          「含标点」与起点等平台的结算口径一致；「不含标点」是你真正敲了多少字。
        </Hint>
      </Section>

      <Section title="存储">
        <Hint>
          作品目录：
          <br />
          <code className="settings-path">{settings.root ?? '（未设置）'}</code>
        </Hint>
        <button className="btn" style={{ width: '100%' }} onClick={onChangeRoot}>
          更换作品目录…
        </button>
        <Hint>
          本机标识 <code>{settings.deviceId}</code>，用于区分多设备写入的历史与统计，
          换目录不会变。
        </Hint>
      </Section>
    </div>
  )
}

/**
 * 自选主题 CSS 那一行。
 *
 * 单独拎出来是因为它需要自己的状态（正在读、读出错了），
 * 而设置面板别的行全是「改一个值就完事」。
 */
function ThemeCssRow({
  settings,
  onChange,
}: {
  settings: UserSettings
  onChange(patch: Partial<UserSettings>): void
}) {
  const [busy, setBusy] = useState(false)
  const [why, setWhy] = useState('')

  const pick = async () => {
    setBusy(true)
    setWhy('')
    try {
      const picked = await api.pickThemeCss()
      if (picked === null) return
      // 存进配置是主进程干的（它顺手验了能不能读），这儿只管把样式装上
      onChange({ themeCss: picked })
      applyThemeCss(await api.readThemeCss())
    } catch (e) {
      setWhy(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const clear = () => {
    onChange({ themeCss: '' })
    applyThemeCss('')
    setWhy('')
  }

  // 只显示文件名，不显示整条路径 —— 一行放不下，而作者要认的是「哪一份」。
  // 反斜杠写成字符码：源码里一个孤零零的反斜杠太容易在下次编辑时被吃掉
  const name = settings.themeCss
    ? ((settings.themeCss.split('/').pop() ?? '').split(String.fromCharCode(92)).pop() ?? '')
    : ''

  return (
    <>
      <Row label="自选样式">
        <div className="ai-key-row">
          <button className="btn" disabled={busy} onClick={() => void pick()}>
            {busy ? '读取中……' : settings.themeCss ? '换一份' : '选一份 CSS'}
          </button>
          {settings.themeCss && (
            <button className="btn" onClick={clear}>
              不用
            </button>
          )}
        </div>
      </Row>
      {name && <Hint>现在用的是 <code>{name}</code>。</Hint>}
      {why && <Hint>{why}</Hint>}
      <Hint>
        {/*
          说清楚「哪些会变、哪些不变」，否则作者装上一个 Typora 主题
          发现侧边栏没变色，会以为没生效
        */}
        <b>Typora 的主题文件可以直接选。</b>
        它们排版正文用的是 <code>#write</code>，稿纸容器也顶着这个 id ——
        字体、字号、行距、标题、引用、代码块这些会跟着变。
        侧边栏和按钮的配色仍然由上面那个主题管，不受它影响。
      </Hint>
    </>
  )
}

/** 把设置应用到 CSS 变量与主题属性上 */
export function applySettings(s: UserSettings): void {
  const root = document.documentElement
  applyTheme(s.theme)
  root.style.setProperty('--font-body', resolveFontStack(s.fontFamily))
  root.style.setProperty('--font-size', `${s.fontSize}px`)
  root.style.setProperty('--line-height', String(s.lineHeight))
  root.style.setProperty('--page-width', `${s.pageWidth}px`)
}

/** 读设置，失败时给一份能用的默认值，不让界面卡在加载态 */
export async function loadSettings(): Promise<UserSettings> {
  try {
    return await api.getSettings()
  } catch {
    return {
      root: null,
      deviceId: '',
      deviceName: '',
      countMode: 'withPunctuation',
      theme: 'light',
      themeCss: '',
      fontFamily: FONTS[0]!.key,
      fontSize: 18,
      lineHeight: 1.9,
      pageWidth: 720,
      sidebarSwapped: false,
      dirBarPinned: false,
      toolBarPinned: false,
      seenGuide: false,
      seenTours: [],
      statsAutoPush: false,
      statsLastPushAt: '',
      dirBarWidth: 250,
      toolBarWidth: 300,
      lastPlace: null,
    }
  }
}

// ───────────────────────── 小部件 ─────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="settings-section">
      <div className="settings-title">{title}</div>
      {children}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <span>{label}</span>
      <div className="settings-control">{children}</div>
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="settings-hint">{children}</div>
}

function Toggle({ on, onChange }: { on: boolean; onChange(v: boolean): void }) {
  return (
    <button
      className={`toggle${on ? ' on' : ''}`}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
    >
      <i />
    </button>
  )
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange(v: string): void
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix: string
  onChange(v: number): void
}) {
  // 拖动时先在本地更新，松手才写配置 —— 否则每动一像素就写一次文件
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])

  return (
    <div className="settings-row settings-slider">
      <span>
        {label}
        <b>
          {local}
          {suffix}
        </b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
        onMouseUp={() => onChange(local)}
        onKeyUp={() => onChange(local)}
      />
    </div>
  )
}
