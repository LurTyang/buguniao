import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * 弹窗的底子：一层遮罩 + 中间那个框。Esc 和点空白处都关。
 *
 * 导出是给「内容不是一两个输入框」的弹窗用的（比如 IF 的写作设置表单）——
 * 它们各自长得不一样，但**关掉的方式必须一模一样**：
 * 一个 Esc 关不掉的弹窗，比多点一下更让人火。
 */
export function Mask({ children, onCancel }: { children: ReactNode; onCancel(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal">{children}</div>
    </div>
  )
}

// ───────────────────────── 输入框弹窗 ─────────────────────────

export interface PromptModalProps {
  title: string
  hint?: ReactNode
  placeholder?: string
  initial?: string
  confirmText?: string
  /**
   * 允许留空就按确定。
   *
   * 新建章节要的：很多时候你只是想立刻开始写，而「这一章叫什么」
   * 得等写完开头才知道。留空建出来的那一篇，第一次存盘时
   * 会拿正文第一行当标题（见 core 的 `autoTitlePath`）。
   */
  allowEmpty?: boolean
  /** 输入框下面再塞点东西（下拉框、日期），加里程碑时要用 */
  extra?: ReactNode
  onConfirm(value: string): void
  onCancel(): void
}

/** 一个输入框的小弹窗。新建作品、新建章节、重命名都用它 */
export function PromptModal({
  title,
  hint,
  placeholder,
  initial = '',
  confirmText = '确定',
  allowEmpty = false,
  extra,
  onConfirm,
  onCancel,
}: PromptModalProps) {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = () => {
    const v = value.trim()
    if (v || allowEmpty) onConfirm(v)
  }

  return (
    <Mask onCancel={onCancel}>
      <h3>{title}</h3>
      {hint && <p className="modal-hint">{hint}</p>}
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      {extra}
      <div className="modal-actions">
        <button className="btn" onClick={onCancel}>
          取消
        </button>
        <button className="btn btn-primary" onClick={submit} disabled={!value.trim() && !allowEmpty}>
          {confirmText}
        </button>
      </div>
    </Mask>
  )
}

// ───────────────────────── 多字段弹窗 ─────────────────────────

export interface FormField {
  key: string
  label: string
  placeholder?: string
  initial?: string
  /** 留空是否允许。默认必填 */
  optional?: boolean
  hint?: string
  /**
   * 给了就渲染成一排可选的卡片，不是输入框。
   * 新建作品要问「小说还是剧本、游戏」，那是选择题不是填空题。
   */
  choices?: Array<{ value: string; label: string; hint?: string }>
}

export interface FormModalProps {
  title: string
  hint?: ReactNode
  fields: FormField[]
  confirmText?: string
  onConfirm(values: Record<string, string>): void
  onCancel(): void
}

/**
 * 多个输入框的弹窗。
 *
 * 新建作品用它一次问清「书名」和「第一章标题」——
 * 之前新建完直接蹦出一个叫「第一章」的章节，想改名还得再右键一次。
 */
export function FormModal({
  title,
  hint,
  fields,
  confirmText = '确定',
  onConfirm,
  onCancel,
}: FormModalProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.initial ?? ''])),
  )
  const firstRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstRef.current?.focus()
    firstRef.current?.select()
  }, [])

  const missing = fields.filter((f) => !f.optional && !(values[f.key] ?? '').trim())
  const submit = () => {
    if (missing.length > 0) return
    onConfirm(Object.fromEntries(fields.map((f) => [f.key, (values[f.key] ?? '').trim()])))
  }

  return (
    <Mask onCancel={onCancel}>
      <h3>{title}</h3>
      {hint && <p className="modal-hint">{hint}</p>}
      {fields.map((f, i) => (
        <div key={f.key} className="form-field">
          <label>
            {f.label}
            {f.optional && <span className="faint">（可留空）</span>}
          </label>
          {f.choices ? (
            <div className="form-choices">
              {f.choices.map((c) => (
                <button
                  key={c.value}
                  className={`form-choice${values[f.key] === c.value ? ' on' : ''}`}
                  onClick={() => setValues((v) => ({ ...v, [f.key]: c.value }))}
                >
                  <b>{c.label}</b>
                  {c.hint && <span>{c.hint}</span>}
                </button>
              ))}
            </div>
          ) : (
            <input
              ref={i === 0 ? firstRef : undefined}
              value={values[f.key] ?? ''}
              placeholder={f.placeholder}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          )}
          {f.hint && <div className="form-field-hint">{f.hint}</div>}
        </div>
      ))}
      <div className="modal-actions">
        <button className="btn" onClick={onCancel}>
          取消
        </button>
        <button className="btn btn-primary" onClick={submit} disabled={missing.length > 0}>
          {confirmText}
        </button>
      </div>
    </Mask>
  )
}

// ───────────────────────── 确认弹窗 ─────────────────────────

export interface ConfirmModalProps {
  title: string
  body?: ReactNode
  confirmText?: string
  danger?: boolean
  onConfirm(): void
  onCancel(): void
}

export function ConfirmModal({
  title,
  body,
  confirmText = '确定',
  danger,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Mask onCancel={onCancel}>
      <h3>{title}</h3>
      {body && <p className="modal-hint">{body}</p>}
      <div className="modal-actions">
        <button className="btn" onClick={onCancel}>
          取消
        </button>
        <button
          className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
          onClick={onConfirm}
          autoFocus
        >
          {confirmText}
        </button>
      </div>
    </Mask>
  )
}

// ───────────────────────── 列表选择弹窗 ─────────────────────────

export interface ChoiceModalProps {
  title: string
  hint?: ReactNode
  options: Array<{ value: string; label: string }>
  emptyText?: string
  onConfirm(value: string): void
  onCancel(): void
}

/** 从一组选项里挑一个。「移到其他卷」用它 */
export function ChoiceModal({
  title,
  hint,
  options,
  emptyText = '没有可选项。',
  onConfirm,
  onCancel,
}: ChoiceModalProps) {
  return (
    <Mask onCancel={onCancel}>
      <h3>{title}</h3>
      {hint && <p className="modal-hint">{hint}</p>}
      {options.length === 0 ? (
        <p className="modal-hint">{emptyText}</p>
      ) : (
        <div className="choice-list">
          {options.map((o) => (
            <button key={o.value} className="choice-item" onClick={() => onConfirm(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
      )}
      <div className="modal-actions">
        <button className="btn" onClick={onCancel}>
          取消
        </button>
      </div>
    </Mask>
  )
}
