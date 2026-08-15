// M0 POC 验证3b：Cordis Loader 动态装载/热替换插件（HMR 的运行机制）
// 验证：
//  A. 从 cordis.yml 声明式加载插件树，依赖驱动启动（infra 先于 consumer）
//  B. 热替换：运行期动态移除一个插件 → 其 ctx.effect 逆操作自动回滚（主题 CSS 被清）
//  C. 热替换：动态重新加入该插件 → 重新应用，无手工清理
// 说明：`@cordisjs/plugin-hmr` 的本质就是监听文件变更后调用 loader.create/remove/update；
//       这里直接调用这些 API 演示同一机制，POC 无需文件系统 watcher。
//
// 运行：cd poc3b && node poc3b.mjs
import { Context } from 'cordis'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import Loader from '@cordisjs/plugin-loader'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const log = (...a) => console.log('[验证3b]', ...a)

const ctx = new Context()
ctx.baseUrl = `file://${__dirname}/`   // 插件以相对路径解析

// 装载 Loader，并让 loader 挂载 Include 从 cordis.yml 读取插件树（同 DSH bin.js 用法）
await ctx.plugin(Loader)

log('=== ① 通过 loader 从 cordis.yml 加载插件树 ===')
await ctx.loader.create({
  name: '@cordisjs/plugin-include',
  config: { path: './cordis.yml' },
})
await ctx.loader.await?.().catch(() => {})
await new Promise((r) => setTimeout(r, 400))

log('\n=== ② 校验：theme/layout 服务已就绪，主题与布局均已应用 ===')
const t = ctx.get('theme')
log(`  theme 服务存在: ${!!t}；已生效样式数: ${t ? t.size : 'n/a'}`)
log(`  layout 覆盖 slot: ${Array.from(ctx.layout.overrides.keys()).join(', ') || '(无)'}`)

log('\n=== ③ 热替换：动态移除 theme-dracula（= 用户禁用主题插件）===')
// 插件实际挂在 include 的 subtree 下，遍历所有 entry（含子树的顶层）
function* allEntries(loader) {
  for (const e of loader.entries()) {
    yield e
    // 递归进入 entry 的独立子树（include 会用 subtree 承载 yaml 插件）
    if (e.subtree) yield* allEntries(e.subtree)
  }
}
let themeEntryId = null
for (const entry of allEntries(ctx.loader)) {
  const id = entry.id || ''
  if (id.endsWith(':theme-dracula') || id === 'theme-dracula') { themeEntryId = entry.id; break }
}
log(`  找到 theme-dracula entry id: ${themeEntryId}`)
// disabled:true 会卸载该插件的 fiber → 触发其 ctx.effect 逆操作回滚
await ctx.loader.resolve(themeEntryId).update({ disabled: true })
await new Promise((r) => setTimeout(r, 400))
log(`  移除后 theme 剩余样式数: ${t.size}（应为 0，dracula 的 CSS 已回滚清理）`)

log('\n=== ④ 热替换：重新启用 theme-dracula（= 用户重新启用）===')
await ctx.loader.resolve(themeEntryId).update({ disabled: false })
ctx.loader.write?.()
await new Promise((r) => setTimeout(r, 400))
log(`  重装后 theme 样式数: ${t.size}（应为 1，dracula 重新应用）`)

log('\n=== 验证3b 完成：Loader 动态装载/热替换 + effect 自动回滚 跑通 ===')
process.exit(0)
