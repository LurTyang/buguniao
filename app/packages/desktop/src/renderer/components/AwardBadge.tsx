/**
 * 奖状 —— 书架上挂在名字底下的那个小牌子。
 *
 * 规范：更新文档/10-0.4规划.md §2
 *
 * ─────────────────────────────────────────────────────────────
 * 【它不是成就系统】
 *
 * 作者的原话：「成就在服务器，开发者手动给予。用于纪念一些比赛等等，
 * **并不会自动获得，并不是传统的里程碑**。」
 *
 * 所以这儿**没有任何判定逻辑** —— 客户端只是把服务器发下来的名字
 * 显示出来。它连「有没有资格」这个概念都不该知道。
 *
 * 【三条】
 *
 * 1. **没有奖状就什么都不显示**，不留一个空位置、不显示「暂无成就」。
 *    一个空着的荣誉位比没有更难看。
 * 2. **读本机缓存，不发请求。** 书架每次打开都要用它，
 *    不该每次都等一趟网络；离线时拿到手的东西也不该消失。
 * 3. **有好几张时点一下换一张。** 不做下拉、不做弹窗 ——
 *    这是个装饰，不值得为它开一个对话框。
 * ─────────────────────────────────────────────────────────────
 */

import { useEffect, useState } from 'react'
import type { Award } from '@bugu/core'
import { api } from '../api.js'
import { nextAwardId, pickAward } from '../award-pick.js'

export function AwardBadge() {
  const [awards, setAwards] = useState<Award[]>([])
  const [pinned, setPinned] = useState('')

  useEffect(() => {
    void api
      .myAwards()
      .then((r) => {
        setAwards(r.awards)
        setPinned(r.pinned)
      })
      // 读不出来就当没有。奖状读不到不该在书架上留个报错
      .catch(() => setAwards([]))
  }, [])

  const show = pickAward(awards, pinned)
  if (!show) return null

  const many = awards.length > 1
  const tip = [show.note, many ? `点一下换一张（共 ${awards.length} 张）` : '']
    .filter(Boolean)
    .join('　')

  return (
    <button
      className="award-badge"
      title={tip || show.name}
      // 只有一张时它就是个牌子，不该有「可以点」的样子
      style={many ? undefined : { cursor: 'default' }}
      onClick={() => {
        if (!many) return
        const id = nextAwardId(awards, show.id)
        setPinned(id)
        // 换哪张是本机的事，存不存得上不影响这一次显示
        void api.pinAward(id).catch(() => {})
      }}
    >
      {show.name}
    </button>
  )
}
