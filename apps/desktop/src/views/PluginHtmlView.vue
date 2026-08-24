<script setup lang="ts">
/**
 * PluginHtmlView —— M9-6 插件贡献的「纯 HTML 页面」通用渲染组件。
 *
 * 前端动态注册的路由（对应一个 builtin=false 的插件视图）统一落到本组件，
 * 从 ui store 按 route name（= 视图 key）取插件贡献的 html 内容渲染。
 *
 * 与现有布局 slot 一致，走 v-html（宿主信任 phase0 hash 校验；CSP 限制内联脚本）。
 * rich 交互（Vue 组件/slot）留给分发演进 Phase 2。
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useUiStore } from '../stores/ui'

const uiStore = useUiStore()
const route = useRoute()

// 当前路由名 = 插件视图 key，去取该插件的 html 贡献
const html = computed(() => {
  const key = route.name as string
  if (!key) return ''
  return uiStore.manifest?.views.find((v) => v.key === key && !v.builtin)?.html ?? ''
})

const label = computed(() => {
  const key = route.name as string
  if (!key) return ''
  return uiStore.manifest?.views.find((v) => v.key === key)?.label ?? ''
})
</script>

<template>
  <section class="plugin-view">
    <h2>{{ label }}</h2>
    <div class="plugin-view-body" v-html="html"></div>
    <p v-if="!html" class="muted">（插件视图暂无内容）</p>
  </section>
</template>

<style scoped>
.muted { color: var(--text-dim, #888); }
.plugin-view-body :deep(p) { margin: 0.3rem 0; }
</style>
