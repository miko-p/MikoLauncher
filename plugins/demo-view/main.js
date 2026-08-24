/**
 * demo-view —— M9-6 示例「视图插件」（真交互）。
 *
 * 演示向宿主贡献一个自定义视图（导航项 + 页面），且该视图带可点动作：
 *   - `registerView({ ..., actions: [...] })`：声明页面上的按钮（id + label）
 *   - `ctx.rustBridge.on('view.demo-view.<action>', handler)`：注册动作处理器，
 *     前端点按钮 → Rust `plugin_view_action` → sidecar `view.<key>.<action>` → handler
 *     → 结果回显页面。
 *
 * 走 UiRegistryService.registerView（卸载即移除导航项），handler 走
 * rustBridge.on（卸载即反注册）——两者都在 ctx.effect 里，时间可组合回滚。
 */
export const name = 'demo-view'
export const version = '1.0.0'
export const inject = ['uiRegistry', 'rustBridge']

export function apply(ctx) {
  ctx.effect(() => {
    // 视图贡献：导航项 + 页面（html）+ 可点动作
    const offView = ctx.uiRegistry.registerView({
      key: 'demo-view',
      label: '示例视图',
      path: '/demo-view',
      order: 10, // 排在内置五页之后
      type: 'html',
      html:
        '<div class="plugin-demo-view">' +
        '<p><strong>这是一个由插件贡献的页面（M9-6 视图插件）</strong></p>' +
        '<p>页面内容与动作按钮均由插件声明；点按钮会触发 sidecar 插件的 handler。</p>' +
        '<p>卸载插件后，本页导航项与按钮一起消失（effect 回滚）。</p>' +
        '</div>',
      actions: [
        { id: 'greet', label: '打个招呼' },
        { id: 'toggle', label: '切换状态' },
      ],
    })

    // 动作处理器：view.<key>.<action>
    const offHello = ctx.rustBridge.on('view.demo-view.greet', () => ({
      title: '来自插件 handler',
      message: `你好！我是 demo-view 插件，当前时间占位。`,
      at: new Date().toISOString(),
    }))

    const offToggle = ctx.rustBridge.on('view.demo-view.toggle', (params) => {
      const on = params?.on ?? false
      return { title: '状态切换', message: `当前状态：${on ? '开' : '关'}`, at: new Date().toISOString() }
    })

    process.stderr.write('[demo-view] 应用：注册视图 + greet/toggle 动作 handler\n')
    return () => {
      offView()
      offHello()
      offToggle()
      process.stderr.write('[demo-view] 卸载：视图 + 动作 handler 已移除\n')
    }
  })
}
