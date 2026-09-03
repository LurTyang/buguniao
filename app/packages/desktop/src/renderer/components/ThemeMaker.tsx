/**
 * 调色器 —— 自己调一套主题。
 *
 * 规范：更新文档/04-界面与交互设计.md §7.6
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么不接着改进「导入别人的主题」】
 *
 * 那条路走到头了，而且是**结构性**的到头：一份 Typora 主题里一多半规则
 * 打向它自己的界面，我们没有那些东西；还有一整类主题根本不定义纸色，
 * 装上之后纸还是白的 —— 而作者只会看到「怎么没变」。
 *
 * 所以换成：**把变量契约变成一个能点的东西**。
 * 调出来的一定完整、一定生效、一定能导出给别人。
 *
 * 【一列表 + 一编辑区，不是二十几个色块并排】
 *
 * 并排摆下来是一面墙，而且每个色块旁边塞不下「它管什么」那句话。
 * 左边选一项、右边调那一项，是唯一能同时放下**色盘 + 色号 + RGB**
 * 三种输入方式的排法。作者要的就是这三种都能用。
 *
 * 【改一下，眼睛立刻看到】
 *
 * 每次改动都当场注进页面。调颜色这件事没法靠想 ——
 * 「先调完再看效果」等于让人闭着眼睛调二十几次。
 * ─────────────────────────────────────────────────────────────
 */

import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { UserSettings } from '../../shared/api.js'
import {
  DRAFT_GROUPS,
  draftCss,
  fillDraft,
  forWheel,
  hexToRgb,
  normHex,
  rgbToHex,
  seedDraft,
  type DraftField,
  type ThemeDraft,
} from '../../shared/theme-draft.js'
import { declsOf, themeOf, applyThemeCss } from '../themes.js'
import { FONTS, resolveFontStack } from '../fonts.js'
import { api } from '../api.js'

/** 一行 R / G / B 数字框 */
function RgbRow({ hex, onHex }: { hex: string; onHex(v: string): void }): ReactElement {
  const rgb = hexToRgb(hex)
  const set = (k: 'r' | 'g' | 'b', raw: string): void => {
    if (!rgb) return
    onHex(rgbToHex({ ...rgb, [k]: Number(raw) }))
  }
  return (
    <div className="tm-rgb">
      {(['r', 'g', 'b'] as const).map((k) => (
        <label key={k}>
          <span>{k.toUpperCase()}</span>
          <input
            type="number"
            min={0}
            max={255}
            className="settings-num"
            value={rgb ? rgb[k] : ''}
            disabled={!rgb}
            onChange={(e) => set(k, e.target.value)}
          />
        </label>
      ))}
    </div>
  )
}

export function ThemeMaker({
  settings,
  slot,
  onChange,
  onSaved,
  onClose,
}: {
  settings: UserSettings
  /** 在改第几格。-1 = 还没存进栏位的新主题 */
  slot: number
  onChange(patch: Partial<UserSettings>): void
  /** 存好了，落在第几格 */
  onSaved(at: number): void | Promise<void>
  onClose(): void
}): ReactElement {
  /** 起点：当前那个预设。从零调一套没人受得了 */
  const decls = useMemo(() => declsOf(themeOf(settings.theme)), [settings.theme])

  /*
   * 从哪儿开始改，按优先级：
   *   1. 正在改的那一格里存着的（双击一格自制主题进来的）
   *   2. 上次没存完的草稿（关掉再打开要能接着改）
   *   3. 当前那个预设
   *
   * ⚠️ 只在**打开的那一刻**取一次。做成跟着 props 变，
   *    改一个字就会被外面的旧值冲掉。
   */
  const [draft, setDraft] = useState<ThemeDraft>(() => {
    const inSlot = slot >= 0 ? (settings.themeCssSlots?.[slot]?.draft ?? null) : null
    const from = inSlot ?? settings.themeDraft
    return from
      ? fillDraft(from, decls)
      : seedDraft(decls, '我的主题', resolveFontStack(settings.fontFamily))
  })
  const [picked, setPicked] = useState<string>(DRAFT_GROUPS[0]!.fields[0]!.name)
  /** 作者自己导进来的字体 */
  const mine = Object.keys(settings.customFonts ?? {})
  const known = [...FONTS.map((f) => f.stack), ...mine.map((f) => `'${f}', serif`)]
  const [said, setSaid] = useState('')

  const field: DraftField =
    DRAFT_GROUPS.flatMap((g) => g.fields).find((f) => f.name === picked) ??
    DRAFT_GROUPS[0]!.fields[0]!
  const value = draft.vars[field.name] ?? ''

  /*
   * 每次改动都当场注进页面。
   *
   * ⚠️ 这里**不写配置**：写配置会一路触发整棵树重渲染，而拖色盘时
   * 一秒能出几十个值 —— 那会卡到拖不动。存盘是「用这套」按的时候的事。
   */
  useEffect(() => {
    applyThemeCss(draftCss(draft))
  }, [draft])

  /*
   * 收起调色器时，把页面恢复成配置里**真正生效**的那一份。
   *
   * 预览是直接注进页面的，不恢复的话：调了半天没按「用这套」就关掉，
   * 屏幕上还留着那套颜色 —— 而配置里根本没有它，重启就没了。
   * 「看着是这样、其实不是」比调不动更让人摸不着头脑。
   */
  useEffect(() => {
    return () => {
      void api
        .readThemeCss()
        .then((r) => applyThemeCss(r?.css ?? ''))
        .catch(() => {})
    }
  }, [])

  const setVar = (name: string, v: string): void => {
    setDraft((d) => ({ ...d, vars: { ...d.vars, [name]: v } }))
  }

  /**
   * 存进自定义栏位，并立刻用上。
   *
   * 存进**栏位**而不是某个单独的位置，是这一版的关键改动：
   * 自己调的和导进来的占同样的格子，于是可以存好几套、点一下就换 ——
   * 而在那之前，自己调的只有一份，调第二套就把第一套顶掉了。
   */
  const save = async (): Promise<void> => {
    const r = await api.saveThemeToSlot(slot, draft).catch(() => null)
    if (!r) {
      setSaid('自定义主题已经九个了 —— 删掉一个再存。')
      return
    }
    onChange({ themeCssSlots: r.slots, themeCssActive: r.slot, themeDraft: draft })
    setSaid(`存好了，在第 ${r.slot + 1} 格。`)
    await onSaved(r.slot)
  }

  const exportIt = async (): Promise<void> => {
    try {
      const p = await api.exportThemeCss(draft)
      setSaid(p ? `导出到 ${p}` : '')
    } catch (e) {
      setSaid(e instanceof Error ? e.message : String(e))
    }
  }

  /** 回到起点。**只重置颜色，名字和字体留着** —— 那两样重打一遍很烦 */
  const reset = (): void => {
    setDraft((d) => ({ ...seedDraft(decls, d.name, d.font) }))
    setSaid('回到了「' + themeOf(settings.theme).label + '」的配色。')
  }

  return (
    <div className="tm-wrap">
      <div className="tm-head">
        <input
          className="tm-name"
          value={draft.name}
          placeholder="给这套主题起个名"
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
        {/*
          字体也算这套主题的一部分：导出之后别人导入，稿纸的字也跟着变。
          （所以 0.4 把 --font-body 从行内样式挪进了样式表 ——
          行内样式压过一切，主题里写了也没用。见 themes.ts 的 applyFontVar）
        */}
        <select
          className="tm-font"
          value={draft.font}
          onChange={(e) => setDraft((d) => ({ ...d, font: e.target.value }))}
        >
          {FONTS.map((f) => (
            <option key={f.key} value={f.stack} style={{ fontFamily: f.stack }}>
              {f.label}
            </option>
          ))}
          {mine.map((f) => (
            <option key={f} value={`'${f}', serif`} style={{ fontFamily: f }}>
              {f}
            </option>
          ))}
          {/* 现在这个不在上面任何一条里（老配置、或者别处改过）——
              摆出来免得下拉框显示成空的 */}
          {!known.includes(draft.font) && <option value={draft.font}>当前（{draft.font}）</option>}
        </select>
        <button className="btn" onClick={onClose}>
          收起
        </button>
      </div>

      <div className="tm-body">
        <div className="tm-list">
          {DRAFT_GROUPS.map((g) => (
            <div key={g.title} className="tm-group">
              <div className="tm-group-title">{g.title}</div>
              {g.fields.map((f) => {
                const v = draft.vars[f.name] ?? ''
                return (
                  <button
                    key={f.name}
                    className={`tm-row${f.name === picked ? ' on' : ''}`}
                    onClick={() => setPicked(f.name)}
                  >
                    <span
                      className="tm-chip"
                      style={f.kind === 'color' ? { background: v } : undefined}
                    >
                      {f.kind === 'shadow' ? '影' : ''}
                    </span>
                    <span className="tm-row-label">{f.label}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div className="tm-edit">
          <div className="tm-edit-title">{field.label}</div>
          {field.hint && <div className="tm-edit-hint">{field.hint}</div>}
          <div className="tm-edit-var">
            {field.name}
            {field.typora && <span className="tm-tag">Typora 同名</span>}
          </div>

          {field.kind === 'color' ? (
            <>
              <input
                type="color"
                className="tm-wheel"
                value={forWheel(value)}
                onChange={(e) => setVar(field.name, e.target.value)}
              />
              <label className="tm-line">
                <span>色号</span>
                <input
                  className="tm-hex"
                  value={value}
                  spellCheck={false}
                  placeholder="#3db8bf"
                  onChange={(e) => {
                    const raw = e.target.value
                    // 打到一半的（`#3d`）也要能留在框里，所以原样存 ——
                    // 只有拼成完整色号时它才真的变成一个颜色
                    setVar(field.name, normHex(raw) || raw)
                  }}
                />
              </label>
              <RgbRow hex={value} onHex={(v) => setVar(field.name, v)} />
              {!hexToRgb(value) && (
                <div className="tm-edit-hint">
                  这个值不是 #rrggbb，所以 RGB 那三格调不了 —— 色盘和色号照样能用。
                </div>
              )}
            </>
          ) : (
            <label className="tm-line tm-line-wide">
              <span>值</span>
              <input
                className="tm-hex"
                value={value}
                spellCheck={false}
                placeholder="0 1px 3px rgba(0,0,0,.06)"
                onChange={(e) => setVar(field.name, e.target.value)}
              />
            </label>
          )}
        </div>
      </div>

      <div className="tm-foot">
        <button className="btn btn-primary" onClick={() => void save()}>
          {slot >= 0 ? '存回这一格' : '存到自定义栏'}
        </button>
        <button className="btn" onClick={() => void exportIt()}>
          导出 CSS
        </button>
        <button className="btn" onClick={reset}>
          回到起点
        </button>
        {said && <span className="tm-said">{said}</span>}
      </div>
    </div>
  )
}
