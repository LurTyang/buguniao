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
import { ThemeMaker } from './ThemeMaker.js'
import { PromptModal } from './Modal.js'
import {
  FONTS,
  applyCustomFont,
  customFamilyOf,
  customValueOf,
  fontKeyOf,
  resolveFontStack,
} from '../fonts.js'
import {
  THEMES,
  applyFontVar,
  applyTheme,
  applyThemeCss,
  themeOf,
  whatTookEffect,
} from '../themes.js'
import { SEED_RULES, shownAs } from '../smart-replace.js'
import { clampToStep, parseNumberLoose } from '../num-field.js'
import type { SmartRule, UserSettings } from '../../shared/api.js'
import { canAdd, isEmptySlot, normalizeSlots } from '../../shared/theme-slots.js'

export interface SettingsPanelProps {
  settings: UserSettings
  onChange(patch: Partial<UserSettings>): void
  onChangeRoot(): void
}

/**
 * 正文字体 —— 内置三款 + 自己导进来的。
 *
 * 内置只有楷宋黑三款，是有意的：一款中文字库十几 MB，内置多了包就吹起来了，
 * 而且能自由分发的中文字体很少。**要别的就自己导** —— 用的是他自己机器上
 * 那个文件，我们不分发、不掺和版权。
 */
function FontRow({
  settings,
  onChange,
}: {
  settings: UserSettings
  onChange(patch: Partial<UserSettings>): void
}) {
  const [busy, setBusy] = useState(false)
  const [why, setWhy] = useState('')
  const mine = Object.keys(settings.customFonts ?? {})
  const cur = customFamilyOf(settings.fontFamily)

  const add = async () => {
    setBusy(true)
    setWhy('')
    try {
      const r = await api.pickFont()
      if (!r) return
      // 导完直接用上 —— 他刚挑了一个字体，想看的就是它长什么样
      onChange({ customFonts: r.fonts, fontFamily: customValueOf(r.family) })
      applyCustomFont(r.family, await api.fontData(r.family))
    } catch (e) {
      // 「导入失败」等于没说。是文件太大、格式不对，还是别的，要说清楚
      setWhy(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const drop = async (family: string) => {
    if (!confirm(`不要「${family}」了？导进来的那份文件也会删掉。`)) return
    try {
      const fonts = await api.removeFont(family)
      const patch: Partial<UserSettings> = { customFonts: fonts }
      // 删的正是在用的那款：退回楷体，别让稿纸变成一片方框
      if (cur === family) patch.fontFamily = 'kai'
      onChange(patch)
      if (cur === family) applyCustomFont('', '')
    } catch (e) {
      setWhy(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <Row label="正文字体">
        <select
          className="settings-select"
          value={cur ? customValueOf(cur) : (fontKeyOf(settings.fontFamily) ?? '__custom')}
          onChange={(e) => {
            const v = e.target.value
            onChange({ fontFamily: v })
            const fam = customFamilyOf(v)
            if (fam) void api.fontData(fam).then((d) => applyCustomFont(fam, d))
            else applyCustomFont('', '')
          }}
        >
          {FONTS.map((f) => (
            // 每一项用它自己的字体显示，不用点开就知道长什么样
            <option key={f.key} value={f.key} style={{ fontFamily: f.stack }}>
              {f.label}
            </option>
          ))}
          {mine.map((f) => (
            <option key={f} value={customValueOf(f)} style={{ fontFamily: f }}>
              {f}
            </option>
          ))}
          {/* 配置里手改过、对不上任何一款时，仍然让它显示出来 */}
          {!cur && fontKeyOf(settings.fontFamily) === null && (
            <option value="__custom">自定义</option>
          )}
        </select>
      </Row>

      <Row label="导入字体">
        <div className="ai-key-row">
          <button className="btn" disabled={busy} onClick={() => void add()}>
            {busy ? '读取中……' : '选一个字体文件'}
          </button>
          {cur && (
            <button className="btn" onClick={() => void drop(cur)}>
              删掉「{cur}」
            </button>
          )}
        </div>
      </Row>
      <Hint>支持 .ttf / .otf / .woff2 等字体文件。</Hint>
      {why && (
        <Hint>
          <span className="account-warn">{why}</span>
        </Hint>
      )}
    </>
  )
}

/**
 * 智能替换 —— 侧边栏里只留一个按钮，规则表在弹窗里改。
 *
 * 作者原话：「符号替换界面不应该做成当前的选项，而是一个按钮，
 * 打开之后会弹出窗口，以表格形式设置什么会变成什么。」
 *
 * 六条规则平铺在侧边栏里，把「字号」「主题」这些每天都要动的东西
 * 挤到了看不见的地方。而替换规则是**配一次就不动**的，不该常驻。
 */
function SmartReplaceSection({
  settings,
  onChange,
}: {
  settings: UserSettings
  onChange(patch: Partial<UserSettings>): void
}) {
  const [open, setOpen] = useState(false)
  // null = 还没初始化过，用出厂那几条
  const rules = settings.smartRules ?? (SEED_RULES as SmartRule[])

  return (
    <Section title="智能替换">
      <Row label="标点替换">
        <div className="ai-key-row">
          <Toggle on={settings.smartReplace} onChange={(v) => onChange({ smartReplace: v })} />
          <button className="btn" disabled={!settings.smartReplace} onClick={() => setOpen(true)}>
            改规则（{rules.length} 条）
          </button>
        </div>
      </Row>
      {open && (
        <RuleDialog
          rules={rules}
          onSave={(next) => onChange({ smartRules: next })}
          onClose={() => setOpen(false)}
        />
      )}
    </Section>
  )
}

/**
 * 规则表：打什么 → 变成什么。
 *
 * **每一条都能改、能删，没有开关。** 作者定的：
 * 「所有规则存在即生效，不存在即删除。」
 * 出厂那几条也一样 —— 它们没有特殊地位。
 */
function RuleDialog({
  rules,
  onSave,
  onClose,
}: {
  rules: readonly SmartRule[]
  onSave(next: SmartRule[]): void
  onClose(): void
}) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  /** 正在改哪一条。null = 没在改 */
  const [editing, setEditing] = useState<string | null>(null)
  const [editFrom, setEditFrom] = useState('')
  const [editTo, setEditTo] = useState('')

  const add = () => {
    if (!from || !to) return
    onSave([...rules, { id: `r${Date.now()}`, kind: 'plain', from, to }])
    setFrom('')
    setTo('')
  }

  const beginEdit = (r: SmartRule) => {
    setEditing(r.id)
    setEditFrom(r.from)
    setEditTo(shownAs(r))
  }

  const commitEdit = () => {
    if (!editing) return
    if (!editFrom || !editTo) {
      setEditing(null)
      return
    }
    /*
     * 改完统一存成 plain 规则，哪怕原来是成对的。
     *
     * 只有一个例外：**「变成什么」正好是两个字符时当成对处理** ——
     * 那几乎必然是一对引号或括号（“”、「」、《》），
     * 而作者要的就是「打一个，前后自动配对」。
     */
    const two = [...editTo]
    const next: SmartRule =
      two.length === 2
        ? { id: editing, kind: 'pair', from: editFrom, open: two[0]!, close: two[1]! }
        : { id: editing, kind: 'plain', from: editFrom, to: editTo }
    onSave(rules.map((r) => (r.id === editing ? next : r)))
    setEditing(null)
  }

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal rule-modal">
        <div className="settings-title">打什么 → 变成什么</div>

        <table className="rule-table">
          <tbody>
            {rules.map((r) =>
              editing === r.id ? (
                <tr key={r.id}>
                  <td>
                    <input
                      className="settings-num"
                      value={editFrom}
                      autoFocus
                      onChange={(e) => setEditFrom(e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="settings-num"
                      value={editTo}
                      onChange={(e) => setEditTo(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && commitEdit()}
                    />
                  </td>
                  <td className="rule-act">
                    <button className="btn" onClick={commitEdit}>
                      好
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={r.id}>
                  <td className="rule-key">{r.from}</td>
                  <td className="rule-val">{shownAs(r)}</td>
                  <td className="rule-act">
                    <button className="icon-btn" title="改" onClick={() => beginEdit(r)}>
                      ···
                    </button>
                    <button
                      className="icon-btn"
                      title="删掉"
                      onClick={() => onSave(rules.filter((x) => x.id !== r.id))}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ),
            )}
            <tr>
              <td>
                <input
                  className="settings-num"
                  placeholder="打"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </td>
              <td>
                <input
                  className="settings-num"
                  placeholder="变成"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && add()}
                />
              </td>
              <td className="rule-act">
                <button className="icon-btn" title="加一条" disabled={!from || !to} onClick={add}>
                  ＋
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <div className="settings-hint">
          {/*
            这一句留着。它是「这功能会不会把我的稿子改坏」的答案，
            而那正是人第一次看到自动替换时会担心的事
          */}
          只在你敲下那一刻替换，<b>不动文件里已有的字</b>；撤销一次退回你原本打的。
          「变成」填两个字符时当成对的引号用。
        </div>

        <div className="plan-actions">
          <button className="btn btn-primary" onClick={onClose}>
            好了
          </button>
        </div>
      </div>
    </div>
  )
}

export function AppearancePanel({
  settings,
  onChange,
}: {
  settings: UserSettings
  onChange(patch: Partial<UserSettings>): void
}) {
  return (
    <>
      <Section title="外观">
        {/*
          ── 一排色块：三档预设 + 三个自选样式 ──

          作者报的：「自选样式疑似仍然可以和预设样式一同存在，这很奇怪。」
          他说得对 —— 原来预设是一排、自选是另一排，两边各有各的选中态，
          看着就像两个都开着。

          其实它本来就是**单选**：要么用一档预设，要么用一份自选样式。
          所以摆成一排，选中的永远只有一个，那份「并存」的错觉就没了。

          每一格用自己的稿纸颜色上色 —— 自选样式的颜色是从它自己的 CSS 里
          抠出来的（作者要求「导入样式后，对应的预设应该与该主题的稿纸颜色一致」）。
        */}
        <ThemePicker settings={settings} onChange={onChange} />


        <FontRow settings={settings} onChange={onChange} />

        {/* 一行样张。改完不用回稿纸就能看出换没换 */}
        <div
          className="font-preview"
          style={{ fontFamily: resolveFontStack(settings.fontFamily), fontSize: settings.fontSize }}
        >
          反者道之动，弱者道之用。
        </div>
        {FONTS.find((f) => f.key === fontKeyOf(settings.fontFamily))?.note && (
          <Hint>{FONTS.find((f) => f.key === fontKeyOf(settings.fontFamily))!.note}</Hint>
        )}

        <NumField
          label="字号"
          value={settings.fontSize}
          min={13}
          max={28}
          step={1}
          suffix="px"
          onChange={(v) => onChange({ fontSize: v })}
        />
        <NumField
          label="行距"
          value={settings.lineHeight}
          min={1.3}
          max={2.6}
          step={0.1}
          suffix=""
          onChange={(v) => onChange({ lineHeight: Number(v.toFixed(1)) })}
        />
        <NumField
          label="稿纸宽度"
          value={settings.pageWidth}
          min={480}
          max={1200}
          step={20}
          suffix="px"
          onChange={(v) => onChange({ pageWidth: v })}
        />
        <NumField
          label="上下留白"
          value={settings.pagePadY ?? 0}
          min={0}
          max={200}
          step={10}
          suffix="px"
          onChange={(v) => onChange({ pagePadY: v })}
        />
        <NumField
          label="首行缩进"
          value={settings.paraIndent ?? 2}
          min={0}
          max={4}
          step={1}
          suffix="字"
          onChange={(v) => onChange({ paraIndent: v })}
        />
      </Section>

      <Section title="写起来什么感觉">
        <Row label="打字机 · 竖向">
          <Toggle on={settings.typewriterV} onChange={(v) => onChange({ typewriterV: v })} />
        </Row>

        <Row label="打字机 · 横向">
          <Toggle
            on={settings.typewriterH}
            onChange={(v) => onChange({ typewriterH: v })}
          />
        </Row>
        {/*
          这一句必须留。折行时一行永远填不满、光标也就永远走不到右边，
          横向根本没得动 —— 两者是硬冲突。默默改掉他的排版，
          他只会觉得「怎么忽然能左右拖了」
        */}
        <Hint>会关掉自动折行。</Hint>

        <Row label="专注模式">
          <Toggle on={settings.focusMode} onChange={(v) => onChange({ focusMode: v })} />
        </Row>
      </Section>

      <SmartReplaceSection settings={settings} onChange={onChange} />

    </>
  )
}

export function SettingsPanel({ settings, onChange, onChangeRoot }: SettingsPanelProps) {
  return (
    <div className="settings-panel">
      <AppearancePanel settings={settings} onChange={onChange} />

      <Section title="界面">
        <Row label="左右侧边栏互换">
          <Toggle
            on={settings.sidebarSwapped}
            onChange={(v) => onChange({ sidebarSwapped: v })}
          />
        </Row>
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
        <Hint>含标点跟起点等平台一致。</Hint>
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
        <Hint>本机标识 <code>{settings.deviceId}</code></Hint>
      </Section>
    </div>
  )
}

/**
 * 一排色块：三档预设 + 三个自选样式。
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么是一排，不是两排】
 *
 * 作者报的：「自选样式疑似仍然可以和预设样式一同存在，这很奇怪。」
 *
 * 原来预设一排、自选一排，两边各有各的选中态 —— 看着就像两个都开着。
 * 但它本来就是**单选**：要么一档预设，要么一份自选样式。
 * 摆成一排、选中的永远只有一个，那种「并存」的错觉自然就没了。
 *
 * 【为什么要给自选样式取名】
 *
 * 作者：「我们可能需要给这些自定义主题取名，这个功能也很重要。」
 *
 * 显示文件名的话它只是个文件；有了名字它才跟「纸白」「护眼」
 * 平起平坐 —— 而那正是它应有的地位。名字点右键能改。
 *
 * 【颜色】
 *
 * 每格用自己的稿纸底色。自选样式那三格的颜色是**从它自己的 CSS 里抠的**
 * （作者要求「导入样式后，对应的预设应该与该主题的稿纸颜色一致」）；
 * 抠不出来就退回当前主题的色，不瞎给。
 * ─────────────────────────────────────────────────────────────
 */
function ThemePicker({
  settings,
  onChange,
}: {
  settings: UserSettings
  onChange(patch: Partial<UserSettings>): void
}) {
  const [busy, setBusy] = useState(-1)
  const [why, setWhy] = useState('')
  /** 装好了之后的回执。普通颜色，跟红字的 why 分开 */
  const [note, setNote] = useState('')
  /**
   * 调色器在改第几格。null = 没开着，-1 = 在调一套还没存进栏位的新主题。
   *
   * 记「第几格」而不是「开没开」，是因为双击一格自制主题要能**接着调那一格**，
   * 存的时候也该更新原来那格，而不是又占一个新位子。
   */
  const [making, setMaking] = useState<number | null>(null)
  /** 正在给第几个槽位改名。-1 = 没在改 */
  const [renaming, setRenaming] = useState(-1)
  /*
   * 永远经过一遍 normalizeSlots：中间不留空位、末尾留且只留一个。
   *
   * 界面这边也收拾一次，不是多余的 —— 配置可能是老版本存下来的三格，
   * 也可能是别处刚改过还没写回来的。**画出来的那一排必须是规矩的**，
   * 否则中间会冒出一个点下去行为不一样的「空格子」。
   */
  const slots = normalizeSlots(settings.themeCssSlots ?? [])
  const active = settings.themeCssActive ?? -1
  /** 现在用的这一格是自己调的吗 */
  const activeIsMade = active >= 0 && !!slots[active]?.draft
  const preset = themeOf(settings.theme)

  /**
   * 装上当前选中的那一份（或卸掉），**并且说清楚它到底改了什么**。
   *
   * 「装上了但没变化」是这功能唯一一种坏法，而从界面上完全看不出是
   * 哪一环出的问题。所以装完直接拿浏览器算出来的值跟预设比一遍 ——
   * 改了几个就说几个，一个没改也直说。
   */
  const refresh = async () => {
    const r = await api.readThemeCss().catch(() => null)
    applyThemeCss(r?.css ?? '')
    if (!r?.css) {
      setWhy(r?.problem ?? '')
      setNote('')
      return
    }
    // 等一帧，让浏览器把新样式算进去
    await new Promise((res) => requestAnimationFrame(res))
    const eff = whatTookEffect(themeOf(settings.theme))
    /*
     * 回执一行，**普通颜色**。
     *
     * 三个数分开报：装进去多少、改了几个颜色、翻译了几条排版。
     * 颜色和排版是两条完全不同的路 —— 前者靠主题定义 --bg-color 那套变量，
     * 后者靠我们把 `#write h1` 翻成 `#write .cm-h1`。一份主题可能只走
     * 其中一条，合成一句话说就分不清是哪条断了。
     *
     * ⚠️ **这一行不能进 `why`。** `why` 是红的，专门说坏消息 ——
     * 作者截图报过：主题明明装好了，设置里却顶着一大段红字。
     * 「装好了」和「出事了」用同一种颜色说，等于两句都没说。
     */
    const rules = (r as { bridged?: number }).bridged ?? 0
    const paper = (r as { paper?: string }).paper ?? ''
    const kb = Math.round(r.css.length / 1024)
    /*
     * **纸色没定义要单独说一句，还要给出怎么办。**
     *
     * 作者问的是「稿纸颜色仍未更改，是不是有个带纸色的文件没导进来」——
     * 不是，文件全在。是有一整类 Typora 主题（phycat 那种）只给强调色和
     * 排版，纸色用的是 Typora 自己的默认白。装上之后纸还是白的，是对的。
     *
     * 光说「没定义纸色」不够 —— 那还是个死胡同。所以把那一行 CSS 也给出来：
     * 这正是 0.4 对齐 Typora 变量之后能给的答案，加一行就有色纸了。
     */
    setNote(
      `装进去 ${kb} KB，改了 ${eff.changed.length}/${eff.total} 个颜色，翻译了 ${rules} 条排版规则。` +
        (paper
          ? ''
          : '　这份主题没定义纸色（它在 Typora 里也是白纸）——' +
            '想要有色的纸，在它的 CSS 里加一行 :root{--bg-color:#eaf7f7}。'),
    )
    setWhy(r.problem)

    /*
     * 顺手把色块的颜色纠回来。
     *
     * 0.4 早先那版抠纸色时会把 `#write code{…}` 的底色当成纸色，
     * 于是色块是薄荷绿、稿纸却是白的。抠法改对了，但**已经存进配置的
     * 那个错颜色不会自己消失** —— 在这儿对一次，不用作者重导一遍。
     */
    if (active >= 0 && slots[active] && slots[active].color !== paper) {
      onChange({
        themeCssSlots: slots.map((sl, i) => (i === active ? { ...sl, color: paper } : sl)),
      })
    }
  }

  const usePreset = async (key: string) => {
    // 回预设 = 不用任何自定义主题。作者早先报过「自选样式疑似仍然
    // 可以和预设样式一同存在」—— 所以切档时必须把另一档明确关掉
    onChange({ theme: key, themeCssActive: -1 })
    await api.useThemeSlot(-1).catch(() => {})
    await refresh()
  }

  const useSlot = async (i: number) => {
    onChange({ themeCssActive: i })
    await api.useThemeSlot(i).catch(() => {})
    await refresh()
  }

  const pick = async (i: number) => {
    setBusy(i)
    setWhy('')
    try {
      const r = await api.pickThemeCss(i)
      if (!r) return
      onChange({ themeCssSlots: r.slots, themeCssActive: r.slot })
      await refresh()
    } catch (e) {
      setWhy(e instanceof Error ? e.message : String(e))
      setNote('')
    } finally {
      setBusy(-1)
    }
  }

  /**
   * 改名。
   *
   * ⚠️ **不能用 `window.prompt`** —— Electron 里它是不支持的，
   * 点了没反应、也不报错（作者报的「没有办法给主题改名」就是这个）。
   * 用软件自己那个输入弹窗。
   */
  const commitRename = async (name: string) => {
    if (renaming < 0) return
    const got = await api.renameThemeSlot(renaming, name).catch(() => null)
    if (got) onChange({ themeCssSlots: got })
    setRenaming(-1)
  }

  /**
   * 双击一格。
   *
   * 两种格子做的事不一样，但**动作是同一个** —— 作者不需要记得
   * 哪一格是导进来的、哪一格是自己调的：
   *   · 文件主题 → 换一份 CSS
   *   · 自制主题 → 打开调色器接着调那一格
   */
  const reopen = async (i: number) => {
    if (slots[i]?.draft) {
      setMaking(i)
      return
    }
    await pick(i)
  }

  const clear = async (i: number) => {
    if (!confirm(`删掉「${slots[i]?.name || '这一份'}」？删除后再次使用需重新导入。`)) return
    const r = await api.clearThemeSlot(i).catch(() => null)
    if (!r) return
    onChange({ themeCssSlots: r.slots, themeCssActive: r.active })
    await refresh()
  }

  return (
    <>
      <div className="theme-picker">
        {THEMES.map((t) => {
          const on = active < 0 && settings.theme === t.key
          return (
            <button
              key={t.key}
              className={`theme-swatch${on ? ' on' : ''}`}
              title={t.hint}
              onClick={() => void usePreset(t.key)}
              style={{
                background: t.vars.bg,
                color: t.vars.text,
                borderColor: on ? t.vars.accent : t.vars.border,
              }}
            >
              <span className="theme-dot" style={{ background: t.vars.accent }} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* 自定义那一排要能换行 —— 最多九个，一行摆不下 */}
      <div className="theme-picker custom">
        {slots.map((sl, i) => {
          const on = active === i
          // 抠不出颜色就用当前预设的 —— 瞎给一个颜色比跟原来一样更糟
          const bg = sl.color || preset.vars.bg
          if (isEmptySlot(sl)) {
            return (
              <button
                key={i}
                className="theme-swatch empty"
                title="空的 —— 点一下挑一份 CSS（Typora 主题直接能用）。自己调的那套也存在这一排"
                onClick={() => void pick(i)}
              >
                {busy === i ? '…' : '＋'}
              </button>
            )
          }
          return (
            <button
              key={i}
              className={`theme-swatch${on ? ' on' : ''}`}
              title={
                sl.draft
                  ? `${sl.name}（自己调的）
右键改名，双击接着调`
                  : `${sl.name}　${sl.path}
右键改名，双击换一份 CSS`
              }
              onClick={() => void useSlot(i)}
              onContextMenu={(e) => {
                e.preventDefault()
                setRenaming(i)
              }}
              onDoubleClick={() => void reopen(i)}
              style={{ background: bg, color: preset.vars.text, borderColor: on ? preset.vars.accent : preset.vars.border }}
            >
              {busy === i ? '…' : sl.name || '自选'}
              <span
                className="theme-x"
                title="不用这一份"
                onClick={(e) => {
                  e.stopPropagation()
                  void clear(i)
                }}
              >
                ✕
              </span>
            </button>
          )
        })}
      </div>
      {/*
        这一行只说**自定义那一排怎么操作**。
        原来它在没选自定义主题时会去介绍预设（「暖白，像一张纸……」），
        作者要求换掉 —— 他说得对：预设那三个色块自己就说清楚了，
        而「双击换、右键改名」这两个动作没地方能看出来，必须写。
      */}
      <Hint>双击自定义主题更换 CSS 文件，右键改名。</Hint>
      {renaming >= 0 && (
        <PromptModal
          title="这份主题叫什么"
          placeholder="比如 薄荷猫"
          initial={slots[renaming]?.name ?? ''}
          confirmText="改好了"
          onConfirm={(v) => void commitRename(v)}
          onCancel={() => setRenaming(-1)}
        />
      )}
      {/*
        调色器的入口。
        摆在自选那一排**下面**，因为它是「不想折腾别人的主题时走这条」——
        而多数人是先试了导入、没达到预期，才会想自己调。
      */}
      <div className="tm-entry">
        <button
          className={`btn${activeIsMade ? ' btn-primary' : ''}`}
          onClick={() => setMaking((v) => (v === null ? -1 : null))}
        >
          {making !== null ? '收起调色器' : '自己调一套'}
        </button>
        {activeIsMade && (
          <span className="tm-entry-on">正在用「{slots[active]?.name || '我的主题'}」</span>
        )}
        {!canAdd(slots) && making !== null && (
          <span className="tm-entry-on">自定义主题满九个了，存的时候会覆盖当前这格。</span>
        )}
      </div>
      {making !== null && (
        <ThemeMaker
          settings={settings}
          slot={making}
          onChange={onChange}
          onSaved={async (i) => {
            setMaking(i)
            await refresh()
          }}
          onClose={() => setMaking(null)}
        />
      )}
      {note && <Hint>{note}</Hint>}
      {why && (
        <Hint>
          <span className="account-warn">{why}</span>
        </Hint>
      )}
    </>
  )
}

export function applySettings(s: UserSettings): void {
  const root = document.documentElement
  applyTheme(s.theme)
  // 字体走样式表，主题才改得到它（见 themes.ts 的 applyFontVar）
  applyFontVar(resolveFontStack(s.fontFamily))
  root.style.setProperty('--font-size', `${s.fontSize}px`)
  root.style.setProperty('--line-height', String(s.lineHeight))
  root.style.setProperty('--page-width', `${s.pageWidth}px`)
  root.style.setProperty('--page-pad-y', `${s.pagePadY ?? 0}px`)
  // 首行缩进是 CSS 的事，文件里一个全角空格都不存（03 §2）
  root.style.setProperty('--para-indent', `${s.paraIndent ?? 2}em`)
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
      themeCssSlots: [{ path: '', draft: null, name: '', color: '' }],
      themeCssActive: -1,
      themeDraft: null,
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
      fontSizeByTheme: {},
      customFonts: {},
      typewriterV: false,
      typewriterH: false,
      focusMode: false,
      pagePadY: 0,
      paraIndent: 2,
      smartReplace: true,
      smartRules: null,
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

/**
 * 一个数字输入框。
 *
 * 原来是滑动条 —— 作者要求换成文本框：
 * 「字号等等，不应该是滑动条，而是以文本框输入数字，
 *  输入纯数字或带单位的都可以。」
 *
 * 他是对的。滑动条**调不准**：想要 18 号字，拖到 17 还是 19 全看手稳不稳，
 * 而字号这种东西人心里是有确切数字的。
 *
 * 解析和收边界在 `renderer/num-field.ts` —— 那两条抠错了的后果是
 * **作者的字号被悄悄改成别的**，所以单拎出来拿测试钉着。
 */
function NumField({
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
  // 输入过程中不写配置：打「1」的时候不该先跳成 1 再变 18
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])

  const commit = () => {
    const n = parseNumberLoose(text)
    if (n === null) {
      // 读不出数就退回原值，不去猜他想要什么
      setText(String(value))
      return
    }
    const tidy = clampToStep(n, min, max, step)
    setText(String(tidy))
    if (tidy !== value) onChange(tidy)
  }

  return (
    <div className="settings-row">
      <span>{label}</span>
      <div className="settings-control num-field">
        <input
          className="settings-num"
          value={text}
          inputMode="decimal"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            // 上下键微调 —— 滑动条那点「随手调一格」的好处不至于全丢
            else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              const cur = parseNumberLoose(text) ?? value
              const tidy = clampToStep(cur + (e.key === 'ArrowUp' ? step : -step), min, max, step)
              setText(String(tidy))
              onChange(tidy)
            }
          }}
        />
        {suffix && <span className="faint num-suffix">{suffix}</span>}
      </div>
    </div>
  )
}
