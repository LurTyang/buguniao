/**
 * 图文说明：每个页面一页。
 *
 * 规范：更新文档/04-界面与交互设计.md §12
 *
 * ─────────────────────────────────────────────────────────────
 * 【为什么每种稿纸各一页，而不是一份总说明】
 *
 * 小说、剧本、游戏剧本在这软件里长得不一样 —— 面板不一样、右键菜单
 * 不一样、正文该怎么写更不一样。一份总说明要么把三种混在一起说，
 * 要么只说小说那种，另外两种的人第一次打开就是懵的。
 *
 * 而且**只弹当下这一页**：只写小说的人不该被弹游戏剧本那一页；
 * 他哪天真开了本剧本，那一页还得弹。所以看过没看过按页面记。
 * ─────────────────────────────────────────────────────────────
 *
 * 图是画出来的（内联 SVG），不是截图 —— 截图会随着界面改而过期，
 * 而且深色模式下是白的。示意图跟着主题色走，改了界面也不至于对不上。
 */

import type { ReactNode } from 'react'

export type TourKey = 'shelf' | 'novel' | 'script' | 'game'

export const TOUR_TITLE: Record<TourKey, string> = {
  shelf: '书架页',
  novel: '小说稿纸',
  script: '剧本稿纸',
  game: '游戏稿纸',
}

/** 示意图里的配色都走主题变量，深色模式下自动跟着变 */
const INK = 'var(--text-color)'
const DIM = 'var(--control-text-color)'
const LINE = 'var(--line)'
const ACCENT = 'var(--primary-color)'
const PAPER = 'var(--bg-color)'

function Num({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r="9" fill={ACCENT} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fill={PAPER} fontWeight="700">
        {n}
      </text>
    </g>
  )
}

/** 窗口外框 + 顶栏。四张图共用，省得每张重画一遍 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 520 260" className="tour-svg" role="img">
      <rect x="1" y="1" width="518" height="258" rx="8" fill={PAPER} stroke={LINE} />
      <line x1="1" y1="30" x2="519" y2="30" stroke={LINE} />
      <circle cx="16" cy="15" r="3" fill={DIM} />
      <circle cx="28" cy="15" r="3" fill={DIM} />
      {children}
    </svg>
  )
}

function ShelfPic() {
  return (
    <Frame>
      {/* 左边窄的用户栏 */}
      <rect x="1" y="30" width="88" height="229" fill={LINE} opacity="0.25" />
      <rect x="14" y="46" width="46" height="8" rx="4" fill={DIM} />
      <rect x="14" y="64" width="62" height="6" rx="3" fill={LINE} />
      <rect x="14" y="78" width="54" height="6" rx="3" fill={LINE} />
      <rect x="14" y="98" width="62" height="14" rx="3" fill={ACCENT} opacity="0.25" />
      <Num x={70} y={52} n={1} />

      {/* 书架 */}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={110 + i * 90} y={64} width="66" height="86" rx="4" fill={LINE} opacity="0.5" />
          <rect x={110 + i * 90} y={156} width="46" height="7" rx="3" fill={DIM} />
        </g>
      ))}
      <Num x={176} y={70} n={2} />

      <rect x="392" y="42" width="72" height="18" rx="4" fill={ACCENT} opacity="0.85" />
      <text x="428" y="55" textAnchor="middle" fontSize="10" fill={PAPER}>
        新建作品
      </text>
      <Num x={478} y={51} n={3} />
    </Frame>
  )
}

function PaperPic({ mode }: { mode: 'novel' | 'script' | 'game' }) {
  return (
    <Frame>
      {/* 左功能栏（划出来的） */}
      <rect x="1" y="30" width="76" height="229" fill={LINE} opacity="0.25" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x="12" y={46 + i * 16} width="52" height="7" rx="3" fill={LINE} />
      ))}
      <Num x={66} y={40} n={1} />

      {/* 右目录栏 */}
      <rect x="443" y="30" width="76" height="229" fill={LINE} opacity="0.25" />
      {[0, 1, 2].map((i) => (
        <rect key={i} x="454" y={46 + i * 16} width="52" height="7" rx="3" fill={LINE} />
      ))}
      <Num x={452} y={40} n={2} />

      {/* 稿纸 */}
      {mode === 'novel' &&
        [0, 1, 2, 3, 4, 5].map((i) => (
          <rect
            key={i}
            x={i % 3 === 0 ? 128 : 108}
            y={60 + i * 20}
            width={i % 3 === 0 ? 260 : 280}
            height="7"
            rx="3"
            fill={i === 0 ? INK : LINE}
          />
        ))}

      {mode === 'script' && (
        <>
          <rect x="100" y="52" width="150" height="8" rx="4" fill={INK} />
          <rect x="124" y="76" width="200" height="6" rx="3" fill={LINE} />
          <rect x="148" y="104" width="46" height="8" rx="4" fill={ACCENT} />
          <rect x="172" y="122" width="180" height="6" rx="3" fill={LINE} />
          <rect x="148" y="152" width="52" height="8" rx="4" fill={ACCENT} />
          <rect x="172" y="170" width="150" height="6" rx="3" fill={LINE} />
          <Num x={140} y={108} n={3} />
        </>
      )}

      {mode === 'game' && (
        <>
          <rect x="100" y="52" width="90" height="8" rx="4" fill={INK} />
          <rect x="108" y="76" width="200" height="6" rx="3" fill={LINE} />
          <rect x="108" y="100" width="120" height="6" rx="3" fill={ACCENT} />
          <rect x="108" y="118" width="140" height="6" rx="3" fill={ACCENT} />
          <Num x={262} y={110} n={3} />
          {/* 底下画一小截分支图 */}
          <rect x="180" y="170" width="52" height="20" rx="10" fill="none" stroke={ACCENT} />
          {/* 用 DIM 不用 LINE：LINE 太淡，缩到这个尺寸就看不见了 */}
          <rect x="130" y="212" width="52" height="20" rx="4" fill="none" stroke={DIM} />
          <rect x="238" y="212" width="52" height="20" rx="4" fill="none" stroke={DIM} />
          <path d="M198 190 L160 212 M214 190 L260 212" stroke={DIM} fill="none" />
          <Num x={306} y={222} n={4} />
        </>
      )}
    </Frame>
  )
}

interface TourPage {
  pic: ReactNode
  lead: string
  points: Array<{ n: number | null; title: string; body: string }>
}

const PAGES: Record<TourKey, TourPage> = {
  shelf: {
    pic: <ShelfPic />,
    lead: '书架是所有作品的入口。一本书就是硬盘上的一个文件夹，随时能用记事本打开。',
    points: [
      {
        n: 1,
        title: '左边这条是你自己',
        body: '昵称、一起写了多少天、今天写了多少、连胜几天。底下那个齿轮是总设置 —— API、码字计划这些不常改的都在里面。',
      },
      {
        n: 2,
        title: '右键一本书有更多操作',
        body: '改名、换封面、标连载／完结／坑了，还有**作品类型**（小说／剧本／游戏剧本）。类型只能在这儿改，稿纸页里没有这个入口。',
      },
      {
        n: 3,
        title: '新建时会问你写的是哪种',
        body: '小说、剧本、游戏剧本，开局的骨架和界面都不一样。选错了回来右键改就行。',
      },
      {
        n: null,
        title: '换个文件夹就是换一个库',
        body: '顶上的「更换目录」指到坚果云／OneDrive 的同步文件夹，就能在两台电脑上写同一批稿子。',
      },
    ],
  },

  novel: {
    pic: <PaperPic mode="novel" />,
    lead: '中间是稿纸，两边的栏平时藏着 —— 鼠标往窗口边缘一靠它自己出来。',
    points: [
      {
        n: 1,
        title: '左边缘：功能栏',
        body: '字数统计、码字计划、全文检索、伏笔、版本历史、番茄钟、灵感箱、AI 助手都在这儿。点右上角的图钉钉住就不会缩回去。',
      },
      {
        n: 2,
        title: '右边缘：目录',
        body: '大纲、正文、设定集三个页签。拖动能调顺序，右键有更多操作。',
      },
      {
        n: null,
        title: '写就完事，不用管保存',
        body: '停笔三秒自动存一次，每次都留一份历史。想手动存按 Ctrl+S。',
      },
      {
        n: null,
        title: '@ 把设定拉到眼前',
        body: '设定卡片里行首写一个 @，那一行就浮到稿纸上当便利贴 —— 写着写着忘了人物设定，不用去翻。',
      },
      {
        n: null,
        title: '右键有插入菜单',
        body: '剪切复制粘贴之外，还能插双链 [[ ]]、标伏笔、二级标题。',
      },
    ],
  },

  script: {
    pic: <PaperPic mode="script" />,
    lead: '剧本不用学新符号 —— 就按中文剧本本来的写法写，软件自己认。',
    points: [
      {
        n: null,
        title: '场景用 # 起头',
        body: '`# 第一场　内景·咖啡馆·日`。它就是这一场的标题，剧本面板里点一下能跳过来。',
      },
      {
        n: 3,
        title: '台词写「角色名：台词」',
        body: '`李四：你等很久了？`。要加表演提示就写 `李四（冷笑）：…`。整行用（）裹起来的是动作和舞台指示。',
      },
      {
        n: null,
        title: '先去设定集建人物卡 ⭐',
        body: '新建剧本时已经给你建好「人物」分类了。往里放一张叫「李四」的卡，正文里的「李四：」就会**自动排成两行**：名字单独一行，台词在下面。没有卡的名字不会拆行 —— 免得把「时间：三年后」也拆了。',
      },
      {
        n: 1,
        title: '功能栏里的「剧本模式」',
        body: '谁的戏多、谁好久没出声了、每场多少条台词、哪些名字不在人物卡里（多半是打错了字）。场次右边一对 ↑↓ 能整场挪位置。',
      },
      {
        n: null,
        title: '排版只改显示',
        body: '缩进和拆行都是显示出来的，**文件里一个字节都没动**。关掉开关就是原来的纯文本，拿记事本打开还是一份剧本。',
      },
    ],
  },

  game: {
    pic: <PaperPic mode="game" />,
    lead: '在剧本写法之上只多四样东西：节点、选项、跳转、变量。',
    points: [
      {
        n: null,
        title: '一个 # 就是一个节点',
        body: '`# 初见`。标题文字就是它的名字，跳转按这个名字找 —— **跨文件也找得到**，一章写一个节点完全没问题。',
      },
      {
        n: 3,
        title: '选项和跳转',
        body: '`- 点头 -> 承认` 是一个选项；单独一行 `-> 放学` 是直接跳过去；`-> 结束` 是结局。',
      },
      {
        n: null,
        title: '变量和条件',
        body: '`$ 好感度 += 1` 改变量，`- {好感度>=3} 搭话 -> 熟络` 是带条件的选项。一段里好几条选项共用一个条件，用 `$若 … $结束` 包起来。',
      },
      {
        n: 4,
        title: '功能栏里的「游戏剧本」⭐',
        body: "分支节点图、**体检**（断头路／孤儿／死路／重名／条件写坏／变量没赋过值）、走一遍看能到哪些结局、从任意节点试玩，还能导出 Ren'Py 和 ink 的骨架。",
      },
      {
        n: null,
        title: '体检是这里最值钱的东西',
        body: '几十个文件里靠人眼翻不出「某个结局根本拿不到」。写完一整条线才发现，那是几万字白写。',
      },
    ],
  },
}

export function TourPageView({ which }: { which: TourKey }) {
  const page = PAGES[which]
  return (
    <div className="tour">
      {page.pic}
      <div className="tour-lead">{page.lead}</div>
      {page.points.map((p) => (
        <div key={p.title} className="tour-point">
          <span className={`tour-badge${p.n === null ? ' plain' : ''}`}>{p.n ?? '·'}</span>
          <div>
            <div className="tour-point-title">{p.title}</div>
            <div className="tour-point-body">{renderTicks(p.body)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * 说明里的 `代码` 和 **粗体** 渲染出来。
 *
 * 没用 Markdown 库 —— 这几页里只有这两种标记，为它引一个解析器不值当，
 * 而且那玩意儿还会把 `->` 之类的东西当成别的语法吃掉。
 */
function renderTicks(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1] !== undefined) out.push(<code key={k++}>{m[1]}</code>)
    else out.push(<b key={k++}>{m[2]}</b>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
