<script setup lang="ts">
/**
 * AccountWidget —— 主页「账号」小组件内容组件（M10-4）。
 *
 * 渲染在主页面板的账号卡片内（HomeView 对 key='widget-account' 特判渲染本组件，而非 v-html），
 * 因为账号数据是运行时动态的、且需要「点选当前账号」的交互，纯插件静态 html 无法承载。
 *
 * 展示所有账号：微软账号显示真实 Mojang 头像（https://crafatar.com/avatars/<mc-uuid>），
 * 离线账号用「首字母圆形」占位头像（本地 SVG，离线无真实 uuid/头像）。每项带类型徽标，
 * 点击设为「当前账号」（homeStore.currentAccount，持久化）。
 */
import { onMounted } from 'vue'
import type { Account } from '@miko-launcher/shared'
import { useAccountStore } from '../stores/accounts'
import { useHomeStore } from '../stores/home'

const accounts = useAccountStore()
const home = useHomeStore()

onMounted(() => {
  if (accounts.accounts.length === 0) void accounts.fetchAccounts()
})

/** 微软账号的 Mojang 头像 URL（crafatar 用 MC uuid；CSP 已放行 https://crafatar.com）。 */
function avatarUrl(a: Account): string | null {
  if (a.type !== 'microsoft') return null
  return `https://crafatar.com/avatars/${a.id}.png?size=64&overlay`
}

/** 展示名首个可见字符（unicode-safe，兼容中文名） */
function initial(a: Account): string {
  const arr = Array.from(a.name)
  return arr[0] ?? '?'
}

/** 从名字散列一个稳定的柔和底色（用于离线占位头像） */
function initialBg(a: Account): string {
  let h = 0
  for (const ch of a.name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 360
  return `hsl(${h}, 45%, 62%)`
}

/** 类型徽标文案 */
function typeLabel(a: Account): string {
  return a.type === 'microsoft' ? '微软' : '离线'
}
</script>

<template>
  <div class="act-widget">
    <p v-if="accounts.accounts.length === 0" class="act-empty">暂无账号。可到「账号」页添加后回到这里。</p>

    <ul v-else class="act-list">
      <li
        v-for="a in accounts.accounts"
        :key="a.id"
        class="act-item"
        :class="{ active: home.currentAccount === a.id }"
        :title="`设为当前账号：${a.name}`"
        @click="home.setCurrentAccount(a.id)"
      >
        <!-- 头像：微软真实 / 离线首字母占位 -->
        <img
          v-if="avatarUrl(a)"
          class="act-avatar"
          :src="avatarUrl(a)!"
          alt=""
          loading="lazy"
        />
        <span v-else class="act-avatar act-avatar-initial" :style="{ background: initialBg(a) }">
          {{ initial(a) }}
        </span>

        <span class="act-name">{{ a.name }}</span>
        <span class="act-type" :class="a.type">{{ typeLabel(a) }}</span>
        <span v-if="home.currentAccount === a.id" class="act-check">✓</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.act-widget {
  min-height: 40px;
}
.act-empty {
  margin: 0.2rem 0;
  color: var(--text-dim, #8b8490);
  font-size: 0.85rem;
}
.act-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.act-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.35rem 0.55rem;
  border-radius: 9px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.act-item:hover {
  background: var(--accent-soft, rgba(119, 99, 108, 0.1));
}
.act-item.active {
  background: var(--accent-soft, rgba(119, 99, 108, 0.16));
  border-color: var(--accent, #77636c);
}
.act-avatar {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 7px;
  object-fit: cover;
  background: var(--bg-elevated, #fdfdfd);
}
.act-avatar-initial {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 1rem;
  font-weight: 650;
}
.act-name {
  flex: 1;
  min-width: 0;
  font-size: 0.9rem;
  color: var(--text, #3a3436);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.act-type {
  flex-shrink: 0;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  font-size: 0.7rem;
  background: var(--accent-soft, rgba(119, 99, 108, 0.14));
  color: var(--accent, #77636c);
}
.act-type.microsoft {
  background: rgba(70, 120, 190, 0.16);
  color: #2f6fb0;
}
.act-check {
  flex-shrink: 0;
  color: var(--accent, #77636c);
  font-weight: 700;
}
</style>
