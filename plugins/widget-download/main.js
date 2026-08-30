/**
 * widget-download —— 「下载预览」小组件插件（M10 扩展）。
 *
 * 往主页「小组件面板」贡献一块「下载」卡片：把下载页里的 Modrinth / CurseForge 拉进来
 * 做快速预览——展示热门/趋势的模组包列表，点击某个模组/模组包直接进入其详情页
 * （/modrinth/:slug）。类似把它和源浏览搬到主页的小组件。
 *
 * Modrinth 走真实搜索（modrinthSearch）；CurseForge 与其搜索 API 需个人 key，暂为占位提示
 * （同下载页浏览器一致）。
 *
 * 数据是运行时动态的（需调 API + 跳转详情），无法放进静态 html，因此本插件只贡献
 * key/title/order/width 等「外壳声明」，宿主前端对 `widget-download` 这个 key 特判渲染
 * 成 Vue 组件（见 apps/desktop/src/components/DownloadsWidget.vue），而非 v-html。
 * 这里保留占位 html 仅作面板库里的缩略预览。
 */
export const name = 'widget-download'
export const version = '1.0.0'
export const inject = ['uiRegistry']

export function apply(ctx) {
  ctx.effect(() => {
    const off = ctx.uiRegistry.registerWidget({
      key: 'widget-download',
      title: '下载预览',
      order: 3,
      width: 'full',
      html:
        '<div class="widget-download-preview">' +
        '<p style="margin:0;color:var(--text-dim,#8b8490)">（下载预览：Modrinth 热门模组/模组包，点击进详情）</p>' +
        '</div>',
    })
    process.stderr.write('[widget-download] 应用：注册下载预览小组件卡片\n')
    return () => {
      off()
      process.stderr.write('[widget-download] 卸载：下载预览小组件卡片已移除\n')
    }
  })
}
