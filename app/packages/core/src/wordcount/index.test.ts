import { describe, it, expect } from 'vitest'
import {
  countWords,
  stripForCounting,
  pickCount,
  formatCount,
  formatCountShort,
  DEFAULT_COUNT_MODE,
} from './index.js'

describe('countWords · 基本口径', () => {
  it('纯汉字两个口径相同', () => {
    expect(countWords('他从四十八楼掉下去')).toEqual({
      withPunctuation: 9,
      withoutPunctuation: 9,
    })
  })

  it('中文标点只计入含标点口径', () => {
    // 「他掉下去了。」→ 6 字 + 1 句号
    expect(countWords('他掉下去了。')).toEqual({
      withPunctuation: 6,
      withoutPunctuation: 5,
    })
  })

  it('空格与换行两个口径都不计', () => {
    expect(countWords('甲 乙\n丙\t丁')).toEqual({
      withPunctuation: 4,
      withoutPunctuation: 4,
    })
  })

  it('全角引号书名号算标点', () => {
    // 他说走剑经 = 5 字；：「。」《》 = 6 个标点
    const c = countWords('他说：「走。」《剑经》')
    expect(c.withoutPunctuation).toBe(5)
    expect(c.withPunctuation).toBe(11)
  })

  it('英文字母数字算进两个口径', () => {
    expect(countWords('abc123')).toEqual({ withPunctuation: 6, withoutPunctuation: 6 })
  })

  it('英文标点只计入含标点口径', () => {
    expect(countWords('a,b.c!')).toEqual({ withPunctuation: 6, withoutPunctuation: 3 })
  })

  it('省略号破折号算标点', () => {
    expect(countWords('甲……乙——丙').withoutPunctuation).toBe(3)
  })

  it('emoji 与生僻字按一个字算', () => {
    expect(countWords('𠮷🌙').withPunctuation).toBe(2)
  })

  it('空文本为 0', () => {
    expect(countWords('')).toEqual({ withPunctuation: 0, withoutPunctuation: 0 })
  })
})

describe('stripForCounting · 不该算进字数的东西', () => {
  it('剔除 front-matter', () => {
    const raw = ['---', 'id: ch-x', 'title: 甲', '---', '正文四个字'].join('\n')
    expect(countWords(raw).withPunctuation).toBe(5)
  })

  it('剔除伏笔标记注释 —— 标伏笔不该让字数凭空上涨', () => {
    const plain = '他摸了摸胸口那块玉佩'
    const marked = '他摸了摸胸口<!--埋#f7k2p9-->那块玉佩<!--/埋#f7k2p9-->'
    expect(countWords(marked)).toEqual(countWords(plain))
  })

  it('剔除普通 HTML 注释', () => {
    expect(countWords('正文<!-- 这是我的备注，不该算字数 -->').withPunctuation).toBe(2)
  })

  it('双向链接只算显示文字', () => {
    expect(countWords('[[李四]]走了').withPunctuation).toBe(4)
  })

  it('带别名的双向链接算别名', () => {
    expect(countWords('[[李四|那个断眉少年]]').withPunctuation).toBe(6)
  })

  it('标题井号不算字数', () => {
    expect(countWords('# 第一章').withPunctuation).toBe(3)
  })

  it('加粗斜体标记不算字数', () => {
    expect(countWords('**很重要**').withPunctuation).toBe(3)
    expect(countWords('*强调*').withPunctuation).toBe(2)
  })

  it('链接只算显示文字', () => {
    expect(countWords('[参考资料](https://example.com/a/b)').withPunctuation).toBe(4)
  })

  it('列表符号不算字数', () => {
    expect(countWords('- 甲\n- 乙').withPunctuation).toBe(2)
  })

  it('引用尖括号不算字数', () => {
    expect(countWords('> 引用的话').withPunctuation).toBe(4)
  })

  it('代码围栏标记不算，但围栏内文字算', () => {
    expect(countWords('```\n甲乙丙\n```').withPunctuation).toBe(3)
  })

  it('分隔线不算字数', () => {
    expect(countWords('甲\n\n---\n\n乙').withPunctuation).toBe(2)
  })

  it('stripForCounting 是纯函数，不改原串', () => {
    const s = '# 甲\n**乙**'
    const before = s
    stripForCounting(s)
    expect(s).toBe(before)
  })
})

describe('真实章节片段', () => {
  const chapter = [
    '---',
    'id: ch-a1b2c3',
    'type: chapter',
    'title: 第一章 坠楼',
    '---',
    '',
    '# 第一章 坠楼',
    '',
    '他从四十八楼掉下去的时候，脑子里想的不是死。',
    '',
    '而是昨天没写完的那一章。',
    '',
    '他下意识摸了摸胸口，<!--埋#f7k2p9-->那块温润的玉佩还在<!--/埋#f7k2p9-->。',
  ].join('\n')

  it('统计结果合理', () => {
    const c = countWords(chapter)
    // 手工逐字核对：标题5 + 第一段20 + 第二段11 + 第三段18 = 54（不含标点）
    expect(c.withoutPunctuation).toBe(54)
    // 标点共 5 个（，。 。 ，。），54 + 5 = 59
    expect(c.withPunctuation).toBe(59)
  })

  it('把伏笔标记去掉后统计结果完全一致', () => {
    const without = chapter.replace(/<!--[\s\S]*?-->/g, '')
    expect(countWords(chapter)).toEqual(countWords(without))
  })
})

describe('pickCount 与格式化', () => {
  it('默认口径是含标点', () => {
    expect(DEFAULT_COUNT_MODE).toBe('withPunctuation')
    expect(pickCount({ withPunctuation: 100, withoutPunctuation: 80 })).toBe(100)
  })

  it('可切换到不含标点', () => {
    expect(pickCount({ withPunctuation: 100, withoutPunctuation: 80 }, 'withoutPunctuation')).toBe(80)
  })

  it('formatCount 带千分位', () => {
    expect(formatCount(1503)).toBe('1,503')
    expect(formatCount(0)).toBe('0')
  })

  it('formatCountShort 不足一万显示具体数', () => {
    expect(formatCountShort(9999)).toBe('9,999字')
  })

  it('formatCountShort 超过一万显示万字', () => {
    expect(formatCountShort(82345)).toBe('8.2万字')
    expect(formatCountShort(1234567)).toBe('123.5万字')
  })
})
