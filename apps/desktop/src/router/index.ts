import { createRouter, createWebHistory } from 'vue-router'

// 页面路由 —— 供布局插件挂接（蓝图「五、Vue Router」）
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
    { path: '/download', name: 'download', component: () => import('../views/DownloadView.vue') },
    { path: '/instances', name: 'instances', component: () => import('../views/InstancesView.vue') },
    { path: '/accounts', name: 'accounts', component: () => import('../views/AccountsView.vue') },
  ],
})
