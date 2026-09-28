/**
 * 检查新版本的那一半纯计算。
 *
 * 这一层有两种错，后果差得很远：
 *   · 版本比错了 —— 顶多是少提示一次、或者多提示一次
 *   · **清单读松了** —— 一个 http 的地址、一个假的哈希，
 *     就能让作者的读者在自己机器上跑一个别人塞进来的 exe
 *
 * 所以下面「不许过」的用例比「要过」的多。
 */
import { describe, it, expect } from 'vitest'
import { compareVersions, isNewer, parseManifest, pickAsset } from './update.js'

const SHA = 'a'.repeat(64)
const good = {
  version: '1.1.0',
  name: '某某',
  date: '2026-10-01',
  notes: '改了点东西',
  page: 'https://github.com/LurTyang/buguniao/releases',
  setup: { url: 'https://例子.com/setup.exe', size: 1000, sha256: SHA },
  portable: { url: 'https://例子.com/portable.exe', size: 900, sha256: SHA },
}

describe('比版本号', () => {
  it('大的新', () => {
    expect(isNewer('1.1.0', '1.0.0')).toBe(true)
    expect(isNewer('1.0.1', '1.0.0')).toBe(true)
    expect(isNewer('0.5.0', '1.0.0')).toBe(false)
  })

  it('一样就不是新的 —— 不然每次启动都提示一遍', () => {
    expect(isNewer('1.0.0', '1.0.0')).toBe(false)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })

  it('位数不一样也比得了', () => {
    expect(isNewer('1.1', '1.0.9')).toBe(true)
    expect(isNewer('1.0', '1.0.0')).toBe(false)
  })

  it('【关键】正式版比预发布版新 —— 装着 preview 的人最该收到提示', () => {
    expect(isNewer('1.0.0', '1.0.0-preview.3')).toBe(true)
    expect(isNewer('1.0.0-preview.3', '1.0.0')).toBe(false)
    expect(isNewer('1.0.0', '1.0.0-if')).toBe(true)
  })

  it('预发布段之间按数字比，不按字符串', () => {
    // 字符串比的话 "10" < "3"，于是发了 preview.10 却没人收到
    expect(isNewer('0.5.0-preview.10', '0.5.0-preview.3')).toBe(true)
  })

  it('开头的 v 不影响', () => {
    expect(isNewer('v1.1.0', '1.0.0')).toBe(true)
  })
})

describe('读清单', () => {
  it('正常的一份读得出来', () => {
    const m = parseManifest(good)
    expect(m?.version).toBe('1.1.0')
    expect(m?.setup?.sha256).toBe(SHA)
  })

  it('字符串形式的 JSON 也认', () => {
    expect(parseManifest(JSON.stringify(good))?.version).toBe('1.1.0')
  })

  it('【关键】明文 http 的下载地址不许过', () => {
    const bad = { ...good, setup: { ...good.setup, url: 'http://例子.com/setup.exe' }, portable: null }
    expect(parseManifest(bad)).toBeNull()
  })

  it('【关键】哈希不对格式的不许过', () => {
    const bad = { ...good, setup: { ...good.setup, sha256: '不是哈希' }, portable: null }
    expect(parseManifest(bad)).toBeNull()
    const short = { ...good, setup: { ...good.setup, sha256: 'abc123' }, portable: null }
    expect(parseManifest(short)).toBeNull()
  })

  it('【关键】一个包都没有时当作没有更新', () => {
    expect(parseManifest({ ...good, setup: null, portable: null })).toBeNull()
  })

  it('返回了一页 HTML、或者别的什么东西，一律当没有更新', () => {
    expect(parseManifest('<!doctype html><html>404</html>')).toBeNull()
    expect(parseManifest(null)).toBeNull()
    expect(parseManifest([1, 2, 3])).toBeNull()
    expect(parseManifest({})).toBeNull()
    expect(parseManifest({ version: '乱写的' })).toBeNull()
  })

  it('page 不是 https 就当没有 —— 那也是个能被改坏的地方', () => {
    expect(parseManifest({ ...good, page: 'http://例子.com' })?.page).toBe('')
  })

  it('只有一个包也行', () => {
    expect(parseManifest({ ...good, portable: null })?.setup).not.toBeNull()
  })
})

describe('该下哪个包', () => {
  const m = parseManifest(good)!

  it('安装版下安装版，免安装版下免安装版', () => {
    expect(pickAsset(m, true)?.url).toContain('setup')
    expect(pickAsset(m, false)?.url).toContain('portable')
  })

  it('只发了一种时就用那一种', () => {
    const onlySetup = parseManifest({ ...good, portable: null })!
    expect(pickAsset(onlySetup, false)?.url).toContain('setup')
  })
})
