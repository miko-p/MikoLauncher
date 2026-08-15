<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useVersionStore } from '../stores/versions'
import type { DownloadProgress } from '@mc-launcher/shared'

const store = useVersionStore()
const progress = ref<DownloadProgress | null>(null)
const simulating = ref(false)
let unlisten: (() => void) | undefined

async function simulateDownload() {
  simulating.value = true
  progress.value = null
  try {
    await invoke('emit_download_progress')
  } finally {
    setTimeout(() => (simulating.value = false), 1600)
  }
}

async function setupProgress() {
  try {
    // 订阅 Rust 侧推送的下载进度事件（DownloadProgressSchema 契约）
    unlisten = await listen<DownloadProgress>('download:progress', (evt) => {
      progress.value = evt.payload
    })
  } catch {
    // 非 Tauri 环境（纯浏览器 vite dev）静默跳过
  }
}

const typeLabel = (t: string) => (t === 'release' ? '正式版' : t === 'snapshot' ? '快照' : t)

onMounted(async () => {
  await setupProgress()
  store.refresh()
})
onUnmounted(() => unlisten?.())
</script>

<template>
  <section>
    <div class="row">
      <h2>下载</h2>
      <button @click="store.refresh" :disabled="store.loading">
        {{ store.loading ? '加载中…' : '刷新版本' }}
      </button>
      <span class="muted" v-if="store.refreshedAt">更新于 {{ store.refreshedAt }}</span>
      <button @click="simulateDownload" :disabled="simulating">模拟下载进度</button>
    </div>

    <p v-if="store.error" class="err">⚠ {{ store.error }}</p>
    <p v-if="store.loading" class="muted">正在从 Mojang 拉取版本清单…</p>

    <!-- 版本列表 -->
    <div v-if="store.versions.length" class="list">
      <div v-for="v in store.versions.slice(0, 40)" :key="v.id" class="row-item">
        <span class="ver"><strong>{{ v.id }}</strong></span>
        <span class="tag" :class="v.type">{{ typeLabel(v.type) }}</span>
        <span class="muted">{{ v.releaseTime }}</span>
      </div>
    </div>
    <p v-else-if="!store.loading && !store.error" class="muted">点击「刷新版本」获取 Minecraft 版本清单。</p>

    <!-- 下载进度 -->
    <div v-if="progress" class="progress">
      <p class="muted">
        下载中：{{ progress.target }}
        <span class="tag">{{ progress.phase }}</span>
      </p>
      <progress :value="progress.downloaded" :max="progress.total || 1"></progress>
      <p class="muted" v-if="progress.total">
        {{ progress.downloaded }} / {{ progress.total }} ({{ (progress.ratio * 100).toFixed(1) }}%)
      </p>
    </div>
  </section>
</template>

<style scoped>
.row { display: flex; align-items: center; gap: 0.8rem; }
.muted { color: var(--text-dim, #888); }
.err { color: var(--danger, #e5484d); }
.list { margin-top: 0.8rem; }
.row-item { display: flex; align-items: center; gap: 0.8rem; padding: 0.4rem 0.4rem;
  border-bottom: 1px solid var(--border, #333); }
.tag { padding: 0.05rem 0.5rem; border-radius: 999px; font-size: 0.75rem; }
.tag.release { background: rgba(57, 197, 187, 0.15); color: #39c5bb; }
.tag.snapshot { background: rgba(229, 72, 77, 0.15); color: #e5484d; }
.ver { min-width: 6rem; }
.progress { margin-top: 1rem; padding: 0.8rem; border: 1px solid var(--border, #333);
  border-radius: var(--radius, 8px); }
.progress progress { width: 100%; }
</style>
