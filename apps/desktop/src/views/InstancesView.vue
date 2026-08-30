<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { listen } from '@tauri-apps/api/event'
import { useInstanceStore } from '../stores/instances'
import { useAccountStore } from '../stores/accounts'
import type { DownloadProgress, Instance } from '@miko-launcher/shared'

const router = useRouter()
const store = useInstanceStore()
const accountStore = useAccountStore()

/* ── M11：➕ 新建实例弹窗（三选项） ── */
const showModal = ref(false)
const stage = ref<'pick' | 'custom' | 'dev'>('pick')
const devTitle = ref('')
const form = reactive({ name: '', versionId: '', modLoader: 'fabric' as const, javaMajor: null as number | null })
const submittingCustom = ref(false)
const customResult = ref<string | null>(null)

/** 常用 Java 主版本选项（新建实例表单）。 */
const JAVA_MAJORS = [8, 11, 17, 21, 25, 26]

/** 按版本号建议默认 Java 主版本：新版号方案（去 1.x 前缀，如 26.x）→ 26；老 1.21+ → 21；更老 → 17。 */
function suggestedJavaMajor(versionId: string): number {
  if (!versionId.startsWith('1.')) return 26
  if (versionId.startsWith('1.21') || versionId.startsWith('1.2')) return 21
  return 17
}

/* ── M11：版本下拉（懒加载 Mojang 清单，进「自定义」才抓一次，会话内缓存） ── */
/** 分组成「正式版 / 快照版」两组（Release 通常在前数十个历史主要版本，Snapshot 是未发布的开发版本）。 */
const releaseVersions = computed(() => store.versionsRaw.filter((v) => v.type === 'release'))
const snapshotVersions = computed(() => store.versionsRaw.filter((v) => v.type === 'snapshot'))

/** 选中版本变化时，把默认 Java 主版本同步为建议值（26.x → 26）。用户手动改过则不再覆盖。 */
function onVersionChange(id: string) {
  if (form.javaMajor == null) form.javaMajor = suggestedJavaMajor(id)
}

async function loadVersions() {
  if (store.versionsLoaded && store.versionsRaw.length) return
  const list = await store.loadVersions()
  // 默认选中最新的正式版（无正式版则第一个）
  const newest = releaseVersions.value[0] ?? list[0]
  if (newest) {
    form.versionId = newest.id
    onVersionChange(newest.id)
  }
}
function openModal() {
  stage.value = 'pick'
  customResult.value = null
  showModal.value = true
}
function pick(which: 'import' | 'modpack' | 'custom') {
  if (which === 'custom') {
    stage.value = 'custom'
    customResult.value = null
    void loadVersions()
  } else if (which === 'modpack') {
    // M13：从模组包开始 → 跳到独立的「下载」页（浏览空间充足，不再用 modal）
    showModal.value = false
    void router.push('/download')
  } else {
    stage.value = 'dev'
    devTitle.value = '导入'
  }
}
function backToPick() {
  stage.value = 'pick'
  customResult.value = null
}
async function createCustom() {
  if (!form.name.trim()) return
  if (store.versionsLoading) return // 清单还没加载完，忽略
  if (!form.versionId.trim()) {
    customResult.value = '请选择版本'
    return
  }
  submittingCustom.value = true
  customResult.value = null
  const res = await store.addInstanceVerified({
    name: form.name.trim(),
    versionId: form.versionId.trim(),
    modLoader: form.modLoader,
    javaMajor: form.javaMajor ?? undefined,
  })
  submittingCustom.value = false
  if (res.ok) {
    showModal.value = false
    form.name = ''
  } else {
    customResult.value = res.reason ?? store.error
  }
}

/* ── M11-2：实例图标网格卡片 ── */

/** 默认「我的世界土方块 2D」占位图标（SVG data-URI，先用简化色块占位，资源后定）。 */
const DIRT_ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <defs>
    <linearGradient id="top" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#c8a36a"/><stop offset="1" stop-color="#b08a52"/>
    </linearGradient>
    <linearGradient id="side" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7a5b38"/><stop offset="1" stop-color="#5e4328"/>
    </linearGradient>
  </defs>
  <polygon points="48,8 84,26 48,44 12,26" fill="url(#top)"/>
  <polygon points="12,26 48,44 48,88 12,70" fill="url(#side)"/>
  <polygon points="84,26 48,44 48,88 84,70" fill="url(#side)"/>
  <circle cx="30" cy="32" r="3" fill="#5e4328"/><circle cx="50" cy="18" r="2.5" fill="#5e4328"/>
  <circle cx="66" cy="36" r="3" fill="#6b4d2e"/><circle cx="40" cy="60" r="3" fill="#4a321d"/>
  <circle cx="62" cy="66" r="2.5" fill="#4a321d"/>
</svg>`,
  )

/** 该实例实际显示的图标：有自定义 icon 用之，否则默认土块占位。 */
function iconSrc(inst: Instance): string {
  return inst.icon && inst.icon.trim() !== '' ? inst.icon : DIRT_ICON
}

/** 启动实例（M11-3 非阻塞）：提交后立即返回，按钮由 store.isRunning 置灰；真实进度经 download:progress 推送。 */
const activeProgress = ref<DownloadProgress | null>(null)
let unlisten: (() => void) | undefined
function start(instId: string) {
  if (store.isRunning(instId)) {
    window.alert('该实例已在运行中')
    return
  }
  activeProgress.value = null
  void store.launch(instId)
}

/** 点卡片空白/名字 → 进入实例详情。 */
function openDetail(instId: string) {
  void router.push(`/instances/${instId}`)
}

/* 换图标：用原生 <input type=file> 选本地图片 → FileReader 读成 data-URI → 存库（无需后端对话框依赖）。 */
const iconPickerId = ref<string | null>(null)
const iconFileInput = ref<HTMLInputElement | null>(null)
function pickIconClick(instId: string) {
  iconPickerId.value = instId
  iconFileInput.value?.click()
}
async function onIconChosen(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file || !iconPickerId.value) return
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
  await store.setIcon(iconPickerId.value, dataUrl)
  iconPickerId.value = null
  target.value = ''
}

function setupProgress() {
  listen<DownloadProgress>('download:progress', (evt) => {
    activeProgress.value = evt.payload
  })
    .then((off) => (unlisten = off))
    .catch(() => {})
}

onMounted(() => {
  setupProgress()
  store.fetchInstances()
  store.refreshLaunchStatus()
  unlisten = store.initLaunchEvents()
  accountStore.fetchAccounts()
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
      <button class="new" @click="openModal">＋ 新建实例</button>
    </div>

    <p v-if="store.loading" class="muted">加载中…</p>
    <p v-if="store.error" class="err">⚠ {{ store.error }}</p>

    <!-- M11-2：手机主屏式图标网格卡片 -->
    <div v-if="store.instances.length" class="grid">
      <div v-for="inst in store.instances" :key="inst.id" class="inst-card" @click="openDetail(inst.id)">
        <div class="icon-wrap" :class="{ running: store.isRunning(inst.id) }">
          <img class="icon" :src="iconSrc(inst)" :alt="inst.name" draggable="false" />
          <!-- 启动：🚀 悬浮于图标右上角（运行中置灰） -->
          <button
            class="launch-btn"
            :class="{ busy: store.isRunning(inst.id) }"
            :disabled="store.isRunning(inst.id)"
            :title="store.isRunning(inst.id) ? inst.name + ' 运行中' : '启动 ' + inst.name"
            @click.stop="start(inst.id)"
          >
            {{ store.isRunning(inst.id) ? '⟳' : '🚀' }}
          </button>
          <!-- 换图标：图标右下角小刷子 -->
          <button class="change-btn" title="更换自定义图标" @click.stop="pickIconClick(inst.id)">
            ✎
          </button>
        </div>
        <span class="name" :title="inst.name">{{ inst.name }}</span>
        <span class="meta">{{ inst.versionId }} · {{ inst.modLoader }}</span>
      </div>
    </div>
    <p v-else-if="!store.loading && !store.error" class="muted">还没有实例。点「＋ 新建实例」创建一个。</p>

    <!-- 隐藏的文件选择器（换图标） -->
    <input ref="iconFileInput" type="file" accept="image/*" class="hidden-input" @change="onIconChosen" />

    <!-- 启动中的下载/安装进度 -->
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

    <!-- ── 新建实例弹窗（M11 三选项） ── -->
    <div v-if="showModal" class="modal-mask" @click.self="showModal = false">
      <div class="modal">
        <div class="modal-head">
          <h3>{{ stage === 'pick' ? '新建实例' : stage === 'custom' ? '自定义' : devTitle }}</h3>
          <button class="close" @click="showModal = false" aria-label="关闭">×</button>
        </div>

        <template v-if="stage === 'pick'">
          <div class="options">
            <button class="opt" @click="pick('import')">
              <span class="opt-icon">⇩</span>
              <span class="opt-txt"><strong>导入</strong><small>从已有实例文件夹 / 存档导入</small></span>
            </button>
            <button class="opt" @click="pick('modpack')">
              <span class="opt-icon">▤</span>
              <span class="opt-txt"><strong>从模组包开始</strong><small>跳转到「下载」页浏览 Modrinth 模组包 / 模组</small></span>
            </button>
            <button class="opt" @click="pick('custom')">
              <span class="opt-icon">＋</span>
              <span class="opt-txt"><strong>自定义</strong><small>自行选择版本与加载器</small></span>
            </button>
          </div>
        </template>

        <template v-else-if="stage === 'custom'">
          <div class="custom-form">
            <label class="field"><span>实例名</span><input v-model="form.name" placeholder="如 MySMP" /></label>
            <label class="field">
              <span>版本</span>
              <select
                v-model="form.versionId"
                :disabled="store.versionsLoading"
                @change="onVersionChange(form.versionId)"
              >
                <option v-if="store.versionsLoading" value="">加载版本清单…</option>
                <option v-else-if="!store.versionsRaw.length" value="">版本清单加载失败</option>
                <optgroup v-if="releaseVersions.length" label="正式版">
                  <option v-for="v in releaseVersions" :key="'r' + v.id" :value="v.id">{{ v.id }}</option>
                </optgroup>
                <optgroup v-if="snapshotVersions.length" label="快照版">
                  <option v-for="v in snapshotVersions" :key="'s' + v.id" :value="v.id">{{ v.id }}</option>
                </optgroup>
              </select>
            </label>
            <label class="field">
              <span>加载器</span>
              <select v-model="form.modLoader">
                <option value="vanilla">Vanilla</option>
                <option value="fabric">Fabric</option>
                <option value="quilt">Quilt</option>
                <option value="forge">Forge</option>
                <option value="neoforge">NeoForge</option>
              </select>
            </label>
            <label class="field">
              <span>Java 版本</span>
              <select v-model.number="form.javaMajor">
                <option :value="null">自动</option>
                <option v-for="m in JAVA_MAJORS" :key="m" :value="m">Java {{ m }}</option>
              </select>
            </label>
            <p v-if="customResult" class="form-err">⚠ {{ customResult }}</p>
          </div>
        </template>

        <template v-else>
          <p class="dev-note">「{{ devTitle }}」功能开发中。这一轮先把三选项入口立起来，子流程后续实现。</p>
        </template>

        <div class="modal-foot">
          <template v-if="stage === 'custom'">
            <button class="ghost" @click="backToPick">{{ submittingCustom ? '创建中…' : '返回' }}</button>
            <button class="primary" :disabled="submittingCustom" @click="createCustom">
              {{ submittingCustom ? '校验并创建…' : '确定' }}
            </button>
          </template>
          <template v-else-if="stage === 'dev'">
            <button class="ghost" @click="backToPick">返回</button>
          </template>
        </div>
      </div>
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
.new { padding: 0.35rem 0.9rem; border-radius: var(--radius, 8px);
  background: var(--accent, #39c5bb); color: #111; border: none; cursor: pointer; }
.hidden-input { display: none; }

/* ── 手机主屏式图标网格卡片 ── */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  gap: 0.9rem;
  margin-top: 0.8rem;
}
.inst-card {
  display: flex; flex-direction: column; align-items: center; gap: 0.3rem;
  padding: 0.7rem 0.5rem 0.6rem;
  background: var(--bg-elevated, #fdfdfd);
  border: 1px solid var(--border, #c9bec3);
  border-radius: 14px;
  cursor: pointer;
  transition: transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease;
  text-align: center;
}
.inst-card:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(40, 30, 35, 0.16);
  border-color: var(--accent, #77636c); }
.icon-wrap {
  position: relative; width: 84px; height: 84px; border-radius: 16px; overflow: hidden;
  background: var(--bg, #b6abb0); flex-shrink: 0;
}
.icon { width: 100%; height: 100%; object-fit: cover; display: block; user-select: none; -webkit-user-drag: none; }
.icon-wrap.running { opacity: 0.75; }
.launch-btn {
  position: absolute; top: 4px; right: 4px;
  width: 26px; height: 26px; border-radius: 8px; border: none;
  background: rgba(57, 197, 187, 0.9); color: #111; cursor: pointer;
  font-size: 0.85rem; line-height: 1; display: flex; align-items: center; justify-content: center;
}
.launch-btn:hover { background: #39c5bb; }
.launch-btn.busy { background: rgba(229, 72, 77, 0.85); }
.change-btn {
  position: absolute; bottom: 4px; right: 4px;
  width: 22px; height: 22px; border-radius: 7px; border: none;
  background: rgba(255, 255, 255, 0.75); color: #333; cursor: pointer;
  font-size: 0.75rem; line-height: 1; display: flex; align-items: center; justify-content: center;
}
.change-btn:hover { background: #fff; }
.name {
  margin-top: 0.3rem; font-size: 0.85rem; font-weight: 600; color: var(--text, #3a3436);
  max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.meta { font-size: 0.72rem; color: var(--text-dim, #8b8490); }

.launch-progress { margin-top: 1rem; padding: 0.8rem; border: 1px solid var(--border, #333);
  border-radius: var(--radius, 8px); }
.launch-progress progress { width: 100%; }
.launch-progress .tag.done { background: rgba(57, 197, 187, 0.15); color: #39c5bb; }
.launch-progress .tag.error { background: rgba(229, 72, 77, 0.15); color: #e5484d; }

/* ── 新建实例弹窗 ── */
.modal-mask { position: fixed; inset: 0; z-index: 60; background: rgba(30, 20, 26, 0.4);
  display: flex; align-items: center; justify-content: center; }
.modal { min-width: 340px; max-width: 420px; width: 88%;
  background: var(--bg-elevated, #fdfdfd); border-radius: 14px;
  box-shadow: 0 18px 48px rgba(40, 30, 35, 0.35); overflow: hidden;
  display: flex; flex-direction: column; }
.modal-head { display: flex; align-items: center; justify-content: space-between;
  padding: 0.9rem 1.1rem; background: var(--shell-bg, #77636c); color: var(--header-text, #f5f1f3); }
.modal-head h3 { margin: 0; font-size: 1.05rem; font-weight: 650; }
.close { background: transparent; border: none; color: inherit; font-size: 1.3rem;
  cursor: pointer; line-height: 1; padding: 0.1rem 0.4rem; }
.options { padding: 0.9rem; display: flex; flex-direction: column; gap: 0.6rem; }
.opt { display: flex; align-items: center; gap: 0.9rem; text-align: left;
  padding: 0.8rem 0.9rem; border: 1px solid var(--border, #c9bec3); border-radius: 10px;
  background: transparent; color: inherit; cursor: pointer; font-family: inherit;
  transition: background 0.12s ease, border-color 0.12s ease; }
.opt:hover { background: rgba(74, 144, 226, 0.08); border-color: var(--accent, #77636c); }
.opt-icon { font-size: 1.2rem; color: var(--accent, #77636c); flex-shrink: 0; width: 1.6rem; text-align: center; }
.opt-txt { display: flex; flex-direction: column; gap: 0.15rem; }
.opt-txt small { color: var(--text-dim, #8b8490); }
.custom-form { padding: 0.9rem; display: flex; flex-direction: column; gap: 0.8rem; }
.field { display: flex; flex-direction: column; gap: 0.3rem; }
.field span { font-size: 0.85rem; color: var(--text-dim, #8b8490); }
.field input, .field select { background: var(--bg, #b6abb0); color: var(--text, #3a3436);
  border: 1px solid var(--border, #c9bec3); padding: 0.45rem 0.6rem; border-radius: 8px; font-size: 0.9rem; }
.form-err { margin: 0; color: var(--danger, #e5484d); font-size: 0.85rem; }
.dev-note { padding: 1.4rem 1.1rem; color: var(--text-dim, #8b8490); font-size: 0.9rem; }
.modal-foot { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.8rem 1.1rem;
  border-top: 1px solid var(--border, #c9bec3); }
.modal-foot .ghost { background: transparent; color: var(--text, #3a3436); border: 1px solid var(--border, #c9bec3);
  padding: 0.35rem 0.9rem; border-radius: 8px; cursor: pointer; }
.modal-foot .primary { background: var(--shell-bg, #77636c); color: var(--header-text, #f5f1f3);
  padding: 0.35rem 1rem; border: none; border-radius: 8px; cursor: pointer; }
.modal-foot .primary:disabled { opacity: 0.5; cursor: default; }
</style>
