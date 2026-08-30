<script setup lang="ts">
/**
 * M13：下载页 —— Modrinth 模组/模组包浏览（回归独立导航页）。
 *
 * 之前 M11 把下载收进「实例 ➕ 弹窗」，但浏览页在 modal 里空间不够（撑破）。
 * 现按用户要求把下载页加回导航，Modrinth 浏览/搜索作为页面主体；「添加实例 → 从模组包开始」
 * 跳转到本页。空间充足，不用受 modal 尺寸限制。
 */
import { useRouter } from 'vue-router'
import ModrinthPackBrowser from '../components/ModrinthPackBrowser.vue'

const router = useRouter()

function goBack() {
  void router.push('/instances')
}
</script>

<template>
  <section class="download-page">
    <div class="row">
      <h2>下载</h2>
      <button class="ghost" @click="goBack">← 返回实例</button>
    </div>
    <p class="muted hint">浏览 Modrinth 的模组包 / 模组，点开选版本即可创建实例；模组包依赖会在首次启动时自动安装。</p>
    <ModrinthPackBrowser @close="goBack" @back="goBack" />
  </section>
</template>

<style scoped>
.download-page { display: flex; flex-direction: column; gap: 0.6rem; }
.row { display: flex; align-items: center; gap: 0.8rem; }
.row h2 { margin: 0; }
.ghost { background: transparent; color: var(--text, #3a3436); border: 1px solid var(--border, #c9bec3);
  padding: 0.35rem 0.9rem; border-radius: 8px; cursor: pointer; }
.muted { color: var(--text-dim, #888); margin: 0; }
.hint { font-size: 0.85rem; }
</style>
