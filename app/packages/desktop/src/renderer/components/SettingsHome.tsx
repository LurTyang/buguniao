/**
 * 总设置的内容。
 *
 * 拆成单独一个文件，是因为它要把已有的几块（目标编辑器、AI 服务商设置）
 * 拼起来 —— 那些都已经写好且验过了，不该为了「有个总设置页」重写一遍。
 */

import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { PromptModal } from './Modal.js'
import { SettingsOverlay, type SettingsSection } from './SettingsOverlay.js'
import { PlanOverview } from './PlanPanel.js'
import { ProviderSetup } from './AiPanel.js'
import { AccountPanel } from './AccountPanel.js'
import type { UserSettings } from '../../shared/api.js'

type Report = Awaited<ReturnType<typeof api.planReport>>
type AiStatus = Awaited<ReturnType<typeof api.aiStatus>>

export function SettingsHome({
  onClose,
  onChangeRoot,
  root,
  initial,
  settings,
  onSettings,
}: {
  onClose(): void
  onChangeRoot(): void
  root: string | null
  initial?: SettingsSection
  settings: UserSettings
  onSettings(patch: Partial<UserSettings>): void
}) {
  const [r, setR] = useState<Report | null>(null)
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [version, setVersion] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    void api.planReport().then(setR).catch(() => setR(null))
    void api.aiStatus().then(setAi).catch(() => setAi(null))
    void api.appVersion().then(setVersion).catch(() => setVersion(''))
  }, [])

  useEffect(load, [load])

  const patchAi = async (p: Record<string, unknown>) => {
    try {
      await api.aiSetConfig(p)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <SettingsOverlay
        onClose={onClose}
        {...(initial ? { initial } : {})}
        sections={[
          {
            key: 'account',
            label: '账号',
            // 「关于你」并进来了：两页说的是同一件事——你是谁。
            // 昵称在这页、连胜在那页，找起来没有道理。
            node: (
              <AccountPanel
                onError={setError}
                me={r}
                version={version}
                onRename={() => setRenaming(true)}
              />
            ),
          },
          {
            key: 'plan',
            label: '码字计划',
            hint: '目标是「你」的属性，不分在写哪本书 —— 判定用的是全部作品当日字数的合计。所以它在这儿，不在写作页的侧边栏上。',
            // 里程碑不在这儿：那是**按书**的（这一卷什么时候写完），
            // 留在写作页的侧边栏上
            node: <PlanOverview />,
          },
          {
            key: 'ai',
            label: 'AI',
            hint: 'API Key 只存在本机、用系统加密，界面进程永远拿不到它。',
            node: ai ? (
              <ProviderSetup
                status={ai}
                onPatch={(p) => void patchAi(p as Record<string, unknown>)}
                onSaved={load}
                onError={setError}
              />
            ) : (
              <div className="empty-hint">正在读……</div>
            ),
          },
          {
            key: 'library',
            label: '作品库',
            node: (
              <div className="set-me">
                <div className="ai-field">
                  <label>作品都放在这儿</label>
                  <input className="search-input" readOnly value={root ?? ''} />
                  <div className="settings-hint">
                    你的正文是普通的 <code>.md</code> 纯文本，就躺在这个文件夹里，记事本能打开。
                    <br />
                    建议选在坚果云的同步文件夹里 —— 计划、目标、昵称也都跟着走。
                  </div>
                  <button className="btn" style={{ width: '100%', marginTop: 8 }} onClick={onChangeRoot}>
                    换一个文件夹
                  </button>
                </div>
              </div>
            ),
          },
        ]}
      />

      {error && <div className="search-error">{error}</div>}

      {renaming && (
        <PromptModal
          title="怎么称呼你"
          hint="只存在你自己的库里，跟着同步走。"
          placeholder="笔名、昵称都行"
          initial={r?.nickname ?? ''}
          confirmText="就这个"
          onCancel={() => setRenaming(false)}
          onConfirm={(v) => {
            setRenaming(false)
            void api.setNickname(v).then(load)
          }}
        />
      )}
    </>
  )
}
