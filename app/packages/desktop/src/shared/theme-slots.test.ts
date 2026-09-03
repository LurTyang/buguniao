/**
 * 栏位表的测试。
 *
 * 这一层错了的表现是「加了一份主题，另一份不见了」或者「删了一格，
 * 正在用的那份悄悄换成了别的」—— 两种都是**丢掉作者调了半天的东西**，
 * 而且都不会报错。所以每条规矩都钉死。
 */
import { describe, it, expect } from 'vitest'
import {
  EMPTY_SLOT,
  MAX_SLOTS,
  canAdd,
  isEmptySlot,
  normalizeSlots,
  putSlot,
  removeSlot,
  type ThemeSlot,
} from './theme-slots.js'

const file = (name: string): ThemeSlot => ({
  path: `C:/${name}.css`,
  draft: null,
  name,
  color: '#fff',
})
const made = (name: string): ThemeSlot => ({
  path: '',
  draft: { name, font: '', vars: { '--bg-color': '#000' } },
  name,
  color: '#000',
})
const names = (list: ThemeSlot[]): string[] => list.map((s) => (isEmptySlot(s) ? '空' : s.name))

describe('isEmptySlot', () => {
  it('没文件也没草稿才算空', () => {
    expect(isEmptySlot(EMPTY_SLOT)).toBe(true)
    expect(isEmptySlot(file('a'))).toBe(false)
    expect(isEmptySlot(made('b'))).toBe(false)
    expect(isEmptySlot(undefined)).toBe(true)
  })
})

describe('normalizeSlots', () => {
  it('什么都没有时，给一个空位 —— 那就是「加」这个按钮', () => {
    expect(names(normalizeSlots([]))).toEqual(['空'])
  })

  it('中间的空位挤掉，末尾留一个', () => {
    expect(names(normalizeSlots([file('a'), EMPTY_SLOT, file('b')]))).toEqual(['a', 'b', '空'])
  })

  it('末尾多余的空位只留一个', () => {
    expect(names(normalizeSlots([file('a'), EMPTY_SLOT, EMPTY_SLOT]))).toEqual(['a', '空'])
  })

  it('满九个之后不再补空位 —— 空位消失本身就是「满了」这句话', () => {
    const nine = Array.from({ length: MAX_SLOTS }, (_, i) => file('t' + i))
    expect(normalizeSlots(nine).length).toBe(MAX_SLOTS)
    expect(normalizeSlots(nine).every((s) => !isEmptySlot(s))).toBe(true)
  })

  it('超过九个的截掉', () => {
    const ten = Array.from({ length: 12 }, (_, i) => file('t' + i))
    expect(normalizeSlots(ten).length).toBe(MAX_SLOTS)
  })
})

describe('putSlot', () => {
  it('放进空位之后，末尾又长一个新空位 —— 这就是「无限」的实现', () => {
    const r = putSlot([EMPTY_SLOT], 0, file('a'))
    expect(r.at).toBe(0)
    expect(names(r.slots)).toEqual(['a', '空'])
  })

  it('指着已有的那一格就覆盖它（双击换一份 CSS 走这条）', () => {
    const r = putSlot([file('a'), file('b'), EMPTY_SLOT], 1, file('新'))
    expect(r.at).toBe(1)
    expect(names(r.slots)).toEqual(['a', '新', '空'])
  })

  it('序号越界时当成「加一份新的」，而不是报错或覆盖第一个', () => {
    const r = putSlot([file('a'), EMPTY_SLOT], 99, file('b'))
    expect(r.at).toBe(1)
    expect(names(r.slots)).toEqual(['a', 'b', '空'])
  })

  it('自制主题跟文件主题占同样的格子', () => {
    const r = putSlot([file('a'), EMPTY_SLOT], -1, made('我的'))
    expect(names(r.slots)).toEqual(['a', '我的', '空'])
    expect(r.slots[1]!.draft).not.toBe(null)
  })

  it('【关键】满九个时拒绝，而不是挤掉最老的那一份', () => {
    const nine = Array.from({ length: MAX_SLOTS }, (_, i) => file('t' + i))
    const r = putSlot(nine, -1, made('第十'))
    expect(r.at).toBe(-1)
    expect(names(r.slots)).toEqual(names(nine))
  })

  it('满九个时，指名覆盖某一格还是可以的', () => {
    const nine = Array.from({ length: MAX_SLOTS }, (_, i) => file('t' + i))
    const r = putSlot(nine, 3, made('换掉'))
    expect(r.at).toBe(3)
    expect(names(r.slots)[3]).toBe('换掉')
    expect(r.slots.length).toBe(MAX_SLOTS)
  })
})

describe('removeSlot', () => {
  it('删的是整格，不是把它清空 —— 清空会在中间留个洞', () => {
    const r = removeSlot([file('a'), file('b'), file('c'), EMPTY_SLOT], 1, -1)
    expect(names(r.slots)).toEqual(['a', 'c', '空'])
  })

  it('删掉正在用的那一格 → 回预设', () => {
    const r = removeSlot([file('a'), file('b'), EMPTY_SLOT], 1, 1)
    expect(r.active).toBe(-1)
  })

  it('【关键】删掉前面那一格时，序号跟着往前挪 —— 不然会悄悄换主题', () => {
    const r = removeSlot([file('a'), file('b'), file('c'), EMPTY_SLOT], 0, 2)
    expect(names(r.slots)).toEqual(['b', 'c', '空'])
    expect(r.active).toBe(1) // 还是 c
  })

  it('删后面那一格不影响正在用的', () => {
    const r = removeSlot([file('a'), file('b'), EMPTY_SLOT], 1, 0)
    expect(r.active).toBe(0)
  })

  it('删空位是没意义的，什么都不做', () => {
    const before = [file('a'), EMPTY_SLOT]
    const r = removeSlot(before, 1, 0)
    expect(names(r.slots)).toEqual(['a', '空'])
    expect(r.active).toBe(0)
  })

  it('删满九个里的一个，空位重新长出来', () => {
    const nine = Array.from({ length: MAX_SLOTS }, (_, i) => file('t' + i))
    const r = removeSlot(nine, 0, -1)
    expect(r.slots.length).toBe(MAX_SLOTS)
    expect(isEmptySlot(r.slots[MAX_SLOTS - 1])).toBe(true)
  })
})

describe('canAdd', () => {
  it('没满就能加', () => {
    expect(canAdd([file('a')])).toBe(true)
  })
  it('满了就不能', () => {
    expect(canAdd(Array.from({ length: MAX_SLOTS }, (_, i) => file('t' + i)))).toBe(false)
  })
})
