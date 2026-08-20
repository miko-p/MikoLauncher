/**
 * sidecar 打包脚本 —— 把 plugin-host (Cordis + Vue 无关的纯 Node) 打成单文件 ESM。
 *
 * 用 esbuild 把 src/main.ts + cordis + @miko-launcher/shared 全部 bundle 成
 * dist/main.mjs，仅剩 better-sqlite3（原生 .node 模块）留作 external——
 * 它运行时从打包目录的 node_modules 原生加载，无法 bundle 进 JS。
 *
 * 输出：
 *   dist/main.mjs      —— 单文件 ESM（可用 `node dist/main.mjs` 直接跑，验证过）
 *   dist/main.mjs.map  —— sourcemap
 *
 * 该产物供 Tauri externalBin 打包链使用：见仓库顶层 BUILD-SIDECAR 说明。
 * 部署版需要一个能跑 better-sqlite3 的 Node 运行时（pkg/bun 内嵌，或装机 Node）。
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
  // 原生模块无法 bundle：运行时从 node_modules 解析（构建时将打包目录一并带上）。
  external: ['better-sqlite3'],
  logLevel: 'info',
  banner: {
    // 告知这是打包产物，勿手改
    js: '// MikoLauncher plugin-host — esbuild bundle。编辑 src/，勿直接改本文件。',
  },
})
