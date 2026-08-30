<script setup lang="ts">
import { onMounted, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useUiStore } from './stores/ui'
import { useHomeStore } from './stores/home'
import { useInstanceStore } from './stores/instances'
import { syncPluginRoutes } from './router'

const router = useRouter()
const uiStore = useUiStore()
const home = useHomeStore()
const instances = useInstanceStore()

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
    <!-- 顶部边框内的品牌 + 悬停下拉（仿 caelestia）：鼠标移到 MikoLauncher 弹出白色圆角悬浮菜单，含全部导航项 -->
    <div class="brand-bar">
      <div class="brand-trigger">
        <span class="brand-text">MikoLauncher</span>
        <!-- 悬停下拉（仿 caelestia 组件）：加宽面板，导航项单列纵排，图标+文字左对齐 -->
        <div class="brand-panel">
          <nav class="panel-box drawer">
            <template v-for="v in uiStore.views" :key="v.key">
              <router-link :to="v.path" class="nav-item">
                <svg class="item-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="viewIcon(v.key)" /></svg>
                <span>{{ v.label }}</span>
              </router-link>
              <!-- 编辑：独立一格，紧跟「主页」正下方（M10-2；切主页编辑态） -->
              <button
                v-if="v.key === 'home'"
                type="button"
                class="nav-item nav-edit-row"
                :class="{ active: home.editing }"
                :title="home.editing ? '退出主页编辑' : '编辑首页小组件'"
                @click.stop.prevent="editHome()"
              >
                <svg class="item-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3zM13.5 6.5l3 3" /></svg>
                <span>{{ home.editing ? '完成' : '编辑' }}</span>
              </button>
            </template>
          </nav>
        </div>
      </div>
    </div>
    <!-- 浅色内容区，四周被深紫圆角边框包住，圆角由 shell / 自身统一裁 -->
    <main class="app-main-rim">
      <!-- 小组件面板已移入首页 HomeView（M10-2 起只挂在首页路由，编辑/添加/调大小也在首页）。
           页脚通用布局 slot 仍是全局注入点。 -->
      <div class="app-main">
        <router-view />
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
  background: var(--shell-bg, #77636c);
  border-radius: var(--shell-radius, 18px);
  transform: translateZ(0);
  overflow: hidden;
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
.brand-trigger:hover .brand-panel,
.brand-trigger:focus-within .brand-panel {
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
  width: 240px; /* 加宽的下拉组件（单列纵排） */
  padding: 8px;
  background: var(--shell-bg, #77636c); /* 与顶栏同深紫 */
  color: var(--header-text, #f5f1f3);
  border-radius: 0 0 var(--drop-radius, 14px) var(--drop-radius, 14px); /* 上边两角不圆贴顶栏，下两角圆角度形 */
  box-shadow: 0 12px 28px rgba(40, 30, 35, 0.3);
  display: flex;
  flex-direction: column; /* 单列纵排：每项一行；M10-3 「编辑」紧跟主页下方 */
  gap: 2px;
}

/* 抽屉/下拉内导航项：圆角方块，图标+文字左对齐 */
.nav-item {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 9px;
  padding: 0.5rem 0.8rem;
  border-radius: 9px;
  color: var(--text, #3a3436);
  text-decoration: none;
  font-size: 0.9rem;
  transition: background 0.12s ease, color 0.12s ease;
  white-space: nowrap;
  text-align: left;
}
/* 编辑行是 <button>：清掉 button 默认样式以免和 nav-item 冲突 */
button.nav-item {
  border: none;
  background: transparent;
  font-family: inherit;
  cursor: pointer;
  width: 100%;
}
.item-icon {
  flex-shrink: 0;
}


/* 抽屉内导航项：深紫底上用浅色文字 */
.panel-box.drawer .nav-item {
  color: var(--header-text, #f5f1f3);
}
.panel-box.drawer .nav-item:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}
.panel-box.drawer .nav-item.router-link-active {
  background: #fff;
  color: var(--shell-bg, #77636c);
  font-weight: 600;
}

/* ---- 内容区：浅粉面板，四周缩进露出深紫边框（顶 52px、左右/底 8px），自身圆角（局部元素 border-radius 可靠） ---- */
.app-main-rim {
  flex: 1;
  display: flex;
  flex-direction: column;
  margin: 52px var(--rim-width, 8px) var(--rim-width, 8px) var(--rim-width, 8px);
  background: var(--bg, #b6abb0);
  border-radius: var(--shell-radius, 18px);
  overflow: hidden;
}
.app-main {
  flex: 1;
  overflow: auto;
  padding: 1.2rem 1.4rem;
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

/* ---- 下拉「编辑」行（独立一格，紧跟主页下方；M10-2）----
   编辑行复用 .nav-item 布局；编辑态 active 反色（白底深紫字）高亮。 */
.panel-box.drawer .nav-item.nav-edit-row {
  margin-top: 2px;
}
.panel-box.drawer .nav-item.nav-edit-row:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}
.panel-box.drawer .nav-item.nav-edit-row.active {
  background: #fff;
  color: var(--shell-bg, #77636c);
  font-weight: 650;
}
</style>
