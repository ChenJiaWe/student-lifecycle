import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

export default defineConfig({
  plugins: [
    // 必须排在 react() 之前：插件要先生成 routeTree.gen.ts 并改写路由文件，
    // 之后 react() 才对最终结果做 JSX 转换与 HMR 处理。顺序反了路由生成不生效。
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // 开发时把 /api 代理到 Nest，做到与生产同域 —— httpOnly cookie 无需
    // CORS、无需 SameSite=None，浏览器直接带上。
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
