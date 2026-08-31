import { describe, it, expect } from 'vitest'
import {
  aliasesFromBody,
  buildCast,
  canonicalName,
  emptyCast,
  guessCastCategories,
  knownName,
  nameFromCardTitle,
} from './index.js'

describe('猜人物分类', () => {
  it('认出常见叫法', () => {
    expect(guessCastCategories(['人物', '地点', '势力', '角色卡'])).toEqual(['人物', '角色卡'])
  })

  it('拆成主次两个文件夹的也都认', () => {
    expect(guessCastCategories(['主要人物', '次要人物', '道具'])).toEqual(['主要人物', '次要人物'])
  })

  it('一个都不像就返回空 —— 宁可让作者自己勾', () => {
    expect(guessCastCategories(['世界观', '时间线'])).toEqual([])
  })
})

describe('从卡片名抠名字', () => {
  it('去掉编号', () => {
    expect(nameFromCardTitle('01-李四')).toBe('李四')
    expect(nameFromCardTitle('3. 王五')).toBe('王五')
  })

  it('去掉括号补充', () => {
    expect(nameFromCardTitle('李四（男主）')).toBe('李四')
    expect(nameFromCardTitle('王五【反派】')).toBe('王五')
  })

  it('干净的名字原样留着', () => {
    expect(nameFromCardTitle('穿灰袍的老人')).toBe('穿灰袍的老人')
  })
})

describe('别名', () => {
  it('认几种常见写法', () => {
    expect(aliasesFromBody('别名：小李、李哥')).toEqual(['小李', '李哥'])
    expect(aliasesFromBody('又名: 老王')).toEqual(['老王'])
    expect(aliasesFromBody('绰号：刀疤')).toEqual(['刀疤'])
  })

  it('夹在正文里也找得到', () => {
    const body = ['# 李四', '', '年龄：28', '别名：小李 李哥', '', '正文正文'].join('\n')
    expect(aliasesFromBody(body)).toEqual(['小李', '李哥'])
  })

  it('没有别名行就是空', () => {
    expect(aliasesFromBody('年龄：28\n身高：180')).toEqual([])
  })
})

describe('buildCast', () => {
  const cast = buildCast([
    { title: '01-李四（男主）', body: '别名：小李、李哥' },
    { title: '王五' },
  ])

  it('正名进名单', () => {
    expect(cast.names).toContain('李四')
    expect(cast.names).toContain('王五')
  })

  it('别名也进名单，并且归得回正名', () => {
    expect(knownName(cast, '小李')).toBe(true)
    expect(canonicalName(cast, '小李')).toBe('李四')
  })

  it('原样的卡片名也认', () => {
    expect(knownName(cast, '01-李四（男主）')).toBe(true)
  })

  it('不在名单里的原样返回', () => {
    expect(knownName(cast, '赵六')).toBe(false)
    expect(canonicalName(cast, '赵六')).toBe('赵六')
  })

  it('【关键】带标点的卡片名不当名字', () => {
    // 作者拿卡片名写了一句话，混进名单就会把一整句叙述排成角色名
    const c = buildCast([{ title: '这一段要重写，先放着' }])
    expect(c.names).toEqual([])
  })

  it('【关键】太长的卡片名不当名字', () => {
    const c = buildCast([{ title: '关于主角家庭背景的补充说明' }])
    expect(c.names).toEqual([])
  })

  it('重名的卡片只算一次，先来的说了算', () => {
    const c = buildCast([{ title: '李四' }, { title: '李四（分身）' }])
    expect(c.names.filter((n) => n === '李四')).toHaveLength(1)
    expect(canonicalName(c, '李四')).toBe('李四')
  })

  it('别名撞上别人的正名时不改归属', () => {
    const c = buildCast([{ title: '李四' }, { title: '王五', body: '别名：李四' }])
    expect(canonicalName(c, '李四')).toBe('李四')
  })

  it('空名单什么都不认', () => {
    expect(knownName(emptyCast(), '李四')).toBe(false)
  })
})
