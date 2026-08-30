<script setup lang="ts">
/**
 * QuickInstancesWidget —— 主页「快速实例展示」小组件内容组件（M10 扩展）。
 *
 * 类似苹果手机「App 分类区块」/应用库那种分组外观：一块圆角分组卡片，顶部是小标题，
 * 内部是圆角圆点格的实例磁贴（图标 + 名字）。点击磁贴进入该实例详情；磁贴上的小启动键一键启动。
 *
 * 由插件 `widget-quick-instances` 贡献外壳（key='widget-quick-instances'），宿主前端
 * HomeView 对 key 特判渲染本组件（同 widget-account 模式），数据来自实例 store（运行时）。
 */
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useInstanceStore } from '../stores/instances'
import type { Instance } from '@miko-launcher/shared'

const store = useInstanceStore()
const router = useRouter()

/** 默认占位图标（同 InstancesView 的土方块 SVG） */
const DIRT_ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
  <defs>
    <linearGradient id="qit-top" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#c8a36a"/><stop offset="1" stop-color="#b08a52"/>
    </linearGradient>
    <linearGradient id="qit-side" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7a5b38"/><stop offset="1" stop-color="#5e4328"/>
    </linearGradient>
  </defs>
  <polygon points="48,8 84,26 48,44 12,26" fill="url(#qit-top)"/>
  <polygon points="12,26 48,44 48,88 12,70" fill="url(#qit-side)"/>
  <polygon points="84,26 48,44 48,88 84,70" fill="url(#qit-side)"/>
  <circle cx="30" cy="32" r="3" fill="#5e4328"/><circle cx="50" cy="18" r="2.5" fill="#5e4328"/>
  <circle cx="66" cy="36" r="3" fill="#6b4d2e"/><circle cx="40" cy="60" r="3" fill="#4a321d"/>
  <circle cx="62" cy="66" r="2.5" fill="#4a321d"/>
</svg>`,
  )

/** 实例实际显示图标：有自定义 icon 用之，否则默认土块占位。 */
function iconSrc(inst: Instance): string {
  return inst.icon && inst.icon.trim() !== '' ? inst.icon : DIRT_ICON
}

/** 点击磁贴 → 进入实例详情。 */
function openDetail(instId: string) {
  void router.push(`/instances/${instId}`)
}

/** 一键启动（运行中则置灰；真实进度走 download:progress 事件）。 */
function launch(instId: string) {
  if (store.isRunning(instId)) return
  void store.launch(instId)
}

onMounted(() => {
  if (!store.instances.length && !store.loading) store.fetchInstances()
})
</script>

<template>
  <div class="qiw-section">
    <!-- 磁贴网格：苹果应用库式圆角格子（无标题/无加载字样，纯实例磁贴） -->
    <div v-if="store.instances.length" class="qiw-grid">
      <div
        v-for="inst in store.instances"
        :key="inst.id"
        class="qiw-tile"
        :title="`${inst.name} · ${inst.versionId} ${inst.modLoader}`"
        @click="openDetail(inst.id)"
      >
        <div class="qiw-icon" :class="{ running: store.isRunning(inst.id) }">
          <img class="qiw-img" :src="iconSrc(inst)" :alt="inst.name" draggable="false" loading="lazy" />
          <!-- 运行中角标 -->
          <span v-if="store.isRunning(inst.id)" class="qiw-run" title="运行中">●</span>
          <!-- 一键启动 -->
          <button
            class="qiw-launch"
            :class="{ busy: store.isRunning(inst.id) }"
            :disabled="store.isRunning(inst.id)"
            :title="store.isRunning(inst.id) ? `${inst.name} 运行中` : `启动 ${inst.name}`"
            @click.stop="launch(inst.id)"
          >
            {{ store.isRunning(inst.id) ? '⟳' : '▶' }}
          </button>
        </div>
        <span class="qiw-name" :title="inst.name">{{ inst.name }}</span>
      </div>
    </div>
    <p v-else-if="!store.loading" class="qiw-empty">暂无实例。到「实例」页新建后可在这里快速启动。</p>
  </div>
</template>

<style scoped>
.qiw-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.qiw-empty {
  margin: 0.1rem 0;
  font-size: 0.82rem;
  color: var(--text-dim, #8b8490);
}

/* 磁贴网格：自适应列数，大圆角格子（应用库风格） */
.qiw-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 0.7rem;
}
.qiw-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.32rem;
  cursor: pointer;
  border-radius: 18px;
  padding: 0.35rem 0.2rem 0.25rem;
  transition: background 0.12s ease, transform 0.12s ease;
}
.qiw-tile:hover {
  background: rgba(255, 255, 255, 0.35);
  transform: translateY(-1px);
}
.qiw-icon {
  position: relative;
  width: 58px;
  height: 58px;
  border-radius: 20px; /* 大圆角（类 iOS app 图标） */
  overflow: hidden;
  background: rgba(255, 255, 255, 0.5);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  box-shadow: 0 2px 8px rgba(40, 30, 35, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.6);
  flex-shrink: 0;
}
.qiw-icon.running { opacity: 0.78; }
.qiw-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
}
/* 运行中角标（右上角小绿点） */
.qiw-run {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #39c5bb;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.7);
}
/* 一键启动小按钮（磁贴右下角，悬浮于图标上） */
.qiw-launch {
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: rgba(74, 144, 226, 0.85);
  color: #fff;
  font-size: 0.6rem;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(30, 20, 25, 0.25);
}
.qiw-launch.busy {
  background: rgb(214, 78, 96);
  cursor: default;
}
.qiw-name {
  max-width: 100%;
  font-size: 0.72rem;
  color: var(--text, #3a3436);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
}
</style>
