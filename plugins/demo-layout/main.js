/**
 * demo-layout —— M8-1 示例布局插件（Phase 0）。
 *
 * M8-1 演示向通用 slot 注入一段 HTML（布局/组件置换）。
 * M10 起「主页小部件」升级为专门的小组件面板：把原 home-widget 的贡献改由
 * registerWidget 贡献成卡片（title + 内文），作为另一个演示小组件实例。
 * footer 仍走通用布局 slot（布局插件语义不变）。
 *
 * 注意：注入的 HTML 由插件作者提供、经前端 v-html 渲染——宿主信任其 phase0 hash 校验，
 *       但插件作者应自行保证不含恶意脚本（宿主 CSP 亦会限制内联脚本执行）。
 */
export const name = 'demo-layout'
export const version = '1.0.0'
export const inject = ['uiRegistry']

export function apply(ctx) {
  ctx.effect(() => {
    const footerHtml = '<p class="plugin-footer">① 由 demo-layout 插件注入的页脚（Phase 0 布局贡献）</p>'
    const widgetHtml =
      '<div class="plugin-widget"><p>demo-layout 也以小组件形式贡献一块到主页面板。</p>' +
      '<p style="font-size:.75rem;color:var(--text-dim,#8b8490)">来自 registerWidget · 布局插件语义保留在 footer</p></div>'
    const offs = [
      ctx.uiRegistry.registerLayout({ slot: 'footer', name, html: footerHtml }),
      ctx.uiRegistry.registerWidget({
        key: 'demo-layout',
        title: 'demo-layout 小组件',
        order: 10,
        width: 'auto',
        html: widgetHtml,
      }),
    ]
    process.stderr.write(`[demo-layout] 应用：注入 footer slot + 注册 demo-layout 小组件\n`)
    return () => {
      for (const off of offs) off()
      process.stderr.write(`[demo-layout] 卸载：footer 贡献 + 小组件已移除\n`)
    }
  })
}
