/**
 * 老配置搬新形状。
 *
 * 这一层是为了一个真实事故加的：0.4 中途把 `smartRules` 从
 * 「开关对象」改成了「规则数组」，升级上来的配置里还是对象，
 * 渲染进程一调 `.filter` 就炸 —— **打开任何书都是一片纯白**。
 *
 * 本地永远试不出来，因为本地是干净配置。所以这些用例全是
 * 「拿一份老配置喂进去」。
 */

import { describe, expect, it } from 'vitest'
import { migrateConfig, migrateSmartRules, migrateThemeSlots } from './config-migrate.js'

describe('标点替换规则', () => {
  it('【关键】老的开关对象要被换掉 —— 留着它渲染进程会当场炸', () => {
    const patch = migrateConfig({ smartRules: { 'quote-curly': true, dash: false } })
    // 只要不是「对象但不是数组」就行 —— 那种形状一调 .filter 就炸
    const v = patch['smartRules']
    expect('smartRules' in patch).toBe(true)
    expect(Array.isArray(v) || v === null).toBe(true)
  })

  it('老的开关对象翻译不过来，就当没配过', () => {
    expect(migrateSmartRules({ smartRules: { 'quote-curly': false } })).toBeNull()
  })

  it('已经是数组就原样留着', () => {
    const rules = [{ id: 'a', kind: 'plain', from: ';', to: '：' }]
    expect(migrateSmartRules({ smartRules: rules })).toEqual(rules)
  })

  it('成对规则也认', () => {
    const rules = [{ id: 'a', kind: 'pair', from: '"', open: '「', close: '」' }]
    expect(migrateSmartRules({ smartRules: rules })).toEqual(rules)
  })

  it('数组里混进坏东西就丢掉那一条，不整份作废', () => {
    const r = migrateSmartRules({
      smartRules: [null, { id: '', from: 'x' }, { id: 'a', kind: 'plain', from: ';', to: '：' }],
    })
    expect(r).toEqual([{ id: 'a', kind: 'plain', from: ';', to: '：' }])
  })

  it('自定义那几条能搬就搬', () => {
    const r = migrateSmartRules({
      customRules: [{ id: 'c1', from: '~~', to: '～', enabled: true }],
    })
    expect(r).toEqual([{ id: 'c1', kind: 'plain', from: '~~', to: '～' }])
  })

  it('停用的不搬 —— 新模型里存在即生效，停用等于不要', () => {
    expect(
      migrateSmartRules({ customRules: [{ id: 'c1', from: '~~', to: '～', enabled: false }] }),
    ).toBeNull()
  })

  it('全新的配置什么都不用改', () => {
    expect(migrateConfig({ smartRules: null })).toEqual({})
    expect(migrateConfig({})).toEqual({})
  })
})

describe('自定义主题栏位的历次搬家', () => {
  it('老的单个 themeCss 搬到第一格，并且顺手起个名', () => {
    const r = migrateThemeSlots({ themeCss: 'D:/x/phycat-mint.css' })
    expect(r?.themeCssActive).toBe(0)
    expect(r?.themeCssSlots[0]).toEqual({
      path: 'D:/x/phycat-mint.css',
      draft: null,
      name: 'phycat mint',
      color: '',
    })
    // 后面跟着一个空位 —— 那就是「再加一份」的按钮
    expect(r?.themeCssSlots.length).toBe(2)
    expect(r?.themeCssSlots[1]?.path).toBe('')
  })

  it('0.4 中途那版的字符串槽位也要搬成带名字的对象', () => {
    const r = migrateThemeSlots({ themeCssSlots: ['D:/a/night-owl.css', '', ''], themeCssActive: 0 })
    expect(r?.themeCssSlots[0]).toEqual({
      path: 'D:/a/night-owl.css',
      draft: null,
      name: 'night owl',
      color: '',
    })
  })

  it('【关键】三个固定槽位搬成会长的一排：中间的空位挤掉，末尾只留一个', () => {
    const r = migrateThemeSlots({
      themeCssSlots: [
        { path: 'a.css', name: 'A', color: '#fff' },
        { path: '', name: '', color: '' },
        { path: 'b.css', name: 'B', color: '#000' },
      ],
      themeCssActive: 2,
    })
    expect(r?.themeCssSlots.map((s) => s.name)).toEqual(['A', 'B', ''])
  })

  it('【关键】搬家时自制主题那一格原样带过去 —— 草稿丢了就是配色丢了', () => {
    const draft = { name: '夜航船', font: '', vars: { '--bg-color': '#123' } }
    // 混着老形状（第二格没有 draft 键），所以会真的走一次搬家
    const r = migrateThemeSlots({
      themeCssSlots: [{ path: '', draft, name: '夜航船', color: '#123' }, { path: '' }],
    })
    expect(r?.themeCssSlots[0]?.draft).toEqual(draft)
    expect(r?.themeCssSlots[0]?.name).toBe('夜航船')
    expect(r?.themeCssSlots.length).toBe(2)
  })

  it('已经是新形状就不动 —— 不然每次启动都白写一遍盘', () => {
    expect(
      migrateThemeSlots({
        themeCssSlots: [
          { path: 'a', draft: null, name: 'A', color: '' },
          { path: '', draft: null, name: '', color: '' },
        ],
      }),
    ).toBeNull()
  })

  it('从来没配过自选样式的，什么都不做', () => {
    expect(migrateThemeSlots({ themeCss: '' })).toBeNull()
    expect(migrateThemeSlots({})).toBeNull()
  })
})

describe('整体', () => {
  it('一份 0.3 的老配置搬完之后不会让人白屏', () => {
    const old = {
      theme: 'dark',
      themeCss: 'D:/x/mint.css',
      smartRules: { 'quote-curly': true },
      customRules: [{ id: 'c1', from: '~~', to: '～', enabled: true }],
    }
    const patch = migrateConfig(old)
    // 老的开关表翻译不过来（丢掉），但他自己加的那条要搬过来
    expect(patch['smartRules']).toEqual([{ id: 'c1', kind: 'plain', from: '~~', to: '～' }])
    expect(patch['themeCssActive']).toBe(0)
    expect((patch['themeCssSlots'] as Array<{ name: string }>)[0]?.name).toBe('mint')
    // 搬完之后 smartRules 绝不能还是个「对象但不是数组」
    const v = patch['smartRules']
    expect(Array.isArray(v) || v === null).toBe(true)
  })
})
