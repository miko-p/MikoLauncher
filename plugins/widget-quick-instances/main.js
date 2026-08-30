/**
 * widget-quick-instances —— 「快速实例展示」小组件插件（苹果应用分类区块风格）。
 *
 * 往主页「小组件面板」贡献一块「快速实例」卡片：把实例列表渲染成一组圆角磁贴
 * （图标 + 名字），点击进详情、磁贴上一键启动 —— 类似苹果手机 App 分类区块/应用库。
 *
 * 实例数据是运行时动态的（需读实例 store + 交互跳转/启动），无法放进静态 html，
 * 因此本插件只贡献 key/title/order/width 等「外壳声明」，宿主前端对
 * `widget-quick-instances` 这个 key 特判渲染成 Vue 组件
 * （见 apps/desktop/src/components/QuickInstancesWidget.vue），而非 v-html。
 * 这里保留占位 html 仅作面板库里的缩略预览。
 */
export const name = 'widget-quick-instances'
export const version = '1.0.0'
export const inject = ['uiRegistry']

export function apply(ctx) {
  ctx.effect(() => {
    const off = ctx.uiRegistry.registerWidget({
      key: 'widget-quick-instances',
      title: '快速实例',
      order: 2,
      width: 'full',
      html:
        '<div class="widget-quick-instances-preview">' +
        '<p style="margin:0;color:var(--text-dim,#8b8490)">（快速实例：一组圆角磁贴，点击进详情、一键启动）</p>' +
        '</div>',
    })
    process.stderr.write('[widget-quick-instances] 应用：注册快速实例小组件卡片\n')
    return () => {
      off()
      process.stderr.write('[widget-quick-instances] 卸载：快速实例小组件卡片已移除\n')
    }
  })
}
