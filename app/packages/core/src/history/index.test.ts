import { describe, it, expect } from 'vitest'
import {
  BUCKET_MS,
  SNAPSHOT_INTERVAL,
  bucketOf,
  shouldSnapshot,
  emptyHistory,
  loadHistory,
  appendSave,
  reconstruct,
  listVersions,
  rollback,
  historySizeBytes,
  capacityStatus,
  prune,
  pruneKeepLabeled,
  pruneOlderThan,
  parseHistoryJsonl,
  toHistoryJsonl,
  normalizeHistory,
  HistoryCorruptError,
} from './index.js'
import type { HistoryState } from './index.js'
import type { HistoryRecord } from '../types/index.js'

const DEV = 'pc-01'
/**
 * 测试基准时间，**刻意对齐到整分钟**（即 60000 的整数倍）。
 * 桶长 30 秒，基准不对齐的话「同桶」断言会随机翻车 —— 这一点第一次写测试时踩过。
 */
const T0 = 1_787_000_040_000
if (T0 % 60_000 !== 0) throw new Error('T0 必须对齐到整分钟')

/**
 * 生成真实尺寸的分段正文（n+1 段，约 (n+1)×55 字）。
 *
 * 有些测试必须用真实尺寸的内容：对几个字的玩具字符串来说，
 * 存全文本来就比存 patch 划算，「保险阀」会正当地把它转成快照，
 * 于是断言 kind==='patch' 就会失败。这不是 bug，是内容太短。
 */
function chapter(n: number): string {
  const paras: string[] = []
  for (let i = 0; i <= n; i++) {
    paras.push(
      `第${i}段。他从四十八楼掉下去的时候，脑子里想的不是死，而是昨天没写完的那一章。` +
        `风声在耳边呼啸，他忽然想起胸口那块温润的玉佩。`,
    )
  }
  return paras.join('\n\n')
}

/** 便捷：连续保存一串内容，返回最终状态 */
function saveAll(contents: Array<[string, number]>, dev = DEV): HistoryState {
  let s = emptyHistory()
  for (const [content, ts] of contents) {
    s = appendSave(s, { content, ts, dev }).state
  }
  return s
}

describe('时间桶', () => {
  it('桶长 30 秒', () => {
    expect(BUCKET_MS).toBe(30_000)
  })

  it('同一个 30 秒格里的时间戳归入同一桶', () => {
    expect(bucketOf(T0)).toBe(bucketOf(T0 + 29_999))
  })

  it('跨过 30 秒边界就换桶', () => {
    expect(bucketOf(T0)).not.toBe(bucketOf(T0 + 30_000))
  })

  it('桶起点是 30 秒的整数倍', () => {
    expect(bucketOf(T0 + 12_345) % BUCKET_MS).toBe(0)
  })

  it('每分钟切成两桶（0-30 秒 / 31-60 秒）', () => {
    const minute = Math.floor(T0 / 60_000) * 60_000
    expect(bucketOf(minute + 5_000)).toBe(minute)
    expect(bucketOf(minute + 29_000)).toBe(minute)
    expect(bucketOf(minute + 31_000)).toBe(minute + 30_000)
    expect(bucketOf(minute + 59_000)).toBe(minute + 30_000)
  })
})

describe('appendSave · 基本行为', () => {
  it('第一次保存产生 v1 快照', () => {
    const r = appendSave(emptyHistory(), { content: '开头', ts: T0, dev: DEV })
    expect(r.action).toBe('created')
    expect(r.record?.v).toBe(1)
    expect(r.record?.kind).toBe('snapshot')
    expect(r.record?.data).toBe('开头')
  })

  it('第二次保存产生 v2 增量', () => {
    const s = appendSave(emptyHistory(), { content: chapter(20), ts: T0, dev: DEV }).state
    const r = appendSave(s, { content: chapter(21), ts: T0 + 40_000, dev: DEV })
    expect(r.action).toBe('created')
    expect(r.record?.v).toBe(2)
    expect(r.record?.kind).toBe('patch')
    // 增量应当远小于全文
    expect(r.record!.data.length).toBeLessThan(chapter(21).length / 2)
  })

  it('内容很短时保险阀把增量换成快照（存全文反而更省）', () => {
    const s = appendSave(emptyHistory(), { content: '开头', ts: T0, dev: DEV }).state
    const r = appendSave(s, { content: '开头，还有后续', ts: T0 + 40_000, dev: DEV })
    expect(r.record?.kind).toBe('snapshot')
    expect(r.record?.data).toBe('开头，还有后续')
  })

  it('记录的 ts 是桶起点而非真实时刻', () => {
    const r = appendSave(emptyHistory(), { content: '甲', ts: T0 + 12_345, dev: DEV })
    expect(r.record?.ts).toBe(bucketOf(T0 + 12_345))
  })

  it('记录带字数（含标点口径）', () => {
    const r = appendSave(emptyHistory(), { content: '他掉下去了。', ts: T0, dev: DEV })
    expect(r.record?.chars).toBe(6)
  })

  it('内容没变时跳过，不刷出空版本', () => {
    let s = appendSave(emptyHistory(), { content: '甲', ts: T0, dev: DEV }).state
    const r = appendSave(s, { content: '甲', ts: T0 + 60_000, dev: DEV })
    expect(r.action).toBe('skipped')
    expect(r.record).toBeNull()
    expect(r.state.records).toHaveLength(1)
  })

  it('内容没变但带 label 时，把 label 补到最后一版上', () => {
    let s = appendSave(emptyHistory(), { content: '甲', ts: T0, dev: DEV }).state
    const r = appendSave(s, { content: '甲', ts: T0 + 60_000, dev: DEV, label: '完成第一卷' })
    expect(r.action).toBe('merged')
    expect(r.state.records).toHaveLength(1)
    expect(r.state.records[0]?.label).toBe('完成第一卷')
  })
})

describe('appendSave · 同桶合并（作者修正的核心设计）', () => {
  it('同一 30 秒桶内的多次保存合并成一条', () => {
    let s = emptyHistory()
    s = appendSave(s, { content: '一', ts: T0 + 1_000, dev: DEV }).state
    s = appendSave(s, { content: '一二', ts: T0 + 5_000, dev: DEV }).state
    const r = appendSave(s, { content: '一二三', ts: T0 + 20_000, dev: DEV })
    expect(r.action).toBe('merged')
    expect(r.state.records).toHaveLength(1)
    expect(r.state.head).toBe('一二三')
  })

  it('跨桶后新建一条', () => {
    let s = emptyHistory()
    s = appendSave(s, { content: '一', ts: T0 + 1_000, dev: DEV }).state
    const r = appendSave(s, { content: '一二', ts: T0 + 31_000, dev: DEV })
    expect(r.action).toBe('created')
    expect(r.state.records).toHaveLength(2)
  })

  it('【关键】连续两小时不停保存，历史按 30 秒均匀切开而不是挤成一条', () => {
    // 每 5 秒保存一次，连续 2 小时 = 1440 次保存
    let s = emptyHistory()
    let text = ''
    for (let i = 0; i < 1440; i++) {
      text += '字'
      s = appendSave(s, { content: text, ts: T0 + i * 5_000, dev: DEV }).state
    }
    // 2 小时 = 7200 秒 = 240 个 30 秒桶
    expect(s.records).toHaveLength(240)
    expect(s.head).toBe(text)
  })

  it('合并后仍能正确还原到该版本', () => {
    let s = emptyHistory()
    s = appendSave(s, { content: '起点', ts: T0, dev: DEV }).state
    s = appendSave(s, { content: '第二版', ts: T0 + 40_000, dev: DEV }).state
    s = appendSave(s, { content: '第二版改', ts: T0 + 45_000, dev: DEV }).state
    s = appendSave(s, { content: '第二版改了又改', ts: T0 + 55_000, dev: DEV }).state
    expect(s.records).toHaveLength(2)
    expect(reconstruct(s.records, 1)).toBe('起点')
    expect(reconstruct(s.records, 2)).toBe('第二版改了又改')
  })

  it('不同设备即使同桶也不合并（各写各的分片）', () => {
    let s = appendSave(emptyHistory(), { content: '一', ts: T0, dev: 'pc-01' }).state
    const r = appendSave(s, { content: '一二', ts: T0 + 5_000, dev: 'pc-02' })
    expect(r.action).toBe('created')
    expect(r.state.records).toHaveLength(2)
  })

  it('v1 快照被同桶合并后仍是快照', () => {
    let s = appendSave(emptyHistory(), { content: '一', ts: T0, dev: DEV }).state
    const r = appendSave(s, { content: '一二', ts: T0 + 5_000, dev: DEV })
    expect(r.record?.kind).toBe('snapshot')
    expect(r.record?.data).toBe('一二')
  })
})

describe('快照策略', () => {
  it('v1 与每隔 SNAPSHOT_INTERVAL 版存快照', () => {
    expect(shouldSnapshot(1)).toBe(true)
    expect(shouldSnapshot(2)).toBe(false)
    expect(shouldSnapshot(SNAPSHOT_INTERVAL)).toBe(false)
    expect(shouldSnapshot(SNAPSHOT_INTERVAL + 1)).toBe(true)
  })

  it('实际写入时按策略产生快照', () => {
    let s = emptyHistory()
    for (let i = 0; i < SNAPSHOT_INTERVAL + 2; i++) {
      s = appendSave(s, { content: chapter(20 + i), ts: T0 + i * BUCKET_MS, dev: DEV }).state
    }
    const snapshots = s.records.filter((r) => r.kind === 'snapshot').map((r) => r.v)
    expect(snapshots).toEqual([1, SNAPSHOT_INTERVAL + 1])
  })

  it('还原任意版本最多应用 SNAPSHOT_INTERVAL-1 个 patch', () => {
    let s = emptyHistory()
    const texts: string[] = []
    for (let i = 0; i < 120; i++) {
      const t = chapter(20 + i)
      texts.push(t)
      s = appendSave(s, { content: t, ts: T0 + i * BUCKET_MS, dev: DEV }).state
    }
    for (const v of [1, 37, 50, 51, 99, 120]) {
      expect(reconstruct(s.records, v)).toBe(texts[v - 1])
    }
  })
})

describe('reconstruct · 还原', () => {
  it('还原到中间任意一版', () => {
    const s = saveAll([
      ['第一版', T0],
      ['第二版', T0 + BUCKET_MS],
      ['第三版', T0 + BUCKET_MS * 2],
    ])
    expect(reconstruct(s.records, 1)).toBe('第一版')
    expect(reconstruct(s.records, 2)).toBe('第二版')
    expect(reconstruct(s.records, 3)).toBe('第三版')
  })

  it('多行文本增删改都能正确还原', () => {
    const v1 = ['第一章 坠楼', '', '他从四十八楼掉下去。', '完。'].join('\n')
    const v2 = ['第一章 坠楼', '', '他从四十八楼掉下去的时候，脑子里想的不是死。', '', '而是昨天没写完的那一章。'].join('\n')
    const v3 = ['第一章 坠楼', '', '而是昨天没写完的那一章。'].join('\n')
    const s = saveAll([
      [v1, T0],
      [v2, T0 + BUCKET_MS],
      [v3, T0 + BUCKET_MS * 2],
    ])
    expect(reconstruct(s.records, 1)).toBe(v1)
    expect(reconstruct(s.records, 2)).toBe(v2)
    expect(reconstruct(s.records, 3)).toBe(v3)
  })

  it('内容清空再重写也能还原', () => {
    const s = saveAll([
      ['原来的内容', T0],
      ['', T0 + BUCKET_MS],
      ['全新的内容', T0 + BUCKET_MS * 2],
    ])
    expect(reconstruct(s.records, 2)).toBe('')
    expect(reconstruct(s.records, 3)).toBe('全新的内容')
  })

  it('末尾换行的增删能正确还原', () => {
    const s = saveAll([
      ['甲\n', T0],
      ['甲', T0 + BUCKET_MS],
      ['甲\n\n', T0 + BUCKET_MS * 2],
    ])
    expect(reconstruct(s.records, 1)).toBe('甲\n')
    expect(reconstruct(s.records, 2)).toBe('甲')
    expect(reconstruct(s.records, 3)).toBe('甲\n\n')
  })

  it('空记录返回空串', () => {
    expect(reconstruct([], 1)).toBe('')
  })

  it('历史链断掉时抛 HistoryCorruptError 而不是悄悄给错内容', () => {
    const s = saveAll([
      [chapter(20), T0],
      [chapter(21), T0 + BUCKET_MS],
    ])
    expect(s.records[1]?.kind).toBe('patch')
    const broken = s.records.slice(1) // 删掉快照，只剩孤立的增量
    expect(() => reconstruct(broken, 2)).toThrow(HistoryCorruptError)
  })

  it('patch 内容对不上时抛错', () => {
    const s = saveAll([
      [chapter(20), T0],
      [chapter(21), T0 + BUCKET_MS],
    ])
    const corrupted = s.records.map((r) =>
      r.v === 2 ? { ...r, data: '@@ -1,3 +1,3 @@\n-这一行原文里根本不存在\n+替换成别的\n 上下文也是假的\n' } : r,
    )
    expect(() => reconstruct(corrupted, 2)).toThrow(HistoryCorruptError)
  })

  it('patch 格式本身坏掉时也抛我们的错误类型（而不是 jsdiff 的原生异常）', () => {
    const s = saveAll([
      [chapter(20), T0],
      [chapter(21), T0 + BUCKET_MS],
    ])
    const corrupted = s.records.map((r) => (r.v === 2 ? { ...r, data: '@@ 这根本不是补丁格式 @@' } : r))
    expect(() => reconstruct(corrupted, 2)).toThrow(HistoryCorruptError)
  })
})

describe('loadHistory · 从磁盘重建状态', () => {
  it('重建后可继续追加', () => {
    const s1 = saveAll([
      ['一', T0],
      ['一二', T0 + BUCKET_MS],
      ['一二三', T0 + BUCKET_MS * 2],
    ])
    const reloaded = loadHistory(s1.records)
    expect(reloaded.head).toBe('一二三')
    expect(reloaded.beforeLast).toBe('一二')

    const r = appendSave(reloaded, { content: '一二三四', ts: T0 + BUCKET_MS * 3, dev: DEV })
    expect(r.state.records).toHaveLength(4)
    expect(reconstruct(r.state.records, 4)).toBe('一二三四')
  })

  it('重建后同桶合并仍正确', () => {
    const s1 = saveAll([
      ['一', T0],
      ['一二', T0 + BUCKET_MS],
    ])
    const reloaded = loadHistory(s1.records)
    const r = appendSave(reloaded, { content: '一二三', ts: T0 + BUCKET_MS + 5_000, dev: DEV })
    expect(r.action).toBe('merged')
    expect(reconstruct(r.state.records, 2)).toBe('一二三')
    expect(reconstruct(r.state.records, 1)).toBe('一')
  })

  it('乱序输入也能重建', () => {
    const s = saveAll([
      ['一', T0],
      ['一二', T0 + BUCKET_MS],
      ['一二三', T0 + BUCKET_MS * 2],
    ])
    expect(loadHistory([...s.records].reverse()).head).toBe('一二三')
  })

  it('空输入', () => {
    expect(loadHistory([])).toEqual(emptyHistory())
  })
})

describe('listVersions', () => {
  it('计算相对上一版的字数变化', () => {
    const s = saveAll([
      ['一二三', T0],
      ['一二', T0 + BUCKET_MS],
      ['一二三四五', T0 + BUCKET_MS * 2],
    ])
    expect(listVersions(s.records).map((e) => e.delta)).toEqual([3, -1, 3])
  })

  it('不含 data 字段（列表不该把全文塞进内存）', () => {
    const s = saveAll([['一', T0]])
    expect(listVersions(s.records)[0]).not.toHaveProperty('data')
  })

  it('带 label 的版本保留 label', () => {
    let s = appendSave(emptyHistory(), { content: '一', ts: T0, dev: DEV, label: '开篇' }).state
    expect(listVersions(s.records)[0]?.label).toBe('开篇')
  })
})

describe('rollback · 回滚', () => {
  it('回滚到旧版本', () => {
    const s = saveAll([
      ['第一版', T0],
      ['第二版', T0 + BUCKET_MS],
      ['第三版', T0 + BUCKET_MS * 2],
    ])
    const r = rollback(s, 1, { ts: T0 + BUCKET_MS * 3, dev: DEV })
    expect(r.state.head).toBe('第一版')
  })

  it('回滚本身产生新版本，因此可以再撤销', () => {
    const s = saveAll([
      ['第一版', T0],
      ['第二版', T0 + BUCKET_MS],
    ])
    const back = rollback(s, 1, { ts: T0 + BUCKET_MS * 2, dev: DEV })
    expect(back.state.records).toHaveLength(3)

    // 后悔了，再回到第二版
    const again = rollback(back.state, 2, { ts: T0 + BUCKET_MS * 3, dev: DEV })
    expect(again.state.head).toBe('第二版')
    expect(again.state.records).toHaveLength(4)
  })

  it('默认打上说明性的 label', () => {
    const s = saveAll([
      ['第一版', T0],
      ['第二版', T0 + BUCKET_MS],
    ])
    const r = rollback(s, 1, { ts: T0 + BUCKET_MS * 2, dev: DEV })
    expect(r.record?.label).toBe('回滚到第 1 版')
  })
})

describe('容量管理', () => {
  it('计算字节数（UTF-8）', () => {
    const s = saveAll([['一二三', T0]])
    expect(historySizeBytes(s.records)).toBeGreaterThan(0)
  })

  it('80% 以下为 ok', () => {
    expect(capacityStatus(50 * 1024 * 1024, 100).level).toBe('ok')
  })

  it('达到 80% 转为 warn', () => {
    expect(capacityStatus(80 * 1024 * 1024, 100).level).toBe('warn')
    expect(capacityStatus(99 * 1024 * 1024, 100).level).toBe('warn')
  })

  it('达到 100% 转为 full', () => {
    expect(capacityStatus(100 * 1024 * 1024, 100).level).toBe('full')
    expect(capacityStatus(200 * 1024 * 1024, 100).level).toBe('full')
  })

  it('上限为 0 时不报 full（视为不限制）', () => {
    expect(capacityStatus(999, 0).level).toBe('ok')
  })
})

describe('prune · 清理', () => {
  const build = () => {
    let s = emptyHistory()
    const texts: string[] = []
    for (let i = 1; i <= 10; i++) {
      const t = `第${i}版`
      texts.push(t)
      s = appendSave(s, {
        content: t,
        ts: T0 + i * BUCKET_MS,
        dev: DEV,
        ...(i === 4 || i === 8 ? { label: `标记${i}` } : {}),
      }).state
    }
    return { s, texts }
  }

  it('清理后最早保留的一版被转成快照，链不断', () => {
    const { s } = build()
    const pruned = prune(s.records, (r) => r.v >= 5)
    expect(pruned[0]?.kind).toBe('snapshot')
    expect(reconstruct(pruned, 5)).toBe('第5版')
    expect(reconstruct(pruned, 10)).toBe('第10版')
  })

  it('清理后每一个保留版本都仍能正确还原', () => {
    const { s, texts } = build()
    const pruned = prune(s.records, (r) => r.v % 3 === 0)
    for (const r of pruned) {
      expect(reconstruct(pruned, r.v)).toBe(texts[r.v - 1])
    }
  })

  it('pruneKeepLabeled 只留带标记的和最新一版', () => {
    const { s } = build()
    const pruned = pruneKeepLabeled(s.records)
    expect(pruned.map((r) => r.v)).toEqual([4, 8, 10])
    expect(reconstruct(pruned, 4)).toBe('第4版')
    expect(reconstruct(pruned, 10)).toBe('第10版')
  })

  it('pruneOlderThan 删掉旧版本但保留带标记的', () => {
    const { s } = build()
    const cutoff = T0 + 7 * BUCKET_MS
    const pruned = pruneOlderThan(s.records, cutoff)
    // 4 带标记所以保留；7 及之后按时间保留
    expect(pruned.map((r) => r.v)).toEqual([4, 7, 8, 9, 10])
    expect(reconstruct(pruned, 10)).toBe('第10版')
  })

  it('全部删光返回空数组，不抛异常', () => {
    const { s } = build()
    expect(prune(s.records, () => false)).toEqual([])
  })

  it('全部保留时内容不变', () => {
    const { s, texts } = build()
    const pruned = prune(s.records, () => true)
    expect(pruned).toHaveLength(10)
    expect(reconstruct(pruned, 10)).toBe(texts[9])
  })
})

describe('jsonl 读写', () => {
  it('往返一致', () => {
    const s = saveAll([
      ['一', T0],
      ['一二', T0 + BUCKET_MS],
    ])
    expect(parseHistoryJsonl(toHistoryJsonl(s.records))).toEqual(s.records)
  })

  it('坏行跳过', () => {
    const s = saveAll([['一', T0]])
    const text = toHistoryJsonl(s.records) + '这是坏行{{{\n'
    expect(parseHistoryJsonl(text)).toHaveLength(1)
  })

  it('空记录序列化为空串', () => {
    expect(toHistoryJsonl([])).toBe('')
    expect(parseHistoryJsonl('')).toEqual([])
  })

  it('含换行的正文序列化后仍能还原', () => {
    const s = saveAll([
      ['第一行\n第二行', T0],
      ['第一行\n第二行\n第三行', T0 + BUCKET_MS],
    ])
    const round = parseHistoryJsonl(toHistoryJsonl(s.records))
    expect(reconstruct(round, 2)).toBe('第一行\n第二行\n第三行')
  })
})

describe('真实写作场景模拟', () => {
  it('写一章 3000 字、200 次保存后能回到任意时刻', () => {
    let s = emptyHistory()
    const snapshots: Array<{ v: number; text: string }> = []
    let text = ''
    for (let i = 0; i < 200; i++) {
      text += `这是第${i}段内容，写了一些字。`
      const r = appendSave(s, { content: text, ts: T0 + i * BUCKET_MS, dev: DEV })
      s = r.state
      if (r.record) snapshots.push({ v: r.record.v, text })
    }
    expect(s.records).toHaveLength(200)
    for (const { v, text: expected } of [snapshots[0]!, snapshots[36]!, snapshots[99]!, snapshots[199]!]) {
      expect(reconstruct(s.records, v)).toBe(expected)
    }
  })

  it('分段正文的增量存储比全量省一个数量级', () => {
    // 真实中文小说：段落之间有空行。改一段不影响其他段。
    let s = emptyHistory()
    const paras: string[] = []
    for (let i = 0; i < 100; i++) {
      paras.push(`这是第${i}段。他从四十八楼掉下去的时候，脑子里想的不是死，而是昨天没写完的那一章。`)
      s = appendSave(s, { content: paras.join('\n\n'), ts: T0 + i * BUCKET_MS, dev: DEV }).state
    }
    const incremental = historySizeBytes(s.records)
    const fullCopies = s.records.length * new TextEncoder().encode(paras.join('\n\n')).length
    expect(incremental).toBeLessThan(fullCopies / 10)
  })

  it('【保险阀】即使正文是不换行的超长单段，占用也不超过每版存全文', () => {
    // unified diff 按行比对，单行不断变长是最坏情况。
    // 保险阀会在增量不划算时改存快照，保证不劣于全量。
    let s = emptyHistory()
    let text = '起始内容。'
    for (let i = 0; i < 100; i++) {
      text += `追加第${i}句。`
      s = appendSave(s, { content: text, ts: T0 + i * BUCKET_MS, dev: DEV }).state
    }
    const incremental = historySizeBytes(s.records)
    const fullCopies = s.records.length * new TextEncoder().encode(text).length
    expect(incremental).toBeLessThanOrEqual(fullCopies)
  })

  it('保险阀触发后仍能正确还原任意版本', () => {
    let s = emptyHistory()
    const texts: string[] = []
    let text = ''
    for (let i = 0; i < 40; i++) {
      text += `不换行地一直追加第${i}句。`
      texts.push(text)
      s = appendSave(s, { content: text, ts: T0 + i * BUCKET_MS, dev: DEV }).state
    }
    // 应当出现了额外的快照
    expect(s.records.filter((r) => r.kind === 'snapshot').length).toBeGreaterThan(1)
    for (const v of [1, 7, 20, 40]) {
      expect(reconstruct(s.records, v)).toBe(texts[v - 1])
    }
  })
})

describe('normalizeHistory · 仅追加文件里的重复版本号', () => {
  // 同一时间桶内多次保存会重写同一个版本号，而文件是仅追加的，
  // 于是磁盘上会出现两条 v 相同的记录 —— 后写的才是真的。
  const dup = (): HistoryRecord[] => [
    { schemaVersion: 1, v: 1, ts: T0, dev: DEV, kind: 'snapshot', chars: 3, data: '第一版' },
    { schemaVersion: 1, v: 1, ts: T0, dev: DEV, kind: 'snapshot', chars: 5, data: '第一版改过' },
  ]

  it('同版本号只留最后一条', () => {
    const n = normalizeHistory(dup())
    expect(n).toHaveLength(1)
    expect(n[0]?.data).toBe('第一版改过')
  })

  it('reconstruct 能正确处理重复版本号，不误报损坏', () => {
    expect(reconstruct(dup(), 1)).toBe('第一版改过')
  })

  it('loadHistory 能正确处理', () => {
    expect(loadHistory(dup()).head).toBe('第一版改过')
  })

  it('listVersions 不重复列出同一版本', () => {
    expect(listVersions(dup())).toHaveLength(1)
  })

  it('乱序输入时仍按文件顺序取最后一条', () => {
    const records: HistoryRecord[] = [
      { schemaVersion: 1, v: 2, ts: T0, dev: DEV, kind: 'snapshot', chars: 3, data: '第二版' },
      { schemaVersion: 1, v: 1, ts: T0, dev: DEV, kind: 'snapshot', chars: 3, data: '第一版' },
      { schemaVersion: 1, v: 1, ts: T0, dev: DEV, kind: 'snapshot', chars: 5, data: '第一版改过' },
    ]
    const n = normalizeHistory(records)
    expect(n.map((r) => r.v)).toEqual([1, 2])
    expect(n[0]?.data).toBe('第一版改过')
  })

  it('没有重复时原样返回', () => {
    const s = saveAll([
      [chapter(20), T0],
      [chapter(21), T0 + BUCKET_MS],
    ])
    expect(normalizeHistory(s.records)).toEqual(s.records)
  })
})
