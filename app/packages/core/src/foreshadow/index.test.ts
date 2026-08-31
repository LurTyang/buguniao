import { describe, it, expect } from 'vitest'
import {
  generateForeshadowId,
  isForeshadowId,
  parseAnchors,
  wrapAnchor,
  unwrapAnchor,
  stripAllAnchors,
  mergeRecords,
  parseJsonl,
  toJsonlLine,
  createRecord,
  createPatchRecord,
  buildList,
  pendingOnly,
  dueForeshadows,
} from './index.js'
import type { ForeshadowRecord } from '../types/index.js'

describe('伏笔 id', () => {
  it('格式为 f + 6 位 base36', () => {
    expect(generateForeshadowId(() => 0.5)).toBe('fiiiiii')
    expect(generateForeshadowId()).toMatch(/^f[0-9a-z]{6}$/)
  })

  it('isForeshadowId 校验', () => {
    expect(isForeshadowId('f7k2p9x')).toBe(true) // f + 6 位
    expect(isForeshadowId('x7k2p9x')).toBe(false) // 前缀错
    expect(isForeshadowId('f7k2p9')).toBe(false) // 只有 5 位
    expect(isForeshadowId('f7k2p9xy')).toBe(false) // 7 位
    expect(isForeshadowId('f7K2p9x')).toBe(false) // 大写不合法
  })

  it('生成的 id 一定通过校验', () => {
    for (let i = 0; i < 200; i++) expect(isForeshadowId(generateForeshadowId())).toBe(true)
  })
})

describe('parseAnchors · 正文锚点', () => {
  it('解析一个埋点', () => {
    const body = '他摸了摸胸口，<!--埋#f7k2p9-->那块玉佩还在<!--/埋#f7k2p9-->。'
    const a = parseAnchors(body)
    expect(a).toHaveLength(1)
    expect(a[0]?.id).toBe('f7k2p9')
    expect(a[0]?.kind).toBe('plant')
    expect(a[0]?.text).toBe('那块玉佩还在')
  })

  it('解析一个收点', () => {
    const body = '<!--收#f7k2p9-->玉佩碎成两半<!--/收#f7k2p9-->'
    const a = parseAnchors(body)
    expect(a[0]?.kind).toBe('recover')
    expect(a[0]?.text).toBe('玉佩碎成两半')
  })

  it('区间可用于精确切片', () => {
    const body = '前文<!--埋#fabc123-->被包的内容<!--/埋#fabc123-->后文'
    const a = parseAnchors(body)[0]!
    expect(body.slice(a.start, a.end)).toBe('被包的内容')
    expect(body.slice(a.outerStart, a.outerEnd)).toBe(
      '<!--埋#fabc123-->被包的内容<!--/埋#fabc123-->',
    )
  })

  it('允许嵌套（开闭都带 id，不依赖栈）', () => {
    const body = '<!--埋#faaa111-->外层<!--埋#fbbb222-->内层<!--/埋#fbbb222-->尾<!--/埋#faaa111-->'
    const a = parseAnchors(body)
    expect(a.map((x) => x.id)).toEqual(['faaa111', 'fbbb222'])
    expect(a[1]?.text).toBe('内层')
    expect(a[0]?.text).toContain('内层')
  })

  it('允许交叉', () => {
    const body = '<!--埋#faaa111-->甲<!--埋#fbbb222-->乙<!--/埋#faaa111-->丙<!--/埋#fbbb222-->'
    expect(parseAnchors(body).map((x) => x.id).sort()).toEqual(['faaa111', 'fbbb222'])
  })

  it('未闭合的开标记被忽略', () => {
    expect(parseAnchors('<!--埋#f7k2p9-->后面没有闭合')).toEqual([])
  })

  it('同一 id 的埋点与收点分别识别', () => {
    const body = '<!--埋#f7k2p9-->埋<!--/埋#f7k2p9-->……<!--收#f7k2p9-->收<!--/收#f7k2p9-->'
    const a = parseAnchors(body)
    expect(a.map((x) => x.kind)).toEqual(['plant', 'recover'])
  })

  it('一个伏笔可以有多个回收点', () => {
    const body =
      '<!--收#f7k2p9-->第一次<!--/收#f7k2p9-->中间<!--收#f7k2p9-->第二次<!--/收#f7k2p9-->'
    expect(parseAnchors(body)).toHaveLength(2)
  })

  it('结果按出现位置排序', () => {
    const body = '<!--收#fbbb222-->乙<!--/收#fbbb222--><!--埋#faaa111-->甲<!--/埋#faaa111-->'
    expect(parseAnchors(body).map((x) => x.id)).toEqual(['fbbb222', 'faaa111'])
  })

  it('普通 HTML 注释不被误认', () => {
    expect(parseAnchors('<!-- 这只是我的备注 -->')).toEqual([])
  })

  it('无标记的正文返回空数组', () => {
    expect(parseAnchors('干净的正文')).toEqual([])
  })
})

describe('wrapAnchor / unwrapAnchor', () => {
  const body = '他摸了摸胸口，那块玉佩还在。'

  it('包上埋点标记', () => {
    const out = wrapAnchor(body, { start: 7, end: 13 }, 'plant', 'f7k2p9')
    expect(out).toBe('他摸了摸胸口，<!--埋#f7k2p9-->那块玉佩还在<!--/埋#f7k2p9-->。')
    expect(parseAnchors(out)[0]?.text).toBe('那块玉佩还在')
  })

  it('包上收点标记', () => {
    const out = wrapAnchor(body, { start: 0, end: 2 }, 'recover', 'f7k2p9')
    expect(parseAnchors(out)[0]?.kind).toBe('recover')
  })

  it('拆掉标记后完全还原', () => {
    const wrapped = wrapAnchor(body, { start: 7, end: 13 }, 'plant', 'f7k2p9')
    expect(unwrapAnchor(wrapped, 'f7k2p9')).toBe(body)
  })

  it('只拆指定类型', () => {
    let s = wrapAnchor(body, { start: 0, end: 2 }, 'plant', 'faaa111')
    s = wrapAnchor(s, { start: s.length, end: s.length }, 'recover', 'faaa111')
    const onlyPlantRemoved = unwrapAnchor(s, 'faaa111', 'plant')
    expect(onlyPlantRemoved).toContain('<!--收#faaa111-->')
    expect(onlyPlantRemoved).not.toContain('<!--埋#faaa111-->')
  })

  it('拆不存在的 id 不改变正文', () => {
    expect(unwrapAnchor(body, 'fzzz999')).toBe(body)
  })

  it('包裹空区间也合法（用于「先记后写」时占位）', () => {
    const out = wrapAnchor('甲乙', { start: 1, end: 1 }, 'plant', 'faaa111')
    expect(parseAnchors(out)[0]?.text).toBe('')
  })
})

describe('stripAllAnchors · 导出时清理', () => {
  it('移除所有标记但保留文字', () => {
    const body =
      '前<!--埋#faaa111-->甲<!--/埋#faaa111-->中<!--收#fbbb222-->乙<!--/收#fbbb222-->后'
    expect(stripAllAnchors(body)).toBe('前甲中乙后')
  })

  it('未闭合的孤立标记也被清掉', () => {
    expect(stripAllAnchors('正文<!--埋#faaa111-->')).toBe('正文')
  })

  it('普通注释保留（那是作者自己的备注）', () => {
    expect(stripAllAnchors('正文<!-- 备注 -->')).toBe('正文<!-- 备注 -->')
  })
})

describe('mergeRecords · 多设备分片合并', () => {
  const R = (o: Partial<ForeshadowRecord> & { id: string; ts: number }): ForeshadowRecord => ({
    schemaVersion: 1,
    dev: 'pc-01',
    ...o,
  })

  it('单条记录直接成型', () => {
    const [f] = mergeRecords([R({ id: 'f1', ts: 100, title: '玉佩', status: 'planted' })])
    expect(f?.title).toBe('玉佩')
    expect(f?.status).toBe('planted')
  })

  it('后写的字段覆盖先写的', () => {
    const [f] = mergeRecords([
      R({ id: 'f1', ts: 100, title: '玉佩', status: 'planted' }),
      R({ id: 'f1', ts: 200, status: 'recovered', recoveredIn: ['ch-x'] }),
    ])
    expect(f?.status).toBe('recovered')
    expect(f?.title).toBe('玉佩') // 没被后一条提到的字段保持不变
    expect(f?.recoveredIn).toEqual(['ch-x'])
  })

  it('输入顺序打乱也按 ts 正确合并', () => {
    const [f] = mergeRecords([
      R({ id: 'f1', ts: 300, status: 'recovered' }),
      R({ id: 'f1', ts: 100, title: '玉佩', status: 'planted' }),
      R({ id: 'f1', ts: 200, priority: 'high' }),
    ])
    expect(f?.status).toBe('recovered')
    expect(f?.priority).toBe('high')
    expect(f?.updatedAt).toBe(300)
  })

  it('两台设备各写各的能正确合并', () => {
    const pc = [R({ id: 'f1', ts: 100, dev: 'pc-01', title: '玉佩' })]
    const laptop = [R({ id: 'f2', ts: 150, dev: 'pc-02', title: '断眉' })]
    const merged = mergeRecords([...pc, ...laptop])
    expect(merged.map((f) => f.title).sort()).toEqual(['断眉', '玉佩'])
  })

  it('ts 相同时按传入顺序，结果稳定', () => {
    const a = mergeRecords([R({ id: 'f1', ts: 100, title: 'A' }), R({ id: 'f1', ts: 100, title: 'B' })])
    const b = mergeRecords([R({ id: 'f1', ts: 100, title: 'A' }), R({ id: 'f1', ts: 100, title: 'B' })])
    expect(a[0]?.title).toBe('B')
    expect(a).toEqual(b)
  })

  it('缺省字段填默认值', () => {
    const [f] = mergeRecords([R({ id: 'f1', ts: 100 })])
    expect(f).toMatchObject({
      title: '',
      desc: '',
      plantedIn: null,
      expectBy: null,
      status: 'planned',
      priority: 'normal',
      recoveredIn: [],
    })
  })

  it('空输入返回空数组', () => {
    expect(mergeRecords([])).toEqual([])
  })
})

describe('parseJsonl · 容错', () => {
  it('解析多行', () => {
    const text = [
      '{"schemaVersion":1,"id":"f1","ts":100,"dev":"pc-01","title":"甲"}',
      '{"schemaVersion":1,"id":"f2","ts":200,"dev":"pc-01","title":"乙"}',
    ].join('\n')
    expect(parseJsonl(text)).toHaveLength(2)
  })

  it('坏行跳过，不毁掉整个清单', () => {
    const text = [
      '{"schemaVersion":1,"id":"f1","ts":100,"dev":"pc-01"}',
      '这是一行被写坏的垃圾{{{',
      '{"schemaVersion":1,"id":"f2","ts":200,"dev":"pc-01"}',
    ].join('\n')
    expect(parseJsonl(text).map((r) => r.id)).toEqual(['f1', 'f2'])
  })

  it('缺 id 或缺 ts 的行跳过', () => {
    const text = ['{"ts":100}', '{"id":"f1"}', '{"id":"f2","ts":200}'].join('\n')
    expect(parseJsonl(text).map((r) => r.id)).toEqual(['f2'])
  })

  it('空行与末尾换行不影响', () => {
    expect(parseJsonl('\n\n{"id":"f1","ts":1}\n\n')).toHaveLength(1)
  })

  it('CRLF 也能解析', () => {
    expect(parseJsonl('{"id":"f1","ts":1}\r\n{"id":"f2","ts":2}\r\n')).toHaveLength(2)
  })

  it('空文件返回空数组', () => {
    expect(parseJsonl('')).toEqual([])
  })

  it('往返一致', () => {
    const rec = createRecord({ id: 'f7k2p9', dev: 'pc-01', ts: 100, title: '玉佩' })
    expect(parseJsonl(toJsonlLine(rec))[0]).toEqual(rec)
  })
})

describe('createRecord / createPatchRecord', () => {
  it('填了 plantedIn 时状态默认为 planted', () => {
    const r = createRecord({ id: 'f1', dev: 'pc', ts: 1, title: '甲', plantedIn: 'ch-x' })
    expect(r.status).toBe('planted')
  })

  it('没填 plantedIn 时状态默认为 planned（先记后写）', () => {
    const r = createRecord({ id: 'f1', dev: 'pc', ts: 1, title: '甲' })
    expect(r.status).toBe('planned')
    expect(r.plantedIn).toBeNull()
  })

  it('patch 记录只带变化字段', () => {
    const p = createPatchRecord('f1', 'pc', 200, { status: 'recovered' })
    expect(Object.keys(p).sort()).toEqual(['dev', 'id', 'schemaVersion', 'status', 'ts'])
  })

  it('先记后写的完整流程', () => {
    const created = createRecord({ id: 'f1', dev: 'pc', ts: 100, title: '玉佩' })
    const planted = createPatchRecord('f1', 'pc', 200, { plantedIn: 'ch-a', status: 'planted' })
    const recovered = createPatchRecord('f1', 'pc', 300, {
      status: 'recovered',
      recoveredIn: ['ch-z'],
    })
    const [f] = mergeRecords([created, planted, recovered])
    expect(f).toMatchObject({
      title: '玉佩',
      plantedIn: 'ch-a',
      status: 'recovered',
      recoveredIn: ['ch-z'],
    })
  })
})

describe('buildList · 清单视图', () => {
  const order = ['ch-1', 'ch-2', 'ch-3', 'ch-4', 'ch-5']
  const recs: ForeshadowRecord[] = [
    { schemaVersion: 1, id: 'fa', ts: 1, dev: 'pc', title: '玉佩', plantedIn: 'ch-1', status: 'planted', priority: 'normal' },
    { schemaVersion: 1, id: 'fb', ts: 2, dev: 'pc', title: '断眉', plantedIn: 'ch-3', status: 'planted', priority: 'high' },
    { schemaVersion: 1, id: 'fc', ts: 3, dev: 'pc', title: '师门', status: 'planned', priority: 'low' },
    { schemaVersion: 1, id: 'fd', ts: 4, dev: 'pc', title: '已收', plantedIn: 'ch-2', status: 'recovered', priority: 'normal' },
  ]
  const fs = mergeRecords(recs)

  it('按优先级排序，高优先在前', () => {
    const list = buildList(fs, order, 'ch-5')
    expect(list[0]?.title).toBe('断眉')
  })

  it('同优先级时埋得越早越靠前', () => {
    const list = buildList(fs, order, 'ch-5').filter((f) => f.priority === 'normal')
    expect(list.map((f) => f.title)).toEqual(['玉佩', '已收'])
  })

  it('计算「已经过去多少章」', () => {
    const list = buildList(fs, order, 'ch-5')
    expect(list.find((f) => f.title === '玉佩')?.chaptersElapsed).toBe(4) // ch-1 → ch-5
    expect(list.find((f) => f.title === '断眉')?.chaptersElapsed).toBe(2) // ch-3 → ch-5
  })

  it('未埋入正文的伏笔无章节数', () => {
    const list = buildList(fs, order, 'ch-5')
    const f = list.find((x) => x.title === '师门')
    expect(f?.plantedIndex).toBeNull()
    expect(f?.chaptersElapsed).toBeNull()
  })

  it('不传 currentDocId 时不算章节数', () => {
    expect(buildList(fs, order)[0]?.chaptersElapsed).toBeNull()
  })

  it('埋点在当前章之后时不出现负数', () => {
    const list = buildList(fs, order, 'ch-1')
    expect(list.find((f) => f.title === '断眉')?.chaptersElapsed).toBe(0)
  })

  it('pendingOnly 只留未回收的', () => {
    const pending = pendingOnly(buildList(fs, order, 'ch-5'))
    expect(pending.map((f) => f.title).sort()).toEqual(['师门', '断眉', '玉佩'])
  })
})

describe('dueForeshadows · 到期提醒', () => {
  const order = ['ch-1', 'ch-2', 'ch-3', 'ch-4']
  const fs = mergeRecords([
    { schemaVersion: 1, id: 'fa', ts: 1, dev: 'pc', title: '该收了', plantedIn: 'ch-1', expectBy: 'ch-2', status: 'planted' },
    { schemaVersion: 1, id: 'fb', ts: 2, dev: 'pc', title: '还早', plantedIn: 'ch-1', expectBy: 'ch-4', status: 'planted' },
    { schemaVersion: 1, id: 'fc', ts: 3, dev: 'pc', title: '自由文本', plantedIn: 'ch-1', expectBy: '第三卷', status: 'planted' },
    { schemaVersion: 1, id: 'fd', ts: 4, dev: 'pc', title: '已收', plantedIn: 'ch-1', expectBy: 'ch-2', status: 'recovered' },
  ])
  const list = buildList(fs, order, 'ch-3')

  it('写到计划回收点之后时提醒', () => {
    expect(dueForeshadows(list, order, 'ch-3').map((f) => f.title)).toEqual(['该收了'])
  })

  it('恰好写到计划回收点当章也提醒', () => {
    expect(dueForeshadows(list, order, 'ch-2').map((f) => f.title)).toEqual(['该收了'])
  })

  it('还没到时不提醒', () => {
    expect(dueForeshadows(list, order, 'ch-1')).toEqual([])
  })

  it('expectBy 是自由文本时不提醒（仅作展示）', () => {
    expect(dueForeshadows(list, order, 'ch-4').map((f) => f.title)).not.toContain('自由文本')
  })

  it('已回收的不提醒', () => {
    expect(dueForeshadows(list, order, 'ch-4').map((f) => f.title)).not.toContain('已收')
  })

  it('当前章不在目录中时返回空', () => {
    expect(dueForeshadows(list, order, 'ch-不存在')).toEqual([])
  })
})
