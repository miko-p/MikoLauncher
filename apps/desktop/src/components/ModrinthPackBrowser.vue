<script setup lang="ts">
/**
 * M13：Modrinth 模组包 / 模组 浏览+搜索（「从模组包开始」，仿 HMCL/Modrinth）。
 *
 * 交互对齐 HMCL：
 *  - 打开即自动加载模组包列表（不用等搜索）
 *  - 左上 源 tab：Modrinth / CurseForge（CurseForge 未配 API key → 占位提示）
 *  - 类型 tab：模组包 / 模组；排序下拉：相关度/下载量/关注/最新发布/最近更新
 *  - 卡片网格点开 → 详情选 MC 版本/加载器 → 创建实例（绑定 modpack，首次启动自动装依赖）
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  modrinthSearch,
  modrinthProjectVersions,
} from '../api'
import { useInstanceStore } from '../stores/instances'
import type { ModrinthProject, ModrinthVersion } from '@miko-launcher/shared'

const emit = defineEmits<{ close: []; back: [] }>()

const store = useInstanceStore()
const route = useRoute()

/** 源：modrinth 现在可用；curseforge 需 API key（占位） */
const source = ref<'modrinth' | 'curseforge'>('modrinth')
const tab = ref<'modpack' | 'mod'>('modpack')
const sortMap = [
  { v: 'relevance', label: '相关度' },
  { v: 'downloads', label: '下载量' },
  { v: 'follows', label: '关注数' },
  { v: 'newest', label: '最新发布' },
  { v: 'updated', label: '最近更新' },
] as const
const sort = ref<'relevance' | 'downloads' | 'follows' | 'newest' | 'updated'>('downloads')
const query = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const hits = ref<ModrinthProject[]>([])
const total = ref(0)
const page = ref(1)
const PAGE = 30

/* 详情 */
const detail = ref<ModrinthProject | null>(null)
const versions = ref<ModrinthVersion[]>([])
const detailLoading = ref(false)
const selectedVersionId = ref('')
const instanceName = ref('')
const creating = ref(false)
const createErr = ref<string | null>(null)

/** 搜索框引用（供外部 ?focus=search 从主页放大镜跳入聚焦） */
const searchInput = ref<HTMLInputElement | null>(null)

/** 总页数（向上取整） */
const totalPages = computed(() => {
  if (total.value <= 0) return 0
  return Math.ceil(total.value / PAGE)
})
const hasPrev = computed(() => page.value > 1)
const hasNext = computed(() => page.value < totalPages.value)

async function runSearch(targetPage = 1) {
  // CurseForge 未接（需 API key）
  if (source.value === 'curseforge') {
    hits.value = []
    total.value = 0
    error.value = null
    return
  }
  loading.value = true
  error.value = null
  try {
    const off = (targetPage - 1) * PAGE
    const res = await modrinthSearch({
      query: query.value,
      projectType: tab.value,
      index: sort.value,
      limit: PAGE,
      offset: off,
    })
    hits.value = res.hits
    total.value = res.total_hits
    page.value = targetPage
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

/** 任一条件变化：回到第 1 页重载（源头/类型/排序/搜索词） */
function reload() {
  hits.value = []
  total.value = 0
  page.value = 1
  detail.value = null
  void runSearch(1)
}

function submitSearch() {
  reload()
}

function goPrev() {
  if (loading.value || !hasPrev.value) return
  void runSearch(page.value - 1)
}

function goNext() {
  if (loading.value || !hasNext.value) return
  void runSearch(page.value + 1)
}

async function openDetail(p: ModrinthProject) {
  detail.value = p
  selectedVersionId.value = ''
  // 实例名默认取模组包名（非法字符替换为 _），用户仍可手动改
  instanceName.value = sanitizeInstanceName(p.title)
  detailLoading.value = true
  createErr.value = null
  try {
    const v = await modrinthProjectVersions(p.slug, 40)
    versions.value = v
    if (v.length) selectedVersionId.value = v[0].id
    else error.value = '该项目暂无版本'
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    detailLoading.value = false
  }
}

function backToSearch() {
  detail.value = null
  versions.value = []
}

/** 选中的 Modrinth 版本对象 */
const selectedVersion = computed<ModrinthVersion | undefined>(() =>
  versions.value.find((v) => v.id === selectedVersionId.value),
)

/** 主下载文件（.mrpack 或模组 jar） */
function primaryFile(v: ModrinthVersion | undefined) {
  if (!v) return undefined
  return v.files?.find((f) => f.primary) ?? v.files?.[0]
}

/**
 * 把任意字符串清洗成合法实例名：跨平台文件/目录名的非法字符、控制字符、首尾空格/点
 * 统一替换为 `_`。实例名虽不拼目录（dir 用 UUID），但保持命名安全一致，供「从模组包」建实例默认名。
 */
function sanitizeInstanceName(name: string): string {
  // Windows/Unix 共通的保留与非法字符 + 控制字符
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .trim()
    .replace(/^\.+$/, '') // 纯点串视为空
    // 首尾的 dot/空格（Windows 路径收尾非法）去掉开头，收尾的也换 _
    .replace(/[. ]$/, '_')
  return cleaned
}

async function createFromModpack() {
  const p = detail.value
  const v = selectedVersion.value
  if (!p || !v) return
  if (!instanceName.value.trim()) {
    createErr.value = '请填写实例名'
    return
  }
  const mcVersion = v.game_versions?.[0]
  if (!mcVersion) {
    createErr.value = '该版本未标注支持的 MC 版本'
    return
  }
  const loader = (v.loaders?.[0] as 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'vanilla') || 'fabric'
  const file = primaryFile(v)
  creating.value = true
  createErr.value = null
  try {
    const finalName = sanitizeInstanceName(instanceName.value) || 'instance'
    const ok = await store.addModpackInstance(
      {
        name: finalName,
        versionId: mcVersion,
        modLoader: loader,
        modpack: {
          provider: 'modrinth',
          project: p.slug,
          title: p.title,
          iconUrl: p.icon_url,
          versionId: v.id,
          versionNumber: v.version_number,
          fileUrl: file?.url,
        },
      },
      file?.url,
    )
    if (ok.ok) {
      emit('close')
    } else {
      createErr.value = ok.reason ?? store.error
    }
  } catch (e) {
    createErr.value = (e as Error).message
  } finally {
    creating.value = false
  }
}

function fmtDownloads(n: number | undefined): string {
  if (n == null) return ''
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

/** 项目类型是否模组包（详情页徽标用） */
function isModpackProject(p: ModrinthProject): boolean {
  return p.project_type === 'modpack'
}

// 打开即自动加载热门模组包列表（HMCL 式，不靠搜索）
onMounted(() => {
  void runSearch(1)
  // 来自主页「下载预览」放大镜（?focus=search）：自动聚焦搜索框，方便直接输入
  if (route.query.focus === 'search') {
    setTimeout(() => searchInput.value?.focus(), 80)
  }
})
</script>

<template>
  <div class="browser">
    <!-- 搜索列表视图 -->
    <template v-if="!detail">
      <div class="toolbar">
        <!-- 源 tab：Modrinth / CurseForge -->
        <div class="src-tabs">
          <button :class="{ active: source === 'modrinth' }" @click="source = 'modrinth'; reload()">Modrinth</button>
          <button :class="{ active: source === 'curseforge' }" @click="source = 'curseforge'; reload()">CurseForge</button>
        </div>
        <!-- 类型 tab -->
        <div class="tabs">
          <button :class="{ active: tab === 'modpack' }" @click="tab = 'modpack'; reload()">模组包</button>
          <button :class="{ active: tab === 'mod' }" @click="tab = 'mod'; reload()">模组</button>
        </div>
        <!-- 排序下拉 -->
        <select v-model="sort" class="sort" @change="reload">
          <option v-for="s in sortMap" :key="s.v" :value="s.v">按{{ s.label }}排序</option>
        </select>
        <!-- 搜索框 -->
        <form class="search" @submit.prevent="submitSearch">
          <input ref="searchInput" v-model="query" placeholder="搜索…" />
          <button type="submit" :disabled="loading">搜索</button>
        </form>
      </div>

      <!-- CurseForge 占位 -->
      <template v-if="source === 'curseforge'">
        <div class="cf-placeholder">
          <p class="muted">CurseForge 的 API 需要申请个人 key 才能搜索/安装。</p>
          <p class="muted">请到浏览器访问 console.curseforge.com 申请 API Key，后续接入后此源即可用。</p>
        </div>
      </template>

      <template v-else>
        <p v-if="error" class="err">⚠ {{ error }}</p>
        <p v-if="loading && !hits.length" class="muted">加载中…</p>

        <div v-if="hits.length" class="grid">
          <button
            v-for="p in hits"
            :key="p.slug"
            class="card"
            @click="openDetail(p)"
          >
            <img v-if="p.icon_url" class="thumb" :src="p.icon_url" :alt="p.title" loading="lazy" />
            <div v-else class="thumb fallback">{{ tab === 'modpack' ? '▤' : '🧩' }}</div>
            <div class="info">
              <strong class="title">{{ p.title }}</strong>
              <span class="desc">{{ p.description }}</span>
              <span class="meta">
                <span v-if="p.downloads != null">↓ {{ fmtDownloads(p.downloads) }}</span>
                <span v-if="p.followers != null">★ {{ fmtDownloads(p.followers) }}</span>
                <span v-if="p.versions?.length" class="mc">{{ p.versions.slice(-3).join(', ') }}</span>
              </span>
            </div>
          </button>
        </div>
        <p v-else-if="!loading && !error && !hits.length" class="muted">没有结果。换个关键词试试。</p>

        <div v-if="hits.length" class="more">
          <button class="ghost" :disabled="loading || !hasPrev" @click="goPrev">← 上一页</button>
          <span class="muted">第 {{ page }} / {{ totalPages }} 页</span>
          <button class="ghost" :disabled="loading || !hasNext" @click="goNext">下一页 →</button>
        </div>
      </template>
    </template>

    <!-- 详情视图 -->
    <template v-else>
      <button class="ghost back-top" @click="backToSearch()">← 返回列表</button>

      <div class="detail-head">
        <img v-if="detail.icon_url" class="d-icon" :src="detail.icon_url" :alt="detail.title" />
        <div class="d-info">
          <h3>{{ detail.title }}</h3>
          <span class="pill-type">{{ isModpackProject(detail) ? '模组包' : '模组' }}</span>
          <p class="d-desc">{{ detail.description }}</p>
          <span class="muted" v-if="detail.downloads != null">下载 {{ fmtDownloads(detail.downloads) }} · 关注 {{ fmtDownloads(detail.followers) }}</span>
        </div>
      </div>

      <div class="form">
        <label class="field"><span>实例名</span><input v-model="instanceName" :placeholder="detail.title" /></label>
        <label class="field"><span>版本</span>
          <select v-model="selectedVersionId" :disabled="detailLoading">
            <option v-if="detailLoading" value="">加载版本…</option>
            <option v-for="v in versions" :key="v.id" :value="v.id">
              {{ v.version_number }} · {{ v.game_versions?.[0] ?? '?' }} ({{ v.loaders?.[0] ?? 'vanilla' }})
            </option>
          </select>
        </label>

        <div class="hint">
          <span class="muted">① 选定版本会自动采用它要求的 MC 版本与加载器；② 点「创建实例」后，模组包依赖会在该实例首次启动时自动安装。</span>
        </div>

        <p v-if="createErr" class="form-err">⚠ {{ createErr }}</p>
        <div class="actions">
          <button class="primary" :disabled="creating || detailLoading" @click="createFromModpack">
            {{ creating ? '创建实例…' : '创建实例' }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.browser { padding: 0.9rem 1rem 1rem; min-height: 320px; display: flex; flex-direction: column; gap: 0.8rem; }
.err { color: var(--danger, #e5484d); margin: 0; }
.muted { color: var(--text-dim, #888); margin: 0; }
.form-err { color: var(--danger, #e5484d); margin: 0; font-size: 0.85rem; }
.link { color: var(--accent, #4a90e2); }

/* 工具条 */
.toolbar { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.src-tabs { display: flex; gap: 0.2rem; background: var(--bg, #b6abb0); border-radius: 10px; padding: 0.2rem; }
.src-tabs button, .tabs button { padding: 0.35rem 0.8rem; border-radius: 8px; border: none;
  background: transparent; color: var(--text, #3a3436); cursor: pointer; font-family: inherit; font-size: 0.85rem; }
.src-tabs button.active { background: var(--shell-bg, #77636c); color: var(--header-text, #f5f1f3); }
.tabs { display: flex; gap: 0.3rem; }
.tabs button { border: 1px solid var(--border, #c9bec3); }
.tabs button.active { background: var(--accent, #39c5bb); color: #111; border-color: transparent; }
.sort { padding: 0.35rem 0.5rem; border: 1px solid var(--border, #c9bec3); border-radius: 8px;
  background: var(--bg-elevated, #fdfdfd); color: var(--text, #3a3436); font-size: 0.85rem; }
.search { display: flex; gap: 0.4rem; flex: 1; min-width: 180px; }
.search input { flex: 1; padding: 0.4rem 0.6rem; border: 1px solid var(--border, #c9bec3);
  border-radius: 8px; background: var(--bg, #b6abb0); color: var(--text, #3a3436); }
.search button { padding: 0.4rem 0.9rem; border-radius: 8px; border: none;
  background: var(--accent, #39c5bb); color: #111; cursor: pointer; }

.cf-placeholder { padding: 2rem 1rem; text-align: center; }
.cf-placeholder p { margin: 0.3rem 0; }

/* 结果卡片网格 */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 0.7rem; }
.card { display: flex; gap: 0.7rem; text-align: left; padding: 0.6rem; border: 1px solid var(--border, #c9bec3);
  border-radius: 12px; background: var(--bg-elevated, #fdfdfd); color: var(--text, #3a3436);
  cursor: pointer; font-family: inherit; transition: transform 0.12s ease, border-color 0.12s ease; }
.card:hover { transform: translateY(-2px); border-color: var(--accent, #77636c); }
.thumb { width: 52px; height: 52px; border-radius: 10px; object-fit: cover; flex-shrink: 0; }
.thumb.fallback { background: var(--shell-bg, #77636c); color: #fff; font-size: 1.3rem;
  display: flex; align-items: center; justify-content: center; }
.info { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
.title { font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.desc { font-size: 0.78rem; color: var(--text-dim, #8b8490); display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.meta { font-size: 0.74rem; color: var(--text-dim, #8b8490); display: flex; gap: 0.5rem; flex-wrap: wrap; }
.mc { color: var(--accent, #4a90e2); }

.more { display: flex; align-items: center; gap: 0.6rem; justify-content: center; }
.ghost { background: transparent; color: var(--text, #3a3436); border: 1px solid var(--border, #c9bec3);
  padding: 0.35rem 0.9rem; border-radius: 8px; cursor: pointer; font-family: inherit; }
.back-top { align-self: flex-start; }

/* 详情 */
.detail-head { display: flex; gap: 0.9rem; }
.d-icon { width: 72px; height: 72px; border-radius: 14px; object-fit: cover; flex-shrink: 0; }
.d-info { display: flex; flex-direction: column; gap: 0.2rem; }
.d-info h3 { margin: 0; font-size: 1.1rem; }
.d-desc { margin: 0.2rem 0 0; font-size: 0.85rem; color: var(--text, #3a3436); }
.pill-type { align-self: flex-start; padding: 0.05rem 0.55rem; border-radius: 999px; font-size: 0.75rem;
  background: rgba(74, 144, 226, 0.15); color: #4a90e2; }

.form { display: flex; flex-direction: column; gap: 0.7rem; }
.field { display: flex; flex-direction: column; gap: 0.3rem; }
.field span { font-size: 0.85rem; color: var(--text-dim, #8b8490); }
.field input, .field select { background: var(--bg, #b6abb0); color: var(--text, #3a3436);
  border: 1px solid var(--border, #c9bec3); padding: 0.45rem 0.6rem; border-radius: 8px; font-size: 0.9rem; }
.hint { font-size: 0.78rem; }
.actions { display: flex; justify-content: flex-end; }
.actions .primary { background: var(--accent, #39c5bb); color: #111; border: none;
  padding: 0.45rem 1.1rem; border-radius: 8px; cursor: pointer; }
.actions .primary:disabled { opacity: 0.5; cursor: default; }
</style>
