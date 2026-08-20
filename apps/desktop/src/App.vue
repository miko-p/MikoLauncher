<script setup lang="ts">
import { onMounted } from 'vue'
import { useUiStore } from './stores/ui'

const uiStore = useUiStore()

onMounted(() => {
  // M8-1：启动时拉取主题/布局插件的 UI 贡献
  uiStore.refresh()
})
</script>

<template>
  <!-- 应用壳：布局插件可在这些 slot 注入/置换（蓝图「十、布局插件」）。
       主题 <style> 置于文档末尾，用 v-html 注入插件 CSS 覆盖 default.css 的 :root 变量 -->
  <component :is="'style'" id="plugin-theme" v-if="uiStore.theme" v-html="uiStore.theme.css"></component>

  <div class="app-shell">
    <header class="app-bar">
      <nav class="app-nav">
        <router-link to="/">首页</router-link>
        <router-link to="/download">下载</router-link>
        <router-link to="/instances">实例</router-link>
        <router-link to="/accounts">账号</router-link>
        <router-link to="/plugins">插件</router-link>
      </nav>
    </header>
    <main class="app-main">
      <!-- 布局插件注入点：主页小部件（例如 demo-layout 在 home-widget slot 贡献 HTML） -->
      <div
        v-for="w in uiStore.layoutsFor('home-widget')"
        :key="'hw-' + w.name"
        class="plugin-slot-home-widget"
        v-html="w.html"
      ></div>
      <router-view />
    </main>
    <!-- 布局插件注入点：页脚 slot（例如 demo-layout 在 footer slot 贡献 HTML） -->
    <footer v-for="f in uiStore.layoutsFor('footer')" :key="'ft-' + f.name" class="plugin-slot-footer" v-html="f.html"></footer>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.app-bar {
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--border, #333);
}
.app-nav a {
  margin-right: 1rem;
  color: var(--text, #ddd);
  text-decoration: none;
}
.app-nav a.router-link-active {
  color: var(--accent, #39c5bb);
  font-weight: 600;
}
.app-main {
  flex: 1;
  overflow: auto;
  padding: 1rem;
}
/* 布局插件注入的 slot 容器（样式由插件自己的 class 提供，这里仅留基础间隔） */
.plugin-slot-home-widget,
.plugin-slot-footer {
  margin: 0.4rem 0;
  padding: 0.4rem 1rem;
}
.plugin-slot-footer {
  border-top: 1px solid var(--border, #333);
}
</style>
