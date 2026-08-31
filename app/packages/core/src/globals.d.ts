/**
 * core 允许依赖的**全部**平台 API，在此显式声明。
 *
 * 这里刻意不引入 `lib: DOM` 也不引入 `@types/node` ——
 * 一旦引入，`window`、`document`、`fs` 就都变得可用，
 * core「零平台依赖」的铁律就没有任何东西守着了。
 *
 * 下面两个是 Node 与浏览器**都有**的标准 API，可以安全使用。
 * 想加第三个的时候请先想清楚：它在 Electron 主进程、Electron 渲染进程、
 * 安卓 WebView 里都存在吗？
 */

declare class TextEncoder {
  encode(input?: string): Uint8Array
}

declare const crypto:
  | {
      getRandomValues?<T extends ArrayBufferView>(array: T): T
    }
  | undefined

declare class TextDecoder {
  decode(input?: Uint8Array): string
}
