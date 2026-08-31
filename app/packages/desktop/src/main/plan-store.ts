/**
 * 计划与里程碑的存取。
 *
 * 规范：更新文档/05-功能模块详述.md §8.5 §8.6
 *
 * ─────────────────────────────────────────────────────────────
 * 【存哪儿，为什么】
 *
 * **每日目标、请假日 → 库根目录的 `_计划.yaml`**
 *   目标是「人」的属性不是「书」的属性 —— 一天写 8000 字，不分在写哪本。
 *   放在库根而不是应用配置目录，是为了**跟着坚果云同步走**：
 *   换台电脑目标不用重设，而且它是可读的 YAML，记事本能改。
 *
 * **里程碑 → 每本书的 `.bugu/milestones.jsonl`**
 *   里程碑是「书」的属性（写完这一卷）。用仅追加的 jsonl，
 *   同 id 后写覆盖 —— 跟伏笔一个套路，多设备改了能合。
 * ─────────────────────────────────────────────────────────────
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  EMPTY_PLAN,
  type LeaveDay,
  type Milestone,
  type Plan,
  type TargetChange,
} from '@bugu/core'
import type { StorageBackend } from '@bugu/core'

/** 库根目录下的计划文件。下划线开头，排在作品前面，一眼看得出不是作品 */
export const PLAN_FILE = '_计划.yaml'

/** 一本书的里程碑文件 */
export const milestoneFile = (bookPath: string) => `${bookPath}/.bugu/milestones.jsonl`

// ───────────────────────── 计划 ─────────────────────────

/**
 * 读计划。
 *
 * 文件坏了、字段缺了都退回空计划而不是抛错 ——
 * 一个 YAML 打错字不该让作者连字数统计都打不开。
 */
export async function loadPlan(backend: StorageBackend): Promise<Plan> {
  let raw: string
  try {
    raw = await backend.read(PLAN_FILE)
  } catch {
    return { ...EMPTY_PLAN }
  }

  try {
    const p = parseYaml(raw) as Partial<Plan> | null
    if (!p || typeof p !== 'object') return { ...EMPTY_PLAN }
    return {
      schemaVersion: typeof p.schemaVersion === 'number' ? p.schemaVersion : 1,
      profile: {
        nickname:
          typeof p.profile?.nickname === 'string' ? p.profile.nickname.slice(0, 20) : '',
      },
      targets: sanitizeTargets(p.targets),
      leaves: sanitizeLeaves(p.leaves),
    }
  } catch {
    return { ...EMPTY_PLAN }
  }
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** 只留结构对得上的条目。手改过的文件什么样都可能有 */
function sanitizeTargets(input: unknown): TargetChange[] {
  if (!Array.isArray(input)) return []
  const out: TargetChange[] = []
  for (const c of input) {
    if (!c || typeof c !== 'object') continue
    const { from, target } = c as Partial<TargetChange>
    if (typeof from !== 'string' || !DAY_RE.test(from)) continue
    if (!target || !Array.isArray(target.floor) || !Array.isArray(target.ideal)) continue
    const seven = (a: unknown[]) =>
      Array.from({ length: 7 }, (_, i) => (typeof a[i] === 'number' && a[i]! >= 0 ? (a[i] as number) : 0))
    out.push({
      from,
      target: {
        floor: seven(target.floor) as TargetChange['target']['floor'],
        ideal: seven(target.ideal) as TargetChange['target']['ideal'],
      },
    })
  }
  return out.sort((a, b) => a.from.localeCompare(b.from))
}

function sanitizeLeaves(input: unknown): LeaveDay[] {
  if (!Array.isArray(input)) return []
  const out: LeaveDay[] = []
  const seen = new Set<string>()
  for (const l of input) {
    if (!l || typeof l !== 'object') continue
    const { day, reason } = l as Partial<LeaveDay>
    if (typeof day !== 'string' || !DAY_RE.test(day) || seen.has(day)) continue
    seen.add(day)
    out.push({ day, reason: typeof reason === 'string' ? reason : '' })
  }
  return out.sort((a, b) => a.day.localeCompare(b.day))
}

/** 写计划。带注释头，作者手改时知道这是什么 */
export async function savePlan(backend: StorageBackend, plan: Plan): Promise<void> {
  const head = [
    '# 不咕鸟 · 码字计划',
    '#',
    '# targets：每日目标的变更历史。每条从 from 那天起生效，',
    '#          **每天用当天生效的那条判定** —— 改了目标，以前的日子不会跟着变。',
    '#          floor 是底线（写够就算达标），ideal 是理想线。',
    '#          七个数从周一排到周日。',
    '# leaves： 请假日。不算断更，但也不算达标 —— 热力图上是中性色。',
    '# profile：昵称。这软件没有账号，这里也不存任何密码或邮箱。',
    '',
  ].join('\n')
  await backend.write(PLAN_FILE, head + stringifyYaml(plan))
}

// ───────────────────────── 里程碑 ─────────────────────────

/**
 * 读里程碑。
 *
 * 仅追加的 jsonl：同一个 id 出现多次时**后写的覆盖先写的**，
 * 这样两台电脑各改各的，同步之后按时间戳合得起来。
 * 坏行直接跳过，不让一行 JSON 打错毁掉整份清单。
 */
export async function loadMilestones(
  backend: StorageBackend,
  bookPath: string,
): Promise<Milestone[]> {
  let raw: string
  try {
    raw = await backend.read(milestoneFile(bookPath))
  } catch {
    return []
  }

  const byId = new Map<string, Milestone>()
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (t === '') continue
    try {
      const m = JSON.parse(t) as Milestone & { deleted?: boolean }
      if (typeof m.id !== 'string' || m.id === '') continue
      const prev = byId.get(m.id)
      // 时间戳小的不覆盖大的 —— 同步回来的旧记录不该盖掉本地新改的
      if (prev && (prev.updatedAt ?? 0) > (m.updatedAt ?? 0)) continue
      if (m.deleted) byId.delete(m.id)
      else byId.set(m.id, m)
    } catch {
      // 坏行跳过
    }
  }
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt)
}

export async function appendMilestone(
  backend: StorageBackend,
  bookPath: string,
  m: Milestone & { deleted?: boolean },
): Promise<void> {
  await backend.append(milestoneFile(bookPath), JSON.stringify(m))
}

/** 生成一个里程碑 id。跟伏笔一样用 base36，短且不重 */
export function newMilestoneId(now = Date.now()): string {
  return `ms-${now.toString(36)}-${Math.floor(Math.random() * 36 ** 3).toString(36)}`
}
