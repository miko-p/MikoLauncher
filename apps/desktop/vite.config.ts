import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Vite 配置 —— 前端构建。Tauri 2 生产构建由 devUrl / beforeBuildCommand 驱动
export default defineConfig({
  plugins: [vue()],
  // Tauri 需要相对路径（打包进 WebView 时按相对地址取资源）
  base: './',
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // dev 时允许 Tauri 内核访问
    watch: { ignored: ['**/src-tauri/**'] },
  },
})
