/**
 * widget-account —— M10 账号小组件插件。
 *
 * 往主页「小组件面板」贡献一块「账号」卡片：展示所有账号（玩家名 + 头像 + 类型徽标），
 * 点击某账号把它设为「当前账号」。走 UiRegistryService.registerWidget，卸载即移除。
 *
 * 注意：账号数据是运行时动态的（需要读账号 store + 交互点选），无法放进静态 html，
 * 因此本插件只贡献 key/title/order 等「外壳声明」，宿主前端对 `widget-account` 这个 key
 * 特判，在卡片渲染成账号组件（见 apps/desktop/src/components/AccountWidget.vue），
 * 而非 v-html。这里保留占位 html 仅作面板库里的缩略预览。
 */
export const name = 'widget-account'
export const version = '1.0.0'
export const inject = ['uiRegistry']

export function apply(ctx) {
  ctx.effect(() => {
    const off = ctx.uiRegistry.registerWidget({
      key: 'widget-account',
      title: '账号',
      order: 1,
      width: 'full',
      html:
        '<div class="widget-account-preview">' +
        '<p style="margin:0;color:var(--text-dim,#8b8490)">（账号小组件：显示玩家名与头像，点选当前账号）</p>' +
        '</div>',
    })
    process.stderr.write('[widget-account] 应用：注册账号小组件卡片\n')
    return () => {
      off()
      process.stderr.write('[widget-account] 卸载：账号小组件卡片已移除\n')
    }
  })
}
