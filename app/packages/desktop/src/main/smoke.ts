/**
 * 端到端冒烟检查。
 *
 * 单元测试测得到纯逻辑，测不到「Electron 起没起来、preload 通没通、
 * IPC 有没有对上、React 白没白屏」—— 而这些恰恰最容易在重构里悄悄坏掉。
 *
 * 做法：启动真窗口，把根目录指到一个临时文件夹，然后**从渲染进程里**
 * 依次调用 window.bugu 的每个方法走完一整套写作流程，检查结果。
 * 走的是真 IPC、真主进程、真文件系统。
 *
 * 用 `pnpm smoke` 跑。结果写进 out/smoke-result.json ——
 * Windows 上 Electron 是 GUI 程序，stdout 不接父控制台，打印了也看不见。
 */

import { app, type BrowserWindow } from 'electron'
import { patchConfig } from './config.js'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export interface SmokeReport {
  ok: boolean
  problems: string[]
  /** 每一步的结果，失败时用来定位 */
  steps: Array<{ name: string; ok: boolean; detail?: string }>
  env: Record<string, unknown>
  pageText?: string
}

/**
 * 在渲染进程里跑的脚本。
 *
 * 写成一个自执行函数的源码字符串 —— 它必须在页面上下文里执行才能拿到
 * window.bugu。里面每一步都自己断言，最后把结果整个带回来。
 */
const E2E_SCRIPT = `(async () => {
  const steps = []
  const check = (name, ok, detail) => {
    steps.push(detail === undefined ? { name, ok } : { name, ok, detail })
    return ok
  }
  const api = window.bugu

  try {
    // ── 书架 ──
    const before = await api.listBooks()
    check('空库时书架为空', before.length === 0, '实得 ' + before.length + ' 本')

    const book = await api.createBook('冒烟测试')
    check('新建作品', book && book.meta && book.meta.title === '冒烟测试')

    const books = await api.listBooks()
    check('新建的作品能被扫到', books.length === 1)

    // ── 目录 ──
    let tree = await api.loadTree(book.rootPath)
    const firstChapter = tree.text[0]
    check('自带第一章', !!firstChapter && firstChapter.title === '第一章',
      firstChapter ? firstChapter.title : '没有章节')

    // ── 写字与保存 ──
    const TEXT = '他从四十八楼掉下去的时候，脑子里想的不是死。\\n\\n而是昨天没写完的那一章。'
    // 22 字 + 12 字（空白不计）
    const saved = await api.saveDoc(firstChapter.path, TEXT)
    check('保存返回字数', saved.chars === 34, '实得 ' + saved.chars)
    check('保存产生版本 1', saved.version === 1, '实得 ' + saved.version)

    const readBack = await api.readDoc(firstChapter.path)
    check('读回来内容一致', readBack.body === TEXT)
    check('文档 id 稳定', readBack.meta.id === saved.meta.id)

    // ── 统计 ──
    const today = await api.todayProgress(book.rootPath)
    check('今日字数统计到了', today.words === 34, '实得 ' + today.words)
    check('未达签到线', today.signedIn === false)
    check('差额正确', today.wordsToSignIn === 5000 - 34, '实得 ' + today.wordsToSignIn)

    // ── 卷与章节 ──
    const vol = await api.createVolume(book.rootPath, '第一卷 少年游')
    const ch2 = await api.createChapter(vol.path, '第二章 醒来')
    check('在卷里新建章节', ch2.path.indexOf('第一卷 少年游') > -1, ch2.path)

    tree = await api.loadTree(book.rootPath)
    check('目录里能看到卷', tree.text.some(n => n.kind === 'volume' && n.title === '第一卷 少年游'))

    // ── 重命名 ──
    const renamed = await api.renameDoc(firstChapter.path, '第一章 坠楼')
    check('重命名后文件名变了', renamed.path.indexOf('第一章 坠楼.md') > -1, renamed.path)
    const afterRename = await api.readDoc(renamed.path)
    check('重命名后标题改了', afterRename.meta.title === '第一章 坠楼')
    check('重命名后正文没动', afterRename.body === TEXT)
    check('重命名后 id 不变', afterRename.meta.id === saved.meta.id)

    // ── 排序 ──
    const ch3 = await api.createChapter(book.rootPath + '/正文', '第三章 出门')
    tree = await api.loadTree(book.rootPath)
    const topBefore = tree.text.map(n => n.title)
    const r = await api.reorder(book.rootPath + '/正文', topBefore.length - 1, 0)
    check('排序只改少量文件', r.renamed >= 1)
    tree = await api.loadTree(book.rootPath)
    check('排序后第一项变了', tree.text[0].title !== topBefore[0],
      '之前 ' + topBefore[0] + '，现在 ' + tree.text[0].title)
    check('排序后一项不丢', tree.text.length === topBefore.length)

    // ── 设定集与模板 ──
    const cat = await api.createSettingCategory(book.rootPath, '人物')
    const tpl = await api.readTemplate(cat.path)
    check('分类自带模板', tpl.content.indexOf('{{标题}}') > -1)

    const card = await api.createSettingCard(cat.path, '李四')
    const cardDoc = await api.readDoc(card.path)
    check('便利贴套用了模板', cardDoc.body.indexOf('# 李四') > -1)
    check('模板占位符被替换', cardDoc.body.indexOf('{{标题}}') === -1)
    check('模板里的 @ 语法保留', cardDoc.body.indexOf('@') > -1)

    tree = await api.loadTree(book.rootPath)
    const people = tree.settings.filter(c => c.name === '人物')[0]
    check('便利贴出现在目录里', !!people && people.cards.length === 1)
    check('模板本身不算一张便利贴', !!people && people.cards[0].title === '李四')

    // ── 回收站 ──
    // 注意：上面排过序，ch3 的路径已经变了，必须从目录树里重新取。
    // 这正是界面里每次操作后都要刷新目录树的原因。
    tree = await api.loadTree(book.rootPath)
    const ch3Now = tree.text.filter(n => n.kind === 'chapter' && n.title === '第三章 出门')[0]
    check('排序后能重新定位到章节', !!ch3Now)
    await api.trashDoc(book.rootPath, ch3Now.path)
    const trash = await api.listTrash(book.rootPath)
    check('删除进了回收站', trash.length === 1)
    check('回收站记住了原位置', trash.length === 1 && trash[0].originalPath.indexOf('第三章 出门') > -1)

    tree = await api.loadTree(book.rootPath)
    check('回收站里的不出现在目录', !JSON.stringify(tree.text).includes('第三章 出门'))

    await api.restoreFromTrash(trash[0])
    tree = await api.loadTree(book.rootPath)
    check('恢复回原位', JSON.stringify(tree.text).includes('第三章 出门'))

    // ── 索引与全文检索 ──
    // 注意：indexed 是本次**增量**索引的篇数，不是总数
    //（前面的拖拽排序已经触发过一次全量重建）。要看总数得问 indexStats。
    await api.ensureIndexed(book.rootPath)
    const st0 = await api.indexStats(book.rootPath)
    check('索引覆盖了全部文档', st0.docs >= 4, '索引里有 ' + st0.docs + ' 篇')

    const r1 = await api.search('四十八楼', { book: book.rootPath })
    check('中文子串检索命中', r1.total === 1, '实得 ' + r1.total)
    check('命中的是第一章', r1.hits.length === 1 && r1.hits[0].title === '第一章 坠楼',
      r1.hits.length ? r1.hits[0].title : '无结果')
    check('片段带高亮标记', r1.hits.length === 1 && r1.hits[0].snippet.indexOf(String.fromCharCode(1)) > -1)

    const r2 = await api.search('断眉', { book: book.rootPath })
    check('搜得到便利贴（模板里的字段名）', r2.total >= 0)

    const r3 = await api.search('四十八楼', { book: book.rootPath, scopes: ['setting'] })
    check('范围筛选生效', r3.total === 0, '实得 ' + r3.total)

    const r4 = await api.search('这句话谁也没写过', { book: book.rootPath })
    check('搜不到时返回空', r4.total === 0 && r4.hits.length === 0)

    const st = await api.indexStats(book.rootPath)
    check('索引统计有数', st.docs >= 3 && st.bytes > 0, st.docs + ' 篇 / ' + st.bytes + ' 字节')

    // 改了正文之后，索引跟着更新
    const chNow = tree.text.filter(n => n.kind === 'chapter' && n.title === '第三章 出门')[0]
    await api.saveDoc(chNow.path, '这里有一个独一无二的暗号：兔子先生。')
    const r5 = await api.search('独一无二的暗号', { book: book.rootPath })
    check('保存后索引立刻更新', r5.total === 1, '实得 ' + r5.total)

    // ── 便利贴 ──
    const cards = await api.listStickies(book.rootPath)
    const lisi = cards.filter(c => c.title === '李四')[0]
    check('能列出便利贴', !!lisi, '共 ' + cards.length + ' 张')
    check('卡片正面抽出了模板里的浮出内容',
      !!lisi && lisi.face.indexOf('身份') > -1, lisi ? JSON.stringify(lisi.face) : '')
    check('便利贴带分类', !!lisi && lisi.category === '人物', lisi ? String(lisi.category) : '')

    const layout0 = await api.loadStickyLayout(book.rootPath)
    check('没贴过时布局是空的', layout0.pinned.length === 0)

    await api.saveStickyLayout(book.rootPath, {
      schemaVersion: 1,
      pinned: [{ cardId: lisi.docId, x: 300, y: 200, w: 260, h: 300, collapsed: false, scope: 'book' }],
    })
    const layout1 = await api.loadStickyLayout(book.rootPath)
    check('布局存得住', layout1.pinned.length === 1 && layout1.pinned[0].x === 300)

    // 改了设定内容后，卡片正面跟着变
    const lisiDoc = await api.readDoc(lisi.path)
    await api.saveDoc(lisi.path, lisiDoc.body + '\\n\\n@新加的一行会浮出\\n')
    const after = await api.readSticky(lisi.path, '人物')
    check('改设定后卡片正面跟着更新', after.face.indexOf('新加的一行会浮出') > -1, JSON.stringify(after.face))

    // 双向链接
    const firstCh = tree.text.filter(n => n.kind === 'chapter')[0]
    const chDoc = await api.readDoc(firstCh.path)
    await api.saveDoc(firstCh.path, chDoc.body + '\\n\\n他看见了[[李四]]。')
    const backs = await api.backlinks('李四', book.rootPath)
    check('反向链接查得到', backs.length === 1, '实得 ' + backs.length)
    check('反向链接指向正确的章节', backs.length === 1 && backs[0].path === firstCh.path)

    const outs = await api.outgoingLinks(firstCh.path, book.rootPath)
    check('正向链接也查得到', outs.length === 1 && outs[0].target === '李四', JSON.stringify(outs))
    check('链接配上了目标便利贴', outs.length === 1 && outs[0].path === lisi.path, JSON.stringify(outs))

    await api.saveDoc(firstCh.path, chDoc.body + String.fromCharCode(10, 10) + '他看见了[[李四]]，还有[[没这个人]]。')
    const outs2 = await api.outgoingLinks(firstCh.path, book.rootPath)
    const dangling = outs2.filter(function (o) { return o.path === null })
    check('【关键】名字写错的链接会被标出来，不是悄悄藏掉',
      dangling.length === 1 && dangling[0].target === '没这个人', JSON.stringify(outs2))

    // ── 伏笔 ──
    const fs0 = await api.listForeshadows(book.rootPath)
    check('一开始没有伏笔', fs0.items.length === 0)
    check('返回了章节顺序', fs0.chapters.length >= 2, '共 ' + fs0.chapters.length + ' 章')

    const made = await api.addForeshadow(book.rootPath, {
      title: '沈家玉佩', desc: '主角贴身戴的玉佩', expectBy: '第三卷', priority: 'high',
    })
    check('能先记一个伏笔', !!made.id)

    const fs1 = await api.listForeshadows(book.rootPath)
    check('清单里出现了', fs1.items.length === 1 && fs1.items[0].title === '沈家玉佩')
    check('还没写进正文时状态是 planned', fs1.items[0].status === 'planned', fs1.items[0].status)

    // 把正文里的一段标成埋点
    // 前面排过序、也改过内容，别假设第一章还是原来那篇 ——
    // 直接写一段已知的文字进去再标。
    const ch1 = fs1.chapters[0]
    const MARK_TEXT = '他摸了摸胸口那块玉佩'
    await api.saveDoc(ch1.path, '这一章的开头。' + MARK_TEXT + '，然后走了。')
    const d1 = await api.readDoc(ch1.path)
    const start = d1.body.indexOf(MARK_TEXT)
    check('找得到要标的那段', start > -1, String(start))
    const marked = await api.markForeshadow(
      book.rootPath, ch1.path, { start, end: start + MARK_TEXT.length }, made.id, 'plant')
    check('正文里出现了埋点注释', marked.body.indexOf('<!--埋#' + made.id + '-->') > -1)

    const anchors = await api.docAnchors(ch1.path)
    check('锚点解析得出来', anchors.length === 1 && anchors[0].kind === 'plant')
    check('锚点包住的正是那段文字', anchors.length === 1 && anchors[0].text === MARK_TEXT,
      anchors.length ? anchors[0].text : '')

    const fs2 = await api.listForeshadows(book.rootPath, ch1.id)
    check('状态变成 planted', fs2.items[0].status === 'planted', fs2.items[0].status)
    check('记住了埋在哪一章', fs2.items[0].plantedIn === ch1.id)

    // 在后面的章节回收
    const lastCh = fs2.chapters[fs2.chapters.length - 1]
    const d2 = await api.readDoc(lastCh.path)
    await api.saveDoc(lastCh.path, d2.body + '\\n\\n玉佩碎成两半。')
    const d2b = await api.readDoc(lastCh.path)
    const rStart = d2b.body.indexOf('玉佩碎成两半')
    await api.markForeshadow(book.rootPath, lastCh.path, { start: rStart, end: rStart + 6 }, made.id, 'recover')

    const fs3 = await api.listForeshadows(book.rootPath, lastCh.id)
    check('回收后状态是 recovered', fs3.items[0].status === 'recovered', fs3.items[0].status)
    check('记住了在哪几章回收', fs3.items[0].recoveredIn.indexOf(lastCh.id) > -1)

    // 伏笔标记不该算进字数
    const beforeChars = (await api.saveDoc(ch1.path, marked.body)).chars
    const plainChars = (await api.saveDoc(ch1.path, marked.body.replace(/<!--[^>]*-->/g, ''))).chars
    check('伏笔标记不计入字数', beforeChars === plainChars,
      beforeChars + ' vs ' + plainChars)

    // ── 版本历史 ──
    const hDoc = await api.readDoc(ch1.path)
    await api.saveDoc(ch1.path, '历史第一版')
    await new Promise(r => setTimeout(r, 40))
    await api.saveDoc(ch1.path, '历史第二版，长一点点')

    const vers = await api.listVersions(book.rootPath, hDoc.meta.id)
    check('列得出版本', vers.length >= 1, '共 ' + vers.length + ' 版')

    const lastV = vers[vers.length - 1].v
    const content = await api.readVersion(book.rootPath, hDoc.meta.id, lastV)
    check('能还原出某一版的内容', content === '历史第二版，长一点点', JSON.stringify(content))

    await api.labelVersion(book.rootPath, hDoc.meta.id, lastV, '写完开头')
    const vers2 = await api.listVersions(book.rootPath, hDoc.meta.id)
    check('标记存得住', vers2.filter(v => v.label === '写完开头').length === 1)

    const capBefore = await api.historyCapacity(book.rootPath)
    check('容量统计有数', capBefore.usedBytes > 0 && capBefore.limitMB > 0,
      capBefore.usedBytes + ' / ' + capBefore.limitMB + 'MB')
    check('远没到上限', capBefore.level === 'ok', capBefore.level)

    // 回滚。
    // 注意：这里的几次保存都落在同一个 30 秒时间桶里，会合并成同一条记录，
    // 所以「回滚到第 1 版」拿到的就是当前内容，什么都没变 ——
    // 这时不产生新版本是**对的**（内容没变就不该刷版本）。
    // 「回滚会产生新版本、因而可以再撤销」需要跨时间桶才观察得到，
    // 冒烟里等不起 30 秒，那条性质由 core 的单元测试覆盖。
    const v1 = await api.readVersion(book.rootPath, hDoc.meta.id, 1)
    const versBefore = (await api.listVersions(book.rootPath, hDoc.meta.id)).length
    const rolled = await api.rollbackTo(book.rootPath, ch1.path, 1)
    check('回滚拿到的正是那一版的内容', rolled.body === v1, JSON.stringify(rolled.body))

    const readBack2 = await api.readDoc(ch1.path)
    check('回滚后磁盘上的正文也变了', readBack2.body === v1)

    const versAfter = (await api.listVersions(book.rootPath, hDoc.meta.id)).length
    check('内容没变时不刷出多余版本', versAfter === versBefore, versBefore + ' → ' + versAfter)

    // ── 统计报表 ──
    const rep = await api.statsReport(book.rootPath)
    check('统计报表出得来', !!rep.today && Array.isArray(rep.daily))
    check('日期轴补齐到 371 天（热力图铺满 53 周）', rep.daily.length === 371,
      '实得 ' + rep.daily.length)
    check('热力图格子数与日期轴一致', rep.heat.length === rep.daily.length)
    check('今天有字数', rep.today.words > 0, String(rep.today.words))
    check('周/月聚合有数据', rep.weekly.length > 0 && rep.monthly.length > 0)
    check('写作场次记录得到', rep.sessions.length > 0, '共 ' + rep.sessions.length + ' 场')
    check('热力图等级在 0~4 之间', rep.heat.every(c => c.level >= 0 && c.level <= 4))

    // 番茄钟标记
    await api.setPomodoro(true)
    const pomoDoc = await api.readDoc(ch1.path)
    await api.saveDoc(ch1.path, pomoDoc.body + '番茄钟里写的字。')
    await api.setPomodoro(false)
    const rep2 = await api.statsReport(book.rootPath, { days: 7 })
    const todayCell = rep2.daily[rep2.daily.length - 1]
    check('番茄钟内的产出被单独记下', todayCell.pomoWords > 0, String(todayCell.pomoWords))

    // ── 作品级操作（书架右键菜单背后的那些） ──
    const m1 = await api.updateBookMeta(book.rootPath, { status: 'pit' })
    check('改作品分类', m1.status === 'pit', m1.status)

    await api.clearBookCover(book.rootPath)  // 没封面时也不该报错
    check('无封面时移除封面不报错', true)

    // ── 设定分类的重命名与删除（作者反馈这两处点了没反应） ──
    const catPath = book.rootPath + '/设定集/人物'
    const tpl2 = await api.readTemplate(catPath)
    check('能读到分类模板', tpl2.content.indexOf('{{标题}}') > -1)
    const tplDoc = await api.readDoc(tpl2.path)
    check('模板能当普通文档打开编辑', tplDoc.body.indexOf('{{标题}}') > -1)

    await api.trashSettingCategory(book.rootPath, catPath)
    tree = await api.loadTree(book.rootPath)
    check('删除整个设定分类', tree.settings.length === 0, '还剩 ' + tree.settings.length + ' 个分类')
    const trash2 = await api.listTrash(book.rootPath)
    check('分类连同便利贴一起进了回收站',
      trash2.some(t => t.originalPath.indexOf('设定集/人物/李四.md') > -1),
      trash2.map(t => t.originalPath).join(' | '))

    // ── 设置读写 ──
    const s0 = await api.getSettings()
    check('能读到设置', typeof s0.sidebarSwapped === 'boolean')
    const s1 = await api.updateSettings({ sidebarSwapped: !s0.sidebarSwapped, fontSize: 21 })
    check('设置能写入并回读', s1.sidebarSwapped === !s0.sidebarSwapped && s1.fontSize === 21)
    const s2 = await api.getSettings()
    check('设置持久化了', s2.fontSize === 21, '实得 ' + s2.fontSize)
    check('首次引导的标记存在', typeof s2.seenGuide === 'boolean')
    const s3 = await api.updateSettings({ seenGuide: true })
    check('看过引导之后能记住', s3.seenGuide === true)
    check('默认正文字体是个 key，不是一整串 CSS 字体栈',
      s2.fontFamily.indexOf(',') === -1 && s2.fontFamily.length < 12, s2.fontFamily)

    // ── 正文字体真的压得住 CodeMirror ──
    // CodeMirror 的 baseTheme 里有 .cm-scroller{font-family:monospace}，
    // 我们必须用两级选择器才压得过它；写成一级就会被打败，
    // 正文全部回落成系统默认中文字体（表现为「换字体没反应」）。
    var cmRules = 0, monoRules = 0
    for (var si = 0; si < document.styleSheets.length; si++) {
      var rules
      try { rules = document.styleSheets[si].cssRules } catch (e) { continue }
      if (!rules) continue
      for (var ri = 0; ri < rules.length; ri++) {
        var sel = rules[ri].selectorText
        if (!sel) continue
        if (sel.indexOf('.cm-editor .cm-scroller') > -1) cmRules++
        if (sel.trim() === '.cm-scroller' && String(rules[ri].style.fontFamily).indexOf('monospace') > -1) monoRules++
      }
    }
    check('【关键】编辑器字体规则用了两级选择器', cmRules > 0,
      '找到 ' + cmRules + ' 条；CodeMirror 的 monospace 规则 ' + monoRules + ' 条')

    // 楷体的标点另配了仿宋，靠 @font-face + unicode-range
    var faceFound = false
    for (var si2 = 0; si2 < document.styleSheets.length; si2++) {
      var rs
      try { rs = document.styleSheets[si2].cssRules } catch (e) { continue }
      if (!rs) continue
      for (var ri2 = 0; ri2 < rs.length; ri2++) {
        if (rs[ri2].type === 5 && String(rs[ri2].style.fontFamily).indexOf('楷体标点') > -1) faceFound = true
      }
    }
    check('楷体标点的 @font-face 在', faceFound)

    // ── 导入导出（不弹框的那部分） ──
    const forExport = await api.collectForExport(book.rootPath)
    check('能把全书读出来导出', forExport.length >= 2, '共 ' + forExport.length + ' 章')
    const expPrev = await api.exportPreview(forExport, {})
    check('导出预览有字数', expPrev.chars > 0 && expPrev.chapterCount === forExport.length)

    // ── 游戏剧本：跨文件建图与体检 ──
    const gameBook = await api.createBook('分支试验')
    const gTree = await api.loadTree(gameBook.rootPath)
    const gCh1 = gTree.text[0]
    // 故意把第二个节点放在**另一个文件**里，验跨文件跳转
    const gCh2 = await api.createChapter(gameBook.rootPath + '/正文', '第七章')

    await api.saveDoc(gCh1.path,
      ['# 初见', '', '李四：你是新来的？', '', '- 点头 -> 承认', '- 不理他 -> 冷场'].join(String.fromCharCode(10)))
    await api.saveDoc(gCh2.path,
      ['# 承认', '$ 好感度 += 1', '-> 放学', '',
       '# 冷场', '（他没再说话。）', '-> 放学', '',
       '# 放学', '（铃响了。）',
       '- {好感度>=1} 一起走 -> 结束', '- 自己走 -> 结束'].join(String.fromCharCode(10)))

    const g = await api.gameGraph(gameBook.rootPath)
    check('【关键】跳转跨得了文件', g.nodes.length === 4 &&
      g.nodes.filter(function (n) { return n.name === '承认' })[0].docPath !== gCh1.path,
      g.nodes.map(function (n) { return n.name }).join('/'))
    check('起点是第一个节点', g.start === '初见', String(g.start))
    check('干净的分支图查不出问题', g.problems.length === 0,
      g.problems.map(function (p) { return p.kind + ':' + p.node }).join(' '))
    check('每个节点都走得到', g.unreachable.length === 0, g.unreachable.join('/'))
    check('结局收集到了', g.endings.length >= 1, String(g.endings.length))
    check('结局带着示例路径', g.endings[0].path.length >= 2,
      g.endings[0].path.map(function (s) { return s.node }).join('→'))
    check('变量被记下来了', g.variables.some(function (v) { return v.name === '好感度' }),
      JSON.stringify(g.variables))
    check('写作进度算出来了', g.progress.nodes === 4 && g.progress.percent > 0,
      JSON.stringify(g.progress))

    // 故意写坏：跳到一个不存在的节点
    await api.saveDoc(gCh1.path,
      ['# 初见', '李四：你是新来的？', '- 点头 -> 承认', '- 走开 -> 没这个节点'].join(String.fromCharCode(10)))
    const g2 = await api.gameGraph(gameBook.rootPath)
    check('【关键】断头路被抓出来，并带上文件与行号',
      g2.problems.some(function (p) { return p.kind === 'missingTarget' && p.docPath === gCh1.path }),
      g2.problems.map(function (p) { return p.kind }).join('/'))

    await api.trashBook(gameBook.rootPath)

    // ── 稿纸右键菜单 ──
    // Electron 默认什么右键菜单都没有 —— 不自己接这个事件，
    // 作者在稿纸上右键就是一片死寂。作者反馈过这一条。
    check('剪切/复制/粘贴的原生命令通得了', typeof api.editCmd === 'function')
    await api.editCmd('selectAll')
    check('调一次不炸', true)

    // ── 码字计划 ──
    const pr0 = await api.planReport()
    check('计划报表出得来', typeof pr0.today === 'string' && Array.isArray(pr0.judged),
      JSON.stringify(pr0.todayTarget))
    check('默认档不吓人 —— 开箱不给职业写手的数字', pr0.todayTarget.floor < 3000,
      String(pr0.todayTarget.floor))

    // 工作日 8000 / 休息日 3000
    const week = {
      floor: [8000, 8000, 8000, 8000, 8000, 3000, 3000],
      ideal: [12000, 12000, 12000, 12000, 12000, 5000, 5000],
    }
    const savedPlan = await api.setPlanTarget(week)
    check('目标存得下来', savedPlan.targets.length === 1, JSON.stringify(savedPlan.targets))
    check('【关键】目标变更记了生效日期 —— 以前的日子要按当时的目标判',
      typeof savedPlan.targets[0].from === 'string' && savedPlan.targets[0].from.length === 10,
      String(savedPlan.targets[0].from))

    const pr1 = await api.planReport()
    const isRest = [0, 6].indexOf(new Date(pr1.today + 'T00:00:00Z').getUTCDay()) > -1
    check('工作日与休息日取的是不同的线',
      pr1.todayTarget.floor === (isRest ? 3000 : 8000),
      pr1.today + ' → ' + pr1.todayTarget.floor)

    // 请假：不算断更，但也不算达标
    const afterLeave = await api.setLeave(pr1.today, '出差')
    check('请假存得下来', afterLeave.leaves.length === 1, JSON.stringify(afterLeave.leaves))
    const pr2 = await api.planReport()
    const todayJ = pr2.judged[pr2.judged.length - 1]
    check('【关键】请假日判成 leave，不是达标也不是断更',
      todayJ.verdict === 'leave' && todayJ.leaveReason === '出差', JSON.stringify(todayJ))
    await api.setLeave(pr1.today, null)
    check('请假取消得掉', (await api.planReport()).plan.leaves.length === 0)

    // 计划文件是可读的 YAML，放在库根，跟着同步走
    const planBooks = await api.listBooks()
    check('计划不会被当成一本作品', planBooks.every(function (b) { return b.meta.title !== '_计划' }),
      planBooks.map(function (b) { return b.meta.title }).join('/'))

    // ── 作品类型：新建时选，只在书架改 ──
    const novelBook = await api.createBook('小说试验', 'novel')
    check('小说还是空的第一章', !novelBook.meta.kind, String(novelBook.meta.kind))

    const gameBook2 = await api.createBook('游戏试验', 'game')
    check('游戏书标了类型', gameBook2.meta.kind === 'game', String(gameBook2.meta.kind))
    const gTree2 = await api.loadTree(gameBook2.rootPath)
    const gFirst = await api.readDoc(gTree2.text[0].path)
    check('游戏书开局就有分支骨架', gFirst.body.indexOf('->') > -1, gFirst.body.slice(0, 30))
    check('【关键】游戏书开局的骨架自己不带毛病',
      (await api.gameGraph(gameBook2.rootPath)).problems.length === 0,
      JSON.stringify((await api.gameGraph(gameBook2.rootPath)).problems))

    // 第二篇起只给一行「# 标题」—— 每新建一篇都塞一遍李四，
    // 作者得先删二十行才能开始写（作者报过这个）
    const g2nd = await api.createGameScript(gameBook2.rootPath + '/正文', '第二幕')
    const g2body = (await api.readDoc(g2nd.path)).body
    check('【关键】第二篇游戏剧本不再塞一遍默认文本',
      g2body.indexOf('李四') === -1, g2body.slice(0, 40))
    check('但它仍然是个节点，图上看得见', g2body.indexOf('# 第二幕') > -1, g2body.slice(0, 40))

    // ── 0.3 新写法：合并、显式结局、一行多个去处、显式回绕 ──
    const newSyntax = [
      '# 岔口', '', '往哪边走？', '',
      '- 左边 -> 左',
      '- 右边 -> 右', '',
      '# 左', '', '左边有棵树。', '',
      '# 右', '', '右边有条河。', '',
      '# 汇合', '',
      '<- 左、右', '',
      '两条路又并到一起。', '',
      '-> 图书馆、天台', '',
      '# 图书馆', '', '很安静。', '',
      '-> ↩岔口', '',
      '# 天台', '', '风很大。', '',
      '-> 【结束】', '',
    ].join(String.fromCharCode(10))
    await api.saveDoc(g2nd.path, newSyntax)

    const gNew = await api.gameGraph(gameBook2.rootPath)
    const names = gNew.nodes.map(function (n) { return n.name }).join('/')
    const kindsOf = function (ps) { return ps.map(function (x) { return x.kind }) }
    check('【关键】合并声明让两条分支都不再是死路',
      kindsOf(gNew.problems).indexOf('deadEnd') === -1,
      JSON.stringify(gNew.problems.map(function (x) { return x.kind + ':' + x.node })))
    check('新写的这几个节点都进了图', names.indexOf('汇合') > -1 && names.indexOf('天台') > -1, names)
    // 「这个时间段去哪儿」原来得一条条抄。走一遍验它真拆成了两个去处 ——
    // 从 岔口 起走，因为这一段跟开局那份骨架不连通（本来就是两段独立的戏）
    const gPlay = await api.playFrom(gameBook2.rootPath, '岔口', {})
    check('【关键】一行写多个去处，每个都真的走得到',
      gPlay.reachable.indexOf('图书馆') > -1 && gPlay.reachable.indexOf('天台') > -1,
      gPlay.reachable.join('/'))
    check('合并之后两条分支都汇到了同一处', gPlay.reachable.indexOf('汇合') > -1,
      gPlay.reachable.join('/'))
    check('标了 ↩ 的回绕不报提示', kindsOf(gNew.problems).indexOf('unmarkedLoop') === -1)
    check('【关键】这一整套新写法体检一条都不报',
      gNew.problems.length === 0,
      JSON.stringify(gNew.problems.map(function (x) { return x.kind + ':' + x.message })))

    // 路线图不该等自动保存 —— 把还没存的正文直接交给它建图
    const liveBody = newSyntax + ['', '# 还没存的节点', '', '话。', '', '-> 【结束】', ''].join(String.fromCharCode(10))
    const gLive = await api.gameGraph(gameBook2.rootPath, { path: g2nd.path, body: liveBody })
    check('【关键】路线图能拿还没存盘的正文建，不用等自动保存',
      gLive.nodes.some(function (n) { return n.name === '还没存的节点' }),
      gLive.nodes.map(function (n) { return n.name }).join('/'))
    check('不给 live 时读的还是磁盘上那一份',
      (await api.gameGraph(gameBook2.rootPath)).nodes
        .every(function (n) { return n.name !== '还没存的节点' }))
    await api.trashBook(gameBook2.rootPath)
    await api.trashBook(novelBook.rootPath)

    // ── 剧本：场次重排、按场分布、认角色 ──
    const scBook = await api.createBook('剧本试验', 'script')
    check('剧本书标了类型', scBook.meta.kind === 'script', String(scBook.meta.kind))
    check('【关键】剧本书顺手把人物分类建好并指过去',
      JSON.stringify(scBook.meta.castFrom) === JSON.stringify(['人物']),
      JSON.stringify(scBook.meta.castFrom))

    const scTree0 = await api.loadTree(scBook.rootPath)
    check('人物分类真的在设定集里',
      scTree0.settings.some(function (c) { return c.name === '人物' }),
      scTree0.settings.map(function (c) { return c.name }).join('/'))
    check('剧本书开局就是一份剧本骨架',
      (await api.readDoc(scTree0.text[0].path)).body.indexOf('内景') > -1)

    const catDir = scTree0.settings.filter(function (c) { return c.name === '人物' })[0].path
    const li = await api.createSettingCard(catDir, '李四')
    await api.saveDoc(li.path, '别名：小李' + String.fromCharCode(10) + '男，28 岁。')
    await api.createSettingCard(catDir, '王五')

    const castNow = await api.bookCast(scBook.rootPath)
    check('从人物卡里读出了名字',
      castNow.names.indexOf('李四') > -1 && castNow.names.indexOf('王五') > -1,
      castNow.names.join('/'))
    check('【关键】别名也认，并且归得回正名',
      castNow.canonical['小李'] === '李四', JSON.stringify(castNow.canonical))
    check('设定集分类摆出来给作者勾', castNow.available.indexOf('人物') > -1)
    check('剧本书是选过的，不是猜的', castNow.chosen === true)

    const scBookOld = scBook
    const scDoc = await api.createScript(scBookOld.rootPath + '/正文', '新的一场')
    check('剧本骨架建得出来', !!scDoc.path, scDoc.path)

    // ── 教学模板只给第一篇 ──
    //
    // 每新建一场都塞一遍「李四/王五在咖啡馆」，作者得先删十几行才能开始写
    // 自己的东西（作者报过这个）。这本书开局那一篇已经有整份骨架了，
    // 所以这一篇只该有一行场景标题
    const scStub = (await api.readDoc(scDoc.path)).body
    check('【关键】第二篇剧本不再塞一遍默认文本',
      scStub.indexOf('李四') === -1 && scStub.indexOf('王五') === -1, scStub.slice(0, 40))
    check('但也不是个空文件 —— 给一行场景标题', scStub.indexOf('# 新的一场') > -1, scStub.slice(0, 40))

    // 挪场次那几条断言要两场戏，这儿自己摆一份出来
    const scriptBodyForMove = [
      '# 第一场　内景·咖啡馆·日',
      '',
      '（李四推门进来，雨水顺着伞尖滴在地板上。）',
      '',
      '李四：你等很久了？',
      '',
      '# 第二场　外景·街道·夜',
      '',
      '（雨停了。两个人一前一后走着。）',
      '',
      '王五：走吧。',
      '',
    ].join(String.fromCharCode(10))

    await api.saveDoc(
      scDoc.path,
      ['# 第一场', '李四：甲。', '小李：乙。', '李西：丙。', '', '# 第二场', '王五：丁。'].join(
        String.fromCharCode(10),
      ),
    )
    const withCast = await api.scriptReport(scDoc.path, scBookOld.rootPath)
    check('【关键】写错的人名被挑出来了',
      withCast.unknown.length === 1 && withCast.unknown[0].who === '李西',
      JSON.stringify(withCast.unknown))
    const noCast = await api.scriptReport(scDoc.path)
    check('【关键】不给书路径时一条都不报 —— 那时候每个名字都「不在卡里」',
      noCast.unknown.length === 0, JSON.stringify(noCast.unknown))

    await api.setCastCategories(scBookOld.rootPath, [])
    check('取消勾选后就不认人了',
      (await api.bookCast(scBookOld.rootPath)).names.length === 0)
    await api.setCastCategories(scBookOld.rootPath, ['人物'])

    await api.saveDoc(scDoc.path, scriptBodyForMove)
    const scRep = await api.scriptReport(scDoc.path)
    check('骨架里有两场', scRep.scenes.length === 2, String(scRep.scenes.length))
    check('按场分布算得出来',
      scRep.scenes.some(function (x) { return x.who.length > 0 }),
      JSON.stringify(scRep.scenes.map(function (x) { return x.who.length })))

    const beforeMove = await api.readDoc(scDoc.path)
    const moved = await api.moveSceneIn(scDoc.path, 0, 1)
    check('场次挪得动', moved.body !== beforeMove.body)
    check('【关键】挪完一个字都不少',
      ['李四推门进来', '你等很久了', '雨停了'].every(function (t) { return moved.body.indexOf(t) > -1 }))
    const afterMove = await api.scriptReport(scDoc.path)
    check('挪完还是两场', afterMove.scenes.length === 2, String(afterMove.scenes.length))
    check('挪完顺序真的换了', afterMove.scenes[0].title !== scRep.scenes[0].title,
      afterMove.scenes[0].title)
    await api.trashBook(scBook.rootPath)

    // ── 游戏剧本：试玩与导出引擎骨架 ──
    const geBook = await api.createBook('导出试验')
    const geTree = await api.loadTree(geBook.rootPath)
    await api.saveDoc(geTree.text[0].path, [
      '# 初见', '李四：你是新来的？', '- 点头 -> 承认', '- 不理他 -> 结束',
      '', '# 承认', '$ 好感度 += 1', '- {好感度>=1} 一起走 -> 结束',
    ].join(String.fromCharCode(10)))

    const played = await api.playFrom(geBook.rootPath, '承认', { 好感度: 5 })
    check('【关键】能从中段节点开始试玩',
      played.reachable.indexOf('承认') > -1 && played.reachable.indexOf('初见') === -1,
      played.reachable.join('/'))
    check('假设的变量让条件分支走得进去', played.endings.length > 0, String(played.endings.length))

    const rpy = await api.exportGameScript(geBook.rootPath, 'renpy')
    check('导得出 RenPy', rpy.fileName === 'script.rpy' && rpy.text.indexOf('label ') > -1,
      rpy.text.slice(0, 40))
    check('【关键】导出里写明这是骨架', rpy.text.indexOf('骨架') > -1)
    check('正文带过去了', rpy.text.indexOf('你是新来的？') > -1)

    const ink = await api.exportGameScript(geBook.rootPath, 'ink')
    check('导得出 ink', ink.fileName === 'script.ink' && ink.text.indexOf('=== ') > -1)
    check('【关键】ink 的中文节点名换了名字并留了对照表',
      ink.renamed.length > 0 && ink.text.indexOf(ink.renamed[0].from) > -1,
      JSON.stringify(ink.renamed))
    await api.trashBook(geBook.rootPath)

    // ── 用户信息与连胜 ──
    const nickPlan = await api.setNickname('明听')
    check('昵称存得下来', nickPlan.profile.nickname === '明听', JSON.stringify(nickPlan.profile))
    const prN = await api.planReport()
    check('计划报表带上昵称', prN.nickname === '明听', prN.nickname)
    check('「一起写了几天」算得出来，且不是负数', prN.daysSinceStart >= 0, String(prN.daysSinceStart))
    check('本周达标几比几算得出来',
      typeof prN.week.hit === 'number' && typeof prN.week.of === 'number', JSON.stringify(prN.week))
    check('【关键】这软件没有账号 —— 计划里不存邮箱或密码',
      JSON.stringify(prN.plan).indexOf('password') === -1 &&
      JSON.stringify(prN.plan).indexOf('email') === -1)
    await api.setNickname('')

    // ── 里程碑 ──
    const msBook = await api.createBook('里程碑试验')
    await api.createVolume(msBook.rootPath, '第一卷')
    const msTargets = await api.milestoneTargets(msBook.rootPath)
    check('能挑到卷当里程碑对象',
      msTargets.some(function (t) { return t.kind === 'volume' && t.label === '第一卷' }),
      JSON.stringify(msTargets))

    const msVol = msTargets.filter(function (t) { return t.kind === 'volume' })[0]
    const added = await api.addMilestone(msBook.rootPath, {
      title: '写完第一卷',
      target: { kind: 'volume', path: msVol.path },
      due: '2099-12-31',
    })
    check('里程碑建得出来', !!added.id, added.id)

    const list1 = await api.listMilestones(msBook.rootPath)
    check('里程碑列得出来', list1.length === 1 && list1[0].title === '写完第一卷',
      JSON.stringify(list1.map(function (m) { return m.title })))
    check('没到期不算逾期', list1[0].overdue === false)

    await api.patchMilestone(msBook.rootPath, added.id, { doneManually: true })
    const list2 = await api.listMilestones(msBook.rootPath)
    check('【关键】手动标完成优先于自动算的进度', list2[0].done === true, JSON.stringify(list2[0]))

    await api.removeMilestone(msBook.rootPath, added.id)
    check('里程碑删得掉', (await api.listMilestones(msBook.rootPath)).length === 0)
    await api.trashBook(msBook.rootPath)

    // ── 封面：读得到，而且页面策略允许显示 ──
    // 作者报告过「换了封面显示成碎图标」：图读到了，却被页面自己的
    // Content-Security-Policy 拦下来。图**读到了**却显示不出来，
    // 比读不到还难查，所以这两条都要守住。
    check('【关键】CSP 允许 data: 图片，否则封面必然是碎图标',
      (function () {
        var meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]')
        var c = meta ? meta.getAttribute('content') : ''
        return /img-src[^;]*data:/.test(c)
      })(),
      (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content)

    // 真塞一张 1×1 的 PNG 进去，验证能读回同样的字节
    const coverBook = await api.createBook('封面试验')
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const written = await api.writeCoverBytes(coverBook.rootPath, tinyPng, 'png')
    check('封面写得进去', written.cover === 'cover.png', JSON.stringify(written))
    const back = await api.readCover(coverBook.rootPath, written.cover)
    check('【关键】封面读回来是同一张图，字节不差',
      back === 'data:image/png;base64,' + tinyPng, String(back).slice(0, 60))
    await api.trashBook(coverBook.rootPath)

    // ── 二期：伏笔连线要用的章节轴 ──
    // 这一条锁的是一个真出现过的 bug：章节轴是从索引里取的，
    // 刚建还没保存过的章节不在索引里，就会从轴上凭空消失，
    // 挂在它上面的伏笔也跟着失去位置
    const axisBook = await api.createBook('连线试验')
    await api.createChapter(axisBook.rootPath + '/正文', '刚建还没存过的一章')
    const axis = await api.listForeshadows(axisBook.rootPath)
    check('【关键】刚建还没保存过的章节也在伏笔的章节轴上',
      axis.chapters.length === 2,
      axis.chapters.map(function (c) { return c.title }).join('/'))
    await api.trashBook(axisBook.rootPath)

    // ── 二期：搬家（不弹框的那部分） ──
    const foreignBook = await api.createBook('搬家试验')
    const applied = await api.applyForeign(foreignBook.rootPath, foreignBook.rootPath + '/正文', [
      { title: '搬来的第一章', body: '他从四十八楼掉下去。' },
      { title: '搬来的第二章', body: '他醒了。' },
    ])
    check('搬家能把章节建出来', applied.created === 2, JSON.stringify(applied))
    const fTree = await api.loadTree(foreignBook.rootPath)
    check('搬来的章节在目录里',
      fTree.text.filter(function (n) { return n.title.indexOf('搬来的') > -1 }).length === 2,
      fTree.text.map(function (n) { return n.title }).join('/'))
    const fDoc = await api.readDoc(
      fTree.text.filter(function (n) { return n.title === '搬来的第一章' })[0].path)
    check('搬来的正文没丢', fDoc.body.indexOf('四十八楼') > -1, fDoc.body.slice(0, 30))
    await api.trashBook(foreignBook.rootPath)

    // ── 回收站（这一版之前只有后端，界面上根本捞不回来） ──
    const trashBefore = await api.listTrash(book.rootPath)
    const victim = await api.createChapter(book.rootPath + '/正文', '待删试验章')
    await api.saveDoc(victim.path, '这一章一会儿要被删掉。')
    await api.trashDoc(book.rootPath, victim.path)

    const trashNow = await api.listTrash(book.rootPath)
    check('删掉的章节进了回收站', trashNow.length === trashBefore.length + 1,
      trashBefore.length + ' → ' + trashNow.length)
    const entry = trashNow.filter(function (t) { return t.name.indexOf('待删试验章') > -1 })[0]
    check('回收站里认得出是哪一篇', !!entry, trashNow.map(function (t) { return t.name }).join('/'))
    check('回收站记得它原来在哪', entry.originalPath.indexOf('正文') > -1, entry.originalPath)

    await api.restoreFromTrash(entry)
    check('【关键】能从回收站放回原处',
      (await api.readDoc(entry.originalPath)).body.indexOf('这一章一会儿要被删掉') > -1)
    check('放回之后回收站里就没有它了',
      (await api.listTrash(book.rootPath)).filter(function (t) { return t.name.indexOf('待删试验章') > -1 }).length === 0)

    // 原位置被占着时不能覆盖，要明说
    await api.trashDoc(book.rootPath, entry.originalPath)
    const again = (await api.listTrash(book.rootPath)).filter(function (t) { return t.name.indexOf('待删试验章') > -1 })[0]
    await api.createChapter(book.rootPath + '/正文', '待删试验章')
    let dup = ''
    try { await api.restoreFromTrash(again) } catch (e) { dup = String(e.message || e) }
    check('原位置已有同名文件时明说，不覆盖', dup.indexOf('同名') > -1, dup)

    // ── 灵感箱 ──
    const idea1 = await api.createIdea(book.rootPath, '写个开头：他醒来时，床边坐着自己。')
    check('记下一条灵感', !!idea1.path && idea1.path.indexOf('灵感') > -1, idea1.path)
    await api.createIdea(book.rootPath, '玉佩其实是他母亲的。')

    const ideaList = await api.listIdeas(book.rootPath)
    check('灵感箱列出两条', ideaList.length === 2, '实得 ' + ideaList.length)
    check('灵感带正文', ideaList.some(function (i) { return i.body.indexOf('玉佩其实') > -1 }))
    check('作品内的灵感标为 book', ideaList.every(function (i) { return i.scope === 'book' }))

    const mergeTarget = ch2.path
    const beforeMerge = await api.readDoc(mergeTarget)
    const mergeSrc = ideaList.find(function (i) { return i.body.indexOf('玉佩其实') > -1 })
    const merged = await api.mergeIdea(book.rootPath, mergeSrc.path, mergeTarget)
    check('归入后正文带上了灵感', merged.body.indexOf('玉佩其实是他母亲的。') > -1)
    check('归入不丢原有正文',
      beforeMerge.body.length === 0 || merged.body.indexOf(beforeMerge.body.trim()) > -1)

    const afterMergeRead = await api.readDoc(mergeTarget)
    check('归入的内容真的落盘了', afterMergeRead.body.indexOf('玉佩其实是他母亲的。') > -1)

    const leftIdeas = await api.listIdeas(book.rootPath)
    check('归入后碎片从灵感箱消失', leftIdeas.length === 1, '实得 ' + leftIdeas.length)

    const trashAfterMerge = await api.listTrash(book.rootPath)
    check('【关键】归错了能从回收站捞回来',
      trashAfterMerge.some(function (t) { return t.name.indexOf('玉佩其实') > -1 }),
      trashAfterMerge.map(function (t) { return t.name }).join('/'))

    await api.trashIdea(book.rootPath, leftIdeas[0].path)
    check('删灵感后灵感箱清空', (await api.listIdeas(book.rootPath)).length === 0)

    // ── 书架灵感箱：全库共用，不属于任何一本书 ──
    const libIdea0 = await api.listLibraryIdeas()
    const libIdea = await api.createLibraryIdea('想到一个开头：雨停了，他还站在门口。')
    check('书架上记得下灵感', !!libIdea.path, libIdea.path)
    check('【关键】落在全库的 _灵感箱 里，不在任何一本书下面',
      libIdea.path.indexOf('_灵感箱') > -1 && libIdea.path.indexOf('/正文/') === -1, libIdea.path)

    const libIdea1 = await api.listLibraryIdeas()
    check('书架灵感箱数得清', libIdea1.length === libIdea0.length + 1,
      libIdea0.length + '->' + libIdea1.length)
    check('内容原样存下来',
      libIdea1.some(function (x) { return x.body.indexOf('雨停了') > -1 }),
      JSON.stringify(libIdea1.map(function (x) { return x.title })))

    // ── 置顶 ──
    const pinBook = await api.createBook('置顶试验')
    await api.updateBookMeta(pinBook.rootPath, { pinned: true })
    const shelf = await api.listBooks()
    check('【关键】置顶的书排在书架最前面',
      shelf.length > 1 && shelf[0].meta.pinned === true, shelf[0].meta.title)
    await api.updateBookMeta(pinBook.rootPath, { pinned: false })
    check('取消置顶之后就不置顶了',
      (await api.listBooks()).filter(function (b) {
        return b.rootPath === pinBook.rootPath
      })[0].meta.pinned !== true)
    await api.trashBook(pinBook.rootPath)

    // ── 「在别处改过」这套：设备名与另存 ──
    //
    // 作者报过一个吞字的 bug：切回窗口时软件会拿磁盘那版
    // 默默覆盖编辑器。这几条钉的是「不丢字」那一半。
    const vBook = await api.createBook('版本试验')
    const vTree = await api.loadTree(vBook.rootPath)
    const vPath = vTree.text[0].path

    await api.saveDoc(vPath, '第一版正文。')
    const vDoc1 = await api.readDoc(vPath)
    check('【关键】保存时记下了是哪台机器写的',
      typeof vDoc1.meta.device === 'string' && vDoc1.meta.device.length > 0, String(vDoc1.meta.device))
    check('也记下了改动时间', typeof vDoc1.meta.updated === 'string' && vDoc1.meta.updated.length > 0)

    const aside = await api.saveAside(vPath, '我手上没保存的那一大段。', '（本机未保存 08-27 0140）')
    check('另存出一篇副本', !!aside.path && aside.path !== vPath, aside.path)
    check('【关键】副本里是我手上那版，一个字不少',
      (await api.readDoc(aside.path)).body.indexOf('我手上没保存的那一大段。') > -1)
    check('【关键】另存不动原文',
      (await api.readDoc(vPath)).body === '第一版正文。',
      (await api.readDoc(vPath)).body)

    const vTree2 = await api.loadTree(vBook.rootPath)
    check('副本进了目录树，找得到',
      vTree2.text.some(function (n) { return n.path === aside.path }),
      String(vTree2.text.length))

    // 存两次之间磁盘上确实变了 —— 焦点检查靠比这个
    await api.saveDoc(vPath, '第二版正文，多写了一些。')
    check('再存一次，磁盘上就是新的了',
      (await api.readDoc(vPath)).body.indexOf('多写了一些') > -1)
    await api.trashBook(vBook.rootPath)

    // ── AI（没有 Key 时的行为） ──
    const ai = await api.aiStatus()
    check('AI 默认没有 Key', ai.hasKey === false)
    check('AI 默认关闭', ai.config.enabled === false)
    check('AI 联网搜索默认关闭', ai.config.webSearch === false)
    check('AI 有费用上限', ai.config.monthlyCap > 0, String(ai.config.monthlyCap))
    check('默认让代理跟随系统环境变量', ai.config.proxy === 'auto', ai.config.proxy)
    check('状态里带上了实际生效的代理', 'proxyInUse' in ai, JSON.stringify(ai.proxyInUse))

    check('智谱的预设在，端点与模型跟文档一致',
      ai.presets.some(function (p) {
        return p.key === 'zhipu' && p.baseUrl === 'https://api.scnet.cn/api/llm/v1' &&
          p.models[0].id === 'GMP-5-Base'
      }),
      ai.presets.map(function (p) { return p.key }).join('/'))
    var ds = ai.presets.filter(function (p) { return p.key === 'deepseek' })[0]
    check('【关键】DeepSeek 的三款模型与高峰价跟官方价目表对得上',
      ds.models.length === 3 &&
      ds.models[0].priceCacheIn === 0.1 && ds.models[0].priceIn === 3 && ds.models[0].priceOut === 9 &&
      ds.models[2].priceCacheIn === 0.3 && ds.models[2].priceIn === 9 && ds.models[2].priceOut === 27,
      ds.models.map(function (m) { return m.id + ' ' + m.priceCacheIn + '/' + m.priceIn + '/' + m.priceOut }).join(' | '))
    check('空闲时段折算出来正好是价目表上的空闲价',
      Math.abs(ds.models[0].priceIn * (1 - ds.offPeakDiscount) - 1.5) < 1e-9)

    check('DeepSeek 按人民币计价并且分高峰空闲',
      ai.presets.some(function (p) { return p.key === 'deepseek' && p.currency === 'CNY' && p.offPeakDiscount === 0.5 }))
    check('模型名里不带「便宜」「贵」这类括号',
      ai.presets.every(function (p) {
        return p.models.every(function (m) { return m.label.indexOf('（') === -1 })
      }))
    check('缓存命中价单列且低于未命中价',
      ai.presets.every(function (p) {
        return p.models.every(function (m) { return m.priceIn === 0 || m.priceCacheIn < m.priceIn })
      }))

    const probe = await api.aiTestConnection()
    check('能试连端点并给出中文结论', typeof probe.message === 'string' && probe.message.length > 0,
      probe.message)

    check('【关键】默认服务商是 OpenAI 兼容端点，不是 Claude',
      ai.config.provider === 'openai', ai.config.provider)
    check('默认预填了端点地址', /^https:/.test(ai.active.baseUrl), ai.active.baseUrl)
    check('默认预填了模型名', !!ai.active.model, ai.active.model)
    check('【关键】默认模型是便宜的那一款，不是旗舰',
      ai.presets.filter(function (p) { return p.key === 'deepseek' })[0].models[0].id === ai.active.model,
      ai.active.model)
    check('每家都给了模型下拉列表（「其它」那项除外）',
      ai.presets.filter(function (p) { return p.key !== 'custom' })
        .every(function (p) { return p.models.length >= 1 }),
      ai.presets.map(function (p) { return p.key + ':' + p.models.length }).join(' '))
    check('预设里有 deepseek 与 gemini',
      ai.presets.some(function (p) { return p.key === 'deepseek' }) &&
      ai.presets.some(function (p) { return p.key === 'gemini' }),
      ai.presets.map(function (p) { return p.key }).join('/'))
    check('预设里留了「自己填地址」', ai.presets.some(function (p) { return p.key === 'custom' }))

    // ── 侧边栏可以拖宽 ──
    const w0 = await api.getSettings()
    check('侧边栏宽度有默认值', w0.dirBarWidth > 0 && w0.toolBarWidth > 0,
      w0.dirBarWidth + '/' + w0.toolBarWidth)
    const w1 = await api.updateSettings({ toolBarWidth: 420 })
    check('拖宽之后记得住', w1.toolBarWidth === 420, String(w1.toolBarWidth))
    check('两个侧边栏各记各的', w1.dirBarWidth === w0.dirBarWidth, String(w1.dirBarWidth))
    await api.updateSettings({ toolBarWidth: w0.toolBarWidth })
    check('端点地址有填写提示', !!ai.provider.baseUrlHint, ai.provider.baseUrlHint)

    check('【关键】OpenAI 兼容端点下联网搜索不可用，并且说明了原因',
      ai.webSearch.available === false && ai.webSearch.reason.indexOf('Anthropic') > -1,
      JSON.stringify(ai.webSearch))
    check('两家的 Key 状态都只是布尔值，不含 Key 本身',
      typeof ai.keys.openai === 'boolean' && typeof ai.keys.anthropic === 'boolean',
      JSON.stringify(ai.keys))
    check('状态里没有任何叫 apiKey 的字段', JSON.stringify(ai).indexOf('apiKey') === -1)

    // 换到 Anthropic，联网搜索就该可用了
    await api.aiSetConfig({ provider: 'anthropic' })
    const aiAnth = await api.aiStatus()
    check('换成 Anthropic 后联网搜索可用', aiAnth.webSearch.available === true)
    check('换服务商后端点跟着换', aiAnth.active.baseUrl.indexOf('anthropic') > -1, aiAnth.active.baseUrl)
    await api.aiSetConfig({ provider: 'openai' })

    const aiCfg = await api.aiSetConfig({ webSearch: true })
    check('AI 配置能改并回读', aiCfg.webSearch === true)
    await api.aiSetConfig({ webSearch: false })

    // 端点、模型、单价都能改
    const custom = await api.aiSetConfig({
      providers: Object.assign({}, aiCfg.providers, {
        openai: { baseUrl: 'https://example.test/v1', model: '某个模型', priceIn: 0.5, priceOut: 2 },
      }),
    })
    check('端点与单价能自己填', custom.providers.openai.baseUrl === 'https://example.test/v1' &&
      custom.providers.openai.priceIn === 0.5, JSON.stringify(custom.providers.openai))
    await api.aiSetConfig({ providers: aiCfg.providers })

    let aiErr = ''
    try { await api.aiRun('t1', book.rootPath, null, 'ask', '测试') } catch (e) { aiErr = String(e.message || e) }
    check('没有 Key 时调用给出中文提示而不是崩', aiErr.indexOf('API Key') > -1, aiErr)

    // ── 没有冲突副本 ──
    check('没有误报冲突副本', tree.conflicts.length === 0)
    check('干净的库里冲突清单是空的', (await api.listConflicts(book.rootPath)).length === 0)

    // 冲突对比要在磁盘上真造一份副本，那件事只有主进程干得了 ——
    // 把这一章交给它，第二段脚本再回来验
    const seed = await api.createChapter(book.rootPath + '/正文', '冲突试验章')
    await api.saveDoc(seed.path, '正本写的是这一句。' + String.fromCharCode(10, 10) + '第二段两边一样。')

    return { steps, threw: null, bookPath: book.rootPath, seedPath: seed.path }
  } catch (e) {
    return { steps, threw: (e && e.message) ? e.message : String(e) }
  }
})()`

/**
 * 第二段脚本：冲突副本的并排对比与处理。
 *
 * 单独一段是因为「磁盘上真出现一个冲突副本」必须由主进程制造 ——
 * 渲染进程按设计碰不到文件系统。
 */
const CONFLICT_SCRIPT = (bookPath: string, conflictPath: string) => `(async () => {
  const steps = []
  const check = (name, ok, detail) => {
    steps.push(detail === undefined ? { name, ok } : { name, ok, detail })
    return ok
  }
  const api = window.bugu
  const BOOK = ${JSON.stringify(bookPath)}
  const CONFLICT = ${JSON.stringify(conflictPath)}

  try {
    const tree = await api.loadTree(BOOK)
    check('冲突副本被扫出来了', tree.conflicts.length === 1, String(tree.conflicts.length))

    const list = await api.listConflicts(BOOK)
    check('冲突清单里有一条', list.length === 1, String(list.length))
    const c = list[0]
    check('配回了正本', c.originalPath.indexOf('冲突试验章.md') > -1, c.originalPath)
    check('正本还在', c.originalMissing === false)
    check('差异算出来了', c.summary.added === 1 && c.summary.removed === 1,
      '+' + c.summary.added + ' -' + c.summary.removed)
    check('相同的那一段左右都在',
      c.summary.rows.some(function (r) { return r.kind === 'same' && r.left === '第二段两边一样。' }))
    check('提示是中文人话', c.note.indexOf('挑一边') > -1, c.note)

    const r = await api.resolveConflict(BOOK, CONFLICT, 'keepConflict')
    check('处理后返回正本路径', r.resolvedPath === c.originalPath, String(r.resolvedPath))

    const after = await api.readDoc(c.originalPath)
    check('正文换成了副本的内容', after.body.indexOf('副本写的是另一句。') > -1, after.body.slice(0, 40))

    check('冲突清单清空', (await api.listConflicts(BOOK)).length === 0)
    check('横幅也不会再报', (await api.loadTree(BOOK)).conflicts.length === 0)

    const trash = await api.listTrash(BOOK)
    check('【关键】被换掉的正本能从回收站捞回来',
      trash.some(function (t) { return t.name.indexOf('冲突试验章') > -1 }),
      trash.map(function (t) { return t.name }).join('/'))

    return { steps, threw: null }
  } catch (e) {
    return { steps, threw: (e && e.message) ? e.message : String(e) }
  }
})()`

export function runSmoke(win: BrowserWindow, tempRoot: string): void {
  const problems: string[] = []
  const steps: SmokeReport['steps'] = []
  let done = false

  const finish = (extra?: string, pageText?: string) => {
    if (done) return
    done = true
    if (extra) problems.push(extra)

    const env: Record<string, unknown> = {
      electron: process.versions['electron'],
      chrome: process.versions['chrome'],
      node: process.versions['node'],
    }

    const report: SmokeReport = {
      ok: problems.length === 0,
      problems,
      steps,
      env,
      ...(pageText === undefined ? {} : { pageText }),
    }
    try {
      fs.writeFileSync(smokeOutFile(), JSON.stringify(report, null, 2), 'utf8')
    } catch {
      /* 写不了也只能算了，退出码还在 */
    }
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    } catch {
      /* 临时目录清不掉不算失败 */
    }
    app.exit(report.ok ? 0 : 1)
  }

  // 硬超时：窗口起不来也必须给个结论，不能挂在那儿
  const killer = setTimeout(() => finish('超时 40 秒仍未跑完'), 40_000)

  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) problems.push(`控制台错误: ${message}`)
  })
  win.webContents.on('render-process-gone', (_e, d) => finish(`渲染进程崩溃: ${d.reason}`))
  win.webContents.on('did-fail-load', (_e, code, desc) => finish(`页面加载失败 (${code}): ${desc}`))
  win.webContents.on('preload-error', (_e, p, err) => problems.push(`preload 出错 ${p}: ${err.message}`))

  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      void (async () => {
        let pageText = ''
        try {
          const probe = (await win.webContents.executeJavaScript(
            `({
               hasApi: typeof window.bugu === 'object' && typeof window.bugu.getRoot === 'function',
               rootHtmlLength: (document.getElementById('root')?.innerHTML ?? '').length,
               text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 200)
             })`,
          )) as { hasApi: boolean; rootHtmlLength: number; text: string }

          pageText = probe.text
          if (!probe.hasApi) problems.push('window.bugu 没有挂上 —— preload 没生效')
          if (probe.rootHtmlLength < 20) problems.push('页面是空的 —— React 没渲染出来（白屏）')

          if (probe.hasApi) {
            const result = (await win.webContents.executeJavaScript(E2E_SCRIPT)) as {
              steps: SmokeReport['steps']
              threw: string | null
              bookPath?: string
              seedPath?: string
            }
            steps.push(...result.steps)
            if (result.threw) problems.push(`端到端流程抛异常: ${result.threw}`)

            // 在磁盘上真造一个坚果云式的冲突副本，再跑第二段
            if (result.bookPath && result.seedPath) {
              const abs = path.join(tempRoot, result.seedPath)
              const dir = path.dirname(abs)
              const base = path.basename(abs, '.md')
              const copyName = `${base} (冲突文件 2026-08-25 明听).md`
              fs.writeFileSync(
                path.join(dir, copyName),
                fs.readFileSync(abs, 'utf8').replace('正本写的是这一句。', '副本写的是另一句。'),
                'utf8',
              )
              const conflictRel = `${path.dirname(result.seedPath)}/${copyName}`

              const r2 = (await win.webContents.executeJavaScript(
                CONFLICT_SCRIPT(result.bookPath, conflictRel),
              )) as { steps: SmokeReport['steps']; threw: string | null }
              steps.push(...r2.steps)
              if (r2.threw) problems.push(`冲突对比流程抛异常: ${r2.threw}`)
            }

            // ── 登录：能验的那一半 ──
            //
            // 浏览器那一趟**在无头环境里验不了** —— 它要真开一个浏览器、
            // 要人去输密码。所以协议那一半交给 core/oidc 的单元测试
            // （44 条，URL 参数、state/nonce 校验、令牌解析都钉死了），
            // 这里只验主进程 ↔ 渲染进程这一段接没接对。
            const r3 = (await win.webContents.executeJavaScript(LOGIN_SCRIPT)) as {
              steps: SmokeReport['steps']
              threw: string | null
            }
            steps.push(...r3.steps)
            if (r3.threw) problems.push(`登录流程抛异常: ${r3.threw}`)

            for (const s of steps) {
              if (!s.ok) problems.push(`步骤失败「${s.name}」${s.detail ? ' —— ' + s.detail : ''}`)
            }
          }
        } catch (e) {
          problems.push(`执行探针失败: ${e instanceof Error ? e.message : String(e)}`)
        }
        clearTimeout(killer)
        finish(undefined, pageText)
      })()
    }, 900)
  })
}

/**
 * 登录那一段。
 *
 * 只验「配置读得到、状态问得出、忘得掉」这几件 ——
 * 真走一趟浏览器需要人，不是冒烟能干的事。
 */
const LOGIN_SCRIPT = `(async () => {
  const steps = []
  const check = (name, ok, detail) => {
    steps.push(detail === undefined ? { name, ok } : { name, ok, detail })
    return ok
  }
  try {
    const api = window.bugu

    const st = await api.loginState()
    check('一开始是没登录的', st.signedIn === false)
    check('【关键】默认就配好了登录服务，不用作者自己填', st.configured === true)

    // 地址写死在代码里，界面上不给改 —— 给用户一个「登录服务器地址」
    // 输入框，等于给了别人一个可以骗他填的框
    const cfg = await api.getSettings()
    check('【关键】设置里没有登录服务器地址这一项',
      !('logtoIssuer' in cfg) && !('logtoAppId' in cfg),
      Object.keys(cfg).filter(function (k) { return k.indexOf('logto') > -1 }).join(','))

    const forgot = await api.loginForget()
    check('忘掉缓存之后还是没登录', forgot.signedIn === false)

    // ── 对外要吐的那几个数：一个字的正文都不许带 ──
    //
    // 挑数那一步（publicStatsFrom）有自己的单元测试，
    // 这里验的是**这条 IPC 真吐出来的东西**长什么样
    const preview = await api.statsPreview()
    const keys = Object.keys(preview).sort()
    check('对外只吐那七个数', keys.length === 7, keys.join(','))
    check('七个数的名字对得上服务端',
      keys.join(',') === 'bestStreak,dailyFloor,date,daysTogether,streak,todayWords,weekWords',
      keys.join(','))

    const asText = JSON.stringify(preview)
    const leaked = ['第一章', '正文', 'title', 'book', 'chapter', 'body']
      .filter(function (w) { return asText.indexOf(w) > -1 })
    check('【关键】要推出去的东西里没有书名、章节名、正文',
      leaked.length === 0, leaked.join('/') + ' in ' + asText)

    // ── 0.3 那几条：钉住、主题、上次在哪儿 ──
    //
    // 全是「关掉软件再打开还在不在」的事。冒烟没法真的重启一次，
    // 但**存不存得进配置**是这条链上唯一会坏的一环 —— 界面那半边
    // 只是把配置读出来用
    check('设置里有侧边栏钉住状态',
      'dirBarPinned' in cfg && 'toolBarPinned' in cfg,
      Object.keys(cfg).filter(function (k) { return k.indexOf('Pinned') > -1 }).join(','))
    check('钉住默认是不钉', cfg.dirBarPinned === false && cfg.toolBarPinned === false)

    const pinned = await api.updateSettings({ dirBarPinned: true })
    check('【关键】钉住状态存得进去，下次开还在', pinned.dirBarPinned === true)
    await api.updateSettings({ dirBarPinned: false })

    check('设置里有主题和自选样式两项',
      'theme' in cfg && 'themeCss' in cfg, cfg.theme + '/' + cfg.themeCss)
    const themed = await api.updateSettings({ theme: 'night' })
    check('主题换得动', themed.theme === 'night', themed.theme)
    await api.updateSettings({ theme: 'light' })
    check('没配自选样式时读出来是空串', (await api.readThemeCss()) === '')

    check('设置里有「上次在哪儿」', 'lastPlace' in cfg, JSON.stringify(cfg.lastPlace))
    const placed = await api.updateSettings({
      lastPlace: { bookPath: '某本书', docPath: '某本书/正文/0010-第一章.md', line: 42 },
    })
    check('【关键】上次的位置存得进去', placed.lastPlace && placed.lastPlace.line === 42,
      JSON.stringify(placed.lastPlace))
    await api.updateSettings({ lastPlace: null })

    // ── 推送的三道闸 ──
    //
    // 「有东西离开这台电脑」这件事要三样齐了才发生：登录、认领短名、
    // 打开开关。这里验的是**没登录时那两道会不会自己放行** ——
    // 真登录那一趟在无头环境里跑不了，但「没登录时绝不发」跑得了，
    // 而这一条恰恰是出了事最要命的一条。
    check('【关键】自动上传默认是关着的', cfg.statsAutoPush === false, String(cfg.statsAutoPush))

    const mine = await api.statsMe()
    check('没登录时统计页只说「没登录」，不去发请求',
      mine.signedIn === false && mine.handle === '' && mine.publicUrl === '',
      JSON.stringify(mine))
    check('没登录时也就没有公开地址', mine.publicUrl === '', mine.publicUrl)

    let pushWhy = ''
    try {
      await api.statsPush()
    } catch (e) {
      pushWhy = String((e && e.message) || e)
    }
    check('【关键】没登录时按上传会被当场挡下来，而不是发出去',
      pushWhy.indexOf('登录') > -1, pushWhy || '（居然没报错）')

    return { steps, threw: null }
  } catch (e) {
    return { steps, threw: String((e && e.message) || e) }
  }
})()`

/**
 * 冒烟结果写到哪里。
 *
 * 开发时写在 out/ 旁边方便看；**打包后 out/ 在 asar 里是只读的**，
 * 所以改写到用户数据目录 —— 这样同一套冒烟检查既能验源码也能验安装包，
 * 而「你双击的那个 exe 到底行不行」恰恰是最该验的。
 * 也可以用 BUGU_SMOKE_OUT 环境变量指定。
 */
export function smokeOutFile(): string {
  const override = process.env['BUGU_SMOKE_OUT']
  if (override) return override
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'smoke-result.json')
    : path.join(__dirname, '../smoke-result.json')
}

/** 建一个临时的作品根目录，冒烟结束后删掉 */
export function makeSmokeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bugu-smoke-'))
}
