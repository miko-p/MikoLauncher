<script setup lang="ts">
import { onMounted, onUnmounted, watch, computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUiStore } from './stores/ui'
import { useHomeStore } from './stores/home'
import { useInstanceStore } from './stores/instances'
import { useAccountStore } from './stores/accounts'
import { syncPluginRoutes } from './router'

const router = useRouter()
const uiStore = useUiStore()
const home = useHomeStore()
const instances = useInstanceStore()
const accounts = useAccountStore()

/** 首页「编辑」：先跳到首页再进入主页小组件编辑态（编辑面板只挂在首页路由）。 */
function editHome() {
  if (router.currentRoute.value.name !== 'home') void router.push('/')
  home.toggleEditing()
}

/** 导航视图图标（内联 SVG path d，24×24）。按视图 key 选择，未知 key 用通用方块。 */
function viewIcon(key: string): string {
  switch (key) {
    case 'home':
      return 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z'
    case 'download':
      return 'M12 3v12m0 0 4-4m-4 4-4-4M4 21h16'
    case 'instances':
      return 'M12 2 3 7l9 5 9-5-9-5M3 12l9 5 9-5m-18 7 9 5 9-5'
    case 'accounts':
      return 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0'
    case 'plugins':
      return 'M9 3v6a3 3 0 0 1-3 3 3 3 0 0 1 3 3v6M15 3v6a3 3 0 0 0 3 3 3 3 0 0 0-3 3v6'
    default:
      return 'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z'
  }
}

// M8-1：启动时拉取主题/布局/视图插件的 UI 贡献
function refreshUi() {
  uiStore.refresh()
}

/* ---- 下拉导航分组（Minecraft.net megamenu 式：类别 + 多样形态，主页/编辑同组） ---- */
type NavItem =
  | { kind: 'link'; key: string; label: string; path: string }
  | { kind: 'edit' }

interface NavGroup {
  title: string
  variant: 'home' | 'list' | 'card'
  items: NavItem[]
}

/** 内置视图按功能归类；每类可配不同展示形态（首页/资源=左右并排大磁贴，单项类别=整行大色块）。 */
const NAV_GROUPS: { title: string; variant: NavGroup['variant']; keys: string[] }[] = [
  { title: '首页', variant: 'home', keys: ['home'] },
  { title: '资源', variant: 'home', keys: ['download', 'instances'] },
  { title: '账户', variant: 'card', keys: ['accounts'] },
  { title: '插件', variant: 'card', keys: ['plugins'] },
]

const navGroups = computed<NavGroup[]>(() => {
  const views = uiStore.views
  const byKey = new Map(views.map((v) => [v.key, v]))
  const assigned = new Set<string>()
  const groups: NavGroup[] = []
  for (const g of NAV_GROUPS) {
    const items: NavItem[] = []
    for (const k of g.keys) {
      const v = byKey.get(k)
      if (!v) continue
      assigned.add(k)
      items.push({ kind: 'link', key: v.key, label: v.label, path: v.path })
    }
    // 首页类别额外带「编辑」动作磁贴，与「主页」并排同区（编辑态反色显示「完成」）
    if (g.keys.includes('home') && items.length) items.push({ kind: 'edit' })
    if (items.length) groups.push({ title: g.title, variant: g.variant, items })
  }
  // 未归类（插件动态注册）视图归入「更多」
  const rest = views.filter((v) => !assigned.has(v.key))
  if (rest.length) {
    groups.push({
      title: '更多',
      variant: 'list',
      items: rest.map((v) => ({ kind: 'link' as const, key: v.key, label: v.label, path: v.path })),
    })
  }
  return groups
})

/** 左边栏当前选中的主类别（Minecraft.net 式：左侧四选 + 右侧显示选中内容） */
const activeNav = ref('首页')

/** 品牌下拉是否展开：跟随 hover —— 鼠标在顶栏 brand（含下拉面板）内展开，移出即收起 */
const menuOpen = ref(false)

/** 右侧内容 = 当前选中类别的分组 */
const currentGroup = computed<NavGroup | null>(
  () => navGroups.value.find((g) => g.title === activeNav.value) ?? null,
)

/** 左侧主选项列表（类别名 + 首个子项的图标 key，用于左侧显示图标） */
const navTabs = computed(() =>
  navGroups.value.map((g) => ({
    title: g.title,
    iconKey:
      g.items.find((i): i is Extract<NavItem, { kind: 'link' }> => i.kind === 'link')?.key ?? '',
  })),
)

/* ---- 苹果划屏：内容区竖直拖拽 + 键盘↑↓ 切换主视图（首页/下载/实例/账号/插件 固定顺序） ---- */
const SWIPE_ORDER: { name: string; path: string }[] = [
  { name: 'home', path: '/' },
  { name: 'download', path: '/download' },
  { name: 'instances', path: '/instances' },
  { name: 'accounts', path: '/accounts' },
  { name: 'plugins', path: '/plugins' },
]
const SWIPE_THRESHOLD = 90

/** 当前页容器（用于跟手 transform + router transition 动画） */
const swipeHost = ref<HTMLElement | null>(null)
const swipeY = ref(0)
const swiping = ref(false)
/** 本次切页动画方向：next=向上推出（新页从顶部进）/ prev=向下推出 */
const swipeDir = ref<'next' | 'prev'>('next')

let swipeStartY = 0
let swipeAxis: 'none' | 'pending' | 'y' = 'none'

function currentSwipeIndex(): number {
  return SWIPE_ORDER.findIndex((v) => v.name === router.currentRoute.value.name)
}

/** 是否处于可划屏主视图（详情页等不在序列内 → 不触发） */
function isSwipeable(): boolean {
  return currentSwipeIndex() >= 0
}

/** 切到指定索引序号的主视图（自动 clamp 到边界，键盘/拖拽共用） */
function swipeToIndex(next: number) {
  const n = Math.max(0, Math.min(SWIPE_ORDER.length - 1, next))
  const cur = currentSwipeIndex()
  if (n === cur) return
  swipeDir.value = n > cur ? 'next' : 'prev'
  swiping.value = false
  swipeY.value = 0
  void router.push(SWIPE_ORDER[n].path)
}

function onSwipePointerDown(e: PointerEvent) {
  if (!isSwipeable() || e.button !== 0) return
  const t = e.target as HTMLElement | null
  if (!t) return
  // 避开可交互元素（按钮/链接/输入/表格/画布/编辑态/下拉/状态列…），避免划屏误触发
  if (
    t.closest(
      'button, a, input, textarea, select, [contenteditable], .widget-card, .widget-canvas, .gallery-overlay, .gallery-panel, .brand-trigger, .run-status, [role="dialog"]',
    )
  )
    return
  swipeStartY = e.clientY
  swipeAxis = 'pending'
  window.addEventListener('pointermove', onSwipePointerMove)
  window.addEventListener('pointerup', onSwipePointerUp)
}

function onSwipePointerMove(e: PointerEvent) {
  if (swipeAxis === 'none') return
  const dy = e.clientY - swipeStartY
  if (swipeAxis === 'pending') {
    if (Math.abs(dy) <= 6) return
    swipeAxis = 'y'
    swiping.value = true
  }
  if (swipeAxis !== 'y') return
  e.preventDefault()
  const h = swipeHost.value?.clientHeight || window.innerHeight
  // 跟手位移（带阻尼，限制幅度保留回弹感）
  let amt = dy * 0.85
  const idx = currentSwipeIndex()
  // 边界：首页往下拖 / 末页往上拖 —— 没有可切换方向，页面像被顶住不跟手，确保边缘无划屏特效
  if ((idx <= 0 && dy > 0) || (idx >= SWIPE_ORDER.length - 1 && dy < 0)) amt = 0
  swipeY.value = Math.max(-h * 0.45, Math.min(h * 0.45, amt))
}

function onSwipePointerUp(e: PointerEvent) {
  window.removeEventListener('pointermove', onSwipePointerMove)
  window.removeEventListener('pointerup', onSwipePointerUp)
  const dy = e.clientY - (swipeStartY || 0)
  swipeAxis = 'none'
  swiping.value = false
  if (Math.abs(dy) > SWIPE_THRESHOLD) {
    // 向上拖 → 下一个主视图；向下拖 → 上一个（与用户描述一致）
    if (dy < 0) swipeToIndex(currentSwipeIndex() + 1)
    else swipeToIndex(currentSwipeIndex() - 1)
  } else {
    swipeY.value = 0 // 未超阈值弹回
  }
}

function onSwipeKey(e: KeyboardEvent) {
  if (!isSwipeable()) return
  // 排除在输入框/下拉等场景误触
  const t = e.target as HTMLElement | null
  if (t && t.closest('input, textarea, select, [contenteditable]')) return
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    swipeToIndex(currentSwipeIndex() + 1) // 上 → 下一个
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    swipeToIndex(currentSwipeIndex() - 1) // 下 → 上一个
  }
}

/** 运行中实例列表（供底部状态列展示名字 + pid + 状态）。 */
const runningList = computed(() =>
  Object.entries(instances.running).map(([id, pid]) => {
    const inst = instances.instances.find((i) => i.id === id)
    return { id, name: inst?.name ?? id, pid }
  }),
)

onMounted(() => {
  refreshUi()
  // M11-3：全局监听游戏运行状态（供底部状态列），并恢复已运行实例
  instances.fetchInstances()
  instances.refreshLaunchStatus()
  instances.initLaunchEvents()
  // 账号数据在应用启动时即加载：先拉列表，再对微软账号做静默有效性检测（后台并行）。
  // 这样进账号页只读已就绪的 store，不再每个账号触发网络往返，彻底消除进页卡顿。
  void accounts.fetchAccounts().then(() => {
    for (const acc of accounts.microsoftAccounts) void accounts.check(acc.id)
  })
  // 苹果划屏：内容区竖直拖拽 + 键盘↑↓
  swipeHost.value?.addEventListener('pointerdown', onSwipePointerDown)
  window.addEventListener('keydown', onSwipeKey, true)
})
onUnmounted(() => {
  swipeHost.value?.removeEventListener('pointerdown', onSwipePointerDown)
  window.removeEventListener('keydown', onSwipeKey, true)
  window.removeEventListener('pointermove', onSwipePointerMove)
  window.removeEventListener('pointerup', onSwipePointerUp)
})

// M9-6：ui manifest 变化（插件启用/禁用后 refresh）时，同步动态插件路由。
// 导航下拉直接渲染自 uiStore.views，无需额外兜底。
watch(
  () => uiStore.manifest,
  (m) => {
    if (m) syncPluginRoutes(uiStore.pluginViews)
  },
  { immediate: true },
)
</script>

<template>
  <!-- 应用壳：布局插件可在这些 slot 注入/置换（蓝图「十、布局插件」）。
       主题 <style> 置于文档末尾，用 v-html 注入插件 CSS 覆盖 default.css 的 :root 变量 -->
  <component :is="'style'" id="plugin-theme" v-if="uiStore.theme" v-html="uiStore.theme.css"></component>

  <!-- 外框包裹壳：四周深紫圆角边框，顶部宽 52px -->
  <div class="app-shell">
    <!-- 顶部边框内的品牌 + 分组导航下拉（Minecraft.net 官方页式：左侧主类别四选 + 竖分隔线 + 右侧内容） -->
    <div class="brand-bar">
      <div class="brand-trigger" @mouseenter="menuOpen = true" @mouseleave="menuOpen = false">
        <span class="brand-text">MikoLauncher</span>
        <!-- 品牌下拉：跟随 hover —— 鼠标移入顶栏 brand（含面板）展开，移出即收起。点击选项不影响展开态 -->
        <div class="brand-panel" :class="{ open: menuOpen }">
          <nav class="panel-box drawer">
            <!-- Minecraft.net 官方页式：左侧主类别四选 → 竖分隔线 → 右侧显示选中类别的内容 -->
            <div class="drawer-side">
              <button
                v-for="t in navTabs"
                :key="'tab-' + t.title"
                type="button"
                class="side-item"
                :class="{ active: t.title === activeNav }"
                @click="activeNav = t.title"
              >
                <svg class="side-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="viewIcon(t.iconKey)" /></svg>
                <span class="side-label">{{ t.title }}</span>
              </button>
            </div>
            <div class="drawer-divider" aria-hidden="true"></div>
            <div class="drawer-main">
              <div v-if="currentGroup" class="nav-group" :class="'variant-' + currentGroup.variant">
                <div class="nav-group-grid">
                  <template v-for="(item, i) in currentGroup.items" :key="'gi-' + currentGroup.title + '-' + i">
                    <router-link v-if="item.kind === 'link'" :to="item.path" class="nav-tile">
                      <svg class="tile-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="viewIcon(item.key)" /></svg>
                      <span class="tile-label">{{ item.label }}</span>
                    </router-link>
                    <button
                      v-else
                      type="button"
                      class="nav-tile nav-tile-edit"
                      :class="{ active: home.editing }"
                      :title="home.editing ? '退出主页编辑' : '编辑首页小组件'"
                      @click.stop.prevent="editHome()"
                    >
                      <svg class="tile-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3zM13.5 6.5l3 3" /></svg>
                      <span class="tile-label">{{ home.editing ? '完成' : '编辑' }}</span>
                    </button>
                  </template>
                </div>
              </div>
            </div>
          </nav>
        </div>
      </div>
    </div>
    <!-- 浅色内容区，四周被深紫圆角边框包住，圆角由 shell / 自身统一裁 -->
    <main class="app-main-rim">
      <!-- 小组件面板已移入首页 HomeView（M10-2 起只挂在首页路由，编辑/添加/调大小也在首页）。
           页脚通用布局 slot 仍是全局注入点。 -->
      <div class="app-main" ref="swipeHost">
        <!-- 苹果划屏：内容区竖直拖拽/键盘↑↓ 切换主视图；router-view 用 V 方向推入推向动画 -->
        <router-view v-slot="{ Component }">
          <transition :name="swipeDir === 'next' ? 'swipe-next' : 'swipe-prev'" mode="out-in">
            <div
              class="page-swipe-sheet"
              :class="{ dragging: swiping }"
              :style="swiping || swipeY !== 0 ? { transform: `translateY(${swipeY}px)` } : null"
            >
              <component :is="Component" />
            </div>
          </transition>
        </router-view>
      </div>

      <!-- M11-3：游戏运行状态列（下方圆角长条视窗）：显示正在运行的实例 + 状态 -->
      <div v-if="runningList.length" class="run-status">
        <div v-for="r in runningList" :key="r.id" class="run-item">
          <span class="run-dot" :class="{ launched: r.pid !== 0 }"></span>
          <span class="run-name">{{ r.name }}</span>
          <span class="run-state">
            {{ r.pid !== 0 ? `运行中 · PID ${r.pid}` : '运行中' }}
          </span>
        </div>
      </div>

      <!-- 布局插件注入点：页脚 slot（例如 demo-layout 在 footer slot 贡献 HTML） -->
      <footer
        v-for="f in uiStore.layoutsFor('footer')"
        :key="'ft-' + f.name"
        class="plugin-slot-footer"
        v-html="f.html"
      ></footer>
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  /* 深紫边框 = 壳整片深紫背景 + border-radius 裁四角。
     transform:translateZ(0) 强制 WebKit 合成层，规避全视口元素 border-radius 不裁角的坑；
     overflow:hidden 让内层内容也被裁进圆角矩形。 */
  background: color-mix(in srgb, var(--shell-bg, #77636c) 96%, transparent);
  border-radius: var(--shell-radius, 18px);
  transform: translateZ(0);
  overflow: hidden;
  /* 边框毛玻璃：半透明深紫透出桌面 + 轻微模糊，让边框有通透质感（透明窗已开启） */
  backdrop-filter: blur(30px) saturate(150%);
  -webkit-backdrop-filter: blur(30px) saturate(150%);
  color: var(--text, #3a3436);
  font-family: system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

/* ---- 顶部边框内的品牌 + 悬停下拉：trigger 水平居中于顶部 52px 边框，下拉为白色圆角悬浮面板（不碰壳四角圆角） ---- */
.brand-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none; /* 仅充当居中定位层，交互落在其子元素上 */
  z-index: 15;
}
.brand-trigger {
  position: relative;
  display: inline-block;
  height: 52px;
  display: flex;
  align-items: center;
  pointer-events: auto;
  cursor: default;
}
.brand-text {
  color: var(--header-text, #f5f1f3);
  font-weight: 650;
  font-size: 1.05rem;
  letter-spacing: 0.2px;
  user-select: none;
  padding: 0.5rem 0.9rem;
  border-radius: 10px;
  transition: background 0.15s ease;
}
.brand-trigger:hover .brand-text {
  background: rgba(255, 255, 255, 0.14);
}

/* 透明衔接带：覆盖品牌与下拉之间的小间隙，移入面板时 hover 不中断 */
.brand-trigger::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 0;
  width: 100%;
  height: var(--drop-gap, 8px);
}

/* 悬停下拉容器：从顶栏下缘开始，整条向下（柄 + 盒一体），默认隐藏 */
.brand-panel {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%) translateY(-6px);
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: center;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.16s ease, transform 0.16s ease, visibility 0.16s;
  pointer-events: none; /* 面板非 hover 时不允许穿透 hover 区 */
}
.brand-panel.open {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(0);
  pointer-events: auto;
}

/* ---- 圆角面板盒：默认全圆角；.drawer 变体【加宽下拉组件】背景与顶栏同深紫、上边贴死顶栏 ---- */
.panel-box {
  display: flex;
  flex-direction: column;
  min-width: 200px;
  padding: 6px;
  background: var(--bg-elevated, #fdfdfd);
  border-radius: var(--drop-radius, 14px);
  box-shadow: var(--drop-shadow, 0 14px 36px rgba(40, 30, 35, 0.28));
}
.panel-box.drawer {
  position: relative;
  width: 340px; /* 加宽的下拉组件（左侧选项栏 + 竖分隔线 + 右侧内容区） */
  padding: 12px 16px 16px;
  background: color-mix(in srgb, var(--shell-bg, #77636c) 96%, transparent); /* 与边框同半透明深紫 */
  color: var(--header-text, #f5f1f3);
  border-radius: 0 0 var(--drop-radius, 14px) var(--drop-radius, 14px); /* 上边两角不圆贴顶栏，下两角圆角度形 */
  box-shadow: 0 12px 28px rgba(40, 30, 35, 0.3);
  display: flex;
  flex-direction: row;
  align-items: stretch;
  /* 与边框一致的毛玻璃：半透明深紫 + 轻微模糊（透出桌面，悬浮亚克力） */
  backdrop-filter: blur(30px) saturate(150%);
  -webkit-backdrop-filter: blur(30px) saturate(150%);
}

/* ---- 左栏：主类别四选（Minecraft.net 官方页式） ---- */
.drawer-side {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 92px;
  flex-shrink: 0;
}
.side-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 10px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--header-text, #f5f1f3);
  font-family: inherit;
  font-size: 0.88rem;
  line-height: 1;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s ease, color 0.12s ease;
}
.side-icon { flex-shrink: 0; opacity: 0.88; }
.side-item:hover { background: rgba(255, 255, 255, 0.12); color: #fff; }
.side-item.active {
  background: #fff;
  color: var(--shell-bg, #77636c);
  font-weight: 650;
}

/* 竖分隔线：贯穿左右两栏的浅色粗线 */
.drawer-divider {
  width: 1.5px;
  flex-shrink: 0;
  margin: 2px 14px;
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.30);
}

/* 右栏：选中类别的内容区 */
.drawer-main { flex: 1; min-width: 0; }

/* ---- Minecraft megamenu 式下拉分组：类别 + 多样形态（home 大磁贴 / list 列表条 / card 整行大色块） ---- */
.nav-group { margin-bottom: 12px; }
.nav-group:last-child { margin-bottom: 0; }
.nav-group-title {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--header-text, #f5f1f3);
  opacity: 0.62;
  margin: 0 4px 6px;
  user-select: none;
}

/* 磁贴基础（深紫底浅色字，hover 白半透明底，active 反色）；形态差异由父级 variant 决定 */
.nav-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border-radius: 10px;
  color: var(--header-text, #f5f1f3);
  text-decoration: none;
  font-size: 0.85rem;
  line-height: 1.15;
  transition: background 0.12s ease, color 0.12s ease;
}
button.nav-tile {
  border: none;
  background: transparent;
  font-family: inherit;
  cursor: pointer;
}
.tile-icon {
  flex-shrink: 0;
  opacity: 0.92;
}
.nav-tile:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}
.nav-tile.router-link-active,
.nav-tile.active {
  background: #fff;
  color: var(--shell-bg, #77636c);
  font-weight: 600;
}

/* 首页：2 列大磁贴（图标上/文字下） */
.variant-home .nav-group-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}
.variant-home .nav-tile {
  flex-direction: column;
  padding: 16px 6px 13px;
  font-weight: 550;
}
.variant-home .tile-icon { width: 26px; height: 26px; }

/* 资源：单列紧凑列表条（图标左/文字右，竖排） */
.variant-list .nav-group-grid {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.variant-list .nav-tile {
  flex-direction: row;
  justify-content: flex-start;
  gap: 9px;
  padding: 10px 12px;
  text-align: left;
}
.variant-list .tile-icon { width: 20px; height: 20px; }

/* 账户/插件：单列整行大色块（图标居中大/文字下） */
.variant-card .nav-group-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.variant-card .nav-tile {
  flex-direction: column;
  padding: 18px 10px 15px;
  font-weight: 550;
}
.variant-card .tile-icon { width: 28px; height: 28px; }

/* ---- 内容区：浅粉面板，四周缩进露出深紫边框（顶 52px、左右/底 8px），自身圆角（局部元素 border-radius 可靠） ---- */
.app-main-rim {
  flex: 1;
  display: flex;
  flex-direction: column;
  margin: 52px var(--rim-width, 8px) var(--rim-width, 8px) var(--rim-width, 8px);
  background: color-mix(in srgb, var(--bg, #b6abb0) 74%, transparent);
  border-radius: var(--shell-radius, 18px);
  overflow: hidden;
  /* 内部毛玻璃：浅粉主体半透明 + 模糊，透出（被模糊的）桌面/边框，呈亚克力质感 */
  backdrop-filter: blur(40px) saturate(150%);
  -webkit-backdrop-filter: blur(40px) saturate(150%);
  /* 深紫边框与内部浅粉主体之间的柔和内阴影：细内描边带出内缘厚度 + 大半径光晕向主体渐隐。
     颜色取自 --shell-bg 半透明，随主题换肤自动跟随；下层 @supports 给出极旧 WebKit 的兜底。 */
  box-shadow: inset 0 0 0 1.5px rgba(40, 30, 35, 0.16), inset 0 0 32px 18px color-mix(in srgb, var(--shell-bg, #77636c) 56%, transparent);
}
@supports not (color: color-mix(in srgb, red, transparent)) {
  .app-main-rim { box-shadow: inset 0 0 0 1.5px rgba(40, 30, 35, 0.16), inset 0 0 32px 18px rgba(40, 30, 35, 0.30); }
}
/* 不支持 backdrop-filter 的极旧内核：半透明背景若无模糊会直接透出桌面（难看且不可读），退回实色 */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .app-shell { background: var(--shell-bg, #77636c); }
  .app-main-rim { background: var(--bg, #b6abb0); }
  .panel-box.drawer { background: var(--shell-bg, #77636c); }
}
.app-main {
  flex: 1;
  overflow: auto;
  padding: 1.2rem 1.4rem;
}

/* ---- 苹果划屏（整页推卡）：页容器 transform 跟手 + router-view 上下滑动 ---- */
.page-swipe-sheet {
  min-height: 100%;
  transition: transform 0.25s cubic-bezier(0.22, 0.8, 0.28, 1);
}
.page-swipe-sheet.dragging {
  transition: none; /* 跟手瞬时，不做过渡 */
}
.page-swipe-sheet.dragging,
.page-swipe-sheet.dragging * {
  user-select: none; /* 划屏中关掉文本选择/拖拽 */
}
/* 切页：新页/旧页整页上下推入推出（next=向上推出，prev=向下推出）
   注：Vue transition 运行时动态加的 class 不带 scoped data 属性，须 :global() 才能命中。 */
:global(.swipe-next-enter-active),
:global(.swipe-next-leave-active),
:global(.swipe-prev-enter-active),
:global(.swipe-prev-leave-active) {
  transition: transform 0.34s cubic-bezier(0.22, 0.8, 0.28, 1);
}
:global(.swipe-next-enter-from),
:global(.swipe-next-leave-to) {
  transform: translateY(-100%);
}
:global(.swipe-prev-enter-from),
:global(.swipe-prev-leave-to) {
  transform: translateY(100%);
}

/* 页脚布局插件的 slot 容器（样式由插件自己的 class 提供，这里仅留基础间隔） */
.plugin-slot-footer {
  margin: 0.4rem 0;
  padding: 0.4rem 1rem;
  border-top: 1px solid var(--border, #c9bec3);
  color: var(--text-dim, #8b8490);
}

/* M11-3：游戏运行状态列 —— 内容区底部圆角长条视窗 */
.run-status {
  margin: 0.4rem 0.8rem;
  padding: 0.5rem 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  background: rgba(74, 144, 226, 0.08);
  border: 1px solid rgba(74, 144, 226, 0.28);
  border-radius: 12px;
}
.run-item { display: flex; align-items: center; gap: 0.55rem; font-size: 0.85rem; }
.run-dot { width: 8px; height: 8px; border-radius: 50%; background: #e5b15c; flex-shrink: 0; }
.run-dot.launched { background: #39c5bb; }
.run-name { font-weight: 600; color: var(--text, #3a3436); }
.run-state { color: var(--text-dim, #8b8490); margin-left: auto; }
</style>
