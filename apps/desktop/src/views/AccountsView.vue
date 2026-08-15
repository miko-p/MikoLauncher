<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { useAccountStore } from '../stores/accounts'
import type { AccountDeviceCode } from '@miko-launcher/shared'

const store = useAccountStore()

const offlineName = ref('')
const loggingMs = ref(false)
const deviceCode = ref<AccountDeviceCode | null>(null)
let unlisten: (() => void) | undefined

async function submitOffline() {
  if (!offlineName.value.trim()) return
  await store.addOffline(offlineName.value.trim())
  if (!store.error) offlineName.value = ''
}

async function loginMs() {
  loggingMs.value = true
  deviceCode.value = null
  try {
    await store.addMicrosoft()
  } finally {
    loggingMs.value = false
    deviceCode.value = null
  }
}

async function setupDeviceCode() {
  try {
    unlisten = await listen<AccountDeviceCode>('account:device-code', (evt) => {
      deviceCode.value = evt.payload
    })
  } catch {
    // 非 Tauri（纯浏览器 vite dev）静默跳过
  }
}

onMounted(() => {
  setupDeviceCode()
  store.fetchAccounts()
})
onUnmounted(() => unlisten?.())
</script>

<template>
  <section>
    <div class="row">
      <h2>账号</h2>
      <span class="muted">{{ store.count }} 个已保存账号</span>
      <button @click="store.fetchAccounts">刷新</button>
    </div>

    <p v-if="store.error" class="err">⚠ {{ store.error }}</p>

    <!-- 添加账号 -->
    <div class="add-panel">
      <h3>添加离线账号</h3>
      <form class="offline-form" @submit.prevent="submitOffline">
        <input v-model="offlineName" placeholder="离线用户名（3-16位）" />
        <button type="submit">登录离线账号</button>
      </form>

      <h3>添加微软账号</h3>
      <button class="ms" @click="loginMs" :disabled="loggingMs">
        {{ loggingMs ? '登录中…' : '用 Microsoft 账号登录' }}
      </button>
      <div v-if="deviceCode" class="device-code">
        <p>请在浏览器打开 <code>{{ deviceCode.verificationUri }}</code> 并输入验证码：</p>
        <strong class="code">{{ deviceCode.userCode }}</strong>
        <p class="muted">等待你在微软页面授权…（本窗口会保持等待）</p>
      </div>
    </div>

    <!-- 账号列表 -->
    <ul v-if="store.accounts.length" class="list">
      <li v-for="acc in store.accounts" :key="acc.id" class="item">
        <div>
          <strong>{{ acc.name }}</strong>
          <span class="tag" :class="acc.type">{{ acc.type === 'microsoft' ? '微软' : '离线' }}</span>
        </div>
        <button class="remove" @click="store.remove(acc.id)">删除</button>
      </li>
    </ul>
    <p v-else-if="!store.loading && !store.error" class="muted">还没有账号。用上方表单添加一个离线或微软账号。</p>
  </section>
</template>

<style scoped>
.row { display: flex; align-items: center; gap: 0.8rem; }
.muted { color: var(--text-dim, #888); }
.err { color: var(--danger, #e5484d); }
.add-panel { margin: 1rem 0; padding: 1rem; border: 1px solid var(--border, #333); border-radius: var(--radius, 8px); }
.offline-form { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
.offline-form input {
  background: var(--bg-elevated, #1b1f27); color: var(--text, #eee);
  border: 1px solid var(--border, #333); padding: 0.35rem 0.5rem; border-radius: var(--radius, 8px);
}
button { padding: 0.35rem 0.9rem; border-radius: var(--radius, 8px); border: none; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
.ms { background: var(--accent, #39c5bb); color: #111; }
.device-code { margin-top: 0.8rem; padding: 0.8rem; background: rgba(74,144,226,0.1); border-radius: var(--radius, 8px); }
.code { font-size: 1.4rem; letter-spacing: 0.3rem; color: var(--accent, #39c5bb); }
.list { list-style: none; padding: 0; }
.item { display: flex; justify-content: space-between; align-items: center;
  padding: 0.6rem 0.8rem; border: 1px solid var(--border, #333); border-radius: var(--radius, 8px); margin-bottom: 0.5rem; }
.tag { padding: 0.05rem 0.5rem; border-radius: 999px; font-size: 0.75rem; margin-left: 0.4rem; }
.tag.microsoft { background: rgba(74, 144, 226, 0.15); color: #4a90e2; }
.tag.offline { background: rgba(57, 197, 187, 0.15); color: #39c5bb; }
.remove { background: rgba(229,72,77,0.15); color: #e5484d; }
</style>
