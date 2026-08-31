/**
 * 封面读写测试。
 *
 * 作者报告：换了封面之后书架上显示成一个碎图标。
 * 碎图标意味着 data URL **拿到了但解不开** —— 比读不到更难查，
 * 因为界面看起来「有反应」。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Workspace } from './workspace.js'

let root: string
let ws: Workspace

/** 一张真的 1×1 PNG。base64 是标准的那张最小图 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'bugu-cover-'))
  ws = new Workspace(root, 'pc-test', path.join(root, '_index.db'))
})

afterEach(async () => {
  ws.close()
  await fs.rm(root, { recursive: true, force: true })
})

describe('封面', () => {
  it('【关键】换上去的封面读回来是同一张图，字节不差', async () => {
    const book = await ws.createBook('封面试验')
    const src = path.join(root, '来源.png')
    await fs.writeFile(src, PNG)

    const { cover } = await ws.setBookCover(book.rootPath, src)
    const url = await ws.readCoverDataUrl(book.rootPath, cover)

    expect(url).toMatch(/^data:image\/png;base64,/)
    const back = Buffer.from(url!.slice(url!.indexOf(',') + 1), 'base64')
    expect(back.equals(PNG)).toBe(true)
  })

  it('落盘的文件本身也和源文件一模一样', async () => {
    const book = await ws.createBook('封面试验')
    const src = path.join(root, '来源.png')
    await fs.writeFile(src, PNG)
    const { cover } = await ws.setBookCover(book.rootPath, src)

    const onDisk = await fs.readFile(path.join(root, book.rootPath, cover))
    expect(onDisk.equals(PNG)).toBe(true)
  })

  it('book.yaml 里记下了封面文件名', async () => {
    const book = await ws.createBook('封面试验')
    const src = path.join(root, '来源.png')
    await fs.writeFile(src, PNG)
    await ws.setBookCover(book.rootPath, src)

    const list = await ws.listBooks()
    expect(list[0]!.meta.cover).toBe('cover.png')
  })

  it('换格式时旧的那张要删掉', async () => {
    const book = await ws.createBook('封面试验')
    const jpg = path.join(root, 'a.jpg')
    const png = path.join(root, 'b.png')
    await fs.writeFile(jpg, PNG)
    await fs.writeFile(png, PNG)

    await ws.setBookCover(book.rootPath, jpg)
    await ws.setBookCover(book.rootPath, png)

    const files = await fs.readdir(path.join(root, book.rootPath))
    expect(files.filter((f) => f.startsWith('cover.'))).toEqual(['cover.png'])
  })

  it('大写扩展名也认', async () => {
    const book = await ws.createBook('封面试验')
    const src = path.join(root, '来源.PNG')
    await fs.writeFile(src, PNG)
    const { cover } = await ws.setBookCover(book.rootPath, src)
    expect(cover).toBe('cover.png')
    expect(await ws.readCoverDataUrl(book.rootPath, cover)).toMatch(/^data:image\/png/)
  })

  it('读不到时返回 null，界面退回占位色块', async () => {
    const book = await ws.createBook('封面试验')
    expect(await ws.readCoverDataUrl(book.rootPath, 'cover.png')).toBeNull()
  })
})
