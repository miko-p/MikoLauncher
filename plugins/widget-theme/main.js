/**
 * widget-theme —— 「主题颜色」小组件插件（Adobe Color 风格圆形色块选色换肤）。
 *
 * 往主页「小组件面板」贡献一块「主题颜色」卡片：显示几个圆形色块（像 Adobe Color 的
 * 色环取样点），点击某个色块 → 整个应用主题（背景 / 包裹边框 / 强调色等 CSS 变量）变成
 * 对应那套配色。仅作用于视觉（样式变量），不影响布局与功能。
 *
 * 由宿主前端组件承载交互（apps/desktop/src/components/ThemeWidget.vue）：它里面对应一套
 * 预设色板的 `:root` CSS 变量覆盖并持久化选择。本插件只贡献外壳（key='widget-theme'），
 * HomeView 对 key 特判渲染成 Vue 组件，而非 v-html。
 */
export const name = 'widget-theme'
export const version = '1.0.0'
export const inject = ['uiRegistry']

export function apply(ctx) {
  ctx.effect(() => {
    const off = ctx.uiRegistry.registerWidget({
      key: 'widget-theme',
      title: '主题颜色',
      order: 4,
      width: 'full',
      html:
        '<div class="widget-theme-preview">' +
        '<p style="margin:0;color:var(--text-dim,#8b8490)">（主题颜色：点击圆点切换整套主题配色）</p>' +
        '</div>',
    })
    process.stderr.write('[widget-theme] 应用：注册主题颜色小组件卡片\n')
    return () => {
      off()
      process.stderr.write('[widget-theme] 卸载：主题颜色小组件卡片已移除\n')
    }
  })
}
