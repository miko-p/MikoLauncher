<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useInstanceStore } from '../stores/instances'
import { useAccountStore } from '../stores/accounts'
import type { Instance } from '@miko-launcher/shared'

const route = useRoute()
const router = useRouter()
const store = useInstanceStore()
const accountStore = useAccountStore()

const instanceId = String(route.params.id ?? '')
const inst = computed<Instance | undefined>(() =>
  store.instances.find((i) => i.id === instanceId),
)

const launching = computed(() => store.isRunning(instanceId))
const iconFileInput = ref<HTMLInputElement | null>(null)

function back() {
  void router.push('/instances')
}

function onBindAccount(accountId: string) {
  store.bindAccount(instanceId, accountId || null)
}

/** 常用 Java 主版本选项（下拉候选）。 */
const JAVA_MAJORS = [8, 11, 17, 21, 25, 26]

/** 未设时按版本号建议的 Java 主版本（仅作提示；lighty 仍按 version json 要求自动选 JRE）。 */
function suggestedJavaMajor(versionId: string): number {
  // 新版号方案（去 1.x 前缀，如 26.x）→ 26；老 1.21+ → 21；更老 → 17
  if (!versionId.startsWith('1.')) return 26
  if (versionId.startsWith('1.21') || versionId.startsWith('1.2')) return 21
  return 17
}

/** 字节大小 → 人类可读（M13：模组详情展示）。 */
function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB'
  if (n >= 1024) return Math.round(n / 1024) + ' KB'
  return n + ' B'
}

/** sha1 摘要 → 短哈希（M13：模组详情展示，避免整串过长）。 */
function shortHash(h: string): string {
  return h.length > 12 ? h.slice(0, 12) + '…' : h
}

function onJavaMajorChange(v: string) {
  if (v === '') {
    void store.setJavaMajor(instanceId, null) // 清除 → 自动
  } else {
    void store.setJavaMajor(instanceId, Number(v))
  }
}

function start() {
  if (store.isRunning(instanceId)) {
    window.alert('该实例已在运行中')
    return
  }
  void store.launch(instanceId)
}

async function remove() {
  if (!inst.value) return
  if (!window.confirm(`确定删除实例「${inst.value.name}」？此操作不可撤销。`)) return
  await store.remove(instanceId)
  void router.push('/instances')
}

async function onIconChosen(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  if (file.size > 512 * 1024) {
    store.error = '图标文件过大（>512KB），请换一张小图'
    target.value = ''
    return
  }
  const dataUrl: string = await new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
  await store.setIcon(instanceId, dataUrl)
  target.value = ''
}

onMounted(() => {
  if (!store.instances.length) store.fetchInstances()
  store.refreshLaunchStatus()
  store.initLaunchEvents()
})
</script>

<template>
  <section>
    <div class="row">
      <button class="ghost" @click="back">← 返回实例</button>
      <span v-if="store.error" class="err">⚠ {{ store.error }}</span>
    </div>

    <div v-if="inst" class="detail">
      <div class="hero">
        <div class="hero-icon" :class="{ running: launching }">
          <img v-if="inst.icon" class="icon" :src="inst.icon" :alt="inst.name" />
          <div v-else class="dirt-fallback">⛏️</div>
        </div>
        <div class="hero-info">
          <h2>{{ inst.name }}</h2>
          <div class="tags">
            <span class="tag">{{ inst.versionId }}</span>
            <span class="tag">{{ inst.modLoader }}</span>
            <span class="tag" v-if="inst.mods.length">{{ inst.mods.length }} 个模组</span>
          </div>
          <span class="muted">创建于 {{ new Date(inst.createdAt).toLocaleString() }}</span>
        </div>
      </div>

      <div class="actions">
        <button class="primary" :disabled="launching" @click="start">{{ launching ? '运行中…' : '🚀 启动' }}</button>
        <button class="ghost" @click="iconFileInput?.click()">更换图标</button>
        <button class="danger" @click="remove">删除实例</button>
      </div>

      <div class="panel">
        <h3>启动账号</h3>
        <select
          :value="inst.accountId ?? ''"
          class="acct-select"
          @change="(e) => onBindAccount((e.target as HTMLSelectElement).value)"
        >
          <option value="">默认账号（离线）</option>
          <option v-for="acc in accountStore.accounts" :key="acc.id" :value="acc.id">
            {{ acc.name }} ({{ acc.type === 'microsoft' ? '微软' : '离线' }})
          </option>
        </select>
      </div>

      <div class="panel">
        <h3>Java 版本</h3>
        <div class="java-row">
          <select
            :value="inst.javaMajor != null ? String(inst.javaMajor) : ''"
            class="acct-select"
            @change="(e) => onJavaMajorChange((e.target as HTMLSelectElement).value)"
          >
            <option value="">自动（按版本：建议 {{ suggestedJavaMajor(inst.versionId) }}）</option>
            <option v-for="m in JAVA_MAJORS" :key="m" :value="String(m)">Java {{ m }}</option>
          </select>
          <span class="muted java-hint">
            留「自动」时按该版本官方要求选 JRE（26.x→Java 25）。
          </span>
        </div>
      </div>

      <div class="panel">
        <h3>模组（{{ inst.mods.length }}）</h3>
        <p v-if="!inst.mods.length" class="muted">还没有安装模组。</p>
        <template v-else>
          <!-- M13：来自 .mrpack 模组包时，展示文件详情（文件名/大小/必需标记/归属路径） -->
          <p v-if="inst.modpack !== undefined" class="muted modpack-src">
            来自模组包「{{ inst.modpack.title }}」{{ inst.modpack.versionNumber }} — 依赖在首次启动时自动安装。
          </p>
          <ul class="mods">
            <li v-for="m in inst.mods" :key="m.id" class="mod-item">
              <div class="mod-main">
                <span class="mod-name">{{ m.projectName }}</span>
                <span class="mod-tags">
                  <span v-if="m.clientRequired" class="tag need" title="模组包标记为客户端必需">必装</span>
                  <span v-if="m.size != null" class="mtag">{{ fmtSize(m.size) }}</span>
                </span>
              </div>
              <span v-if="m.path" class="mod-path muted">{{ m.source }} · {{ m.path }}</span>
              <span class="mod-hash muted" v-if="m.hash">sha1 {{ shortHash(m.hash) }}</span>
            </li>
          </ul>
        </template>
      </div>

      <input ref="iconFileInput" type="file" accept="image/*" class="hidden-input" @change="onIconChosen" />
    </div>

    <p v-else-if="!store.loading" class="muted">未找到该实例（id={{ instanceId }}）。</p>
  </section>
</template>

<style scoped>
.row { display: flex; align-items: center; gap: 0.8rem; }
.err { color: var(--danger, #e5484d); }
.ghost { background: transparent; color: var(--text, #3a3436); border: 1px solid var(--border, #c9bec3);
  padding: 0.35rem 0.9rem; border-radius: 8px; cursor: pointer; }
.hidden-input { display: none; }
.muted { color: var(--text-dim, #888); margin: 0; }

.detail { margin-top: 1rem; display: flex; flex-direction: column; gap: 1rem; }
.hero { display: flex; gap: 1rem; align-items: flex-start; }
.hero-icon {
  position: relative; width: 96px; height: 96px; border-radius: 18px; overflow: hidden;
  background: var(--bg-elevated, #fdfdfd); border: 1px solid var(--border, #c9bec3);
  display: flex; align-items: center; justify-content: center;
}
.hero-icon.running { opacity: 0.7; }
.icon { width: 100%; height: 100%; object-fit: cover; }
.dirt-fallback { font-size: 2.4rem; }
.hero-info { display: flex; flex-direction: column; gap: 0.4rem; }
.hero-info h2 { margin: 0; }
.tags { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.tag { padding: 0.05rem 0.55rem; border-radius: 999px; font-size: 0.78rem;
  background: rgba(74, 144, 226, 0.15); color: #4a90e2; }

.actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
.actions .primary { background: var(--accent, #39c5bb); color: #111; border: none;
  padding: 0.4rem 1rem; border-radius: 8px; cursor: pointer; }
.actions .primary:disabled { opacity: 0.5; cursor: default; }
.actions .danger { background: rgba(229, 72, 77, 0.15); color: #e5484d; border: 1px solid rgba(229, 72, 77, 0.4);
  padding: 0.4rem 0.9rem; border-radius: 8px; cursor: pointer; }

.panel { border: 1px solid var(--border, #c9bec3); border-radius: 12px; padding: 0.8rem 1rem; }
.panel h3 { margin: 0 0 0.5rem; font-size: 0.95rem; }
.acct-select { background: var(--bg-elevated, #fdfdfd); color: var(--text, #3a3436);
  border: 1px solid var(--border, #c9bec3); padding: 0.35rem 0.5rem; border-radius: 8px; }
.java-row { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.java-hint { font-size: 0.8rem; }
.mods { margin: 0; padding-left: 0; display: flex; flex-direction: column; gap: 0.5rem; list-style: none; }
.mod-item { display: flex; flex-direction: column; gap: 0.1rem; padding: 0.3rem 0.55rem;
  border: 1px solid var(--border, #c9bec3); border-radius: 8px; background: var(--bg, #b6abb0); }
.mod-main { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; }
.mod-name { font-weight: 600; word-break: break-all; }
.mod-tags { display: flex; gap: 0.35rem; flex-shrink: 0; }
.tag.need { padding: 0.05rem 0.5rem; border-radius: 999px; font-size: 0.7rem;
  background: rgba(57, 197, 187, 0.18); color: #2a8a83; }
.mtag { padding: 0.05rem 0.5rem; border-radius: 999px; font-size: 0.72rem;
  background: rgba(74, 144, 226, 0.12); color: #4a90e2; }
.mod-path { font-size: 0.74rem; }
.mod-hash { font-size: 0.7rem; }
.modpack-src { font-size: 0.78rem; margin-bottom: 0.4rem; }
</style>
