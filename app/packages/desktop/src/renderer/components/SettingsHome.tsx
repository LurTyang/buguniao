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
import { AppearancePanel } from './SettingsPanel.js'
import type { UserSettings } from '../../shared/api.js'
import { rootName, sameRoot } from '../../shared/roots.js'

type Report = Awaited<ReturnType<typeof api.planReport>>
type AiStatus = Awaited<ReturnType<typeof api.aiStatus>>

export function SettingsHome({
  onClose,
  onChangeRoot,
  onSwitchRoot,
  onForgetRoot,
  root,
  roots,
  initial,
  settings,
  onSettings,
}: {
  onClose(): void
  /** 挑一个新目录进来 */
  onChangeRoot(): void
  /** 切到另一个已经认得的作品库 */
  onSwitchRoot(path: string): void
  /** 不再记着某个作品库。一个文件都不删 */
  onForgetRoot(path: string): void
  root: string | null
  /** 认得的作品库，全部 */
  roots: string[]
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
            key: 'appearance',
            label: '外观',
            hint: '跟写作页侧边栏里的那一份是同一个设置 —— 两边改哪个都一样，改完立刻生效。',
            // 作者要求两处都能改。抽的是同一个组件，不是复制两份代码 ——
            // 复制的话改一处忘一处，两边就会不一样
            node: <AppearancePanel settings={settings} onChange={onSettings} />,
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
                  <label>认得这几个作品库</label>
                  {/*
                    一个作品库就是一个文件夹，里面摆着若干本书。
                    稿子常常不止摆在一处：同步盘一份、移动硬盘一份、
                    别人给的一份 —— 所以记一排，随时切。
                  */}
                  <div className="root-list">
                    {(roots.length > 0 ? roots : root ? [root] : []).map((p) => {
                      const cur = !!root && sameRoot(p, root)
                      return (
                        <div key={p} className={`root-row${cur ? ' active' : ''}`}>
                          <div className="root-main" title={p}>
                            <b>
                              {rootName(p)}
                              {cur && <span className="root-cur">正在用</span>}
                            </b>
                            <span className="root-path">{p}</span>
                          </div>
                          {!cur && (
                            <>
                              <button className="btn" onClick={() => onSwitchRoot(p)}>
                                切过去
                              </button>
                              {/* 移除只是不再记着它 —— 说清楚，不然没人敢点 */}
                              <button
                                className="btn-ghost icon-btn"
                                title="只是不再记着它，文件一个都不动"
                                onClick={() => onForgetRoot(p)}
                              >
                                移除
                              </button>
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <div className="settings-hint">
                    你的正文是普通的 <code>.md</code> 纯文本，就躺在这些文件夹里，记事本能打开。
                    <br />
                    建议选在坚果云的同步文件夹里 —— 计划、目标、昵称也都跟着走。
                    <br />
                    <b>切换只是换个看的地方，移除只是不再记着它 —— 两样都不动你的文件。</b>
                  </div>
                  <button className="btn" style={{ width: '100%', marginTop: 8 }} onClick={onChangeRoot}>
                    添加一个目录…
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
