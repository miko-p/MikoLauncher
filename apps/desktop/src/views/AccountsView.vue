<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { useAccountStore } from '../stores/accounts'
import type { AccountDeviceCode } from '@miko-launcher/shared'

const store = useAccountStore()

const offlineName = ref('')
const deviceCode = ref<AccountDeviceCode | null>(null)
/** M9-2：正在检查有效性的账号 id（用于按钮 loading 态）。 */
const checkingId = ref<string | null>(null)
/** M10-4：微软登录失败原因（就地醒目展示，避免「点了没反应」）。 */
const msError = ref<string | null>(null)
let unlisten: (() => void) | undefined

async function submitOffline() {
  if (!offlineName.value.trim()) return
  await store.addOffline(offlineName.value.trim())
  if (!store.error) offlineName.value = ''
}

/** 微软登录（设备码流）：回调后端 account_login_microsoft，后端 emit account:device-code → 前端展示
 *  验证码 + verification uri，用户在网页授权后后端自动轮询完成登录。无「code 秒过期」坑（替代已废弃的手动粘 URL）。 */
async function loginMs() {
  msError.value = null
  deviceCode.value = null
  await store.deviceLogin()
  if (store.error) msError.value = store.error
}

/** 用户粘回授权 URL 的旧交互已废弃（手动粘 code 实测 2 秒内即过期）；finishing 仅用于按钮 disabled 态。 */
const finishing = ref(false)

/** M9-2：显式检查单个微软账号的 refresh 凭据是否仍有效。 */
async function check(accountId: string) {
  checkingId.value = accountId
  try {
    await store.check(accountId)
  } finally {
    checkingId.value = null
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
  // 账号数据已由应用启动时全局加载（App.vue 启动即 fetchAccounts + 微软账号后台有效性检测）。
  // 进账号页不再触发任何网络请求（列表面临启动态），彻底消除进页卡顿；需要刷新可点页面「刷新」按钮。
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
      <!-- M10-6b：微软登录走「设备码流」——点击后展示验证码 + verification 链接，用户在网页授权即可，
           无需粘 URL（手动粘官方 client 的桌面向 code 已被微软实测证伪：2 秒内复制都报 code has expired）。 -->
      <button class="ms" @click="loginMs" :disabled="!!deviceCode || finishing">
        {{ deviceCode ? '等待你在网页授权…' : '用 Microsoft 账号登录' }}
      </button>

      <!-- 登录失败就地醒目提示（避免「点了没反应」） -->
      <p v-if="msError" class="ms-error">
        ⚠ {{ msError }}<br />
        <span class="ms-error-hint">检查上方原因；若提示 client/租户无效，请见运行终端的 <code>[ms-login]</code> 日志。</span>
      </p>
      <div v-if="deviceCode" class="device-code">
        <p>请在浏览器打开 <code>{{ deviceCode.verificationUri }}</code> 并输入验证码：</p>
        <strong class="code">{{ deviceCode.userCode }}</strong>
        <p class="muted">等待你在微软页面授权…（本窗口会保持等待）</p>
      </div>
    </div>

    <!-- 账号列表 -->
    <ul v-if="store.accounts.length" class="list">
      <li v-for="acc in store.accounts" :key="acc.id" class="item">
        <div class="info">
          <div class="top">
            <strong>{{ acc.name }}</strong>
            <span class="tag" :class="acc.type">{{ acc.type === 'microsoft' ? '微软' : '离线' }}</span>
            <!-- M9-2：微软账号 refresh 失效 → 醒目「需重新登录」 -->
            <span v-if="store.isInvalidated(acc.id)" class="tag bad">需重新登录</span>
          </div>
          <!-- M9-2：失效原因提示 -->
          <span v-if="store.isInvalidated(acc.id)" class="muted reason">
            {{ store.invalidated[acc.id] }}
          </span>
        </div>
        <div class="actions">
          <!-- M9-2：微软账号可手动检查凭据有效性 -->
          <button
            v-if="acc.type === 'microsoft'"
            class="check"
            :disabled="checkingId === acc.id || !!store.msLoginUrl || finishing"
            @click="check(acc.id)"
          >
            {{ checkingId === acc.id ? '检查中…' : '检查' }}
          </button>
          <!-- M9-2：失效时提供重新登录入口（走设备流） -->
          <button v-if="store.isInvalidated(acc.id)" class="relogin" :disabled="!!store.msLoginUrl || finishing" @click="loginMs">
            重新登录
          </button>
          <button class="remove" @click="store.remove(acc.id)">删除</button>
        </div>
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
/* M10-4：微软登录失败就地提示（醒目红条） */
.ms-error {
  margin: 0.6rem 0 0;
  padding: 0.6rem 0.8rem;
  color: var(--danger, #e5484d);
  background: rgba(229, 72, 77, 0.1);
  border: 1px solid rgba(229, 72, 77, 0.35);
  border-radius: var(--radius, 8px);
  font-size: 0.85rem;
}
.ms-error-hint { color: var(--text-dim, #8b8490); font-size: 0.78rem; }
.ms-error code { color: var(--accent, #39c5bb); }
/* M10-5：手动兜底链接按钮 */
.link-btn {
  margin-top: 0.6rem;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent, #77636c);
  font-size: 0.78rem;
  text-decoration: underline;
  cursor: pointer;
}
/* M10-4：请求中提示（中性色） */
.ms-info {
  margin: 0.6rem 0 0;
  padding: 0.6rem 0.8rem;
  color: var(--text, #3a3436);
  background: rgba(74, 144, 226, 0.08);
  border: 1px solid rgba(74, 144, 226, 0.3);
  border-radius: var(--radius, 8px);
  font-size: 0.85rem;
}
/* M10-4：授权码流「粘贴 URL + 完成登录」行 */
.ms-finish { margin-top: 0.6rem; }
.ms-finish-row { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
.ms-url {
  flex: 1;
  min-width: 0;
  padding: 0.45rem 0.6rem;
  background: var(--bg-elevated, #fdfdfd);
  color: var(--text, #3a3436);
  border: 1px solid var(--border, #c9bec3);
  border-radius: var(--radius, 8px);
  font-size: 0.85rem;
}
.device-code { margin-top: 0.8rem; padding: 0.8rem; background: rgba(74,144,226,0.1); border-radius: var(--radius, 8px); }
.code { font-size: 1.4rem; letter-spacing: 0.3rem; color: var(--accent, #39c5bb); }
.list { list-style: none; padding: 0; }
.item { display: flex; justify-content: space-between; align-items: center;
  padding: 0.6rem 0.8rem; border: 1px solid var(--border, #333); border-radius: var(--radius, 8px); margin-bottom: 0.5rem; }
.info { display: flex; flex-direction: column; gap: 0.2rem; }
.top { display: flex; align-items: baseline; gap: 0.4rem; }
.actions { display: flex; align-items: center; gap: 0.4rem; }
.reason { font-size: 0.8rem; }
.tag { padding: 0.05rem 0.5rem; border-radius: 999px; font-size: 0.75rem; margin-left: 0.4rem; }
.tag.microsoft { background: rgba(74, 144, 226, 0.15); color: #4a90e2; }
.tag.offline { background: rgba(57, 197, 187, 0.15); color: #39c5bb; }
.tag.bad { background: rgba(229, 72, 77, 0.15); color: #e5484d; }
.check { background: var(--bg-elevated, #1b1f27); color: var(--text, #eee); border: 1px solid var(--border, #333); }
.relogin { background: rgba(229, 72, 77, 0.2); color: #e5484d; border: 1px solid rgba(229,72,77,0.4); }
.remove { background: rgba(229,72,77,0.15); color: #e5484d; }
</style>
