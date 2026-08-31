import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: 'src/main/index.ts' },
        // externalizeDepsPlugin 只外部化 dependencies，而 electron 在 devDependencies，
        // 于是 electron 包自身（那个负责定位 electron.exe 的壳）会被内联进产物，
        // 运行时报 "Electron failed to install correctly"。必须显式外部化。
        external: ['electron'],
        // 必须输出 .cjs。
        //
        // package.json 里有 "type": "module"，Node 会把 .js 当 ES 模块解析；
        // 而 electron-vite 默认把主进程编译成 CommonJS，编译时会把源码里的
        // import.meta.url 转成基于 __filename 的代码 —— 那两个变量在 ES 模块里
        // 不存在，于是应用一启动就抛 "__dirname is not defined"。
        // 用 .cjs 扩展名把它钉死为 CommonJS，两边就对上了。
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: 'src/preload/index.ts' },
        external: ['electron'],
        // 包是 ESM（package.json 的 type: module），而 Electron 加载 ESM preload
        // 要求 .mjs 扩展名。输出成 CJS 的 .cjs 最省事也最兼容。
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: { rollupOptions: { input: { index: 'src/renderer/index.html' } } },
  },
})
