/**
 * demo-layout —— M8-1 示例布局插件（Phase 0）。
 *
 * 演示向某个 slot 注入一段 HTML（布局/组件置换）。
 * 走 UiRegistryService.registerLayout，卸载即移除（effect 回滚）。
 * 注意：注入的 HTML 由插件作者提供、经前端 v-html 渲染——宿主信任其 phase0 hash 校验，
 *       但插件作者应自行保证不含恶意脚本（宿主 CSP 亦会限制内联脚本执行）。
 */
export const name = 'demo-layout'
export const version = '1.0.0'
export const inject = ['uiRegistry']

export function apply(ctx) {
  ctx.effect(() => {
    const footerHtml = '<p class="plugin-footer">① 由 demo-layout 插件注入的页脚（Phase 0 布局贡献）</p>'
    const homeHtml = '<div class="plugin-widget"><strong>demo-layout 主页小部件</strong><p>布局插件可替换/扩展任意 slot。</p></div>'
    const offs = [
      ctx.uiRegistry.registerLayout({ slot: 'footer', name, html: footerHtml }),
      ctx.uiRegistry.registerLayout({ slot: 'home-widget', name, html: homeHtml }),
    ]
    process.stderr.write(`[demo-layout] 应用：注入 footer + home-widget 两个 slot\n`)
    return () => {
      for (const off of offs) off()
      process.stderr.write(`[demo-layout] 卸载：两个 slot 贡献已移除\n`)
    }
  })
}
