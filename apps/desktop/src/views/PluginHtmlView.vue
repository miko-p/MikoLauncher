<script setup lang="ts">
/**
 * PluginHtmlView —— M9-6 插件贡献的「页面」通用渲染组件。
 *
 * 前端动态注册的路由（对应一个 builtin=false 的插件视图）统一落到本组件：
 *  - 渲染插件贡献的 html 内容（v-html，与布局 slot 同通道；CSP 限内联脚本）
 *  - 渲染插件声明的 `actions` 按钮（M9-6 真交互）：点击调 `viewAction` →
 *    sidecar 插件的 `view.<key>.<action>` handler，结果回显页面下方。
 *
 * rich 组件级交互（Vue 组件/沙箱）留给分发演进 Phase 2。
 */
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useUiStore } from '../stores/ui'
import { viewAction } from '../api'

const uiStore = useUiStore()
const route = useRoute()

// 当前路由名 = 插件视图 key
const key = computed(() => (route.name as string) || '')

/** 当前视图贡献（非 builtin） */
const view = computed(() =>
  uiStore.manifest?.views.find((v) => v.key === key.value && !v.builtin),
)

const html = computed(() => view.value?.html ?? '')
const label = computed(() => view.value?.label ?? '')
const actions = computed(() => view.value?.actions ?? [])

/** 动作执行状态 & 结果 */
const runningAction = ref<string | null>(null)
const result = ref<string>('')

async function run(actionId: string) {
  runningAction.value = actionId
  result.value = ''
  try {
    const data = await viewAction({ key: key.value, action: actionId })
    result.value =
      typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  } catch (e) {
    result.value = `⚠ ${(e as Error).message}`
  } finally {
    runningAction.value = null
  }
}
</script>

<template>
  <section class="plugin-view">
    <h2>{{ label }}</h2>
    <div class="plugin-view-body" v-html="html"></div>

    <!-- M9-6：插件声明的动作按钮 -->
    <div v-if="actions.length" class="plugin-view-actions">
      <button
        v-for="a in actions"
        :key="a.id"
        :disabled="runningAction !== null"
        @click="run(a.id)"
      >
        {{ runningAction === a.id ? '处理中…' : a.label }}
      </button>
    </div>

    <!-- 动作结果回显 -->
    <pre v-if="result" class="plugin-view-result">{{ result }}</pre>

    <p v-if="!html && !actions.length" class="muted">（插件视图暂无内容）</p>
  </section>
</template>

<style scoped>
.muted { color: var(--text-dim, #888); }
.plugin-view-body :deep(p) { margin: 0.3rem 0; }
.plugin-view-actions {
  display: flex;
  gap: 0.5rem;
  margin: 0.8rem 0;
}
.plugin-view-actions button {
  padding: 0.35rem 0.9rem;
  border: 1px solid var(--border, #333);
  border-radius: var(--radius, 8px);
  background: var(--bg-elevated, #1b1f27);
  color: var(--text, #eee);
  cursor: pointer;
}
.plugin-view-actions button:disabled { opacity: 0.5; cursor: default; }
.plugin-view-result {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border, #333);
  border-radius: var(--radius, 8px);
  padding: 0.6rem 0.8rem;
  font-size: 0.85rem;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
