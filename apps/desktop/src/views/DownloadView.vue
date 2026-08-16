<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, reactive } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useVersionStore } from '../stores/versions'
import { useInstanceStore } from '../stores/instances'
import type { DownloadProgress } from '@miko-launcher/shared'

const store = useVersionStore()
const imStore = useInstanceStore()
const progress = ref<DownloadProgress | null>(null)
const simulating = ref(false)
const activeTab = ref<'all' | 'release' | 'snapshot'>('all')
const keyword = ref('')
const creating = ref<string | null>(null)
const createLoader = reactive<Record<string, string>>({})
let unlisten: (() => void) | undefined

const typeLabel = (t: string) => (t === 'release' ? '正式版' : t === 'snapshot' ? '快照' : t)

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
    unlisten = await listen<DownloadProgress>('download:progress', (evt) => {
      progress.value = evt.payload
    })
  } catch {
    // 非 Tauri 环境（纯浏览器 vite dev）静默跳过
  }
}

/** M7-4：按类型分组 + 关键字过滤后的版本列表 */
const filteredVersions = computed(() => {
  let list = store.versions
  if (activeTab.value === 'release') list = list.filter((v) => v.type === 'release')
  else if (activeTab.value === 'snapshot') list = list.filter((v) => v.type === 'snapshot')
  const kw = keyword.value.trim().toLowerCase()
  if (kw) list = list.filter((v) => v.id.toLowerCase().includes(kw))
  return list.slice(0, 60)
})

/** M7-4：以选中版本 + 可选 loader 直接创建实例（预选 loader，落到实例页）。 */
async function quickCreate(versionId: string, defaultLoader: string) {
  const name = defaultLoader === 'vanilla' ? versionId : `${defaultLoader}-${versionId}`
  creating.value = versionId
  await imStore.addInstance({
    name,
    versionId,
    modLoader: (createLoader[versionId] || defaultLoader) as any,
  })
  creating.value = null
}

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

    <!-- M7-4：分组筛选（类型 tabs + 关键字搜索） -->
    <div class="filters" v-if="store.versions.length">
      <div class="tabs">
        <button
          v-for="t in (['all', 'release', 'snapshot'] as const)"
          :key="t"
          class="tab"
          :class="{ on: activeTab === t }"
          @click="activeTab = t"
        >
          {{ t === 'all' ? '全部' : t === 'release' ? '正式版' : '快照' }}
        </button>
      </div>
      <input v-model="keyword" class="search" placeholder="搜索版本，如 1.20.4 / snapshot" />
    </div>

    <!-- M7-4：版本列表（分组 + 每版本可选 loader 直接建实例） -->
    <div v-if="filteredVersions.length" class="list">
      <div v-for="v in filteredVersions" :key="v.id" class="row-item">
        <div class="lef">
          <span class="ver"><strong>{{ v.id }}</strong></span>
          <span class="tag" :class="v.type">{{ typeLabel(v.type) }}</span>
          <span class="tag java" v-if="v.javaMajor">Java {{ v.javaMajor }}</span>
          <span class="muted">{{ v.releaseTime }}</span>
        </div>
        <div class="lef-actions">
          <select
            v-model="createLoader[v.id]"
            class="ldr-select"
            title="选择以哪个加载器创建实例（M7-4）"
          >
            <option value="vanilla">Vanilla</option>
            <option value="fabric">Fabric</option>
            <option value="quilt">Quilt</option>
            <option value="forge">Forge</option>
            <option value="neoforge">NeoForge</option>
          </select>
          <button
            class="create"
            :disabled="creating === v.id"
            @click="quickCreate(v.id, createLoader[v.id] || 'fabric')"
          >
            {{ creating === v.id ? '创建中…' : '以此版本创建实例' }}
          </button>
        </div>
      </div>
    </div>
    <p v-else-if="!store.loading && !store.error && !store.versions.length" class="muted">点击「刷新版本」获取 Minecraft 版本清单。</p>
    <p v-else-if="!store.loading && !store.error" class="muted">没有匹配该筛选/搜索的版本。</p>

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
.row-item { display: flex; align-items: center; justify-content: space-between; gap: 0.8rem;
  padding: 0.4rem 0.4rem; border-bottom: 1px solid var(--border, #333); }
.lef { display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap; }
.lef-actions { display: flex; align-items: center; gap: 0.5rem; }
.filters { display: flex; align-items: center; gap: 0.8rem; margin-top: 0.4rem; flex-wrap: wrap; }
.tabs { display: flex; gap: 0.3rem; }
.tab { padding: 0.2rem 0.7rem; border-radius: 999px; font-size: 0.8rem; cursor: pointer;
  background: var(--bg-elevated, #1b1f27); color: var(--text-dim, #888);
  border: 1px solid var(--border, #333); }
.tab.on { background: var(--accent, #39c5bb); color: #111; border-color: transparent; }
.search { background: var(--bg-elevated, #1b1f27); color: var(--text, #eee);
  border: 1px solid var(--border, #333); padding: 0.3rem 0.6rem; border-radius: var(--radius, 8px);
  min-width: 14rem; }
.ldr-select { background: var(--bg-elevated, #1b1f27); color: var(--text, #eee);
  border: 1px solid var(--border, #333); padding: 0.2rem 0.4rem; border-radius: var(--radius, 8px); }
.create { padding: 0.25rem 0.8rem; border-radius: var(--radius, 8px);
  background: var(--accent, #39c5bb); color: #111; border: none; cursor: pointer; white-space: nowrap; }
.create:disabled { opacity: 0.5; cursor: default; }
.tag { padding: 0.05rem 0.5rem; border-radius: 999px; font-size: 0.75rem; }
.tag.release { background: rgba(57, 197, 187, 0.15); color: #39c5bb; }
.tag.snapshot { background: rgba(229, 72, 77, 0.15); color: #e5484d; }
.tag.java { background: rgba(74, 144, 226, 0.15); color: #4a90e2; }
.ver { min-width: 6rem; }
.progress { margin-top: 1rem; padding: 0.8rem; border: 1px solid var(--border, #333);
  border-radius: var(--radius, 8px); }
.progress progress { width: 100%; }
</style>
