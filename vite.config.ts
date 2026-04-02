import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBase = env.VITE_API_BASE_URL || 'http://localhost:3001'
  const basePath = env.VITE_BASE_PATH || '/'

  return {
    plugins: [react()],
    base: basePath,
    server: {
      proxy: {
        '/api': {
          target: apiBase,
          changeOrigin: true,
          secure: true,
        },
      },
    },
  }
})
