/**
 * demo-view —— M9-6 示例「视图插件」。
 *
 * 演示向宿主贡献一个自定义视图（导航项 + 页面）：在 ui store manifest 里新增
 * 一个 builtin=false 的 view，前端据此把导航项渲染进顶部导航、动态注册对应路由，
 * 页面内容走 PluginHtmlView（v-html）。
 *
 * 走 UiRegistryService.registerView，卸载即移除（effect 回滚，导航项随之消失）。
 */
export const name = 'demo-view'
export const version = '1.0.0'
export const inject = ['uiRegistry']

export function apply(ctx) {
  ctx.effect(() => {
    const off = ctx.uiRegistry.registerView({
      key: 'demo-view',
      label: '示例视图',
      path: '/demo-view',
      order: 10, // 排在内置五页之后
      type: 'html',
      html:
        '<div class="plugin-demo-view">' +
        '<p><strong>这是一个由插件贡献的页面（M9-6 视图插件）</strong></p>' +
        '<p>导航项与路由均由 <code>uiRegistry.registerView</code> 贡献，卸载后自动消失。</p>' +
        '</div>',
    })
    process.stderr.write('[demo-view] 应用：注册视图（导航项 + 页面）\n')
    return () => {
      off()
      process.stderr.write('[demo-view] 卸载：视图贡献已移除\n')
    }
  })
}
