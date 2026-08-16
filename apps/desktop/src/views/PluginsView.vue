<script setup lang="ts">
import { onMounted } from 'vue'
import { usePluginStore } from '../stores/plugins'

const store = usePluginStore()

onMounted(() => store.fetchPlugins())
</script>

<template>
  <section>
    <div class="row">
      <h2>插件</h2>
      <span class="muted">Phase 0：本地 plugins/ 目录 + hash 校验（蓝图「九」）</span>
      <button @click="store.fetchPlugins" :disabled="store.loading">
        {{ store.loading ? '加载中…' : '刷新' }}
      </button>
    </div>

    <p v-if="store.error" class="err">⚠ {{ store.error }}</p>

    <!-- 空目录提示 -->
    <div v-if="store.plugins && store.plugins.length === 0" class="empty">
      <p class="muted">plugins/ 下暂无插件。</p>
      <ol class="muted steps">
        <li>在 <code>plugins/&lt;插件名&gt;/</code> 放 <code>main.js</code>（ESM 导出 { name, inject, apply }）</li>
        <li>写 <code>manifest.json</code>（name / version / api / hash）</li>
        <li>hash 为 main.js 的 SHA-256；不一致会被拒绝加载（防篡改）</li>
      </ol>
    </div>

    <ul v-else-if="store.plugins?.length" class="list">
      <li v-for="p in store.plugins" :key="p.name" class="item">
        <div class="info">
          <div class="top">
            <strong>{{ p.name }}</strong>
            <span class="muted">v{{ p.version }}</span>
          </div>
          <div class="badges">
            <span class="tag" :class="p.loaded ? 'ok' : 'off'">
              {{ p.loaded ? '已装载' : '未装载' }}
            </span>
            <span class="tag" :class="p.hashOk ? 'ok' : 'bad'">
              {{ p.hashOk ? 'hash✓' : 'hash✗' }}
            </span>
            <span v-if="p.reason" class="err reason">{{ p.reason }}</span>
          </div>
        </div>
        <button
          class="toggle"
          :class="{ on: p.loaded }"
          :disabled="store.toggling === p.name || !p.hashOk"
          @click="store.toggle(p.name)"
        >
          {{ store.toggling === p.name ? '处理中…' : p.loaded ? '禁用' : '启用' }}
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.row { display: flex; align-items: center; gap: 0.8rem; margin-bottom: 0.6rem; }
.muted { color: var(--text-dim, #888); font-size: 0.85rem; }
.err { color: var(--danger, #e5484d); }
.empty { padding: 0.8rem 0; }
.steps { padding-left: 1.2rem; margin: 0.5rem 0; display: flex; flex-direction: column; gap: 0.2rem; }
.steps code { background: var(--bg-elevated, #1b1f27); padding: 0.1rem 0.3rem; border-radius: 4px; }
.list { list-style: none; padding: 0; }
.item { display: flex; justify-content: space-between; align-items: center;
  padding: 0.6rem 0.8rem; border: 1px solid var(--border, #333); border-radius: var(--radius, 8px); margin-bottom: 0.5rem; }
.info { display: flex; flex-direction: column; gap: 0.35rem; }
.top { display: flex; align-items: baseline; gap: 0.6rem; }
.badges { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
.tag { padding: 0.05rem 0.5rem; border-radius: 999px; font-size: 0.75rem; }
.tag.ok { background: rgba(57, 197, 187, 0.15); color: #39c5bb; }
.tag.off { background: rgba(120, 120, 120, 0.15); color: #888; }
.tag.bad { background: rgba(229, 72, 77, 0.15); color: #e5484d; }
.reason { font-size: 0.8rem; }
.toggle { padding: 0.25rem 0.9rem; border-radius: var(--radius, 8px); cursor: pointer;
  background: var(--bg-elevated, #1b1f27); color: var(--text, #eee); border: 1px solid var(--border, #333); }
.toggle.on { background: var(--accent, #39c5bb); color: #111; border-color: transparent; }
.toggle:disabled { opacity: 0.5; cursor: default; }
</style>
