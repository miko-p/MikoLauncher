<script setup lang="ts">
</script>

<template>
  <!-- 应用壳：布局插件可在未来置换这些 slot（蓝图「十、布局插件」） -->
  <div class="app-shell">
    <header class="app-bar">
      <nav class="app-nav">
        <router-link to="/">首页</router-link>
        <router-link to="/download">下载</router-link>
        <router-link to="/instances">实例</router-link>
      </nav>
    </header>
    <main class="app-main">
      <router-view />
    </main>
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
</style>
