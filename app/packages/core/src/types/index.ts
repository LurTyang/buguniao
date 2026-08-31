/**
 * 全项目共享的类型定义。
 *
 * 对应规范：更新文档/03-数据格式规范.md
 * 改动这里之前请先改文档 —— 文档是规范，代码是实现。
 */

// ───────────────────────── 文档 ─────────────────────────

/** 文档类型。`script` 属二期，此处先占位，解析器按 type 分派。 */
export type DocType = 'chapter' | 'outline' | 'setting' | 'idea' | 'script'

export type DocStatus = 'draft' | 'done' | 'revising'

/** 文档 front-matter。见 03-数据格式规范 §3 */
export interface DocMeta {
  /** 稳定不变的唯一标识，版本历史/伏笔/统计全靠它关联。文件改名移动都不影响 */
  id: string
  type: DocType
  title: string
  /** ISO 8601 带时区 */
  created: string
  updated: string
  /**
   * 最后一次是在哪台机器上改的（人看得懂的名字，默认取主机名）。
   *
   * 为了「这一篇在别处改过」那个对话框 —— 只说「另一台设备」等于没说，
   * 作者得看见是「书房台式机」还是「公司笔记本」才决定得了要哪一版。
   * 老文档没有这一项，那就显示「不知道是哪台」。
   */
  device?: string
  status?: DocStatus
  /** 未被识别的字段原样保留，避免用别的编辑器加的自定义字段被我们吞掉 */
  extra?: Record<string, unknown>
}

export interface ParsedDoc {
  meta: DocMeta
  /** 去掉 front-matter 之后的正文 */
  body: string
  /** front-matter 是否原本就存在。false 表示这是外部新建的裸 md，需要补写 id */
  hadFrontMatter: boolean
}

// ───────────────────────── 作品 ─────────────────────────

/** 连载中 / 完结 / 坑啦！哈哈 */
export type BookStatus = 'serializing' | 'finished' | 'pit'

/**
 * 作品类型。决定新建时套哪份骨架、界面默认按哪套格式排。
 *
 * **只在书架页右键改，稿纸页改不了** —— 换类型会换掉整本书的排版规矩，
 * 那不该是写到一半顺手点到的东西。
 */
export type BookKind = 'novel' | 'script' | 'game'

export const BOOK_KINDS: readonly BookKind[] = ['novel', 'script', 'game']

/** 见 03-数据格式规范 §2 */
export interface BookMeta {
  schemaVersion: number
  id: string
  title: string
  author?: string
  cover?: string
  status: BookStatus
  /** 小说 / 剧本 / 游戏剧本。老书没有这一项，按小说算 */
  kind?: BookKind
  /** 设定集里哪几个分类算「人物」。剧本模式靠它认角色名，可多选 */
  castFrom?: string[]
  /**
   * 置顶。书架上排在最前面。
   *
   * 存在书自己的 `book.yaml` 里而不是一份全局清单 —— 那样换台电脑、
   * 或者把某本书单独拷走，置顶都跟着走，也不会留下一条指向不存在的书的记录。
   */
  pinned?: boolean
  tags?: string[]
  summary?: string
  createdAt: string
  targets?: { dailyWords?: number }
  historyLimitMB?: number
  extra?: Record<string, unknown>
}

// ───────────────────────── 便利贴 ─────────────────────────

/** 一段浮出内容。见 03-数据格式规范 §4.3 */
export interface FloatSegment {
  /** 命中的规则：block=独占行@块 / line=行首@整行 / inline=行内成对@ */
  rule: 'block' | 'line' | 'inline'
  /** 浮出的文本。block 保留内部换行 */
  text: string
  /** 起始行号（0 基），用于点击定位回原文 */
  line: number
}

export interface StickyCard {
  /** 来源文档 id */
  docId: string
  /** 卡片标题：第一个 # → 最高级标题 → 文件名 */
  title: string
  /** 标题来源，便于界面提示「这张卡还没写标题」 */
  titleSource: 'h1' | 'top-heading' | 'filename'
  /** 卡片正面显示的内容，按文档顺序 */
  floats: FloatSegment[]
  /** 分类（= 所在文件夹名），根目录下为 null */
  category: string | null
}

// ───────────────────────── 伏笔 ─────────────────────────

export type ForeshadowStatus = 'planned' | 'planted' | 'recovered' | 'abandoned'
export type ForeshadowPriority = 'high' | 'normal' | 'low'

/** jsonl 中的一条记录。同 id 后写覆盖先写。见 03-数据格式规范 §5.2 */
export interface ForeshadowRecord {
  schemaVersion: number
  id: string
  ts: number
  dev: string
  title?: string
  desc?: string
  plantedIn?: string | null
  expectBy?: string | null
  status?: ForeshadowStatus
  priority?: ForeshadowPriority
  recoveredIn?: string[]
}

/** 合并所有分片后的伏笔视图 */
export interface Foreshadow {
  id: string
  title: string
  desc: string
  plantedIn: string | null
  expectBy: string | null
  status: ForeshadowStatus
  priority: ForeshadowPriority
  recoveredIn: string[]
  /** 最后一次变更时间 */
  updatedAt: number
}

/** 正文里解析出的一个标记锚点 */
export interface ForeshadowAnchor {
  id: string
  kind: 'plant' | 'recover'
  /** 被包裹的文本 */
  text: string
  /** 在 body 中的字符区间（不含注释本身） */
  start: number
  end: number
  /** 含注释在内的完整区间，替换/删除标记时用 */
  outerStart: number
  outerEnd: number
}

// ───────────────────────── 版本历史 ─────────────────────────

export interface HistoryRecord {
  schemaVersion: number
  /** 单调递增 */
  v: number
  /** 该记录所属时间桶的起始毫秒时间戳 */
  ts: number
  dev: string
  kind: 'patch' | 'snapshot'
  /** 该版本的总字数（含标点口径），统计模块直接用 */
  chars: number
  /** patch 为 unified diff；snapshot 为全文 */
  data: string
  /** 手动打的命名标记 */
  label?: string
}

// ───────────────────────── 统计 ─────────────────────────

export interface StatRecord {
  schemaVersion: number
  ts: number
  dev: string
  /** 文档 id */
  doc: string
  /** 相对上次的净增字数，可为负 */
  delta: number
  /** 保存后的总字数 */
  total: number
  /** 写作会话 id，间隔 <30 分钟算同一会话 */
  session: string
  /** 是否发生在番茄钟运行期间 */
  pomo?: boolean
}

// ───────────────────────── 便利贴布局 ─────────────────────────

/** `"book"` 全书常驻 | `"doc:{docId}"` 仅该文档 */
export type StickyScope = string

export interface PinnedSticky {
  cardId: string
  x: number
  y: number
  w: number
  h: number
  collapsed: boolean
  scope: StickyScope
}

/**
 * 便利贴在稿纸上的摆放（`.bugu/workspace/{deviceId}.json`）。
 *
 * 每台设备各存各的 —— 分辨率和习惯都可能不一样，共享反而添乱。
 */
export interface StickyLayout {
  schemaVersion: number
  pinned: PinnedSticky[]
}
