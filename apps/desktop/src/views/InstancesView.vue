<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { useInstanceStore } from '../stores/instances'
import type { DownloadProgress } from '@mc-launcher/shared'

const store = useInstanceStore()

const showCreate = ref(false)
const form = reactive({ name: '', versionId: '1.21.4', modLoader: 'fabric' as const })

/** 正在启动的实例 id + 其实时下载/安装进度。 */
const launchingId = ref<string | null>(null)
const activeProgress = ref<DownloadProgress | null>(null)
let unlisten: (() => void) | undefined

async function create() {
  if (!form.name.trim()) return
  await store.addInstance({ name: form.name.trim(), versionId: form.versionId, modLoader: form.modLoader })
  if (!store.error) {
    form.name = ''
    showCreate.value = false
  }
}

/** 启动实例并实时渲染 lighty 的下载/安装进度（Rust 经 download:progress 推送）。 */
async function start(instId: string) {
  launchingId.value = instId
  activeProgress.value = null
  await store.launch(instId)
  // M4 起 lighty `run()` 在游戏运行期间不返回，此处的 await 会一直 pending
  //（启动动作在后台线程执行），直到游戏退出才 resolve —— 不阻塞 UI。
  launchingId.value = null
}

async function setupProgress() {
  try {
    unlisten = await listen<DownloadProgress>('download:progress', (evt) => {
      activeProgress.value = evt.payload
    })
  } catch {
    // 非 Tauri（纯浏览器 vite dev）静默跳过
  }
}

onMounted(() => {
  setupProgress()
  store.fetchInstances()
})
onUnmounted(() => unlisten?.())
</script>

<template>
  <section>
    <div class="row">
      <h2>实例</h2>
      <span class="pill" :class="store.sidecarReady ? 'ok' : 'bad'">
        {{ store.sidecarReady ? 'sidecar 已连接' : 'sidecar 未就绪' }}
      </span>
      <button @click="store.fetchInstances">刷新</button>
      <button @click="showCreate = !showCreate">{{ showCreate ? '取消' : '+ 新建实例' }}</button>
    </div>

    <p v-if="store.loading" class="muted">加载中…</p>
    <p v-if="store.error" class="err">⚠ {{ store.error }}</p>

    <form v-if="showCreate" class="create-form" @submit.prevent="create">
      <input v-model="form.name" placeholder="实例名，如 MySMP" required />
      <input v-model="form.versionId" placeholder="版本，如 1.21.4" required />
      <select v-model="form.modLoader">
        <option value="vanilla">Vanilla</option>
        <option value="fabric">Fabric</option>
        <option value="quilt">Quilt</option>
        <option value="forge">Forge</option>
        <option value="neoforge">NeoForge</option>
      </select>
      <button type="submit" :disabled="store.loading">创建</button>
    </form>

    <ul v-if="store.instances.length" class="list">
      <li v-for="inst in store.instances" :key="inst.id" class="item">
        <div>
          <strong>{{ inst.name }}</strong>
          <span class="muted"> {{ inst.versionId }} · {{ inst.modLoader }}</span>
        </div>
        <button @click="start(inst.id)" class="launch" :disabled="launchingId === inst.id">
          {{ launchingId === inst.id ? '启动中…' : '启动' }}
        </button>
      </li>
    </ul>
    <p v-else-if="!store.loading && !store.error" class="muted">还没有实例。点「+ 新建实例」创建一个。</p>

    <!-- 正在启动的实例实时下载/安装进度（lighty 真实进度） -->
    <div v-if="activeProgress" class="launch-progress">
      <p class="muted">
        安装中：{{ activeProgress.target }}
        <span class="tag" :class="activeProgress.phase">{{ activeProgress.phase }}</span>
      </p>
      <progress :value="activeProgress.downloaded" :max="activeProgress.total || 1"></progress>
      <p class="muted" v-if="activeProgress.total">
        {{ activeProgress.downloaded }} / {{ activeProgress.total }}
        ({{ (activeProgress.ratio * 100).toFixed(1) }}%)
      </p>
    </div>
  </section>
</template>

<style scoped>
.row { display: flex; align-items: center; gap: 0.8rem; }
.pill { padding: 0.1rem 0.6rem; border-radius: 999px; font-size: 0.8rem; }
.pill.ok { background: rgba(57, 197, 187, 0.15); color: #39c5bb; }
.pill.bad { background: rgba(229, 72, 77, 0.15); color: #e5484d; }
.muted { color: var(--text-dim, #888); }
.err { color: var(--danger, #e5484d); }
.create-form { display: flex; gap: 0.5rem; margin: 0.8rem 0; flex-wrap: wrap; }
.create-form input, .create-form select {
  background: var(--bg-elevated, #1b1f27); color: var(--text, #eee);
  border: 1px solid var(--border, #333); padding: 0.35rem 0.5rem; border-radius: var(--radius, 8px);
}
.list { list-style: none; padding: 0; }
.item { display: flex; justify-content: space-between; align-items: center;
  padding: 0.6rem 0.8rem; border: 1px solid var(--border, #333); border-radius: var(--radius, 8px); margin-bottom: 0.5rem; }
.launch { padding: 0.25rem 0.9rem; border-radius: var(--radius, 8px);
  background: var(--accent, #39c5bb); color: #111; border: none; cursor: pointer; }
.launch:disabled { opacity: 0.5; cursor: default; }
.launch-progress { margin-top: 1rem; padding: 0.8rem; border: 1px solid var(--border, #333);
  border-radius: var(--radius, 8px); }
.launch-progress progress { width: 100%; }
.launch-progress .tag.done { background: rgba(57, 197, 187, 0.15); color: #39c5bb; }
.launch-progress .tag.error { background: rgba(229, 72, 77, 0.15); color: #e5484d; }
</style>
