import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import type { UiView } from '@miko-launcher/shared'

// 宿主内置页面路由（M9-6：仍是默认一组视图，导航条由 ui manifest 渲染动态化）
const builtinRoutes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
  { path: '/download', name: 'download', component: () => import('../views/DownloadView.vue') },
  { path: '/instances', name: 'instances', component: () => import('../views/InstancesView.vue') },
  { path: '/accounts', name: 'accounts', component: () => import('../views/AccountsView.vue') },
  { path: '/plugins', name: 'plugins', component: () => import('../views/PluginsView.vue') },
]

export const router = createRouter({
  history: createWebHistory(),
  routes: builtinRoutes,
})

/** 已由插件贡献注册过的路径（用于卸载时精确移除，避免误删内置）。 */
const pluginRoutes = new Map<string, RouteRecordRaw>()

/**
 * M9-6：按 ui manifest 同步「插件贡献视图」的路由。
 * 对每个 builtin=false 的视图，动态 addRoute 到 PluginHtmlView（name=view.key）；
 * 已不再贡献的路径 removeRoute。幂等，可在插件启用/禁用后重复调用。
 */
export function syncPluginRoutes(pluginViews: UiView[]) {
  const wantPaths = new Set(pluginViews.map((v) => v.path))

  // 先移除不再需要的插件路由
  for (const [path, rec] of [...pluginRoutes]) {
    if (!wantPaths.has(path)) {
      router.removeRoute(rec.name as string)
      pluginRoutes.delete(path)
    }
  }

  // 再注册新增/更新的插件路由
  for (const v of pluginViews) {
    if (pluginRoutes.has(v.path)) continue // 已注册
    if (v.type === 'html' && !v.html) continue // 无内容不注册
    const rec: RouteRecordRaw = {
      path: v.path,
      name: v.key,
      component: () => import('../views/PluginHtmlView.vue'),
    }
    router.addRoute(rec)
    pluginRoutes.set(v.path, rec)
  }
}
