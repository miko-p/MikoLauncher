/**
 * sidecar 打包脚本 —— 把 plugin-host (Cordis + Vue 无关的纯 Node) 打成单文件 ESM。
 *
 * 用 esbuild 把 src/main.ts + cordis + @miko-launcher/shared 全部 bundle 成
 * dist/main.mjs。M9 起 SQLite 用 Node 内置的 `node:sqlite`，无任何原生模块
 * external——因此产物是纯 JS 单文件，可被 `bun build --compile` 直接内嵌。
 *
 * 输出：
 *   dist/main.mjs      —— 单文件 ESM（可用 `node dist/main.mjs` 直接跑）
 *   dist/main.mjs.map  —— sourcemap
 *
 * 该产物供 Tauri externalBin 打包链使用：见仓库顶层 BUILD-SIDECAR 说明。
 */
import { build } from 'esbuild'

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  banner: {
    // 告知这是打包产物，勿手改
    js: '// MikoLauncher plugin-host — esbuild bundle。编辑 src/，勿直接改本文件。',
  },
})
